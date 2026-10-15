export const MAX_LESSON_SIZE = 2 * 1024 * 1024;

export type StagedStatus =
  | 'Ready'
  | 'Already in this course'
  | 'Duplicate in list'
  | 'Unsupported type'
  | 'Empty'
  | 'Too large';

export interface StagedLesson {
  id: string;
  title: string;
  content: string;
  contentHash: string;
  source: 'file' | 'paste';
  originalFileName?: string;
  size: number;
  baseStatus: StagedStatus;
  status: StagedStatus;
}

export interface ExistingLessonKey {
  title: string;
  contentHash: string;
}

export type StagingAction =
  | { type: 'addFiles'; files: StagedLesson[] }
  | { type: 'addPaste'; lesson: StagedLesson }
  | { type: 'remove'; id: string }
  | { type: 'markDuplicates'; existing: ExistingLessonKey[] }
  | { type: 'replace'; items: StagedLesson[] }
  | { type: 'clear' };

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
const duplicateKey = (lesson: ExistingLessonKey) => `${lesson.title}\u0000${lesson.contentHash}`;

export function derivePasteTitle(content: string): string {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const heading = lines.find((line) => /^\s{0,3}#{1,6}\s+\S/.test(line));
  if (heading) {
    const value = heading.replace(/^\s{0,3}#{1,6}\s+/, '').replace(/\s+#+\s*$/, '');
    const stripped = value
      .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/<[^>]*>/g, '')
      .replace(/\\([\\`*_{}\[\]()#+.!>-])/g, '$1')
      .replace(/(\*\*|__)(.*?)\1/g, '$2')
      .replace(/(\*|_)(.*?)\1/g, '$2')
      .replace(/~~(.*?)~~/g, '$1')
      .trim();
    if (stripped) return stripped;
  }
  const firstLine = lines.find((line) => line.trim().length > 0)?.trim();
  return firstLine ? firstLine.slice(0, 60) : 'Untitled lesson';
}

export function uniquePasteTitle(title: string, existingTitles: string[]): string {
  const titles = new Set(existingTitles);
  if (!titles.has(title)) return title;
  let suffix = 2;
  while (titles.has(`${title} (${suffix})`)) suffix++;
  return `${title} (${suffix})`;
}

function markStatus(items: StagedLesson[], existing: ExistingLessonKey[]): StagedLesson[] {
  const existingKeys = new Set(existing.map(duplicateKey));
  const seen = new Set<string>();
  return items.map((item) => {
    let status = item.baseStatus;
    if (status === 'Ready') {
      const key = duplicateKey(item);
      if (existingKeys.has(key)) status = 'Already in this course';
      else if (seen.has(key)) status = 'Duplicate in list';
      else seen.add(key);
    }
    return item.status === status ? item : { ...item, status };
  });
}

export function addLessonsStagingReducer(state: StagedLesson[], action: StagingAction): StagedLesson[] {
  switch (action.type) {
    case 'addFiles': {
      const files = [...action.files].sort((a, b) => collator.compare(a.title, b.title));
      return [...state, ...files];
    }
    case 'addPaste':
      return [...state, action.lesson];
    case 'remove':
      return state.filter((item) => item.id !== action.id);
    case 'markDuplicates': {
      const marked = markStatus(state, action.existing);
      return marked.every((item, index) => item === state[index]) ? state : marked;
    }
    case 'replace':
      return action.items;
    case 'clear':
      return state.length ? [] : state;
  }
}
