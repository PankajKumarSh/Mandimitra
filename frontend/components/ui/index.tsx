'use client';

import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Inbox, Info, Loader2, X, XCircle } from 'lucide-react';
import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { useT } from '@/hooks';
import { formatMoney, isNegative } from '@/lib/format';
import { useAppDispatch, useAppSelector } from '@/store';
import { dismissToast } from '@/store/ui-slice';

// ------------------------------------------------------------------ Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
const variants: Record<Variant, string> = {
  primary: 'bg-brand-800 text-white hover:bg-brand-900 disabled:bg-brand-800/50',
  secondary: 'bg-surface text-ink border border-line hover:bg-canvas disabled:text-ink-3',
  ghost: 'text-ink-2 hover:bg-canvas hover:text-ink',
  danger: 'bg-danger-600 text-white hover:bg-danger-700 disabled:bg-danger-600/50',
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; loading?: boolean; size?: 'sm' | 'md' }
>(function Button({ variant = 'primary', loading, size = 'md', className, children, disabled, ...rest }, ref) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        size === 'md' ? 'h-10 px-4 text-[15px]' : 'h-8 px-3 text-sm',
        variants[variant],
        className,
      )}
      {...rest}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});

// ------------------------------------------------------------------ Form fields

const controlBase =
  'w-full rounded-lg border border-line bg-surface px-3 text-[15px] text-ink placeholder:text-ink-3 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20 disabled:bg-canvas aria-[invalid=true]:border-danger-600';

export function Field({
  label,
  error,
  hint,
  required,
  children,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  required?: boolean;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink-2">
        {label}
        {required && <span className="text-danger-600"> *</span>}
      </label>
      {children}
      {error ? (
        <p role="alert" className="text-sm text-danger-700">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return <input ref={ref} aria-invalid={invalid || undefined} className={clsx(controlBase, 'h-10', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <select ref={ref} aria-invalid={invalid || undefined} className={clsx(controlBase, 'h-10 pr-8', className)} {...rest}>
        {children}
      </select>
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, ...rest }, ref) {
    return <textarea ref={ref} aria-invalid={invalid || undefined} className={clsx(controlBase, 'py-2', className)} rows={3} {...rest} />;
  },
);

export function Checkbox({ label, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 text-[15px] text-ink">
      <input id={id} type="checkbox" className="mt-0.5 size-5 rounded border-line accent-brand-800" {...rest} />
      <span>{label}</span>
    </label>
  );
}

// ------------------------------------------------------------------ Display

export function Card({ className, children, title, action }: { className?: string; children: ReactNode; title?: string; action?: ReactNode }) {
  return (
    <section className={clsx('rounded-xl border border-line bg-surface', className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'green' | 'orange' | 'red' | 'amber'; children: ReactNode }) {
  const tones = {
    neutral: 'bg-canvas text-ink-2 border-line',
    green: 'bg-brand-50 text-brand-800 border-brand-200',
    orange: 'bg-accent-50 text-accent-700 border-accent-100',
    red: 'bg-danger-50 text-danger-700 border-danger-600/20',
    amber: 'bg-warn-50 text-warn-700 border-warn-700/20',
  };
  return <span className={clsx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>;
}

/** Balance with direction label — sign is never conveyed by colour alone. */
export function Balance({ value, side }: { value: string; side: 'farmer' | 'buyer' }) {
  const { t } = useT();
  const neg = isNegative(value);
  const zero = /^-?0*(\.0*)?$/.test(value);
  const label = zero ? null : side === 'farmer' ? (neg ? t('farmer.advance') : t('farmer.weOwe')) : neg ? t('farmer.advance') : t('common.balance');
  return (
    <span className="num inline-flex flex-col items-end leading-tight">
      <span className={clsx('font-semibold', zero ? 'text-ink-3' : neg ? 'text-accent-700' : 'text-ink')}>{formatMoney(value.replace('-', ''))}</span>
      {label && <span className="text-[11px] text-ink-3">{label}</span>}
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-line/70', className)} aria-hidden />;
}

export function Spinner({ label }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-2 py-10 text-ink-3">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, hint, action, icon }: { title: string; hint?: string; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <div className="rounded-full bg-canvas p-3 text-ink-3">{icon ?? <Inbox className="size-6" aria-hidden />}</div>
      <p className="text-base font-medium text-ink">{title}</p>
      {hint && <p className="max-w-sm text-sm text-ink-2">{hint}</p>}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div role="alert" className="flex flex-col items-center gap-3 px-4 py-12 text-center">
      <AlertTriangle className="size-7 text-danger-600" aria-hidden />
      <p className="text-base font-medium text-ink">{message ?? t('common.error')}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const { t } = useT();
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <nav className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 text-sm text-ink-2" aria-label="Pagination">
      <span className="num">
        {from}–{to} {t('common.of')} {total}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.prev')}
        </Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </Button>
      </div>
    </nav>
  );
}

// ------------------------------------------------------------------ Modal & confirm (native <dialog>: focus trap + Esc for free)

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      className={clsx(
        'm-auto max-h-[92vh] w-[calc(100%-2rem)] overflow-hidden rounded-xl border border-line bg-surface p-0 text-ink shadow-xl',
        wide ? 'max-w-2xl' : 'max-w-md',
      )}
    >
      {open && (
        <div className="flex max-h-[92vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="rounded-md p-1 text-ink-3 hover:bg-canvas hover:text-ink" aria-label="Close">
              <X className="size-5" />
            </button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  loading,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const { t } = useT();
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <p className="text-[15px] text-ink-2">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          {t('common.cancel')}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} loading={loading} onClick={onConfirm}>
          {confirmLabel ?? t('common.confirm')}
        </Button>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ Toasts

export function Toaster() {
  const toasts = useAppSelector((s) => s.ui.toasts);
  const dispatch = useAppDispatch();
  useEffect(() => {
    const timers = toasts.map((t) => setTimeout(() => dispatch(dismissToast(t.id)), t.kind === 'error' ? 6000 : 3500));
    return () => timers.forEach(clearTimeout);
  }, [toasts, dispatch]);
  const icons = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:bottom-6 sm:items-end sm:pr-6">
      {toasts.map((t) => {
        const Icon = icons[t.kind];
        return (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={clsx(
              'pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-lg border bg-surface px-4 py-3 text-[15px] shadow-lg',
              t.kind === 'error' ? 'border-danger-600/30' : 'border-line',
            )}
          >
            <Icon className={clsx('mt-0.5 size-5 shrink-0', t.kind === 'error' ? 'text-danger-600' : t.kind === 'success' ? 'text-brand-700' : 'text-ink-3')} aria-hidden />
            <span className="flex-1 text-ink">{t.message}</span>
            <button onClick={() => dispatch(dismissToast(t.id))} className="text-ink-3 hover:text-ink" aria-label="Dismiss">
              <X className="size-4" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold text-ink">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-2">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}
