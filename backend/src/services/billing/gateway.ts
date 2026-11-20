import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../config/logger.ts';

export class GatewayError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
  }
}

export interface PaymentGateway {
  readonly name: 'razorpay' | 'mock';
  /** Public key id for Checkout (safe for the browser; the secret never leaves the server). */
  readonly keyId: string;
  createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }): Promise<{ id: string }>;
  /** Checkout success callback: HMAC_SHA256(order_id + "|" + payment_id, key_secret), hex. */
  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean;
  /** Webhook: HMAC_SHA256(raw body, webhook_secret), hex, in X-Razorpay-Signature. */
  verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined): boolean;
}

export function hmacHex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function safeEqualHex(expected: string, got: string | undefined): boolean {
  if (!got) return false;
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(got.toLowerCase(), 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Razorpay Orders API (https://razorpay.com/docs/api/orders/create/). */
export class RazorpayGateway implements PaymentGateway {
  readonly name = 'razorpay' as const;
  readonly keyId: string;
  private readonly secret: string;
  private readonly webhookSecret: string;

  constructor(
    env: Env,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.keyId = env.RAZORPAY_KEY_ID!;
    this.secret = env.RAZORPAY_KEY_SECRET!;
    this.webhookSecret = env.RAZORPAY_WEBHOOK_SECRET!;
  }

  async createOrder(input: { amountPaise: number; receipt: string; notes: Record<string, string> }) {
    let res: Response;
    try {
      res = await this.fetchImpl('https://api.razorpay.com/v1/orders', {
        method: 'POST',
        headers: {
          authorization: `Basic ${Buffer.from(`${this.keyId}:${this.secret}`).toString('base64')}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ amount: input.amountPaise, currency: 'INR', receipt: input.receipt.slice(0, 40), notes: input.notes }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new GatewayError((e as Error).message, 'NETWORK');
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string; error?: { code?: string; description?: string } };
    if (!res.ok || !body.id) {
      this.logger.warn({ status: res.status, code: body.error?.code }, 'razorpay.order.failed');
      throw new GatewayError(body.error?.description ?? `HTTP ${res.status}`, body.error?.code ?? String(res.status));
    }
    return { id: body.id };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
    return safeEqualHex(hmacHex(this.secret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody) return false;
    return safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }
}

/**
 * Local test checkout (development only — refused in production by loadEnv).
 * Uses the exact same signature scheme as Razorpay, so the real verify path is exercised:
 * `complete()` plays the role of Razorpay's popup and signs with a per-process secret.
 */
export class MockGateway implements PaymentGateway {
  readonly name = 'mock' as const;
  readonly keyId = 'rzp_test_mock';
  private readonly secret = randomBytes(32).toString('hex');
  readonly webhookSecret = randomBytes(32).toString('hex');
  private readonly orders = new Set<string>();

  async createOrder() {
    const id = `order_mock_${randomBytes(9).toString('hex')}`;
    this.orders.add(id);
    return { id };
  }

  /** Simulates a successful payment in the popup. Only orders this process created can be "paid". */
  complete(orderId: string): { paymentId: string; signature: string } | null {
    if (!this.orders.has(orderId)) return null;
    const paymentId = `pay_mock_${randomBytes(9).toString('hex')}`;
    return { paymentId, signature: hmacHex(this.secret, `${orderId}|${paymentId}`) };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string) {
    return safeEqualHex(hmacHex(this.secret, `${orderId}|${paymentId}`), signature);
  }

  verifyWebhookSignature(rawBody: Buffer | undefined, signature: string | undefined) {
    if (!rawBody) return false;
    return safeEqualHex(hmacHex(this.webhookSecret, rawBody), signature);
  }
}
