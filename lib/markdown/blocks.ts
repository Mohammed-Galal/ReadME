// The reading model: walks a parsed mdast tree into an ordered list of
// speakable blocks with settings-aware spoken text and alignment segments.

import type { Definition, Parent, PhrasingContent, Root, RootContent } from 'mdast';
import { toString } from 'mdast-util-to-string';
import type { HeadingEntry, Segment, Settings, SpeakableBlock } from '../types';

/** Inline math spans: `$...$` and `$$...$$`. We never speak math. */
const MATH_RE = /\$\$[\s\S]+?\$\$|\$(?!\$)[^$\n]+?\$/g;

function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36).padStart(7, '0');
}

export interface Candidate {
  /** Stable across re-parses: `ordinal-shortHash(fullText)`. */
  id: string;
  ordinal: number;
  type: SpeakableBlock['type'];
  depth?: number;
  /** Settings-independent full text (used for the TOC and the hash). */
  label: string;
  /** The mdast node this block was derived from. */
  node: Parent;
}

/**
 * Settings-independent walk over the tree. Runs before settings are applied
 * so block ids (and ordinals) never change when toggles are flipped.
 */
export function collectCandidates(tree: Root): {
  candidates: Candidate[];
  definitions: Map<string, Definition>;
} {
  const out: Candidate[] = [];
  const definitions = new Map<string, Definition>();

  const push = (node: Parent, type: Candidate['type'], depth?: number) => {
    const label = toString(node);
    const ordinal = out.length + 1;
    const id = `${ordinal}-${shortHash(label)}`;
    out.push({ id, ordinal, type, depth, label, node });
    // Stamp the mdast node so remark-rehype copies `data-block-id` onto the
    // matching hast element.
    const data = (node.data ??= {});
    const props = (data.hProperties ??= {});
    props['data-block-id'] = id;
  };

  const walk = (nodes: RootContent[]): void => {
    for (const node of nodes) {
      switch (node.type) {
        case 'heading':
          push(node, 'heading', node.depth);
          break;
        case 'paragraph':
          push(node, 'paragraph');
          break;
        case 'blockquote':
          walk(node.children);
          break;
        case 'list':
          for (const item of node.children) {
            push(item, 'listItem');
            for (const child of item.children) {
              if (child.type === 'list') walk([child]);
            }
          }
          break;
        case 'table':
          for (const row of node.children) push(row, 'tableRow');
          break;
        case 'definition':
          definitions.set(node.identifier, node);
          break;
        default:
          break;
      }
    }
  };

  walk(tree.children);

  // Code fences and blockquote wrappers render as text containers but are not
  // part of the speech model. Keep their ids in a separate namespace so the
  // persisted speakable ids above never move when these are introduced.
  let nonSpeakableOrdinal = 0;
  const stampNonSpeakable = (nodes: RootContent[]): void => {
    for (const node of nodes) {
      if (node.type === 'code' || node.type === 'blockquote') {
        const label = toString(node);
        const data = (node.data ??= {});
        const props = (data.hProperties ??= {});
        props['data-block-id'] = `c-${++nonSpeakableOrdinal}-${shortHash(label)}`;
      }
      if ('children' in node) stampNonSpeakable(node.children as RootContent[]);
    }
  };
  stampNonSpeakable(tree.children);
  return { candidates: out, definitions };
}

