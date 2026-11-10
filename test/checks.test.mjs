// Every fixture page plants one kind of problem. These tests pin down exactly what is
// reported for each, so a check that goes quiet or starts over-reporting fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { startSite, ids } from './helpers.mjs';

const PAGES = ['clean', 'focus', 'obscured', 'reflow', 'video', 'rules', 'headings', 'banner', 'frame', 'shadow', 'skiplink', 'popup'];
let site, result;
const page = (name) => result.pages[PAGES.indexOf(name)];

before(async () => {
  site = await startSite();
  result = await audit(site.origin, { paths: PAGES.map((p) => `/${p}.html`), concurrency: 3 });
});
after(() => site.close());

test('a clean page reports nothing', () => {
  assert.deepEqual(page('clean').issues, []);
  assert.equal(page('clean').tabStops, 3);
  assert.equal(page('clean').error, null);
});

test('focus visible is judged from what is drawn, not from the CSS', () => {
  const p = page('focus');
  assert.equal(p.tabStops, 5);
  // Only the link that draws nothing fails. Rings drawn by a pseudo-element, by the wrapper
  // and by the browser default all pass.
  assert.deepEqual(p.issues.filter((i) => i.kind === 'failure').map((i) => [i.id, i.selector]), [['focus-visible', '#no-ring']]);
  assert.deepEqual(p.issues.filter((i) => i.kind === 'failure')[0].wcag, ['2.4.7']);
});

test('a text field with only a cursor is a note, not a failure', () => {
  assert.deepEqual(page('focus').issues.filter((i) => i.kind === 'advice').map((i) => [i.id, i.selector]), [['focus-caret-only', '#bare']]);
});

test('focus hidden under a fixed bar is reported and names the bar', () => {
  const p = page('obscured');
  assert.deepEqual(ids(p), ['focus-not-obscured']);
  assert.equal(p.issues[0].selector, '#bottom-link');
  assert.deepEqual(p.issues[0].wcag, ['2.4.11']);
  assert.match(p.issues[0].message, /#sticky-bar \(position: fixed\)/);
});

test('sideways scroll at 320px is reported and names the widest element', () => {
  const p = page('reflow');
  assert.deepEqual(ids(p), ['reflow']);
  assert.match(p.issues[0].message, /^428px of sideways scroll at 320px wide; widest: #wide-box$/);
});

test('a looping video fails only when there is no pause control', () => {
  const p = page('video');
  assert.deepEqual(p.issues.map((i) => [i.id, i.selector]), [['moving-video', '#no-pause']]);
});

test('axe-core rules run, including target size from WCAG 2.2', () => {
  const p = page('rules');
  assert.deepEqual(ids(p), ['color-contrast', 'target-size', 'target-size']);
  assert.deepEqual(p.issues.find((i) => i.id === 'target-size').wcag, ['2.5.8']);
  assert.ok(p.issues.every((i) => i.source === 'axe' && i.helpUrl.startsWith('https://dequeuniversity.com/')));
});

test('best-practice rules are notes and do not count as failures', () => {
  const p = page('headings');
  assert.deepEqual(ids(p), []);
  assert.deepEqual(ids(p, 'advice'), ['heading-order']);
  assert.deepEqual(p.issues[0].wcag, []);
});

test('a cookie banner is dismissed with Reject before the page is audited', () => {
  const p = page('banner');
  assert.deepEqual(p.issues, []);
  assert.equal(p.tabStops, 1);
  assert.deepEqual(p.notes, ['clicked "Reject all" on a cookie banner first']);
});

test('the walk carries on past an embedded frame', () => {
  const p = page('frame');
  assert.deepEqual(p.issues, []);
  assert.equal(p.tabStops, 2);
  assert.deepEqual(p.notes, ['1 embedded frame(s) take focus; focus inside them was not checked']);
});

test('focus inside a shadow root is checked', () => {
  const p = page('shadow');
  assert.deepEqual(ids(p), ['focus-visible']);
  assert.match(p.issues[0].message, /Button inside a shadow root/);
});

test('a skip link that slides in on focus is measured after it arrives', () => {
  const p = page('skiplink');
  assert.deepEqual(p.issues, []);
  assert.equal(p.tabStops, 2);
});

test('a popup that opens mid-walk and traps focus is called out', () => {
  const p = page('popup');
  assert.equal(p.notes.length, 1);
  assert.match(p.notes[0], /^a popup \("Join our newsletter"\) opened during the audit and took keyboard focus/);
  assert.ok(!p.issues.some((i) => i.selector === '#third'), 'the link behind the popup is not judged');
});

test('totals add up', () => {
  assert.deepEqual(result.totals, { pages: 12, failures: 8, advice: 2, needsReview: result.totals.needsReview, errors: 0 });
  assert.equal(result.standard, 'WCAG 2.2 AA');
  assert.match(result.engine, /^axe-core \d+\.\d+\.\d+$/);
});

test('with dismissal off, the banner is reported as covering the page', async () => {
  const r = await audit(`${site.origin}/banner.html`, { dismiss: false });
  assert.equal(r.discovery, 'single page');
  assert.deepEqual(ids(r.pages[0]), ['focus-not-obscured']);
  assert.match(r.pages[0].issues[0].message, /#cookie-banner/);
});

test('the tab stop limit is honoured and reported', async () => {
  const r = await audit(`${site.origin}/focus.html`, { maxTabStops: 2 });
  assert.equal(r.pages[0].tabStops, 2);
  assert.deepEqual(r.pages[0].notes, ['stopped after 2 tab stops; the rest of the page was not walked']);
});
