import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma, type AttachmentPurpose, type MessageStatus, type PrismaClient } from '@mandimitra/database';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../config/logger.ts';
import type { TenantContext } from '../../middleware/tenant.ts';
import { AppError, Errors } from '../../utils/errors.ts';
import type { RequestContext } from '../../utils/http.ts';
import { writeActivity } from '../audit.service.ts';
import type { PattiService } from '../patti/patti.service.ts';
import type { PdfRenderer } from '../patti/pdf.ts';
import type { PaymentService } from '../payment.service.ts';
import type { StatementService } from '../statement.service.ts';
import type { StorageService } from '../storage.service.ts';
import { isTransientWhatsAppError, WhatsAppError, type WhatsAppProvider } from './provider.ts';

export type SendKind = 'PATTI' | 'STATEMENT' | 'RECEIPT' | 'REMINDER';

/**
 * Pre-approved Meta templates (register these exact names/bodies; see docs/DEPLOYMENT.md).
 * {{n}} variables are filled from backend data only — never from AI output.
 */
export const TEMPLATES: Record<SendKind | 'RECEIPT_FARMER', { name: string; document: AttachmentPurpose | null }> = {
  PATTI: { name: 'patti_ready_hi', document: 'PATTI_PDF' },
  STATEMENT: { name: 'statement_hi', document: 'STATEMENT_PDF' },
  RECEIPT: { name: 'payment_received_hi', document: 'RECEIPT_PDF' },
  RECEIPT_FARMER: { name: 'payment_made_hi', document: 'RECEIPT_PDF' },
  REMINDER: { name: 'payment_reminder_hi', document: null },
};

const RANK: Record<MessageStatus, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3, FAILED: 4 };
const STOP_WORDS = new Set(['STOP', 'UNSUBSCRIBE', 'BAND', 'BAND KARO', 'रुकें', 'बंद', 'बंद करो']);

