/**
 * Verifies the hand-written CHECK constraints from the init migration against a real PostgreSQL.
 * These are the last line of defence behind service validation (Phase 4/5).
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { makeApp, registerOwner } from './helpers.ts';

const { app, prisma } = makeApp();

let businessId: string;
let userId: string;
let farmerId: string;
let buyerId: string;
let commodityId: string;

beforeAll(async () => {
  ({ businessId, userId } = await registerOwner(app));
  commodityId = (await prisma.commodity.findFirstOrThrow({ where: { businessId } })).id;
  farmerId = (await prisma.farmer.create({ data: { businessId, code: 'F-1', name: 'रामकुमार', createdById: userId } })).id;
  buyerId = (await prisma.buyer.create({ data: { businessId, code: 'B-1', firmName: 'Agarwal Traders', createdById: userId } })).id;
});

const lot = (over: Record<string, string>) => ({
  businessId,
  lotNumber: `L-${crypto.randomUUID().slice(0, 8)}`,
  farmerId,
  commodityId,
  arrivalDate: new Date('2026-11-19'),
  grossWeightKg: '1000.000',
  tareWeightKg: '20.000',
  netWeightKg: '980.000',
  createdById: userId,
  ...over,
});

describe('database encoding', () => {
  it('is UTF8 and round-trips Devanagari', async () => {
    const [row] = await prisma.$queryRaw<{ server_encoding: string }[]>`SHOW server_encoding`;
    expect(row!.server_encoding).toBe('UTF8');
    expect((await prisma.farmer.findUniqueOrThrow({ where: { id: farmerId } })).name).toBe('रामकुमार');
  });
});

describe('lot constraints', () => {
  it('accepts a coherent lot', async () => {
    await expect(prisma.lot.create({ data: lot({}) })).resolves.toBeTruthy();
  });

  it.each([
    ['net ≠ gross − tare', { netWeightKg: '990.000' }, 'Lot_net_equals'],
    ['zero gross', { grossWeightKg: '0', tareWeightKg: '0', netWeightKg: '0' }, 'Lot_gross_positive'],
    ['tare ≥ gross', { tareWeightKg: '1000.000', netWeightKg: '0' }, 'Lot_tare_valid'],
    ['negative tare', { tareWeightKg: '-5', netWeightKg: '1005.000' }, 'Lot_tare_valid'],
    ['sold > net', { soldWeightKg: '981.000' }, 'Lot_sold_within_net'],
    ['moisture > 100', { moisturePercent: '101' }, 'Lot_moisture_range'],
  ])('rejects %s', async (_label, over, constraint) => {
    await expect(prisma.lot.create({ data: lot(over) })).rejects.toThrow(constraint);
  });
});

describe('money constraints', () => {
  const payment = (over: Record<string, unknown>) => ({
    businessId,
    receiptNumber: `R-${crypto.randomUUID().slice(0, 8)}`,
    partySide: 'FARMER' as const,
    farmerId,
    direction: 'OUTGOING' as const,
    purpose: 'ADVANCE' as const,
    mode: 'CASH' as const,
    amount: '5000.00',
    paymentDate: new Date('2026-11-19'),
    idempotencyKey: crypto.randomUUID(),
    createdById: userId,
    ...over,
  });

  it('accepts a valid payment', async () => {
    await expect(prisma.payment.create({ data: payment({}) })).resolves.toBeTruthy();
  });

  it('rejects zero / negative payment amounts', async () => {
    await expect(prisma.payment.create({ data: payment({ amount: '0' }) })).rejects.toThrow('Payment_amount_positive');
    await expect(prisma.payment.create({ data: payment({ amount: '-1' }) })).rejects.toThrow('Payment_amount_positive');
  });

  it('rejects a payment linked to both or the wrong party', async () => {
    await expect(prisma.payment.create({ data: payment({ buyerId }) })).rejects.toThrow('Payment_party_valid');
    await expect(prisma.payment.create({ data: payment({ partySide: 'BUYER' }) })).rejects.toThrow('Payment_party_valid');
  });

  it('rejects duplicate idempotency keys', async () => {
    const key = crypto.randomUUID();
    await prisma.payment.create({ data: payment({ idempotencyKey: key }) });
    await expect(prisma.payment.create({ data: payment({ idempotencyKey: key }) })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('ledger entries must be strictly one-sided', async () => {
    const entry = (debit: string, credit: string) => ({
      businessId,
      farmerId,
      entryDate: new Date('2026-11-19'),
      entryType: 'ADJUSTMENT' as const,
      debit,
      credit,
      balanceAfter: '0',
      narration: 'test',
      createdById: userId,
    });
    // Raw insert bypasses the ledger service (no cached-balance update), so remove it afterwards to keep
    // the global ledger-vs-cache consistency check in masters.test.ts strict.
    const valid = await prisma.farmerLedgerEntry.create({ data: entry('100.00', '0') });
    await prisma.farmerLedgerEntry.delete({ where: { id: valid.id } });
    await expect(prisma.farmerLedgerEntry.create({ data: entry('100.00', '50.00') })).rejects.toThrow('FarmerLedger_one_sided');
    await expect(prisma.farmerLedgerEntry.create({ data: entry('0', '0') })).rejects.toThrow('FarmerLedger_one_sided');
    await expect(prisma.farmerLedgerEntry.create({ data: entry('-10.00', '0') })).rejects.toThrow('FarmerLedger_one_sided');
  });

  it('patti deductions can never exceed gross', async () => {
    const base = { businessId, farmerId, pattiDate: new Date('2026-11-19'), createdById: userId };
    await expect(
      prisma.patti.create({
        data: { ...base, pattiNumber: 'P-OK', grossAmount: '10000.00', totalDeductions: '500.00', netAmount: '9500.00', netPayable: '9500.00' },
      }),
    ).resolves.toBeTruthy();
    await expect(
      prisma.patti.create({
        data: { ...base, pattiNumber: 'P-BAD', grossAmount: '1000.00', totalDeductions: '1500.00', netAmount: '-500.00', netPayable: '-500.00' },
      }),
      // Negative net also violates Patti_advance_le_net; Postgres reports whichever it checks first.
    ).rejects.toThrow(/Patti_(deductions_le_gross|advance_le_net)/);
    await expect(
      prisma.patti.create({
        data: { ...base, pattiNumber: 'P-BAD2', grossAmount: '1000.00', totalDeductions: '100.00', netAmount: '800.00', netPayable: '800.00' },
      }),
    ).rejects.toThrow('Patti_net_equals');
  });

  it('commission percentage cannot exceed 100', async () => {
    const rule = (value: string) => ({
      businessId,
      name: 'Commission',
      chargeType: 'COMMISSION' as const,
      calcMethod: 'PERCENTAGE' as const,
      value,
      effectiveFrom: new Date('2026-04-01'),
    });
    await expect(prisma.commissionRule.create({ data: rule('2.5') })).resolves.toBeTruthy();
    await expect(prisma.commissionRule.create({ data: rule('150') })).rejects.toThrow('CommissionRule_pct_max');
  });
});
