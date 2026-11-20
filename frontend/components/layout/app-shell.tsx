'use client';

import clsx from 'clsx';
import {
  BarChart3,
  Bot,
  BookOpen,
  BookUser,
  ChevronDown,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Receipt,
  Search,
  Settings,
  ShoppingCart,
  Store,
  Truck,
  Users,
  UsersRound,
  Wallet,
  Wheat,
  X,
  KeyRound,
  Languages,
  Building2,
  CreditCard,
  AlertTriangle,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, Input, Modal, Spinner } from '@/components/ui';
import { NotificationBell } from '@/features/communication';
import { useCan, useDebounce, useLanguage, useT, useToast } from '@/hooks';
import { formatMobile } from '@/lib/format';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { api, useBuyersQuery, useChangePasswordMutation, useFarmersQuery, useLogoutMutation, useMeQuery, useSwitchBusinessMutation } from '@/services/api';
import { useAppDispatch, useAppSelector } from '@/store';
import { setSidebar } from '@/store/ui-slice';

interface NavItem {
  href: string;
  label: MessageKey;
  icon: LucideIcon;
  perm?: string;
  /** Phase in which the module ships; undefined = available now. */
  phase?: number;
}

const NAV: NavItem[] = [
  { href: '/dashboard', label: 'nav.dashboard', icon: LayoutDashboard, perm: 'report:read' },
  { href: '/farmers', label: 'nav.farmers', icon: Users, perm: 'farmer:read' },
  { href: '/buyers', label: 'nav.buyers', icon: Store, perm: 'buyer:read' },
  { href: '/arrivals', label: 'nav.arrivals', icon: Truck, perm: 'lot:read' },
  { href: '/purchases', label: 'nav.purchases', icon: ShoppingCart, perm: 'purchase:read' },
  { href: '/sales', label: 'nav.sales', icon: Wheat, perm: 'sale:read' },
  { href: '/patti', label: 'nav.patti', icon: FileText, perm: 'patti:read' },
  { href: '/ledger/farmers', label: 'nav.farmerLedger', icon: BookUser, perm: 'ledger:read' },
  { href: '/ledger/buyers', label: 'nav.buyerLedger', icon: BookOpen, perm: 'ledger:read' },
  { href: '/payments', label: 'nav.payments', icon: Wallet, perm: 'payment:read' },
  { href: '/expenses', label: 'nav.expenses', icon: Receipt, perm: 'expense:read' },
  { href: '/reports', label: 'nav.reports', icon: BarChart3, perm: 'report:read' },
  { href: '/assistant', label: 'nav.ai', icon: Bot, perm: 'ai:query' },
  { href: '/staff', label: 'nav.staff', icon: UsersRound, perm: 'staff:read' },
  { href: '/billing', label: 'nav.billing', icon: CreditCard, perm: 'subscription:read' },
  { href: '/settings', label: 'nav.settings', icon: Settings, perm: 'business:read' },
];

