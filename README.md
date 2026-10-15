# ReadME

A privacy-first, client-side web tool that reads uploaded Markdown files aloud
using the browser's `speechSynthesis` API. It skips code blocks, lets you move
back and forth between paragraphs, and highlights the paragraph being read
(slightly) and the current word (heavily). **No backend â€” files never leave
the device.**

## Stack

- **Next.js 15** (App Router, TypeScript, React 19) + **Bootstrap 5** CSS with
  **react-bootstrap** components (Modal, Offcanvas, â€¦). All browser APIs
  (`window`, `speechSynthesis`, IndexedDB) are guarded so SSR stays safe.
- **unified / remark**: `remark-parse` â†’ `remark-frontmatter` â†’ `remark-gfm` â†’
  `remark-rehype` â†’ hast, rendered to React elements with
  `hast-util-to-jsx-runtime`.
- **Shiki** via `@shikijs/rehype`, lazy-loaded on first use, JavaScript RegExp
  engine, dual light/dark themes (`github-light` / `github-dark`) switched by
  the OS preference.
- **Zustand** store, **IndexedDB via `idb`** for files/positions, localStorage
  for settings.

## Getting started

```bash
npm install
npm run dev       # http://localhost:3000
npm run build     # production build (type-checked)
npm run start     # serve the production build

# headless Edge smoke tests (require `npm run start` on :3000):
npm run smoke       # main flow: upload, read, highlight, shortcuts, settings, persistence, delete
npm run smoke:edge  # quality bar: unsupported files, .txt, no headings, nothing-to-read, duplicates, RTL, missing TTS, auto-advance across files
npm run smoke:style # computed-style checks: highlight contrast, sticky navbar, scroll-margin, dark mode
```

## Folder structure

```
app/
  layout.tsx        # html shell, bootstrap CSS, system dark-theme script
  page.tsx          # renders <ReaderApp/>
  globals.css       # custom styles: highlights, sidebar, navbar, Shiki dark vars
  icon.svg
components/
  ReaderApp.tsx     # hydration, shortcut wiring, Phase 0 vs Phase 1
  Landing.tsx       # Phase 0: centered drop zone
  Sidebar.tsx       # desktop persistent + mobile Offcanvas, file list + delete
  TopNavbar.tsx     # floating navbar: toggle, brand, prev/play/next/settings
  MainContent.tsx   # TOC + rendered markdown + click-to-read delegation
  MarkdownView.tsx  # hast -> memoized React blocks (current-block class)
  TableOfContents.tsx
  SettingsModal.tsx # voice, speed, pitch, toggles, language override
  ConfirmDeleteModal.tsx
  JumpToCurrent.tsx # floating button while auto-scroll is suspended
  Toasts.tsx
lib/
  types.ts          # SpeakableBlock, Segment, Settings, StoredFile, ...
  utils.ts          # hashing, word chars, debounce, TTS support probe
  db/               # Typed IndexedDB schema, migration, and repositories
  settings.ts       # localStorage settings
  store.ts          # Zustand store + speech/highlight/scroll wiring
  offsetMap.ts      # spoken-text index <-> DOM Range
  highlight.ts      # imperative word highlight (Custom Highlight API + <mark>)
  scroller.ts       # auto-scroll + manual-scroll suspension
  shortcuts.ts      # Space / ArrowLeft / ArrowRight
  markdown/
    blocks.ts       # mdast walk -> candidates + settings-aware spoken text/segments
    pipeline.ts     # parse, strip, remark-rehype + Shiki, rehype dir plugin
    cache.ts        # per-file parse cache (mdast/hast reused across toggles)
  speech/
    controller.ts   # the one speech module: idle/playing/paused, tokens, boundaries
    sentences.ts    # sentence + max-length splitting (Chrome cutoff)
    voices.ts       # async voices loading, pickVoice by voiceURI
    language.ts     # lightweight script detector + override list
scripts/
  smoke.mjs         # end-to-end smoke test (headless Edge)
  smoke-edge.mjs    # edge-case / quality-bar tests
  smoke-style.mjs   # computed-style checks
```

## Data model

### Speakable block (the reading model's single source of truth)

```ts
interface SpeakableBlock {
  id: string;        // stable: `${ordinal}-${shortHash(fullText)}`
  ordinal: number;   // position in the settings-independent walk
  type: 'heading' | 'paragraph' | 'listItem' | 'tableRow';
  depth?: number;    // heading level
  text: string;      // the spoken text, after settings are applied
  segments: Segment[]; // alignment info: spoken text <-> DOM
}
```

