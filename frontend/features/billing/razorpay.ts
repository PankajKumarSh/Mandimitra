/**
 * Razorpay Checkout (https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/).
 * The browser receives only the public key id and a server-created order. The handler's
 * {payment_id, order_id, signature} triple is sent back to the API, which verifies the HMAC with the
 * secret before anything changes. Nothing here is trusted on its own.
 */
import type { CheckoutOrder } from '@/types/billing';

interface RazorpayResponse {
  razorpay_payment_id: string;
  razorpay_order_id: string;
  razorpay_signature: string;
}
interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (r: { error?: { description?: string } }) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

const SRC = 'https://checkout.razorpay.com/v1/checkout.js';
let loading: Promise<void> | null = null;

export function loadRazorpay(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.Razorpay) return Promise.resolve();
  loading ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.Razorpay ? resolve() : reject(new Error('Razorpay missing')));
    s.onerror = () => {
      loading = null;
      reject(new Error('Razorpay script failed'));
    };
    document.body.appendChild(s);
  });
  return loading;
}

export type CheckoutResult =
  | { ok: true; orderId: string; paymentId: string; signature: string }
  | { ok: false; reason: 'dismissed' | 'failed'; message?: string };

export async function openRazorpay(order: CheckoutOrder, opts: { description: string }): Promise<CheckoutResult> {
  await loadRazorpay();
  return new Promise<CheckoutResult>((resolve) => {
    let settled = false;
    const done = (r: CheckoutResult) => {
      if (!settled) {
        settled = true;
        resolve(r);
      }
    };
    const rzp = new window.Razorpay!({
      key: order.keyId,
      order_id: order.orderId,
      amount: order.amountPaise,
      currency: order.currency,
      name: 'MandiMitra AI',
      description: opts.description,
      prefill: order.prefill,
      notes: { business: order.business },
      theme: { color: '#166534' },
      handler: (r: RazorpayResponse) => done({ ok: true, orderId: r.razorpay_order_id, paymentId: r.razorpay_payment_id, signature: r.razorpay_signature }),
      modal: { ondismiss: () => done({ ok: false, reason: 'dismissed' }), confirm_close: true },
    });
    // A failed attempt keeps the popup open for a retry; we only report when the user closes it.
    rzp.on('payment.failed', () => undefined);
    rzp.open();
  });
}
