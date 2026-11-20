import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { DateRangeQuery } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import { istDateString } from './ledger.service.ts';

const D = (v: Prisma.Decimal | null | undefined) => v ?? new Prisma.Decimal(0);
const toDate = (s: string) => new Date(`${s}T00:00:00.000Z`);
const fmt = (d: Date) => d.toISOString().slice(0, 10);

/** Resolves a named range to inclusive [from, to] business dates in IST. */
export function resolveRange(q: DateRangeQuery, now = new Date()): { from: string; to: string } {
  const today = toDate(istDateString(now));
  const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
  switch (q.range) {
    case 'today':
      return { from: fmt(today), to: fmt(today) };
    case 'yesterday': {
      const y = addDays(today, -1);
      return { from: fmt(y), to: fmt(y) };
    }
    case 'week': {
      const dow = (today.getUTCDay() + 6) % 7; // Monday = 0
      return { from: fmt(addDays(today, -dow)), to: fmt(today) };
    }
    case 'month':
      return { from: fmt(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1))), to: fmt(today) };
    case 'custom': {
      const from = q.from!;
      const to = q.to!;
      if ((toDate(to).getTime() - toDate(from).getTime()) / 86_400_000 > 366) {
        throw Errors.validation([{ location: 'query', path: 'to', message: 'Range cannot exceed 366 days' }]);
      }
      return { from, to };
    }
  }
}

