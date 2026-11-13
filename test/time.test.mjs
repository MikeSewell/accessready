// Time and motion. Each time-* page plants one problem; time-clean has a carousel with a
// pause button, a hover effect that respects reduced motion, a short animation and a
// loading spinner, none of which should be reported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules, analyzeFlashes } from '../src/checks/time.mjs';
import { startSite } from './helpers.mjs';

const MINE = new Set(Object.keys(rules));
const found = (page) => page.issues.filter((i) => MINE.has(i.id)).map((i) => [i.kind, i.id, i.selector]);

const AA = ['time-carousel', 'time-ticker', 'time-animation', 'time-flash', 'time-flash-small', 'time-redirect', 'time-reload', 'time-expire', 'time-warned', 'time-popup', 'time-motion', 'time-clean'];
const AAA = ['time-flash-small', 'time-warned', 'time-popup', 'time-motion', 'time-clean'];
let site, aa, aaa;
const page = (result, list, name) => result.pages[list.indexOf(name)];
const message = (p, id) => p.issues.find((i) => i.id === id).message;

before(async () => {
  site = await startSite();
  [aa, aaa] = await Promise.all([
    audit(site.origin, { viewports: ['desktop'], paths: AA.map((p) => `/${p}.html`), concurrency: 3 }),
    audit(site.origin, { viewports: ['desktop'], level: 'AAA', paths: AAA.map((p) => `/${p}.html`), concurrency: 2 }),
  ]);
});
after(() => site.close());

test('a carousel that rotates by itself with no pause button fails 2.2.2', () => {
  const p = page(aa, AA, 'time-carousel');
  assert.deepEqual(found(p), [['failure', 'carousel-no-pause', '#news > div']]);
  assert.match(message(p, 'carousel-no-pause'), /still going after half a minute/);
});

test('text that keeps rewriting itself is a likely 2.2.2 problem', () => {
  assert.deepEqual(found(page(aa, AA, 'time-ticker')), [['likely', 'auto-update-no-pause', '#ticker']]);
});

test('an endless CSS animation is flagged, and the report says it stops under reduced motion', () => {
  const p = page(aa, AA, 'time-animation');
  assert.deepEqual(found(p), [['likely', 'animation-no-pause', '#marquee']]);
  assert.match(message(p, 'animation-no-pause'), /"slide" animation \(transform\) runs forever .* it stops when reduced motion is asked for/);
});

test('a large area flashing five times a second fails 2.3.1, and names the element', () => {
  const p = page(aa, AA, 'time-flash');
  // The flashing box is also restyled by a script forever, which 2.2.2 covers.
  assert.deepEqual(found(p), [['failure', 'flashing', '#strobe'], ['likely', 'animation-no-pause', '#strobe']]);
  assert.deepEqual(p.issues.find((i) => i.id === 'flashing').wcag, ['2.3.1', '2.3.2']);
  assert.match(message(p, 'flashing'), /above the general flash threshold$/);
});

test('a small flashing area passes 2.3.1 but fails 2.3.2 at AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'time-flash-small')), [['likely', 'animation-no-pause', '#dot']]);
  assert.deepEqual(found(page(aaa, AAA, 'time-flash-small')), [['failure', 'flashing-small', '#dot'], ['likely', 'animation-no-pause', '#dot']]);
});

test('a page that leaves by itself after ten minutes fails 2.2.1', () => {
  const p = page(aa, AA, 'time-redirect');
  assert.deepEqual(found(p), [['failure', 'page-changes-by-itself', 'html']]);
  assert.match(message(p, 'page-changes-by-itself'), /leaves for another address by itself after about 10 minutes/);
});

test('a page that reloads itself after five minutes fails 2.2.1 too', () => {
  const p = page(aa, AA, 'time-reload');
  assert.deepEqual(found(p), [['failure', 'page-changes-by-itself', 'html']]);
  assert.match(message(p, 'page-changes-by-itself'), /^the page reloads itself after about 5 minutes/);
});

test('a session that expires with no warning is a likely 2.2.1 problem', () => {
  const p = page(aa, AA, 'time-expire');
  assert.deepEqual(found(p), [['likely', 'timeout-no-warning', 'html']]);
  assert.match(message(p, 'timeout-no-warning'), /after about 15 minutes/);
});

test('a session that warns with a way to stay passes at AA; at AAA the time limit itself is flagged', () => {
  assert.deepEqual(found(page(aa, AA, 'time-warned')), []);
  const p = page(aaa, AAA, 'time-warned');
  assert.deepEqual(found(p), [['likely', 'timeout-warned', 'html']]);
  assert.match(message(p, 'timeout-warned'), /nothing on the page says up front how long that is/);
});

test('a popup that opens by itself is a note at AA and a likely 2.2.4 problem at AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'time-popup')), [['advice', 'timed-popup-note', '#popup']]);
  assert.deepEqual(found(page(aaa, AAA, 'time-popup')), [['likely', 'timed-popup', '#popup']]);
  assert.match(message(page(aaa, AAA, 'time-popup'), 'timed-popup'), /\("Join our newsletter"\) opened by itself after about 1 minute/);
});

test('motion on hover that ignores reduced motion is flagged at AAA only', () => {
  assert.deepEqual(found(page(aa, AA, 'time-motion')), []);
  assert.deepEqual(found(page(aaa, AAA, 'time-motion')), [['likely', 'motion-on-interaction', 'a.card']]);
});

test('moving things done right report nothing, at AA and AAA', () => {
  assert.deepEqual(found(page(aa, AA, 'time-clean')), []);
  assert.deepEqual(found(page(aaa, AAA, 'time-clean')), []);
  assert.ok([...aa.pages, ...aaa.pages].every((p) => !p.notes.some((n) => /could not/.test(n))), 'no timing check crashed');
});

// Frames as the screen recorder delivers them, drawn here so the thresholds can be pinned.
const frames = (seconds, every, [a, b]) => {
  const out = [];
  for (let t = 0, k = 0; t <= seconds + 1e-9; t += every, k++) {
    const data = Buffer.alloc(20 * 20 * 4);
    const [r, g, bl] = k % 2 ? b : a;
    for (let i = 0; i < data.length; i += 4) data.set([r, g, bl, 255], i);
    out.push({ time: t, width: 20, height: 20, data });
  }
  return out;
};

test('flash counting follows the WCAG thresholds', () => {
  // 20 frame pixels stand for 600 CSS pixels: the whole field of view.
  const black = [0, 0, 0], white = [255, 255, 255];
  const fast = analyzeFlashes(frames(2, 0.1, [black, white]), 30);
  assert.ok(fast.rate >= 4 && fast.generalField > 341 * 256 * 0.25, 'five flashes a second over the whole field');
  const slow = analyzeFlashes(frames(2, 0.5, [black, white]), 30);
  assert.equal(slow.rate, 0, 'one flash a second is allowed');
  // Light grey to white is a big change, but both are lighter than 0.8: not a flash.
  const light = analyzeFlashes(frames(2, 0.1, [[235, 235, 235], white]), 30);
  assert.equal(light.rate, 0);
  // Bright red to darker red: too small a change in luminance, but a red flash.
  const red = analyzeFlashes(frames(2, 0.1, [[255, 0, 0], [200, 0, 0]]), 30);
  assert.equal(red.generalField, 0);
  assert.ok(red.redField > 341 * 256 * 0.25);
});
