// The parts every check relies on: how the views of a page are folded together, and the
// instrumentation installed in every page.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mergeViews, summarize, exitCode } from '../src/index.mjs';
import { instrument, listenerTypesSource } from '../src/instrument.mjs';

const view = (viewport, fields = {}) => ({
  url: 'https://example.org/', viewport, browser: 'chromium', status: 200, error: null, engine: 'axe-core 4.14.0',
  issues: [], needsReview: [], review: { title: 'Home' }, tabStops: 5, notes: [], timings: {}, ...fields,
});
const finding = (id, selector) => ({ id, kind: 'failure', selector, message: `${id} at ${selector}`, wcag: ['2.4.7'] });

test('a finding seen on every screen size is listed once, one seen on some says where', () => {
  const [page] = mergeViews([
    view('desktop', { issues: [finding('a', '#x'), finding('b', '#y')] }),
    view('phone', { issues: [finding('a', '#x')] }),
  ]);
  assert.deepEqual(page.issues.map((i) => [i.id, i.seenOn]), [['a', null], ['b', ['desktop']]]);
  assert.equal(page.error, null);
});

test('a screen size that could not be audited makes the page an error, and the rest still count', () => {
  const merged = mergeViews([
    view('desktop', { issues: [finding('a', '#x')] }),
    view('phone', { error: 'could not load: timeout', review: null, tabStops: 0 }),
  ]);
  const [page] = merged;
  assert.equal(page.error, 'phone: could not load: timeout');
  // Findings from the view that worked are not labelled "desktop only".
  assert.deepEqual(page.issues.map((i) => [i.id, i.seenOn]), [['a', null]]);
  assert.deepEqual(page.review, { title: 'Home' });
  assert.equal(page.tabStops, 5);
  assert.equal(exitCode({ totals: summarize(merged) }), 2);
});

test('the inventory comes from a view that worked, even when the first one failed', () => {
  const [page] = mergeViews([view('desktop', { error: 'server answered 503', review: null, tabStops: 0 }), view('phone')]);
  assert.deepEqual(page.review, { title: 'Home' });
  assert.equal(page.tabStops, 5);
  assert.equal(page.error, 'desktop: server answered 503');
});

let browser;
before(async () => { browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch()); });
after(() => browser?.close());

test('the instrumentation keeps listeners the way the browser does, and leaves subclasses alone', async () => {
  const context = await browser.newContext();
  await context.addInitScript(instrument);
  const page = await context.newPage();
  await page.setContent('<button id="b">Go</button>');
  const r = await page.evaluate((source) => {
    const typesOf = eval(source);
    const b = document.getElementById('b');
    const fn = () => {};
    b.addEventListener('click', fn);
    b.addEventListener('click', fn); // the same listener twice is one listener
    b.removeEventListener('click', fn);
    const afterRemove = typesOf(b);
    b.addEventListener('pointerdown', () => {}, { once: true });
    const beforeFire = typesOf(b);
    b.dispatchEvent(new PointerEvent('pointerdown'));
    const afterFire = typesOf(b);
    const ctrl = new AbortController();
    b.addEventListener('keydown', () => {}, { signal: ctrl.signal });
    const beforeAbort = typesOf(b);
    ctrl.abort();
    const afterAbort = typesOf(b);
    class Synth extends (window.AudioContext || window.webkitAudioContext) { tone() { return 'ok'; } }
    const synth = new Synth();
    return { afterRemove, beforeFire, afterFire, beforeAbort, afterAbort, subclass: synth instanceof Synth && synth.tone(), counted: window.__accessready_log.audioContexts };
  }, listenerTypesSource());
  assert.deepEqual(r.afterRemove, []);
  assert.deepEqual(r.beforeFire, ['pointerdown']);
  assert.deepEqual(r.afterFire, []);
  assert.deepEqual(r.beforeAbort, ['keydown']);
  assert.deepEqual(r.afterAbort, []);
  assert.equal(r.subclass, 'ok');
  assert.equal(r.counted, 1);
  await context.close();
});
