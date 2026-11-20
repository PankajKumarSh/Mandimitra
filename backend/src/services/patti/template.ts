/**
 * Printable A4 patti (HTML). The SAME template is used for browser print and server PDF,
 * so what the munim prints is exactly what WhatsApp will later receive.
 * Every interpolated value goes through esc().
 */
import { amountInWords } from '../../utils/words.ts';

export interface PattiDoc {
  pattiNumber: string;
  pattiDate: string; // YYYY-MM-DD
  status: 'FINALIZED' | 'CANCELLED' | 'DRAFT';
  cancelReason: string | null;
  business: { name: string; nameHindi: string | null; mandiName: string | null; licenseNumber: string | null; gstin: string | null; addressLine: string | null; city: string | null; district: string | null; state: string | null; phone: string | null };
  farmer: { code: string; name: string; nameHindi: string | null; fatherName: string | null; village: string | null; district: string | null; mobile: string | null };
  lines: { lotNumber: string; commodity: string; commodityHindi: string | null; date: string; bags: number; weightQtl: string; rate: string; rateUnit: string; amount: string }[];
  totals: { weightQtl: string; bags: number; grossAmount: string; totalDeductions: string; netAmount: string; advanceAdjusted: string; roundOff: string; netPayable: string };
  deductions: { label: string; labelHindi: string | null; detail: string; amount: string }[];
  footerNote: string | null;
  notes: string | null;
  language: 'HI' | 'EN' | 'BILINGUAL';
  generatedAt: string;
}

export function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function group(int: string) {
  if (int.length <= 3) return int;
  return `${int.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${int.slice(-3)}`;
}
/** String-exact ₹ formatting of a 2-dp decimal string (no floats). */
export function rupees(v: string): string {
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return esc(v);
  const neg = m[1] && /[1-9]/.test(m[2]! + (m[3] ?? '')) ? '−' : '';
  return `${neg}₹${group(m[2]!.replace(/^0+(?=\d)/, ''))}.${((m[3] ?? '') + '00').slice(0, 2)}`;
}
/** Groups an already-rounded quintal string, e.g. "1250.50" → "1,250.50". */
function quintals(qtl: string) {
  const [i = '0', f = '00'] = qtl.split('.');
  return `${group(i)}.${(f + '00').slice(0, 2)}`;
}
function dateIn(d: string) {
  const [y, m, dd] = d.split('-');
  return `${dd}/${m}/${y}`;
}

