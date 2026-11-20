'use client';

import clsx from 'clsx';
import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, type ReactNode } from 'react';
import { Button, Spinner } from '@/components/ui';
import { useLanguage, useT } from '@/hooks';
import { useMeQuery } from '@/services/api';

/** Platform console shell. Client guard only — every /admin API call re-checks the admin flag in the DB. */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { t } = useT();
  const { lang, change } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const me = useMeQuery();
  const unauth = me.isError && 'status' in (me.error ?? {}) && (me.error as { status: unknown }).status === 401;
  useEffect(() => {
    if (unauth) router.replace('/login');
  }, [unauth, router]);

  if (me.isLoading || unauth) return <div className="flex min-h-dvh items-center justify-center"><Spinner label={t('common.loading')} /></div>;
  if (!me.data?.user.isPlatformAdmin) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 px-4 text-center">
        <p className="text-ink-2">{t('admin.notAdmin')}</p>
        <Link href="/dashboard" className="text-brand-800 underline">{t('admin.backToApp')}</Link>
      </div>
    );
  }

  const tabs = [
    { href: '/admin', label: t('admin.overview') },
    { href: '/admin/payments', label: t('admin.payments') },
  ];
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <span className="flex items-center gap-2 font-semibold text-brand-800">
            <ShieldCheck className="size-5" aria-hidden /> {t('admin.title')}
          </span>
          <nav className="flex gap-1" aria-label="Admin">
            {tabs.map((tab) => {
              const active = tab.href === '/admin' ? pathname === '/admin' || pathname.startsWith('/admin/businesses') : pathname.startsWith(tab.href);
              return (
                <Link key={tab.href} href={tab.href} aria-current={active ? 'page' : undefined} className={clsx('rounded-md px-3 py-1.5 text-sm', active ? 'bg-brand-50 font-semibold text-brand-900' : 'text-ink-2 hover:bg-canvas')}>
                  {tab.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => change(lang === 'hi' ? 'en' : 'hi')}>{lang === 'hi' ? 'English' : 'हिंदी'}</Button>
            {me.data.activeBusiness && (
              <Link href="/dashboard" className="text-sm text-brand-800 hover:underline">{t('admin.backToApp')}</Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">
        <p className="mb-4 text-xs text-ink-3">{t('admin.privacyNote')}</p>
        {children}
      </main>
    </div>
  );
}
