// How things look. Each visual-* page plants one problem; visual-clean has a logo with text
// in it, fields and icon buttons with enough contrast, text in rem, and readable paragraphs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules } from '../src/checks/visual.mjs';
import { rules as contrastRules } from '../src/checks/contrast.mjs';
import { startSite } from './helpers.mjs';

const MINE = new Set([...Object.keys(rules), ...Object.keys(contrastRules)]);
const found = (page) => page.issues.filter((i) => MINE.has(i.id)).map((i) => [i.kind, i.id, i.selector]);

const AA = ['visual-vw', 'visual-zoom-clip', 'visual-zoom-overlap', 'visual-field', 'visual-icon', 'visual-image-text', 'visual-enhanced', 'visual-presentation', 'visual-clean'];
const AAA = ['visual-enhanced', 'visual-presentation', 'visual-wide', 'visual-clean'];
const PHONE = ['visual-orientation', 'visual-clean'];
let site, aa, aaa, phone;
const page = (result, list, name) => result.pages[list.indexOf(name)];
const message = (p, id) => p.issues.find((i) => i.id === id).message;

before(async () => {
  site = await startSite();
  [aa, aaa, phone] = await Promise.all([
    audit(site.origin, { viewports: ['desktop'], paths: AA.map((p) => `/${p}.html`), concurrency: 3 }),
    audit(site.origin, { viewports: ['desktop'], level: 'AAA', paths: AAA.map((p) => `/${p}.html`) }),
    audit(site.origin, { viewports: ['phone'], paths: PHONE.map((p) => `/${p}.html`) }),
  ]);
});
after(() => site.close());

test('text sized in vw units does not grow when zoomed and fails 1.4.4', () => {
  const p = page(aa, AA, 'visual-vw');
  assert.deepEqual(found(p), [['failure', 'text-does-not-scale', '#hero']]);
  assert.match(message(p, 'text-does-not-scale'), /stays about 58px on screen when the page is zoomed to 200% and 400%/);
});

test('text cut off or drawn over other text at 200% zoom is a likely 1.4.4 problem', () => {
  assert.deepEqual(found(page(aa, AA, 'visual-zoom-clip')), [['likely', 'zoom-clipped-text', '#hours']]);
  const p = page(aa, AA, 'visual-zoom-overlap');
  assert.deepEqual(found(p), [['likely', 'zoom-overlapping-text', '#title']]);
  assert.match(message(p, 'zoom-overlapping-text'), /is drawn over "Published in March by the volunteers" at 200% zoom/);
});

test('a page that asks to be rotated fails 1.3.4 on a phone', () => {
  const p = page(phone, PHONE, 'visual-orientation');
  assert.deepEqual(found(p), [['failure', 'orientation-locked', 'body']]);
  assert.match(message(p, 'orientation-locked'), /^held landscape, the page says "rotate your device"/i);
});

test('a faint field border and a faint icon button fail 1.4.11 with their measured ratio', () => {
  const field = page(aa, AA, 'visual-field'), icon = page(aa, AA, 'visual-icon');
  assert.deepEqual(found(field), [['failure', 'faint-field-border', '#email']]);
  assert.match(message(field, 'faint-field-border'), /"Email" reaches 1\.36:1 .* needs 3:1$/);
  assert.deepEqual(found(icon), [['failure', 'faint-icon-control', '#share']]);
  assert.match(message(icon, 'faint-icon-control'), /"Share" reaches 1\.74:1/);
});

test('an image of text is read with OCR and flagged for 1.4.5 and 1.4.9', (t) => {
  const p = page(aa, AA, 'visual-image-text');
  const note = p.notes.find((n) => /images were not read for text/.test(n));
  if (note) return t.skip(`OCR could not run here: ${note}`);
  assert.deepEqual(found(p), [['likely', 'image-of-text', '#banner']]);
  assert.match(message(p, 'image-of-text'), /"Spring food drive Saturday at the community center"/);
  assert.deepEqual(p.issues.find((i) => i.id === 'image-of-text').wcag, ['1.4.5', '1.4.9']);
});

test('text over an image between 4.5:1 and 7:1 passes at AA and fails enhanced contrast at AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'visual-enhanced')), []);
  const p = page(aaa, AAA, 'visual-enhanced');
  assert.deepEqual(found(p), [['failure', 'contrast-on-image-enhanced', '#on-grey']]);
  assert.match(message(p, 'contrast-on-image-enhanced'), /reaches 5\.\d\d:1 at best .* needs 7:1$/);
});

test('justified, long, tightly set paragraphs are flagged at AAA only', () => {
  assert.deepEqual(found(page(aa, AA, 'visual-presentation')), []);
  assert.deepEqual(found(page(aaa, AAA, 'visual-presentation')), [
    ['likely', 'justified-text', 'p.wide'],
    ['likely', 'long-lines', 'p.wide'],
    ['likely', 'tight-line-height', 'p.wide'],
    ['likely', 'tight-paragraph-spacing', 'p.wide'],
  ]);
});

test('a page that scrolls sideways at 200% zoom is flagged at AAA', () => {
  const p = page(aaa, AAA, 'visual-wide');
  assert.deepEqual(found(p), [['likely', 'zoom-sideways-scroll', 'html']]);
  assert.match(message(p, 'zoom-sideways-scroll'), /^at 200% zoom in a 1440px wide window the page scrolls sideways by \d+px$/);
});

test('visual done right reports nothing, at AA, AAA and on a phone', () => {
  assert.deepEqual(found(page(aa, AA, 'visual-clean')), []);
  assert.deepEqual(found(page(aaa, AAA, 'visual-clean')), []);
  assert.deepEqual(found(page(phone, PHONE, 'visual-clean')), []);
  assert.ok([...aa.pages, ...aaa.pages, ...phone.pages].every((p) => !p.notes.some((n) => /could not finish/.test(n))), 'no visual check crashed');
});
