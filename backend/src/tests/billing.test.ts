import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { Prisma } from '@mandimitra/database';
import { loadEnv } from '../config/env.ts';
import { createLogger } from '../config/logger.ts';
import { hmacHex, MockGateway, RazorpayGateway } from '../services/billing/gateway.ts';
import { classifyChange, computePeriod, sweepAction, toPaise, type SubState } from '../services/billing/lifecycle.ts';
import { H, addStaff, makeApp, registerOwner, type Agent } from './helpers.ts';

const { app, prisma, gateway } = makeApp();
const mock = gateway as MockGateway;
const DAY = 86_400_000;
const D = (v: string) => new Prisma.Decimal(v);
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });

async function pay(agent: Agent, planCode: string) {
  const co = await agent.post('/api/v1/billing/checkout').set(H).send({ planCode });
  expect(co.status, JSON.stringify(co.body)).toBe(201);
  const done = await agent.post('/api/v1/billing/mock/complete').set(H).send({ orderId: co.body.data.orderId });
  expect(done.status).toBe(200);
  const v = await agent.post('/api/v1/billing/verify').set(H).send(done.body.data);
  return { checkout: co.body.data, popup: done.body.data, verify: v };
}

function webhookBody(event: string, orderId: string, amount: number, paymentId = `pay_${randomUUID().slice(0, 12)}`) {
  return JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: 'INR', status: event === 'payment.failed' ? 'failed' : 'captured', error_description: 'Card declined' } } } });
}

// ---------------------------------------------------------------------------------------------- rules

describe('billing rules (pure)', () => {
  const now = new Date('2026-11-20T06:00:00Z');
  const pro: SubState = { status: 'ACTIVE', planCode: 'PROFESSIONAL', planPrice: D('799'), trialEndsAt: null, currentPeriodEnd: new Date(now.getTime() + 15 * DAY) };
  const BUSINESS = { code: 'BUSINESS', price: D('1499') };

  it('classifies new / renewal / upgrade / downgrade', () => {
    expect(classifyChange(pro, { code: 'PROFESSIONAL', price: D('799') }, now)).toBe('RENEWAL');
    expect(classifyChange(pro, BUSINESS, now)).toBe('UPGRADE');
    expect(classifyChange(pro, { code: 'STARTER', price: D('499') }, now)).toBe('DOWNGRADE');
    expect(classifyChange({ ...pro, currentPeriodEnd: new Date(now.getTime() - 1) }, { code: 'STARTER', price: D('499') }, now)).toBe('NEW');
    expect(classifyChange({ ...pro, status: 'TRIALING' }, { code: 'STARTER', price: D('499') }, now)).toBe('NEW');
  });

  it('a payment during a live trial starts when the trial ends (free days are kept)', () => {
    const trialEnd = new Date(now.getTime() + 5 * DAY);
    const p = computePeriod({ ...pro, status: 'TRIALING', trialEndsAt: trialEnd, currentPeriodEnd: null }, BUSINESS, now, 30);
    expect(p.kind).toBe('NEW');
    expect(p.start).toEqual(trialEnd);
    expect(p.end.getTime()).toBe(trialEnd.getTime() + 30 * DAY);
  });

  it('renewal is appended to the current period; an expired one restarts today', () => {
    const r = computePeriod(pro, { code: 'PROFESSIONAL', price: D('799') }, now, 30);
    expect(r.start).toEqual(pro.currentPeriodEnd);
    expect(r.end.getTime()).toBe(pro.currentPeriodEnd!.getTime() + 30 * DAY);
    const e = computePeriod({ ...pro, status: 'EXPIRED', currentPeriodEnd: new Date(now.getTime() - DAY) }, BUSINESS, now, 30);
    expect(e.start).toEqual(now);
  });

  it('upgrade credits the unused value of the old plan as extra days', () => {
    const u = computePeriod(pro, BUSINESS, now, 30);
    // 15 days × 799 / 1499 = 7.9953 days → floored to whole minutes
    const expected = Math.floor((15 * DAY * 799) / 1499 / 60_000) * 60_000;
    expect(u.creditMs).toBe(expected);
    expect(u.end.getTime()).toBe(now.getTime() + 30 * DAY + expected);
    expect(() => computePeriod(pro, { code: 'STARTER', price: D('499') }, now, 30)).toThrow();
  });

  it('converts rupees to paise exactly', () => {
    expect(toPaise(D('1499.00'))).toBe(149900);
    expect(toPaise(D('0.10'))).toBe(10);
    expect(() => toPaise(D('0'))).toThrow();
  });

  it('sweep decisions', () => {
    const base = { ...pro, cancelAtPeriodEnd: false, hasPendingPlan: false };
    expect(sweepAction({ ...base, currentPeriodEnd: new Date(now.getTime() + 3 * DAY - 1000) }, now, 15)).toEqual({ action: 'REMIND', daysLeft: 3 });
    expect(sweepAction({ ...base, currentPeriodEnd: new Date(now.getTime() + 10 * DAY) }, now, 15)).toEqual({ action: 'NONE' });
    expect(sweepAction({ ...base, currentPeriodEnd: new Date(now.getTime() - 1), hasPendingPlan: true }, now, 15)).toEqual({ action: 'LAPSE', to: 'PAST_DUE', applyPendingPlan: true });
    expect(sweepAction({ ...base, currentPeriodEnd: new Date(now.getTime() - 1), cancelAtPeriodEnd: true }, now, 15)).toEqual({ action: 'LAPSE', to: 'CANCELLED', applyPendingPlan: false });
    expect(sweepAction({ ...base, status: 'PAST_DUE', currentPeriodEnd: new Date(now.getTime() - 16 * DAY) }, now, 15)).toEqual({ action: 'EXPIRE_PAST_DUE' });
    expect(sweepAction({ ...base, status: 'PAST_DUE', currentPeriodEnd: new Date(now.getTime() - 14 * DAY) }, now, 15)).toEqual({ action: 'NONE' });
    expect(sweepAction({ ...base, status: 'TRIALING', trialEndsAt: new Date(now.getTime() - 1) }, now, 15)).toEqual({ action: 'EXPIRE_TRIAL' });
  });
});

