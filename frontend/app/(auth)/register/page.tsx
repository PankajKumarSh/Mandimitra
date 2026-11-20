'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { mobileSchema, nameSchema, passwordSchema } from '@mandimitra/shared';
import { AuthFrame } from '@/components/layout/auth-frame';
import { Button, Field, Input } from '@/components/ui';
import { useT } from '@/hooks';
import { applyServerErrors } from '@/lib/forms';
import { useRegisterMutation } from '@/services/api';

// Flat form shape; mapped to the API's nested registerSchema on submit (server re-validates).
const schema = z.object({
  fullName: nameSchema,
  mobile: mobileSchema,
  password: passwordSchema,
  businessName: z.string().trim().min(2, 'Enter the firm name').max(150),
  businessNameHindi: z.string().trim().max(150).optional(),
  mandiName: z.string().trim().max(150).optional(),
  district: z.string().trim().max(80).optional(),
  state: z.string().trim().max(80).optional(),
});
type Values = z.input<typeof schema>;

export default function RegisterPage() {
  const { t, lang } = useT();
  const router = useRouter();
  const [registerUser, { isLoading }] = useRegisterMutation();
  const [formError, setFormError] = useState('');
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(schema) as never });
  const err = formState.errors;

  const onSubmit = handleSubmit(async (v) => {
    setFormError('');
    const opt = (s?: string) => (s && s.trim() ? s.trim() : undefined);
    try {
      await registerUser({
        fullName: v.fullName,
        mobile: v.mobile,
        password: v.password,
        preferredLanguage: lang === 'hi' ? 'HI' : 'EN',
        business: { name: v.businessName, nameHindi: opt(v.businessNameHindi), mandiName: opt(v.mandiName), district: opt(v.district), state: opt(v.state) },
      }).unwrap();
      router.replace('/dashboard');
    } catch (e) {
      setFormError(applyServerErrors(e, setError, ['fullName', 'mobile', 'password']));
    }
  });

  return (
    <AuthFrame
      title={t('auth.register')}
      footer={
        <>
          {t('auth.haveAccount')}{' '}
          <Link href="/login" className="font-medium text-brand-800 hover:underline">
            {t('auth.login')}
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.fullName')} error={err.fullName?.message} htmlFor="fullName" required>
          <Input id="fullName" autoComplete="name" autoFocus invalid={!!err.fullName} {...register('fullName')} />
        </Field>
        <Field label={t('auth.mobile')} error={err.mobile?.message} htmlFor="mobile" required>
          <Input id="mobile" type="tel" inputMode="numeric" autoComplete="tel" placeholder="98123 45678" invalid={!!err.mobile} {...register('mobile')} />
        </Field>
        <Field label={t('auth.password')} error={err.password?.message} htmlFor="password" hint="8+" required>
          <Input id="password" type="password" autoComplete="new-password" invalid={!!err.password} {...register('password')} />
        </Field>
        <hr className="border-line" />
        <Field label={t('auth.businessName')} error={err.businessName?.message} htmlFor="businessName" required>
          <Input id="businessName" invalid={!!err.businessName} {...register('businessName')} />
        </Field>
        <Field label={t('auth.businessNameHindi')} htmlFor="businessNameHindi" hint={t('common.optional')}>
          <Input id="businessNameHindi" lang="hi" {...register('businessNameHindi')} />
        </Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label={t('auth.mandiName')} htmlFor="mandiName">
            <Input id="mandiName" {...register('mandiName')} />
          </Field>
          <Field label={t('auth.district')} htmlFor="district">
            <Input id="district" {...register('district')} />
          </Field>
          <Field label={t('auth.state')} htmlFor="state">
            <Input id="state" {...register('state')} />
          </Field>
        </div>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isLoading} className="mt-1 h-11">
          {t('auth.register')}
        </Button>
        <p className="text-center text-xs text-ink-3">{t('auth.trialNote')}</p>
      </form>
    </AuthFrame>
  );
}