- Speakable: headings, paragraphs (including inside blockquotes), list items
  (own text only; nested lists are separate blocks), table rows (cells joined
  with `, `). Never spoken: code blocks, front matter, raw HTML, math, the
  TOC, footnote references; links speak their text, never the URL.
- `id` is computed from an ordinal + a short FNV hash of the **settings-
  independent** full text, so ids (and saved positions) survive re-parses and
  toggle changes. Ordinals come from the same settings-independent walk, so
  muting tables never renumbers later blocks.
- `segments` describe how the spoken text maps onto the rendered DOM: copied
  text runs, skipped spans (inline code when muted, math), inserted text (cell
  separators, image alt), each with `textStart`/`textEnd` plus DOM anchoring
  data. `lib/offsetMap.ts` aligns these with the real text nodes/elements in a
  lockstep walk and resolves any spoken `charIndex` range to a DOM `Range`.

### Store shape (Zustand)

```ts
{
  hydrated, speechSupported,
  files: StoredFile[],              // { id, name, content, hash, date }
  positions: Map<fileId, SavedPosition>, // { fileId, blockId, charOffset, updatedAt }
  activeFileId, blocks, headings, docLang, detectedLang, hast,
  parsing, parseError,
  playback: 'idle'|'playing'|'paused', currentBlockId, resumeOffset,
  sidebarCollapsed, mobileSidebarOpen, settingsOpen, deleteTarget,
  autoScrollSuspended, toasts,
  settings: {
    voiceURI, rate (0.5â€“2), pitch (0â€“2),
    readInlineCode: true, readTables: true, readImageAlt: false,
    autoScroll: true, autoAdvanceFile: true, langOverride: ''
  }
}
```

### IndexedDB schema (idb, database readme-reader, v2)

Typed repositories store courses, ordered lessons, comments, lesson positions,
and app metadata. The v2 upgrade copies existing v1 files into a default My
lessons course and keeps the legacy files, positions, and meta stores intact.
New app code uses courses, lessons, comments, positions_v2, and meta_v2.

Settings live in localStorage (`readme.settings.v1`). On reload the library,
last-opened lesson, and its saved position are restored without auto-playing.

## Speech controller (one module: `lib/speech/controller.ts`)

States `idle | playing | paused`. Speaks one block at a time, split into
sentence utterances (max ~200 chars) to dodge Chrome's long-utterance cutoff.
Every utterance is tagged with an incrementing generation token; `cancel()`
bumps the generation so stale `end`/`error` events are ignored and skipping
never double-advances. Pause = cancel + remember block + char offset (snapped
back to the word start); resume re-speaks the remainder â€” the same path
applies voice/rate/pitch changes live. Word tracking uses `boundary` events
(`charIndex`); a character-rate estimate takes over if none arrives within
~1 s. Voices load via `voiceschanged`, are stored by `voiceURI` with a
language-matching fallback. Language = manual override â†’ front-matter `lang`
â†’ script-based detector.

## Deviations from the spec (flagged)

1. **`data-block-id` stamping point** â€” ids are stamped at the *remark* stage
   via the canonical `node.data.hProperties` mechanism (that is the only stage
   that still knows which mdast node an id belongs to); the rehype plugin adds
   `dir="auto"` to stamped elements (and sets `loading="lazy"` /
   `referrerpolicy="no-referrer"` on images for privacy). Same DOM result.
2. **Math** â€” the mandated stack has no math plugin, so math renders as plain
   text; the speech builder strips `$â€¦$` / `$$â€¦$$` spans so math is still
   never spoken.
3. **Theme** â€” light/dark follows `prefers-color-scheme` (Shiki vars and
   Bootstrap 5.3's `data-bs-theme`); the settings modal lists no theme toggle
   in the spec, so none was added.
4. **Raw HTML** â€” fully stripped (`allowDangerousHtml: false`), matching the
   spec's "isn't rendered" option.
5. **Auto-scroll resume** â€” in addition to the spec's two triggers (the
   "Jump to current" button, clicking a block), explicit navigation
   (play/prev/next/TOC) also re-arms auto-scroll, so playback isn't left
   visually orphaned after the user acted on a control.
6. **Deletion of non-active files** while playing another file doesn't stop
   speech (the spec only requires stopping when the file *being read* is
   deleted).
7. **Blockquote** is not a block itself â€” its inner paragraphs are (per the
   spec's "paragraphs (including in blockquotes)" wording).
8. **`pause()`/`resume()` of `speechSynthesis`** are never used â€” pause is
   cancel + resume-from-offset, per the spec's own flakiness note.
