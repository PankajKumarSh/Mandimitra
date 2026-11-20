import type {
  BetaContentBlock,
  BetaContentBlockParam,
  BetaMessageParam,
  BetaToolResultBlockParam,
  BetaToolUseBlock,
} from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Prisma, type AiDraftType, type PrismaClient } from '@mandimitra/database';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../config/logger.ts';
import type { TenantContext } from '../../middleware/tenant.ts';
import { AppError, Errors } from '../../utils/errors.ts';
import type { RequestContext } from '../../utils/http.ts';
import { writeAudit } from '../audit.service.ts';
import { istDateString } from '../ledger.service.ts';
import type { StorageService } from '../storage.service.ts';
import { FALLBACK, type BetaMessage, type LlmClient } from './llm.ts';
import { runTool, toolsFor, type ToolDeps } from './tools.ts';

const MAX_TURNS_PER_CONVERSATION = 40;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const SYSTEM = (businessName: string) => `You are "MandiMitra Assistant" (मंडीमित्र सहायक), the assistant inside the accounting software of an Indian mandi commission agent (आढ़ती) firm named "${businessName}".

Language: reply in the language the user wrote in. Devanagari Hindi → reply in Hindi (Devanagari). Hinglish in Roman script → reply in simple Hinglish. English → English. Keep replies short and practical; a munim is reading on a phone.

Facts and numbers:
- Use the tools for every figure. Never estimate or compute money yourself; for any multiplication of quantity and rate call calculate_amount. Quote amounts exactly as tools return them, formatted in the Indian style (₹1,25,000.50).
- Farmer balance > 0 means the firm owes the farmer (देना है); < 0 means the farmer holds an advance (अग्रिम). Buyer balance > 0 means the buyer owes the firm (लेना है).
- Gross sales are the value of farmers' produce, not the firm's profit. Never call any figure "profit"; the closest figure is "commission income minus expenses".
- Each user message starts with today's date in IST. Resolve "aaj/today", "kal/yesterday", "is mahine/this month" against it; "kal" usually means yesterday when asking about past figures.
- If a name matches several people, list them briefly (code, village) and ask which one. If nothing matches, say so.

Limits: you can only read. You cannot create, change or cancel sales, payments, pattis or any record, and you must not claim to have done so. If the user asks to record something, tell them to use the 🎤 draft button or the entry screens — a draft is filled for them to check and save.`;

const EXTRACT_SYSTEM = `You read Indian mandi transactions — spoken Hindi/Hinglish/English text, or a photo of a handwritten/printed patti, parchi or bill — and fill a draft for a human to check. Do not guess: leave a field "" when it is not stated or not legible, and list anything ambiguous in "unclear".
Rules:
- kind: LOT = produce arrived from a farmer (weight/bags/vehicle); SALE = produce sold to a buyer at a rate; PAYMENT = money paid to a farmer or received from a buyer; EXPENSE = a business expense; UNKNOWN otherwise.
- Numbers as plain decimal strings without commas or ₹ ("2450", "40.5"). "quintal/kwintal/क्विंटल/qtl" → QUINTAL; "kilo/kg/किलो" → KG; "bori/बोरी/bag" → BAG; "ton/टन" → TON.
- commodity: canonical English name if recognisable (gehun/गेहूं → Wheat, dhan/धान → Paddy, chawal → Rice, sarson/सरसों → Mustard, makka/मक्का → Maize, aloo/आलू → Potato, pyaz/प्याज → Onion), else as written.
- Names exactly as written/spoken (keep Devanagari if given in Devanagari).
- date: YYYY-MM-DD only if a date is explicitly given; "" otherwise.`;