function rupees(v: Prisma.Decimal) {
  const [i = '0', f = '00'] = v.abs().toFixed(2).split('.');
  return `₹${i.length <= 3 ? i : `${i.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${i.slice(-3)}`}.${f}`;
}

export class WhatsAppService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly provider: WhatsAppProvider,
    private readonly pdf: PdfRenderer,
    private readonly storage: StorageService,
    private readonly patti: PattiService,
    private readonly statements: StatementService,
    private readonly payments: PaymentService,
    private readonly logger: Logger,
  ) {}

  /** Set when the job queue runs: temporary send failures are retried in the background. */
  private retryQueue: ((messageId: string) => Promise<void>) | null = null;
  setRetryQueue(fn: ((messageId: string) => Promise<void>) | null) {
    this.retryQueue = fn;
  }

  get providerName() {
    return this.provider.name;
  }

  /**
   * Send a document/reminder to a farmer or buyer. Gates, in order: plan feature → party in this tenant →
   * consent OPTED_IN → mobile present. Every attempt is recorded (QUEUED → SENT | FAILED).
   */
  async send(t: TenantContext, userId: string, input: { kind: SendKind; entityId?: string; farmerId?: string; buyerId?: string }, ctx: RequestContext) {
    if (this.provider.name === 'disabled') throw new AppError(503, 'WHATSAPP_NOT_CONFIGURED');
    const plan = await this.prisma.subscription.findUnique({ where: { businessId: t.businessId }, select: { plan: { select: { whatsappEnabled: true } } } });
    if (!plan?.plan.whatsappEnabled) throw Errors.paymentRequired('PLAN_LIMIT_REACHED', { resource: 'whatsapp' });
    const business = await this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { name: true, nameHindi: true } });
    const firm = business.nameHindi ?? business.name;

    let party: { kind: 'farmer' | 'buyer'; id: string; name: string; mobile: string | null; consent: string };
    let template = TEMPLATES[input.kind];
    let params: string[];
    let doc: { html: string; fileName: string } | null = null;
    let related: { type: string; id: string } | null = null;

    const farmerParty = async (id: string) => {
      const f = await t.db.farmer.findFirst({ where: { id, deletedAt: null }, select: { id: true, name: true, nameHindi: true, mobile: true, whatsappConsent: true, currentBalance: true } });
      if (!f) throw Errors.notFound();
      return { p: { kind: 'farmer' as const, id: f.id, name: f.nameHindi ?? f.name, mobile: f.mobile, consent: f.whatsappConsent }, balance: f.currentBalance };
    };
    const buyerParty = async (id: string) => {
      const b = await t.db.buyer.findFirst({ where: { id, deletedAt: null }, select: { id: true, firmName: true, ownerName: true, mobile: true, whatsappConsent: true, currentBalance: true } });
      if (!b) throw Errors.notFound();
      return { p: { kind: 'buyer' as const, id: b.id, name: b.ownerName ?? b.firmName, mobile: b.mobile, consent: b.whatsappConsent }, balance: b.currentBalance };
    };

    switch (input.kind) {
      case 'PATTI': {
        const p = await this.patti.get(t, input.entityId!);
        if (p.status !== 'FINALIZED') throw Errors.unprocessable('ALREADY_CANCELLED');
        party = (await farmerParty(p.farmerId)).p;
        params = [party.name, firm, p.pattiNumber, rupees(p.netPayable)];
        doc = { html: await this.patti.html(t, p.id, false), fileName: `${p.pattiNumber.replaceAll('/', '-')}.pdf` };
        related = { type: 'Patti', id: p.id };
        break;
      }
      case 'RECEIPT': {
        const pay = await this.payments.get(t, input.entityId!);
        if (pay.status !== 'ACTIVE') throw Errors.unprocessable('ALREADY_CANCELLED');
        party = pay.farmerId ? (await farmerParty(pay.farmerId)).p : (await buyerParty(pay.buyerId!)).p;
        if (pay.partySide === 'FARMER') template = TEMPLATES.RECEIPT_FARMER;
        params = [party.name, firm, rupees(pay.amount)];
        const r = await this.payments.receiptHtml(t, pay.id, false);
        doc = { html: r.html, fileName: r.fileName };
        related = { type: 'Payment', id: pay.id };
        break;
      }
      case 'STATEMENT': {
        const side = input.farmerId ? 'farmer' : 'buyer';
        const id = input.farmerId ?? input.buyerId!;
        const r = side === 'farmer' ? await farmerParty(id) : await buyerParty(id);
        party = r.p;
        params = [party.name, firm, rupees(r.balance)];
        const d = await this.statements.document(t, side, id, undefined, undefined, 'hi');
        doc = { html: d.html(false), fileName: d.fileName };
        related = { type: side === 'farmer' ? 'Farmer' : 'Buyer', id };
        break;
      }
      case 'REMINDER': {
        const r = await buyerParty(input.buyerId!);
        party = r.p;
        if (!r.balance.gt(0)) throw Errors.unprocessable('NOTHING_OUTSTANDING', { currentBalance: r.balance.toFixed(2) });
        params = [party.name, firm, rupees(r.balance)];
        related = { type: 'Buyer', id: party.id };
        break;
      }
    }

    if (party.consent !== 'OPTED_IN') throw Errors.unprocessable('WHATSAPP_CONSENT_REQUIRED');
    if (!party.mobile) throw Errors.unprocessable('NO_MOBILE');

    let mediaAttachmentId: string | null = null;
    let pdfBuf: Buffer | null = null;
    if (doc && template.document) {
      if (!this.pdf.available) throw Errors.unprocessable('PDF_UNAVAILABLE');
      pdfBuf = await this.pdf.render(doc.html);
      const att = await this.storage.save({ businessId: t.businessId, uploadedById: userId, purpose: template.document, data: pdfBuf, mimeType: 'application/pdf', fileName: doc.fileName });
      mediaAttachmentId = att.id;
    }

    const msg = await this.prisma.whatsAppMessage.create({
      data: {
        businessId: t.businessId,
        farmerId: party.kind === 'farmer' ? party.id : null,
        buyerId: party.kind === 'buyer' ? party.id : null,
        toMobile: party.mobile,
        templateName: template.name,
        templateLanguage: 'hi',
        variables: params,
        mediaId: mediaAttachmentId,
        relatedEntityType: related.type,
        relatedEntityId: related.id,
        status: 'QUEUED',
        createdById: userId,
      },
    });

    try {
      const mediaId = pdfBuf ? await this.provider.uploadMedia(pdfBuf, 'application/pdf', doc!.fileName) : null;
      const { providerMessageId } = await this.provider.sendTemplate({
        to: party.mobile.replace('+', ''),
        template: template.name,
        language: 'hi',
        bodyParams: params,
        ...(mediaId ? { document: { mediaId, filename: doc!.fileName } } : {}),
      });
      // The mock provider has no delivery webhooks, so it records the message as delivered immediately.
      const mock = this.provider.name === 'mock';
      const updated = await this.prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: { status: mock ? 'DELIVERED' : 'SENT', providerMessageId, sentAt: new Date(), ...(mock ? { deliveredAt: new Date() } : {}) },
      });
      if (input.kind === 'STATEMENT' || input.kind === 'PATTI') {
        await writeActivity(this.prisma, { businessId: t.businessId, userId, activityType: 'STATEMENT_SHARED', metadata: { kind: input.kind, messageId: msg.id, provider: this.provider.name } }, ctx);
      }
      return { ...updated, provider: this.provider.name };
    } catch (err) {
      const e = err instanceof WhatsAppError ? err : new WhatsAppError('Unexpected error', 'UNEXPECTED');
      if (this.retryQueue && isTransientWhatsAppError(e.code)) {
        // Stays QUEUED; the worker retries with backoff and marks it FAILED only after the last attempt.
        const queued = await this.prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { errorCode: e.code.slice(0, 40), errorMessage: e.message.slice(0, 300) } });
        await this.retryQueue(msg.id);
        this.logger.warn({ messageId: msg.id, code: e.code }, 'whatsapp.send.queued_for_retry');
        return { ...queued, provider: this.provider.name };
      }
      await this.prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', errorCode: e.code.slice(0, 40), errorMessage: e.message.slice(0, 300) } });
      this.logger.warn({ messageId: msg.id, code: e.code }, 'whatsapp.send.failed');
      throw new AppError(502, 'WHATSAPP_SEND_FAILED', { messageId: msg.id, code: e.code });
    }
  }

  /**
   * Background retry of a QUEUED message, rebuilt only from what was stored at send time (same template
   * variables, same stored PDF). Throws on a temporary failure so the queue retries; on the final attempt
   * or a permanent error the message is marked FAILED.
   */
  async retry(messageId: string, finalAttempt: boolean) {
    const msg = await this.prisma.whatsAppMessage.findUnique({ where: { id: messageId } });
    if (!msg || msg.status !== 'QUEUED') return { skipped: true };
    try {
      let document: { mediaId: string; filename: string } | undefined;
      if (msg.mediaId) {
        const att = await this.prisma.attachment.findFirstOrThrow({ where: { id: msg.mediaId, businessId: msg.businessId } });
        const buf = await this.storage.read(att.storageKey);
        document = { mediaId: await this.provider.uploadMedia(buf, att.mimeType, att.fileName), filename: att.fileName };
      }
      const { providerMessageId } = await this.provider.sendTemplate({
        to: msg.toMobile.replace('+', ''),
        template: msg.templateName,
        language: msg.templateLanguage,
        bodyParams: (msg.variables as string[] | null) ?? [],
        ...(document ? { document } : {}),
      });
      const mock = this.provider.name === 'mock';
      await this.prisma.whatsAppMessage.update({
        where: { id: msg.id },
        data: { status: mock ? 'DELIVERED' : 'SENT', providerMessageId, sentAt: new Date(), errorCode: null, errorMessage: null, ...(mock ? { deliveredAt: new Date() } : {}) },
      });
      return { sent: true };
    } catch (err) {
      const e = err instanceof WhatsAppError ? err : new WhatsAppError((err as Error).message ?? 'Unexpected error', 'UNEXPECTED');
      if (!finalAttempt && isTransientWhatsAppError(e.code)) throw err;
      await this.prisma.whatsAppMessage.update({ where: { id: msg.id }, data: { status: 'FAILED', errorCode: e.code.slice(0, 40), errorMessage: e.message.slice(0, 300) } });
      this.logger.warn({ messageId: msg.id, code: e.code }, 'whatsapp.retry.failed');
      return { failed: true };
    }
  }

  list(t: TenantContext, q: { page: number; pageSize: number; farmerId?: string; buyerId?: string }) {
    const where = { ...(q.farmerId ? { farmerId: q.farmerId } : {}), ...(q.buyerId ? { buyerId: q.buyerId } : {}) };
    return Promise.all([
      t.db.whatsAppMessage.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, templateName: true, toMobile: true, status: true, errorMessage: true, relatedEntityType: true, relatedEntityId: true,
          sentAt: true, deliveredAt: true, readAt: true, createdAt: true,
          farmer: { select: { id: true, name: true } }, buyer: { select: { id: true, firmName: true } },
        },
      }),
      t.db.whatsAppMessage.count({ where }),
    ]);
  }

  // ---------------------------------------------------------------- webhook (no session; authenticated by signature)

  verifySubscription(mode: unknown, token: unknown, challenge: unknown): string | null {
    if (mode === 'subscribe' && this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && token === this.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN && typeof challenge === 'string') return challenge;
    return null;
  }

  verifySignature(rawBody: Buffer | undefined, header: string | undefined): boolean {
    if (!this.env.WHATSAPP_APP_SECRET || !rawBody || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', this.env.WHATSAPP_APP_SECRET).update(rawBody).digest('hex'));
    const got = Buffer.from(header.slice(7));
    return expected.length === got.length && timingSafeEqual(expected, got);
  }

  /** Status callbacks (sent/delivered/read/failed) and STOP replies. Idempotent via WebhookEvent. */
  async handleWebhook(payload: unknown) {
    type Change = {
      value?: {
        statuses?: { id: string; status: string; timestamp?: string; errors?: { code?: number; title?: string }[] }[];
        messages?: { id: string; from: string; type: string; text?: { body?: string }; button?: { text?: string } }[];
      };
    };
    const entries = (payload as { entry?: { changes?: Change[] }[] })?.entry ?? [];
    let processed = 0;
    for (const change of entries.flatMap((e) => e.changes ?? [])) {
      for (const s of change.value?.statuses ?? []) {
        if (!(await this.firstTime(`status:${s.id}:${s.status}`, 'status', s))) continue;
        const map: Record<string, MessageStatus> = { sent: 'SENT', delivered: 'DELIVERED', read: 'READ', failed: 'FAILED' };
        const next = map[s.status];
        if (!next) continue;
        const msg = await this.prisma.whatsAppMessage.findUnique({ where: { providerMessageId: s.id } });
        // Never move backwards (a late "sent" must not overwrite "read"); a FAILED message stays failed.
        if (!msg || msg.status === 'FAILED' || (RANK[next] <= RANK[msg.status] && next !== 'FAILED')) continue;
        const at = s.timestamp ? new Date(Number(s.timestamp) * 1000) : new Date();
        await this.prisma.whatsAppMessage.update({
          where: { id: msg.id },
          data: {
            status: next,
            ...(next === 'DELIVERED' ? { deliveredAt: at } : next === 'READ' ? { readAt: at } : {}),
            ...(next === 'FAILED' ? { errorCode: String(s.errors?.[0]?.code ?? ''), errorMessage: (s.errors?.[0]?.title ?? '').slice(0, 300) } : {}),
          },
        });
        processed++;
      }
      for (const m of change.value?.messages ?? []) {
        if (!(await this.firstTime(`message:${m.id}`, 'message', { id: m.id, from: m.from, type: m.type }))) continue;
        const text = (m.text?.body ?? m.button?.text ?? '').trim().toUpperCase();
        if (STOP_WORDS.has(text)) {
          await this.optOut(`+${m.from}`);
          processed++;
        }
      }
    }
    return { processed };
  }

  private async firstTime(eventId: string, eventType: string, payload: unknown) {
    try {
      await this.prisma.webhookEvent.create({ data: { provider: 'whatsapp', eventId: eventId.slice(0, 120), eventType, payload: payload as Prisma.InputJsonValue, processedAt: new Date() } });
      return true;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
      throw e;
    }
  }

  /** A STOP reply opts the number out in every business that has messaged it. */
  private async optOut(mobile: string) {
    const sent = await this.prisma.whatsAppMessage.findMany({ where: { toMobile: mobile }, select: { businessId: true, farmerId: true, buyerId: true }, distinct: ['businessId', 'farmerId', 'buyerId'] });
    const now = new Date();
    for (const s of sent) {
      if (s.farmerId) await this.prisma.farmer.updateMany({ where: { id: s.farmerId, businessId: s.businessId }, data: { whatsappConsent: 'OPTED_OUT', whatsappConsentAt: now } });
      if (s.buyerId) await this.prisma.buyer.updateMany({ where: { id: s.buyerId, businessId: s.businessId }, data: { whatsappConsent: 'OPTED_OUT', whatsappConsentAt: now } });
    }
    this.logger.info({ businesses: new Set(sent.map((s) => s.businessId)).size }, 'whatsapp.optout');
  }
}
