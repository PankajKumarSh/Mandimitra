import { randomUUID } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { beforeAll, describe, expect, it } from 'vitest';
import { istDateString } from '../services/ledger.service.ts';
import { H, addStaff, makeApp, registerOwner, type Agent } from './helpers.ts';

const { app, prisma, pdf } = makeApp();
const today = istDateString();
const daysAgo = (n: number) => new Date(new Date(`${today}T00:00:00Z`).getTime() - n * 86_400_000).toISOString().slice(0, 10);
const yesterday = daysAgo(1);

const post = (agent: Agent, url: string, body: unknown, key: string = randomUUID()) => agent.post(url).set(H).set('Idempotency-Key', key).send(body as object);
const binary = (agent: Agent, url: string) =>
  agent.get(url).buffer(true).parse((res, cb) => {
    const chunks: Buffer[] = [];
    res.on('data', (c: Buffer) => chunks.push(c));
    res.on('end', () => cb(null, Buffer.concat(chunks)));
  });

/** Pull one file out of an xlsx (central-directory walk). */
function xlsxSheet(buf: Buffer): string {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  let p = buf.readUInt32LE(eocd + 16);
  for (let i = 0; i < buf.readUInt16LE(eocd + 10); i++) {
    const nlen = buf.readUInt16LE(p + 28);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString();
    const off = buf.readUInt32LE(p + 42);
    const csize = buf.readUInt32LE(p + 20);
    if (name === 'xl/worksheets/sheet1.xml') {
      const start = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
      return inflateRawSync(buf.subarray(start, start + csize)).toString('utf8');
    }
    p += 46 + nlen + buf.readUInt16LE(p + 30) + buf.readUInt16LE(p + 32);
  }
  throw new Error('sheet not found');
}

let owner: Awaited<ReturnType<typeof registerOwner>>;
let farmerId: string;
let buyerId: string;
let lotId: string;

/**
 * Scenario (hand-computed):
 *  rules: commission 2.5% (farmer), labour ₹5/bag (farmer), market fee 1% (buyer)
 *  yesterday: advance ₹5,000 to farmer                                   farmer −5,000
 *  today: lot 52 qtl; sale 40 qtl × ₹2,500, 80 bags = ₹1,00,000 + fee ₹1,000 → buyer +1,01,000
 *         patti: 1,00,000 − 2,500 − 400 = 97,100 net; advance 5,000 → payable 92,100   farmer +92,100
 */
beforeAll(async () => {
  owner = await registerOwner(app);
  const a = owner.agent;
  const rule = (b: object) => a.post('/api/v1/commission-rules').set(H).send({ effectiveFrom: '2026-01-01', ...b });
  await rule({ name: 'Commission', nameHindi: 'आढ़त', chargeType: 'COMMISSION', calcMethod: 'PERCENTAGE', value: '2.5' });
  await rule({ name: 'Labour', chargeType: 'LABOUR', calcMethod: 'PER_BAG', value: '5' });
  await rule({ name: 'Market fee', chargeType: 'MARKET_FEE', calcMethod: 'PERCENTAGE', value: '1', appliesTo: 'BUYER' });
  const wheat = (await a.get('/api/v1/commodities')).body.data.find((c: { name: string }) => c.name === 'Wheat');
  farmerId = (await a.post('/api/v1/farmers').set(H).send({ name: 'Ram Kumar', nameHindi: 'राम कुमार', village: 'Gharaunda' })).body.data.id;
  buyerId = (await a.post('/api/v1/buyers').set(H).send({ firmName: 'Bansal Rice Mills', city: 'Karnal' })).body.data.id;

  const adv = await post(a, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'ADVANCE', mode: 'CASH', amount: '5000', paymentDate: yesterday });
  expect(adv.status, JSON.stringify(adv.body)).toBe(201);

  lotId = (await post(a, '/api/v1/lots', { farmerId, commodityId: wheat.id, arrivalDate: today, weightUnit: 'QUINTAL', grossWeight: '52', bags: 104 })).body.data.id;
  const s = await post(a, '/api/v1/sales', { lotId, buyerId, saleDate: today, weight: '40', weightUnit: 'QUINTAL', bags: 80, rate: '2500' });
  expect(s.body.data.totalAmount).toBe('101000');
  const p = await post(a, '/api/v1/patti', { farmerId, pattiDate: today });
  expect(p.body.data).toMatchObject({ netAmount: '97100', advanceAdjusted: '5000', netPayable: '92100' });
});

