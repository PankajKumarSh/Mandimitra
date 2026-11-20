import type { Request, Response } from 'express';
import type { StaffService } from '../services/staff.service.ts';
import { ok, requestContext } from '../utils/http.ts';

type IdParams = { id: string };
type AuditQuery = { entityType?: string; entityId?: string; actorUserId?: string; page: number; pageSize: number };

export class StaffController {
  constructor(private readonly staff: StaffService) {}

  list = async (req: Request, res: Response) => {
    ok(res, await this.staff.list(req.tenant!));
  };

  roles = async (req: Request, res: Response) => {
    ok(res, await this.staff.listRoles(req.tenant!.businessId));
  };

  createInvite = async (req: Request, res: Response) => {
    ok(res, await this.staff.createInvite(req.tenant!, req.auth!.userId, req.body, requestContext(req)), 201);
  };

  revokeInvite = async (req: Request, res: Response) => {
    const { id } = req.validated.params as IdParams;
    await this.staff.revokeInvite(req.tenant!, req.auth!.userId, id, requestContext(req));
    res.status(204).end();
  };

  updateMembership = async (req: Request, res: Response) => {
    const { id } = req.validated.params as IdParams;
    ok(res, await this.staff.updateMembership(req.tenant!, req.auth!.userId, id, req.body, requestContext(req)));
  };

  activity = async (req: Request, res: Response) => {
    const { id } = req.validated.params as IdParams;
    ok(res, await this.staff.activity(req.tenant!, id));
  };

  auditLog = async (req: Request, res: Response) => {
    const q = req.validated.query as AuditQuery;
    const { items, total } = await this.staff.auditLog(req.tenant!, q);
    ok(res, items, 200, { page: q.page, pageSize: q.pageSize, total });
  };
}
