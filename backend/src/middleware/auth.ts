import type { RequestHandler } from 'express';
import { AUTH } from '@mandimitra/shared';
import { Errors } from '../utils/errors.ts';
import type { TokenSigner } from '../utils/jwt.ts';

/** Verifies the access token (HttpOnly cookie, or Bearer for non-browser clients). */
export function authenticate(signer: TokenSigner): RequestHandler {
  return async (req, _res, next) => {
    const header = req.get('authorization');
    const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token: string | undefined = bearer ?? req.cookies?.[AUTH.ACCESS_COOKIE];
    if (!token) return next(Errors.unauthenticated());
    req.auth = await signer.verify(token);
    next();
  };
}
