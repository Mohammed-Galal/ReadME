'use client';

// Floating "Jump to current" button, shown when auto-scroll was paused by a
// manual scroll during playback.

import { Button } from 'react-bootstrap';
import { resumeAutoScroll } from '@/lib/scroller';
import { useStore } from '@/lib/store';

export default function JumpToCurrent() {
  const show = useStore((s) => s.autoScrollSuspended && !!s.currentBlockId);
  if (!show) return null;
  return (
    <Button variant="primary" className="jump-to-current" onClick={() => resumeAutoScroll()}>
      <i className="bi bi-arrow-down-circle" aria-hidden="true" /> Jump to current
    </Button>
  );
}
