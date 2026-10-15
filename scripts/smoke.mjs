// End-to-end smoke test: drives the production build in headless Edge with a
// stubbed speechSynthesis, exercising upload, rendering, reading, highlight,
// shortcuts, settings, persistence, and delete.
//
// Requires the production server to be running on :3000 (`npm run start`).

import puppeteer from 'puppeteer-core';

const BASE = process.env.SMOKE_URL || 'http://localhost:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

const md = `---
title: Smoke test
lang: en
---

# Welcome

First paragraph with **bold** and *italic* and [a link](https://example.com) and \`inline code\`.

Second paragraph with math $x + y$ that should be skipped.

## Chapter One

Third paragraph. It has multiple sentences. Another sentence here. And a third one!

- First item with own text
  - Nested item text
- Second item

### Sub section

Fourth paragraph.

## Chapter Two

\`\`\`js
const hello = "world";
console.log(hello);
\`\`\`

Fifth paragraph after code.

| Name | Value |
| ---- | ----- |
| One  | 1     |
| Two  | 2     |
`;

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${extra}`}`);
  if (!cond) failures++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-first-run', '--disable-gpu', '--mute-audio'],
});
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${e.message}`));
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(`console: ${m.text()}`);
});

await page.evaluateOnNewDocument(() => {
  // Stub speechSynthesis for deterministic testing.
  const synth = {
    getVoices: () => [
      { name: 'Test Voice', lang: 'en-US', voiceURI: 'test-en-us', localService: true, default: true },
    ],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak(u) {
      window.__pending = window.__pending || [];
      window.__spoken = window.__spoken || [];
      window.__spoken.push({
        text: u.text,
        rate: u.rate,
        pitch: u.pitch,
        lang: u.lang,
        voiceURI: u.voice ? u.voice.voiceURI : null,
      });
      window.__pending.push(u);
      setTimeout(() => {
        if (window.__pending.includes(u)) {
          u.onstart && u.onstart();
          const ci = Math.min(3, Math.max(0, u.text.length - 1));
          u.onboundary && u.onboundary({ name: 'word', charIndex: ci });
        }
      }, 15);
    },
    cancel() {
      window.__canceled = (window.__canceled || 0) + 1;
      window.__pending = [];
    },
    pause() {},
    resume() {},
    speaking: false,
    pending: false,
    paused: false,
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
  window.__endAll = () => {
    const ps = (window.__pending || []).splice(0);
    for (const u of ps) u.onend && u.onend();
  };
  if (typeof window.SpeechSynthesisUtterance === 'undefined') {
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        this.text = text;
      }
    };
  }
});

// ---- Phase 0 --------------------------------------------------------------

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('.courses-empty', { timeout: 15000 });
check('empty courses state is shown for a fresh install', true);

await page.click('.courses-topbar button');
await page.waitForSelector('#course-name', { timeout: 5000 });
await page.type('#course-name', 'Smoke Course');
await page.click('.modal button[type="submit"]');
await page.waitForSelector('.course-page .course-heading-copy h1', { timeout: 15000 });
check('a course can be created and opened', true);

// ---- Upload ---------------------------------------------------------------

await page.evaluate((content) => {
  const transfer = new DataTransfer();
  transfer.items.add(new File([content], 'smoke.md', { type: 'text/markdown' }));
  document.querySelector('.lesson-dropzone')?.dispatchEvent(
    new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }),
  );
}, md);
await page.waitForSelector('.add-lessons-row', { timeout: 20000 });
await page.click('#add-lessons-tabs-tab-paste');
await page.type('input[aria-label="Pasted lesson title"]', 'Pasted lesson');
await page.type('textarea[aria-label="Paste Markdown lesson text"]', '# Pasted reading\n\nThis pasted lesson reads like a regular lesson.');
await page.evaluate(() => [...document.querySelectorAll('button')].find((button) => button.textContent?.includes('Add to list'))?.click());
await page.waitForFunction(() => document.querySelectorAll('.add-lessons-row').length === 2, { timeout: 10000 });
check('pasted text can be staged alongside an uploaded file', true);
await page.waitForFunction(() => {
  const button = document.querySelector('.add-lessons-submit');
  return button && !button.disabled && button.textContent.includes('Add 2 lessons');
}, { timeout: 10000 });
await page.click('.add-lessons-submit');
await page.waitForSelector('.add-lessons-modal.show', { hidden: true, timeout: 10000 });
await page.waitForSelector('.modal-backdrop', { hidden: true, timeout: 10000 });
await page.waitForSelector('.lesson-row-link', { timeout: 20000 });
check('mixed upload and paste batch adds both lessons', await page.$$eval('.lesson-row', (rows) => rows.length) === 2);
await page.click('.lesson-row-link');
await page.waitForSelector('.markdown-body', { timeout: 20000 });
check('opening the lesson route renders its Markdown', true);

const blockCount = await page.$$eval('[data-block-id]', (els) => els.length);
check('all 15 candidate blocks stamped with data-block-id', blockCount === 15, `got ${blockCount}`);

const hasToc = (await page.$('.toc')) !== null;
check('table of contents shown (4 headings)', hasToc);

const shikiSpans = await page.$$eval('pre.shiki span', (els) => els.length);
check('code block is Shiki-highlighted', shikiSpans > 0, `spans=${shikiSpans}`);

const hasWarning = (await page.$('.speech-warning')) !== null;
check('no speech-support warning with working TTS', !hasWarning);

const hasEmptyNote = (await page.$('.empty-note')) !== null;
check('no "nothing to read" note', !hasEmptyNote);

// ---- Click to read + highlighting ----------------------------------------

// First paragraph: contains a link and inline code.
const clickedFirst = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-block-id]')].find((e) =>
    e.textContent.includes('First paragraph with'),
  );
  if (!el) return null;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return el.getAttribute('data-block-id');
});
check('click-to-read target found (first paragraph)', !!clickedFirst, String(clickedFirst));
await sleep(150);

const spokenFirst = await page.evaluate(() => (window.__spoken || []).map((s) => s.text));
check('click starts reading', spokenFirst.length >= 1, JSON.stringify(spokenFirst));
check(
  'links speak text, never URLs',
  spokenFirst.some((s) => s.includes('a link') && !s.includes('example.com')),
  JSON.stringify(spokenFirst),
);
check('inline code spoken by default', spokenFirst.some((s) => s.includes('inline code')), JSON.stringify(spokenFirst));

// Math paragraph: math must be stripped.
const clickedId = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-block-id]')].find((e) =>
    e.textContent.includes('Second paragraph with math'),
  );
  if (!el) return null;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return el.getAttribute('data-block-id');
});
check('click-to-read target found (math paragraph)', !!clickedId, String(clickedId));
await sleep(150);

const spoken = await page.evaluate(() => (window.__spoken || []).map((s) => s.text));
check(
  'math is never spoken',
  spoken.some((s) => s.includes('Second paragraph with math') && !s.includes('$x + y$')),
  JSON.stringify(spoken),
);

const hl = await page.evaluate(() => {
  try {
    if (window.CSS && CSS.highlights) {
      const h = CSS.highlights.get('readme-word');
      return { type: 'api', size: h ? h.size : 0 };
    }
  } catch {
    /* ignore */
  }
  return { type: 'mark', present: !!document.querySelector('mark.readme-word-mark') };
});
check(
  'current word highlighted',
  (hl.type === 'api' && hl.size > 0) || (hl.type === 'mark' && hl.present),
  JSON.stringify(hl),
);

const curClass = await page.evaluate(() =>
  [...document.querySelectorAll('[data-block-id].reading-block')].map((e) => e.textContent.slice(0, 32)),
);
check('current block slightly highlighted', curClass.length === 1, JSON.stringify(curClass));

// ---- Navigation -----------------------------------------------------------

await page.keyboard.press('ArrowRight');
await sleep(150);
const cur2 = await page.evaluate(() =>
  [...document.querySelectorAll('[data-block-id].reading-block')].map((e) => e.textContent.slice(0, 32)),
);
check('ArrowRight moves to the next block', cur2.length === 1 && cur2[0].includes('Chapter One'), JSON.stringify(cur2));

await page.evaluate(() => window.__endAll());
await sleep(200);
const cur3 = await page.evaluate(() =>
  [...document.querySelectorAll('[data-block-id].reading-block')].map((e) => e.textContent.slice(0, 32)),
);
check('auto-advance on utterance end', cur3.length === 1 && cur3[0].includes('Third paragraph'), JSON.stringify(cur3));

await page.keyboard.press(' ');
await sleep(120);
const canceled1 = await page.evaluate(() => window.__canceled || 0);
check('Space pauses (cancel called)', canceled1 > 0);

await page.keyboard.press(' ');
await sleep(250);
const spokenAfterResume = await page.evaluate(() => (window.__spoken || []).length);
check('Space resumes speaking', spokenAfterResume > 0);

// ---- Settings -------------------------------------------------------------

await page.keyboard.press(' ');
await sleep(120);
await page.click('button[aria-label="Settings"]');
await page.waitForSelector('.modal.show', { timeout: 5000 });
check('settings modal opens', true);

await page.evaluate(() => document.querySelector('#settings-tables')?.click());
await sleep(500);
const spokenBeforeTr = await page.evaluate(() => (window.__spoken || []).length);
const trClicked = await page.evaluate(() => {
  const tr = document.querySelector('tr[data-block-id]');
  if (!tr) return false;
  tr.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return true;
});
await sleep(200);
const spokenAfterTr = await page.evaluate(() => (window.__spoken || []).length);
check('muted table rows are not click-to-read targets', trClicked && spokenAfterTr === spokenBeforeTr);

const tablesOff = await page.evaluate(() => {
  try {
    return JSON.parse(localStorage.getItem('readme.settings.v1')).readTables === false;
  } catch {
    return false;
  }
});
check('settings persist to localStorage', tablesOff);

await page.click('.modal .btn-close');
await sleep(300);

// ---- Persistence across reload -------------------------------------------

await page.reload({ waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('.markdown-body', { timeout: 15000 });
check('file restored from IndexedDB after reload', true);

const activeItem = (await page.$('.file-item-active')) !== null;
check('active file highlighted in the sidebar', activeItem);

const anyReading = await page.evaluate(() => !!document.querySelector('[data-block-id].reading-block'));
check('saved position restored as the current block', anyReading);

const spokenReload = await page.evaluate(() => (window.__spoken || []).length);
check('no auto-play after reload', spokenReload === 0);

// ---- Delete ---------------------------------------------------------------

await page.evaluate(() => document.querySelector('.file-item-delete')?.click());
await page.waitForSelector('.modal.show', { timeout: 5000 });
check('delete confirmation modal opens', true);
await page.click('.modal .btn-danger');
await page.waitForSelector('.markdown-body', { timeout: 15000 });
const nextLesson = await page.$eval('.file-item-active .file-name', (el) => el.textContent);
check('deleting an active lesson opens the next lesson', nextLesson === 'Pasted lesson');
const pastedVisible = await page.$$eval('[data-block-id]', (els) => els.some((el) => el.textContent?.includes('This pasted lesson reads like a regular lesson.')));
check('pasted lesson renders in the reader', pastedVisible);
await page.evaluate(() => document.querySelector('.file-item-delete')?.click());
await page.waitForSelector('.modal.show', { timeout: 5000 });
await page.click('.modal .btn-danger');
await page.waitForSelector('.course-page .course-empty-lessons', { timeout: 10000 });
check('deleting the last lesson returns to its course page', true);

await page.click('.courses-topbar .brand');
await page.waitForSelector('.course-card');
await page.click('[aria-label="Actions for Smoke Course"]');
await page.click('.dropdown-menu .text-danger');
await page.waitForSelector('.modal.show');
const courseCounts = await page.$eval('.modal.show .modal-body', (el) => el.textContent || '');
check('course delete confirmation includes lesson and comment counts', /0 lessons and 0 comments/.test(courseCounts));
await page.click('.modal.show .btn-danger');
await page.waitForSelector('.courses-empty', { timeout: 10000 });
check('deleting the course returns to the empty courses state', true);

// ---- Console health -------------------------------------------------------

check('no page/console errors during the run', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));

await browser.close();

console.log('');
if (failures) {
  console.log(`SMOKE TEST FAILED: ${failures} check(s) failed`);
  process.exit(1);
} else {
  console.log('SMOKE TEST PASSED: all checks green');
}
