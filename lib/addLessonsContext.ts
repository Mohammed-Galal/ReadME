'use client';

import { createContext } from 'react';

export interface OpenAddLessonsOptions {
  tab?: 'upload' | 'paste';
  files?: File[];
}

export interface AddLessonsContextValue {
  open(courseId: string, options?: OpenAddLessonsOptions): void;
}

export const AddLessonsContext = createContext<AddLessonsContextValue | null>(null);
