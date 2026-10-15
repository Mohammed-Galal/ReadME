import { describe, expect, it } from 'vitest';
import { collectCandidates } from './blocks';
import { buildHast, parseMarkdown } from './pipeline';
import { visit } from 'unist-util-visit';
import type { Element } from 'hast';

describe('speakable block ids', () => {
  it('keeps the existing ids for the fixture markdown', () => {
    const tree = parseMarkdown([
      '# Heading',
      '',
      'A paragraph with **bold** text.',
      '',
      '- First item',
      '  - Nested item',
      '',
      '| Name | Value |',
      '| --- | --- |',
      '| Alpha | 1 |',
    ].join('\n'));

    const { candidates } = collectCandidates(tree);
    expect(candidates.map(({ id, type, label }) => ({ id, type, label }))).toMatchInlineSnapshot(`
      [
        {
          "id": "1-1xz14fp",
          "label": "Heading",
          "type": "heading",
        },
        {
          "id": "2-0lelxa6",
          "label": "A paragraph with bold text.",
          "type": "paragraph",
        },
        {
          "id": "3-1lxuu0m",
          "label": "First itemNested item",
          "type": "listItem",
        },
        {
          "id": "4-1ezur3x",
          "label": "Nested item",
          "type": "listItem",
        },
        {
          "id": "5-1krbufb",
          "label": "NameValue",
          "type": "tableRow",
        },
        {
          "id": "6-19sm5n2",
          "label": "Alpha1",
          "type": "tableRow",
        },
      ]
    `);
  });

  it('stamps rendered code with a separate non-speakable id', async () => {
    const tree = parseMarkdown('# Read this\n\n```js\nconst value = 1;\n```\n\n> A quote.');
    const { candidates } = collectCandidates(tree);
    const hast = await buildHast(tree);
    const blockIds: string[] = [];
    visit(hast, 'element', (node: Element) => {
      const id = node.properties['data-block-id'];
      if (typeof id === 'string') blockIds.push(id);
    });
    expect(candidates.map(({ id }) => id)).toEqual(['1-1vkmyvz', '2-00z8sq2']);
    expect(blockIds).toEqual([
      '1-1vkmyvz',
      expect.stringMatching(/^c-1-/),
      expect.stringMatching(/^c-2-/),
      '2-00z8sq2',
    ]);
  }, 15000);
});
