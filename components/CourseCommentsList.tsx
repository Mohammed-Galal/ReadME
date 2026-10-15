"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Alert, Collapse, Dropdown, Spinner } from "react-bootstrap";
import { deleteComment, moveComment } from "@/lib/db/repositories";
import type { Lesson, LessonComment } from "@/lib/db/schema";
import { paths } from "@/lib/paths";
import {
  buildCommentRows,
  truncateQuote,
  type CommentRow,
} from "@/lib/courseComments";
import { useStore } from "@/lib/store";
import ConfirmDialog from "./ConfirmDialog";
import MoveToPositionModal from "./MoveToPositionModal";

function relativeTime(timestamp: number): string {
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (Math.abs(seconds) < 60) return formatter.format(seconds, "second");
  if (Math.abs(seconds) < 3600)
    return formatter.format(Math.round(seconds / 60), "minute");
  if (Math.abs(seconds) < 86400)
    return formatter.format(Math.round(seconds / 3600), "hour");
  if (Math.abs(seconds) < 2592000)
    return formatter.format(Math.round(seconds / 86400), "day");
  if (Math.abs(seconds) < 31536000)
    return formatter.format(Math.round(seconds / 2592000), "month");
  return formatter.format(Math.round(seconds / 31536000), "year");
}

interface CommentItemProps {
  row: CommentRow;
  open: boolean;
  onToggle(id: string): void;
  onGoToSource(comment: LessonComment): void;
  onMove(row: CommentRow): void;
  onDelete(row: CommentRow): void;
}

const CommentItem = memo(function CommentItem({
  row,
  open,
  onToggle,
  onGoToSource,
  onMove,
  onDelete,
}: CommentItemProps) {
  const { comment, lessonTitle, position } = row;
  const collapseId = `course-comment-details-${comment.id}`;
  const snippet = truncateQuote(comment.anchor.quote);
  return (
    <article className="course-comment-row" data-comment-row-id={comment.id}>
      <div className="align-items-center course-comment-header d-flex">
        <button
          type="button"
          className="course-comment-toggle"
          aria-expanded={open}
          aria-controls={collapseId}
          onClick={() => onToggle(comment.id)}
        >
          <span
            className="course-comment-position"
            aria-label={`Position ${position}`}
          >
            {position}
          </span>
          <span className="course-comment-summary">
            <span className="course-comment-snippet" dir="auto" title={snippet}>
              {snippet || "Empty quote"}
            </span>
            <span
              className="badge text-bg-secondary course-comment-lesson-badge"
              title={lessonTitle}
            >
              {lessonTitle}
            </span>
          </span>
          <i
            className={`bi bi-chevron-${open ? "up" : "down"} course-comment-chevron`}
            aria-hidden="true"
          />
        </button>
        <button
          type="button"
          className="btn course-comment-source"
          aria-label={`Go to source for comment ${position}`}
          title="Go to source"
          onClick={() => onGoToSource(comment)}
        >
          <i className="bi bi-box-arrow-up-right" aria-hidden="true" />
        </button>
        <Dropdown align="end" className="course-comment-menu">
          <Dropdown.Toggle
            // variant="light"
            className="btn"
            aria-label={`Actions for comment ${position}`}
          >
            {/* <i className="bi bi-three-dots-vertical" aria-hidden="true" /> */}
          </Dropdown.Toggle>
          <Dropdown.Menu popperConfig={{ strategy: "absolute" }}>
            <Dropdown.Item onClick={() => onMove(row)}>
              Move to position…
            </Dropdown.Item>
            <Dropdown.Item
              className="text-danger"
              onClick={() => onDelete(row)}
            >
              Delete
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </div>
      <Collapse in={open} mountOnEnter unmountOnExit>
        <div id={collapseId} className="course-comment-details">
          <blockquote className="course-comment-quote" dir="auto">
            {comment.anchor.quote}
          </blockquote>

          <p className="course-comment-text" dir="auto">
            {comment.text}
          </p>
          <div className="course-comment-meta">
            <Link href={paths.lesson(comment.courseId, comment.lessonId)}>
              {lessonTitle}
            </Link>
            <span>Updated {relativeTime(comment.updatedAt)}</span>
          </div>
        </div>
      </Collapse>
    </article>
  );
});

