'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Alert, Dropdown, Spinner } from 'react-bootstrap';
import { useCourse, useAddLessons, useCourseComments, useLessons } from '@/lib/dataHooks';
import {
  deleteLesson,
  listCommentsByLesson,
  moveLesson,
  renameLesson,
} from '@/lib/db/repositories';
import type { Lesson } from '@/lib/db/schema';
import { notifyCourseDataChanged } from '@/lib/dataEvents';
import { paths, type CourseTab } from '@/lib/paths';
import ConfirmDialog from './ConfirmDialog';
import LessonUploadBox, { LessonUploadButton } from './LessonUpload';
import MoveToPositionModal from './MoveToPositionModal';
import RenameLessonDialog from './RenameLessonDialog';
import CourseCommentsList from './CourseCommentsList';

function CourseContent() {
  const params = useParams<{ courseId: string }>();
  const courseId = params.courseId;
  const searchParams = useSearchParams();
  const tab: CourseTab = searchParams.get('tab') === 'comments' ? 'comments' : 'lessons';
  const { course, loading: courseLoading, error: courseError } = useCourse(courseId);
  const { lessons, loading: lessonsLoading, error: lessonsError } = useLessons(courseId);
  const { comments, lessons: commentLessons, loading: commentsLoading, error: commentsError } = useCourseComments(courseId);
  const addFiles = useAddLessons(courseId);
  const [renaming, setRenaming] = useState<Lesson | null>(null);
  const [moving, setMoving] = useState<Lesson | null>(null);
  const [deleting, setDeleting] = useState<{ lesson: Lesson; commentCount: number } | null>(null);

  if (courseLoading || lessonsLoading) {
    return <div className="page-loading" role="status"><Spinner animation="border" size="sm" /> Loading course…</div>;
  }
  if (courseError || lessonsError) {
    return <main className="courses-page"><Alert variant="danger" role="alert">{courseError || lessonsError}</Alert><Link href={paths.home()}>Back to courses</Link></main>;
  }
  if (!course) {
    return <main className="courses-page"><div className="not-found-state"><h1>Course not found</h1><p>This course may have been deleted.</p><Link href={paths.home()} className="btn btn-primary">Back to courses</Link></div></main>;
  }

  const confirmLessonDelete = async () => {
    if (!deleting) return;
    await deleteLesson(deleting.lesson.id);
    notifyCourseDataChanged(course.id);
    setDeleting(null);
  };
  const requestLessonDelete = async (lesson: Lesson) => {
    const comments = await listCommentsByLesson(lesson.id);
    setDeleting({ lesson, commentCount: comments.length });
  };

  return (
    <main className="courses-page course-page">
      <header className="courses-topbar">
        <Link href={paths.home()} className="brand" aria-label="ReadME home">ReadME</Link>
        <Link href={paths.home()} className="subtle-link">All courses</Link>
      </header>
      <div className="course-detail-content">
        <nav className="breadcrumb-line" aria-label="Breadcrumb">
          <Link href={paths.home()}>Courses</Link><span aria-hidden="true">/</span><span aria-current="page">{course.name}</span>
        </nav>
        <div className="align-items-center course-detail-heading d-flex flex-column flex-md-row">
          <div className="course-heading-copy">
            <h1>{course.name}</h1>
            {course.description && <p>{course.description}</p>}
          </div>
          <LessonUploadButton open={addFiles} />
        </div>
        <div className="course-tabs" role="tablist" aria-label="Course content">
          <Link href={paths.course(course.id, 'lessons')} role="tab" aria-selected={tab === 'lessons'} className={tab === 'lessons' ? 'active' : ''}>Lessons <span>{lessons.length}</span></Link>
          <Link href={paths.course(course.id, 'comments')} role="tab" aria-selected={tab === 'comments'} className={tab === 'comments' ? 'active' : ''}>Comments ({comments.length})</Link>
        </div>
        {tab === 'comments' ? (
          <CourseCommentsList comments={comments} lessons={commentLessons} loading={commentsLoading} error={commentsError} />
        ) : lessons.length === 0 ? (
          <section className="course-empty-lessons" role="tabpanel" aria-label="Lessons">
            <LessonUploadBox open={addFiles} />
          </section>
        ) : (
          <section className="lesson-list" role="tabpanel" aria-label="Lessons">
            {lessons.map((lesson, index) => (
              <article className="lesson-row" key={lesson.id}>
                <span className="lesson-order" aria-hidden="true">{index + 1}</span>
                <Link href={paths.lesson(course.id, lesson.id)} className="lesson-row-link">
                  <i className="bi bi-file-earmark-text" aria-hidden="true" />
                  <span className="lesson-row-title" title={lesson.title}>{lesson.title}</span>
                  <i className="bi bi-chevron-right lesson-row-chevron" aria-hidden="true" />
                </Link>
                <Dropdown className="lesson-menu">
                  <Dropdown.Toggle variant="light" className="kebab-toggle tap-target" aria-label={`Actions for ${lesson.title}`}>
                    <i className="bi bi-three-dots-vertical" aria-hidden="true" />
                  </Dropdown.Toggle>
                  <Dropdown.Menu popperConfig={{ strategy: 'fixed' }}>
                    <Dropdown.Item onClick={() => setRenaming(lesson)}>Rename</Dropdown.Item>
                    <Dropdown.Item onClick={() => setMoving(lesson)}>Move to position…</Dropdown.Item>
                    <Dropdown.Item className="text-danger" onClick={() => void requestLessonDelete(lesson)}>Delete</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </article>
            ))}
          </section>
        )}
      </div>
      <RenameLessonDialog
        show={!!renaming}
        title={renaming?.title ?? ''}
        onHide={() => setRenaming(null)}
        onSave={async (title) => {
          if (renaming) await renameLesson(renaming.id, title);
          notifyCourseDataChanged(course.id);
        }}
      />
      <MoveToPositionModal
        show={!!moving}
        count={lessons.length}
        currentPosition={(moving?.order ?? 0) + 1}
        onHide={() => setMoving(null)}
        onMove={async (position) => {
          if (moving) await moveLesson(moving.id, position);
          notifyCourseDataChanged(course.id);
        }}
      />
      <ConfirmDialog
        show={!!deleting}
        title="Delete lesson?"
        message={deleting ? `Delete “${deleting.lesson.title}”${deleting.commentCount ? ` and its ${deleting.commentCount} ${deleting.commentCount === 1 ? 'comment' : 'comments'}` : ''}? This can't be undone.` : ''}
        onHide={() => setDeleting(null)}
        onConfirm={confirmLessonDelete}
      />
    </main>
  );
}

export default function CoursePageClient() {
  return <Suspense fallback={<div className="page-loading" role="status">Loading course…</div>}><CourseContent /></Suspense>;
}
