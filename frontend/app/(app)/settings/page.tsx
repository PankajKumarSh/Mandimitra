'use client';

import clsx from 'clsx';
import { Plus } from 'lucide-react';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState, type FormEvent } from 'react';
import { RulesTab } from '@/features/settings/rules-tab';
import { Badge, Button, Card, Checkbox, ErrorState, Field, Input, Modal, PageHeader, Select, Skeleton, Textarea } from '@/components/ui';
import { useCan, useT, useToast } from '@/hooks';
import { formatMobile } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import {
  useAddGradeMutation,
  useBusinessQuery,
  useCommoditiesQuery,
  useCreateCommodityMutation,
  useSettingsQuery,
  useUpdateBusinessMutation,
  useUpdateCommodityMutation,
  useUpdateGradeMutation,
  useUpdateSettingsMutation,
} from '@/services/api';
import type { BusinessSettings, Commodity, Unit } from '@/types/api';

const UNITS: Unit[] = ['QUINTAL', 'KG', 'TON', 'BAG'];

function errorText(err: unknown) {
  const e = apiError(err);
  return Array.isArray(e.details) ? (e.details as { path: string; message: string }[]).map((d) => `${d.path}: ${d.message}`).join(' · ') : e.message;
}

function BusinessTab({ editable }: { editable: boolean }) {
  const { t } = useT();
  const toast = useToast();
  const q = useBusinessQuery();
  const [save, s] = useUpdateBusinessMutation();
  const [v, setV] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  useEffect(() => {
    if (q.data) {
      const d = q.data;
      setV({
        name: d.name, nameHindi: d.nameHindi ?? '', mandiName: d.mandiName ?? '', licenseNumber: d.licenseNumber ?? '', gstin: d.gstin ?? '',
        phone: d.phone ? formatMobile(d.phone) : '', email: d.email ?? '', addressLine: d.addressLine ?? '', city: d.city ?? '', district: d.district ?? '', state: d.state ?? '', pincode: d.pincode ?? '',
      });
    }
  }, [q.data]);
  if (q.isLoading) return <Skeleton className="h-64" />;
  if (q.isError) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, string | null> = {};
    for (const [k, val] of Object.entries(v)) body[k] = val.trim() === '' ? (k === 'name' ? val : null) : val.trim();
    try {
      await save(body).unwrap();
      toast.success(t('common.saved'));
    } catch (err) {
      setError(errorText(err));
    }
  };
  const f = (key: string, label: MessageKey, extra: Record<string, unknown> = {}) => (
    <Field label={t(label)} htmlFor={`biz-${key}`}>
      <Input id={`biz-${key}`} value={v[key] ?? ''} disabled={!editable} onChange={(e) => setV({ ...v, [key]: e.target.value })} {...extra} />
    </Field>
  );
  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {f('name', 'auth.businessName', { required: true })}
        {f('nameHindi', 'auth.businessNameHindi', { lang: 'hi' })}
        {f('mandiName', 'auth.mandiName')}
        {f('licenseNumber', 'settings.licence')}
        {f('gstin', 'buyer.gstin', { className: 'uppercase' })}
        {f('phone', 'settings.phone', { type: 'tel', inputMode: 'numeric' })}
        {f('email', 'settings.email', { type: 'email' })}
        {f('city', 'settings.city')}
        {f('district', 'auth.district')}
        {f('state', 'auth.state')}
        {f('pincode', 'settings.pincode', { inputMode: 'numeric' })}
      </div>
      {f('addressLine', 'settings.address')}
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
      {editable ? <div className="flex justify-end"><Button type="submit" loading={s.isLoading}>{t('common.save')}</Button></div> : <p className="text-sm text-ink-3">{t('settings.ownerOnly')}</p>}
    </form>
  );
}

