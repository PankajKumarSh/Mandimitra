import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { istDateString } from '../services/ledger.service.ts';
import { H, addStaff, makeApp, registerOwner, type Agent } from './helpers.ts';

const { app, prisma, pdf } = makeApp();
const today = istDateString();
const fy = (() => {
  const [y, m] = today.split('-').map(Number);
  const start = m! >= 4 ? y! : y! - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
})();

/** POST with a fresh Idempotency-Key unless one is given. */
const post = (agent: Agent, url: string, body: unknown, key: string = randomUUID()) =>
  agent.post(url).set(H).set('Idempotency-Key', key).send(body as object);

async function setupBusiness() {
  const owner = await registerOwner(app);
  const wheat = (await owner.agent.get('/api/v1/commodities')).body.data.find((c: { name: string }) => c.name === 'Wheat');
  const farmer = (await owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Ram Kumar', nameHindi: 'राम कुमार', village: 'Gharaunda', mobile: '9812300001' })).body.data;
  const buyer = (await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Bansal Rice Mills' })).body.data;
  const buyer2 = (await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Goyal Trading' })).body.data;
  // Business-configured rates (none are seeded):
  const rule = (b: Record<string, unknown>) => owner.agent.post('/api/v1/commission-rules').set(H).send({ effectiveFrom: '2026-04-01', ...b });
  expect((await rule({ name: 'Commission', nameHindi: 'आढ़त', chargeType: 'COMMISSION', calcMethod: 'PERCENTAGE', value: '2.5' })).status).toBe(201);
  expect((await rule({ name: 'Labour', nameHindi: 'पल्लेदारी', chargeType: 'LABOUR', calcMethod: 'PER_BAG', value: '5' })).status).toBe(201);
  expect((await rule({ name: 'Market fee', chargeType: 'MARKET_FEE', calcMethod: 'PERCENTAGE', value: '1', appliesTo: 'BUYER' })).status).toBe(201);
  return { owner, wheat, farmer, buyer, buyer2 };
}

async function newLot(agent: Agent, farmerId: string, commodityId: string, over: Record<string, unknown> = {}) {
  const r = await post(agent, '/api/v1/lots', { farmerId, commodityId, arrivalDate: today, weightUnit: 'QUINTAL', grossWeight: '52.5', tareWeight: '0.5', bags: 104, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.data;
}

const sale = (lotId: string, buyerId: string, over: Record<string, unknown> = {}) => ({ lotId, buyerId, saleDate: today, weight: '40', weightUnit: 'QUINTAL', bags: 80, rate: '2450', ...over });

describe('lots', () => {
  let ctx: Awaited<ReturnType<typeof setupBusiness>>;
  beforeAll(async () => {
    ctx = await setupBusiness();
  });

  it('computes net weight in kg on the server and numbers per financial year', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    expect(lot).toMatchObject({ lotNumber: `L/${fy}/000001`, status: 'CONFIRMED', grossWeightKg: '5250', tareWeightKg: '50', netWeightKg: '5200' });
  });

  it('rejects tare ≥ gross, zero gross and negative weights', async () => {
    const bad = (b: Record<string, unknown>) => post(ctx.owner.agent, '/api/v1/lots', { farmerId: ctx.farmer.id, commodityId: ctx.wheat.id, arrivalDate: today, ...b });
    expect((await bad({ grossWeight: '100', tareWeight: '100' })).status).toBe(400);
    expect((await bad({ grossWeight: '0' })).status).toBe(400);
    expect((await bad({ grossWeight: '-5' })).status).toBe(400);
  });

  it('draft lots are editable with optimistic locking; confirmed ones are not', async () => {
    const draft = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id, { confirm: false });
    expect(draft.status).toBe('DRAFT');
    const u1 = await ctx.owner.agent.patch(`/api/v1/lots/${draft.id}`).set(H).send({ version: 0, weightUnit: 'KG', grossWeight: '6000', tareWeight: '60' });
    expect(u1.body.data).toMatchObject({ netWeightKg: '5940', version: 1 });
    const stale = await ctx.owner.agent.patch(`/api/v1/lots/${draft.id}`).set(H).send({ version: 0, bags: 10 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await post(ctx.owner.agent, `/api/v1/lots/${draft.id}/sale-not-a-route`, {})).status).toBe(404);
    // draft cannot be sold
    const s = await post(ctx.owner.agent, '/api/v1/sales', sale(draft.id, ctx.buyer.id));
    expect(s.body.error.code).toBe('LOT_NOT_SELLABLE');
    expect((await ctx.owner.agent.post(`/api/v1/lots/${draft.id}/confirm`).set(H)).body.data.status).toBe('CONFIRMED');
    const locked = await ctx.owner.agent.patch(`/api/v1/lots/${draft.id}`).set(H).send({ version: 2, bags: 1 });
    expect(locked.body.error.code).toBe('LOT_NOT_EDITABLE');
  });

  it('rejects a grade from another commodity', async () => {
    const potato = (await ctx.owner.agent.get('/api/v1/commodities')).body.data.find((c: { name: string }) => c.name === 'Potato');
    const g = await ctx.owner.agent.post(`/api/v1/commodities/${potato.id}/grades`).set(H).send({ name: 'Jyoti' });
    const r = await post(ctx.owner.agent, '/api/v1/lots', { farmerId: ctx.farmer.id, commodityId: ctx.wheat.id, gradeId: g.body.data.id, arrivalDate: today, grossWeight: '100' });
    expect(r.body.error.code).toBe('GRADE_MISMATCH');
  });
});

describe('sales (commission-agent mode) and partial lots', () => {
  let ctx: Awaited<ReturnType<typeof setupBusiness>>;
  let lot: { id: string; lotNumber: string };
  beforeAll(async () => {
    ctx = await setupBusiness();
    lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id); // 52 qtl net
  });

  it('records a sale: buyer charges, buyer ledger debit, paired farmer purchase, lot status', async () => {
    const r = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id));
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    // 40 qtl × 2450 = 98,000 ; market fee 1% = 980 ; total 98,980
    expect(r.body.data).toMatchObject({ saleNumber: `S/${fy}/000001`, weightKg: '4000', grossAmount: '98000', chargesTotal: '980', totalAmount: '98980' });
    expect(r.body.data.charges.map((c: { label: string; amount: string }) => [c.label, c.amount])).toEqual([['Market fee', '980']]);
    expect(r.body.data.purchase).toMatchObject({ status: 'ACTIVE', pattiId: null });

    const buyer = await prisma.buyer.findUniqueOrThrow({ where: { id: ctx.buyer.id } });
    expect(buyer.currentBalance.toFixed(2)).toBe('98980.00');
    const l = await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } });
    expect([l.status, l.soldWeightKg.toFixed(0), l.purchasedWeightKg.toFixed(0)]).toEqual(['PARTIALLY_SOLD', '4000', '4000']);
    const p = await prisma.purchase.findFirstOrThrow({ where: { saleId: r.body.data.id } });
    expect([p.farmerId, p.grossAmount.toFixed(2), p.rate.toFixed(2)]).toEqual([ctx.farmer.id, '98000.00', '2450.00']);
  });

  it('second buyer takes the rest; over-selling is refused', async () => {
    const over = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer2.id, { weight: '12.001' }));
    expect(over.status).toBe(422);
    expect(over.body.error).toMatchObject({ code: 'LOT_QTY_EXCEEDED', details: { availableKg: '1200.000' } });
    const rest = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer2.id, { weight: '12', rate: '2460', bags: 24 }));
    expect(rest.status).toBe(201);
    expect(rest.body.data.grossAmount).toBe('29520'); // 12 × 2460
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('SOLD');
    expect((await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer2.id, { weight: '1' }))).body.error.code).toBe('LOT_NOT_SELLABLE');
  });

  it('rejects zero quantity and non-positive rate', async () => {
    const l2 = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    expect((await post(ctx.owner.agent, '/api/v1/sales', sale(l2.id, ctx.buyer.id, { weight: '0' }))).status).toBe(400);
    expect((await post(ctx.owner.agent, '/api/v1/sales', sale(l2.id, ctx.buyer.id, { rate: '0' }))).status).toBe(400);
    expect((await post(ctx.owner.agent, '/api/v1/sales', sale(l2.id, ctx.buyer.id, { rate: '-10' }))).status).toBe(400);
  });

  it('serialises concurrent sales on one lot — never oversold', async () => {
    const l = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id, { grossWeight: '100', tareWeight: '0' }); // 100 qtl
    const results = await Promise.all(Array.from({ length: 5 }, () => post(ctx.owner.agent, '/api/v1/sales', sale(l.id, ctx.buyer.id, { weight: '40' }))));
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 422, 422, 422]);
    const after = await prisma.lot.findUniqueOrThrow({ where: { id: l.id } });
    expect(after.soldWeightKg.toFixed(0)).toBe('8000');
    expect(await prisma.sale.count({ where: { lotId: l.id, status: 'ACTIVE' } })).toBe(2);
  });

  it('owner cancels a sale: buyer reversed, stock restored, farmer purchase voided', async () => {
    const l = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const s = (await post(ctx.owner.agent, '/api/v1/sales', sale(l.id, ctx.buyer2.id, { weight: '10', rate: '2000', bags: 0 }))).body.data;
    const before = await prisma.buyer.findUniqueOrThrow({ where: { id: ctx.buyer2.id } });
    const c = await post(ctx.owner.agent, `/api/v1/sales/${s.id}/cancel`, { reason: 'Wrong buyer entered' });
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('CANCELLED');
    const after = await prisma.buyer.findUniqueOrThrow({ where: { id: ctx.buyer2.id } });
    // 10 qtl × 2000 = 20,000 + 1% fee 200 = 20,200 reversed
    expect(before.currentBalance.minus(after.currentBalance).toFixed(2)).toBe('20200.00');
    const rev = await prisma.buyerLedgerEntry.findFirstOrThrow({ where: { saleId: s.id, entryType: 'REVERSAL' } });
    expect(rev.credit.toFixed(2)).toBe('20200.00');
    const lotAfter = await prisma.lot.findUniqueOrThrow({ where: { id: l.id } });
    expect([lotAfter.status, lotAfter.soldWeightKg.toFixed(0)]).toEqual(['CONFIRMED', '0']);
    expect((await prisma.purchase.findFirstOrThrow({ where: { saleId: s.id } })).status).toBe('CANCELLED');
    const again = await post(ctx.owner.agent, `/api/v1/sales/${s.id}/cancel`, { reason: 'again' });
    expect(again.body.error.code).toBe('ALREADY_CANCELLED');
  });

  it('a lot with sales cannot be cancelled', async () => {
    const r = await post(ctx.owner.agent, `/api/v1/lots/${lot.id}/cancel`, { reason: 'test' });
    expect(r.body.error.code).toBe('LOT_HAS_TRANSACTIONS');
  });
});

