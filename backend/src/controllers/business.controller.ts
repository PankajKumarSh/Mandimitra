import type { Request, Response } from 'express';
import type { BusinessService } from '../services/business.service.ts';
import { ok, requestContext } from '../utils/http.ts';

export class BusinessController {
  constructor(private readonly businesses: BusinessService) {}

  getCurrent = async (req: Request, res: Response) => {
    ok(res, await this.businesses.getCurrent(req.tenant!.businessId));
  };

  updateCurrent = async (req: Request, res: Response) => {
    ok(res, await this.businesses.updateCurrent(req.tenant!.businessId, req.auth!.userId, req.body, requestContext(req)));
  };

  getSettings = async (req: Request, res: Response) => {
    ok(res, await this.businesses.getSettings(req.tenant!.businessId));
  };

  updateSettings = async (req: Request, res: Response) => {
    ok(res, await this.businesses.updateSettings(req.tenant!.businessId, req.auth!.userId, req.body, requestContext(req)));
  };
}
