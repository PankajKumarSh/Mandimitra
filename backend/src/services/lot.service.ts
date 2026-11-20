import { Prisma, type LotStatus, type PrismaClient } from '@mandimitra/database';
import type { CreateLotInput, LotListQuery, UpdateLotInput } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';
import { CalcError, lotNetKg, toKg } from './calculation/engine.ts';
import { nextDocumentNumber } from './sequence.service.ts';

type Tx = Prisma.TransactionClient;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

/** Status follows sold weight. Never manually settable. */
export function lotStatusFor(sold: Prisma.Decimal, net: Prisma.Decimal): LotStatus {
  if (sold.isZero()) return 'CONFIRMED';
  return sold.gte(net) ? 'SOLD' : 'PARTIALLY_SOLD';
}

/** Row lock on a lot for the rest of the transaction; returns the fresh row. */
export async function lockLot(tx: Tx, businessId: string, lotId: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "Lot" WHERE "id" = ${lotId}::uuid AND "businessId" = ${businessId}::uuid FOR UPDATE`;
  if (!rows[0]) throw Errors.notFound();
  return tx.lot.findUniqueOrThrow({ where: { id: lotId }, include: { commodity: true } });
}

export function mapCalcError(err: unknown): never {
  if (err instanceof CalcError) {
    if (err.code === 'INVALID_INPUT') throw Errors.validation([{ location: 'body', path: '', message: err.message }]);
    throw Errors.unprocessable(err.code);
  }
  throw err;
}

const listInclude = {
  farmer: { select: { id: true, code: true, name: true, nameHindi: true, village: true } },
  commodity: { select: { id: true, name: true, nameHindi: true, rateUnit: true, defaultUnit: true, bagWeightKg: true } },
  grade: { select: { id: true, name: true } },
} as const;

export class LotService {
  constructor(private readonly prisma: PrismaClient) {}

  private async validateRefs(t: TenantContext, farmerId: string, commodityId: string, gradeId: string | null | undefined) {
    const [farmer, commodity] = await Promise.all([
      t.db.farmer.findFirst({ where: { id: farmerId, deletedAt: null }, select: { isActive: true } }),
      t.db.commodity.findUnique({ where: { id: commodityId }, select: { isActive: true } }),
    ]);
    if (!farmer || !commodity) throw Errors.notFound();
    if (!farmer.isActive) throw Errors.unprocessable('INACTIVE_PARTY');
    if (!commodity.isActive) throw Errors.unprocessable('COMMODITY_INACTIVE');
    if (gradeId) {
      const g = await t.db.commodityGrade.findFirst({ where: { id: gradeId, commodityId, isActive: true } });
      if (!g) throw Errors.unprocessable('GRADE_MISMATCH');
    }
  }

  private weights(unit: 'KG' | 'QUINTAL', gross: string, tare: string) {
    try {
      const grossKg = toKg(gross, unit);
      const tareKg = toKg(tare, unit);
      return { grossWeightKg: grossKg, tareWeightKg: tareKg, netWeightKg: lotNetKg(grossKg, tareKg) };
    } catch (e) {
      mapCalcError(e);
    }
  }

  async create(t: TenantContext, actorUserId: string, input: CreateLotInput, ctx: RequestContext) {
    await this.validateRefs(t, input.farmerId, input.commodityId, input.gradeId);
    const w = this.weights(input.weightUnit, input.grossWeight, input.tareWeight);
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    const arrivalDate = day(input.arrivalDate);

    return this.prisma.$transaction(async (tx) => {
      const lotNumber = await nextDocumentNumber(tx, t.businessId, 'LOT', { date: arrivalDate, fiscalYearStartMonth: settings.fiscalYearStartMonth });
      const lot = await tx.lot.create({
        data: {
          businessId: t.businessId,
          lotNumber,
          farmerId: input.farmerId,
          commodityId: input.commodityId,
          gradeId: input.gradeId ?? null,
          arrivalDate,
          vehicleNumber: input.vehicleNumber ?? null,
          bags: input.bags,
          ...w,
          moisturePercent: input.moisturePercent ?? null,
          remarks: input.remarks ?? null,
          status: input.confirm ? 'CONFIRMED' : 'DRAFT',
          confirmedAt: input.confirm ? new Date() : null,
          createdById: actorUserId,
        },
        include: listInclude,
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Lot', entityId: lot.id, after: lot }, ctx);
      return lot;
    });
  }

  async update(t: TenantContext, actorUserId: string, id: string, input: UpdateLotInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await lockLot(tx, t.businessId, id);
      if (before.status !== 'DRAFT') throw Errors.unprocessable('LOT_NOT_EDITABLE');
      if (before.version !== input.version) throw Errors.conflict('VERSION_CONFLICT', { currentVersion: before.version });

      const { version: _v, weightUnit, grossWeight, tareWeight, arrivalDate, ...rest } = input;
      const farmerId = rest.farmerId ?? before.farmerId;
      const commodityId = rest.commodityId ?? before.commodityId;
      const gradeId = rest.gradeId === undefined ? before.gradeId : rest.gradeId;
      await this.validateRefs(t, farmerId, commodityId, gradeId);

      let w = {};
      if (weightUnit) {
        // Re-derive in kg from the unit given; omitted weight keeps its current kg value converted back.
        const divisor = weightUnit === 'QUINTAL' ? 100 : 1;
        const g = grossWeight ?? before.grossWeightKg.div(divisor).toString();
        const tr = tareWeight ?? before.tareWeightKg.div(divisor).toString();
        w = this.weights(weightUnit, g, tr);
      }
      const after = await tx.lot.update({
        where: { id },
        data: {
          ...rest,
          farmerId,
          commodityId,
          gradeId,
          ...(arrivalDate ? { arrivalDate: day(arrivalDate) } : {}),
          ...w,
          version: { increment: 1 },
        },
        include: listInclude,
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'Lot', entityId: id, before, after }, ctx);
      return after;
    });
  }

  async confirm(t: TenantContext, actorUserId: string, id: string, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const lot = await lockLot(tx, t.businessId, id);
      if (lot.status !== 'DRAFT') throw Errors.unprocessable('LOT_NOT_EDITABLE');
      const after = await tx.lot.update({ where: { id }, data: { status: 'CONFIRMED', confirmedAt: new Date(), version: { increment: 1 } }, include: listInclude });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CONFIRM', entityType: 'Lot', entityId: id }, ctx);
      return after;
    });
  }

  /** Cancel executor (used directly and by approvals). */
  cancelTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const lot = await lockLot(tx, t.businessId, id);
    if (lot.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');
    if (!lot.soldWeightKg.isZero() || !lot.purchasedWeightKg.isZero()) throw Errors.unprocessable('LOT_HAS_TRANSACTIONS');
    const after = await tx.lot.update({
      where: { id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason, version: { increment: 1 } },
      include: listInclude,
    });
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Lot', entityId: id, before: { status: lot.status }, after: { status: 'CANCELLED', reason } }, ctx);
    return after;
  };

  async list(t: TenantContext, q: LotListQuery) {
    const where: Prisma.LotWhereInput = {
      ...(q.status === 'OPEN' ? { status: { in: ['CONFIRMED', 'PARTIALLY_SOLD'] } } : q.status ? { status: q.status } : {}),
      ...(q.farmerId ? { farmerId: q.farmerId } : {}),
      ...(q.commodityId ? { commodityId: q.commodityId } : {}),
      ...(q.from || q.to ? { arrivalDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
      ...(q.q
        ? { OR: [{ lotNumber: { contains: q.q, mode: 'insensitive' } }, { vehicleNumber: { contains: q.q, mode: 'insensitive' } }, { farmer: { name: { contains: q.q, mode: 'insensitive' } } }] }
        : {}),
    };
    const [items, total] = await Promise.all([
      t.db.lot.findMany({ where, include: listInclude, orderBy: [{ arrivalDate: 'desc' }, { lotNumber: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.lot.count({ where }),
    ]);
    return { items: items.map(withAvailable), total };
  }

  async get(t: TenantContext, id: string) {
    const lot = await t.db.lot.findUnique({
      where: { id },
      include: {
        ...listInclude,
        sales: { orderBy: { createdAt: 'asc' }, include: { buyer: { select: { id: true, code: true, firmName: true } }, charges: true } },
        purchases: { orderBy: { createdAt: 'asc' }, select: { id: true, purchaseNumber: true, purchaseDate: true, weightKg: true, rate: true, rateUnit: true, grossAmount: true, status: true, saleId: true, pattiId: true } },
      },
    });
    if (!lot) throw Errors.notFound();
    return withAvailable(lot);
  }
}

/** Remaining quantities, so the UI never computes them. */
function withAvailable<T extends { netWeightKg: Prisma.Decimal; soldWeightKg: Prisma.Decimal; purchasedWeightKg: Prisma.Decimal }>(lot: T) {
  return {
    ...lot,
    availableToSellKg: lot.netWeightKg.minus(Prisma.Decimal.max(lot.soldWeightKg, lot.purchasedWeightKg)),
    unsoldKg: lot.netWeightKg.minus(lot.soldWeightKg),
    purchasedUnsoldKg: lot.purchasedWeightKg.minus(lot.soldWeightKg),
  };
}
