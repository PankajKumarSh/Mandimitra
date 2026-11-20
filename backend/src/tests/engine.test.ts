import { describe, expect, it } from 'vitest';
import {
  CalcError,
  D,
  amountFor,
  applyRule,
  computePatti,
  computeSale,
  lotNetKg,
  resolveRules,
  toKg,
  type RuleLike,
} from '../services/calculation/engine.ts';

const day = (s: string) => new Date(`${s}T00:00:00Z`);
let n = 0;
const rule = (over: Partial<RuleLike>): RuleLike => ({
  id: `r${++n}`,
  name: 'Rule',
  nameHindi: null,
  chargeType: 'COMMISSION',
  calcMethod: 'PERCENTAGE',
  value: '2.5',
  appliesTo: 'FARMER',
  commodityId: null,
  priority: 0,
  isActive: true,
  effectiveFrom: day('2026-04-01'),
  effectiveTo: null,
  ...over,
});
const s = (v: { toFixed: (n: number) => string }, dp = 2) => v.toFixed(dp);

describe('units & amounts', () => {
  it('converts to kg exactly', () => {
    expect(s(toKg('50', 'QUINTAL'), 3)).toBe('5000.000');
    expect(s(toKg('1.255', 'TON'), 3)).toBe('1255.000');
    expect(s(toKg('3', 'BAG', '50.5'), 3)).toBe('151.500');
    expect(s(toKg('12.345', 'KG'), 3)).toBe('12.345');
  });

  it('requires bag weight for BAG', () => {
    expect(() => toKg('3', 'BAG')).toThrow(CalcError);
    expect(() => toKg('3', 'BAG', '0')).toThrow(CalcError);
  });

  it('"50 quintal gehun ka 2500 rate" = ₹1,25,000', () => {
    expect(s(amountFor(toKg('50', 'QUINTAL'), '2500', 'QUINTAL'))).toBe('125000.00');
  });

  it('rounds the amount half-up to the paisa', () => {
    // 1234.567 kg × ₹2,451.35/qtl = 12.34567 × 2451.35 = 29416.20 + 847.358 = 30263.558 → 30263.56
    expect(s(amountFor('1234.567', '2451.35', 'QUINTAL'))).toBe('30263.56');
    // 0.005 exact half: 1 kg at ₹0.5/qtl = 0.005 → 0.01 (half-up, not banker's)
    expect(s(amountFor('1', '0.5', 'QUINTAL'))).toBe('0.01');
  });

  it('is immune to float error that plain JS would show', () => {
    // 0.1 + 0.2 style: 3 lines of ₹0.10 + ₹0.20 sum exactly
    expect(s(new D('0.1').plus('0.2'))).toBe('0.30');
    // large values beyond float precision stay exact:
    // 999999.99999 qtl × 9999.99 = 9,999,990,000 − 0.0999999 = 9,999,989,999.9000001 → .90
    expect(s(amountFor('99999999.999', '9999.99', 'QUINTAL'))).toBe('9999989999.90');
  });

  it('computes lot net weight and rejects bad tare', () => {
    expect(s(lotNetKg('5250.5', '50.5'), 3)).toBe('5200.000');
    expect(() => lotNetKg('100', '100')).toThrow(CalcError);
    expect(() => lotNetKg('100', '-1')).toThrow(CalcError);
    expect(() => lotNetKg('0', '0')).toThrow(CalcError);
  });

  it('rejects negative inputs', () => {
    expect(() => amountFor('-1', '100', 'KG')).toThrow(CalcError);
    expect(() => toKg('-5', 'KG')).toThrow(CalcError);
  });
});

