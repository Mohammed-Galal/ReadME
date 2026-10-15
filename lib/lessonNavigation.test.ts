import { describe, expect, it } from 'vitest';
import type { Lesson } from './db/schema';
import { getLessonAfterDelete, getNextLesson } from './lessonNavigation';

const lessons = ([...['a', 'b', 'c']]).map((id, order) => ({
  id,
  courseId: 'course',
  title: id,
  content: '',
  contentHash: '',
  order,
  source: 'file' as const,
  createdAt: 0,
  updatedAt: 0,
})) satisfies Lesson[];

describe('lesson navigation', () => {
  it('finds the next ordered lesson only when auto-advance is enabled', () => {
    expect(getNextLesson('b', lessons)?.id).toBe('c');
    expect(getNextLesson('b', lessons, false)).toBeNull();
    expect(getNextLesson('c', lessons)).toBeNull();
  });

  it('selects the next lesson after deletion, then the previous one at the end', () => {
    expect(getLessonAfterDelete('b', lessons)?.id).toBe('c');
    expect(getLessonAfterDelete('c', lessons)?.id).toBe('b');
    expect(getLessonAfterDelete('a', [lessons[0]])).toBeNull();
  });
});
