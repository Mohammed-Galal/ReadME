'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button, Form, Modal } from 'react-bootstrap';
import { addComment } from '@/lib/db/repositories';
import { notifyCourseDataChanged } from '@/lib/dataEvents';
import { useStore } from '@/lib/store';
import { rangeToAnchor, type TextAnchor } from '@/lib/anchors';
import { useSelectionAnchor } from '@/lib/useSelectionAnchor';
import ConfirmDialog from './ConfirmDialog';

const COMMENT_SHORTCUT_EVENT = 'readme-comment-selection';

export default function SelectionCommentAction({
  rootRef,
  courseId,
  lessonId,
}: {
  rootRef: RefObject<HTMLElement | null>;
  courseId: string;
  lessonId: string;
}) {
  const selection = useSelectionAnchor(rootRef);
  const [coarsePointer, setCoarsePointer] = useState(false);
  const [anchor, setAnchor] = useState<TextAnchor | null>(null);
  const [clamped, setClamped] = useState(false);
  const [showComposer, setShowComposer] = useState(false);
  const [showDiscard, setShowDiscard] = useState(false);
  const [expandedQuote, setExpandedQuote] = useState(false);
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const resumeSpeech = useRef(false);
  const saving = useRef(false);
  const toast = useStore((state) => state.toast);

  useEffect(() => {
    const media = window.matchMedia('(pointer: coarse)');
    const update = () => setCoarsePointer(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  const updatePosition = useCallback(() => {
    if (!selection) return;
    const range = window.getSelection();
    const rect = range && range.rangeCount ? range.getRangeAt(0).getBoundingClientRect() : selection.rect;
    const buttonWidth = 104;
    const left = Math.max(8, Math.min(window.innerWidth - buttonWidth - 8, rect.left + rect.width / 2 - buttonWidth / 2));
    const top = rect.top >= 48 ? rect.top - 44 : Math.min(window.innerHeight - 52, rect.bottom + 8);
    setPosition({ left, top: Math.max(8, top) });
  }, [selection]);

  useEffect(() => {
    updatePosition();
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(updatePosition);
    };
    window.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [updatePosition]);

  const openComposer = useCallback((source: { anchor: TextAnchor; clamped: boolean }) => {
    setAnchor(source.anchor);
    setClamped(source.clamped);
    setText('');
    setError(null);
    setExpandedQuote(false);
    resumeSpeech.current = useStore.getState().playback === 'playing';
    if (resumeSpeech.current) useStore.getState().playPause();
    setShowComposer(true);
  }, []);

  useEffect(() => {
    const onShortcut = () => {
      const root = rootRef.current;
      const liveSelection = window.getSelection();
      if (!root || !liveSelection || liveSelection.isCollapsed || !liveSelection.rangeCount) return;
      const result = rangeToAnchor(liveSelection.getRangeAt(0), root);
      if (result.ok) openComposer({ anchor: result.anchor, clamped: result.clamped });
    };
    window.addEventListener(COMMENT_SHORTCUT_EVENT, onShortcut);
    return () => window.removeEventListener(COMMENT_SHORTCUT_EVENT, onShortcut);
  }, [openComposer, rootRef]);

  const clearSelection = () => {
    window.getSelection()?.removeAllRanges();
  };
  const finishComposer = () => {
    setShowComposer(false);
    setShowDiscard(false);
    setAnchor(null);
    clearSelection();
    if (resumeSpeech.current && useStore.getState().playback === 'paused') useStore.getState().playPause();
    resumeSpeech.current = false;
  };
  const requestCancel = () => {
    if (text.length) setShowDiscard(true);
    else finishComposer();
  };
  const save = async () => {
    if (!anchor || !text.trim() || saving.current) return;
    saving.current = true;
    setError(null);
    try {
      await addComment({ courseId, lessonId, text: text.trim(), anchor });
      notifyCourseDataChanged(courseId);
      finishComposer();
      toast('Comment saved', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save this comment. Please try again.');
    } finally {
      saving.current = false;
    }
  };

  const quote = anchor?.quote ?? '';
  const showMore = quote.length > 300;
  const displayedQuote = useMemo(() => showMore && !expandedQuote ? `${quote.slice(0, 300)}…` : quote, [expandedQuote, quote, showMore]);

  return (
    <>
      {selection && !showComposer && !coarsePointer && (
        <Button
          type="button"
          className="selection-comment-float"
          style={{ left: position.left, top: position.top }}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => openComposer(selection)}
        >
          <i className="bi bi-chat-left-text" aria-hidden="true" /> Comment
        </Button>
      )}
      {selection && !showComposer && coarsePointer && (
        <div className="selection-comment-bar" role="toolbar" aria-label="Selection actions">
          <Button type="button" onPointerDown={(event) => event.preventDefault()} onClick={() => openComposer(selection)}>
            <i className="bi bi-chat-left-text" aria-hidden="true" /> Comment
          </Button>
          <Button variant="link" aria-label="Dismiss selection actions" onClick={clearSelection}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </Button>
        </div>
      )}

      <Modal
        show={showComposer}
        onHide={requestCancel}
        backdrop={text.length ? 'static' : true}
        keyboard={!text.length}
        fullscreen="sm-down"
        scrollable
        centered
        aria-labelledby="comment-composer-title"
      >
        <Modal.Header>
          <Modal.Title id="comment-composer-title">Add comment</Modal.Title>
          <Button variant="link" aria-label="Close comment composer" onClick={requestCancel}>
            <i className="bi bi-x-lg" aria-hidden="true" />
          </Button>
        </Modal.Header>
        <Modal.Body>
          <blockquote className="comment-quote" dir="auto">{displayedQuote}</blockquote>
          {showMore && <Button variant="link" className="p-0 mb-3" onClick={() => setExpandedQuote((value) => !value)}>{expandedQuote ? 'Show less' : 'Show more'}</Button>}
          {clamped && <p className="text-body-secondary small">Your selection spans several paragraphs; commenting on the first part.</p>}
          <Form.Group controlId="comment-text">
            <Form.Label>Your comment</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              maxLength={2000}
              autoFocus
              dir="auto"
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  void save();
                }
              }}
            />
            <div className="d-flex justify-content-between text-body-secondary small mt-1"><span>Ctrl/Cmd+Enter to save</span><span>{text.length}/2000</span></div>
          </Form.Group>
          {error && <div className="alert alert-danger mt-3 mb-0" role="alert">{error}</div>}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={requestCancel}>Cancel</Button>
          <Button variant="primary" onClick={() => void save()} disabled={!text.trim() || saving.current}>Save comment</Button>
        </Modal.Footer>
      </Modal>
      <ConfirmDialog
        show={showDiscard}
        title="Discard comment?"
        message="Your comment has not been saved. Discard it?"
        confirmLabel="Discard"
        danger
        onHide={() => setShowDiscard(false)}
        onConfirm={finishComposer}
      />
    </>
  );
}

export { COMMENT_SHORTCUT_EVENT };
