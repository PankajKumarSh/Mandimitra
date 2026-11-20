import type { PrismaClient } from '@mandimitra/database';
import type { CreateCommodityInput, UpdateCommodityInput } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';

export class CommodityService {
  constructor(private readonly prisma: PrismaClient) {}

  list(t: TenantContext, includeInactive: boolean) {
    return t.db.commodity.findMany({
      where: includeInactive ? {} : { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: { grades: { where: includeInactive ? {} : { isActive: true }, orderBy: { name: 'asc' } } },
    });
  }

  async get(t: TenantContext, id: string) {
    const c = await t.db.commodity.findUnique({ where: { id }, include: { grades: { orderBy: { name: 'asc' } } } });
    if (!c) throw Errors.notFound();
    return c;
  }

  async create(t: TenantContext, actorUserId: string, input: CreateCommodityInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.commodity.create({ data: { ...input, businessId: t.businessId } });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Commodity', entityId: created.id, after: created }, ctx);
      return created;
    });
  }

  async update(t: TenantContext, actorUserId: string, id: string, input: UpdateCommodityInput, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.commodity.findFirst({ where: { id, businessId: t.businessId } });
      if (!before) throw Errors.notFound();
      // Validate the BAG rule against the merged result, not just the patch.
      const merged = { ...before, ...input };
      const usesBag = merged.defaultUnit === 'BAG' || merged.rateUnit === 'BAG';
      if (usesBag && !merged.bagWeightKg) throw Errors.unprocessable('BAG_WEIGHT_REQUIRED');

      const after = await tx.commodity.update({ where: { id }, data: input });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'Commodity', entityId: id, before, after }, ctx);
      return after;
    });
  }

  async addGrade(t: TenantContext, actorUserId: string, commodityId: string, name: string, ctx: RequestContext) {
    await this.get(t, commodityId);
    const grade = await t.db.commodityGrade.create({ data: { commodityId, name } as never });
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'CommodityGrade', entityId: grade.id, after: grade }, ctx);
    return grade;
  }

  /** Grades are referenced by lots, so they are deactivated rather than deleted. */
  async setGradeActive(t: TenantContext, actorUserId: string, commodityId: string, gradeId: string, isActive: boolean, ctx: RequestContext) {
    const res = await t.db.commodityGrade.updateMany({ where: { id: gradeId, commodityId }, data: { isActive } });
    if (res.count === 0) throw Errors.notFound();
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'CommodityGrade', entityId: gradeId, after: { isActive } }, ctx);
    return t.db.commodityGrade.findUniqueOrThrow({ where: { id: gradeId } });
  }
}
