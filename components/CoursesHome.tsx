'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Alert, Button, Dropdown, Spinner } from 'react-bootstrap';
import { useRouter } from 'next/navigation';
import { useCourses } from '@/lib/dataHooks';
import { createCourse, deleteCourse, updateCourse } from '@/lib/db/repositories';
import type { Course } from '@/lib/db/schema';
import { notifyCourseDataChanged } from '@/lib/dataEvents';
import { paths } from '@/lib/paths';
import ConfirmDialog from './ConfirmDialog';
import CourseDialog from './CourseDialog';

export default function CoursesHome() {
  const router = useRouter();
  const { courses, loading, error } = useCourses();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Course | null>(null);
  const [deleting, setDeleting] = useState<(typeof courses)[number] | null>(null);

  const saveCourse = async (data: { name: string; description: string }) => {
    if (editing) {
      await updateCourse(editing.id, data);
      notifyCourseDataChanged(editing.id);
    } else {
      const created = await createCourse(data);
      notifyCourseDataChanged(created.id);
      router.push(paths.course(created.id));
    }
  };
  const confirmDelete = async () => {
    if (!deleting) return;
    await deleteCourse(deleting.id);
    notifyCourseDataChanged(deleting.id);
    setDeleting(null);
  };
  const openEdit = (course: Course) => { setEditing(course); setDialogOpen(true); };
  const closeCourseDialog = () => { setDialogOpen(false); setEditing(null); };

  return (
    <main className="courses-page">
      <header className="courses-topbar">
        <Link href={paths.home()} className="brand" aria-label="ReadME home">ReadME</Link>
        <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="tap-target">
          <i className="bi bi-plus-lg me-1" aria-hidden="true" />Add course
        </Button>
      </header>
      <section className="courses-content" aria-labelledby="courses-heading">
        <div className="courses-heading-row">
          <div>
            <h1 id="courses-heading">Your courses</h1>
            <p>Organize your reading into courses and lessons.</p>
          </div>
        </div>
        {error && <Alert variant="danger" role="alert">Could not load courses: {error}</Alert>}
        {loading ? (
          <div className="page-loading" role="status"><Spinner animation="border" size="sm" /> Loading courses…</div>
        ) : courses.length === 0 ? (
          <div className="courses-empty">
            <i className="bi bi-collection" aria-hidden="true" />
            <h2>No courses yet</h2>
            <p>Create a course to start building your lesson library.</p>
            <Button onClick={() => { setEditing(null); setDialogOpen(true); }} className="tap-target">Add course</Button>
          </div>
        ) : (
          <div className="course-grid">
            {courses.map((course) => (
              <article className="course-card" key={course.id}>
                <Link className="course-card-link stretched-link" href={paths.course(course.id)} aria-label={`Open ${course.name}`}>
                  <span className="course-card-icon"><i className="bi bi-journal-bookmark" aria-hidden="true" /></span>
                  <h2 title={course.name}>{course.name}</h2>
                  <p className="course-description" title={course.description}>{course.description || 'No description'}</p>
                  <span className="course-lesson-count">{course.lessonCount} {course.lessonCount === 1 ? 'lesson' : 'lessons'}</span>
                </Link>
                <Dropdown className="course-menu">
                  <Dropdown.Toggle variant="light" className="kebab-toggle tap-target" aria-label={`Actions for ${course.name}`}>
                    <i className="bi bi-three-dots-vertical" aria-hidden="true" />
                  </Dropdown.Toggle>
                  <Dropdown.Menu popperConfig={{ strategy: 'absolute' }}>
                    <Dropdown.Item onClick={() => openEdit(course)}>Edit</Dropdown.Item>
                    <Dropdown.Item className="text-danger" onClick={() => setDeleting(course)}>Delete</Dropdown.Item>
                  </Dropdown.Menu>
                </Dropdown>
              </article>
            ))}
          </div>
        )}
      </section>
      <CourseDialog show={dialogOpen} course={editing} onHide={closeCourseDialog} onSave={saveCourse} />
      <ConfirmDialog
        show={!!deleting}
        title="Delete course?"
        message={deleting ? `Delete “${deleting.name}” with ${deleting.lessonCount} ${deleting.lessonCount === 1 ? 'lesson' : 'lessons'} and ${deleting.commentCount} ${deleting.commentCount === 1 ? 'comment' : 'comments'}? This can't be undone.` : ''}
        onHide={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </main>
  );
}
