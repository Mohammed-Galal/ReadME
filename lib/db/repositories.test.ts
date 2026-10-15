import 'fake-indexeddb/auto';
import { beforeAll, describe, expect, it } from 'vitest';
import { openDB } from 'idb';
import { getDb, openReadmeDatabase } from './index';
import {
  addComment,
  addLessons,
  createCourse,
  deleteCourse,
  deleteLesson,
  getLastOpened,
  getPosition,
  listComments,
  listLessons,
  moveComment,
  moveLesson,
  savePosition,
  setLastOpened,
} from './repositories';
import type { LessonInput } from './schema';
import type { LegacyFile } from './schema';

const legacyFile = { id: 'old-file-1', name: 'Chapter 1.md', content: '# One', hash: 'hash-one', date: 100 };

async function seedLegacyDatabase(name = 'readme-reader', files: LegacyFile[] = [legacyFile]) {
  const db = await openDB(name, 1, {
    upgrade(database) {
      database.createObjectStore('files', { keyPath: 'id' });
      database.createObjectStore('positions', { keyPath: 'fileId' });
      database.createObjectStore('meta', { keyPath: 'key' });
    },
  });
  const tx = db.transaction(['files', 'positions', 'meta'], 'readwrite');
  for (const file of files) await tx.objectStore('files').put(file);
  await tx.objectStore('positions').put({ fileId: files[0].id, blockId: 'block-2', charOffset: 14, updatedAt: 101 });
  await tx.objectStore('meta').put({ key: 'lastActive', value: files[0].id });
  await tx.objectStore('meta').put({ key: 'sidebarCollapsed', value: true });
  await tx.done;
  db.close();
}

beforeAll(async () => seedLegacyDatabase());