interface CourseCommentsListProps {
  comments: LessonComment[];
  lessons: Lesson[];
  loading: boolean;
  error: string | null;
}

export default function CourseCommentsList({
  comments,
  lessons,
  loading,
  error,
}: CourseCommentsListProps) {
  const router = useRouter();
  const toast = useStore((state) => state.toast);
  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set());
  const [moving, setMoving] = useState<CommentRow | null>(null);
  const [deleting, setDeleting] = useState<CommentRow | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const rows = useMemo(
    () => buildCommentRows(comments, lessons),
    [comments, lessons],
  );

  useEffect(() => {
    if (!flashId) return;
    const frame = requestAnimationFrame(() => {
      const item = listRef.current?.querySelector<HTMLElement>(
        `[data-comment-row-id="${CSS.escape(flashId)}"]`,
      );
      if (!item) return;
      const rect = item.getBoundingClientRect();
      const visible =
        rect.top >= 0 &&
        rect.left >= 0 &&
        rect.bottom <= window.innerHeight &&
        rect.right <= window.innerWidth;
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      if (!visible)
        item.scrollIntoView({
          behavior: reducedMotion ? "instant" : "smooth",
          block: "center",
        });
      if (!reducedMotion) {
        item.setAttribute("data-list-flash", "true");
        window.setTimeout(() => item.removeAttribute("data-list-flash"), 1500);
      }
      setFlashId(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [flashId, rows]);

  const toggle = useCallback((id: string) => {
    setOpenIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const goToSource = useCallback(
    (comment: LessonComment) => {
      router.push(paths.lesson(comment.courseId, comment.lessonId, comment.id));
    },
    [router],
  );
  const removeComment = async () => {
    if (!deleting) return;
    await deleteComment(deleting.comment.id);
    setOpenIds((current) => {
      const next = new Set(current);
      next.delete(deleting.comment.id);
      return next;
    });
    setDeleting(null);
    toast("Comment deleted", "success");
  };
  const moveSelected = async (newIndex: number) => {
    if (!moving || newIndex === moving.position - 1) return;
    const id = moving.comment.id;
    await moveComment(id, newIndex);
    setFlashId(id);
  };

  return (
    <section
      className="course-comments-panel"
      role="tabpanel"
      aria-label="Comments"
    >
      <h2 className="course-comments-heading">
        {comments.length} {comments.length === 1 ? "comment" : "comments"}
      </h2>
      {loading ? (
        <div className="page-loading" role="status">
          <Spinner animation="border" size="sm" /> Loading comments…
        </div>
      ) : error ? (
        <Alert variant="danger" role="alert">
          {error}
        </Alert>
      ) : rows.length === 0 ? (
        <div className="comments-placeholder">
          <i className="bi bi-chat-left-text" aria-hidden="true" />
          <p>
            No comments yet. Select text while reading a lesson and tap Comment.
          </p>
        </div>
      ) : (
        <section
          className="course-comment-list"
          ref={listRef}
          aria-label="Course comments"
        >
          {rows.map((row) => (
            <CommentItem
              key={row.comment.id}
              row={row}
              open={openIds.has(row.comment.id)}
              onToggle={toggle}
              onGoToSource={goToSource}
              onMove={setMoving}
              onDelete={setDeleting}
            />
          ))}
        </section>
      )}
      <MoveToPositionModal
        show={!!moving}
        count={comments.length}
        currentPosition={moving?.position ?? 1}
        onHide={() => setMoving(null)}
        onMove={moveSelected}
      />
      <ConfirmDialog
        show={!!deleting}
        title="Delete comment?"
        message={
          deleting
            ? `Delete “${truncateQuote(deleting.comment.anchor.quote)}”? This can’t be undone.`
            : ""
        }
        onHide={() => setDeleting(null)}
        onConfirm={removeComment}
      />
    </section>
  );
}
