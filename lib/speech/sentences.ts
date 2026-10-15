// Sentence splitting for speech utterances. Chrome can cut off very long
// utterances, so we split both at sentence boundaries and at a hard length cap.

export interface Sentence {
  text: string;
  /** Start offset of this sentence in the block's spoken text. */
  start: number;
}

const MAX_UTTERANCE_LEN = 200;
const SENTENCE_RE = /[^.!?…]+[.!?…]+["'»)\]]*(?:\s+|$)|[^.!?…]+$/g;

export function splitSentences(text: string): Sentence[] {
  const chunks: Sentence[] = [];
  let last = 0;
  SENTENCE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_RE.exec(text))) {
    const raw = m[0];
    addChunk(chunks, raw, last);
    last += raw.length;
  }
  if (last < text.length) addChunk(chunks, text.slice(last), last);
  return chunks;
}

function addChunk(chunks: Sentence[], raw: string, start: number): void {
  let rest = raw;
  let offset = 0;
  while (rest.length > MAX_UTTERANCE_LEN) {
    let cut = rest.lastIndexOf(' ', MAX_UTTERANCE_LEN);
    if (cut < MAX_UTTERANCE_LEN * 0.4) cut = rest.indexOf(' ', MAX_UTTERANCE_LEN);
    if (cut < 0) cut = MAX_UTTERANCE_LEN;
    const piece = rest.slice(0, cut + 1);
    if (piece.trim()) chunks.push({ text: piece, start: start + offset });
    offset += cut + 1;
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) chunks.push({ text: rest, start: start + offset });
}
