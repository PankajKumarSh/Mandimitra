import { Prisma, type PrismaClient } from '@mandimitra/database';
import type { CreatePurchaseInput, CreateSaleInput, TxnListQuery } from '@mandimitra/shared';
import type { TenantContext } from '../middleware/tenant.ts';
import { Errors } from '../utils/errors.ts';
import type { RequestContext } from '../utils/http.ts';
import { writeAudit } from './audit.service.ts';
import { amountFor, computeSale, toKg, type RuleLike } from './calculation/engine.ts';
import { istToday, postBuyerEntry } from './ledger.service.ts';
import { lockLot, lotStatusFor, mapCalcError } from './lot.service.ts';
import { nextDocumentNumber } from './sequence.service.ts';

type Tx = Prisma.TransactionClient;
const day = (s: string) => new Date(`${s}T00:00:00.000Z`);
const qtl = (kg: Prisma.Decimal) => kg.div(100).toFixed(2);

const saleInclude = {
  buyer: { select: { id: true, code: true, firmName: true } },
  lot: { select: { id: true, lotNumber: true, farmerId: true, farmer: { select: { id: true, code: true, name: true, nameHindi: true } } } },
  commodity: { select: { id: true, name: true, nameHindi: true } },
  charges: { orderBy: { sortOrder: 'asc' as const } },
  purchase: { select: { id: true, purchaseNumber: true, pattiId: true, status: true } },
} as const;

const purchaseInclude = {
  farmer: { select: { id: true, code: true, name: true, nameHindi: true } },
  lot: { select: { id: true, lotNumber: true } },
  commodity: { select: { id: true, name: true, nameHindi: true } },
  patti: { select: { id: true, pattiNumber: true, status: true } },
} as const;

export class TradeService {
  constructor(private readonly prisma: PrismaClient) {}

  async rules(tx: Tx | PrismaClient, businessId: string): Promise<RuleLike[]> {
    return tx.commissionRule.findMany({ where: { businessId, isActive: true } });
  }

  /** Pure preview for the sale form: what will be charged, before saving. */
  async previewSale(t: TenantContext, input: CreateSaleInput) {
    const lot = await t.db.lot.findUnique({ where: { id: input.lotId }, include: { commodity: true } });
    if (!lot) throw Errors.notFound();
    try {
      const weightKg = toKg(input.weight, input.weightUnit, lot.commodity.bagWeightKg);
      return computeSale({
        weightKg,
        bags: input.bags,
        rate: input.rate,
        rateUnit: input.rateUnit ?? lot.commodity.rateUnit,
        bagWeightKg: lot.commodity.bagWeightKg,
        commodityId: lot.commodityId,
        date: day(input.saleDate),
        rules: await this.rules(this.prisma, t.businessId),
      });
    } catch (e) {
      mapCalcError(e);
    }
  }

