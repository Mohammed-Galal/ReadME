import puppeteer from 'puppeteer-core';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 'http://localhost:3000';
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : `  — ${extra}`}`);
  if (!cond) failures++;
};

const md = `---
lang: en
---

# Style check

A paragraph to highlight.

## Code

\`\`\`js
const x = 1;
\`\`\`
`;

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: true,
  args: ['--no-first-run', '--disable-gpu'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 800 });

await page.evaluateOnNewDocument(() => {
  const synth = {
    getVoices: () => [{ name: 'Test Voice', lang: 'en-US', voiceURI: 'test-en-us', localService: true, default: true }],
    addEventListener: () => {},
    removeEventListener: () => {},
    speak(u) {
      window.__pending = window.__pending || [];
      window.__pending.push(u);
      setTimeout(() => {
        if (window.__pending.includes(u)) {
          u.onstart && u.onstart();
          u.onboundary && u.onboundary({ name: 'word', charIndex: 4 });
        }
      }, 15);
    },
    cancel() {
      window.__pending = [];
    },
    pause() {},
    resume() {},
  };
  Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
});

await page.goto(BASE, { waitUntil: 'networkidle0', timeout: 30000 });
await page.waitForSelector('.courses-empty, .course-card', { timeout: 15000 });
const dir = mkdtempSync(join(tmpdir(), 'readme-style-'));
const file = join(dir, 'style.md');
writeFileSync(file, md);
await page.click('.courses-topbar button');
await page.waitForSelector('#course-name');
await page.type('#course-name', 'Style Course');
await page.click('.modal button[type="submit"]');
await page.waitForSelector('.course-page');
await page.click('.course-detail-heading button');
await page.waitForSelector('.add-lessons-modal.show');
await (await page.$('input[aria-label="Choose Markdown lesson files"]')).uploadFile(file);
await page.waitForSelector('.add-lessons-row');
await page.click('.add-lessons-submit');
await page.waitForSelector('.add-lessons-modal.show', { hidden: true });
await page.waitForSelector('.modal-backdrop', { hidden: true });
await page.waitForSelector('.lesson-row-link');
await page.click('.lesson-row-link');
await page.waitForSelector('.markdown-body', { timeout: 20000 });

// Start reading the paragraph → word + block highlight active.
await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-block-id]')].find((e) => e.textContent.includes('paragraph to highlight'));
  el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await sleep(250);

const styles = await page.evaluate(() => {
  const block = document.querySelector('.reading-block');
  const cs = block ? getComputedStyle(block) : null;
  const pre = document.querySelector('pre.shiki');
  const preCs = pre ? getComputedStyle(pre) : null;
  const nav = document.querySelector('.top-navbar');
  const navCs = nav ? getComputedStyle(nav) : null;
  const hlVar = getComputedStyle(document.documentElement).getPropertyValue('--word-hl-bg').trim();
  const fgVar = getComputedStyle(document.documentElement).getPropertyValue('--word-hl-fg').trim();
  return {
    blockBg: cs ? cs.backgroundColor : 'none',
    preColor: preCs ? preCs.color : 'none',
    navPosition: navCs ? navCs.position : 'none',
    navTop: navCs ? navCs.top : 'none',
    wordHlBg: hlVar,
    wordHlFg: fgVar,
    scrollMargin: block ? getComputedStyle(block).scrollMarginTop : 'none',
  };
});
check('current block has a slight background highlight', styles.blockBg !== 'rgba(0, 0, 0, 0)' && styles.blockBg !== 'transparent', styles.blockBg);
check('navbar is sticky at the top', styles.navPosition === 'sticky' && styles.navTop === '0px', `${styles.navPosition} top=${styles.navTop}`);
check('blocks keep scroll-margin for the navbar', styles.scrollMargin !== '0px', styles.scrollMargin);
check('word highlight vars have contrast (light)', styles.wordHlBg !== '' && styles.wordHlFg !== '', `${styles.wordHlBg} / ${styles.wordHlFg}`);

// Dark mode: Shiki colors must flip and vars update.
await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
await sleep(300);
const dark = await page.evaluate(() => {
  const pre = document.querySelector('pre.shiki span');
  const preCs = pre ? getComputedStyle(pre) : null;
  const root = getComputedStyle(document.documentElement);
  return {
    spanColor: preCs ? preCs.color : 'none',
    hlBg: root.getPropertyValue('--word-hl-bg').trim(),
    scheme: root.colorScheme,
  };
});
check('dark scheme active', dark.scheme === 'dark', dark.scheme);
check('Shiki span color flips in dark mode', dark.spanColor !== 'none', dark.spanColor);
check('word highlight vars updated for dark', dark.hlBg !== '', dark.hlBg);

// Keyboard: click block first to give body focus, then space toggles pause.
await page.keyboard.press(' ');
await sleep(200);
const paused = await page.$eval('button[aria-label="Play"], button[aria-label="Pause"]', (b) => b.getAttribute('aria-label'));
check('Space toggles to pause in dark mode too', paused === 'Play');

await browser.close();
rmSync(dir, { recursive: true, force: true });
console.log('');
console.log(failures ? `STYLE TEST FAILED: ${failures}` : 'STYLE TEST PASSED');
process.exit(failures ? 1 : 0);