export function renderPattiHtml(doc: PattiDoc, opts: { autoPrint?: boolean } = {}): string {
  const hi = doc.language !== 'EN';
  const en = doc.language !== 'HI';
  // Bilingual label helper: "हिंदी / English"
  const L = (h: string, e: string) => (hi && en ? `${h} <span class="en">/ ${e}</span>` : hi ? h : e);
  const b = doc.business;
  const f = doc.farmer;
  // De-duplicate (city and district are often the same, e.g. "Karnal, Karnal").
  const addr = [...new Set([b.addressLine, b.city, b.district, b.state].filter(Boolean))].join(', ');
  const unitLbl = (u: string) => (u === 'QUINTAL' ? (hi ? 'क्विं.' : 'qtl') : u === 'KG' ? (hi ? 'कि.ग्रा.' : 'kg') : u === 'TON' ? (hi ? 'टन' : 'ton') : hi ? 'बोरी' : 'bag');
  const cancelled = doc.status === 'CANCELLED';
  const show = (v: string) => !/^-?0+(\.0+)?$/.test(v);

  return `<!doctype html>
<html lang="${hi ? 'hi' : 'en'}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(doc.pattiNumber)} · ${esc(f.name)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { margin: 0; color: #1c1b19; background: #fff; font: 12.5px/1.45 "Noto Sans Devanagari", "Nirmala UI", "Mangal", "Inter", system-ui, sans-serif; }
  .sheet { max-width: 186mm; margin: 0 auto; padding: 4mm 0; position: relative; }
  header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #166534; padding-bottom: 8px; }
  h1 { margin: 0; font-size: 20px; color: #14532d; line-height: 1.2; }
  .sub { color: #52514e; font-size: 11.5px; }
  .doc-title { text-align: right; }
  .doc-title .t { font-size: 16px; font-weight: 700; color: #14532d; }
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 6px 16px; margin: 10px 0; padding: 8px 10px; background: #f7f6f3; border-radius: 6px; }
  .meta b { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { padding: 5px 6px; border-bottom: 1px solid #e7e5e0; text-align: left; vertical-align: top; }
  th { background: #f0fdf4; color: #14532d; font-weight: 600; font-size: 11.5px; }
  .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  tfoot td { font-weight: 700; border-top: 1.5px solid #1c1b19; border-bottom: none; }
  .summary { margin-left: auto; width: 62%; margin-top: 10px; }
  .summary td { border: none; padding: 3px 6px; }
  .summary .ded td { color: #52514e; }
  .summary .sep td { border-top: 1px solid #1c1b19; }
  .summary .grand td { font-size: 15px; font-weight: 700; border-top: 2px solid #166534; color: #14532d; padding-top: 6px; }
  .words { margin-top: 8px; padding: 6px 10px; border: 1px dashed #bbf7d0; border-radius: 6px; font-size: 12px; }
  .en { color: #7a7873; font-weight: 400; }
  .notes { margin-top: 8px; color: #52514e; font-size: 11.5px; }
  .sign { display: flex; justify-content: space-between; margin-top: 36px; font-size: 11.5px; color: #52514e; }
  .sign div { border-top: 1px solid #7a7873; padding-top: 4px; min-width: 42mm; text-align: center; }
  footer { margin-top: 14px; text-align: center; color: #7a7873; font-size: 10.5px; }
  .stamp { position: absolute; top: 40%; left: 50%; transform: translate(-50%, -50%) rotate(-18deg); font-size: 64px; font-weight: 800; color: rgba(220,38,38,.18); border: 6px solid rgba(220,38,38,.18); padding: 4px 24px; border-radius: 12px; pointer-events: none; }
  @media screen { body { background: #f7f6f3; } .sheet { background: #fff; padding: 12mm; margin: 16px auto; box-shadow: 0 1px 4px rgba(0,0,0,.08); } }
</style>
</head>
<body>
<div class="sheet">
  ${cancelled ? `<div class="stamp">${hi ? 'रद्द' : ''}${hi && en ? ' / ' : ''}${en ? 'CANCELLED' : ''}</div>` : ''}
  <header>
    <div>
      <h1>${esc(hi && b.nameHindi ? b.nameHindi : b.name)}</h1>
      ${hi && en && b.nameHindi ? `<div class="sub">${esc(b.name)}</div>` : ''}
      <div class="sub">${esc([b.mandiName, addr].filter(Boolean).join(' · '))}</div>
      <div class="sub">${esc([b.licenseNumber && `${hi ? 'लाइसेंस' : 'Licence'}: ${b.licenseNumber}`, b.gstin && `GSTIN: ${b.gstin}`, b.phone && `☎ ${b.phone}`].filter(Boolean).join(' · '))}</div>
    </div>
    <div class="doc-title">
      <div class="t">${L('किसान पट्टी', 'Farmer Patti')}</div>
      <div><b>${esc(doc.pattiNumber)}</b></div>
      <div>${L('दिनांक', 'Date')}: ${esc(dateIn(doc.pattiDate))}</div>
    </div>
  </header>

  <div class="meta">
    <div>${L('किसान', 'Farmer')}: <b>${esc(hi && f.nameHindi ? f.nameHindi : f.name)}</b>${hi && en && f.nameHindi ? ` <span class="en">(${esc(f.name)})</span>` : ''}</div>
    <div>${L('कोड', 'Code')}: <b>${esc(f.code)}</b></div>
    <div>${L('पिता का नाम', "Father's name")}: ${esc(f.fatherName ?? '—')}</div>
    <div>${L('गाँव', 'Village')}: ${esc([f.village, f.district].filter(Boolean).join(', ') || '—')}</div>
    ${f.mobile ? `<div>${L('मोबाइल', 'Mobile')}: ${esc(f.mobile)}</div>` : ''}
  </div>

  <table>
    <thead><tr>
      <th>${L('लॉट', 'Lot')}</th><th>${L('फसल', 'Crop')}</th><th>${L('तारीख', 'Date')}</th>
      <th class="r">${L('बोरी', 'Bags')}</th><th class="r">${L('वजन (क्विं.)', 'Weight (qtl)')}</th>
      <th class="r">${L('भाव', 'Rate')}</th><th class="r">${L('राशि', 'Amount')}</th>
    </tr></thead>
    <tbody>
      ${doc.lines
        .map(
          (l) => `<tr>
        <td>${esc(l.lotNumber)}</td>
        <td>${esc(hi && l.commodityHindi ? l.commodityHindi : l.commodity)}</td>
        <td>${esc(dateIn(l.date))}</td>
        <td class="r">${esc(l.bags)}</td>
        <td class="r">${quintals(l.weightQtl)}</td>
        <td class="r">${rupees(l.rate)}/${esc(unitLbl(l.rateUnit))}</td>
        <td class="r">${rupees(l.amount)}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
    <tfoot><tr>
      <td colspan="3">${L('कुल', 'Total')}</td>
      <td class="r">${esc(doc.totals.bags)}</td>
      <td class="r">${quintals(doc.totals.weightQtl)}</td>
      <td></td>
      <td class="r">${rupees(doc.totals.grossAmount)}</td>
    </tr></tfoot>
  </table>

  <table class="summary">
    <tr><td>${L('सकल राशि', 'Gross amount')}</td><td class="r">${rupees(doc.totals.grossAmount)}</td></tr>
    ${doc.deductions
      .map(
        (d) => `<tr class="ded"><td>− ${esc(hi && d.labelHindi ? d.labelHindi : d.label)}${hi && en && d.labelHindi ? ` <span class="en">/ ${esc(d.label)}</span>` : ''} <span class="en">${esc(d.detail)}</span></td><td class="r">${rupees(d.amount)}</td></tr>`,
      )
      .join('')}
    <tr class="sep"><td>${L('कुल कटौती', 'Total deductions')}</td><td class="r">${rupees(doc.totals.totalDeductions)}</td></tr>
    <tr><td><b>${L('शुद्ध राशि', 'Net amount')}</b></td><td class="r"><b>${rupees(doc.totals.netAmount)}</b></td></tr>
    ${show(doc.totals.advanceAdjusted) ? `<tr class="ded"><td>− ${L('अग्रिम समायोजन', 'Advance adjusted')}</td><td class="r">${rupees(doc.totals.advanceAdjusted)}</td></tr>` : ''}
    ${show(doc.totals.roundOff) ? `<tr class="ded"><td>${L('पूर्णांकन', 'Round off')}</td><td class="r">${rupees(doc.totals.roundOff)}</td></tr>` : ''}
    <tr class="grand"><td>${L('देय राशि', 'Net payable')}</td><td class="r">${rupees(doc.totals.netPayable)}</td></tr>
  </table>

  <div class="words">
    ${hi ? `<div>${L('अक्षरों में', 'In words')}: <b>${esc(amountInWords(doc.totals.netPayable, 'hi'))}</b></div>` : ''}
    ${en ? `<div>${hi ? '' : 'In words: '}<b>${esc(amountInWords(doc.totals.netPayable, 'en'))}</b></div>` : ''}
  </div>

  ${doc.notes ? `<div class="notes">${L('टिप्पणी', 'Note')}: ${esc(doc.notes)}</div>` : ''}
  ${cancelled && doc.cancelReason ? `<div class="notes"><b>${L('रद्द करने का कारण', 'Cancellation reason')}:</b> ${esc(doc.cancelReason)}</div>` : ''}

  <div class="sign">
    <div>${L('किसान के हस्ताक्षर', 'Farmer signature')}</div>
    <div>${L('मुनीम', 'Munim')}</div>
    <div>${L('कृते', 'For')} ${esc(hi && b.nameHindi ? b.nameHindi : b.name)}</div>
  </div>

  <footer>
    ${doc.footerNote ? `<div>${esc(doc.footerNote)}</div>` : ''}
    <div>${esc(doc.generatedAt)} · MandiMitra</div>
  </footer>
</div>
${opts.autoPrint ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150));</script>' : ''}
</body>
</html>`;
}
