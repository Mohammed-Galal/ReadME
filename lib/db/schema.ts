import type { DBSchema } from 'idb';

export interface Course {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  updatedAt: number;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  content: string;
  contentHash: string;
  order: number;
  source: 'file' | 'paste';
  originalFileName?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommentAnchor {
  blockId: string;
  start: number;
  end: number;
  quote: string;
  prefix: string;
  suffix: string;
}

export interface LessonComment {
  id: string;
  courseId: string;
  lessonId: string;
  text: string;
  anchor: CommentAnchor;
  order: number;
  createdAt: number;
  updatedAt: number;
}

export interface Position {
  lessonId: string;
  blockId: string | null;
  charOffset: number;
  updatedAt: number;
}

export interface MetaRecord<T = unknown> {
  key: string;
  value: T;
}

export interface LegacyFile {
  id: string | number;
  name: string;
  content: string;
  hash: string;
  date: number;
}

export interface LegacyPosition {
  fileId: string | number;
  blockId: string | null;
  charOffset: number;
  updatedAt: number;
}

export interface ReadmeDB extends DBSchema {
  // Retained unchanged for one version so upgrades remain non-destructive.
  files: { key: string | number; value: LegacyFile };
  positions: { key: string | number; value: LegacyPosition };
  meta: { key: string; value: MetaRecord };
  courses: { key: string; value: Course; indexes: { 'by-createdAt': number } };
  lessons: { key: string; value: Lesson; indexes: { 'by-courseId': string } };
  comments: {
    key: string;
    value: LessonComment;
    indexes: { 'by-courseId': string; 'by-lessonId': string };
  };
  positions_v2: { key: string; value: Position };
  meta_v2: { key: string; value: MetaRecord };
}

export interface LessonInput {
  title: string;
  content: string;
  contentHash: string;
  source: 'file' | 'paste';
  originalFileName?: string;
}

