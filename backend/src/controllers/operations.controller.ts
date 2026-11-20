import type { Request, Response } from 'express';
import type { LotListQuery, PattiListQuery, TxnListQuery } from '@mandimitra/shared';
import type { ApprovalService, CancellableEntity } from '../services/approval.service.ts';
import { amountFor, lotNetKg, toKg } from '../services/calculation/engine.ts';
import type { LotService } from '../services/lot.service.ts';
import { mapCalcError } from '../services/lot.service.ts';
import type { PattiService } from '../services/patti/patti.service.ts';
import type { RuleService } from '../services/rule.service.ts';
import type { TradeService } from '../services/trade.service.ts';
import { Errors } from '../utils/errors.ts';
import { ok, requestContext } from '../utils/http.ts';

const id = (req: Request) => (req.validated.params as { id: string }).id;

export class OperationsController {
  constructor(
    private readonly lots: LotService,
    private readonly trade: TradeService,
    private readonly patti: PattiService,
    private readonly rules: RuleService,
    private readonly approvals: ApprovalService,
  ) {}

  /** Shared cancel endpoint: 200 when cancelled, 202 when sent to the owner for approval. */
  private cancel = (entity: CancellableEntity) => async (req: Request, res: Response) => {
    const r = await this.approvals.cancelOrRequest(req.tenant!, req.auth!.userId, entity, id(req), req.body.reason, requestContext(req));
    if (r.status === 'PENDING_APPROVAL') ok(res, { status: r.status, approvalRequest: r.result }, 202);
    else ok(res, { status: r.status, record: r.result });
  };

  // ---------------------------------------------------------------- lots
  listLots = async (req: Request, res: Response) => {
    const q = req.validated.query as LotListQuery;
    const { items, total } = await this.lots.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  getLot = async (req: Request, res: Response) => ok(res, await this.lots.get(req.tenant!, id(req)));
  createLot = async (req: Request, res: Response) => ok(res, await this.lots.create(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  updateLot = async (req: Request, res: Response) => ok(res, await this.lots.update(req.tenant!, req.auth!.userId, id(req), req.body, requestContext(req)));
  confirmLot = async (req: Request, res: Response) => ok(res, await this.lots.confirm(req.tenant!, req.auth!.userId, id(req), requestContext(req)));
  cancelLot = this.cancel('Lot');

  // ---------------------------------------------------------------- sales / purchases
  listSales = async (req: Request, res: Response) => {
    const q = req.validated.query as TxnListQuery;
    const { items, total, totals } = await this.trade.listSales(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total, totals });
  };
  getSale = async (req: Request, res: Response) => ok(res, await this.trade.getSale(req.tenant!, id(req)));
  createSale = async (req: Request, res: Response) => ok(res, await this.trade.createSale(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  cancelSale = this.cancel('Sale');
  listPurchases = async (req: Request, res: Response) => {
    const q = req.validated.query as TxnListQuery;
    const { items, total, totals } = await this.trade.listPurchases(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total, totals });
  };
  createPurchase = async (req: Request, res: Response) => ok(res, await this.trade.createPurchase(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  cancelPurchase = this.cancel('Purchase');

  // ---------------------------------------------------------------- patti
  listPatti = async (req: Request, res: Response) => {
    const q = req.validated.query as PattiListQuery;
    const { items, total } = await this.patti.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  previewPatti = async (req: Request, res: Response) => ok(res, await this.patti.preview(req.tenant!, req.body));
  createPatti = async (req: Request, res: Response) => ok(res, await this.patti.create(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  getPatti = async (req: Request, res: Response) => ok(res, await this.patti.get(req.tenant!, id(req)));
  cancelPatti = this.cancel('Patti');
  printPatti = async (req: Request, res: Response) => {
    const html = await this.patti.html(req.tenant!, id(req), req.query.print === '1');
    res
      .status(200)
      .type('html')
      .setHeader('cache-control', 'private, no-store')
      // Self-contained page: inline styles + one inline print script; nothing else may load.
      .setHeader('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'")
      .send(html);
  };
  pdfPatti = async (req: Request, res: Response) => {
    const { buffer, fileName } = await this.patti.pdfBuffer(req.tenant!, id(req));
    res
      .status(200)
      .type('application/pdf')
      .setHeader('cache-control', 'private, no-store')
      .setHeader('content-disposition', `${req.query.download === '1' ? 'attachment' : 'inline'}; filename="${fileName}"`)
      .send(buffer);
  };

  // ---------------------------------------------------------------- rules
  listRules = async (req: Request, res: Response) => {
    const { appliesTo } = req.validated.query as { appliesTo?: 'FARMER' | 'BUYER' };
    ok(res, await this.rules.list(req.tenant!, appliesTo));
  };
  createRule = async (req: Request, res: Response) => ok(res, await this.rules.create(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  updateRule = async (req: Request, res: Response) => ok(res, await this.rules.update(req.tenant!, req.auth!.userId, id(req), req.body, requestContext(req)));

  // ---------------------------------------------------------------- calculators (stateless)
  calcAmount = async (req: Request, res: Response) => {
    const b = req.body as { quantity: string; unit: 'KG' | 'QUINTAL' | 'TON' | 'BAG'; rate: string; rateUnit: 'KG' | 'QUINTAL' | 'TON' | 'BAG'; commodityId?: string };
    let bagWeightKg = null;
    if (b.commodityId) {
      const c = await req.tenant!.db.commodity.findUnique({ where: { id: b.commodityId }, select: { bagWeightKg: true } });
      if (!c) throw Errors.notFound();
      bagWeightKg = c.bagWeightKg;
    }
    try {
      const weightKg = toKg(b.quantity, b.unit, bagWeightKg);
      ok(res, { weightKg, amount: amountFor(weightKg, b.rate, b.rateUnit, bagWeightKg) });
    } catch (e) {
      mapCalcError(e);
    }
  };
  calcSale = async (req: Request, res: Response) => ok(res, await this.trade.previewSale(req.tenant!, req.body));
  calcLot = async (req: Request, res: Response) => {
    const b = req.body as { weightUnit: 'KG' | 'QUINTAL'; grossWeight: string; tareWeight: string };
    try {
      const grossKg = toKg(b.grossWeight, b.weightUnit);
      const tareKg = toKg(b.tareWeight, b.weightUnit);
      ok(res, { grossWeightKg: grossKg, tareWeightKg: tareKg, netWeightKg: lotNetKg(grossKg, tareKg) });
    } catch (e) {
      mapCalcError(e);
    }
  };

  // ---------------------------------------------------------------- approvals
  listApprovals = async (req: Request, res: Response) => {
    const q = req.validated.query as { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; page: number; pageSize: number };
    const { items, total } = await this.approvals.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  approve = async (req: Request, res: Response) => ok(res, await this.approvals.approve(req.tenant!, req.auth!.userId, id(req), req.body.note, requestContext(req)));
  reject = async (req: Request, res: Response) => ok(res, await this.approvals.reject(req.tenant!, req.auth!.userId, id(req), req.body.note, requestContext(req)));
}
