import { z } from 'zod';
import { ASSIGNABLE_ROLE_KEYS } from '../permissions.ts';
import { mobileSchema, nameSchema, optionalText, passwordSchema } from './common.ts';

export const registerSchema = z.object({
  fullName: nameSchema,
  mobile: mobileSchema,
  email: z.email().max(254).optional(),
  password: passwordSchema,
  preferredLanguage: z.enum(['HI', 'EN']).default('HI'),
  business: z.object({
    name: z.string().trim().min(2).max(150),
    nameHindi: optionalText(150),
    mandiName: optionalText(150),
    district: optionalText(80),
    state: optionalText(80),
  }),
});
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  mobile: mobileSchema,
  password: z.string().min(1).max(128),
  businessId: z.uuid().optional(),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const switchBusinessSchema = z.object({ businessId: z.uuid() });

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: passwordSchema,
});

export const createInviteSchema = z.object({
  mobile: mobileSchema,
  fullName: optionalText(120),
  roleKey: z.enum(ASSIGNABLE_ROLE_KEYS),
});

export const acceptInviteSchema = z.object({
  fullName: nameSchema.optional(),
  password: passwordSchema,
});

export const updateMembershipSchema = z
  .object({
    roleKey: z.enum(ASSIGNABLE_ROLE_KEYS).optional(),
    status: z.enum(['ACTIVE', 'DEACTIVATED']).optional(),
  })
  .refine((v) => v.roleKey !== undefined || v.status !== undefined, {
    message: 'Provide roleKey or status',
  });
