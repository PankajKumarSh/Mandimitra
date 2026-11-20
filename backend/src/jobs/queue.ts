import { PgBoss, type Job } from 'pg-boss';
import type { Env } from '../config/env.ts';
import type { Logger } from '../config/logger.ts';

export const QUEUES = {
  subscriptionSweep: 'subscription-sweep',
  ledgerDrift: 'ledger-drift',
  whatsappRetry: 'whatsapp-retry',
} as const;

const WHATSAPP_RETRY_LIMIT = 4; // 5 attempts in all: 30 s, ~1 min, ~2 min, ~4 min backoff

export interface JobHandlers {
  subscriptionSweep: () => Promise<unknown>;
  ledgerDrift: () => Promise<unknown>;
  whatsappRetry: (messageId: string, finalAttempt: boolean) => Promise<unknown>;
}

/**
 * pg-boss job queue, stored in its own `pgboss` schema in the same PostgreSQL — no Redis to run.
 *  - producer: the API enqueues WhatsApp retries
 *  - worker:   runs handlers and the nightly cron schedules (IST). Several workers are safe: pg-boss
 *              uses SKIP LOCKED for jobs and a single elected instance for cron.
 */
export class JobQueue {
  private readonly boss: PgBoss;
  private started = false;

  constructor(
    env: Env,
    private readonly logger: Logger,
  ) {
    const url = new URL(env.DATABASE_URL);
    url.searchParams.delete('schema'); // Prisma-only parameter
    this.boss = new PgBoss({ connectionString: url.toString(), schema: 'pgboss', max: 4, application_name: 'mandimitra-jobs' });
    this.boss.on('error', (err) => this.logger.error({ err }, 'jobs.error'));
  }

  async start(handlers: JobHandlers | null) {
    await this.boss.start();
    this.started = true;
    for (const name of Object.values(QUEUES)) {
      try {
        await this.boss.createQueue(name);
      } catch (e) {
        if (!/exist/i.test((e as Error).message)) throw e;
      }
    }
    if (!handlers) return;

    await this.boss.schedule(QUEUES.subscriptionSweep, '10 0 * * *', null, { tz: 'Asia/Kolkata' }); // 00:10 IST
    await this.boss.schedule(QUEUES.ledgerDrift, '40 2 * * *', null, { tz: 'Asia/Kolkata' }); // 02:40 IST

    await this.boss.work(QUEUES.subscriptionSweep, async () => {
      await handlers.subscriptionSweep();
    });
    await this.boss.work(QUEUES.ledgerDrift, async () => {
      await handlers.ledgerDrift();
    });
    await this.boss.work<{ messageId: string }>(QUEUES.whatsappRetry, async (jobs: Job<{ messageId: string }>[]) => {
      for (const job of jobs) await handlers.whatsappRetry(job.data.messageId, job.retryCount >= WHATSAPP_RETRY_LIMIT);
    });
    this.logger.info({ queues: Object.values(QUEUES) }, 'jobs.worker_started');
  }

  enqueueWhatsAppRetry = async (messageId: string) => {
    await this.boss.send(QUEUES.whatsappRetry, { messageId }, { retryLimit: WHATSAPP_RETRY_LIMIT, retryDelay: 30, retryBackoff: true, startAfter: 30, singletonKey: messageId });
  };

  /** Run a scheduled job now (admin "run now", smoke tests). */
  trigger(name: (typeof QUEUES)[keyof typeof QUEUES]) {
    return this.boss.send(name, {});
  }

  async stop() {
    if (this.started) await this.boss.stop({ graceful: true, timeout: 20_000 });
  }
}
