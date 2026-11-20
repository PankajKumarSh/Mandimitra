import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { PattiInput, PattiListQuery } from '@mandimitra/shared';
import type { TenantContext } from '../../middleware/tenant.ts';
import { Errors } from '../../utils/errors.ts';
import type { RequestContext } from '../../utils/http.ts';
import { writeAudit } from '../audit.service.ts';
import { computePatti, type ChargeLine, type PattiComputation } from '../calculation/engine.ts';
import { istDateString, istToday, postFarmerEntry } from '../ledger.service.ts';
import { mapCalcError } from '../lot.service.ts';
import { nextDocumentNumber } from '../sequence.service.ts';
import type { PdfRenderer } from './pdf.ts';
import { renderPattiHtml, type PattiDoc } from './template.ts';

type Tx = Prisma.TransactionClient;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const D = Prisma.Decimal;
const qtl = (kg: Prisma.Decimal) => kg.div(100).toFixed(2, D.ROUND_HALF_UP);
const ymd = (d: Date) => d.toISOString().slice(0, 10);

const lineSelect = {
  id: true,
  purchaseNumber: true,
  purchaseDate: true,
  commodityId: true,
  weightKg: true,
  bags: true,
  rate: true,
  rateUnit: true,
  grossAmount: true,
  lot: { select: { lotNumber: true } },
  commodity: { select: { name: true, nameHindi: true } },
} as const;

function detail(d: { calcMethod: string; rateValue: Prisma.Decimal; baseValue: Prisma.Decimal; isManual: boolean }): string {
  if (d.isManual) return '';
  switch (d.calcMethod) {
    case 'PERCENTAGE':
      return `(${d.rateValue.toString()}%)`;
    case 'PER_QUINTAL':
      return `(₹${d.rateValue.toString()} × ${qtl(d.baseValue)} qtl)`;
    case 'PER_KG':
      return `(₹${d.rateValue.toString()} × ${d.baseValue.toString()} kg)`;
    case 'PER_BAG':
      return `(₹${d.rateValue.toString()} × ${d.baseValue.toFixed(0)})`;
    default:
      return '';
  }
}