/** Read-only / trial-ending notice. The API enforces read-only on its own; this only explains it. */
function SubscriptionBanner() {
  const { t } = useT();
  const can = useCan();
  const { data: me } = useMeQuery();
  const sub = me?.activeBusiness?.subscription;
  if (!sub) return null;
  const readOnly = ['EXPIRED', 'PAST_DUE', 'CANCELLED'].includes(sub.status);
  const daysLeft = sub.status === 'TRIALING' && sub.trialEndsAt ? Math.ceil((new Date(sub.trialEndsAt).getTime() - Date.now()) / 86_400_000) : null;
  if (!readOnly && (daysLeft === null || daysLeft > 3)) return null;
  return (
    <div role="status" className={clsx('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm sm:px-6', readOnly ? 'bg-danger-50 text-danger-700' : 'bg-warn-50 text-warn-700')}>
      <AlertTriangle className="size-4 shrink-0" aria-hidden />
      <span>{readOnly ? t('banner.readOnly') : t('banner.trialEnding', { days: Math.max(daysLeft ?? 0, 0) })}</span>
      {can('subscription:manage') ? (
        <Link href="/billing" className="font-semibold underline underline-offset-2">
          {t('banner.renewNow')}
        </Link>
      ) : (
        <span>{t('bill.ownerOnly')}</span>
      )}
    </div>
  );
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useT();
  const pathname = usePathname();
  const can = useCan();
  return (
    <ul className="flex flex-col gap-0.5">
      {NAV.filter((n) => !n.perm || can(n.perm)).map((n) => {
        const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
        const Icon = n.icon;
        if (n.phase) {
          // Not built yet: shown so users see what's coming, but not clickable (no dead links).
          return (
            <li key={n.href}>
              <span aria-disabled="true" title={`Phase ${n.phase}`} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-[15px] text-ink-3">
                <Icon className="size-5 shrink-0" aria-hidden />
                <span className="flex-1">{t(n.label)}</span>
                <span className="rounded-full bg-canvas px-1.5 py-0.5 text-[10px] font-medium">{t('nav.soon')}</span>
              </span>
            </li>
          );
        }
        return (
          <li key={n.href}>
            <Link
              href={n.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={clsx(
                'flex items-center gap-3 rounded-lg px-3 py-2 text-[15px] transition-colors',
                active ? 'bg-brand-50 font-semibold text-brand-900' : 'text-ink-2 hover:bg-canvas hover:text-ink',
              )}
            >
              <Icon className="size-5 shrink-0" aria-hidden />
              {t(n.label)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Brand() {
  const { t } = useT();
  return (
    <Link href="/dashboard" className="flex items-center gap-2 px-3 text-brand-800">
      <Wheat className="size-7" aria-hidden />
      <span className="text-xl font-bold">{t('appName')}</span>
    </Link>
  );
}

/** Live search across farmers and buyers (server-side, tenant-scoped). */
function GlobalSearch() {
  const { t } = useT();
  const can = useCan();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q.trim(), 250);
  const skip = dq.length < 2;
  const farmers = useFarmersQuery({ q: dq, pageSize: 5 }, { skip: skip || !can('farmer:read') });
  const buyers = useBuyersQuery({ q: dq, pageSize: 5 }, { skip: skip || !can('buyer:read') });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQ('');
    router.push(href);
  };
  const results = [
    ...(farmers.data?.items ?? []).map((f) => ({ href: `/farmers/${f.id}`, title: f.nameHindi ? `${f.name} · ${f.nameHindi}` : f.name, sub: [f.code, f.village, formatMobile(f.mobile)].filter((x) => x && x !== '—').join(' · '), kind: t('nav.farmers') })),
    ...(buyers.data?.items ?? []).map((b) => ({ href: `/buyers/${b.id}`, title: b.firmName, sub: [b.code, b.city].filter(Boolean).join(' · '), kind: t('nav.buyers') })),
  ];

  return (
    <div ref={box} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
      <input
        type="search"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder={t('common.searchPlaceholder')}
        aria-label={t('common.search')}
        className="h-10 w-full rounded-lg border border-line bg-canvas pl-9 pr-3 text-[15px] placeholder:text-ink-3 focus:border-brand-700 focus:bg-surface focus:outline-none"
      />
      {open && !skip && (
        <div className="absolute left-0 right-0 top-12 z-40 overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {farmers.isFetching || buyers.isFetching ? (
            <Spinner />
          ) : results.length === 0 ? (
            <p className="px-4 py-3 text-sm text-ink-3">{t('common.noResults')}</p>
          ) : (
            <ul>
              {results.map((r) => (
                <li key={r.href}>
                  <button onClick={() => go(r.href)} className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-canvas">
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] text-ink">{r.title}</span>
                      <span className="block truncate text-xs text-ink-3">{r.sub}</span>
                    </span>
                    <span className="shrink-0 text-xs text-ink-3">{r.kind}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ProfileMenu() {
  const { t } = useT();
  const { lang, change } = useLanguage();
  const toast = useToast();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const { data: me } = useMeQuery();
  const [logout] = useLogoutMutation();
  const [switchBusiness] = useSwitchBusinessMutation();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  if (!me) return null;
  const others = me.memberships.filter((m) => m.businessId !== me.activeBusiness?.businessId);

  const doLogout = async () => {
    await logout().unwrap().catch(() => undefined);
    dispatch(api.util.resetApiState());
    router.replace('/login');
  };
  const doSwitch = async (id: string) => {
    try {
      await switchBusiness(id).unwrap();
      dispatch(api.util.resetApiState()); // drop every cached record of the previous tenant
      setOpen(false);
      router.replace('/dashboard');
    } catch (e) {
      toast.error(apiError(e).message);
    }
  };

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-canvas" aria-expanded={open} aria-haspopup="menu">
        <span className="flex size-8 items-center justify-center rounded-full bg-brand-800 text-sm font-semibold text-white" aria-hidden>
          {me.user.fullName.slice(0, 1).toUpperCase()}
        </span>
        <span className="hidden text-left sm:block">
          <span className="block max-w-40 truncate text-sm font-medium text-ink">{me.user.fullName}</span>
          <span className="block max-w-40 truncate text-xs text-ink-3">{lang === 'hi' ? (me.activeBusiness?.role.nameHindi ?? me.activeBusiness?.role.name) : me.activeBusiness?.role.name}</span>
        </span>
        <ChevronDown className="size-4 text-ink-3" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-12 z-40 w-64 overflow-hidden rounded-lg border border-line bg-surface py-1 shadow-lg">
          <div className="border-b border-line px-4 py-2.5">
            <p className="truncate text-sm font-medium">{me.activeBusiness?.name}</p>
            <p className="text-xs text-ink-3">{formatMobile(me.user.mobile)}</p>
          </div>
          {others.length > 0 && (
            <div className="border-b border-line py-1">
              <p className="px-4 py-1 text-xs font-medium text-ink-3">{t('auth.switchBusiness')}</p>
              {others.map((m) => (
                <button key={m.businessId} role="menuitem" onClick={() => doSwitch(m.businessId)} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-canvas">
                  <Building2 className="size-4 text-ink-3" aria-hidden />
                  <span className="truncate">{m.business.name}</span>
                </button>
              ))}
            </div>
          )}
          {me.user.isPlatformAdmin && (
            <Link href="/admin" role="menuitem" className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-canvas">
              <ShieldCheck className="size-4 text-ink-3" aria-hidden /> {t('nav.superAdmin')}
            </Link>
          )}
          <button role="menuitem" onClick={() => change(lang === 'hi' ? 'en' : 'hi')} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-canvas">
            <Languages className="size-4 text-ink-3" aria-hidden /> {lang === 'hi' ? 'English' : 'हिंदी'}
          </button>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setPwOpen(true);
            }}
            className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm hover:bg-canvas"
          >
            <KeyRound className="size-4 text-ink-3" aria-hidden /> {t('auth.changePassword')}
          </button>
          <button role="menuitem" onClick={doLogout} className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-danger-700 hover:bg-danger-50">
            <LogOut className="size-4" aria-hidden /> {t('auth.logout')}
          </button>
        </div>
      )}
      <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} />
    </div>
  );
}

function ChangePasswordModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const toast = useToast();
  const [change, { isLoading }] = useChangePasswordMutation();
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      await change({ currentPassword: cur, newPassword: next }).unwrap();
      toast.success(t('common.saved'));
      setCur('');
      setNext('');
      onClose();
    } catch (err) {
      setError(apiError(err).message);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title={t('auth.changePassword')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('auth.currentPassword')} htmlFor="cur" required>
          <Input id="cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required />
        </Field>
        <Field label={t('auth.newPassword')} htmlFor="new" hint="8+" required>
          <Input id="new" type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />
        </Field>
        {error && <p role="alert" className="text-sm text-danger-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" loading={isLoading}>{t('common.save')}</Button>
        </div>
      </form>
    </Modal>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useT();
  const router = useRouter();
  const pathname = usePathname();
  const dispatch = useAppDispatch();
  const sidebarOpen = useAppSelector((s) => s.ui.sidebarOpen);
  const sessionExpired = useAppSelector((s) => s.ui.sessionExpired);
  const me = useMeQuery();

  // Client-side guard. Real protection is the API: every request is authenticated server-side.
  const unauth = me.isError && (('status' in (me.error ?? {}) && (me.error as { status: unknown }).status === 401) || sessionExpired);
  useEffect(() => {
    if (unauth || sessionExpired) router.replace('/login');
  }, [unauth, sessionExpired, router]);
  useEffect(() => {
    dispatch(setSidebar(false));
  }, [pathname, dispatch]);
  // A platform admin without a business of their own lands in the admin console.
  const adminOnly = !!me.data && !me.data.activeBusiness && me.data.user.isPlatformAdmin;
  useEffect(() => {
    if (adminOnly) router.replace('/admin');
  }, [adminOnly, router]);

  if (me.isLoading || unauth) return <div className="flex min-h-dvh items-center justify-center"><Spinner label={t('common.loading')} /></div>;
  if (me.isError) {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Button onClick={() => me.refetch()}>{t('common.retry')}</Button>
      </div>
    );
  }
  if (!me.data?.activeBusiness) {
    if (me.data?.user.isPlatformAdmin) {
      return <div className="flex min-h-dvh items-center justify-center"><Spinner label={t('common.loading')} /></div>;
    }
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
        <p className="text-lg font-medium">{t('common.error')}</p>
        <p className="text-sm text-ink-2">No active business for this account.</p>
      </div>
    );
  }

  return (
    <div className="min-h-dvh lg:pl-64">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden w-64 flex-col gap-4 overflow-y-auto border-r border-line bg-surface py-5 lg:flex">
        <Brand />
        <nav className="px-3" aria-label="Main">
          <NavList />
        </nav>
      </aside>

      {/* Mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button className="absolute inset-0 bg-ink/40" aria-label={t('common.close')} onClick={() => dispatch(setSidebar(false))} />
          <aside className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col gap-4 overflow-y-auto bg-surface py-5 shadow-xl">
            <div className="flex items-center justify-between pr-3">
              <Brand />
              <button onClick={() => dispatch(setSidebar(false))} className="rounded-md p-1.5 text-ink-3 hover:bg-canvas" aria-label={t('common.close')}>
                <X className="size-5" />
              </button>
            </div>
            <nav className="px-3" aria-label="Main">
              <NavList onNavigate={() => dispatch(setSidebar(false))} />
            </nav>
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-line bg-surface/95 px-4 backdrop-blur sm:px-6">
        <button onClick={() => dispatch(setSidebar(true))} className="rounded-md p-2 text-ink-2 hover:bg-canvas lg:hidden" aria-label="Menu">
          <Menu className="size-5" />
        </button>
        <GlobalSearch />
        <div className="ml-auto flex items-center gap-1">
          <NotificationBell />
          <ProfileMenu />
        </div>
      </header>
      <SubscriptionBanner />

      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