describe('idempotency (duplicate submissions)', () => {
  let ctx: Awaited<ReturnType<typeof setupBusiness>>;
  beforeAll(async () => {
    ctx = await setupBusiness();
  });

  it('requires a key on financial POSTs', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const r = await ctx.owner.agent.post('/api/v1/sales').set(H).send(sale(lot.id, ctx.buyer.id));
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REQUIRED');
  });

  it('replays the original response for a repeated key — one sale, one ledger entry', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const key = randomUUID();
    const a = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '5' }), key);
    const b = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '5' }), key);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect(b.headers['idempotent-replayed']).toBe('true');
    expect(b.body.data.id).toBe(a.body.data.id);
    expect(await prisma.sale.count({ where: { lotId: lot.id } })).toBe(1);
    expect(await prisma.buyerLedgerEntry.count({ where: { saleId: a.body.data.id } })).toBe(1);
  });

  it('rejects the same key with a different body', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const key = randomUUID();
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '5' }), key);
    const r = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '6' }), key);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('a double-click (concurrent identical requests) creates exactly one sale', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const key = randomUUID();
    const rs = await Promise.all([1, 2, 3].map(() => post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '5' }), key)));
    expect(rs.filter((r) => r.status === 201).length).toBeGreaterThanOrEqual(1);
    expect(rs.every((r) => r.status === 201 || (r.status === 409 && r.body.error.code === 'REQUEST_IN_PROGRESS'))).toBe(true);
    expect(await prisma.sale.count({ where: { lotId: lot.id } })).toBe(1);
  });

  it('a failed request releases the key so the user can retry', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    const key = randomUUID();
    const fail = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '999' }), key);
    expect(fail.status).toBe(422);
    const retry = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '999' }), key);
    expect(retry.status).toBe(422); // re-executed (not replayed): still a business-rule error
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });
});

