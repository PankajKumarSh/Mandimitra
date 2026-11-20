import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { rateLimit } from 'express-rate-limit';
import type { z } from 'zod';
import { AUTH } from '@mandimitra/shared';
import type { Env } from '../config/env.ts';
import { AppError, Errors } from '../utils/errors.ts';

const REQUEST_ID_RE = /^[\w-]{8,64}$/;

export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && REQUEST_ID_RE.test(incoming) ? incoming : randomUUID();
  req.validated = {};
  res.setHeader('x-request-id', req.requestId);
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF guard: state-changing requests must carry a custom header. Cross-site HTML forms cannot set
 * custom headers, and cross-origin fetch with custom headers needs a CORS preflight our allowlist rejects.
 * Webhooks are exempt (they authenticate by signature).
 */
export const csrfGuard: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method) || req.path.startsWith('/api/v1/webhooks/')) return next();
  if (req.get(AUTH.CSRF_HEADER) !== AUTH.CSRF_HEADER_VALUE) return next(Errors.forbidden('CSRF_HEADER_MISSING'));
  next();
};

interface Schemas {
  body?: z.ZodType;
  query?: z.ZodType;
  params?: z.ZodType;
}

/** Validates and replaces body; parsed query/params go to req.validated (Express 5 query is read-only). */
export function validate(schemas: Schemas): RequestHandler {
  return (req, _res, next) => {
    for (const part of ['params', 'query', 'body'] as const) {
      const schema = schemas[part];
      if (!schema) continue;
      const result = schema.safeParse(part === 'body' ? (req.body ?? {}) : req[part]);
      if (!result.success) {
        return next(
          Errors.validation(
            result.error.issues.map((i) => ({ location: part, path: i.path.join('.'), message: i.message })),
          ),
        );
      }
      if (part === 'body') req.body = result.data;
      else req.validated[part] = result.data;
    }
    next();
  };
}

export function rateLimiter(env: Env, opts: { windowMs: number; limit: number }): RequestHandler {
  if (!env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(Errors.tooMany()),
  });
}

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(Errors.notFound());

export type { NextFunction, Request, Response };
export { AppError };
