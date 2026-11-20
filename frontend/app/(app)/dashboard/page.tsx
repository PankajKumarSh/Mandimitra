'use client';

import clsx from 'clsx';
import { AlertTriangle, Clock, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Skeleton } from '@/components/ui';
import { MonthChart } from '@/features/dashboard/month-chart';
import { useT } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useDashboardQuery } from '@/services/api';
import type { RangeKey } from '@/types/api';

const RANGES: { key: RangeKey; label: MessageKey }[] = [
  { key: 'today', label: 'dash.today' },
  { key: 'yesterday', label: 'dash.yesterday' },
  { key: 'week', label: 'dash.week' },
  { key: 'month', label: 'dash.month' },
  { key: 'custom', label: 'dash.custom' },
];

function Kpi({ label, value, sub, note, tone }: { label: string; value: string; sub?: string; note?: string; tone?: 'orange' | 'green' }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={clsx('num mt-1 text-2xl font-semibold tracking-tight sm:text-[28px]', tone === 'orange' ? 'text-accent-700' : tone === 'green' ? 'text-brand-800' : 'text-ink')}>{value}</p>
      {sub && <p className="num mt-0.5 text-xs text-ink-3">{sub}</p>}
      {note && <p className="mt-1 text-[11px] font-medium text-ink-3">{note}</p>}
    </div>
  );
}

