import { z } from 'zod';
import { paginationSchema } from './common.ts';

export const askSchema = z
  .object({
    conversationId: z.uuid().optional(),
    text: z.string().trim().min(1, 'Ask something').max(1000),
    inputMode: z.enum(['TEXT', 'VOICE']).default('TEXT'),
  })
  .strict();
export type AskInput = z.infer<typeof askSchema>;

/** Voice transcript / typed text and/or a photo (base64, ≤ 5 MB decoded). */
export const extractSchema = z
  .object({
    text: z.string().trim().max(2000).optional(),
    imageBase64: z
      .string()
      .max(7_000_000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Invalid image data')
      .optional(),
    imageMediaType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
    source: z.enum(['VOICE', 'TEXT', 'IMAGE']),
  })
  .strict()
  .refine((v) => !!v.text || !!v.imageBase64, { message: 'Provide text or an image', path: ['text'] })
  .refine((v) => !v.imageBase64 || !!v.imageMediaType, { message: 'imageMediaType is required with an image', path: ['imageMediaType'] });
export type ExtractInput = z.infer<typeof extractSchema>;

export const confirmDraftSchema = z.object({ entityType: z.enum(['Lot', 'Sale', 'Payment', 'Expense']), entityId: z.uuid() }).strict();
export const reminderSchema = z.object({ buyerId: z.uuid() }).strict();

export const whatsappSendSchema = z
  .object({
    kind: z.enum(['PATTI', 'STATEMENT', 'RECEIPT', 'REMINDER']),
    entityId: z.uuid().optional(),
    farmerId: z.uuid().optional(),
    buyerId: z.uuid().optional(),
  })
  .strict()
  .refine((v) => (v.kind === 'PATTI' || v.kind === 'RECEIPT' ? !!v.entityId : true), { message: 'entityId is required', path: ['entityId'] })
  .refine((v) => (v.kind === 'STATEMENT' ? !!v.farmerId !== !!v.buyerId : true), { message: 'Give exactly one of farmerId / buyerId', path: ['farmerId'] })
  .refine((v) => (v.kind === 'REMINDER' ? !!v.buyerId : true), { message: 'buyerId is required', path: ['buyerId'] });
export type WhatsAppSendInput = z.infer<typeof whatsappSendSchema>;

export const messageListQuerySchema = paginationSchema.extend({
  farmerId: z.uuid().optional(),
  buyerId: z.uuid().optional(),
});
