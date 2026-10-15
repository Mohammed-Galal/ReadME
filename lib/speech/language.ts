// Lightweight language detection by counting Unicode script characters.

const SCRIPTS: Array<[RegExp, string]> = [
  [/[\u3040-\u30ff]/g, 'ja'],
  [/[\uac00-\ud7af]/g, 'ko'],
  [/[\u4e00-\u9fff\u3400-\u4dbf]/g, 'zh'],
  [/[\u0e00-\u0e7f]/g, 'th'],
  [/[\u0590-\u05ff]/g, 'he'],
  [/[\u0600-\u06ff\u0750-\u077f]/g, 'ar'],
  [/[\u0900-\u097f]/g, 'hi'],
  [/[\u0400-\u04ff]/g, 'ru'],
  [/[\u0370-\u03ff]/g, 'el'],
];

function countMatches(text: string, re: RegExp): number {
  re.lastIndex = 0;
  const m = text.match(re);
  return m ? m.length : 0;
}

/**
 * Returns an ISO language code when a non-Latin script dominates the sample,
 * otherwise null (caller falls back to the default, e.g. 'en').
 */
export function detectLang(text: string): string | null {
  const sample = text.slice(0, 8000);
  const scored = SCRIPTS.map(([re, lang]) => ({ lang, n: countMatches(sample, re) })).sort(
    (a, b) => b.n - a.n,
  );
  const best = scored[0];
  const second = scored[1];
  if (!best || best.n < 8) return null;
  if (second && second.n >= best.n * 0.5) return null; // mixed scripts: ambiguous
  return best.lang;
}

/** Languages offered in the manual override select. */
export const LANGUAGE_OPTIONS: Array<{ code: string; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'ar', label: 'Arabic' },
  { code: 'zh', label: 'Chinese' },
  { code: 'nl', label: 'Dutch' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'el', label: 'Greek' },
  { code: 'he', label: 'Hebrew' },
  { code: 'hi', label: 'Hindi' },
  { code: 'it', label: 'Italian' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'pl', label: 'Polish' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'ru', label: 'Russian' },
  { code: 'es', label: 'Spanish' },
  { code: 'tr', label: 'Turkish' },
  { code: 'uk', label: 'Ukrainian' },
];
