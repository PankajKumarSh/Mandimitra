import { randomInt } from 'node:crypto';
import request from 'supertest';
import { expect } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@mandimitra/database';
import { createApp, type AppDeps } from '../app.ts';
import { loadEnv } from '../config/env.ts';
import { createLogger } from '../config/logger.ts';

export const H = { 'x-requested-with': 'mandimitra' } as const;
export const PASSWORD = 'Mandi@2026secure';

let sharedPrisma: PrismaClient | undefined;
export function testPrisma(): PrismaClient {
  sharedPrisma ??= createPrismaClient(process.env.DATABASE_URL!, { max: 5 });
  return sharedPrisma;
}

export function makeApp(overrides: Record<string, string> = {}, deps: Pick<AppDeps, 'llm' | 'whatsapp' | 'gateway' | 'store'> = {}) {
  const env = loadEnv({ ...process.env, ...overrides });
  const prisma = testPrisma();
  const { app, cache, pdf, whatsapp, gateway, services } = createApp({ env, prisma, logger: createLogger({ LOG_LEVEL: 'silent', NODE_ENV: 'test' }), ...deps });
  return { app, prisma, cache, env, pdf, whatsapp, gateway, services };
}

const issued = new Set<string>();
/** Unique valid Indian mobile (10 digits starting 6–9). Random 9-digit space makes cross-worker clashes negligible. */
export function uniqueMobile(): string {
  let m: string;
  do m = `9${String(randomInt(0, 1_000_000_000)).padStart(9, '0')}`;
  while (issued.has(m));
  issued.add(m);
  return m;
}

export type Agent = ReturnType<typeof request.agent>;
type App = Parameters<typeof request.agent>[0];

export async function registerOwner(app: App, opts: { businessName?: string } = {}) {
  const agent = request.agent(app);
  const mobile = uniqueMobile();
  const res = await agent
    .post('/api/v1/auth/register')
    .set(H)
    .send({
      fullName: 'Ram Lal',
      mobile,
      password: PASSWORD,
      business: { name: opts.businessName ?? 'Ram Lal & Sons', nameHindi: 'राम लाल एंड संस', mandiName: 'Karnal' },
    });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return {
    agent,
    mobile: `+91${mobile}`,
    userId: res.body.data.user.id as string,
    businessId: res.body.data.activeBusinessId as string,
  };
}

/** Owner invites a staff member, who accepts; returns the staff member's logged-in agent. */
export async function addStaff(app: App, owner: Agent, roleKey: 'MUNIM' | 'VIEWER') {
  const mobile = uniqueMobile();
  const inv = await owner.post('/api/v1/staff/invites').set(H).send({ mobile, roleKey, fullName: `${roleKey} User` });
  expect(inv.status, JSON.stringify(inv.body)).toBe(201);
  const staff = request.agent(app);
  const acc = await staff.post(`/api/v1/auth/invites/${inv.body.data.token}/accept`).set(H).send({ password: PASSWORD });
  expect(acc.status, JSON.stringify(acc.body)).toBe(200);
  const list = await owner.get('/api/v1/staff');
  const member = list.body.data.members.find((m: { user: { mobile: string } }) => m.user.mobile === `+91${mobile}`);
  return { agent: staff, mobile: `+91${mobile}`, userId: acc.body.data.user.id as string, membershipId: member.membershipId as string };
}

/** Raw value of a Set-Cookie cookie from a response. */
export function cookieValue(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  const hit = raw?.find((c) => c.startsWith(`${name}=`));
  return hit ? decodeURIComponent(hit.split(';')[0]!.slice(name.length + 1)) : undefined;
}

export function cookieHeader(res: request.Response, name: string): string | undefined {
  const raw = res.headers['set-cookie'] as unknown as string[] | undefined;
  return raw?.find((c) => c.startsWith(`${name}=`));
}
