/**
 * Printable documents other than the patti: tabular reports, ledger statements, payment receipts.
 * Same rules as the patti template: every value escaped, money formatted from decimal strings, offline-safe.
 */
import { amountInWords } from '../../utils/words.ts';
import { esc, rupees } from '../patti/template.ts';
import type { ColumnType } from '../../utils/xlsx.ts';

export interface DocBusiness {
  name: string;
  nameHindi: string | null;
  mandiName: string | null;
  licenseNumber: string | null;
  gstin: string | null;
  addressLine: string | null;
  city: string | null;
  district: string | null;
  state: string | null;
  phone: string | null;
}

export interface TableColumn {
  key: string;
  header: { hi: string; en: string };
  type: ColumnType;
  /** Keep on one line (document numbers like P/2026-27/000001). */
  nowrap?: boolean;
}
export type TableRow = Record<string, string | number | null>;

export interface TableDoc {
  business: DocBusiness;
  title: { hi: string; en: string };
  subtitle: string;
  columns: TableColumn[];
  rows: TableRow[];
  totals?: TableRow;
  breakdown?: { title: { hi: string; en: string }; rows: { label: string; value: string }[] };
  notes?: { hi: string; en: string }[];
  lang: 'hi' | 'en';
  landscape?: boolean;
  generatedAt: string;
}

function group(int: string) {
  return int.length <= 3 ? int : `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}`;
}
function weight(v: string) {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return esc(v);
  return `${m[1] ?? ''}${group(m[2]!)}.${((m[3] ?? '') + '000').slice(0, 3)}`;
}
function fmt(v: string | number | null | undefined, type: ColumnType): string {
  if (v === null || v === undefined || v === '') return '';
  const s = String(v);
  if (type === 'money') return rupees(s);
  if (type === 'weight') return weight(s);
  if (type === 'int') return esc(group(s));
  if (type === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(s)) return esc(s.split('-').reverse().join('/'));
  return esc(s);
}

function header(b: DocBusiness, lang: 'hi' | 'en') {
  const name = lang === 'hi' && b.nameHindi ? b.nameHindi : b.name;
  const addr = [...new Set([b.addressLine, b.city, b.district, b.state].filter(Boolean))].join(', ');
  return `<div>
    <h1>${esc(name)}</h1>
    <div class="sub">${esc([b.mandiName, addr].filter(Boolean).join(' · '))}</div>
    <div class="sub">${esc([b.licenseNumber && `${lang === 'hi' ? 'लाइसेंस' : 'Licence'}: ${b.licenseNumber}`, b.gstin && `GSTIN: ${b.gstin}`, b.phone && `☎ ${b.phone}`].filter(Boolean).join(' · '))}</div>
  </div>`;
}

const BASE_CSS = `
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #1c1b19; background: #fff; font: 11.5px/1.45 "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Inter", system-ui, sans-serif; }
  .sheet { margin: 0 auto; padding: 2mm 0; }
  header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #166534; padding-bottom: 6px; margin-bottom: 8px; }
  h1 { margin: 0; font-size: 17px; color: #14532d; }
  h2 { margin: 0; font-size: 15px; color: #14532d; text-align: right; }
  .sub { color: #52514e; font-size: 10.5px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 5px; border-bottom: 1px solid #e7e5e0; text-align: left; vertical-align: top; }
  thead th { background: #f0fdf4; color: #14532d; font-weight: 600; font-size: 10.5px; position: sticky; top: 0; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .nw { white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #1c1b19; border-bottom: none; }
  .muted { color: #7a7873; }
  .notes { margin-top: 8px; color: #52514e; font-size: 10.5px; }
  footer { margin-top: 10px; text-align: center; color: #7a7873; font-size: 9.5px; }
  @media screen { body { background: #f7f6f3; } .sheet { background: #fff; padding: 10mm; margin: 12px auto; max-width: 290mm; box-shadow: 0 1px 4px rgba(0,0,0,.08); } }
`;