describe('Razorpay gateway', () => {
  const env = loadEnv({ ...process.env, BILLING_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'rzp_test_abc', RAZORPAY_KEY_SECRET: 'sekret', RAZORPAY_WEBHOOK_SECRET: 'whsec' });

  it('creates orders with Basic auth, paise amount and INR, server-side only', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ id: 'order_TEST123', amount: 79900 }), { status: 200 });
    }) as unknown as typeof fetch;
    const g = new RazorpayGateway(env, logger, fake);
    expect(await g.createOrder({ amountPaise: 79900, receipt: 'r1', notes: { a: 'b' } })).toEqual({ id: 'order_TEST123' });
    expect(calls[0]!.url).toBe('https://api.razorpay.com/v1/orders');
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from('rzp_test_abc:sekret').toString('base64')}`);
    expect(JSON.parse(calls[0]!.init.body as string)).toEqual({ amount: 79900, currency: 'INR', receipt: 'r1', notes: { a: 'b' } });
  });

  it('surfaces gateway errors', async () => {
    const fake = (async () => new Response(JSON.stringify({ error: { code: 'BAD_REQUEST_ERROR', description: 'Authentication failed' } }), { status: 401 })) as unknown as typeof fetch;
    await expect(new RazorpayGateway(env, logger, fake).createOrder({ amountPaise: 100, receipt: 'r', notes: {} })).rejects.toMatchObject({ code: 'BAD_REQUEST_ERROR' });
  });

  it('verifies checkout and webhook signatures (HMAC-SHA256 hex)', () => {
    const g = new RazorpayGateway(env, logger);
    const sig = hmacHex('sekret', 'order_1|pay_1');
    expect(g.verifyPaymentSignature('order_1', 'pay_1', sig)).toBe(true);
    expect(g.verifyPaymentSignature('order_1', 'pay_2', sig)).toBe(false);
    expect(g.verifyPaymentSignature('order_1', 'pay_1', sig.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a')))).toBe(false);
    const body = Buffer.from('{"event":"payment.captured"}');
    expect(g.verifyWebhookSignature(body, hmacHex('whsec', body))).toBe(true);
    expect(g.verifyWebhookSignature(body, hmacHex('other', body))).toBe(false);
    expect(g.verifyWebhookSignature(undefined, 'x')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------- API

describe('subscription checkout', () => {
  it('trial → pay for BUSINESS: verified server-side, period starts after the trial, receipt available', async () => {
    const o = await registerOwner(app);
    const before = (await o.agent.get('/api/v1/billing/subscription')).body.data;
    expect(before.status).toBe('TRIALING');
    expect(before.plan.code).toBe('PROFESSIONAL');

    const { checkout, popup, verify } = await pay(o.agent, 'BUSINESS');
    expect(checkout).toMatchObject({ provider: 'mock', amount: '1499.00', amountPaise: 149900, currency: 'INR', kind: 'NEW', keyId: 'rzp_test_mock' });
    expect(verify.status).toBe(200);
    expect(verify.body.data).toMatchObject({ status: 'ACTIVE', plan: { code: 'BUSINESS' } });
    const trialEnd = new Date(before.trialEndsAt).getTime();
    expect(new Date(verify.body.data.currentPeriodEnd).getTime()).toBe(trialEnd + 30 * DAY);

    const list = (await o.agent.get('/api/v1/billing/payments')).body.data;
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'SUCCEEDED', amount: '1499', gatewayPaymentId: popup.paymentId });
    const receipt = await o.agent.get(`/api/v1/billing/payments/${list[0].id}/receipt`);
    expect(receipt.status).toBe(200);
    expect(receipt.text).toContain(popup.paymentId);
    expect(receipt.text).toContain('₹1,499.00');

    // Same callback again (double click / retry) changes nothing.
    const again = await o.agent.post('/api/v1/billing/verify').set(H).send(popup);
    expect(again.body.data.currentPeriodEnd).toBe(verify.body.data.currentPeriodEnd);
    const events = await prisma.subscriptionEvent.findMany({ where: { businessId: o.businessId, eventType: 'ACTIVATED' } });
    expect(events).toHaveLength(1);
    // /auth/me reflects the new plan immediately (tenant cache invalidated).
    expect((await o.agent.get('/api/v1/auth/me')).body.data.activeBusiness.subscription.planCode).toBe('BUSINESS');
  });

  it('a forged or mismatched signature changes nothing', async () => {
    const o = await registerOwner(app);
    const co = (await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'STARTER' })).body.data;
    const forged = await o.agent.post('/api/v1/billing/verify').set(H).send({ orderId: co.orderId, paymentId: 'pay_fake', signature: 'a'.repeat(64) });
    expect(forged.status).toBe(400);
    expect(forged.body.error.code).toBe('PAYMENT_VERIFICATION_FAILED');
    // A real signature for a different order cannot be replayed onto this one.
    const other = (await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'STARTER' })).body.data;
    const popup = (await o.agent.post('/api/v1/billing/mock/complete').set(H).send({ orderId: other.orderId })).body.data;
    expect((await o.agent.post('/api/v1/billing/verify').set(H).send({ ...popup, orderId: co.orderId })).status).toBe(400);
    const sub = await prisma.subscription.findUniqueOrThrow({ where: { businessId: o.businessId } });
    expect(sub.status).toBe('TRIALING');
    expect((await prisma.billingPayment.findFirstOrThrow({ where: { gatewayOrderId: co.orderId } })).status).toBe('PENDING');
  });

  it('the client names a plan only — amounts are never accepted from the browser', async () => {
    const o = await registerOwner(app);
    const r = await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'BUSINESS', amount: 1 });
    expect(r.status).toBe(400);
    expect((await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'GOLD' })).status).toBe(400);
  });

  it('an expired business can still pay, and writes work again afterwards', async () => {
    const o = await registerOwner(app);
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });
    expect((await o.agent.patch('/api/v1/businesses/current/settings').set(H).send({ pattiFooterNote: 'x' })).status).toBe(402);
    const { verify } = await pay(o.agent, 'STARTER');
    expect(verify.body.data.status).toBe('ACTIVE');
    const start = Date.now();
    expect(Math.abs(new Date(verify.body.data.currentPeriodEnd).getTime() - (start + 30 * DAY))).toBeLessThan(60_000);
    expect((await o.agent.patch('/api/v1/businesses/current/settings').set(H).send({ pattiFooterNote: 'x' })).status).toBe(200);
  });

  it('staff can see the plan but only the owner can pay', async () => {
    const o = await registerOwner(app);
    const munim = await addStaff(app, o.agent, 'MUNIM');
    expect((await munim.agent.get('/api/v1/billing/subscription')).status).toBe(200);
    expect((await munim.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'BUSINESS' })).status).toBe(403);
    const viewer = await addStaff(app, o.agent, 'VIEWER');
    expect((await viewer.agent.get('/api/v1/billing/subscription')).status).toBe(403);
  });

  it('upgrade mid-period credits unused days; smaller plans are scheduled for renewal', async () => {
    const o = await registerOwner(app);
    await pay(o.agent, 'PROFESSIONAL');
    const end = new Date(Date.now() + 15 * DAY);
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { currentPeriodEnd: end } });

    const t0 = Date.now();
    const { checkout, verify } = await pay(o.agent, 'BUSINESS');
    expect(checkout.kind).toBe('UPGRADE');
    const credit = (15 * DAY * 799) / 1499;
    const got = new Date(verify.body.data.currentPeriodEnd).getTime();
    expect(Math.abs(got - (t0 + 30 * DAY + credit))).toBeLessThan(5 * 60_000);
    expect(verify.body.data.plan.code).toBe('BUSINESS');

    const down = await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'STARTER' });
    expect(down.status).toBe(409);
    expect(down.body.error.code).toBe('PLAN_CHANGE_AT_RENEWAL');

    await addStaff(app, o.agent, 'MUNIM'); // 2 active members; STARTER allows 1
    const blocked = await o.agent.post('/api/v1/billing/change-plan').set(H).send({ planCode: 'STARTER' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error).toMatchObject({ code: 'DOWNGRADE_BLOCKED_STAFF', details: { activeStaff: 2, limit: 1 } });

    const sched = await o.agent.post('/api/v1/billing/change-plan').set(H).send({ planCode: 'PROFESSIONAL' });
    expect(sched.status).toBe(200);
    expect(sched.body.data.pendingPlan.code).toBe('PROFESSIONAL');
    expect(sched.body.data.plan.code).toBe('BUSINESS'); // unchanged until renewal
    const cleared = await o.agent.post('/api/v1/billing/change-plan/cancel').set(H).send({});
    expect(cleared.body.data.pendingPlan).toBeNull();
  });

  it('cancel at period end and resume; not possible without a paid plan', async () => {
    const o = await registerOwner(app);
    expect((await o.agent.post('/api/v1/billing/cancel').set(H).send({})).body.error.code).toBe('NO_ACTIVE_PAID_PLAN');
    await pay(o.agent, 'STARTER');
    expect((await o.agent.post('/api/v1/billing/cancel').set(H).send({})).body.data.cancelAtPeriodEnd).toBe(true);
    expect((await o.agent.post('/api/v1/billing/resume').set(H).send({})).body.data.cancelAtPeriodEnd).toBe(false);
  });

  it("another business's order is invisible", async () => {
    const a = await registerOwner(app);
    const b = await registerOwner(app);
    const co = (await a.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'STARTER' })).body.data;
    expect((await b.agent.post('/api/v1/billing/mock/complete').set(H).send({ orderId: co.orderId })).status).toBe(404);
    const popup = mock.complete(co.orderId)!;
    expect((await b.agent.post('/api/v1/billing/verify').set(H).send({ orderId: co.orderId, ...popup })).status).toBe(404);
  });
});

describe('Razorpay webhook', () => {
  const send = (body: string, sig?: string, eventId: string = randomUUID()) => {
    const req = request(app).post('/api/v1/webhooks/razorpay').set('content-type', 'application/json').set('x-razorpay-event-id', eventId);
    return (sig === undefined ? req : req.set('x-razorpay-signature', sig)).send(body);
  };
  const signed = (body: string, eventId?: string) => send(body, hmacHex(mock.webhookSecret, body), eventId);

  it('rejects unsigned and wrongly signed calls', async () => {
    const body = webhookBody('payment.captured', 'order_x', 100);
    expect((await send(body)).status).toBe(401);
    expect((await send(body, hmacHex('wrong', body))).status).toBe(401);
  });

  it('payment.captured activates even if the browser never came back; replays are ignored', async () => {
    const o = await registerOwner(app);
    const co = (await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'PROFESSIONAL' })).body.data;
    const body = webhookBody('payment.captured', co.orderId, 79900);
    const eventId = randomUUID();
    const r = await signed(body, eventId);
    expect(r.status).toBe(200);
    expect(r.body.processed).toBe(true);
    const sub1 = await prisma.subscription.findUniqueOrThrow({ where: { businessId: o.businessId } });
    expect(sub1.status).toBe('ACTIVE');
    expect((await signed(body, eventId)).body.reason).toBe('duplicate');
    // order.paid for the same order (different event) is a no-op: no second period.
    await signed(webhookBody('order.paid', co.orderId, 79900));
    const sub2 = await prisma.subscription.findUniqueOrThrow({ where: { businessId: o.businessId } });
    expect(sub2.currentPeriodEnd).toEqual(sub1.currentPeriodEnd);
  });

  it('checkout callback and webhook arriving together extend the period once', async () => {
    const o = await registerOwner(app);
    const co = (await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'STARTER' })).body.data;
    const popup = mock.complete(co.orderId)!;
    await Promise.all([
      o.agent.post('/api/v1/billing/verify').set(H).send({ orderId: co.orderId, ...popup }),
      signed(webhookBody('payment.captured', co.orderId, 49900, popup.paymentId)),
      signed(webhookBody('payment.captured', co.orderId, 49900, popup.paymentId)),
    ]);
    const events = await prisma.subscriptionEvent.findMany({ where: { businessId: o.businessId, eventType: { in: ['ACTIVATED', 'RENEWED'] } } });
    expect(events).toHaveLength(1);
  });

  it('an amount that differs from the order is never activated; failures are recorded', async () => {
    const o = await registerOwner(app);
    const co = (await o.agent.post('/api/v1/billing/checkout').set(H).send({ planCode: 'BUSINESS' })).body.data;
    expect((await signed(webhookBody('payment.captured', co.orderId, 100))).body.reason).toBe('amount_mismatch');
    expect((await prisma.subscription.findUniqueOrThrow({ where: { businessId: o.businessId } })).status).toBe('TRIALING');

    await signed(webhookBody('payment.failed', co.orderId, 149900));
    const row = await prisma.billingPayment.findFirstOrThrow({ where: { gatewayOrderId: co.orderId } });
    expect(row.status).toBe('FAILED');
    expect(row.failureReason).toBe('Card declined');
    expect((await signed(webhookBody('payment.captured', 'order_unknown', 100))).body.reason).toBe('unknown_order');
  });
});
