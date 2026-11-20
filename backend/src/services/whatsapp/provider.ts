import { randomUUID } from 'node:crypto';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../config/logger.ts';

export interface TemplateMessage {
  /** E.164 without "+", e.g. 919812345678 */
  to: string;
  template: string;
  language: string;
  bodyParams: string[];
  document?: { mediaId: string; filename: string };
}

export interface WhatsAppProvider {
  readonly name: 'mock' | 'cloud' | 'disabled';
  uploadMedia(data: Buffer, mimeType: string, filename: string): Promise<string>;
  sendTemplate(m: TemplateMessage): Promise<{ providerMessageId: string }>;
}

export class WhatsAppError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

/** Temporary failures worth retrying from the queue: network, Graph 5xx, rate limits. */
export function isTransientWhatsAppError(code: string): boolean {
  return code === 'UNEXPECTED' || code === 'NETWORK' || /^5\d\d$/.test(code) || ['4', '80007', '130429', '131000', '131016', '133004'].includes(code);
}

/** Production without Cloud API credentials: every send is refused up front (never faked). */
export class DisabledWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'disabled' as const;
  async uploadMedia(): Promise<string> {
    throw new WhatsAppError('WhatsApp is disabled', 'DISABLED');
  }
  async sendTemplate(): Promise<{ providerMessageId: string }> {
    throw new WhatsAppError('WhatsApp is disabled', 'DISABLED');
  }
}

/**
 * Development / pre-approval provider. Nothing leaves the server; messages are logged and recorded as
 * delivered so the full flow (consent → PDF → template → status) can be exercised end to end.
 */
export class MockWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'mock' as const;
  readonly sent: (TemplateMessage & { id: string })[] = [];
  constructor(private readonly logger: Logger) {}
  async uploadMedia(data: Buffer, mimeType: string, filename: string) {
    this.logger.info({ bytes: data.length, mimeType, filename }, 'whatsapp.mock.uploadMedia');
    return `mock-media-${randomUUID()}`;
  }
  async sendTemplate(m: TemplateMessage) {
    const id = `wamid.mock.${randomUUID()}`;
    this.sent.push({ ...m, id });
    this.logger.info({ template: m.template, to: `${m.to.slice(0, 4)}••••${m.to.slice(-3)}`, id }, 'whatsapp.mock.send');
    return { providerMessageId: id };
  }
}

/**
 * Official WhatsApp Business Platform (Cloud API, Graph API). Business-initiated messages must use
 * pre-approved templates; documents are uploaded first and referenced by media id.
 * NOTE: written against the documented Cloud API shapes; verify against your Meta app before go-live
 * (see docs/DEPLOYMENT.md → WhatsApp).
 */
export class CloudWhatsAppProvider implements WhatsAppProvider {
  readonly name = 'cloud' as const;
  private readonly base: string;
  constructor(
    private readonly env: Env,
    private readonly logger: Logger,
  ) {
    this.base = `https://graph.facebook.com/${env.WHATSAPP_GRAPH_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}`;
  }

  private async call(path: string, init: RequestInit) {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.env.WHATSAPP_ACCESS_TOKEN}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(20_000),
    });
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number }; id?: string; messages?: { id: string }[] };
    if (!res.ok || body.error) {
      this.logger.warn({ status: res.status, code: body.error?.code }, 'whatsapp.cloud.error');
      throw new WhatsAppError(body.error?.message ?? `HTTP ${res.status}`, String(body.error?.code ?? res.status));
    }
    return body;
  }

  async uploadMedia(data: Buffer, mimeType: string, filename: string) {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('type', mimeType);
    form.append('file', new Blob([new Uint8Array(data)], { type: mimeType }), filename);
    const body = await this.call('/media', { method: 'POST', body: form });
    if (!body.id) throw new WhatsAppError('No media id returned', 'NO_MEDIA_ID');
    return body.id;
  }

  async sendTemplate(m: TemplateMessage) {
    const components: unknown[] = [];
    if (m.document) components.push({ type: 'header', parameters: [{ type: 'document', document: { id: m.document.mediaId, filename: m.document.filename } }] });
    if (m.bodyParams.length) components.push({ type: 'body', parameters: m.bodyParams.map((text) => ({ type: 'text', text })) });
    const body = await this.call('/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to: m.to, type: 'template', template: { name: m.template, language: { code: m.language }, components } }),
    });
    const id = body.messages?.[0]?.id;
    if (!id) throw new WhatsAppError('No message id returned', 'NO_MESSAGE_ID');
    return { providerMessageId: id };
  }
}