describe('rule resolution', () => {
  const potato = 'c-potato';
  const wheat = 'c-wheat';
  const generic = rule({ name: 'Commission', value: '2.5' });
  const potatoSpecific = rule({ name: 'Commission (aloo)', value: '2', commodityId: potato });
  const labour = rule({ name: 'Labour', chargeType: 'LABOUR', calcMethod: 'PER_BAG', value: '5' });
  const buyerFee = rule({ name: 'Market fee', chargeType: 'MARKET_FEE', appliesTo: 'BUYER', value: '1' });
  const expired = rule({ name: 'Old', chargeType: 'WEIGHING', effectiveTo: day('2026-06-30') });
  const future = rule({ name: 'Future', chargeType: 'TRANSPORT', effectiveFrom: day('2027-01-01') });
  const inactive = rule({ name: 'Off', chargeType: 'OTHER', isActive: false });
  const all = [generic, potatoSpecific, labour, buyerFee, expired, future, inactive];

  it('commodity-specific rule replaces the generic one of the same type', () => {
    const r = resolveRules(all, { side: 'FARMER', commodityId: potato, date: day('2026-11-20') });
    expect(r.map((x) => x.name).sort()).toEqual(['Commission (aloo)', 'Labour']);
  });

  it('generic applies when no specific rule exists', () => {
    const r = resolveRules(all, { side: 'FARMER', commodityId: wheat, date: day('2026-11-20') });
    expect(r.map((x) => x.name).sort()).toEqual(['Commission', 'Labour']);
  });

  it('respects side, effective dates (inclusive) and active flag', () => {
    expect(resolveRules(all, { side: 'BUYER', commodityId: wheat, date: day('2026-11-20') }).map((x) => x.name)).toEqual(['Market fee']);
    expect(resolveRules(all, { side: 'FARMER', commodityId: wheat, date: day('2026-06-30') }).map((x) => x.name)).toContain('Old');
    expect(resolveRules(all, { side: 'FARMER', commodityId: wheat, date: day('2026-07-01') }).map((x) => x.name)).not.toContain('Old');
    expect(resolveRules(all, { side: 'FARMER', commodityId: wheat, date: day('2027-01-01') }).map((x) => x.name)).toContain('Future');
    expect(resolveRules(all, { side: 'FARMER', commodityId: wheat, date: day('2026-03-31') })).toEqual([]);
  });
});

describe('applyRule', () => {
  const base = { grossAmount: new D('125000'), weightKg: new D('5000'), bags: 100 };
  it.each([
    ['PERCENTAGE', '2.5', '3125.00', '125000.00'], // 2.5% of 1,25,000
    ['FIXED', '150', '150.00', '1.00'],
    ['PER_QUINTAL', '12', '600.00', '5000.00'], // 50 qtl × 12
    ['PER_KG', '0.10', '500.00', '5000.00'],
    ['PER_BAG', '6.5', '650.00', '100.00'],
  ] as const)('%s %s → %s', (calcMethod, value, amount, baseValue) => {
    const line = applyRule(rule({ calcMethod, value }), base);
    expect(s(line.amount)).toBe(amount);
    expect(s(line.baseValue)).toBe(baseValue);
  });

  it('per-bag with zero bags charges nothing', () => {
    expect(s(applyRule(rule({ calcMethod: 'PER_BAG', value: '5' }), { ...base, bags: 0 }).amount)).toBe('0.00');
  });
});

describe('computeSale', () => {
  it('adds buyer-side charges on top of gross', () => {
    const r = computeSale({
      weightKg: new D('4000'),
      bags: 80,
      rate: '2450',
      rateUnit: 'QUINTAL',
      commodityId: 'w',
      date: day('2026-11-20'),
      rules: [
        rule({ name: 'Market fee', chargeType: 'MARKET_FEE', appliesTo: 'BUYER', value: '1' }),
        rule({ name: 'Loading', chargeType: 'LOADING_UNLOADING', appliesTo: 'BUYER', calcMethod: 'PER_BAG', value: '3' }),
        rule({ name: 'Farmer only', appliesTo: 'FARMER' }),
      ],
    });
    // 40 qtl × 2450 = 98,000 ; fee 1% = 980 ; loading 80 × 3 = 240
    expect(s(r.grossAmount)).toBe('98000.00');
    expect(r.charges.map((c) => [c.label, s(c.amount)])).toEqual([
      ['Loading', '240.00'],
      ['Market fee', '980.00'],
    ]);
    expect(s(r.chargesTotal)).toBe('1220.00');
    expect(s(r.totalAmount)).toBe('99220.00');
  });

  it('rejects zero weight', () => {
    expect(() => computeSale({ weightKg: new D(0), bags: 0, rate: '1', rateUnit: 'KG', commodityId: 'x', date: day('2026-11-20'), rules: [] })).toThrow(CalcError);
  });
});

