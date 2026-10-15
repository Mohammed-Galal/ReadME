'use client';

// Floating top navbar: sidebar toggle, tool name, prev / play-pause / next /
// settings.

import { Button, ButtonGroup } from 'react-bootstrap';
import Link from 'next/link';
import { useStore } from '@/lib/store';
import { paths } from '@/lib/paths';

export default function TopNavbar() {
  const playback = useStore((s) => s.playback);
  const canPlay = useStore((s) => s.blocks.length > 0 && s.speechSupported);

  const playing = playback === 'playing';

  return (
    <nav className="top-navbar" aria-label="Reader controls">
      <div className="nav-left">
        <Button
          variant="outline-secondary"
          className="icon-btn"
          onClick={() => useStore.getState().toggleSidebar()}
          aria-label="Toggle file list"
        >
          <i className="bi bi-list" aria-hidden="true" />
        </Button>
      </div>

      <div className="nav-center">
        <Link href={paths.home()} className="brand" aria-label="ReadME home">ReadME</Link>
      </div>

      <div className="nav-right">
        <ButtonGroup aria-label="Reading controls">
          <Button
            variant="outline-secondary"
            className="icon-btn"
            onClick={() => useStore.getState().prevBlock()}
            disabled={!canPlay}
            aria-label="Previous block"
          >
            <i className="bi bi-skip-backward-fill" aria-hidden="true" />
          </Button>
          <Button
            variant={playing ? 'primary' : 'outline-primary'}
            className="icon-btn play-btn"
            onClick={() => useStore.getState().playPause()}
            disabled={!canPlay}
            aria-label={playing ? 'Pause' : 'Play'}
          >
            <i className={playing ? 'bi bi-pause-fill' : 'bi bi-play-fill'} aria-hidden="true" />
          </Button>
          <Button
            variant="outline-secondary"
            className="icon-btn"
            onClick={() => useStore.getState().nextBlock()}
            disabled={!canPlay}
            aria-label="Next block"
          >
            <i className="bi bi-skip-forward-fill" aria-hidden="true" />
          </Button>
        </ButtonGroup>
        <Button
          variant="outline-secondary"
          className="icon-btn"
          onClick={() => useStore.getState().setSettingsOpen(true)}
          aria-label="Settings"
        >
          <i className="bi bi-gear" aria-hidden="true" />
        </Button>
      </div>
    </nav>
  );
}
