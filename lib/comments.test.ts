// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LessonComment } from './db/schema';
import {
  findNextSpeakableBlock,
  getCommentDeepLinkState,
  pickCommentAtPoint,
  resolveAll,
} from './comments';
import { registerCommentHighlights } from './commentHighlights';

const comment = (id: string, blockId: string, quote: string, start = 0): LessonComment => ({
  id,
  courseId: 'course',
  lessonId: 'lesson',
  text: `note ${id}`,
  anchor: { blockId, start, end: start + quote.length, quote, prefix: '', suffix: '' },
  order: 0,
  createdAt: 1,
  updatedAt: 2,
});

describe('comment range helpers', () => {
  it('hit tests rects with tolerance and sorts overlaps by quote length', () => {
    const hits = pickCommentAtPoint([
      { id: 'long', quoteLength: 12, rects: [{ left: 10, right: 30, top: 10, bottom: 20 }] },
      { id: 'short', quoteLength: 4, rects: [{ left: 20, right: 40, top: 10, bottom: 20 }] },
      { id: 'miss', quoteLength: 1, rects: [{ left: 100, right: 120, top: 100, bottom: 120 }] },
    ], 18, 21);
    expect(hits).toEqual(['short', 'long']);
    expect(pickCommentAtPoint([{ id: 'a', quoteLength: 1, rects: [{ left: 0, right: 10, top: 0, bottom: 10 }] }], 13, 5)).toEqual([]);
  });

  it('resolves anchors and reports unresolved comment ids', () => {
    const root = document.createElement('article');
    root.innerHTML = '<p data-block-id="p1">read this line</p>';
    const result = resolveAll([comment('yes', 'p1', 'this'), comment('no', 'gone', 'lost')], root);
    expect(result.resolved.map((item) => item.id)).toEqual(['yes']);
    expect(result.resolved[0].range.toString()).toBe('this');
    expect(result.unresolvedIds).toEqual(new Set(['no']));
  });

  it('moves non-speakable comments to the next speakable block in DOM order', () => {
    const root = document.createElement('article');
    root.innerHTML = '<pre data-block-id="c-1-code"></pre><p data-block-id="2-p">next</p><p data-block-id="3-p">later</p>';
    const ids = new Set(['2-p', '3-p']);
    expect(findNextSpeakableBlock('c-1-code', root, ids)).toBe('2-p');
    expect(findNextSpeakableBlock('2-p', root, ids)).toBe('2-p');
    expect(findNextSpeakableBlock('3-p', root, ids)).toBe('3-p');
  });

  it('models deep links through pending, resolved, unresolved, missing and timeout states', () => {
    const rows = [comment('c1', 'p1', 'text')];
    expect(getCommentDeepLinkState('c1', rows, false, new Set(), false)).toBe('pending');
    expect(getCommentDeepLinkState('c1', rows, false, new Set(), true)).toBe('timeout');
    expect(getCommentDeepLinkState('missing', rows, true, new Set(), false)).toBe('not-found');
    expect(getCommentDeepLinkState('c1', rows, true, new Set(), false)).toBe('resolved');
    expect(getCommentDeepLinkState('c1', rows, true, new Set(['c1']), false)).toBe('unresolved');
  });
});

describe('comment highlight registration', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('registers both highlight layers at their priorities and removes them on cleanup', () => {
    const entries = new Map<string, { priority: number; ranges: Range[] }>();
    const deleted: string[] = [];
    vi.stubGlobal('CSS', { highlights: {
      set: (name: string, highlight: { priority: number; ranges: Range[] }) => entries.set(name, highlight),
      delete: (name: string) => deleted.push(name),
    } });
    vi.stubGlobal('Highlight', class {
      priority = 0;
      constructor(...ranges: Range[]) { this.ranges = ranges; }
      ranges: Range[];
    });
    const range = document.createRange();
    const cleanup = registerCommentHighlights([range], [range]);
    expect(entries.get('comment')?.priority).toBe(1);
    expect(entries.get('comment-active')?.priority).toBe(2);
    cleanup?.();
    expect(deleted).toEqual(['comment', 'comment-active']);
  });
});
