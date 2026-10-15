// offsetMap: maps indices in a block's *spoken* text to DOM positions, so a
// `charIndex` becomes a DOM Range even when inline content (code, math,
// images, links) is skipped or inserted.

import type { Segment, SpeakableBlock } from './types';

export interface Anchor {
  node: Node;
  offset: number;
}

export interface OffsetEntry {
  kind: 'copied' | 'inserted' | 'skipped';
  /** Anchor at the start of this entry's DOM span. */
  anchorStart: Anchor;
  /** Anchor at the end of this entry's DOM span. */
  anchorEnd: Anchor;
  textStart: number;
  textEnd: number;
}

export interface OffsetMap {
  textLength: number;
  entries: OffsetEntry[];
}

interface DomItem {
  type: 'text' | 'code' | 'img' | 'br';
  node: Node;
  text: string;
}

export function cssEscape(id: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(id);
  return id.replace(/["\\]/g, '\\$&');
}

export function findBlockElement(blockId: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector<HTMLElement>(`[data-block-id="${cssEscape(blockId)}"]`);
}

/** Collect DOM text nodes and code/img/br elements in document order. */
function collectDomItems(el: Element): DomItem[] {
  const items: DomItem[] = [];
  const walk = (node: Node): void => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.textContent ?? '';
      if (t) items.push({ type: 'text', node, text: t });
      return;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const tag = (node as Element).tagName.toLowerCase();
      if (tag === 'code') {
        items.push({ type: 'code', node, text: node.textContent ?? '' });
        return;
      }
      if (tag === 'img') {
        items.push({ type: 'img', node, text: (node as HTMLImageElement).alt ?? '' });
        return;
      }
      if (tag === 'br') {
        items.push({ type: 'br', node, text: '' });
        return;
      }
      for (let i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
  };
  walk(el);
  return items;
}

/** Anchor for an element node: (parent, childIndex) .. (parent, childIndex+1). */
function elementAnchors(node: Node): { start: Anchor; end: Anchor } {
  const parent = node.parentNode;
  if (!parent) return { start: { node, offset: 0 }, end: { node, offset: 0 } };
  const idx = Array.prototype.indexOf.call(parent.childNodes, node);
  return {
    start: { node: parent, offset: Math.max(0, idx) },
    end: { node: parent, offset: Math.max(0, idx) + 1 },
  };
}

function makeTextEntry(kind: OffsetEntry['kind'], textNode: Node, domStart: number, domEnd: number, textStart: number, textEnd: number): OffsetEntry {
  return {
    kind,
    anchorStart: { node: textNode, offset: domStart },
    anchorEnd: { node: textNode, offset: domEnd },
    textStart,
    textEnd,
  };
}

function makeElementEntry(kind: OffsetEntry['kind'], el: Node, textStart: number, textEnd: number): OffsetEntry {
  const { start, end } = elementAnchors(el);
  return { kind, anchorStart: start, anchorEnd: end, textStart, textEnd };
}

/** Align the mdast segments with the rendered DOM (lockstep walk). */
export function buildOffsetMap(block: SpeakableBlock, element: Element): OffsetMap | null {
  const items = collectDomItems(element);
  const entries: OffsetEntry[] = [];
  let ii = 0;
  let currentSegNode: unknown = null;
  const pendingSeps: Array<{ textStart: number; textEnd: number }> = [];

  const flushSeps = (anchorStart: Anchor): void => {
    for (const s of pendingSeps) {
      entries.push({ kind: 'inserted', anchorStart, anchorEnd: anchorStart, textStart: s.textStart, textEnd: s.textEnd });
    }
    pendingSeps.length = 0;
  };

  for (const seg of block.segments) {
    if (seg.kind === 'sep') {
      pendingSeps.push({ textStart: seg.textStart, textEnd: seg.textEnd });
      continue;
    }

    let item: DomItem | undefined;
    let domStart: number;
    let domEnd: number;
    let entry: OffsetEntry;

    if (seg.kind === 'text' || seg.kind === 'math') {
      if (seg.node === currentSegNode && ii > 0 && items[ii - 1].type === 'text') {
        item = items[ii - 1];
      } else {
        item = nextItemOfType(items, ii, 'text');
        if (item) {
          ii++;
          currentSegNode = seg.node;
        }
      }
      if (!item || item.type !== 'text') {
        entries.length = 0;
        break; // fall back below
      }
      // Verify the text node matches the mdast text node.
      const mdastValue = segMdastValue(seg);
      if (mdastValue !== null && item.text !== mdastValue) {
        const found = searchTextItem(items, ii, mdastValue);
        if (found) {
          item = found.item;
          ii = found.index + 1;
          currentSegNode = seg.node;
        } else {
          entries.length = 0;
          break;
        }
      }
      domStart = Math.max(0, Math.min(item.text.length, seg.domStart ?? 0));
      domEnd = Math.max(domStart, Math.min(item.text.length, seg.domEnd ?? domStart));
      entry = makeTextEntry(seg.kind === 'text' ? 'copied' : 'skipped', item.node, domStart, domEnd, seg.textStart, seg.textEnd);
    } else {
      const type = seg.expected ?? (seg.kind === 'code' || seg.kind === 'skip' ? 'code' : seg.kind === 'image' ? 'img' : 'br');
      item = nextItemOfType(items, ii, type);
      if (!item) {
        entries.length = 0;
        break;
      }
      ii++;
      const spoken = seg.kind === 'code' || seg.kind === 'image' || seg.kind === 'break';
      entry = makeElementEntry(spoken ? 'copied' : 'skipped', item.node, seg.textStart, seg.textEnd);
    }

    flushSeps(entry.anchorStart);
    entries.push(entry);
  }

  if (entries.length) {
    flushSeps(entries[entries.length - 1].anchorEnd);
    return { textLength: block.text.length, entries };
  }
  return buildFallbackMap(block, items);
}

function segMdastValue(seg: Segment): string | null {
  const n = seg.node as { value?: unknown } | undefined;
  return typeof n?.value === 'string' ? n.value : null;
}

function nextItemOfType(items: DomItem[], from: number, type: DomItem['type']): DomItem | undefined {
  for (let i = from; i < items.length; i++) {
    if (items[i].type === type) return items[i];
  }
  return undefined;
}

function searchTextItem(items: DomItem[], from: number, value: string): { item: DomItem; index: number } | null {
  for (let i = from; i < Math.min(items.length, from + 20); i++) {
    if (items[i].type === 'text' && items[i].text === value) return { item: items[i], index: i };
  }
  return null;
}

/**
 * Degraded fallback: map DOM text items sequentially onto the spoken text.
 * Only used when the lockstep alignment fails; still lets word highlighting
 * work approximately.
 */
function buildFallbackMap(block: SpeakableBlock, items: DomItem[]): OffsetMap | null {
  const textItems = items.filter((i) => i.type === 'text');
  if (!textItems.length) return null;
  const entries: OffsetEntry[] = [];
  let cursor = 0;
  for (const item of textItems) {
    const idx = block.text.indexOf(item.text, cursor);
    const start = idx >= 0 ? idx : cursor;
    const end = idx >= 0 ? idx + item.text.length : cursor;
    entries.push(makeTextEntry('copied', item.node, 0, item.text.length, start, end));
    if (idx >= 0) cursor = end;
  }
  return { textLength: block.text.length, entries };
}

// ---- range resolution ------------------------------------------------------

/** First entry whose textEnd > c, clamped to the last entry. */
function findIndex(map: OffsetMap, c: number): number {
  const { entries } = map;
  let lo = 0;
  let hi = entries.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (entries[mid].textEnd > c) hi = mid;
    else lo = mid + 1;
  }
  return Math.min(lo, entries.length - 1);
}

function anchorInside(entry: OffsetEntry, c: number): Anchor {
  if (c <= entry.textStart) return entry.anchorStart;
  if (c >= entry.textEnd) return entry.anchorEnd;
  // Inside a copied text span: interpolate within the text node.
  const { anchorStart, anchorEnd } = entry;
  if (anchorStart.node !== anchorEnd.node) return anchorStart;
  const span = entry.textEnd - entry.textStart;
  if (span <= 0) return anchorStart;
  const ratio = (c - entry.textStart) / span;
  const offset = Math.round(anchorStart.offset + (anchorEnd.offset - anchorStart.offset) * ratio);
  return { node: anchorStart.node, offset };
}

/** Resolve a spoken-text range [start, end) to a DOM Range. */
export function resolveRange(map: OffsetMap, start: number, end: number): Range | null {
  const { entries } = map;
  if (!entries.length || typeof document === 'undefined') return null;
  const clampedStart = Math.max(0, Math.min(map.textLength, start));
  const clampedEnd = Math.max(clampedStart, Math.min(map.textLength, end));
  const s = anchorInside(entries[findIndex(map, clampedStart)], clampedStart);
  const e = anchorInside(entries[findIndex(map, clampedEnd)], clampedEnd);
  try {
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return range;
  } catch {
    return null;
  }
}
