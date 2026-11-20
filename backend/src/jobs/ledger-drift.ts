import type { Prisma, PrismaClient } from '@mandimitra/database';
import type { Logger } from '../config/logger.ts';

export interface DriftRow {
  businessId: string;
  partyId: string;
  cached: string;
  ledger: string;
}

/**
 * Nightly integrity check: every cached balance must equal the sum of its append-only ledger.
 *   farmer: Σ(credit − debit)   buyer: Σ(debit − credit)
 * It never "fixes" anything — a mismatch means a bug or a manual DB edit, and must be investigated.
 * Mismatches are logged at error level (→ Sentry when configured).
 */
export class LedgerDriftCheck {
  constructor(
    private readonly prisma: PrismaClient | Prisma.TransactionClient,
    private readonly logger: Logger,
  ) {}

  async run() {
    const farmers = await this.prisma.$queryRaw<DriftRow[]>`
      SELECT f."businessId"::text AS "businessId", f.id::text AS "partyId",
             f."currentBalance"::text AS cached, COALESCE(SUM(e.credit - e.debit), 0)::text AS ledger
      FROM "Farmer" f
      LEFT JOIN "FarmerLedgerEntry" e ON e."businessId" = f."businessId" AND e."farmerId" = f.id
      GROUP BY f.id
      HAVING f."currentBalance" <> COALESCE(SUM(e.credit - e.debit), 0)
      LIMIT 500`;
    const buyers = await this.prisma.$queryRaw<DriftRow[]>`
      SELECT b."businessId"::text AS "businessId", b.id::text AS "partyId",
             b."currentBalance"::text AS cached, COALESCE(SUM(e.debit - e.credit), 0)::text AS ledger
      FROM "Buyer" b
      LEFT JOIN "BuyerLedgerEntry" e ON e."businessId" = b."businessId" AND e."buyerId" = b.id
      GROUP BY b.id
      HAVING b."currentBalance" <> COALESCE(SUM(e.debit - e.credit), 0)
      LIMIT 500`;
    if (farmers.length || buyers.length) {
      this.logger.error({ farmers: farmers.slice(0, 20), buyers: buyers.slice(0, 20), farmerCount: farmers.length, buyerCount: buyers.length }, 'ledger.drift_detected');
    } else {
      this.logger.info('jobs.ledger_drift: ok');
    }
    return { farmers, buyers };
  }
}
