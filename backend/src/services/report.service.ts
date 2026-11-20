import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { ReportKey } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { businessForDocs, rangeLabel } from './documents/business.ts';
import { renderTableDoc, type TableColumn, type TableDoc, type TableRow } from './documents/templates.ts';
import { istDateString } from './ledger.service.ts';
import { buildXlsx } from '../utils/xlsx.ts';

const D = Prisma.Decimal;
type Dec = Prisma.Decimal;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const s2 = (v: Dec | null | undefined) => (v ?? new D(0)).toFixed(2);
const s3 = (v: Dec | null | undefined) => (v ?? new D(0)).toFixed(3);
const H = (hi: string, en: string) => ({ hi, en });

export interface ReportResult {
  key: ReportKey;
  title: { hi: string; en: string };
  from: string | null;
  to: string | null;
  columns: TableColumn[];
  rows: TableRow[];
  totals?: TableRow;
  breakdown?: TableDoc['breakdown'];
  notes?: { hi: string; en: string }[];
  landscape?: boolean;
}

/**
 * All reports return the same tabular shape so one renderer serves JSON, print/PDF and Excel.
 * Money values are 2-dp strings computed with Decimal in SQL/TS — the client never sums anything.
 * Terminology: gross sales are the value of goods sold for farmers — NOT the commission agent's income.
 */
