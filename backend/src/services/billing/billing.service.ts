import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { Env } from '../../config/env.ts';
import type { Logger } from '../../config/logger.ts';
import { effectiveSubscriptionStatus, type TenantCache, type TenantContext } from '../../middleware/tenant.ts';
import { AppError, Errors } from '../../utils/errors.ts';
import type { RequestContext } from '../../utils/http.ts';
import { writeAudit } from '../audit.service.ts';
import { istDateString } from '../ledger.service.ts';
import { esc, rupees } from '../patti/template.ts';
import { GatewayError, type PaymentGateway } from './gateway.ts';
import { classifyChange, computePeriod, hasLivePaidPeriod, toPaise, type SubState } from './lifecycle.ts';

type Tx = Prisma.TransactionClient;

const planPublic = {
  id: true, code: true, name: true, nameHindi: true, priceMonthly: true, currency: true, maxStaffUsers: true, maxFarmers: true,
  maxMonthlyAiQueries: true, aiEnabled: true, whatsappEnabled: true, exportsEnabled: true, sortOrder: true,
} satisfies Prisma.SubscriptionPlanSelect;

/**
 * SaaS subscription billing. Money moves only through the gateway; a subscription changes only after a
 * server-side signature check (Checkout callback) or a signed webhook — never on the browser's word.
 * Both paths converge on `activate()`, which is idempotent under a row lock.
 */
