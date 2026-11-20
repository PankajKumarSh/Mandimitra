'use client';

import clsx from 'clsx';
import { Ban, Plus, ShoppingCart } from 'lucide-react';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorState, Field, Input, Modal, PageHeader, Pagination, Select, Skeleton } from '@/components/ui';
import { CancelDialog, onEnterAdvance, todayIST, useIdempotencyKey } from '@/features/common';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelPurchaseMutation, useCreatePurchaseMutation, useLotsQuery, usePurchasesQuery, useSettingsQuery } from '@/services/api';

function PurchaseForm({ onDone }: { onDone: () => void }) {
  const { t, lang } = useT();
  const toast = useToast();
  const lots = useLotsQuery({ status: 'OPEN', pageSize: 100 });
  const [create, cs] = useCreatePurchaseMutation();
  const { key, rotate } = useIdempotencyKey();
  const [v, setV] = useState({ lotId: '', purchaseDate: todayIST(), weight: '', weightUnit: 'QUINTAL', bags: '', rate: '' });
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const p = await create({ key, body: { ...v, bags: v.bags ? Number(v.bags) : 0 } }).unwrap();
      rotate();
      toast.success(`${t('common.saved')} · ${p.purchaseNumber}`);
      onDone();
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };
  return (
    <form onSubmit={submit} onKeyDown={onEnterAdvance} className="flex flex-col gap-4">
      <Field label={t('sale.chooseLot')} htmlFor="p-lot" required>
        <Select id="p-lot" value={v.lotId} onChange={(e) => setV({ ...v, lotId: e.target.value })} required>
          <option value="">—</option>
          {lots.data?.items.map((l) => (
            <option key={l.id} value={l.id}>{l.lotNumber} · {lang === 'hi' ? (l.farmer.nameHindi ?? l.farmer.name) : l.farmer.name} · {formatQuintals(l.netWeightKg, t('unit.qtl'))}</option>
          ))}
        </Select>
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('sale.weight')} htmlFor="p-w" required><Input id="p-w" inputMode="decimal" className="num" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} required /></Field>
        <Field label={t('lot.weightUnit')} htmlFor="p-wu">
          <Select id="p-wu" value={v.weightUnit} onChange={(e) => setV({ ...v, weightUnit: e.target.value })}><option value="QUINTAL">{t('unit.QUINTAL')}</option><option value="KG">{t('unit.KG')}</option></Select>
        </Field>
        <Field label={t('lot.bags')} htmlFor="p-b"><Input id="p-b" inputMode="numeric" className="num" value={v.bags} onChange={(e) => setV({ ...v, bags: e.target.value.replace(/\D/g, '') })} /></Field>
        <Field label={`${t('sale.rate')} (₹)`} htmlFor="p-r" required><Input id="p-r" inputMode="decimal" className="num" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} required /></Field>
        <Field label={t('sale.date')} htmlFor="p-d" required><Input id="p-d" type="date" value={v.purchaseDate} onChange={(e) => setV({ ...v, purchaseDate: e.target.value })} /></Field>
      </div>
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end"><Button type="submit" loading={cs.isLoading}>{t('common.save')}</Button></div>
    </form>
  );
}

