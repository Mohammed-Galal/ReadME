import { getDb } from './index';
import type { Course, Lesson, LessonComment, LessonInput, Position } from './schema';
import { uid } from '../utils';
import { notifyCommentDataChanged } from '../dataEvents';

const byOrder = <T extends { order: number; id: string }>(a: T, b: T) => a.order - b.order || a.id.localeCompare(b.id);

export async function createCourse(input: Pick<Course, 'name'> & Partial<Pick<Course, 'description'>>): Promise<Course> {
  const db = await getDb();
  const now = Date.now();
  const course: Course = { id: uid(), name: input.name, description: input.description ?? '', createdAt: now, updatedAt: now };
  await db.add('courses', course);
  return course;
}

export async function updateCourse(id: string, changes: Partial<Pick<Course, 'name' | 'description'>>): Promise<Course | undefined> {
  const db = await getDb();
  const course = await db.get('courses', id);
  if (!course) return undefined;
  const updated = { ...course, ...changes, updatedAt: Date.now() };
  await db.put('courses', updated);
  return updated;
}

export async function getCourse(id: string): Promise<Course | undefined> {
  return (await getDb()).get('courses', id);
}

export async function listCourses(): Promise<Course[]> {
  return (await getDb()).getAllFromIndex('courses', 'by-createdAt').then((rows) => rows.sort((a, b) => a.createdAt - b.createdAt));
}

export async function getCourseStats(courseId: string): Promise<{ lessons: number; comments: number }> {
  const db = await getDb();
  const tx = db.transaction(['lessons', 'comments'], 'readonly');
  const [lessons, comments] = await Promise.all([
    tx.objectStore('lessons').index('by-courseId').count(courseId),
    tx.objectStore('comments').index('by-courseId').count(courseId),
  ]);
  return { lessons, comments };
}

export async function deleteCourse(id: string): Promise<{ course?: Course; lessons: Lesson[]; comments: LessonComment[]; positions: Position[] }> {
  const db = await getDb();
  const tx = db.transaction(['courses', 'lessons', 'comments', 'positions_v2', 'meta_v2'], 'readwrite');
  const courses = tx.objectStore('courses');
  const lessonsStore = tx.objectStore('lessons');
  const commentsStore = tx.objectStore('comments');
  const course = await courses.get(id);
  const lessons = await lessonsStore.index('by-courseId').getAll(id);
  const comments = await commentsStore.index('by-courseId').getAll(id);
  const positions: Position[] = [];
  for (const lesson of lessons) {
    const position = await tx.objectStore('positions_v2').get(lesson.id);
    if (position) positions.push(position);
    await tx.objectStore('positions_v2').delete(lesson.id);
    await lessonsStore.delete(lesson.id);
  }
  for (const comment of comments) await commentsStore.delete(comment.id);
  await courses.delete(id);
  const meta = tx.objectStore('meta_v2');
  const lastOpened = await meta.get('lastOpened');
  const lastOpenedValue = lastOpened?.value as { courseId?: unknown } | undefined;
  if (lastOpenedValue?.courseId === id) await meta.delete('lastOpened');
  const defaultCourseId = await meta.get('defaultCourseId');
  if (defaultCourseId?.value === id) await meta.delete('defaultCourseId');
  await tx.done;
  return { course, lessons, comments, positions };
}

export async function addLessons(
  courseId: string,
  inputs: LessonInput[],
  options: { preserveOrder?: boolean } = {},
): Promise<{ added: Lesson[]; skippedDuplicates: number }> {
  const db = await getDb();
  const tx = db.transaction('lessons', 'readwrite');
  const store = tx.objectStore('lessons');
  const existing = await store.index('by-courseId').getAll(courseId);
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  const sortedInputs = options.preserveOrder
    ? inputs.map((input) => ({ input }))
    : inputs.map((input, index) => ({ input, index })).sort((a, b) => collator.compare(a.input.title, b.input.title) || a.index - b.index);
  let order = existing.reduce((max, lesson) => Math.max(max, lesson.order), -1) + 1;
  const dedupe = new Set(existing.map((lesson) => `${lesson.title}\u0000${lesson.contentHash}`));
  const added: Lesson[] = [];
  let skippedDuplicates = 0;
  for (const { input } of sortedInputs) {
    const key = `${input.title}\u0000${input.contentHash}`;
    if (dedupe.has(key)) {
      skippedDuplicates++;
      continue;
    }
    dedupe.add(key);
    const now = Date.now();
    const lesson: Lesson = { ...input, id: uid(), courseId, order: order++, createdAt: now, updatedAt: now };
    await store.add(lesson);
    added.push(lesson);
  }
  await tx.done;
  return { added, skippedDuplicates };
}

export async function listLessons(courseId: string): Promise<Lesson[]> {
  return (await getDb()).getAllFromIndex('lessons', 'by-courseId', courseId).then((rows) => rows.sort(byOrder));
}

export async function getLesson(id: string): Promise<Lesson | undefined> {
  return (await getDb()).get('lessons', id);
}

export async function renameLesson(id: string, title: string): Promise<Lesson | undefined> {
  const db = await getDb();
  const lesson = await db.get('lessons', id);
  if (!lesson) return undefined;
  const updated = { ...lesson, title, updatedAt: Date.now() };
  await db.put('lessons', updated);
  return updated;
}

