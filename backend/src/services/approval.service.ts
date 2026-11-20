import type { Prisma, PrismaClient } from '@mandimitra/database';
import type { PermissionKey } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';

export type CancellableEntity = 'Lot' | 'Sale' | 'Purchase' | 'Patti' | 'Payment' | 'Expense';
type Tx = Prisma.TransactionClient;

/** Executes a cancellation inside a caller-provided transaction. */
export type CancelExecutor = (tx: Tx, t: TenantContext, actorUserId: string, entityId: string, reason: string, ctx: RequestContext) => Promise<unknown>;

const CANCEL_PERMISSION: Record<CancellableEntity, PermissionKey> = {
  Lot: 'lot:cancel',
  Sale: 'sale:cancel',
  Purchase: 'purchase:cancel',
  Patti: 'patti:cancel',
  Payment: 'payment:cancel',
  Expense: 'expense:cancel',
};

export class ApprovalService {
  private readonly executors = new Map<CancellableEntity, CancelExecutor>();

  constructor(private readonly prisma: PrismaClient) {}

  register(entity: CancellableEntity, exec: CancelExecutor) {
    this.executors.set(entity, exec);
  }

  /**
   * One entry point for every cancel button:
   *  - has `<entity>:cancel`                         → cancel now
   *  - has `approval:request` and approval required → create a pending request for the owner (202)
   *  - has `approval:request`, approval NOT required → cancel now (business opted out of the 4-eyes rule)
   */
  async cancelOrRequest(t: TenantContext, actorUserId: string, entity: CancellableEntity, entityId: string, reason: string, ctx: RequestContext) {
    const exec = this.executors.get(entity)!;
    if (t.permissions.has(CANCEL_PERMISSION[entity])) {
      return { status: 'CANCELLED' as const, result: await this.prisma.$transaction((tx) => exec(tx, t, actorUserId, entityId, reason, ctx)) };
    }
    if (!t.permissions.has('approval:request')) throw Errors.forbidden('FORBIDDEN', { missing: [CANCEL_PERMISSION[entity]] });

    const settings = await this.prisma.businessSettings.findUnique({ where: { businessId: t.businessId }, select: { requireApprovalForCancel: true } });
    if (!settings?.requireApprovalForCancel) {
      return { status: 'CANCELLED' as const, result: await this.prisma.$transaction((tx) => exec(tx, t, actorUserId, entityId, reason, ctx)) };
    }
    return { status: 'PENDING_APPROVAL' as const, result: await this.createRequest(t, actorUserId, entity, entityId, reason, ctx) };
  }

  private async createRequest(t: TenantContext, actorUserId: string, entity: CancellableEntity, entityId: string, reason: string, ctx: RequestContext) {
    await this.assertEntityExists(t, entity, entityId);
    const pending = await t.db.approvalRequest.count({ where: { entityType: entity, entityId, status: 'PENDING' } });
    if (pending) throw Errors.conflict('APPROVAL_ALREADY_PENDING');

    return this.prisma.$transaction(async (tx) => {
      const req = await tx.approvalRequest.create({
        data: { businessId: t.businessId, entityType: entity, entityId, action: 'CANCEL', reason, requestedById: actorUserId },
      });
      const approvers = await tx.businessMembership.findMany({
        where: { businessId: t.businessId, status: 'ACTIVE', role: { permissions: { some: { permission: { key: 'approval:decide' } } } } },
        select: { userId: true },
      });
      if (approvers.length) {
        await tx.notification.createMany({
          data: approvers.map((a) => ({
            businessId: t.businessId,
            userId: a.userId,
            type: 'APPROVAL_PENDING',
            title: `Cancellation requested: ${entity}`,
            body: reason.slice(0, 500),
            link: '/staff?tab=approvals',
          })),
        });
      }
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'ApprovalRequest', entityId: req.id, after: { entity, entityId, reason } }, ctx);
      return req;
    });
  }

  private async assertEntityExists(t: TenantContext, entity: CancellableEntity, id: string) {
    const counters: Record<CancellableEntity, () => Promise<number>> = {
      Lot: () => t.db.lot.count({ where: { id } }),
      Sale: () => t.db.sale.count({ where: { id } }),
      Purchase: () => t.db.purchase.count({ where: { id } }),
      Patti: () => t.db.patti.count({ where: { id } }),
      Payment: () => t.db.payment.count({ where: { id } }),
      Expense: () => t.db.expense.count({ where: { id } }),
    };
    const found = await counters[entity]();
    if (!found) throw Errors.notFound();
  }

  async list(t: TenantContext, q: { status?: 'PENDING' | 'APPROVED' | 'REJECTED'; page: number; pageSize: number }) {
    const where = q.status ? { status: q.status } : {};
    const [items, total] = await Promise.all([
      t.db.approvalRequest.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        include: { requestedBy: { select: { id: true, fullName: true } }, decidedBy: { select: { id: true, fullName: true } } },
      }),
      t.db.approvalRequest.count({ where }),
    ]);
    return { items, total };
  }

  /** Approve = claim the request and run the cancellation in ONE transaction; either both happen or neither. */
  async approve(t: TenantContext, actorUserId: string, id: string, note: string | undefined, ctx: RequestContext) {
    return this.prisma.$transaction(async (tx) => {
      const req = await tx.approvalRequest.findFirst({ where: { id, businessId: t.businessId } });
      if (!req) throw Errors.notFound();
      const claimed = await tx.approvalRequest.updateMany({
        where: { id, businessId: t.businessId, status: 'PENDING' },
        data: { status: 'APPROVED', decidedById: actorUserId, decidedAt: new Date(), decisionNote: note ?? null },
      });
      if (claimed.count === 0) throw Errors.unprocessable('APPROVAL_NOT_PENDING');
      const exec = this.executors.get(req.entityType as CancellableEntity);
      if (!exec) throw Errors.internal();
      const result = await exec(tx, t, actorUserId, req.entityId, `${req.reason} (approved request ${req.id})`, ctx);
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'APPROVE', entityType: 'ApprovalRequest', entityId: id, after: { entityType: req.entityType, entityId: req.entityId, note } }, ctx);
      return { request: { ...req, status: 'APPROVED' }, result };
    });
  }

  async reject(t: TenantContext, actorUserId: string, id: string, note: string | undefined, ctx: RequestContext) {
    const res = await t.db.approvalRequest.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'REJECTED', decidedById: actorUserId, decidedAt: new Date(), decisionNote: note ?? null },
    });
    if (res.count === 0) {
      if (!(await t.db.approvalRequest.count({ where: { id } }))) throw Errors.notFound();
      throw Errors.unprocessable('APPROVAL_NOT_PENDING');
    }
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'REJECT', entityType: 'ApprovalRequest', entityId: id, after: { note } }, ctx);
    return t.db.approvalRequest.findUniqueOrThrow({ where: { id } });
  }
}
