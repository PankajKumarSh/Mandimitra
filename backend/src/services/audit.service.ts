import type { ActivityType, AuditAction, Prisma, PrismaClient } from '@mandimitra/database';
import type { RequestContext } from '../utils/http.ts';

type Db = PrismaClient | Prisma.TransactionClient;

export interface AuditInput {
  businessId: string | null;
  actorUserId: string | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  before?: unknown;
  after?: unknown;
}

const SENSITIVE_KEYS = new Set(['passwordHash', 'tokenHash', 'accountNumberEnc']);

/** Strip secrets and make the value JSON-safe (Decimal/Date → string). */
function sanitize(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SENSITIVE_KEYS.has(k) ? undefined : typeof v === 'bigint' ? v.toString() : v)),
  );
}

export function writeAudit(db: Db, input: AuditInput, ctx?: RequestContext) {
  return db.auditLog.create({
    data: {
      businessId: input.businessId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      before: sanitize(input.before),
      after: sanitize(input.after),
      requestId: ctx?.requestId ?? null,
      ipAddress: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
}

export function writeActivity(
  db: Db,
  input: { businessId: string | null; userId: string | null; activityType: ActivityType; metadata?: unknown },
  ctx?: RequestContext,
) {
  return db.staffActivity.create({
    data: {
      businessId: input.businessId,
      userId: input.userId,
      activityType: input.activityType,
      metadata: sanitize(input.metadata),
      ipAddress: ctx?.ip ?? null,
      userAgent: ctx?.userAgent ?? null,
    },
  });
}
