'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, ErrorState, Field, Input, Modal, Skeleton, Textarea } from '@/components/ui';
import { useT, useToast } from '@/hooks';
import { formatDate, formatDateTime, formatMobile, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useAdminActionMutation, useAdminBusinessQuery } from '@/services/api';
import { SUB_TONE } from '@/features/billing/status';

type Action = 'suspend' | 'extend' | null;

export default function AdminBusinessPage() {
  const { t, lang } = useT();
  const toast = useToast();
  const { id } = useParams<{ id: string }>();
  const q = useAdminBusinessQuery(id);
  const [act, a] = useAdminActionMutation();
  const [open, setOpen] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [days, setDays] = useState('14');
  const [error, setError] = useState('');

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;
  const b = q.data;
  const s = b.subscription;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await act({ id, action: open!, body: open === 'extend' ? { days: Number(days), reason } : { reason } }).unwrap();
      toast.success(t('common.saved'));
      setOpen(null);
      setReason('');
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  const reactivate = async () => {
    try {
      await act({ id, action: 'reactivate' }).unwrap();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(apiError(err).message);
    }
  };

  const rows: [string, string][] = [
    [t('admin.owner'), `${b.owner.fullName} · ${formatMobile(b.owner.mobile)}`],
    [t('auth.mandiName'), b.mandiName ?? '—'],
    ['GSTIN', b.gstin ?? '—'],
    [t('admin.joined'), formatDate(b.createdAt, lang)],
    [t('admin.lastActivity'), b.lastActivity ? formatDateTime(b.lastActivity.createdAt, lang) : '—'],
  ];

  return (
    <div className="flex flex-col gap-5">
      <Link href="/admin" className="inline-flex items-center gap-1 text-sm text-brand-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> {t('admin.businesses')}
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{b.name}</h1>
          <p className="text-sm text-ink-2">{[b.nameHindi, b.city, b.district, b.state].filter(Boolean).join(' · ')}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Badge tone={b.status === 'ACTIVE' ? 'green' : 'red'}>{t(`admin.biz.${b.status}` as MessageKey)}</Badge>
            {s && <Badge tone={SUB_TONE[s.effectiveStatus]}>{s.plan.code} · {t(`bill.status.${s.effectiveStatus}` as MessageKey)}</Badge>}
          </div>
          {b.suspendReason && <p className="mt-2 text-sm text-danger-700">{t('admin.suspendedBecause', { reason: b.suspendReason })}</p>}
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setOpen('extend')}>{t('admin.extend')}</Button>
          {b.status === 'SUSPENDED' ? (
            <Button loading={a.isLoading} onClick={reactivate}>{t('admin.reactivate')}</Button>
          ) : (
            <Button variant="danger" onClick={() => setOpen('suspend')}>{t('admin.suspend')}</Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title={t('admin.business')}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-ink-3">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </Card>
        <Card title={t('admin.counts')}>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            {([['bill.usage.staff', b._count.memberships], ['bill.usage.farmers', b._count.farmers], ['nav.buyers', b._count.buyers], ['nav.arrivals', b._count.lots], ['nav.patti', b._count.pattis]] as [MessageKey, number][]).map(([k, n]) => (
              <div key={k}>
                <dt className="text-ink-3">{t(k)}</dt>
                <dd className="num text-lg font-semibold">{n}</dd>
              </div>
            ))}
          </dl>
          {s && (
            <p className="mt-4 text-sm text-ink-2">
              {s.effectiveStatus === 'TRIALING' ? t('bill.trialEnds', { date: formatDate(s.trialEndsAt, lang) }) : s.currentPeriodEnd ? `${t('admin.periodEnd')}: ${formatDate(s.currentPeriodEnd, lang)}` : ''}
              {s.pendingPlan && ` · → ${s.pendingPlan.code}`}
            </p>
          )}
        </Card>
      </div>

      <Card title={t('admin.payments')}>
        {b.payments.length === 0 ? (
          <p className="text-sm text-ink-3">{t('bill.noPayments')}</p>
        ) : (
          <ul className="divide-y divide-line text-sm">
            {b.payments.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>{formatDate(p.verifiedAt ?? p.createdAt, lang)} · {p.plan.code}</span>
                <span className="flex items-center gap-2">
                  <span className="num font-medium">{formatMoney(p.amount)}</span>
                  <Badge tone={p.status === 'SUCCEEDED' ? 'green' : p.status === 'FAILED' ? 'red' : 'neutral'}>{t(`bill.pay.${p.status}` as MessageKey)}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={t('admin.events')}>
        <ul className="divide-y divide-line text-sm">
          {b.events.map((e) => (
            <li key={e.id} className="flex flex-wrap justify-between gap-2 py-2">
              <span className="font-medium">{e.eventType}</span>
              <span className="text-ink-2">
                {[e.fromPlanCode && e.toPlanCode && e.fromPlanCode !== e.toPlanCode ? `${e.fromPlanCode} → ${e.toPlanCode}` : e.toPlanCode, e.toStatus, typeof e.metadata?.reason === 'string' ? `“${e.metadata.reason}”` : null].filter(Boolean).join(' · ')}
              </span>
              <span className="text-ink-3">{formatDateTime(e.createdAt, lang)}</span>
            </li>
          ))}
        </ul>
      </Card>

      <Modal open={open !== null} onClose={() => setOpen(null)} title={open === 'extend' ? t('admin.extend') : t('admin.suspend')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          {open === 'extend' && (
            <Field label={t('admin.days')} htmlFor="days" required>
              <Input id="days" type="number" min={1} max={90} value={days} onChange={(e) => setDays(e.target.value)} required />
            </Field>
          )}
          <Field label={t('admin.reason')} htmlFor="reason" required>
            <Textarea id="reason" rows={3} minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} required />
          </Field>
          {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(null)}>{t('common.cancel')}</Button>
            <Button type="submit" variant={open === 'suspend' ? 'danger' : 'primary'} loading={a.isLoading}>{open === 'extend' ? t('admin.extend') : t('admin.suspend')}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
