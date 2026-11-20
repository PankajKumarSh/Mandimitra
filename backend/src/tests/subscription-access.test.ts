import { describe, expect, it } from 'vitest';
import { H, makeApp, registerOwner } from './helpers.ts';

const { app, prisma } = makeApp();
const patch = { pattiFooterNote: 'test' };

describe('subscription gate', () => {
  it('trial allows writes', async () => {
    const o = await registerOwner(app);
    expect((await o.agent.patch('/api/v1/businesses/current/settings').set(H).send(patch)).status).toBe(200);
  });

  it('expired trial → read-only (402 on writes, reads still work)', async () => {
    const o = await registerOwner(app);
    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { trialEndsAt: new Date(Date.now() - 1000) } });

    expect((await o.agent.get('/api/v1/businesses/current/settings')).status).toBe(200);
    const w = await o.agent.patch('/api/v1/businesses/current/settings').set(H).send(patch);
    expect(w.status).toBe(402);
    expect(w.body.error.code).toBe('SUBSCRIPTION_INACTIVE');
    expect(w.body.error.details.status).toBe('EXPIRED');

    const me = await o.agent.get('/api/v1/auth/me');
    expect(me.body.data.activeBusiness.subscription.status).toBe('EXPIRED');
  });

  it('active paid period allows writes; lapsed period becomes PAST_DUE read-only', async () => {
    const o = await registerOwner(app);
    await prisma.subscription.update({
      where: { businessId: o.businessId },
      data: { status: 'ACTIVE', currentPeriodEnd: new Date(Date.now() + 86_400_000) },
    });
    expect((await o.agent.patch('/api/v1/businesses/current/settings').set(H).send(patch)).status).toBe(200);

    await prisma.subscription.update({ where: { businessId: o.businessId }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    const w = await o.agent.patch('/api/v1/businesses/current/settings').set(H).send(patch);
    expect(w.status).toBe(402);
    expect(w.body.error.details.status).toBe('PAST_DUE');
  });

  it('suspended business is blocked entirely', async () => {
    const o = await registerOwner(app);
    await prisma.business.update({ where: { id: o.businessId }, data: { status: 'SUSPENDED' } });
    const r = await o.agent.get('/api/v1/businesses/current');
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('BUSINESS_SUSPENDED');
  });
});
