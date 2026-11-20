import { randomUUID } from 'node:crypto';
import { Prisma, type PrismaClient, type User } from '@mandimitra/database';
import { AUTH, TRIAL_PLAN_CODE, type LoginInput, type RegisterInput } from '@mandimitra/shared';
import type { Env } from '../config/env.ts';
import type { TenantCache } from '../middleware/tenant.ts';
import { effectiveSubscriptionStatus } from '../middleware/tenant.ts';
import { randomToken, sha256 } from '../utils/crypto.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import type { TokenSigner } from '../utils/jwt.ts';
import { hashPassword, verifyAgainstDummy, verifyPassword } from '../utils/password.ts';
import { writeActivity, writeAudit } from './audit.service.ts';
import { bootstrapBusiness } from './business.service.ts';

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

export function publicUser(u: Pick<User, 'id' | 'fullName' | 'mobile' | 'email' | 'preferredLanguage' | 'isPlatformAdmin'>) {
  return {
    id: u.id,
    fullName: u.fullName,
    mobile: u.mobile,
    email: u.email,
    preferredLanguage: u.preferredLanguage,
    isPlatformAdmin: u.isPlatformAdmin,
  };
}

export class AuthService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly signer: TokenSigner,
    private readonly cache: TenantCache,
  ) {}

  // ---------------------------------------------------------------- sessions

  /** Creates a refresh token (new family unless given) and a matching access token. */
  async issueSession(
    db: PrismaClient | Prisma.TransactionClient,
    user: Pick<User, 'id' | 'isPlatformAdmin'>,
    businessId: string | null,
    ctx: RequestContext,
    familyId: string = randomUUID(),
  ): Promise<SessionTokens & { refreshTokenId: string; familyId: string }> {
    const refreshToken = randomToken();
    const refreshExpiresAt = new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000);
    const row = await db.refreshToken.create({
      data: {
        userId: user.id,
        businessId,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: refreshExpiresAt,
        userAgent: ctx.userAgent,
        ipAddress: ctx.ip,
      },
    });
    const accessToken = await this.signer.sign({
      userId: user.id,
      businessId,
      isPlatformAdmin: user.isPlatformAdmin,
      sessionId: familyId,
    });
    return { accessToken, refreshToken, refreshExpiresAt, refreshTokenId: row.id, familyId };
  }

  private revokeFamily(familyId: string) {
    return this.prisma.refreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private async activeMemberships(userId: string) {
    return this.prisma.businessMembership.findMany({
      where: { userId, status: 'ACTIVE', business: { status: 'ACTIVE' } },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        businessId: true,
        role: { select: { key: true, name: true, nameHindi: true } },
        business: { select: { name: true, nameHindi: true, mandiName: true } },
      },
    });
  }

  // ---------------------------------------------------------------- register

  async register(input: RegisterInput, ctx: RequestContext) {
    const [ownerRole, trialPlan] = await Promise.all([
      this.prisma.role.findFirst({ where: { businessId: null, key: 'OWNER' } }),
      this.prisma.subscriptionPlan.findUnique({ where: { code: TRIAL_PLAN_CODE } }),
    ]);
    if (!ownerRole || !trialPlan) throw Errors.internal('SETUP_INCOMPLETE');

    const existing = await this.prisma.user.findUnique({ where: { mobile: input.mobile }, select: { id: true } });
    if (existing) throw Errors.conflict('MOBILE_ALREADY_REGISTERED');

    const passwordHash = await hashPassword(input.password);
    const now = new Date();

    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            fullName: input.fullName,
            mobile: input.mobile,
            email: input.email ?? null,
            passwordHash,
            preferredLanguage: input.preferredLanguage,
            lastLoginAt: now,
          },
        });
        const business = await tx.business.create({
          data: {
            name: input.business.name,
            nameHindi: input.business.nameHindi ?? null,
            mandiName: input.business.mandiName ?? null,
            district: input.business.district ?? null,
            state: input.business.state ?? null,
            ownerUserId: user.id,
            status: 'ACTIVE',
          },
        });
        await bootstrapBusiness(tx, {
          businessId: business.id,
          ownerUserId: user.id,
          ownerRoleId: ownerRole.id,
          trialPlan,
          now,
        });
        await writeAudit(
          tx,
          { businessId: business.id, actorUserId: user.id, action: 'CREATE', entityType: 'Business', entityId: business.id, after: business },
          ctx,
        );
        const tokens = await this.issueSession(tx, user, business.id, ctx);
        await writeActivity(tx, { businessId: business.id, userId: user.id, activityType: 'LOGIN_SUCCESS', metadata: { via: 'register' } }, ctx);
        return { user: publicUser(user), businessId: business.id, tokens };
      });
    } catch (err) {
      // Two simultaneous sign-ups with the same mobile: the unique index decides.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw Errors.conflict('MOBILE_ALREADY_REGISTERED');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------- login

  async login(input: LoginInput, ctx: RequestContext) {
    const user = await this.prisma.user.findUnique({ where: { mobile: input.mobile } });

    if (!user) {
      await verifyAgainstDummy(input.password);
      await writeActivity(this.prisma, { businessId: null, userId: null, activityType: 'LOGIN_FAILED', metadata: { reason: 'UNKNOWN_USER' } }, ctx);
      throw Errors.unauthenticated('INVALID_CREDENTIALS');
    }

    const now = new Date();
    if (user.lockedUntil && user.lockedUntil > now) {
      await writeActivity(this.prisma, { businessId: null, userId: user.id, activityType: 'LOGIN_FAILED', metadata: { reason: 'LOCKED' } }, ctx);
      throw Errors.tooMany('ACCOUNT_LOCKED', { retryAfterSeconds: Math.ceil((user.lockedUntil.getTime() - now.getTime()) / 1000) });
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      const updated = await this.prisma.user.update({
        where: { id: user.id },
        data: { failedLoginCount: { increment: 1 } },
        select: { failedLoginCount: true },
      });
      if (updated.failedLoginCount >= AUTH.MAX_FAILED_LOGINS) {
        await this.prisma.user.update({
          where: { id: user.id },
          data: { failedLoginCount: 0, lockedUntil: new Date(now.getTime() + AUTH.LOCKOUT_MINUTES * 60_000) },
        });
      }
      await writeActivity(this.prisma, { businessId: null, userId: user.id, activityType: 'LOGIN_FAILED', metadata: { reason: 'BAD_PASSWORD' } }, ctx);
      throw Errors.unauthenticated('INVALID_CREDENTIALS');
    }

    if (user.status !== 'ACTIVE') throw Errors.forbidden('ACCOUNT_DISABLED');

    const memberships = await this.activeMemberships(user.id);
    const businessId =
      (input.businessId && memberships.find((m) => m.businessId === input.businessId)?.businessId) ||
      memberships[0]?.businessId ||
      null;

    await this.prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: now } });
    const tokens = await this.issueSession(this.prisma, user, businessId, ctx);
    await writeActivity(this.prisma, { businessId, userId: user.id, activityType: 'LOGIN_SUCCESS' }, ctx);

    return { user: publicUser(user), businessId, memberships, tokens };
  }

  // ---------------------------------------------------------------- refresh (rotation + reuse detection)

  async refresh(rawToken: string | undefined, ctx: RequestContext): Promise<SessionTokens & { businessId: string | null }> {
    if (!rawToken) throw Errors.unauthenticated('INVALID_REFRESH');
    const current = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(rawToken) },
      include: { user: { select: { id: true, status: true, isPlatformAdmin: true } } },
    });
    if (!current) throw Errors.unauthenticated('INVALID_REFRESH');

    const now = Date.now();
    if (current.revokedAt) {
      // Explicitly revoked (logout, deactivation, password change): no replacement exists. Plain rejection.
      if (!current.replacedById) throw Errors.unauthenticated('INVALID_REFRESH');

      // A *rotated* token presented again. Within a short grace window this is a benign race
      // (two tabs refreshing at once); after it, assume theft and kill the whole family.
      const benign = now - current.revokedAt.getTime() < AUTH.REFRESH_REUSE_GRACE_MS;
      if (!benign) {
        await this.revokeFamily(current.familyId);
        await writeActivity(this.prisma, { businessId: current.businessId, userId: current.userId, activityType: 'TOKEN_REUSE_DETECTED', metadata: { familyId: current.familyId } }, ctx);
        throw Errors.unauthenticated('REFRESH_REUSED');
      }
      // Grace path must not resurrect a family that was logged out after the rotation.
      const killed = await this.prisma.refreshToken.count({
        where: { familyId: current.familyId, revokedAt: { not: null }, replacedById: null },
      });
      if (killed > 0) throw Errors.unauthenticated('INVALID_REFRESH');
    }
    if (current.expiresAt.getTime() < now) throw Errors.unauthenticated('INVALID_REFRESH');
    if (current.user.status !== 'ACTIVE') {
      await this.revokeFamily(current.familyId);
      throw Errors.unauthenticated('ACCOUNT_DISABLED');
    }

    // Drop the business binding if membership was revoked meanwhile.
    let businessId = current.businessId;
    if (businessId) {
      const m = await this.prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId, userId: current.userId } },
        select: { status: true, business: { select: { status: true } } },
      });
      if (!m || m.status !== 'ACTIVE' || m.business.status !== 'ACTIVE') businessId = null;
    }

    return this.prisma.$transaction(async (tx) => {
      const next = await this.issueSession(tx, current.user, businessId, ctx, current.familyId);
      if (!current.revokedAt) {
        // Conditional update: if a concurrent request rotated first, count is 0 and that's fine (grace).
        await tx.refreshToken.updateMany({
          where: { id: current.id, revokedAt: null },
          data: { revokedAt: new Date(), replacedById: next.refreshTokenId },
        });
      }
      return { ...next, businessId };
    });
  }

  async logout(rawToken: string | undefined, userId: string | undefined, sessionId: string | undefined, ctx: RequestContext) {
    let familyId = sessionId;
    if (!familyId && rawToken) {
      const row = await this.prisma.refreshToken.findUnique({ where: { tokenHash: sha256(rawToken) }, select: { familyId: true, userId: true } });
      familyId = row?.familyId;
      userId ??= row?.userId;
    }
    if (familyId) await this.revokeFamily(familyId);
    if (userId) await writeActivity(this.prisma, { businessId: null, userId, activityType: 'LOGOUT' }, ctx);
  }

  // ---------------------------------------------------------------- me / switch / password

  async me(userId: string, businessId: string | null) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== 'ACTIVE') throw Errors.unauthenticated();
    const memberships = await this.activeMemberships(userId);

    let active = null;
    if (businessId) {
      const m = await this.prisma.businessMembership.findUnique({
        where: { businessId_userId: { businessId, userId } },
        include: {
          role: { include: { permissions: { include: { permission: { select: { key: true } } } } } },
          business: { include: { subscription: { include: { plan: true } } } },
        },
      });
      if (m && m.status === 'ACTIVE' && m.business.status === 'ACTIVE') {
        const sub = m.business.subscription;
        active = {
          businessId,
          name: m.business.name,
          nameHindi: m.business.nameHindi,
          isOwner: m.business.ownerUserId === userId,
          role: { key: m.role.key, name: m.role.name, nameHindi: m.role.nameHindi },
          permissions: m.role.permissions.map((rp) => rp.permission.key).sort(),
          subscription: sub && {
            status: effectiveSubscriptionStatus({
              status: sub.status,
              planCode: sub.plan.code,
              trialEndsAt: sub.trialEndsAt,
              currentPeriodEnd: sub.currentPeriodEnd,
              maxStaffUsers: sub.plan.maxStaffUsers,
            }),
            planCode: sub.plan.code,
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            features: {
              aiEnabled: sub.plan.aiEnabled,
              whatsappEnabled: sub.plan.whatsappEnabled,
              exportsEnabled: sub.plan.exportsEnabled,
              maxStaffUsers: sub.plan.maxStaffUsers,
              maxFarmers: sub.plan.maxFarmers,
              maxMonthlyAiQueries: sub.plan.maxMonthlyAiQueries,
            },
          },
        };
      }
    }
    return { user: publicUser(user), memberships, activeBusiness: active };
  }

  async switchBusiness(userId: string, currentSessionId: string, businessId: string, ctx: RequestContext) {
    const m = await this.prisma.businessMembership.findUnique({
      where: { businessId_userId: { businessId, userId } },
      select: { status: true, business: { select: { status: true } }, user: true },
    });
    // 404, not 403: never confirm that some other business id exists.
    if (!m || m.status !== 'ACTIVE') throw Errors.notFound();
    if (m.business.status !== 'ACTIVE') throw Errors.forbidden('BUSINESS_SUSPENDED');

    await this.revokeFamily(currentSessionId);
    const tokens = await this.issueSession(this.prisma, m.user, businessId, ctx);
    await writeActivity(this.prisma, { businessId, userId, activityType: 'BUSINESS_SWITCHED' }, ctx);
    return { businessId, tokens };
  }

  async changePassword(
    userId: string,
    sessionId: string,
    input: { currentPassword: string; newPassword: string },
    ctx: RequestContext,
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw Errors.unauthenticated();
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw Errors.unauthenticated('INVALID_CREDENTIALS');
    if (input.currentPassword === input.newPassword) throw Errors.unprocessable('SAME_PASSWORD');

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // Sign out every other device; keep the current session.
      this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null, familyId: { not: sessionId } },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.cache.invalidate({ userId });
    await writeActivity(this.prisma, { businessId: null, userId, activityType: 'PASSWORD_CHANGED' }, ctx);
  }
}