const S = { type: 'string' } as const;
const en = (...v: string[]) => ({ type: 'string', enum: v });
const EXTRACT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'kind', 'farmer_name', 'buyer_name', 'commodity', 'quantity', 'quantity_unit', 'bags', 'rate', 'rate_unit', 'amount',
    'payment_direction', 'payment_purpose', 'payment_mode', 'reference', 'expense_category', 'date', 'vehicle_number', 'notes', 'confidence', 'unclear',
  ],
  properties: {
    kind: en('LOT', 'SALE', 'PAYMENT', 'EXPENSE', 'UNKNOWN'),
    farmer_name: S,
    buyer_name: S,
    commodity: S,
    quantity: S,
    quantity_unit: en('KG', 'QUINTAL', 'TON', 'BAG', ''),
    bags: S,
    rate: S,
    rate_unit: en('KG', 'QUINTAL', 'TON', 'BAG', ''),
    amount: S,
    payment_direction: en('TO_FARMER', 'FROM_BUYER', ''),
    payment_purpose: en('ADVANCE', 'SETTLEMENT', 'COLLECTION', ''),
    payment_mode: en('CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE', ''),
    reference: S,
    expense_category: S,
    date: S,
    vehicle_number: S,
    notes: S,
    confidence: en('high', 'medium', 'low'),
    unclear: { type: 'array', items: S },
  },
} as const;

type Extracted = { [K in (typeof EXTRACT_SCHEMA.required)[number]]: K extends 'unclear' ? string[] : string };

