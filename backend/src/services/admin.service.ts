import { Prisma, type PrismaClient, type SubscriptionStatus } from '@mandimitra/database';
import type { RequestHandler } from 'express';
import { effectiveSubscriptionStatus, type TenantCache } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';

const DAY = 86_400_000;

/**
 * Re-checks the platform-admin flag in the database on every request: a revoked admin loses access
 * immediately, not when their access token expires.
 */
export function requirePlatformAdmin(prisma: PrismaClient): RequestHandler {
  return async (req, _res, next) => {
    if (!req.auth) return next(Errors.unauthenticated());
    const u = await prisma.user.findUnique({ where: { id: req.auth.userId }, select: { isPlatformAdmin: true, status: true } });
    if (!u || u.status !== 'ACTIVE' || !u.isPlatformAdmin) return next(Errors.forbidden());
    next();
  };
}

/**
 * Super Admin console. Platform metadata only (businesses, owners, plans, SaaS payments, counts).
 * It deliberately has no access to a business's ledgers, parties or transactions.
 */
export class AdminService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cache: TenantCache,
  ) {}

  async overview() {
    const now = new Date();
    const d30 = new Date(now.getTime() - 30 * DAY);
    const [byStatus, subs, revenue30, failed30, signups30] = await Promise.all([
      this.prisma.business.groupBy({ by: ['status'], _count: { _all: true } }),
      this.prisma.subscription.findMany({ select: { status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { code: true, priceMonthly: true, maxStaffUsers: true } } } }),
      this.prisma.billingPayment.aggregate({ where: { status: 'SUCCEEDED', verifiedAt: { gte: d30 } }, _sum: { amount: true }, _count: { _all: true } }),
      this.prisma.billingPayment.count({ where: { status: 'FAILED', createdAt: { gte: d30 } } }),
      this.prisma.business.count({ where: { createdAt: { gte: d30 } } }),
    ]);

    const subscriptions: Record<string, number> = {};
    const plans: Record<string, number> = {};
    let mrr = new Prisma.Decimal(0);
    let trialsEndingIn7Days = 0;
    for (const s of subs) {
      const eff = effectiveSubscriptionStatus({ status: s.status, planCode: s.plan.code, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, maxStaffUsers: s.plan.maxStaffUsers }, now);
      subscriptions[eff] = (subscriptions[eff] ?? 0) + 1;
      if (eff === 'ACTIVE') {
        mrr = mrr.plus(s.plan.priceMonthly);
        plans[s.plan.code] = (plans[s.plan.code] ?? 0) + 1;
      }
      if (eff === 'TRIALING' && s.trialEndsAt && s.trialEndsAt.getTime() - now.getTime() <= 7 * DAY) trialsEndingIn7Days++;
    }

    return {
      businesses: Object.fromEntries(byStatus.map((b) => [b.status, b._count._all])),
      subscriptions,
      activePaidByPlan: plans,
      /** Sum of monthly prices of subscriptions in a paid, unexpired period. Not revenue received. */
      mrr: mrr.toFixed(2),
      revenueLast30Days: (revenue30._sum.amount ?? new Prisma.Decimal(0)).toFixed(2),
      paymentsLast30Days: revenue30._count._all,
      failedPaymentsLast30Days: failed30,
      signupsLast30Days: signups30,
      trialsEndingIn7Days,
      generatedAt: now,
    };
  }

  async listBusinesses(q: { page: number; pageSize: number; q?: string; status?: string; subscriptionStatus?: SubscriptionStatus }) {
    const digits = q.q?.replace(/\D/g, '');
    const where: Prisma.BusinessWhereInput = {
      ...(q.status ? { status: q.status as Prisma.BusinessWhereInput['status'] } : {}),
      ...(q.subscriptionStatus ? { subscription: { status: q.subscriptionStatus } } : {}),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' } },
              { nameHindi: { contains: q.q } },
              { city: { contains: q.q, mode: 'insensitive' } },
              { owner: { fullName: { contains: q.q, mode: 'insensitive' } } },
              ...(digits && digits.length >= 4 ? [{ owner: { mobile: { contains: digits } } }] : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.business.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, name: true, nameHindi: true, city: true, state: true, status: true, createdAt: true,
          owner: { select: { fullName: true, mobile: true } },
          subscription: { select: { status: true, trialEndsAt: true, currentPeriodEnd: true, plan: { select: { code: true, maxStaffUsers: true } } } },
          _count: { select: { memberships: { where: { status: 'ACTIVE' } }, farmers: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.business.count({ where }),
    ]);
    const now = new Date();
    return [
      rows.map((b) => ({
        ...b,
        subscription: b.subscription && {
          ...b.subscription,
          effectiveStatus: effectiveSubscriptionStatus({ status: b.subscription.status, planCode: b.subscription.plan.code, trialEndsAt: b.subscription.trialEndsAt, currentPeriodEnd: b.subscription.currentPeriodEnd, maxStaffUsers: b.subscription.plan.maxStaffUsers }, now),
        },
      })),
      total,
    ] as const;
  }

  async getBusiness(id: string) {
    const b = await this.prisma.business.findUnique({
      where: { id },
      select: {
        id: true, name: true, nameHindi: true, mandiName: true, city: true, district: true, state: true, gstin: true, phone: true, email: true,
        status: true, suspendedAt: true, suspendReason: true, createdAt: true,
        owner: { select: { id: true, fullName: true, mobile: true, email: true, lastLoginAt: true } },
        subscription: { include: { plan: { select: { code: true, name: true, priceMonthly: true, maxStaffUsers: true } }, pendingPlan: { select: { code: true } } } },
        _count: { select: { memberships: { where: { status: 'ACTIVE' } }, farmers: { where: { deletedAt: null } }, buyers: { where: { deletedAt: null } }, lots: true, pattis: true } },
      },
    });
    if (!b) throw Errors.notFound();
    const [events, payments, lastActivity] = await Promise.all([
      this.prisma.subscriptionEvent.findMany({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      this.prisma.billingPayment.findMany({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, take: 50, include: { plan: { select: { code: true } } } }),
      this.prisma.staffActivity.findFirst({ where: { businessId: id }, orderBy: { createdAt: 'desc' }, select: { createdAt: true, activityType: true } }),
    ]);
    const s = b.subscription;
    return {
      ...b,
      subscription: s && { ...s, effectiveStatus: effectiveSubscriptionStatus({ status: s.status, planCode: s.plan.code, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, maxStaffUsers: s.plan.maxStaffUsers }) },
      events,
      payments,
      lastActivity,
    };
  }

  async setSuspended(adminId: string, id: string, suspend: boolean, reason: string | null, ctx: RequestContext) {
    const b = await this.prisma.business.findUnique({ where: { id }, select: { status: true, suspendReason: true } });
    if (!b) throw Errors.notFound();
    const to = suspend ? 'SUSPENDED' : 'ACTIVE';
    if (b.status !== to) {
      await this.prisma.$transaction(async (tx) => {
        await tx.business.update({ where: { id }, data: suspend ? { status: 'SUSPENDED', suspendedAt: new Date(), suspendReason: reason } : { status: 'ACTIVE', suspendedAt: null, suspendReason: null } });
        await writeAudit(tx, { businessId: id, actorUserId: adminId, action: 'UPDATE', entityType: 'Business', entityId: id, before: { status: b.status, suspendReason: b.suspendReason }, after: { status: to, reason, by: 'platform_admin' } }, ctx);
      });
      this.cache.invalidate({ businessId: id });
    }
    return this.getBusiness(id);
  }

  /**
   * Goodwill extension (support cases, onboarding). Trial-only accounts get a longer trial; accounts that
   * have paid before get a longer paid period. Always recorded with the reason.
   */
  async extend(adminId: string, id: string, days: number, reason: string, ctx: RequestContext) {
    const sub = await this.prisma.subscription.findUnique({ where: { businessId: id } });
    if (!sub) throw Errors.notFound();
    const now = Date.now();
    const add = days * DAY;
    const trialOnly = !sub.currentPeriodEnd;
    const data: Prisma.SubscriptionUpdateInput = trialOnly
      ? { status: 'TRIALING', trialEndsAt: new Date(Math.max(now, sub.trialEndsAt?.getTime() ?? now) + add) }
      : { status: 'ACTIVE', currentPeriodEnd: new Date(Math.max(now, sub.currentPeriodEnd!.getTime()) + add) };
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.subscription.update({ where: { id: sub.id }, data });
      await tx.subscriptionEvent.create({
        data: { businessId: id, subscriptionId: sub.id, eventType: 'EXTENDED_BY_ADMIN', fromStatus: sub.status, toStatus: updated.status, actorUserId: adminId, metadata: { days, reason, trialEndsAt: updated.trialEndsAt, currentPeriodEnd: updated.currentPeriodEnd } },
      });
      await writeAudit(tx, { businessId: id, actorUserId: adminId, action: 'UPDATE', entityType: 'Subscription', entityId: sub.id, before: { status: sub.status, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd }, after: { status: updated.status, trialEndsAt: updated.trialEndsAt, currentPeriodEnd: updated.currentPeriodEnd, days, reason, by: 'platform_admin' } }, ctx);
    });
    this.cache.invalidate({ businessId: id });
    return this.getBusiness(id);
  }

  listPayments(q: { page: number; pageSize: number; status?: string }) {
    const where: Prisma.BillingPaymentWhereInput = q.status ? { status: q.status as Prisma.BillingPaymentWhereInput['status'] } : { status: { not: 'CREATED' } };
    return Promise.all([
      this.prisma.billingPayment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: { id: true, amount: true, status: true, gatewayOrderId: true, gatewayPaymentId: true, verifiedAt: true, failureReason: true, createdAt: true, plan: { select: { code: true } }, business: { select: { id: true, name: true } } },
      }),
      this.prisma.billingPayment.count({ where }),
    ]);
  }
}
