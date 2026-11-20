import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { SYSTEM_ROLES } from '@mandimitra/shared';
import { H, PASSWORD, addStaff, makeApp, registerOwner, uniqueMobile } from './helpers.ts';

const { app, prisma } = makeApp();

let owner: Awaited<ReturnType<typeof registerOwner>>;
let munim: Awaited<ReturnType<typeof addStaff>>;
let viewer: Awaited<ReturnType<typeof addStaff>>;

beforeAll(async () => {
  owner = await registerOwner(app);
  munim = await addStaff(app, owner.agent, 'MUNIM');
  viewer = await addStaff(app, owner.agent, 'VIEWER');
});

describe('role matrix', () => {
  it('exposes system roles with seeded permissions', async () => {
    const res = await owner.agent.get('/api/v1/staff/roles');
    expect(res.status).toBe(200);
    const byKey = Object.fromEntries(res.body.data.map((r: { key: string; permissions: string[] }) => [r.key, r.permissions]));
    expect(byKey.MUNIM).toEqual([...SYSTEM_ROLES.MUNIM.permissions].sort());
    expect(byKey.VIEWER).toEqual([...SYSTEM_ROLES.VIEWER.permissions].sort());
  });

  it('staff /me shows their own role and permissions', async () => {
    const me = await munim.agent.get('/api/v1/auth/me');
    expect(me.body.data.activeBusiness.role.key).toBe('MUNIM');
    expect(me.body.data.activeBusiness.isOwner).toBe(false);
    expect(me.body.data.activeBusiness.permissions).not.toContain('settings:manage');
  });
});

