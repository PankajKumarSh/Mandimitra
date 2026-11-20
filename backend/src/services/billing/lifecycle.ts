import { Prisma, type SubscriptionStatus } from '@mandimitra/database';

/**
 * Pure subscription-period arithmetic. No I/O, so every rule is unit-tested.
 *
 * Billing model: prepaid periods (default 30 days), one Razorpay order per period. No card mandates,
 * so UPI works and nothing is ever charged without the owner pressing "Pay".
 */

export type ChangeKind = 'NEW' | 'RENEWAL' | 'UPGRADE' | 'DOWNGRADE';

export interface SubState {
  status: SubscriptionStatus;
  planCode: string;
  planPrice: Prisma.Decimal;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date | null;
}

const DAY = 86_400_000;

/** A paid period that has not ended yet. */
export function hasLivePaidPeriod(s: SubState, now: Date): boolean {
  return s.status === 'ACTIVE' && !!s.currentPeriodEnd && s.currentPeriodEnd > now;
}

/** What paying for `target` would mean right now. */
export function classifyChange(s: SubState, target: { code: string; price: Prisma.Decimal }, now: Date): ChangeKind {
  if (!hasLivePaidPeriod(s, now)) return 'NEW';
  if (target.code === s.planCode) return 'RENEWAL';
  return target.price.gt(s.planPrice) ? 'UPGRADE' : 'DOWNGRADE';
}

/**
 * The paid period a successful payment buys.
 *  - NEW during a live trial: starts when the trial ends (the owner keeps the free days they were promised).
 *  - NEW otherwise (expired / past due / cancelled): starts now.
 *  - RENEWAL: appended to the current period (paying early never loses days).
 *  - UPGRADE: starts now; the unused value of the old plan becomes extra days on the new one:
 *      extra = remaining × oldPrice / newPrice   (floored to whole minutes)
 *  - DOWNGRADE: never paid immediately; it is scheduled for renewal instead (callers reject it).
 */
export function computePeriod(
  s: SubState,
  target: { code: string; price: Prisma.Decimal },
  now: Date,
  periodDays: number,
): { kind: ChangeKind; start: Date; end: Date; creditMs: number } {
  const kind = classifyChange(s, target, now);
  const length = periodDays * DAY;

  if (kind === 'DOWNGRADE') throw new Error('Downgrades are applied at renewal, not paid immediately');

  if (kind === 'RENEWAL') {
    const start = s.currentPeriodEnd!;
    return { kind, start, end: new Date(start.getTime() + length), creditMs: 0 };
  }

  if (kind === 'UPGRADE') {
    const remaining = s.currentPeriodEnd!.getTime() - now.getTime();
    const credit = new Prisma.Decimal(remaining).mul(s.planPrice).div(target.price);
    const creditMs = Math.floor(credit.toNumber() / 60_000) * 60_000;
    return { kind, start: now, end: new Date(now.getTime() + length + creditMs), creditMs };
  }

  const trialLive = s.status === 'TRIALING' && !!s.trialEndsAt && s.trialEndsAt > now;
  const start = trialLive ? s.trialEndsAt! : now;
  return { kind, start, end: new Date(start.getTime() + length), creditMs: 0 };
}

/** Amount in paise for the gateway. Prices are stored as Decimal(10,2) rupees. */
export function toPaise(rupees: Prisma.Decimal): number {
  const p = rupees.mul(100);
  if (!p.isInteger() || p.lte(0)) throw new Error(`Invalid plan price ${rupees.toFixed(2)}`);
  return p.toNumber();
}

/** What the nightly sweep should do with one subscription. */
export type SweepAction =
  | { action: 'NONE' }
  | { action: 'EXPIRE_TRIAL' }
  | { action: 'LAPSE'; to: 'PAST_DUE' | 'CANCELLED'; applyPendingPlan: boolean }
  | { action: 'EXPIRE_PAST_DUE' }
  | { action: 'REMIND'; daysLeft: number };

export function sweepAction(
  s: SubState & { cancelAtPeriodEnd: boolean; hasPendingPlan: boolean },
  now: Date,
  graceDays: number,
  remindAtDays: readonly number[] = [3, 1],
): SweepAction {
  if (s.status === 'TRIALING' && s.trialEndsAt) {
    if (s.trialEndsAt <= now) return { action: 'EXPIRE_TRIAL' };
    const daysLeft = Math.ceil((s.trialEndsAt.getTime() - now.getTime()) / DAY);
    return remindAtDays.includes(daysLeft) ? { action: 'REMIND', daysLeft } : { action: 'NONE' };
  }
  if (s.status === 'ACTIVE' && s.currentPeriodEnd) {
    if (s.currentPeriodEnd <= now) {
      return { action: 'LAPSE', to: s.cancelAtPeriodEnd ? 'CANCELLED' : 'PAST_DUE', applyPendingPlan: s.hasPendingPlan };
    }
    if (s.cancelAtPeriodEnd) return { action: 'NONE' };
    const daysLeft = Math.ceil((s.currentPeriodEnd.getTime() - now.getTime()) / DAY);
    return remindAtDays.includes(daysLeft) ? { action: 'REMIND', daysLeft } : { action: 'NONE' };
  }
  if (s.status === 'PAST_DUE' && s.currentPeriodEnd && s.currentPeriodEnd.getTime() + graceDays * DAY <= now.getTime()) {
    return { action: 'EXPIRE_PAST_DUE' };
  }
  return { action: 'NONE' };
}
