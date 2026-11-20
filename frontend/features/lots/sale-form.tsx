'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { BuyerPicker, onEnterAdvance, todayIST, useIdempotencyKey } from '@/features/common';
import { useDebounce, useT, useToast } from '@/hooks';
import { formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCalcSaleMutation, useCreateSaleMutation, useSettingsQuery } from '@/services/api';
import type { Lot, Sale, SalePreview, Unit } from '@/types/api';

const NUM = /^\d{1,11}(\.\d{1,3})?$/;
const RATE = /^\d{1,10}(\.\d{1,2})?$/;

/** Sale entry against one lot. Live preview of gross + buyer charges comes from the server engine. */
export type SalePrefill = Partial<{ buyer: { id: string; label: string }; saleDate: string; weight: string; weightUnit: Unit; bags: string; rate: string; rateUnit: Unit }>;

export function SaleForm({ lot, initial, onDone }: { lot: Lot; initial?: SalePrefill; onDone: (sale: Sale) => void }) {
  const { t } = useT();
  const toast = useToast();
  const settings = useSettingsQuery();
  const [create, cs] = useCreateSaleMutation();
  const [calc] = useCalcSaleMutation();
  const { key, rotate } = useIdempotencyKey();
  const [buyer, setBuyer] = useState<{ id: string; label: string } | null>(initial?.buyer ?? null);
  const [v, setV] = useState({
    saleDate: initial?.saleDate || todayIST(),
    weight: initial?.weight ?? '',
    weightUnit: (initial?.weightUnit || 'QUINTAL') as Unit,
    bags: initial?.bags ?? '',
    rate: initial?.rate ?? '',
    rateUnit: (initial?.rateUnit || lot.commodity.rateUnit) as Unit,
    mode: 'COMMISSION' as 'COMMISSION' | 'TRADE',
  });
  const [preview, setPreview] = useState<SalePreview | null>(null);
  const [error, setError] = useState('');
  const mixed = settings.data?.tradingMode === 'MIXED';
  const units: Unit[] = lot.commodity.bagWeightKg ? ['QUINTAL', 'KG', 'BAG'] : ['QUINTAL', 'KG'];

  const body = () => ({
    lotId: lot.id,
    buyerId: buyer?.id,
    saleDate: v.saleDate,
    weight: v.weight.trim(),
    weightUnit: v.weightUnit,
    bags: v.bags ? Number(v.bags) : 0,
    rate: v.rate.trim(),
    rateUnit: v.rateUnit,
    ...(mixed ? { mode: v.mode } : {}),
  });

  const dWeight = useDebounce(v.weight, 250);
  const dRate = useDebounce(v.rate, 250);
  useEffect(() => {
    if (!NUM.test(dWeight) || !RATE.test(dRate) || Number(dWeight) <= 0 || Number(dRate) <= 0 || !buyer) return setPreview(null);
    calc({ ...body(), weight: dWeight, rate: dRate })
      .unwrap()
      .then(setPreview)
      .catch(() => setPreview(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dWeight, dRate, v.weightUnit, v.rateUnit, v.bags, v.saleDate, buyer?.id, calc]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!buyer) return setError(t('sale.buyer'));
    try {
      const s = await create({ key, body: body() }).unwrap();
      rotate();
      toast.success(`${t('common.saved')} · ${s.saleNumber}`);
      setV((x) => ({ ...x, weight: '', bags: '', rate: '' }));
      setPreview(null);
      onDone(s);
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onEnterAdvance} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink-2">
        {t('lot.available')}: <span className="num font-semibold text-ink">{formatQuintals(lot.availableToSellKg, t('unit.qtl'))}</span>
      </p>
      <BuyerPicker value={buyer?.id ?? null} selectedLabel={buyer?.label ?? null} onChange={(id, label) => setBuyer({ id, label })} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('sale.weight')} htmlFor="s-w" required>
          <Input id="s-w" inputMode="decimal" className="num" value={v.weight} onChange={(e) => setV({ ...v, weight: e.target.value })} />
        </Field>
        <Field label={t('lot.weightUnit')} htmlFor="s-wu">
          <Select id="s-wu" value={v.weightUnit} onChange={(e) => setV({ ...v, weightUnit: e.target.value as Unit })}>
            {units.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('lot.bags')} htmlFor="s-b">
          <Input id="s-b" inputMode="numeric" className="num" value={v.bags} onChange={(e) => setV({ ...v, bags: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={`${t('sale.rate')} (₹)`} htmlFor="s-r" required>
          <Input id="s-r" inputMode="decimal" className="num" value={v.rate} onChange={(e) => setV({ ...v, rate: e.target.value })} />
        </Field>
        <Field label={t('sale.rateUnit')} htmlFor="s-ru">
          <Select id="s-ru" value={v.rateUnit} onChange={(e) => setV({ ...v, rateUnit: e.target.value as Unit })}>
            {units.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('sale.date')} htmlFor="s-d" required>
          <Input id="s-d" type="date" value={v.saleDate} onChange={(e) => setV({ ...v, saleDate: e.target.value })} />
        </Field>
        {mixed && (
          <Field label={t('sale.mode')} htmlFor="s-mode">
            <Select id="s-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as 'COMMISSION' | 'TRADE' })}>
              <option value="COMMISSION">{t('sale.mode.COMMISSION')}</option>
              <option value="TRADE">{t('sale.mode.TRADE')}</option>
            </Select>
          </Field>
        )}
      </div>

      <div className="rounded-lg border border-line bg-canvas px-4 py-3 text-[15px]" aria-live="polite">
        {preview ? (
          <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1">
            <dt className="text-ink-2">{t('sale.gross')}</dt>
            <dd className="num text-right">{formatMoney(preview.grossAmount)}</dd>
            {preview.charges.map((c) => (
              <div key={c.label} className="contents">
                <dt className="text-ink-2">+ {c.label}</dt>
                <dd className="num text-right">{formatMoney(c.amount)}</dd>
              </div>
            ))}
            <dt className="border-t border-line pt-1 font-semibold">{t('sale.total')}</dt>
            <dd className="num border-t border-line pt-1 text-right text-lg font-semibold">{formatMoney(preview.totalAmount)}</dd>
          </dl>
        ) : (
          <p className="text-sm text-ink-3">{t('common.preview')}: {t('sale.buyer')} · {t('sale.weight')} · {t('sale.rate')}</p>
        )}
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={cs.isLoading}>{t('sale.add')}</Button>
      </div>
    </form>
  );
}