describe('backend enforcement', () => {
  const settingsPatch = { netRounding: 'NONE' };

  it('viewer can read but not modify', async () => {
    expect((await viewer.agent.get('/api/v1/businesses/current')).status).toBe(200);
    expect((await viewer.agent.get('/api/v1/businesses/current/settings')).status).toBe(200);
    const res = await viewer.agent.patch('/api/v1/businesses/current/settings').set(H).send(settingsPatch);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(res.body.error.details.missing).toEqual(['settings:manage']);
    expect((await viewer.agent.get('/api/v1/staff')).status).toBe(403);
  });

  it('munim cannot change settings, manage staff, or read the audit log', async () => {
    expect((await munim.agent.patch('/api/v1/businesses/current/settings').set(H).send(settingsPatch)).status).toBe(403);
    expect((await munim.agent.patch('/api/v1/businesses/current').set(H).send({ name: 'Renamed' })).status).toBe(403);
    expect((await munim.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'VIEWER' })).status).toBe(403);
    expect((await munim.agent.get('/api/v1/staff/audit-log')).status).toBe(403);
  });

  it('owner can change settings, and the change is audited with before/after', async () => {
    const res = await owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ netRounding: 'NONE', pattiFooterNote: 'धन्यवाद' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ netRounding: 'NONE', pattiFooterNote: 'धन्यवाद' });
    const log = await prisma.auditLog.findFirstOrThrow({
      where: { businessId: owner.businessId, entityType: 'BusinessSettings' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log.actorUserId).toBe(owner.userId);
    expect((log.before as { netRounding: string }).netRounding).toBe('NEAREST_RUPEE');
    expect((log.after as { netRounding: string }).netRounding).toBe('NONE');
  });

  it('rejects unknown fields on settings (strict schemas)', async () => {
    const res = await owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ businessId: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('staff lifecycle', () => {
  it('OWNER role can never be assigned', async () => {
    const res = await owner.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'OWNER' });
    expect(res.status).toBe(400);
  });

  it('owner cannot modify their own membership', async () => {
    const list = await owner.agent.get('/api/v1/staff');
    const ownerRow = list.body.data.members.find((m: { isOwner: boolean }) => m.isOwner);
    const res = await owner.agent.patch(`/api/v1/staff/${ownerRow.membershipId}`).set(H).send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CANNOT_MODIFY_OWNER');
  });

  it('role change takes effect on the very next request', async () => {
    const staff = await addStaff(app, owner.agent, 'VIEWER');
    expect((await staff.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'VIEWER' })).status).toBe(403);
    const up = await owner.agent.patch(`/api/v1/staff/${staff.membershipId}`).set(H).send({ roleKey: 'MUNIM' });
    expect(up.status).toBe(200);
    const me = await staff.agent.get('/api/v1/auth/me');
    expect(me.body.data.activeBusiness.role.key).toBe('MUNIM');
  });

  it('deactivation cuts access immediately, even with a warm permission cache', async () => {
    const { app: cachedApp } = makeApp({ TENANT_CACHE_TTL_MS: '60000' });
    const o = await registerOwner(cachedApp);
    const s = await addStaff(cachedApp, o.agent, 'MUNIM');
    expect((await s.agent.get('/api/v1/businesses/current')).status).toBe(200); // warms cache

    const res = await o.agent.patch(`/api/v1/staff/${s.membershipId}`).set(H).send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(200);

    const blocked = await s.agent.get('/api/v1/businesses/current');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('MEMBERSHIP_INACTIVE');
    expect((await s.agent.post('/api/v1/auth/refresh').set(H)).status).toBe(401); // sessions revoked

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { entityId: s.membershipId, action: 'UPDATE' } });
    expect(audit.after).toMatchObject({ status: 'DEACTIVATED' });
  });

  it('invite links are single-use', async () => {
    const inv = await owner.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'VIEWER' });
    const url = `/api/v1/auth/invites/${inv.body.data.token}/accept`;
    expect((await request(app).post(url).set(H).send({ password: PASSWORD })).status).toBe(200);
    const again = await request(app).post(url).set(H).send({ password: PASSWORD });
    expect(again.status).toBe(422);
    expect(again.body.error.code).toBe('INVITE_INVALID');
  });

  it('revoked invites cannot be used', async () => {
    const inv = await owner.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'VIEWER' });
    expect((await owner.agent.delete(`/api/v1/staff/invites/${inv.body.data.id}`).set(H)).status).toBe(204);
    const res = await request(app).post(`/api/v1/auth/invites/${inv.body.data.token}/accept`).set(H).send({ password: PASSWORD });
    expect(res.status).toBe(422);
  });

  it('an existing user must prove their password to join, then can switch businesses', async () => {
    const other = await registerOwner(app, { businessName: 'Other Firm' });
    const inv = await owner.agent.post('/api/v1/staff/invites').set(H).send({ mobile: other.mobile, roleKey: 'MUNIM' });
    expect(inv.status).toBe(201);

    const preview = await request(app).get(`/api/v1/auth/invites/${inv.body.data.token}`);
    expect(preview.body.data.userExists).toBe(true);
    expect(preview.body.data.mobile).not.toBe(other.mobile); // masked

    const bad = await request(app).post(`/api/v1/auth/invites/${inv.body.data.token}/accept`).set(H).send({ password: 'not-their-password' });
    expect(bad.status).toBe(401);

    const okRes = await other.agent.post(`/api/v1/auth/invites/${inv.body.data.token}/accept`).set(H).send({ password: PASSWORD });
    expect(okRes.status).toBe(200);
    expect(okRes.body.data.activeBusinessId).toBe(owner.businessId);

    const me = await other.agent.get('/api/v1/auth/me');
    expect(me.body.data.memberships).toHaveLength(2);
    expect(me.body.data.activeBusiness.role.key).toBe('MUNIM');

    const sw = await other.agent.post('/api/v1/auth/switch-business').set(H).send({ businessId: other.businessId });
    expect(sw.status).toBe(200);
    const me2 = await other.agent.get('/api/v1/auth/me');
    expect(me2.body.data.activeBusiness.role.key).toBe('OWNER');
  });

  it('login history is visible to the owner', async () => {
    const res = await owner.agent.get(`/api/v1/staff/${munim.membershipId}/activity`);
    expect(res.status).toBe(200);
    expect(res.body.data.some((a: { activityType: string }) => a.activityType === 'LOGIN_SUCCESS')).toBe(true);
  });
});

describe('plan limits', () => {
  it('enforces the staff seat limit of the current plan', async () => {
    const o = await registerOwner(app);
    const starter = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'STARTER' } }); // 1 seat
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { planId: starter.id } });

    const first = await o.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'MUNIM' });
    expect(first.status).toBe(201);
    const second = await o.agent.post('/api/v1/staff/invites').set(H).send({ mobile: uniqueMobile(), roleKey: 'VIEWER' });
    expect(second.status).toBe(402);
    expect(second.body.error.code).toBe('PLAN_LIMIT_REACHED');
    expect(second.body.error.details).toMatchObject({ limit: 1, resource: 'staff' });
  });
});
