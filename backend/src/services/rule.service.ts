import type { PrismaClient } from '@mandimitra/database';
import type { CreateRuleInput, UpdateRuleInput } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';

const day = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * Commission & charge rules. Rules are never deleted: pattis and sales keep a snapshot of the values they
 * used, and deactivating (or setting effectiveTo) is how a rate change is recorded.
 */
export class RuleService {
  constructor(private readonly prisma: PrismaClient) {}

  list(t: TenantContext, appliesTo?: 'FARMER' | 'BUYER') {
    return t.db.commissionRule.findMany({
      where: appliesTo ? { appliesTo } : {},
      include: { commodity: { select: { id: true, name: true, nameHindi: true } } },
      orderBy: [{ isActive: 'desc' }, { appliesTo: 'asc' }, { chargeType: 'asc' }, { priority: 'desc' }, { name: 'asc' }],
    });
  }

  private async checkCommodity(t: TenantContext, commodityId: string | null | undefined) {
    if (commodityId && !(await t.db.commodity.count({ where: { id: commodityId } }))) throw Errors.notFound();
  }

  async create(t: TenantContext, actorUserId: string, input: CreateRuleInput, ctx: RequestContext) {
    await this.checkCommodity(t, input.commodityId);
    return this.prisma.$transaction(async (tx) => {
      const rule = await tx.commissionRule.create({
        data: {
          ...input,
          businessId: t.businessId,
          commodityId: input.commodityId ?? null,
          effectiveFrom: day(input.effectiveFrom),
          effectiveTo: input.effectiveTo ? day(input.effectiveTo) : null,
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'CommissionRule', entityId: rule.id, after: rule }, ctx);
      return rule;
    });
  }

  async update(t: TenantContext, actorUserId: string, id: string, input: UpdateRuleInput, ctx: RequestContext) {
    await this.checkCommodity(t, input.commodityId);
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.commissionRule.findFirst({ where: { id, businessId: t.businessId } });
      if (!before) throw Errors.notFound();
      const merged = {
        calcMethod: input.calcMethod ?? before.calcMethod,
        value: input.value ?? before.value.toString(),
        from: input.effectiveFrom ?? before.effectiveFrom.toISOString().slice(0, 10),
        to: input.effectiveTo === undefined ? before.effectiveTo?.toISOString().slice(0, 10) : input.effectiveTo,
      };
      if (merged.calcMethod === 'PERCENTAGE' && Number(merged.value) > 100) throw Errors.validation([{ location: 'body', path: 'value', message: 'Percentage cannot exceed 100' }]);
      if (merged.to && merged.to < merged.from) throw Errors.validation([{ location: 'body', path: 'effectiveTo', message: 'End date must be on or after start date' }]);

      const after = await tx.commissionRule.update({
        where: { id },
        data: {
          ...input,
          ...(input.effectiveFrom ? { effectiveFrom: day(input.effectiveFrom) } : {}),
          ...(input.effectiveTo !== undefined ? { effectiveTo: input.effectiveTo ? day(input.effectiveTo) : null } : {}),
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'CommissionRule', entityId: id, before, after }, ctx);
      return after;
    });
  }
}
