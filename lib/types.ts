// Shared types for ReadME.

import type { Lesson, Position } from './db/schema';

export type BlockType = 'heading' | 'paragraph' | 'listItem' | 'tableRow';

export type PlaybackState = 'idle' | 'playing' | 'paused';

export type StoredFile = Lesson;
export type SavedPosition = Position;

export interface Settings {
  voiceURI: string | null;
  /** 0.5 – 2, step 0.1 */
  rate: number;
  /** 0 – 2, step 0.1 */
  pitch: number;
  readInlineCode: boolean;
  readTables: boolean;
  readImageAlt: boolean;
  autoScroll: boolean;
  autoAdvanceFile: boolean;
  /** '' = auto (front matter / detection) */
  langOverride: string;
}

export const DEFAULT_SETTINGS: Settings = {
  voiceURI: null,
  rate: 1,
  pitch: 1,
  readInlineCode: true,
  readTables: true,
  readImageAlt: false,
  autoScroll: true,
  autoAdvanceFile: true,
  langOverride: '',
};

/** The subset of settings that changes what text is spoken. */
export const SPEECH_TEXT_KEYS = ['readInlineCode', 'readTables', 'readImageAlt'] as const;

export interface ToastItem {
  id: number;
  message: string;
  variant: 'success' | 'danger' | 'info' | 'warning';
}

/**
 * A segment of a block's spoken text. `textStart`/`textEnd` are indices in the
 * spoken text. For segments that are skipped (not spoken) the span is
 * zero-width (`textStart === textEnd`) and marks the position where the
 * skipped content sits in the spoken stream.
 */
export interface Segment {
  kind: 'text' | 'code' | 'image' | 'break' | 'sep' | 'math' | 'skip';
  /** The contributed spoken text ('' is possible for images without alt). */
  text: string;
  textStart: number;
  textEnd: number;
  /** DOM element kind expected during offset-map alignment. */
  expected?: 'code' | 'img' | 'br';
  /**
   * Offsets inside the mdast text node for 'text'/'math' segments, so the
   * segment can be aligned with the matching DOM text node.
   */
  domStart?: number;
  domEnd?: number;
  /** For 'sep' (cell/paragraph joiners): anchor at the start of the next segment. */
  anchorNext?: boolean;
  /** The mdast node this segment came from (used for DOM alignment). */
  node?: unknown;
}

export interface SpeakableBlock {
  /** Stable across re-parses: `ordinal-shortHash(fullText)`. */
  id: string;
  /** Ordinal of the block in the settings-independent walk. */
  ordinal: number;
  type: BlockType;
  /** Heading level (1-6) for headings. */
  depth?: number;
  /** The text that is spoken, after settings are applied. */
  text: string;
  segments: Segment[];
}

export interface HeadingEntry {
  id: string;
  depth: number;
  label: string;
}
