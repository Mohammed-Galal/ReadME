// Settings persistence in localStorage (client-only).

import { DEFAULT_SETTINGS, type Settings } from './types';

const KEY = 'readme.settings.v1';

export function loadSettings(): Settings {
  const defaults = { ...DEFAULT_SETTINGS };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...defaults, ...parsed };
    // Validate numeric ranges.
    if (typeof merged.rate !== 'number' || Number.isNaN(merged.rate)) merged.rate = defaults.rate;
    merged.rate = Math.min(2, Math.max(0.5, Math.round(merged.rate * 10) / 10));
    if (typeof merged.pitch !== 'number' || Number.isNaN(merged.pitch)) merged.pitch = defaults.pitch;
    merged.pitch = Math.min(2, Math.max(0, Math.round(merged.pitch * 10) / 10));
    if (typeof merged.voiceURI !== 'string') merged.voiceURI = null;
    if (typeof merged.langOverride !== 'string') merged.langOverride = '';
    for (const key of [
      'readInlineCode',
      'readTables',
      'readImageAlt',
      'autoScroll',
      'autoAdvanceFile',
    ] as const) {
      if (typeof merged[key] !== 'boolean') merged[key] = defaults[key];
    }
    return merged;
  } catch {
    return defaults;
  }
}

export function saveSettings(settings: Settings): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable (private mode etc.) — settings just won't persist.
  }
}
