import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { H, addStaff, makeApp, registerOwner, uniqueMobile } from './helpers.ts';

const { app, prisma } = makeApp();

let owner: Awaited<ReturnType<typeof registerOwner>>;
let munim: Awaited<ReturnType<typeof addStaff>>;
let viewer: Awaited<ReturnType<typeof addStaff>>;

beforeAll(async () => {
  owner = await registerOwner(app);
  munim = await addStaff(app, owner.agent, 'MUNIM');
  viewer = await addStaff(app, owner.agent, 'VIEWER');
});

const farmer = (over: Record<string, unknown> = {}) => ({
  name: 'Ram Kumar',
  nameHindi: 'राम कुमार',
  fatherName: 'Shiv Lal',
  village: 'Kharkhoda',
  district: 'Sonipat',
  ...over,
});

describe('farmers', () => {
  it('creates with auto code, Hindi name and normalised mobile', async () => {
    const o = await registerOwner(app);
    const r1 = await o.agent.post('/api/v1/farmers').set(H).send(farmer({ mobile: '98123 45678' }));
    const r2 = await o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Mohan Singh' }));
    expect(r1.status).toBe(201);
    expect(r1.body.data).toMatchObject({ code: 'F-00001', nameHindi: 'राम कुमार', mobile: '+919812345678', currentBalance: '0' });
    expect(r2.body.data.code).toBe('F-00002');
  });

  it('numbers are unique and gap-free under concurrent creation', async () => {
    const o = await registerOwner(app);
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: `Kisan ${i}` }))),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const codes = results.map((r) => r.body.data.code).sort();
    expect(codes).toEqual(Array.from({ length: 12 }, (_, i) => `F-${String(i + 1).padStart(5, '0')}`));
  });

  it('posts opening balance to the ledger (credit when we owe, debit for advance)', async () => {
    const owed = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: '15000.50' }));
    expect(owed.status).toBe(201);
    expect(owed.body.data).toMatchObject({ openingBalance: '15000.5', currentBalance: '15000.5' });
    const e1 = await prisma.farmerLedgerEntry.findMany({ where: { farmerId: owed.body.data.id } });
    expect(e1).toHaveLength(1);
    expect(e1[0]!.entryType).toBe('OPENING_BALANCE');
    expect(e1[0]!.credit.toFixed(2)).toBe('15000.50');
    expect(e1[0]!.balanceAfter.toFixed(2)).toBe('15000.50');

    const advance = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Advance Wala', openingBalance: '-2000' }));
    const e2 = await prisma.farmerLedgerEntry.findFirstOrThrow({ where: { farmerId: advance.body.data.id } });
    expect(e2.debit.toFixed(2)).toBe('2000.00');
    expect(advance.body.data.currentBalance).toBe('-2000');

    const zero = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Zero' }));
    expect(await prisma.farmerLedgerEntry.count({ where: { farmerId: zero.body.data.id } })).toBe(0);
  });

  it('rejects float-ish or over-precise money', async () => {
    const r1 = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: '10.555' }));
    const r2 = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: 10.5 }));
    expect(r1.status).toBe(400);
    expect(r2.status).toBe(400);
  });

  it('warns (but allows) a shared family mobile', async () => {
    const m = uniqueMobile();
    await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Papa', mobile: m }));
    const r = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Beta', mobile: m }));
    expect(r.status).toBe(201);
    expect(r.body.meta.warnings[0]).toMatchObject({ code: 'DUPLICATE_MOBILE', name: 'Papa' });
  });

  it('searches by English name, Hindi name, mobile digits, village and code; paginates', async () => {
    const o = await registerOwner(app);
    await o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Suresh Yadav', nameHindi: 'सुरेश यादव', mobile: '9876500011', village: 'Gohana' }));
    await o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Ramesh Jat', nameHindi: 'रमेश जाट', village: 'Rai' }));
    const s = (q: string) => o.agent.get(`/api/v1/farmers?q=${encodeURIComponent(q)}`).then((r) => r.body.data.map((f: { name: string }) => f.name));
    expect(await s('suresh')).toEqual(['Suresh Yadav']);
    expect(await s('रमेश')).toEqual(['Ramesh Jat']);
    expect(await s('500011')).toEqual(['Suresh Yadav']);
    expect(await s('gohana')).toEqual(['Suresh Yadav']);
    expect(await s('F-00002')).toEqual(['Ramesh Jat']);

    const page = await o.agent.get('/api/v1/farmers?pageSize=1&page=2&sort=name');
    expect(page.body.meta).toEqual({ page: 2, pageSize: 1, total: 2 });
    expect(page.body.data[0].name).toBe('Suresh Yadav');

    const villages = await o.agent.get('/api/v1/farmers/villages');
    expect(villages.body.data).toEqual(['Gohana', 'Rai']);
  });

  it('updates with an audit trail; opening balance cannot be changed afterwards', async () => {
    const c = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Old Name' }));
    const id = c.body.data.id;
    const u = await munim.agent.patch(`/api/v1/farmers/${id}`).set(H).send({ name: 'New Name', whatsappConsent: 'OPTED_IN' });
    expect(u.status).toBe(200);
    expect(u.body.data.whatsappConsentAt).toBeTruthy();
    const log = await prisma.auditLog.findFirstOrThrow({ where: { entityId: id, action: 'UPDATE' } });
    expect(log.actorUserId).toBe(munim.userId);
    expect(log.before).toMatchObject({ name: 'Old Name' });
    expect((await owner.agent.patch(`/api/v1/farmers/${id}`).set(H).send({ openingBalance: '5' })).status).toBe(400);
  });

  it('refuses to archive a farmer with a balance; archives a settled one', async () => {
    const withBal = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: '100' }));
    const del = await owner.agent.delete(`/api/v1/farmers/${withBal.body.data.id}`).set(H);
    expect(del.status).toBe(422);
    expect(del.body.error.code).toBe('FARMER_HAS_BALANCE');

    const clean = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'To Archive' }));
    expect((await owner.agent.delete(`/api/v1/farmers/${clean.body.data.id}`).set(H)).status).toBe(204);
    expect((await owner.agent.get(`/api/v1/farmers/${clean.body.data.id}`)).status).toBe(404);
    const row = await prisma.farmer.findUniqueOrThrow({ where: { id: clean.body.data.id } });
    expect(row.deletedAt).not.toBeNull(); // soft delete: history preserved
  });

  it('enforces role permissions', async () => {
    expect((await viewer.agent.get('/api/v1/farmers')).status).toBe(200);
    expect((await viewer.agent.post('/api/v1/farmers').set(H).send(farmer())).status).toBe(403);
    const c = await munim.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'By Munim' }));
    expect(c.status).toBe(201);
    expect((await munim.agent.delete(`/api/v1/farmers/${c.body.data.id}`).set(H)).status).toBe(403);
  });

  it('enforces the plan farmer limit', async () => {
    const o = await registerOwner(app);
    const tiny = await prisma.subscriptionPlan.upsert({
      where: { code: 'TEST_TINY' },
      create: { code: 'TEST_TINY', name: 'Tiny', priceMonthly: '1', maxFarmers: 1, isActive: false },
      update: {},
    });
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { planId: tiny.id } });
    expect((await o.agent.post('/api/v1/farmers').set(H).send(farmer())).status).toBe(201);
    const r = await o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Second' }));
    expect(r.status).toBe(402);
    expect(r.body.error.details).toMatchObject({ resource: 'farmers', limit: 1 });
  });

  it('summary reports balance and activity', async () => {
    const c = await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: '700' }));
    const s = await owner.agent.get(`/api/v1/farmers/${c.body.data.id}/summary`);
    expect(s.status).toBe(200);
    expect(s.body.data).toMatchObject({ currentBalance: '700', lotCount: 0, finalizedPattiCount: 0 });
  });
});

