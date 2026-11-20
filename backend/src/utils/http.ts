import type { Request, Response } from 'express';

export function ok<T>(res: Response, data: T, status = 200, meta?: Record<string, unknown>): void {
  res.status(status).json(meta ? { success: true, data, meta } : { success: true, data });
}

export interface RequestContext {
  ip: string | null;
  userAgent: string | null;
  requestId: string;
}

export function requestContext(req: Request): RequestContext {
  return {
    ip: req.ip ?? null,
    userAgent: req.get('user-agent')?.slice(0, 300) ?? null,
    requestId: req.requestId,
  };
}
