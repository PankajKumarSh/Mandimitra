'use client';

import { Plus, Store } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Balance, Button, Card, Checkbox, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { BuyerForm } from '@/features/buyers/buyer-form';
import { useCan, useDebounce, useT } from '@/hooks';
import { formatMobile, formatMoney } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useBuyersQuery } from '@/services/api';

export default function BuyersPage() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [outstanding, setOutstanding] = useState(false);
  const [sort, setSort] = useState('firmName');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounce(q.trim(), 300);
  const list = useBuyersQuery({ q: dq, hasOutstanding: outstanding || undefined, sort, page, pageSize: 25 });
  const filtered = !!dq || outstanding;

  return (
    <>
      <PageHeader
        title={t('buyer.title')}
        subtitle={list.data ? `${list.data.total}` : undefined}
        action={can('buyer:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('buyer.add')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={`${t('common.search')}: ${t('buyer.firmName')}, GSTIN…`} aria-label={t('common.search')} className="max-w-sm flex-1" />
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="w-44">
          <option value="firmName">{t('buyer.firmName')} A→Z</option>
          <option value="-balance">{t('common.balance')} ↓</option>
          <option value="-createdAt">नए पहले / Newest</option>
        </Select>
        <Checkbox label={t('buyer.outstandingOnly')} checked={outstanding} onChange={(e) => { setOutstanding(e.target.checked); setPage(1); }} />
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? (
          <ErrorState message={apiError(list.error).message} onRetry={list.refetch} />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={<Store className="size-6" aria-hidden />}
            title={filtered ? t('common.noResults') : t('buyer.empty')}
            hint={filtered ? undefined : t('buyer.emptyHint')}
            action={!filtered && can('buyer:create') && <Button onClick={() => setAdding(true)}>{t('buyer.add')}</Button>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('farmer.code')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('buyer.firmName')}</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">{t('buyer.city')}</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('auth.mobile')}</th>
                    <th className="hidden px-4 py-2.5 text-right font-medium lg:table-cell">{t('buyer.creditLimit')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('common.balance')}</th>
                  </tr>
                </thead>
                <tbody className={list.isFetching ? 'opacity-60' : undefined}>
                  {list.data.items.map((b) => (
                    <tr key={b.id} className="border-t border-line hover:bg-canvas/60">
                      <td className="num px-4 py-3 text-sm text-ink-3">{b.code}</td>
                      <td className="px-4 py-3">
                        <Link href={`/buyers/${b.id}`} className="font-medium hover:text-brand-800 hover:underline">{b.firmName}</Link>
                        {b.ownerName && <span className="block text-sm text-ink-2">{b.ownerName}</span>}
                        {b.overCreditLimit && <Badge tone="red">{t('buyer.overLimit')}</Badge>}
                      </td>
                      <td className="hidden px-4 py-3 text-ink-2 md:table-cell">{b.city ?? '—'}</td>
                      <td className="num hidden px-4 py-3 text-ink-2 sm:table-cell">{formatMobile(b.mobile)}</td>
                      <td className="num hidden px-4 py-3 text-right text-ink-2 lg:table-cell">{b.creditLimit ? formatMoney(b.creditLimit, { decimals: 0 }) : '—'}</td>
                      <td className="px-4 py-3 text-right"><Balance value={b.currentBalance} side="buyer" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('buyer.add')} wide>
        <BuyerForm onDone={(id) => { setAdding(false); router.push(`/buyers/${id}`); }} />
      </Modal>
    </>
  );
}