describe('farmer bank accounts', () => {
  let farmerId: string;
  beforeAll(async () => {
    farmerId = (await owner.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Bank Wala' }))).body.data.id;
  });

  it('encrypts at rest, masks in lists, reveals with an access log', async () => {
    const add = await owner.agent
      .post(`/api/v1/farmers/${farmerId}/bank-accounts`)
      .set(H)
      .send({ accountHolderName: 'Bank Wala', accountNumber: '123456789012', ifsc: 'sbin0001234', bankName: 'SBI' });
    expect(add.status).toBe(201);
    expect(add.body.data).toMatchObject({ accountNumberMasked: 'XXXXXX9012', ifsc: 'SBIN0001234', isPrimary: true });
    expect(JSON.stringify(add.body)).not.toContain('123456789012');

    const row = await prisma.farmerBankAccount.findUniqueOrThrow({ where: { id: add.body.data.id } });
    expect(row.accountNumberEnc).toMatch(/^v1:/);
    expect(row.accountNumberEnc).not.toContain('123456789012');

    const reveal = await owner.agent.post(`/api/v1/farmers/${farmerId}/bank-accounts/${add.body.data.id}/reveal`).set(H);
    expect(reveal.body.data.accountNumber).toBe('123456789012');
    expect(reveal.headers['cache-control']).toBe('no-store');
    expect(await prisma.staffActivity.count({ where: { userId: owner.userId, activityType: 'BANK_DETAILS_VIEWED' } })).toBe(1);
  });

  it('switching primary account clears the old primary', async () => {
    const second = await owner.agent
      .post(`/api/v1/farmers/${farmerId}/bank-accounts`)
      .set(H)
      .send({ accountHolderName: 'Bank Wala', accountNumber: '998877665544', ifsc: 'HDFC0000001', isPrimary: true });
    expect(second.status).toBe(201);
    const list = await owner.agent.get(`/api/v1/farmers/${farmerId}/bank-accounts`);
    expect(list.body.data.filter((a: { isPrimary: boolean }) => a.isPrimary)).toHaveLength(1);
    expect(list.body.data[0].id).toBe(second.body.data.id);
  });

  it('is hidden from munim and viewer', async () => {
    expect((await munim.agent.get(`/api/v1/farmers/${farmerId}/bank-accounts`)).status).toBe(403);
    expect((await viewer.agent.get(`/api/v1/farmers/${farmerId}/bank-accounts`)).status).toBe(403);
    const asMunim = await munim.agent.get(`/api/v1/farmers/${farmerId}`);
    expect(asMunim.body.data.bankAccounts).toBeUndefined();
  });

  it('validates IFSC and account number', async () => {
    const r = await owner.agent
      .post(`/api/v1/farmers/${farmerId}/bank-accounts`)
      .set(H)
      .send({ accountHolderName: 'X', accountNumber: '12ab', ifsc: 'BAD' });
    expect(r.status).toBe(400);
  });
});

describe('buyers', () => {
  it('creates with code, opening receivable, credit-limit flag and outstanding filter', async () => {
    const o = await registerOwner(app);
    const b = await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Agarwal Traders', gstin: '06ABCDE1234F1Z5', openingBalance: '50000', creditLimit: '40000' });
    expect(b.status).toBe(201);
    expect(b.body.data).toMatchObject({ code: 'B-00001', currentBalance: '50000' });
    const entry = await prisma.buyerLedgerEntry.findFirstOrThrow({ where: { buyerId: b.body.data.id } });
    expect(entry.debit.toFixed(2)).toBe('50000.00');

    await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Clean Co' });
    const out = await o.agent.get('/api/v1/buyers?hasOutstanding=true');
    expect(out.body.data.map((x: { firmName: string }) => x.firmName)).toEqual(['Agarwal Traders']);
    expect(out.body.data[0].overCreditLimit).toBe(true);
  });

  it('validates GSTIN and warns on duplicate GSTIN', async () => {
    expect((await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'X', gstin: 'NOTAGSTIN' })).status).toBe(400);
    await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'G1', gstin: '07AAACG1234A1Z1' });
    const dup = await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'G2', gstin: '07aaacg1234a1z1' });
    expect(dup.status).toBe(201);
    expect(dup.body.meta.warnings[0].code).toBe('DUPLICATE_GSTIN');
  });

  it('refuses to archive with outstanding balance', async () => {
    const b = await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Owes Money', openingBalance: '10' });
    const r = await owner.agent.delete(`/api/v1/buyers/${b.body.data.id}`).set(H);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('BUYER_HAS_BALANCE');
  });
});

