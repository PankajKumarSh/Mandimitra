import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.ts';
import { createLogger } from '../config/logger.ts';
import { LedgerDriftCheck } from '../jobs/ledger-drift.ts';
import { JobQueue } from '../jobs/queue.ts';
import { SubscriptionSweep } from '../jobs/subscription-sweep.ts';
import { LocalDiskStore, S3Store } from '../services/storage.service.ts';
import { WhatsAppError, type TemplateMessage, type WhatsAppProvider } from '../services/whatsapp/provider.ts';
import { H, makeApp, registerOwner } from './helpers.ts';

const { app, prisma, env } = makeApp();
const logger = createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' });
const DAY = 86_400_000;

// ---------------------------------------------------------------------------------------------- admin

describe('Super Admin console', () => {
  let admin: Awaited<ReturnType<typeof registerOwner>>;
  let target: Awaited<ReturnType<typeof registerOwner>>;

  beforeAll(async () => {
    admin = await registerOwner(app, { businessName: 'Platform Ops' });
    await prisma.user.update({ where: { id: admin.userId }, data: { isPlatformAdmin: true } });
    target = await registerOwner(app, { businessName: `Gupta Traders ${randomUUID().slice(0, 6)}` });
  });

  it('is closed to everyone else', async () => {
    expect((await request(app).get('/api/v1/admin/overview')).status).toBe(401);
    expect((await target.agent.get('/api/v1/admin/overview')).status).toBe(403);
    expect((await target.agent.post(`/api/v1/admin/businesses/${target.businessId}/extend`).set(H).send({ days: 30, reason: 'self-serve' })).status).toBe(403);
  });

  it('overview and search show platform metadata, never ledgers', async () => {
    const ov = (await admin.agent.get('/api/v1/admin/overview')).body.data;
    expect(ov).toHaveProperty('mrr');
    expect(ov).toHaveProperty('revenueLast30Days');
    expect(ov.businesses.ACTIVE).toBeGreaterThanOrEqual(2);

    const name = (await prisma.business.findUniqueOrThrow({ where: { id: target.businessId } })).name;
    const list = await admin.agent.get('/api/v1/admin/businesses').query({ q: name });
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ id: target.businessId, subscription: { effectiveStatus: 'TRIALING' }, _count: { memberships: 1 } });
    const byMobile = await admin.agent.get('/api/v1/admin/businesses').query({ q: target.mobile.slice(-10) });
    expect(byMobile.body.data.map((b: { id: string }) => b.id)).toContain(target.businessId);

    const detail = (await admin.agent.get(`/api/v1/admin/businesses/${target.businessId}`)).body.data;
    expect(detail.owner.mobile).toBe(target.mobile);
    const keys = JSON.stringify(Object.keys(detail));
    for (const k of ['farmers', 'ledger', 'payments_mandi', 'sales']) expect(keys).not.toContain(`"${k}"`);
    // An admin still has no tenant access to the target's data.
    expect((await admin.agent.get('/api/v1/farmers').set('x-business', target.businessId)).body.data?.length ?? 0).toBe(0);
  });

  it('suspend blocks the business immediately; reactivate restores it; both audited', async () => {
    expect((await admin.agent.post(`/api/v1/admin/businesses/${target.businessId}/suspend`).set(H).send({ reason: 'x' })).status).toBe(400);
    const s = await admin.agent.post(`/api/v1/admin/businesses/${target.businessId}/suspend`).set(H).send({ reason: 'Chargeback dispute' });
    expect(s.body.data).toMatchObject({ status: 'SUSPENDED', suspendReason: 'Chargeback dispute' });
    const blocked = await target.agent.get('/api/v1/farmers');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('BUSINESS_SUSPENDED');

    await admin.agent.post(`/api/v1/admin/businesses/${target.businessId}/reactivate`).set(H).send({});
    expect((await target.agent.get('/api/v1/farmers')).status).toBe(200);
    const audit = await prisma.auditLog.findMany({ where: { businessId: target.businessId, entityType: 'Business', actorUserId: admin.userId } });
    expect(audit).toHaveLength(2);
  });

  it('extends an expired trial (support goodwill), with the reason recorded', async () => {
    await prisma.subscription.update({ where: { businessId: target.businessId }, data: { trialEndsAt: new Date(Date.now() - DAY) } });
    expect((await target.agent.patch('/api/v1/businesses/current/settings').set(H).send({ pattiFooterNote: 'a' })).status).toBe(402);
    const r = await admin.agent.post(`/api/v1/admin/businesses/${target.businessId}/extend`).set(H).send({ days: 10, reason: 'Onboarding delayed' });
    expect(r.body.data.subscription.effectiveStatus).toBe('TRIALING');
    expect(Math.abs(new Date(r.body.data.subscription.trialEndsAt).getTime() - (Date.now() + 10 * DAY))).toBeLessThan(60_000);
    expect((await target.agent.patch('/api/v1/businesses/current/settings').set(H).send({ pattiFooterNote: 'a' })).status).toBe(200);
    const ev = await prisma.subscriptionEvent.findFirstOrThrow({ where: { businessId: target.businessId, eventType: 'EXTENDED_BY_ADMIN' } });
    expect(ev.metadata).toMatchObject({ days: 10, reason: 'Onboarding delayed' });
  });

  it('revoking the flag takes effect on the next request, not at token expiry', async () => {
    const other = await registerOwner(app);
    await prisma.user.update({ where: { id: other.userId }, data: { isPlatformAdmin: true } });
    expect((await other.agent.get('/api/v1/admin/overview')).status).toBe(200);
    await prisma.user.update({ where: { id: other.userId }, data: { isPlatformAdmin: false } });
    expect((await other.agent.get('/api/v1/admin/overview')).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------- jobs

describe('nightly subscription sweep', () => {
  it('expires trials, lapses periods (applying scheduled downgrades), expires after grace, reminds once', async () => {
    const [trial, lapsing, cancelling, grace, remind] = await Promise.all([1, 2, 3, 4, 5].map(() => registerOwner(app)));
    const plans = Object.fromEntries((await prisma.subscriptionPlan.findMany()).map((p) => [p.code, p.id]));
    const now = new Date();
    await prisma.subscription.update({ where: { businessId: trial!.businessId }, data: { trialEndsAt: new Date(now.getTime() - 1000) } });
    await prisma.subscription.update({ where: { businessId: lapsing!.businessId }, data: { status: 'ACTIVE', planId: plans.BUSINESS!, pendingPlanId: plans.STARTER!, currentPeriodEnd: new Date(now.getTime() - 1000) } });
    await prisma.subscription.update({ where: { businessId: cancelling!.businessId }, data: { status: 'ACTIVE', cancelAtPeriodEnd: true, currentPeriodEnd: new Date(now.getTime() - 1000) } });
    await prisma.subscription.update({ where: { businessId: grace!.businessId }, data: { status: 'PAST_DUE', currentPeriodEnd: new Date(now.getTime() - 20 * DAY) } });
    await prisma.subscription.update({ where: { businessId: remind!.businessId }, data: { status: 'ACTIVE', currentPeriodEnd: new Date(now.getTime() + 3 * DAY - 60_000) } });

    const ids = [trial, lapsing, cancelling, grace, remind].map((o) => o!.businessId);
    const sweep = new SubscriptionSweep(prisma, env, logger);
    const counts = await sweep.run(now, { businessIds: ids });
    expect(counts).toEqual({ expiredTrials: 1, lapsed: 2, expired: 1, reminders: 1, downgradesApplied: 1 });

    const get = async (b: string) => prisma.subscription.findUniqueOrThrow({ where: { businessId: b }, include: { plan: true } });
    expect((await get(trial!.businessId)).status).toBe('EXPIRED');
    const l = await get(lapsing!.businessId);
    expect([l.status, l.plan.code, l.pendingPlanId]).toEqual(['PAST_DUE', 'STARTER', null]);
    expect((await get(cancelling!.businessId)).status).toBe('CANCELLED');
    expect((await get(grace!.businessId)).status).toBe('EXPIRED');

    const notes = await prisma.notification.findMany({ where: { businessId: remind!.businessId, type: 'SUBSCRIPTION_EXPIRING' } });
    expect(notes).toHaveLength(1);
    expect(notes[0]!.title).toContain('3 दिन');
    // Running again the same day sends nothing new.
    expect((await sweep.run(now, { businessIds: ids })).reminders).toBe(0);
    // The owner sees it in the bell.
    expect((await remind!.agent.get('/api/v1/notifications')).body.data[0].link).toBe('/billing');
  });
});

describe('ledger drift check', () => {
  it('passes on real postings and reports a tampered cached balance', async () => {
    const o = await registerOwner(app);
    const f = (await o.agent.post('/api/v1/farmers').set(H).send({ name: 'Drift Test', village: 'X', openingBalance: '1200.50' })).body.data;
    const b = (await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'Drift Buyer', openingBalance: '300' })).body.data;
    const check = new LedgerDriftCheck(prisma, logger);
    const mine = (r: Awaited<ReturnType<LedgerDriftCheck['run']>>) => [...r.farmers, ...r.buyers].filter((x) => x.businessId === o.businessId);
    expect(mine(await check.run())).toEqual([]);

    // Tamper inside a transaction that is rolled back: other test files (which check global ledger
    // consistency) never see the corrupted rows.
    let drift: Awaited<ReturnType<LedgerDriftCheck['run']>> | undefined;
    await prisma
      .$transaction(async (tx) => {
        await tx.farmer.update({ where: { id: f.id }, data: { currentBalance: '1300.50' } });
        await tx.buyer.update({ where: { id: b.id }, data: { currentBalance: '0' } });
        drift = await new LedgerDriftCheck(tx, logger).run();
        throw new Error('rollback');
      })
      .catch((e: Error) => {
        if (e.message !== 'rollback') throw e;
      });
    const found = mine(drift!);
    expect(found).toHaveLength(2);
    expect(found.find((d) => d.partyId === f.id)).toMatchObject({ cached: '1300.50', ledger: '1200.50' });
    expect(mine(await check.run())).toEqual([]);
  });
});

describe('WhatsApp temporary failures are retried from the queue', () => {
  class FlakyProvider implements WhatsAppProvider {
    readonly name = 'cloud' as const;
    failures: string[] = [];
    sent: TemplateMessage[] = [];
    async uploadMedia() {
      return 'media-1';
    }
    async sendTemplate(m: TemplateMessage) {
      const code = this.failures.shift();
      if (code) throw new WhatsAppError(`fail ${code}`, code);
      this.sent.push(m);
      return { providerMessageId: `wamid.${randomUUID()}` };
    }
  }
  const flaky = new FlakyProvider();
  const t = makeApp({}, { whatsapp: flaky });
  const queued: string[] = [];
  t.services.whatsapp.setRetryQueue(async (id) => {
    queued.push(id);
  });
  let agent: Awaited<ReturnType<typeof registerOwner>>['agent'];
  let buyerId: string;

  beforeAll(async () => {
    const o = await registerOwner(t.app);
    agent = o.agent;
    buyerId = (await agent.post('/api/v1/buyers').set(H).send({ firmName: 'Retry Mills', mobile: '9812377001', openingBalance: '5000', whatsappConsent: 'OPTED_IN' })).body.data.id;
  });
  const send = () => agent.post('/api/v1/notifications/whatsapp/send').set(H).set('Idempotency-Key', randomUUID()).send({ kind: 'REMINDER', buyerId });

  it('a 5xx is accepted as QUEUED (202), then the retry sends the same stored message', async () => {
    flaky.failures.push('503');
    const r = await send();
    expect(r.status, JSON.stringify(r.body)).toBe(202);
    expect(r.body.data.status).toBe('QUEUED');
    expect(queued).toContain(r.body.data.id);

    flaky.failures.push('131000'); // still failing on the first retry → throws so pg-boss retries
    await expect(t.services.whatsapp.retry(r.body.data.id, false)).rejects.toThrow();
    expect(await t.services.whatsapp.retry(r.body.data.id, false)).toEqual({ sent: true });
    const msg = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: r.body.data.id } });
    expect([msg.status, msg.errorCode]).toEqual(['SENT', null]);
    expect(flaky.sent.at(-1)!.bodyParams).toEqual(msg.variables);
    expect(await t.services.whatsapp.retry(r.body.data.id, false)).toEqual({ skipped: true }); // never sent twice
  });

  it('a permanent error fails at once; the last retry marks FAILED', async () => {
    flaky.failures.push('131026'); // undeliverable — not transient
    const r = await send();
    expect(r.status).toBe(502);
    flaky.failures.push('503');
    const q = await send();
    flaky.failures.push('503');
    expect(await t.services.whatsapp.retry(q.body.data.id, true)).toEqual({ failed: true });
    expect((await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: q.body.data.id } })).status).toBe('FAILED');
  });
});

