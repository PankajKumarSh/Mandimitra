'use client';

import clsx from 'clsx';
import { Ban, Plus, Receipt } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { CancelDialog, todayIST } from '@/features/common';
import { ExpenseForm } from '@/features/expenses/expense-form';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelExpenseMutation, useExpenseCategoriesQuery, useExpensesQuery } from '@/services/api';

export default function ExpensesPage() {
  const { t, lang } = useT();
  const can = useCan();
  const today = todayIST();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [categoryId, setCategoryId] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const cats = useExpenseCategoriesQuery();
  const list = useExpensesQuery({ from: from || undefined, to: to || undefined, categoryId: categoryId || undefined, page, pageSize: 50 });
  const [cancelExpense] = useCancelExpenseMutation();

  return (
    <>
      <PageHeader
        title={t('exp.title')}
        subtitle={list.data?.totals ? `${t('common.total')}: ${formatMoney(list.data.totals.amount)}` : undefined}
        action={can('expense:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('exp.add')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
        <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }} aria-label={t('exp.category')} className="w-48">
          <option value="">{t('exp.category')}: {t('common.all')}</option>
          {cats.data?.map((c) => <option key={c.id} value={c.id}>{lang === 'hi' ? (c.nameHindi ?? c.name) : c.name}</option>)}
        </Select>
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="overflow-hidden lg:col-span-2 [&>div]:p-0">
          {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : !list.data?.items.length ? (
            <EmptyState icon={<Receipt className="size-6" aria-hidden />} title={t('exp.empty')} action={can('expense:create') && <Button onClick={() => setAdding(true)}>{t('exp.add')}</Button>} />
          ) : (
            <>
              <ul className="divide-y divide-line">
                {list.data.items.map((x) => (
                  <li key={x.id} className={clsx('flex items-center justify-between gap-3 px-4 py-3', x.status === 'CANCELLED' && 'opacity-60')}>
                    <div className="min-w-0">
                      <p className="font-medium">{lang === 'hi' ? (x.category.nameHindi ?? x.category.name) : x.category.name} {x.status === 'CANCELLED' && <Badge tone="red">{t('lot.status.CANCELLED')}</Badge>}</p>
                      <p className="num text-xs text-ink-3">{x.expenseNumber} · {formatDate(x.expenseDate, lang)} · {t(`pay.${x.mode}`)}{x.payee ? ` · ${x.payee}` : ''}</p>
                      {x.remarks && <p className="text-xs text-ink-3">{x.remarks}</p>}
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={clsx('num font-semibold', x.status === 'CANCELLED' && 'line-through')}>{formatMoney(x.amount)}</span>
                      {x.status === 'ACTIVE' && (can('expense:cancel') || can('approval:request')) && (
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(x.id)} aria-label={t('exp.cancel')}><Ban className="size-4 text-danger-600" aria-hidden /></Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <Pagination page={list.data.page} pageSize={list.data.pageSize} total={list.data.total} onPage={setPage} />
            </>
          )}
        </Card>
        <Card title={t('exp.byCategory')}>
          {!list.data?.totals?.byCategory.length ? <p className="text-sm text-ink-3">—</p> : (
            <ul className="flex flex-col gap-2">
              {list.data.totals.byCategory.map((c) => (
                <li key={c.categoryId} className="flex justify-between gap-2 text-[15px]">
                  <span>{lang === 'hi' ? (c.nameHindi ?? c.name) : c.name} <span className="text-xs text-ink-3">({c.count})</span></span>
                  <span className="num font-medium">{formatMoney(c.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title={t('exp.add')}><ExpenseForm onDone={() => setAdding(false)} /></Modal>
      <CancelDialog open={!!cancelling} title={t('exp.cancel')} onClose={() => setCancelling(null)} onSubmit={(reason, key) => cancelExpense({ key, body: { id: cancelling!, reason } }).unwrap()} />
    </>
  );
}