export async function moveLesson(id: string, newIndex: number): Promise<Lesson[]> {
  const db = await getDb();
  const tx = db.transaction('lessons', 'readwrite');
  const lesson = await tx.store.get(id);
  if (!lesson) { await tx.done; return []; }
  const rows = (await tx.store.index('by-courseId').getAll(lesson.courseId)).sort(byOrder);
  const current = rows.findIndex((row) => row.id === id);
  if (current >= 0) {
    const [item] = rows.splice(current, 1);
    rows.splice(Math.max(0, Math.min(newIndex, rows.length)), 0, item);
    for (const [order, row] of rows.entries()) await tx.store.put({ ...row, order, updatedAt: Date.now() });
  }
  await tx.done;
  return (await db.getAllFromIndex('lessons', 'by-courseId', lesson.courseId)).sort(byOrder);
}

export async function deleteLesson(id: string): Promise<{ lesson?: Lesson; comments: LessonComment[]; position?: Position }> {
  const db = await getDb();
  const tx = db.transaction(['lessons', 'comments', 'positions_v2', 'meta_v2'], 'readwrite');
  const lesson = await tx.objectStore('lessons').get(id);
  if (!lesson) { await tx.done; return { comments: [] }; }
  const comments = await tx.objectStore('comments').index('by-lessonId').getAll(id);
  for (const comment of comments) await tx.objectStore('comments').delete(comment.id);
  const position = await tx.objectStore('positions_v2').get(id);
  await tx.objectStore('positions_v2').delete(id);
  await tx.objectStore('lessons').delete(id);
  const meta = tx.objectStore('meta_v2');
  const lastOpened = await meta.get('lastOpened');
  const lastOpenedValue = lastOpened?.value as { lessonId?: unknown } | undefined;
  if (lastOpenedValue?.lessonId === id) await meta.delete('lastOpened');
  await tx.done;
  return { lesson, comments, position };
}

export async function addComment(input: Omit<LessonComment, 'id' | 'order' | 'createdAt' | 'updatedAt'>): Promise<LessonComment> {
  const db = await getDb();
  const tx = db.transaction('comments', 'readwrite');
  const comments = tx.store.index('by-courseId');
  const existing = await comments.getAll(input.courseId);
  const now = Date.now();
  const comment: LessonComment = { ...input, id: uid(), order: existing.reduce((max, row) => Math.max(max, row.order), -1) + 1, createdAt: now, updatedAt: now };
  await tx.store.add(comment);
  await tx.done;
  notifyCommentDataChanged(comment.lessonId, comment.courseId);
  return comment;
}

export async function listComments(courseId: string): Promise<LessonComment[]> {
  return (await getDb()).getAllFromIndex('comments', 'by-courseId', courseId).then((rows) => rows.sort(byOrder));
}

export async function listCommentsByLesson(lessonId: string): Promise<LessonComment[]> {
  return (await getDb()).getAllFromIndex('comments', 'by-lessonId', lessonId).then((rows) => rows.sort(byOrder));
}

export async function updateComment(id: string, changes: Partial<Pick<LessonComment, 'text' | 'anchor'>>): Promise<LessonComment | undefined> {
  const db = await getDb();
  const comment = await db.get('comments', id);
  if (!comment) return undefined;
  const updated = { ...comment, ...changes, updatedAt: Date.now() };
  await db.put('comments', updated);
  notifyCommentDataChanged(updated.lessonId, updated.courseId);
  return updated;
}

export async function moveComment(id: string, newIndex: number): Promise<LessonComment[]> {
  const db = await getDb();
  const tx = db.transaction('comments', 'readwrite');
  const comment = await tx.store.get(id);
  if (!comment) { await tx.done; return []; }
  const rows = (await tx.store.index('by-courseId').getAll(comment.courseId)).sort(byOrder);
  const current = rows.findIndex((row) => row.id === id);
  if (current >= 0) {
    const [item] = rows.splice(current, 1);
    rows.splice(Math.max(0, Math.min(newIndex, rows.length)), 0, item);
    for (const [order, row] of rows.entries()) await tx.store.put({ ...row, order, updatedAt: Date.now() });
  }
  await tx.done;
  const result = (await db.getAllFromIndex('comments', 'by-courseId', comment.courseId)).sort(byOrder);
  notifyCommentDataChanged(comment.lessonId, comment.courseId);
  return result;
}

export async function deleteComment(id: string): Promise<LessonComment | undefined> {
  const db = await getDb();
  const comment = await db.get('comments', id);
  if (comment) await db.delete('comments', id);
  if (comment) notifyCommentDataChanged(comment.lessonId, comment.courseId);
  return comment;
}

export async function getPosition(lessonId: string): Promise<Position | undefined> {
  return (await getDb()).get('positions_v2', lessonId);
}

export async function savePosition(position: Position): Promise<void> {
  await (await getDb()).put('positions_v2', position);
}

export async function getLastOpened(): Promise<{ courseId: string; lessonId: string } | null> {
  const meta = await (await getDb()).get('meta_v2', 'lastOpened');
  const value = meta?.value as { courseId?: unknown; lessonId?: unknown } | undefined;
  return value && typeof value.courseId === 'string' && typeof value.lessonId === 'string'
    ? { courseId: value.courseId, lessonId: value.lessonId }
    : null;
}

export async function setLastOpened(value: { courseId: string; lessonId: string } | null): Promise<void> {
  const db = await getDb();
  if (value) await db.put('meta_v2', { key: 'lastOpened', value });
  else await db.delete('meta_v2', 'lastOpened');
}

export async function getMeta<T>(key: string, fallback: T): Promise<T> {
  const row = await (await getDb()).get('meta_v2', key);
  return row?.value !== undefined ? row.value as T : fallback;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await getDb()).put('meta_v2', { key, value });
}

