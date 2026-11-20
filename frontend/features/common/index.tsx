'use client';

import clsx from 'clsx';
import { Check, ChevronsUpDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from 'react';
import { Badge, Button, Field, Modal, Textarea } from '@/components/ui';
import { useDebounce, useT, useToast } from '@/hooks';
import { formatMobile } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useBuyersQuery, useFarmersQuery } from '@/services/api';
import type { CancelResult, LotStatus } from '@/types/api';

/** Today's date in IST as YYYY-MM-DD (the mandi's business day). */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/**
 * One key per submission intent: stable across retries/double-clicks of the same form,
 * rotated after a successful save so the next entry is a new request.
 */
export function useIdempotencyKey() {
  const [key, setKey] = useState(() => crypto.randomUUID());
  const rotate = useCallback(() => setKey(crypto.randomUUID()), []);
  return { key, rotate };
}

/** Keyboard-first entry: Enter moves to the next field; Enter on the last field submits. */
export function onEnterAdvance(e: KeyboardEvent<HTMLFormElement>) {
  const el = e.target as HTMLElement;
  if (e.key !== 'Enter' || e.shiftKey || el.tagName === 'TEXTAREA' || el.tagName === 'BUTTON' || (el as HTMLInputElement).type === 'submit') return;
  const focusables = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled])')).filter(
    (x) => x.offsetParent !== null,
  );
  const i = focusables.indexOf(el);
  if (i >= 0 && i < focusables.length - 1) {
    e.preventDefault();
    focusables[i + 1]!.focus();
  }
}

export function LotStatusBadge({ status }: { status: LotStatus }) {
  const { t } = useT();
  const tone = { DRAFT: 'neutral', CONFIRMED: 'green', PARTIALLY_SOLD: 'amber', SOLD: 'neutral', CANCELLED: 'red' } as const;
  return <Badge tone={tone[status]}>{t(`lot.status.${status}` as MessageKey)}</Badge>;
}

// ------------------------------------------------------------------ party picker

interface Option {
  id: string;
  title: string;
  sub: string;
}

