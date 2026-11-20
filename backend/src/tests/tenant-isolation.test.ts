import { SignJWT } from 'jose';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { forTenant, TenantViolationError } from '../repositories/tenant.ts';
import { H, makeApp, registerOwner } from './helpers.ts';

const { app, prisma } = makeApp();

let A: Awaited<ReturnType<typeof registerOwner>>;
let B: Awaited<ReturnType<typeof registerOwner>>;
let farmerA: { id: string };
let farmerB: { id: string };

beforeAll(async () => {
  A = await registerOwner(app, { businessName: 'Firm A' });
  B = await registerOwner(app, { businessName: 'Firm B' });
  farmerA = await forTenant(prisma, A.businessId).farmer.create({
    data: { code: 'F-00001', name: 'Ram Kumar', createdById: A.userId } as never,
  });
  farmerB = await forTenant(prisma, B.businessId).farmer.create({
    data: { code: 'F-00001', name: 'Shyam Singh', createdById: B.userId } as never,
  });
});

describe('tenant-scoped data layer (forTenant)', () => {
  it('injects businessId on create', async () => {
    const row = await prisma.farmer.findUniqueOrThrow({ where: { id: farmerA.id } });
    expect(row.businessId).toBe(A.businessId);
  });

  it('only ever reads its own rows', async () => {
    const dbA = forTenant(prisma, A.businessId);
    const list = await dbA.farmer.findMany();
    expect(list.map((f) => f.id)).toEqual([farmerA.id]);
    expect(await dbA.farmer.count()).toBe(1);
    expect(await dbA.farmer.findUnique({ where: { id: farmerB.id } })).toBeNull();
    expect(await dbA.farmer.findFirst({ where: { name: 'Shyam Singh' } })).toBeNull();
  });

  it('cannot update or delete another tenant’s rows', async () => {
    const dbA = forTenant(prisma, A.businessId);
    await expect(dbA.farmer.update({ where: { id: farmerB.id }, data: { name: 'Hacked' } })).rejects.toMatchObject({ code: 'P2025' });
    expect((await dbA.farmer.updateMany({ where: { id: farmerB.id }, data: { name: 'Hacked' } })).count).toBe(0);
    expect((await dbA.farmer.deleteMany({ where: { id: farmerB.id } })).count).toBe(0);
    const b = await prisma.farmer.findUniqueOrThrow({ where: { id: farmerB.id } });
    expect(b.name).toBe('Shyam Singh');
  });

  it('throws on any attempt to address another businessId', async () => {
    const dbA = forTenant(prisma, A.businessId);
    await expect(
      dbA.farmer.create({ data: { businessId: B.businessId, code: 'F-9', name: 'X', createdById: A.userId } as never }),
    ).rejects.toBeInstanceOf(TenantViolationError);
    await expect(dbA.farmer.findMany({ where: { businessId: B.businessId } })).rejects.toBeInstanceOf(TenantViolationError);
    await expect(
      dbA.farmer.updateMany({ where: {}, data: { businessId: B.businessId } as never }),
    ).rejects.toBeInstanceOf(TenantViolationError);
  });

  it('refuses platform (non-tenant) models', async () => {
    const dbA = forTenant(prisma, A.businessId) as unknown as { user: { findMany: () => Promise<unknown> } };
    await expect(dbA.user.findMany()).rejects.toThrow(/not tenant-scoped/);
  });

  it('works inside interactive transactions', async () => {
    const dbA = forTenant(prisma, A.businessId);
    const ids = await dbA.$transaction(async (tx) => (await tx.farmer.findMany()).map((f) => f.id));
    expect(ids).toEqual([farmerA.id]);
  });
});

describe('database-level isolation (composite foreign keys)', () => {
  it('rejects a lot in business A that points at business B’s farmer', async () => {
    const commodityA = await prisma.commodity.findFirstOrThrow({ where: { businessId: A.businessId } });
    await expect(
      prisma.lot.create({
        data: {
          businessId: A.businessId,
          lotNumber: 'L-X-1',
          farmerId: farmerB.id, // other tenant
          commodityId: commodityA.id,
          arrivalDate: new Date('2026-11-19'),
          grossWeightKg: '1000',
          tareWeightKg: '10',
          netWeightKg: '990',
          createdById: A.userId,
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });
});

describe('API-level isolation', () => {
  it('cannot switch into a business without membership (404, existence not leaked)', async () => {
    const res = await A.agent.post('/api/v1/auth/switch-business').set(H).send({ businessId: B.businessId });
    expect(res.status).toBe(404);
  });

  it('a validly signed token for a foreign business is rejected', async () => {
    const token = await new SignJWT({ bid: B.businessId, pa: false, sid: crypto.randomUUID() })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(A.userId)
      .setIssuer('mandimitra-api')
      .setAudience('mandimitra-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!));
    const res = await request(app).get('/api/v1/businesses/current').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('MEMBERSHIP_INACTIVE');
  });

  it('staff lists and audit logs contain only own-tenant data', async () => {
    const staff = await A.agent.get('/api/v1/staff');
    expect(staff.body.data.members).toHaveLength(1);
    expect(staff.body.data.members[0].user.id).toBe(A.userId);

    const audit = await A.agent.get('/api/v1/staff/audit-log');
    expect(audit.status).toBe(200);
    expect(audit.body.data.every((e: { businessId: string }) => e.businessId === A.businessId)).toBe(true);
  });

  it('cannot touch another tenant’s membership by id', async () => {
    const bMembership = await prisma.businessMembership.findFirstOrThrow({ where: { businessId: B.businessId } });
    const patch = await A.agent.patch(`/api/v1/staff/${bMembership.id}`).set(H).send({ status: 'DEACTIVATED' });
    expect(patch.status).toBe(404);
    const activity = await A.agent.get(`/api/v1/staff/${bMembership.id}/activity`);
    expect(activity.status).toBe(404);
  });

  it('returns each owner their own business only', async () => {
    const a = await A.agent.get('/api/v1/businesses/current');
    const b = await B.agent.get('/api/v1/businesses/current');
    expect(a.body.data.name).toBe('Firm A');
    expect(b.body.data.name).toBe('Firm B');
  });
});
