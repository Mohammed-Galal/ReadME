export const COMMENT_HIGHLIGHT_NAME = 'comment';
export const ACTIVE_COMMENT_HIGHLIGHT_NAME = 'comment-active';

interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): unknown;
  delete(name: string): unknown;
}

function getRegistry(): HighlightRegistryLike | null {
  if (typeof CSS === 'undefined') return null;
  return (CSS as unknown as { highlights?: HighlightRegistryLike }).highlights ?? null;
}

export function hasCommentHighlightSupport(): boolean {
  return !!getRegistry() && typeof Highlight !== 'undefined';
}

export function registerCommentHighlights(ranges: Range[], activeRanges: Range[]): (() => void) | null {
  const registry = getRegistry();
  if (!registry || typeof Highlight === 'undefined') return null;
  try {
    const comments = new Highlight(...ranges);
    const active = new Highlight(...activeRanges);
    comments.priority = 1;
    active.priority = 2;
    registry.set(COMMENT_HIGHLIGHT_NAME, comments);
    registry.set(ACTIVE_COMMENT_HIGHLIGHT_NAME, active);
    return () => {
      registry.delete(COMMENT_HIGHLIGHT_NAME);
      registry.delete(ACTIVE_COMMENT_HIGHLIGHT_NAME);
    };
  } catch {
    registry.delete(COMMENT_HIGHLIGHT_NAME);
    registry.delete(ACTIVE_COMMENT_HIGHLIGHT_NAME);
    return null;
  }
}
