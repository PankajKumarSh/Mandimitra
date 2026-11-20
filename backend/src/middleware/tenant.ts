import type { RequestHandler } from 'express';
import type { PrismaClient, SubscriptionStatus } from '@mandimitra/database';
import type { PermissionKey } from '@mandimitra/shared';
import { Errors } from '../utils/errors.ts';
import { forTenant, type TenantDb } from '../repositories/tenant.ts';

export interface TenantContext {
  businessId: string;
  membershipId: string;
  roleKey: string;
  isOwner: boolean;
  permissions: ReadonlySet<string>;
  subscription: {
    status: SubscriptionStatus;
    planCode: string;
    trialEndsAt: Date | null;
    currentPeriodEnd: Date | null;
    maxStaffUsers: number | null;
  } | null;
  db: TenantDb;
}

type CachedTenant = Omit<TenantContext, 'db'>;

/**
 * Short-lived cache of membership+permissions so every request doesn't re-join 4 tables.
 * Any change to membership / role / business status / subscription MUST call invalidate().
 * TTL bounds the worst case if a change happens on another API instance.
 */
export class TenantCache {
  private readonly map = new Map<string, { value: CachedTenant; expires: number }>();
  constructor(private readonly ttlMs: number) {}

  get(key: string): CachedTenant | undefined {
    const hit = this.map.get(key);
    if (!hit) return undefined;
    if (hit.expires < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    return hit.value;
  }

  set(key: string, value: CachedTenant): void {
    if (this.ttlMs <= 0) return;
    this.map.set(key, { value, expires: Date.now() + this.ttlMs });
  }

  /** Invalidate by business (all users) and/or a specific user. */
  invalidate(filter: { businessId?: string; userId?: string }): void {
    for (const key of this.map.keys()) {
      const [userId, businessId] = key.split(':');
      if ((filter.userId && filter.userId === userId) || (filter.businessId && filter.businessId === businessId)) {
        this.map.delete(key);
      }
    }
  }
}

/** Requires an active business on the token and an ACTIVE membership in an ACTIVE business. */
export function resolveTenant(prisma: PrismaClient, cache: TenantCache): RequestHandler {
  return async (req, _res, next) => {
    const auth = req.auth;
    if (!auth) return next(Errors.unauthenticated());
    if (!auth.businessId) return next(Errors.forbidden('NO_ACTIVE_BUSINESS'));

    const key = `${auth.userId}:${auth.businessId}`;
    let ctx = cache.get(key);

    if (!ctx) {
      const membership = await prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId: auth.businessId, userId: auth.userId } },
        include: {
          user: { select: { status: true } },
          business: {
            select: {
              status: true,
              ownerUserId: true,
              subscription: { include: { plan: { select: { code: true, maxStaffUsers: true } } } },
            },
          },
          role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
        },
      });

      if (!membership || membership.status !== 'ACTIVE') return next(Errors.forbidden('MEMBERSHIP_INACTIVE'));
      if (membership.user.status !== 'ACTIVE') return next(Errors.unauthenticated('ACCOUNT_DISABLED'));
      if (membership.business.status !== 'ACTIVE') return next(Errors.forbidden('BUSINESS_SUSPENDED'));

      const sub = membership.business.subscription;
      ctx = {
        businessId: auth.businessId,
        membershipId: membership.id,
        roleKey: membership.role.key,
        isOwner: membership.business.ownerUserId === auth.userId,
        permissions: new Set(membership.role.permissions.map((rp) => rp.permission.key)),
        subscription: sub
          ? {
              status: sub.status,
              planCode: sub.plan.code,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodEnd: sub.currentPeriodEnd,
              maxStaffUsers: sub.plan.maxStaffUsers,
            }
          : null,
      };
      cache.set(key, ctx);
    }

    req.tenant = { ...ctx, db: forTenant(prisma, ctx.businessId) };
    next();
  };
}

export function requirePermission(...keys: PermissionKey[]): RequestHandler {
  return (req, _res, next) => {
    const perms = req.tenant?.permissions;
    if (!perms) return next(Errors.unauthenticated());
    const missing = keys.filter((k) => !perms.has(k));
    if (missing.length) return next(Errors.forbidden('FORBIDDEN', { missing }));
    next();
  };
}

/** Effective status, accounting for a trial whose end date has passed before the nightly job flips it. */
export function effectiveSubscriptionStatus(sub: TenantContext['subscription'], now = new Date()): SubscriptionStatus {
  if (!sub) return 'EXPIRED';
  if (sub.status === 'TRIALING' && sub.trialEndsAt && sub.trialEndsAt < now) return 'EXPIRED';
  if (sub.status === 'ACTIVE' && sub.currentPeriodEnd && sub.currentPeriodEnd < now) return 'PAST_DUE';
  return sub.status;
}

/**
 * TRIALING / ACTIVE → full access. PAST_DUE / EXPIRED / CANCELLED → read-only (data is never held hostage).
 * SUSPENDED is blocked earlier via business status.
 */
export const requireWritableSubscription: RequestHandler = (req, _res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  const status = effectiveSubscriptionStatus(req.tenant?.subscription ?? null);
  if (status === 'TRIALING' || status === 'ACTIVE') return next();
  next(Errors.paymentRequired('SUBSCRIPTION_INACTIVE', { status }));
};
