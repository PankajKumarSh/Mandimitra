'use client';

import clsx from 'clsx';
import { ArrowLeft, Download, Printer, Wallet } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Card, EmptyState, ErrorState, Input, Modal, Skeleton } from '@/components/ui';
import { Stat } from '@/features/common';
import { ReminderButton, WhatsAppSendButton } from '@/features/communication';
import { PaymentForm } from '@/features/payments/payment-form';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney, isNegative } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useStatementQuery } from '@/services/api';

/** Shared farmer/buyer statement: date filter, running balance, print / PDF, pay-from-here. */
export function StatementView({ side, id }: { side: 'farmers' | 'buyers'; id: string }) {
  const { t, lang } = useT();
  const can = useCan();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [paying, setPaying] = useState(false);
  const q = useStatementQuery({ side, id, from: from || undefined, to: to || undefined });

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <Card><ErrorState message={apiError(q.error).message} onRetry={q.refetch} /></Card>;
  const s = q.data;
  const farmer = side === 'farmers';
  const name = farmer ? (lang === 'hi' ? (s.party.nameHindi ?? s.party.name) : s.party.name) : s.party.firmName;
  const docUrl = (format: string, extra = '') => `/api/v1/ledger/${side}/${id}?format=${format}&lang=${lang}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}${extra}`;
  // Balance wording follows the sign convention of each ledger.
  const balanceText = (v: string) => (farmer ? (isNegative(v) ? `${formatMoney(v.replace('-', ''))} ${t('farmer.advance')}` : `${formatMoney(v)} ${t('farmer.weOwe')}`) : formatMoney(v));

  return (
    <div className="flex flex-col gap-5">
      <Link href={`/ledger/${side}`} className="inline-flex w-fit items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {farmer ? t('ledger.farmers') : t('ledger.buyers')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="num text-sm text-ink-3">{s.party.code}</p>
          <h1 className="text-2xl font-semibold">
            <Link href={`/${side}/${id}`} className="hover:underline">{name}</Link>
          </h1>
          <p className="text-sm text-ink-2">{t('ledger.statement')} · {s.from || s.to ? `${formatDate(s.from, lang)} – ${formatDate(s.to, lang)}` : t('ledger.allDates')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={docUrl('html', '&print=1')} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas"><Printer className="size-4" aria-hidden /> {t('patti.print')}</a>
          {can('report:export') && <a href={docUrl('pdf', '&download=1')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas"><Download className="size-4" aria-hidden /> PDF</a>}
          <WhatsAppSendButton kind="STATEMENT" {...(farmer ? { farmerId: id } : { buyerId: id })} label={t('wa.statement')} />
          {!farmer && <ReminderButton buyerId={id} mobile={s.party.mobile} />}
          {can('payment:create') && <Button onClick={() => setPaying(true)}><Wallet className="size-4" aria-hidden /> {farmer ? t('pay.toFarmer') : t('pay.fromBuyer')}</Button>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
        <span className="text-sm text-ink-3">{t('common.to')}</span>
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
        {(from || to) && <Button size="sm" variant="ghost" onClick={() => { setFrom(''); setTo(''); }}>{t('ledger.allDates')}</Button>}
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label={t('ledger.opening')} value={balanceText(s.openingBalance)} />
          <Stat label={t('ledger.debit')} value={formatMoney(s.totals.debit)} />
          <Stat label={t('ledger.credit')} value={formatMoney(s.totals.credit)} />
          <Stat label={t('ledger.closing')} value={balanceText(s.closingBalance)} strong />
        </div>
      </Card>

      <Card className={clsx('overflow-hidden [&>div]:p-0', q.isFetching && 'opacity-70')}>
        {s.entries.length === 0 ? <EmptyState title={t('ledger.empty')} /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-[15px]">
              <thead className="bg-canvas text-left text-sm text-ink-2">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('pay.date')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('ledger.narration')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('ledger.debit')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('ledger.credit')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('common.balance')}</th>
                </tr>
              </thead>
              <tbody>
                {s.entries.map((e) => (
                  <tr key={e.id} className={clsx('border-t border-line', e.type === 'REVERSAL' && 'text-ink-3')}>
                    <td className="num whitespace-nowrap px-4 py-2.5 text-sm">{formatDate(e.date, lang)}</td>
                    <td className="px-4 py-2.5">
                      <span className="font-medium">{t(`ledger.type.${e.type}` as MessageKey)}</span>
                      {e.ref && <span className="num ml-2 text-sm text-ink-3">{e.ref}</span>}
                      <span className="block text-xs text-ink-3">{e.narration}</span>
                    </td>
                    <td className="num px-4 py-2.5 text-right">{e.debit !== '0.00' ? formatMoney(e.debit) : ''}</td>
                    <td className="num px-4 py-2.5 text-right">{e.credit !== '0.00' ? formatMoney(e.credit) : ''}</td>
                    <td className={clsx('num px-4 py-2.5 text-right font-medium', isNegative(e.balance) && 'text-accent-700')}>{formatMoney(e.balance)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={paying} onClose={() => setPaying(false)} title={farmer ? t('pay.toFarmer') : t('pay.fromBuyer')}>
        <PaymentForm initial={{ side: farmer ? 'FARMER' : 'BUYER', id, label: name ?? '' }} lockParty onDone={() => setPaying(false)} />
      </Modal>
    </div>
  );
}
