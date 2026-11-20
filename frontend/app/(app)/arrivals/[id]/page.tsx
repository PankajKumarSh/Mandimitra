'use client';

import clsx from 'clsx';
import { ArrowLeft, Ban, CheckCircle2, FileText } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Skeleton } from '@/components/ui';
import { CancelDialog, LotStatusBadge, Stat } from '@/features/common';
import { SaleForm } from '@/features/lots/sale-form';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelLotMutation, useCancelSaleMutation, useConfirmLotMutation, useLotQuery } from '@/services/api';

export default function LotDetailPage() {
  const { t, lang } = useT();
  const can = useCan();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const q = useLotQuery(id);
  const [confirmLot, cl] = useConfirmLotMutation();
  const [cancelLot] = useCancelLotMutation();
  const [cancelSale] = useCancelSaleMutation();
  const [cancelling, setCancelling] = useState<{ kind: 'lot' } | { kind: 'sale'; id: string } | null>(null);

  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.isError || !q.data) return <Card><ErrorState message={apiError(q.error).message} onRetry={q.refetch} /></Card>;
  const lot = q.data;
  const sellable = lot.status === 'CONFIRMED' || lot.status === 'PARTIALLY_SOLD';
  const qtl = (kg: string) => formatQuintals(kg, t('unit.qtl'));
  const canCancel = can('lot:cancel') || can('approval:request');

  return (
    <div className="flex flex-col gap-5">
      <Link href="/arrivals" className="inline-flex w-fit items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> {t('lot.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2"><span className="num text-sm text-ink-3">{lot.lotNumber}</span> <LotStatusBadge status={lot.status} /></p>
          <h1 className="text-2xl font-semibold">
            <Link href={`/farmers/${lot.farmer.id}`} className="hover:underline">{lang === 'hi' ? (lot.farmer.nameHindi ?? lot.farmer.name) : lot.farmer.name}</Link>
            <span className="text-ink-2"> · {lang === 'hi' ? (lot.commodity.nameHindi ?? lot.commodity.name) : lot.commodity.name}{lot.grade ? ` (${lot.grade.name})` : ''}</span>
          </h1>
          <p className="mt-1 text-sm text-ink-2">{[formatDate(lot.arrivalDate, lang), lot.vehicleNumber, lot.farmer.village].filter(Boolean).join(' · ')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {lot.status === 'DRAFT' && can('lot:create') && (
            <Button loading={cl.isLoading} onClick={async () => { try { await confirmLot(lot.id).unwrap(); toast.success(t('common.saved')); } catch (e) { toast.error(apiError(e).message); } }}>
              <CheckCircle2 className="size-4" aria-hidden /> {t('lot.confirm')}
            </Button>
          )}
          {lot.purchases.some((p) => p.status === 'ACTIVE' && !p.pattiId) && can('patti:create') && (
            <Link href={`/patti/new?farmerId=${lot.farmer.id}`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">
              <FileText className="size-4" aria-hidden /> {t('patti.new')}
            </Link>
          )}
          {lot.status !== 'CANCELLED' && canCancel && lot.sales.every((s) => s.status === 'CANCELLED') && (
            <Button variant="secondary" onClick={() => setCancelling({ kind: 'lot' })}><Ban className="size-4 text-danger-600" aria-hidden /> {t('lot.cancel')}</Button>
          )}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat label={t('lot.gross')} value={qtl(lot.grossWeightKg)} sub={`${lot.grossWeightKg} kg`} />
          <Stat label={t('lot.tare')} value={qtl(lot.tareWeightKg)} sub={`${lot.tareWeightKg} kg`} />
          <Stat label={t('lot.net')} value={qtl(lot.netWeightKg)} sub={`${lot.netWeightKg} kg · ${lot.bags} ${t('lot.bags')}`} strong />
          <Stat label={t('lot.sold')} value={qtl(lot.soldWeightKg)} />
          <Stat label={t('lot.available')} value={lot.status === 'CANCELLED' ? '—' : qtl(lot.availableToSellKg)} />
        </div>
        {lot.moisturePercent && <p className="mt-3 text-sm text-ink-2">{t('lot.moisture')}: {lot.moisturePercent}%</p>}
        {lot.remarks && <p className="mt-1 text-sm text-ink-2">{lot.remarks}</p>}
        {lot.cancelReason && <p className="mt-2 text-sm text-danger-700">{t('cancel.reason')}: {lot.cancelReason}</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <Card title={t('sale.title')} className="lg:col-span-3">
          {lot.sales.length === 0 ? <EmptyState title={t('sale.empty')} /> : (
            <ul className="-my-2 divide-y divide-line">
              {lot.sales.map((s) => (
                <li key={s.id} className={clsx('flex flex-wrap items-center justify-between gap-3 py-3', s.status === 'CANCELLED' && 'opacity-60')}>
                  <div className="min-w-0">
                    <p className="font-medium">{s.buyer.firmName} {s.status === 'CANCELLED' && <Badge tone="red">{t('lot.status.CANCELLED')}</Badge>}</p>
                    <p className="num text-sm text-ink-2">{s.saleNumber} · {qtl(s.weightKg)} × {formatMoney(s.rate)}/{t(`unit.${s.rateUnit}`)}</p>
                    {s.charges.length > 0 && <p className="text-xs text-ink-3">+ {s.charges.map((c) => `${c.label} ${formatMoney(c.amount)}`).join(', ')}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={clsx('num font-semibold', s.status === 'CANCELLED' && 'line-through')}>{formatMoney(s.totalAmount)}</span>
                    {s.status === 'ACTIVE' && (can('sale:cancel') || can('approval:request')) && (
                      <Button size="sm" variant="ghost" onClick={() => setCancelling({ kind: 'sale', id: s.id })} aria-label={t('sale.cancel')}><Ban className="size-4 text-danger-600" aria-hidden /></Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t('sale.add')} className="lg:col-span-2">
          {sellable && can('sale:create') ? <SaleForm lot={lot} onDone={() => q.refetch()} /> : <p className="text-sm text-ink-3">{t(`lot.status.${lot.status}`)}</p>}
        </Card>
      </div>

      <CancelDialog<unknown>
        open={!!cancelling}
        title={cancelling?.kind === 'lot' ? t('lot.cancel') : t('sale.cancel')}
        onClose={() => setCancelling(null)}
        onSubmit={(reason, key) =>
          cancelling?.kind === 'sale' ? cancelSale({ key, body: { id: cancelling.id, reason } }).unwrap() : cancelLot({ key, body: { id: lot.id, reason } }).unwrap()
        }
      />
    </div>
  );
}
