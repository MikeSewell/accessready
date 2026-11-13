// Pointer criteria: 2.1.3 pointer-only input, 2.5.1 gestures, 2.5.2 press without release,
// 2.5.4 shaking, 2.5.5 target size at AAA, 2.5.6 touch-only controls, 2.5.7 dragging. Each
// pointer-* page plants one problem; pointer-clean has each feature done right.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules } from '../src/checks/pointer.mjs';
import { startSite, findings } from './helpers.mjs';

const OWN = new Set(Object.keys(rules));
const PAGES = ['pointer-clean', 'pointer-draw', 'pointer-swipe', 'pointer-gesture', 'pointer-press', 'pointer-shake', 'pointer-touch', 'pointer-drag', 'pointer-small'];
const AA_PAGES = ['pointer-draw', 'pointer-touch', 'pointer-small'];
const PHONE_PAGES = ['pointer-clean', 'pointer-swipe', 'pointer-touch', 'pointer-press'];
let site, aaa, aa, phone;
const mine = (result, list, name) => findings(result.pages[list.indexOf(name)], OWN);

before(async () => {
  site = await startSite();
  const run = (level, list, viewport = 'desktop') => audit(site.origin, { viewports: [viewport], level, paths: list.map((p) => `/${p}.html`), concurrency: 3 });
  aaa = await run('AAA', PAGES);
  aa = await run('AA', AA_PAGES);
  phone = await run('AAA', PHONE_PAGES, 'phone');
});
after(() => site.close());

test('pointer features done right report nothing, on desktop and phone', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-clean'), []);
  assert.deepEqual(mine(phone, PHONE_PAGES, 'pointer-clean'), []);
});

test('a signature pad with no keyboard path is flagged for 2.1.3, at AAA only', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-draw'), [['likely', 'pointer-only-input', '#pad']]);
  assert.deepEqual(mine(aa, AA_PAGES, 'pointer-draw'), []);
});

test('a carousel that only swipes, and a pinch handler with no buttons, are flagged (2.5.1)', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-swipe'), [['likely', 'swipe-only', '#stories']]);
  assert.deepEqual(mine(phone, PHONE_PAGES, 'pointer-swipe'), [['likely', 'swipe-only', '#stories']]);
  assert.deepEqual(mine(aaa, PAGES, 'pointer-gesture'), [['likely', 'multipoint-gesture', '#plan']]);
});

test('an action that fires on mouse down is flagged (2.5.2)', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-press'), [['likely', 'down-event-action', '#remove']]);
  assert.deepEqual(mine(phone, PHONE_PAGES, 'pointer-press'), [['likely', 'down-event-action', '#remove']]);
  assert.match(aaa.pages[PAGES.indexOf('pointer-press')].issues.find((i) => i.id === 'down-event-action').message, /^button "Remove item" changes the page as soon as the mouse button goes down/);
});

test('a page that reacts to shaking is flagged (2.5.4)', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-shake'), [['likely', 'motion-actuation', 'window']]);
  assert.match(aaa.pages[PAGES.indexOf('pointer-shake')].issues[0].message, /^shaking the device changes the page/);
});

test('a control that answers touch only is flagged at AAA (2.5.6)', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-touch'), [['likely', 'touch-only', '#like']]);
  assert.deepEqual(mine(phone, PHONE_PAGES, 'pointer-touch'), [['likely', 'touch-only', '#like']]);
  assert.deepEqual(mine(aa, AA_PAGES, 'pointer-touch'), []);
});

test('items that can only be dragged are flagged (2.5.7)', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-drag'), [['likely', 'drag-only', '#a'], ['likely', 'drag-only', '#b']]);
});

test('targets under 44px fail at AAA, except inline links, equivalents and native checkboxes', () => {
  assert.deepEqual(mine(aaa, PAGES, 'pointer-small'), [['failure', 'target-size-enhanced', '#tiny']]);
  assert.match(aaa.pages[PAGES.indexOf('pointer-small')].issues.find((i) => i.id === 'target-size-enhanced').message, /^button "Close" is 30 by 30 px/);
  assert.deepEqual(mine(aa, AA_PAGES, 'pointer-small'), []);
});
