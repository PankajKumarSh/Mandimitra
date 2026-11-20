'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/* Minimal typing for the Web Speech API (not in lib.dom for all TS targets). */
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
}
type Ctor = new () => SpeechRecognitionLike;

/**
 * Browser speech-to-text (Chrome/Edge: Google/Microsoft engines; hi-IN supported). Audio never touches
 * MandiMitra's servers — only the resulting text is sent. Unsupported browsers fall back to typing.
 */
export function useSpeech(lang: 'hi' | 'en') {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState('');
  const rec = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
    setSupported(!!(w.SpeechRecognition ?? w.webkitSpeechRecognition));
  }, []);

  const start = useCallback(() => {
    const w = window as unknown as { SpeechRecognition?: Ctor; webkitSpeechRecognition?: Ctor };
    const C = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!C) return;
    const r = new C();
    r.lang = lang === 'hi' ? 'hi-IN' : 'en-IN';
    r.interimResults = true;
    r.continuous = false;
    r.onresult = (e) => setTranscript(Array.from(e.results).map((x) => x[0]!.transcript).join(' '));
    r.onend = () => setListening(false);
    r.onerror = () => setListening(false);
    rec.current = r;
    setTranscript('');
    setListening(true);
    r.start();
  }, [lang]);

  const stop = useCallback(() => rec.current?.stop(), []);
  useEffect(() => () => rec.current?.stop(), []);
  return { supported, listening, transcript, setTranscript, start, stop };
}

/**
 * Photo → JPEG base64, downscaled on the device (max 1600px) so uploads stay small on mandi networks.
 * Returns null if the browser cannot decode the format (e.g. HEIC on some desktops).
 */
export async function photoToBase64(file: File): Promise<{ data: string; mediaType: 'image/jpeg' } | null> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = url;
    });
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { data: dataUrl.slice(dataUrl.indexOf(',') + 1), mediaType: 'image/jpeg' };
  } catch {
    return null;
  } finally {
    URL.revokeObjectURL(url);
  }
}
