import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import { businessForDocs, rangeLabel } from './documents/business.ts';
import { renderTableDoc, type TableDoc } from './documents/templates.ts';
import { istDateString } from './ledger.service.ts';

const D = Prisma.Decimal;
type Side = 'farmer' | 'buyer';

interface Row {
  id: string;
  entryDate: Date;
  entryType: string;
  debit: string;
  credit: string;
  narration: string;
  ref: string | null;
}

const TYPE_LABEL: Record<string, { hi: string; en: string }> = {
  OPENING_BALANCE: { hi: 'प्रारंभिक शेष', en: 'Opening balance' },
  PATTI_CREDIT: { hi: 'पट्टी', en: 'Patti' },
  SALE_DEBIT: { hi: 'बिक्री', en: 'Sale' },
  ADVANCE: { hi: 'अग्रिम', en: 'Advance' },
  PAYMENT: { hi: 'भुगतान', en: 'Payment' },
  ADJUSTMENT: { hi: 'समायोजन', en: 'Adjustment' },
  REVERSAL: { hi: 'रद्द (उलट)', en: 'Reversal' },
};

/**
 * Party statements. Ordering is by BUSINESS DATE (entryDate), then insertion sequence — so a back-dated
 * sale appears where it belongs. The running balance is recomputed here with Decimal for that order;
 * the stored `balanceAfter` reflects insertion order and is kept as an audit value only.
 *
 * Sign convention:
 *   farmer balance = Σcredit − Σdebit  (positive = we owe the farmer)
 *   buyer  balance = Σdebit − Σcredit  (positive = buyer owes us)
 */
export class StatementService {
  constructor(private readonly prisma: PrismaClient) {}

  async statement(t: TenantContext, side: Side, partyId: string, from?: string, to?: string) {
    const party =
      side === 'farmer'
        ? await t.db.farmer.findFirst({ where: { id: partyId }, select: { id: true, code: true, name: true, nameHindi: true, village: true, mobile: true, currentBalance: true, fatherName: true } })
        : await t.db.buyer.findFirst({ where: { id: partyId }, select: { id: true, code: true, firmName: true, ownerName: true, city: true, mobile: true, currentBalance: true, creditLimit: true } });
    if (!party) throw Errors.notFound();

    const fromDate = from ? new Date(`${from}T00:00:00.000Z`) : null;
    const toDate = to ? new Date(`${to}T00:00:00.000Z`) : null;
    const sign = (debit: Prisma.Decimal, credit: Prisma.Decimal) => (side === 'farmer' ? credit.minus(debit) : debit.minus(credit));

    let opening = new D(0);
    if (fromDate) {
      const agg =
        side === 'farmer'
          ? await t.db.farmerLedgerEntry.aggregate({ where: { farmerId: partyId, entryDate: { lt: fromDate } }, _sum: { debit: true, credit: true } })
          : await t.db.buyerLedgerEntry.aggregate({ where: { buyerId: partyId, entryDate: { lt: fromDate } }, _sum: { debit: true, credit: true } });
      opening = sign(agg._sum.debit ?? new D(0), agg._sum.credit ?? new D(0));
    }

    // Raw SQL to join document numbers; businessId bound explicitly.
    const rows =
      side === 'farmer'
        ? await this.prisma.$queryRaw<Row[]>`
            SELECT e."id", e."entryDate", e."entryType"::text AS "entryType", e."debit"::text AS debit, e."credit"::text AS credit, e."narration",
                   COALESCE(p."pattiNumber", pay."receiptNumber") AS ref
            FROM "FarmerLedgerEntry" e
            LEFT JOIN "Patti" p ON p."id" = e."pattiId"
            LEFT JOIN "Payment" pay ON pay."id" = e."paymentId"
            WHERE e."businessId" = ${t.businessId}::uuid AND e."farmerId" = ${partyId}::uuid
              AND (${fromDate}::date IS NULL OR e."entryDate" >= ${fromDate}::date)
              AND (${toDate}::date IS NULL OR e."entryDate" <= ${toDate}::date)
            ORDER BY e."entryDate", e."seq"`
        : await this.prisma.$queryRaw<Row[]>`
            SELECT e."id", e."entryDate", e."entryType"::text AS "entryType", e."debit"::text AS debit, e."credit"::text AS credit, e."narration",
                   COALESCE(s."saleNumber", pay."receiptNumber") AS ref
            FROM "BuyerLedgerEntry" e
            LEFT JOIN "Sale" s ON s."id" = e."saleId"
            LEFT JOIN "Payment" pay ON pay."id" = e."paymentId"
            WHERE e."businessId" = ${t.businessId}::uuid AND e."buyerId" = ${partyId}::uuid
              AND (${fromDate}::date IS NULL OR e."entryDate" >= ${fromDate}::date)
              AND (${toDate}::date IS NULL OR e."entryDate" <= ${toDate}::date)
            ORDER BY e."entryDate", e."seq"`;

    let running = opening;
    let totalDebit = new D(0);
    let totalCredit = new D(0);
    const entries = rows.map((r) => {
      const debit = new D(r.debit);
      const credit = new D(r.credit);
      totalDebit = totalDebit.plus(debit);
      totalCredit = totalCredit.plus(credit);
      running = running.plus(sign(debit, credit));
      return { id: r.id, date: r.entryDate.toISOString().slice(0, 10), type: r.entryType, ref: r.ref, narration: r.narration, debit: debit.toFixed(2), credit: credit.toFixed(2), balance: running.toFixed(2) };
    });

    return {
      side,
      party,
      from: from ?? null,
      to: to ?? null,
      openingBalance: opening.toFixed(2),
      entries,
      totals: { debit: totalDebit.toFixed(2), credit: totalCredit.toFixed(2) },
      closingBalance: running.toFixed(2),
      currentBalance: party.currentBalance.toFixed(2),
    };
  }

