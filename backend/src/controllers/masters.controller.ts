import type { Request, Response } from 'express';
import type { BuyerListQuery, DateRangeQuery, FarmerListQuery } from '@mandimitra/shared';
import type { BuyerService } from '../services/buyer.service.ts';
import type { CommodityService } from '../services/commodity.service.ts';
import type { DashboardService } from '../services/dashboard.service.ts';
import type { FarmerService } from '../services/farmer.service.ts';
import { ok, requestContext } from '../utils/http.ts';

const params = <T>(req: Request) => req.validated.params as T;
type Id = { id: string };
type IdSub = { id: string; subId: string };

export class FarmerController {
  constructor(private readonly farmers: FarmerService) {}

  list = async (req: Request, res: Response) => {
    const q = req.validated.query as FarmerListQuery;
    const { items, total } = await this.farmers.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  villages = async (req: Request, res: Response) => ok(res, await this.farmers.villages(req.tenant!));
  get = async (req: Request, res: Response) => ok(res, await this.farmers.get(req.tenant!, params<Id>(req).id));
  summary = async (req: Request, res: Response) => ok(res, await this.farmers.summary(req.tenant!, params<Id>(req).id));
  create = async (req: Request, res: Response) => {
    const r = await this.farmers.create(req.tenant!, req.auth!.userId, req.body, requestContext(req));
    ok(res, r.farmer, 201, { warnings: r.warnings });
  };
  update = async (req: Request, res: Response) =>
    ok(res, await this.farmers.update(req.tenant!, req.auth!.userId, params<Id>(req).id, req.body, requestContext(req)));
  remove = async (req: Request, res: Response) => {
    await this.farmers.remove(req.tenant!, req.auth!.userId, params<Id>(req).id, requestContext(req));
    res.status(204).end();
  };
  listBank = async (req: Request, res: Response) => ok(res, await this.farmers.listBankAccounts(req.tenant!, params<Id>(req).id));
  addBank = async (req: Request, res: Response) =>
    ok(res, await this.farmers.addBankAccount(req.tenant!, req.auth!.userId, params<Id>(req).id, req.body, requestContext(req)), 201);
  revealBank = async (req: Request, res: Response) => {
    const p = params<IdSub>(req);
    res.setHeader('cache-control', 'no-store');
    ok(res, await this.farmers.revealBankAccount(req.tenant!, req.auth!.userId, p.id, p.subId, requestContext(req)));
  };
  removeBank = async (req: Request, res: Response) => {
    const p = params<IdSub>(req);
    await this.farmers.removeBankAccount(req.tenant!, req.auth!.userId, p.id, p.subId, requestContext(req));
    res.status(204).end();
  };
}

export class BuyerController {
  constructor(private readonly buyers: BuyerService) {}

  list = async (req: Request, res: Response) => {
    const q = req.validated.query as BuyerListQuery;
    const { items, total } = await this.buyers.list(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
  get = async (req: Request, res: Response) => ok(res, await this.buyers.get(req.tenant!, params<Id>(req).id));
  summary = async (req: Request, res: Response) => ok(res, await this.buyers.summary(req.tenant!, params<Id>(req).id));
  create = async (req: Request, res: Response) => {
    const r = await this.buyers.create(req.tenant!, req.auth!.userId, req.body, requestContext(req));
    ok(res, r.buyer, 201, { warnings: r.warnings });
  };
  update = async (req: Request, res: Response) =>
    ok(res, await this.buyers.update(req.tenant!, req.auth!.userId, params<Id>(req).id, req.body, requestContext(req)));
  remove = async (req: Request, res: Response) => {
    await this.buyers.remove(req.tenant!, req.auth!.userId, params<Id>(req).id, requestContext(req));
    res.status(204).end();
  };
}

export class CommodityController {
  constructor(private readonly commodities: CommodityService) {}

  list = async (req: Request, res: Response) => {
    const { includeInactive } = req.validated.query as { includeInactive?: boolean };
    ok(res, await this.commodities.list(req.tenant!, includeInactive ?? false));
  };
  get = async (req: Request, res: Response) => ok(res, await this.commodities.get(req.tenant!, params<Id>(req).id));
  create = async (req: Request, res: Response) =>
    ok(res, await this.commodities.create(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  update = async (req: Request, res: Response) =>
    ok(res, await this.commodities.update(req.tenant!, req.auth!.userId, params<Id>(req).id, req.body, requestContext(req)));
  addGrade = async (req: Request, res: Response) =>
    ok(res, await this.commodities.addGrade(req.tenant!, req.auth!.userId, params<Id>(req).id, req.body.name, requestContext(req)), 201);
  updateGrade = async (req: Request, res: Response) => {
    const p = params<IdSub>(req);
    ok(res, await this.commodities.setGradeActive(req.tenant!, req.auth!.userId, p.id, p.subId, req.body.isActive, requestContext(req)));
  };
}

export class ReportController {
  constructor(private readonly dashboard: DashboardService) {}

  dashboardSummary = async (req: Request, res: Response) =>
    ok(res, await this.dashboard.get(req.tenant!, req.validated.query as DateRangeQuery));
}
