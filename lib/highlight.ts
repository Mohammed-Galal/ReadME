// Imperative word highlighting: CSS Custom Highlight API with a <mark>
// fallback. Never driven through per-word React state.

import type { SpeakableBlock } from './types';
import { buildOffsetMap, findBlockElement, resolveRange, type OffsetMap } from './offsetMap';

const HIGHLIGHT_NAME = 'readme-word';
const MARK_CLASS = 'readme-word-mark';

let blocksById = new Map<string, SpeakableBlock>();
const maps = new Map<string, OffsetMap>();
let mark: HTMLElement | null = null;
let useMarkFallback = typeof CSS === 'undefined' || !('highlights' in CSS);

function highlightsRegistry(): { set(name: string, hl: Highlight): void } | null {
  if (typeof CSS === 'undefined' || !('highlights' in CSS)) return null;
  return (CSS as unknown as { highlights?: { set(name: string, hl: Highlight): void } }).highlights ?? null;
}

export function setBlocks(blocks: SpeakableBlock[]): void {
  blocksById = new Map(blocks.map((b) => [b.id, b]));
  maps.clear();
  clearWord();
}

export function clearAll(): void {
  blocksById.clear();
  maps.clear();
  clearWord();
}

export function resolveWordRange(blockId: string, start: number, end: number): Range | null {
  const map = mapFor(blockId);
  if (!map) return null;
  return resolveRange(map, start, end);
}

function mapFor(blockId: string): OffsetMap | null {
  const block = blocksById.get(blockId);
  if (!block) return null;
  const cached = maps.get(blockId);
  if (cached) return cached;
  const el = findBlockElement(blockId);
  if (!el) return null;
  const built = buildOffsetMap(block, el);
  if (!built) return null;
  maps.set(blockId, built);
  return built;
}

export function updateWord(blockId: string, start: number, end: number): void {
  const range = resolveWordRange(blockId, start, end);
  if (!range) return;
  if (!useMarkFallback) {
    const registry = highlightsRegistry();
    if (registry) {
      try {
        const highlight = new Highlight(range);
        highlight.priority = 3;
        registry.set(HIGHLIGHT_NAME, highlight);
        return;
      } catch {
        useMarkFallback = true;
      }
    } else {
      useMarkFallback = true;
    }
  }
  applyMark(range);
}

function applyMark(range: Range): void {
  removeMark();
  try {
    const m = document.createElement('mark');
    m.className = MARK_CLASS;
    range.surroundContents(m);
    mark = m;
  } catch {
    // Partial/non-text ranges can't be surrounded; skip the fallback.
  }
}

function removeMark(): void {
  if (!mark) return;
  const parent = mark.parentNode;
  if (parent) {
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
  }
  mark = null;
}

export function clearWord(): void {
  if (!useMarkFallback) {
    const registry = highlightsRegistry();
    if (registry) {
      try {
        registry.set(HIGHLIGHT_NAME, new Highlight());
      } catch {
        // ignore
      }
      return;
    }
  }
  removeMark();
}
