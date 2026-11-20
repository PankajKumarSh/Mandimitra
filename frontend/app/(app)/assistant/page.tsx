'use client';

import clsx from 'clsx';
import { Bot, Camera, Mic, MicOff, Plus, Send, Sparkles } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, PageHeader, Spinner, Textarea } from '@/components/ui';
import { DraftReview } from '@/features/ai/draft-review';
import { photoToBase64, useSpeech } from '@/features/ai/media';
import { useCan, useT, useToast } from '@/hooks';
import type { MessageKey } from '@/lib/i18n';
import { apiError } from '@/services/base-query';
import { useAiAskMutation, useAiConversationQuery, useAiConversationsQuery, useAiExtractMutation, useAiUsageQuery } from '@/services/api';
import type { AiDraft } from '@/types/api';

type Bubble = { role: 'USER' | 'ASSISTANT'; content: string; pending?: boolean; tools?: string[] };

function DraftPanel() {
  const { t, lang } = useT();
  const toast = useToast();
  const speech = useSpeech(lang);
  const [extract, ex] = useAiExtractMutation();
  const [text, setText] = useState('');
  const [draft, setDraft] = useState<AiDraft | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (speech.transcript) setText(speech.transcript);
  }, [speech.transcript]);

  const run = async (body: Parameters<typeof extract>[0]) => {
    try {
      setDraft(await extract(body).unwrap());
      setText('');
    } catch (e) {
      toast.error(apiError(e).message);
    }
  };

  if (draft) return <DraftReview draft={draft} onClose={() => setDraft(null)} />;
  return (
    <Card title={t('ai.draft')}>
      <p className="mb-3 text-sm text-ink-2">{t('ai.draftHint')}</p>
      <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="राम कुमार का 40 क्विंटल गेहूं बंसल को 2450 के भाव" aria-label={t('ai.draft')} lang={lang} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {speech.supported ? (
          <Button type="button" variant={speech.listening ? 'danger' : 'secondary'} onClick={speech.listening ? speech.stop : speech.start}>
            {speech.listening ? <MicOff className="size-4" aria-hidden /> : <Mic className="size-4" aria-hidden />} {speech.listening ? t('ai.listening') : t('ai.speak')}
          </Button>
        ) : (
          <span className="text-xs text-ink-3">{t('ai.noSpeech')}</span>
        )}
        <Button type="button" variant="secondary" onClick={() => fileRef.current?.click()} disabled={ex.isLoading}>
          <Camera className="size-4" aria-hidden /> {t('ai.photo')}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            const img = await photoToBase64(file);
            if (!img || img.data.length > 7_000_000) return toast.error(t('ai.photoTooBig'));
            run({ imageBase64: img.data, imageMediaType: img.mediaType, source: 'IMAGE', ...(text.trim() ? { text: text.trim() } : {}) });
          }}
        />
        <Button className="ml-auto" loading={ex.isLoading} disabled={!text.trim()} onClick={() => run({ text: text.trim(), source: speech.transcript ? 'VOICE' : 'TEXT' })}>
          <Sparkles className="size-4" aria-hidden /> {t('ai.makeDraft')}
        </Button>
      </div>
    </Card>
  );
}