describe('approvals: munim cancellations need the owner', () => {
  let ctx: Awaited<ReturnType<typeof setupBusiness>>;
  let munim: Awaited<ReturnType<typeof addStaff>>;
  beforeAll(async () => {
    ctx = await setupBusiness();
    munim = await addStaff(app, ctx.owner.agent, 'MUNIM');
  });

  it('munim cancel → 202 pending; owner approves → cancelled atomically', async () => {
    const lot = await newLot(munim.agent, ctx.farmer.id, ctx.wheat.id);
    const s = (await post(munim.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '10' }))).body.data;
    const req = await post(munim.agent, `/api/v1/sales/${s.id}/cancel`, { reason: 'Rate entered wrong' });
    expect(req.status).toBe(202);
    expect(req.body.data.status).toBe('PENDING_APPROVAL');
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('ACTIVE');
    expect(await prisma.notification.count({ where: { userId: ctx.owner.userId, type: 'APPROVAL_PENDING' } })).toBe(1);

    const dup = await post(munim.agent, `/api/v1/sales/${s.id}/cancel`, { reason: 'again' });
    expect(dup.body.error.code).toBe('APPROVAL_ALREADY_PENDING');
    expect((await munim.agent.get('/api/v1/approvals')).status).toBe(403);
    expect((await munim.agent.post(`/api/v1/approvals/${req.body.data.approvalRequest.id}/approve`).set(H).send({})).status).toBe(403);

    const list = await ctx.owner.agent.get('/api/v1/approvals?status=PENDING');
    expect(list.body.data).toHaveLength(1);
    const ok = await ctx.owner.agent.post(`/api/v1/approvals/${req.body.data.approvalRequest.id}/approve`).set(H).send({ note: 'ठीक है' });
    expect(ok.status).toBe(200);
    expect((await prisma.sale.findUniqueOrThrow({ where: { id: s.id } })).status).toBe('CANCELLED');
    const twice = await ctx.owner.agent.post(`/api/v1/approvals/${req.body.data.approvalRequest.id}/approve`).set(H).send({});
    expect(twice.body.error.code).toBe('APPROVAL_NOT_PENDING');
  });

  it('rejected request leaves the record untouched', async () => {
    const lot = await newLot(munim.agent, ctx.farmer.id, ctx.wheat.id);
    const req = await post(munim.agent, `/api/v1/lots/${lot.id}/cancel`, { reason: 'Duplicate entry' });
    expect(req.status).toBe(202);
    const r = await ctx.owner.agent.post(`/api/v1/approvals/${req.body.data.approvalRequest.id}/reject`).set(H).send({ note: 'Not a duplicate' });
    expect(r.body.data.status).toBe('REJECTED');
    expect((await prisma.lot.findUniqueOrThrow({ where: { id: lot.id } })).status).toBe('CONFIRMED');
  });

  it('if the business turns approvals off, munim cancels directly', async () => {
    await ctx.owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ requireApprovalForCancel: false });
    const lot = await newLot(munim.agent, ctx.farmer.id, ctx.wheat.id);
    const r = await post(munim.agent, `/api/v1/lots/${lot.id}/cancel`, { reason: 'Entered twice' });
    expect(r.status).toBe(200);
    expect(r.body.data.record.status).toBe('CANCELLED');
    await ctx.owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ requireApprovalForCancel: true });
  });

  it('viewer cannot cancel at all', async () => {
    const viewer = await addStaff(app, ctx.owner.agent, 'VIEWER');
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    expect((await post(viewer.agent, `/api/v1/lots/${lot.id}/cancel`, { reason: 'nope' })).status).toBe(403);
    expect((await post(viewer.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id))).status).toBe(403);
  });
});

