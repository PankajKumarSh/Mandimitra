import { createHash } from 'node:crypto';
import type { Request, Response } from 'express';
import type { AdminService } from '../services/admin.service.ts';
import type { BillingService } from '../services/billing/billing.service.ts';
import type { PaymentGateway } from '../services/billing/gateway.ts';
import { ok, requestContext } from '../utils/http.ts';

const id = (req: Request) => (req.validated.params as { id: string }).id;

export class BillingController {
  constructor(
    private readonly billing: BillingService,
    private readonly gateway: PaymentGateway,
  ) {}

  plans = async (_req: Request, res: Response) => ok(res, await this.billing.plans(), 200, { provider: this.billing.provider });
  overview = async (req: Request, res: Response) => ok(res, await this.billing.overview(req.tenant!));
  checkout = async (req: Request, res: Response) => ok(res, await this.billing.checkout(req.tenant!, req.auth!.userId, req.body.planCode, requestContext(req)), 201);
  verify = async (req: Request, res: Response) => ok(res, await this.billing.verify(req.tenant!, req.auth!.userId, req.body, requestContext(req)));
  mockComplete = async (req: Request, res: Response) => ok(res, await this.billing.mockComplete(req.tenant!, req.body.orderId));
  scheduleDowngrade = async (req: Request, res: Response) => ok(res, await this.billing.scheduleDowngrade(req.tenant!, req.auth!.userId, req.body.planCode, requestContext(req)));
  clearPendingPlan = async (req: Request, res: Response) => ok(res, await this.billing.clearPendingPlan(req.tenant!, req.auth!.userId, requestContext(req)));
  cancel = async (req: Request, res: Response) => ok(res, await this.billing.setCancelAtPeriodEnd(req.tenant!, req.auth!.userId, true, requestContext(req)));
  resume = async (req: Request, res: Response) => ok(res, await this.billing.setCancelAtPeriodEnd(req.tenant!, req.auth!.userId, false, requestContext(req)));
  payments = async (req: Request, res: Response) => ok(res, await this.billing.payments(req.tenant!));
  receipt = async (req: Request, res: Response) => {
    const r = await this.billing.receiptHtml(req.tenant!, id(req));
    res.status(200).type('html').set('cache-control', 'private, no-store').send(r.html);
  };

  /** Razorpay webhook: no session; authenticated by X-Razorpay-Signature over the raw body. */
  webhook = async (req: Request, res: Response) => {
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!this.gateway.verifyWebhookSignature(raw, req.get('x-razorpay-signature'))) return res.status(401).end();
    const eventId = req.get('x-razorpay-event-id') ?? `sha256:${createHash('sha256').update(raw!).digest('hex')}`;
    const r = await this.billing.handleWebhook(eventId, req.body);
    res.status(200).json({ ok: true, ...r });
  };
}

export class AdminController {
  constructor(private readonly admin: AdminService) {}

  overview = async (_req: Request, res: Response) => ok(res, await this.admin.overview());
  businesses = async (req: Request, res: Response) => {
    const q = req.validated.query as Parameters<AdminService['listBusinesses']>[0];
    const [items, total] = await this.admin.listBusinesses(q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  business = async (req: Request, res: Response) => ok(res, await this.admin.getBusiness(id(req)));
  suspend = async (req: Request, res: Response) => ok(res, await this.admin.setSuspended(req.auth!.userId, id(req), true, req.body.reason, requestContext(req)));
  reactivate = async (req: Request, res: Response) => ok(res, await this.admin.setSuspended(req.auth!.userId, id(req), false, null, requestContext(req)));
  extend = async (req: Request, res: Response) => ok(res, await this.admin.extend(req.auth!.userId, id(req), req.body.days, req.body.reason, requestContext(req)));
  payments = async (req: Request, res: Response) => {
    const q = req.validated.query as { page: number; pageSize: number; status?: string };
    const [items, total] = await this.admin.listPayments(q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
}
