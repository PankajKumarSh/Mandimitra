import { z } from 'zod';
import { paginationSchema } from './common.ts';

export const PLAN_CODES = ['STARTER', 'PROFESSIONAL', 'BUSINESS'] as const;
export const planCodeSchema = z.enum(PLAN_CODES);

export const checkoutSchema = z.object({ planCode: planCodeSchema }).strict();
export const changePlanSchema = z.object({ planCode: planCodeSchema }).strict();

/** Returned by Razorpay Checkout's success handler; verified server-side before anything changes. */
export const verifyPaymentSchema = z
  .object({
    orderId: z.string().trim().min(1).max(100),
    paymentId: z.string().trim().min(1).max(100),
    signature: z.string().trim().regex(/^[a-f0-9]{64}$/i, 'Invalid signature'),
  })
  .strict();

export const mockCompleteSchema = z.object({ orderId: z.string().trim().min(1).max(100) }).strict();

// ------------------------------------------------------------------ platform admin

export const BUSINESS_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'CLOSED'] as const;
export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED', 'SUSPENDED'] as const;

export const adminBusinessListSchema = paginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  status: z.enum(BUSINESS_STATUSES).optional(),
  subscriptionStatus: z.enum(SUBSCRIPTION_STATUSES).optional(),
});

export const adminReasonSchema = z.object({ reason: z.string().trim().min(3).max(300) }).strict();

export const adminExtendSchema = z
  .object({ days: z.coerce.number().int().min(1).max(90), reason: z.string().trim().min(3).max(300) })
  .strict();

export const adminPaymentListSchema = paginationSchema.extend({
  status: z.enum(['CREATED', 'PENDING', 'SUCCEEDED', 'FAILED', 'REFUNDED']).optional(),
});
