// Keyboard shortcuts: Space = play/pause, ←/→ = previous/next block.
// Ignored while a modal, input, link, or button has focus.

export interface ShortcutHandlers {
  playPause(): void;
  next(): void;
  prev(): void;
  comment(): void;
  isModalOpen(): boolean;
}

export function wireShortcuts(handlers: ShortcutHandlers): () => void {
  const onKey = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const target = e.target as HTMLElement | null;
    if (
      target &&
      (target.closest('input, textarea, select, [contenteditable="true"], button, a[href]') ||
        target.isContentEditable)
    ) {
      return;
    }
    if (handlers.isModalOpen()) return;
    if (e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) handlers.playPause();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      handlers.next();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      handlers.prev();
    } else if (e.key.toLowerCase() === 'c') {
      handlers.comment();
    }
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