describe('patti', () => {
  let ctx: Awaited<ReturnType<typeof setupBusiness>>;
  beforeAll(async () => {
    ctx = await setupBusiness();
  });

  it('preview → finalize: deductions, ledger credit, billed purchases, number', async () => {
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id); // 52 qtl, 104 bags
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '50', rate: '2500', bags: 100 }));

    const body = { farmerId: ctx.farmer.id, pattiDate: today };
    const pv = await ctx.owner.agent.post('/api/v1/patti/preview').set(H).send(body);
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    // 50 × 2500 = 1,25,000 ; commission 2.5% = 3,125 ; labour 100 × 5 = 500 → net 1,21,375
    expect(pv.body.data).toMatchObject({ grossAmount: '125000', totalDeductions: '3625', netAmount: '121375', netPayable: '121375' });
    expect(await prisma.patti.count({ where: { farmerId: ctx.farmer.id } })).toBe(0); // preview writes nothing

    const p = await post(ctx.owner.agent, '/api/v1/patti', body);
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body.data).toMatchObject({ pattiNumber: `P/${fy}/000001`, status: 'FINALIZED', netPayable: '121375' });
    expect(p.body.data.deductions.map((d: { label: string; amount: string }) => [d.label, d.amount])).toEqual([
      ['Commission', '3125'],
      ['Labour', '500'],
    ]);
    const f = await prisma.farmer.findUniqueOrThrow({ where: { id: ctx.farmer.id } });
    expect(f.currentBalance.toFixed(2)).toBe('121375.00');
    expect(await prisma.purchase.count({ where: { farmerId: ctx.farmer.id, pattiId: null, status: 'ACTIVE' } })).toBe(0);

    const second = await post(ctx.owner.agent, '/api/v1/patti', body);
    expect(second.body.error.code).toBe('NO_UNBILLED_PURCHASES');
  });

  it('billed sales cannot be cancelled until the patti is cancelled; patti cancel reverses the ledger', async () => {
    const pattiRow = await prisma.patti.findFirstOrThrow({ where: { farmerId: ctx.farmer.id, status: 'FINALIZED' } });
    const saleRow = await prisma.sale.findFirstOrThrow({ where: { lot: { farmerId: ctx.farmer.id }, status: 'ACTIVE' } });
    expect((await post(ctx.owner.agent, `/api/v1/sales/${saleRow.id}/cancel`, { reason: 'x x x' })).body.error.code).toBe('IN_FINALIZED_PATTI');

    const c = await post(ctx.owner.agent, `/api/v1/patti/${pattiRow.id}/cancel`, { reason: 'Rate dispute' });
    expect(c.status).toBe(200);
    expect(c.body.data.record.status).toBe('CANCELLED');
    expect(c.body.data.record.purchases).toHaveLength(1); // still shows what it contained
    const f = await prisma.farmer.findUniqueOrThrow({ where: { id: ctx.farmer.id } });
    expect(f.currentBalance.toFixed(2)).toBe('0.00');
    expect(await prisma.purchase.count({ where: { farmerId: ctx.farmer.id, pattiId: null, status: 'ACTIVE' } })).toBe(1);
    expect((await post(ctx.owner.agent, `/api/v1/sales/${saleRow.id}/cancel`, { reason: 'now allowed' })).status).toBe(200);
  });

  it('nets the outstanding advance and rounds to the rupee', async () => {
    const adv = (await ctx.owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Advance Wala', openingBalance: '-3000' })).body.data;
    const lot = await newLot(ctx.owner.agent, adv.id, ctx.wheat.id, { weightUnit: 'KG', grossWeight: '400.16', tareWeight: '0', bags: 0 });
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '400.16', weightUnit: 'KG', rate: '2500.10', bags: 0 }));
    // 4.0016 qtl × 2500.10 = 10004.40016 → 10,004.40 ; commission 2.5% = 250.11 → net 9,754.29
    // advance 3,000 → 6,754.29 → rounded 6,754 (−0.29)
    const p = (await post(ctx.owner.agent, '/api/v1/patti', { farmerId: adv.id, pattiDate: today })).body.data;
    expect(p).toMatchObject({ grossAmount: '10004.4', netAmount: '9754.29', advanceAdjusted: '3000', roundOff: '-0.29', netPayable: '6754' });
    const f = await prisma.farmer.findUniqueOrThrow({ where: { id: adv.id } });
    expect(f.currentBalance.toFixed(2)).toBe('6754.00'); // −3000 + 9754.29 − 0.29
  });

  it('rejects deductions above gross', async () => {
    const fr = (await ctx.owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Small Lot' })).body.data;
    const lot = await newLot(ctx.owner.agent, fr.id, ctx.wheat.id, { grossWeight: '1', tareWeight: '0', bags: 0 });
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '1', rate: '1000', bags: 0 }));
    const r = await post(ctx.owner.agent, '/api/v1/patti', { farmerId: fr.id, pattiDate: today, manualDeductions: [{ label: 'Bardana', amount: '5000' }] });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('EXCESSIVE_DEDUCTIONS');
  });

  it('two simultaneous pattis for the same farmer: exactly one wins', async () => {
    const fr = (await ctx.owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Race Kisan' })).body.data;
    const lot = await newLot(ctx.owner.agent, fr.id, ctx.wheat.id);
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '10' }));
    const rs = await Promise.all([1, 2].map(() => post(ctx.owner.agent, '/api/v1/patti', { farmerId: fr.id, pattiDate: today })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 422]);
    expect(await prisma.patti.count({ where: { farmerId: fr.id } })).toBe(1);
  });

  it('print HTML is bilingual, uses the frozen snapshot, and escapes user input', async () => {
    const evil = (await ctx.owner.agent.post('/api/v1/farmers').set(H).send({ name: '<script>alert(1)</script>', nameHindi: 'सुरेश <b>यादव</b>' })).body.data;
    const lot = await newLot(ctx.owner.agent, evil.id, ctx.wheat.id);
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '10', rate: '2500', bags: 20 }));
    const p = (await post(ctx.owner.agent, '/api/v1/patti', { farmerId: evil.id, pattiDate: today })).body.data;
    await ctx.owner.agent.patch(`/api/v1/farmers/${evil.id}`).set(H).send({ nameHindi: 'बदला हुआ नाम' }); // later rename

    const r = await ctx.owner.agent.get(`/api/v1/patti/${p.id}/print`);
    expect(r.status).toBe(200);
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
    expect(r.text).not.toContain('<script>alert(1)</script>');
    expect(r.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(r.text).toContain('सुरेश &lt;b&gt;यादव&lt;/b&gt;'); // snapshot, escaped
    expect(r.text).not.toContain('बदला हुआ नाम');
    expect(r.text).toContain('किसान पट्टी');
    expect(r.text).toContain('आढ़त'); // Hindi rule label survives API → DB → snapshot → document
    expect(r.text).toContain('पल्लेदारी');
    expect(r.text).toContain('Net payable');
    // 10 × 2500 = 25,000 − 625 − 100 = 24,275
    expect(r.text).toContain('₹24,275.00');
    expect(r.text).toContain('चौबीस हज़ार दो सौ पचहत्तर रुपये मात्र');
    expect(r.text).toContain('Rupees Twenty Four Thousand Two Hundred Seventy Five Only');
  });

  it.skipIf(!pdf.available)('renders an A4 PDF via headless browser', async () => {
    const p = await prisma.patti.findFirstOrThrow({ where: { businessId: ctx.owner.businessId, status: 'FINALIZED' } });
    const r = await ctx.owner.agent.get(`/api/v1/patti/${p.id}/pdf`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('application/pdf');
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(5000);
  }, 60_000);
});

