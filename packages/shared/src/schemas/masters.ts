import { z } from 'zod';
import { gstinSchema, mobileSchema, optionalText, paginationSchema } from './common.ts';

/**
 * Money and weight travel as STRINGS end-to-end ("125000.50"), never JS numbers,
 * so no float rounding can happen in forms or JSON.
 */
export const moneySchema = z
  .string()
  .trim()
  .regex(/^-?\d{1,12}(\.\d{1,2})?$/, 'Enter a valid amount (up to 2 decimals)');
export const nonNegativeMoneySchema = moneySchema.refine((v) => !v.startsWith('-'), 'Amount cannot be negative');
export const positiveWeightSchema = z
  .string()
  .trim()
  .regex(/^\d{1,11}(\.\d{1,3})?$/, 'Enter a valid weight (up to 3 decimals)')
  .refine((v) => Number(v) > 0, 'Weight must be greater than zero');

export const consentSchema = z.enum(['UNKNOWN', 'OPTED_IN', 'OPTED_OUT']);
export const quantityUnitSchema = z.enum(['KG', 'QUINTAL', 'TON', 'BAG']);
const nullableText = (max: number) => z.string().trim().max(max).nullable().optional();
const optionalMobile = mobileSchema.nullable().optional();
const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);

// ------------------------------------------------------------------ farmers

const farmerFields = {
  name: z.string().trim().min(1, 'Name is required').max(120),
  nameHindi: nullableText(120),
  fatherName: nullableText(120),
  mobile: optionalMobile,
  village: nullableText(100),
  tehsil: nullableText(100),
  district: nullableText(100),
  state: nullableText(80),
  address: nullableText(300),
  notes: nullableText(2000),
  whatsappConsent: consentSchema.optional(),
};

export const createFarmerSchema = z
  .object({ ...farmerFields, openingBalance: moneySchema.optional() })
  .strict();
export type CreateFarmerInput = z.infer<typeof createFarmerSchema>;

/** Opening balance is create-only; later changes go through ledger adjustments (Phase 5). */
export const updateFarmerSchema = z
  .object({ ...farmerFields, isActive: z.boolean() })
  .partial()
  .strict();
export type UpdateFarmerInput = z.infer<typeof updateFarmerSchema>;

export const farmerListQuerySchema = paginationSchema.extend({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  village: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  district: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  isActive: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  sort: z.enum(['name', '-name', 'code', '-code', 'createdAt', '-createdAt', 'balance', '-balance']).default('name'),
});
export type FarmerListQuery = z.infer<typeof farmerListQuerySchema>;

export const createBankAccountSchema = z
  .object({
    accountHolderName: z.string().trim().min(1).max(120),
    accountNumber: z.string().trim().regex(/^\d{9,18}$/, 'Account number must be 9–18 digits'),
    ifsc: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'),
    bankName: nullableText(120),
    upiId: z
      .string()
      .trim()
      .regex(/^[\w.-]{2,256}@[a-zA-Z]{2,64}$/, 'Invalid UPI ID')
      .nullable()
      .optional(),
    isPrimary: z.boolean().optional(),
  })
  .strict();
export type CreateBankAccountInput = z.infer<typeof createBankAccountSchema>;

// ------------------------------------------------------------------ buyers

const buyerFields = {
  firmName: z.string().trim().min(1, 'Firm name is required').max(150),
  ownerName: nullableText(120),
  mobile: optionalMobile,
  address: nullableText(300),
  city: nullableText(100),
  gstin: gstinSchema.nullable().optional(),
  creditLimit: nonNegativeMoneySchema.nullable().optional(),
  notes: nullableText(2000),
  whatsappConsent: consentSchema.optional(),
};

export const createBuyerSchema = z.object({ ...buyerFields, openingBalance: moneySchema.optional() }).strict();
export type CreateBuyerInput = z.infer<typeof createBuyerSchema>;
export const updateBuyerSchema = z.object({ ...buyerFields, isActive: z.boolean() }).partial().strict();
export type UpdateBuyerInput = z.infer<typeof updateBuyerSchema>;

export const buyerListQuerySchema = paginationSchema.extend({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  city: z.preprocess(emptyToUndefined, z.string().trim().max(100).optional()),
  isActive: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  hasOutstanding: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  sort: z.enum(['firmName', '-firmName', 'code', '-code', 'createdAt', '-createdAt', 'balance', '-balance']).default('firmName'),
});
export type BuyerListQuery = z.infer<typeof buyerListQuerySchema>;

// ------------------------------------------------------------------ commodities

const commodityFields = {
  name: z.string().trim().min(1).max(80),
  nameHindi: nullableText(80),
  defaultUnit: quantityUnitSchema,
  rateUnit: quantityUnitSchema,
  bagWeightKg: positiveWeightSchema.nullable().optional(),
  sortOrder: z.number().int().min(0).max(10_000),
};

const bagRule = (v: { defaultUnit?: string; rateUnit?: string; bagWeightKg?: string | null }) =>
  !(v.defaultUnit === 'BAG' || v.rateUnit === 'BAG') || !!v.bagWeightKg;
const bagMsg = { message: 'Bag weight is required when the unit is BAG', path: ['bagWeightKg'] };

export const createCommoditySchema = z
  .object({ ...commodityFields, defaultUnit: quantityUnitSchema.default('QUINTAL'), rateUnit: quantityUnitSchema.default('QUINTAL'), sortOrder: commodityFields.sortOrder.default(0) })
  .strict()
  .refine(bagRule, bagMsg);
export type CreateCommodityInput = z.infer<typeof createCommoditySchema>;

export const updateCommoditySchema = z
  .object({ ...commodityFields, isActive: z.boolean() })
  .partial()
  .strict();
export type UpdateCommodityInput = z.infer<typeof updateCommoditySchema>;

export const commodityGradeSchema = z.object({ name: z.string().trim().min(1).max(50) }).strict();
export const updateGradeSchema = z.object({ isActive: z.boolean() }).strict();

// ------------------------------------------------------------------ dashboard

export const dateStringSchema = z.iso.date();
export const dateRangeQuerySchema = z
  .object({
    range: z.enum(['today', 'yesterday', 'week', 'month', 'custom']).default('today'),
    from: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
    to: z.preprocess(emptyToUndefined, dateStringSchema.optional()),
  })
  .refine((v) => v.range !== 'custom' || (v.from && v.to), { message: 'from and to are required for a custom range' })
  .refine((v) => !v.from || !v.to || v.from <= v.to, { message: 'from must be on or before to' });
export type DateRangeQuery = z.infer<typeof dateRangeQuerySchema>;

export { optionalText };
