'use client';

import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Balance, Button, Card, ConfirmDialog, ErrorState, Modal, Skeleton } from '@/components/ui';
import { BuyerForm } from '@/features/buyers/buyer-form';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatMobile, formatMoney } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useBuyerQuery, useBuyerSummaryQuery, useDeleteBuyerMutation } from '@/services/api';

export default function BuyerDetailPage() {
  const { t, lang } = useT();
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const buyer = useBuyerQuery(id);
  const summary = useBuyerSummaryQuery(id);
  const [del, delState] = useDeleteBuyerMutation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (buyer.isLoading) return <Skeleton className="h-64" />;
  if (buyer.isError || !buyer.data) return <Card><ErrorState message={apiError(buyer.error).message} onRetry={buyer.refetch} /></Card>;
  const b = buyer.data;
  const s = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/buyers" className="inline-flex w-fit items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t('buyer.title')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="num text-sm text-ink-3">{b.code}</p>
          <h1 className="flex items-center gap-2 text-2xl font-semibold">
            {b.firmName} {b.overCreditLimit && <Badge tone="red">{t('buyer.overLimit')}</Badge>}
          </h1>
          <p className="mt-1 text-sm text-ink-2">{[b.ownerName, b.city, formatMobile(b.mobile), b.gstin].filter((x) => x && x !== '—').join(' · ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('ledger:read') && (
            <Link href={`/ledger/buyers/${b.id}`} className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">{t('ledger.statement')}</Link>
          )}
          {can('buyer:update') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> {t('common.edit')}</Button>}
          {can('buyer:delete') && <Button variant="secondary" onClick={() => setDeleting(true)}><Trash2 className="size-4 text-danger-600" aria-hidden /> {t('common.delete')}</Button>}
        </div>
      </div>
      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <div>
            <p className="text-sm text-ink-2">{t('common.balance')}</p>
            <div className="mt-1 text-2xl"><Balance value={b.currentBalance} side="buyer" /></div>
          </div>
          <div>
            <p className="text-sm text-ink-2">{t('buyer.creditLimit')}</p>
            <p className="num mt-0.5 text-lg font-semibold">{b.creditLimit ? formatMoney(b.creditLimit, { decimals: 0 }) : '—'}</p>
          </div>
          <div>
            <p className="text-sm text-ink-2">{t('buyer.sales')}</p>
            <p className="num mt-0.5 text-lg font-semibold">{s ? `${formatMoney(s.sales.amount, { decimals: 0 })} (${s.sales.count})` : '—'}</p>
          </div>
          <div>
            <p className="text-sm text-ink-2">{t('buyer.lastSale')}</p>
            <p className="num mt-0.5 text-lg font-semibold">{formatDate(s?.lastSaleDate ?? null, lang)}</p>
          </div>
        </div>
        <p className="mt-4 text-xs text-ink-3">{t('farmer.openingBalance')}: {formatMoney(b.openingBalance)}</p>
      </Card>
      {b.address && <Card title={t('farmer.address')}><p className="text-[15px] text-ink-2">{b.address}</p></Card>}
      {b.notes && <Card title={t('common.notes')}><p className="whitespace-pre-wrap text-[15px] text-ink-2">{b.notes}</p></Card>}

      <Modal open={editing} onClose={() => setEditing(false)} title={t('buyer.edit')} wide>
        <BuyerForm buyer={b} onDone={() => setEditing(false)} />
      </Modal>
      <ConfirmDialog
        open={deleting}
        title={t('common.areYouSure')}
        message={t('buyer.deleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
        loading={delState.isLoading}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await del(b.id).unwrap();
            toast.success(t('common.deleted'));
            router.replace('/buyers');
          } catch (err) {
            toast.error(apiError(err).message);
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