describe('commodities', () => {
  it('lists the 7 seeded commodities with Hindi names', async () => {
    const r = await owner.agent.get('/api/v1/commodities');
    expect(r.body.data.map((c: { nameHindi: string }) => c.nameHindi)).toEqual(['गेहूं', 'धान', 'चावल', 'सरसों', 'मक्का', 'आलू', 'प्याज']);
  });

  it('owner adds a commodity and grades; duplicates rejected; BAG requires bag weight', async () => {
    const c = await owner.agent.post('/api/v1/commodities').set(H).send({ name: 'Bajra', nameHindi: 'बाजरा' });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ defaultUnit: 'QUINTAL', rateUnit: 'QUINTAL' });
    expect((await owner.agent.post('/api/v1/commodities').set(H).send({ name: 'Bajra' })).status).toBe(409);
    expect((await owner.agent.post('/api/v1/commodities').set(H).send({ name: 'Garlic', defaultUnit: 'BAG' })).status).toBe(400);
    const bad = await owner.agent.patch(`/api/v1/commodities/${c.body.data.id}`).set(H).send({ rateUnit: 'BAG' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('BAG_WEIGHT_REQUIRED');
    expect((await owner.agent.patch(`/api/v1/commodities/${c.body.data.id}`).set(H).send({ rateUnit: 'BAG', bagWeightKg: '50' })).status).toBe(200);

    const g = await owner.agent.post(`/api/v1/commodities/${c.body.data.id}/grades`).set(H).send({ name: 'FAQ' });
    expect(g.status).toBe(201);
    const off = await owner.agent.patch(`/api/v1/commodities/${c.body.data.id}/grades/${g.body.data.id}`).set(H).send({ isActive: false });
    expect(off.body.data.isActive).toBe(false);
    const active = await owner.agent.get(`/api/v1/commodities`);
    expect(active.body.data.find((x: { id: string }) => x.id === c.body.data.id).grades).toHaveLength(0);
  });

  it('munim cannot manage commodities', async () => {
    expect((await munim.agent.post('/api/v1/commodities').set(H).send({ name: 'Jowar' })).status).toBe(403);
  });
});

