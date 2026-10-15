'use client';

import { useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { paths } from '@/lib/paths';
import { connectReaderNavigation, useStore } from '@/lib/store';
import { wireShortcuts } from '@/lib/shortcuts';
import JumpToCurrent from './JumpToCurrent';
import MainContent from './MainContent';
import SettingsModal from './SettingsModal';
import Sidebar from './Sidebar';
import TopNavbar from './TopNavbar';

export default function ReaderApp({ courseId, lessonId, courseName }: { courseId: string; lessonId: string; courseName: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const commentId = searchParams.get('comment');
  const speechSupported = useStore((state) => state.speechSupported);
  const consumeCommentParam = useCallback(() => {
    router.replace(paths.lesson(courseId, lessonId), { scroll: false });
  }, [courseId, lessonId, router]);

  useEffect(() => connectReaderNavigation((nextLessonId) => {
    router.replace(paths.lesson(courseId, nextLessonId), { scroll: false });
  }), [courseId, router]);

  useEffect(() => wireShortcuts({
    playPause: () => useStore.getState().playPause(),
    next: () => useStore.getState().nextBlock(),
    prev: () => useStore.getState().prevBlock(),
    comment: () => window.dispatchEvent(new CustomEvent('readme-comment-selection')),
    isModalOpen: () => !!document.querySelector('.modal.show'),
  }), []);

  return (
    <>
      <div className="app-shell">
        <Sidebar courseId={courseId} lessonId={lessonId} courseName={courseName} />
        <div className="app-main">
          <TopNavbar />
          {!speechSupported && (
            <div className="speech-warning" role="alert">
              <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
              <span>Text-to-speech is not supported in this browser. You can still browse and highlight your lessons, but playback controls are disabled.</span>
            </div>
          )}
          <MainContent courseId={courseId} lessonId={lessonId} commentId={commentId} onCommentParamConsumed={consumeCommentParam} />
        </div>
      </div>
      <SettingsModal />
      <JumpToCurrent />
    </>
  );
}