describe('computePatti', () => {
  const wheat = 'c-wheat';
  const potato = 'c-potato';
  const rules = [
    rule({ name: 'Commission', value: '2.5' }),
    rule({ name: 'Commission (aloo)', value: '2', commodityId: potato }),
    rule({ name: 'Labour', chargeType: 'LABOUR', calcMethod: 'PER_BAG', value: '5' }),
    rule({ name: 'Weighing', chargeType: 'WEIGHING', calcMethod: 'PER_QUINTAL', value: '2' }),
    rule({ name: 'Patti fee', chargeType: 'OTHER', calcMethod: 'FIXED', value: '20' }),
  ];
  const base = { rules, manualDeductions: [], date: day('2026-11-20'), outstandingAdvance: new D(0), autoAdjustAdvance: true, netRounding: 'NONE' as const };

  it('worked example: one wheat purchase', () => {
    // 50 qtl × 2,500 = 1,25,000 ; commission 2.5% = 3,125 ; labour 100 bags × 5 = 500 ;
    // weighing 50 qtl × 2 = 100 ; patti fee 20 → deductions 3,745 → net 1,21,255
    const r = computePatti({ ...base, lines: [{ id: 'p1', commodityId: wheat, weightKg: new D('5000'), bags: 100, grossAmount: new D('125000') }] });
    expect(s(r.grossAmount)).toBe('125000.00');
    expect(Object.fromEntries(r.deductions.map((d) => [d.label, s(d.amount)]))).toEqual({
      Commission: '3125.00',
      Labour: '500.00',
      Weighing: '100.00',
      'Patti fee': '20.00',
    });
    expect(s(r.totalDeductions)).toBe('3745.00');
    expect(s(r.netAmount)).toBe('121255.00');
    expect(s(r.netPayable)).toBe('121255.00');
    expect(s(r.ledgerCredit)).toBe('121255.00');
  });

  it('mixed commodities: commission rate per commodity, fixed fee once', () => {
    // wheat 10,000 @2.5% = 250 ; potato 8,000 @2% = 160 ; labour (20+40)×5 = 300 ; weighing (4+8 qtl)×2 = 24 ; fee 20
    const r = computePatti({
      ...base,
      lines: [
        { id: 'a', commodityId: wheat, weightKg: new D('400'), bags: 20, grossAmount: new D('10000') },
        { id: 'b', commodityId: potato, weightKg: new D('800'), bags: 40, grossAmount: new D('8000') },
      ],
    });
    const byLabel = Object.fromEntries(r.deductions.map((d) => [d.label, s(d.amount)]));
    expect(byLabel).toEqual({ Commission: '250.00', 'Commission (aloo)': '160.00', Labour: '300.00', Weighing: '24.00', 'Patti fee': '20.00' });
    expect(s(r.totalDeductions)).toBe('754.00');
    expect(s(r.netAmount)).toBe('17246.00');
    expect(r.totalBags).toBe(60);
    expect(s(r.totalWeightKg, 3)).toBe('1200.000');
  });

  it('merges the same rule across purchases of one commodity into one line', () => {
    const r = computePatti({
      ...base,
      rules: [rule({ name: 'Commission', value: '2.5' })],
      lines: [
        { id: 'a', commodityId: wheat, weightKg: new D('100'), bags: 2, grossAmount: new D('2501') },
        { id: 'b', commodityId: wheat, weightKg: new D('100'), bags: 2, grossAmount: new D('2501') },
      ],
    });
    // computed on the group total (5002 × 2.5% = 125.05), not per line (62.53 + 62.53 = 125.06)
    expect(r.deductions).toHaveLength(1);
    expect(s(r.deductions[0]!.amount)).toBe('125.05');
  });

  it('nets outstanding advance and rounds the payable to the rupee', () => {
    // gross 10,000.40 − commission 250.01 (2.5% of 10000.40 = 250.01) = 9,750.39 ; advance 3,000 → 6,750.39 → round 6,750 (−0.39)
    const r = computePatti({
      ...base,
      rules: [rule({ name: 'Commission', value: '2.5' })],
      lines: [{ id: 'a', commodityId: wheat, weightKg: new D('400'), bags: 0, grossAmount: new D('10000.40') }],
      outstandingAdvance: new D('3000'),
      netRounding: 'NEAREST_RUPEE',
    });
    expect(s(r.netAmount)).toBe('9750.39');
    expect(s(r.advanceAdjusted)).toBe('3000.00');
    expect(s(r.roundOff)).toBe('-0.39');
    expect(s(r.netPayable)).toBe('6750.00');
    // ledger gets net + roundOff; with the −3,000 advance already on the ledger, balance ends at 6,750 = netPayable
    expect(s(r.ledgerCredit)).toBe('9750.00');
    expect(s(new D('-3000').plus(r.ledgerCredit))).toBe('6750.00');
  });

  it('advance larger than net is capped at net (payable 0)', () => {
    const r = computePatti({ ...base, rules: [], lines: [{ id: 'a', commodityId: wheat, weightKg: new D('100'), bags: 0, grossAmount: new D('5000') }], outstandingAdvance: new D('8000') });
    expect(s(r.advanceAdjusted)).toBe('5000.00');
    expect(s(r.netPayable)).toBe('0.00');
  });

  it('does not net advance when auto-adjust is off', () => {
    const r = computePatti({ ...base, rules: [], autoAdjustAdvance: false, lines: [{ id: 'a', commodityId: wheat, weightKg: new D('100'), bags: 0, grossAmount: new D('5000') }], outstandingAdvance: new D('1000') });
    expect(s(r.advanceAdjusted)).toBe('0.00');
    expect(s(r.netPayable)).toBe('5000.00');
  });

  it('adds manual deductions and rejects excessive ones', () => {
    const lines = [{ id: 'a', commodityId: wheat, weightKg: new D('100'), bags: 0, grossAmount: new D('1000') }];
    const ok = computePatti({ ...base, rules: [], lines, manualDeductions: [{ label: 'Bardana', labelHindi: 'बारदाना', amount: '120.50' }] });
    expect(ok.deductions[0]).toMatchObject({ label: 'Bardana', isManual: true });
    expect(s(ok.netAmount)).toBe('879.50');
    expect(() => computePatti({ ...base, rules: [], lines, manualDeductions: [{ label: 'Too much', amount: '1000.01' }] })).toThrow(
      expect.objectContaining({ code: 'EXCESSIVE_DEDUCTIONS' }),
    );
    expect(() => computePatti({ ...base, rules: [], lines, manualDeductions: [{ label: 'Neg', amount: '-5' }] })).toThrow(CalcError);
  });

  it('deductions exactly equal to gross are allowed (net 0)', () => {
    const r = computePatti({ ...base, rules: [], lines: [{ id: 'a', commodityId: wheat, weightKg: new D('1'), bags: 0, grossAmount: new D('100') }], manualDeductions: [{ label: 'All', amount: '100' }] });
    expect(s(r.netAmount)).toBe('0.00');
  });

  it('rejects an empty patti', () => {
    expect(() => computePatti({ ...base, lines: [] })).toThrow(CalcError);
  });

  it('invariants hold for many random pattis', () => {
    // Property check: lines always add up exactly; payable = net − advance + roundOff.
    let seed = 42;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let i = 0; i < 300; i++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 4) }, (_, k) => ({
        id: `l${k}`,
        commodityId: rnd() > 0.5 ? wheat : potato,
        weightKg: new D((rnd() * 9000 + 1).toFixed(3)),
        bags: Math.floor(rnd() * 200),
        grossAmount: new D((rnd() * 500000 + 100).toFixed(2)),
      }));
      const r = computePatti({ ...base, lines, outstandingAdvance: new D((rnd() * 50000).toFixed(2)), netRounding: rnd() > 0.5 ? 'NEAREST_RUPEE' : 'NONE' });
      const sumLines = r.deductions.reduce((acc, d) => acc.plus(d.amount), new D(0));
      expect(sumLines.eq(r.totalDeductions)).toBe(true);
      expect(r.netAmount.eq(r.grossAmount.minus(r.totalDeductions))).toBe(true);
      expect(r.netPayable.eq(r.netAmount.minus(r.advanceAdjusted).plus(r.roundOff))).toBe(true);
      expect(r.advanceAdjusted.lte(r.netAmount)).toBe(true);
      expect(r.roundOff.abs().lte('0.5')).toBe(true);
      expect(r.deductions.every((d) => d.amount.decimalPlaces() <= 2)).toBe(true);
    }
  });
});