  async document(t: TenantContext, side: Side, partyId: string, from: string | undefined, to: string | undefined, lang: 'hi' | 'en'): Promise<{ html: (autoPrint: boolean) => string; fileName: string }> {
    const s = await this.statement(t, side, partyId, from, to);
    const p = s.party as { code: string; name?: string; nameHindi?: string | null; firmName?: string; village?: string | null; city?: string | null };
    const name = side === 'farmer' ? (lang === 'hi' && p.nameHindi ? p.nameHindi : p.name!) : p.firmName!;
    const balLabel =
      side === 'farmer'
        ? { hi: 'बकाया (+ देना / − अग्रिम)', en: 'Balance (+ payable / − advance)' }
        : { hi: 'बकाया (+ लेना)', en: 'Balance (+ receivable)' };
    const doc: TableDoc = {
      business: await businessForDocs(this.prisma, t.businessId),
      title: side === 'farmer' ? { hi: `किसान खाता — ${name}`, en: `Farmer ledger — ${name}` } : { hi: `व्यापारी खाता — ${name}`, en: `Buyer ledger — ${name}` },
      subtitle: `${p.code} · ${[p.village ?? p.city].filter(Boolean).join('')} · ${rangeLabel(s.from, s.to, lang)}`,
      columns: [
        { key: 'date', header: { hi: 'तारीख', en: 'Date' }, type: 'date' },
        { key: 'type', header: { hi: 'प्रकार', en: 'Type' }, type: 'text' },
        { key: 'ref', header: { hi: 'संदर्भ', en: 'Ref' }, type: 'text', nowrap: true },
        { key: 'narration', header: { hi: 'विवरण', en: 'Narration' }, type: 'text' },
        { key: 'debit', header: { hi: 'नामे (Dr)', en: 'Debit' }, type: 'money' },
        { key: 'credit', header: { hi: 'जमा (Cr)', en: 'Credit' }, type: 'money' },
        { key: 'balance', header: balLabel, type: 'money' },
      ],
      rows: [
        { date: s.from ?? '', type: lang === 'hi' ? 'पिछला शेष' : 'Brought forward', ref: '', narration: '', debit: null, credit: null, balance: s.openingBalance },
        // Blank instead of ₹0.00 on the unused side of each entry (one-sided by construction).
        ...s.entries.map((e) => ({
          ...e,
          type: (TYPE_LABEL[e.type] ?? { hi: e.type, en: e.type })[lang],
          debit: e.debit === '0.00' ? null : e.debit,
          credit: e.credit === '0.00' ? null : e.credit,
        })),
      ],
      totals: { date: '', type: lang === 'hi' ? 'कुल / अंतिम शेष' : 'Total / closing', ref: '', narration: '', debit: s.totals.debit, credit: s.totals.credit, balance: s.closingBalance },
      lang,
      landscape: true,
      generatedAt: `${istDateString()} IST`,
    };
    return { html: (autoPrint) => renderTableDoc(doc, { autoPrint }), fileName: `statement-${p.code}-${s.from ?? 'all'}-${s.to ?? istDateString()}.pdf` };
  }
}
