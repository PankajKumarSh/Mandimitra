'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Button, Field, Input, Select } from '@/components/ui';
import { onEnterAdvance, todayIST, useIdempotencyKey } from '@/features/common';
import { useCan, useT, useToast } from '@/hooks';
import { apiError } from '@/services/base-query';
import { useCreateExpenseCategoryMutation, useCreateExpenseMutation, useExpenseCategoriesQuery } from '@/services/api';
import type { Expense, PaymentMode } from '@/types/api';

export type ExpensePrefill = Partial<{ categoryId: string; expenseDate: string; amount: string; mode: PaymentMode; payee: string; referenceNumber: string; remarks: string }>;

export function ExpenseForm({ initial, onDone }: { initial?: ExpensePrefill; onDone: (e: Expense) => void }) {
  const { t, lang } = useT();
  const toast = useToast();
  const can = useCan();
  const cats = useExpenseCategoriesQuery();
  const [create, cs] = useCreateExpenseMutation();
  const [createCat] = useCreateExpenseCategoryMutation();
  const { key, rotate } = useIdempotencyKey();
  const [v, setV] = useState({
    categoryId: '', expenseDate: todayIST(), amount: '', mode: 'CASH' as PaymentMode, payee: '', referenceNumber: '', remarks: '',
    ...Object.fromEntries(Object.entries(initial ?? {}).filter(([, x]) => x)),
  });
  const [newCat, setNewCat] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (!v.categoryId && cats.data?.[0]) setV((x) => ({ ...x, categoryId: cats.data![0]!.id }));
  }, [cats.data, v.categoryId]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    const body: Record<string, unknown> = { categoryId: v.categoryId, expenseDate: v.expenseDate, amount: v.amount.trim(), mode: v.mode };
    for (const k of ['payee', 'referenceNumber', 'remarks'] as const) if (v[k].trim()) body[k] = v[k].trim();
    try {
      const x = await create({ key, body }).unwrap();
      rotate();
      toast.success(`${t('common.saved')} · ${x.expenseNumber}`);
      onDone(x);
    } catch (err) {
      const ae = apiError(err);
      setError(Array.isArray(ae.details) ? (ae.details as { message: string }[]).map((d) => d.message).join(' · ') : ae.message);
    }
  };

  return (
    <form onSubmit={submit} onKeyDown={onEnterAdvance} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('exp.category')} htmlFor="e-cat" required>
          <Select id="e-cat" value={v.categoryId} onChange={(e) => setV({ ...v, categoryId: e.target.value })}>
            {cats.data?.map((c) => <option key={c.id} value={c.id}>{lang === 'hi' ? (c.nameHindi ?? c.name) : c.name}</option>)}
          </Select>
        </Field>
        <Field label={t('pay.amount')} htmlFor="e-amt" required>
          <Input id="e-amt" inputMode="decimal" className="num" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} autoFocus />
        </Field>
        <Field label={t('pay.date')} htmlFor="e-date" required><Input id="e-date" type="date" value={v.expenseDate} onChange={(e) => setV({ ...v, expenseDate: e.target.value })} /></Field>
        <Field label={t('pay.mode')} htmlFor="e-mode">
          <Select id="e-mode" value={v.mode} onChange={(e) => setV({ ...v, mode: e.target.value as PaymentMode })}>
            {(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'] as const).map((m) => <option key={m} value={m}>{t(`pay.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t('exp.payee')} htmlFor="e-payee"><Input id="e-payee" value={v.payee} onChange={(e) => setV({ ...v, payee: e.target.value })} /></Field>
        <Field label={t('pay.reference')} htmlFor="e-ref"><Input id="e-ref" value={v.referenceNumber} onChange={(e) => setV({ ...v, referenceNumber: e.target.value })} /></Field>
      </div>
      <Field label={t('common.notes')} htmlFor="e-rem"><Input id="e-rem" maxLength={300} value={v.remarks} onChange={(e) => setV({ ...v, remarks: e.target.value })} /></Field>
      {can('settings:manage') && (
        <div className="flex gap-2">
          <Input value={newCat} onChange={(e) => setNewCat(e.target.value)} placeholder={t('exp.addCategory')} aria-label={t('exp.addCategory')} />
          <Button type="button" variant="secondary" disabled={!newCat.trim()} onClick={async () => {
            try {
              const c = await createCat({ name: newCat.trim() }).unwrap();
              setV((x) => ({ ...x, categoryId: c.id }));
              setNewCat('');
            } catch (err) { toast.error(apiError(err).message); }
          }}>{t('common.add')}</Button>
        </div>
      )}
      {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
      <div className="flex justify-end"><Button type="submit" loading={cs.isLoading}>{t('common.save')}</Button></div>
    </form>
  );
}
