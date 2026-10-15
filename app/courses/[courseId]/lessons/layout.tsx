'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { initSpeechAndScroller, useStore } from '@/lib/store';

function ReaderSession({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    initSpeechAndScroller();
    return () => useStore.getState().stopReader();
  }, []);
  return children;
}

export default function LessonsLayout({ children }: { children: React.ReactNode }) {
  const { courseId } = useParams<{ courseId: string }>();
  return <ReaderSession key={courseId}>{children}</ReaderSession>;
}
