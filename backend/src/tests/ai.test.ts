import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { MockWhatsAppProvider } from '../services/whatsapp/provider.ts';
import { istDateString } from '../services/ledger.service.ts';
import { toolsFor } from '../services/ai/tools.ts';
import { H, addStaff, makeApp, registerOwner, type Agent } from './helpers.ts';
import { ScriptedLlm, lastToolResults, text, toolCall } from './scripted-llm.ts';

const llm = new ScriptedLlm();
const SECRET = 'test-app-secret';
const { app, prisma, pdf, whatsapp } = makeApp(
  { WHATSAPP_APP_SECRET: SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verify-me' },
  { llm },
);
const mock = whatsapp as MockWhatsAppProvider;
const today = istDateString();
const post = (agent: Agent, url: string, body: unknown) => agent.post(url).set(H).set('Idempotency-Key', randomUUID()).send(body as object);

let owner: Awaited<ReturnType<typeof registerOwner>>;
let other: Awaited<ReturnType<typeof registerOwner>>;
let ramId: string;
let buyerId: string;
let wheatId: string;

beforeAll(async () => {
  owner = await registerOwner(app, { businessName: 'Shri Ram Traders' });
  other = await registerOwner(app, { businessName: 'Other Firm' });
  const a = owner.agent;
  wheatId = (await a.get('/api/v1/commodities')).body.data.find((c: { name: string }) => c.name === 'Wheat').id;
  ramId = (await a.post('/api/v1/farmers').set(H).send({ name: 'Ram Kumar', nameHindi: 'राम कुमार', village: 'Gharaunda', mobile: '9812300011', openingBalance: '42100' })).body.data.id;
  buyerId = (await a.post('/api/v1/buyers').set(H).send({ firmName: 'Bansal Rice Mills', ownerName: 'Ashok Bansal', mobile: '9812300022', openingBalance: '185000' })).body.data.id;
  // Same name in ANOTHER business, different balance — must never surface.
  await other.agent.post('/api/v1/farmers').set(H).send({ name: 'Ram Kumar', village: 'Elsewhere', openingBalance: '999999' });
});

beforeEach(() => {
  llm.calls.length = 0;
});

describe('assistant: question answering with read-only tools', () => {
  it('"Ram Kumar ka balance kitna hai?" — searches, reads the account, answers; request is well-formed', async () => {
    let farmerFromTool = '';
    llm.script(
      toolCall('search_farmers', { query: 'Ram Kumar' }, 'toolu_1'),
      (params) => {
        const [r] = lastToolResults(params);
        const rows = r!.data as { id: string; name: string; village: string; currentBalance: string }[];
        expect(rows).toHaveLength(1); // the other business's Ram Kumar is invisible
        expect(rows[0]).toMatchObject({ name: 'Ram Kumar', village: 'Gharaunda', currentBalance: '42100.00' });
        farmerFromTool = rows[0]!.id;
        return toolCall('party_account', { party_type: 'farmer', id: rows[0]!.id }, 'toolu_2')(params);
      },
      (params) => {
        const [r] = lastToolResults(params);
        expect(r!.data).toMatchObject({ currentBalance: '42100.00', unbilledPurchases: '0.00' });
        return text('राम कुमार (घरौंडा) को ₹42,100.00 देना है।')(params);
      },
    );
    const res = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: 'Ram Kumar ka balance kitna hai?' });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.data).toMatchObject({ answer: 'राम कुमार (घरौंडा) को ₹42,100.00 देना है।', tools: ['search_farmers', 'party_account'] });
    expect(farmerFromTool).toBe(ramId);

    const req = llm.calls[0]!;
    expect(req.model).toBe('claude-opus-5-5');
    expect((req as unknown as { fallbacks: string }).fallbacks).toBe('default');
    expect(req.betas).toContain('server-side-fallback-2026-07-01');
    expect(req.output_config).toMatchObject({ effort: 'medium' });
    expect(req.thinking).toBeUndefined(); // Opus 5.5: thinking is always on; never send "disabled"
    expect(req.tool_choice).toBeUndefined(); // forced tool_choice is a 400 on Opus 5.5
    expect(String(req.system)).toContain('Shri Ram Traders');
    expect(String((req.messages[0]!.content as string))).toContain(`[आज / today: ${today}]`);
    // every tool is strict and read-only by name
    const names = (req.tools ?? []).map((t) => (t as { name: string; strict: boolean }).name);
    expect(names).toEqual(['business_summary', 'calculate_amount', 'farmers_to_pay', 'party_account', 'pending_buyer_payments', 'sales_by_commodity', 'search_buyers', 'search_farmers']);
    expect((req.tools ?? []).every((t) => (t as { strict: boolean }).strict === true)).toBe(true);
    expect(names.some((n) => /create|update|delete|cancel|record|pay/i.test(n.replace('pending_buyer_payments', '').replace('farmers_to_pay', '')))).toBe(false);
  });

  it('cannot read another business’s farmer even with its id', async () => {
    const foreign = await prisma.farmer.findFirstOrThrow({ where: { businessId: other.businessId } });
    llm.script(toolCall('party_account', { party_type: 'farmer', id: foreign.id }), (params) => {
      const [r] = lastToolResults(params);
      expect(r).toMatchObject({ isError: true, data: { error: 'Not found in this business' } });
      return text('नहीं मिला')(params);
    });
    const res = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: 'show account' });
    expect(res.status).toBe(200);
  });

  it('a hallucinated write tool is refused (there is none to call)', async () => {
    llm.script(toolCall('create_sale', { buyer: 'x', amount: '1000' }), (params) => {
      const [r] = lastToolResults(params);
      expect(r).toMatchObject({ isError: true });
      return text('I can only read data.')(params);
    });
    const before = await prisma.sale.count({ where: { businessId: owner.businessId } });
    await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: 'sell 10 qtl to bansal' });
    expect(await prisma.sale.count({ where: { businessId: owner.businessId } })).toBe(before);
  });

  it('"50 quintal gehun ka 2500 rate se total" uses the backend engine', async () => {
    llm.script(toolCall('calculate_amount', { quantity: '50', unit: 'QUINTAL', rate: '2500', rate_unit: 'QUINTAL' }), (params) => {
      expect(lastToolResults(params)[0]!.data).toEqual({ weightKg: '5000.000', amount: '125000.00' });
      return text('₹1,25,000.00')(params);
    });
    const res = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: '50 quintal gehun ka 2500 rate se total batao' });
    expect(res.body.data.answer).toBe('₹1,25,000.00');
  });

  it('replays earlier turns unchanged (append-only history, thinking blocks intact)', async () => {
    llm.script(toolCall('search_buyers', { query: 'Bansal' }, 'toolu_b1'), text('Bansal owes ₹1,85,000.00'));
    const first = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: 'Bansal ka baki?' });
    const conversationId = first.body.data.conversationId;
    const firstTurn = [...llm.calls.at(-1)!.messages];

    llm.script(text('हाँ'));
    await owner.agent.post('/api/v1/ai/ask').set(H).send({ conversationId, text: 'aur kuch?' });
    const second = llm.calls.at(-1)!.messages;
    // Prefix of the new request == everything sent/received before, byte-for-byte.
    expect(second.slice(0, firstTurn.length)).toEqual(firstTurn);
    const replayedAssistant = second[1] as { role: string; content: { type: string; signature?: string }[] };
    expect(replayedAssistant.role).toBe('assistant');
    expect(replayedAssistant.content[0]).toMatchObject({ type: 'thinking', signature: 'sig-toolu_b1' });
    expect(second.at(-2)).toMatchObject({ role: 'assistant' }); // final answer of turn 1 kept
    const conv = await owner.agent.get(`/api/v1/ai/conversations/${conversationId}`);
    expect(conv.body.data.messages.map((m: { role: string }) => m.role)).toEqual(['USER', 'ASSISTANT', 'USER', 'ASSISTANT']);
  });

  it('stops a runaway tool loop at the round cap', async () => {
    for (let i = 0; i < 6; i++) llm.script(toolCall('search_farmers', { query: `x${i}` }));
    const res = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: 'loop' });
    expect(res.status).toBe(200);
    expect(llm.calls).toHaveLength(6);
    expect(res.body.data.stopReason).toBe('tool_use');
    expect(res.body.data.answer).toMatch(/smaller parts/);
  });

  it('handles a refusal gracefully', async () => {
    llm.script(() => ({ stop_reason: 'refusal', content: [] as never }));
    const res = await owner.agent.post('/api/v1/ai/ask').set(H).send({ text: '...' });
    expect(res.body.data.answer).toContain('Sorry');
  });

  it('offers only the tools the caller may use', async () => {
    const tenant = { permissions: new Set(['ai:query', 'farmer:read']) } as never;
    expect(toolsFor(tenant).map((d) => d.tool.name)).toEqual(['calculate_amount', 'search_farmers']);
  });
});

