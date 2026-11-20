import { Prisma, type LedgerEntryType } from '@mandimitra/database';
import { Errors } from '../utils/errors.ts';

type Tx = Prisma.TransactionClient;
const ZERO = new Prisma.Decimal(0);

interface EntryInput {
  businessId: string;
  entryDate: Date;
  entryType: LedgerEntryType;
  /** Exactly one of debit / credit must be > 0 (also enforced by a DB CHECK). */
  debit?: Prisma.Decimal;
  credit?: Prisma.Decimal;
  narration: string;
  createdById: string;
  paymentId?: string;
  reversalOfId?: string;
}

function sides(e: EntryInput) {
  const debit = e.debit ?? ZERO;
  const credit = e.credit ?? ZERO;
  if (debit.isNegative() || credit.isNegative() || debit.isZero() === credit.isZero()) {
    throw new Error('Ledger entry must have exactly one positive side');
  }
  return { debit, credit };
}

/**
 * Farmer ledger: balance = Σcredit − Σdebit (positive ⇒ business owes the farmer).
 * Locks the farmer row so concurrent postings serialise and balanceAfter is always exact.
 */
export async function postFarmerEntry(tx: Tx, e: EntryInput & { farmerId: string; pattiId?: string }) {
  const { debit, credit } = sides(e);
  const rows = await tx.$queryRaw<{ currentBalance: string }[]>`
    SELECT "currentBalance"::text AS "currentBalance" FROM "Farmer"
    WHERE "id" = ${e.farmerId}::uuid AND "businessId" = ${e.businessId}::uuid
    FOR UPDATE`;
  if (!rows[0]) throw Errors.notFound();
  const balanceAfter = new Prisma.Decimal(rows[0].currentBalance).plus(credit).minus(debit);

  const entry = await tx.farmerLedgerEntry.create({
    data: {
      businessId: e.businessId,
      farmerId: e.farmerId,
      entryDate: e.entryDate,
      entryType: e.entryType,
      debit,
      credit,
      balanceAfter,
      narration: e.narration,
      pattiId: e.pattiId ?? null,
      paymentId: e.paymentId ?? null,
      reversalOfId: e.reversalOfId ?? null,
      createdById: e.createdById,
    },
  });
  await tx.farmer.update({ where: { id: e.farmerId }, data: { currentBalance: balanceAfter } });
  return entry;
}

/** Buyer ledger: balance = Σdebit − Σcredit (positive ⇒ buyer owes the business). */
export async function postBuyerEntry(tx: Tx, e: EntryInput & { buyerId: string; saleId?: string }) {
  const { debit, credit } = sides(e);
  const rows = await tx.$queryRaw<{ currentBalance: string }[]>`
    SELECT "currentBalance"::text AS "currentBalance" FROM "Buyer"
    WHERE "id" = ${e.buyerId}::uuid AND "businessId" = ${e.businessId}::uuid
    FOR UPDATE`;
  if (!rows[0]) throw Errors.notFound();
  const balanceAfter = new Prisma.Decimal(rows[0].currentBalance).plus(debit).minus(credit);

  const entry = await tx.buyerLedgerEntry.create({
    data: {
      businessId: e.businessId,
      buyerId: e.buyerId,
      entryDate: e.entryDate,
      entryType: e.entryType,
      debit,
      credit,
      balanceAfter,
      narration: e.narration,
      saleId: e.saleId ?? null,
      paymentId: e.paymentId ?? null,
      reversalOfId: e.reversalOfId ?? null,
      createdById: e.createdById,
    },
  });
  await tx.buyer.update({ where: { id: e.buyerId }, data: { currentBalance: balanceAfter } });
  return entry;
}

/** Today's business date in IST, as a UTC-midnight Date suitable for @db.Date columns. */
export function istToday(now = new Date()): Date {
  return new Date(`${istDateString(now)}T00:00:00.000Z`);
}

export function istDateString(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