describe('cross-tenant access to masters', () => {
  it('returns 404 for another business’s farmer, buyer, commodity and bank account', async () => {
    const other = await registerOwner(app);
    const f = await other.agent.post('/api/v1/farmers').set(H).send(farmer());
    const b = await other.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Theirs' });
    const acc = await other.agent
      .post(`/api/v1/farmers/${f.body.data.id}/bank-accounts`)
      .set(H)
      .send({ accountHolderName: 'X', accountNumber: '111122223333', ifsc: 'SBIN0000001' });
    const com = (await other.agent.get('/api/v1/commodities')).body.data[0].id;

    expect((await owner.agent.get(`/api/v1/farmers/${f.body.data.id}`)).status).toBe(404);
    expect((await owner.agent.patch(`/api/v1/farmers/${f.body.data.id}`).set(H).send({ name: 'x' })).status).toBe(404);
    expect((await owner.agent.delete(`/api/v1/farmers/${f.body.data.id}`).set(H)).status).toBe(404);
    expect((await owner.agent.post(`/api/v1/farmers/${f.body.data.id}/bank-accounts/${acc.body.data.id}/reveal`).set(H)).status).toBe(404);
    expect((await owner.agent.get(`/api/v1/buyers/${b.body.data.id}`)).status).toBe(404);
    expect((await owner.agent.patch(`/api/v1/commodities/${com}`).set(H).send({ name: 'Hijack' })).status).toBe(404);
    expect((await owner.agent.post(`/api/v1/commodities/${com}/grades`).set(H).send({ name: 'X' })).status).toBe(404);
  });
});