describe('pg-boss queue (real, against the test database)', () => {
  const queue = new JobQueue(env, logger);
  const seen: { id: string; final: boolean }[] = [];
  afterAll(() => queue.stop());

  it('delivers an enqueued retry job to the worker', async () => {
    await queue.start({ subscriptionSweep: async () => null, ledgerDrift: async () => null, whatsappRetry: async (id, final) => seen.push({ id, final }) });
    const id = randomUUID();
    await queue.enqueueWhatsAppRetry(id);
    // startAfter is 30 s in production use; force it due now for the test.
    await prisma.$executeRawUnsafe(`UPDATE pgboss.job SET start_after = now() WHERE data->>'messageId' = $1`, id);
    for (let i = 0; i < 40 && !seen.some((s) => s.id === id); i++) await new Promise((r) => setTimeout(r, 500));
    expect(seen.find((s) => s.id === id)).toEqual({ id, final: false });
  }, 40_000);
});

// ---------------------------------------------------------------------------------------------- storage

describe('S3-compatible storage', () => {
  const objects = new Map<string, Buffer>();
  const requests: { method: string; url: string; auth: string; sse?: string }[] = [];
  const server = createServer((req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method!, url: req.url!, auth: String(req.headers.authorization ?? ''), sse: req.headers['x-amz-server-side-encryption'] as string | undefined });
      const key = decodeURIComponent(req.url!.split('?')[0]!);
      if (req.method === 'PUT') {
        objects.set(key, Buffer.concat(chunks));
        res.writeHead(200, { etag: '"x"' }).end();
      } else if (req.method === 'GET' && objects.has(key)) {
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': objects.get(key)!.length }).end(objects.get(key));
      } else {
        res.writeHead(404, { 'content-type': 'application/xml' }).end('<Error><Code>NoSuchKey</Code></Error>');
      }
    });
  });
  let store: S3Store;
  beforeAll(async () => {
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    store = new S3Store({ bucket: 'mm-test', region: 'ap-south-1', accessKeyId: 'AKIATEST', secretAccessKey: 'secret', endpoint: `http://127.0.0.1:${port}`, forcePathStyle: true });
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('round-trips bytes with SigV4-signed requests to a path-style bucket', async () => {
    const key = `biz/patti_pdf/${randomUUID()}.pdf`;
    const data = Buffer.from('%PDF-1.7 हिंदी ✓');
    await store.put(key, data);
    expect((await store.get(key)).equals(data)).toBe(true);
    const put = requests.find((r) => r.method === 'PUT')!;
    expect(put.url.startsWith(`/mm-test/${key}`)).toBe(true);
    expect(put.auth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIATEST\/\d{8}\/ap-south-1\/s3\/aws4_request/);
    expect(put.sse).toBeUndefined(); // SSE header only for AWS itself
    await expect(store.get('missing/key')).rejects.toThrow();
  });

  it('local disk store refuses keys that escape its folder', async () => {
    const s = new LocalDiskStore(mkdtempSync(path.join(os.tmpdir(), 'mm-store-')));
    await expect(s.put('../../evil.txt', Buffer.from('x'))).rejects.toThrow('Invalid storage key');
  });
});