export default function AssistantPage() {
  const { t, lang } = useT();
  const toast = useToast();
  const can = useCan();
  const usage = useAiUsageQuery();
  const list = useAiConversationsQuery();
  const [conversationId, setConversationId] = useState<string | null>(null);
  const conv = useAiConversationQuery(conversationId!, { skip: !conversationId });
  const [ask, askState] = useAiAskMutation();
  const speech = useSpeech(lang);
  const [input, setInput] = useState('');
  const [local, setLocal] = useState<Bubble[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (speech.transcript) setInput(speech.transcript);
  }, [speech.transcript]);

  const bubbles: Bubble[] = [...(conv.data?.messages.filter((m) => m.role !== 'TOOL').map((m) => ({ role: m.role as 'USER' | 'ASSISTANT', content: m.content, tools: m.tools })) ?? []), ...local];
  useEffect(() => endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }), [bubbles.length]);

  const submit = async (e?: FormEvent, preset?: string) => {
    e?.preventDefault();
    const text = (preset ?? input).trim();
    if (!text || askState.isLoading) return;
    setInput('');
    setLocal([{ role: 'USER', content: text }, { role: 'ASSISTANT', content: t('ai.thinking'), pending: true }]);
    try {
      const r = await ask({ ...(conversationId ? { conversationId } : {}), text, inputMode: speech.transcript ? 'VOICE' : 'TEXT' }).unwrap();
      speech.setTranscript('');
      setConversationId(r.conversationId);
      setLocal([]);
    } catch (err) {
      setLocal([]);
      setInput(text);
      toast.error(apiError(err).message);
    }
  };

  const u = usage.data;
  const blocked = u && (!u.configured || !u.enabled);

  return (
    <>
      <PageHeader
        title={t('ai.title')}
        subtitle={u?.enabled ? `${t('ai.subtitle')} · ${t('ai.usage', { used: u.used, limit: u.limit })}` : t('ai.subtitle')}
        action={<Button variant="secondary" onClick={() => { setConversationId(null); setLocal([]); }}><Plus className="size-4" aria-hidden /> {t('ai.newChat')}</Button>}
      />
      {blocked && <p className="mb-4 rounded-lg bg-warn-50 px-4 py-3 text-[15px] text-warn-700">{!u.configured ? t('ai.notConfigured') : t('ai.notInPlan')}</p>}

      <div className="grid gap-5 lg:grid-cols-[220px_1fr_360px]">
        <Card title={t('ai.history')} className="hidden lg:block">
          {list.isLoading ? <Spinner /> : !list.data?.length ? <p className="text-sm text-ink-3">—</p> : (
            <ul className="-mx-2 flex flex-col">
              {list.data.map((c) => (
                <li key={c.id}>
                  <button onClick={() => { setConversationId(c.id); setLocal([]); }} className={clsx('w-full truncate rounded-md px-2 py-1.5 text-left text-sm hover:bg-canvas', c.id === conversationId && 'bg-brand-50 font-medium text-brand-900')}>
                    {c.title ?? '—'}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex min-h-[60vh] flex-col [&>div]:flex [&>div]:flex-1 [&>div]:flex-col">
          <div className="flex-1 overflow-y-auto" aria-live="polite">
            {bubbles.length === 0 ? (
              <EmptyState
                icon={<Bot className="size-6" aria-hidden />}
                title={t('ai.subtitle')}
                hint={t('ai.readOnly')}
                action={
                  <div className="mt-2 flex flex-wrap justify-center gap-2">
                    {(['ai.ex1', 'ai.ex2', 'ai.ex3', 'ai.ex4'] as MessageKey[]).map((k) => (
                      <button key={k} disabled={!!blocked} onClick={() => submit(undefined, t(k))} className="rounded-full border border-line bg-surface px-3 py-1.5 text-sm hover:bg-canvas disabled:opacity-50">
                        {t(k)}
                      </button>
                    ))}
                  </div>
                }
              />
            ) : (
              <ul className="flex flex-col gap-3 pb-2">
                {bubbles.map((b, i) => (
                  <li key={i} className={clsx('flex', b.role === 'USER' ? 'justify-end' : 'justify-start')}>
                    <div className={clsx('max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[15px]', b.role === 'USER' ? 'bg-brand-800 text-white' : 'bg-canvas text-ink', b.pending && 'animate-pulse text-ink-3')}>
                      {b.content}
                      {b.tools && b.tools.length > 0 && <span className="mt-1 block text-[11px] text-ink-3">↳ {[...new Set(b.tools)].join(', ')}</span>}
                    </div>
                  </li>
                ))}
                <div ref={endRef} />
              </ul>
            )}
          </div>
          <form onSubmit={submit} className="mt-3 flex items-end gap-2 border-t border-line pt-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              rows={2}
              maxLength={1000}
              placeholder={t('ai.placeholder')}
              aria-label={t('ai.ask')}
              disabled={!!blocked}
              className="flex-1 resize-none"
            />
            {speech.supported && (
              <Button type="button" variant={speech.listening ? 'danger' : 'secondary'} onClick={speech.listening ? speech.stop : speech.start} aria-label={t('ai.speak')} disabled={!!blocked}>
                {speech.listening ? <MicOff className="size-4" /> : <Mic className="size-4" />}
              </Button>
            )}
            <Button type="submit" loading={askState.isLoading} disabled={!input.trim() || !!blocked} aria-label={t('ai.ask')}>
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        </Card>

        {can('ai:draft') && !blocked && <div><DraftPanel /></div>}
      </div>
    </>
  );
}