  /**
   * Record a sale. One transaction:
   *   lock lot → validate stock → compute → number → insert sale (+charges, +paired purchase in commission mode)
   *   → update lot weights/status → debit buyer ledger → audit.
   */
  async createSale(t: TenantContext, actorUserId: string, input: CreateSaleInput, ctx: RequestContext) {
    const buyer = await t.db.buyer.findFirst({ where: { id: input.buyerId, deletedAt: null }, select: { isActive: true } });
    if (!buyer) throw Errors.notFound();
    if (!buyer.isActive) throw Errors.unprocessable('INACTIVE_PARTY');
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    const mode =
      settings.tradingMode === 'COMMISSION_AGENT' ? 'COMMISSION' : settings.tradingMode === 'TRADER' ? 'TRADE' : (input.mode ?? 'COMMISSION');
    const saleDate = day(input.saleDate);

    return this.prisma.$transaction(async (tx) => {
      const lot = await lockLot(tx, t.businessId, input.lotId);
      if (lot.status !== 'CONFIRMED' && lot.status !== 'PARTIALLY_SOLD') throw Errors.unprocessable('LOT_NOT_SELLABLE', { status: lot.status });

      let calc;
      try {
        const weightKg = toKg(input.weight, input.weightUnit, lot.commodity.bagWeightKg);
        calc = computeSale({
          weightKg,
          bags: input.bags,
          rate: input.rate,
          rateUnit: input.rateUnit ?? lot.commodity.rateUnit,
          bagWeightKg: lot.commodity.bagWeightKg,
          commodityId: lot.commodityId,
          date: saleDate,
          rules: await this.rules(tx, t.businessId),
        });
      } catch (e) {
        mapCalcError(e);
      }
      const w = calc.weightKg;

      if (mode === 'COMMISSION') {
        const available = lot.netWeightKg.minus(Prisma.Decimal.max(lot.soldWeightKg, lot.purchasedWeightKg));
        if (w.gt(available)) throw Errors.unprocessable('LOT_QTY_EXCEEDED', { availableKg: available.toFixed(3) });
      } else {
        const unsold = lot.netWeightKg.minus(lot.soldWeightKg);
        if (w.gt(unsold)) throw Errors.unprocessable('LOT_QTY_EXCEEDED', { availableKg: unsold.toFixed(3) });
        const bought = lot.purchasedWeightKg.minus(lot.soldWeightKg);
        if (w.gt(bought)) throw Errors.unprocessable('STOCK_NOT_PURCHASED', { purchasedAvailableKg: bought.toFixed(3) });
      }

      const rateUnit = input.rateUnit ?? lot.commodity.rateUnit;
      const fyOpts = { date: saleDate, fiscalYearStartMonth: settings.fiscalYearStartMonth };
      const saleNumber = await nextDocumentNumber(tx, t.businessId, 'SALE', fyOpts);
      const sale = await tx.sale.create({
        data: {
          businessId: t.businessId,
          saleNumber,
          buyerId: input.buyerId,
          lotId: lot.id,
          commodityId: lot.commodityId,
          saleDate,
          weightKg: w,
          bags: input.bags,
          rate: input.rate,
          rateUnit,
          grossAmount: calc.grossAmount,
          chargesTotal: calc.chargesTotal,
          totalAmount: calc.totalAmount,
          createdById: actorUserId,
        },
      });
      if (calc.charges.length) {
        await tx.saleCharge.createMany({
          data: calc.charges.map((c, i) => ({
            businessId: t.businessId,
            saleId: sale.id,
            commissionRuleId: c.ruleId,
            chargeType: c.chargeType,
            calcMethod: c.calcMethod,
            rateValue: c.rateValue,
            baseValue: c.baseValue,
            amount: c.amount,
            label: c.label,
            isManual: false,
            sortOrder: i,
          })),
        });
      }

      let purchasedWeightKg = lot.purchasedWeightKg;
      if (mode === 'COMMISSION') {
        // Aadhat: the farmer is credited at the auction rate (same weight, same rate, same gross).
        const purchaseNumber = await nextDocumentNumber(tx, t.businessId, 'PURCHASE', fyOpts);
        await tx.purchase.create({
          data: {
            businessId: t.businessId,
            purchaseNumber,
            farmerId: lot.farmerId,
            lotId: lot.id,
            commodityId: lot.commodityId,
            saleId: sale.id,
            purchaseDate: saleDate,
            weightKg: w,
            bags: input.bags,
            rate: input.rate,
            rateUnit,
            grossAmount: calc.grossAmount,
            createdById: actorUserId,
          },
        });
        purchasedWeightKg = purchasedWeightKg.plus(w);
      }

      const soldWeightKg = lot.soldWeightKg.plus(w);
      await tx.lot.update({
        where: { id: lot.id },
        data: { soldWeightKg, purchasedWeightKg, status: lotStatusFor(soldWeightKg, lot.netWeightKg), version: { increment: 1 } },
      });

      await postBuyerEntry(tx, {
        businessId: t.businessId,
        buyerId: input.buyerId,
        entryDate: saleDate,
        entryType: 'SALE_DEBIT',
        debit: calc.totalAmount,
        narration: `Sale ${saleNumber} · Lot ${lot.lotNumber} · ${qtl(w)} qtl @ ₹${input.rate}/${rateUnit}`,
        saleId: sale.id,
        createdById: actorUserId,
      });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Sale', entityId: sale.id, after: { ...sale, mode, charges: calc.charges } }, ctx);
      return tx.sale.findUniqueOrThrow({ where: { id: sale.id }, include: saleInclude });
    });
  }

