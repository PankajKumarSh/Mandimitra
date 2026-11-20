'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Input, Pagination, Select, Skeleton } from '@/components/ui';
import { useDebounce, useT } from '@/hooks';
import { formatDate, formatMobile, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useAdminBusinessesQuery, useAdminOverviewQuery } from '@/services/api';
import { SUB_TONE } from '@/features/billing/status';
import type { SubStatus } from '@/types/billing';

const SUB_STATUSES: SubStatus[] = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'];

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className="num mt-1 text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-1 text-xs text-ink-3">{hint}</p>}
    </div>
  );
}

function Overview() {
  const { t } = useT();
  const q = useAdminOverviewQuery();
  if (q.isLoading) return <Skeleton className="h-40" />;
  if (q.isError || !q.data) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;
  const o = q.data;
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('admin.mrr')} value={formatMoney(o.mrr, { decimals: 0 })} hint={t('admin.mrrHint')} />
        <Stat label={t('admin.revenue30')} value={formatMoney(o.revenueLast30Days, { decimals: 0 })} />
        <Stat label={t('admin.signups30')} value={o.signupsLast30Days} />
        <Stat label={t('admin.trialsEnding')} value={o.trialsEndingIn7Days} />
        <Stat label={t('admin.failed30')} value={o.failedPaymentsLast30Days} />
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <Card title={t('admin.byStatus')}>
          <ul className="flex flex-wrap gap-2">
            {Object.entries(o.subscriptions).map(([k, n]) => (
              <li key={k}>
                <Badge tone={SUB_TONE[k as SubStatus] ?? 'neutral'}>
                  {t(`bill.status.${k}` as MessageKey)} · {n}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
        <Card title={t('admin.byPlan')}>
          <ul className="flex flex-wrap gap-2">
            {Object.keys(o.activePaidByPlan).length === 0 ? <li className="text-sm text-ink-3">—</li> : Object.entries(o.activePaidByPlan).map(([k, n]) => <li key={k}><Badge>{k} · {n}</Badge></li>)}
          </ul>
        </Card>
      </div>
    </div>
  );
}

export default function AdminHome() {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const dq = useDebounce(q.trim(), 300);
  const list = useAdminBusinessesQuery({ q: dq || undefined, subscriptionStatus: status || undefined, page, pageSize: 25 });

  return (
    <div className="flex flex-col gap-6">
      <Overview />
      <Card title={t('admin.businesses')}>
        <div className="mb-4 flex flex-wrap gap-2">
          <Input className="max-w-sm" type="search" placeholder={t('admin.searchPlaceholder')} aria-label={t('common.search')} value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select className="max-w-48" aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">{t('common.all')}</option>
            {SUB_STATUSES.map((s) => <option key={s} value={s}>{t(`bill.status.${s}` as MessageKey)}</option>)}
          </Select>
        </div>
        {list.isLoading ? (
          <Skeleton className="h-48" />
        ) : list.isError ? (
          <ErrorState message={apiError(list.error).message} onRetry={list.refetch} />
        ) : !list.data?.items.length ? (
          <EmptyState title={t('common.noResults')} />
        ) : (
          <>
            <div className="-mx-4 overflow-x-auto sm:mx-0">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-ink-3">
                    <th className="px-3 py-2 font-medium">{t('admin.business')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.owner')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.plan')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.status')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.periodEnd')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('bill.usage.staff')} / {t('bill.usage.farmers')}</th>
                    <th className="px-3 py-2 font-medium">{t('admin.joined')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((b) => {
                    const s = b.subscription;
                    const end = s?.effectiveStatus === 'TRIALING' ? s.trialEndsAt : s?.currentPeriodEnd;
                    return (
                      <tr key={b.id} className="border-b border-line last:border-0 hover:bg-canvas">
                        <td className="px-3 py-2.5">
                          <Link href={`/admin/businesses/${b.id}`} className="font-medium text-brand-800 hover:underline">{b.name}</Link>
                          <span className="block text-xs text-ink-3">{[b.city, b.state].filter(Boolean).join(', ')}</span>
                        </td>
                        <td className="px-3 py-2.5">{b.owner.fullName}<span className="block text-xs text-ink-3">{formatMobile(b.owner.mobile)}</span></td>
                        <td className="px-3 py-2.5">{s?.plan.code ?? '—'}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1">
                            {b.status !== 'ACTIVE' && <Badge tone="red">{t(`admin.biz.${b.status}` as MessageKey)}</Badge>}
                            {s && <Badge tone={SUB_TONE[s.effectiveStatus]}>{t(`bill.status.${s.effectiveStatus}` as MessageKey)}</Badge>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5">{formatDate(end, lang)}</td>
                        <td className="num px-3 py-2.5 text-right">{b._count.memberships} / {b._count.farmers}</td>
                        <td className="px-3 py-2.5">{formatDate(b.createdAt, lang)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={25} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
