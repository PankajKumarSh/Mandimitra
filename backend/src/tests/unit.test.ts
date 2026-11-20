import { Writable } from 'node:stream';
import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { mobileSchema, registerSchema } from '@mandimitra/shared';
import { REDACT_PATHS } from '../config/logger.ts';
import { TenantCache } from '../middleware/tenant.ts';
import { resolveRange } from '../services/dashboard.service.ts';
import { istDateString } from '../services/ledger.service.ts';
import { fiscalYearOf } from '../services/sequence.service.ts';
import { FieldCipher } from '../utils/field-crypto.ts';

describe('mobile normalisation', () => {
  it.each([
    ['9812345678', '+919812345678'],
    ['98123 45678', '+919812345678'],
    ['098123-45678', '+919812345678'],
    ['+91 98123 45678', '+919812345678'],
    ['919812345678', '+919812345678'],
    ['6000000000', '+916000000000'],
  ])('%s → %s', (input, expected) => {
    expect(mobileSchema.parse(input)).toBe(expected);
  });

  it.each(['12345', '5812345678', '98123456789', 'abcdefghij', ''])('rejects %s', (input) => {
    expect(mobileSchema.safeParse(input).success).toBe(false);
  });
});

describe('register schema', () => {
  it('defaults language to Hindi', () => {
    const r = registerSchema.parse({ fullName: 'A', mobile: '9812345678', password: '12345678', business: { name: 'Firm' } });
    expect(r.preferredLanguage).toBe('HI');
  });
});

describe('log redaction', () => {
  it('never writes passwords, tokens or cookies', () => {
    const lines: string[] = [];
    const sink = new Writable({ write: (chunk, _e, cb) => (lines.push(chunk.toString()), cb()) });
    const log = pino({ redact: { paths: REDACT_PATHS, censor: '[REDACTED]' } }, sink);
    log.info({
      body: { password: 'secret-pass', mobile: '+919812345678' },
      session: { refreshToken: 'rt-secret', accessToken: 'at-secret' },
      req: { headers: { cookie: 'mm_at=abc', authorization: 'Bearer xyz' } },
    });
    const out = lines.join('');
    for (const secret of ['secret-pass', 'rt-secret', 'at-secret', 'mm_at=abc', 'Bearer xyz']) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain('[REDACTED]');
  });
});

describe('fiscal year & numbering helpers', () => {
  it.each([
    ['2026-11-19', 4, '2026-27'],
    ['2026-04-01', 4, '2026-27'],
    ['2026-03-31', 4, '2025-26'],
    ['2099-12-31', 4, '2099-00'],
    ['2026-06-15', 1, '2026'],
  ])('%s (FY start %i) → %s', (d, m, fy) => {
    expect(fiscalYearOf(new Date(`${d}T00:00:00Z`), m)).toBe(fy);
  });
});

describe('IST date ranges', () => {
  // 20:00 UTC on 19 Nov is 01:30 IST on 20 Nov — the mandi's "today" is the 20th.
  const lateUtc = new Date('2026-11-19T20:00:00Z');
  it('uses the IST calendar day', () => {
    expect(istDateString(lateUtc)).toBe('2026-11-20');
    expect(resolveRange({ range: 'today' }, lateUtc)).toEqual({ from: '2026-11-20', to: '2026-11-20' });
    expect(resolveRange({ range: 'yesterday' }, lateUtc)).toEqual({ from: '2026-11-19', to: '2026-11-19' });
  });
  it('week starts on Monday; month on the 1st', () => {
    // 2026-11-20 is a Friday → Monday 2026-11-16
    expect(resolveRange({ range: 'week' }, lateUtc)).toEqual({ from: '2026-11-16', to: '2026-11-20' });
    expect(resolveRange({ range: 'month' }, lateUtc)).toEqual({ from: '2026-11-01', to: '2026-11-20' });
  });
});

describe('field encryption', () => {
  const cipher = new FieldCipher(Buffer.alloc(32, 1).toString('base64'));
  it('round-trips and uses a fresh IV each time', () => {
    const a = cipher.encrypt('123456789012');
    const b = cipher.encrypt('123456789012');
    expect(a).not.toBe(b);
    expect(cipher.decrypt(a)).toBe('123456789012');
  });
  it('detects tampering', () => {
    const enc = cipher.encrypt('123456789012');
    const buf = Buffer.from(enc.slice(3), 'base64');
    buf[buf.length - 1]! ^= 1;
    expect(() => cipher.decrypt(`v1:${buf.toString('base64')}`)).toThrow();
  });
  it('rejects wrong key sizes', () => {
    expect(() => new FieldCipher(Buffer.alloc(16).toString('base64'))).toThrow();
  });
});

describe('tenant cache', () => {
  it('invalidates by user and by business', () => {
    const c = new TenantCache(60_000);
    const v = {} as never;
    c.set('u1:b1', v);
    c.set('u2:b1', v);
    c.set('u1:b2', v);
    c.invalidate({ userId: 'u1' });
    expect(c.get('u1:b1')).toBeUndefined();
    expect(c.get('u1:b2')).toBeUndefined();
    expect(c.get('u2:b1')).toBeDefined();
    c.invalidate({ businessId: 'b1' });
    expect(c.get('u2:b1')).toBeUndefined();
  });

  it('is disabled with TTL 0', () => {
    const c = new TenantCache(0);
    c.set('a:b', {} as never);
    expect(c.get('a:b')).toBeUndefined();
  });
});
