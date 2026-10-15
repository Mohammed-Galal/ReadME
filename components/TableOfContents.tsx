'use client';

// Table of contents: built from heading blocks (h1–h4), nested by depth,
// collapsible, shown only with 2+ headings. Navigation only — never spoken.

import { useMemo } from 'react';
import { resumeAutoScroll } from '@/lib/scroller';
import { useStore } from '@/lib/store';
import type { HeadingEntry } from '@/lib/types';

interface TocNode {
  id: string;
  depth: number;
  label: string;
  children: TocNode[];
}

function buildTree(headings: HeadingEntry[]): TocNode[] {
  const root: TocNode[] = [];
  const stack: TocNode[] = [];
  for (const h of headings) {
    const node: TocNode = { id: h.id, depth: h.depth, label: h.label, children: [] };
    while (stack.length && stack[stack.length - 1].depth >= h.depth) stack.pop();
    if (stack.length) stack[stack.length - 1].children.push(node);
    else root.push(node);
    stack.push(node);
  }
  return root;
}

function TocList({ items, onClick }: { items: TocNode[]; onClick: (id: string) => void }) {
  if (!items.length) return null;
  return (
    <ul className="toc-list">
      {items.map((n) => (
        <li key={n.id} className={`toc-depth-${n.depth}`}>
          <button type="button" className="toc-entry" onClick={() => onClick(n.id)}>
            {n.label}
          </button>
          <TocList items={n.children} onClick={onClick} />
        </li>
      ))}
    </ul>
  );
}

export default function TableOfContents() {
  const headings = useStore((s) => s.headings);
  const tree = useMemo(() => buildTree(headings), [headings]);

  const onClick = (id: string): void => {
    resumeAutoScroll();
    const s = useStore.getState();
    // If playing, reading continues from the new block; otherwise just navigate.
    s.setCurrentBlock(id, { restartSpeech: s.playback === 'playing' });
  };

  return (
    <details className="toc" open>
      <summary>Table of contents</summary>
      <TocList items={tree} onClick={onClick} />
    </details>
  );
}
