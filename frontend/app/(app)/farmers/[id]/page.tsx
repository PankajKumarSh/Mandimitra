'use client';

import { ArrowLeft, Eye, Landmark, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Badge, Balance, Button, Card, Checkbox, ConfirmDialog, EmptyState, ErrorState, Field, Input, Modal, Skeleton } from '@/components/ui';
import { FarmerForm } from '@/features/farmers/farmer-form';
import { useCan, useT, useToast } from '@/hooks';
import { formatDate, formatMobile, formatMoney } from '@/lib/format';
import { apiError } from '@/services/base-query';
import {
  useAddBankAccountMutation,
  useBankAccountsQuery,
  useDeleteFarmerMutation,
  useFarmerQuery,
  useFarmerSummaryQuery,
  useRemoveBankAccountMutation,
  useRevealBankAccountMutation,
} from '@/services/api';

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm text-ink-2">{label}</p>
      <p className="num mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}

function BankAccounts({ farmerId }: { farmerId: string }) {
  const { t } = useT();
  const toast = useToast();
  const list = useBankAccountsQuery(farmerId);
  const [add, addState] = useAddBankAccountMutation();
  const [reveal] = useRevealBankAccountMutation();
  const [remove, removeState] = useRemoveBankAccountMutation();
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [form, setForm] = useState({ accountHolderName: '', accountNumber: '', ifsc: '', bankName: '', upiId: '', isPrimary: false });
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { accountHolderName: form.accountHolderName, accountNumber: form.accountNumber.replace(/\s/g, ''), ifsc: form.ifsc };
    if (form.bankName.trim()) body.bankName = form.bankName.trim();
    if (form.upiId.trim()) body.upiId = form.upiId.trim();
    if (form.isPrimary) body.isPrimary = true;
    try {
      await add({ farmerId, body }).unwrap();
      toast.success(t('common.saved'));
      setAdding(false);
      setForm({ accountHolderName: '', accountNumber: '', ifsc: '', bankName: '', upiId: '', isPrimary: false });
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };

  return (
    <Card title={t('bank.title')} action={<Button size="sm" variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden /> {t('bank.add')}</Button>}>
      {list.isLoading ? (
        <Skeleton className="h-16" />
      ) : list.isError ? (
        <ErrorState message={apiError(list.error).message} onRetry={list.refetch} />
      ) : !list.data?.length ? (
        <EmptyState icon={<Landmark className="size-6" aria-hidden />} title={t('bank.empty')} />
      ) : (
        <ul className="flex flex-col divide-y divide-line">
          {list.data.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="flex items-center gap-2 font-medium">
                  {a.bankName ?? a.ifsc} {a.isPrimary && <Badge tone="green">{t('bank.primary')}</Badge>}
                </p>
                <p className="num text-sm text-ink-2">{revealed[a.id] ?? a.accountNumberMasked} · {a.ifsc}</p>
                <p className="text-xs text-ink-3">{a.accountHolderName}{a.upiId ? ` · UPI ${a.upiId}` : ''}</p>
              </div>
              <div className="flex gap-1">
                {!revealed[a.id] && (
                  <Button
                    size="sm"
                    variant="ghost"
                    title={t('bank.revealNote')}
                    onClick={async () => {
                      try {
                        const r = await reveal({ farmerId, accountId: a.id }).unwrap();
                        setRevealed((s) => ({ ...s, [a.id]: r.accountNumber }));
                      } catch (err) {
                        toast.error(apiError(err).message);
                      }
                    }}
                  >
                    <Eye className="size-4" aria-hidden /> {t('bank.reveal')}
                  </Button>
                )}
                <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={() => setRemoving(a.id)}>
                  <Trash2 className="size-4 text-danger-600" aria-hidden />
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-xs text-ink-3">{t('bank.revealNote')}</p>

      <Modal open={adding} onClose={() => setAdding(false)} title={t('bank.add')}>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <Field label={t('bank.holder')} htmlFor="b-holder" required>
            <Input id="b-holder" value={form.accountHolderName} onChange={(e) => setForm({ ...form, accountHolderName: e.target.value })} required />
          </Field>
          <Field label={t('bank.number')} htmlFor="b-num" required>
            <Input id="b-num" inputMode="numeric" autoComplete="off" className="num" value={form.accountNumber} onChange={(e) => setForm({ ...form, accountNumber: e.target.value })} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t('bank.ifsc')} htmlFor="b-ifsc" required>
              <Input id="b-ifsc" className="uppercase" value={form.ifsc} onChange={(e) => setForm({ ...form, ifsc: e.target.value })} required />
            </Field>
            <Field label={t('bank.bankName')} htmlFor="b-bank">
              <Input id="b-bank" value={form.bankName} onChange={(e) => setForm({ ...form, bankName: e.target.value })} />
            </Field>
          </div>
          <Field label={t('bank.upi')} htmlFor="b-upi">
            <Input id="b-upi" value={form.upiId} onChange={(e) => setForm({ ...form, upiId: e.target.value })} placeholder="name@upi" />
          </Field>
          <Checkbox label={t('bank.primary')} checked={form.isPrimary} onChange={(e) => setForm({ ...form, isPrimary: e.target.checked })} />
          {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
          <div className="flex justify-end"><Button type="submit" loading={addState.isLoading}>{t('common.save')}</Button></div>
        </form>
      </Modal>
      <ConfirmDialog
        open={!!removing}
        title={t('common.areYouSure')}
        message={t('common.delete')}
        danger
        loading={removeState.isLoading}
        onClose={() => setRemoving(null)}
        onConfirm={async () => {
          try {
            await remove({ farmerId, accountId: removing! }).unwrap();
            toast.success(t('common.deleted'));
          } catch (err) {
            toast.error(apiError(err).message);
          }
          setRemoving(null);
        }}
      />
    </Card>
  );
}

export default function FarmerDetailPage() {
  const { t, lang } = useT();
  const can = useCan();
  const toast = useToast();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();
  const farmer = useFarmerQuery(id);
  const summary = useFarmerSummaryQuery(id);
  const [del, delState] = useDeleteFarmerMutation();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  if (farmer.isLoading) return <Skeleton className="h-64" />;
  if (farmer.isError || !farmer.data) return <Card><ErrorState message={apiError(farmer.error).message} onRetry={farmer.refetch} /></Card>;
  const f = farmer.data;
  const s = summary.data;

  return (
    <div className="flex flex-col gap-5">
      <Link href="/farmers" className="inline-flex w-fit items-center gap-1 text-sm text-ink-2 hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden /> {t('farmer.title')}
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="num text-sm text-ink-3">{f.code}</p>
          <h1 className="text-2xl font-semibold">{f.name}</h1>
          {f.nameHindi && <p className="text-lg text-ink-2">{f.nameHindi}</p>}
          <p className="mt-1 text-sm text-ink-2">
            {[f.fatherName && `s/o ${f.fatherName}`, f.village, f.district, formatMobile(f.mobile)].filter((x) => x && x !== '—').join(' · ')}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('ledger:read') && (
            <Link href={`/ledger/farmers/${f.id}`} className="inline-flex h-10 items-center rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">{t('ledger.statement')}</Link>
          )}
          {can('patti:create') && s && s.unbilledPurchases.count > 0 && (
            <Link href={`/patti/new?farmerId=${f.id}`} className="inline-flex h-10 items-center rounded-lg bg-brand-800 px-4 text-[15px] font-medium text-white hover:bg-brand-900">
              {t('patti.new')} ({s.unbilledPurchases.count})
            </Link>
          )}
          {can('farmer:update') && <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden /> {t('common.edit')}</Button>}
          {can('farmer:delete') && <Button variant="secondary" onClick={() => setDeleting(true)}><Trash2 className="size-4 text-danger-600" aria-hidden /> {t('common.delete')}</Button>}
        </div>
      </div>

      <Card>
        <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
          <div>
            <p className="text-sm text-ink-2">{t('common.balance')}</p>
            <div className="mt-1 text-2xl"><Balance value={f.currentBalance} side="farmer" /></div>
          </div>
          <Stat label={t('farmer.lots')} value={String(s?.lotCount ?? '—')} />
          <Stat label={t('farmer.lastArrival')} value={formatDate(s?.lastArrivalDate ?? null, lang)} />
          <Stat label={t('farmer.unbilled')} value={s ? formatMoney(s.unbilledPurchases.amount, { decimals: 0 }) : '—'} />
          <Stat label={t('farmer.pattis')} value={String(s?.finalizedPattiCount ?? '—')} />
        </div>
        <p className="mt-4 text-xs text-ink-3">{t('farmer.openingBalance')}: {formatMoney(f.openingBalance)}</p>
      </Card>

      {f.notes && <Card title={t('common.notes')}><p className="whitespace-pre-wrap text-[15px] text-ink-2">{f.notes}</p></Card>}

      {can('farmer:bank') && <BankAccounts farmerId={f.id} />}

      <Modal open={editing} onClose={() => setEditing(false)} title={t('farmer.edit')} wide>
        <FarmerForm farmer={f} onDone={() => setEditing(false)} />
      </Modal>
      <ConfirmDialog
        open={deleting}
        title={t('common.areYouSure')}
        message={t('farmer.deleteConfirm')}
        confirmLabel={t('common.delete')}
        danger
        loading={delState.isLoading}
        onClose={() => setDeleting(false)}
        onConfirm={async () => {
          try {
            await del(f.id).unwrap();
            toast.success(t('common.deleted'));
            router.replace('/farmers');
          } catch (err) {
            toast.error(apiError(err).message);
            setDeleting(false);
          }
        }}
      />
    </div>
  );
}