function Combobox({
  label,
  value,
  selectedLabel,
  onChange,
  options,
  loading,
  query,
  setQuery,
  required,
  error,
  id,
}: {
  label: string;
  value: string | null;
  selectedLabel: string | null;
  onChange: (id: string, label: string) => void;
  options: Option[];
  loading: boolean;
  query: string;
  setQuery: (q: string) => void;
  required?: boolean;
  error?: string;
  id: string;
}) {
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  useEffect(() => setActive(0), [options.length]);

  const pick = (o: Option) => {
    onChange(o.id, o.title);
    setQuery('');
    setOpen(false);
  };

  return (
    <Field label={label} required={required} error={error} htmlFor={id}>
      <div ref={box} className="relative">
        <input
          id={id}
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-list`}
          aria-autocomplete="list"
          autoComplete="off"
          value={open ? query : (selectedLabel ?? '')}
          placeholder={selectedLabel ?? t('common.search')}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (!open) return;
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, options.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === 'Enter' && options[active]) {
              e.preventDefault();
              e.stopPropagation();
              pick(options[active]!);
            } else if (e.key === 'Escape') setOpen(false);
          }}
          aria-invalid={!!error || undefined}
          className="h-10 w-full rounded-lg border border-line bg-surface pl-3 pr-9 text-[15px] placeholder:text-ink-3 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 aria-[invalid=true]:border-danger-600"
        />
        <ChevronsUpDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
        {open && (
          <ul id={`${id}-list`} role="listbox" className="absolute left-0 right-0 top-11 z-40 max-h-64 overflow-y-auto rounded-lg border border-line bg-surface py-1 shadow-lg">
            {loading ? (
              <li className="px-3 py-2 text-sm text-ink-3">{t('common.loading')}</li>
            ) : options.length === 0 ? (
              <li className="px-3 py-2 text-sm text-ink-3">{t('common.noResults')}</li>
            ) : (
              options.map((o, i) => (
                <li
                  key={o.id}
                  role="option"
                  aria-selected={o.id === value}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    pick(o);
                  }}
                  onMouseEnter={() => setActive(i)}
                  className={clsx('flex cursor-pointer items-center justify-between gap-2 px-3 py-2', i === active && 'bg-canvas')}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-[15px]">{o.title}</span>
                    <span className="block truncate text-xs text-ink-3">{o.sub}</span>
                  </span>
                  {o.id === value && <Check className="size-4 text-brand-700" aria-hidden />}
                </li>
              ))
            )}
          </ul>
        )}
      </div>
    </Field>
  );
}

export function FarmerPicker(props: { value: string | null; selectedLabel: string | null; onChange: (id: string, label: string) => void; label?: string; error?: string; id?: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 200);
  const list = useFarmersQuery({ q: dq || undefined, pageSize: 20, isActive: true, sort: 'name' });
  const options = (list.data?.items ?? []).map((f) => ({
    id: f.id,
    title: f.nameHindi ? `${f.name} · ${f.nameHindi}` : f.name,
    sub: [f.code, f.fatherName && `s/o ${f.fatherName}`, f.village, f.mobile && formatMobile(f.mobile)].filter(Boolean).join(' · '),
  }));
  return <Combobox id={props.id ?? 'farmer-picker'} label={props.label ?? t('lot.farmer')} required value={props.value} selectedLabel={props.selectedLabel} onChange={props.onChange} options={options} loading={list.isFetching} query={q} setQuery={setQ} error={props.error} />;
}

export function BuyerPicker(props: { value: string | null; selectedLabel: string | null; onChange: (id: string, label: string) => void; error?: string; id?: string }) {
  const { t } = useT();
  const [q, setQ] = useState('');
  const dq = useDebounce(q.trim(), 200);
  const list = useBuyersQuery({ q: dq || undefined, pageSize: 20, isActive: true });
  const options = (list.data?.items ?? []).map((b) => ({ id: b.id, title: b.firmName, sub: [b.code, b.ownerName, b.city, b.overCreditLimit ? '⚠ limit' : null].filter(Boolean).join(' · ') }));
  return <Combobox id={props.id ?? 'buyer-picker'} label={t('sale.buyer')} required value={props.value} selectedLabel={props.selectedLabel} onChange={props.onChange} options={options} loading={list.isFetching} query={q} setQuery={setQ} error={props.error} />;
}

// ------------------------------------------------------------------ cancel dialog (200 cancelled / 202 sent for approval)

export function CancelDialog<T>({
  open,
  title,
  onClose,
  onSubmit,
  onDone,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  onSubmit: (reason: string, key: string) => Promise<CancelResult<T>>;
  onDone?: (r: CancelResult<T>) => void;
}) {
  const { t } = useT();
  const toast = useToast();
  const { key, rotate } = useIdempotencyKey();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const r = await onSubmit(reason.trim(), key);
      toast[r.status === 'PENDING_APPROVAL' ? 'info' : 'success'](r.status === 'PENDING_APPROVAL' ? t('cancel.sentForApproval') : t('cancel.done'));
      rotate();
      setReason('');
      onDone?.(r);
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('cancel.reason')} htmlFor="cancel-reason" required>
          <Textarea id="cancel-reason" value={reason} minLength={3} maxLength={500} onChange={(e) => setReason(e.target.value)} required autoFocus />
        </Field>
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.close')}</Button>
          <Button type="submit" variant="danger" loading={busy} disabled={reason.trim().length < 3}>{title}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function Stat({ label, value, sub, strong }: { label: string; value: ReactNode; sub?: string; strong?: boolean }) {
  return (
    <div>
      <p className="text-sm text-ink-2">{label}</p>
      <p className={clsx('num mt-0.5 font-semibold', strong ? 'text-2xl text-brand-900' : 'text-lg')}>{value}</p>
      {sub && <p className="num text-xs text-ink-3">{sub}</p>}
    </div>
  );
}
