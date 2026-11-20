import type { SubStatus } from '@/types/billing';

/** Badge tone per subscription status. Status is always shown as text too, never by colour alone. */
export const SUB_TONE: Record<SubStatus, 'green' | 'amber' | 'red' | 'neutral'> = {
  TRIALING: 'amber',
  ACTIVE: 'green',
  PAST_DUE: 'red',
  EXPIRED: 'red',
  CANCELLED: 'neutral',
  SUSPENDED: 'red',
};
