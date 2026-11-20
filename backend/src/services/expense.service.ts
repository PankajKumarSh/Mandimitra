import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { CreateExpenseInput, ExpenseListQuery } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';
import { nextDocumentNumber } from './sequence.service.ts';

type Tx = Prisma.TransactionClient;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const include = { category: { select: { id: true, name: true, nameHindi: true } }, createdBy: { select: { fullName: true } } } as const;

/** Business running costs. Not party ledgers; they reduce "commission income − expenses" in reports. */
export class ExpenseService {
  constructor(private readonly prisma: PrismaClient) {}

  categories(t: TenantContext, includeInactive: boolean) {
    return t.db.expenseCategory.findMany({ where: includeInactive ? {} : { isActive: true }, orderBy: [{ isSystem: 'desc' }, { name: 'asc' }] });
  }

  async createCategory(t: TenantContext, actorUserId: string, input: { name: string; nameHindi?: string | null }, ctx: RequestContext) {
    const c = await t.db.expenseCategory.create({ data: { name: input.name, nameHindi: input.nameHindi ?? null } as never });
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'ExpenseCategory', entityId: c.id, after: c }, ctx);
    return c;
  }

  async updateCategory(t: TenantContext, actorUserId: string, id: string, input: { name?: string; nameHindi?: string | null; isActive?: boolean }, ctx: RequestContext) {
    const before = await t.db.expenseCategory.findUnique({ where: { id } });
    if (!before) throw Errors.notFound();
    const after = await t.db.expenseCategory.update({ where: { id }, data: input });
    await writeAudit(this.prisma, { businessId: t.businessId, actorUserId, action: 'UPDATE', entityType: 'ExpenseCategory', entityId: id, before, after }, ctx);
    return after;
  }

  async create(t: TenantContext, actorUserId: string, input: CreateExpenseInput, ctx: RequestContext) {
    const cat = await t.db.expenseCategory.findUnique({ where: { id: input.categoryId } });
    if (!cat) throw Errors.notFound();
    if (!cat.isActive) throw Errors.unprocessable('CATEGORY_INACTIVE');
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    const expenseDate = day(input.expenseDate);
    return this.prisma.$transaction(async (tx) => {
      const expenseNumber = await nextDocumentNumber(tx, t.businessId, 'EXPENSE', { date: expenseDate, fiscalYearStartMonth: settings.fiscalYearStartMonth });
      const e = await tx.expense.create({
        data: {
          businessId: t.businessId,
          expenseNumber,
          categoryId: input.categoryId,
          expenseDate,
          amount: input.amount,
          mode: input.mode,
          payee: input.payee ?? null,
          referenceNumber: input.referenceNumber ?? null,
          remarks: input.remarks ?? null,
          createdById: actorUserId,
        },
        include,
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Expense', entityId: e.id, after: e }, ctx);
      return e;
    });
  }

  cancelTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Expense" WHERE "id" = ${id}::uuid AND "businessId" = ${t.businessId}::uuid FOR UPDATE`;
    if (!rows[0]) throw Errors.notFound();
    const e = await tx.expense.findUniqueOrThrow({ where: { id } });
    if (e.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');
    const after = await tx.expense.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason }, include });
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Expense', entityId: id, after: { status: 'CANCELLED', reason } }, ctx);
    return after;
  };

  async list(t: TenantContext, q: ExpenseListQuery) {
    const where: Prisma.ExpenseWhereInput = {
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.from || q.to ? { expenseDate: { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } } : {}),
    };
    const [items, total, sum, byCategory] = await Promise.all([
      t.db.expense.findMany({ where, include, orderBy: [{ expenseDate: 'desc' }, { expenseNumber: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.expense.count({ where }),
      t.db.expense.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { amount: true } }),
      t.db.expense.groupBy({ by: ['categoryId'], where: { ...where, status: 'ACTIVE' }, _sum: { amount: true }, _count: true }),
    ]);
    const cats = await t.db.expenseCategory.findMany({ where: { id: { in: byCategory.map((b) => b.categoryId) } }, select: { id: true, name: true, nameHindi: true } });
    const catName = new Map(cats.map((c) => [c.id, c]));
    return {
      items,
      total,
      totals: {
        amount: sum._sum.amount ?? new Prisma.Decimal(0),
        byCategory: byCategory
          .map((b) => ({ categoryId: b.categoryId, name: catName.get(b.categoryId)?.name ?? '', nameHindi: catName.get(b.categoryId)?.nameHindi ?? null, count: b._count, amount: b._sum.amount ?? new Prisma.Decimal(0) }))
          .sort((a, b) => b.amount.comparedTo(a.amount)),
      },
    };
  }
}
