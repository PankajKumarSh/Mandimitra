'use client';

import clsx from 'clsx';
import { FileText, Plus } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { usePattisQuery } from '@/services/api';

export default function PattiListPage() {
  const { t, lang } = useT();
  const can = useCan();
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const list = usePattisQuery({ status: status || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 });

  return (
    <>
      <PageHeader
        title={t('patti.title')}
        action={can('patti:create') && <Link href="/patti/new" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-800 px-4 text-[15px] font-medium text-white hover:bg-brand-900"><Plus className="size-4" aria-hidden /> {t('patti.new')}</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label={t('common.status')} className="w-40">
          <option value="">{t('common.all')}</option>
          <option value="FINALIZED">{t('patti.finalized')}</option>
          <option value="CANCELLED">{t('patti.cancelled')}</option>
        </Select>
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : !list.data?.items.length ? (
          <EmptyState icon={<FileText className="size-6" aria-hidden />} title={t('patti.empty')} action={can('patti:create') && <Link href="/patti/new" className="text-brand-800 hover:underline">{t('patti.new')}</Link>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('patti.number')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('lot.farmer')}</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">{t('sale.weight')}</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t('patti.gross')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('patti.payable')}</th>
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id} className={clsx('border-t border-line hover:bg-canvas/60', p.status === 'CANCELLED' && 'opacity-60')}>
                      <td className="px-4 py-3">
                        <Link href={`/patti/${p.id}`} className="num font-medium hover:text-brand-800 hover:underline">{p.pattiNumber}</Link>
                        <span className="block text-xs text-ink-3">{formatDate(p.pattiDate, lang)}</span>
                      </td>
                      <td className="px-4 py-3">{lang === 'hi' ? (p.farmer.nameHindi ?? p.farmer.name) : p.farmer.name} {p.status === 'CANCELLED' && <Badge tone="red">{t('patti.cancelled')}</Badge>}</td>
                      <td className="num hidden px-4 py-3 text-right md:table-cell">{formatQuintals(p.totalWeightKg, t('unit.qtl'))}</td>
                      <td className="num hidden px-4 py-3 text-right sm:table-cell">{formatMoney(p.grossAmount, { decimals: 0 })}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{formatMoney(p.netPayable)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
    </>
  );
}