const balance = async (kind: 'farmer' | 'buyer', id: string) =>
  (kind === 'farmer' ? await prisma.farmer.findUniqueOrThrow({ where: { id } }) : await prisma.buyer.findUniqueOrThrow({ where: { id } })).currentBalance.toFixed(2);

describe('payments', () => {
  it('advance was recorded with a receipt number and an ADVANCE ledger debit', async () => {
    const p = await prisma.payment.findFirstOrThrow({ where: { farmerId, purpose: 'ADVANCE' } });
    expect(p.receiptNumber).toMatch(/^R\/\d{4}-\d{2}\/000001$/);
    const e = await prisma.farmerLedgerEntry.findFirstOrThrow({ where: { paymentId: p.id } });
    expect([e.entryType, e.debit.toFixed(2)]).toEqual(['ADVANCE', '5000.00']);
    expect(await balance('farmer', farmerId)).toBe('92100.00');
  });

  it('settlement can never exceed what is payable (zero / negative / too much)', async () => {
    const r = await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'CASH', amount: '92100.01', paymentDate: today });
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'PAYMENT_EXCEEDS_PAYABLE', details: { payable: '92100.00' } });
    expect((await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'CASH', amount: '0', paymentDate: today })).status).toBe(400);
    expect((await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'CASH', amount: '-5', paymentDate: today })).status).toBe(400);
    expect((await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'COLLECTION', mode: 'CASH', amount: '5', paymentDate: today })).status).toBe(400);
  });

  it('partial settlement by UPI; a repeated UTR is flagged (not blocked)', async () => {
    const r1 = await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'UPI', referenceNumber: 'UTR998877', amount: '50000', paymentDate: today });
    expect(r1.status).toBe(201);
    expect(r1.body.meta.warnings).toEqual([]);
    expect(await balance('farmer', farmerId)).toBe('42100.00');
    const r2 = await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'UPI', referenceNumber: 'UTR998877', amount: '100', paymentDate: today });
    expect(r2.status).toBe(201);
    expect(r2.body.meta.warnings[0]).toMatchObject({ code: 'DUPLICATE_REFERENCE', receiptNumber: r1.body.data.receiptNumber });
    expect(await balance('farmer', farmerId)).toBe('42000.00');

    // cancel the mistaken one → reversal restores the balance
    const c = await post(owner.agent, `/api/v1/payments/${r2.body.data.id}/cancel`, { reason: 'Same UTR entered twice' });
    expect(c.status).toBe(200);
    expect(await balance('farmer', farmerId)).toBe('42100.00');
    const rev = await prisma.farmerLedgerEntry.findFirstOrThrow({ where: { paymentId: r2.body.data.id, entryType: 'REVERSAL' } });
    expect(rev.credit.toFixed(2)).toBe('100.00');
    expect((await post(owner.agent, `/api/v1/payments/${r2.body.data.id}/cancel`, { reason: 'again' })).body.error.code).toBe('ALREADY_CANCELLED');
  });

  it('cheques need a cheque number', async () => {
    const r = await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'SETTLEMENT', mode: 'CHEQUE', amount: '10', paymentDate: today });
    expect(r.status).toBe(400);
  });

  it('buyer collection credits the buyer; overpayment is allowed but flagged', async () => {
    const r = await post(owner.agent, '/api/v1/payments', { partySide: 'BUYER', buyerId, mode: 'BANK_TRANSFER', referenceNumber: 'NEFT001', amount: '60000', paymentDate: today });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ direction: 'INCOMING', purpose: 'COLLECTION' });
    expect(await balance('buyer', buyerId)).toBe('41000.00');

    const b2 = (await owner.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Over Payer', openingBalance: '100' })).body.data.id;
    const over = await post(owner.agent, '/api/v1/payments', { partySide: 'BUYER', buyerId: b2, mode: 'CASH', amount: '150', paymentDate: today });
    expect(over.body.meta.warnings[0]).toMatchObject({ code: 'OVERPAYMENT', outstanding: '100.00' });
    expect(await balance('buyer', b2)).toBe('-50.00');
  });

  it('advances can be switched off per business', async () => {
    await owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ allowNegativeFarmerBalance: false });
    const f = (await owner.agent.post('/api/v1/farmers').set(H).send({ name: 'No Advance' })).body.data.id;
    const r = await post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId: f, purpose: 'ADVANCE', mode: 'CASH', amount: '1', paymentDate: today });
    expect(r.body.error.code).toBe('ADVANCE_NOT_ALLOWED');
    await owner.agent.patch('/api/v1/businesses/current/settings').set(H).send({ allowNegativeFarmerBalance: true });
  });

  it('concurrent settlements cannot overdraw the payable balance', async () => {
    const f = (await owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Race', openingBalance: '25000' })).body.data.id;
    const rs = await Promise.all(Array.from({ length: 5 }, () => post(owner.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId: f, purpose: 'SETTLEMENT', mode: 'CASH', amount: '10000', paymentDate: today })));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 201, 422, 422, 422]);
    expect(await balance('farmer', f)).toBe('5000.00');
  });

  it('a double-submitted payment is recorded once', async () => {
    const key = randomUUID();
    const body = { partySide: 'BUYER', buyerId, mode: 'CASH', amount: '1000', paymentDate: today };
    const rs = await Promise.all([1, 2, 3].map(() => post(owner.agent, '/api/v1/payments', body, key)));
    expect(rs.every((r) => r.status === 201 || r.status === 409)).toBe(true);
    expect(await prisma.payment.count({ where: { idempotencyKey: key } })).toBe(1);
    expect(await balance('buyer', buyerId)).toBe('40000.00');
  });

  it('receipt is bilingual with amount in words', async () => {
    const p = await prisma.payment.findFirstOrThrow({ where: { farmerId, referenceNumber: 'UTR998877', status: 'ACTIVE' } });
    const r = await owner.agent.get(`/api/v1/payments/${p.id}/receipt`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('भुगतान वाउचर');
    expect(r.text).toContain('पचास हज़ार रुपये मात्र');
    expect(r.text).toContain('Rupees Fifty Thousand Only');
    expect(r.text).toContain('₹42,100.00'); // balance after this payment
  });
});

