import type { ErrorRequestHandler } from 'express';
import { ERROR_MESSAGES, type ErrorCode } from '@mandimitra/shared';
import { Prisma } from '@mandimitra/database';
import type { Logger } from '../config/logger.ts';
import { AppError } from '../utils/errors.ts';

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') return new AppError(409, 'CONFLICT');
    if (err.code === 'P2025') return new AppError(404, 'NOT_FOUND');
  }

  // body-parser errors
  const e = err as { type?: string; status?: number };
  if (e?.type === 'entity.parse.failed') return new AppError(400, 'INVALID_JSON');
  if (e?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE');
  return null;
}

export function errorHandler(logger: Logger, report?: (err: unknown, ctx: Record<string, unknown>) => void): ErrorRequestHandler {
  return (err, req, res, _next) => {
    const appErr = toAppError(err);
    const status = appErr?.status ?? 500;
    const code: ErrorCode = appErr?.code ?? 'INTERNAL_ERROR';

    if (status >= 500) {
      logger.error({ err, requestId: req.requestId, userId: req.auth?.userId }, 'Unhandled error');
      // Expected upstream failures (gateway/WhatsApp 502s) are AppErrors; only real bugs are reported.
      if (!appErr) report?.(err, { requestId: req.requestId, route: req.route?.path, method: req.method });
    }

    const lang = req.acceptsLanguages('hi', 'en') === 'hi' ? 'hi' : 'en';
    res.status(status).json({
      success: false,
      error: {
        code,
        message: ERROR_MESSAGES[code][lang],
        ...(appErr?.details !== undefined ? { details: appErr.details } : {}),
      },
      requestId: req.requestId,
    });
  };
}
