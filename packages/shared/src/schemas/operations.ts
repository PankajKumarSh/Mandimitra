import { z } from 'zod';
import { paginationSchema } from './common.ts';
import { dateStringSchema, positiveWeightSchema, quantityUnitSchema } from './masters.ts';

const emptyToUndefined = (v: unknown) => (v === '' ? undefined : v);
const optionalUuid = z.preprocess(emptyToUndefined, z.uuid().optional());
const optionalDate = z.preprocess(emptyToUndefined, dateStringSchema.optional());

export const weightSchema = z
  .string()
  .trim()
  .regex(/^\d{1,11}(\.\d{1,3})?$/, 'Enter a valid weight (up to 3 decimals)');
export const rateSchema = z
  .string()
  .trim()
  .regex(/^\d{1,10}(\.\d{1,2})?$/, 'Enter a valid rate (up to 2 decimals)')
  .refine((v) => Number(v) > 0, 'Rate must be greater than zero');
export const positiveMoneySchema = z
  .string()
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a valid amount (up to 2 decimals)')
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero');
export const ruleValueSchema = z
  .string()
  .trim()
  .regex(/^\d{1,8}(\.\d{1,4})?$/, 'Enter a valid value (up to 4 decimals)');

export const weighUnitSchema = z.enum(['KG', 'QUINTAL']);
export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason').max(500) }).strict();

// ------------------------------------------------------------------ lots

const lotFields = {
  farmerId: z.uuid(),
  commodityId: z.uuid(),
  gradeId: z.uuid().nullable().optional(),
  arrivalDate: dateStringSchema,
  vehicleNumber: z.string().trim().toUpperCase().max(20).nullable().optional(),
  bags: z.number().int().min(0).max(1_000_000),
  weightUnit: weighUnitSchema,
  grossWeight: positiveWeightSchema,
  tareWeight: weightSchema,
  moisturePercent: z
    .string()
    .trim()
    .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Invalid moisture')
    .refine((v) => Number(v) <= 100, 'Moisture cannot exceed 100%')
    .nullable()
    .optional(),
  remarks: z.string().trim().max(500).nullable().optional(),
};

export const createLotSchema = z
  .object({
    ...lotFields,
    bags: lotFields.bags.default(0),
    weightUnit: weighUnitSchema.default('KG'),
    tareWeight: weightSchema.default('0'),
    /** true = confirm immediately (normal flow); false = save as draft. */
    confirm: z.boolean().default(true),
  })
  .strict();
export type CreateLotInput = z.infer<typeof createLotSchema>;

/** Draft lots only. Weights must be sent together with their unit. */
export const updateLotSchema = z
  .object({ ...lotFields, version: z.number().int().min(0) })
  .partial()
  .required({ version: true })
  .strict()
  .refine((v) => (v.grossWeight === undefined && v.tareWeight === undefined) || v.weightUnit !== undefined, {
    message: 'weightUnit is required when changing weights',
    path: ['weightUnit'],
  });
export type UpdateLotInput = z.infer<typeof updateLotSchema>;

export const lotListQuerySchema = paginationSchema.extend({
  q: z.preprocess(emptyToUndefined, z.string().trim().max(40).optional()),
  status: z.preprocess(emptyToUndefined, z.enum(['DRAFT', 'CONFIRMED', 'PARTIALLY_SOLD', 'SOLD', 'CANCELLED', 'OPEN']).optional()),
  farmerId: optionalUuid,
  commodityId: optionalUuid,
  from: optionalDate,
  to: optionalDate,
});
export type LotListQuery = z.infer<typeof lotListQuerySchema>;

// ------------------------------------------------------------------ sales & purchases

export const createSaleSchema = z
  .object({
    lotId: z.uuid(),
    buyerId: z.uuid(),
    saleDate: dateStringSchema,
    weight: positiveWeightSchema,
    weightUnit: quantityUnitSchema.default('QUINTAL'),
    bags: z.number().int().min(0).max(1_000_000).default(0),
    rate: rateSchema,
    /** Defaults to the commodity's rate unit. */
    rateUnit: quantityUnitSchema.optional(),
    /** MIXED mode only: COMMISSION auto-creates the farmer purchase at the sale rate. */
    mode: z.enum(['COMMISSION', 'TRADE']).optional(),
  })
  .strict();
export type CreateSaleInput = z.infer<typeof createSaleSchema>;

