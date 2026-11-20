import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  DB_POOL_MAX: z.coerce.number().int().positive().default(10),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  FIELD_ENCRYPTION_KEY: z
    .string()
    .refine((v) => Buffer.from(v, 'base64').length === 32, 'FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded'),
  JWT_ACCESS_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),

  WEB_ORIGIN: z.string().default('http://localhost:3000'),
  APP_URL: z.string().default('http://localhost:3000'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  RATE_LIMIT_ENABLED: z.stringbool().default(true),
  AUTH_RATE_LIMIT: z.coerce.number().int().positive().default(20), // per 15 min per IP
  TENANT_CACHE_TTL_MS: z.coerce.number().int().min(0).default(30_000),

  // --- AI (server-side only; the browser never sees the key) ---
  ANTHROPIC_API_KEY: z.string().optional(),
  AI_PROVIDER: z.enum(['anthropic', 'disabled']).optional(), // default: anthropic when a key is set
  AI_MODEL: z.string().default('claude-opus-5-5'),
  AI_EFFORT: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).default('medium'),
  AI_MAX_TOOL_ROUNDS: z.coerce.number().int().min(1).max(12).default(6),

  // --- WhatsApp Business Platform (Cloud API). "mock" until credentials exist. ---
  // 'disabled' = sending off (required choice in production when there are no Cloud API credentials).
  WHATSAPP_PROVIDER: z.enum(['mock', 'cloud', 'disabled']).default('mock'),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WHATSAPP_APP_SECRET: z.string().optional(),
  WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
  WHATSAPP_GRAPH_VERSION: z.string().default('v23.0'),

  // --- File storage: local disk (dev / single server) or any S3-compatible bucket ---
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('.uploads'),
  S3_ENDPOINT: z.string().optional(), // empty = AWS; set for R2 / MinIO / DigitalOcean Spaces
  S3_REGION: z.string().default('ap-south-1'),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: z.stringbool().default(false),

  // --- Billing (SaaS subscription payments). 'mock' = local test checkout, never allowed in production. ---
  BILLING_PROVIDER: z.enum(['mock', 'razorpay']).default('mock'),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  BILLING_PERIOD_DAYS: z.coerce.number().int().min(1).max(366).default(30),
  /** A lapsed paid plan stays PAST_DUE (read-only) this long before it is marked EXPIRED. */
  BILLING_GRACE_DAYS: z.coerce.number().int().min(0).max(90).default(15),

  // --- Background jobs (pg-boss, same database). inline = inside the API process; worker = separate process. ---
  JOBS_MODE: z.enum(['inline', 'worker', 'off']).default('inline'),

  // --- Error tracking (optional) ---
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
});

export type Env = z.infer<typeof envSchema> & { isProd: boolean; cookieSecure: boolean };

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production' && /change-me/i.test(env.JWT_ACCESS_SECRET)) {
    throw new Error('JWT_ACCESS_SECRET still has the placeholder value');
  }
  if (env.NODE_ENV === 'production') {
    // No simulated services in production: every message, payment and file must be real.
    if (env.WHATSAPP_PROVIDER === 'mock') throw new Error('WHATSAPP_PROVIDER=mock is not allowed in production (use cloud, or disabled)');
    if (env.BILLING_PROVIDER === 'mock') throw new Error('BILLING_PROVIDER=mock is not allowed in production (use razorpay)');
    if (!env.APP_URL.startsWith('https://')) throw new Error('APP_URL must be https:// in production');
  }
  if (env.BILLING_PROVIDER === 'razorpay') {
    for (const k of ['RAZORPAY_KEY_ID', 'RAZORPAY_KEY_SECRET', 'RAZORPAY_WEBHOOK_SECRET'] as const) {
      if (!env[k]) throw new Error(`BILLING_PROVIDER=razorpay requires ${k}`);
    }
  }
  if (env.STORAGE_DRIVER === 's3') {
    for (const k of ['S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'] as const) {
      if (!env[k]) throw new Error(`STORAGE_DRIVER=s3 requires ${k}`);
    }
  }
  if (env.WHATSAPP_PROVIDER === 'cloud') {
    for (const k of ['WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET', 'WHATSAPP_WEBHOOK_VERIFY_TOKEN'] as const) {
      if (!env[k]) throw new Error(`WHATSAPP_PROVIDER=cloud requires ${k}`);
    }
  }
  return {
    ...env,
    AI_PROVIDER: env.AI_PROVIDER ?? (env.ANTHROPIC_API_KEY ? 'anthropic' : 'disabled'),
    isProd: env.NODE_ENV === 'production',
    cookieSecure: env.NODE_ENV === 'production',
  };
}
