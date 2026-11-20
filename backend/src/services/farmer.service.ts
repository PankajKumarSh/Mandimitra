import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { CreateBankAccountInput, CreateFarmerInput, FarmerListQuery, UpdateFarmerInput } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { FieldCipher } from '../utils/field-crypto.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeActivity, writeAudit } from './audit.service.ts';
import { istToday, postFarmerEntry } from './ledger.service.ts';
import { nextDocumentNumber } from './sequence.service.ts';

const listSelect = {
  id: true,
  code: true,
  name: true,
  nameHindi: true,
  fatherName: true,
  mobile: true,
  village: true,
  district: true,
  currentBalance: true,
  isActive: true,
  createdAt: true,
} as const;

const SORTS: Record<FarmerListQuery['sort'], Prisma.FarmerOrderByWithRelationInput> = {
  name: { name: 'asc' },
  '-name': { name: 'desc' },
  code: { code: 'asc' },
  '-code': { code: 'desc' },
  createdAt: { createdAt: 'asc' },
  '-createdAt': { createdAt: 'desc' },
  balance: { currentBalance: 'asc' },
  '-balance': { currentBalance: 'desc' },
};

const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });

export class FarmerService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cipher: FieldCipher,
  ) {}

  async list(t: TenantContext, q: FarmerListQuery) {
    const where: Prisma.FarmerWhereInput = {
      deletedAt: null,
      ...(q.isActive !== undefined ? { isActive: q.isActive } : {}),
      ...(q.village ? { village: contains(q.village) } : {}),
      ...(q.district ? { district: contains(q.district) } : {}),
      ...(q.q
        ? {
            OR: [
              { name: contains(q.q) },
              { nameHindi: contains(q.q) },
              { fatherName: contains(q.q) },
              { code: contains(q.q) },
              { village: contains(q.q) },
              ...(/^\d{3,}$/.test(q.q.replace(/\s/g, '')) ? [{ mobile: { contains: q.q.replace(/\s/g, '') } }] : []),
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      t.db.farmer.findMany({
        where,
        select: listSelect,
        orderBy: [SORTS[q.sort], { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      t.db.farmer.count({ where }),
    ]);
    return { items, total };
  }

  /** Distinct villages for the filter dropdown. */
  async villages(t: TenantContext) {
    const rows = await t.db.farmer.findMany({
      where: { deletedAt: null, village: { not: null } },
      distinct: ['village'],
      select: { village: true },
      orderBy: { village: 'asc' },
      take: 500,
    });
    return rows.map((r) => r.village!);
  }

  private async findLive(t: TenantContext, id: string) {
    const farmer = await t.db.farmer.findFirst({ where: { id, deletedAt: null } });
    if (!farmer) throw Errors.notFound();
    return farmer;
  }

  async get(t: TenantContext, id: string) {
    const farmer = await this.findLive(t, id);
    const bankAccounts = t.permissions.has('farmer:bank') ? await this.listBankAccounts(t, id) : undefined;
    return { ...farmer, bankAccounts };
  }

  async summary(t: TenantContext, id: string) {
    const farmer = await this.findLive(t, id);
    const [lots, lastLot, unbilled, pattis] = await Promise.all([
      t.db.lot.count({ where: { farmerId: id, status: { not: 'CANCELLED' } } }),
      t.db.lot.findFirst({ where: { farmerId: id, status: { not: 'CANCELLED' } }, orderBy: { arrivalDate: 'desc' }, select: { arrivalDate: true } }),
      t.db.purchase.aggregate({ where: { farmerId: id, status: 'ACTIVE', pattiId: null }, _sum: { grossAmount: true }, _count: true }),
      t.db.patti.count({ where: { farmerId: id, status: 'FINALIZED' } }),
    ]);
    return {
      farmerId: id,
      currentBalance: farmer.currentBalance,
      openingBalance: farmer.openingBalance,
      lotCount: lots,
      lastArrivalDate: lastLot?.arrivalDate ?? null,
      unbilledPurchases: { count: unbilled._count, amount: unbilled._sum.grossAmount ?? new Prisma.Decimal(0) },
      finalizedPattiCount: pattis,
    };
  }

  async create(t: TenantContext, actorUserId: string, input: CreateFarmerInput, ctx: RequestContext) {
    const limit = await this.prisma.subscription.findUnique({
      where: { businessId: t.businessId },
      select: { plan: { select: { maxFarmers: true } } },
    });
    const maxFarmers = limit?.plan.maxFarmers ?? null;
    if (maxFarmers !== null) {
      const used = await t.db.farmer.count({ where: { deletedAt: null } });
      if (used >= maxFarmers) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { limit: maxFarmers, used, resource: 'farmers' });
    }

    const warnings: { code: 'DUPLICATE_MOBILE'; farmerId: string; farmerCode: string; name: string }[] = [];
    if (input.mobile) {
      const dup = await t.db.farmer.findFirst({ where: { mobile: input.mobile, deletedAt: null }, select: { id: true, code: true, name: true } });
      // Families often share one phone, so this is a warning, not an error.
      if (dup) warnings.push({ code: 'DUPLICATE_MOBILE', farmerId: dup.id, farmerCode: dup.code, name: dup.name });
    }

    const opening = new Prisma.Decimal(input.openingBalance ?? '0');
    const { openingBalance: _ignored, ...fields } = input;

    const farmer = await this.prisma.$transaction(async (tx) => {
      const code = await nextDocumentNumber(tx, t.businessId, 'FARMER');
      const created = await tx.farmer.create({
        data: { ...fields, businessId: t.businessId, code, openingBalance: opening, currentBalance: 0, createdById: actorUserId },
      });
      if (!opening.isZero()) {
        await postFarmerEntry(tx, {
          businessId: t.businessId,
          farmerId: created.id,
          entryDate: istToday(),
          entryType: 'OPENING_BALANCE',
          ...(opening.isPositive() ? { credit: opening } : { debit: opening.abs() }),
          narration: 'Opening balance / प्रारंभिक शेष',
          createdById: actorUserId,
        });
      }
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Farmer', entityId: created.id, after: created }, ctx);
      return tx.farmer.findUniqueOrThrow({ where: { id: created.id } });
    });
    return { farmer, warnings };
  }

  async update(t: TenantContext, actorUserId: string, id: string, input: UpdateFarmerInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.farmer.findFirst({ where: { id, businessId: t.businessId, deletedAt: null } });
      if (!before) throw Errors.notFound();
      const after = await tx.farmer.update({
        where: { id },
        data: {
          ...input,
          ...(input.whatsappConsent && input.whatsappConsent !== before.whatsappConsent ? { whatsappConsentAt: new Date() } : {}),
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'Farmer', entityId: id, before, after }, ctx);
      return after;
    });
  }

  /** Soft delete. Refused while money is outstanding either way. */
  async remove(t: TenantContext, actorUserId: string, id: string, ctx: RequestContext) {
    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ currentBalance: string }[]>`
        SELECT "currentBalance"::text AS "currentBalance" FROM "Farmer"
        WHERE "id" = ${id}::uuid AND "businessId" = ${t.businessId}::uuid AND "deletedAt" IS NULL FOR UPDATE`;
      if (!rows[0]) throw Errors.notFound();
      const balance = new Prisma.Decimal(rows[0].currentBalance);
      if (!balance.isZero()) throw Errors.unprocessable('FARMER_HAS_BALANCE', { currentBalance: balance.toFixed(2) });
      await tx.farmer.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'DELETE', entityType: 'Farmer', entityId: id }, ctx);
    });
  }

  // ---------------------------------------------------------------- bank accounts

  async listBankAccounts(t: TenantContext, farmerId: string) {
    const rows = await t.db.farmerBankAccount.findMany({ where: { farmerId }, orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] });
    return rows.map(({ accountNumberEnc: _enc, businessId: _b, ...r }) => ({ ...r, accountNumberMasked: `XXXXXX${r.accountNumberLast4}` }));
  }

  async addBankAccount(t: TenantContext, actorUserId: string, farmerId: string, input: CreateBankAccountInput, ctx: RequestContext) {
    await this.findLive(t, farmerId);
    const { accountNumber, ...rest } = input;
    const created = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.farmerBankAccount.count({ where: { businessId: t.businessId, farmerId } });
      const isPrimary = input.isPrimary ?? existing === 0;
      if (isPrimary) {
        await tx.farmerBankAccount.updateMany({ where: { businessId: t.businessId, farmerId, isPrimary: true }, data: { isPrimary: false } });
      }
      const row = await tx.farmerBankAccount.create({
        data: {
          ...rest,
          businessId: t.businessId,
          farmerId,
          isPrimary,
          accountNumberEnc: this.cipher.encrypt(accountNumber),
          accountNumberLast4: accountNumber.slice(-4),
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'FarmerBankAccount', entityId: row.id, after: { farmerId, last4: row.accountNumberLast4, ifsc: row.ifsc } }, ctx);
      return row;
    });
    const { accountNumberEnc: _e, businessId: _b, ...safe } = created;
    return { ...safe, accountNumberMasked: `XXXXXX${created.accountNumberLast4}` };
  }

  /** Full number, for making a transfer. Every reveal is logged. */
  async revealBankAccount(t: TenantContext, actorUserId: string, farmerId: string, accountId: string, ctx: RequestContext) {
    const row = await t.db.farmerBankAccount.findFirst({ where: { id: accountId, farmerId } });
    if (!row) throw Errors.notFound();
    await writeActivity(this.prisma, { businessId: t.businessId, userId: actorUserId, activityType: 'BANK_DETAILS_VIEWED', metadata: { farmerId, accountId } }, ctx);
    return { id: row.id, accountNumber: this.cipher.decrypt(row.accountNumberEnc), ifsc: row.ifsc, accountHolderName: row.accountHolderName };
  }

  async removeBankAccount(t: TenantContext, actorUserId: string, farmerId: string, accountId: string, ctx: RequestContext) {
    const res = await t.db.farmerBankAccount.deleteMany({ where: { id: accountId, farmerId } });
    if (res.count === 0) throw Errors.notFound();
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'DELETE', entityType: 'FarmerBankAccount', entityId: accountId, before: { farmerId } }, ctx);
  }
}
