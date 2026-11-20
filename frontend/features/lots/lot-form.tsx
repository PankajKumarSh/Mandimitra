'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { FarmerPicker, onEnterAdvance, todayIST, useIdempotencyKey } from '@/features/common';
import { useDebounce, useT, useToast } from '@/hooks';
import { formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCalcLotMutation, useCommoditiesQuery, useCreateLotMutation } from '@/services/api';
import type { Lot } from '@/types/api';

const W = /^\d{1,11}(\.\d{1,3})?$/;

export type LotPrefill = Partial<{ commodityId: string; arrivalDate: string; vehicleNumber: string; bags: string; weightUnit: string; grossWeight: string; tareWeight: string; remarks: string }>;

export function LotForm({ initialFarmer, initial, onDone }: { initialFarmer?: { id: string; label: string }; initial?: LotPrefill; onDone: (lot: Lot) => void }) {
  const { t, lang } = useT();
  const toast = useToast();
  const commodities = useCommoditiesQuery();
  const [create, createState] = useCreateLotMutation();
  const [calc] = useCalcLotMutation();
  const { key, rotate } = useIdempotencyKey();
  const [farmer, setFarmer] = useState<{ id: string; label: string } | null>(initialFarmer ?? null);
  const [v, setV] = useState({
    commodityId: '', gradeId: '', arrivalDate: todayIST(), vehicleNumber: '', bags: '', weightUnit: 'QUINTAL', grossWeight: '', tareWeight: '', moisturePercent: '', remarks: '',
    ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, x]) => x)),
  });
  const [net, setNet] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState('');
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));

  useEffect(() => {
    if (!v.commodityId && commodities.data?.[0]) setV((s) => ({ ...s, commodityId: commodities.data![0]!.id }));
  }, [commodities.data, v.commodityId]);

  // Net weight is computed by the server, never in the browser.
  const dGross = useDebounce(v.grossWeight, 250);
  const dTare = useDebounce(v.tareWeight, 250);
  useEffect(() => {
    if (!W.test(dGross) || (dTare && !W.test(dTare))) return setNet(null);
    calc({ weightUnit: v.weightUnit, grossWeight: dGross, tareWeight: dTare || '0' })
      .unwrap()
      .then((r) => setNet(r.netWeightKg))
      .catch(() => setNet(null));
  }, [dGross, dTare, v.weightUnit, calc]);

  const grades = commodities.data?.find((c) => c.id === v.commodityId)?.grades.filter((g) => g.isActive) ?? [];

  const submit = (confirm: boolean) => async (e?: FormEvent) => {
    e?.preventDefault();
    setErrors({});
    setFormError('');
    if (!farmer) return setErrors({ farmerId: t('patti.chooseFarmer') });
    const body: Record<string, unknown> = {
      farmerId: farmer.id,
      commodityId: v.commodityId,
      arrivalDate: v.arrivalDate,
      weightUnit: v.weightUnit,
      grossWeight: v.grossWeight.trim(),
      tareWeight: v.tareWeight.trim() || '0',
      bags: v.bags ? Number(v.bags) : 0,
      confirm,
    };
    if (v.gradeId) body.gradeId = v.gradeId;
    if (v.vehicleNumber.trim()) body.vehicleNumber = v.vehicleNumber.trim();
    if (v.moisturePercent.trim()) body.moisturePercent = v.moisturePercent.trim();
    if (v.remarks.trim()) body.remarks = v.remarks.trim();
    try {
      const lot = await create({ key, body }).unwrap();
      rotate();
      toast.success(`${t('common.saved')} · ${lot.lotNumber}`);
      onDone(lot);
    } catch (err) {
      const ae = apiError(err);
      if (ae.code === 'VALIDATION_ERROR' && Array.isArray(ae.details)) {
        setErrors(Object.fromEntries((ae.details as { path: string; message: string }[]).map((d) => [d.path || 'form', d.message])));
      } else setFormError(ae.message);
    }
  };

  return (
    <form onSubmit={submit(true)} onKeyDown={onEnterAdvance} className="flex flex-col gap-4" noValidate>
      <FarmerPicker value={farmer?.id ?? null} selectedLabel={farmer?.label ?? null} onChange={(id, label) => setFarmer({ id, label })} error={errors.farmerId} />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('lot.commodity')} htmlFor="l-com" required>
          <Select id="l-com" value={v.commodityId} onChange={(e) => setV({ ...v, commodityId: e.target.value, gradeId: '' })}>
            {commodities.data?.map((c) => <option key={c.id} value={c.id}>{lang === 'hi' ? (c.nameHindi ?? c.name) : c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('lot.grade')} htmlFor="l-grade">
          <Select id="l-grade" value={v.gradeId} onChange={set('gradeId')} disabled={!grades.length}>
            <option value="">—</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </Select>
        </Field>
        <Field label={t('lot.date')} htmlFor="l-date" required error={errors.arrivalDate}>
          <Input id="l-date" type="date" value={v.arrivalDate} onChange={set('arrivalDate')} />
        </Field>
        <Field label={t('lot.vehicle')} htmlFor="l-veh">
          <Input id="l-veh" className="uppercase" placeholder="HR 05 AB 1234" value={v.vehicleNumber} onChange={set('vehicleNumber')} />
        </Field>
        <Field label={t('lot.bags')} htmlFor="l-bags" error={errors.bags}>
          <Input id="l-bags" inputMode="numeric" className="num" value={v.bags} onChange={(e) => setV({ ...v, bags: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label={t('lot.weightUnit')} htmlFor="l-unit">
          <Select id="l-unit" value={v.weightUnit} onChange={set('weightUnit')}>
            <option value="QUINTAL">{t('unit.QUINTAL')}</option>
            <option value="KG">{t('unit.KG')}</option>
          </Select>
        </Field>
        <Field label={t('lot.gross')} htmlFor="l-gross" required error={errors.grossWeight}>
          <Input id="l-gross" inputMode="decimal" className="num" value={v.grossWeight} onChange={set('grossWeight')} invalid={!!errors.grossWeight} />
        </Field>
        <Field label={t('lot.tare')} htmlFor="l-tare" error={errors.tareWeight}>
          <Input id="l-tare" inputMode="decimal" className="num" placeholder="0" value={v.tareWeight} onChange={set('tareWeight')} />
        </Field>
        <div className="flex flex-col justify-end rounded-lg bg-brand-50 px-3 py-2">
          <span className="text-sm text-brand-800">{t('lot.net')}</span>
          <span className="num text-lg font-semibold text-brand-900">{net ? `${formatQuintals(net, t('unit.qtl'))} · ${net} kg` : '—'}</span>
        </div>
        <Field label={t('lot.moisture')} htmlFor="l-moist" error={errors.moisturePercent}>
          <Input id="l-moist" inputMode="decimal" className="num" value={v.moisturePercent} onChange={set('moisturePercent')} />
        </Field>
        <div className="sm:col-span-2">
          <Field label={t('lot.remarks')} htmlFor="l-rem">
            <Input id="l-rem" value={v.remarks} onChange={set('remarks')} />
          </Field>
        </div>
      </div>
      {(formError || errors.form) && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{formError || errors.form}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="secondary" onClick={() => submit(false)()} disabled={createState.isLoading}>{t('lot.saveDraft')}</Button>
        <Button type="submit" loading={createState.isLoading}>{t('lot.saveConfirm')}</Button>
      </div>
    </form>
  );
}
