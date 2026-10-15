import type { Lesson, LessonComment } from './db/schema';

export interface CommentRow {
  comment: LessonComment;
  lessonTitle: string;
  position: number;
}

export function buildCommentRows(comments: readonly LessonComment[], lessons: readonly Lesson[]): CommentRow[] {
  const titles = new Map(lessons.map((lesson) => [lesson.id, lesson.title]));
  return [...comments]
    .sort((a, b) => a.order - b.order)
    .map((comment, index) => ({
      comment,
      lessonTitle: titles.get(comment.lessonId) ?? 'Deleted lesson',
      position: index + 1,
    }));
}

function graphemes(value: string): string[] {
  if (typeof Intl.Segmenter === 'function') {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value)].map((item) => item.segment);
  }
  return Array.from(value);
}

export function truncateQuote(quote: string, maxGraphemes = 90): string {
  const normalized = quote.replace(/\s+/gu, ' ').trim();
  const units = graphemes(normalized);
  if (units.length <= maxGraphemes) return normalized;
  if (maxGraphemes <= 1) return '…'.slice(0, maxGraphemes);
  return `${units.slice(0, maxGraphemes - 1).join('')}…`;
}
