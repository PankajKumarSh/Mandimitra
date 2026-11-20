import type { PrismaClient } from '@mandimitra/database';

/**
 * Tenant-scoped Prisma client.
 *
 * Every query on a tenant model gets `businessId = <tenant>` forced into its `where` / `data`.
 * A caller that passes a *different* businessId gets a TenantViolationError (a bug, never a user error).
 *
 * Rules for repositories using this client:
 *  - Use scalar FK ids (`farmerId: x`), not nested `connect`, so the injected businessId stays valid.
 *  - `$queryRaw` is NOT intercepted. Raw SQL must filter on businessId explicitly.
 *  - Platform models (User, Permission, SubscriptionPlan, Business itself) are rejected here;
 *    access them through the root client in platform-level services only.
 */
export const TENANT_MODELS = new Set<string>([
  'BusinessSettings',
  'BusinessMembership',
  'StaffInvite',
  'Farmer',
  'FarmerBankAccount',
  'Buyer',
  'Commodity',
  'CommodityGrade',
  'Lot',
  'Purchase',
  'Sale',
  'SaleCharge',
  'CommissionRule',
  'Patti',
  'Deduction',
  'FarmerLedgerEntry',
  'BuyerLedgerEntry',
  'Payment',
  'ExpenseCategory',
  'Expense',
  'DocumentSequence',
  'IdempotencyRecord',
  'ApprovalRequest',
  'AuditLog',
  'StaffActivity',
  'Subscription',
  'SubscriptionEvent',
  'BillingPayment',
  'Notification',
  'WhatsAppMessage',
  'Attachment',
  'AiConversation',
  'AiMessage',
  'AiDraft',
]);

export class TenantViolationError extends Error {
  constructor(model: string, operation: string) {
    super(`Tenant violation: ${model}.${operation} attempted to address another business`);
    this.name = 'TenantViolationError';
  }
}

const WHERE_OPS = new Set([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
]);

type AnyRecord = Record<string, unknown>;

export function forTenant(prisma: PrismaClient, businessId: string) {
  if (!businessId) throw new Error('forTenant requires a businessId');

  const guard = (obj: unknown, model: string, op: string) => {
    if (obj && typeof obj === 'object' && 'businessId' in obj && (obj as AnyRecord).businessId !== businessId) {
      throw new TenantViolationError(model, op);
    }
  };

  return prisma.$extends({
    name: 'tenant-scope',
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!TENANT_MODELS.has(model)) {
            throw new Error(`Model ${model} is not tenant-scoped; use a platform service`);
          }
          const a = { ...((args ?? {}) as AnyRecord) };

          if (WHERE_OPS.has(operation)) {
            guard(a.where, model, operation);
            a.where = { ...((a.where as AnyRecord) ?? {}), businessId };
            if (operation === 'updateMany' || operation === 'update' || operation === 'updateManyAndReturn') {
              guard(a.data, model, operation); // cannot move a row to another tenant
            }
          } else if (operation === 'create') {
            guard(a.data, model, operation);
            a.data = { ...((a.data as AnyRecord) ?? {}), businessId };
          } else if (operation === 'createMany' || operation === 'createManyAndReturn') {
            const rows = Array.isArray(a.data) ? a.data : [a.data];
            a.data = rows.map((row: AnyRecord) => {
              guard(row, model, operation);
              return { ...row, businessId };
            });
          } else if (operation === 'upsert') {
            guard(a.where, model, operation);
            guard(a.create, model, operation);
            guard(a.update, model, operation);
            a.where = { ...((a.where as AnyRecord) ?? {}), businessId };
            a.create = { ...((a.create as AnyRecord) ?? {}), businessId };
          }
          return query(a as typeof args);
        },
      },
    },
  });
}

export type TenantDb = ReturnType<typeof forTenant>;
