export interface TextAnchor {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export type RangeAnchorResult =
  | { ok: true; anchor: TextAnchor; clamped: boolean }
  | { ok: false; reason: 'collapsed' | 'outside' | 'empty' };

interface TextPart {
  node: Text;
  start: number;
  end: number;
}

function textParts(block: HTMLElement): TextPart[] {
  const parts: TextPart[] = [];
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let parent = node.parentElement;
    let nestedBlock = false;
    while (parent && parent !== block) {
      if (parent.hasAttribute('data-block-id')) { nestedBlock = true; break; }
      parent = parent.parentElement;
    }
    if (nestedBlock) continue;
    const text = node as Text;
    parts.push({ node: text, start: cursor, end: cursor + text.data.length });
    cursor += text.data.length;
  }
  return parts;
}

export function getBlockText(blockEl: HTMLElement): string {
  return textParts(blockEl).map(({ node }) => node.data).join('');
}

function closestBlock(node: Node, root: HTMLElement): HTMLElement | null {
  let element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
  while (element && element !== root) {
    if (element instanceof HTMLElement && element.hasAttribute('data-block-id')) return element;
    element = element.parentElement;
  }
  return element === root && root.hasAttribute('data-block-id') ? root : null;
}

function comparePointToNodeEdge(container: Node, offset: number, part: TextPart, edge: 'start' | 'end'): number {
  const point = document.createRange();
  point.setStart(container, offset);
  point.collapse(true);
  const edgeRange = document.createRange();
  edgeRange.setStart(part.node, edge === 'start' ? 0 : part.node.length);
  edgeRange.collapse(true);
  return point.compareBoundaryPoints(Range.START_TO_START, edgeRange);
}

function boundaryOffset(
  container: Node,
  rawOffset: number,
  parts: TextPart[],
  affinity: 'start' | 'end',
): number | null {
  const offset = Math.max(0, Math.min(rawOffset, container.nodeType === Node.TEXT_NODE ? container.textContent?.length ?? 0 : container.childNodes.length));
  const direct = parts.find((part) => part.node === container);
  if (direct) return direct.start + offset;
  if (affinity === 'start') {
    for (const part of parts) {
      if (comparePointToNodeEdge(container, offset, part, 'start') <= 0) return part.start;
      if (comparePointToNodeEdge(container, offset, part, 'end') < 0) {
        const probe = document.createRange();
        probe.setStart(container, offset);
        probe.collapse(true);
        for (let i = 0; i <= part.node.length; i++) {
          const charPoint = document.createRange();
          charPoint.setStart(part.node, i);
          charPoint.collapse(true);
          if (probe.compareBoundaryPoints(Range.START_TO_START, charPoint) <= 0) return part.start + i;
        }
      }
    }
    return parts.length ? parts[parts.length - 1].end : null;
  }
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (comparePointToNodeEdge(container, offset, part, 'end') >= 0) return part.end;
    if (comparePointToNodeEdge(container, offset, part, 'start') > 0) {
      const probe = document.createRange();
      probe.setStart(container, offset);
      probe.collapse(true);
      for (let j = part.node.length; j >= 0; j--) {
        const charPoint = document.createRange();
        charPoint.setStart(part.node, j);
        charPoint.collapse(true);
        if (probe.compareBoundaryPoints(Range.START_TO_START, charPoint) >= 0) return part.start + j;
      }
    }
  }
  return parts.length ? parts[0].start : null;
}

function rangeAtOffsets(block: HTMLElement, parts: TextPart[], start: number, end: number): Range | null {
  const locate = (offset: number, isEnd: boolean): [Text, number] | null => {
    for (const part of parts) {
      if (offset >= part.start && offset <= part.end && (isEnd ? offset > part.start || offset === 0 : offset < part.end || offset === 0)) {
        return [part.node, offset - part.start];
      }
    }
    const last = parts.at(-1);
    return last && offset === last.end ? [last.node, last.node.length] : null;
  };
  const a = locate(start, false);
  const b = locate(end, true);
  if (!a || !b) return null;
  const range = document.createRange();
  range.setStart(a[0], a[1]);
  range.setEnd(b[0], b[1]);
  if (!block.contains(range.commonAncestorContainer) && range.commonAncestorContainer !== block) return null;
  return range;
}

