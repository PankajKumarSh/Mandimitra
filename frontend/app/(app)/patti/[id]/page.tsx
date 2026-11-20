'use client';

import { ArrowLeft, Ban, Download, MessageCircle, Printer } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorState, Skeleton } from '@/components/ui';
import { CancelDialog, Stat } from '@/features/common';
import { WhatsAppSendButton } from '@/features/communication';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney, formatQuintals } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCancelPattiMutation, useMeQuery, usePattiQuery } from '@/services/api';

export default function PattiDetailPage() {
  const { t, lang } = useT();
  const can = useCan();
  const { id } = useParams<{ id: string }>();
  const q = usePattiQuery(id);
  const me = useMeQuery();
  const [cancelPatti] = useCancelPattiMutation();
  const [cancelling, setCancelling] = useState(false);
  const [frameKey, setFrameKey] = useState(0);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.isError || !q.data) return <Card><ErrorState message={apiError(q.error).message} onRetry={q.refetch} /></Card>;
  const p = q.data;
  const farmerName = lang === 'hi' ? (p.farmer.nameHindi ?? p.farmer.name) : p.farmer.name;
  const business = me.data?.activeBusiness;
  const businessName = lang === 'hi' ? (business?.nameHindi ?? business?.name) : business?.name;

  // Click-to-chat (opens the user's own WhatsApp). Server-sent PDFs via the Business API arrive in Phase 6.
  const wa =
    p.farmer.mobile && p.farmer.whatsappConsent !== 'OPTED_OUT' && p.status === 'FINALIZED'
      ? `https://wa.me/${p.farmer.mobile.replace('+', '')}?text=${encodeURIComponent(
          lang === 'hi'
            ? `राम राम ${farmerName} जी 🙏\nआपकी पट्टी ${p.pattiNumber} (${formatDate(p.pattiDate, 'hi')})\nसकल: ${formatMoney(p.grossAmount)}\nकटौती: ${formatMoney(p.totalDeductions)}\nदेय राशि: ${formatMoney(p.netPayable)}\n— ${businessName ?? ''}`
            : `Namaste ${farmerName} ji 🙏\nYour patti ${p.pattiNumber} (${formatDate(p.pattiDate, 'en')})\nGross: ${formatMoney(p.grossAmount)}\nDeductions: ${formatMoney(p.totalDeductions)}\nNet payable: ${formatMoney(p.netPayable)}\n— ${businessName ?? ''}`,
        )}`
      : null;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/patti" className="inline-flex w-fit items-center gap-1 text-sm text-ink-2 hover:text-ink"><ArrowLeft className="size-4" aria-hidden /> {t('patti.title')}</Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="flex items-center gap-2">
            <span className="num text-sm text-ink-3">{p.pattiNumber}</span>
            <Badge tone={p.status === 'FINALIZED' ? 'green' : 'red'}>{p.status === 'FINALIZED' ? t('patti.finalized') : t('patti.cancelled')}</Badge>
          </p>
          <h1 className="text-2xl font-semibold"><Link href={`/farmers/${p.farmer.id}`} className="hover:underline">{farmerName}</Link></h1>
          <p className="mt-1 text-sm text-ink-2">{formatDate(p.pattiDate, lang)}{p.finalizedBy ? ` · ${p.finalizedBy.fullName}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/api/v1/patti/${p.id}/print?print=1`} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">
            <Printer className="size-4" aria-hidden /> {t('patti.print')}
          </a>
          <a href={`/api/v1/patti/${p.id}/pdf?download=1`} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">
            <Download className="size-4" aria-hidden /> {t('patti.pdf')}
          </a>
          {p.status === 'FINALIZED' && <WhatsAppSendButton kind="PATTI" entityId={p.id} />}
          {wa && (
            <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">
              <MessageCircle className="size-4" aria-hidden /> {t('wa.openWhatsApp')}
            </a>
          )}
          {p.status === 'FINALIZED' && (can('patti:cancel') || can('approval:request')) && (
            <Button variant="secondary" onClick={() => setCancelling(true)}><Ban className="size-4 text-danger-600" aria-hidden /> {t('patti.cancel')}</Button>
          )}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <Stat label={t('sale.weight')} value={formatQuintals(p.totalWeightKg, t('unit.qtl'))} sub={`${p.totalBags} ${t('lot.bags')}`} />
          <Stat label={t('patti.gross')} value={formatMoney(p.grossAmount, { decimals: 0 })} />
          <Stat label={t('patti.totalDeductions')} value={formatMoney(p.totalDeductions, { decimals: 0 })} />
          <Stat label={t('patti.advance')} value={formatMoney(p.advanceAdjusted, { decimals: 0 })} />
          <Stat label={t('patti.payable')} value={formatMoney(p.netPayable)} strong />
        </div>
        {p.cancelReason && <p className="mt-3 text-sm text-danger-700">{t('cancel.reason')}: {p.cancelReason}</p>}
      </Card>

      {/* The exact document that prints and becomes the PDF (served by the API, same template). */}
      <Card className="overflow-hidden [&>div]:p-0">
        <iframe key={frameKey} title={p.pattiNumber} src={`/api/v1/patti/${p.id}/print`} className="h-[1100px] w-full border-0 bg-canvas" />
      </Card>

      <CancelDialog
        open={cancelling}
        title={t('patti.cancel')}
        onClose={() => setCancelling(false)}
        onSubmit={(reason, key) => cancelPatti({ key, body: { id: p.id, reason } }).unwrap()}
        onDone={() => setFrameKey((k) => k + 1)}
      />
    </div>
  );
}