describe('trader mode', () => {
  it('requires buying from the farmer before selling; purchase cancels respect sold stock', async () => {
    const ctx = await setupBusiness();
    expect((await post(ctx.owner.agent, '/api/v1/purchases', { lotId: (await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id)).id, purchaseDate: today, weight: '1', rate: '1' })).body.error.code).toBe(
      'PURCHASE_NOT_ALLOWED_IN_MODE',
    );
    await ctx.owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ tradingMode: 'TRADER' });
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);

    const early = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '10' }));
    expect(early.body.error.code).toBe('STOCK_NOT_PURCHASED');

    const pur = await post(ctx.owner.agent, '/api/v1/purchases', { lotId: lot.id, purchaseDate: today, weight: '30', rate: '2300', bags: 60 });
    expect(pur.status).toBe(201);
    expect(pur.body.data).toMatchObject({ grossAmount: '69000', farmer: { id: ctx.farmer.id } }); // 30 × 2300

    const s = await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '20', rate: '2450' }));
    expect(s.status).toBe(201);
    expect(s.body.data.purchase).toBeNull(); // trader sale: no auto purchase
    expect((await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '11' }))).body.error.code).toBe('STOCK_NOT_PURCHASED');

    const c = await post(ctx.owner.agent, `/api/v1/purchases/${pur.body.data.id}/cancel`, { reason: 'test cancel' });
    expect(c.body.error.code).toBe('STOCK_ALREADY_SOLD');
  });
});