describe('assistant: plan, quota and configuration', () => {
  it('enforces the monthly AI quota and plan feature', async () => {
    const o = await registerOwner(app);
    const plan = await prisma.subscriptionPlan.upsert({
      where: { code: 'TEST_AI_2' },
      create: { code: 'TEST_AI_2', name: 'AI2', priceMonthly: '1', aiEnabled: true, maxMonthlyAiQueries: 2, isActive: false },
      update: {},
    });
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { planId: plan.id } });
    llm.script(text('1'), text('2'));
    expect((await o.agent.post('/api/v1/ai/ask').set(H).send({ text: 'q1' })).status).toBe(200);
    expect((await o.agent.post('/api/v1/ai/ask').set(H).send({ text: 'q2' })).status).toBe(200);
    const third = await o.agent.post('/api/v1/ai/ask').set(H).send({ text: 'q3' });
    expect(third.status).toBe(402);
    expect(third.body.error.details).toMatchObject({ resource: 'ai', limit: 2, used: 2 });
    expect((await o.agent.get('/api/v1/ai/usage')).body.data).toMatchObject({ limit: 2, used: 2, enabled: true });

    const starter = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'STARTER' } });
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { planId: starter.id } });
    expect((await o.agent.post('/api/v1/ai/ask').set(H).send({ text: 'q' })).body.error.details).toMatchObject({ resource: 'ai' });
  });

  it('returns 503 when no AI provider is configured', async () => {
    const { app: noAi } = makeApp({ AI_PROVIDER: 'disabled' });
    const o = await registerOwner(noAi);
    const r = await o.agent.post('/api/v1/ai/ask').set(H).send({ text: 'hi' });
    expect(r.status).toBe(503);
    expect(r.body.error.code).toBe('AI_NOT_CONFIGURED');
  });

  it('viewer may ask but not create drafts or reminders', async () => {
    const viewer = await addStaff(app, owner.agent, 'VIEWER');
    llm.script(text('ok'));
    expect((await viewer.agent.post('/api/v1/ai/ask').set(H).send({ text: 'hi' })).status).toBe(200);
    expect((await viewer.agent.post('/api/v1/ai/extract').set(H).send({ text: 'x', source: 'TEXT' })).status).toBe(403);
    expect((await viewer.agent.post('/api/v1/ai/reminder').set(H).send({ buyerId })).status).toBe(403);
  });
});

