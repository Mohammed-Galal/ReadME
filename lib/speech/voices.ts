// Voice loading. `speechSynthesis.getVoices()` is async in Chrome: the list
// is often empty until the `voiceschanged` event fires.

import { useEffect, useState } from 'react';

export function getVoices(): SpeechSynthesisVoice[] {
  if (typeof window === 'undefined' || !window.speechSynthesis) return [];
  try {
    return window.speechSynthesis.getVoices();
  } catch {
    return [];
  }
}

let cached: SpeechSynthesisVoice[] = [];
let loaded = false;
let wired = false;
const listeners = new Set<() => void>();

function refresh(): void {
  cached = getVoices();
  loaded = true;
  for (const l of [...listeners]) l();
}

function wire(): void {
  if (wired || typeof window === 'undefined' || !window.speechSynthesis) return;
  wired = true;
  try {
    window.speechSynthesis.addEventListener('voiceschanged', refresh);
  } catch {
    // Older Safari used onvoiceschanged; best-effort.
    const synth = window.speechSynthesis as unknown as { onvoiceschanged?: (() => void) | null };
    synth.onvoiceschanged = refresh;
  }
}

export function subscribeVoices(cb: () => void): () => void {
  listeners.add(cb);
  wire();
  if (typeof window !== 'undefined') setTimeout(refresh, 0);
  return () => {
    listeners.delete(cb);
  };
}

/** Hook for components that need the live voice list. */
export function useVoices(): SpeechSynthesisVoice[] {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(loaded ? cached : []);
  useEffect(() => {
    const update = () => setVoices([...cached]);
    update();
    return subscribeVoices(update);
  }, []);
  return voices;
}

/**
 * Pick a voice: exact `voiceURI` match first, then a voice matching the
 * language, then undefined (browser default).
 */
export function pickVoice(voiceURI: string | null, lang: string): SpeechSynthesisVoice | undefined {
  const voices = cached.length ? cached : getVoices();
  if (!voices.length) return undefined;
  if (voiceURI) {
    const byUri = voices.find((v) => v.voiceURI === voiceURI);
    if (byUri) return byUri;
  }
  const target = (lang || 'en').toLowerCase();
  const base = target.split('-')[0];
  return (
    voices.find((v) => v.lang.toLowerCase() === target) ??
    voices.find((v) => v.lang.toLowerCase().split('-')[0] === base) ??
    undefined
  );
}
