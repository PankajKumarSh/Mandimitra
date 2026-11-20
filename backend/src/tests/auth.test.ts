import { SignJWT } from 'jose';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSION_KEYS } from '@mandimitra/shared';
import { H, PASSWORD, cookieHeader, cookieValue, makeApp, registerOwner, uniqueMobile } from './helpers.ts';

const { app, prisma } = makeApp();

describe('business registration', () => {
  it('creates user, business, owner membership, defaults and a 14-day trial in one go', async () => {
    const before = Date.now();
    const { agent, businessId, userId } = await registerOwner(app);

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    const active = me.body.data.activeBusiness;
    expect(active.businessId).toBe(businessId);
    expect(active.isOwner).toBe(true);
    expect(active.role.key).toBe('OWNER');
    expect(active.permissions).toHaveLength(ALL_PERMISSION_KEYS.length);
    expect(active.subscription).toMatchObject({ status: 'TRIALING', planCode: 'PROFESSIONAL' });
    const trialMs = new Date(active.subscription.trialEndsAt).getTime() - before;
    expect(trialMs).toBeGreaterThan(13.9 * 86_400_000);
    expect(trialMs).toBeLessThan(14.1 * 86_400_000);

    const [commodities, categories, settings, rules, audit, user] = await Promise.all([
      prisma.commodity.findMany({ where: { businessId }, orderBy: { sortOrder: 'asc' } }),
      prisma.expenseCategory.count({ where: { businessId } }),
      prisma.businessSettings.findUnique({ where: { businessId } }),
      prisma.commissionRule.count({ where: { businessId } }),
      prisma.auditLog.count({ where: { businessId, entityType: 'Business', action: 'CREATE' } }),
      prisma.user.findUniqueOrThrow({ where: { id: userId } }),
    ]);
    expect(commodities.map((c) => c.nameHindi)).toEqual(['गेहूं', 'धान', 'चावल', 'सरसों', 'मक्का', 'आलू', 'प्याज']);
    expect(categories).toBe(7);
    expect(settings).toMatchObject({ tradingMode: 'COMMISSION_AGENT', fiscalYearStartMonth: 4 });
    expect(rules).toBe(0); // rates are never assumed
    expect(audit).toBe(1);
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(user.passwordHash).not.toContain(PASSWORD);
  });

  it('stores Hindi business names intact', async () => {
    const { businessId } = await registerOwner(app);
    const b = await prisma.business.findUniqueOrThrow({ where: { id: businessId } });
    expect(b.nameHindi).toBe('राम लाल एंड संस');
  });

  it('sets HttpOnly, SameSite=Lax cookies scoped to the API', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'A', mobile: uniqueMobile(), password: PASSWORD, business: { name: 'Test Firm' } });
    expect(res.status).toBe(201);
    const at = cookieHeader(res, 'mm_at')!;
    const rt = cookieHeader(res, 'mm_rt')!;
    expect(at).toMatch(/HttpOnly/i);
    expect(at).toMatch(/SameSite=Lax/i);
    expect(at).toMatch(/Path=\/api(;|$)/);
    expect(rt).toMatch(/HttpOnly/i);
    expect(rt).toMatch(/Path=\/api\/v1\/auth/);
    expect(JSON.stringify(res.body)).not.toContain(cookieValue(res, 'mm_rt')!); // token never in body
  });

  it('rejects a duplicate mobile (in any format) with 409', async () => {
    const { mobile } = await registerOwner(app);
    const local = `0${mobile.slice(3, 8)} ${mobile.slice(8)}`; // "098123 45678"
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'B', mobile: local, password: PASSWORD, business: { name: 'Other' } });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('MOBILE_ALREADY_REGISTERED');
  });

  it('lets exactly one of two concurrent sign-ups with the same mobile succeed', async () => {
    const mobile = uniqueMobile();
    const body = { fullName: 'Race', mobile, password: PASSWORD, business: { name: 'Race Firm' } };
    const results = await Promise.all([
      request(app).post('/api/v1/auth/register').set(H).send(body),
      request(app).post('/api/v1/auth/register').set(H).send(body),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await prisma.user.count({ where: { mobile: `+91${mobile}` } })).toBe(1);
  });

  it('validates input and localises messages', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .set('Accept-Language', 'hi')
      .send({ fullName: '', mobile: '12345', password: 'short', business: { name: 'X' } });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toBe('कुछ जानकारी सही नहीं है');
    const paths = res.body.error.details.map((d: { path: string }) => d.path);
    expect(paths).toEqual(expect.arrayContaining(['fullName', 'mobile', 'password', 'business.name']));
  });

  it('blocks state-changing requests without the CSRF header', async () => {
    const res = await request(app).post('/api/v1/auth/login').send({ mobile: uniqueMobile(), password: 'x' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_HEADER_MISSING');
  });

  it('rejects malformed JSON cleanly', async () => {
    const res = await request(app).post('/api/v1/auth/login').set(H).set('content-type', 'application/json').send('{bad');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('login', () => {
  it('logs in with any mobile format and records login history', async () => {
    const { mobile, userId } = await registerOwner(app);
    const res = await request(app).post('/api/v1/auth/login').set(H).send({ mobile: mobile.slice(3), password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.memberships).toHaveLength(1);
    expect(await prisma.staffActivity.count({ where: { userId, activityType: 'LOGIN_SUCCESS' } })).toBeGreaterThanOrEqual(2);
  });

  it('returns the same error for unknown mobile and wrong password', async () => {
    const { mobile } = await registerOwner(app);
    const wrong = await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: 'wrong-password' });
    const unknown = await request(app).post('/api/v1/auth/login').set(H).send({ mobile: uniqueMobile(), password: 'wrong-password' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('locks the account after 5 failures, even for the correct password', async () => {
    const { mobile } = await registerOwner(app);
    for (let i = 0; i < 5; i++) {
      await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: 'nope-nope' });
    }
    const res = await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: PASSWORD });
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    expect(res.body.error.details.retryAfterSeconds).toBeGreaterThan(800);
  });

  it('rejects disabled accounts', async () => {
    const { mobile, userId } = await registerOwner(app);
    await prisma.user.update({ where: { id: userId }, data: { status: 'DISABLED' } });
    const res = await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_DISABLED');
  });
});

describe('access token', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects tampered and expired tokens', async () => {
    const { userId, businessId } = await registerOwner(app);
    const key = new TextEncoder().encode(process.env.JWT_ACCESS_SECRET!);
    const claims = { bid: businessId, pa: false, sid: crypto.randomUUID() };

    const expired = await new SignJWT(claims)
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('mandimitra-api')
      .setAudience('mandimitra-web')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(key);
    const r1 = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(r1.status).toBe(401);
    expect(r1.body.error.code).toBe('TOKEN_EXPIRED');

    const forged = await new SignJWT({ ...claims, pa: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('mandimitra-api')
      .setAudience('mandimitra-web')
      .setExpirationTime('5m')
      .sign(new TextEncoder().encode('some-other-secret-that-is-long-enough-123'));
    const r2 = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(r2.status).toBe(401);
    expect(r2.body.error.code).toBe('UNAUTHENTICATED');
  });
});

describe('refresh token rotation', () => {
  it('rotates on refresh and keeps the session working', async () => {
    const { agent } = await registerOwner(app);
    const r = await agent.post('/api/v1/auth/refresh').set(H);
    expect(r.status).toBe(200);
    expect(cookieValue(r, 'mm_rt')).toBeTruthy();
    expect((await agent.get('/api/v1/auth/me')).status).toBe(200);
  });

  it('treats a near-simultaneous double refresh as benign (two tabs)', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'Tabs', mobile: uniqueMobile(), password: PASSWORD, business: { name: 'Tabs Firm' } });
    const rt = cookieValue(reg, 'mm_rt')!;
    const first = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${rt}`);
    const second = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${rt}`);
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
  });

  it('detects reuse of a rotated token and revokes the whole family', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'Victim', mobile: uniqueMobile(), password: PASSWORD, business: { name: 'Victim Firm' } });
    const stolen = cookieValue(reg, 'mm_rt')!;
    const userId = reg.body.data.user.id;

    const legit = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${stolen}`);
    const legitNext = cookieValue(legit, 'mm_rt')!;

    // Move the rotation outside the grace window.
    await prisma.refreshToken.updateMany({
      where: { userId, replacedById: { not: null } },
      data: { revokedAt: new Date(Date.now() - 60_000) },
    });

    const attacker = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${stolen}`);
    expect(attacker.status).toBe(401);
    expect(attacker.body.error.code).toBe('REFRESH_REUSED');

    // The legitimate holder's newer token is dead too.
    const after = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${legitNext}`);
    expect(after.status).toBe(401);
    expect(await prisma.staffActivity.count({ where: { userId, activityType: 'TOKEN_REUSE_DETECTED' } })).toBe(1);
  });

  it('logout revokes the session; refresh afterwards fails without a false theft alarm', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'Bye', mobile: uniqueMobile(), password: PASSWORD, business: { name: 'Bye Firm' } });
    const rt = cookieValue(reg, 'mm_rt')!;
    const userId = reg.body.data.user.id;
    const out = await request(app).post('/api/v1/auth/logout').set(H).set('Cookie', `mm_rt=${rt}`);
    expect(out.status).toBe(204);
    const r = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${rt}`);
    expect(r.status).toBe(401);
    expect(r.body.error.code).toBe('INVALID_REFRESH');
    expect(await prisma.staffActivity.count({ where: { userId, activityType: 'TOKEN_REUSE_DETECTED' } })).toBe(0);
  });

  it('grace window does not resurrect a session logged out after rotation', async () => {
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .set(H)
      .send({ fullName: 'Grace', mobile: uniqueMobile(), password: PASSWORD, business: { name: 'Grace Firm' } });
    const old = cookieValue(reg, 'mm_rt')!;
    const rotated = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${old}`);
    await request(app).post('/api/v1/auth/logout').set(H).set('Cookie', `mm_rt=${cookieValue(rotated, 'mm_rt')}`);
    const r = await request(app).post('/api/v1/auth/refresh').set(H).set('Cookie', `mm_rt=${old}`);
    expect(r.status).toBe(401);
  });
});

describe('change password', () => {
  it('signs out other devices but keeps the current one', async () => {
    const { agent: phone, mobile } = await registerOwner(app);
    const laptop = request.agent(app);
    expect((await laptop.post('/api/v1/auth/login').set(H).send({ mobile, password: PASSWORD })).status).toBe(200);

    const res = await phone.post('/api/v1/auth/change-password').set(H).send({ currentPassword: PASSWORD, newPassword: 'NewPass@2026' });
    expect(res.status).toBe(204);

    expect((await laptop.post('/api/v1/auth/refresh').set(H)).status).toBe(401);
    expect((await phone.post('/api/v1/auth/refresh').set(H)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: 'NewPass@2026' })).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').set(H).send({ mobile, password: PASSWORD })).status).toBe(401);
  });

  it('requires the current password and a different new one', async () => {
    const { agent } = await registerOwner(app);
    const wrong = await agent.post('/api/v1/auth/change-password').set(H).send({ currentPassword: 'bad-bad-bad', newPassword: 'NewPass@2026' });
    expect(wrong.status).toBe(401);
    const same = await agent.post('/api/v1/auth/change-password').set(H).send({ currentPassword: PASSWORD, newPassword: PASSWORD });
    expect(same.status).toBe(422);
    expect(same.body.error.code).toBe('SAME_PASSWORD');
  });
});

describe('rate limiting', () => {
  it('throttles auth endpoints per IP', async () => {
    const { app: limited } = makeApp({ RATE_LIMIT_ENABLED: 'true', AUTH_RATE_LIMIT: '3' });
    const mobile = uniqueMobile();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await request(limited).post('/api/v1/auth/login').set(H).send({ mobile, password: 'x' })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 429]);
  });
});
