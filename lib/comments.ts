import { anchorToRange, type TextAnchor } from './anchors';
import type { LessonComment } from './db/schema';

export interface ResolvedComment {
  id: string;
  range: Range;
  quoteLength: number;
}

export interface ClientRectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface CommentHitEntry {
  id: string;
  rects: readonly ClientRectLike[];
  quoteLength: number;
}

export function resolveAll(comments: LessonComment[], root: HTMLElement): {
  resolved: ResolvedComment[];
  unresolvedIds: Set<string>;
} {
  const resolved: ResolvedComment[] = [];
  const unresolvedIds = new Set<string>();
  for (const comment of comments) {
    const range = anchorToRange(comment.anchor as TextAnchor, root);
    if (range) resolved.push({ id: comment.id, range, quoteLength: comment.anchor.quote.length });
    else unresolvedIds.add(comment.id);
  }
  return { resolved, unresolvedIds };
}

export function pickCommentAtPoint(entries: readonly CommentHitEntry[], x: number, y: number): string[] {
  return entries
    .filter(({ rects }) => rects.some((rect) => x >= rect.left - 2 && x <= rect.right + 2 && y >= rect.top - 2 && y <= rect.bottom + 2))
    .sort((a, b) => a.quoteLength - b.quoteLength)
    .map(({ id }) => id);
}

export type CommentDeepLinkState = 'pending' | 'resolved' | 'unresolved' | 'not-found' | 'timeout';

export function getCommentDeepLinkState(
  commentId: string,
  comments: readonly LessonComment[],
  ready: boolean,
  unresolvedIds: ReadonlySet<string>,
  timedOut: boolean,
): CommentDeepLinkState {
  if (!ready) return timedOut ? 'timeout' : 'pending';
  const comment = comments.find((item) => item.id === commentId);
  if (!comment) return 'not-found';
  return unresolvedIds.has(commentId) ? 'unresolved' : 'resolved';
}

export function findNextSpeakableBlock(
  blockId: string,
  root: HTMLElement,
  speakableIds: ReadonlySet<string>,
): string | null {
  const blocks = [...root.querySelectorAll<HTMLElement>('[data-block-id]')];
  const index = blocks.findIndex((element) => element.dataset.blockId === blockId);
  if (index < 0) return null;
  if (speakableIds.has(blockId)) return blockId;
  for (let i = index + 1; i < blocks.length; i++) {
    const id = blocks[i].dataset.blockId;
    if (id && speakableIds.has(id)) return id;
  }
  return null;
}
