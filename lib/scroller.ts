// Auto-scroll: keeps the current block centered. Manual scrolling pauses
// auto-scroll and surfaces the "Jump to current" button.

import { prefersReducedMotion } from './utils';
import { resolveWordRange } from './highlight';
import { findBlockElement } from './offsetMap';

interface ScrollerDeps {
  isPlaying(): boolean;
  autoScrollOn(): boolean;
  currentBlockId(): string | null;
  setSuspended(v: boolean): void;
}

let deps: ScrollerDeps | null = null;
let suspended = false;
let lastAuto = 0;
let lastWordScroll = 0;
let wired = false;

export function initScroller(d: ScrollerDeps): void {
  deps = d;
  if (wired || typeof window === 'undefined') return;
  wired = true;

  // Wheel/touch are unambiguously user-initiated.
  window.addEventListener('wheel', () => suspend(), { passive: true });
  window.addEventListener('touchmove', () => suspend(), { passive: true });
  // Scroll events also fire for programmatic scrollIntoView; only treat a
  // scroll as user-initiated once enough time has passed since the last
  // automatic scroll.
  window.addEventListener('scroll', () => {
    if (performance.now() - lastAuto < 1500) return;
    suspend();
  }, { passive: true });
}

function suspend(): void {
  if (!deps) return;
  if (suspended) return;
  if (!deps.autoScrollOn()) return;
  if (!deps.isPlaying()) return;
  suspended = true;
  deps.setSuspended(true);
}

export function isSuspended(): boolean {
  return suspended;
}

export function scrollToBlock(blockId: string | null, opts?: { force?: boolean; instant?: boolean }): void {
  if (!blockId || !deps) return;
  if (!opts?.force) {
    if (!deps.autoScrollOn() || suspended) return;
  }
  const el = findBlockElement(blockId);
  if (!el) return;
  const behavior = opts?.instant || prefersReducedMotion() ? 'auto' : 'smooth';
  try {
    el.scrollIntoView({ behavior, block: 'center' });
    lastAuto = performance.now();
  } catch {
    // ignore
  }
}

export function resumeAutoScroll(): void {
  if (!deps) return;
  suspended = false;
  deps.setSuspended(false);
  scrollToBlock(deps.currentBlockId(), { force: true });
}

/** While reading a long block, keep the spoken word inside the viewport. */
export function checkWordVisible(blockId: string, start: number, end: number): void {
  if (!deps || suspended || !deps.autoScrollOn() || !deps.isPlaying()) return;
  const range = resolveWordRange(blockId, start, end);
  if (!range) return;
  const rect = range.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return;
  const NAV_TOP = 84;
  const BOTTOM_PAD = 28;
  if (rect.top >= NAV_TOP && rect.bottom <= window.innerHeight - BOTTOM_PAD) return;
  const now = performance.now();
  if (now - lastWordScroll < 700) return;
  lastWordScroll = now;
  scrollToBlock(blockId);
}
