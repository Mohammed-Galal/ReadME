// Edge-case smoke checks for course-based uploads and route readers.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const check = (name, condition, extra = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  ${extra}`}`);
  if (!condition) failures++;
};
const stubSpeech = (enabled) => {
  if (!enabled) return () => Object.defineProperty(window, 'speechSynthesis', { value: undefined, configurable: true });
  return () => {
    const synth = {
      getVoices: () => [], addEventListener: () => {}, removeEventListener: () => {},
      speak(utterance) {
        window.__pending ??= [];
        window.__spoken ??= [];
        window.__spoken.push({ text: utterance.text });
        window.__pending.push(utterance);
        setTimeout(() => {
          if (window.__pending.includes(utterance)) {
            utterance.onstart?.();
            utterance.onboundary?.({ name: 'word', charIndex: Math.min(3, Math.max(0, utterance.text.length - 1)) });
          }
        }, 15);
      },
      cancel() { window.__pending = []; }, pause() {}, resume() {},
    };
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    window.__endAll = () => {
      const pending = (window.__pending || []).splice(0);
      for (const utterance of pending) utterance.onend?.();
    };
  };
};
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--disable-gpu'] });
async function scenario(enabled = true) {
  const context = await browser.createBrowserContext();
  const page = await context.newPage();
  await page.setViewport({ width: 1280, height: 800 });
  await page.evaluateOnNewDocument(stubSpeech(enabled));
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.courses-empty, .course-card', { timeout: 15000 });
  await page.click('.courses-topbar button');
  await page.waitForSelector('#course-name', { timeout: 5000 });
  await page.type('#course-name', 'Smoke Course');
  await page.click('.modal button[type="submit"]');
  await page.waitForSelector('.course-page', { timeout: 15000 });
  return { page, close: () => context.close() };
}
async function upload(page, ...files) {
  await page.click('.course-detail-heading button');
  await page.waitForSelector('.add-lessons-modal.show', { timeout: 5000 });
  const input = await page.$('input[aria-label="Choose Markdown lesson files"]');
  await input.uploadFile(...files);
  await page.waitForFunction((count) => document.querySelectorAll('.add-lessons-row').length === count, { timeout: 15000 }, files.length);
  const readyCount = await page.$$eval('.add-lessons-row-copy span', (rows) => rows.filter((row) => /· Ready$/.test(row.textContent || '')).length);
  if (readyCount) {
    await page.waitForFunction(() => !document.querySelector('.add-lessons-submit')?.disabled, { timeout: 10000 });
    await page.click('.add-lessons-submit');
    await page.waitForFunction(() => !document.querySelector('.add-lessons-modal.show'), { timeout: 15000 });
    await page.waitForSelector('.modal-backdrop', { hidden: true, timeout: 10000 });
  }
}
async function openLesson(page, title) {
  await page.waitForFunction((expected) => [...document.querySelectorAll('.lesson-row-link')].some((el) => el.textContent.includes(expected)), { timeout: 15000 }, title);
  await page.evaluate((expected) => {
    [...document.querySelectorAll('.lesson-row-link')].find((el) => el.textContent.includes(expected))?.click();
  }, title);
  await page.waitForSelector('.markdown-body', { timeout: 20000 });
}
const dir = mkdtempSync(join(tmpdir(), 'readme-edge-'));
const write = (name, content) => { const path = join(dir, name); writeFileSync(path, content, 'utf8'); return path; };
const txt = write('plain.txt', '# Only heading\n\nSome plain text paragraph.\n');
const noHeading = write('nohead.md', 'A paragraph without headings.\n\nAnother paragraph.\n');
const codeOnly = write('codeonly.md', '```js\nconst x = 1;\n```\n');
const pdf = write('notes.pdf', 'not a markdown file');
const rtl = write('rtl.md', '# عنوان\n\nهذه فقرة باللغة العربية للاختبار.\n');
const dupA = write('dup.md', '# Duplicate\n\nSame content.\n');
const dupB = write('dup-copy.md', '# Duplicate\n\nSame content.\n');
const auto1 = write('aaa.md', '# One\n\nFirst block of file one.\n\nSecond block of file one.\n');
const auto2 = write('bbb.md', '# Two\n\nOnly block of file two.\n');

