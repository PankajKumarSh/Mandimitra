import type { ErrorCode } from '@mandimitra/shared';

export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly details?: unknown;

  constructor(status: number, code: ErrorCode, details?: unknown) {
    super(code);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  validation: (details?: unknown) => new AppError(400, 'VALIDATION_ERROR', details),
  unauthenticated: (code: ErrorCode = 'UNAUTHENTICATED') => new AppError(401, code),
  forbidden: (code: ErrorCode = 'FORBIDDEN', details?: unknown) => new AppError(403, code, details),
  /** Also used for other-tenant records so existence is never leaked. */
  notFound: () => new AppError(404, 'NOT_FOUND'),
  conflict: (code: ErrorCode = 'CONFLICT', details?: unknown) => new AppError(409, code, details),
  unprocessable: (code: ErrorCode, details?: unknown) => new AppError(422, code, details),
  paymentRequired: (code: ErrorCode = 'SUBSCRIPTION_INACTIVE', details?: unknown) => new AppError(402, code, details),
  tooMany: (code: ErrorCode = 'RATE_LIMITED', details?: unknown) => new AppError(429, code, details),
  internal: (code: ErrorCode = 'INTERNAL_ERROR') => new AppError(500, code),
};
