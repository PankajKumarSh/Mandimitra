'use client';

import { useId, useState } from 'react';
import { useT } from '@/hooks';
import { formatMoney, formatMoneyCompact } from '@/lib/format';

export interface SeriesDef {
  key: string;
  label: string;
  /** CSS colour token (validated pair: --color-series-1 / --color-series-2). */
  color: string;
}

interface Props {
  title: string;
  rows: Record<string, string>[]; // { month: '2026-11', [seriesKey]: '12345.00' }
  series: [SeriesDef, SeriesDef];
}

/** Geometry needs numbers; these never feed back into stored values. */
const num = (s: string | undefined) => Number(s ?? 0) || 0;

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const pow = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * pow >= v / 4)! * pow;
  return Math.ceil(v / step) * step;
}

function monthLabel(ym: string, lang: 'hi' | 'en') {
  const [y, m] = ym.split('-').map(Number);
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { month: 'short' }).format(new Date(Date.UTC(y!, m! - 1, 1)));
}

/**
 * Grouped column chart, one y-axis (two measures of different scale live in two charts, never a dual axis).
 * Bars ≤ 24px with 4px rounded data-ends, 2px gap between adjacent bars, recessive grid,
 * legend + hover tooltip + table view so identity is never colour-only.
 */
export function MonthChart({ title, rows, series }: Props) {
  const { t, lang } = useT();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const titleId = useId();

  const W = 560;
  const H = 220;
  const pad = { l: 56, r: 8, t: 12, b: 28 };
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const max = niceMax(Math.max(0, ...rows.flatMap((r) => series.map((s) => num(r[s.key])))));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const band = innerW / Math.max(1, rows.length);
  const barW = Math.min(24, (band - 16) / 2);
  const gap = 2;
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const allZero = rows.every((r) => series.every((s) => num(r[s.key]) === 0));

  return (
    <figure aria-labelledby={titleId} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <figcaption id={titleId} className="text-[15px] font-semibold text-ink">
          {title}
        </figcaption>
        <button onClick={() => setTable((v) => !v)} className="text-sm text-brand-800 hover:underline">
          {table ? t('common.showChart') : t('common.showTable')}
        </button>
      </div>

      {/* Legend: always present for 2 series */}
      <ul className="flex flex-wrap gap-4 text-sm text-ink-2">
        {series.map((s) => (
          <li key={s.key} className="flex items-center gap-2">
            <span className="inline-block size-3 rounded-sm" style={{ background: s.color }} aria-hidden />
            {s.label}
          </li>
        ))}
      </ul>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-ink-3">
                <th className="py-2 pr-4 font-medium">{t('dash.month_col')}</th>
                {series.map((s) => (
                  <th key={s.key} className="py-2 pr-4 text-right font-medium">{s.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b border-line/60">
                  <td className="py-2 pr-4">{monthLabel(r.month!, lang)} {r.month!.slice(0, 4)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="num py-2 pr-4 text-right">{formatMoney(r[s.key])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={title}>
            {/* recessive grid + y labels */}
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--color-line)" strokeWidth={1} />
                <text x={pad.l - 8} y={y(v)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--color-ink-3)">
                  {formatMoneyCompact(String(v))}
                </text>
              </g>
            ))}
            {rows.map((r, i) => {
              const cx = pad.l + band * i + band / 2;
              const x0 = cx - barW - gap / 2;
              return (
                <g key={r.month}>
                  {series.map((s, si) => {
                    const v = num(r[s.key]);
                    const h = Math.max(0, y(0) - y(v));
                    const x = si === 0 ? x0 : cx + gap / 2;
                    const rr = Math.min(4, h); // 4px rounded data-end, square at baseline
                    return h > 0 ? (
                      <path
                        key={s.key}
                        d={`M${x},${y(0)} V${y(v) + rr} Q${x},${y(v)} ${x + rr},${y(v)} H${x + barW - rr} Q${x + barW},${y(v)} ${x + barW},${y(v) + rr} V${y(0)} Z`}
                        fill={s.color}
                        opacity={hover === null || hover === i ? 1 : 0.45}
                      />
                    ) : null;
                  })}
                  <text x={cx} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--color-ink-3)">
                    {monthLabel(r.month!, lang)}
                  </text>
                  {/* Hit target: whole band, larger than the marks */}
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={innerH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${monthLabel(r.month!, lang)}: ${series.map((s) => `${s.label} ${formatMoney(r[s.key])}`).join(', ')}`}
                    onMouseEnter={() => setHover(i)}
                    onMouseLeave={() => setHover(null)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--color-ink-3)" strokeWidth={1} />
          </svg>

          {hover !== null && rows[hover] && (
            <div
              className="pointer-events-none absolute top-2 z-10 rounded-lg border border-line bg-surface px-3 py-2 text-sm shadow-lg"
              style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%`, transform: 'translateX(-50%)' }}
            >
              <p className="mb-1 font-medium text-ink">
                {monthLabel(rows[hover]!.month!, lang)} {rows[hover]!.month!.slice(0, 4)}
              </p>
              {series.map((s) => (
                <p key={s.key} className="flex items-center gap-2 text-ink-2">
                  <span className="inline-block size-2.5 rounded-sm" style={{ background: s.color }} aria-hidden />
                  {s.label}: <span className="num font-medium text-ink">{formatMoney(rows[hover]![s.key])}</span>
                </p>
              ))}
            </div>
          )}
          {allZero && <p className="absolute inset-x-0 top-1/3 text-center text-sm text-ink-3">{t('dash.noRecent')}</p>}
        </div>
      )}
    </figure>
  );
}
