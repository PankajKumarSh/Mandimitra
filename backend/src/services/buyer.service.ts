import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { BuyerListQuery, CreateBuyerInput, UpdateBuyerInput } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';
import { istToday, postBuyerEntry } from './ledger.service.ts';
import { nextDocumentNumber } from './sequence.service.ts';

const listSelect = {
  id: true,
  code: true,
  firmName: true,
  ownerName: true,
  mobile: true,
  city: true,
  gstin: true,
  currentBalance: true,
  creditLimit: true,
  isActive: true,
  createdAt: true,
} as const;

const SORTS: Record<BuyerListQuery['sort'], Prisma.BuyerOrderByWithRelationInput> = {
  firmName: { firmName: 'asc' },
  '-firmName': { firmName: 'desc' },
  code: { code: 'asc' },
  '-code': { code: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
  balance: { currentBalance: 'asc' },
  '-balance': { currentBalance: 'desc' },
};

const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });

export class BuyerService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(t: TenantContext, q: BuyerListQuery) {
    const digits = q.q?.replace(/\s/g, '');
    const where: Prisma.BuyerWhereInput = {
      deletedAt: null,
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(q.city ? { city: contains(q.city) } : {}),
      ...(q.hasOutstanding ? { currentBalance: { gt: 0 } } : {}),
      ...(q.q
        ? {
            OR: [
              { firmName: contains(q.q) },
              { ownerName: contains(q.q) },
              { code: contains(q.q) },
              { city: contains(q.q) },
              { gstin: contains(q.q) },
              ...(digits && /^\d{3,}$/.test(digits) ? [{ mobile: { contains: digits } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      t.db.buyer.findMany({ where, select: listSelect, orderBy: [SORTS[q.sort], { id: 'asc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.buyer.count({ where }),
    ]);
    return { items: items.map((b) => ({ ...b, overCreditLimit: isOverLimit(b.currentBalance, b.creditLimit) })), total };
  }

  private async findLive(t: TenantContext, id: string) {
    const buyer = await t.db.buyer.findFirst({ where: { id, deletedAt: null } });
    if (!buyer) throw Errors.notFound();
    return buyer;
  }

  async get(t: TenantContext, id: string) {
    const b = await this.findLive(t, id);
    return { ...b, overCreditLimit: isOverLimit(b.currentBalance, b.creditLimit) };
  }

  async summary(t: TenantContext, id: string) {
    const b = await this.findLive(t, id);
    const [sales, lastSale] = await Promise.all([
      t.db.sale.aggregate({ where: { buyerId: id, status: 'ACTIVE' }, _sum: { totalAmount: true }, _count: true }),
      t.db.sale.findFirst({ where: { buyerId: id, status: 'ACTIVE' }, orderBy: { saleDate: 'desc' }, select: { saleDate: true } }),
    ]);
    return {
      buyerId: id,
      currentBalance: b.currentBalance,
      openingBalance: b.openingBalance,
      creditLimit: b.creditLimit,
      overCreditLimit: isOverLimit(b.currentBalance, b.creditLimit),
      sales: { count: sales._count, amount: sales._sum.totalAmount ?? new Prisma.Decimal(0) },
      lastSaleDate: lastSale?.saleDate ?? null,
    };
  }

  async create(t: TenantContext, actorUserId: string, input: CreateBuyerInput, ctx: RequestContext) {
    const warnings: { code: string; buyerId: string; buyerCode: string; firmName: string }[] = [];
    if (input.gstin) {
      const dup = await t.db.buyer.findFirst({ where: { gstin: input.gstin, deletedAt: null }, select: { id: true, code: true, firmName: true } });
      if (dup) warnings.push({ code: 'DUPLICATE_GSTIN', buyerId: dup.id, buyerCode: dup.code, firmName: dup.firmName });
    }
    const opening = new Prisma.Decimal(input.openingBalance ?? '0');
    const { openingBalance: _o, ...fields } = input;

    const buyer = await this.prisma.$transaction(async (tx) => {
      const code = await nextDocumentNumber(tx, t.businessId, 'BUYER');
      const created = await tx.buyer.create({
        data: { ...fields, businessId: t.businessId, code, openingBalance: opening, currentBalance: 0, createdById: actorUserId },
      });
      if (!opening.isZero()) {
        await postBuyerEntry(tx, {
          businessId: t.businessId,
          buyerId: created.id,
          entryDate: istToday(),
          entryType: 'OPENING_BALANCE',
          ...(opening.isPositive() ? { debit: opening } : { credit: opening.abs() }),
          narration: 'Opening balance / प्रारंभिक शेष',
          createdById: actorUserId,
        });
      }
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Buyer', entityId: created.id, after: created }, ctx);
      return tx.buyer.findUniqueOrThrow({ where: { id: created.id } });
    });
    return { buyer, warnings };
  }

  async update(t: TenantContext, actorUserId: string, id: string, input: UpdateBuyerInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.buyer.findFirst({ where: { id, businessId: t.businessId, deletedAt: null } });
      if (!before) throw Errors.notFound();
      const after = await tx.buyer.update({
        where: { id },
        data: {
          ...input,
          ...(input.whatsappConsent && input.whatsappConsent !== before.whatsappConsent ? { whatsappConsentAt: new Date() } : {}),
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'Buyer', entityId: id, before, after }, ctx);
      return after;
    });
  }

  async remove(t: TenantContext, actorUserId: string, id: string, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ currentBalance: string }[]>`
        SELECT "currentBalance"::text AS "currentBalance" FROM "Buyer"
        WHERE "id" = ${id}::uuid AND "businessId" = ${t.businessId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound();
      const balance = new Prisma.Decimal(rows[0].currentBalance);
      if (!balance.isZero()) throw Errors.unprocessable('BUYER_HAS_BALANCE', { currentBalance: balance.toFixed(2) });
      await tx.buyer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'DELETE', entityType: 'Buyer', entityId: id }, ctx);
    });
  }
}

function isOverLimit(balance: Prisma.Decimal, limit: Prisma.Decimal | null): boolean {
  return limit !== null && balance.greaterThan(limit);
}
