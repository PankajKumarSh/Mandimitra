import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { CreatePaymentInput, PaymentListQuery } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';
import { businessForDocs } from './documents/business.ts';
import { renderReceipt, type ReceiptDoc } from './documents/templates.ts';
import { istDateString, istToday, postBuyerEntry, postFarmerEntry } from './ledger.service.ts';
import { nextDocumentNumber } from './sequence.service.ts';

type Tx = Prisma.TransactionClient;
const D = Prisma.Decimal;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

const include = {
  farmer: { select: { id: true, code: true, name: true, nameHindi: true, village: true, mobile: true } },
  buyer: { select: { id: true, code: true, firmName: true, city: true, mobile: true } },
  createdBy: { select: { fullName: true } },
} as const;

export interface PaymentWarning {
  code: 'DUPLICATE_REFERENCE' | 'OVERPAYMENT';
  receiptNumber?: string;
  outstanding?: string;
}

export class PaymentService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Record money paid to a farmer or received from a buyer. One transaction:
   * lock party → validate against the LOCKED balance → number → insert → ledger → audit.
   * The Idempotency-Key is also stored on the row (unique per business) as a second, DB-level guard.
   */
  async create(t: TenantContext, actorUserId: string, input: CreatePaymentInput, idempotencyKey: string, ctx: RequestContext) {
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    const amount = new D(input.amount);
    const paymentDate = day(input.paymentDate);
    const ref = input.referenceNumber?.trim() || null;

    const warnings: PaymentWarning[] = [];
    if (ref && input.mode !== 'CASH') {
      const dup = await t.db.payment.findFirst({ where: { mode: input.mode, referenceNumber: ref, status: 'ACTIVE' }, select: { receiptNumber: true } });
      // UTR/UPI refs should be unique, but cheque numbers can repeat across banks: warn, don't block.
      if (dup) warnings.push({ code: 'DUPLICATE_REFERENCE', receiptNumber: dup.receiptNumber });
    }

    const payment = await this.prisma.$transaction(async (tx) => {
      const receiptNumber = await nextDocumentNumber(tx, t.businessId, 'PAYMENT', { date: paymentDate, fiscalYearStartMonth: settings.fiscalYearStartMonth });
      const common = {
        businessId: t.businessId,
        receiptNumber,
        mode: input.mode,
        referenceNumber: ref,
        amount,
        paymentDate,
        remarks: input.remarks ?? null,
        idempotencyKey,
        createdById: actorUserId,
      };

      if (input.partySide === 'FARMER') {
        const balance = await this.lockedBalance(tx, 'Farmer', t.businessId, input.farmerId);
        const payable = D.max(balance, 0);
        if (input.purpose === 'SETTLEMENT' && amount.gt(payable)) {
          throw Errors.unprocessable('PAYMENT_EXCEEDS_PAYABLE', { payable: payable.toFixed(2) });
        }
        if (input.purpose === 'ADVANCE' && !settings.allowNegativeFarmerBalance && amount.gt(payable)) {
          throw Errors.unprocessable('ADVANCE_NOT_ALLOWED', { payable: payable.toFixed(2) });
        }
        const p = await tx.payment.create({ data: { ...common, partySide: 'FARMER', farmerId: input.farmerId, direction: 'OUTGOING', purpose: input.purpose } });
        await postFarmerEntry(tx, {
          businessId: t.businessId,
          farmerId: input.farmerId,
          entryDate: paymentDate,
          entryType: input.purpose === 'ADVANCE' ? 'ADVANCE' : 'PAYMENT',
          debit: amount,
          narration: `${input.purpose === 'ADVANCE' ? 'Advance' : 'Payment'} ${receiptNumber} · ${input.mode}${ref ? ` ${ref}` : ''}`,
          paymentId: p.id,
          createdById: actorUserId,
        });
        return p;
      }

      const outstanding = await this.lockedBalance(tx, 'Buyer', t.businessId, input.buyerId);
      if (amount.gt(D.max(outstanding, 0))) warnings.push({ code: 'OVERPAYMENT', outstanding: D.max(outstanding, 0).toFixed(2) });
      const p = await tx.payment.create({ data: { ...common, partySide: 'BUYER', buyerId: input.buyerId, direction: 'INCOMING', purpose: 'COLLECTION' } });
      await postBuyerEntry(tx, {
        businessId: t.businessId,
        buyerId: input.buyerId,
        entryDate: paymentDate,
        entryType: 'PAYMENT',
        credit: amount,
        narration: `Received ${receiptNumber} · ${input.mode}${ref ? ` ${ref}` : ''}`,
        paymentId: p.id,
        createdById: actorUserId,
      });
      return p;
    });

    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Payment', entityId: payment.id, after: payment }, ctx);
    return { payment: await this.get(t, payment.id), warnings };
  }

  private async lockedBalance(tx: Tx, table: 'Farmer' | 'Buyer', businessId: string, id: string): Promise<Prisma.Decimal> {
    const rows =
      table === 'Farmer'
        ? await tx.$queryRaw<{ b: string; active: boolean }[]>`
            SELECT "currentBalance"::text AS b, "isActive" AS active FROM "Farmer" WHERE "id" = ${id}::uuid AND "businessId" = ${businessId}::uuid AND "deletedAt" IS NULL FOR UPDATE`
        : await tx.$queryRaw<{ b: string; active: boolean }[]>`
            SELECT "currentBalance"::text AS b, "isActive" AS active FROM "Buyer" WHERE "id" = ${id}::uuid AND "businessId" = ${businessId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound();
    return new D(rows[0].b);
  }

  /** Cancel executor: reverses the ledger entry. Never deletes. */
  cancelTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "Payment" WHERE "id" = ${id}::uuid AND "businessId" = ${t.businessId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound();
    const p = await tx.payment.findUniqueOrThrow({ where: { id } });
    if (p.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');
    await tx.payment.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });

    const narration = `Cancelled ${p.receiptNumber}: ${reason}`.slice(0, 300);
    if (p.partySide === 'FARMER') {
      const orig = await tx.farmerLedgerEntry.findFirstOrThrow({ where: { businessId: t.businessId, paymentId: id, reversalOfId: null, entryType: { in: ['ADVANCE', 'PAYMENT'] } } });
      await postFarmerEntry(tx, { businessId: t.businessId, farmerId: p.farmerId!, entryDate: istToday(), entryType: 'REVERSAL', credit: orig.debit, narration, paymentId: id, reversalOfId: orig.id, createdById: actorUserId });
    } else {
      const orig = await tx.buyerLedgerEntry.findFirstOrThrow({ where: { businessId: t.businessId, paymentId: id, reversalOfId: null, entryType: 'PAYMENT' } });
      await postBuyerEntry(tx, { businessId: t.businessId, buyerId: p.buyerId!, entryDate: istToday(), entryType: 'REVERSAL', debit: orig.credit, narration, paymentId: id, reversalOfId: orig.id, createdById: actorUserId });
    }
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Payment', entityId: id, before: { status: 'ACTIVE' }, after: { status: 'CANCELLED', reason } }, ctx);
    return tx.payment.findUniqueOrThrow({ where: { id }, include });
  };

  async get(t: TenantContext, id: string) {
    const p = await t.db.payment.findUnique({ where: { id }, include });
    if (!p) throw Errors.notFound();
    return p;
  }

  async list(t: TenantContext, q: PaymentListQuery) {
    const where: Prisma.PaymentWhereInput = {
      ...(q.partySide ? { partySide: q.partySide } : {}),
      ...(q.farmerId ? { farmerId: q.farmerId } : {}),
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.mode ? { mode: q.mode } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { paymentDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
    };
    const active = { ...where, status: 'ACTIVE' as const };
    const [items, total, paid, received] = await Promise.all([
      t.db.payment.findMany({ where, include, orderBy: [{ paymentDate: 'desc' }, { receiptNumber: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.payment.count({ where }),
      t.db.payment.aggregate({ where: { ...active, direction: 'OUTGOING' }, _sum: { amount: true } }),
      t.db.payment.aggregate({ where: { ...active, direction: 'INCOMING' }, _sum: { amount: true } }),
    ]);
    return { items, total, totals: { paidOut: paid._sum.amount ?? new D(0), received: received._sum.amount ?? new D(0) } };
  }

  async receiptHtml(t: TenantContext, id: string, autoPrint: boolean) {
    const p = await this.get(t, id);
    const entry =
      p.partySide === 'FARMER'
        ? await t.db.farmerLedgerEntry.findFirst({ where: { paymentId: id, reversalOfId: null }, select: { balanceAfter: true } })
        : await t.db.buyerLedgerEntry.findFirst({ where: { paymentId: id, reversalOfId: null }, select: { balanceAfter: true } });
    const doc: ReceiptDoc = {
      business: await businessForDocs(this.prisma, t.businessId),
      receiptNumber: p.receiptNumber,
      paymentDate: p.paymentDate.toISOString().slice(0, 10),
      direction: p.direction,
      purpose: p.purpose,
      mode: p.mode,
      referenceNumber: p.referenceNumber,
      amount: p.amount.toFixed(2),
      party: p.farmer
        ? { code: p.farmer.code, name: p.farmer.name, nameHindi: p.farmer.nameHindi, extra: p.farmer.village }
        : { code: p.buyer!.code, name: p.buyer!.firmName, nameHindi: null, extra: p.buyer!.city },
      remarks: p.remarks,
      balanceAfter: entry ? entry.balanceAfter.toFixed(2) : null,
      balanceLabel: p.partySide === 'FARMER' ? { hi: 'इसके बाद बकाया (देना)', en: 'Balance after (payable)' } : { hi: 'इसके बाद बकाया (लेना)', en: 'Balance after (receivable)' },
      status: p.status,
      cancelReason: p.cancelReason,
      generatedAt: `${istDateString()} IST`,
    };
    return { html: renderReceipt(doc, { autoPrint }), fileName: `${p.receiptNumber.replaceAll('/', '-')}.pdf` };
  }
}