export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async get(t: TenantContext, q: DateRangeQuery) {
    const { from, to } = resolveRange(q);
    const range = { gte: toDate(from), lte: toDate(to) };
    const db = t.db;

    const [
      farmers,
      buyers,
      arrivals,
      purchases,
      sales,
      pattiCommission,
      saleCommission,
      expenses,
      payables,
      advances,
      receivables,
      pendingApprovals,
    ] = await Promise.all([
      db.farmer.count({ where: { deletedAt: null, isActive: true } }),
      db.buyer.count({ where: { deletedAt: null, isActive: true } }),
      db.lot.aggregate({
        where: { arrivalDate: range, status: { in: ['CONFIRMED', 'PARTIALLY_SOLD', 'SOLD'] } },
        _count: true,
        _sum: { netWeightKg: true, bags: true },
      }),
      db.purchase.aggregate({ where: { purchaseDate: range, status: 'ACTIVE' }, _count: true, _sum: { grossAmount: true, weightKg: true } }),
      db.sale.aggregate({ where: { saleDate: range, status: 'ACTIVE' }, _count: true, _sum: { grossAmount: true, weightKg: true } }),
      db.deduction.aggregate({
        where: { chargeType: 'COMMISSION', patti: { status: 'FINALIZED', pattiDate: range } },
        _sum: { amount: true },
      }),
      db.saleCharge.aggregate({
        where: { chargeType: 'COMMISSION', sale: { status: 'ACTIVE', saleDate: range } },
        _sum: { amount: true },
      }),
      db.expense.aggregate({ where: { expenseDate: range, status: 'ACTIVE' }, _count: true, _sum: { amount: true } }),
      db.farmer.aggregate({ where: { deletedAt: null, currentBalance: { gt: 0 } }, _count: true, _sum: { currentBalance: true } }),
      db.farmer.aggregate({ where: { deletedAt: null, currentBalance: { lt: 0 } }, _count: true, _sum: { currentBalance: true } }),
      db.buyer.aggregate({ where: { deletedAt: null, currentBalance: { gt: 0 } }, _count: true, _sum: { currentBalance: true } }),
      db.approvalRequest.count({ where: { status: 'PENDING' } }),
    ]);

    return {
      range: { key: q.range, from, to },
      counts: { farmers, buyers },
      arrivals: { lots: arrivals._count, netWeightKg: D(arrivals._sum.netWeightKg), bags: arrivals._sum.bags ?? 0 },
      purchases: { count: purchases._count, grossAmount: D(purchases._sum.grossAmount), weightKg: D(purchases._sum.weightKg) },
      grossSales: { count: sales._count, amount: D(sales._sum.grossAmount), weightKg: D(sales._sum.weightKg) },
      commissionIncome: D(pattiCommission._sum.amount).plus(D(saleCommission._sum.amount)),
      expenses: { count: expenses._count, amount: D(expenses._sum.amount) },
      // Point-in-time positions (not range-bound):
      payables: { farmers: payables._count, amount: D(payables._sum.currentBalance) },
      advancesOutstanding: { farmers: advances._count, amount: D(advances._sum.currentBalance).abs() },
      receivables: { buyers: receivables._count, amount: D(receivables._sum.currentBalance) },
      alerts: await this.alerts(t, pendingApprovals),
      recent: await this.recent(t),
      monthly: await this.monthly(t.businessId, to),
    };
  }

  private async alerts(t: TenantContext, pendingApprovals: number) {
    const [overLimit, topReceivables] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; code: string; firmName: string; currentBalance: string; creditLimit: string }[]>`
        SELECT "id", "code", "firmName", "currentBalance"::text, "creditLimit"::text FROM "Buyer"
        WHERE "businessId" = ${t.businessId}::uuid AND "deletedAt" IS NULL
          AND "creditLimit" IS NOT NULL AND "currentBalance" > "creditLimit"
        ORDER BY ("currentBalance" - "creditLimit") DESC LIMIT 5`,
      t.db.buyer.findMany({
        where: { deletedAt: null, currentBalance: { gt: 0 } },
        orderBy: { currentBalance: 'desc' },
        take: 5,
        select: { id: true, code: true, firmName: true, currentBalance: true },
      }),
    ]);
    const sub = t.subscription;
    const trialDaysLeft =
      sub?.status === 'TRIALING' && sub.trialEndsAt ? Math.ceil((sub.trialEndsAt.getTime() - Date.now()) / 86_400_000) : null;
    return { buyersOverCreditLimit: overLimit, topReceivables, pendingApprovals, trialDaysLeft };
  }

  private async recent(t: TenantContext) {
    const take = 8;
    const [sales, purchases, payments, expenses] = await Promise.all([
      t.db.sale.findMany({ take, orderBy: { createdAt: 'desc' }, select: { id: true, saleNumber: true, saleDate: true, grossAmount: true, status: true, createdAt: true, buyer: { select: { firmName: true } } } }),
      t.db.purchase.findMany({ take, orderBy: { createdAt: 'desc' }, select: { id: true, purchaseNumber: true, purchaseDate: true, grossAmount: true, status: true, createdAt: true, farmer: { select: { name: true } } } }),
      t.db.payment.findMany({ take, orderBy: { createdAt: 'desc' }, select: { id: true, receiptNumber: true, paymentDate: true, amount: true, direction: true, status: true, createdAt: true, farmer: { select: { name: true } }, buyer: { select: { firmName: true } } } }),
      t.db.expense.findMany({ take, orderBy: { createdAt: 'desc' }, select: { id: true, expenseNumber: true, expenseDate: true, amount: true, status: true, createdAt: true, category: { select: { name: true, nameHindi: true } } } }),
    ]);
    return [
      ...sales.map((s) => ({ type: 'SALE' as const, id: s.id, number: s.saleNumber, date: s.saleDate, amount: s.grossAmount, party: s.buyer.firmName, status: s.status, createdAt: s.createdAt })),
      ...purchases.map((p) => ({ type: 'PURCHASE' as const, id: p.id, number: p.purchaseNumber, date: p.purchaseDate, amount: p.grossAmount, party: p.farmer.name, status: p.status, createdAt: p.createdAt })),
      ...payments.map((p) => ({ type: p.direction === 'INCOMING' ? ('PAYMENT_IN' as const) : ('PAYMENT_OUT' as const), id: p.id, number: p.receiptNumber, date: p.paymentDate, amount: p.amount, party: p.farmer?.name ?? p.buyer?.firmName ?? '', status: p.status, createdAt: p.createdAt })),
      ...expenses.map((e) => ({ type: 'EXPENSE' as const, id: e.id, number: e.expenseNumber, date: e.expenseDate, amount: e.amount, party: e.category.nameHindi ?? e.category.name, status: e.status, createdAt: e.createdAt })),
    ]
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10);
  }

  /** Six calendar months ending with the month of `to`. Raw SQL: businessId is always bound explicitly. */
  private async monthly(businessId: string, to: string) {
    const rows = await this.prisma.$queryRaw<{ month: string; grossSales: string; purchases: string; commission: string; expenses: string }[]>`
      WITH months AS (
        SELECT generate_series(
          date_trunc('month', ${to}::date) - interval '5 months',
          date_trunc('month', ${to}::date),
          interval '1 month')::date AS m
      )
      SELECT to_char(m, 'YYYY-MM') AS month,
        COALESCE((SELECT SUM(s."grossAmount") FROM "Sale" s
          WHERE s."businessId" = ${businessId}::uuid AND s."status" = 'ACTIVE'
            AND s."saleDate" >= m AND s."saleDate" < (m + interval '1 month')), 0)::text AS "grossSales",
        COALESCE((SELECT SUM(p."grossAmount") FROM "Purchase" p
          WHERE p."businessId" = ${businessId}::uuid AND p."status" = 'ACTIVE'
            AND p."purchaseDate" >= m AND p."purchaseDate" < (m + interval '1 month')), 0)::text AS "purchases",
        (COALESCE((SELECT SUM(d."amount") FROM "Deduction" d JOIN "Patti" pt ON pt."id" = d."pattiId"
          WHERE d."businessId" = ${businessId}::uuid AND d."chargeType" = 'COMMISSION' AND pt."status" = 'FINALIZED'
            AND pt."pattiDate" >= m AND pt."pattiDate" < (m + interval '1 month')), 0)
        + COALESCE((SELECT SUM(c."amount") FROM "SaleCharge" c JOIN "Sale" s2 ON s2."id" = c."saleId"
          WHERE c."businessId" = ${businessId}::uuid AND c."chargeType" = 'COMMISSION' AND s2."status" = 'ACTIVE'
            AND s2."saleDate" >= m AND s2."saleDate" < (m + interval '1 month')), 0))::text AS "commission",
        COALESCE((SELECT SUM(e."amount") FROM "Expense" e
          WHERE e."businessId" = ${businessId}::uuid AND e."status" = 'ACTIVE'
            AND e."expenseDate" >= m AND e."expenseDate" < (m + interval '1 month')), 0)::text AS "expenses"
      FROM months ORDER BY m`;
    return rows;
  }
}
