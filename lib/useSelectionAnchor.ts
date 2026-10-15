'use client';

import { useEffect, useState, type RefObject } from 'react';
import { rangeToAnchor, type TextAnchor } from './anchors';

export interface SelectionAnchorState {
  anchor: TextAnchor;
  clamped: boolean;
  rect: DOMRect;
}

export function useSelectionAnchor(rootRef: RefObject<HTMLElement | null>): SelectionAnchorState | null {
  const [selected, setSelected] = useState<SelectionAnchorState | null>(null);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      timer = null;
      const root = rootRef.current;
      const selection = window.getSelection();
      if (!root || !selection || selection.isCollapsed || !selection.rangeCount) {
        setSelected(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const result = rangeToAnchor(range, root);
      if (!result.ok) {
        setSelected(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelected(rect.width || rect.height ? { anchor: result.anchor, clamped: result.clamped, rect } : null);
    };
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 150);
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      if (timer) clearTimeout(timer);
    };
  }, [rootRef]);

  return selected;
}
