// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { anchorToRange, getBlockText, rangeToAnchor } from './index';

let root: HTMLElement;
beforeEach(() => {
  document.body.innerHTML = '<main id="root"></main>';
  root = document.querySelector('#root')!;
});

function select(startNode: Node, start: number, endNode: Node = startNode, end = start + 1): Range {
  const range = document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  return range;
}

function anchorFor(range: Range) {
  const result = rangeToAnchor(range, root);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.reason);
  return result;
}

describe('reader text anchors', () => {
  it('anchors a plain paragraph using its block text', () => {
    root.innerHTML = '<p data-block-id="p1">Hello world.</p>';
    const text = root.querySelector('p')!.firstChild!;
    expect(anchorFor(select(text, 6, text, 11)).anchor).toMatchObject({ blockId: 'p1', start: 6, end: 11, quote: 'world', prefix: 'Hello ', suffix: '.' });
  });

  it('joins text across bold, inline code and link descendants', () => {
    root.innerHTML = '<p data-block-id="p1">A <strong>bold</strong> <code>bit</code> <a href="#">link</a></p>';
    const paragraph = root.querySelector('p')!;
    expect(getBlockText(paragraph)).toBe('A bold bit link');
    const range = select(paragraph.firstChild!, 2, paragraph.querySelector('a')!.firstChild!, 2);
    expect(anchorFor(range).anchor.quote).toBe('bold bit li');
  });

  it('normalizes element offset boundaries toward text', () => {
    root.innerHTML = '<p data-block-id="p1">one <em>two</em> three</p>';
    const paragraph = root.querySelector('p')!;
    const range = select(paragraph, 1, paragraph, 2);
    expect(anchorFor(range).anchor.quote).toBe('two');
  });

  it('trims whitespace and adjusts offsets', () => {
    root.innerHTML = '<p data-block-id="p1">  keep this  </p>';
    const text = root.querySelector('p')!.firstChild!;
    expect(anchorFor(select(text, 0, text, text.textContent!.length)).anchor).toMatchObject({ start: 2, end: 11, quote: 'keep this' });
  });

  it('excludes nested list item text from its parent item', () => {
    root.innerHTML = '<li data-block-id="parent">Parent<ul><li data-block-id="child">Child</li></ul></li>';
    const parent = root.querySelector('[data-block-id="parent"]') as HTMLElement;
    expect(getBlockText(parent)).toBe('Parent');
  });

  it('maps Shiki style code spans back to the code block text', () => {
    root.innerHTML = '<pre data-block-id="c-1-code"><code><span>const </span><span>answer</span><span> = 42;</span></code></pre>';
    const code = root.querySelector('pre')!;
    expect(getBlockText(code)).toBe('const answer = 42;');
    expect(anchorFor(select(code.querySelectorAll('span')[0].firstChild!, 0, code.querySelectorAll('span')[2].firstChild!, 6)).anchor.quote).toBe('const answer = 42;');
  });

  it('clamps an end that crosses into another block', () => {
    root.innerHTML = '<p data-block-id="p1">first</p><p data-block-id="p2"> second</p>';
    const first = root.querySelector('p')!;
    const secondText = root.querySelectorAll('p')[1].firstChild!;
    const result = anchorFor(select(first.firstChild!, 2, secondText, 4));
    expect(result.anchor.quote).toBe('rst');
    expect(result.clamped).toBe(true);
  });

  it('reports collapsed, outside and empty selections', () => {
    root.innerHTML = '<p data-block-id="p1"></p><p data-block-id="p2">text</p>';
    const p = root.querySelectorAll('p')[1];
    expect(rangeToAnchor(select(p.firstChild!, 1, p.firstChild!, 1), root)).toEqual({ ok: false, reason: 'collapsed' });
    expect(rangeToAnchor(select(document.createTextNode('outside'), 0), root)).toEqual({ ok: false, reason: 'outside' });
    expect(rangeToAnchor(select(p.firstChild!, 0, p.firstChild!, 0), root)).toEqual({ ok: false, reason: 'collapsed' });
  });

  it('round trips a range, falls back to quote, and disambiguates by context', () => {
    root.innerHTML = '<p data-block-id="p1">red target one</p><p data-block-id="p2">blue target two</p>';
    const p2Text = root.querySelectorAll('p')[1].firstChild!;
    const anchor = anchorFor(select(p2Text, 5, p2Text, 11)).anchor;
    const roundTrip = anchorToRange(anchor, root)!;
    expect(roundTrip.toString()).toBe('target');
    const fallback = anchorToRange({ ...anchor, blockId: 'missing', start: 0, end: 1 }, root)!;
    expect(fallback.toString()).toBe('target');
    expect(fallback.startContainer.parentElement?.textContent).toContain('blue');
  });

  it('returns null when a fallback quote is missing or equally ambiguous', () => {
    root.innerHTML = '<p data-block-id="p1">same</p><p data-block-id="p2">same</p>';
    expect(anchorToRange({ blockId: 'bad', start: 0, end: 1, quote: 'missing', prefix: '', suffix: '' }, root)).toBeNull();
    expect(anchorToRange({ blockId: 'bad', start: 0, end: 4, quote: 'same', prefix: '', suffix: '' }, root)).toBeNull();
  });

  it('keeps offsets stable when a mark splits a text node', () => {
    root.innerHTML = '<p data-block-id="p1">hello world</p>';
    const before = anchorFor(select(root.querySelector('p')!.firstChild!, 6, root.querySelector('p')!.firstChild!, 11)).anchor;
    root.querySelector('p')!.innerHTML = 'hello <mark>world</mark>';
    const after = anchorFor(select(root.querySelector('mark')!.firstChild!, 0, root.querySelector('mark')!.firstChild!, 5)).anchor;
    expect(after).toEqual(before);
  });
});
