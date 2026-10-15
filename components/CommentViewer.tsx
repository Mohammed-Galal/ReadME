'use client';

import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Button, Form, Offcanvas } from 'react-bootstrap';
import { deleteComment, updateComment } from '@/lib/db/repositories';
import { useStore } from '@/lib/store';
import { notifyCourseDataChanged } from '@/lib/dataEvents';
import type { LessonComment } from '@/lib/db/schema';
import ConfirmDialog from './ConfirmDialog';

export default function CommentViewer({
  comments,
  activeId,
  open,
  matchingIds,
  unresolvedIds,
  rootRef,
  onActiveChange,
  onClose,
  onReadFromHere,
}: {
  comments: LessonComment[];
  activeId: string | null;
  open: boolean;
  matchingIds: string[];
  unresolvedIds: ReadonlySet<string>;
  rootRef: RefObject<HTMLElement | null>;
  onActiveChange(id: string): void;
  onClose(): void;
  onReadFromHere(comment: LessonComment): void;
}) {
  const comment = comments.find((item) => item.id === activeId) ?? null;
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState('');
  const [expandedQuote, setExpandedQuote] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const resumeSpeech = useRef(false);
  const toast = useStore((state) => state.toast);
  const quote = comment?.anchor.quote ?? '';
  const showMore = quote.length > 300;
  const shownQuote = useMemo(() => showMore && !expandedQuote ? `${quote.slice(0, 300)}…` : quote, [expandedQuote, quote, showMore]);
  const overlappingIndex = Math.max(0, matchingIds.indexOf(activeId ?? ''));

  const endEditing = () => {
    setEditing(false);
    if (resumeSpeech.current && useStore.getState().playback === 'paused') useStore.getState().playPause();
    resumeSpeech.current = false;
  };
  const close = () => {
    if (editing) endEditing();
    onClose();
  };

  useEffect(() => {
    if (activeId && !comment) {
      if (editing) {
        setEditing(false);
        if (resumeSpeech.current && useStore.getState().playback === 'paused') useStore.getState().playPause();
        resumeSpeech.current = false;
      }
      onClose();
    }
  }, [activeId, comment, editing, onClose]);

  const startEditing = () => {
    if (!comment) return;
    resumeSpeech.current = useStore.getState().playback === 'playing';
    if (resumeSpeech.current) useStore.getState().playPause();
    setEditText(comment.text);
    setError(null);
    setEditing(true);
  };
  const cancelEditing = () => {
    setError(null);
    endEditing();
  };
  const saveEdit = async () => {
    if (!comment || !editText.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updateComment(comment.id, { text: editText.trim() });
      endEditing();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this comment.');
    } finally {
      setBusy(false);
    }
  };
  const confirmDelete = async () => {
    if (!comment) return;
    await deleteComment(comment.id);
    notifyCourseDataChanged(comment.courseId);
    setShowDelete(false);
    onClose();
    toast('Comment deleted', 'success');
  };

  return (
    <>
      <Offcanvas
        show={open && !!comment}
        onHide={close}
        placement="bottom"
        backdrop={false}
        scroll
        enforceFocus={false}
        autoFocus
        onEntered={() => sheetRef.current?.focus()}
        onExited={() => rootRef.current?.focus()}
        aria-labelledby="comment-viewer-title"
        className="comment-viewer"
      >
        <div className="comment-viewer-inner" ref={sheetRef} tabIndex={-1}>
          <Offcanvas.Header>
            <Offcanvas.Title id="comment-viewer-title">Comment</Offcanvas.Title>
            <Button variant="link" aria-label="Close comment" onClick={close}><i className="bi bi-x-lg" aria-hidden="true" /></Button>
          </Offcanvas.Header>
          <Offcanvas.Body>
            {matchingIds.length > 1 && (
              <div className="comment-overlap-controls" aria-label="Overlapping comments">
                <Button variant="outline-secondary" size="sm" aria-label="Previous overlapping comment" disabled={overlappingIndex <= 0} onClick={() => onActiveChange(matchingIds[overlappingIndex - 1])}>‹</Button>
                <span>{overlappingIndex + 1} / {matchingIds.length}</span>
                <Button variant="outline-secondary" size="sm" aria-label="Next overlapping comment" disabled={overlappingIndex >= matchingIds.length - 1} onClick={() => onActiveChange(matchingIds[overlappingIndex + 1])}>›</Button>
              </div>
            )}
            {comment && (
              <div className="comment-viewer-content">
                <blockquote className="comment-quote" dir="auto">{shownQuote}</blockquote>
                {showMore && <Button variant="link" className="p-0 mb-2" onClick={() => setExpandedQuote((value) => !value)}>{expandedQuote ? 'Show less' : 'Show more'}</Button>}
                {unresolvedIds.has(comment.id) && <p className="text-body-secondary small">The source text for this comment can&apos;t be found.</p>}
                {editing ? (
                  <Form.Group controlId="comment-edit-text">
                    <Form.Label>Edit comment</Form.Label>
                    <Form.Control as="textarea" rows={4} maxLength={2000} autoFocus dir="auto" value={editText} onChange={(event) => setEditText(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void saveEdit(); }
                    }} />
                    {error && <div role="alert" className="alert alert-danger mt-2">{error}</div>}
                    <div className="comment-viewer-actions mt-2">
                      <Button variant="secondary" onClick={cancelEditing}>Cancel</Button>
                      <Button onClick={() => void saveEdit()} disabled={!editText.trim() || busy}>Save</Button>
                    </div>
                  </Form.Group>
                ) : (
                  <>
                    <p className="comment-viewer-text" dir="auto">{comment.text}</p>
                    <p className="comment-updated text-body-secondary small">Updated {new Date(comment.updatedAt).toLocaleString()}</p>
                    <div className="comment-viewer-actions">
                      <Button variant="primary" onClick={() => onReadFromHere(comment)}><i className="bi bi-play-fill" aria-hidden="true" /> Read from here</Button>
                      <Button variant="outline-secondary" onClick={startEditing}>Edit</Button>
                      <Button variant="outline-danger" onClick={() => setShowDelete(true)}>Delete</Button>
                    </div>
                  </>
                )}
              </div>
            )}
          </Offcanvas.Body>
        </div>
      </Offcanvas>
      <ConfirmDialog
        show={showDelete}
        title="Delete comment?"
        message="This comment will be deleted. This can’t be undone."
        confirmLabel="Delete"
        onHide={() => setShowDelete(false)}
        onConfirm={confirmDelete}
      />
    </>
  );
}
