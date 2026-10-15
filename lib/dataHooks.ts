'use client';

import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import {
  getCourse as readCourse,
  getCourseStats,
  listComments,
  listCommentsByLesson,
  listCourses,
  listLessons,
} from './db/repositories';
import type { Course, Lesson } from './db/schema';
import { COMMENT_DATA_CHANGED, COURSE_DATA_CHANGED } from './dataEvents';
import type { LessonComment } from './db/schema';
import { AddLessonsContext, type OpenAddLessonsOptions } from './addLessonsContext';

function eventBelongsToCourse(event: Event, courseId: string): boolean {
  return (event as CustomEvent<{ courseId?: string }>).detail?.courseId === courseId;
}

export interface CourseWithStats extends Course {
  lessonCount: number;
  commentCount: number;
}

export function useCourses() {
  const [courses, setCourses] = useState<CourseWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await listCourses();
      const enriched = await Promise.all(rows.map(async (course) => {
        const stats = await getCourseStats(course.id);
        return { ...course, lessonCount: stats.lessons, commentCount: stats.comments };
      }));
      setCourses(enriched);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const listener = () => void refresh();
    window.addEventListener(COURSE_DATA_CHANGED, listener);
    return () => window.removeEventListener(COURSE_DATA_CHANGED, listener);
  }, [refresh]);
  return { courses, loading, error, refresh };
}

export function useCourse(courseId: string) {
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const result = await readCourse(courseId);
      if (request !== requestId.current) return;
      setCourse(result ?? null);
      setLoadedFor(courseId);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setLoadedFor(courseId);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [courseId]);
  useEffect(() => {
    void refresh();
    const listener = (event: Event) => { if (eventBelongsToCourse(event, courseId)) void refresh(); };
    window.addEventListener(COURSE_DATA_CHANGED, listener);
    return () => window.removeEventListener(COURSE_DATA_CHANGED, listener);
  }, [courseId, refresh]);
  return { course: loadedFor === courseId ? course : null, loading: loading || loadedFor !== courseId, error, refresh };
}

export function useLessons(courseId: string) {
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const result = await listLessons(courseId);
      if (request !== requestId.current) return;
      setLessons(result);
      setLoadedFor(courseId);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setLoadedFor(courseId);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [courseId]);
  useEffect(() => {
    void refresh();
    const listener = (event: Event) => { if (eventBelongsToCourse(event, courseId)) void refresh(); };
    window.addEventListener(COURSE_DATA_CHANGED, listener);
    return () => window.removeEventListener(COURSE_DATA_CHANGED, listener);
  }, [courseId, refresh]);
  return { lessons: loadedFor === courseId ? lessons : [], loading: loading || loadedFor !== courseId, error, refresh };
}

export function useLessonComments(lessonId: string) {
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const rows = await listCommentsByLesson(lessonId);
      if (request !== requestId.current) return;
      setComments(rows);
      setLoadedFor(lessonId);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setLoadedFor(lessonId);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [lessonId]);
  useEffect(() => {
    void refresh();
    const listener = (event: Event) => {
      if ((event as CustomEvent<{ lessonId?: string }>).detail?.lessonId === lessonId) void refresh();
    };
    window.addEventListener(COMMENT_DATA_CHANGED, listener);
    return () => {
      window.removeEventListener(COMMENT_DATA_CHANGED, listener);
    };
  }, [lessonId, refresh]);
  return {
    comments: loadedFor === lessonId ? comments : [],
    loading: loading || loadedFor !== lessonId,
    error: loadedFor === lessonId ? error : null,
    refresh,
  };
}

export function useCourseComments(courseId: string) {
  const [comments, setComments] = useState<LessonComment[]>([]);
  const [lessons, setLessons] = useState<Lesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadedFor, setLoadedFor] = useState('');
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const [commentRows, lessonRows] = await Promise.all([listComments(courseId), listLessons(courseId)]);
      if (request !== requestId.current) return;
      setComments(commentRows);
      setLessons(lessonRows);
      setLoadedFor(courseId);
      setError(null);
    } catch (cause) {
      if (request !== requestId.current) return;
      setLoadedFor(courseId);
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [courseId]);
  useEffect(() => {
    void refresh();
    const listener = (event: Event) => {
      if (eventBelongsToCourse(event, courseId)) void refresh();
    };
    window.addEventListener(COMMENT_DATA_CHANGED, listener);
    window.addEventListener(COURSE_DATA_CHANGED, listener);
    return () => {
      window.removeEventListener(COMMENT_DATA_CHANGED, listener);
      window.removeEventListener(COURSE_DATA_CHANGED, listener);
    };
  }, [courseId, refresh]);
  return {
    comments: loadedFor === courseId ? comments : [],
    lessons: loadedFor === courseId ? lessons : [],
    loading: loading || loadedFor !== courseId,
    error: loadedFor === courseId ? error : null,
    refresh,
  };
}

export function useAddLessons(courseId: string) {
  const context = useContext(AddLessonsContext);
  if (!context) throw new Error('useAddLessons must be used within AddLessonsProvider');
  return useCallback((options?: OpenAddLessonsOptions) => context.open(courseId, options), [context, courseId]);
}
