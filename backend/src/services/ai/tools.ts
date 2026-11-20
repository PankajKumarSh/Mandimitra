/**
 * MandiMitra Assistant tools.
 *
 * Safety properties (enforced here, not by the prompt):
 *  1. READ-ONLY. There is no tool that creates, edits or cancels anything. Financial writes only happen
 *     through the normal validated endpoints after a human confirms a draft.
 *  2. TENANT-SCOPED. Every executor receives the caller's TenantContext and queries through t.db /
 *     businessId-bound services — the model never supplies a businessId.
 *  3. PERMISSION-FILTERED. A tool is offered only if the caller holds its permission (a VIEWER's assistant
 *     sees exactly what the VIEWER may see), and each executor re-checks.
 *  4. MINIMAL DATA. Results carry only fields needed to answer (no bank details, no audit data).
 *  5. ALL ARITHMETIC IN THE ENGINE. Totals come from SQL/Decimal; `calculate_amount` wraps the calc engine.
 */
import type { BetaTool } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { Prisma } from '@mandimitra/database';
import type { PermissionKey } from '@mandimitra/shared';
import type { TenantContext } from '../../middleware/tenant.ts';
import { amountFor, CalcError, toKg } from '../calculation/engine.ts';
import type { ReportService } from '../report.service.ts';
import type { StatementService } from '../statement.service.ts';

const DATE = { type: 'string', description: 'Date as YYYY-MM-DD (IST business date).' } as const;
const UNIT = { type: 'string', enum: ['KG', 'QUINTAL', 'TON', 'BAG'] } as const;
const contains = (v: string) => ({ contains: v, mode: 'insensitive' as const });
const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);

export interface ToolDeps {
  reports: ReportService;
  statements: StatementService;
}

interface ToolDef {
  permission: PermissionKey;
  tool: BetaTool;
  run: (t: TenantContext, input: Record<string, unknown>, deps: ToolDeps) => Promise<unknown>;
}

const strict = (name: string, description: string, properties: Record<string, unknown>): BetaTool => ({
  name,
  description,
  strict: true,
  input_schema: { type: 'object', properties, required: Object.keys(properties), additionalProperties: false },
});

export class ToolInputError extends Error {}

