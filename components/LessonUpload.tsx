'use client';

import type { DragEvent } from 'react';
import { Button } from 'react-bootstrap';
import type { OpenAddLessonsOptions } from '@/lib/addLessonsContext';

export function LessonUploadButton({ open }: { open: (options?: OpenAddLessonsOptions) => void }) {
  return (
    <Button type="button" onClick={() => open()} className="tap-target">
      <i className="bi bi-plus-lg me-1" aria-hidden="true" />Upload lessons
    </Button>
  );
}

export default function LessonUploadBox({ open }: { open: (options?: OpenAddLessonsOptions) => void }) {
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (event.dataTransfer.files.length) open({ tab: 'upload', files: Array.from(event.dataTransfer.files) });
  };
  return (
    <div
      className="lesson-dropzone"
      role="button"
      tabIndex={0}
      aria-label="Upload lessons"
      onClick={() => open({ tab: 'upload' })}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open({ tab: 'upload' }); }
      }}
      onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; }}
      onDrop={drop}
    >
      <i className="bi bi-cloud-arrow-up lesson-upload-icon" aria-hidden="true" />
      <strong>Drop Markdown files here</strong>
      <span>or click to browse · .md, .markdown, and .txt</span>
    </div>
  );
}