function PreferencesTab({ editable }: { editable: boolean }) {
  const { t } = useT();
  const toast = useToast();
  const q = useSettingsQuery();
  const [save, s] = useUpdateSettingsMutation();
  const [v, setV] = useState<BusinessSettings | null>(null);
  useEffect(() => { if (q.data) setV(q.data); }, [q.data]);
  if (q.isLoading || !v) return q.isError ? <ErrorState message={apiError(q.error).message} onRetry={q.refetch} /> : <Skeleton className="h-64" />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await save({
        tradingMode: v.tradingMode, netRounding: v.netRounding, pattiLanguage: v.pattiLanguage,
        pattiFooterNote: v.pattiFooterNote?.trim() ? v.pattiFooterNote.trim() : null,
        requireApprovalForCancel: v.requireApprovalForCancel, allowNegativeFarmerBalance: v.allowNegativeFarmerBalance, autoAdjustAdvanceInPatti: v.autoAdjustAdvanceInPatti,
      }).unwrap();
      toast.success(t('common.saved'));
    } catch (err) {
      toast.error(errorText(err));
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={t('settings.tradingMode')} htmlFor="p-mode">
          <Select id="p-mode" disabled={!editable} value={v.tradingMode} onChange={(e) => setV({ ...v, tradingMode: e.target.value as BusinessSettings['tradingMode'] })}>
            {(['COMMISSION_AGENT', 'TRADER', 'MIXED'] as const).map((m) => <option key={m} value={m}>{t(`settings.mode.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.rounding')} htmlFor="p-round">
          <Select id="p-round" disabled={!editable} value={v.netRounding} onChange={(e) => setV({ ...v, netRounding: e.target.value as BusinessSettings['netRounding'] })}>
            {(['NEAREST_RUPEE', 'NONE'] as const).map((m) => <option key={m} value={m}>{t(`settings.round.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('settings.pattiLanguage')} htmlFor="p-lang">
          <Select id="p-lang" disabled={!editable} value={v.pattiLanguage} onChange={(e) => setV({ ...v, pattiLanguage: e.target.value as BusinessSettings['pattiLanguage'] })}>
            {(['BILINGUAL', 'HI', 'EN'] as const).map((m) => <option key={m} value={m}>{t(`settings.lang.${m}`)}</option>)}
          </Select>
        </Field>
      </div>
      <Field label={t('settings.footer')} htmlFor="p-footer">
        <Textarea id="p-footer" disabled={!editable} maxLength={500} value={v.pattiFooterNote ?? ''} onChange={(e) => setV({ ...v, pattiFooterNote: e.target.value })} />
      </Field>
      <div className="flex flex-col gap-3">
        <Checkbox label={t('settings.approvalCancel')} disabled={!editable} checked={v.requireApprovalForCancel} onChange={(e) => setV({ ...v, requireApprovalForCancel: e.target.checked })} />
        <Checkbox label={t('settings.negativeBalance')} disabled={!editable} checked={v.allowNegativeFarmerBalance} onChange={(e) => setV({ ...v, allowNegativeFarmerBalance: e.target.checked })} />
        <Checkbox label={t('settings.autoAdvance')} disabled={!editable} checked={v.autoAdjustAdvanceInPatti} onChange={(e) => setV({ ...v, autoAdjustAdvanceInPatti: e.target.checked })} />
      </div>
      {editable ? <div className="flex justify-end"><Button type="submit" loading={s.isLoading}>{t('common.save')}</Button></div> : <p className="text-sm text-ink-3">{t('settings.ownerOnly')}</p>}
    </form>
  );
}

function CommodityEditor({ commodity, onClose }: { commodity: Commodity | 'new' | null; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [create, c] = useCreateCommodityMutation();
  const [update, u] = useUpdateCommodityMutation();
  const [addGrade] = useAddGradeMutation();
  const [updateGrade] = useUpdateGradeMutation();
  const existing = commodity && commodity !== 'new' ? commodity : null;
  const [v, setV] = useState({ name: '', nameHindi: '', defaultUnit: 'QUINTAL' as Unit, rateUnit: 'QUINTAL' as Unit, bagWeightKg: '', isActive: true });
  const [grade, setGrade] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    setError('');
    setV(existing ? { name: existing.name, nameHindi: existing.nameHindi ?? '', defaultUnit: existing.defaultUnit, rateUnit: existing.rateUnit, bagWeightKg: existing.bagWeightKg ?? '', isActive: existing.isActive } : { name: '', nameHindi: '', defaultUnit: 'QUINTAL', rateUnit: 'QUINTAL', bagWeightKg: '', isActive: true });
  }, [commodity]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { name: v.name.trim(), nameHindi: v.nameHindi.trim() || null, defaultUnit: v.defaultUnit, rateUnit: v.rateUnit, bagWeightKg: v.bagWeightKg.trim() || null };
    try {
      if (existing) await update({ id: existing.id, body: { ...body, isActive: v.isActive } }).unwrap();
      else await create(body).unwrap();
      toast.success(t('common.saved'));
      onClose();
    } catch (err) {
      setError(errorText(err));
    }
  };
  const needsBag = v.defaultUnit === 'BAG' || v.rateUnit === 'BAG';
  return (
    <Modal open={!!commodity} onClose={onClose} title={existing ? existing.name : t('commodity.add')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('farmer.name')} htmlFor="c-name" required><Input id="c-name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required /></Field>
          <Field label={t('farmer.nameHindi')} htmlFor="c-hi"><Input id="c-hi" lang="hi" value={v.nameHindi} onChange={(e) => setV({ ...v, nameHindi: e.target.value })} /></Field>
          <Field label={t('commodity.unit')} htmlFor="c-unit">
            <Select id="c-unit" value={v.defaultUnit} onChange={(e) => setV({ ...v, defaultUnit: e.target.value as Unit })}>{UNITS.map((x) => <option key={x} value={x}>{t(`unit.${x}`)}</option>)}</Select>
          </Field>
          <Field label={t('commodity.rateUnit')} htmlFor="c-rate">
            <Select id="c-rate" value={v.rateUnit} onChange={(e) => setV({ ...v, rateUnit: e.target.value as Unit })}>{UNITS.map((x) => <option key={x} value={x}>{t(`unit.${x}`)}</option>)}</Select>
          </Field>
        </div>
        <Field label={t('commodity.bagWeight')} htmlFor="c-bag" required={needsBag}>
          <Input id="c-bag" inputMode="decimal" className="num" value={v.bagWeightKg} onChange={(e) => setV({ ...v, bagWeightKg: e.target.value })} required={needsBag} />
        </Field>
        {existing && <Checkbox label={t('common.active')} checked={v.isActive} onChange={(e) => setV({ ...v, isActive: e.target.checked })} />}
        {existing && (
          <div className="flex flex-col gap-2 rounded-lg border border-line p-3">
            <p className="text-sm font-medium">{t('commodity.grades')}</p>
            <div className="flex flex-wrap gap-2">
              {existing.grades.map((g) => (
                <button key={g.id} type="button" onClick={async () => { try { await updateGrade({ id: existing.id, gradeId: g.id, isActive: !g.isActive }).unwrap(); } catch (err) { toast.error(errorText(err)); } }}
                  className={clsx('rounded-full border px-2.5 py-1 text-sm', g.isActive ? 'border-brand-200 bg-brand-50 text-brand-900' : 'border-line text-ink-3 line-through')}>
                  {g.name}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="A / FAQ / Sharbati" aria-label={t('commodity.addGrade')} />
              <Button type="button" variant="secondary" disabled={!grade.trim()} onClick={async () => {
                try { await addGrade({ id: existing.id, name: grade.trim() }).unwrap(); setGrade(''); } catch (err) { toast.error(errorText(err)); }
              }}>{t('common.add')}</Button>
            </div>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        <div className="flex justify-end"><Button type="submit" loading={c.isLoading || u.isLoading}>{t('common.save')}</Button></div>
      </form>
    </Modal>
  );
}

function CommoditiesTab({ editable }: { editable: boolean }) {
  const { t, lang } = useT();
  const q = useCommoditiesQuery({ includeInactive: true });
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  if (q.isLoading) return <Skeleton className="h-48" />;
  if (q.isError) return <ErrorState message={apiError(q.error).message} onRetry={q.refetch} />;
  const current = editing === 'new' ? 'new' : (q.data?.find((c) => c.id === editing) ?? null);
  return (
    <div className="flex flex-col gap-3">
      {editable && <div className="flex justify-end"><Button variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden /> {t('commodity.add')}</Button></div>}
      <ul className="divide-y divide-line">
        {q.data?.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
            <div>
              <p className="font-medium">{lang === 'hi' ? (c.nameHindi ?? c.name) : c.name} <span className="text-sm font-normal text-ink-3">{lang === 'hi' ? c.name : c.nameHindi}</span></p>
              <p className="text-sm text-ink-2">{t(`unit.${c.defaultUnit}`)} · {t('commodity.rateUnit')} {t(`unit.${c.rateUnit}`)}{c.bagWeightKg ? ` · ${c.bagWeightKg} kg/${t('unit.BAG')}` : ''}{c.grades.length ? ` · ${c.grades.filter((g) => g.isActive).map((g) => g.name).join(', ')}` : ''}</p>
            </div>
            <div className="flex items-center gap-2">
              {!c.isActive && <Badge>{t('common.inactive')}</Badge>}
              {editable && <Button size="sm" variant="ghost" onClick={() => setEditing(c.id)}>{t('common.edit')}</Button>}
            </div>
          </li>
        ))}
      </ul>
      <CommodityEditor commodity={current} onClose={() => setEditing(null)} />
    </div>
  );
}

type Tab = 'business' | 'preferences' | 'rules' | 'commodities';
const TABS: Tab[] = ['business', 'preferences', 'rules', 'commodities'];

function Settings() {
  const { t } = useT();
  const can = useCan();
  const params = useSearchParams();
  const initial = params.get('tab') as Tab | null;
  const [tab, setTab] = useState<Tab>(initial && TABS.includes(initial) ? initial : 'business');
  const tabs: { key: Tab; label: MessageKey }[] = [
    { key: 'business', label: 'settings.business' },
    { key: 'preferences', label: 'settings.preferences' },
    { key: 'rules', label: 'rule.title' },
    { key: 'commodities', label: 'settings.commodities' },
  ];
  return (
    <>
      <PageHeader title={t('settings.title')} />
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
            className={clsx('-mb-px whitespace-nowrap border-b-2 px-4 py-2.5 text-[15px] font-medium', tab === x.key ? 'border-brand-800 text-brand-900' : 'border-transparent text-ink-2 hover:text-ink')}>
            {t(x.label)}
          </button>
        ))}
      </div>
      <Card>
        {tab === 'business' && <BusinessTab editable={can('business:manage')} />}
        {tab === 'preferences' && <PreferencesTab editable={can('settings:manage')} />}
        {tab === 'rules' && <RulesTab editable={can('settings:manage')} />}
        {tab === 'commodities' && <CommoditiesTab editable={can('commodity:manage')} />}
      </Card>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<Skeleton className="h-64" />}>
      <Settings />
    </Suspense>
  );
}