describe('ledger statements', () => {
  it('orders by business date: a back-dated advance comes first, running balance and closing are exact', async () => {
    const r = await owner.agent.get(`/api/v1/ledger/farmers/${farmerId}`);
    expect(r.status).toBe(200);
    const s = r.body.data;
    expect(s.entries[0]).toMatchObject({ date: yesterday, type: 'ADVANCE', debit: '5000.00', balance: '-5000.00' });
    expect(s.entries.map((e: { balance: string }) => e.balance)).toEqual(['-5000.00', '92100.00', '42100.00', '42000.00', '42100.00']);
    expect(s.closingBalance).toBe('42100.00');
    expect(s.closingBalance).toBe(s.currentBalance);
  });

  it('opening balance for a date range = everything before it', async () => {
    const s = (await owner.agent.get(`/api/v1/ledger/farmers/${farmerId}?from=${today}&to=${today}`)).body.data;
    expect(s.openingBalance).toBe('-5000.00');
    expect(s.entries).toHaveLength(4);
    expect(s.totals).toEqual({ debit: '50100.00', credit: '97200.00' });
    expect(s.closingBalance).toBe('42100.00');
  });

  it('buyer statement: debit sale, credit collections', async () => {
    const s = (await owner.agent.get(`/api/v1/ledger/buyers/${buyerId}`)).body.data;
    expect(s.entries.map((e: { type: string; ref: string | null }) => e.type)).toEqual(['SALE_DEBIT', 'PAYMENT', 'PAYMENT']);
    expect(s.entries[0].ref).toMatch(/^S\//);
    expect(s.closingBalance).toBe('40000.00');
  });

  it('statement print view is bilingual and escaped', async () => {
    const r = await owner.agent.get(`/api/v1/ledger/farmers/${farmerId}?format=html`);
    expect(r.status).toBe(200);
    expect(r.text).toContain('किसान खाता — राम कुमार');
    expect(r.headers['content-security-policy']).toContain("default-src 'none'");
  });

  it.skipIf(!pdf.available)('statement PDF renders', async () => {
    const r = await binary(owner.agent, `/api/v1/ledger/farmers/${farmerId}?format=pdf`);
    expect(r.status).toBe(200);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);
});

describe('expenses', () => {
  let munim: Awaited<ReturnType<typeof addStaff>>;
  beforeAll(async () => {
    munim = await addStaff(app, owner.agent, 'MUNIM');
  });

  it('records, totals by category, and cancels (owner direct, munim via approval)', async () => {
    const cats = (await owner.agent.get('/api/v1/expenses/categories')).body.data;
    const labour = cats.find((c: { name: string }) => c.name === 'Labour').id;
    const elec = cats.find((c: { name: string }) => c.name === 'Electricity').id;
    const e1 = await post(owner.agent, '/api/v1/expenses', { categoryId: labour, expenseDate: today, amount: '1500', payee: 'Palledar team' });
    expect(e1.status).toBe(201);
    expect(e1.body.data.expenseNumber).toMatch(/^E\//);
    const e2 = await post(munim.agent, '/api/v1/expenses', { categoryId: elec, expenseDate: today, amount: '2350.50' });
    expect(e2.status).toBe(201);

    const list = await owner.agent.get(`/api/v1/expenses?from=${today}&to=${today}`);
    expect(list.body.meta.totals.amount).toBe('3850.5');

    const req = await post(munim.agent, `/api/v1/expenses/${e2.body.data.id}/cancel`, { reason: 'Wrong month bill' });
    expect(req.status).toBe(202);
    const approval = req.body.data.approvalRequest.id;
    expect((await owner.agent.post(`/api/v1/approvals/${approval}/approve`).set(H).send({})).status).toBe(200);
    const after = await owner.agent.get(`/api/v1/expenses?from=${today}&to=${today}`);
    expect(after.body.meta.totals.amount).toBe('1500');
  });

  it('viewer cannot record expenses; inactive categories are refused', async () => {
    const viewer = await addStaff(app, owner.agent, 'VIEWER');
    const cat = (await owner.agent.post('/api/v1/expenses/categories').set(H).send({ name: 'Tea & snacks', nameHindi: 'चाय-नाश्ता' })).body.data;
    expect((await post(viewer.agent, '/api/v1/expenses', { categoryId: cat.id, expenseDate: today, amount: '50' })).status).toBe(403);
    await owner.agent.patch(`/api/v1/expenses/categories/${cat.id}`).set(H).send({ isActive: false });
    expect((await post(owner.agent, '/api/v1/expenses', { categoryId: cat.id, expenseDate: today, amount: '50' })).body.error.code).toBe('CATEGORY_INACTIVE');
  });
});

describe('reports', () => {
  const run = (key: string, qs = `from=${yesterday}&to=${today}`) => owner.agent.get(`/api/v1/reports/${key}?${qs}`);

  it('sales / purchases / commission tie out', async () => {
    const sales = (await run('sales')).body.data;
    expect(sales.totals).toMatchObject({ gross: '100000.00', charges: '1000.00', total: '101000.00' });
    const purchases = (await run('purchases')).body.data;
    expect(purchases.totals.amount).toBe('100000.00');
    const comm = (await run('commission')).body.data;
    expect(comm.totals).toMatchObject({ pattis: 1, farmerSide: '2500.00', buyerSide: '0.00', total: '2500.00' }); // labour & market fee excluded
  });

  it('business summary separates trade value, income, pass-through, cash and positions', async () => {
    const r = (await run('monthly-summary')).body.data;
    const v = (needle: string) => r.rows.find((x: { metric: string }) => x.metric.includes(needle)).amount;
    expect(v('Gross sales')).toBe('100000.00');
    expect(v('Total commission income')).toBe('2500.00');
    expect(v('Business expenses')).toBe('1500.00');
    expect(v('Commission income − expenses')).toBe('1000.00');
    expect(v('Other farmer deductions')).toBe('400.00');
    expect(v('Other buyer charges')).toBe('1000.00');
    // 5,000 advance + 50,000 UPI (cancelled ₹100 excluded) + 2 × 10,000 from the concurrency test's "Race" farmer
    expect(v('Paid to farmers')).toBe('75000.00');
    expect(r.rows.some((x: { metric: string }) => /profit/i.test(x.metric))).toBe(false);
  });

  it('farmer & buyer outstanding', async () => {
    const f = (await run('farmer-outstanding', '')).body.data;
    expect(f.rows.find((x: { name: string }) => x.name === 'Ram Kumar')).toMatchObject({ payable: '42100.00', advance: null });
    const b = (await run('buyer-outstanding', '')).body.data;
    expect(b.rows.find((x: { firm: string }) => x.firm === 'Bansal Rice Mills')).toMatchObject({ outstanding: '40000.00', b0: '40000.00', b91: '0.00' });
  });

  it('stock and commodity-wise', async () => {
    const st = (await run('stock', '')).body.data;
    expect(st.rows.find((x: { unsoldKg: string }) => x.unsoldKg === '1200.000')).toBeTruthy(); // 52 − 40 qtl
    const cw = (await run('commodity-wise')).body.data;
    expect(cw.rows[0]).toMatchObject({ lots: 1, arrivedKg: '5200.000', soldKg: '4000.000', gross: '100000.00', avgRate: '2500.00' });
  });

  it('exports Excel (valid xlsx with exact numbers) and logs the export', async () => {
    const r = await binary(owner.agent, `/api/v1/reports/sales?from=${yesterday}&to=${today}&format=xlsx`);
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml');
    const buf = r.body as Buffer;
    expect(buf.subarray(0, 2).toString()).toBe('PK');
    const sheet = xlsxSheet(buf);
    expect(sheet).toContain('<v>100000.00</v>');
    expect(sheet).toContain('<v>101000.00</v>');
    expect(sheet).toContain('Bansal Rice Mills');
    expect(await prisma.staffActivity.count({ where: { userId: owner.userId, activityType: 'REPORT_EXPORTED' } })).toBeGreaterThan(0);
  });

  it.skipIf(!pdf.available)('exports PDF', async () => {
    const r = await binary(owner.agent, `/api/v1/reports/buyer-outstanding?format=pdf`);
    expect((r.body as Buffer).subarray(0, 5).toString()).toBe('%PDF-');
  }, 60_000);

  it('viewer can read reports but not export them', async () => {
    const viewer = await addStaff(app, owner.agent, 'VIEWER');
    expect((await viewer.agent.get('/api/v1/reports/sales')).status).toBe(200);
    expect((await viewer.agent.get('/api/v1/reports/sales?format=xlsx')).status).toBe(403);
    expect((await viewer.agent.get(`/api/v1/ledger/farmers/${farmerId}?format=pdf`)).status).toBe(403);
  });

  it('rejects unknown reports and inverted ranges', async () => {
    expect((await owner.agent.get('/api/v1/reports/profit')).status).toBe(400);
    expect((await owner.agent.get(`/api/v1/reports/sales?from=${today}&to=${yesterday}`)).status).toBe(400);
  });
});

describe('buyer ageing (FIFO)', () => {
  it('collections settle the oldest sales first', async () => {
    const o = await registerOwner(app); // no rules → no buyer charges
    const wheat = (await o.agent.get('/api/v1/commodities')).body.data[0].id;
    const f = (await o.agent.post('/api/v1/farmers').set(H).send({ name: 'Ageing Farmer' })).body.data.id;
    const b = (await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Slow Payer' })).body.data.id;
    const lot = (await post(o.agent, '/api/v1/lots', { farmerId: f, commodityId: wheat, arrivalDate: daysAgo(120), weightUnit: 'QUINTAL', grossWeight: '20' })).body.data.id;
    const sell = (q: string, d: string) => post(o.agent, '/api/v1/sales', { lotId: lot, buyerId: b, saleDate: d, weight: q, rate: '1000' });
    await sell('10', daysAgo(100)); // ₹10,000 (90+)
    await sell('5', daysAgo(45)); //  ₹5,000  (31–60)
    await sell('2', today); //        ₹2,000  (0–30)
    await post(o.agent, '/api/v1/payments', { partySide: 'BUYER', buyerId: b, mode: 'CASH', amount: '12000', paymentDate: today });
    // 12,000 clears the 10,000 sale and 2,000 of the 5,000 one → 3,000 (31–60) + 2,000 (0–30)
    const row = (await o.agent.get('/api/v1/reports/buyer-outstanding')).body.data.rows[0];
    expect(row).toMatchObject({ outstanding: '5000.00', b0: '2000.00', b31: '3000.00', b61: '0.00', b91: '0.00' });
  });
});

describe('cross-tenant safety for money', () => {
  it('another business cannot see statements, receipts, payments or expenses', async () => {
    const other = await registerOwner(app);
    const p = await prisma.payment.findFirstOrThrow({ where: { businessId: owner.businessId } });
    const e = await prisma.expense.findFirstOrThrow({ where: { businessId: owner.businessId } });
    expect((await other.agent.get(`/api/v1/ledger/farmers/${farmerId}`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/ledger/buyers/${buyerId}?format=html`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/payments/${p.id}`)).status).toBe(404);
    expect((await other.agent.get(`/api/v1/payments/${p.id}/receipt`)).status).toBe(404);
    expect((await post(other.agent, `/api/v1/payments/${p.id}/cancel`, { reason: 'hostile' })).status).toBe(404);
    expect((await post(other.agent, `/api/v1/expenses/${e.id}/cancel`, { reason: 'hostile' })).status).toBe(404);
    expect((await post(other.agent, '/api/v1/payments', { partySide: 'FARMER', farmerId, purpose: 'ADVANCE', mode: 'CASH', amount: '1', paymentDate: today })).status).toBe(404);
    const rep = (await other.agent.get('/api/v1/reports/farmer-outstanding')).body.data;
    expect(rep.rows).toHaveLength(0);
  });
});