export class BillingService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly env: Env,
    private readonly gateway: PaymentGateway,
    private readonly cache: TenantCache,
    private readonly logger: Logger,
  ) {}

  get provider() {
    return this.gateway.name;
  }

  plans() {
    return this.prisma.subscriptionPlan.findMany({ where: { isActive: true }, orderBy: { sortOrder: 'asc' }, select: planPublic });
  }

  private async loadSub(db: PrismaClient | Tx, businessId: string) {
    const sub = await db.subscription.findUnique({
      where: { businessId },
      include: { plan: { select: planPublic }, pendingPlan: { select: { code: true, name: true, nameHindi: true, priceMonthly: true } } },
    });
    if (!sub) throw Errors.notFound();
    return sub;
  }

  private state(sub: Awaited<ReturnType<BillingService['loadSub']>>): SubState {
    return { status: sub.status, planCode: sub.plan.code, planPrice: sub.plan.priceMonthly, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd };
  }

  async overview(t: TenantContext) {
    const sub = await this.loadSub(this.prisma, t.businessId);
    const now = new Date();
    // Same counting rule as the assistant's quota: questions + drafts since the 1st of the month (IST).
    const monthStart = new Date(`${istDateString(now).slice(0, 8)}01T00:00:00+05:30`);
    const [staff, farmers, aiQ, aiD] = await Promise.all([
      this.prisma.businessMembership.count({ where: { businessId: t.businessId, status: 'ACTIVE' } }),
      this.prisma.farmer.count({ where: { businessId: t.businessId, deletedAt: null } }),
      this.prisma.aiMessage.count({ where: { businessId: t.businessId, role: 'USER', createdAt: { gte: monthStart } } }),
      this.prisma.aiDraft.count({ where: { businessId: t.businessId, createdAt: { gte: monthStart } } }),
    ]);
    const ai = aiQ + aiD;
    return {
      status: effectiveSubscriptionStatus({ status: sub.status, planCode: sub.plan.code, trialEndsAt: sub.trialEndsAt, currentPeriodEnd: sub.currentPeriodEnd, maxStaffUsers: sub.plan.maxStaffUsers }, now),
      plan: sub.plan,
      trialEndsAt: sub.trialEndsAt,
      currentPeriodStart: sub.currentPeriodStart,
      currentPeriodEnd: sub.currentPeriodEnd,
      cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
      pendingPlan: sub.pendingPlan,
      usage: { staff, farmers, aiQueriesThisMonth: ai },
      provider: this.gateway.name,
    };
  }

  // ---------------------------------------------------------------- checkout

  async checkout(t: TenantContext, userId: string, planCode: string, ctx: RequestContext) {
    const [plan, sub, business, user] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({ where: { code: planCode } }),
      this.loadSub(this.prisma, t.businessId),
      this.prisma.business.findUniqueOrThrow({ where: { id: t.businessId }, select: { name: true, email: true } }),
      this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { fullName: true, mobile: true, email: true } }),
    ]);
    if (!plan || !plan.isActive) throw Errors.unprocessable('PLAN_NOT_AVAILABLE');
    const now = new Date();
    const kind = classifyChange(this.state(sub), { code: plan.code, price: plan.priceMonthly }, now);
    if (kind === 'DOWNGRADE') throw Errors.conflict('PLAN_CHANGE_AT_RENEWAL');

    // The amount always comes from the plan table on the server — the client only names a plan.
    const amountPaise = toPaise(plan.priceMonthly);
    const row = await this.prisma.billingPayment.create({
      data: {
        businessId: t.businessId,
        subscriptionId: sub.id,
        planId: plan.id,
        amount: plan.priceMonthly,
        currency: plan.currency,
        gateway: this.gateway.name.toUpperCase(),
        gatewayOrderId: `pending_${crypto.randomUUID()}`, // replaced below; keeps the unique column non-null
        status: 'CREATED',
      },
    });
    let order: { id: string };
    try {
      order = await this.gateway.createOrder({ amountPaise, receipt: row.id, notes: { businessId: t.businessId, planCode: plan.code, billingPaymentId: row.id } });
    } catch (e) {
      const code = e instanceof GatewayError ? e.code : 'UNEXPECTED';
      await this.prisma.billingPayment.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: `order: ${code}`.slice(0, 300) } });
      throw new AppError(502, 'BILLING_GATEWAY_ERROR', { code });
    }
    await this.prisma.billingPayment.update({ where: { id: row.id }, data: { gatewayOrderId: order.id, status: 'PENDING' } });
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId: userId, action: 'CREATE', entityType: 'BillingPayment', entityId: row.id, after: { planCode: plan.code, amount: plan.priceMonthly, kind } }, ctx);

    return {
      billingPaymentId: row.id,
      provider: this.gateway.name,
      keyId: this.gateway.keyId,
      orderId: order.id,
      amount: plan.priceMonthly.toFixed(2),
      amountPaise,
      currency: plan.currency,
      kind,
      plan: { code: plan.code, name: plan.name, nameHindi: plan.nameHindi },
      business: business.name,
      prefill: { name: user.fullName, contact: user.mobile, email: user.email ?? business.email ?? undefined },
    };
  }

  /** Dev-only test checkout: plays Razorpay's popup for an order this server created. */
  mockComplete(t: TenantContext, orderId: string) {
    const g = this.gateway as PaymentGateway & { complete?: (id: string) => { paymentId: string; signature: string } | null };
    if (this.gateway.name !== 'mock' || !g.complete) throw Errors.notFound();
    return this.prisma.billingPayment.findFirst({ where: { businessId: t.businessId, gatewayOrderId: orderId } }).then((row) => {
      const r = row ? g.complete!(orderId) : null;
      if (!r) throw Errors.notFound();
      return { orderId, ...r };
    });
  }

  /** Checkout success callback. Signature check first; nothing changes on a bad signature. */
  async verify(t: TenantContext, userId: string, input: { orderId: string; paymentId: string; signature: string }, ctx: RequestContext) {
    const row = await this.prisma.billingPayment.findFirst({ where: { businessId: t.businessId, gatewayOrderId: input.orderId } });
    if (!row) throw Errors.notFound();
    if (!this.gateway.verifyPaymentSignature(input.orderId, input.paymentId, input.signature)) {
      this.logger.warn({ billingPaymentId: row.id }, 'billing.verify.bad_signature');
      throw new AppError(400, 'PAYMENT_VERIFICATION_FAILED');
    }
    await this.activate(row.id, input.paymentId, { source: 'checkout', actorUserId: userId, ctx });
    return this.overview(t);
  }

  /**
   * Applies a verified payment exactly once. Locks the billing row so the Checkout callback and the
   * webhook (which often arrive together) cannot both extend the period.
   */
  async activate(billingPaymentId: string, gatewayPaymentId: string, opts: { source: 'checkout' | 'webhook'; actorUserId?: string | null; ctx?: RequestContext }) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BillingPayment" WHERE id = ${billingPaymentId}::uuid FOR UPDATE`;
      const row = await tx.billingPayment.findUniqueOrThrow({ where: { id: billingPaymentId }, include: { plan: true } });
      if (row.status === 'SUCCEEDED') return { applied: false as const, businessId: row.businessId };
      // Lock the subscription too: two different paid orders must apply one after the other.
      await tx.$queryRaw`SELECT id FROM "Subscription" WHERE id = ${row.subscriptionId}::uuid FOR UPDATE`;
      const sub = await this.loadSub(tx, row.businessId);
      const now = new Date();
      const target = { code: row.plan.code, price: row.plan.priceMonthly };
      let period: ReturnType<typeof computePeriod>;
      if (classifyChange(this.state(sub), target, now) === 'DOWNGRADE') {
        // A smaller plan's order paid while a bigger plan is live (e.g. an old checkout tab completed late).
        // The money is never lost: it buys equal-value time on the current plan, appended to the period.
        const start = sub.currentPeriodEnd!;
        const ms = new Prisma.Decimal(this.env.BILLING_PERIOD_DAYS * 86_400_000).mul(row.plan.priceMonthly).div(sub.plan.priceMonthly);
        const creditMs = Math.floor(ms.toNumber() / 60_000) * 60_000;
        period = { kind: 'DOWNGRADE', start, end: new Date(start.getTime() + creditMs), creditMs };
      } else {
        period = computePeriod(this.state(sub), target, now, this.env.BILLING_PERIOD_DAYS);
      }

      const keepPlan = period.kind === 'DOWNGRADE';
      await tx.subscription.update({
        where: { id: sub.id },
        data: keepPlan
          ? { currentPeriodEnd: period.end, cancelAtPeriodEnd: false }
          : {
              planId: row.planId,
              status: 'ACTIVE',
              currentPeriodStart: period.kind === 'RENEWAL' ? sub.currentPeriodStart : period.start,
              currentPeriodEnd: period.end,
              cancelAtPeriodEnd: false,
              pendingPlanId: null,
            },
      });
      await tx.billingPayment.update({
        where: { id: row.id },
        data: { status: 'SUCCEEDED', gatewayPaymentId, verifiedAt: now, periodStart: period.start, periodEnd: period.end, failureReason: null },
      });
      const eventType = { NEW: sub.status === 'TRIALING' ? 'ACTIVATED' : 'REACTIVATED', RENEWAL: 'RENEWED', UPGRADE: 'UPGRADED', DOWNGRADE: 'CREDITED' }[period.kind];
      await tx.subscriptionEvent.create({
        data: {
          businessId: row.businessId,
          subscriptionId: sub.id,
          eventType,
          fromStatus: sub.status,
          toStatus: 'ACTIVE',
          fromPlanCode: sub.plan.code,
          toPlanCode: keepPlan ? sub.plan.code : row.plan.code,
          actorUserId: opts.actorUserId ?? null,
          metadata: { billingPaymentId: row.id, gatewayPaymentId, source: opts.source, periodStart: period.start, periodEnd: period.end, creditMinutes: period.creditMs / 60_000 },
        },
      });
      await writeAudit(tx, {
        businessId: row.businessId,
        actorUserId: opts.actorUserId ?? null,
        action: 'UPDATE',
        entityType: 'Subscription',
        entityId: sub.id,
        before: { planCode: sub.plan.code, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd },
        after: { planCode: keepPlan ? sub.plan.code : row.plan.code, status: 'ACTIVE', currentPeriodEnd: period.end, via: opts.source },
      }, opts.ctx);
      return { applied: true as const, businessId: row.businessId };
    });
    if (result.applied) {
      this.cache.invalidate({ businessId: result.businessId });
      this.logger.info({ billingPaymentId, source: opts.source }, 'billing.activated');
    }
    return result;
  }

  // ---------------------------------------------------------------- plan changes without payment

  /** Smaller plan from the renewal date. Blocked if active staff exceed the new limit. */
  async scheduleDowngrade(t: TenantContext, userId: string, planCode: string, ctx: RequestContext) {
    const [plan, sub] = await Promise.all([this.prisma.subscriptionPlan.findUnique({ where: { code: planCode } }), this.loadSub(this.prisma, t.businessId)]);
    if (!plan || !plan.isActive) throw Errors.unprocessable('PLAN_NOT_AVAILABLE');
    if (!hasLivePaidPeriod(this.state(sub), new Date())) throw Errors.unprocessable('NO_ACTIVE_PAID_PLAN');
    if (!plan.priceMonthly.lt(sub.plan.priceMonthly)) throw Errors.unprocessable('PLAN_NOT_AVAILABLE', { reason: 'not_a_downgrade' });
    const staff = await this.prisma.businessMembership.count({ where: { businessId: t.businessId, status: 'ACTIVE' } });
    if (plan.maxStaffUsers !== null && staff > plan.maxStaffUsers) throw Errors.unprocessable('DOWNGRADE_BLOCKED_STAFF', { activeStaff: staff, limit: plan.maxStaffUsers });
    const farmers = await this.prisma.farmer.count({ where: { businessId: t.businessId, deletedAt: null } });

    await this.prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: plan.id } });
      await tx.subscriptionEvent.create({ data: { businessId: t.businessId, subscriptionId: sub.id, eventType: 'DOWNGRADE_SCHEDULED', fromPlanCode: sub.plan.code, toPlanCode: plan.code, actorUserId: userId, metadata: { effectiveAt: sub.currentPeriodEnd } } });
      await writeAudit(tx, { businessId: t.businessId, actorUserId: userId, action: 'UPDATE', entityType: 'Subscription', entityId: sub.id, before: { pendingPlan: sub.pendingPlan?.code ?? null }, after: { pendingPlan: plan.code } }, ctx);
    });
    this.cache.invalidate({ businessId: t.businessId });
    const warnings = plan.maxFarmers !== null && farmers > plan.maxFarmers ? [{ resource: 'farmers', count: farmers, limit: plan.maxFarmers }] : [];
    return { ...(await this.overview(t)), warnings };
  }

  async clearPendingPlan(t: TenantContext, userId: string, ctx: RequestContext) {
    const sub = await this.loadSub(this.prisma, t.businessId);
    if (sub.pendingPlanId) {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { pendingPlanId: null } });
        await tx.subscriptionEvent.create({ data: { businessId: t.businessId, subscriptionId: sub.id, eventType: 'DOWNGRADE_CANCELLED', fromPlanCode: sub.plan.code, toPlanCode: sub.pendingPlan?.code ?? null, actorUserId: userId } });
        await writeAudit(tx, { businessId: t.businessId, actorUserId: userId, action: 'UPDATE', entityType: 'Subscription', entityId: sub.id, before: { pendingPlan: sub.pendingPlan?.code }, after: { pendingPlan: null } }, ctx);
      });
    }
    return this.overview(t);
  }

  /** Stop at period end (no further renewal reminders). Data stays readable afterwards. */
  async setCancelAtPeriodEnd(t: TenantContext, userId: string, cancel: boolean, ctx: RequestContext) {
    const sub = await this.loadSub(this.prisma, t.businessId);
    if (!hasLivePaidPeriod(this.state(sub), new Date())) throw Errors.unprocessable('NO_ACTIVE_PAID_PLAN');
    if (sub.cancelAtPeriodEnd !== cancel) {
      await this.prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: cancel } });
        await tx.subscriptionEvent.create({ data: { businessId: t.businessId, subscriptionId: sub.id, eventType: cancel ? 'CANCEL_SCHEDULED' : 'CANCEL_REVOKED', actorUserId: userId, metadata: { effectiveAt: sub.currentPeriodEnd } } });
        await writeAudit(tx, { businessId: t.businessId, actorUserId: userId, action: 'UPDATE', entityType: 'Subscription', entityId: sub.id, before: { cancelAtPeriodEnd: sub.cancelAtPeriodEnd }, after: { cancelAtPeriodEnd: cancel } }, ctx);
      });
    }
    return this.overview(t);
  }

  // ---------------------------------------------------------------- history & receipt

  payments(t: TenantContext) {
    return this.prisma.billingPayment.findMany({
      where: { businessId: t.businessId, status: { in: ['SUCCEEDED', 'FAILED', 'REFUNDED', 'PENDING'] } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: { id: true, amount: true, currency: true, status: true, gatewayOrderId: true, gatewayPaymentId: true, verifiedAt: true, periodStart: true, periodEnd: true, failureReason: true, createdAt: true, plan: { select: { code: true, name: true, nameHindi: true } } },
    });
  }

  async receiptHtml(t: TenantContext, id: string) {
    const p = await this.prisma.billingPayment.findFirst({ where: { id, businessId: t.businessId, status: 'SUCCEEDED' }, include: { plan: true, business: true } });
    if (!p) throw Errors.notFound();
    const d = (x: Date | null) => (x ? x.toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }) : '');
    const b = p.business;
    const addr = [b.addressLine, b.city, b.district, b.state, b.pincode].filter((v, i, a) => v && a.indexOf(v) === i).join(', ');
    const rows: [string, string][] = [
      ['प्लान / Plan', `${p.plan.nameHindi ?? ''} ${p.plan.name}`.trim()],
      ['अवधि / Period', `${d(p.periodStart)} – ${d(p.periodEnd)}`],
      ['भुगतान तिथि / Paid on', d(p.verifiedAt)],
      ['भुगतान आईडी / Payment ID', p.gatewayPaymentId ?? ''],
      ['ऑर्डर आईडी / Order ID', p.gatewayOrderId],
    ];
    const html = `<!doctype html><html lang="hi"><head><meta charset="utf-8"><title>Receipt ${esc(p.gatewayPaymentId ?? p.id)}</title>
<style>body{font-family:'Noto Sans Devanagari','Noto Sans',system-ui,sans-serif;color:#111;margin:0;padding:32px;font-size:14px}
.box{max-width:640px;margin:0 auto;border:1px solid #ccc;padding:28px}h1{font-size:20px;margin:0 0 4px}.muted{color:#555}
table{width:100%;border-collapse:collapse;margin-top:18px}td{padding:8px 4px;border-bottom:1px solid #eee;vertical-align:top}
td:first-child{color:#555;width:45%}.total{font-size:18px;font-weight:700;margin-top:18px;text-align:right}
@media print{body{padding:0}.box{border:0}}</style></head><body><div class="box">
<h1>MandiMitra AI — भुगतान रसीद / Payment receipt</h1>
<div class="muted">सदस्यता शुल्क / Subscription fee</div>
<p><strong>${esc(b.name)}</strong>${b.nameHindi ? ` (${esc(b.nameHindi)})` : ''}<br>${esc(addr)}${b.gstin ? `<br>GSTIN: ${esc(b.gstin)}` : ''}</p>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
<div class="total">राशि / Amount: ${rupees(p.amount.toFixed(2))}</div>
<p class="muted" style="margin-top:24px;font-size:12px">This is a payment receipt, not a tax invoice.</p>
</div></body></html>`;
    return { html, fileName: `mandimitra-receipt-${(p.verifiedAt ?? p.createdAt).toISOString().slice(0, 10)}.html` };
  }

  // ---------------------------------------------------------------- webhook

  /**
   * Razorpay webhook. Signature verified by the caller over the raw bytes. Handles payment.captured /
   * order.paid (activate) and payment.failed. De-duplicated by X-Razorpay-Event-Id.
   */
  async handleWebhook(eventId: string, payload: unknown): Promise<{ processed: boolean; reason?: string }> {
    const p = payload as {
      event?: string;
      payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string; error_description?: string } }; order?: { entity?: { id?: string } } };
    };
    const event = p.event ?? 'unknown';
    try {
      await this.prisma.webhookEvent.create({ data: { provider: 'razorpay', eventId: eventId.slice(0, 120), eventType: event.slice(0, 80), payload: payload as Prisma.InputJsonValue } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { processed: false, reason: 'duplicate' };
      throw e;
    }

    const done = (reason?: string) =>
      this.prisma.webhookEvent
        .update({ where: { provider_eventId: { provider: 'razorpay', eventId: eventId.slice(0, 120) } }, data: { processedAt: new Date(), error: reason ?? null } })
        .then(() => ({ processed: !reason, ...(reason ? { reason } : {}) }));

    const pay = p.payload?.payment?.entity;
    const orderId = pay?.order_id ?? p.payload?.order?.entity?.id;
    if (!orderId) return done('no_order');
    const row = await this.prisma.billingPayment.findUnique({ where: { gatewayOrderId: orderId } });
    if (!row) return done('unknown_order');

    if (event === 'payment.captured' || event === 'order.paid') {
      if (!pay?.id) return done('no_payment');
      // Defence in depth: the captured amount must equal what this server asked for.
      if (pay.amount !== toPaise(row.amount) || (pay.currency && pay.currency !== row.currency)) {
        this.logger.error({ billingPaymentId: row.id, amount: pay.amount }, 'billing.webhook.amount_mismatch');
        await this.prisma.billingPayment.update({ where: { id: row.id }, data: { failureReason: `amount mismatch: got ${pay.amount}` } });
        return done('amount_mismatch');
      }
      await this.activate(row.id, pay.id, { source: 'webhook' });
      return done();
    }
    if (event === 'payment.failed') {
      if (row.status !== 'SUCCEEDED') {
        await this.prisma.billingPayment.update({ where: { id: row.id }, data: { status: 'FAILED', failureReason: (pay?.error_description ?? 'failed').slice(0, 300), gatewayPaymentId: row.gatewayPaymentId ?? null } });
      }
      return done();
    }
    return done('ignored_event');
  }
}
