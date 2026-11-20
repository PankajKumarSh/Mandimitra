'use client';

import { BookUser } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Balance, Card, Checkbox, EmptyState, ErrorState, Input, PageHeader, Pagination, Skeleton } from '@/components/ui';
import { useDebounce, useT } from '@/hooks';
import { useBuyersQuery, useFarmersQuery } from '@/services/api';
import { apiError } from '@/services/base-query';

/** Ledger landing: parties sorted by balance, each opening its statement. */
export function PartyIndex({ side }: { side: 'farmers' | 'buyers' }) {
  const { t, lang } = useT();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [outstanding, setOutstanding] = useState(true);
  const dq = useDebounce(q.trim(), 300);
  const farmers = useFarmersQuery({ q: dq || undefined, sort: '-balance', page, pageSize: 50 }, { skip: side !== 'farmers' });
  const buyers = useBuyersQuery({ q: dq || undefined, sort: '-balance', hasOutstanding: outstanding || undefined, page, pageSize: 50 }, { skip: side !== 'buyers' });
  const list = side === 'farmers' ? farmers : buyers;
  const items = (list.data?.items ?? []) as { id: string; code: string; name?: string; nameHindi?: string | null; firmName?: string; village?: string | null; city?: string | null; currentBalance: string }[];

  return (
    <>
      <PageHeader title={side === 'farmers' ? t('ledger.farmers') : t('ledger.buyers')} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="search" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder={t('common.search')} aria-label={t('common.search')} className="max-w-sm flex-1" />
        {side === 'buyers' && <Checkbox label={t('buyer.outstandingOnly')} checked={outstanding} onChange={(e) => { setOutstanding(e.target.checked); setPage(1); }} />}
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : items.length === 0 ? (
          <EmptyState icon={<BookUser className="size-6" aria-hidden />} title={t('common.noResults')} />
        ) : (
          <>
            <ul className="divide-y divide-line">
              {items.map((p) => (
                <li key={p.id}>
                  <Link href={`/ledger/${side}/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-canvas/60">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{side === 'farmers' ? (lang === 'hi' ? (p.nameHindi ?? p.name) : p.name) : p.firmName}</span>
                      <span className="num block text-xs text-ink-3">{p.code} · {p.village ?? p.city ?? ''}</span>
                    </span>
                    <Balance value={p.currentBalance} side={side === 'farmers' ? 'farmer' : 'buyer'} />
                  </Link>
                </li>
              ))}
            </ul>
            {list.data && <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />}
          </>
        )}
      </Card>
    </>
  );
}
