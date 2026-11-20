'use client';

import { Plus, Truck } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { LotStatusBadge } from '@/features/common';
import { LotForm } from '@/features/lots/lot-form';
import { useCan, useDebounce, useT } from '@/hooks';
import { formatDate, formatQuintals } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useLotsQuery } from '@/services/api';

const STATUSES = ['OPEN', 'DRAFT', 'PARTIALLY_SOLD', 'SOLD', 'CANCELLED'] as const;

export default function ArrivalsPage() {
  const { t, lang } = useT();
  const can = useCan();
  const router = useRouter();
  const [status, setStatus] = useState<string>('OPEN');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounce(q.trim(), 300);
  const list = useLotsQuery({ status: status || undefined, q: dq || undefined, from: from || undefined, to: to || undefined, page, pageSize: 25 });

  return (
    <>
      <PageHeader title={t('lot.title')} action={can('lot:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('lot.add')}</Button>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={`${t('lot.number')}, ${t('lot.vehicle')}, ${t('lot.farmer')}`} aria-label={t('common.search')} className="max-w-xs flex-1" />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('common.status')} className="w-44">
          <option value="">{t('common.all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`lot.status.${s}` as MessageKey)}</option>)}
        </Select>
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 5 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState icon={<Truck className="size-6" aria-hidden />} title={t('lot.empty')} hint={t('lot.emptyHint')} action={can('lot:create') && <Button onClick={() => setAdding(true)}>{t('lot.add')}</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('lot.number')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('lot.farmer')}</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('lot.commodity')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('lot.net')}</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">{t('lot.available')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('common.status')}</th>
                  </tr>
                </thead>
                <tbody className={list.isFetching ? 'opacity-60' : undefined}>
                  {list.data.items.map((l) => (
                    <tr key={l.id} className="border-t border-line hover:bg-canvas/60">
                      <td className="px-4 py-3">
                        <Link href={`/arrivals/${l.id}`} className="num font-medium hover:text-brand-800 hover:underline">{l.lotNumber}</Link>
                        <span className="block text-xs text-ink-3">{formatDate(l.arrivalDate, lang)}{l.vehicleNumber ? ` · ${l.vehicleNumber}` : ''}</span>
                      </td>
                      <td className="px-4 py-3">{lang === 'hi' ? (l.farmer.nameHindi ?? l.farmer.name) : l.farmer.name}<span className="block text-xs text-ink-3">{l.farmer.village}</span></td>
                      <td className="hidden px-4 py-3 sm:table-cell">{lang === 'hi' ? (l.commodity.nameHindi ?? l.commodity.name) : l.commodity.name}{l.grade ? ` · ${l.grade.name}` : ''}</td>
                      <td className="num px-4 py-3 text-right">{formatQuintals(l.netWeightKg, t('unit.qtl'))}</td>
                      <td className="num hidden px-4 py-3 text-right md:table-cell">{l.status === 'CANCELLED' ? '—' : formatQuintals(l.unsoldKg, t('unit.qtl'))}</td>
                      <td className="px-4 py-3"><LotStatusBadge status={l.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('lot.add')} wide>
        <LotForm onDone={(lot) => { setAdding(false); router.push(`/arrivals/${lot.id}`); }} />
      </Modal>
    </>
  );
}
