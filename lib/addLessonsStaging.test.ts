import { describe, expect, it } from 'vitest';
import {
  addLessonsStagingReducer,
  derivePasteTitle,
  type StagedLesson,
  uniquePasteTitle,
} from './addLessonsStaging';

const staged = (id: string, title: string, contentHash: string, baseStatus: StagedLesson['baseStatus'] = 'Ready'): StagedLesson => ({
  id, title, content: title, contentHash, source: 'paste', size: title.length, baseStatus, status: baseStatus,
});

describe('Add Lessons staging', () => {
  it('derives a title from a Markdown heading and strips inline markup', () => {
    expect(derivePasteTitle('Intro\n\n## **A [linked](https://example.com) `title`**')).toBe('A linked title');
    expect(derivePasteTitle('# keep_this and *emphasis*')).toBe('keep_this and emphasis');
  });

  it('uses the first non-empty line, truncates it, and falls back for empty text', () => {
    expect(derivePasteTitle('\n  First line\nSecond line')).toBe('First line');
    expect(derivePasteTitle(`  ${'x'.repeat(70)}`).length).toBe(60);
    expect(derivePasteTitle(' \n\t ')).toBe('Untitled lesson');
  });

  it('numbers generated titles when a course or staged row already uses the title', () => {
    expect(uniquePasteTitle('Notes', ['Notes'])).toBe('Notes (2)');
    expect(uniquePasteTitle('Notes', ['Notes', 'Notes (2)', 'Notes (3)'])).toBe('Notes (4)');
    expect(uniquePasteTitle('Notes', ['Other'])).toBe('Notes');
  });

  it('natural-sorts each file selection while preserving previously staged rows', () => {
    const first = addLessonsStagingReducer([], { type: 'addFiles', files: [staged('a10', 'Lesson 10.md', '10'), staged('a2', 'Lesson 2.md', '2')] });
    const mixed = addLessonsStagingReducer(first, { type: 'addPaste', lesson: staged('paste', 'Pasted', 'p') });
    const second = addLessonsStagingReducer(mixed, { type: 'addFiles', files: [staged('b3', 'Part 3.md', '3'), staged('b1', 'Part 1.md', '1')] });
    expect(second.map((item) => item.id)).toEqual(['a2', 'a10', 'paste', 'b1', 'b3']);
  });

  it('flags course and list duplicates while keeping invalid rows visible', () => {
    const input = [
      staged('existing', 'Existing.md', 'same'),
      staged('first', 'New.md', 'shared'),
      staged('second', 'New.md', 'shared'),
      staged('unsupported', 'bad.pdf', 'x', 'Unsupported type'),
      staged('empty', 'empty.md', 'y', 'Empty'),
    ];
    const result = addLessonsStagingReducer(input, {
      type: 'markDuplicates', existing: [{ title: 'Existing.md', contentHash: 'same' }],
    });
    expect(result.map((item) => item.status)).toEqual([
      'Already in this course', 'Ready', 'Duplicate in list', 'Unsupported type', 'Empty',
    ]);
  });

  it('removes rows and clears all staged rows', () => {
    const rows = [staged('one', 'One', '1'), staged('two', 'Two', '2')];
    expect(addLessonsStagingReducer(rows, { type: 'remove', id: 'one' }).map((item) => item.id)).toEqual(['two']);
    expect(addLessonsStagingReducer(rows, { type: 'clear' })).toEqual([]);
  });
});
