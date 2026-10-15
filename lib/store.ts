// Global Zustand store: app state, actions, and the wiring between the
// speech controller, highlighting, scrolling, and persistence.

import { create } from 'zustand';
import type { Root as HastRoot } from 'hast';
import { evictAllExcept, evictFile, getDocument } from './markdown/cache';
import {
  deleteLesson,
  getPosition,
  listLessons,
  savePosition as persistPosition,
  setLastOpened,
  setMeta,
} from './db/repositories';
import { getLessonAfterDelete, getNextLesson } from './lessonNavigation';
import { clearAll, clearWord, setBlocks as setHighlightBlocks, updateWord as updateWordHighlight } from './highlight';
import { checkWordVisible, initScroller, resumeAutoScroll, scrollToBlock } from './scroller';
import { detectLang } from './speech/language';
import { SpeechController } from './speech/controller';
import { loadSettings, saveSettings } from './settings';
import {
  SPEECH_TEXT_KEYS,
  type HeadingEntry,
  type PlaybackState,
  type SavedPosition,
  type Settings,
  type SpeakableBlock,
  type StoredFile,
  type ToastItem,
} from './types';
import { debounce, isSpeechSupported } from './utils';

interface StoreState {
  // lifecycle
  hydrated: boolean;
  speechSupported: boolean;
  // library
  files: StoredFile[];
  positions: Map<string, SavedPosition>;
  activeCourseId: string | null;
  activeFileId: string | null;
  // active document
  blocks: SpeakableBlock[];
  headings: HeadingEntry[];
  docLang: string | null;
  detectedLang: string | null;
  hast: HastRoot | null;
  parsing: boolean;
  parseError: string | null;
  // playback
  playback: PlaybackState;
  currentBlockId: string | null;
  resumeOffset: number;
  // ui
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  settingsOpen: boolean;
  autoScrollSuspended: boolean;
  toasts: ToastItem[];
  unresolvedCommentIds: Set<string>;
  settings: Settings;

  openLesson(courseId: string, id: string, lessons: StoredFile[], opts?: { autoPlay?: boolean }): Promise<void>;
  refreshReaderLessons(courseId: string): Promise<void>;
  deleteReaderLesson(id: string): Promise<string | null>;
  stopReader(): void;
  setCurrentBlock(blockId: string, opts?: { charOffset?: number; scroll?: boolean; restartSpeech?: boolean }): void;
  playFromBlock(blockId: string): void;
  playPause(): void;
  nextBlock(): void;
  prevBlock(): void;
  updateSettings(partial: Partial<Settings>): Promise<void>;
  setSettingsOpen(open: boolean): void;
  toggleSidebar(): void;
  setMobileSidebarOpen(open: boolean): void;
  toast(message: string, variant?: ToastItem['variant']): void;
  dismissToast(id: number): void;
  setUnresolvedCommentIds(ids: Set<string>): void;
  savePosition(blockId: string, charOffset: number): void;
  flushPosition(): void;
  handleFileFinished(fileId: string): Promise<void>;
  recomputeBlocks(): Promise<void>;
}

let speechController: SpeechController | null = null;
let toastSeq = 0;
let routeNavigation: ((lessonId: string, autoPlay: boolean) => void) | null = null;
let autoPlayLessonId: string | null = null;
let routeLoadSequence = 0;

export function connectReaderNavigation(navigate: (lessonId: string, autoPlay: boolean) => void): () => void {
  routeNavigation = navigate;
  return () => { if (routeNavigation === navigate) routeNavigation = null; };
}

export function consumeAutoPlayLesson(lessonId: string): boolean {
  if (autoPlayLessonId !== lessonId) return false;
  autoPlayLessonId = null;
  return true;
}

const debouncedPositionWrite = debounce((pos: SavedPosition) => {
  void persistPosition(pos);
}, 800);

export function initSpeechAndScroller(): void {
  if (speechController) return;
  speechController = new SpeechController({
    getContext: () => {
      const s = useStore.getState();
      return {
        fileId: s.activeFileId,
        blocks: s.blocks,
        settings: s.settings,
        docLang: s.docLang,
        detectedLang: s.detectedLang,
      };
    },
    onState: (state) => useStore.setState({ playback: state }),
    onBlock: (blockId) => {
      const s = useStore.getState();
      if (s.currentBlockId !== blockId) useStore.setState({ currentBlockId: blockId, resumeOffset: 0 });
      scrollToBlock(blockId);
    },
    onWord: (blockId, start, end) => {
      updateWordHighlight(blockId, start, end);
      checkWordVisible(blockId, start, end);
    },
    onPosition: (blockId, charOffset) => useStore.getState().savePosition(blockId, charOffset),
    onFileFinished: (fileId) => void useStore.getState().handleFileFinished(fileId),
    onError: (message) => useStore.getState().toast(message, 'danger'),
  });
  initScroller({
    isPlaying: () => useStore.getState().playback === 'playing',
    autoScrollOn: () => useStore.getState().settings.autoScroll,
    currentBlockId: () => useStore.getState().currentBlockId,
    setSuspended: (v) => useStore.setState({ autoScrollSuspended: v }),
  });
}