const extraction = (over: Record<string, unknown> = {}) =>
  text(
    JSON.stringify({
      kind: 'SALE', farmer_name: 'Ram Kumar', buyer_name: 'Bansal', commodity: 'Wheat', quantity: '40', quantity_unit: 'QUINTAL', bags: '80', rate: '2450', rate_unit: 'QUINTAL', amount: '',
      payment_direction: '', payment_purpose: '', payment_mode: '', reference: '', expense_category: '', date: '', vehicle_number: '', notes: '', confidence: 'high', unclear: [],
      ...over,
    }),
  );

describe('drafts: voice / text / photo → human-confirmed entry', () => {
  let lotId: string;
  beforeAll(async () => {
    lotId = (await post(owner.agent, '/api/v1/lots', { farmerId: ramId, commodityId: wheatId, arrivalDate: today, weightUnit: 'QUINTAL', grossWeight: '60', bags: 120 })).body.data.id;
  });

  it('extracts a SALE draft, resolves names to ids, and writes NOTHING financial', async () => {
    llm.script(extraction());
    const salesBefore = await prisma.sale.count({ where: { businessId: owner.businessId } });
    const ledgerBefore = await prisma.buyerLedgerEntry.count({ where: { businessId: owner.businessId } });
    const r = await owner.agent.post('/api/v1/ai/extract').set(H).send({ text: 'राम कुमार का 40 क्विंटल गेहूं बंसल को 2450 के भाव', source: 'VOICE' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'PENDING', type: 'SALE', fields: { farmerId: ramId, buyerId, commodityId: wheatId, lotId, quantity: '40', rate: '2450' } });
    expect(await prisma.sale.count({ where: { businessId: owner.businessId } })).toBe(salesBefore);
    expect(await prisma.buyerLedgerEntry.count({ where: { businessId: owner.businessId } })).toBe(ledgerBefore);

    const req = llm.calls[0]!;
    expect(req.output_config).toMatchObject({ format: { type: 'json_schema' } });
    expect((req as unknown as { fallbacks: string }).fallbacks).toBe('default');
    expect(req.tools).toBeUndefined();

    // Human saves via the normal endpoint, then links the draft.
    const sale = await post(owner.agent, '/api/v1/sales', { lotId, buyerId, saleDate: today, weight: '40', bags: 80, rate: '2450' });
    const c = await owner.agent.post(`/api/v1/ai/drafts/${r.body.data.id}/confirm`).set(H).send({ entityType: 'Sale', entityId: sale.body.data.id });
    expect(c.body.data).toMatchObject({ status: 'CONFIRMED', confirmedEntityType: 'Sale' });
    expect((await owner.agent.post(`/api/v1/ai/drafts/${r.body.data.id}/confirm`).set(H).send({ entityType: 'Sale', entityId: sale.body.data.id })).status).toBe(422);
  });

  it('ambiguous names become candidates; invalid numbers are dropped; unknown names warned', async () => {
    await owner.agent.post('/api/v1/farmers').set(H).send({ name: 'Ram Kumar Saini', village: 'Indri' });
    llm.script(extraction({ quantity: '4O', buyer_name: 'Nobody Traders' }));
    const r = await owner.agent.post('/api/v1/ai/extract').set(H).send({ text: 'ram kumar ...', source: 'TEXT' });
    expect(r.body.data.fields).toMatchObject({ farmerId: null, buyerId: null, quantity: '' });
    expect(r.body.data.candidates.farmers).toHaveLength(2);
    expect(r.body.data.warnings).toContain('Buyer "Nobody Traders" not found');
  });

  it('cannot link a draft to another user’s or another business’s record', async () => {
    llm.script(extraction({ kind: 'PAYMENT' }));
    const d = await owner.agent.post('/api/v1/ai/extract').set(H).send({ text: 'x', source: 'TEXT' });
    const foreignSale = await prisma.sale.findFirst({ where: { businessId: { not: owner.businessId } } });
    const r = await owner.agent.post(`/api/v1/ai/drafts/${d.body.data.id}/confirm`).set(H).send({ entityType: 'Sale', entityId: foreignSale?.id ?? randomUUID() });
    expect(r.status).toBe(404);
    expect((await other.agent.get(`/api/v1/ai/drafts/${d.body.data.id}`)).status).toBe(404);
  });

  it('accepts a photo: stores it and sends it as an image block', async () => {
    // 1×1 PNG
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    llm.script(extraction({ kind: 'LOT', buyer_name: '' }));
    const r = await owner.agent.post('/api/v1/ai/extract').set(H).send({ imageBase64: png, imageMediaType: 'image/png', source: 'IMAGE' });
    expect(r.status).toBe(201);
    const content = llm.calls[0]!.messages[0]!.content as { type: string }[];
    expect(content[0]).toMatchObject({ type: 'image' });
    const draft = await prisma.aiDraft.findUniqueOrThrow({ where: { id: r.body.data.id } });
    const att = await prisma.attachment.findUniqueOrThrow({ where: { id: (draft.payload as { attachmentId: string }).attachmentId } });
    expect(att).toMatchObject({ purpose: 'AI_UPLOAD', mimeType: 'image/png', businessId: owner.businessId });
  });

  it('unreadable output → 422, no draft', async () => {
    llm.script(text('sorry I cannot'));
    const r = await owner.agent.post('/api/v1/ai/extract').set(H).send({ text: '???', source: 'TEXT' });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('AI_COULD_NOT_READ');
  });
});

