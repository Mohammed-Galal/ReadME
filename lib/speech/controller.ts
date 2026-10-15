// Speech controller. One module; states: idle | playing | paused.
//
// Design notes (per spec):
// - Speaks one block at a time, split into sentence utterances so Chrome
//   doesn't cut long blocks off.
// - Every utterance carries an incrementing generation token; events from
//   older generations are ignored, so `cancel()` never double-advances.
// - Pause = cancel + remember block + char offset. Resume = re-speak from
//   that offset (word-snapped). The same path applies settings changes live.
// - Word tracking: `boundary` events (charIndex) when they arrive; a timing
//   estimate (character count x rate) kicks in if none arrives within ~1s.

import type { PlaybackState, Settings, SpeakableBlock } from '../types';
import { wordEnd, wordStart } from '../utils';
import { detectLang } from './language';
import { splitSentences, type Sentence } from './sentences';
import { pickVoice } from './voices';

export interface ControllerContext {
  fileId: string | null;
  blocks: SpeakableBlock[];
  settings: Settings;
  docLang: string | null;
  detectedLang: string | null;
}

export interface SpeechCallbacks {
  getContext(): ControllerContext;
  onState(state: PlaybackState): void;
  onBlock(blockId: string): void;
  onWord(blockId: string, start: number, end: number): void;
  onPosition(blockId: string, charOffset: number): void;
  onFileFinished(fileId: string): void;
  onError(message: string): void;
}

const EST_CHARS_PER_SEC = 14.5; // calibrated at rate 1
const BOUNDARY_TIMEOUT_MS = 1000;
const ESTIMATE_INTERVAL_MS = 150;
const CANCEL_RESTART_DELAY_MS = 60;
const NO_START_FALLBACK_MS = 1500;

export class SpeechController {
  private state: PlaybackState = 'idle';
  private gen = 0;
  private fileId: string | null = null;
  private blockIdx = -1;
  private charOffset = 0;
  private lastChar = 0;
  private lastWordKey = '';
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeout: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private boundarySeen = false;
  private cb: SpeechCallbacks;
  private debouncedApply: (() => void) & { cancel: () => void };

  constructor(cb: SpeechCallbacks) {
    this.cb = cb;
    let t: ReturnType<typeof setTimeout> | null = null;
    const apply = () => {
      t = null;
      this.restartFromCurrentWord();
    };
    this.debouncedApply = Object.assign(
      () => {
        if (t) clearTimeout(t);
        t = setTimeout(apply, 250);
      },
      { cancel: () => (t ? clearTimeout(t) : undefined) },
    );
  }

  get playback(): PlaybackState {
    return this.state;
  }

  get supported(): boolean {
    return (
      typeof window !== 'undefined' && !!window.speechSynthesis && 'SpeechSynthesisUtterance' in window
    );
  }

  private get synth(): SpeechSynthesis {
    return window.speechSynthesis;
  }

  private setState(s: PlaybackState): void {
    if (this.state !== s) {
      this.state = s;
      this.cb.onState(s);
    }
  }

