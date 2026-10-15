// unified/remark pipeline: markdown -> mdast, then mdast -> hast (with Shiki
// syntax highlighting applied to code blocks). Everything runs client-side.

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import { visit } from 'unist-util-visit';
import type { Root as MdRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';

export function parseMarkdown(content: string): MdRoot {
  return unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .parse(content) as MdRoot;
}

const NON_RENDERABLE = new Set(['html', 'yaml', 'toml']);

/**
 * Removes raw HTML and front matter from the tree. Raw HTML is never
 * rendered (spec: "Raw HTML in markdown isn't rendered"), front matter is
 * metadata only. `lang` must be extracted *before* calling this.
 */
export function stripNonRenderable(tree: MdRoot): void {
  visit(tree, (node, index, parent) => {
    if (NON_RENDERABLE.has(node.type)) {
      if (parent && typeof index === 'number') {
        parent.children.splice(index, 1);
        return index; // re-visit the node that shifted into this slot
      }
    }
  });
}

/** Rehype plugin: `dir="auto"` (RTL support) on speakable blocks, and
 * privacy-safe lazy loading for images. */
export function rehypeBlockDirPlugin() {
  return (tree: HastRoot): void => {
    visit(tree, 'element', (node) => {
      const props = node.properties as Record<string, unknown> | null | undefined;
      if (!props) return;
      if (typeof props['data-block-id'] === 'string') {
        props.dir = 'auto';
      }
      if (node.tagName === 'img') {
        props.loading = 'lazy';
        props.referrerPolicy = 'no-referrer';
      }
    });
  };
}

let shikiPluginPromise: Promise<unknown> | null = null;

function loadShikiPlugin(): Promise<unknown> {
  if (!shikiPluginPromise) {
    shikiPluginPromise = import('@shikijs/rehype').then((mod: Record<string, unknown>) => {
      const plugin =
        (mod.default as unknown) ??
        (mod.rehypeShiki as unknown) ??
        (mod.rehypeShikiFromHighlighter as unknown);
      if (!plugin) throw new Error('Could not load @shikijs/rehype plugin');
      return plugin;
    });
  }
  return shikiPluginPromise;
}

/**
 * mdast -> hast. Shiki is lazy-loaded on first use and runs with its default
 * JavaScript RegExp engine; themes follow the system light/dark preference
 * via CSS variables (`--shiki-light` / `--shiki-dark`).
 */
export async function buildHast(tree: MdRoot): Promise<HastRoot> {
  const codeBlockIds: string[] = [];
  visit(tree, 'code', (node) => {
    const props = node.data?.hProperties as Record<string, unknown> | undefined;
    const id = props?.['data-block-id'];
    if (typeof id === 'string') codeBlockIds.push(id);
  });
  const rehypeShiki = await loadShikiPlugin();
  const processor = unified()
    .use(remarkRehype, { allowDangerousHtml: false })
    .use(rehypeShiki as never, {
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
      defaultLanguage: 'plaintext',
    })
    .use(rehypeBlockDirPlugin);
  const hast = (await processor.run(tree)) as HastRoot;
  let codeIndex = 0;
  visit(hast, 'element', (node) => {
    if (node.tagName !== 'pre') return;
    const id = codeBlockIds[codeIndex++];
    if (!id) return;
    const props = node.properties as Record<string, unknown>;
    props['data-block-id'] = id;
    props.dir = 'auto';
  });
  return hast;
}
