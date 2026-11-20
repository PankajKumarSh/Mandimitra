import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { Errors } from './errors.ts';

const ISSUER = 'mandimitra-api';
const AUDIENCE = 'mandimitra-web';

export interface AccessClaims {
  userId: string;
  businessId: string | null;
  isPlatformAdmin: boolean;
  /** Refresh-token family id — lets logout / password change identify the session. */
  sessionId: string;
}

export class TokenSigner {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  sign(c: AccessClaims): Promise<string> {
    return new SignJWT({ bid: c.businessId, pa: c.isPlatformAdmin, sid: c.sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(c.userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  async verify(token: string): Promise<AccessClaims> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') throw Errors.unauthenticated();
      return {
        userId: payload.sub,
        businessId: typeof payload.bid === 'string' ? payload.bid : null,
        isPlatformAdmin: payload.pa === true,
        sessionId: payload.sid,
      };
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) throw Errors.unauthenticated('TOKEN_EXPIRED');
      throw Errors.unauthenticated();
    }
  }
}
