import { describe, expect, it } from 'vitest';
import type { Lesson, LessonComment } from './db/schema';
import { buildCommentRows, truncateQuote } from './courseComments';

const makeComment = (id: string, order: number, lessonId: string, quote: string): LessonComment => ({
  id,
  courseId: 'course',
  lessonId,
  text: `Note ${id}`,
  anchor: { blockId: 'p1', start: 0, end: quote.length, quote, prefix: '', suffix: '' },
  order,
  createdAt: 1,
  updatedAt: 2,
});

const makeLesson = (id: string, title: string): Lesson => ({
  id, courseId: 'course', title, content: '', contentHash: '', order: 0, source: 'paste', createdAt: 1, updatedAt: 2,
});

describe('course comment rows', () => {
  it('sorts by creation order and assigns positions with lesson titles', () => {
    const rows = buildCommentRows([
      makeComment('third', 2, 'l1', 'third quote'),
      makeComment('first', 0, 'l2', 'first quote'),
      makeComment('second', 1, 'l1', 'second quote'),
    ], [makeLesson('l1', 'One'), makeLesson('l2', 'Two')]);
    expect(rows.map(({ comment, lessonTitle, position }) => [comment.id, lessonTitle, position])).toEqual([
      ['first', 'Two', 1], ['second', 'One', 2], ['third', 'One', 3],
    ]);
  });

  it('uses a deleted lesson fallback when the source lesson is absent', () => {
    expect(buildCommentRows([makeComment('orphan', 0, 'missing', 'quote')], [])[0].lessonTitle).toBe('Deleted lesson');
  });
});

describe('truncateQuote', () => {
  it('collapses whitespace before applying an ellipsis', () => {
    expect(truncateQuote('  one\n\t two   ')).toBe('one two');
    expect(truncateQuote('one two three', 8)).toBe('one two…');
  });

  it('cuts on grapheme boundaries for joined emoji and Arabic combining marks', () => {
    expect(truncateQuote('a👨‍👩‍👧‍👦bc', 3)).toBe('a👨‍👩‍👧‍👦…');
    expect(truncateQuote('اَبت', 2)).toBe('اَ…');
  });
});