describe('database migration and repositories', () => {
  it('migrates v1 lessons, position, last-opened and leaves legacy stores untouched', async () => {
    const db = await getDb();
    const courses = await db.getAll('courses');
    const lessons = await db.getAll('lessons');
    expect(courses).toHaveLength(1);
    expect(courses[0]).toMatchObject({ name: 'My lessons', description: '' });
    expect(lessons).toHaveLength(1);
    expect(lessons[0]).toMatchObject({
      id: legacyFile.id,
      courseId: courses[0].id,
      title: legacyFile.name,
      content: legacyFile.content,
      contentHash: legacyFile.hash,
      order: 0,
      source: 'file',
      originalFileName: legacyFile.name,
    });
    expect(await getPosition(legacyFile.id)).toMatchObject({ lessonId: legacyFile.id, blockId: 'block-2', charOffset: 14 });
    expect(await getLastOpened()).toEqual({ courseId: courses[0].id, lessonId: legacyFile.id });
    expect(await db.get('meta_v2', 'sidebarCollapsed')).toEqual({ key: 'sidebarCollapsed', value: true });
    expect(await db.get('files', legacyFile.id)).toEqual(legacyFile);
    expect(await db.get('positions', legacyFile.id)).toMatchObject({ fileId: legacyFile.id, charOffset: 14 });
    expect(await db.get('meta', 'lastActive')).toEqual({ key: 'lastActive', value: legacyFile.id });
  });

  it('creates only the new schema on a fresh install and leaves courses empty', async () => {
    const db = await openReadmeDatabase('readme-fresh-test');
    expect(Array.from(db.objectStoreNames)).toEqual(expect.arrayContaining([
      'courses', 'lessons', 'comments', 'positions_v2', 'meta_v2',
    ]));
    expect(await db.getAll('courses')).toEqual([]);
    expect(await db.getAll('lessons')).toEqual([]);
    db.close();
  });

  it('rewrites numeric ids and references during migration', async () => {
    await seedLegacyDatabase('readme-numeric-test', [{ ...legacyFile, id: 42 }]);
    const db = await openReadmeDatabase('readme-numeric-test');
    const lesson = (await db.getAll('lessons'))[0];
    expect(lesson.id).not.toBe('42');
    expect(await db.get('positions_v2', lesson.id)).toMatchObject({ lessonId: lesson.id, blockId: 'block-2' });
    expect(await db.get('meta_v2', 'lastOpened')).toMatchObject({ value: { lessonId: lesson.id } });
    expect(await db.get('files', 42)).toMatchObject({ id: 42 });
    db.close();
  });

  it('deduplicates by title and content hash and natural-sorts batch order', async () => {
    const course = await createCourse({ name: 'Ordering' });
    const inputs: LessonInput[] = [
      { title: 'Lesson 10.md', content: 'ten', contentHash: 'ten', source: 'file' },
      { title: 'Lesson 2.md', content: 'two', contentHash: 'two', source: 'file' },
      { title: 'Lesson 1.md', content: 'one', contentHash: 'one', source: 'file' },
      { title: 'Lesson 2.md', content: 'duplicate', contentHash: 'two', source: 'file' },
    ];
    const result = await addLessons(course.id, inputs);
    expect(result.skippedDuplicates).toBe(1);
    expect(result.added.map((lesson) => lesson.title)).toEqual(['Lesson 1.md', 'Lesson 2.md', 'Lesson 10.md']);
    expect((await addLessons(course.id, [inputs[0]])).skippedDuplicates).toBe(1);
    expect((await listLessons(course.id)).map((lesson) => lesson.order)).toEqual([0, 1, 2]);
  });

  it('preserves input order when requested and appends after existing lessons', async () => {
    const course = await createCourse({ name: 'Preserved ordering' });
    await addLessons(course.id, [{ title: 'Existing', content: 'existing', contentHash: 'existing', source: 'paste' }]);
    const result = await addLessons(course.id, [
      { title: 'Lesson 10', content: 'ten', contentHash: 'ten', source: 'paste' },
      { title: 'Lesson 2', content: 'two', contentHash: 'two', source: 'paste' },
      { title: 'Lesson 1', content: 'one', contentHash: 'one', source: 'paste' },
    ], { preserveOrder: true });
    expect(result.added.map((lesson) => [lesson.title, lesson.order])).toEqual([
      ['Lesson 10', 1], ['Lesson 2', 2], ['Lesson 1', 3],
    ]);
    expect((await listLessons(course.id)).map((lesson) => lesson.order)).toEqual([0, 1, 2, 3]);
  });

  it('renumbers lessons and comments on move', async () => {
    const course = await createCourse({ name: 'Move' });
    const lessons = (await addLessons(course.id, [1, 2, 3].map((n) => ({
      title: `Lesson ${n}`, content: `${n}`, contentHash: `${n}`, source: 'paste' as const,
    })))).added;
    const movedLessons = await moveLesson(lessons[0].id, 2);
    expect(movedLessons.map((lesson) => [lesson.title, lesson.order])).toEqual([
      ['Lesson 2', 0], ['Lesson 3', 1], ['Lesson 1', 2],
    ]);
    const makeComment = (lessonId: string, text: string) => addComment({
      courseId: course.id,
      lessonId,
      text,
      anchor: { blockId: 'p1', start: 0, end: 1, quote: 'a', prefix: '', suffix: '' },
    });
    const comments = await Promise.all(lessons.map((lesson, index) => makeComment(lesson.id, `Comment ${index + 1}`)));
    const movedComments = await moveComment(comments[0].id, 2);
    expect(movedComments.map((comment) => [comment.text, comment.order])).toEqual([
      ['Comment 2', 0], ['Comment 3', 1], ['Comment 1', 2],
    ]);
  });

  it('cascades lesson deletes and clears matching last-opened state', async () => {
    const course = await createCourse({ name: 'Lesson cascade' });
    const lesson = (await addLessons(course.id, [{ title: 'Only', content: 'body', contentHash: 'body', source: 'file' }])).added[0];
    const comment = await addComment({
      courseId: course.id,
      lessonId: lesson.id,
      text: 'note',
      anchor: { blockId: 'b', start: 0, end: 1, quote: 'b', prefix: '', suffix: '' },
    });
    await savePosition({ lessonId: lesson.id, blockId: 'b', charOffset: 1, updatedAt: 1 });
    await setLastOpened({ courseId: course.id, lessonId: lesson.id });
    const removed = await deleteLesson(lesson.id);
    expect(removed.lesson?.id).toBe(lesson.id);
    expect(removed.comments.map((row) => row.id)).toContain(comment.id);
    expect(removed.position?.lessonId).toBe(lesson.id);
    expect(await listComments(course.id)).toEqual([]);
    expect(await getPosition(lesson.id)).toBeUndefined();
    expect(await getLastOpened()).toBeNull();
  });

  it('cascades course deletes and clears last-opened and default-course metadata', async () => {
    const course = await createCourse({ name: 'Course cascade' });
    const lessons = (await addLessons(course.id, [1, 2].map((n) => ({
      title: `Lesson ${n}`, content: `${n}`, contentHash: `${n}`, source: 'file' as const,
    })))).added;
    await addComment({
      courseId: course.id,
      lessonId: lessons[0].id,
      text: 'note',
      anchor: { blockId: 'b', start: 0, end: 1, quote: 'b', prefix: '', suffix: '' },
    });
    await savePosition({ lessonId: lessons[0].id, blockId: 'b', charOffset: 1, updatedAt: 1 });
    await setLastOpened({ courseId: course.id, lessonId: lessons[0].id });
    const db = await getDb();
    await db.put('meta_v2', { key: 'defaultCourseId', value: course.id });
    const removed = await deleteCourse(course.id);
    expect(removed.lessons).toHaveLength(2);
    expect(removed.comments).toHaveLength(1);
    expect(removed.positions).toHaveLength(1);
    expect(await getLastOpened()).toBeNull();
    expect(await db.get('meta_v2', 'defaultCourseId')).toBeUndefined();
  });
});
