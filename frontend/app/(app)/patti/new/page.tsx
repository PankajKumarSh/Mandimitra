'use client';

import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { Button, Card, ConfirmDialog, EmptyState, Field, Input, PageHeader, Spinner } from '@/components/ui';
import { FarmerPicker, todayIST, useIdempotencyKey } from '@/features/common';
import { useDebounce, useT, useToast } from '@/hooks';
import { formatDate, formatMoney, formatQuintals, isPositive } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useCreatePattiMutation, useFarmerQuery, usePattiPreviewMutation, usePurchasesQuery, useRulesQuery } from '@/services/api';
import type { PattiPreview } from '@/types/api';

const AMOUNT = /^\d{1,12}(\.\d{1,2})?$/;

function NewPatti() {
  const { t, lang } = useT();
  const toast = useToast();
  const router = useRouter();
  const params = useSearchParams();
  const initialId = params.get('farmerId');
  const initialFarmer = useFarmerQuery(initialId!, { skip: !initialId });
  const [farmer, setFarmer] = useState<{ id: string; label: string } | null>(null);
  useEffect(() => {
    if (initialFarmer.data && !farmer) setFarmer({ id: initialFarmer.data.id, label: initialFarmer.data.name });
  }, [initialFarmer.data, farmer]);

  const rules = useRulesQuery();
  const purchases = usePurchasesQuery({ farmerId: farmer?.id, unbilled: true, status: 'ACTIVE', pageSize: 100 }, { skip: !farmer });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set((purchases.data?.items ?? []).map((p) => p.id))), [purchases.data]);
  const [pattiDate, setPattiDate] = useState(todayIST());
  const [manual, setManual] = useState<{ label: string; amount: string }[]>([]);
  const [notes, setNotes] = useState('');
  const [preview, setPreview] = useState<PattiPreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [runPreview, pv] = usePattiPreviewMutation();
  const [create, cs] = useCreatePattiMutation();
  const { key, rotate } = useIdempotencyKey();
  const [confirming, setConfirming] = useState(false);

  const body = useMemo(() => {
    if (!farmer || selected.size === 0) return null;
    const validManual = manual.filter((m) => m.label.trim() && AMOUNT.test(m.amount) && isPositive(m.amount)).map((m) => ({ label: m.label.trim(), amount: m.amount }));
    return { farmerId: farmer.id, pattiDate, purchaseIds: [...selected], manualDeductions: validManual, ...(notes.trim() ? { notes: notes.trim() } : {}) };
  }, [farmer, selected, pattiDate, manual, notes]);
  const dBody = useDebounce(body, 300);

  // Every number on this screen comes from the server engine.
  useEffect(() => {
    if (!dBody) return setPreview(null);
    setPreviewError('');
    runPreview(dBody)
      .unwrap()
      .then(setPreview)
      .catch((e) => {
        setPreview(null);
        setPreviewError(apiError(e).message);
      });
  }, [dBody, runPreview]);

  const finalize = async () => {
    if (!body) return;
    try {
      const p = await create({ key, body }).unwrap();
      rotate();
      toast.success(`${t('patti.finalized')} · ${p.pattiNumber}`);
      router.replace(`/patti/${p.id}`);
    } catch (e) {
      toast.error(apiError(e).message);
      setConfirming(false);
    }
  };

  const farmerRules = rules.data?.filter((r) => r.appliesTo === 'FARMER' && r.isActive) ?? [];

  return (
    <>
      <PageHeader title={t('patti.new')} />
      <div className="grid gap-5 lg:grid-cols-5">
        <div className="flex flex-col gap-5 lg:col-span-3">
          <Card>
            <div className="grid gap-4 sm:grid-cols-2">
              <FarmerPicker value={farmer?.id ?? null} selectedLabel={farmer?.label ?? null} onChange={(id, label) => { setFarmer({ id, label }); setManual([]); }} label={t('patti.chooseFarmer')} />
              <Field label={t('patti.date')} htmlFor="pt-date" required>
                <Input id="pt-date" type="date" value={pattiDate} onChange={(e) => setPattiDate(e.target.value)} />
              </Field>
            </div>
            {rules.data && farmerRules.length === 0 && (
              <p className="mt-3 rounded-lg bg-warn-50 px-3 py-2 text-sm text-warn-700">
                {t('patti.noRules')} <Link href="/settings?tab=rules" className="font-medium underline">{t('nav.settings')}</Link>
              </p>
            )}
          </Card>

          {farmer && (
            <Card title={t('patti.lines')}>
              {purchases.isLoading ? <Spinner /> : !purchases.data?.items.length ? (
                <EmptyState title={t('patti.noUnbilled')} />
              ) : (
                <ul className="-my-2 divide-y divide-line">
                  {purchases.data.items.map((p) => (
                    <li key={p.id} className="flex items-center gap-3 py-2.5">
                      <input
                        type="checkbox"
                        className="size-5 accent-brand-800"
                        aria-label={p.purchaseNumber}
                        checked={selected.has(p.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(p.id); else n.delete(p.id); return n; })}
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-[15px]">{lang === 'hi' ? (p.commodity.nameHindi ?? p.commodity.name) : p.commodity.name} · <span className="num">{formatQuintals(p.weightKg, t('unit.qtl'))} × {formatMoney(p.rate, { decimals: 0 })}</span></p>
                        <p className="num text-xs text-ink-3">{p.lot.lotNumber} · {formatDate(p.purchaseDate, lang)}</p>
                      </div>
                      <span className="num font-semibold">{formatMoney(p.grossAmount)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}

          {farmer && (purchases.data?.items.length ?? 0) > 0 && (
            <Card title={t('patti.manual')} action={<Button size="sm" variant="secondary" onClick={() => setManual((m) => [...m, { label: '', amount: '' }])} disabled={manual.length >= 10}><Plus className="size-4" aria-hidden /> {t('patti.addManual')}</Button>}>
              {manual.length === 0 ? <p className="text-sm text-ink-3">—</p> : (
                <div className="flex flex-col gap-2">
                  {manual.map((m, i) => (
                    <div key={i} className="flex gap-2">
                      <Input aria-label={t('rule.name')} placeholder="बारदाना / Bardana" value={m.label} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))} />
                      <Input aria-label="₹" inputMode="decimal" className="num w-36" placeholder="₹" value={m.amount} invalid={!!m.amount && !AMOUNT.test(m.amount)} onChange={(e) => setManual((x) => x.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)))} />
                      <Button variant="ghost" aria-label={t('common.delete')} onClick={() => setManual((x) => x.filter((_, j) => j !== i))}><Trash2 className="size-4 text-danger-600" aria-hidden /></Button>
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-4">
                <Field label={t('common.notes')} htmlFor="pt-notes"><Input id="pt-notes" value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} /></Field>
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          <Card title={t('common.preview')} className="lg:sticky lg:top-20">
            {!body ? <p className="text-sm text-ink-3">{t('patti.chooseFarmer')}</p> : previewError ? (
              <p role="alert" className="text-sm text-danger-700">{previewError}</p>
            ) : !preview ? <Spinner /> : (
              <div className={clsx('flex flex-col gap-4', pv.isLoading && 'opacity-60')} aria-live="polite">
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1.5 text-[15px]">
                  <dt className="text-ink-2">{t('patti.gross')} <span className="num text-xs">({formatQuintals(preview.totalWeightKg, t('unit.qtl'))})</span></dt>
                  <dd className="num text-right">{formatMoney(preview.grossAmount)}</dd>
                  {preview.deductions.map((d, i) => (
                    <div key={i} className="contents">
                      <dt className="text-ink-2">− {lang === 'hi' ? (d.labelHindi ?? d.label) : d.label}</dt>
                      <dd className="num text-right text-ink-2">{formatMoney(d.amount)}</dd>
                    </div>
                  ))}
                  <dt className="border-t border-line pt-1.5 font-medium">{t('patti.net')}</dt>
                  <dd className="num border-t border-line pt-1.5 text-right font-medium">{formatMoney(preview.netAmount)}</dd>
                  {isPositive(preview.advanceAdjusted) && (
                    <><dt className="text-ink-2">− {t('patti.advance')}</dt><dd className="num text-right text-ink-2">{formatMoney(preview.advanceAdjusted)}</dd></>
                  )}
                  {preview.roundOff !== '0' && (
                    <><dt className="text-ink-2">{t('patti.roundOff')}</dt><dd className="num text-right text-ink-2">{formatMoney(preview.roundOff)}</dd></>
                  )}
                  <dt className="border-t-2 border-brand-800 pt-2 text-lg font-semibold text-brand-900">{t('patti.payable')}</dt>
                  <dd className="num border-t-2 border-brand-800 pt-2 text-right text-2xl font-bold text-brand-900">{formatMoney(preview.netPayable)}</dd>
                </dl>
                <Button className="h-11" onClick={() => setConfirming(true)} disabled={pv.isLoading}>{t('patti.finalize')}</Button>
              </div>
            )}
          </Card>
        </div>
      </div>
      <ConfirmDialog
        open={confirming}
        title={t('patti.finalize')}
        message={`${t('patti.finalizeConfirm')} ${preview ? `${t('patti.payable')}: ${formatMoney(preview.netPayable)}` : ''}`}
        confirmLabel={t('patti.finalize')}
        loading={cs.isLoading}
        onClose={() => setConfirming(false)}
        onConfirm={finalize}
      />
    </>
  );
}

export default function NewPattiPage() {
  return (
    <Suspense fallback={<Spinner />}>
      <NewPatti />
    </Suspense>
  );
}