export function renderTableDoc(doc: TableDoc, opts: { autoPrint?: boolean } = {}): string {
  const L = (x: { hi: string; en: string }) => (doc.lang === 'hi' ? x.hi : x.en);
  const right = (t: ColumnType) => t === 'money' || t === 'weight' || t === 'int';
  return `<!doctype html>
<html lang="${doc.lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(L(doc.title))}</title>
<style>@page { size: A4 ${doc.landscape ? 'landscape' : 'portrait'}; margin: 10mm; } ${BASE_CSS}</style></head>
<body><div class="sheet">
<header>${header(doc.business, doc.lang)}<div><h2>${esc(L(doc.title))}</h2><div class="sub" style="text-align:right">${esc(doc.subtitle)}</div></div></header>
${
  doc.rows.length === 0
    ? `<p class="muted">${doc.lang === 'hi' ? 'इस अवधि में कोई रिकॉर्ड नहीं' : 'No records for this period'}</p>`
    : `<table>
<thead><tr>${doc.columns.map((c) => `<th class="${right(c.type) ? 'r' : ''}">${esc(L(c.header))}</th>`).join('')}</tr></thead>
<tbody>${doc.rows.map((r) => `<tr>${doc.columns.map((c) => `<td class="${right(c.type) ? 'r' : ''}${c.nowrap || c.type === 'date' ? ' nw' : ''}">${fmt(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')}</tbody>
${doc.totals ? `<tfoot><tr>${doc.columns.map((c) => `<td class="${right(c.type) ? 'r' : ''}">${fmt(doc.totals![c.key], c.type)}</td>`).join('')}</tr></tfoot>` : ''}
</table>`
}
${
  doc.breakdown && doc.breakdown.rows.length
    ? `<table style="width:50%;margin-top:12px"><thead><tr><th colspan="2">${esc(L(doc.breakdown.title))}</th></tr></thead><tbody>${doc.breakdown.rows
        .map((b) => `<tr><td>${esc(b.label)}</td><td class="r">${rupees(b.value)}</td></tr>`)
        .join('')}</tbody></table>`
    : ''
}
${(doc.notes ?? []).map((n) => `<p class="notes">* ${esc(L(n))}</p>`).join('')}
<footer>${esc(doc.generatedAt)} · MandiMitra</footer>
</div>
${opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150));</script>' : ''}
</body></html>`;
}

// ------------------------------------------------------------------ payment receipt / voucher

export interface ReceiptDoc {
  business: DocBusiness;
  receiptNumber: string;
  paymentDate: string;
  direction: 'INCOMING' | 'OUTGOING';
  purpose: string;
  mode: string;
  referenceNumber: string | null;
  amount: string;
  party: { code: string; name: string; nameHindi: string | null; extra: string | null };
  remarks: string | null;
  balanceAfter: string | null;
  balanceLabel: { hi: string; en: string };
  status: 'ACTIVE' | 'CANCELLED';
  cancelReason: string | null;
  generatedAt: string;
}

const PURPOSE: Record<string, { hi: string; en: string }> = {
  ADVANCE: { hi: 'अग्रिम', en: 'Advance' },
  SETTLEMENT: { hi: 'पट्टी भुगतान', en: 'Settlement' },
  COLLECTION: { hi: 'वसूली', en: 'Collection' },
};
const MODE: Record<string, { hi: string; en: string }> = {
  CASH: { hi: 'नकद', en: 'Cash' },
  UPI: { hi: 'UPI', en: 'UPI' },
  BANK_TRANSFER: { hi: 'बैंक ट्रांसफ़र', en: 'Bank transfer' },
  CHEQUE: { hi: 'चेक', en: 'Cheque' },
};

/** Bilingual by design: receipts are handed to farmers and buyers. */
export function renderReceipt(d: ReceiptDoc, opts: { autoPrint?: boolean } = {}): string {
  const incoming = d.direction === 'INCOMING';
  const title = incoming ? { hi: 'भुगतान रसीद', en: 'Payment Receipt' } : { hi: 'भुगतान वाउचर', en: 'Payment Voucher' };
  const B = (x: { hi: string; en: string }) => (x.hi === x.en ? esc(x.hi) : `${esc(x.hi)} <span class="muted">/ ${esc(x.en)}</span>`);
  const row = (label: { hi: string; en: string }, value: string) => `<tr><th style="width:38%">${B(label)}</th><td>${value}</td></tr>`;
  return `<!doctype html>
<html lang="hi"><head><meta charset="utf-8"><title>${esc(d.receiptNumber)}</title>
<style>@page { size: A5 landscape; margin: 8mm; } ${BASE_CSS}
  .box th { background: transparent; color: #52514e; font-weight: 500; }
  .amount { font-size: 22px; font-weight: 700; color: #14532d; }
  .sign { display:flex; justify-content: space-between; margin-top: 28px; color:#52514e; }
  .sign div { border-top: 1px solid #7a7873; padding-top: 3px; min-width: 40mm; text-align:center; }
  .stamp { position: fixed; top: 35%; left: 50%; transform: translate(-50%,-50%) rotate(-15deg); font-size: 48px; font-weight: 800; color: rgba(220,38,38,.2); border: 5px solid rgba(220,38,38,.2); padding: 2px 18px; border-radius: 10px; }
</style></head>
<body><div class="sheet">
${d.status === 'CANCELLED' ? '<div class="stamp">रद्द / CANCELLED</div>' : ''}
<header>${header(d.business, 'hi')}<div><h2>${B(title)}</h2><div class="sub" style="text-align:right"><b>${esc(d.receiptNumber)}</b> · ${esc(d.paymentDate.split('-').reverse().join('/'))}</div></div></header>
<table class="box">
${row(incoming ? { hi: 'प्राप्त किया', en: 'Received from' } : { hi: 'भुगतान किया', en: 'Paid to' }, `<b>${esc(d.party.nameHindi ?? d.party.name)}</b>${d.party.nameHindi ? ` <span class="muted">(${esc(d.party.name)})</span>` : ''} · ${esc(d.party.code)}${d.party.extra ? ` · ${esc(d.party.extra)}` : ''}`)}
${row({ hi: 'प्रकार', en: 'Purpose' }, B(PURPOSE[d.purpose] ?? { hi: d.purpose, en: d.purpose }))}
${row({ hi: 'माध्यम', en: 'Mode' }, `${B(MODE[d.mode] ?? { hi: d.mode, en: d.mode })}${d.referenceNumber ? ` · Ref: ${esc(d.referenceNumber)}` : ''}`)}
${row({ hi: 'राशि', en: 'Amount' }, `<span class="amount">${rupees(d.amount)}</span>`)}
${row({ hi: 'अक्षरों में', en: 'In words' }, `${esc(amountInWords(d.amount, 'hi'))}<br><span class="muted">${esc(amountInWords(d.amount, 'en'))}</span>`)}
${d.balanceAfter !== null ? row(d.balanceLabel, rupees(d.balanceAfter)) : ''}
${d.remarks ? row({ hi: 'टिप्पणी', en: 'Remarks' }, esc(d.remarks)) : ''}
${d.status === 'CANCELLED' && d.cancelReason ? row({ hi: 'रद्द करने का कारण', en: 'Cancellation reason' }, esc(d.cancelReason)) : ''}
</table>
<div class="sign"><div>${incoming ? 'भुगतानकर्ता / Payer' : 'प्राप्तकर्ता / Receiver'}</div><div>कृते / For ${esc(d.business.nameHindi ?? d.business.name)}</div></div>
<footer>${esc(d.generatedAt)} · MandiMitra</footer>
</div>
${opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150));</script>' : ''}
</body></html>`;
}
