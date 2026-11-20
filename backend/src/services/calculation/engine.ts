/**
 * MandiMitra settlement engine — PURE functions: no I/O, no clock, no globals.
 *
 * Rules:
 *  - Decimal arithmetic only (decimal.js via Prisma.Decimal). No JS numbers for money.
 *  - Weights are kilograms (3 dp). Money is rupees (2 dp).
 *  - Every line amount is rounded HALF_UP to 2 dp *before* summing, so printed lines always add up.
 *  - Inputs are validated; impossible states throw CalcError (mapped to 422 by services).
 */
import { Prisma } from '@mandimitra/database';

export const D = Prisma.Decimal;
export type Dec = Prisma.Decimal;
type Unit = 'KG' | 'QUINTAL' | 'TON' | 'BAG';
type ChargeType = 'COMMISSION' | 'LABOUR' | 'WEIGHING' | 'TRANSPORT' | 'MARKET_FEE' | 'LOADING_UNLOADING' | 'OTHER';
type CalcMethod = 'PERCENTAGE' | 'FIXED' | 'PER_QUINTAL' | 'PER_KG' | 'PER_BAG';
type Side = 'FARMER' | 'BUYER';

export class CalcError extends Error {
  constructor(
    readonly code: 'BAG_WEIGHT_REQUIRED' | 'EXCESSIVE_DEDUCTIONS' | 'INVALID_INPUT',
    message: string,
  ) {
    super(message);
    this.name = 'CalcError';
  }
}

const ZERO = new D(0);
export const money = (v: Dec) => v.toDecimalPlaces(2, D.ROUND_HALF_UP);
export const weight = (v: Dec) => v.toDecimalPlaces(3, D.ROUND_HALF_UP);

// ------------------------------------------------------------------ units

export function unitKg(unit: Unit, bagWeightKg?: Dec | string | null): Dec {
  switch (unit) {
    case 'KG':
      return new D(1);
    case 'QUINTAL':
      return new D(100);
    case 'TON':
      return new D(1000);
    case 'BAG': {
      if (bagWeightKg === null || bagWeightKg === undefined || new D(bagWeightKg).lte(0)) {
        throw new CalcError('BAG_WEIGHT_REQUIRED', 'Bag weight is required for BAG unit');
      }
      return new D(bagWeightKg);
    }
  }
}

/** Quantity in any unit → kilograms (3 dp). */
export function toKg(qty: Dec | string, unit: Unit, bagWeightKg?: Dec | string | null): Dec {
  const q = new D(qty);
  if (q.isNegative()) throw new CalcError('INVALID_INPUT', 'Quantity cannot be negative');
  return weight(q.times(unitKg(unit, bagWeightKg)));
}

/** Amount for a weight at a rate quoted per `rateUnit`: kg ÷ unitKg × rate, rounded to paisa. */
export function amountFor(weightKg: Dec | string, rate: Dec | string, rateUnit: Unit, bagWeightKg?: Dec | string | null): Dec {
  const w = new D(weightKg);
  const r = new D(rate);
  if (w.isNegative() || r.isNegative()) throw new CalcError('INVALID_INPUT', 'Weight and rate must be non-negative');
  return money(w.div(unitKg(rateUnit, bagWeightKg)).times(r));
}

/** Net weight of a lot. Tare must be below gross. */
export function lotNetKg(grossKg: Dec | string, tareKg: Dec | string): Dec {
  const g = new D(grossKg);
  const t = new D(tareKg);
  if (g.lte(0)) throw new CalcError('INVALID_INPUT', 'Gross weight must be greater than zero');
  if (t.isNegative() || t.gte(g)) throw new CalcError('INVALID_INPUT', 'Tare must be at least 0 and less than gross');
  return weight(g.minus(t));
}

// ------------------------------------------------------------------ rules

export interface RuleLike {
  id: string;
  name: string;
  nameHindi: string | null;
  chargeType: ChargeType;
  calcMethod: CalcMethod;
  value: Dec | string;
  appliesTo: Side;
  commodityId: string | null;
  priority: number;
  isActive: boolean;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}

