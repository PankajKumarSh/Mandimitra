import { z } from 'zod';
import { paginationSchema } from './common.ts';
import { dateStringSchema } from './masters.ts';
import { positiveMoneySchema } from './operations.ts';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalDate = z.preprocess(emptyToUndefined, dateStringSchema.optional());
const optionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());

export const paymentModeSchema = z.enum(['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE']);

/**
 * Farmer side: ADVANCE (before/without a patti) or SETTLEMENT (paying a patti balance) — money goes OUT.
 * Buyer side:  COLLECTION — money comes IN.
 */
export const createPaymentSchema = z
  .discriminatedUnion('partySide', [
    z.object({ partySide: z.literal('FARMER'), farmerId: z.uuid(), purpose: z.enum(['ADVANCE', 'SETTLEMENT']) }),
    z.object({ partySide: z.literal('BUYER'), buyerId: z.uuid(), purpose: z.literal('COLLECTION').default('COLLECTION') }),
  ])
  .and(
    z.object({
      mode: paymentModeSchema,
      amount: positiveMoneySchema,
      paymentDate: dateStringSchema,
      referenceNumber: z.string().trim().max(60).nullable().optional(),
      remarks: z.string().trim().max(300).nullable().optional(),
    }),
  )
  .refine((v) => v.mode !== 'CHEQUE' || !!v.referenceNumber, { message: 'Cheque number is required', path: ['referenceNumber'] });
export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;

export const paymentListQuerySchema = paginationSchema.extend({
  partySide: z.preprocess(emptyToUndefined, z.enum(['FARMER', 'BUYER']).optional()),
  farmerId: optionalUuid,
  buyerId: optionalUuid,
  mode: z.preprocess(emptyToUndefined, paymentModeSchema.optional()),
  status: z.preprocess(emptyToUndefined, z.enum(['ACTIVE', 'CANCELLED']).optional()),
  from: optionalDate,
  to: optionalDate,
});
export type PaymentListQuery = z.infer<typeof paymentListQuerySchema>;

// ------------------------------------------------------------------ expenses

export const createExpenseSchema = z
  .object({
    categoryId: z.uuid(),
    expenseDate: dateStringSchema,
    amount: positiveMoneySchema,
    mode: paymentModeSchema.default('CASH'),
    payee: z.string().trim().max(120).nullable().optional(),
    referenceNumber: z.string().trim().max(60).nullable().optional(),
    remarks: z.string().trim().max(300).nullable().optional(),
  })
  .strict();
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const expenseListQuerySchema = paginationSchema.extend({
  categoryId: optionalUuid,
  status: z.preprocess(emptyToUndefined, z.enum(['ACTIVE', 'CANCELLED']).optional()),
  from: optionalDate,
  to: optionalDate,
});
export type ExpenseListQuery = z.infer<typeof expenseListQuerySchema>;

export const expenseCategorySchema = z
  .object({ name: z.string().trim().min(1).max(80), nameHindi: z.string().trim().max(80).nullable().optional() })
  .strict();
export const updateExpenseCategorySchema = expenseCategorySchema.partial().extend({ isActive: z.boolean().optional() }).strict();

// ------------------------------------------------------------------ ledger & reports

export const statementQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    format: z.preprocess(emptyToUndefined, z.enum(['json', 'html', 'pdf']).default('json')),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['from'] });
export type StatementQuery = z.infer<typeof statementQuerySchema>;

export const REPORT_KEYS = [
  'daily-arrivals',
  'purchases',
  'sales',
  'farmer-outstanding',
  'buyer-outstanding',
  'commission',
  'expenses',
  'stock',
  'monthly-summary',
  'commodity-wise',
] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];

export const reportQuerySchema = z
  .object({
    from: optionalDate,
    to: optionalDate,
    format: z.preprocess(emptyToUndefined, z.enum(['json', 'html', 'pdf', 'xlsx']).default('json')),
    lang: z.preprocess(emptyToUndefined, z.enum(['hi', 'en']).default('hi')),
  })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to', path: ['from'] });
export type ReportQuery = z.infer<typeof reportQuerySchema>;