describe('payment reminder drafting', () => {
  it('uses AI text only if the exact backend amount survives', async () => {
    // Earlier tests in this file add sales to this buyer, so derive the expected amount from the ledger.
    const bal = (await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } })).currentBalance.toFixed(2);
    const [i, f] = bal.split('.');
    const amount = `₹${i!.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i!.slice(-3)}.${f}`;

    llm.script(text(`नमस्ते अशोक जी 🙏 आपकी बकाया राशि ${amount} है, कृपया भुगतान करें।`));
    const ok = await owner.agent.post('/api/v1/ai/reminder').set(H).send({ buyerId });
    expect(ok.body.data).toMatchObject({ source: 'ai', amount });

    llm.script(text('नमस्ते, आपकी बकाया राशि ₹1,58,000 है।')); // model altered the amount
    const fb = await owner.agent.post('/api/v1/ai/reminder').set(H).send({ buyerId });
    expect(fb.body.data.source).toBe('template');
    expect(fb.body.data.text).toContain(amount);
  });
});

describe('WhatsApp (mock provider)', () => {
  it('requires consent, then sends the patti as a template with the PDF', async () => {
    const lot = (await post(owner.agent, '/api/v1/lots', { farmerId: ramId, commodityId: wheatId, arrivalDate: today, weightUnit: 'QUINTAL', grossWeight: '10', bags: 0 })).body.data.id;
    await post(owner.agent, '/api/v1/sales', { lotId: lot, buyerId, saleDate: today, weight: '10', rate: '2500' });
    const patti = (await post(owner.agent, '/api/v1/patti', { farmerId: ramId, pattiDate: today })).body.data;

    const blocked = await post(owner.agent, '/api/v1/notifications/whatsapp/send', { kind: 'PATTI', entityId: patti.id });
    expect(blocked.status).toBe(422);
    expect(blocked.body.error.code).toBe('WHATSAPP_CONSENT_REQUIRED');

    await owner.agent.patch(`/api/v1/farmers/${ramId}`).set(H).send({ whatsappConsent: 'OPTED_IN' });
    if (!pdf.available) return; // PDF needs a browser on this host
    const sent = await post(owner.agent, '/api/v1/notifications/whatsapp/send', { kind: 'PATTI', entityId: patti.id });
    expect(sent.status, JSON.stringify(sent.body)).toBe(201);
    expect(sent.body.data).toMatchObject({ status: 'DELIVERED', templateName: 'patti_ready_hi', provider: 'mock' });
    const m = mock.sent.at(-1)!;
    expect(m.to).toBe('919812300011');
    expect(m.bodyParams[0]).toBe('राम कुमार');
    expect(m.bodyParams[2]).toBe(patti.pattiNumber);
    expect(m.bodyParams[3]).toMatch(/^₹[\d,]+\.\d{2}$/);
    expect(m.document?.filename).toMatch(/\.pdf$/);
  }, 60_000);

  it('reminders need buyer consent and an outstanding balance; requires an idempotency key', async () => {
    expect((await owner.agent.post('/api/v1/notifications/whatsapp/send').set(H).send({ kind: 'REMINDER', buyerId })).status).toBe(400);
    expect((await post(owner.agent, '/api/v1/notifications/whatsapp/send', { kind: 'REMINDER', buyerId })).body.error.code).toBe('WHATSAPP_CONSENT_REQUIRED');
    await owner.agent.patch(`/api/v1/buyers/${buyerId}`).set(H).send({ whatsappConsent: 'OPTED_IN' });
    const r = await post(owner.agent, '/api/v1/notifications/whatsapp/send', { kind: 'REMINDER', buyerId });
    expect(r.status).toBe(201);
    expect(mock.sent.at(-1)!.template).toBe('payment_reminder_hi');
    expect(mock.sent.at(-1)!.document).toBeUndefined(); // reminders carry no attachment
  });

  it('plans without WhatsApp are refused', async () => {
    const o = await registerOwner(app);
    const starter = await prisma.subscriptionPlan.findUniqueOrThrow({ where: { code: 'STARTER' } });
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { planId: starter.id } });
    const b = (await o.agent.post('/api/v1/buyers').set(H).send({ firmName: 'X', mobile: '9812300099', openingBalance: '10', whatsappConsent: 'OPTED_IN' })).body.data.id;
    const r = await post(o.agent, '/api/v1/notifications/whatsapp/send', { kind: 'REMINDER', buyerId: b });
    expect(r.status).toBe(402);
  });
});