export default function DashboardPage() {
  const { t, lang } = useT();
  const [range, setRange] = useState<RangeKey>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const customReady = range !== 'custom' || (from && to && from <= to);
  const q = useDashboardQuery(range === 'custom' ? { range, from, to } : { range }, { skip: !customReady });
  const d = q.data;

  return (
    <>
      <PageHeader title={t('dash.title')} subtitle={d ? `${formatDate(d.range.from, lang)}${d.range.from !== d.range.to ? ` – ${formatDate(d.range.to, lang)}` : ''}` : undefined} />

      {/* Filters: one row above the content */}
      <div className="mb-5 flex flex-wrap items-center gap-2">
        <div role="radiogroup" aria-label="Date range" className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-1">
          {RANGES.map((r) => (
            <button
              key={r.key}
              role="radio"
              aria-checked={range === r.key}
              onClick={() => setRange(r.key)}
              className={clsx('rounded-md px-3 py-1.5 text-sm font-medium', range === r.key ? 'bg-brand-800 text-white' : 'text-ink-2 hover:bg-canvas')}
            >
              {t(r.label)}
            </button>
          ))}
        </div>
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" aria-label={t('dash.from')} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-sm text-ink-3">{t('dash.to')}</span>
            <Input type="date" aria-label={t('dash.to')} value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        )}
      </div>

      {q.isError ? (
        <Card><ErrorState message={apiError(q.error).message} onRetry={q.refetch} /></Card>
      ) : !d || q.isFetching && !q.data ? (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className={clsx('flex flex-col gap-5', q.isFetching && 'opacity-70')}>
          {/* Period figures — kept separate; gross sales is never shown as profit */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi label={t('dash.arrivals')} value={formatQuintals(d.arrivals.netWeightKg, t('unit.qtl'))} sub={`${d.arrivals.lots} ${t('dash.lots')}`} />
            <Kpi label={t('dash.purchases')} value={formatMoney(d.purchases.grossAmount, { decimals: 0 })} sub={formatQuintals(d.purchases.weightKg, t('unit.qtl'))} />
            <Kpi label={t('dash.grossSales')} value={formatMoney(d.grossSales.amount, { decimals: 0 })} sub={formatQuintals(d.grossSales.weightKg, t('unit.qtl'))} note={t('dash.grossSalesNote')} />
            <Kpi label={t('dash.commission')} value={formatMoney(d.commissionIncome, { decimals: 0 })} tone="green" />
            <Kpi label={t('dash.expenses')} value={formatMoney(d.expenses.amount, { decimals: 0 })} sub={`${d.expenses.count}`} />
            {/* Positions — as of now, not range-bound */}
            <Kpi label={t('dash.payables')} value={formatMoney(d.payables.amount, { decimals: 0 })} sub={`${d.payables.farmers} ${t('nav.farmers')}`} tone="orange" />
            <Kpi label={t('dash.receivables')} value={formatMoney(d.receivables.amount, { decimals: 0 })} sub={`${d.receivables.buyers} ${t('nav.buyers')}`} />
            <Kpi label={t('dash.advances')} value={formatMoney(d.advancesOutstanding.amount, { decimals: 0 })} sub={`${d.advancesOutstanding.farmers} ${t('nav.farmers')}`} />
          </div>

          <div className="grid grid-cols-2 gap-3 sm:max-w-md">
            <Link href="/farmers" className="rounded-xl border border-line bg-surface p-4 hover:border-brand-200">
              <p className="text-sm text-ink-2">{t('dash.farmers')}</p>
              <p className="num mt-1 text-2xl font-semibold">{d.counts.farmers}</p>
            </Link>
            <Link href="/buyers" className="rounded-xl border border-line bg-surface p-4 hover:border-brand-200">
              <p className="text-sm text-ink-2">{t('dash.buyers')}</p>
              <p className="num mt-1 text-2xl font-semibold">{d.counts.buyers}</p>
            </Link>
          </div>

          <div className="grid gap-5 lg:grid-cols-3">
            <Card title={t('dash.recent')} className="lg:col-span-2">
              {d.recent.length === 0 ? (
                <EmptyState title={t('dash.noRecent')} />
              ) : (
                <ul className="-my-2 divide-y divide-line">
                  {d.recent.map((r) => (
                    <li key={`${r.type}-${r.id}`} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-[15px] text-ink">{r.party}</p>
                        <p className="text-xs text-ink-3">
                          {t(`txn.${r.type}` as MessageKey)} · {r.number} · {formatDate(r.date, lang)}
                        </p>
                      </div>
                      <span className={clsx('num shrink-0 font-semibold', r.status === 'CANCELLED' && 'text-ink-3 line-through')}>{formatMoney(r.amount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card title={t('dash.alerts')}>
              <div className="flex flex-col gap-4">
                {d.alerts.trialDaysLeft !== null && (
                  <p className="flex items-center gap-2 text-sm text-ink-2">
                    <Clock className="size-4 text-warn-700" aria-hidden /> {t('dash.trialEnds', { n: Math.max(0, d.alerts.trialDaysLeft) })}
                  </p>
                )}
                {d.alerts.pendingApprovals > 0 && (
                  <p className="flex items-center gap-2 text-sm"><ShieldCheck className="size-4 text-brand-700" aria-hidden /> {t('dash.pendingApprovals')}: {d.alerts.pendingApprovals}</p>
                )}
                {d.alerts.buyersOverCreditLimit.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-sm font-medium text-danger-700">
                      <AlertTriangle className="size-4" aria-hidden /> {t('dash.overLimit')}
                    </p>
                    <ul className="flex flex-col gap-1.5">
                      {d.alerts.buyersOverCreditLimit.map((b) => (
                        <li key={b.id} className="flex justify-between gap-2 text-sm">
                          <Link href={`/buyers/${b.id}`} className="truncate hover:underline">{b.firmName}</Link>
                          <span className="num">{formatMoney(b.currentBalance, { decimals: 0 })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {d.alerts.topReceivables.length > 0 ? (
                  <div>
                    <p className="mb-2 text-sm font-medium text-ink">{t('dash.topReceivables')}</p>
                    <ul className="flex flex-col gap-1.5">
                      {d.alerts.topReceivables.map((b) => (
                        <li key={b.id} className="flex justify-between gap-2 text-sm">
                          <Link href={`/buyers/${b.id}`} className="truncate hover:underline">{b.firmName}</Link>
                          <span className="num">{formatMoney(b.currentBalance, { decimals: 0 })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  d.alerts.trialDaysLeft === null && <p className="text-sm text-ink-3">{t('dash.noAlerts')}</p>
                )}
                {d.alerts.buyersOverCreditLimit.length > 0 && <Badge tone="red">{d.alerts.buyersOverCreditLimit.length} {t('buyer.overLimit')}</Badge>}
              </div>
            </Card>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card>
              <MonthChart
                title={t('dash.tradeChart')}
                rows={d.monthly}
                series={[
                  { key: 'grossSales', label: t('dash.grossSales'), color: 'var(--color-series-1)' },
                  { key: 'purchases', label: t('dash.purchases'), color: 'var(--color-series-2)' },
                ]}
              />
            </Card>
            <Card>
              <MonthChart
                title={t('dash.incomeChart')}
                rows={d.monthly}
                series={[
                  { key: 'commission', label: t('dash.commission'), color: 'var(--color-series-1)' },
                  { key: 'expenses', label: t('dash.expenses'), color: 'var(--color-series-2)' },
                ]}
              />
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