export class AssistantService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly llm: LlmClient,
    private readonly deps: ToolDeps,
    private readonly storage: StorageService,
    private readonly logger: Logger,
  ) {}

  // ---------------------------------------------------------------- plan & quota

  private async checkQuota(t: TenantContext) {
    if (!this.llm.enabled) throw new AppError(503, 'AI_NOT_CONFIGURED');
    const sub = await this.prisma.subscription.findUnique({ where: { businessId: t.businessId }, select: { plan: { select: { aiEnabled: true, maxMonthlyAiQueries: true } } } });
    if (!sub?.plan.aiEnabled) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { resource: 'ai' });
    const used = await this.usedThisMonth(t.businessId);
    if (used >= sub.plan.maxMonthlyAiQueries) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { resource: 'ai', limit: sub.plan.maxMonthlyAiQueries, used });
  }

  private async usedThisMonth(businessId: string) {
    const start = new Date(`${istDateString().slice(0, 8)}01T00:00:00+05:30`);
    const [q, d] = await Promise.all([
      this.prisma.aiMessage.count({ where: { businessId, role: 'USER', createdAt: { gte: start } } }),
      this.prisma.aiDraft.count({ where: { businessId, createdAt: { gte: start } } }),
    ]);
    return q + d;
  }

  async usage(t: TenantContext) {
    const sub = await this.prisma.subscription.findUnique({ where: { businessId: t.businessId }, select: { plan: { select: { aiEnabled: true, maxMonthlyAiQueries: true } } } });
    return { configured: this.llm.enabled, enabled: !!sub?.plan.aiEnabled, limit: sub?.plan.maxMonthlyAiQueries ?? 0, used: await this.usedThisMonth(t.businessId) };
  }

  private baseParams(system: string) {
    return {
      model: this.env.AI_MODEL,
      max_tokens: 16000,
      system,
      output_config: { effort: this.env.AI_EFFORT },
      cache_control: { type: 'ephemeral' as const },
      ...FALLBACK,
      betas: [...FALLBACK.betas],
    };
  }

  // ---------------------------------------------------------------- conversations

  listConversations(t: TenantContext, userId: string) {
    return t.db.aiConversation.findMany({ where: { userId, archivedAt: null }, orderBy: { updatedAt: 'desc' }, take: 30, select: { id: true, title: true, updatedAt: true } });
  }

  async getConversation(t: TenantContext, userId: string, id: string) {
    const c = await t.db.aiConversation.findFirst({
      where: { id, userId },
      include: { messages: { orderBy: { createdAt: 'asc' }, select: { id: true, role: true, inputMode: true, content: true, createdAt: true, toolCalls: true } } },
    });
    if (!c) throw Errors.notFound();
    return {
      id: c.id,
      title: c.title,
      messages: c.messages.map((m) => ({
        id: m.id,
        role: m.role,
        inputMode: m.inputMode,
        content: m.content,
        createdAt: m.createdAt,
        tools: ((m.toolCalls as { tools?: { name: string }[] } | null)?.tools ?? []).map((x) => x.name),
      })),
    };
  }

  /**
   * One question → bounded tool loop → answer. Assistant turns are stored exactly as returned (thinking
   * and fallback blocks included) and replayed unchanged, so conversation history is append-only.
   */
  async ask(t: TenantContext, userId: string, input: { conversationId?: string; text: string; inputMode: 'TEXT' | 'VOICE' }, ctx: RequestContext) {
    await this.checkQuota(t);
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { name: true } });

    let conversation = input.conversationId ? await t.db.aiConversation.findFirst({ where: { id: input.conversationId, userId } }) : null;
    if (input.conversationId && !conversation) throw Errors.notFound();
    const history: BetaMessageParam[] = [];
    if (conversation) {
      const rows = await t.db.aiMessage.findMany({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'asc' }, select: { role: true, toolCalls: true } });
      if (rows.filter((r) => r.role === 'USER').length >= MAX_TURNS_PER_CONVERSATION) throw Errors.unprocessable('AI_CONVERSATION_FULL');
      for (const r of rows) {
        const tc = r.toolCalls as { apiContent?: BetaContentBlockParam[] | string; apiMessages?: BetaMessageParam[] } | null;
        if (r.role === 'USER' && tc?.apiContent) history.push({ role: 'user', content: tc.apiContent });
        if (r.role === 'ASSISTANT' && tc?.apiMessages) history.push(...tc.apiMessages);
      }
    } else {
      conversation = await t.db.aiConversation.create({ data: { userId, title: input.text.slice(0, 80) } as never });
    }

    const userContent = `[आज / today: ${istDateString()}]\n${input.text}`;
    const messages: BetaMessageParam[] = [...history, { role: 'user', content: userContent }];
    const newTurn: BetaMessageParam[] = [];
    const toolLog: { name: string; input: unknown; ok: boolean; ms: number }[] = [];
    const tools = toolsFor(t);
    let last: BetaMessage | null = null;
    let inTok = 0;
    let outTok = 0;

    for (let round = 0; round < this.env.AI_MAX_TOOL_ROUNDS; round++) {
      last = await this.llm.create({ ...this.baseParams(SYSTEM(business.name)), tools: tools.map((d) => d.tool), messages: [...messages, ...newTurn] });
      inTok += last.usage.input_tokens;
      outTok += last.usage.output_tokens;
      newTurn.push({ role: 'assistant', content: last.content as BetaContentBlockParam[] });
      if (last.stop_reason === 'pause_turn') continue;
      if (last.stop_reason !== 'tool_use') break;

      // Execute every requested tool (in parallel) and return ALL results in ONE user message.
      const calls = last.content.filter((b): b is BetaToolUseBlock => b.type === 'tool_use');
      const results: BetaToolResultBlockParam[] = await Promise.all(
        calls.map(async (c) => {
          const started = Date.now();
          const r = await runTool(t, c.name, c.input, this.deps);
          toolLog.push({ name: c.name, input: c.input, ok: r.ok, ms: Date.now() - started });
          return { type: 'tool_result' as const, tool_use_id: c.id, content: JSON.stringify(r.result), ...(r.ok ? {} : { is_error: true }) };
        }),
      );
      newTurn.push({ role: 'user', content: results });
    }

    const answer = this.answerText(last);
    // If the round cap was hit right after tool results, the turn ends on a user tool_result message.
    // That is still valid to replay (the next user text merges into the same user turn), and we never
    // edit or drop model output — history stays append-only.

    await this.prisma.$transaction([
      this.prisma.aiMessage.create({
        data: { businessId: t.businessId, conversationId: conversation.id, role: 'USER', inputMode: input.inputMode, content: input.text, toolCalls: { apiContent: userContent } },
      }),
      this.prisma.aiMessage.create({
        data: {
          businessId: t.businessId,
          conversationId: conversation.id,
          role: 'ASSISTANT',
          content: answer,
          model: last?.model ?? this.env.AI_MODEL,
          inputTokens: inTok,
          outputTokens: outTok,
          toolCalls: { apiMessages: newTurn, tools: toolLog } as unknown as Prisma.InputJsonValue,
        },
      }),
      this.prisma.aiConversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } }),
    ]);
    this.logger.info({ businessId: t.businessId, conversationId: conversation.id, tools: toolLog.map((x) => x.name), inTok, outTok, stop: last?.stop_reason }, 'ai.ask');
    void ctx;
    return { conversationId: conversation.id, answer, tools: toolLog.map((x) => x.name), stopReason: last?.stop_reason ?? null };
  }

  private answerText(m: BetaMessage | null): string {
    if (!m) return '';
    if (m.stop_reason === 'refusal') return 'माफ़ कीजिए, मैं इस अनुरोध में मदद नहीं कर सकता। / Sorry, I can’t help with that request.';
    const text = m.content
      .filter((b): b is Extract<BetaContentBlock, { type: 'text' }> => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    if (m.stop_reason === 'tool_use') return text || 'यह सवाल बहुत लंबा हो गया — कृपया छोटे हिस्सों में पूछें। / Please ask in smaller parts.';
    return text || '—';
  }

  // ---------------------------------------------------------------- drafts (voice / text / photo → form)

  /**
   * Extract a DRAFT. Nothing is written except the AiDraft row. Names are resolved to ids by deterministic
   * database search; ambiguity is returned as candidates for the human to choose.
   */
  async extract(
    t: TenantContext,
    userId: string,
    input: { text?: string; imageBase64?: string; imageMediaType?: 'image/jpeg' | 'image/png' | 'image/webp'; source: 'VOICE' | 'TEXT' | 'IMAGE' },
    ctx: RequestContext,
  ) {
    await this.checkQuota(t);
    let attachmentId: string | null = null;
    const content: BetaContentBlockParam[] = [];
    if (input.imageBase64) {
      const buf = Buffer.from(input.imageBase64, 'base64');
      if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) throw Errors.validation([{ location: 'body', path: 'imageBase64', message: 'Image must be under 5 MB' }]);
      const att = await this.storage.save({ businessId: t.businessId, uploadedById: userId, purpose: 'AI_UPLOAD', data: buf, mimeType: input.imageMediaType!, fileName: `ai-upload.${input.imageMediaType!.split('/')[1]}` });
      attachmentId = att.id;
      content.push({ type: 'image', source: { type: 'base64', media_type: input.imageMediaType!, data: input.imageBase64 } });
    }
    content.push({ type: 'text', text: `[today: ${istDateString()}]\n${input.text?.trim() || 'Read this document and fill the draft.'}` });

    const res = await this.llm.create({
      ...this.baseParams(EXTRACT_SYSTEM),
      output_config: { effort: this.env.AI_EFFORT, format: { type: 'json_schema', schema: EXTRACT_SCHEMA as unknown as Record<string, unknown> } },
      messages: [{ role: 'user', content }],
    });
    if (res.stop_reason === 'refusal') throw Errors.unprocessable('AI_COULD_NOT_READ');
    const raw = res.content.find((b) => b.type === 'text');
    let x: Extracted;
    try {
      x = JSON.parse(raw && raw.type === 'text' ? raw.text : '') as Extracted;
    } catch {
      throw Errors.unprocessable('AI_COULD_NOT_READ');
    }

    const draft = await this.resolve(t, x);
    const row = await this.prisma.aiDraft.create({
      data: {
        businessId: t.businessId,
        userId,
        draftType: draft.type,
        payload: { ...draft, source: input.source, transcript: input.text ?? null, attachmentId, model: res.model } as unknown as Prisma.InputJsonValue,
        expiresAt: new Date(Date.now() + 24 * 3600_000),
      },
    });
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId: userId, action: 'CREATE', entityType: 'AiDraft', entityId: row.id, after: { type: draft.type, source: input.source } }, ctx);
    return { id: row.id, status: row.status, expiresAt: row.expiresAt, ...draft };
  }

  /** Deterministic matching of extracted names to this tenant's records. No financial computation. */
  private async resolve(t: TenantContext, x: Extracted) {
    const num = (v: string, dp: number) => (new RegExp(`^\\d{1,11}(\\.\\d{1,${dp}})?$`).test(v.trim()) ? v.trim() : '');
    const date = /^\d{4}-\d{2}-\d{2}$/.test(x.date) ? x.date : '';
    const warnings = [...x.unclear];
    const find = async (kind: 'farmer' | 'buyer', name: string) => {
      const q = name.trim();
      if (!q) return [];
      const c = { contains: q, mode: 'insensitive' as const };
      return kind === 'farmer'
        ? (await t.db.farmer.findMany({ where: { deletedAt: null, isActive: true, OR: [{ name: c }, { nameHindi: c }, { code: c }] }, select: { id: true, code: true, name: true, nameHindi: true, village: true }, take: 6 })).map((f) => ({ id: f.id, label: `${f.nameHindi ?? f.name} (${f.code}${f.village ? `, ${f.village}` : ''})` }))
        : (await t.db.buyer.findMany({ where: { deletedAt: null, isActive: true, OR: [{ firmName: c }, { ownerName: c }, { code: c }] }, select: { id: true, code: true, firmName: true, city: true }, take: 6 })).map((b) => ({ id: b.id, label: `${b.firmName} (${b.code}${b.city ? `, ${b.city}` : ''})` }));
    };
    const farmers = await find('farmer', x.farmer_name);
    const buyers = await find('buyer', x.buyer_name);
    if (x.farmer_name && farmers.length === 0) warnings.push(`Farmer "${x.farmer_name}" not found`);
    if (x.buyer_name && buyers.length === 0) warnings.push(`Buyer "${x.buyer_name}" not found`);

    let commodity: { id: string; label: string } | null = null;
    if (x.commodity.trim()) {
      const c = { equals: x.commodity.trim(), mode: 'insensitive' as const };
      const hit = await t.db.commodity.findFirst({ where: { isActive: true, OR: [{ name: c }, { nameHindi: c }] }, select: { id: true, name: true, nameHindi: true } });
      if (hit) commodity = { id: hit.id, label: hit.nameHindi ?? hit.name };
      else warnings.push(`Commodity "${x.commodity}" not found`);
    }

    // For a sale, offer the farmer's open lots of that commodity (the human picks; nothing is assumed).
    let lots: { id: string; label: string }[] = [];
    if (x.kind === 'SALE' && farmers.length === 1) {
      const open = await t.db.lot.findMany({
        where: { farmerId: farmers[0]!.id, status: { in: ['CONFIRMED', 'PARTIALLY_SOLD'] }, ...(commodity ? { commodityId: commodity.id } : {}) },
        select: { id: true, lotNumber: true, netWeightKg: true, soldWeightKg: true },
        orderBy: { arrivalDate: 'desc' },
        take: 5,
      });
      lots = open.map((l) => ({ id: l.id, label: `${l.lotNumber} · ${l.netWeightKg.minus(l.soldWeightKg).div(100).toFixed(2)} qtl` }));
      if (!lots.length) warnings.push('No open lot for this farmer/commodity');
    }

    let category: { id: string; label: string } | null = null;
    if (x.kind === 'EXPENSE' && x.expense_category.trim()) {
      const c = { contains: x.expense_category.trim(), mode: 'insensitive' as const };
      const hit = await t.db.expenseCategory.findFirst({ where: { isActive: true, OR: [{ name: c }, { nameHindi: c }] }, select: { id: true, name: true, nameHindi: true } });
      if (hit) category = { id: hit.id, label: hit.nameHindi ?? hit.name };
    }

    const type: AiDraftType = x.kind === 'LOT' ? 'LOT' : x.kind === 'SALE' ? 'SALE' : x.kind === 'PAYMENT' ? 'PAYMENT' : x.kind === 'EXPENSE' ? 'EXPENSE' : 'LOT';
    if (x.kind === 'UNKNOWN') warnings.push('Could not tell what kind of entry this is');
    return {
      type,
      kind: x.kind,
      confidence: x.confidence,
      fields: {
        farmerId: farmers.length === 1 ? farmers[0]!.id : null,
        buyerId: buyers.length === 1 ? buyers[0]!.id : null,
        commodityId: commodity?.id ?? null,
        lotId: lots.length === 1 ? lots[0]!.id : null,
        categoryId: category?.id ?? null,
        quantity: num(x.quantity, 3),
        quantityUnit: x.quantity_unit || 'QUINTAL',
        bags: /^\d{1,7}$/.test(x.bags.trim()) ? x.bags.trim() : '',
        rate: num(x.rate, 2),
        rateUnit: x.rate_unit || '',
        amount: num(x.amount, 2),
        paymentSide: x.payment_direction === 'FROM_BUYER' ? 'BUYER' : x.payment_direction === 'TO_FARMER' ? 'FARMER' : '',
        paymentPurpose: x.payment_purpose,
        paymentMode: x.payment_mode || 'CASH',
        reference: x.reference.trim().slice(0, 60),
        date,
        vehicleNumber: x.vehicle_number.trim().toUpperCase().slice(0, 20),
        notes: x.notes.trim().slice(0, 300),
      },
      names: { farmer: x.farmer_name, buyer: x.buyer_name, commodity: x.commodity, category: x.expense_category },
      candidates: { farmers, buyers, lots, commodity, category },
      warnings,
    };
  }

  async getDraft(t: TenantContext, userId: string, id: string) {
    const d = await t.db.aiDraft.findFirst({ where: { id, userId } });
    if (!d) throw Errors.notFound();
    return d;
  }

  /** The human saved the record through the normal form; link it and close the draft. */
  async confirmDraft(t: TenantContext, userId: string, id: string, entity: { entityType: 'Lot' | 'Sale' | 'Payment' | 'Expense'; entityId: string }) {
    const d = await this.getDraft(t, userId, id);
    if (d.status !== 'PENDING') throw Errors.unprocessable('APPROVAL_NOT_PENDING');
    const exists = {
      Lot: () => t.db.lot.count({ where: { id: entity.entityId, createdById: userId } }),
      Sale: () => t.db.sale.count({ where: { id: entity.entityId, createdById: userId } }),
      Payment: () => t.db.payment.count({ where: { id: entity.entityId, createdById: userId } }),
      Expense: () => t.db.expense.count({ where: { id: entity.entityId, createdById: userId } }),
    }[entity.entityType];
    if (!(await exists())) throw Errors.notFound();
    return t.db.aiDraft.update({ where: { id }, data: { status: 'CONFIRMED', confirmedEntityType: entity.entityType, confirmedEntityId: entity.entityId, confirmedAt: new Date() } });
  }

  async discardDraft(t: TenantContext, userId: string, id: string) {
    const res = await t.db.aiDraft.updateMany({ where: { id, userId, status: 'PENDING' }, data: { status: 'DISCARDED' } });
    if (res.count === 0) throw Errors.notFound();
  }

  // ---------------------------------------------------------------- payment reminder text

  /**
   * Polite reminder text for a buyer. The amount is computed by the backend and must appear verbatim;
   * if the model alters it, a deterministic template is used instead.
   */
  async reminder(t: TenantContext, buyerId: string) {
    await this.checkQuota(t);
    const [buyer, business] = await Promise.all([
      t.db.buyer.findFirst({ where: { id: buyerId, deletedAt: null }, select: { firmName: true, ownerName: true, currentBalance: true } }),
      this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { name: true, nameHindi: true } }),
    ]);
    if (!buyer) throw Errors.notFound();
    const amount = `₹${indian(buyer.currentBalance.toFixed(2))}`;
    const firm = business.nameHindi ?? business.name;
    const fallback = `नमस्ते ${buyer.ownerName ?? buyer.firmName} जी, ${firm} की ओर से विनम्र निवेदन: आपकी बकाया राशि ${amount} है। कृपया सुविधानुसार जल्द भुगतान करें। धन्यवाद।`;
    if (!buyer.currentBalance.gt(0)) return { text: '', amount, source: 'none' as const };

    const res = await this.llm.create({
      ...this.baseParams(
        'You write short, respectful WhatsApp payment reminders in Hindi (Devanagari) for an Indian mandi commission agent. 2–3 sentences, warm and polite, no threats, no emojis except one 🙏 at most. Include the amount EXACTLY as given, character for character. Output only the message text.',
      ),
      messages: [{ role: 'user', content: `Buyer: ${buyer.ownerName ?? buyer.firmName} (${buyer.firmName})\nFrom firm: ${firm}\nOutstanding amount (use exactly): ${amount}` }],
    });
    const text = res.stop_reason === 'end_turn' ? res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('').trim() : '';
    if (!text || !text.includes(amount) || text.length > 600) return { text: fallback, amount, source: 'template' as const };
    return { text, amount, source: 'ai' as const };
  }
}

function indian(v: string) {
  const [i = '0', f = '00'] = v.split('.');
  const g = i.length <= 3 ? i : `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i.slice(-3)}`;
  return `${g}.${f}`;
}