export interface ChargeLine {
  ruleId: string | null;
  chargeType: ChargeType;
  calcMethod: CalcMethod;
  rateValue: Dec;
  baseValue: Dec;
  amount: Dec;
  label: string;
  labelHindi: string | null;
  isManual: boolean;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Rules that apply on `date` for `side` and `commodityId`.
 * Per charge type, commodity-specific rules REPLACE generic ones (so "Commission 2.5%" generic and
 * "Commission 2% for Potato" don't double-charge potato). Several rules of the same type may apply
 * together (e.g. two OTHER charges). Order: priority desc, then name.
 */
export function resolveRules(rules: readonly RuleLike[], q: { side: Side; commodityId: string; date: Date }): RuleLike[] {
  const day = dayKey(q.date);
  const live = rules.filter(
    (r) =>
      r.isActive &&
      r.appliesTo === q.side &&
      dayKey(r.effectiveFrom) <= day &&
      (!r.effectiveTo || dayKey(r.effectiveTo) >= day) &&
      (r.commodityId === null || r.commodityId === q.commodityId),
  );
  const byType = new Map<ChargeType, RuleLike[]>();
  for (const r of live) byType.set(r.chargeType, [...(byType.get(r.chargeType) ?? []), r]);

  const out: RuleLike[] = [];
  for (const group of byType.values()) {
    const specific = group.filter((r) => r.commodityId !== null);
    out.push(...(specific.length ? specific : group));
  }
  return out.sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
}

export interface ChargeBase {
  grossAmount: Dec;
  weightKg: Dec;
  bags: number;
}

/** One rule against one base. FIXED is a flat amount per transaction/patti. */
export function applyRule(rule: RuleLike, base: ChargeBase): ChargeLine {
  const v = new D(rule.value);
  if (v.isNegative()) throw new CalcError('INVALID_INPUT', 'Rule value cannot be negative');
  let baseValue: Dec;
  let amount: Dec;
  switch (rule.calcMethod) {
    case 'PERCENTAGE':
      baseValue = base.grossAmount;
      amount = base.grossAmount.times(v).div(100);
      break;
    case 'FIXED':
      baseValue = new D(1);
      amount = v;
      break;
    case 'PER_QUINTAL':
      baseValue = base.weightKg;
      amount = base.weightKg.div(100).times(v);
      break;
    case 'PER_KG':
      baseValue = base.weightKg;
      amount = base.weightKg.times(v);
      break;
    case 'PER_BAG':
      baseValue = new D(base.bags);
      amount = new D(base.bags).times(v);
      break;
  }
  return {
    ruleId: rule.id,
    chargeType: rule.chargeType,
    calcMethod: rule.calcMethod,
    rateValue: v,
    baseValue,
    amount: money(amount),
    label: rule.name,
    labelHindi: rule.nameHindi,
    isManual: false,
  };
}

// ------------------------------------------------------------------ sale (buyer side)

export interface SaleComputation {
  weightKg: Dec;
  grossAmount: Dec;
  charges: ChargeLine[];
  chargesTotal: Dec;
  totalAmount: Dec;
}

export function computeSale(input: {
  weightKg: Dec;
  bags: number;
  rate: Dec | string;
  rateUnit: Unit;
  bagWeightKg?: Dec | string | null;
  commodityId: string;
  date: Date;
  rules: readonly RuleLike[];
}): SaleComputation {
  if (input.weightKg.lte(0)) throw new CalcError('INVALID_INPUT', 'Weight must be greater than zero');
  const grossAmount = amountFor(input.weightKg, input.rate, input.rateUnit, input.bagWeightKg);
  const charges = resolveRules(input.rules, { side: 'BUYER', commodityId: input.commodityId, date: input.date })
    .map((r) => applyRule(r, { grossAmount, weightKg: input.weightKg, bags: input.bags }))
    .filter((c) => !c.amount.isZero());
  const chargesTotal = charges.reduce((s, c) => s.plus(c.amount), ZERO);
  return { weightKg: input.weightKg, grossAmount, charges, chargesTotal, totalAmount: grossAmount.plus(chargesTotal) };
}

// ------------------------------------------------------------------ patti (farmer side)

export interface PattiLineInput {
  id: string;
  commodityId: string;
  weightKg: Dec;
  bags: number;
  grossAmount: Dec;
}

export interface PattiComputation {
  totalWeightKg: Dec;
  totalBags: number;
  grossAmount: Dec;
  deductions: ChargeLine[];
  totalDeductions: Dec;
  netAmount: Dec;
  advanceAdjusted: Dec;
  roundOff: Dec;
  netPayable: Dec;
  /** What the farmer ledger is credited with: netAmount + roundOff. */
  ledgerCredit: Dec;
}

/**
 * Settlement for one farmer.
 *  - Percentage / per-weight / per-bag rules are computed per commodity group (rates can differ by commodity),
 *    then merged per rule into one printed line.
 *  - FIXED rules apply once per patti.
 *  - advanceAdjusted = min(outstanding advance, net) — informational netting; the advance was already debited
 *    to the ledger when paid, so it is NOT debited again.
 *  - Optional round-off to the nearest rupee is applied to the payable and shown as its own line.
 */
export function computePatti(input: {
  lines: readonly PattiLineInput[];
  rules: readonly RuleLike[];
  manualDeductions: readonly { label: string; labelHindi?: string | null; amount: Dec | string }[];
  date: Date;
  outstandingAdvance: Dec;
  autoAdjustAdvance: boolean;
  netRounding: 'NONE' | 'NEAREST_RUPEE';
}): PattiComputation {
  if (input.lines.length === 0) throw new CalcError('INVALID_INPUT', 'A patti needs at least one purchase');
  if (input.outstandingAdvance.isNegative()) throw new CalcError('INVALID_INPUT', 'Outstanding advance cannot be negative');

  const grossAmount = input.lines.reduce((s, l) => s.plus(l.grossAmount), ZERO);
  const totalWeightKg = input.lines.reduce((s, l) => s.plus(l.weightKg), ZERO);
  const totalBags = input.lines.reduce((s, l) => s + l.bags, 0);

  // Group by commodity
  const groups = new Map<string, ChargeBase>();
  for (const l of input.lines) {
    const g = groups.get(l.commodityId) ?? { grossAmount: ZERO, weightKg: ZERO, bags: 0 };
    groups.set(l.commodityId, { grossAmount: g.grossAmount.plus(l.grossAmount), weightKg: g.weightKg.plus(l.weightKg), bags: g.bags + l.bags });
  }

  const merged = new Map<string, ChargeLine>();
  const fixedApplied = new Set<string>();
  for (const [commodityId, base] of groups) {
    for (const rule of resolveRules(input.rules, { side: 'FARMER', commodityId, date: input.date })) {
      if (rule.calcMethod === 'FIXED') {
        if (fixedApplied.has(rule.id)) continue;
        fixedApplied.add(rule.id);
      }
      const line = applyRule(rule, base);
      const prev = merged.get(rule.id);
      merged.set(
        rule.id,
        prev ? { ...prev, baseValue: prev.baseValue.plus(line.baseValue), amount: prev.amount.plus(line.amount) } : line,
      );
    }
  }

  const deductions: ChargeLine[] = [...merged.values()].filter((d) => !d.amount.isZero());
  for (const m of input.manualDeductions) {
    const amount = money(new D(m.amount));
    if (amount.lte(0)) throw new CalcError('INVALID_INPUT', 'Manual deduction must be greater than zero');
    deductions.push({
      ruleId: null,
      chargeType: 'OTHER',
      calcMethod: 'FIXED',
      rateValue: amount,
      baseValue: new D(1),
      amount,
      label: m.label,
      labelHindi: m.labelHindi ?? null,
      isManual: true,
    });
  }

  const totalDeductions = deductions.reduce((s, d) => s.plus(d.amount), ZERO);
  if (totalDeductions.gt(grossAmount)) throw new CalcError('EXCESSIVE_DEDUCTIONS', 'Deductions exceed gross amount');

  const netAmount = grossAmount.minus(totalDeductions);
  const advanceAdjusted = input.autoAdjustAdvance ? D.min(input.outstandingAdvance, netAmount) : ZERO;
  const payable = netAmount.minus(advanceAdjusted);
  const rounded = input.netRounding === 'NEAREST_RUPEE' ? payable.toDecimalPlaces(0, D.ROUND_HALF_UP) : payable;
  const roundOff = rounded.minus(payable);

  return {
    totalWeightKg,
    totalBags,
    grossAmount,
    deductions,
    totalDeductions,
    netAmount,
    advanceAdjusted,
    roundOff,
    netPayable: rounded,
    ledgerCredit: netAmount.plus(roundOff),
  };
}
