'use client';

import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, Input, Modal, Select, Skeleton } from '@/components/ui';
import { useT, useToast } from '@/hooks';
import { formatDate } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useCommoditiesQuery, useCreateRuleMutation, useRulesQuery, useUpdateRuleMutation } from '@/services/api';
import type { CommissionRule } from '@/types/api';

const TYPES = ['COMMISSION', 'LABOUR', 'WEIGHING', 'TRANSPORT', 'MARKET_FEE', 'LOADING_UNLOADING', 'OTHER'] as const;
const METHODS = ['PERCENTAGE', 'FIXED', 'PER_QUINTAL', 'PER_KG', 'PER_BAG'] as const;

function valueLabel(r: Pick<CommissionRule, 'calcMethod' | 'value'>, t: (k: MessageKey) => string) {
  return r.calcMethod === 'PERCENTAGE' ? `${r.value}%` : `₹${r.value} ${t(`rule.method.${r.calcMethod}` as MessageKey).replace('₹ ', '')}`;
}

function RuleEditor({ rule, onClose }: { rule: CommissionRule | 'new' | null; onClose: () => void }) {
  const { t, lang } = useT();
  const toast = useToast();
  const commodities = useCommoditiesQuery();
  const [create, c] = useCreateRuleMutation();
  const [update, u] = useUpdateRuleMutation();
  const existing = rule && rule !== 'new' ? rule : null;
  const [v, setV] = useState(() => ({
    name: existing?.name ?? '',
    nameHindi: existing?.nameHindi ?? '',
    chargeType: existing?.chargeType ?? 'COMMISSION',
    calcMethod: existing?.calcMethod ?? 'PERCENTAGE',
    value: existing?.value ?? '',
    appliesTo: existing?.appliesTo ?? 'FARMER',
    commodityId: existing?.commodityId ?? '',
    effectiveFrom: existing?.effectiveFrom.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    effectiveTo: existing?.effectiveTo?.slice(0, 10) ?? '',
    isActive: existing?.isActive ?? true,
  }));
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body = {
      name: v.name.trim(),
      nameHindi: v.nameHindi.trim() || null,
      chargeType: v.chargeType,
      calcMethod: v.calcMethod,
      value: v.value.trim(),
      appliesTo: v.appliesTo,
      commodityId: v.commodityId || null,
      effectiveFrom: v.effectiveFrom,
      effectiveTo: v.effectiveTo || null,
      isActive: v.isActive,
    };
    try {
      if (existing) await update({ id: existing.id, body }).unwrap();
      else await create(body).unwrap();
      toast.success(t('common.saved'));
      onClose();
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join(' · ') : ae.message);
    }
  };

  return (
    <Modal open={!!rule} onClose={onClose} title={existing ? existing.name : t('rule.add')} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={`${t('rule.name')} (English)`} htmlFor="r-name" required><Input id="r-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required placeholder="Commission" /></Field>
          <Field label={`${t('rule.name')} (हिंदी)`} htmlFor="r-hi"><Input id="r-hi" lang="hi" value={v.nameHindi} onChange={(e) => setV({ ...v, nameHindi: e.target.value })} placeholder="आढ़त" /></Field>
          <Field label={t('rule.type')} htmlFor="r-type">
            <Select id="r-type" value={v.chargeType} onChange={(e) => setV({ ...v, chargeType: e.target.value as typeof v.chargeType })}>{TYPES.map((x) => <option key={x} value={x}>{t(`rule.type.${x}` as MessageKey)}</option>)}</Select>
          </Field>
          <Field label={t('rule.appliesTo')} htmlFor="r-side">
            <Select id="r-side" value={v.appliesTo} onChange={(e) => setV({ ...v, appliesTo: e.target.value as 'FARMER' | 'BUYER' })}>
              <option value="FARMER">{t('rule.FARMER')}</option>
              <option value="BUYER">{t('rule.BUYER')}</option>
            </Select>
          </Field>
          <Field label={t('rule.method')} htmlFor="r-method">
            <Select id="r-method" value={v.calcMethod} onChange={(e) => setV({ ...v, calcMethod: e.target.value as typeof v.calcMethod })}>{METHODS.map((x) => <option key={x} value={x}>{t(`rule.method.${x}` as MessageKey)}</option>)}</Select>
          </Field>
          <Field label={t('rule.value')} htmlFor="r-value" required hint={v.calcMethod === 'PERCENTAGE' ? '2.5 = 2.5%' : '₹'}>
            <Input id="r-value" inputMode="decimal" className="num" value={v.value} onChange={(e) => setV({ ...v, value: e.target.value })} required />
          </Field>
          <Field label={t('lot.commodity')} htmlFor="r-com">
            <Select id="r-com" value={v.commodityId} onChange={(e) => setV({ ...v, commodityId: e.target.value })}>
              <option value="">{t('rule.allCommodities')}</option>
              {commodities.data?.map((cm) => <option key={cm.id} value={cm.id}>{lang === 'hi' ? (cm.nameHindi ?? cm.name) : cm.name}</option>)}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('rule.from')} htmlFor="r-from" required><Input id="r-from" type="date" value={v.effectiveFrom} onChange={(e) => setV({ ...v, effectiveFrom: e.target.value })} /></Field>
            <Field label={t('rule.to')} htmlFor="r-to"><Input id="r-to" type="date" min={v.effectiveFrom} value={v.effectiveTo} onChange={(e) => setV({ ...v, effectiveTo: e.target.value })} /></Field>
          </div>
        </div>
        {existing && <Checkbox label={t('common.active')} checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />}
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        <div className="flex justify-end"><Button type="submit" loading={c.isLoading || u.isLoading}>{t('common.save')}</Button></div>
      </form>
    </Modal>
  );
}

export function RulesTab({ editable }: { editable: boolean }) {
  const { t, lang } = useT();
  const q = useRulesQuery();
  const [editing, setEditing] = useState<CommissionRule | 'new' | null>(null);
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;

  return (
    <div className="flex flex-col gap-3">
      {editable && <div className="flex justify-end"><Button variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> {t('rule.add')}</Button></div>}
      {!q.data?.length ? <EmptyState title={t('rule.empty')} /> : (
        (['FARMER', 'BUYER'] as const).map((side) => {
          const rows = q.data!.filter((r) => r.appliesTo === side);
          if (!rows.length) return null;
          return (
            <section key={side}>
              <h3 className="mb-1 mt-2 text-sm font-semibold text-ink-2">{t(`rule.${side}`)}</h3>
              <ul className="divide-y divide-line">
                {rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                    <div>
                      <p className="font-medium">{lang === 'hi' ? (r.nameHindi ?? r.name) : r.name} <span className="num font-semibold text-brand-800">{valueLabel(r, t)}</span></p>
                      <p className="text-sm text-ink-2">
                        {t(`rule.type.${r.chargeType}` as MessageKey)} · {r.commodity ? (lang === 'hi' ? (r.commodity.nameHindi ?? r.commodity.name) : r.commodity.name) : t('rule.allCommodities')} · {formatDate(r.effectiveFrom, lang)}{r.effectiveTo ? ` – ${formatDate(r.effectiveTo, lang)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {!r.isActive && <Badge>{t('common.inactive')}</Badge>}
                      {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>{t('common.edit')}</Button>}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
      {editing && <RuleEditor key={editing === 'new' ? 'new' : editing.id} rule={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
