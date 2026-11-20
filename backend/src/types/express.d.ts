import type { AccessClaims } from '../utils/jwt.ts';
import type { TenantContext } from '../middleware/tenant.ts';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      auth?: AccessClaims;
      tenant?: TenantContext;
      /** Parsed query/params (Express 5 makes req.query a read-only getter). */
      validated: { query?: unknown; params?: unknown };
    }
  }
}

export {};
