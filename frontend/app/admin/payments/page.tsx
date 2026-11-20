'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Badge, Card, EmptyState, ErrorState, Pagination, Select, Skeleton } from '@/components/ui';
import { useT } from '@/hooks';
import { formatDateTime, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useAdminPaymentsQuery } from '@/services/api';

const STATUSES = ['SUCCEEDED', 'FAILED', 'PENDING', 'REFUNDED'] as const;

export default function AdminPaymentsPage() {
  const { t, lang } = useT();
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const q = useAdminPaymentsQuery({ status: status || undefined, page, pageSize: 25 });

  return (
    <Card
      title={t('admin.payments')}
      action={
        <Select className="max-w-44" aria-label={t('admin.status')} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">{t('common.all')}</option>
          {STATUSES.map((s) => <option key={s} value={s}>{t(`bill.pay.${s}` as MessageKey)}</option>)}
        </Select>
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : q.isError ? (
        <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />
      ) : !q.data?.items.length ? (
        <EmptyState title={t('bill.noPayments')} />
      ) : (
        <>
          <div className="-mx-4 overflow-x-auto sm:mx-0">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-3">
                  <th className="px-3 py-2 font-medium">{t('bill.date')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.business')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.plan')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('bill.amount')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.status')}</th>
                  <th className="px-3 py-2 font-medium">Razorpay</th>
                </tr>
              </thead>
              <tbody>
                {q.data.items.map((p) => (
                  <tr key={p.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2.5">{formatDateTime(p.verifiedAt ?? p.createdAt, lang)}</td>
                    <td className="px-3 py-2.5"><Link href={`/admin/businesses/${p.business.id}`} className="text-brand-800 hover:underline">{p.business.name}</Link></td>
                    <td className="px-3 py-2.5">{p.plan.code}</td>
                    <td className="num px-3 py-2.5 text-right font-medium">{formatMoney(p.amount)}</td>
                    <td className="px-3 py-2.5">
                      <Badge tone={p.status === 'SUCCEEDED' ? 'green' : p.status === 'FAILED' ? 'red' : 'neutral'}>{t(`bill.pay.${p.status}` as MessageKey)}</Badge>
                      {p.failureReason && <span className="ml-2 text-xs text-ink-3">{p.failureReason}</span>}
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink-3">{p.gatewayPaymentId ?? p.gatewayOrderId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={25} total={q.data.total} onPage={setPage} />
        </>
      )}
    </Card>
  );
}
