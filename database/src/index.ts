import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.ts';

export * from '../generated/prisma/client.ts';

export interface CreatePrismaOptions {
  /** Max pool connections (pg Pool). */
  max?: number;
}

/** Prisma 7 requires a driver adapter; this is the only place a client is constructed. */
export function createPrismaClient(connectionString: string, opts: CreatePrismaOptions = {}): PrismaClient {
  const adapter = new PrismaPg({ connectionString, max: opts.max ?? 10 });
  return new PrismaClient({ adapter });
}