export const createPurchaseSchema = z
  .object({
    lotId: z.uuid(),
    purchaseDate: dateStringSchema,
    weight: positiveWeightSchema,
    weightUnit: quantityUnitSchema.default('QUINTAL'),
    bags: z.number().int().min(0).max(1_000_000).default(0),
    rate: rateSchema,
    rateUnit: quantityUnitSchema.optional(),
  })
  .strict();
export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;

export const txnListQuerySchema = paginationSchema.extend({
  farmerId: optionalUuid,
  buyerId: optionalUuid,
  lotId: optionalUuid,
  commodityId: optionalUuid,
  status: z.preprocess(emptyToUndefined, z.enum(['ACTIVE', 'CANCELLED']).optional()),
  unbilled: z.preprocess(emptyToUndefined, z.stringbool().optional()),
  from: optionalDate,
  to: optionalDate,
});
export type TxnListQuery = z.infer<typeof txnListQuerySchema>;

// ------------------------------------------------------------------ patti

export const manualDeductionSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    labelHindi: z.string().trim().max(80).nullable().optional(),
    amount: positiveMoneySchema,
  })
  .strict();

export const pattiInputSchema = z
  .object({
    farmerId: z.uuid(),
    pattiDate: dateStringSchema,
    /** Omit to include every unbilled purchase of the farmer. */
    purchaseIds: z.array(z.uuid()).min(1).max(500).optional(),
    manualDeductions: z.array(manualDeductionSchema).max(10).default([]),
    notes: z.string().trim().max(500).nullable().optional(),
  })
  .strict();
export type PattiInput = z.infer<typeof pattiInputSchema>;

export const pattiListQuerySchema = paginationSchema.extend({
  farmerId: optionalUuid,
  status: z.preprocess(emptyToUndefined, z.enum(['FINALIZED', 'CANCELLED']).optional()),
  from: optionalDate,
  to: optionalDate,
});
export type PattiListQuery = z.infer<typeof pattiListQuerySchema>;

// ------------------------------------------------------------------ commission rules

export const chargeTypeSchema = z.enum(['COMMISSION', 'LABOUR', 'WEIGHING', 'TRANSPORT', 'MARKET_FEE', 'LOADING_UNLOADING', 'OTHER']);
export const calcMethodSchema = z.enum(['PERCENTAGE', 'FIXED', 'PER_QUINTAL', 'PER_KG', 'PER_BAG']);

const ruleFields = {
  name: z.string().trim().min(1).max(80),
  nameHindi: z.string().trim().max(80).nullable().optional(),
  chargeType: chargeTypeSchema,
  calcMethod: calcMethodSchema,
  value: ruleValueSchema,
  appliesTo: z.enum(['FARMER', 'BUYER']),
  commodityId: z.uuid().nullable().optional(),
  priority: z.number().int().min(0).max(1000),
  effectiveFrom: dateStringSchema,
  effectiveTo: dateStringSchema.nullable().optional(),
  isActive: z.boolean(),
};
const pctRule = (v: { calcMethod?: string; value?: string }) => v.calcMethod !== 'PERCENTAGE' || v.value === undefined || Number(v.value) <= 100;
const dateRule = (v: { effectiveFrom?: string; effectiveTo?: string | null }) => !v.effectiveFrom || !v.effectiveTo || v.effectiveFrom <= v.effectiveTo;

export const createRuleSchema = z
  .object({ ...ruleFields, appliesTo: ruleFields.appliesTo.default('FARMER'), priority: ruleFields.priority.default(0), isActive: ruleFields.isActive.default(true) })
  .strict()
  .refine(pctRule, { message: 'Percentage cannot exceed 100', path: ['value'] })
  .refine(dateRule, { message: 'End date must be on or after start date', path: ['effectiveTo'] });
export type CreateRuleInput = z.infer<typeof createRuleSchema>;

export const updateRuleSchema = z
  .object(ruleFields)
  .partial()
  .strict()
  .refine(pctRule, { message: 'Percentage cannot exceed 100', path: ['value'] })
  .refine(dateRule, { message: 'End date must be on or after start date', path: ['effectiveTo'] });
export type UpdateRuleInput = z.infer<typeof updateRuleSchema>;

// ------------------------------------------------------------------ calculator & approvals

export const calcAmountSchema = z
  .object({ quantity: positiveWeightSchema, unit: quantityUnitSchema, rate: rateSchema, rateUnit: quantityUnitSchema, commodityId: z.uuid().optional() })
  .strict();

export const approvalDecisionSchema = z.object({ note: z.string().trim().max(500).optional() }).strict();
export const approvalListQuerySchema = paginationSchema.extend({
  status: z.preprocess(emptyToUndefined, z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional()),
});
