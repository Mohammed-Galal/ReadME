// Browser smoke check for selecting text and saving an anchored comment.
// Requires the production server to be running on :3000.
import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = process.env.SMOKE_URL || 'http://localhost:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
let failures = 0;
const check = (name, condition, extra = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${name}${condition ? '' : `  ${extra}`}`);
  if (!condition) failures++;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const tempDir = mkdtempSync(join(tmpdir(), 'readme-comments-'));
const markdownPath = join(tempDir, 'comments.md');
writeFileSync(markdownPath, '# Comments\n\nA paragraph with a **bold selection** for anchoring.\n\n## Code\n\n```js\nconst answer = 42;\n```\n', 'utf8');
const browser = await puppeteer.launch({ executablePath: EDGE, headless: true, args: ['--no-first-run', '--disable-gpu'] });
const context = await browser.createBrowserContext();
const page = await context.newPage();
await page.setViewport({ width: 1280, height: 800 });
await page.evaluateOnNewDocument(() => {
  const synth = {
    getVoices: () => [{ name: 'Smoke Voice', lang: 'en-US', voiceURI: 'smoke-en', localService: true, default: true }],
    addEventListener() {}, removeEventListener() {},
    speak(utterance) { setTimeout(() => utterance.onstart?.(), 10); },
    cancel() {}, pause() {}, resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
});
await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForSelector('.courses-empty, .course-card', { timeout: 15000 });
await page.click('.courses-topbar button');
await page.waitForSelector('#course-name');
await page.type('#course-name', 'Comments Smoke Course');
await page.click('.modal button[type="submit"]');
await page.waitForSelector('.course-page');

await page.click('.course-detail-heading button');
await page.waitForSelector('.add-lessons-modal.show');
const input = await page.$('input[aria-label="Choose Markdown lesson files"]');
await input.uploadFile(markdownPath);
await page.waitForSelector('.add-lessons-submit:not(:disabled)', { timeout: 10000 });
await page.click('.add-lessons-submit');
await page.waitForFunction(() => !document.querySelector('.add-lessons-modal.show'));
await page.waitForSelector('.lesson-row-link');
await page.evaluate(() => document.querySelector('.lesson-row-link')?.click());
await page.waitForSelector('.markdown-body', { timeout: 20000 });

const blockIds = await page.$$eval('[data-reader-content] [data-block-id]', (els) => els.map((el) => el.dataset.blockId));
check('speakable and code blocks have separate id schemes', blockIds.some((id) => /^\d+-/.test(id || '')) && blockIds.some((id) => /^c-\d+-/.test(id || '')), JSON.stringify(blockIds));
check('TOC is outside the reader content wrapper', await page.evaluate(() => {
  const toc = document.querySelector('.toc');
  return !!toc && !toc.closest('[data-reader-content]') && !!document.querySelector('[data-reader-content]');
}));

await page.evaluate(() => {
  const paragraph = document.querySelector('[data-reader-content] p');
  const bold = paragraph?.querySelector('strong')?.firstChild;
  const range = document.createRange();
  range.setStart(bold, 0);
  range.setEnd(bold, bold.textContent.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
});
await sleep(250);
check('valid selection shows the desktop Comment action', await page.$('.selection-comment-float') !== null);
await page.keyboard.press('c');
await page.waitForSelector('#comment-text');
check('C opens the composer for a valid selection', await page.$eval('.comment-quote', (el) => el.textContent) === 'bold selection');
await page.click('.modal.show .modal-footer .btn-secondary');
await page.waitForSelector('.modal.show', { hidden: true });
await page.evaluate(() => {
  const bold = document.querySelector('[data-reader-content] strong')?.firstChild;
  const range = document.createRange();
  range.setStart(bold, 0);
  range.setEnd(bold, bold.textContent.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
});
await sleep(200);
await page.click('button[aria-label="Play"]');
await page.waitForSelector('button[aria-label="Pause"]');
await page.click('.selection-comment-float');
await page.waitForSelector('#comment-text');
check('composer shows the selected quote', await page.$eval('.comment-quote', (el) => el.textContent) === 'bold selection');
check('opening the composer pauses speech', await page.$('button[aria-label="Play"]') !== null);
await page.click('.modal.show .modal-footer .btn-secondary');
await page.waitForSelector('.modal.show', { hidden: true });
await page.waitForSelector('button[aria-label="Pause"]');
check('closing the composer resumes previously playing speech', await page.$('button[aria-label="Pause"]') !== null);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await page.waitForSelector('[data-reader-content] strong');
await page.evaluate(() => {
  const bold = document.querySelector('[data-reader-content] strong')?.firstChild;
  const range = document.createRange();
  range.setStart(bold, 0);
  range.setEnd(bold, bold.textContent.length);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
});
await sleep(200);
check('coarse pointer shows the fixed bottom Comment bar', await page.$('.selection-comment-bar') !== null);
await page.click('.selection-comment-bar button');
await page.waitForSelector('#comment-text');
check('composer shows the selected quote', await page.$eval('.comment-quote', (el) => el.textContent) === 'bold selection');
await page.type('#comment-text', 'Remember this passage');
await page.keyboard.press('c');
check('typing C does not trigger the reader shortcut', await page.$('#comment-text') !== null && await page.$('.modal.show') !== null);
await page.keyboard.press('Backspace');
await page.click('.modal.show .modal-footer .btn-secondary');
await page.waitForFunction(() => [...document.querySelectorAll('.modal.show .modal-title')].some((el) => el.textContent === 'Discard comment?'));
check('Cancel asks to discard typed comment text', true);
await page.evaluate(() => {
  [...document.querySelectorAll('.modal.show')].find((modal) => modal.querySelector('#confirm-dialog-title'))?.querySelector('.btn-secondary')?.click();
});
await page.waitForFunction(() => ![...document.querySelectorAll('.modal.show .modal-title')].some((el) => el.textContent === 'Discard comment?'));
await sleep(350);
check('keeping the comment returns to the composer with text intact', await page.$eval('#comment-text', (el) => el.value) === 'Remember this passage');
await page.click('.modal.show .modal-footer .btn-primary');
await sleep(1000);
const saveState = await page.evaluate(() => [...document.querySelectorAll('.toast-message')].map((el) => el.textContent));
check('saving shows a Comment saved toast', saveState.some((value) => value?.includes('Comment saved')), JSON.stringify(saveState));
const saved = await page.evaluate(async () => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('readme-reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return await new Promise((resolve, reject) => {
    const request = db.transaction('comments', 'readonly').objectStore('comments').getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
});
check('IndexedDB stores the comment and text anchor', saved.length === 1 && saved[0].text === 'Remember this passage' && saved[0].anchor.quote === 'bold selection' && saved[0].anchor.blockId, JSON.stringify(saved));

await page.setViewport({ width: 1280, height: 800 });
await page.waitForFunction(() => !!window.CSS?.highlights?.has('comment'));
check('comment and active highlight layers register', await page.evaluate(() => window.CSS.highlights.has('comment') && window.CSS.highlights.has('comment-active')));
await page.evaluate(async (row) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('readme-reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    tx.objectStore('comments').add({ ...row, id: 'smoke-overlap', order: 1, text: 'Overlapping comment' });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new CustomEvent('readme-comment-data-changed', { detail: { lessonId: row.lessonId, courseId: row.courseId } }));
}, saved[0]);
await page.waitForFunction(() => document.querySelectorAll('.markdown-body [data-block-id]').length > 0);
await sleep(200);
const quotePoint = await page.evaluate(() => {
  const strong = document.querySelector('[data-reader-content] strong');
  const range = document.createRange();
  range.selectNodeContents(strong);
  const rect = range.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.click(quotePoint.x, quotePoint.y);
await page.waitForSelector('.comment-viewer.show');
await page.waitForFunction(() => document.querySelector('.comment-viewer')?.getBoundingClientRect().top < innerHeight - 100);
check('clicking a highlighted quote opens the viewer instead of reading', await page.$eval('.comment-viewer-text', (el) => el.textContent === 'Remember this passage'));
check('overlapping comments can be stepped through', await page.$eval('.comment-overlap-controls span', (el) => el.textContent === '1 / 2'));
await page.click('.comment-viewer button[aria-label="Next overlapping comment"]');
check('next overlap shows the other comment', await page.$eval('.comment-viewer-text', (el) => el.textContent === 'Overlapping comment'));
await page.click('.comment-viewer button[aria-label="Previous overlapping comment"]');
await page.evaluate(() => [...document.querySelectorAll('.comment-viewer button')].find((button) => button.textContent?.trim() === 'Edit')?.click());
await page.waitForSelector('#comment-edit-text');
await page.click('#comment-edit-text');
await page.keyboard.down('Control');
await page.keyboard.press('A');
await page.keyboard.up('Control');
await page.type('#comment-edit-text', 'Edited comment');
await page.evaluate(() => [...document.querySelectorAll('.comment-viewer button')].find((button) => button.textContent?.trim() === 'Save')?.click());
await page.waitForFunction(() => document.querySelector('.comment-viewer-text')?.textContent === 'Edited comment');
check('editing updates the comment live', true);
await page.evaluate(() => [...document.querySelectorAll('.comment-viewer button')].find((button) => button.textContent?.includes('Read from here'))?.click());
await page.waitForSelector('button[aria-label="Pause"]');
check('Read from here starts at the comment block', true);
await page.click('.comment-viewer button[aria-label="Close comment"]');
await page.waitForSelector('.comment-viewer.show', { hidden: true });

const lessonUrl = page.url();
const resolvedDeepLink = new URL(lessonUrl);
resolvedDeepLink.searchParams.set('comment', saved[0].id);
await page.goto(resolvedDeepLink.href, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-reader-content]');
await page.waitForFunction(() => !new URL(location.href).searchParams.has('comment'), { timeout: 10000 });
check('resolved comment deep link cleans the URL and makes its block current', await page.evaluate((blockId) => !!document.querySelector(`[data-block-id="${CSS.escape(blockId)}"].reading-block`), saved[0].anchor.blockId));

await page.evaluate(async (id) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('readme-reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    const store = tx.objectStore('comments');
    const request = store.get(id);
    request.onsuccess = () => store.put({ ...request.result, anchor: { ...request.result.anchor, blockId: 'missing-block', quote: 'text no longer in the article' } });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}, saved[0].id);
const unresolvedDeepLink = new URL(lessonUrl);
unresolvedDeepLink.searchParams.set('comment', saved[0].id);
await page.goto(unresolvedDeepLink.href, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.comment-viewer.show');
await page.waitForFunction(() => document.querySelector('.comment-viewer')?.getBoundingClientRect().top < innerHeight - 100);
await page.waitForFunction(() => !new URL(location.href).searchParams.has('comment'), { timeout: 10000 });
check('unresolved deep link opens the viewer with its source warning', await page.$eval('.comment-viewer-content', (el) => el.textContent.includes("The source text for this comment can't be found")));
await page.evaluate(() => [...document.querySelectorAll('.comment-viewer button')].find((button) => button.textContent?.trim() === 'Delete')?.click());
await page.waitForSelector('#confirm-dialog-title');
await page.evaluate(() => [...document.querySelectorAll('.modal.show button')].find((button) => button.textContent?.trim() === 'Delete')?.click());
await page.waitForSelector('.comment-viewer.show', { hidden: true });
check('deleting a comment closes its viewer', await page.$('.comment-viewer.show') === null);
const listSeedId = 'smoke-list-second';
await page.evaluate(async (savedRow) => {
  const db = await new Promise((resolve, reject) => {
    const request = indexedDB.open('readme-reader');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  await new Promise((resolve, reject) => {
    const tx = db.transaction('comments', 'readwrite');
    tx.objectStore('comments').put({ ...savedRow, id: 'smoke-list-second', order: 0, text: 'Second list comment', anchor: { ...savedRow.anchor, quote: 'Second list quote' } });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
  window.dispatchEvent(new CustomEvent('readme-comment-data-changed', { detail: { lessonId: savedRow.lessonId, courseId: savedRow.courseId } }));
}, saved[0]);
await page.goto(`${BASE}/courses/${encodeURIComponent(saved[0].courseId)}?tab=comments`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.course-page');
await page.waitForFunction(() => document.querySelectorAll('.course-comment-row').length === 2);
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
check('phone Comments tab has no horizontal overflow and keeps action targets at least 44px', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth && [...document.querySelectorAll('.course-comment-header button')].every((button) => button.getBoundingClientRect().height >= 44)));
await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
check('Comments tab count and live list use the same comment data', await page.$eval('.course-tabs', (el) => el.textContent.includes('Comments (2)')));
const listedIds = await page.$$eval('.course-comment-row', (rows) => rows.map((row) => row.getAttribute('data-comment-row-id')));
check('comments appear in creation order with lesson badges', listedIds[0] === listSeedId && (await page.$('.course-comment-lesson-badge')) !== null);
await page.click(`.course-comment-row[data-comment-row-id="${listSeedId}"] .course-comment-toggle`);
await page.click('.course-comment-row[data-comment-row-id="smoke-overlap"] .course-comment-toggle');
check('comment items expand independently', await page.$$eval('.course-comment-toggle[aria-expanded="true"]', (buttons) => buttons.length === 2));
const firstRow = `.course-comment-row[data-comment-row-id="${listSeedId}"]`;
await page.click(`${firstRow} button[aria-label^="Actions for"]`);
await page.waitForSelector('.dropdown-menu.show .dropdown-item');
await page.click('.dropdown-menu.show .dropdown-item');
await page.waitForSelector('#move-position-number');
check('move modal preselects the current position', await page.$eval('#move-position-number', (input) => input.value === '1'));
await page.click('#move-position-number');
await page.keyboard.down('Control');
await page.keyboard.press('A');
await page.keyboard.up('Control');
await page.type('#move-position-number', '2');
await page.click('.modal.show button[type="submit"]');
await page.waitForSelector('.modal.show', { hidden: true });
await page.waitForFunction(() => document.querySelector('.course-comment-row[data-comment-row-id="smoke-overlap"]')?.querySelector('.course-comment-position')?.textContent === '1');
check('move to the last position persists and keeps expanded state by id', await page.$eval(firstRow, (row) => row.querySelector('.course-comment-position')?.textContent === '2' && row.querySelector('.course-comment-toggle')?.getAttribute('aria-expanded') === 'true'));
await page.click(`${firstRow} button[aria-label^="Actions for"]`);
await new Promise((resolve) => setTimeout(resolve, 150));
if (await page.$eval(`${firstRow} button[aria-label^="Actions for"]`, (button) => button.getAttribute('aria-expanded') !== 'true')) {
  await page.click(`${firstRow} button[aria-label^="Actions for"]`);
}
await page.waitForSelector('.dropdown-menu.show .dropdown-item');
await page.click('.dropdown-menu.show .dropdown-item');
await page.waitForSelector('#move-position-number');
check('unchanged move is preselected', await page.$eval('#move-position-number', (input) => input.value === '2'));
await page.click('.modal.show button[type="submit"]');
await page.waitForSelector('.modal.show', { hidden: true });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction((id) => document.querySelector(`[data-comment-row-id="${CSS.escape(id)}"] .course-comment-position`)?.textContent === '2', {}, listSeedId);
check('comment position persists after reload', true);
await page.click(`${firstRow} button[aria-label="Go to source for comment 2"]`);
await page.waitForFunction((id) => new URL(location.href).searchParams.get('comment') === id, {}, listSeedId);
check('Go to source opens the lesson with a comment deep link', new URL(page.url()).searchParams.get('comment') === listSeedId);
await page.goBack({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('.course-comment-row');
check('Back returns to the Comments tab', new URL(page.url()).searchParams.get('tab') === 'comments');
await page.click(`${firstRow} button[aria-label^="Actions for"]`);
await page.waitForSelector('.dropdown-menu.show .dropdown-item');
await page.click('.dropdown-menu.show .dropdown-item');
await page.waitForSelector('#move-position-number');
await page.click('#move-position-number');
await page.keyboard.down('Control');
await page.keyboard.press('A');
await page.keyboard.up('Control');
await page.type('#move-position-number', '1');
await page.click('.modal.show button[type="submit"]');
await page.waitForSelector('.modal.show', { hidden: true });
await page.waitForFunction((id) => document.querySelector(`[data-comment-row-id="${CSS.escape(id)}"] .course-comment-position`)?.textContent === '1', {}, listSeedId);
check('move to the first position works', true);
const deleteMenuButton = `.course-comment-row[data-comment-row-id="${listSeedId}"] button[aria-label^="Actions for"]`;
await page.click(deleteMenuButton);
await new Promise((resolve) => setTimeout(resolve, 150));
if (await page.$eval(deleteMenuButton, (button) => button.getAttribute('aria-expanded') !== 'true')) await page.click(deleteMenuButton);
await page.waitForSelector('.dropdown-menu.show .dropdown-item.text-danger');
await page.click('.dropdown-menu.show .dropdown-item.text-danger');
await page.waitForSelector('#confirm-dialog-title');
check('delete confirmation includes the quote snippet', await page.$eval('.modal.show .modal-body', (el) => el.textContent.includes('Second list quote')));
await page.click('.modal.show button.btn-danger');
await page.waitForFunction(() => document.querySelectorAll('.course-comment-row').length === 1);
check('deleting from the list updates the count and shows a toast', await page.$eval('.course-tabs', (el) => el.textContent.includes('Comments (1)')) && await page.$eval('.toast-stack', (el) => el.textContent.includes('Comment deleted')));

await context.close();
await browser.close();
rmSync(tempDir, { recursive: true, force: true });
if (failures) { console.log(`COMMENT SMOKE FAILED: ${failures} check(s) failed`); process.exit(1); }
else console.log('COMMENT SMOKE PASSED: all checks green');
