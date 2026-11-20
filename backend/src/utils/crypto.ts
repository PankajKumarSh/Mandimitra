import { createHash, randomBytes } from 'node:crypto';

/** 256-bit URL-safe random token (refresh tokens, invites). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** "+919812345678" → "+91•••••45678" for display in invite previews / logs. */
export function maskMobile(mobile: string): string {
  return mobile.length > 5 ? `${mobile.slice(0, 3)}•••••${mobile.slice(-5)}` : '•••••';
}
