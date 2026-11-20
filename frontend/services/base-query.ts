import { fetchBaseQuery, type BaseQueryFn, type FetchArgs, type FetchBaseQueryError } from '@reduxjs/toolkit/query/react';
import { sessionExpired } from '@/store/ui-slice';
import type { Lang } from '@/lib/i18n';

const raw = fetchBaseQuery({
  baseUrl: '/api/v1',
  credentials: 'include',
  prepareHeaders: (headers, { getState }) => {
    headers.set('x-requested-with', 'mandimitra'); // CSRF guard header required by the API
    const lang = (getState() as { ui: { lang: Lang } }).ui.lang;
    headers.set('accept-language', lang);
    return headers;
  },
});

const NO_REFRESH = ['/auth/login', '/auth/register', '/auth/refresh', '/auth/logout'];
let refreshing: Promise<boolean> | null = null;

/**
 * On 401, perform ONE shared refresh (concurrent requests wait on the same promise — the server's
 * rotation would otherwise see parallel refreshes), then retry the original request once.
 */
export const baseQueryWithRefresh: BaseQueryFn<string | FetchArgs, unknown, FetchBaseQueryError> = async (args, api, extra) => {
  let result = await raw(args, api, extra);
  const url = typeof args === 'string' ? args : args.url;

  if (result.error?.status === 401 && !NO_REFRESH.some((p) => url.startsWith(p)) && !url.startsWith('/auth/invites')) {
    refreshing ??= (async () => {
      try {
        const r = await raw({ url: '/auth/refresh', method: 'POST' }, api, extra);
        return !r.error;
      } finally {
        queueMicrotask(() => (refreshing = null));
      }
    })();
    if (await refreshing) {
      result = await raw(args, api, extra);
    } else {
      api.dispatch(sessionExpired());
    }
  }
  return result;
};

/** Extract the API's error code/message/details from an RTK Query error. */
export function apiError(err: unknown): { code: string; message: string; details?: unknown; status?: number | string } {
  const e = err as FetchBaseQueryError | undefined;
  const body = e && 'data' in e ? (e.data as { error?: { code: string; message: string; details?: unknown } }) : undefined;
  if (body?.error) return { ...body.error, status: e!.status };
  return { code: 'NETWORK', message: 'Network error — check your connection', status: e?.status };
}
