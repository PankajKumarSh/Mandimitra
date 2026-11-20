'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { createFarmerSchema, updateFarmerSchema } from '@mandimitra/shared';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useT, useToast } from '@/hooks';
import { applyServerErrors, cleanPayload, formSchema } from '@/lib/forms';
import { formatMobile } from '@/lib/format';
import { useCreateFarmerMutation, useUpdateFarmerMutation } from '@/services/api';
import type { Farmer } from '@/types/api';

const FIELDS = ['name', 'nameHindi', 'fatherName', 'mobile', 'village', 'tehsil', 'district', 'state', 'address', 'notes', 'openingBalance', 'whatsappConsent'] as const;
type Values = Record<(typeof FIELDS)[number], string>;

export function FarmerForm({ farmer, onDone }: { farmer?: Farmer; onDone: (id: string) => void }) {
  const { t } = useT();
  const toast = useToast();
  const mode = farmer ? 'update' : 'create';
  const [create, c] = useCreateFarmerMutation();
  const [update, u] = useUpdateFarmerMutation();
  const [formError, setFormError] = useState('');

  const { register, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(formSchema(mode === 'create' ? createFarmerSchema : updateFarmerSchema, mode)) as never,
    defaultValues: {
      name: farmer?.name ?? '',
      nameHindi: farmer?.nameHindi ?? '',
      fatherName: farmer?.fatherName ?? '',
      mobile: farmer?.mobile ? formatMobile(farmer.mobile) : '',
      village: farmer?.village ?? '',
      tehsil: farmer?.tehsil ?? '',
      district: farmer?.district ?? '',
      state: farmer?.state ?? '',
      address: farmer?.address ?? '',
      notes: farmer?.notes ?? '',
      // Opening balance is create-only (the strict update schema rejects it).
      ...(farmer ? {} : { openingBalance: '' }),
      whatsappConsent: farmer?.whatsappConsent ?? 'UNKNOWN',
    } as Values,
  });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    // `values` is already the parsed/normalised output of the shared schema.
    try {
      if (farmer) {
        const body = cleanPayload({ ...values } as Record<string, unknown>, 'update');
        const saved = await update({ id: farmer.id, body }).unwrap();
        toast.success(t('common.saved'));
        onDone(saved.id);
      } else {
        const r = await create(values as unknown as Record<string, unknown>).unwrap();
        const dup = r.warnings.find((w) => w.code === 'DUPLICATE_MOBILE');
        if (dup) toast.info(t('farmer.dupMobile', { name: dup.name ?? '', code: dup.farmerCode ?? '' }));
        toast.success(`${t('common.saved')} · ${r.data.code}`);
        onDone(r.data.id);
      }
    } catch (err) {
      setFormError(applyServerErrors(err, setError, FIELDS));
    }
  });

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('farmer.name')} error={e.name?.message} htmlFor="f-name" required>
          <Input id="f-name" autoFocus invalid={!!e.name} {...register('name')} />
        </Field>
        <Field label={t('farmer.nameHindi')} error={e.nameHindi?.message} htmlFor="f-nameHindi">
          <Input id="f-nameHindi" lang="hi" {...register('nameHindi')} />
        </Field>
        <Field label={t('farmer.fatherName')} htmlFor="f-father">
          <Input id="f-father" {...register('fatherName')} />
        </Field>
        <Field label={t('auth.mobile')} error={e.mobile?.message} htmlFor="f-mobile">
          <Input id="f-mobile" type="tel" inputMode="numeric" placeholder="98123 45678" invalid={!!e.mobile} {...register('mobile')} />
        </Field>
        <Field label={t('farmer.village')} htmlFor="f-village">
          <Input id="f-village" {...register('village')} />
        </Field>
        <Field label={t('farmer.tehsil')} htmlFor="f-tehsil">
          <Input id="f-tehsil" {...register('tehsil')} />
        </Field>
        <Field label={t('auth.district')} htmlFor="f-district">
          <Input id="f-district" {...register('district')} />
        </Field>
        <Field label={t('auth.state')} htmlFor="f-state">
          <Input id="f-state" {...register('state')} />
        </Field>
      </div>
      <Field label={t('farmer.address')} htmlFor="f-address">
        <Input id="f-address" {...register('address')} />
      </Field>
      {!farmer && (
        <Field label={t('farmer.openingBalance')} error={e.openingBalance?.message} hint={t('farmer.openingHint')} htmlFor="f-opening">
          <Input id="f-opening" inputMode="decimal" placeholder="0.00" className="num" invalid={!!e.openingBalance} {...register('openingBalance')} />
        </Field>
      )}
      <Field label="WhatsApp" htmlFor="f-consent">
        <Select id="f-consent" {...register('whatsappConsent')}>
          <option value="UNKNOWN">—</option>
          <option value="OPTED_IN">✓ सहमति / Opted in</option>
          <option value="OPTED_OUT">✗ मना / Opted out</option>
        </Select>
      </Field>
      <Field label={t('common.notes')} htmlFor="f-notes">
        <Textarea id="f-notes" {...register('notes')} />
      </Field>
      {formError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{formError}</p>}
      <div className="flex justify-end gap-2">
        <Button type="submit" loading={c.isLoading || u.isLoading}>{t('common.save')}</Button>
      </div>
    </form>
  );
}
