'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Alert, Spinner } from 'react-bootstrap';
import { useCourse, useLessons } from '@/lib/dataHooks';
import { consumeAutoPlayLesson, useStore } from '@/lib/store';
import { paths } from '@/lib/paths';
import ReaderApp from './ReaderApp';

export default function ReaderRouteClient() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const { course, loading: courseLoading, error: courseError } = useCourse(courseId);
  const { lessons, loading: lessonsLoading, error: lessonsError } = useLessons(courseId);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadedRoute, setLoadedRoute] = useState('');
  const routeKey = `${courseId}:${lessonId}`;
  const handledRoute = useRef('');

  useEffect(() => {
    setLoadedRoute('');
    setLoadError(null);
  }, [routeKey]);

  useEffect(() => {
    if (courseLoading || lessonsLoading) return;
    if (courseError || lessonsError) {
      setLoadError(courseError || lessonsError);
      return;
    }
    if (!course) return;
    const lesson = lessons.find((item) => item.id === lessonId && item.courseId === courseId);
    if (!lesson) return;
    if (handledRoute.current === routeKey) {
      void useStore.getState().refreshReaderLessons(courseId);
      return;
    }
    handledRoute.current = routeKey;
    setLoadError(null);
    void useStore.getState().openLesson(courseId, lessonId, lessons, {
      autoPlay: consumeAutoPlayLesson(lessonId),
    }).then(() => {
      if (handledRoute.current === routeKey) setLoadedRoute(routeKey);
    });
  }, [course, courseError, courseId, courseLoading, lessonId, lessons, lessonsError, lessonsLoading, routeKey]);

  if (courseLoading || lessonsLoading || (course && lessons.some((lesson) => lesson.id === lessonId) && loadedRoute !== routeKey)) {
    return <div className="page-loading reader-route-loading" role="status"><Spinner animation="border" size="sm" /> Loading lesson…</div>;
  }
  if (loadError || courseError || lessonsError) {
    return <main className="not-found-state"><Alert variant="danger" role="alert">{loadError || courseError || lessonsError}</Alert><Link href={paths.home()}>Back to courses</Link></main>;
  }
  if (!course) {
    return <main className="not-found-state"><h1>Course not found</h1><p>This course may have been deleted.</p><Link href={paths.home()} className="btn btn-primary tap-target">Back to courses</Link></main>;
  }
  const lesson = lessons.find((item) => item.id === lessonId && item.courseId === courseId);
  if (!lesson) {
    return <main className="not-found-state"><h1>Lesson not found</h1><p>This lesson may have been deleted or belongs to another course.</p><Link href={paths.course(courseId)} className="btn btn-primary tap-target">Back to {course.name}</Link></main>;
  }
  return <ReaderApp courseId={courseId} lessonId={lessonId} courseName={course.name} />;
}
