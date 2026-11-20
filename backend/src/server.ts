import { createPrismaClient } from '@mandimitra/database';
import { createApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { createLogger } from './config/logger.ts';
import { flushSentry, initSentry } from './config/sentry.ts';
import { startJobs } from './jobs/runtime.ts';
import type { JobQueue } from './jobs/queue.ts';

const env = loadEnv();
const logger = createLogger(env);
await initSentry(env, process.env.APP_VERSION);
const prisma = createPrismaClient(env.DATABASE_URL, { max: env.DB_POOL_MAX });

// Refuse to run on a database that cannot store Hindi (e.g. a Windows WIN1252 cluster).
const [enc] = await prisma.$queryRaw<{ server_encoding: string }[]>`SHOW server_encoding`;
if (enc?.server_encoding !== 'UTF8') {
  logger.fatal({ encoding: enc?.server_encoding }, 'Database must use UTF8 encoding');
  process.exit(1);
}

const { app, cache, services } = createApp({ env, prisma, logger });

// JOBS_MODE: inline → this process also runs jobs (dev / single server); worker → a separate
// `worker` process runs them and the API only enqueues; off → no queue (retries fall back to FAILED).
let queue: JobQueue | null = null;
if (env.JOBS_MODE !== 'off') {
  queue = await startJobs({ env, prisma, logger, whatsapp: services.whatsapp, cache, work: env.JOBS_MODE === 'inline' });
}

const server = app.listen(env.API_PORT, () => {
  logger.info({ port: env.API_PORT, env: env.NODE_ENV, jobs: env.JOBS_MODE, billing: env.BILLING_PROVIDER, storage: env.STORAGE_DRIVER, whatsapp: env.WHATSAPP_PROVIDER }, 'MandiMitra API listening');
});

const shutdown = (signal: string) => {
  logger.info({ signal }, 'Shutting down');
  server.close(async () => {
    await queue?.stop();
    await prisma.$disconnect();
    await flushSentry();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 25_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
