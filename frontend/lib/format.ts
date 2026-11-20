/**
 * Display formatting only — never arithmetic. Amounts arrive from the API as decimal strings
 * and are grouped with pure string operations, so there is no float rounding at any size.
 */

/** "1234567.5" → "12,34,567.50" (Indian grouping: last 3 digits, then pairs). */
export function groupIndian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

export function formatMoney(value: string | null | undefined, opts: { symbol?: boolean; decimals?: 0 | 2 } = {}): string {
  const { symbol = true, decimals = 2 } = opts;
  if (value === null || value === undefined || value === '') return '—';
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(String(value).trim());
  if (!m) return String(value);
  const [, neg, int = '0', frac = ''] = m;
  let intPart = int.replace(/^0+(?=\d)/, '');
  let fracPart = '';
  if (decimals === 2) {
    // Values from the API never exceed 2 dp; pad, don't round.
    fracPart = `.${(frac + '00').slice(0, 2)}`;
  } else if (frac && Number(frac[0]) >= 5) {
    intPart = incrementDigits(intPart); // half-up to rupee for display
  }
  const isZero = /^0+$/.test(intPart) && /^\.?0*$/.test(fracPart);
  return `${neg && !isZero ? '−' : ''}${symbol ? '₹' : ''}${groupIndian(intPart)}${fracPart}`;
}

function incrementDigits(digits: string): string {
  const arr = digits.split('').map(Number);
  for (let i = arr.length - 1; i >= 0; i--) {
    if (arr[i]! < 9) {
      arr[i]! += 1;
      return arr.join('');
    }
    arr[i] = 0;
  }
  return `1${arr.join('')}`;
}

/** Compact for KPI tiles: ₹12.4 L, ₹3.2 Cr. Display-only approximation, labelled as such. */
export function formatMoneyCompact(value: string | null | undefined): string {
  if (!value) return '₹0';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  const abs = Math.abs(n);
  const sign = n < 0 ? '−' : '';
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)} Cr`;
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(2)} L`;
  return formatMoney(value, { decimals: 0 });
}

/** Weight stored in kg → "12.50 क्विं." (quintals) for display. */
export function formatQuintals(kg: string | null | undefined, unitLabel = 'qtl'): string {
  if (!kg) return `0 ${unitLabel}`;
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(kg);
  if (!m) return kg;
  // kg/100 as a pure string shift: "125050.5" → "1250.505"
  const int = m[2]!.padStart(3, '0');
  const q = `${int.slice(0, -2)}.${int.slice(-2)}${m[3] ?? ''}`;
  const [qi, qf = ''] = q.split('.');
  return `${groupIndian(qi!.replace(/^0+(?=\d)/, ''))}.${(qf + '00').slice(0, 2)} ${unitLabel}`;
}

export function formatDate(value: string | Date | null | undefined, lang: 'hi' | 'en' = 'hi'): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value.length === 10 ? `${value}T00:00:00Z` : value) : value;
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }).format(d);
}

export function formatDateTime(value: string | null | undefined, lang: 'hi' | 'en' = 'hi'): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(lang === 'hi' ? 'hi-IN' : 'en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  }).format(new Date(value));
}

/** "+919812345678" → "98123 45678" */
export function formatMobile(e164: string | null | undefined): string {
  if (!e164) return '—';
  const d = e164.replace(/^\+91/, '');
  return d.length === 10 ? `${d.slice(0, 5)} ${d.slice(5)}` : e164;
}

export function isNegative(value: string | null | undefined): boolean {
  return !!value && value.trim().startsWith('-') && !/^-0*(\.0*)?$/.test(value.trim());
}

export function isPositive(value: string | null | undefined): boolean {
  return !!value && !value.trim().startsWith('-') && !/^0*(\.0*)?$/.test(value.trim());
}
