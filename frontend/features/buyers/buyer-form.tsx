'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { createBuyerSchema, updateBuyerSchema } from '@mandimitra/shared';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useT, useToast } from '@/hooks';
import { applyServerErrors, cleanPayload, formSchema } from '@/lib/forms';
import { formatMobile } from '@/lib/format';
import { useCreateBuyerMutation, useUpdateBuyerMutation } from '@/services/api';
import type { Buyer } from '@/types/api';

const FIELDS = ['firmName', 'ownerName', 'mobile', 'address', 'city', 'gstin', 'creditLimit', 'notes', 'openingBalance', 'whatsappConsent'] as const;
type Values = Record<(typeof FIELDS)[number], string>;

export function BuyerForm({ buyer, onDone }: { buyer?: Buyer; onDone: (id: string) => void }) {
  const { t } = useT();
  const toast = useToast();
  const mode = buyer ? 'update' : 'create';
  const [create, c] = useCreateBuyerMutation();
  const [update, u] = useUpdateBuyerMutation();
  const [formError, setFormError] = useState('');
  const { register, handleSubmit, setError, formState } = useForm<Values>({
    resolver: zodResolver(formSchema(mode === 'create' ? createBuyerSchema : updateBuyerSchema, mode)) as never,
    defaultValues: {
      firmName: buyer?.firmName ?? '',
      ownerName: buyer?.ownerName ?? '',
      mobile: buyer?.mobile ? formatMobile(buyer.mobile) : '',
      address: buyer?.address ?? '',
      city: buyer?.city ?? '',
      gstin: buyer?.gstin ?? '',
      creditLimit: buyer?.creditLimit ?? '',
      notes: buyer?.notes ?? '',
      ...(buyer ? {} : { openingBalance: '' }),
      whatsappConsent: buyer?.whatsappConsent ?? 'UNKNOWN',
    } as Values,
  });
  const e = formState.errors;

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      if (buyer) {
        const saved = await update({ id: buyer.id, body: cleanPayload({ ...values } as Record<string, unknown>, 'update') }).unwrap();
        toast.success(t('common.saved'));
        onDone(saved.id);
      } else {
        const r = await create(values as unknown as Record<string, unknown>).unwrap();
        const dup = r.warnings.find((w) => w.code === 'DUPLICATE_GSTIN');
        if (dup) toast.info(`GSTIN: ${dup.firmName} (${dup.buyerCode})`);
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
        <Field label={t('buyer.firmName')} error={e.firmName?.message} htmlFor="b-firm" required>
          <Input id="b-firm" autoFocus invalid={!!e.firmName} {...register('firmName')} />
        </Field>
        <Field label={t('buyer.ownerName')} htmlFor="b-owner">
          <Input id="b-owner" {...register('ownerName')} />
        </Field>
        <Field label={t('auth.mobile')} error={e.mobile?.message} htmlFor="b-mobile">
          <Input id="b-mobile" type="tel" inputMode="numeric" placeholder="98123 45678" invalid={!!e.mobile} {...register('mobile')} />
        </Field>
        <Field label={t('buyer.city')} htmlFor="b-city">
          <Input id="b-city" {...register('city')} />
        </Field>
        <Field label={t('buyer.gstin')} error={e.gstin?.message} htmlFor="b-gstin" hint={t('common.optional')}>
          <Input id="b-gstin" className="uppercase" invalid={!!e.gstin} {...register('gstin')} />
        </Field>
        <Field label={t('buyer.creditLimit')} error={e.creditLimit?.message} htmlFor="b-limit" hint={t('common.optional')}>
          <Input id="b-limit" inputMode="decimal" className="num" invalid={!!e.creditLimit} {...register('creditLimit')} />
        </Field>
      </div>
      <Field label={t('farmer.address')} htmlFor="b-address">
        <Input id="b-address" {...register('address')} />
      </Field>
      {!buyer && (
        <Field label={t('farmer.openingBalance')} error={e.openingBalance?.message} hint={t('buyer.openingHint')} htmlFor="b-opening">
          <Input id="b-opening" inputMode="decimal" placeholder="0.00" className="num" invalid={!!e.openingBalance} {...register('openingBalance')} />
        </Field>
      )}
      <Field label="WhatsApp" htmlFor="b-consent">
        <Select id="b-consent" {...register('whatsappConsent')}>
          <option value="UNKNOWN">—</option>
          <option value="OPTED_IN">✓ सहमति / Opted in</option>
          <option value="OPTED_OUT">✗ मना / Opted out</option>
        </Select>
      </Field>
      <Field label={t('common.notes')} htmlFor="b-notes">
        <Textarea id="b-notes" {...register('notes')} />
      </Field>
      {formError && <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">{formError}</p>}
      <div className="flex justify-end">
        <Button type="submit" loading={c.isLoading || u.isLoading}>{t('common.save')}</Button>
      </div>
    </form>
  );
}