  private clearTimers(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  /** Cancels current speech and bumps the generation so stale events are ignored. */
  private cancelAll(): void {
    this.gen++;
    this.clearTimers();
    this.debouncedApply.cancel();
    if (this.supported) {
      try {
        this.synth.cancel();
      } catch {
        // ignore
      }
    }
  }

  // ---- position queries ---------------------------------------------------

  currentBlockId(): string | null {
    const { blocks } = this.cb.getContext();
    return blocks[this.blockIdx]?.id ?? null;
  }

  currentCharOffset(): number {
    return this.charOffset;
  }

  // ---- public controls ----------------------------------------------------

  /** Start (or restart) reading from a specific block. */
  playFrom(blockId: string, charOffset = 0): void {
    const ctx = this.cb.getContext();
    if (!ctx.fileId) return;
    const idx = ctx.blocks.findIndex((b) => b.id === blockId);
    if (idx < 0) return;
    this.fileId = ctx.fileId;
    this.blockIdx = idx;
    this.charOffset = Math.max(0, Math.min(charOffset, ctx.blocks[idx].text.length));
    this.speakBlock(this.charOffset);
  }

  /** Play from the current position (or the first block when idle). */
  play(): void {
    const ctx = this.cb.getContext();
    if (!ctx.fileId || ctx.blocks.length === 0) return;
    if (this.state === 'paused') {
      this.resume();
      return;
    }
    if (this.state === 'playing') return;
    if (this.fileId !== ctx.fileId || this.blockIdx < 0 || this.blockIdx >= ctx.blocks.length) {
      this.fileId = ctx.fileId;
      this.blockIdx = 0;
      this.charOffset = 0;
    } else {
      const block = ctx.blocks[this.blockIdx];
      if (this.charOffset >= block.text.length) this.charOffset = 0; // finished block -> restart it
    }
    this.speakBlock(this.charOffset);
  }

  pause(): void {
    if (this.state !== 'playing') return;
    const ctx = this.cb.getContext();
    const block = ctx.blocks[this.blockIdx];
    if (block) {
      const c = Math.min(this.lastChar, block.text.length);
      this.charOffset = wordStart(block.text, c);
      this.cb.onPosition(block.id, this.charOffset);
    }
    this.cancelAll();
    this.setState('paused');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    const ctx = this.cb.getContext();
    if (!ctx.fileId || this.blockIdx < 0 || this.blockIdx >= ctx.blocks.length) return;
    this.speakBlock(this.charOffset);
  }

  toggle(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
    else this.play();
  }

  stop(): void {
    this.cancelAll();
    this.setState('idle');
  }

  next(): void {
    this.move(1);
  }

  prev(): void {
    this.move(-1);
  }

  private move(delta: number): void {
    const ctx = this.cb.getContext();
    if (!ctx.blocks.length) return;
    const wasPlaying = this.state === 'playing';
    const idx = this.blockIdx < 0 ? (delta > 0 ? 0 : 0) : this.blockIdx;
    const newIdx = Math.max(0, Math.min(ctx.blocks.length - 1, idx + delta));
    if (newIdx === this.blockIdx && wasPlaying) return;
    this.blockIdx = newIdx;
    this.charOffset = 0;
    this.lastChar = 0;
    this.lastWordKey = '';
    const block = ctx.blocks[newIdx];
    if (this.state === 'playing') {
      this.speakBlock(0);
    } else {
      this.cb.onBlock(block.id);
      this.cb.onPosition(block.id, 0);
    }
  }

  /** Sync internal position without speaking (file restore, idle navigation). */
  seek(blockId: string | null, charOffset = 0): void {
    const ctx = this.cb.getContext();
    this.fileId = ctx.fileId;
    this.blockIdx = blockId ? ctx.blocks.findIndex((b) => b.id === blockId) : -1;
    this.charOffset = charOffset;
    this.lastChar = charOffset;
    this.lastWordKey = '';
  }

  /** After the block list was rebuilt (speech toggles changed). */
  resync(blockId: string | null, charOffset: number): void {
    const ctx = this.cb.getContext();
    this.fileId = ctx.fileId;
    this.blockIdx = blockId ? ctx.blocks.findIndex((b) => b.id === blockId) : -1;
    this.charOffset = charOffset;
    this.lastChar = charOffset;
    this.lastWordKey = '';
    if (this.state === 'playing') {
      if (this.blockIdx >= 0) this.speakBlock(this.charOffset);
      else this.finishFile();
    }
  }

  /** Voice/rate/pitch changed: restart from the current word (debounced). */
  applySettings(): void {
    if (this.state !== 'playing') return;
    this.debouncedApply();
  }

  // ---- internals ----------------------------------------------------------

  private restartFromCurrentWord(): void {
    if (this.state !== 'playing') return;
    const ctx = this.cb.getContext();
    const block = ctx.blocks[this.blockIdx];
    if (!block) return;
    const c = Math.min(this.lastChar, block.text.length);
    this.charOffset = wordStart(block.text, c);
    this.speakBlock(this.charOffset);
  }

  private speakBlock(fromChar: number): void {
    const ctx = this.cb.getContext();
    const block = ctx.blocks[this.blockIdx];
    if (!block) {
      this.finishFile();
      return;
    }
    this.cb.onBlock(block.id);
    const text = block.text.slice(fromChar);
    const sentences = splitSentences(text);
    if (!sentences.length) {
      this.advanceBlock();
      return;
    }
    this.cancelAll(); // bumps gen; stale events from previous speech are ignored
    this.setState('playing');
    this.charOffset = fromChar;
    this.lastChar = fromChar;
    this.lastWordKey = '';
    const gen = this.gen;
    const blockId = block.id;
    const fileId = ctx.fileId;
    const lang = this.resolveLang(ctx);
    const settings = ctx.settings;

    const queue = () => {
      if (gen !== this.gen || this.state !== 'playing') return;
      this.speakSequence(ctx, block, sentences, fromChar, gen, fileId, blockId, lang, settings);
    };
    // A tiny delay after cancel() avoids Chrome occasionally dropping the
    // first utterance of the new queue.
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(queue, CANCEL_RESTART_DELAY_MS);
  }

  private speakSequence(
    ctx: ControllerContext,
    block: SpeakableBlock,
    sentences: Sentence[],
    baseOffset: number,
    gen: number,
    fileId: string | null,
    blockId: string,
    lang: string | null,
    settings: Settings,
  ): void {
    const totalEnd = baseOffset + block.text.length - baseOffset;
    sentences.forEach((sentence, i) => {
      const uttStart = baseOffset + sentence.start;
      const utterEnd = uttStart + sentence.text.length;
      const u = new SpeechSynthesisUtterance(sentence.text);
      u.rate = settings.rate;
      u.pitch = settings.pitch;
      if (lang) u.lang = lang;
      const voice = pickVoice(settings.voiceURI, lang ?? '');
      if (voice) {
        try {
          u.voice = voice;
        } catch {
          // Some platforms reject certain voices; fall back to the default.
        }
      }
      const isLast = i === sentences.length - 1;

      u.onstart = () => {
        if (gen !== this.gen) return;
        this.startedAt = performance.now();
        this.boundarySeen = false;
        if (this.timeout) clearTimeout(this.timeout);
        this.timeout = setTimeout(() => {
          if (gen === this.gen && !this.boundarySeen && this.state === 'playing') {
            this.startEstimate(gen, uttStart, utterEnd);
          }
        }, BOUNDARY_TIMEOUT_MS);
      };

      u.onboundary = (e) => {
        if (gen !== this.gen) return;
        if (e.name !== 'word' || typeof e.charIndex !== 'number') return;
        this.boundarySeen = true;
        if (this.timer) {
          clearInterval(this.timer);
          this.timer = null;
        }
        const idx = uttStart + e.charIndex;
        this.updateWord(idx);
        this.cb.onPosition(blockId, idx);
      };

      u.onend = () => {
        if (gen !== this.gen) return;
        this.clearTimers();
        if (isLast) this.advanceBlock();
      };

      u.onerror = (e) => {
        if (gen !== this.gen) return;
        if (e.error === 'canceled' || e.error === 'interrupted') return; // cancel path
        this.clearTimers();
        this.setState('idle');
        this.cb.onError(`Speech error: ${e.error || 'unknown error'}`);
      };

      try {
        this.synth.speak(u);
      } catch {
        if (gen === this.gen) {
          this.setState('idle');
          this.cb.onError('Could not start speech synthesis.');
        }
      }
    });

    // Safety net: if onstart never fires for the first utterance, fall back
    // to the estimate so word highlighting still moves.
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = setTimeout(() => {
      if (gen === this.gen && this.state === 'playing' && !this.boundarySeen && !this.startedAt) {
        this.startedAt = performance.now();
        this.startEstimate(gen, baseOffset, totalEnd);
      }
    }, NO_START_FALLBACK_MS);
  }

  private startEstimate(gen: number, utterStart: number, utterEnd: number): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      if (gen !== this.gen) {
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
        return;
      }
      const ctx = this.cb.getContext();
      const elapsed = (performance.now() - this.startedAt) / 1000;
      const idx = Math.min(utterEnd, utterStart + elapsed * EST_CHARS_PER_SEC * ctx.settings.rate);
      const block = ctx.blocks[this.blockIdx];
      if (!block) return;
      this.updateWord(idx);
      this.cb.onPosition(block.id, idx);
    }, ESTIMATE_INTERVAL_MS);
  }

  private updateWord(charIndex: number): void {
    const ctx = this.cb.getContext();
    const block = ctx.blocks[this.blockIdx];
    if (!block) return;
    const text = block.text;
    const i = Math.max(0, Math.min(text.length, Math.floor(charIndex)));
    let start = wordStart(text, i);
    let end = wordEnd(text, i);
    if (start === end) {
      start = i;
      end = Math.min(text.length, i + 1);
    }
    this.lastChar = i;
    const key = `${this.blockIdx}:${start}:${end}`;
    if (key === this.lastWordKey) return;
    this.lastWordKey = key;
    this.cb.onWord(block.id, start, end);
  }

  private advanceBlock(): void {
    const ctx = this.cb.getContext();
    if (this.blockIdx + 1 < ctx.blocks.length) {
      this.blockIdx++;
      this.charOffset = 0;
      this.speakBlock(0);
    } else {
      this.finishFile();
    }
  }

  private finishFile(): void {
    this.clearTimers();
    const fileId = this.fileId;
    this.setState('idle');
    if (fileId) this.cb.onFileFinished(fileId);
  }

  private resolveLang(ctx: ControllerContext): string | null {
    if (ctx.settings.langOverride) return ctx.settings.langOverride;
    if (ctx.docLang) return ctx.docLang;
    return detectLangForContext(ctx);
  }
}

function detectLangForContext(ctx: ControllerContext): string | null {
  // Prefer the parse-time detection; fall back to a quick re-check.
  if (ctx.detectedLang) return ctx.detectedLang;
  const sample = ctx.blocks
    .slice(0, 3)
    .map((b) => b.text)
    .join(' ');
  return detectLang(sample);
}
