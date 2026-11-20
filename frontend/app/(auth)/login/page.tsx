'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { loginSchema } from '@mandimitra/shared';
import { AuthFrame } from '@/components/layout/auth-frame';
import { Button, Field, Input } from '@/components/ui';
import { useT } from '@/hooks';
import { applyServerErrors } from '@/lib/forms';
import { useLoginMutation } from '@/services/api';
import { useAppDispatch, useAppSelector } from '@/store';
import { sessionRestored } from '@/store/ui-slice';

type Values = { mobile: string; password: string };

export default function LoginPage() {
  const { t } = useT();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const expired = useAppSelector((s) => s.ui.sessionExpired);
  const [login, { isLoading }] = useLoginMutation();
  const [formError, setFormError] = useState('');
  const { register, handleSubmit, setError, formState } = useForm<Values>({ resolver: zodResolver(loginSchema) as never });

  const onSubmit = handleSubmit(async (values) => {
    setFormError('');
    try {
      await login(values).unwrap();
      dispatch(sessionRestored());
      router.replace('/dashboard');
    } catch (err) {
      setFormError(applyServerErrors(err, setError, ['mobile', 'password']));
    }
  });

  return (
    <AuthFrame
      title={t('auth.login')}
      footer={
        <>
          {t('auth.noAccount')}{' '}
          <Link href="/register" className="font-medium text-brand-800 hover:underline">
            {t('auth.register')}
          </Link>
        </>
      }
    >
      {expired && <p className="mb-4 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700">{t('auth.sessionExpired')}</p>}
      <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
        <Field label={t('auth.mobile')} error={formState.errors.mobile?.message} htmlFor="mobile" required>
          <Input id="mobile" type="tel" inputMode="numeric" autoComplete="tel" autoFocus placeholder="98123 45678" invalid={!!formState.errors.mobile} {...register('mobile')} />
        </Field>
        <Field label={t('auth.password')} error={formState.errors.password?.message} htmlFor="password" required>
          <Input id="password" type="password" autoComplete="current-password" invalid={!!formState.errors.password} {...register('password')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {formError}
          </p>
        )}
        <Button type="submit" loading={isLoading} className="mt-1 h-11">
          {t('auth.login')}
        </Button>
      </form>
    </AuthFrame>
  );
}
