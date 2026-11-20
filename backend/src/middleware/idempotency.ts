import type { RequestHandler, Response } from 'express';
import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { Logger } from '../config/logger.ts';
import { sha256 } from '../utils/crypto.ts';
import { AppError } from '../utils/errors.ts';

const KEY_RE = /^[\w-]{8,64}$/;
const TTL_MS = 24 * 3600_000;

/**
 * Exactly-once POSTs for financial writes (Idempotency-Key header).
 *
 *  first request    → claims the key (unique insert), runs, stores the 2xx response before sending it
 *  same key again   → replays the stored response (header Idempotent-Replayed: true); nothing re-executes
 *  same key, other body → 422 IDEMPOTENCY_KEY_REUSED
 *  concurrent dup   → 409 REQUEST_IN_PROGRESS (the unique index decides who wins — no timing games)
 *  non-2xx outcome  → claim released so the user can fix the input and retry with the same key
 *
 * Handlers behind this middleware must respond with res.json().
 */
export function idempotent(prisma: PrismaClient, logger: Logger): RequestHandler {
  return async (req, res, next) => {
    const key = req.get('idempotency-key');
    if (!key || !KEY_RE.test(key)) return next(new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED'));
    const t = req.tenant!;
    const where = { businessId_key: { businessId: t.businessId, key } };
    const requestHash = sha256(JSON.stringify({ m: req.method, p: req.originalUrl, u: req.auth!.userId, b: req.body ?? null }));

    try {
      await prisma.idempotencyRecord.create({
        data: {
          businessId: t.businessId,
          userId: req.auth!.userId,
          key,
          method: req.method,
          path: req.originalUrl.slice(0, 200),
          requestHash,
          expiresAt: new Date(Date.now() + TTL_MS),
        },
      });
    } catch (err) {
      if (!(err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')) throw err;
      const existing = await prisma.idempotencyRecord.findUnique({ where });
      if (!existing) return next(new AppError(409, 'REQUEST_IN_PROGRESS'));
      if (existing.requestHash !== requestHash) return next(new AppError(422, 'IDEMPOTENCY_KEY_REUSED'));
      if (existing.responseStatus === null) return next(new AppError(409, 'REQUEST_IN_PROGRESS'));
      res.setHeader('idempotent-replayed', 'true');
      res.status(existing.responseStatus).json(existing.responseBody);
      return;
    }

    const send = res.json.bind(res) as Response['json'];
    res.json = ((body: unknown) => {
      const ok = res.statusCode >= 200 && res.statusCode < 300;
      const persist = ok
        ? prisma.idempotencyRecord.update({ where, data: { responseStatus: res.statusCode, responseBody: body as Prisma.InputJsonValue } })
        : prisma.idempotencyRecord.delete({ where });
      // Store BEFORE sending so an immediate retry always sees the final result.
      persist
        .catch((e: unknown) => logger.error({ err: e, key }, 'idempotency record update failed'))
        .finally(() => send(body));
      return res;
    }) as Response['json'];
    next();
  };
}
