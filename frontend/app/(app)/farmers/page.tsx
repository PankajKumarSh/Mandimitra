'use client';

import { Plus, Users } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Balance, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { FarmerForm } from '@/features/farmers/farmer-form';
import { useCan, useDebounce, useT } from '@/hooks';
import { formatMobile } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useFarmersQuery, useVillagesQuery } from '@/services/api';

export default function FarmersPage() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [village, setVillage] = useState('');
  const [sort, setSort] = useState('name');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const dq = useDebounce(q.trim(), 300);
  const list = useFarmersQuery({ q: dq, village, sort, page, pageSize: 25 });
  const villages = useVillagesQuery();
  const filtered = !!(dq || village);

  return (
    <>
      <PageHeader
        title={t('farmer.title')}
        subtitle={list.data ? `${list.data.total}` : undefined}
        action={can('farmer:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('farmer.add')}</Button>}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <Input
          type="search"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(1);
          }}
          placeholder={`${t('common.search')}: ${t('farmer.name')}, ${t('auth.mobile')}, ${t('farmer.code')}…`}
          aria-label={t('common.search')}
          className="max-w-sm flex-1"
        />
        <Select value={village} onChange={(e) => { setVillage(e.target.value); setPage(1); }} aria-label={t('farmer.village')} className="w-44">
          <option value="">{t('farmer.allVillages')}</option>
          {villages.data?.map((v) => <option key={v} value={v}>{v}</option>)}
        </Select>
        <Select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort" className="w-44">
          <option value="name">{t('farmer.name')} A→Z</option>
          <option value="-createdAt">नए पहले / Newest</option>
          <option value="-balance">{t('farmer.weOwe')} ↓</option>
          <option value="balance">{t('farmer.advance')} ↓</option>
          <option value="code">{t('farmer.code')}</option>
        </Select>
      </div>

      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? (
          <ErrorState message={apiError(list.error).message} onRetry={list.refetch} />
        ) : list.isLoading ? (
          <div className="flex flex-col gap-2 p-4">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : !list.data?.items.length ? (
          <EmptyState
            icon={<Users className="size-6" aria-hidden />}
            title={filtered ? t('common.noResults') : t('farmer.empty')}
            hint={filtered ? undefined : t('farmer.emptyHint')}
            action={!filtered && can('farmer:create') && <Button onClick={() => setAdding(true)}>{t('farmer.add')}</Button>}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('farmer.code')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('farmer.name')}</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">{t('farmer.village')}</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('auth.mobile')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('common.balance')}</th>
                  </tr>
                </thead>
                <tbody className={list.isFetching ? 'opacity-60' : undefined}>
                  {list.data.items.map((f) => (
                    <tr key={f.id} className="border-t border-line hover:bg-canvas/60">
                      <td className="num px-4 py-3 text-sm text-ink-3">{f.code}</td>
                      <td className="px-4 py-3">
                        <Link href={`/farmers/${f.id}`} className="font-medium text-ink hover:text-brand-800 hover:underline">{f.name}</Link>
                        {f.nameHindi && <span className="block text-sm text-ink-2">{f.nameHindi}</span>}
                        {f.fatherName && <span className="block text-xs text-ink-3">s/o {f.fatherName}</span>}
                        {!f.isActive && <Badge>{t('common.inactive')}</Badge>}
                      </td>
                      <td className="hidden px-4 py-3 text-ink-2 md:table-cell">{f.village ?? '—'}</td>
                      <td className="num hidden px-4 py-3 text-ink-2 sm:table-cell">{formatMobile(f.mobile)}</td>
                      <td className="px-4 py-3 text-right"><Balance value={f.currentBalance} side="farmer" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
          </>
        )}
      </Card>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('farmer.add')} wide>
        <FarmerForm onDone={(id) => { setAdding(false); router.push(`/farmers/${id}`); }} />
      </Modal>
    </>
  );
}
