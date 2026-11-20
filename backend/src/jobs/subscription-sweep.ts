import type { PrismaClient, SubscriptionStatus } from '@mandimitra/database';
import type { Env } from '../config/env.ts';
import type { Logger } from '../config/logger.ts';
import type { TenantCache } from '../middleware/tenant.ts';
import { sweepAction } from '../services/billing/lifecycle.ts';

const fmt = (d: Date) => d.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' });

/**
 * Nightly: moves subscriptions through their lifecycle and reminds owners before access turns read-only.
 *   TRIALING past trial end           → EXPIRED
 *   ACTIVE past period end            → PAST_DUE (or CANCELLED if cancel was scheduled); a scheduled
 *                                        downgrade becomes the current plan at this moment
 *   PAST_DUE beyond BILLING_GRACE_DAYS → EXPIRED
 *   3 and 1 days before the end       → in-app reminder to the owner (once per period per day-mark)
 * Access never depends on this job having run: effectiveSubscriptionStatus() already treats a lapsed
 * date as read-only. The job makes the stored state, reminders and admin reports match.
 */
export class SubscriptionSweep {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly logger: Logger,
    private readonly cache?: TenantCache,
  ) {}

  /** `businessIds` narrows the sweep (tests run against a shared database). */
  async run(now = new Date(), opts: { businessIds?: string[] } = {}) {
    const counts = { expiredTrials: 0, lapsed: 0, expired: 0, reminders: 0, downgradesApplied: 0 };
    const subs = await this.prisma.subscription.findMany({
      where: { status: { in: ['TRIALING', 'ACTIVE', 'PAST_DUE'] }, business: { status: 'ACTIVE' }, ...(opts.businessIds ? { businessId: { in: opts.businessIds } } : {}) },
      include: { plan: { select: { code: true, priceMonthly: true } }, pendingPlan: { select: { code: true } }, business: { select: { ownerUserId: true } } },
    });

    for (const s of subs) {
      const a = sweepAction(
        { status: s.status, planCode: s.plan.code, planPrice: s.plan.priceMonthly, trialEndsAt: s.trialEndsAt, currentPeriodEnd: s.currentPeriodEnd, cancelAtPeriodEnd: s.cancelAtPeriodEnd, hasPendingPlan: !!s.pendingPlanId },
        now,
        this.env.BILLING_GRACE_DAYS,
      );
      if (a.action === 'NONE') continue;

      if (a.action === 'REMIND') {
        const end = (s.status === 'TRIALING' ? s.trialEndsAt : s.currentPeriodEnd)!;
        const marker = `${end.toISOString()}:${a.daysLeft}`;
        const already = await this.prisma.subscriptionEvent.findFirst({ where: { subscriptionId: s.id, eventType: 'REMINDER_SENT', metadata: { path: ['marker'], equals: marker } } });
        if (already) continue;
        const trial = s.status === 'TRIALING';
        await this.prisma.$transaction([
          this.prisma.notification.create({
            data: {
              businessId: s.businessId,
              userId: s.business.ownerUserId,
              type: 'SUBSCRIPTION_EXPIRING',
              title: trial ? `ट्रायल ${a.daysLeft} दिन में समाप्त होगा` : `सदस्यता ${a.daysLeft} दिन में समाप्त होगी`,
              body: `${fmt(end)} के बाद खाता केवल देखने के लिए रहेगा। जारी रखने के लिए प्लान चुनकर भुगतान करें।`,
              link: '/billing',
            },
          }),
          this.prisma.subscriptionEvent.create({ data: { businessId: s.businessId, subscriptionId: s.id, eventType: 'REMINDER_SENT', metadata: { marker, daysLeft: a.daysLeft } } }),
        ]);
        counts.reminders++;
        continue;
      }

      let to: SubscriptionStatus;
      let planId = s.planId;
      let eventType: string;
      if (a.action === 'EXPIRE_TRIAL') {
        to = 'EXPIRED';
        eventType = 'TRIAL_EXPIRED';
        counts.expiredTrials++;
      } else if (a.action === 'LAPSE') {
        to = a.to;
        eventType = a.to === 'CANCELLED' ? 'CANCELLED' : 'LAPSED';
        if (a.applyPendingPlan && s.pendingPlanId) {
          planId = s.pendingPlanId;
          counts.downgradesApplied++;
        }
        counts.lapsed++;
      } else {
        to = 'EXPIRED';
        eventType = 'EXPIRED';
        counts.expired++;
      }

      // Conditional update: if a payment activated this subscription meanwhile, leave it alone.
      const r = await this.prisma.subscription.updateMany({
        where: { id: s.id, status: s.status, updatedAt: s.updatedAt },
        data: { status: to, planId, ...(planId !== s.planId ? { pendingPlanId: null } : {}) },
      });
      if (r.count === 0) continue;
      await this.prisma.subscriptionEvent.create({
        data: { businessId: s.businessId, subscriptionId: s.id, eventType, fromStatus: s.status, toStatus: to, fromPlanCode: s.plan.code, toPlanCode: planId !== s.planId ? s.pendingPlan?.code ?? null : s.plan.code, metadata: { by: 'sweep' } },
      });
      this.cache?.invalidate({ businessId: s.businessId });
    }

    this.logger.info(counts, 'jobs.subscription_sweep');
    return counts;
  }
}
