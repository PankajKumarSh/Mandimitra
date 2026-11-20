'use client';

import clsx from 'clsx';
import { Download, FileSpreadsheet, Printer } from 'lucide-react';
import { useState } from 'react';
import { Card, EmptyState, ErrorState, Input, PageHeader, Skeleton } from '@/components/ui';
import { todayIST } from '@/features/common';
import { useCan, useT } from '@/hooks';
import { formatDate, formatMoney } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useReportQuery } from '@/services/api';
import type { ColumnType } from '@/types/api';

const REPORTS = ['daily-arrivals', 'sales', 'purchases', 'commission', 'expenses', 'monthly-summary', 'commodity-wise', 'farmer-outstanding', 'buyer-outstanding', 'stock'] as const;
const POINT_IN_TIME = new Set(['farmer-outstanding', 'buyer-outstanding', 'stock']);

function groupDigits(int: string) {
  return int.length <= 3 ? int : `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}`;
}
/** Display-only formatting of server-computed values. */
function cell(v: string | number | null | undefined, type: ColumnType, lang: 'hi' | 'en') {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (type === 'money') return /^-?\d/.test(s) ? formatMoney(s) : s;
  if (type === 'weight') {
    const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(s);
    return m ? `${m[1]}${groupDigits(m[2]!)}.${((m[3] ?? '') + '000').slice(0, 3)}` : s;
  }
  if (type === 'int') return groupDigits(s);
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return formatDate(s, lang);
  return s;
}

export default function ReportsPage() {
  const { t, lang } = useT();
  const can = useCan();
  const today = todayIST();
  const [key, setKey] = useState<(typeof REPORTS)[number]>('daily-arrivals');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const pit = POINT_IN_TIME.has(key);
  const valid = pit || (!!from && !!to && from <= to);
  const q = useReportQuery({ key, ...(pit ? {} : { from, to }) }, { skip: !valid });
  const r = q.data;
  const url = (format: string, extra = '') => `/api/v1/reports/${key}?format=${format}&lang=${lang}${pit ? '' : `&from=${from}&to=${to}`}${extra}`;
  const right = (ty: ColumnType) => ty === 'money' || ty === 'weight' || ty === 'int';

  return (
    <>
      <PageHeader title={t('rep.title')} />
      <div role="tablist" aria-label={t('rep.choose')} className="mb-4 flex flex-wrap gap-1.5">
        {REPORTS.map((k) => (
          <button key={k} role="tab" aria-selected={key === k} onClick={() => setKey(k)}
            className={clsx('rounded-full border px-3 py-1.5 text-sm font-medium', key === k ? 'border-brand-800 bg-brand-800 text-white' : 'border-line bg-surface text-ink-2 hover:bg-canvas')}>
            {t(`rep.${k}` as MessageKey)}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        {pit ? (
          <p className="text-sm text-ink-2">{t('rep.asOf')}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" aria-label={t('common.from')} value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
            <span className="text-sm text-ink-3">{t('common.to')}</span>
            <Input type="date" aria-label={t('common.to')} value={to} min={from} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <a href={url('html', '&print=1')} target="_blank" rel="noopener" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas"><Printer className="size-4" aria-hidden /> {t('rep.print')}</a>
          {can('report:export') && (
            <>
              <a href={url('pdf', '&download=1')} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm font-medium hover:bg-canvas"><Download className="size-4" aria-hidden /> {t('rep.pdf')}</a>
              <a href={url('xlsx')} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand-800 px-3 text-sm font-medium text-white hover:bg-brand-900"><FileSpreadsheet className="size-4" aria-hidden /> {t('rep.excel')}</a>
            </>
          )}
        </div>
      </div>

      <Card className={clsx('overflow-hidden [&>div]:p-0', q.isFetching && 'opacity-70')}>
        {q.isError ? <ErrorState message={apiError(q.error).message} onRetry={q.refetch} /> : !r || q.isLoading ? <Skeleton className="m-4 h-48" /> : r.rows.length === 0 ? (
          <EmptyState title={t('common.noResults')} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-canvas text-left text-ink-2">
                <tr>{r.columns.map((c) => <th key={c.key} className={clsx('whitespace-nowrap px-3 py-2.5 font-medium', right(c.type) && 'text-right')}>{c.header[lang]}</th>)}</tr>
              </thead>
              <tbody>
                {r.rows.map((row, i) => (
                  <tr key={i} className="border-t border-line">
                    {r.columns.map((c) => <td key={c.key} className={clsx('px-3 py-2', right(c.type) && 'num text-right')}>{cell(row[c.key], c.type, lang)}</td>)}
                  </tr>
                ))}
              </tbody>
              {r.totals && (
                <tfoot className="border-t-2 border-ink font-semibold">
                  <tr>{r.columns.map((c) => <td key={c.key} className={clsx('px-3 py-2.5', right(c.type) && 'num text-right')}>{cell(r.totals![c.key], c.type, lang)}</td>)}</tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Card>

      {r?.breakdown && r.breakdown.rows.length > 0 && (
        <Card title={r.breakdown.title[lang]} className="mt-5 max-w-md">
          <ul className="flex flex-col gap-1.5">{r.breakdown.rows.map((b) => <li key={b.label} className="flex justify-between gap-2 text-[15px]"><span>{b.label}</span><span className="num font-medium">{formatMoney(b.value)}</span></li>)}</ul>
        </Card>
      )}
      {r?.notes?.map((n, i) => <p key={i} className="mt-3 text-sm text-ink-2">* {n[lang]}</p>)}
    </>
  );
}
