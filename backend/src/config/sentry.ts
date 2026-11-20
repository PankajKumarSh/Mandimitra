import type { Env } from './env.ts';

type SentryModule = typeof import('@sentry/node');
let sentry: SentryModule | null = null;

/**
 * Optional error tracking. Off unless SENTRY_DSN is set. Only unexpected errors are reported
 * (never validation/permission errors); cookies, auth headers and request bodies are stripped, so no
 * session tokens or farmer/financial data leave the server.
 */
export async function initSentry(env: Env, release?: string) {
  if (!env.SENTRY_DSN) return;
  sentry = await import('@sentry/node');
  sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
    ...(release ? { release } : {}),
    dataCollection: { userInfo: false, cookies: false, httpHeaders: false, httpBodies: [], urlQueryParams: false, genAI: { inputs: false, outputs: false } },
    tracesSampleRate: 0,
    beforeSend(event) {
      if (event.request) {
        delete event.request.cookies;
        delete event.request.data;
        if (event.request.headers) {
          for (const h of Object.keys(event.request.headers)) {
            if (/cookie|authorization|signature|token/i.test(h)) delete event.request.headers[h];
          }
        }
      }
      return event;
    },
  });
}

export function captureException(err: unknown, context?: Record<string, unknown>) {
  sentry?.captureException(err, context ? { extra: context } : undefined);
}

export async function flushSentry() {
  await sentry?.flush(2000);
}