  /** Cancel executor. Reverses the buyer ledger and restores lot stock; blocked once the farmer side is on a patti. */
  cancelSaleTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const sale = await tx.sale.findFirst({ where: { id, businessId: t.businessId }, include: { purchase: true } });
    if (!sale) throw Errors.notFound();
    const lot = await lockLot(tx, t.businessId, sale.lotId);
    const fresh = await tx.sale.findUniqueOrThrow({ where: { id }, include: { purchase: true } }); // re-read under lock
    if (fresh.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');
    if (fresh.purchase?.pattiId) throw Errors.unprocessable('IN_FINALIZED_PATTI');

    const now = new Date();
    await tx.sale.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason } });
    let purchasedWeightKg = lot.purchasedWeightKg;
    if (fresh.purchase && fresh.purchase.status === 'ACTIVE') {
      await tx.purchase.update({ where: { id: fresh.purchase.id }, data: { status: 'CANCELLED', cancelledAt: now, cancelReason: reason } });
      purchasedWeightKg = purchasedWeightKg.minus(fresh.purchase.weightKg);
    }
    const soldWeightKg = lot.soldWeightKg.minus(fresh.weightKg);
    await tx.lot.update({
      where: { id: lot.id },
      data: { soldWeightKg, purchasedWeightKg, status: lotStatusFor(soldWeightKg, lot.netWeightKg), version: { increment: 1 } },
    });

    const original = await tx.buyerLedgerEntry.findFirstOrThrow({ where: { businessId: t.businessId, saleId: id, entryType: 'SALE_DEBIT' } });
    await postBuyerEntry(tx, {
      businessId: t.businessId,
      buyerId: fresh.buyerId,
      entryDate: istToday(), // a reversal is dated the day it happens, not back-dated
      entryType: 'REVERSAL',
      credit: original.debit,
      narration: `Cancelled sale ${fresh.saleNumber}: ${reason}`.slice(0, 300),
      saleId: id,
      reversalOfId: original.id,
      createdById: actorUserId,
    });
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Sale', entityId: id, before: { status: 'ACTIVE' }, after: { status: 'CANCELLED', reason } }, ctx);
    return tx.sale.findUniqueOrThrow({ where: { id }, include: saleInclude });
  };

  /** Manual farmer purchase (TRADER / MIXED). In commission mode purchases come only from sales. */
  async createPurchase(t: TenantContext, actorUserId: string, input: CreatePurchaseInput, ctx: RequestContext) {
    const settings = await this.prisma.businessSettings.findUniqueOrThrow({ where: { businessId: t.businessId } });
    if (settings.tradingMode === 'COMMISSION_AGENT') throw Errors.unprocessable('PURCHASE_NOT_ALLOWED_IN_MODE');
    const purchaseDate = day(input.purchaseDate);

    return this.prisma.$transaction(async (tx) => {
      const lot = await lockLot(tx, t.businessId, input.lotId);
      if (lot.status === 'DRAFT' || lot.status === 'CANCELLED') throw Errors.unprocessable('LOT_NOT_SELLABLE', { status: lot.status });
      let weightKg: Prisma.Decimal;
      let grossAmount: Prisma.Decimal;
      const rateUnit = input.rateUnit ?? lot.commodity.rateUnit;
      try {
        weightKg = toKg(input.weight, input.weightUnit, lot.commodity.bagWeightKg);
        grossAmount = amountFor(weightKg, input.rate, rateUnit, lot.commodity.bagWeightKg);
      } catch (e) {
        mapCalcError(e);
      }
      const available = lot.netWeightKg.minus(lot.purchasedWeightKg);
      if (weightKg.gt(available)) throw Errors.unprocessable('LOT_QTY_EXCEEDED', { availableKg: available.toFixed(3) });

      const purchaseNumber = await nextDocumentNumber(tx, t.businessId, 'PURCHASE', { date: purchaseDate, fiscalYearStartMonth: settings.fiscalYearStartMonth });
      const p = await tx.purchase.create({
        data: {
          businessId: t.businessId,
          purchaseNumber,
          farmerId: lot.farmerId,
          lotId: lot.id,
          commodityId: lot.commodityId,
          purchaseDate,
          weightKg,
          bags: input.bags,
          rate: input.rate,
          rateUnit,
          grossAmount,
          createdById: actorUserId,
        },
        include: purchaseInclude,
      });
      await tx.lot.update({ where: { id: lot.id }, data: { purchasedWeightKg: lot.purchasedWeightKg.plus(weightKg), version: { increment: 1 } } });
      await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CREATE', entityType: 'Purchase', entityId: p.id, after: p }, ctx);
      return p;
    });
  }

  cancelPurchaseTx = async (tx: Tx, t: TenantContext, actorUserId: string, id: string, reason: string, ctx: RequestContext) => {
    const p0 = await tx.purchase.findFirst({ where: { id, businessId: t.businessId } });
    if (!p0) throw Errors.notFound();
    if (p0.saleId) throw Errors.unprocessable('LOT_HAS_TRANSACTIONS'); // paired with a sale → cancel the sale instead
    const lot = await lockLot(tx, t.businessId, p0.lotId);
    const p = await tx.purchase.findUniqueOrThrow({ where: { id } });
    if (p.status === 'CANCELLED') throw Errors.unprocessable('ALREADY_CANCELLED');
    if (p.pattiId) throw Errors.unprocessable('IN_FINALIZED_PATTI');
    const remaining = lot.purchasedWeightKg.minus(p.weightKg);
    if (lot.soldWeightKg.gt(remaining)) throw Errors.unprocessable('STOCK_ALREADY_SOLD');

    await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
    await tx.lot.update({ where: { id: lot.id }, data: { purchasedWeightKg: remaining, version: { increment: 1 } } });
    await writeAudit(tx, { businessId: t.businessId, actorUserId, action: 'CANCEL', entityType: 'Purchase', entityId: id, after: { status: 'CANCELLED', reason } }, ctx);
    return tx.purchase.findUniqueOrThrow({ where: { id }, include: purchaseInclude });
  };

  private range(q: TxnListQuery) {
    return q.from || q.to ? { ...(q.from ? { gte: day(q.from) } : {}), ...(q.to ? { lte: day(q.to) } : {}) } : undefined;
  }

  async listSales(t: TenantContext, q: TxnListQuery) {
    const r = this.range(q);
    const where: Prisma.SaleWhereInput = {
      ...(q.buyerId ? { buyerId: q.buyerId } : {}),
      ...(q.lotId ? { lotId: q.lotId } : {}),
      ...(q.commodityId ? { commodityId: q.commodityId } : {}),
      ...(q.farmerId ? { lot: { farmerId: q.farmerId } } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(r ? { saleDate: r } : {}),
    };
    const [items, total, sums] = await Promise.all([
      t.db.sale.findMany({ where, include: saleInclude, orderBy: [{ saleDate: 'desc' }, { saleNumber: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.sale.count({ where }),
      t.db.sale.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { weightKg: true, grossAmount: true, totalAmount: true } }),
    ]);
    return { items, total, totals: sums._sum };
  }

  async getSale(t: TenantContext, id: string) {
    const s = await t.db.sale.findUnique({ where: { id }, include: saleInclude });
    if (!s) throw Errors.notFound();
    return s;
  }

  async listPurchases(t: TenantContext, q: TxnListQuery) {
    const r = this.range(q);
    const where: Prisma.PurchaseWhereInput = {
      ...(q.farmerId ? { farmerId: q.farmerId } : {}),
      ...(q.lotId ? { lotId: q.lotId } : {}),
      ...(q.commodityId ? { commodityId: q.commodityId } : {}),
      ...(q.status ? { status: q.status } : {}),
      ...(q.unbilled ? { pattiId: null, status: 'ACTIVE' } : {}),
      ...(r ? { purchaseDate: r } : {}),
    };
    const [items, total, sums] = await Promise.all([
      t.db.purchase.findMany({ where, include: purchaseInclude, orderBy: [{ purchaseDate: 'desc' }, { purchaseNumber: 'desc' }], skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      t.db.purchase.count({ where }),
      t.db.purchase.aggregate({ where: { ...where, status: 'ACTIVE' }, _sum: { weightKg: true, grossAmount: true } }),
    ]);
    return { items, total, totals: sums._sum };
  }
}
