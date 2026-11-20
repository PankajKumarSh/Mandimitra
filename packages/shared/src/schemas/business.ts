import { z } from 'zod';
import { gstinSchema, mobileSchema, optionalText, pincodeSchema } from './common.ts';

export const updateBusinessSchema = z
  .object({
    name: z.string().trim().min(2).max(150),
    nameHindi: optionalText(150).nullable(),
    mandiName: optionalText(150).nullable(),
    licenseNumber: optionalText(60).nullable(),
    gstin: gstinSchema.nullable(),
    phone: mobileSchema.nullable(),
    email: z.email().max(254).nullable(),
    addressLine: optionalText(300).nullable(),
    city: optionalText(80).nullable(),
    district: optionalText(80).nullable(),
    state: optionalText(80).nullable(),
    pincode: pincodeSchema.nullable(),
  })
  .partial()
  .strict();

export const updateSettingsSchema = z
  .object({
    tradingMode: z.enum(['COMMISSION_AGENT', 'TRADER', 'MIXED']),
    defaultRateUnit: z.enum(['KG', 'QUINTAL', 'TON', 'BAG']),
    fiscalYearStartMonth: z.number().int().min(1).max(12),
    netRounding: z.enum(['NONE', 'NEAREST_RUPEE']),
    pattiLanguage: z.enum(['HI', 'EN', 'BILINGUAL']),
    pattiFooterNote: z.string().trim().max(500).nullable(),
    requireApprovalForCancel: z.boolean(),
    allowNegativeFarmerBalance: z.boolean(),
    autoAdjustAdvanceInPatti: z.boolean(),
  })
  .partial()
  .strict();