export function rangeToAnchor(range: Range, root: HTMLElement): RangeAnchorResult {
  if (range.collapsed) return { ok: false, reason: 'collapsed' };
  if (!root.contains(range.startContainer)) return { ok: false, reason: 'outside' };
  const block = closestBlock(range.startContainer, root);
  const blockId = block?.getAttribute('data-block-id');
  if (!block || !blockId) return { ok: false, reason: 'empty' };
  const parts = textParts(block);
  const text = parts.map(({ node }) => node.data).join('');
  if (!text.length) return { ok: false, reason: 'empty' };
  let start = boundaryOffset(range.startContainer, range.startOffset, parts, 'start');
  let end = boundaryOffset(range.endContainer, range.endOffset, parts, 'end');
  if (start === null || end === null) return { ok: false, reason: 'empty' };
  start = Math.min(start, text.length);
  const lastPart = parts[parts.length - 1];
  let clamped = !block.contains(range.endContainer) || (!!lastPart && comparePointToNodeEdge(range.endContainer, range.endOffset, lastPart, 'end') > 0);
  if (end > text.length) { end = text.length; clamped = true; }
  if (end < start) end = start;
  while (start < end && /\s/u.test(text[start])) start++;
  while (end > start && /\s/u.test(text[end - 1])) end--;
  if (start === end) return { ok: false, reason: 'empty' };
  return {
    ok: true,
    clamped,
    anchor: {
      blockId,
      start,
      end,
      quote: text.slice(start, end),
      prefix: text.slice(Math.max(0, start - 32), start),
      suffix: text.slice(end, end + 32),
    },
  };
}

function contextScore(text: string, start: number, end: number, anchor: TextAnchor): number {
  const before = text.slice(Math.max(0, start - anchor.prefix.length), start);
  const after = text.slice(end, end + anchor.suffix.length);
  let score = 0;
  for (let i = 1; i <= Math.min(before.length, anchor.prefix.length); i++) {
    if (before.at(-i) !== anchor.prefix.at(-i)) break;
    score++;
  }
  for (let i = 0; i < Math.min(after.length, anchor.suffix.length); i++) {
    if (after[i] !== anchor.suffix[i]) break;
    score++;
  }
  return score;
}

export function anchorToRange(anchor: TextAnchor, root: HTMLElement): Range | null {
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-block-id]')];
  if (root.hasAttribute('data-block-id')) blocks.unshift(root);
  const preferred = blocks.find((block) => block.getAttribute('data-block-id') === anchor.blockId);
  if (preferred) {
    const parts = textParts(preferred);
    const text = parts.map(({ node }) => node.data).join('');
    if (anchor.start >= 0 && anchor.end >= anchor.start && text.slice(anchor.start, anchor.end) === anchor.quote) {
      const exact = rangeAtOffsets(preferred, parts, anchor.start, anchor.end);
      if (exact) return exact;
    }
  }
  if (!anchor.quote) return null;
  const matches: { block: HTMLElement; parts: TextPart[]; start: number; end: number; score: number }[] = [];
  for (const block of blocks) {
    const parts = textParts(block);
    const text = parts.map(({ node }) => node.data).join('');
    let from = 0;
    while (true) {
      const start = text.indexOf(anchor.quote, from);
      if (start < 0) break;
      const end = start + anchor.quote.length;
      matches.push({ block, parts, start, end, score: contextScore(text, start, end, anchor) });
      from = start + 1;
    }
  }
  if (!matches.length) return null;
  const highest = Math.max(...matches.map((match) => match.score));
  const best = matches.filter((match) => match.score === highest);
  if (best.length !== 1) return null;
  return rangeAtOffsets(best[0].block, best[0].parts, best[0].start, best[0].end);
}
