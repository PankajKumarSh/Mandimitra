import type { PrismaClient } from '@mandimitra/database';
import { AUTH } from '@mandimitra/shared';
import type { z } from 'zod';
import type { acceptInviteSchema, createInviteSchema, updateMembershipSchema } from '@mandimitra/shared';
import type { Env } from '../config/env.ts';
import type { TenantCache, TenantContext } from '../middleware/tenant.ts';
import { maskMobile, randomToken, sha256 } from '../utils/crypto.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { hashPassword, verifyPassword } from '../utils/password.ts';
import { writeActivity, writeAudit } from './audit.service.ts';
import { publicUser, type AuthService } from './auth.service.ts';

type Tenant = TenantContext;

export class StaffService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly cache: TenantCache,
    private readonly auth: AuthService,
  ) {}

  private async assignableRole(businessId: string, roleKey: string) {
    if (roleKey === 'OWNER') throw Errors.unprocessable('ROLE_NOT_ASSIGNABLE');
    const role = await this.prisma.role.findFirst({
      where: { key: roleKey, OR: [{ businessId: null }, { businessId }] },
      orderBy: { businessId: 'asc' }, // business custom role overrides system role of same key
    });
    if (!role) throw Errors.unprocessable('ROLE_NOT_ASSIGNABLE');
    return role;
  }

  async list(t: Tenant) {
    const [business, members, invites] = await Promise.all([
      this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { ownerUserId: true } }),
      t.db.businessMembership.findMany({
        orderBy: { createdAt: 'asc' },
        include: {
          user: { select: { id: true, fullName: true, mobile: true, lastLoginAt: true, status: true } },
          role: { select: { key: true, name: true, nameHindi: true } },
        },
      }),
      t.db.staffInvite.findMany({
        where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
        include: { role: { select: { key: true, name: true } } },
      }),
    ]);
    return {
      members: members.map((m) => ({
        membershipId: m.id,
        status: m.status,
        joinedAt: m.joinedAt,
        isOwner: m.userId === business.ownerUserId,
        user: m.user,
        role: m.role,
      })),
      invites: invites.map((i) => ({
        id: i.id,
        mobile: i.mobile,
        fullName: i.fullName,
        role: i.role,
        expiresAt: i.expiresAt,
        createdAt: i.createdAt,
      })),
    };
  }

  async listRoles(businessId: string) {
    const roles = await this.prisma.role.findMany({
      where: { OR: [{ businessId: null }, { businessId }] },
      include: { permissions: { include: { permission: { select: { key: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      nameHindi: r.nameHindi,
      isSystem: r.isSystem,
      assignable: r.key !== 'OWNER',
      permissions: r.permissions.map((p) => p.permission.key).sort(),
    }));
  }

  /** Seats used = non-owner ACTIVE members + pending invites. */
  private async seatsUsed(t: Tenant, ownerUserId: string) {
    const [members, invites] = await Promise.all([
      t.db.businessMembership.count({ where: { status: 'ACTIVE', userId: { not: ownerUserId } } }),
      t.db.staffInvite.count({ where: { acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } } }),
    ]);
    return members + invites;
  }

  async createInvite(t: Tenant, actorUserId: string, input: z.infer<typeof createInviteSchema>, ctx: RequestContext) {
    const role = await this.assignableRole(t.businessId, input.roleKey);
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { ownerUserId: true, name: true } });

    const existingUser = await this.prisma.user.findUnique({ where: { mobile: input.mobile }, select: { id: true } });
    if (existingUser) {
      const m = await t.db.businessMembership.findFirst({ where: { userId: existingUser.id, status: 'ACTIVE' } });
      if (m) throw Errors.conflict('ALREADY_MEMBER');
    }

    const limit = t.subscription?.maxStaffUsers ?? null;
    if (limit !== null) {
      // Re-inviting the same mobile replaces its pending invite, so don't count that one.
      const pendingSame = await t.db.staffInvite.count({
        where: { mobile: input.mobile, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      });
      const used = (await this.seatsUsed(t, business.ownerUserId)) - pendingSame;
      if (used >= limit) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { limit, used, resource: 'staff' });
    }

    const token = randomToken();
    const invite = await this.prisma.$transaction(async (tx) => {
      await tx.staffInvite.updateMany({
        where: { businessId: t.businessId, mobile: input.mobile, acceptedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      const created = await tx.staffInvite.create({
        data: {
          businessId: t.businessId,
          mobile: input.mobile,
          fullName: input.fullName ?? null,
          roleId: role.id,
          tokenHash: sha256(token),
          invitedById: actorUserId,
          expiresAt: new Date(Date.now() + AUTH.INVITE_TTL_DAYS * 86_400_000),
        },
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'StaffInvite', entityId: created.id, after: { mobile: created.mobile, roleKey: role.key } }, ctx);
      return created;
    });

    // Delivery via WhatsApp/SMS arrives in Phase 6; until then the owner shares this link.
    return {
      id: invite.id,
      mobile: invite.mobile,
      roleKey: role.key,
      expiresAt: invite.expiresAt,
      inviteUrl: `${this.env.APP_URL}/invite/${token}`,
      token,
    };
  }

  async revokeInvite(t: Tenant, actorUserId: string, inviteId: string, ctx: RequestContext) {
    const res = await t.db.staffInvite.updateMany({
      where: { id: inviteId, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (res.count === 0) throw Errors.notFound();
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'StaffInvite', entityId: inviteId }, ctx);
  }

  private async findValidInvite(token: string) {
    const invite = await this.prisma.staffInvite.findUnique({
      where: { tokenHash: sha256(token) },
      include: { role: true, business: { select: { id: true, name: true, nameHindi: true, status: true } } },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || invite.expiresAt < new Date() || invite.business.status !== 'ACTIVE') {
      throw Errors.unprocessable('INVITE_INVALID');
    }
    return invite;
  }

  /** Public preview for the invite landing page. */
  async previewInvite(token: string) {
    const invite = await this.findValidInvite(token);
    const userExists = !!(await this.prisma.user.findUnique({ where: { mobile: invite.mobile }, select: { id: true } }));
    return {
      businessName: invite.business.name,
      businessNameHindi: invite.business.nameHindi,
      roleKey: invite.role.key,
      roleName: invite.role.name,
      roleNameHindi: invite.role.nameHindi,
      mobile: maskMobile(invite.mobile),
      fullName: invite.fullName,
      userExists,
    };
  }

  /**
   * Accept: new users set a password; existing users prove identity with their current password.
   * The invite token alone never grants access to an existing account.
   */
  async acceptInvite(token: string, input: z.infer<typeof acceptInviteSchema>, ctx: RequestContext) {
    const invite = await this.findValidInvite(token);
    const existing = await this.prisma.user.findUnique({ where: { mobile: invite.mobile } });
    if (existing && !(await verifyPassword(existing.passwordHash, input.password))) {
      throw Errors.unauthenticated('INVALID_CREDENTIALS');
    }
    const newHash = existing ? null : await hashPassword(input.password);

    const result = await this.prisma.$transaction(async (tx) => {
      // Single-use: claim the invite atomically.
      const claimed = await tx.staffInvite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (claimed.count === 0) throw Errors.unprocessable('INVITE_INVALID');

      const user =
        existing ??
        (await tx.user.create({
          data: { fullName: input.fullName ?? invite.fullName ?? 'Staff', mobile: invite.mobile, passwordHash: newHash! },
        }));

      const membership = await tx.businessMembership.upsert({
        where: { businessId_userId: { businessId: invite.businessId, userId: user.id } },
        create: { businessId: invite.businessId, userId: user.id, roleId: invite.roleId, status: 'ACTIVE', joinedAt: new Date() },
        update: { roleId: invite.roleId, status: 'ACTIVE', joinedAt: new Date(), deactivatedAt: null },
      });
      await writeAudit(tx, { businessId: invite.businessId, actorUserId: user.id, action: 'CREATE', entityType: 'BusinessMembership', entityId: membership.id, after: { roleKey: invite.role.key, via: 'invite' } }, ctx);
      const tokens = await this.auth.issueSession(tx, user, invite.businessId, ctx);
      await writeActivity(tx, { businessId: invite.businessId, userId: user.id, activityType: 'LOGIN_SUCCESS', metadata: { via: 'invite' } }, ctx);
      return { user: publicUser(user), businessId: invite.businessId, tokens };
    });
    this.cache.invalidate({ userId: result.user.id });
    return result;
  }

  async updateMembership(
    t: Tenant,
    actorUserId: string,
    membershipId: string,
    input: z.infer<typeof updateMembershipSchema>,
    ctx: RequestContext,
  ) {
    const membership = await t.db.businessMembership.findUnique({
      where: { id: membershipId },
      include: { role: { select: { key: true } }, business: { select: { ownerUserId: true } } },
    });
    if (!membership) throw Errors.notFound();
    if (membership.userId === membership.business.ownerUserId) throw Errors.unprocessable('CANNOT_MODIFY_OWNER');
    if (membership.userId === actorUserId) throw Errors.unprocessable('CANNOT_MODIFY_SELF');

    const data: { roleId?: string; status?: 'ACTIVE' | 'DEACTIVATED'; deactivatedAt?: Date | null } = {};
    let newRoleKey = membership.role.key;
    if (input.roleKey) {
      const role = await this.assignableRole(t.businessId, input.roleKey);
      data.roleId = role.id;
      newRoleKey = role.key;
    }
    if (input.status) {
      if (input.status === 'ACTIVE' && membership.status !== 'ACTIVE') {
        const limit = t.subscription?.maxStaffUsers ?? null;
        if (limit !== null && (await this.seatsUsed(t, membership.business.ownerUserId)) >= limit) {
          throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { limit, resource: 'staff' });
        }
      }
      data.status = input.status;
      data.deactivatedAt = input.status === 'DEACTIVATED' ? new Date() : null;
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const after = await tx.businessMembership.update({ where: { id: membershipId }, data });
      if (input.status === 'DEACTIVATED') {
        // Kill their sessions bound to this business immediately.
        await tx.refreshToken.updateMany({
          where: { userId: membership.userId, businessId: t.businessId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await writeAudit(
        tx,
        {
          businessId: t.businessId,
          actorUserId,
          action: 'UPDATE',
          entityType: 'BusinessMembership',
          entityId: membershipId,
          before: { roleKey: membership.role.key, status: membership.status },
          after: { roleKey: newRoleKey, status: after.status },
        },
        ctx,
      );
      return after;
    });
    this.cache.invalidate({ userId: membership.userId, businessId: t.businessId });
    return { membershipId: updated.id, status: updated.status, roleKey: newRoleKey };
  }

  async activity(t: Tenant, membershipId: string, take = 50) {
    const m = await t.db.businessMembership.findUnique({ where: { id: membershipId }, select: { userId: true } });
    if (!m) throw Errors.notFound();
    return t.db.staffActivity.findMany({
      where: { userId: m.userId },
      orderBy: { createdAt: 'desc' },
      take,
      select: { id: true, activityType: true, ipAddress: true, userAgent: true, createdAt: true, metadata: true },
    });
  }

  async auditLog(t: Tenant, q: { entityType?: string; entityId?: string; actorUserId?: string; page: number; pageSize: number }) {
    const where = {
      ...(q.entityType ? { entityType: q.entityType } : {}),
      ...(q.entityId ? { entityId: q.entityId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId } : {}),
    };
    const [items, total] = await Promise.all([
      t.db.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { actor: { select: { id: true, fullName: true } } },
      }),
      t.db.auditLog.count({ where }),
    ]);
    return { items, total };
  }
}
