import type { Lesson } from './db/schema';

export function getNextLesson(
  currentLessonId: string,
  lessons: Lesson[],
  autoAdvance = true,
): Lesson | null {
  if (!autoAdvance) return null;
  const ordered = [...lessons].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = ordered.findIndex((lesson) => lesson.id === currentLessonId);
  return index >= 0 ? ordered[index + 1] ?? null : null;
}

export function getLessonAfterDelete(deletedLessonId: string, lessons: Lesson[]): Lesson | null {
  const ordered = [...lessons].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
  const index = ordered.findIndex((lesson) => lesson.id === deletedLessonId);
  if (index < 0) return null;
  return ordered[index + 1] ?? ordered[index - 1] ?? null;
}
