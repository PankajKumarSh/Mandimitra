import type { PrismaClient } from '@mandimitra/database';
import type { Env } from '../config/env.ts';
import type { Logger } from '../config/logger.ts';
import type { TenantCache } from '../middleware/tenant.ts';
import type { WhatsAppService } from '../services/whatsapp/whatsapp.service.ts';
import { LedgerDriftCheck } from './ledger-drift.ts';
import { JobQueue } from './queue.ts';
import { SubscriptionSweep } from './subscription-sweep.ts';

/**
 * Starts the queue. `work=true` also runs handlers + cron (inline mode in the API, or the worker process).
 * The producer side (WhatsApp retry enqueue) is wired whenever the queue is running.
 */
export async function startJobs(args: { env: Env; prisma: PrismaClient; logger: Logger; whatsapp: WhatsAppService; cache?: TenantCache; work: boolean }) {
  const queue = new JobQueue(args.env, args.logger);
  const sweep = new SubscriptionSweep(args.prisma, args.env, args.logger, args.cache);
  const drift = new LedgerDriftCheck(args.prisma, args.logger);
  await queue.start(
    args.work
      ? {
          subscriptionSweep: () => sweep.run(),
          ledgerDrift: () => drift.run(),
          whatsappRetry: (id, final) => args.whatsapp.retry(id, final),
        }
      : null,
  );
  args.whatsapp.setRetryQueue(queue.enqueueWhatsAppRetry);
  return queue;
}
