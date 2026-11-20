'use client';

import clsx from 'clsx';
import { Ban, Plus, Printer, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { CancelDialog } from '@/features/common';
import { WhatsAppSendButton } from '@/features/communication';
import { PaymentForm } from '@/features/payments/payment-form';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelPaymentMutation, usePaymentsQuery } from '@/services/api';

export default function PaymentsPage() {
  const { t, lang } = useT();
  const can = useCan();
  const [side, setSide] = useState('');
  const [mode, setMode] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const list = usePaymentsQuery({ partySide: side || undefined, mode: mode || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 });
  const [cancelPayment] = useCancelPaymentMutation();

  return (
    <>
      <PageHeader
        title={t('pay.title')}
        subtitle={list.data?.totals ? `${t('pay.paidOut')}: ${formatMoney(list.data.totals.paidOut, { decimals: 0 })} · ${t('pay.received')}: ${formatMoney(list.data.totals.received, { decimals: 0 })}` : undefined}
        action={can('payment:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('pay.add')}</Button>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={side} onChange={(e) => { setSide(e.target.value); setPage(1); }} aria-label={t('pay.party')} className="w-48">
          <option value="">{t('common.all')}</option>
          <option value="FARMER">{t('pay.toFarmer')}</option>
          <option value="BUYER">{t('pay.fromBuyer')}</option>
        </Select>
        <Select value={mode} onChange={(e) => { setMode(e.target.value); setPage(1); }} aria-label={t('pay.mode')} className="w-40">
          <option value="">{t('pay.mode')}: {t('common.all')}</option>
          {(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
        </Select>
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : !list.data?.items.length ? (
          <EmptyState icon={<Wallet className="size-6" aria-hidden />} title={t('pay.empty')} action={can('payment:create') && <Button onClick={() => setAdding(true)}>{t('pay.add')}</Button>} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('pay.receipt')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('pay.party')}</th>
                    <th className="hidden px-4 py-2.5 font-medium sm:table-cell">{t('pay.purpose')} · {t('pay.mode')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('pay.amount')}</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id} className={clsx('border-t border-line', p.status === 'CANCELLED' && 'opacity-60')}>
                      <td className="px-4 py-3"><span className="num">{p.receiptNumber}</span><span className="block text-xs text-ink-3">{formatDate(p.paymentDate, lang)}</span></td>
                      <td className="px-4 py-3">
                        {p.farmer ? (
                          <Link href={`/ledger/farmers/${p.farmer.id}`} className="hover:underline">{lang === 'hi' ? (p.farmer.nameHindi ?? p.farmer.name) : p.farmer.name}</Link>
                        ) : (
                          <Link href={`/ledger/buyers/${p.buyer!.id}`} className="hover:underline">{p.buyer!.firmName}</Link>
                        )}
                        {p.status === 'CANCELLED' && <Badge tone="red">{t('lot.status.CANCELLED')}</Badge>}
                      </td>
                      <td className="hidden px-4 py-3 text-sm text-ink-2 sm:table-cell">{t(`pay.${p.purpose}`)} · {t(`pay.${p.mode}`)}{p.referenceNumber ? ` · ${p.referenceNumber}` : ''}</td>
                      <td className={clsx('num px-4 py-3 text-right font-semibold', p.direction === 'INCOMING' ? 'text-brand-800' : 'text-ink')}>
                        {p.direction === 'INCOMING' ? '+' : '−'}{formatMoney(p.amount)}
                      </td>
                      <td className="px-2 py-3">
                        <div className="flex justify-end">
                          <a href={`/api/v1/payments/${p.id}/receipt?print=1`} target="_blank" rel="noopener" className="rounded-md p-2 text-ink-2 hover:bg-canvas" aria-label={t('pay.receipt')}><Printer className="size-4" aria-hidden /></a>
                          {p.status === 'ACTIVE' && <WhatsAppSendButton kind="RECEIPT" entityId={p.id} size="sm" label="WhatsApp" />}
                          {p.status === 'ACTIVE' && (can('payment:cancel') || can('approval:request')) && (
                            <Button size="sm" variant="ghost" onClick={() => setCancelling(p.id)} aria-label={t('pay.cancel')}><Ban className="size-4 text-danger-600" aria-hidden /></Button>
                          )}
                        </div>
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
      <Modal open={adding} onClose={() => setAdding(false)} title={t('pay.add')}>
        <PaymentForm onDone={() => setAdding(false)} />
      </Modal>
      <CancelDialog open={!!cancelling} title={t('pay.cancel')} onClose={() => setCancelling(null)} onSubmit={(reason, key) => cancelPayment({ key, body: { id: cancelling!, reason } }).unwrap()} />
    </>
  );
}
