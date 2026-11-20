/**
 * Amount in words, Indian numbering (lakh / crore), for patti and receipts.
 * Works on the decimal STRING so there is no float conversion.
 */

const EN_ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN_TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

// Hindi numbers 1–99 are irregular words, so a full table is the only correct approach.
const HI_1_99 = [
  '', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस',
  'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस', 'बीस',
  'इक्कीस', 'बाईस', 'तेईस', 'चौबीस', 'पच्चीस', 'छब्बीस', 'सत्ताईस', 'अट्ठाईस', 'उनतीस', 'तीस',
  'इकतीस', 'बत्तीस', 'तैंतीस', 'चौंतीस', 'पैंतीस', 'छत्तीस', 'सैंतीस', 'अड़तीस', 'उनतालीस', 'चालीस',
  'इकतालीस', 'बयालीस', 'तैंतालीस', 'चवालीस', 'पैंतालीस', 'छियालीस', 'सैंतालीस', 'अड़तालीस', 'उनचास', 'पचास',
  'इक्यावन', 'बावन', 'तिरपन', 'चौवन', 'पचपन', 'छप्पन', 'सत्तावन', 'अट्ठावन', 'उनसठ', 'साठ',
  'इकसठ', 'बासठ', 'तिरसठ', 'चौंसठ', 'पैंसठ', 'छियासठ', 'सड़सठ', 'अड़सठ', 'उनहत्तर', 'सत्तर',
  'इकहत्तर', 'बहत्तर', 'तिहत्तर', 'चौहत्तर', 'पचहत्तर', 'छिहत्तर', 'सतहत्तर', 'अठहत्तर', 'उन्यासी', 'अस्सी',
  'इक्यासी', 'बयासी', 'तिरासी', 'चौरासी', 'पचासी', 'छियासी', 'सत्तासी', 'अट्ठासी', 'नवासी', 'नब्बे',
  'इक्यानवे', 'बानवे', 'तिरानवे', 'चौरानवे', 'पचानवे', 'छियानवे', 'सत्तानवे', 'अट्ठानवे', 'निन्यानवे',
];

function en99(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  return `${EN_TENS[Math.floor(n / 10)]}${n % 10 ? ` ${EN_ONES[n % 10]}` : ''}`;
}
function en999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${EN_ONES[h]} Hundred` : '', r ? en99(r) : ''].filter(Boolean).join(' ');
}
function hi999(n: number): string {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${HI_1_99[h]} सौ` : '', r ? HI_1_99[r]! : ''].filter(Boolean).join(' ');
}

/** Split an integer string into Indian groups: crore (any size), lakh, thousand, hundreds. */
function indianGroups(intStr: string) {
  const s = intStr.replace(/^0+(?=\d)/, '');
  const last3 = Number(s.slice(-3) || '0');
  const thousand = Number(s.slice(-5, -3) || '0');
  const lakh = Number(s.slice(-7, -5) || '0');
  const croreStr = s.slice(0, -7);
  return { crore: croreStr, lakh, thousand, last3 };
}

function intWords(intStr: string, lang: 'en' | 'hi'): string {
  const { crore, lakh, thousand, last3 } = indianGroups(intStr);
  const f = lang === 'en' ? en999 : hi999;
  const parts: string[] = [];
  if (crore && Number(crore) > 0) parts.push(`${intWords(crore, lang)} ${lang === 'en' ? 'Crore' : 'करोड़'}`);
  if (lakh) parts.push(`${f(lakh)} ${lang === 'en' ? 'Lakh' : 'लाख'}`);
  if (thousand) parts.push(`${f(thousand)} ${lang === 'en' ? 'Thousand' : 'हज़ार'}`);
  if (last3) parts.push(f(last3));
  return parts.join(' ');
}

export function amountInWords(amount: string, lang: 'en' | 'hi'): string {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(amount.trim());
  if (!m) throw new Error(`Invalid amount: ${amount}`);
  const rupees = m[2]!;
  const paise = Number(((m[3] ?? '') + '00').slice(0, 2));
  const zero = /^0+$/.test(rupees);
  const neg = m[1] && (!zero || paise) ? (lang === 'en' ? 'Minus ' : 'ऋण ') : '';

  if (lang === 'en') {
    const r = zero ? 'Zero' : intWords(rupees, 'en');
    return `${neg}Rupees ${r}${paise ? ` and ${en99(paise)} Paise` : ''} Only`;
  }
  const r = zero ? 'शून्य' : intWords(rupees, 'hi');
  return `${neg}${r} रुपये${paise ? ` और ${HI_1_99[paise]} पैसे` : ''} मात्र`;
}
