"use client";

// Sidebar: persistent on desktop (collapsible), Offcanvas drawer on mobile.

import { useState } from "react";
import Link from "next/link";
import { Offcanvas } from "react-bootstrap";
import { useRouter } from "next/navigation";
import { useStore } from "@/lib/store";
import { useAddLessons } from "@/lib/dataHooks";
import { listCommentsByLesson } from "@/lib/db/repositories";
import type { Lesson } from "@/lib/db/schema";
import { notifyCourseDataChanged } from "@/lib/dataEvents";
import { paths } from "@/lib/paths";
import { cls } from "@/lib/utils";
import ConfirmDialog from "./ConfirmDialog";
import { LessonUploadButton } from "./LessonUpload";

interface SidebarProps {
  courseId: string;
  lessonId: string;
  courseName: string;
}

function SidebarContent({
  courseId,
  lessonId,
  courseName,
  onNavigate,
}: SidebarProps & { onNavigate?: () => void }) {
  const router = useRouter();
  const files = useStore((s) => s.files);
  const addFiles = useAddLessons(courseId);
  const [deleting, setDeleting] = useState<{
    lesson: Lesson;
    commentCount: number;
  } | null>(null);
  const requestDelete = async (lesson: Lesson) => {
    const comments = await listCommentsByLesson(lesson.id);
    setDeleting({ lesson, commentCount: comments.length });
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    const isCurrent = deleting.lesson.id === lessonId;
    const nextId = await useStore
      .getState()
      .deleteReaderLesson(deleting.lesson.id);
    notifyCourseDataChanged(courseId);
    setDeleting(null);
    if (isCurrent) {
      if (nextId) router.replace(paths.lesson(courseId, nextId));
      else router.push(paths.course(courseId));
    }
  };

  return (
    <div className="gap-3 sidebar-content">
      <div className="sidebar-header">
        <Link
          href={paths.course(courseId)}
          className="sidebar-course-link"
          onClick={onNavigate}
          title={`Back to ${courseName}`}
        >
          <i className="bi bi-arrow-left" aria-hidden="true" />{" "}
          <span>{courseName}</span>
        </Link>

        <div className="d-flex gap-1 small text-secondary-emphasis">
          <span aria-label={`${files.length} lessons`}>{files.length}</span>
          <span className="sidebar-title text-secondary">Lessons</span>
        </div>
      </div>
      <div className="sidebar-list" role="list">
        {files.map((f) => (
          <div
            key={f.id}
            role="listitem"
            className={cls(
              "file-item",
              f.id === lessonId && "file-item-active",
            )}
          >
            <button
              type="button"
              className="file-item-main"
              title={f.title}
              onClick={() => {
                router.push(paths.lesson(courseId, f.id));
                onNavigate?.();
              }}
            >
              <i
                className="bi bi-file-earmark-text file-icon"
                aria-hidden="true"
              />
              <span className="file-name">{f.title}</span>
            </button>
            <button
              type="button"
              className="file-item-delete"
              aria-label={`Delete ${f.title}`}
              title={`Delete ${f.title}`}
              onClick={() => requestDelete(f)}
            >
              <i className="bi bi-trash" aria-hidden="true" />
            </button>
          </div>
        ))}
        {files.length === 0 && (
          <div className="sidebar-empty">No lessons yet.</div>
        )}
      </div>
      <div className="d-flex flex-column sidebar-footer">
        <LessonUploadButton open={addFiles} />
      </div>
      <ConfirmDialog
        show={!!deleting}
        title="Delete lesson?"
        message={
          deleting
            ? `Delete “${deleting.lesson.title}”${deleting.commentCount ? ` and its ${deleting.commentCount} ${deleting.commentCount === 1 ? "comment" : "comments"}` : ""}? This can't be undone.`
            : ""
        }
        onHide={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  );
}

export default function Sidebar({
  courseId,
  lessonId,
  courseName,
}: SidebarProps) {
  const collapsed = useStore((s) => s.sidebarCollapsed);
  const mobileOpen = useStore((s) => s.mobileSidebarOpen);
  const setMobileOpen = useStore((s) => s.setMobileSidebarOpen);

  return (
    <>
      <aside
        className={cls(
          "sidebar d-none d-lg-flex",
          collapsed && "sidebar-collapsed",
        )}
        aria-label="Files"
      >
        <SidebarContent
          courseId={courseId}
          lessonId={lessonId}
          courseName={courseName}
        />
      </aside>
      <Offcanvas
        show={mobileOpen}
        onHide={() => setMobileOpen(false)}
        placement="start"
        className="mobile-sidebar d-lg-none"
        aria-label="Files"
      >
        <Offcanvas.Header closeButton>
          <Offcanvas.Title>Lessons</Offcanvas.Title>
        </Offcanvas.Header>
        <Offcanvas.Body className="p-0">
          <SidebarContent
            courseId={courseId}
            lessonId={lessonId}
            courseName={courseName}
            onNavigate={() => setMobileOpen(false)}
          />
        </Offcanvas.Body>
      </Offcanvas>
    </>
  );
}
