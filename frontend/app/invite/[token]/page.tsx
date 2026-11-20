'use client';

import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AuthFrame } from '@/components/layout/auth-frame';
import { Button, ErrorState, Field, Input, Spinner } from '@/components/ui';
import { useT } from '@/hooks';
import { apiError } from '@/services/base-query';
import { useAcceptInviteMutation, useInvitePreviewQuery } from '@/services/api';

export default function InvitePage() {
  const { t, lang } = useT();
  const router = useRouter();
  const { token } = useParams<{ token: string }>();
  const preview = useInvitePreviewQuery(token);
  const [accept, { isLoading }] = useAcceptInviteMutation();
  const [fullName, setFullName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await accept({ token, password, ...(fullName.trim() ? { fullName: fullName.trim() } : {}) }).unwrap();
      router.replace('/dashboard');
    } catch (err) {
      setError(apiError(err).message);
    }
  };

  if (preview.isLoading) return <AuthFrame title={t('invite.title')}><Spinner label={t('common.loading')} /></AuthFrame>;
  if (preview.isError || !preview.data) return <AuthFrame title={t('invite.title')}><ErrorState message={apiError(preview.error).message} /></AuthFrame>;

  const p = preview.data;
  const biz = lang === 'hi' ? (p.businessNameHindi ?? p.businessName) : p.businessName;
  const role = lang === 'hi' ? (p.roleNameHindi ?? p.roleName) : p.roleName;

  return (
    <AuthFrame title={t('invite.title')}>
      <div className="mb-5 rounded-lg bg-brand-50 px-4 py-3 text-[15px]">
        <p className="font-semibold text-brand-900">{biz}</p>
        <p className="text-sm text-brand-800">
          {role} · {p.mobile}
        </p>
      </div>
      <p className="mb-4 text-sm text-ink-2">{p.userExists ? t('invite.existingUser') : t('invite.newUser')}</p>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {!p.userExists && (
          <Field label={t('auth.fullName')} htmlFor="fullName" required>
            <Input id="fullName" value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder={p.fullName ?? ''} required />
          </Field>
        )}
        <Field label={t('auth.password')} htmlFor="password" required hint={p.userExists ? undefined : '8+'}>
          <Input id="password" type="password" autoComplete={p.userExists ? 'current-password' : 'new-password'} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </Field>
        {error && (
          <p role="alert" className="rounded-lg bg-danger-50 px-3 py-2 text-sm text-danger-700">
            {error}
          </p>
        )}
        <Button type="submit" loading={isLoading} className="h-11">
          {t('invite.join')}
        </Button>
      </form>
    </AuthFrame>
  );
}
