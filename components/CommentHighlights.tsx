'use client';

import { useEffect, useRef, type RefObject } from 'react';
import type { LessonComment } from '@/lib/db/schema';
import { resolveAll, type ResolvedComment } from '@/lib/comments';
import { registerCommentHighlights } from '@/lib/commentHighlights';
import { useStore } from '@/lib/store';

export default function CommentHighlights({
  rootRef,
  comments,
  activeId,
  lessonId,
  onResolvedChange,
}: {
  rootRef: RefObject<HTMLElement | null>;
  comments: LessonComment[];
  activeId: string | null;
  lessonId: string;
  onResolvedChange(resolved: ResolvedComment[]): void;
}) {
  const toast = useStore((state) => state.toast);
  const setUnresolved = useStore((state) => state.setUnresolvedCommentIds);
  const missingSupportNotified = useRef(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) {
      setUnresolved(new Set());
      onResolvedChange([]);
      return;
    }
    let registration: (() => void) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      registration?.();
      const { resolved, unresolvedIds } = resolveAll(comments, root);
      setUnresolved(unresolvedIds);
      onResolvedChange(resolved);
      registration = registerCommentHighlights(
        resolved.map((item) => item.range),
        resolved.filter((item) => item.id === activeId).map((item) => item.range),
      );
      if (!registration && !missingSupportNotified.current) {
        missingSupportNotified.current = true;
        toast('Comment highlights need a newer browser', 'warning');
      }
    };
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 150);
    };
    update();
    const observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
    return () => {
      observer.disconnect();
      if (timer) clearTimeout(timer);
      registration?.();
      setUnresolved(new Set());
      onResolvedChange([]);
    };
  }, [activeId, comments, lessonId, onResolvedChange, rootRef, setUnresolved, toast]);

  return null;
}