describe('commission rules & calculator', () => {
  it('validates rules and restricts them to the owner', async () => {
    const ctx = await setupBusiness();
    const munim = await addStaff(app, ctx.owner.agent, 'MUNIM');
    const bad = await ctx.owner.agent.post('/api/v1/commission-rules').set(H).send({ name: 'X', chargeType: 'COMMISSION', calcMethod: 'PERCENTAGE', value: '150', effectiveFrom: '2026-04-01' });
    expect(bad.status).toBe(400);
    expect((await munim.agent.post('/api/v1/commission-rules').set(H).send({ name: 'X', chargeType: 'LABOUR', calcMethod: 'FIXED', value: '5', effectiveFrom: '2026-04-01' })).status).toBe(403);
    const list = await munim.agent.get('/api/v1/commission-rules');
    expect(list.body.data).toHaveLength(3);
  });

  it('"50 quintal gehun ka 2500 rate" — computed by the backend engine', async () => {
    const ctx = await setupBusiness();
    const r = await ctx.owner.agent.post('/api/v1/calculate/amount').set(H).send({ quantity: '50', unit: 'QUINTAL', rate: '2500', rateUnit: 'QUINTAL' });
    expect(r.body.data).toEqual({ weightKg: '5000', amount: '125000' });
  });
});

