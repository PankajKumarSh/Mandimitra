'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorState, Select, Skeleton } from '@/components/ui';
import { useT, useToast } from '@/hooks';
import { formatDateTime } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useApprovalsQuery, useDecideApprovalMutation } from '@/services/api';

const LINK: Record<string, string> = { Lot: '/arrivals', Sale: '/sales', Purchase: '/purchases', Patti: '/patti' };

export function ApprovalsPanel() {
  const { t, lang } = useT();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const q = useApprovalsQuery({ status: status || undefined, pageSize: 50 });
  const [decide, ds] = useDecideApprovalMutation();

  const act = async (id: string, decision: 'approve' | 'reject') => {
    try {
      await decide({ id, decision }).unwrap();
      toast.success(decision === 'approve' ? t('cancel.done') : t('approval.status.REJECTED'));
    } catch (e) {
      toast.error(apiError(e).message);
    }
  };

  return (
    <Card
      title={t('approval.title')}
      action={
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label={t('common.status')} className="h-9 w-36">
          <option value="PENDING">{t('approval.status.PENDING')}</option>
          <option value="APPROVED">{t('approval.status.APPROVED')}</option>
          <option value="REJECTED">{t('approval.status.REJECTED')}</option>
          <option value="">{t('common.all')}</option>
        </Select>
      }
    >
      {q.isLoading ? <Skeleton className="h-24" /> : q.isError ? <ErrorState message={apiError(q.error).message} onRetry={q.refetch} /> : !q.data?.items.length ? (
        <EmptyState title={t('approval.empty')} />
      ) : (
        <ul className="-my-2 divide-y divide-line">
          {q.data.items.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="font-medium">
                  {t('common.cancel')}:{' '}
                  <Link href={a.entityType === 'Lot' || a.entityType === 'Patti' ? `${LINK[a.entityType]}/${a.entityId}` : LINK[a.entityType]!} className="text-brand-800 hover:underline">
                    {a.entityType}
                  </Link>{' '}
                  <Badge tone={a.status === 'PENDING' ? 'amber' : a.status === 'APPROVED' ? 'green' : 'red'}>{t(`approval.status.${a.status}` as MessageKey)}</Badge>
                </p>
                <p className="text-sm text-ink-2">“{a.reason}”</p>
                <p className="text-xs text-ink-3">{t('approval.requestedBy')}: {a.requestedBy.fullName} · {formatDateTime(a.createdAt, lang)}{a.decidedBy ? ` · ${a.decidedBy.fullName}` : ''}</p>
              </div>
              {a.status === 'PENDING' && (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={ds.isLoading} onClick={() => act(a.id, 'reject')}>{t('approval.reject')}</Button>
                  <Button size="sm" variant="danger" disabled={ds.isLoading} onClick={() => act(a.id, 'approve')}>{t('approval.approve')}</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
