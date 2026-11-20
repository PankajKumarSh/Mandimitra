'use client';

import clsx from 'clsx';
import { Bell, Copy, MessageCircle, Send } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button, Modal, Spinner, Textarea } from '@/components/ui';
import { useIdempotencyKey } from '@/features/common';
import { useCan, useT, useToast } from '@/hooks';
import { formatDateTime } from '@/lib/format';
import { apiError } from '@/services/base-query';
import { useAiReminderMutation, useNotificationsQuery, useReadAllNotificationsMutation, useReadNotificationMutation, useSendWhatsAppMutation } from '@/services/api';
import type { WhatsAppKind } from '@/types/api';

export function NotificationBell() {
  const { t, lang } = useT();
  const router = useRouter();
  const q = useNotificationsQuery(undefined, { pollingInterval: 60_000 });
  const [read] = useReadNotificationMutation();
  const [readAll] = useReadAllNotificationsMutation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  const unread = q.data?.unread ?? 0;

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-2 hover:bg-canvas" aria-label={`${t('notif.title')} (${unread})`} aria-expanded={open}>
        <Bell className="size-5" aria-hidden />
        {unread > 0 && <span className="absolute right-1 top-1 flex min-w-4 items-center justify-center rounded-full bg-accent-600 px-1 text-[10px] font-bold text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-80 max-w-[90vw] overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
            <span className="font-medium">{t('notif.title')}</span>
            {unread > 0 && <button onClick={() => readAll()} className="text-sm text-brand-800 hover:underline">{t('notif.readAll')}</button>}
          </div>
          {q.isLoading ? <Spinner /> : !q.data?.items.length ? <p className="px-4 py-6 text-center text-sm text-ink-3">{t('notif.empty')}</p> : (
            <ul className="max-h-96 divide-y divide-line overflow-y-auto">
              {q.data.items.map((n) => (
                <li key={n.id}>
                  <button
                    onClick={() => {
                      if (!n.readAt) read(n.id);
                      setOpen(false);
                      if (n.link) router.push(n.link);
                    }}
                    className={clsx('block w-full px-4 py-3 text-left hover:bg-canvas', !n.readAt && 'bg-brand-50/60')}
                  >
                    <span className="block text-sm font-medium">{n.title}</span>
                    {n.body && <span className="block truncate text-xs text-ink-2">{n.body}</span>}
                    <span className="block text-[11px] text-ink-3">{formatDateTime(n.createdAt, lang)}</span>
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

/** Official WhatsApp Business send (approved template + PDF). Consent and plan are enforced server-side. */
export function WhatsAppSendButton({ kind, entityId, farmerId, buyerId, label, size = 'md' }: { kind: WhatsAppKind; entityId?: string; farmerId?: string; buyerId?: string; label?: string; size?: 'sm' | 'md' }) {
  const { t } = useT();
  const toast = useToast();
  const can = useCan();
  const [send, s] = useSendWhatsAppMutation();
  const { key, rotate } = useIdempotencyKey();
  if (!can('whatsapp:send')) return null;
  return (
    <Button
      size={size}
      variant="secondary"
      loading={s.isLoading}
      onClick={async () => {
        try {
          const r = await send({ key, body: { kind, entityId, farmerId, buyerId } }).unwrap();
          rotate();
          toast.success(r.provider === 'mock' ? t('wa.sentMock') : t('wa.sent'));
        } catch (e) {
          rotate();
          toast.error(apiError(e).message);
        }
      }}
    >
      <Send className="size-4" aria-hidden /> {label ?? t('wa.send')}
    </Button>
  );
}

/** AI-drafted (or template) reminder: copy it, open it in the user's own WhatsApp, or send the official template. */
export function ReminderButton({ buyerId, mobile }: { buyerId: string; mobile: string | null }) {
  const { t } = useT();
  const toast = useToast();
  const can = useCan();
  const [draft, d] = useAiReminderMutation();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  if (!can('whatsapp:send')) return null;

  const start = async () => {
    setOpen(true);
    setText('');
    try {
      setText((await draft(buyerId).unwrap()).text);
    } catch (e) {
      toast.error(apiError(e).message);
    }
  };
  return (
    <>
      <Button variant="secondary" onClick={start}><MessageCircle className="size-4" aria-hidden /> {t('wa.reminder')}</Button>
      <Modal open={open} onClose={() => setOpen(false)} title={t('wa.reminderTitle')}>
        {d.isLoading ? <Spinner label={t('ai.thinking')} /> : (
          <div className="flex flex-col gap-4">
            <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} lang="hi" aria-label={t('wa.reminderTitle')} />
            <p className="text-xs text-ink-3">{t('wa.officialNote')}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="ghost" onClick={async () => { try { await navigator.clipboard.writeText(text); toast.success(t('common.copied')); } catch { /* selectable */ } }}>
                <Copy className="size-4" aria-hidden /> {t('common.copy')}
              </Button>
              {mobile && (
                <a href={`https://wa.me/${mobile.replace('+', '')}?text=${encodeURIComponent(text)}`} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-[15px] font-medium hover:bg-canvas">
                  {t('wa.openWhatsApp')}
                </a>
              )}
              <WhatsAppSendButton kind="REMINDER" buyerId={buyerId} label={t('wa.sendTemplate')} />
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