describe('cross-tenant safety for operations', () => {
  it('cannot sell another business’s lot, nor read/cancel its patti', async () => {
    const a = await setupBusiness();
    const b = await setupBusiness();
    const lotB = await newLot(b.owner.agent, b.farmer.id, b.wheat.id);
    // A uses B's lot id with A's buyer
    expect((await post(a.owner.agent, '/api/v1/sales', sale(lotB.id, a.buyer.id))).status).toBe(404);
    // A uses its own lot but B's buyer
    const lotA = await newLot(a.owner.agent, a.farmer.id, a.wheat.id);
    expect((await post(a.owner.agent, '/api/v1/sales', sale(lotA.id, b.buyer.id))).status).toBe(404);
    // B finalizes a patti; A can't see or cancel it
    await post(b.owner.agent, '/api/v1/sales', sale(lotB.id, b.buyer.id, { weight: '5' }));
    const pB = (await post(b.owner.agent, '/api/v1/patti', { farmerId: b.farmer.id, pattiDate: today })).body.data;
    expect((await a.owner.agent.get(`/api/v1/patti/${pB.id}`)).status).toBe(404);
    expect((await a.owner.agent.get(`/api/v1/patti/${pB.id}/print`)).status).toBe(404);
    expect((await post(a.owner.agent, `/api/v1/patti/${pB.id}/cancel`, { reason: 'hostile' })).status).toBe(404);
    expect((await a.owner.agent.post('/api/v1/patti/preview').set(H).send({ farmerId: b.farmer.id, pattiDate: today })).status).toBe(404);
  });
});

