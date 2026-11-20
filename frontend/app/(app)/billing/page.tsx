'use client';

import clsx from 'clsx';
import { Check, CreditCard, FlaskConical, Minus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Skeleton } from '@/components/ui';
import { openRazorpay } from '@/features/billing/razorpay';
import { SUB_TONE } from '@/features/billing/status';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import {
  useBillingPaymentsQuery,
  useBillingQuery,
  useChangePlanMutation,
  useCheckoutMutation,
  useClearPendingPlanMutation,
  useMockCompleteMutation,
  usePlansQuery,
  useSetCancelAtPeriodEndMutation,
  useVerifyPaymentMutation,
} from '@/services/api';
import type { BillingOverview, CheckoutOrder, Plan } from '@/types/billing';


function money(v: string) {
  return formatMoney(v, { decimals: /\.\d*[1-9]/.test(v) ? 2 : 0 });
}

function livePaid(b: BillingOverview) {
  return b.status === 'ACTIVE' && !!b.currentPeriodEnd && new Date(b.currentPeriodEnd) > new Date();
}

function UsageBar({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const { t } = useT();
  const pct = limit ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const over = limit !== null && used >= limit;
  return (
    <div>
      <div className="mb-1 flex justify-between text-sm">
        <span className="text-ink-2">{label}</span>
        <span className={clsx('num font-medium', over ? 'text-danger-700' : 'text-ink')}>
          {used} / {limit === null ? t('bill.unlimited') : limit}
        </span>
      </div>
      {limit !== null && limit > 0 && (
        <div className="h-2 overflow-hidden rounded-full bg-canvas" aria-hidden>
          <div className={clsx('h-full rounded-full', over ? 'bg-danger-600' : 'bg-brand-700')} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function CurrentPlan({ b, canManage }: { b: BillingOverview; canManage: boolean }) {
  const { t, lang } = useT();
  const toast = useToast();
  const [clearPending, cp] = useClearPendingPlanMutation();
  const [setCancel, sc] = useSetCancelAtPeriodEndMutation();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const live = livePaid(b);
  const end = b.status === 'TRIALING' ? b.trialEndsAt : b.currentPeriodEnd;
  const date = formatDate(end, lang);
  const dateLine =
    b.status === 'TRIALING' ? t('bill.trialEnds', { date }) : live ? (b.cancelAtPeriodEnd ? t('bill.stopsOn', { date }) : t('bill.paidTill', { date })) : end ? t('bill.endedOn', { date }) : '';
  const planName = lang === 'hi' ? (b.plan.nameHindi ?? b.plan.name) : b.plan.name;
  const run = async (p: Promise<unknown>) => {
    try {
      await p;
      toast.success(t('common.saved'));
    } catch (e) {
      toast.error(apiError(e).message);
    }
  };

  return (
    <Card title={t('bill.currentPlan')}>
      <div className="grid gap-6 md:grid-cols-2">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-2xl font-semibold">{planName}</span>
            <Badge tone={SUB_TONE[b.status]}>{t(`bill.status.${b.status}` as MessageKey)}</Badge>
          </div>
          <p className="num text-ink-2">
            {money(b.plan.priceMonthly)} <span className="text-sm">{t('bill.perMonth')}</span>
          </p>
          {dateLine && <p className="text-sm text-ink-2">{dateLine}</p>}
          {b.pendingPlan && (
            <div className="mt-1 flex flex-wrap items-center gap-2 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700">
              {t('bill.pendingPlan', { plan: lang === 'hi' ? (b.pendingPlan.nameHindi ?? b.pendingPlan.name) : b.pendingPlan.name, date })}
              {canManage && (
                <Button variant="ghost" size="sm" loading={cp.isLoading} onClick={() => run(clearPending().unwrap())}>
                  {t('bill.undoPending')}
                </Button>
              )}
            </div>
          )}
          {canManage && live && (
            <div className="mt-2">
              {b.cancelAtPeriodEnd ? (
                <Button variant="secondary" loading={sc.isLoading} onClick={() => run(setCancel(false).unwrap())}>
                  {t('bill.resume')}
                </Button>
              ) : (
                <Button variant="ghost" className="text-danger-700" onClick={() => setConfirmCancel(true)}>
                  {t('bill.cancel')}
                </Button>
              )}
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3">
          <p className="text-sm font-medium text-ink-2">{t('bill.usage')}</p>
          <UsageBar label={t('bill.usage.staff')} used={b.usage.staff} limit={b.plan.maxStaffUsers} />
          <UsageBar label={t('bill.usage.farmers')} used={b.usage.farmers} limit={b.plan.maxFarmers} />
          {b.plan.aiEnabled && <UsageBar label={t('bill.usage.ai')} used={b.usage.aiQueriesThisMonth} limit={b.plan.maxMonthlyAiQueries} />}
        </div>
      </div>
      <ConfirmDialog
        open={confirmCancel}
        title={t('bill.cancel')}
        message={t('bill.cancelConfirm', { date })}
        confirmLabel={t('bill.cancel')}
        danger
        loading={sc.isLoading}
        onClose={() => setConfirmCancel(false)}
        onConfirm={async () => {
          await run(setCancel(true).unwrap());
          setConfirmCancel(false);
        }}
      />
    </Card>
  );
}

function Feature({ ok, children }: { ok: boolean; children: string }) {
  return (
    <li className={clsx('flex items-start gap-2 text-sm', ok ? 'text-ink' : 'text-ink-3')}>
      {ok ? <Check className="mt-0.5 size-4 shrink-0 text-brand-700" aria-hidden /> : <Minus className="mt-0.5 size-4 shrink-0" aria-hidden />}
      <span>{children}</span>
    </li>
  );
}

function PlanCard({ plan, b, canManage, busy, onPay, onSchedule }: { plan: Plan; b: BillingOverview; canManage: boolean; busy: string | null; onPay: (p: Plan) => void; onSchedule: (p: Plan) => void }) {
  const { t, lang } = useT();
  const live = livePaid(b);
  const isCurrent = plan.code === b.plan.code;
  const price = Number(plan.priceMonthly);
  const current = Number(b.plan.priceMonthly);
  const amount = money(plan.priceMonthly);

  let action: { label: string; kind: 'pay' | 'schedule' | 'none'; note?: string } = { label: t('bill.payAmount', { amount }), kind: 'pay' };
  if (live && isCurrent) action = { label: t('bill.renew', { amount }), kind: 'pay', note: t('bill.renewNote') };
  else if (live && price > current) action = { label: t('bill.upgrade', { amount }), kind: 'pay', note: t('bill.upgradeNote') };
  else if (live && price < current) action = b.pendingPlan?.code === plan.code ? { label: t('bill.switchAtRenewal'), kind: 'none' } : { label: t('bill.switchAtRenewal'), kind: 'schedule' };
  else if (b.status === 'TRIALING' && b.trialEndsAt && new Date(b.trialEndsAt) > new Date()) action = { ...action, note: t('bill.trialNote') };

  return (
    <section className={clsx('flex flex-col rounded-xl border bg-surface p-5', isCurrent ? 'border-brand-700 ring-1 ring-brand-700' : 'border-line')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold">{lang === 'hi' ? (plan.nameHindi ?? plan.name) : plan.name}</h3>
        {isCurrent && <Badge tone="green">{t('bill.current')}</Badge>}
      </div>
      <p className="num mt-2 text-3xl font-semibold">
        {amount}
        <span className="ml-1 text-sm font-normal text-ink-2">{t('bill.perMonth')}</span>
      </p>
      <ul className="mt-4 flex flex-1 flex-col gap-2">
        <Feature ok>{plan.maxStaffUsers === null ? t('bill.feature.staffUnlimited') : t('bill.feature.staff', { n: plan.maxStaffUsers })}</Feature>
        <Feature ok>{plan.maxFarmers === null ? t('bill.feature.farmersUnlimited') : t('bill.feature.farmers', { n: plan.maxFarmers.toLocaleString('en-IN') })}</Feature>
        <Feature ok={plan.aiEnabled}>{plan.aiEnabled ? t('bill.feature.ai', { n: plan.maxMonthlyAiQueries.toLocaleString('en-IN') }) : t('bill.feature.noAi')}</Feature>
        <Feature ok={plan.whatsappEnabled}>{plan.whatsappEnabled ? t('bill.feature.whatsapp') : t('bill.feature.noWhatsapp')}</Feature>
        <Feature ok={plan.exportsEnabled}>{t('bill.feature.exports')}</Feature>
      </ul>
      {canManage && (
        <div className="mt-5 flex flex-col gap-2">
          <Button
            variant={action.kind === 'pay' ? 'primary' : 'secondary'}
            disabled={action.kind === 'none' || (busy !== null && busy !== plan.code)}
            loading={busy === plan.code}
            onClick={() => (action.kind === 'pay' ? onPay(plan) : action.kind === 'schedule' ? onSchedule(plan) : undefined)}
          >
            {action.kind === 'pay' && <CreditCard className="size-4" aria-hidden />}
            {action.label}
          </Button>
          {action.note && <p className="text-xs text-ink-3">{action.note}</p>}
        </div>
      )}
    </section>
  );
}

function History() {
  const { t, lang } = useT();
  const q = useBillingPaymentsQuery();
  if (q.isLoading) return <Skeleton className="h-32" />;
  if (q.isError) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;
  const rows = q.data ?? [];
  return (
    <Card title={t('bill.history')}>
      {rows.length === 0 ? (
        <EmptyState title={t('bill.noPayments')} icon={<Receipt className="size-8" />} />
      ) : (
        <div className="-mx-4 overflow-x-auto sm:mx-0">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="px-4 py-2 font-medium">{t('bill.date')}</th>
                <th className="px-4 py-2 font-medium">{t('admin.plan')}</th>
                <th className="px-4 py-2 font-medium">{t('bill.period')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('bill.amount')}</th>
                <th className="px-4 py-2 font-medium">{t('common.status')}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{formatDate(p.verifiedAt ?? p.createdAt, lang)}</td>
                  <td className="px-4 py-2.5">{lang === 'hi' ? (p.plan.nameHindi ?? p.plan.name) : p.plan.name}</td>
                  <td className="px-4 py-2.5 text-ink-2">{p.periodStart ? `${formatDate(p.periodStart, lang)} – ${formatDate(p.periodEnd, lang)}` : '—'}</td>
                  <td className="num px-4 py-2.5 text-right font-medium">{formatMoney(p.amount)}</td>
                  <td className="px-4 py-2.5">
                    <Badge tone={p.status === 'SUCCEEDED' ? 'green' : p.status === 'FAILED' ? 'red' : 'neutral'}>{t(`bill.pay.${p.status}` as MessageKey)}</Badge>
                    {p.status === 'FAILED' && p.failureReason && <span className="ml-2 text-xs text-ink-3">{p.failureReason}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {p.status === 'SUCCEEDED' && (
                      <a href={`/api/v1/billing/payments/${p.id}/receipt`} target="_blank" rel="noopener" className="text-brand-800 underline-offset-2 hover:underline">
                        {t('bill.receipt')}
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

export default function BillingPage() {
  const { t, lang } = useT();
  const toast = useToast();
  const can = useCan();
  const canManage = can('subscription:manage');
  const billing = useBillingQuery();
  const plans = usePlansQuery();
  const [checkout] = useCheckoutMutation();
  const [mockComplete] = useMockCompleteMutation();
  const [verify] = useVerifyPaymentMutation();
  const [changePlan] = useChangePlanMutation();
  const [busy, setBusy] = useState<string | null>(null);
  const [testOrder, setTestOrder] = useState<CheckoutOrder | null>(null);

  if (!can('subscription:read')) return <ErrorState message={t('bill.ownerOnly')} />;
  if (billing.isLoading || plans.isLoading) return <Skeleton className="h-96" />;
  if (billing.isError || !billing.data) return <ErrorState message={apiError(billing.error).message} onRetry={billing.refetch} />;
  const b = billing.data;

  const finish = async (r: { orderId: string; paymentId: string; signature: string }) => {
    await verify(r).unwrap();
    toast.success(t('bill.success'));
  };

  const pay = async (plan: Plan) => {
    setBusy(plan.code);
    try {
      const order = await checkout(plan.code).unwrap();
      if (order.provider === 'mock') {
        setTestOrder(order);
        return;
      }
      let res;
      try {
        res = await openRazorpay(order, { description: `${plan.name} — ${b.plan.code === plan.code ? 'renewal' : 'plan'}` });
      } catch {
        toast.error(t('bill.scriptFailed'));
        return;
      }
      if (res.ok) await finish(res);
      else toast.info(t('bill.dismissed'));
    } catch (e) {
      toast.error(apiError(e).message);
    } finally {
      setBusy((cur) => (cur === plan.code ? null : cur));
    }
  };

  const schedule = async (plan: Plan) => {
    setBusy(plan.code);
    try {
      const r = await changePlan(plan.code).unwrap();
      toast.success(t('common.saved'));
      for (const w of r.warnings ?? []) if (w.resource === 'farmers') toast.info(t('bill.warnFarmers', { count: w.count, limit: w.limit }));
    } catch (e) {
      toast.error(apiError(e).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title={t('bill.title')}
        subtitle={t('bill.subtitle')}
        action={
          b.provider === 'mock' ? (
            <Badge tone="amber">
              <FlaskConical className="size-3.5" aria-hidden /> {t('bill.testMode')}
            </Badge>
          ) : undefined
        }
      />
      <div className="flex flex-col gap-6">
        <CurrentPlan b={b} canManage={canManage} />
        {!canManage && <p className="text-sm text-ink-2">{t('bill.ownerOnly')}</p>}
        <div>
          <h2 className="mb-3 text-base font-semibold">{t('bill.plans')}</h2>
          <div className="grid gap-4 md:grid-cols-3">
            {(plans.data?.plans ?? []).map((p) => (
              <PlanCard key={p.code} plan={p} b={b} canManage={canManage} busy={busy} onPay={pay} onSchedule={schedule} />
            ))}
          </div>
        </div>
        <History />
      </div>

      <Modal open={!!testOrder} onClose={() => { setTestOrder(null); setBusy(null); }} title={t('bill.testPayTitle')}>
        {testOrder && (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink-2">{t('bill.testPayBody')}</p>
            <p className="num text-lg font-semibold">
              {lang === 'hi' ? (testOrder.plan.nameHindi ?? testOrder.plan.name) : testOrder.plan.name} — {formatMoney(testOrder.amount)}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setTestOrder(null); setBusy(null); toast.info(t('bill.dismissed')); }}>
                {t('common.cancel')}
              </Button>
              <Button
                onClick={async () => {
                  try {
                    await finish(await mockComplete(testOrder.orderId).unwrap());
                  } catch (e) {
                    toast.error(apiError(e).message);
                  } finally {
                    setTestOrder(null);
                    setBusy(null);
                  }
                }}
              >
                {t('bill.testPayButton')}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
