'use client';

import clsx from 'clsx';
import { Ban, Wheat } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { CancelDialog, todayIST } from '@/features/common';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelSaleMutation, useSalesQuery } from '@/services/api';

export default function SalesPage() {
  const { t, lang } = useT();
  const can = useCan();
  const [from, setFrom] = useState(todayIST());
  const [to, setTo] = useState(todayIST());
  const [status, setStatus] = useState('ACTIVE');
  const [page, setPage] = useState(1);
  const list = useSalesQuery({ from: from || undefined, to: to || undefined, status: status || undefined, page, pageSize: 50 });
  const [cancelSale] = useCancelSaleMutation();
  const [cancelling, setCancelling] = useState<string | null>(null);

  return (
    <>
      <PageHeader
        title={t('sale.title')}
        subtitle={list.data?.totals ? `${t('common.total')}: ${formatMoney(list.data.totals.grossAmount ?? '0', { decimals: 0 })} · ${formatQuintals(list.data.totals.weightKg ?? '0', t('unit.qtl'))}` : undefined}
        action={can('sale:create') && <Link href="/arrivals" className="inline-flex h-10 items-center rounded-lg bg-brand-800 px-4 text-[15px] font-medium text-white hover:bg-brand-900">{t('sale.chooseLot')}</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <span className="text-sm text-ink-3">{t('common.to')}</span>
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('common.status')} className="w-40">
          <option value="ACTIVE">{t('common.active')}</option>
          <option value="CANCELLED">{t('lot.status.CANCELLED')}</option>
          <option value="">{t('common.all')}</option>
        </Select>
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : !list.data?.items.length ? (
          <EmptyState icon={<Wheat className="size-6" aria-hidden />} title={t('sale.empty')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('sale.number')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('sale.buyer')}</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">{t('lot.farmer')} / {t('lot.number')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('sale.weight')} × {t('sale.rate')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('sale.total')}</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((s) => (
                    <tr key={s.id} className={clsx('border-t border-line', s.status === 'CANCELLED' && 'opacity-60')}>
                      <td className="px-4 py-3"><span className="num">{s.saleNumber}</span><span className="block text-xs text-ink-3">{formatDate(s.saleDate, lang)}</span></td>
                      <td className="px-4 py-3"><Link href={`/buyers/${s.buyer.id}`} className="hover:underline">{s.buyer.firmName}</Link>{s.status === 'CANCELLED' && <Badge tone="red">{t('lot.status.CANCELLED')}</Badge>}</td>
                      <td className="hidden px-4 py-3 text-sm md:table-cell">{lang === 'hi' ? (s.lot.farmer.nameHindi ?? s.lot.farmer.name) : s.lot.farmer.name}<Link href={`/arrivals/${s.lot.id}`} className="num block text-xs text-ink-3 hover:underline">{s.lot.lotNumber} · {lang === 'hi' ? (s.commodity.nameHindi ?? s.commodity.name) : s.commodity.name}</Link></td>
                      <td className="num px-4 py-3 text-right text-sm">{formatQuintals(s.weightKg, t('unit.qtl'))} × {formatMoney(s.rate, { decimals: 0 })}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{formatMoney(s.totalAmount)}{s.chargesTotal !== '0' && <span className="block text-xs font-normal text-ink-3">{formatMoney(s.grossAmount)} + {formatMoney(s.chargesTotal)}</span>}</td>
                      <td className="px-2 py-3">
                        {s.status === 'ACTIVE' && !s.purchase?.pattiId && (can('sale:cancel') || can('approval:request')) && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(s.id)} aria-label={t('sale.cancel')}><Ban className="size-4 text-danger-600" aria-hidden /></Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <CancelDialog open={!!cancelling} title={t('sale.cancel')} onClose={() => setCancelling(null)} onSubmit={(reason, key) => cancelSale({ key, body: { id: cancelling!, reason } }).unwrap()} />
    </>
  );
}
