'use client';

// Main section: TOC, rendered markdown (from the same mdast -> hast pipeline),
// click-to-read event delegation on data-block-id.

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Spinner } from 'react-bootstrap';
import { resumeAutoScroll } from '@/lib/scroller';
import { useStore } from '@/lib/store';
import { useLessonComments } from '@/lib/dataHooks';
import { findNextSpeakableBlock, getCommentDeepLinkState, pickCommentAtPoint, resolveAll, type ResolvedComment } from '@/lib/comments';
import { prefersReducedMotion } from '@/lib/utils';
import type { LessonComment } from '@/lib/db/schema';
import MarkdownView from './MarkdownView';
import TableOfContents from './TableOfContents';
import SelectionCommentAction from './SelectionCommentAction';
import CommentHighlights from './CommentHighlights';
import CommentViewer from './CommentViewer';

export default function MainContent({
  courseId,
  lessonId,
  commentId,
  onCommentParamConsumed,
}: {
  courseId: string;
  lessonId: string;
  commentId: string | null;
  onCommentParamConsumed(): void;
}) {
  const contentRef = useRef<HTMLElement | null>(null);
  const [resolvedComments, setResolvedComments] = useState<ResolvedComment[]>([]);
  const [activeCommentId, setActiveCommentId] = useState<string | null>(null);
  const [matchingIds, setMatchingIds] = useState<string[]>([]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [deepLinkTimedOut, setDeepLinkTimedOut] = useState(false);
  const handledDeepLink = useRef('');
  const pulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkKey = `${lessonId}:${commentId ?? ''}`;
  const { comments, loading: commentsLoading } = useLessonComments(lessonId);
  const unresolvedIds = useStore((state) => state.unresolvedCommentIds);
  const activeFile = useStore((s) => s.files.find((f) => f.id === s.activeFileId));
  const hast = useStore((s) => s.hast);
  const blocks = useStore((s) => s.blocks);
  const headings = useStore((s) => s.headings);
  const parsing = useStore((s) => s.parsing);
  const parseError = useStore((s) => s.parseError);
  const updateResolved = useCallback((items: ResolvedComment[]) => setResolvedComments(items), []);
  const closeViewer = useCallback(() => {
    setViewerOpen(false);
    setActiveCommentId(null);
    setMatchingIds([]);
  }, []);

  useEffect(() => {
    handledDeepLink.current = '';
    setDeepLinkTimedOut(false);
    if (!commentId) return;
    const timer = setTimeout(() => setDeepLinkTimedOut(true), 3000);
    return () => clearTimeout(timer);
  }, [commentId, lessonId]);

  useEffect(() => {
    setViewerOpen(false);
    setActiveCommentId(null);
    setMatchingIds([]);
    setResolvedComments([]);
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
  }, [lessonId]);

  useEffect(() => () => {
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
  }, []);

  useEffect(() => {
    if (activeCommentId && !comments.some((comment) => comment.id === activeCommentId)) closeViewer();
  }, [activeCommentId, closeViewer, comments]);

  const openComments = useCallback((ids: string[]) => {
    if (!ids.length) return;
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    setMatchingIds(ids);
    setActiveCommentId(ids[0]);
    setViewerOpen(true);
  }, []);

  const readFromComment = useCallback((comment: LessonComment) => {
    const root = contentRef.current;
    if (!root) return;
    const range = resolveAll([comment], root).resolved[0]?.range;
    const container = range?.startContainer;
    const element = container?.nodeType === Node.ELEMENT_NODE ? container as Element : container?.parentElement;
    const actualBlock = element?.closest<HTMLElement>('[data-block-id]')?.dataset.blockId ?? comment.anchor.blockId;
    const ids = new Set(useStore.getState().blocks.map((block) => block.id));
    const target = findNextSpeakableBlock(actualBlock, root, ids);
    if (!target) {
      useStore.getState().toast('There is no readable text after this comment.', 'warning');
      return;
    }
    resumeAutoScroll();
    useStore.getState().playFromBlock(target);
  }, []);

  useEffect(() => {
    if (!commentId || handledDeepLink.current === deepLinkKey) return;
    const root = contentRef.current;
    const ready = !commentsLoading && !parsing && !!root;
    const found = root && !commentsLoading ? resolveAll(comments, root) : { resolved: [], unresolvedIds: new Set<string>() };
    const state = getCommentDeepLinkState(commentId, comments, ready, found.unresolvedIds, deepLinkTimedOut);
    if (state === 'pending') return;
    handledDeepLink.current = deepLinkKey;
    onCommentParamConsumed();
    if (state === 'not-found') {
      useStore.getState().toast('That comment no longer exists', 'warning');
      return;
    }
    if (state === 'timeout') {
      useStore.getState().toast('Could not load the source for this comment.', 'warning');
      return;
    }
    const comment = comments.find((item) => item.id === commentId);
    if (!comment) return;
    setMatchingIds([comment.id]);
    setActiveCommentId(comment.id);
    if (state === 'unresolved') {
      setViewerOpen(true);
      return;
    }
    setViewerOpen(false);
    const range = found.resolved.find((item) => item.id === comment.id)?.range;
    if (range) {
      const element = range.startContainer.nodeType === Node.ELEMENT_NODE ? range.startContainer as Element : range.startContainer.parentElement;
      const block = element?.closest<HTMLElement>('[data-block-id]');
      if (block) {
        const speakable = new Set(useStore.getState().blocks.map((item) => item.id));
        const target = findNextSpeakableBlock(block.dataset.blockId ?? '', root!, speakable);
        if (target) useStore.getState().setCurrentBlock(target, { scroll: false });
        block.setAttribute('data-flash', 'true');
        block.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' });
        setTimeout(() => block.removeAttribute('data-flash'), 2000);
      }
    }
    if (pulseTimer.current) clearTimeout(pulseTimer.current);
    pulseTimer.current = setTimeout(() => {
      setActiveCommentId((current) => current === comment.id ? null : current);
      pulseTimer.current = null;
    }, 2000);
  }, [commentId, comments, commentsLoading, deepLinkKey, deepLinkTimedOut, onCommentParamConsumed, parsing]);

  const handleClick = (e: React.MouseEvent<HTMLElement>): void => {
    // Ignore clicks that are text selections or link activations.
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const target = e.target as HTMLElement;
    if (target.closest('a')) return;
    const hits = pickCommentAtPoint(resolvedComments.map((item) => ({
      id: item.id,
      quoteLength: item.quoteLength,
      rects: [...item.range.getClientRects()],
    })), e.clientX, e.clientY);
    if (hits.length) {
      openComments(hits);
      return;
    }
    const el = target.closest<HTMLElement>('[data-block-id]');
    if (!el) return;
    const id = el.dataset.blockId;
    if (!id) return;
    const exists = useStore.getState().blocks.some((b) => b.id === id);
    if (!exists) return; // e.g. a table row with "read tables" off
    resumeAutoScroll();
    useStore.getState().playFromBlock(id);
  };

  const mousePoint = useRef<{ x: number; y: number } | null>(null);
  const mouseFrame = useRef(0);
  const handleMouseMove = (event: React.MouseEvent<HTMLElement>) => {
    if (!window.matchMedia('(pointer: fine)').matches) return;
    mousePoint.current = { x: event.clientX, y: event.clientY };
    if (mouseFrame.current) return;
    mouseFrame.current = requestAnimationFrame(() => {
      mouseFrame.current = 0;
      const point = mousePoint.current;
      const root = contentRef.current;
      if (!point || !root) return;
      const hits = pickCommentAtPoint(resolvedComments.map((item) => ({ id: item.id, quoteLength: item.quoteLength, rects: [...item.range.getClientRects()] })), point.x, point.y);
      if (hits.length) root.setAttribute('data-over-comment', 'true');
      else root.removeAttribute('data-over-comment');
    });
  };
  const clearCommentHover = () => {
    if (mouseFrame.current) cancelAnimationFrame(mouseFrame.current);
    mouseFrame.current = 0;
    mousePoint.current = null;
    contentRef.current?.removeAttribute('data-over-comment');
  };

  return (
    <main className="content">
      <div className="content-inner">
        {parsing && (
          <div className="parsing-note" aria-live="polite">
            <Spinner animation="border" size="sm" role="status" />
            <span>Preparing document…</span>
          </div>
        )}
        {parseError && <Alert variant="danger">{parseError}</Alert>}

        {!parsing && activeFile && (
          <>
            {headings.length >= 2 && <TableOfContents />}
            {blocks.length === 0 && hast && (
              <div className="empty-note">
                <i className="bi bi-volume-mute" aria-hidden="true" /> This file has no speakable content
                (nothing but code, tables you&apos;ve muted, or empty headings).
              </div>
            )}
            {hast && (
              <article className="markdown-body" data-reader-content ref={contentRef} tabIndex={-1} onClick={handleClick} onMouseMove={handleMouseMove} onMouseLeave={clearCommentHover}>
                <MarkdownView hast={hast} />
              </article>
            )}
            {hast && <CommentHighlights rootRef={contentRef} comments={comments} activeId={activeCommentId} lessonId={lessonId} onResolvedChange={updateResolved} />}
            <SelectionCommentAction rootRef={contentRef} courseId={courseId} lessonId={lessonId} />
          </>
        )}
      </div>
      <CommentViewer
        comments={comments}
        activeId={activeCommentId}
        open={viewerOpen}
        matchingIds={matchingIds}
        unresolvedIds={unresolvedIds}
        rootRef={contentRef}
        onActiveChange={setActiveCommentId}
        onClose={closeViewer}
        onReadFromHere={readFromComment}
      />
    </main>
  );
}
