'use client';

import clsx from 'clsx';
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { BuyerPicker, FarmerPicker, onEnterAdvance, todayIST, useIdempotencyKey } from '@/features/common';
import { useT, useToast } from '@/hooks';
import { formatMoney, isNegative, isPositive } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useBuyerQuery, useCreatePaymentMutation, useFarmerQuery } from '@/services/api';
import type { Payment, PaymentMode } from '@/types/api';

type Side = 'FARMER' | 'BUYER';
const MODES: PaymentMode[] = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'];

export type PaymentPrefill = Partial<{ purpose: 'SETTLEMENT' | 'ADVANCE'; mode: PaymentMode; amount: string; referenceNumber: string; paymentDate: string; remarks: string }>;

export function PaymentForm({
  initial,
  values,
  lockParty,
  onDone,
}: {
  initial?: { side: Side; id: string; label: string };
  values?: PaymentPrefill;
  lockParty?: boolean;
  onDone: (p: Payment) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const [create, cs] = useCreatePaymentMutation();
  const { key, rotate } = useIdempotencyKey();
  const [side, setSide] = useState<Side>(initial?.side ?? 'FARMER');
  const [party, setParty] = useState<{ id: string; label: string } | null>(initial ? { id: initial.id, label: initial.label } : null);
  const farmer = useFarmerQuery(party?.id ?? '', { skip: side !== 'FARMER' || !party });
  const buyer = useBuyerQuery(party?.id ?? '', { skip: side !== 'BUYER' || !party });
  const balance = side === 'FARMER' ? farmer.data?.currentBalance : buyer.data?.currentBalance;
  const [v, setV] = useState({
    purpose: 'SETTLEMENT' as 'SETTLEMENT' | 'ADVANCE',
    mode: 'CASH' as PaymentMode,
    amount: '',
    referenceNumber: '',
    paymentDate: todayIST(),
    remarks: '',
    ...Object.fromEntries(Object.entries(values ?? {}).filter(([, x]) => x)),
  });
  const [error, setError] = useState('');

  // Sensible default: settle when something is payable, otherwise it's an advance (unless prefilled).
  useEffect(() => {
    if (side === 'FARMER' && balance !== undefined && !values?.purpose) setV((x) => ({ ...x, purpose: isPositive(balance) ? 'SETTLEMENT' : 'ADVANCE' }));
  }, [side, balance, values?.purpose]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!party) return setError(t('pay.party'));
    const body: Record<string, unknown> = {
      partySide: side,
      ...(side === 'FARMER' ? { farmerId: party.id, purpose: v.purpose } : { buyerId: party.id, purpose: 'COLLECTION' }),
      mode: v.mode,
      amount: v.amount.trim(),
      paymentDate: v.paymentDate,
      ...(v.referenceNumber.trim() ? { referenceNumber: v.referenceNumber.trim() } : {}),
      ...(v.remarks.trim() ? { remarks: v.remarks.trim() } : {}),
    };
    try {
      const r = await create({ key, body }).unwrap();
      rotate();
      for (const w of r.warnings) {
        if (w.code === 'DUPLICATE_REFERENCE') toast.info(t('pay.dupRef', { n: w.receiptNumber ?? '' }));
        if (w.code === 'OVERPAYMENT') toast.info(t('pay.overpaid', { n: formatMoney(w.outstanding ?? '0', { symbol: false }) }));
      }
      toast.success(`${t('common.saved')} · ${r.data.receiptNumber}`);
      onDone(r.data);
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onEnterAdvance} className="flex flex-col gap-4" noValidate>
      {!lockParty && (
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-lg border border-line p-1">
          {(['FARMER', 'BUYER'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={side === s}
              onClick={() => { setSide(s); setParty(null); }}
              className={clsx('rounded-md py-2 text-sm font-medium', side === s ? 'bg-brand-800 text-white' : 'text-ink-2 hover:bg-canvas')}
            >
              {s === 'FARMER' ? t('pay.toFarmer') : t('pay.fromBuyer')}
            </button>
          ))}
        </div>
      )}
      {lockParty ? (
        <p className="text-[15px] font-medium">{party?.label}</p>
      ) : side === 'FARMER' ? (
        <FarmerPicker value={party?.id ?? null} selectedLabel={party?.label ?? null} onChange={(id, label) => setParty({ id, label })} />
      ) : (
        <BuyerPicker value={party?.id ?? null} selectedLabel={party?.label ?? null} onChange={(id, label) => setParty({ id, label })} />
      )}

      {balance !== undefined && (
        <div className="rounded-lg bg-canvas px-4 py-2.5 text-[15px]" aria-live="polite">
          {side === 'FARMER' ? (isNegative(balance) ? t('pay.advanceNow') : t('pay.payableNow')) : t('pay.receivableNow')}:{' '}
          <span className="num font-semibold">{formatMoney(balance.replace('-', ''))}</span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {side === 'FARMER' && (
          <Field label={t('pay.purpose')} htmlFor="pay-purpose">
            <Select id="pay-purpose" value={v.purpose} onChange={(e) => setV({ ...v, purpose: e.target.value as 'SETTLEMENT' | 'ADVANCE' })}>
              <option value="SETTLEMENT">{t('pay.SETTLEMENT')}</option>
              <option value="ADVANCE">{t('pay.ADVANCE')}</option>
            </Select>
          </Field>
        )}
        <Field label={t('pay.mode')} htmlFor="pay-mode">
          <Select id="pay-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as PaymentMode })}>
            {MODES.map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('pay.amount')} htmlFor="pay-amount" required>
          <Input id="pay-amount" inputMode="decimal" className="num text-lg" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} autoFocus={lockParty} />
        </Field>
        <Field label={t('pay.date')} htmlFor="pay-date" required>
          <Input id="pay-date" type="date" value={v.paymentDate} onChange={(e) => setV({ ...v, paymentDate: e.target.value })} />
        </Field>
        {v.mode !== 'CASH' && (
          <Field label={t('pay.reference')} htmlFor="pay-ref" required={v.mode === 'CHEQUE'}>
            <Input id="pay-ref" value={v.referenceNumber} onChange={(e) => setV({ ...v, referenceNumber: e.target.value })} />
          </Field>
        )}
        <Field label={t('common.notes')} htmlFor="pay-rem">
          <Input id="pay-rem" value={v.remarks} maxLength={300} onChange={(e) => setV({ ...v, remarks: e.target.value })} />
        </Field>
      </div>
      {error && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={cs.isLoading}>{t('pay.add')}</Button>
      </div>
    </form>
  );
}