export class PattiService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly pdf: PdfRenderer,
  ) {}

  /** Loads everything the engine needs. `forUpdate` locks the farmer row first (finalize path). */
  private async gather(db: Tx | PrismaClient, t: TenantContext, input: PattiInput, forUpdate: boolean) {
    if (forUpdate) {
      const rows = await (db as Tx).$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "Farmer" WHERE "id" = ${input.farmerId}::uuid AND "businessId" = ${t.businessId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound();
    }
    const farmer = await db.farmer.findFirst({ where: { id: input.farmerId, businessId: t.businessId, deletedAt: null } });
    if (!farmer) throw Errors.notFound();

    const lines = await db.purchase.findMany({
      where: {
        businessId: t.businessId,
        farmerId: input.farmerId,
        status: 'ACTIVE',
        pattiId: null,
        ...(input.purchaseIds ? { id: { in: input.purchaseIds } } : {}),
      },
      select: lineSelect,
      orderBy: [{ purchaseDate: 'asc' }, { purchaseNumber: 'asc' }],
    });
    if (lines.length === 0) throw Errors.unprocessable('NO_UNBILLED_PURCHASES');
    if (input.purchaseIds && lines.length !== new Set(input.purchaseIds).size) throw Errors.conflict('PURCHASES_CHANGED');

    const [rules, settings] = await Promise.all([
      db.commissionRule.findMany({ where: { businessId: t.businessId, isActive: true, appliesTo: 'FARMER' } }),
      db.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } }),
    ]);
    const outstandingAdvance = farmer.currentBalance.isNegative() ? farmer.currentBalance.abs() : new D(0);

    let calc: PattiComputation;
    try {
      calc = computePatti({
        lines: lines.map((l) => ({ id: l.id, commodityId: l.commodityId, weightKg: l.weightKg, bags: l.bags, grossAmount: l.grossAmount })),
        rules,
        manualDeductions: input.manualDeductions,
        date: day(input.pattiDate),
        outstandingAdvance,
        autoAdjustAdvance: settings.autoAdjustAdvanceInPatti,
        netRounding: settings.netRounding,
      });
    } catch (e) {
      mapCalcError(e);
    }
    return { farmer, lines, calc, settings, outstandingAdvance };
  }

  /** Read-only preview — what the patti will look like if finalized now. */
  async preview(t: TenantContext, input: PattiInput) {
    const { farmer, lines, calc, outstandingAdvance } = await this.gather(this.prisma, t, input, false);
    return {
      farmer: { id: farmer.id, code: farmer.code, name: farmer.name, nameHindi: farmer.nameHindi, currentBalance: farmer.currentBalance },
      outstandingAdvance,
      lines,
      ...calc,
    };
  }

  /**
   * Finalize. One transaction: lock farmer → recompute from fresh data → number → insert patti + deduction
   * snapshot → claim purchases (conditional update; a concurrent patti makes the count mismatch → rollback)
   * → credit farmer ledger (net + round-off) → audit.
   */
  async create(t: TenantContext, actorUserId: string, input: PattiInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const { farmer, lines, calc, settings } = await this.gather(tx, t, input, true);
      const business = await tx.business.findUniqueOrThrow({ where: { id: t.businessId } });
      const pattiDate = day(input.pattiDate);
      const pattiNumber = await nextDocumentNumber(tx, t.businessId, 'PATTI', { date: pattiDate, fiscalYearStartMonth: settings.fiscalYearStartMonth });

      const patti = await tx.patti.create({
        data: {
          businessId: t.businessId,
          pattiNumber,
          farmerId: farmer.id,
          pattiDate,
          status: 'FINALIZED',
          totalWeightKg: calc.totalWeightKg,
          totalBags: calc.totalBags,
          grossAmount: calc.grossAmount,
          totalDeductions: calc.totalDeductions,
          netAmount: calc.netAmount,
          advanceAdjusted: calc.advanceAdjusted,
          roundOff: calc.roundOff,
          netPayable: calc.netPayable,
          farmerSnapshot: { code: farmer.code, name: farmer.name, nameHindi: farmer.nameHindi, fatherName: farmer.fatherName, village: farmer.village, district: farmer.district, mobile: farmer.mobile },
          businessSnapshot: {
            name: business.name, nameHindi: business.nameHindi, mandiName: business.mandiName, licenseNumber: business.licenseNumber, gstin: business.gstin,
            addressLine: business.addressLine, city: business.city, district: business.district, state: business.state, phone: business.phone,
          },
          notes: input.notes ?? null,
          finalizedAt: new Date(),
          finalizedById: actorUserId,
          createdById: actorUserId,
        },
      });
      if (calc.deductions.length) {
        await tx.deduction.createMany({
          data: calc.deductions.map((d: ChargeLine, i) => ({
            businessId: t.businessId,
            pattiId: patti.id,
            commissionRuleId: d.ruleId,
            chargeType: d.chargeType,
            calcMethod: d.calcMethod,
            rateValue: d.rateValue,
            baseValue: d.baseValue,
            amount: d.amount,
            label: d.label,
            labelHindi: d.labelHindi,
            isManual: d.isManual,
            sortOrder: i,
          })),
        });
      }
      const claimed = await tx.purchase.updateMany({
        where: { businessId: t.businessId, id: { in: lines.map((l) => l.id) }, status: 'ACTIVE', pattiId: null },
        data: { pattiId: patti.id },
      });
      if (claimed.count !== lines.length) throw Errors.conflict('PURCHASES_CHANGED');

      if (calc.ledgerCredit.gt(0)) {
        await postFarmerEntry(tx, {
          businessId: t.businessId,
          farmerId: farmer.id,
          entryDate: pattiDate,
          entryType: 'PATTI_CREDIT',
          credit: calc.ledgerCredit,
          narration: `Patti ${pattiNumber} · ${lines.length} purchase(s) · ${qtl(calc.totalWeightKg)} qtl`,
          pattiId: patti.id,
          createdById: actorUserId,
        });
      }
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'FINALIZE', entityType: 'Patti', entityId: patti.id, after: { ...patti, deductions: calc.deductions, purchaseIds: lines.map((l) => l.id) } }, ctx);
      return this.getWith(tx, t.businessId, patti.id);
    });
  }

  /** Cancel executor: reverses the ledger credit and releases purchases back to "unbilled". */
  cancelTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const rows = await tx.$queryRaw<{ id: string; status: string; farmerId: string; pattiNumber: string }[]>`
      SELECT "id", "status"::text, "farmerId", "pattiNumber" FROM "Patti"
      WHERE "id" = ${id}::uuid AND "businessId" = ${t.businessId}::uuid FOR UPDATE`;
    const p = rows[0];
    if (!p) throw Errors.notFound();
    if (p.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');

    await tx.purchase.updateMany({ where: { businessId: t.businessId, pattiId: id }, data: { pattiId: null } });
    await tx.patti.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } } });
    const credit = await tx.farmerLedgerEntry.findFirst({ where: { businessId: t.businessId, pattiId: id, entryType: 'PATTI_CREDIT' } });
    if (credit) {
      await postFarmerEntry(tx, {
        businessId: t.businessId,
        farmerId: p.farmerId,
        entryDate: istToday(),
        entryType: 'REVERSAL',
        debit: credit.credit,
        narration: `Cancelled patti ${p.pattiNumber}: ${reason}`.slice(0, 300),
        pattiId: id,
        reversalOfId: credit.id,
        createdById: actorUserId,
      });
    }
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Patti', entityId: id, before: { status: 'FINALIZED' }, after: { status: 'CANCELLED', reason } }, ctx);
    return this.getWith(tx, t.businessId, id);
  };

  private async getWith(db: Tx | PrismaClient, businessId: string, id: string) {
    const p = await db.patti.findFirst({
      where: { id, businessId },
      include: {
        farmer: { select: { id: true, code: true, name: true, nameHindi: true, mobile: true, whatsappConsent: true } },
        deductions: { orderBy: { sortOrder: 'asc' } },
        purchases: { select: lineSelect, orderBy: [{ purchaseDate: 'asc' }, { purchaseNumber: 'asc' }] },
        finalizedBy: { select: { fullName: true } },
      },
    });
    if (!p) throw Errors.notFound();
    // Cancelled pattis no longer own their purchases; show the lines from the audit snapshot instead.
    if (p.status === 'CANCELLED' && p.purchases.length === 0) {
      const audit = await db.auditLog.findFirst({ where: { businessId, entityType: 'Patti', entityId: id, action: 'FINALIZE' } });
      const ids = ((audit?.after as { purchaseIds?: string[] } | null)?.purchaseIds ?? []) as string[];
      const purchases = ids.length ? await db.purchase.findMany({ where: { businessId, id: { in: ids } }, select: lineSelect, orderBy: [{ purchaseDate: 'asc' }] }) : [];
      return { ...p, purchases };
    }
    return p;
  }

  get(t: TenantContext, id: string) {
    return this.getWith(this.prisma, t.businessId, id);
  }

  async list(t: TenantContext, q: PattiListQuery) {
    const where: Prisma.PattiWhereInput = {
      ...(q.farmerId ? { farmerId: q.farmerId } : {}),
      ...(q.status ? { status: q.status } : { status: { not: 'DRAFT' } }),
      ...(q.from || q.to ? { pattiDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
    };
    const [items, total] = await Promise.all([
      t.db.patti.findMany({
        where,
        include: { farmer: { select: { id: true, code: true, name: true, nameHindi: true, village: true } } },
        orderBy: [{ pattiDate: 'desc' }, { pattiNumber: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      t.db.patti.count({ where }),
    ]);
    return { items, total };
  }

  /** Builds the printable document from the FROZEN snapshots, not live master data. */
  async document(t: TenantContext, id: string): Promise<PattiDoc> {
    const p = await this.get(t, id);
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    const b = (p.businessSnapshot ?? {}) as PattiDoc['business'];
    const f = (p.farmerSnapshot ?? {}) as PattiDoc['farmer'];
    return {
      pattiNumber: p.pattiNumber,
      pattiDate: ymd(p.pattiDate),
      status: p.status,
      cancelReason: p.cancelReason,
      business: b,
      farmer: f,
      lines: p.purchases.map((l) => ({
        lotNumber: l.lot.lotNumber,
        commodity: l.commodity.name,
        commodityHindi: l.commodity.nameHindi,
        date: ymd(l.purchaseDate),
        bags: l.bags,
        weightQtl: qtl(l.weightKg),
        rate: l.rate.toFixed(2),
        rateUnit: l.rateUnit,
        amount: l.grossAmount.toFixed(2),
      })),
      totals: {
        weightQtl: qtl(p.totalWeightKg),
        bags: p.totalBags,
        grossAmount: p.grossAmount.toFixed(2),
        totalDeductions: p.totalDeductions.toFixed(2),
        netAmount: p.netAmount.toFixed(2),
        advanceAdjusted: p.advanceAdjusted.toFixed(2),
        roundOff: p.roundOff.toFixed(2),
        netPayable: p.netPayable.toFixed(2),
      },
      deductions: p.deductions.map((d) => ({ label: d.label, labelHindi: d.labelHindi, detail: detail(d), amount: d.amount.toFixed(2) })),
      footerNote: settings.pattiFooterNote,
      notes: p.notes,
      language: settings.pattiLanguage,
      generatedAt: `${istDateString()} IST`,
    };
  }

  async html(t: TenantContext, id: string, autoPrint: boolean) {
    return renderPattiHtml(await this.document(t, id), { autoPrint });
  }

  async pdfBuffer(t: TenantContext, id: string) {
    if (!this.pdf.available) throw Errors.unprocessable('PDF_UNAVAILABLE');
    const doc = await this.document(t, id);
    return { buffer: await this.pdf.render(renderPattiHtml(doc)), fileName: `${doc.pattiNumber.replaceAll('/', '-')}.pdf` };
  }
}