const TOOLS: ToolDef[] = [
  {
    permission: 'farmer:read',
    tool: strict(
      'search_farmers',
      'Find farmers by name (English or Hindi), father’s name, village, code (F-00012) or mobile digits. Returns up to 8 matches with current balance. Balance > 0 means the business owes the farmer; < 0 means the farmer holds an advance.',
      { query: { type: 'string', description: 'Name, village, code or mobile digits as the user said it.' } },
    ),
    run: async (t, input) => {
      const q = String(input.query ?? '').trim().slice(0, 60);
      if (!q) throw new ToolInputError('query is empty');
      const digits = q.replace(/\s/g, '');
      const rows = await t.db.farmer.findMany({
        where: {
          deletedAt: null,
          OR: [
            { name: contains(q) },
            { nameHindi: contains(q) },
            { fatherName: contains(q) },
            { village: contains(q) },
            { code: contains(q) },
            ...(/^\d{4,}$/.test(digits) ? [{ mobile: { contains: digits } }] : []),
          ],
        },
        select: { id: true, code: true, name: true, nameHindi: true, fatherName: true, village: true, currentBalance: true },
        orderBy: { name: 'asc' },
        take: 8,
      });
      return rows.map((f) => ({ ...f, currentBalance: f.currentBalance.toFixed(2) }));
    },
  },
  {
    permission: 'buyer:read',
    tool: strict(
      'search_buyers',
      'Find buyers/traders by firm name, owner, city, code (B-00003) or GSTIN. Returns up to 8 matches. currentBalance > 0 means the buyer owes the business.',
      { query: { type: 'string', description: 'Firm/owner name, city or code.' } },
    ),
    run: async (t, input) => {
      const q = String(input.query ?? '').trim().slice(0, 60);
      if (!q) throw new ToolInputError('query is empty');
      const rows = await t.db.buyer.findMany({
        where: { deletedAt: null, OR: [{ firmName: contains(q) }, { ownerName: contains(q) }, { city: contains(q) }, { code: contains(q) }, { gstin: contains(q) }] },
        select: { id: true, code: true, firmName: true, ownerName: true, city: true, currentBalance: true, creditLimit: true },
        orderBy: { firmName: 'asc' },
        take: 8,
      });
      return rows.map((b) => ({ ...b, currentBalance: b.currentBalance.toFixed(2), creditLimit: b.creditLimit?.toFixed(2) ?? null }));
    },
  },
  {
    permission: 'ledger:read',
    tool: strict(
      'party_account',
      'Account of ONE farmer or buyer (use an id returned by search_farmers / search_buyers): current balance, unbilled purchases (farmers) and the last 8 ledger entries.',
      { party_type: { type: 'string', enum: ['farmer', 'buyer'] }, id: { type: 'string', description: 'UUID from a search result.' } },
    ),
    run: async (t, input, deps) => {
      const id = String(input.id ?? '');
      if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ToolInputError('id must be a UUID from a search result');
      const side = input.party_type === 'buyer' ? 'buyer' : 'farmer';
      const s = await deps.statements.statement(t, side, id); // tenant-scoped; 404 for other businesses
      let unbilled: string | null = null;
      if (side === 'farmer') {
        const agg = await t.db.purchase.aggregate({ where: { farmerId: id, status: 'ACTIVE', pattiId: null }, _sum: { grossAmount: true } });
        unbilled = (agg._sum.grossAmount ?? new Prisma.Decimal(0)).toFixed(2);
      }
      return {
        party: side === 'farmer' ? { code: s.party.code, name: (s.party as { name: string }).name } : { code: s.party.code, firmName: (s.party as { firmName: string }).firmName },
        currentBalance: s.currentBalance,
        unbilledPurchases: unbilled,
        lastEntries: s.entries.slice(-8).map((e) => ({ date: e.date, type: e.type, ref: e.ref, debit: e.debit, credit: e.credit, balance: e.balance })),
      };
    },
  },
  {
    permission: 'report:read',
    tool: strict(
      'business_summary',
      'Business totals for a date range: gross sales (value of farmers’ produce — NOT profit), purchases, commission income, expenses, commission income minus expenses, payments, and current receivables/payables/advances.',
      { from: DATE, to: DATE },
    ),
    run: async (t, input, deps) => {
      if (!isDate(input.from) || !isDate(input.to) || input.from > input.to) throw new ToolInputError('from/to must be YYYY-MM-DD with from <= to');
      const r = await deps.reports.run(t, 'monthly-summary', input.from, input.to);
      return { from: r.from, to: r.to, lines: r.rows.map((x) => ({ item: x.metric, amount: x.amount })) };
    },
  },
  {
    permission: 'report:read',
    tool: strict(
      'sales_by_commodity',
      'Per-commodity arrivals (kg), sold weight (kg), gross sales and weighted average rate per quintal for a date range. Use for questions like "aaj kitni gehun ki sale hui".',
      { from: DATE, to: DATE },
    ),
    run: async (t, input, deps) => {
      if (!isDate(input.from) || !isDate(input.to) || input.from > input.to) throw new ToolInputError('from/to must be YYYY-MM-DD with from <= to');
      const r = await deps.reports.run(t, 'commodity-wise', input.from, input.to);
      return { from: r.from, to: r.to, rows: r.rows, totals: r.totals };
    },
  },
  {
    permission: 'report:read',
    tool: strict(
      'pending_buyer_payments',
      'Buyers who owe money, largest first, with ageing buckets (0–30, 31–60, 61–90, 90+ days). Use for "kitne buyers ka payment pending hai".',
      { limit: { type: 'integer', description: 'How many to return (1–20).' } },
    ),
    run: async (t, input, deps) => {
      const limit = Math.min(20, Math.max(1, Number(input.limit) || 10));
      const r = await deps.reports.run(t, 'buyer-outstanding');
      return { buyersWithDues: r.rows.length, totalOutstanding: r.totals?.outstanding, top: r.rows.slice(0, limit) };
    },
  },
  {
    permission: 'report:read',
    tool: strict(
      'farmers_to_pay',
      'Farmers the business owes money to (largest first) and farmers holding advances, plus unbilled purchases.',
      { limit: { type: 'integer', description: 'How many to return (1–20).' } },
    ),
    run: async (t, input, deps) => {
      const limit = Math.min(20, Math.max(1, Number(input.limit) || 10));
      const r = await deps.reports.run(t, 'farmer-outstanding');
      return { count: r.rows.length, totals: r.totals, top: r.rows.slice(0, limit) };
    },
  },
  {
    permission: 'ai:query',
    tool: strict(
      'calculate_amount',
      'Exact amount for a quantity at a rate (decimal arithmetic, rounded to the paisa). ALWAYS use this instead of doing arithmetic yourself, e.g. "50 quintal ka 2500 rate se total".',
      {
        quantity: { type: 'string', description: 'Decimal number as a string, e.g. "50" or "12.5".' },
        unit: UNIT,
        rate: { type: 'string', description: 'Rate in rupees as a string, e.g. "2500".' },
        rate_unit: UNIT,
      },
    ),
    run: async (_t, input) => {
      const qty = String(input.quantity ?? '');
      const rate = String(input.rate ?? '');
      if (!/^\d{1,11}(\.\d{1,3})?$/.test(qty) || !/^\d{1,10}(\.\d{1,2})?$/.test(rate)) throw new ToolInputError('quantity/rate must be plain decimal strings');
      const unit = String(input.unit) as 'KG' | 'QUINTAL' | 'TON' | 'BAG';
      const rateUnit = String(input.rate_unit) as 'KG' | 'QUINTAL' | 'TON' | 'BAG';
      if (unit === 'BAG' || rateUnit === 'BAG') throw new ToolInputError('BAG needs a commodity bag weight; convert to KG or QUINTAL first');
      try {
        const kg = toKg(qty, unit);
        return { weightKg: kg.toFixed(3), amount: amountFor(kg, rate, rateUnit).toFixed(2) };
      } catch (e) {
        if (e instanceof CalcError) throw new ToolInputError(e.message);
        throw e;
      }
    },
  },
];

/** Tools this caller may use. Sorted by name for a stable, cacheable request prefix. */
export function toolsFor(t: TenantContext): ToolDef[] {
  return TOOLS.filter((d) => t.permissions.has(d.permission)).sort((a, b) => a.tool.name.localeCompare(b.tool.name));
}

export async function runTool(t: TenantContext, name: string, input: unknown, deps: ToolDeps): Promise<{ ok: boolean; result: unknown }> {
  const def = toolsFor(t).find((d) => d.tool.name === name);
  if (!def) return { ok: false, result: { error: `Tool ${name} is not available to this user` } };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, result: { error: 'Invalid input' } };
  try {
    return { ok: true, result: await def.run(t, input as Record<string, unknown>, deps) };
  } catch (e) {
    if (e instanceof ToolInputError) return { ok: false, result: { error: e.message } };
    const status = (e as { status?: number }).status;
    if (status === 404) return { ok: false, result: { error: 'Not found in this business' } };
    throw e;
  }
}