export class ReportService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Default range: current month to date (IST). Point-in-time reports ignore it. */
  private range(from?: string, to?: string) {
    const today = istDateString();
    const f = from ?? `${today.slice(0, 8)}01`;
    const t = to ?? today;
    return { from: f, to: t, gte: day(f), lte: day(t) };
  }

  async run(t: TenantContext, key: ReportKey, from?: string, to?: string): Promise<ReportResult> {
    switch (key) {
      case 'daily-arrivals':
        return this.arrivals(t, this.range(from, to));
      case 'purchases':
        return this.purchases(t, this.range(from, to));
      case 'sales':
        return this.sales(t, this.range(from, to));
      case 'farmer-outstanding':
        return this.farmerOutstanding(t);
      case 'buyer-outstanding':
        return this.buyerOutstanding(t);
      case 'commission':
        return this.commission(t, this.range(from, to));
      case 'expenses':
        return this.expenses(t, this.range(from, to));
      case 'stock':
        return this.stock(t);
      case 'monthly-summary':
        return this.summary(t, this.range(from, to));
      case 'commodity-wise':
        return this.commodityWise(t, this.range(from, to));
    }
  }

  // ---------------------------------------------------------------- range reports

  private async arrivals(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const lots = await t.db.lot.findMany({
      where: { arrivalDate: { gte: r.gte, lte: r.lte }, status: { notIn: ['DRAFT', 'CANCELLED'] } },
      include: { farmer: { select: { code: true, name: true, village: true } }, commodity: { select: { name: true, nameHindi: true } }, grade: { select: { name: true } } },
      orderBy: [{ arrivalDate: 'asc' }, { lotNumber: 'asc' }],
    });
    const sum = (f: (l: (typeof lots)[number]) => Dec) => lots.reduce((a, l) => a.plus(f(l)), new D(0));
    return {
      key: 'daily-arrivals',
      title: H('दैनिक आवक रिपोर्ट', 'Daily arrival report'),
      from: r.from,
      to: r.to,
      landscape: true,
      columns: [
        { key: 'date', header: H('तारीख', 'Date'), type: 'date' },
        { key: 'lot', header: H('लॉट', 'Lot'), type: 'text', nowrap: true },
        { key: 'farmer', header: H('किसान', 'Farmer'), type: 'text' },
        { key: 'village', header: H('गाँव', 'Village'), type: 'text' },
        { key: 'commodity', header: H('फसल', 'Commodity'), type: 'text' },
        { key: 'vehicle', header: H('गाड़ी', 'Vehicle'), type: 'text' },
        { key: 'bags', header: H('बोरी', 'Bags'), type: 'int' },
        { key: 'netKg', header: H('शुद्ध वजन (kg)', 'Net (kg)'), type: 'weight' },
        { key: 'soldKg', header: H('बिका (kg)', 'Sold (kg)'), type: 'weight' },
      ],
      rows: lots.map((l) => ({
        date: ymd(l.arrivalDate),
        lot: l.lotNumber,
        farmer: `${l.farmer.name} (${l.farmer.code})`,
        village: l.farmer.village,
        commodity: `${l.commodity.nameHindi ?? l.commodity.name}${l.grade ? ` · ${l.grade.name}` : ''}`,
        vehicle: l.vehicleNumber,
        bags: l.bags,
        netKg: s3(l.netWeightKg),
        soldKg: s3(l.soldWeightKg),
      })),
      totals: { date: `${lots.length} lots`, bags: lots.reduce((a, l) => a + l.bags, 0), netKg: s3(sum((l) => l.netWeightKg)), soldKg: s3(sum((l) => l.soldWeightKg)) },
    };
  }

  private async purchases(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const rows = await t.db.purchase.findMany({
      where: { purchaseDate: { gte: r.gte, lte: r.lte }, status: 'ACTIVE' },
      include: { farmer: { select: { code: true, name: true } }, lot: { select: { lotNumber: true } }, commodity: { select: { name: true, nameHindi: true } }, patti: { select: { pattiNumber: true } } },
      orderBy: [{ purchaseDate: 'asc' }, { purchaseNumber: 'asc' }],
    });
    return {
      key: 'purchases',
      title: H('खरीद रिपोर्ट', 'Purchase report'),
      from: r.from,
      to: r.to,
      landscape: true,
      columns: [
        { key: 'date', header: H('तारीख', 'Date'), type: 'date' },
        { key: 'number', header: H('खरीद नं.', 'Purchase no.'), type: 'text', nowrap: true },
        { key: 'farmer', header: H('किसान', 'Farmer'), type: 'text' },
        { key: 'lot', header: H('लॉट', 'Lot'), type: 'text', nowrap: true },
        { key: 'commodity', header: H('फसल', 'Commodity'), type: 'text' },
        { key: 'weightKg', header: H('वजन (kg)', 'Weight (kg)'), type: 'weight' },
        { key: 'rate', header: H('भाव', 'Rate'), type: 'money' },
        { key: 'unit', header: H('प्रति', 'Per'), type: 'text' },
        { key: 'amount', header: H('राशि', 'Amount'), type: 'money' },
        { key: 'patti', header: H('पट्टी', 'Patti'), type: 'text' },
      ],
      rows: rows.map((p) => ({
        date: ymd(p.purchaseDate),
        number: p.purchaseNumber,
        farmer: `${p.farmer.name} (${p.farmer.code})`,
        lot: p.lot.lotNumber,
        commodity: p.commodity.nameHindi ?? p.commodity.name,
        weightKg: s3(p.weightKg),
        rate: s2(p.rate),
        unit: p.rateUnit,
        amount: s2(p.grossAmount),
        patti: p.patti?.pattiNumber ?? '—',
      })),
      totals: { date: `${rows.length}`, weightKg: s3(rows.reduce((a, p) => a.plus(p.weightKg), new D(0))), amount: s2(rows.reduce((a, p) => a.plus(p.grossAmount), new D(0))) },
    };
  }

  private async sales(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const rows = await t.db.sale.findMany({
      where: { saleDate: { gte: r.gte, lte: r.lte }, status: 'ACTIVE' },
      include: { buyer: { select: { code: true, firmName: true } }, lot: { select: { lotNumber: true, farmer: { select: { name: true } } } }, commodity: { select: { name: true, nameHindi: true } } },
      orderBy: [{ saleDate: 'asc' }, { saleNumber: 'asc' }],
    });
    const sum = (f: (s: (typeof rows)[number]) => Dec) => s2(rows.reduce((a, s) => a.plus(f(s)), new D(0)));
    return {
      key: 'sales',
      title: H('बिक्री रिपोर्ट', 'Sale report'),
      from: r.from,
      to: r.to,
      landscape: true,
      columns: [
        { key: 'date', header: H('तारीख', 'Date'), type: 'date' },
        { key: 'number', header: H('बिल नं.', 'Bill no.'), type: 'text', nowrap: true },
        { key: 'buyer', header: H('व्यापारी', 'Buyer'), type: 'text' },
        { key: 'farmer', header: H('किसान / लॉट', 'Farmer / lot'), type: 'text' },
        { key: 'commodity', header: H('फसल', 'Commodity'), type: 'text' },
        { key: 'weightKg', header: H('वजन (kg)', 'Weight (kg)'), type: 'weight' },
        { key: 'rate', header: H('भाव', 'Rate'), type: 'money' },
        { key: 'gross', header: H('सकल', 'Gross'), type: 'money' },
        { key: 'charges', header: H('शुल्क', 'Charges'), type: 'money' },
        { key: 'total', header: H('कुल', 'Total'), type: 'money' },
      ],
      rows: rows.map((s) => ({
        date: ymd(s.saleDate),
        number: s.saleNumber,
        buyer: s.buyer.firmName,
        farmer: `${s.lot.farmer.name} · ${s.lot.lotNumber}`,
        commodity: s.commodity.nameHindi ?? s.commodity.name,
        weightKg: s3(s.weightKg),
        rate: s2(s.rate),
        gross: s2(s.grossAmount),
        charges: s2(s.chargesTotal),
        total: s2(s.totalAmount),
      })),
      totals: { date: `${rows.length}`, weightKg: s3(rows.reduce((a, s) => a.plus(s.weightKg), new D(0))), gross: sum((s) => s.grossAmount), charges: sum((s) => s.chargesTotal), total: sum((s) => s.totalAmount) },
      notes: [H('सकल बिक्री किसानों के माल का मूल्य है, आढ़ती का मुनाफ़ा नहीं।', 'Gross sales are the value of farmers’ produce, not the commission agent’s profit.')],
    };
  }

  /** Commission income per day: farmer-side COMMISSION deductions on finalized pattis + buyer-side COMMISSION charges. */
  private async commission(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<{ d: Date; pattis: number; pattiGross: string; farmerSide: string; buyerSide: string }[]>`
      WITH days AS (
        SELECT p."pattiDate" AS d FROM "Patti" p WHERE p."businessId" = ${t.businessId}::uuid AND p."status" = 'FINALIZED' AND p."pattiDate" BETWEEN ${r.gte}::date AND ${r.lte}::date
        UNION
        SELECT s."saleDate" FROM "Sale" s WHERE s."businessId" = ${t.businessId}::uuid AND s."status" = 'ACTIVE' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date
      )
      SELECT days.d,
        (SELECT COUNT(*)::int FROM "Patti" p WHERE p."businessId" = ${t.businessId}::uuid AND p."status" = 'FINALIZED' AND p."pattiDate" = days.d) AS pattis,
        (SELECT COALESCE(SUM(p."grossAmount"),0)::text FROM "Patti" p WHERE p."businessId" = ${t.businessId}::uuid AND p."status" = 'FINALIZED' AND p."pattiDate" = days.d) AS "pattiGross",
        (SELECT COALESCE(SUM(x."amount"),0)::text FROM "Deduction" x JOIN "Patti" p ON p."id" = x."pattiId"
          WHERE x."businessId" = ${t.businessId}::uuid AND x."chargeType" = 'COMMISSION' AND p."status" = 'FINALIZED' AND p."pattiDate" = days.d) AS "farmerSide",
        (SELECT COALESCE(SUM(c."amount"),0)::text FROM "SaleCharge" c JOIN "Sale" s ON s."id" = c."saleId"
          WHERE c."businessId" = ${t.businessId}::uuid AND c."chargeType" = 'COMMISSION' AND s."status" = 'ACTIVE' AND s."saleDate" = days.d) AS "buyerSide"
      FROM days ORDER BY days.d`;
    let gross = new D(0), fs = new D(0), bs = new D(0), n = 0;
    const out = rows.map((x) => {
      gross = gross.plus(x.pattiGross);
      fs = fs.plus(x.farmerSide);
      bs = bs.plus(x.buyerSide);
      n += x.pattis;
      return { date: ymd(x.d), pattis: x.pattis, pattiGross: new D(x.pattiGross).toFixed(2), farmerSide: new D(x.farmerSide).toFixed(2), buyerSide: new D(x.buyerSide).toFixed(2), total: new D(x.farmerSide).plus(x.buyerSide).toFixed(2) };
    });
    return {
      key: 'commission',
      title: H('कमीशन आय रिपोर्ट', 'Commission income report'),
      from: r.from,
      to: r.to,
      columns: [
        { key: 'date', header: H('तारीख', 'Date'), type: 'date' },
        { key: 'pattis', header: H('पट्टियाँ', 'Pattis'), type: 'int' },
        { key: 'pattiGross', header: H('पट्टी सकल', 'Patti gross'), type: 'money' },
        { key: 'farmerSide', header: H('किसान से कमीशन', 'From farmers'), type: 'money' },
        { key: 'buyerSide', header: H('व्यापारी से कमीशन', 'From buyers'), type: 'money' },
        { key: 'total', header: H('कुल कमीशन', 'Total commission'), type: 'money' },
      ],
      rows: out,
      totals: { date: '', pattis: n, pattiGross: s2(gross), farmerSide: s2(fs), buyerSide: s2(bs), total: s2(fs.plus(bs)) },
      notes: [H('केवल "कमीशन" प्रकार की कटौती/शुल्क। मजदूरी, तुलाई, मंडी शुल्क शामिल नहीं।', 'Only COMMISSION-type deductions/charges. Labour, weighing and market fees are excluded.')],
    };
  }

  private async expenses(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const rows = await t.db.expense.findMany({
      where: { expenseDate: { gte: r.gte, lte: r.lte }, status: 'ACTIVE' },
      include: { category: { select: { name: true, nameHindi: true } } },
      orderBy: [{ expenseDate: 'asc' }, { expenseNumber: 'asc' }],
    });
    const byCat = new Map<string, Dec>();
    for (const e of rows) {
      const k = e.category.nameHindi ? `${e.category.nameHindi} / ${e.category.name}` : e.category.name;
      byCat.set(k, (byCat.get(k) ?? new D(0)).plus(e.amount));
    }
    return {
      key: 'expenses',
      title: H('खर्च रिपोर्ट', 'Expense report'),
      from: r.from,
      to: r.to,
      columns: [
        { key: 'date', header: H('तारीख', 'Date'), type: 'date' },
        { key: 'number', header: H('नं.', 'No.'), type: 'text', nowrap: true },
        { key: 'category', header: H('श्रेणी', 'Category'), type: 'text' },
        { key: 'payee', header: H('किसको', 'Payee'), type: 'text' },
        { key: 'mode', header: H('माध्यम', 'Mode'), type: 'text' },
        { key: 'remarks', header: H('टिप्पणी', 'Remarks'), type: 'text' },
        { key: 'amount', header: H('राशि', 'Amount'), type: 'money' },
      ],
      rows: rows.map((e) => ({ date: ymd(e.expenseDate), number: e.expenseNumber, category: e.category.nameHindi ?? e.category.name, payee: e.payee, mode: e.mode, remarks: e.remarks, amount: s2(e.amount) })),
      totals: { date: `${rows.length}`, amount: s2(rows.reduce((a, e) => a.plus(e.amount), new D(0))) },
      breakdown: { title: H('श्रेणी अनुसार', 'By category'), rows: [...byCat.entries()].sort((a, b) => b[1].comparedTo(a[1])).map(([label, v]) => ({ label, value: v.toFixed(2) })) },
    };
  }

  /** One-page business summary. Every line is a separate concept; nothing is called profit. */
  private async summary(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const b = t.businessId;
    const [x] = await this.prisma.$queryRaw<Record<string, string>[]>`
      SELECT
        (SELECT COALESCE(SUM("grossAmount"),0) FROM "Sale" WHERE "businessId"=${b}::uuid AND "status"='ACTIVE' AND "saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "grossSales",
        (SELECT COALESCE(SUM("grossAmount"),0) FROM "Purchase" WHERE "businessId"=${b}::uuid AND "status"='ACTIVE' AND "purchaseDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "purchases",
        (SELECT COALESCE(SUM(d."amount"),0) FROM "Deduction" d JOIN "Patti" p ON p."id"=d."pattiId" WHERE d."businessId"=${b}::uuid AND p."status"='FINALIZED' AND d."chargeType"='COMMISSION' AND p."pattiDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "commFarmer",
        (SELECT COALESCE(SUM(c."amount"),0) FROM "SaleCharge" c JOIN "Sale" s ON s."id"=c."saleId" WHERE c."businessId"=${b}::uuid AND s."status"='ACTIVE' AND c."chargeType"='COMMISSION' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "commBuyer",
        (SELECT COALESCE(SUM(d."amount"),0) FROM "Deduction" d JOIN "Patti" p ON p."id"=d."pattiId" WHERE d."businessId"=${b}::uuid AND p."status"='FINALIZED' AND d."chargeType"<>'COMMISSION' AND p."pattiDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "otherFarmer",
        (SELECT COALESCE(SUM(c."amount"),0) FROM "SaleCharge" c JOIN "Sale" s ON s."id"=c."saleId" WHERE c."businessId"=${b}::uuid AND s."status"='ACTIVE' AND c."chargeType"<>'COMMISSION' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "otherBuyer",
        (SELECT COALESCE(SUM("amount"),0) FROM "Expense" WHERE "businessId"=${b}::uuid AND "status"='ACTIVE' AND "expenseDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "expenses",
        (SELECT COALESCE(SUM("amount"),0) FROM "Payment" WHERE "businessId"=${b}::uuid AND "status"='ACTIVE' AND "direction"='OUTGOING' AND "paymentDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "paidOut",
        (SELECT COALESCE(SUM("amount"),0) FROM "Payment" WHERE "businessId"=${b}::uuid AND "status"='ACTIVE' AND "direction"='INCOMING' AND "paymentDate" BETWEEN ${r.gte}::date AND ${r.lte}::date)::text AS "received",
        (SELECT COALESCE(SUM("currentBalance"),0) FROM "Buyer" WHERE "businessId"=${b}::uuid AND "deletedAt" IS NULL AND "currentBalance" > 0)::text AS "receivables",
        (SELECT COALESCE(SUM("currentBalance"),0) FROM "Farmer" WHERE "businessId"=${b}::uuid AND "deletedAt" IS NULL AND "currentBalance" > 0)::text AS "payables",
        (SELECT COALESCE(-SUM("currentBalance"),0) FROM "Farmer" WHERE "businessId"=${b}::uuid AND "deletedAt" IS NULL AND "currentBalance" < 0)::text AS "advances"`;
    const v = (k: string) => new D(x![k] ?? '0');
    const commission = v('commFarmer').plus(v('commBuyer'));
    const line = (hi: string, en: string, value: Dec, group: string) => ({ group, metric: `${hi} / ${en}`, amount: value.toFixed(2) });
    return {
      key: 'monthly-summary',
      title: H('व्यापार सारांश', 'Business summary'),
      from: r.from,
      to: r.to,
      columns: [
        { key: 'group', header: H('भाग', 'Section'), type: 'text' },
        { key: 'metric', header: H('विवरण', 'Item'), type: 'text' },
        { key: 'amount', header: H('राशि', 'Amount'), type: 'money' },
      ],
      rows: [
        line('सकल बिक्री (किसानों का माल)', 'Gross sales (farmers’ produce)', v('grossSales'), 'Trade'),
        line('किसानों से खरीद', 'Purchases from farmers', v('purchases'), 'Trade'),
        line('कमीशन आय — किसान', 'Commission income — farmers', v('commFarmer'), 'Income'),
        line('कमीशन आय — व्यापारी', 'Commission income — buyers', v('commBuyer'), 'Income'),
        line('कुल कमीशन आय', 'Total commission income', commission, 'Income'),
        line('खर्च', 'Business expenses', v('expenses'), 'Income'),
        line('कमीशन आय − खर्च', 'Commission income − expenses', commission.minus(v('expenses')), 'Income'),
        line('किसानों से अन्य कटौती (मजदूरी आदि)', 'Other farmer deductions (labour etc.)', v('otherFarmer'), 'Pass-through'),
        line('व्यापारियों से अन्य शुल्क (मंडी शुल्क आदि)', 'Other buyer charges (market fee etc.)', v('otherBuyer'), 'Pass-through'),
        line('किसानों को भुगतान', 'Paid to farmers', v('paidOut'), 'Cash'),
        line('व्यापारियों से वसूली', 'Collected from buyers', v('received'), 'Cash'),
        line('आज तक व्यापारियों से लेना', 'Receivable from buyers (now)', v('receivables'), 'Position'),
        line('आज तक किसानों को देना', 'Payable to farmers (now)', v('payables'), 'Position'),
        line('किसानों पर अग्रिम', 'Advances with farmers (now)', v('advances'), 'Position'),
      ],
      notes: [
        H('सकल बिक्री मुनाफ़ा नहीं है। मजदूरी/मंडी शुल्क जैसी कटौतियाँ आगे चुकाई जाती हैं।', 'Gross sales are not profit. Labour / market-fee lines are usually passed on to others.'),
        H('"कमीशन आय − खर्च" में ब्याज, कर आदि शामिल नहीं हैं।', '"Commission income − expenses" excludes interest, taxes and other items.'),
      ],
    };
  }

  private async commodityWise(t: TenantContext, r: ReturnType<ReportService['range']>): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<{ name: string; nameHindi: string | null; lots: number; arrivedKg: string; soldKg: string; gross: string; charges: string }[]>`
      SELECT c."name", c."nameHindi",
        (SELECT COUNT(*)::int FROM "Lot" l WHERE l."businessId"=${t.businessId}::uuid AND l."commodityId"=c."id" AND l."status" NOT IN ('DRAFT','CANCELLED') AND l."arrivalDate" BETWEEN ${r.gte}::date AND ${r.lte}::date) AS lots,
        (SELECT COALESCE(SUM(l."netWeightKg"),0)::text FROM "Lot" l WHERE l."businessId"=${t.businessId}::uuid AND l."commodityId"=c."id" AND l."status" NOT IN ('DRAFT','CANCELLED') AND l."arrivalDate" BETWEEN ${r.gte}::date AND ${r.lte}::date) AS "arrivedKg",
        (SELECT COALESCE(SUM(s."weightKg"),0)::text FROM "Sale" s WHERE s."businessId"=${t.businessId}::uuid AND s."commodityId"=c."id" AND s."status"='ACTIVE' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date) AS "soldKg",
        (SELECT COALESCE(SUM(s."grossAmount"),0)::text FROM "Sale" s WHERE s."businessId"=${t.businessId}::uuid AND s."commodityId"=c."id" AND s."status"='ACTIVE' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date) AS gross,
        (SELECT COALESCE(SUM(s."chargesTotal"),0)::text FROM "Sale" s WHERE s."businessId"=${t.businessId}::uuid AND s."commodityId"=c."id" AND s."status"='ACTIVE' AND s."saleDate" BETWEEN ${r.gte}::date AND ${r.lte}::date) AS charges
      FROM "Commodity" c WHERE c."businessId" = ${t.businessId}::uuid ORDER BY c."sortOrder", c."name"`;
    const used = rows.filter((x) => x.lots > 0 || !new D(x.soldKg).isZero());
    let tArr = new D(0), tSold = new D(0), tGross = new D(0);
    const out = used.map((x) => {
      const sold = new D(x.soldKg);
      const gross = new D(x.gross);
      tArr = tArr.plus(x.arrivedKg);
      tSold = tSold.plus(sold);
      tGross = tGross.plus(gross);
      // Weighted average rate per quintal = gross ÷ (sold kg ÷ 100). Display figure only.
      const avg = sold.isZero() ? null : gross.div(sold.div(100)).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
      return { commodity: x.nameHindi ? `${x.nameHindi} / ${x.name}` : x.name, lots: x.lots, arrivedKg: new D(x.arrivedKg).toFixed(3), soldKg: sold.toFixed(3), gross: gross.toFixed(2), avgRate: avg, charges: new D(x.charges).toFixed(2) };
    });
    return {
      key: 'commodity-wise',
      title: H('फसल अनुसार व्यापार', 'Commodity-wise business'),
      from: r.from,
      to: r.to,
      columns: [
        { key: 'commodity', header: H('फसल', 'Commodity'), type: 'text' },
        { key: 'lots', header: H('लॉट', 'Lots'), type: 'int' },
        { key: 'arrivedKg', header: H('आवक (kg)', 'Arrived (kg)'), type: 'weight' },
        { key: 'soldKg', header: H('बिका (kg)', 'Sold (kg)'), type: 'weight' },
        { key: 'gross', header: H('सकल बिक्री', 'Gross sales'), type: 'money' },
        { key: 'avgRate', header: H('औसत भाव/क्विं.', 'Avg rate/qtl'), type: 'money' },
        { key: 'charges', header: H('व्यापारी शुल्क', 'Buyer charges'), type: 'money' },
      ],
      rows: out,
      totals: { commodity: '', lots: out.reduce((a, x) => a + x.lots, 0), arrivedKg: tArr.toFixed(3), soldKg: tSold.toFixed(3), gross: tGross.toFixed(2) },
    };
  }

  // ---------------------------------------------------------------- point-in-time reports

  private async farmerOutstanding(t: TenantContext): Promise<ReportResult> {
    const rows = await this.prisma.$queryRaw<{ code: string; name: string; father: string | null; village: string | null; mobile: string | null; balance: string; unbilled: string }[]>`
      SELECT f."code", f."name", f."fatherName" AS father, f."village", f."mobile", f."currentBalance"::text AS balance,
        COALESCE((SELECT SUM(p."grossAmount") FROM "Purchase" p WHERE p."farmerId" = f."id" AND p."status"='ACTIVE' AND p."pattiId" IS NULL), 0)::text AS unbilled
      FROM "Farmer" f
      WHERE f."businessId" = ${t.businessId}::uuid AND f."deletedAt" IS NULL
        AND (f."currentBalance" <> 0 OR EXISTS (SELECT 1 FROM "Purchase" p WHERE p."farmerId" = f."id" AND p."status"='ACTIVE' AND p."pattiId" IS NULL))
      ORDER BY f."currentBalance" DESC, f."name"`;
    let pay = new D(0), adv = new D(0), unb = new D(0);
    const out = rows.map((x) => {
      const b = new D(x.balance);
      if (b.isPositive() && !b.isZero()) pay = pay.plus(b);
      if (b.isNegative()) adv = adv.plus(b.abs());
      unb = unb.plus(x.unbilled);
      return { code: x.code, name: x.name, father: x.father, village: x.village, mobile: x.mobile?.replace(/^\+91/, '') ?? null, payable: b.isPositive() && !b.isZero() ? b.toFixed(2) : null, advance: b.isNegative() ? b.abs().toFixed(2) : null, unbilled: new D(x.unbilled).isZero() ? null : new D(x.unbilled).toFixed(2) };
    });
    return {
      key: 'farmer-outstanding',
      title: H('किसान बकाया रिपोर्ट', 'Farmer outstanding report'),
      from: null,
      to: istDateString(),
      landscape: true,
      columns: [
        { key: 'code', header: H('कोड', 'Code'), type: 'text' },
        { key: 'name', header: H('किसान', 'Farmer'), type: 'text' },
        { key: 'father', header: H('पिता', 'Father'), type: 'text' },
        { key: 'village', header: H('गाँव', 'Village'), type: 'text' },
        { key: 'mobile', header: H('मोबाइल', 'Mobile'), type: 'text' },
        { key: 'payable', header: H('देना है', 'Payable'), type: 'money' },
        { key: 'advance', header: H('अग्रिम (लेना)', 'Advance (due from)'), type: 'money' },
        { key: 'unbilled', header: H('बिना पट्टी खरीद', 'Unbilled purchases'), type: 'money' },
      ],
      rows: out,
      totals: { code: `${out.length}`, payable: s2(pay), advance: s2(adv), unbilled: s2(unb) },
      notes: [H('"बिना पट्टी खरीद" अभी खाते में जमा नहीं है — पट्टी बनने पर जुड़ेगी।', '"Unbilled purchases" are not yet on the ledger — they are credited when the patti is finalized.')],
    };
  }

  /**
   * Buyer outstanding with ageing. Credits settle the OLDEST debits first (FIFO), so the outstanding
   * balance is attributed to the most recent debits. Reversed debits and their reversals are excluded.
   */
  private async buyerOutstanding(t: TenantContext): Promise<ReportResult> {
    const buyers = await t.db.buyer.findMany({
      where: { deletedAt: null, currentBalance: { gt: 0 } },
      select: { id: true, code: true, firmName: true, city: true, mobile: true, currentBalance: true, creditLimit: true },
      orderBy: { currentBalance: 'desc' },
    });
    const debits = buyers.length
      ? await t.db.buyerLedgerEntry.findMany({
          where: { buyerId: { in: buyers.map((b) => b.id) }, debit: { gt: 0 }, entryType: { in: ['SALE_DEBIT', 'OPENING_BALANCE', 'ADJUSTMENT'] }, reversedBy: null },
          select: { buyerId: true, entryDate: true, debit: true, seq: true },
          orderBy: [{ entryDate: 'desc' }, { seq: 'desc' }],
        })
      : [];
    const lastPay = buyers.length
      ? await t.db.payment.groupBy({ by: ['buyerId'], where: { buyerId: { in: buyers.map((b) => b.id) }, status: 'ACTIVE' }, _max: { paymentDate: true } })
      : [];
    const lastPayMap = new Map(lastPay.map((p) => [p.buyerId, p._max.paymentDate]));
    const today = day(istDateString()).getTime();
    const buckets = ['b0', 'b31', 'b61', 'b91'] as const;
    const totals: Record<string, Dec> = { outstanding: new D(0), b0: new D(0), b31: new D(0), b61: new D(0), b91: new D(0) };

    const out = buyers.map((b) => {
      let remaining = b.currentBalance;
      const agg: Record<string, Dec> = { b0: new D(0), b31: new D(0), b61: new D(0), b91: new D(0) };
      for (const d of debits) {
        if (d.buyerId !== b.id || remaining.lte(0)) continue;
        const take = D.min(remaining, d.debit);
        const age = Math.floor((today - d.entryDate.getTime()) / 86_400_000);
        const k = age <= 30 ? 'b0' : age <= 60 ? 'b31' : age <= 90 ? 'b61' : 'b91';
        agg[k] = agg[k]!.plus(take);
        remaining = remaining.minus(take);
      }
      if (remaining.gt(0)) agg.b91 = agg.b91!.plus(remaining); // unattributed (e.g. pre-system balance)
      totals.outstanding = totals.outstanding!.plus(b.currentBalance);
      for (const k of buckets) totals[k] = totals[k]!.plus(agg[k]!);
      const lp = lastPayMap.get(b.id);
      return {
        code: b.code,
        firm: b.firmName,
        city: b.city,
        mobile: b.mobile?.replace(/^\+91/, '') ?? null,
        limit: b.creditLimit ? b.creditLimit.toFixed(2) : null,
        outstanding: b.currentBalance.toFixed(2),
        b0: agg.b0!.toFixed(2),
        b31: agg.b31!.toFixed(2),
        b61: agg.b61!.toFixed(2),
        b91: agg.b91!.toFixed(2),
        lastPayment: lp ? ymd(lp) : '—',
      };
    });
    return {
      key: 'buyer-outstanding',
      title: H('व्यापारी बकाया (आयु अनुसार)', 'Buyer outstanding (ageing)'),
      from: null,
      to: istDateString(),
      landscape: true,
      columns: [
        { key: 'code', header: H('कोड', 'Code'), type: 'text' },
        { key: 'firm', header: H('फर्म', 'Firm'), type: 'text' },
        { key: 'city', header: H('शहर', 'City'), type: 'text' },
        { key: 'limit', header: H('उधार सीमा', 'Credit limit'), type: 'money' },
        { key: 'outstanding', header: H('कुल बकाया', 'Outstanding'), type: 'money' },
        { key: 'b0', header: H('0–30 दिन', '0–30 days'), type: 'money' },
        { key: 'b31', header: H('31–60', '31–60'), type: 'money' },
        { key: 'b61', header: H('61–90', '61–90'), type: 'money' },
        { key: 'b91', header: H('90+', '90+'), type: 'money' },
        { key: 'lastPayment', header: H('पिछला भुगतान', 'Last payment'), type: 'date' },
      ],
      rows: out,
      totals: { code: `${out.length}`, outstanding: s2(totals.outstanding), b0: s2(totals.b0), b31: s2(totals.b31), b61: s2(totals.b61), b91: s2(totals.b91) },
      notes: [H('भुगतान सबसे पुरानी बिक्री में पहले समायोजित माने गए हैं (FIFO)।', 'Payments are applied to the oldest sales first (FIFO).')],
    };
  }

  private async stock(t: TenantContext): Promise<ReportResult> {
    const lots = await t.db.lot.findMany({
      where: { status: { in: ['CONFIRMED', 'PARTIALLY_SOLD'] } },
      include: { farmer: { select: { name: true, code: true } }, commodity: { select: { name: true, nameHindi: true } } },
      orderBy: [{ arrivalDate: 'asc' }],
    });
    const today = day(istDateString()).getTime();
    const byCom = new Map<string, Dec>();
    const out = lots.map((l) => {
      const unsold = l.netWeightKg.minus(l.soldWeightKg);
      const k = l.commodity.nameHindi ?? l.commodity.name;
      byCom.set(k, (byCom.get(k) ?? new D(0)).plus(unsold));
      return {
        lot: l.lotNumber,
        date: ymd(l.arrivalDate),
        days: Math.floor((today - l.arrivalDate.getTime()) / 86_400_000),
        farmer: `${l.farmer.name} (${l.farmer.code})`,
        commodity: k,
        netKg: s3(l.netWeightKg),
        soldKg: s3(l.soldWeightKg),
        unsoldKg: s3(unsold),
      };
    });
    return {
      key: 'stock',
      title: H('बिना बिका माल (स्टॉक)', 'Unsold stock'),
      from: null,
      to: istDateString(),
      columns: [
        { key: 'lot', header: H('लॉट', 'Lot'), type: 'text', nowrap: true },
        { key: 'date', header: H('आवक', 'Arrived'), type: 'date' },
        { key: 'days', header: H('दिन', 'Days'), type: 'int' },
        { key: 'farmer', header: H('किसान', 'Farmer'), type: 'text' },
        { key: 'commodity', header: H('फसल', 'Commodity'), type: 'text' },
        { key: 'netKg', header: H('शुद्ध (kg)', 'Net (kg)'), type: 'weight' },
        { key: 'soldKg', header: H('बिका (kg)', 'Sold (kg)'), type: 'weight' },
        { key: 'unsoldKg', header: H('बचा (kg)', 'Unsold (kg)'), type: 'weight' },
      ],
      rows: out,
      totals: { lot: `${out.length}`, unsoldKg: s3(lots.reduce((a, l) => a.plus(l.netWeightKg.minus(l.soldWeightKg)), new D(0))) },
      breakdown: undefined,
      notes: [...byCom.entries()].map(([k, v]) => ({ hi: `${k}: ${v.div(100).toFixed(2)} क्विं.`, en: `${k}: ${v.div(100).toFixed(2)} qtl` })),
    };
  }

  // ---------------------------------------------------------------- rendering

  async toDoc(t: TenantContext, r: ReportResult, lang: 'hi' | 'en'): Promise<TableDoc> {
    return {
      business: await businessForDocs(this.prisma, t.businessId),
      title: r.title,
      subtitle: r.from || r.to ? (r.from ? rangeLabel(r.from, r.to, lang) : `${lang === 'hi' ? 'आज तक' : 'As of'} ${r.to!.split('-').reverse().join('/')}`) : '',
      columns: r.columns,
      rows: r.rows,
      totals: r.totals,
      breakdown: r.breakdown,
      notes: r.notes,
      lang,
      landscape: r.landscape,
      generatedAt: `${istDateString()} IST`,
    };
  }

  html(doc: TableDoc, autoPrint: boolean) {
    return renderTableDoc(doc, { autoPrint });
  }

  xlsx(doc: TableDoc): Buffer {
    const L = (x: { hi: string; en: string }) => (doc.lang === 'hi' ? `${x.hi} / ${x.en}` : x.en);
    return buildXlsx({
      name: doc.title.en,
      title: `${doc.business.name} — ${L(doc.title)}`,
      subtitle: doc.subtitle,
      columns: doc.columns.map((c) => ({ header: L(c.header), type: c.type })),
      rows: doc.rows.map((r) => doc.columns.map((c) => r[c.key] ?? null)),
      totals: doc.totals ? doc.columns.map((c) => doc.totals![c.key] ?? null) : undefined,
    });
  }
}