/** Extract `lang` / `language` from YAML front matter, if present. */
export function extractLang(tree: Root): string | null {
  for (const child of tree.children) {
    if (child.type === 'yaml') {
      const m = /^lang(?:uage)?\s*:\s*["']?([A-Za-z][A-Za-z0-9_-]*)["']?\s*$/m.exec(child.value);
      if (m) return m[1].toLowerCase();
    }
  }
  return null;
}

export function headingsFromCandidates(candidates: Candidate[]): HeadingEntry[] {
  return candidates
    .filter((c) => c.type === 'heading' && (c.depth ?? 0) >= 1 && (c.depth ?? 0) <= 4)
    .map((c) => ({ id: c.id, depth: c.depth ?? 1, label: c.label }));
}

class TextBuilder {
  text = '';
  segments: Segment[] = [];

  push(
    kind: Segment['kind'],
    value: string,
    opts: Omit<Segment, 'kind' | 'text' | 'textStart' | 'textEnd'> = {},
    counted = true,
  ): void {
    const start = this.text.length;
    const seg: Segment = {
      kind,
      text: value,
      textStart: start,
      textEnd: counted ? start + value.length : start,
      ...opts,
    };
    this.segments.push(seg);
    if (counted) this.text += value;
  }

  /** Joiner text (cell commas, paragraph spaces) anchored at the next segment. */
  join(value: string): void {
    this.push('sep', value, { anchorNext: true });
  }

  append(other: { text: string; segments: Segment[] }): void {
    this.segments.push(...other.segments);
    this.text += other.text;
  }
}

function inlineText(
  node: Parent,
  settings: Settings,
  definitions: Map<string, Definition>,
): { text: string; segments: Segment[] } {
  const b = new TextBuilder();

  const visit = (n: PhrasingContent): void => {
    switch (n.type) {
      case 'text': {
        const v = n.value;
        let last = 0;
        MATH_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = MATH_RE.exec(v))) {
          if (m.index > last) {
            b.push('text', v.slice(last, m.index), { node: n, domStart: last, domEnd: m.index });
          }
          b.push('math', m[0], { node: n, domStart: m.index, domEnd: m.index + m[0].length }, false);
          last = m.index + m[0].length;
        }
        if (last < v.length) b.push('text', v.slice(last), { node: n, domStart: last, domEnd: v.length });
        break;
      }
      case 'inlineCode':
        if (settings.readInlineCode) b.push('code', n.value, { node: n, expected: 'code' });
        else b.push('skip', n.value, { node: n, expected: 'code' }, false);
        break;
      case 'break':
        b.push('break', ' ', { node: n, expected: 'br' });
        break;
      case 'image':
        if (settings.readImageAlt) b.push('image', n.alt ?? '', { node: n, expected: 'img' });
        break;
      case 'imageReference': {
        if (settings.readImageAlt) {
          const d = definitions.get(n.identifier);
          b.push('image', d?.title ?? n.alt ?? '', { node: n, expected: 'img' });
        }
        break;
      }
      case 'link':
      case 'linkReference':
        for (const c of n.children) visit(c);
        break;
      case 'emphasis':
      case 'strong':
      case 'delete':
        for (const c of n.children) visit(c);
        break;
      case 'footnoteReference':
        // Never spoken.
        break;
      case 'html':
        // Raw HTML is stripped before rendering and never spoken.
        break;
      default:
        // Unknown phrasing node: safe fallback via mdast-util-to-string.
        b.push('text', toString(n as never), { node: n });
    }
  };

  for (const child of node.children) visit(child as PhrasingContent);
  return { text: b.text, segments: b.segments };
}

/** Builds the settings-dependent spoken text for one block node. */
function blockText(
  node: Parent,
  type: Candidate['type'],
  settings: Settings,
  definitions: Map<string, Definition>,
): { text: string; segments: Segment[] } {
  switch (type) {
    case 'heading':
    case 'paragraph':
      return inlineText(node, settings, definitions);
    case 'listItem': {
      // Own text only: nested lists are separate blocks.
      const b = new TextBuilder();
      let first = true;
      for (const child of node.children) {
        if (child.type === 'list' || !('children' in child)) continue;
        const part = inlineText(child as Parent, settings, definitions);
        if (!part.text.trim()) continue;
        if (!first) b.join(' ');
        b.append(part);
        first = false;
      }
      return { text: b.text, segments: b.segments };
    }
    case 'tableRow': {
      // Cells joined with commas.
      const b = new TextBuilder();
      let first = true;
      for (const cell of node.children) {
        const part = inlineText(cell as Parent, settings, definitions);
        if (!first) b.join(', ');
        b.append(part);
        first = false;
      }
      return { text: b.text, segments: b.segments };
    }
  }
}

export function buildBlocks(
  candidates: Candidate[],
  settings: Settings,
  definitions: Map<string, Definition>,
): SpeakableBlock[] {
  const blocks: SpeakableBlock[] = [];
  for (const c of candidates) {
    if (c.type === 'tableRow' && !settings.readTables) continue;
    const { text, segments } = blockText(c.node, c.type, settings, definitions);
    if (!text.trim()) continue; // nothing to say
    blocks.push({ id: c.id, ordinal: c.ordinal, type: c.type, depth: c.depth, text, segments });
  }
  return blocks;
}
