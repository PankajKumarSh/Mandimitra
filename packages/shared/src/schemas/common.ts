import { z } from 'zod';

/**
 * Indian mobile number → E.164 (+91XXXXXXXXXX).
 * Accepts "98123 45678", "098123-45678", "+91 9812345678", "919812345678".
 */
export const mobileSchema = z
  .string()
  .trim()
  .transform((raw, ctx) => {
    const digits = raw.replace(/[\s()-]/g, '');
    const m = /^(?:\+91|91|0)?([6-9]\d{9})$/.exec(digits);
    if (!m) {
      ctx.addIssue({ code: 'custom', message: 'Enter a valid 10-digit Indian mobile number' });
      return z.NEVER;
    }
    return `+91${m[1]}`;
  });

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password is too long');

export const nameSchema = z.string().trim().min(1).max(120);
export const optionalText = (max: number) => z.string().trim().max(max).optional();

export const uuidSchema = z.uuid();
export const idParamSchema = z.object({ id: z.uuid() });

export const gstinSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Invalid GSTIN');

export const pincodeSchema = z.string().trim().regex(/^[1-9]\d{5}$/, 'Invalid PIN code');

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