export const useStore = create<StoreState>()((set, get) => ({
  hydrated: false,
  speechSupported: false,
  files: [],
  positions: new Map(),
  activeCourseId: null,
  activeFileId: null,
  blocks: [],
  headings: [],
  docLang: null,
  detectedLang: null,
  hast: null,
  parsing: false,
  parseError: null,
  playback: 'idle',
  currentBlockId: null,
  resumeOffset: 0,
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  settingsOpen: false,
  autoScrollSuspended: false,
  toasts: [],
  unresolvedCommentIds: new Set(),
  settings: loadSettings(),

  async openLesson(courseId, id, lessons, opts) {
    initSpeechAndScroller();
    const target = lessons.find((lesson) => lesson.id === id && lesson.courseId === courseId)
    if (!target) return
    const token = ++routeLoadSequence
    const previous = get()
    const changingCourse = previous.activeCourseId !== courseId
    const switchingLesson = previous.activeFileId !== id
    if (switchingLesson || changingCourse) get().flushPosition()
    if ((switchingLesson || changingCourse) && !opts?.autoPlay) {
      speechController?.stop()
      clearWord()
    }
    if (opts?.autoPlay) speechController?.stop()
    set({
      hydrated: true,
      speechSupported: isSpeechSupported(),
      activeCourseId: courseId,
      files: lessons,
      activeFileId: id,
      parsing: true,
      parseError: null,
      autoScrollSuspended: false,
    })
    if (changingCourse) set({ positions: new Map() })
    evictAllExcept(id)
    void setLastOpened({ courseId, lessonId: id })
    try {
      const pos = await getPosition(id)
      if (token !== routeLoadSequence) return
      const positions = new Map(changingCourse ? [] : get().positions)
      if (pos) positions.set(id, pos)
      else positions.delete(id)
      set({ positions })
      const doc = getDocument(id, target.content, get().settings)
      const hast = await doc.hast
      if (token !== routeLoadSequence) return
      const validSaved = pos?.blockId && doc.blocks.some((block) => block.id === pos.blockId) ? pos.blockId : null
      const currentBlockId = validSaved ?? doc.blocks[0]?.id ?? null
      const resumeOffset = validSaved ? Math.max(0, pos!.charOffset) : 0
      set({
        blocks: doc.blocks,
        headings: doc.headings,
        docLang: doc.lang,
        detectedLang: detectLang(target.content),
        hast,
        parsing: false,
        currentBlockId,
        resumeOffset,
      })
      setHighlightBlocks(doc.blocks)
      speechController?.seek(currentBlockId, resumeOffset)
      if (opts?.autoPlay && currentBlockId) speechController?.playFrom(currentBlockId, 0)
      else if (currentBlockId) scrollToBlock(currentBlockId, { force: true, instant: true })
    } catch (err) {
      if (token !== routeLoadSequence) return
      set({ parsing: false, parseError: err instanceof Error ? err.message : String(err) })
      get().toast('Could not parse this file.', 'danger')
    }
  },

  async refreshReaderLessons(courseId) {
    if (get().activeCourseId !== courseId) return
    set({ files: await listLessons(courseId) })
  },

  async deleteReaderLesson(id) {
    const { files, activeFileId, activeCourseId } = get()
    const lesson = files.find((item) => item.id === id)
    if (!lesson || !activeCourseId) return null
    const next = id === activeFileId ? getLessonAfterDelete(id, files) : null
    if (id === activeFileId) {
      get().flushPosition()
      speechController?.stop()
      clearWord()
      set({ activeFileId: null, parsing: false, playback: 'idle', currentBlockId: null, resumeOffset: 0 })
      clearAll()
    }
    await deleteLesson(id)
    evictFile(id)
    const positions = new Map(get().positions)
    positions.delete(id)
    set({ files: files.filter((item) => item.id !== id), positions })
    return next?.id ?? null
  },

  stopReader() {
    routeLoadSequence++
    get().flushPosition()
    speechController?.stop()
    clearAll()
    evictAllExcept('')
    autoPlayLessonId = null
    set({ activeCourseId: null, activeFileId: null, files: [], positions: new Map(), blocks: [], headings: [], docLang: null, detectedLang: null, hast: null, parsing: false, parseError: null, playback: 'idle', currentBlockId: null, resumeOffset: 0, settingsOpen: false, mobileSidebarOpen: false, autoScrollSuspended: false })
  },
  setCurrentBlock(blockId, opts) {
    const { blocks } = get();
    const block = blocks.find((b) => b.id === blockId);
    if (!block) return;
    const charOffset = Math.max(0, opts?.charOffset ?? 0);
    if (get().currentBlockId !== blockId) set({ currentBlockId: blockId, resumeOffset: charOffset });
    else set({ resumeOffset: charOffset });
    if (opts?.restartSpeech && speechController) {
      speechController.playFrom(blockId, charOffset);
    } else {
      speechController?.seek(blockId, charOffset);
    }
    if (opts?.scroll !== false) scrollToBlock(blockId);
  },

  playFromBlock(blockId) {
    const s = get();
    if (!s.speechSupported) {
      s.toast('Text-to-speech is not supported in this browser.', 'warning');
      s.setCurrentBlock(blockId);
      return;
    }
    resumeAutoScroll();
    s.setCurrentBlock(blockId, { restartSpeech: true });
  },

  playPause() {
    const s = get();
    if (!s.speechSupported) {
      s.toast('Text-to-speech is not supported in this browser.', 'warning');
      return;
    }
    if (!s.activeFileId || !s.blocks.length) return;
    resumeAutoScroll();
    speechController?.toggle();
  },

  nextBlock() {
    const s = get();
    if (!s.blocks.length) return;
    const idx = s.currentBlockId ? s.blocks.findIndex((b) => b.id === s.currentBlockId) : -1;
    const targetIdx = idx < 0 ? 0 : Math.min(s.blocks.length - 1, idx + 1);
    if (targetIdx === idx) return;
    resumeAutoScroll();
    s.setCurrentBlock(s.blocks[targetIdx].id, { restartSpeech: s.playback === 'playing' });
  },

  prevBlock() {
    const s = get();
    if (!s.blocks.length) return;
    const idx = s.currentBlockId ? s.blocks.findIndex((b) => b.id === s.currentBlockId) : -1;
    const targetIdx = idx <= 0 ? 0 : idx - 1;
    if (targetIdx === idx) return;
    resumeAutoScroll();
    s.setCurrentBlock(s.blocks[targetIdx].id, { restartSpeech: s.playback === 'playing' });
  },

  async updateSettings(partial) {
    const prev = get().settings;
    const next: Settings = { ...prev, ...partial };
    saveSettings(next);
    const textChanged = SPEECH_TEXT_KEYS.some((k) => k in partial && prev[k] !== next[k]);
    set({ settings: next });
    if (textChanged) {
      await get().recomputeBlocks();
    } else if (get().playback === 'playing') {
      speechController?.applySettings();
    }
  },

  setSettingsOpen(open) {
    set({ settingsOpen: open });
  },

  toggleSidebar() {
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 992px)').matches) {
      const v = !get().sidebarCollapsed;
      set({ sidebarCollapsed: v });
      void setMeta('sidebarCollapsed', v);
    } else {
      set({ mobileSidebarOpen: true });
    }
  },

  setMobileSidebarOpen(open) {
    set({ mobileSidebarOpen: open });
  },

  toast(message, variant = 'info') {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, message, variant }] }));
    const ttl = variant === 'danger' ? 6000 : 4000;
    setTimeout(() => get().dismissToast(id), ttl);
  },

  dismissToast(id) {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },

  setUnresolvedCommentIds(ids) {
    const current = get().unresolvedCommentIds;
    if (current.size === ids.size && [...current].every((id) => ids.has(id))) return;
    set({ unresolvedCommentIds: new Set(ids) });
  },

  savePosition(blockId, charOffset) {
    const fileId = get().activeFileId;
    if (!fileId) return;
    const pos: SavedPosition = { lessonId: fileId, blockId, charOffset, updatedAt: Date.now() };
    set((s) => {
      const positions = new Map(s.positions);
      positions.set(fileId, pos);
      return { positions, resumeOffset: charOffset };
    });
    debouncedPositionWrite(pos);
  },

  flushPosition() {
    const { activeFileId, positions } = get();
    debouncedPositionWrite.cancel();
    if (activeFileId && positions.has(activeFileId)) {
      void persistPosition(positions.get(activeFileId)!);
    }
  },

  async handleFileFinished(fileId) {
    const { settings, files, activeFileId } = get();
    if (fileId !== activeFileId) return;
    const next = getNextLesson(fileId, files, settings.autoAdvanceFile);
    if (next && routeNavigation) {
      autoPlayLessonId = next.id;
      routeNavigation(next.id, true);
    } else {
      clearWord();
      get().toast('Finished reading.', 'info');
    }
  },

  // internal, not part of the public interface above
  async recomputeBlocks() {
    const { activeFileId, files, settings, currentBlockId } = get();
    const file = files.find((f) => f.id === activeFileId);
    if (!file) return;
    const doc = getDocument(file.id, file.content, settings);
    const hast = await doc.hast;
    let nextBlockId = currentBlockId;
    if (!currentBlockId || !doc.blocks.some((b) => b.id === currentBlockId)) {
      const ord = currentBlockId ? parseInt(currentBlockId, 10) : 0;
      const fallback =
        doc.blocks.find((b) => b.ordinal > (Number.isNaN(ord) ? 0 : ord)) ?? doc.blocks[doc.blocks.length - 1];
      nextBlockId = fallback?.id ?? null;
    }
    set({ blocks: doc.blocks, headings: doc.headings, hast, currentBlockId: nextBlockId });
    setHighlightBlocks(doc.blocks);
    speechController?.resync(nextBlockId, get().resumeOffset);
  },
}));
