import type { Prisma, PrismaClient, SubscriptionPlan } from '@mandimitra/database';
import { DEFAULT_COMMODITIES, DEFAULT_EXPENSE_CATEGORIES } from '@mandimitra/shared';
import type { z } from 'zod';
import type { updateBusinessSchema, updateSettingsSchema } from '@mandimitra/shared';
import type { TenantCache } from '../middleware/tenant.ts';
import type { RequestContext } from '../utils/http.ts';
import { Errors } from '../utils/errors.ts';
import { writeAudit } from './audit.service.ts';

/**
 * Creates everything a new business needs, inside the registration transaction:
 * settings, owner membership, default commodities & expense categories, trial subscription.
 * Commission rules are intentionally NOT created — each business configures its own rates.
 */
export async function bootstrapBusiness(
  tx: Prisma.TransactionClient,
  args: { businessId: string; ownerUserId: string; ownerRoleId: string; trialPlan: SubscriptionPlan; now: Date },
) {
  const { businessId, ownerUserId, ownerRoleId, trialPlan, now } = args;

  await tx.businessSettings.create({ data: { businessId } });
  await tx.businessMembership.create({
    data: { businessId, userId: ownerUserId, roleId: ownerRoleId, status: 'ACTIVE', joinedAt: now },
  });
  await tx.commodity.createMany({
    data: DEFAULT_COMMODITIES.map((c, i) => ({ businessId, name: c.name, nameHindi: c.nameHindi, sortOrder: i })),
  });
  await tx.expenseCategory.createMany({
    data: DEFAULT_EXPENSE_CATEGORIES.map((c) => ({ businessId, name: c.name, nameHindi: c.nameHindi, isSystem: true })),
  });

  const trialEndsAt = new Date(now.getTime() + trialPlan.trialDays * 86_400_000);
  const subscription = await tx.subscription.create({
    data: { businessId, planId: trialPlan.id, status: 'TRIALING', trialEndsAt },
  });
  await tx.subscriptionEvent.create({
    data: {
      businessId,
      subscriptionId: subscription.id,
      eventType: 'TRIAL_STARTED',
      toStatus: 'TRIALING',
      toPlanCode: trialPlan.code,
      actorUserId: ownerUserId,
      metadata: { trialDays: trialPlan.trialDays },
    },
  });
}

const businessPublicSelect = {
  id: true,
  name: true,
  nameHindi: true,
  mandiName: true,
  licenseNumber: true,
  gstin: true,
  phone: true,
  email: true,
  addressLine: true,
  city: true,
  district: true,
  state: true,
  pincode: true,
  status: true,
  createdAt: true,
} as const;

export class BusinessService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: TenantCache,
  ) {}

  async getCurrent(businessId: string) {
    const business = await this.prisma.business.findUnique({ where: { id: businessId }, select: businessPublicSelect });
    if (!business) throw Errors.notFound();
    return business;
  }

  async updateCurrent(
    businessId: string,
    actorUserId: string,
    input: z.infer<typeof updateBusinessSchema>,
    ctx: RequestContext,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.business.findUnique({ where: { id: businessId }, select: businessPublicSelect });
      if (!before) throw Errors.notFound();
      const after = await tx.business.update({ where: { id: businessId }, data: input, select: businessPublicSelect });
      await writeAudit(tx, { businessId, actorUserId, action: 'UPDATE', entityType: 'Business', entityId: businessId, before, after }, ctx);
      return after;
    });
  }

  async getSettings(businessId: string) {
    const s = await this.prisma.businessSettings.findUnique({ where: { businessId } });
    if (!s) throw Errors.notFound();
    return s;
  }

  async updateSettings(
    businessId: string,
    actorUserId: string,
    input: z.infer<typeof updateSettingsSchema>,
    ctx: RequestContext,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      const before = await tx.businessSettings.findUnique({ where: { businessId } });
      if (!before) throw Errors.notFound();
      const after = await tx.businessSettings.update({ where: { businessId }, data: input });
      await writeAudit(tx, { businessId, actorUserId, action: 'UPDATE', entityType: 'BusinessSettings', entityId: businessId, before, after }, ctx);
      return after;
    });
    this.cache.invalidate({ businessId });
    return result;
  }
}