describe('dashboard after trading', () => {
  it('separates gross sales from commission income', async () => {
    const ctx = await setupBusiness();
    const lot = await newLot(ctx.owner.agent, ctx.farmer.id, ctx.wheat.id);
    await post(ctx.owner.agent, '/api/v1/sales', sale(lot.id, ctx.buyer.id, { weight: '50', rate: '2500', bags: 100 }));
    await post(ctx.owner.agent, '/api/v1/patti', { farmerId: ctx.farmer.id, pattiDate: today });
    const d = (await ctx.owner.agent.get('/api/v1/reports/dashboard?range=today')).body.data;
    expect(d.grossSales.amount).toBe('125000');
    expect(d.commissionIncome).toBe('3125'); // only COMMISSION-type deductions, not labour or market fee
    expect(d.arrivals).toMatchObject({ lots: 1, netWeightKg: '5200' });
    expect(d.purchases.grossAmount).toBe('125000');
    expect(d.payables.amount).toBe('121375');
    expect(d.receivables.amount).toBe('126250'); // 1,25,000 + 1% market fee
  });
});

describe('ledger consistency after all operations', () => {
  it('every cached balance equals the sum of its ledger entries', async () => {
    const drift = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM (
        SELECT f."id" FROM "Farmer" f LEFT JOIN "FarmerLedgerEntry" e ON e."farmerId" = f."id"
        GROUP BY f."id", f."currentBalance" HAVING f."currentBalance" <> COALESCE(SUM(e."credit") - SUM(e."debit"), 0)
        UNION ALL
        SELECT b."id" FROM "Buyer" b LEFT JOIN "BuyerLedgerEntry" e ON e."buyerId" = b."id"
        GROUP BY b."id", b."currentBalance" HAVING b."currentBalance" <> COALESCE(SUM(e."debit") - SUM(e."credit"), 0)
      ) x`;
    expect(Number(drift[0]!.n)).toBe(0);
    // and lot sold weights equal the sum of their active sales
    const lotDrift = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Lot" l
      WHERE l."soldWeightKg" <> COALESCE((SELECT SUM(s."weightKg") FROM "Sale" s WHERE s."lotId" = l."id" AND s."status" = 'ACTIVE'), 0)`;
    expect(Number(lotDrift[0]!.n)).toBe(0);
  });
});