describe('WhatsApp webhook', () => {
  const sign = (body: string) => `sha256=${createHmac('sha256', SECRET).update(body).digest('hex')}`;
  const hook = (payload: object, signature?: string) => {
    const body = JSON.stringify(payload);
    return request(app).post('/api/v1/webhooks/whatsapp').set('content-type', 'application/json').set('x-hub-signature-256', signature ?? sign(body)).send(body);
  };

  it('verification handshake', async () => {
    const ok = await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=12345');
    expect([ok.status, ok.text]).toEqual([200, '12345']);
    expect((await request(app).get('/api/v1/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=1')).status).toBe(403);
  });

  it('rejects unsigned or tampered payloads', async () => {
    expect((await hook({ entry: [] }, 'sha256=deadbeef')).status).toBe(401);
  });

  it('applies status updates forward-only and idempotently; STOP opts the party out', async () => {
    const msg = await prisma.whatsAppMessage.findFirstOrThrow({ where: { businessId: owner.businessId, templateName: 'payment_reminder_hi' } });
    const pmid = msg.providerMessageId!;
    await prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: 'SENT', deliveredAt: null } });
    const status = (s: string, ts: number) => ({ entry: [{ changes: [{ value: { statuses: [{ id: pmid, status: s, timestamp: String(ts) }] } }] }] });

    await hook(status('read', 1_800_000_100));
    await hook(status('delivered', 1_800_000_050)); // arrives late — must not move status backwards
    const after = await prisma.whatsAppMessage.findUniqueOrThrow({ where: { id: msg.id } });
    expect(after.status).toBe('READ');
    const dup = await hook(status('read', 1_800_000_100));
    expect(dup.body.processed).toBe(0);

    const stop = { entry: [{ changes: [{ value: { messages: [{ id: `wamid.in.${randomUUID()}`, from: '919812300022', type: 'text', text: { body: 'stop' } }] } }] }] };
    expect((await hook(stop)).body.processed).toBe(1);
    expect((await prisma.buyer.findUniqueOrThrow({ where: { id: buyerId } })).whatsappConsent).toBe('OPTED_OUT');
  });
});

describe('in-app notifications', () => {
  it('approval requests notify the owner; read-all clears; users only see their own', async () => {
    const munim = await addStaff(app, owner.agent, 'MUNIM');
    const lot = (await post(munim.agent, '/api/v1/lots', { farmerId: ramId, commodityId: wheatId, arrivalDate: today, grossWeight: '100' })).body.data.id;
    await post(munim.agent, `/api/v1/lots/${lot}/cancel`, { reason: 'Duplicate entry' });
    const list = await owner.agent.get('/api/v1/notifications?unread=true');
    expect(list.body.meta.unread).toBeGreaterThanOrEqual(1);
    expect(list.body.data[0]).toMatchObject({ type: 'APPROVAL_PENDING' });
    expect((await munim.agent.get('/api/v1/notifications')).body.meta.unread).toBe(0);
    await owner.agent.post('/api/v1/notifications/read-all').set(H);
    expect((await owner.agent.get('/api/v1/notifications?unread=true')).body.meta.unread).toBe(0);
  });
});
