'use client';

import { Wheat } from 'lucide-react';
import type { ReactNode } from 'react';
import { useLanguage, useT } from '@/hooks';

export function AuthFrame({ title, children, footer }: { title: string; children: ReactNode; footer?: ReactNode }) {
  const { t } = useT();
  const { lang, change } = useLanguage();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="mb-6 flex flex-col items-center gap-2 text-center">
        <div className="flex items-center gap-2 text-brand-800">
          <Wheat className="size-8" aria-hidden />
          <span className="text-2xl font-bold">{t('appName')}</span>
        </div>
        <p className="text-sm text-ink-2">{t('tagline')}</p>
      </div>
      <div className="w-full max-w-md rounded-xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <h1 className="mb-5 text-xl font-semibold">{title}</h1>
        {children}
      </div>
      {footer && <div className="mt-5 text-sm text-ink-2">{footer}</div>}
      <button onClick={() => change(lang === 'hi' ? 'en' : 'hi')} className="mt-4 text-sm text-ink-3 underline-offset-4 hover:text-ink hover:underline">
        {lang === 'hi' ? 'English' : 'हिंदी'}
      </button>
    </main>
  );
}