{
  const { page, close } = await scenario(false);
  await upload(page, txt);
  await openLesson(page, 'plain.txt');
  check('missing speechSynthesis shows a clear message', await page.$('.speech-warning') !== null);
  check('playback controls disabled without TTS', await page.$eval('button[aria-label="Play"]', (button) => button.disabled));
  await page.click('.sidebar-footer button');
  await page.waitForSelector('.add-lessons-modal.show');
  check('reader sidebar opens the shared Add lessons modal', await page.$eval('#add-lessons-title', (el) => el.textContent) === 'Add lessons');
  await page.click('.add-lessons-modal .btn-secondary');
  await page.waitForFunction(() => !document.querySelector('.add-lessons-modal.show'));
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, pdf);
  const unsupported = await page.$eval('.add-lessons-row-copy span', (el) => el.textContent || '');
  check('unsupported file remains staged with a clear status', unsupported.includes('Unsupported type') && await page.$('.course-page') !== null);
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, txt);
  await openLesson(page, 'plain.txt');
  check('.txt files are accepted and rendered', true);
  check('single heading does not show a TOC', await page.$('.toc') === null);
  await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
  await page.waitForSelector('.course-card-link');
  await page.click('.course-card-link');
  await page.waitForSelector('.course-page');
  await upload(page, txt, noHeading);
  const count = await page.$$eval('.lesson-row', (rows) => rows.length);
  check('exact duplicate is flagged and only the new lesson is added', count === 2, `rows=${count}`);
  await openLesson(page, 'nohead.md');
  check('file without headings has no TOC and still yields blocks', await page.$('.toc') === null && await page.$$eval('[data-block-id]', (els) => els.length) === 2);
  await page.evaluate(() => [...document.querySelectorAll('.file-item')].find((row) => !row.classList.contains('file-item-active'))?.querySelector('.file-item-delete')?.click());
  await page.waitForSelector('.modal.show');
  await page.click('.modal .btn-danger');
  await sleep(600);
  check('deleting a non-active lesson keeps current lesson open', await page.$eval('.file-item-active .file-name', (el) => el.textContent) === 'nohead.md');
  await page.evaluate(() => document.querySelector('.file-item-delete')?.click());
  await page.waitForSelector('.modal.show');
  await page.click('.modal .btn-danger');
  await page.waitForSelector('.course-page .course-empty-lessons', { timeout: 10000 });
  check('deleting the last reader lesson returns to its course page', true);
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, codeOnly);
  await openLesson(page, 'codeonly.md');
  check('code-only file shows the nothing-to-read note and renders code', await page.$('.empty-note') !== null && await page.$$eval('pre.shiki', (els) => els.length) === 1);
  check('play is disabled when nothing is speakable', await page.$eval('button[aria-label="Play"]', (button) => button.disabled));
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, rtl);
  await openLesson(page, 'rtl.md');
  const dirs = await page.$$eval('[data-block-id]', (els) => els.map((el) => el.getAttribute('dir')));
  check('speakable RTL blocks use dir=auto', dirs.length > 0 && dirs.every((dir) => dir === 'auto'), JSON.stringify(dirs));
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, dupA, dupB);
  await page.waitForFunction(() => document.querySelectorAll('.lesson-row').length === 2, { timeout: 10000 });
  check('same content with different names is allowed', await page.$$eval('.lesson-row', (rows) => rows.length) === 2);
  await close();
}
{
  const { page, close } = await scenario();
  await page.setViewport({ width: 390, height: 600 });
  await page.click('.course-detail-heading button');
  await page.waitForSelector('.add-lessons-modal.show');
  const mobileModal = await page.evaluate(() => {
    const dialog = document.querySelector('.add-lessons-modal .modal-dialog');
    const footer = document.querySelector('.add-lessons-modal .modal-footer')?.getBoundingClientRect();
    return { fullscreen: dialog?.classList.contains('modal-fullscreen-sm-down'), footerVisible: !!footer && footer.top >= 0 && footer.bottom <= window.innerHeight };
  });
  check('phone modal fills the screen and keeps the footer visible', mobileModal.fullscreen && mobileModal.footerVisible, JSON.stringify(mobileModal));
  await page.click('#add-lessons-tabs-tab-paste');
  await page.type('textarea[aria-label="Paste Markdown lesson text"]', 'Unsaved text');
  await page.keyboard.press('Escape');
  check('Escape does not dismiss typed paste text', await page.$('.add-lessons-modal.show') !== null);
  await page.click('.add-lessons-modal .btn-secondary');
  await page.waitForFunction(() => [...document.querySelectorAll('.modal-title')].some((el) => el.textContent === 'Discard staged lessons?'));
  check('Cancel asks before discarding typed text', true);
  await page.evaluate(() => [...document.querySelectorAll('.modal.show button')].find((button) => button.textContent?.trim() === 'Discard')?.click());
  await page.waitForSelector('.modal-backdrop', { hidden: true });
  check('confirmed discard closes the modal without adding a lesson', await page.$$eval('.lesson-row', (rows) => rows.length) === 0);
  await close();
}
{
  const { page, close } = await scenario();
  await upload(page, auto1, auto2);
  await openLesson(page, 'aaa.md');
  await page.evaluate(() => [...document.querySelectorAll('[data-block-id]')].find((el) => el.textContent.includes('First block of file one'))?.click());
  await sleep(200);
  check('auto-advance starts in first lesson', await page.evaluate(() => (window.__spoken || []).some((entry) => entry.text.includes('First block of file one'))));
  await page.evaluate(() => window.__endAll());
  await sleep(300);
  check('auto-advance moves to next block', await page.evaluate(() => (window.__spoken || []).some((entry) => entry.text.includes('Second block of file one'))));
  await page.evaluate(() => window.__endAll());
  await sleep(1000);
  const state = await page.evaluate(() => ({
    active: document.querySelector('.file-item-active .file-name')?.textContent,
    spoken: (window.__spoken || []).map((entry) => entry.text).join('|'),
    playLabel: document.querySelector('button[aria-label="Play"], button[aria-label="Pause"]')?.getAttribute('aria-label'),
  }));
  check('auto-advance opens the next lesson and keeps reading', state.active === 'bbb.md' && state.spoken.includes('Two') && state.playLabel === 'Pause', JSON.stringify(state));
  await page.evaluate(() => window.__endAll());
  await sleep(400);
  check('auto-advance continues through next lesson', await page.evaluate(() => (window.__spoken || []).some((entry) => entry.text.includes('Only block of file two'))));
  await close();
}
await browser.close();
rmSync(dir, { recursive: true, force: true });
console.log('');
if (failures) { console.log(`EDGE TEST FAILED: ${failures} check(s) failed`); process.exit(1); }
else console.log('EDGE TEST PASSED: all checks green');


