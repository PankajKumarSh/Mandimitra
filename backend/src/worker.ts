/**
 * Background worker (JOBS_MODE=worker on the API). Same image, different command: `node dist/worker.js`.
 * Runs the nightly subscription sweep, the ledger drift check and WhatsApp retries.
 */
import { createPrismaClient } from '@mandimitra/database';
import { createApp } from './app.ts';
import { loadEnv } from './config/env.ts';
import { createLogger } from './config/logger.ts';
import { flushSentry, initSentry } from './config/sentry.ts';
import { startJobs } from './jobs/runtime.ts';

const env = loadEnv();
const logger = createLogger(env).child({ proc: 'worker' });
await initSentry(env, process.env.APP_VERSION);
const prisma = createPrismaClient(env.DATABASE_URL, { max: 4 });

// Reuse the API's service graph (no HTTP listener) so job handlers run exactly the same code.
const { services } = createApp({ env, prisma, logger });
const queue = await startJobs({ env, prisma, logger, whatsapp: services.whatsapp, work: true });
logger.info('MandiMitra worker started');

const shutdown = async (signal: string) => {
  logger.info({ signal }, 'Worker shutting down');
  setTimeout(() => process.exit(1), 25_000).unref();
  await queue.stop();
  await prisma.$disconnect();
  await flushSentry();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
