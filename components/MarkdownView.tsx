'use client';

// Renders the hast tree to React elements. Speakable blocks are memoized
// wrappers that subscribe only to their own "current" flag, so word-level
// updates never re-render the tree.

import { createElement, memo, useMemo, type ReactNode } from 'react';
import { toJsxRuntime } from 'hast-util-to-jsx-runtime';
import { Fragment, jsx, jsxs } from 'react/jsx-runtime';
import type { Root as HastRoot } from 'hast';
import { useStore } from '@/lib/store';
import { cls } from '@/lib/utils';

interface BlockProps {
  'data-block-id'?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}

type TagName = 'p' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'li' | 'tr';

function makeBlock(tag: TagName) {
  return memo(function Block(props: BlockProps) {
    const blockId = typeof props['data-block-id'] === 'string' ? props['data-block-id'] : null;
    const isCurrent = useStore((s) => (blockId ? s.currentBlockId === blockId : false));
    const { className, children, ...rest } = props;
    return createElement(
      tag,
      { ...rest, className: cls(className, isCurrent && 'reading-block') },
      children,
    );
  });
}

// eslint-disable-next-line react/display-name
const BLOCK_COMPONENTS: Record<TagName, ReturnType<typeof makeBlock>> = {
  p: makeBlock('p'),
  h1: makeBlock('h1'),
  h2: makeBlock('h2'),
  h3: makeBlock('h3'),
  h4: makeBlock('h4'),
  h5: makeBlock('h5'),
  h6: makeBlock('h6'),
  li: makeBlock('li'),
  tr: makeBlock('tr'),
};

export default function MarkdownView({ hast }: { hast: HastRoot }) {
  return useMemo(
    () => toJsxRuntime(hast, { Fragment, jsx, jsxs, components: BLOCK_COMPONENTS as never }),
    [hast],
  );
}