export default function PurchasesPage() {
  const { t, lang } = useT();
  const can = useCan();
  const settings = useSettingsQuery();
  const [unbilled, setUnbilled] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const list = usePurchasesQuery({ unbilled: unbilled || undefined, from: from || undefined, to: to || undefined, page, pageSize: 50 });
  const [cancelPurchase] = useCancelPurchaseMutation();
  const manual = settings.data && settings.data.tradingMode !== 'COMMISSION_AGENT';

  return (
    <>
      <PageHeader
        title={t('purchase.title')}
        subtitle={list.data?.totals ? `${t('common.total')}: ${formatMoney(list.data.totals.grossAmount ?? '0', { decimals: 0 })} · ${formatQuintals(list.data.totals.weightKg ?? '0', t('unit.qtl'))}` : undefined}
        action={manual && can('purchase:create') && <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('purchase.add')}</Button>}
      />
      {settings.data?.tradingMode === 'COMMISSION_AGENT' && <p className="mb-4 rounded-lg bg-brand-50 px-4 py-2.5 text-sm text-brand-900">{t('purchase.autoNote')}</p>}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className="w-40" />
        <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => { setTo(e.target.value); setPage(1); }} className="w-40" />
        <Checkbox label={t('purchase.unbilled')} checked={unbilled} onChange={(e) => { setUnbilled(e.target.checked); setPage(1); }} />
      </div>
      <Card className="overflow-hidden [&>div]:p-0">
        {list.isError ? <ErrorState message={apiError(list.error).message} onRetry={list.refetch} /> : list.isLoading ? <Skeleton className="m-4 h-40" /> : !list.data?.items.length ? (
          <EmptyState icon={<ShoppingCart className="size-6" aria-hidden />} title={t('purchase.empty')} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="bg-canvas text-left text-sm text-ink-2">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">{t('purchase.number')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('lot.farmer')}</th>
                    <th className="hidden px-4 py-2.5 font-medium md:table-cell">{t('lot.number')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('sale.weight')} × {t('sale.rate')}</th>
                    <th className="px-4 py-2.5 text-right font-medium">{t('sale.gross')}</th>
                    <th className="px-4 py-2.5 font-medium">{t('patti.title')}</th>
                    <th className="px-2 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((p) => (
                    <tr key={p.id} className={clsx('border-t border-line', p.status === 'CANCELLED' && 'opacity-60')}>
                      <td className="px-4 py-3"><span className="num">{p.purchaseNumber}</span><span className="block text-xs text-ink-3">{formatDate(p.purchaseDate, lang)}</span></td>
                      <td className="px-4 py-3"><Link href={`/farmers/${p.farmer.id}`} className="hover:underline">{lang === 'hi' ? (p.farmer.nameHindi ?? p.farmer.name) : p.farmer.name}</Link></td>
                      <td className="hidden px-4 py-3 md:table-cell"><Link href={`/arrivals/${p.lot.id}`} className="num text-sm hover:underline">{p.lot.lotNumber}</Link></td>
                      <td className="num px-4 py-3 text-right text-sm">{formatQuintals(p.weightKg, t('unit.qtl'))} × {formatMoney(p.rate, { decimals: 0 })}</td>
                      <td className="num px-4 py-3 text-right font-semibold">{formatMoney(p.grossAmount)}</td>
                      <td className="px-4 py-3">
                        {p.status === 'CANCELLED' ? <Badge tone="red">{t('lot.status.CANCELLED')}</Badge> : p.patti ? <Link href={`/patti/${p.patti.id}`} className="num text-sm text-brand-800 hover:underline">{p.patti.pattiNumber}</Link> : (
                          can('patti:create') ? <Link href={`/patti/new?farmerId=${p.farmer.id}`}><Badge tone="amber">{t('purchase.unbilled')} →</Badge></Link> : <Badge tone="amber">{t('purchase.unbilled')}</Badge>
                        )}
                      </td>
                      <td className="px-2 py-3">
                        {p.status === 'ACTIVE' && !p.saleId && !p.pattiId && (can('purchase:cancel') || can('approval:request')) && (
                          <Button size="sm" variant="ghost" onClick={() => setCancelling(p.id)} aria-label={t('common.cancel')}><Ban className="size-4 text-danger-600" aria-hidden /></Button>
                        )}
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
      <Modal open={adding} onClose={() => setAdding(false)} title={t('purchase.add')}>
        <PurchaseForm onDone={() => setAdding(false)} />
      </Modal>
      <CancelDialog open={!!cancelling} title={t('common.cancel')} onClose={() => setCancelling(null)} onSubmit={(reason, key) => cancelPurchase({ key, body: { id: cancelling!, reason } }).unwrap()} />
    </>
  );
}
