'use client';

import { useCallback, useEffect, useState } from 'react';
import { translate, type Lang, type MessageKey } from '@/lib/i18n';
import { useMeQuery } from '@/services/api';
import { pushToast, setLang } from '@/store/ui-slice';
import { useAppDispatch, useAppSelector } from '@/store';

export function useT() {
  const lang = useAppSelector((s) => s.ui.lang);
  const t = useCallback((key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars), [lang]);
  return { t, lang };
}

const LANG_KEY = 'mm.lang';

/** Language is a per-device convenience; storage access is guarded (private mode etc.). */
export function useLanguage() {
  const dispatch = useAppDispatch();
  const lang = useAppSelector((s) => s.ui.lang);
  const change = useCallback(
    (next: Lang) => {
      dispatch(setLang(next));
      try {
        localStorage.setItem(LANG_KEY, next);
      } catch {
        /* storage unavailable — fine, state still updates */
      }
      document.documentElement.lang = next;
    },
    [dispatch],
  );
  return { lang, change };
}

export function useRestoreLanguage() {
  const dispatch = useAppDispatch();
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANG_KEY);
      if (saved === 'hi' || saved === 'en') {
        dispatch(setLang(saved));
        document.documentElement.lang = saved;
      }
    } catch {
      /* ignore */
    }
  }, [dispatch]);
}

export function useToast() {
  const dispatch = useAppDispatch();
  return {
    success: (message: string) => dispatch(pushToast({ kind: 'success', message })),
    error: (message: string) => dispatch(pushToast({ kind: 'error', message })),
    info: (message: string) => dispatch(pushToast({ kind: 'info', message })),
  };
}

export function useDebounce<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** UI hint only — the backend enforces every permission independently. */
export function useCan() {
  const { data } = useMeQuery();
  const perms = new Set(data?.activeBusiness?.permissions ?? []);
  return (key: string) => perms.has(key);
}
