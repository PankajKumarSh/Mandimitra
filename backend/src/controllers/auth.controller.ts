import type { CookieOptions, Request, Response } from 'express';
import { AUTH } from '@mandimitra/shared';
import type { Env } from '../config/env.ts';
import type { AuthService, SessionTokens } from '../services/auth.service.ts';
import type { StaffService } from '../services/staff.service.ts';
import { Errors } from '../utils/errors.ts';
import { ok, requestContext } from '../utils/http.ts';

export class AuthController {
  constructor(
    private readonly env: Env,
    private readonly auth: AuthService,
    private readonly staff: StaffService,
  ) {}

  private cookieBase(): CookieOptions {
    return { httpOnly: true, secure: this.env.cookieSecure, sameSite: 'lax' };
  }

  private setSession(res: Response, t: SessionTokens) {
    res.cookie(AUTH.ACCESS_COOKIE, t.accessToken, {
      ...this.cookieBase(),
      path: '/api',
      maxAge: this.env.JWT_ACCESS_TTL_SECONDS * 1000,
    });
    res.cookie(AUTH.REFRESH_COOKIE, t.refreshToken, {
      ...this.cookieBase(),
      path: '/api/v1/auth',
      expires: t.refreshExpiresAt,
    });
  }

  private clearSession(res: Response) {
    res.clearCookie(AUTH.ACCESS_COOKIE, { ...this.cookieBase(), path: '/api' });
    res.clearCookie(AUTH.REFRESH_COOKIE, { ...this.cookieBase(), path: '/api/v1/auth' });
  }

  register = async (req: Request, res: Response) => {
    const r = await this.auth.register(req.body, requestContext(req));
    this.setSession(res, r.tokens);
    ok(res, { user: r.user, activeBusinessId: r.businessId }, 201);
  };

  login = async (req: Request, res: Response) => {
    const r = await this.auth.login(req.body, requestContext(req));
    this.setSession(res, r.tokens);
    ok(res, { user: r.user, activeBusinessId: r.businessId, memberships: r.memberships });
  };

  refresh = async (req: Request, res: Response) => {
    try {
      const r = await this.auth.refresh(req.cookies?.[AUTH.REFRESH_COOKIE], requestContext(req));
      this.setSession(res, r);
      ok(res, { activeBusinessId: r.businessId });
    } catch (err) {
      this.clearSession(res);
      throw err;
    }
  };

  logout = async (req: Request, res: Response) => {
    await this.auth.logout(req.cookies?.[AUTH.REFRESH_COOKIE], req.auth?.userId, req.auth?.sessionId, requestContext(req));
    this.clearSession(res);
    res.status(204).end();
  };

  me = async (req: Request, res: Response) => {
    ok(res, await this.auth.me(req.auth!.userId, req.auth!.businessId));
  };

  switchBusiness = async (req: Request, res: Response) => {
    const r = await this.auth.switchBusiness(req.auth!.userId, req.auth!.sessionId, req.body.businessId, requestContext(req));
    this.setSession(res, r.tokens);
    ok(res, { activeBusinessId: r.businessId });
  };

  changePassword = async (req: Request, res: Response) => {
    await this.auth.changePassword(req.auth!.userId, req.auth!.sessionId, req.body, requestContext(req));
    res.status(204).end();
  };

  previewInvite = async (req: Request, res: Response) => {
    ok(res, await this.staff.previewInvite(this.token(req)));
  };

  acceptInvite = async (req: Request, res: Response) => {
    const r = await this.staff.acceptInvite(this.token(req), req.body, requestContext(req));
    this.setSession(res, r.tokens);
    ok(res, { user: r.user, activeBusinessId: r.businessId });
  };

  private token(req: Request): string {
    const t = req.params.token;
    if (typeof t !== 'string' || !/^[\w-]{20,100}$/.test(t)) throw Errors.unprocessable('INVITE_INVALID');
    return t;
  }
}
