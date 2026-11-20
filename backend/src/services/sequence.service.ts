import type { DocType, Prisma } from '@mandimitra/database';

const FORMATS: Record<DocType, { prefix: string; pad: number; perFiscalYear: boolean }> = {
  FARMER: { prefix: 'F', pad: 5, perFiscalYear: false },
  BUYER: { prefix: 'B', pad: 5, perFiscalYear: false },
  LOT: { prefix: 'L', pad: 6, perFiscalYear: true },
  PURCHASE: { prefix: 'PU', pad: 6, perFiscalYear: true },
  SALE: { prefix: 'S', pad: 6, perFiscalYear: true },
  PATTI: { prefix: 'P', pad: 6, perFiscalYear: true },
  PAYMENT: { prefix: 'R', pad: 6, perFiscalYear: true },
  EXPENSE: { prefix: 'E', pad: 6, perFiscalYear: true },
};

/** Indian FY label for a business date: 2026-11-19 (start month 4) → "2026-27". */
export function fiscalYearOf(date: Date, startMonth = 4): string {
  const y = date.getUTCFullYear();
  const start = date.getUTCMonth() + 1 >= startMonth ? y : y - 1;
  return startMonth === 1 ? String(start) : `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/**
 * Gap-free, per-tenant document number. MUST be called inside the transaction that inserts the document:
 * the upsert takes a row lock held until commit, and a rollback rolls the counter back too.
 */
export async function nextDocumentNumber(
  tx: Prisma.TransactionClient,
  businessId: string,
  docType: DocType,
  opts: { date?: Date; fiscalYearStartMonth?: number } = {},
): Promise<string> {
  const fmt = FORMATS[docType];
  const fy = fmt.perFiscalYear ? fiscalYearOf(opts.date ?? new Date(), opts.fiscalYearStartMonth) : 'ALL';

  const rows = await tx.$queryRaw<{ value: number }[]>`
    INSERT INTO "DocumentSequence" ("businessId", "docType", "fiscalYear", "prefix", "nextValue", "updatedAt")
    VALUES (${businessId}::uuid, ${docType}::"DocType", ${fy}, ${fmt.prefix}, 2, now())
    ON CONFLICT ("businessId", "docType", "fiscalYear")
    DO UPDATE SET "nextValue" = "DocumentSequence"."nextValue" + 1, "updatedAt" = now()
    RETURNING ("nextValue" - 1)::int AS value`;

  const n = String(rows[0]!.value).padStart(fmt.pad, '0');
  return fmt.perFiscalYear ? `${fmt.prefix}/${fy}/${n}` : `${fmt.prefix}-${n}`;
}
