// Per-file parse cache. Each file is parsed once into an mdast tree; the
// speakable-block list is re-derived cheaply from cached candidates when the
// speech toggles change. The hast tree (with Shiki highlighting) is built
// once, from the same tree, and reused.

import type { Root as MdRoot } from 'mdast';
import type { Root as HastRoot } from 'hast';
import type { Definition } from 'mdast';
import type { HeadingEntry, Settings, SpeakableBlock } from '../types';
import {
  buildBlocks,
  collectCandidates,
  extractLang,
  headingsFromCandidates,
  type Candidate,
} from './blocks';
import { buildHast, parseMarkdown, stripNonRenderable } from './pipeline';

interface CacheEntry {
  content: string;
  /** Stripped tree (html/yaml removed) shared by blocks and hast. */
  tree: MdRoot;
  candidates: Candidate[];
  definitions: Map<string, Definition>;
  lang: string | null;
  hast: Promise<HastRoot> | null;
}

const cache = new Map<string, CacheEntry>();

export interface DocumentModel {
  blocks: SpeakableBlock[];
  headings: HeadingEntry[];
  lang: string | null;
  hast: Promise<HastRoot>;
}

export function getDocument(fileId: string, content: string, settings: Settings): DocumentModel {
  let entry = cache.get(fileId);
  if (!entry || entry.content !== content) {
    // Parse once: candidates are stamped with data-block-id on the mdast
    // nodes, then the same tree is stripped and used for the hast build.
    const tree = parseMarkdown(content);
    const { candidates, definitions } = collectCandidates(tree);
    const lang = extractLang(tree);
    stripNonRenderable(tree);
    entry = { content, tree, candidates, definitions, lang, hast: null };
    cache.set(fileId, entry);
    trimCache(fileId);
  }
  if (!entry.hast) entry.hast = buildHast(entry.tree);
  return {
    blocks: buildBlocks(entry.candidates, settings, entry.definitions),
    headings: headingsFromCandidates(entry.candidates),
    lang: entry.lang,
    hast: entry.hast,
  };
}

/** Keep the cache small: only the most recently used entries survive. */
function trimCache(keep: string): void {
  if (cache.size <= 6) return;
  const drop = [...cache.keys()].filter((k) => k !== keep).slice(0, cache.size - 6);
  for (const k of drop) cache.delete(k);
}

export function evictAllExcept(fileId: string | null): void {
  for (const key of cache.keys()) {
    if (key !== fileId) cache.delete(key);
  }
}

export function evictFile(fileId: string): void {
  cache.delete(fileId);
}