describe('ledger consistency', () => {
  it('cached balances equal the sum of ledger entries for every farmer and buyer', async () => {
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT f."id" FROM "Farmer" f LEFT JOIN "FarmerLedgerEntry" e ON e."farmerId" = f."id"
        GROUP BY f."id", f."currentBalance"
        HAVING f."currentBalance" <> COALESCE(SUM(e."credit") - SUM(e."debit"), 0)
        UNION ALL
        SELECT b."id" FROM "Buyer" b LEFT JOIN "BuyerLedgerEntry" e ON e."buyerId" = b."id"
        GROUP BY b."id", b."currentBalance"
        HAVING b."currentBalance" <> COALESCE(SUM(e."debit") - SUM(e."credit"), 0)
      ) x`;
    expect(Number(drift[0]!.n)).toBe(0);
  });
});

describe('dashboard', () => {
  it('computes real figures for a fresh business (no fake numbers)', async () => {
    const o = await registerOwner(app);
    await o.agent.post('/api/v1/farmers').set(H).send(farmer({ openingBalance: '12000' }));
    await o.agent.post('/api/v1/farmers').set(H).send(farmer({ name: 'Adv', openingBalance: '-3000' }));
    await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Owes', openingBalance: '45000.75' });

    const r = await o.agent.get('/api/v1/reports/dashboard?range=month');
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d.counts).toEqual({ farmers: 2, buyers: 1 });
    expect(d.payables).toEqual({ farmers: 1, amount: '12000' });
    expect(d.advancesOutstanding).toEqual({ farmers: 1, amount: '3000' });
    expect(d.receivables).toEqual({ buyers: 1, amount: '45000.75' });
    expect(d.grossSales.amount).toBe('0');
    expect(d.commissionIncome).toBe('0');
    expect(d).not.toHaveProperty('profit');
    expect(d.monthly).toHaveLength(6);
    expect(d.alerts.topReceivables[0].firmName).toBe('Owes');
    expect(d.alerts.trialDaysLeft).toBeGreaterThanOrEqual(13);
  });

  it('validates custom ranges', async () => {
    expect((await owner.agent.get('/api/v1/reports/dashboard?range=custom')).status).toBe(400);
    expect((await owner.agent.get('/api/v1/reports/dashboard?range=custom&from=2026-11-10&to=2026-11-01')).status).toBe(400);
    expect((await owner.agent.get('/api/v1/reports/dashboard?range=custom&from=2024-01-01&to=2026-01-01')).status).toBe(400);
    expect((await owner.agent.get('/api/v1/reports/dashboard?range=custom&from=2026-11-01&to=2026-11-19')).status).toBe(200);
  });

  it('is readable by viewer, isolated per tenant', async () => {
    const v = await viewer.agent.get('/api/v1/reports/dashboard');
    expect(v.status).toBe(200);
    const fresh = await registerOwner(app);
    const d = (await fresh.agent.get('/api/v1/reports/dashboard')).body.data;
    expect(d.counts).toEqual({ farmers: 0, buyers: 0 });
    expect(d.receivables.amount).toBe('0');
  });

  it('requires authentication', async () => {
    expect((await request(app).get('/api/v1/reports/dashboard')).status).toBe(401);
  });
});