// ---------------------------------------------------------------------------------------------- config

describe('production configuration guards', () => {
  const prod = {
    ...process.env,
    NODE_ENV: 'production',
    APP_URL: 'https://app.mandimitra.in',
    WHATSAPP_PROVIDER: 'disabled',
    BILLING_PROVIDER: 'razorpay',
    RAZORPAY_KEY_ID: 'rzp_live_x',
    RAZORPAY_KEY_SECRET: 's',
    RAZORPAY_WEBHOOK_SECRET: 'w',
  };
  it('accepts a complete production config', () => {
    expect(loadEnv(prod).isProd).toBe(true);
  });
  it.each([
    [{ WHATSAPP_PROVIDER: 'mock' }, /WHATSAPP_PROVIDER=mock/],
    [{ BILLING_PROVIDER: 'mock' }, /BILLING_PROVIDER=mock/],
    [{ RAZORPAY_WEBHOOK_SECRET: '' }, /requires RAZORPAY_WEBHOOK_SECRET/],
    [{ APP_URL: 'http://app.mandimitra.in' }, /https/],
    [{ STORAGE_DRIVER: 's3' }, /requires S3_BUCKET/],
    [{ JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' }, /placeholder/],
  ])('refuses %o', (override, msg) => {
    expect(() => loadEnv({ ...prod, ...override })).toThrow(msg);
  });

  it('WhatsApp "disabled" refuses sends with a clear 503 instead of pretending', async () => {
    const d = makeApp({ WHATSAPP_PROVIDER: 'disabled' });
    const o = await registerOwner(d.app);
    const r = await o.agent.post('/api/v1/notifications/whatsapp/send').set(H).set('Idempotency-Key', randomUUID()).send({ kind: 'REMINDER', buyerId: randomUUID() });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('WHATSAPP_NOT_CONFIGURED');
  });

  it('the test-checkout route does not exist with a real gateway', async () => {
    const real = makeApp({ BILLING_PROVIDER: 'razorpay', RAZORPAY_KEY_ID: 'k', RAZORPAY_KEY_SECRET: 's', RAZORPAY_WEBHOOK_SECRET: 'w' });
    const o = await registerOwner(real.app);
    expect((await o.agent.post('/api/v1/billing/mock/complete').set(H).send({ orderId: 'order_1' })).status).toBe(404);
  });
});
