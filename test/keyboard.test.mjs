// The keyboard walk's newer checks: focus indicators (1.4.11, 2.4.13), focus partly covered
// (2.4.12), focus order (2.4.3) and changes on focus (3.2.1), plus single-key shortcuts
// (2.1.4). Each kb-* page plants one problem; kb-clean must stay clean even at AAA.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { startSite, tripwires, findings } from './helpers.mjs';

const OWN = new Set(['focus-indicator-contrast', 'focus-appearance', 'focus-partly-obscured', 'focus-order', 'focus-changes-context', 'character-shortcut']);
const PAGES = ['kb-clean', 'kb-focus-faint', 'kb-focus-thin', 'kb-partly-covered', 'kb-order-jump', 'kb-order-tabindex', 'kb-focus-navigates', 'kb-focus-beacon', 'kb-focus-window', 'kb-focus-dialog', 'kb-shortcut', 'kb-head-script', 'kb-offscreen', 'popup', 'unreachable', 'focus'];
// Pages whose findings differ by level, audited again at AA.
const AA_PAGES = ['kb-clean', 'kb-focus-faint', 'kb-focus-thin', 'kb-partly-covered'];
const wires = tripwires('/left.html');
let site, aaa, aa;
const at = (result, list, name) => result.pages[list.indexOf(name)];
const mine = (name, level = 'AAA') => findings(level === 'AAA' ? at(aaa, PAGES, name) : at(aa, AA_PAGES, name), OWN);

before(async () => {
  site = await startSite(wires.routes);
  const run = (level, list) => audit(site.origin, { viewports: ['desktop'], level, paths: list.map((p) => `/${p}.html`), concurrency: 3 });
  aaa = await run('AAA', PAGES);
  aa = await run('AA', AA_PAGES);
});
after(() => site.close());

test('strong indicators on a clean page report nothing, even at AAA', () => {
  assert.deepEqual(mine('kb-clean'), []);
  assert.deepEqual(mine('kb-clean', 'AA'), []);
  assert.equal(at(aaa, PAGES, 'kb-clean').tabStops, 3);
});

test('a pale tint for focus is too faint (1.4.11), and too small at AAA (2.4.13)', () => {
  assert.deepEqual(mine('kb-focus-faint', 'AA'), [['likely', 'focus-indicator-contrast', '#faint']]);
  assert.deepEqual(mine('kb-focus-faint'), [['failure', 'focus-appearance', '#faint'], ['likely', 'focus-indicator-contrast', '#faint']]);
  assert.match(at(aa, AA_PAGES, 'kb-focus-faint').issues.find((i) => i.id === 'focus-indicator-contrast').message, /reaches only 1\.\d+:1 .* needs 3:1$/);
});

test('a 1px ring has contrast but not the area of a 2px outline: AAA only', () => {
  assert.deepEqual(mine('kb-focus-thin', 'AA'), []);
  assert.deepEqual(mine('kb-focus-thin'), [['failure', 'focus-appearance', '#thin']]);
  assert.match(at(aaa, PAGES, 'kb-focus-thin').issues.find((i) => i.id === 'focus-appearance').message, /covers \d+ square px, less than the \d+ square px of a 2px outline/);
});

test('the browser default ring and rings drawn outside the element are not judged weak', () => {
  // focus.html: the default ring (exempt) and a 3px pseudo-element ring pass. The pale
  // yellow wrapper is the one weak indicator.
  assert.deepEqual(mine('focus').filter(([, id]) => id === 'focus-indicator-contrast'), [['likely', 'focus-indicator-contrast', '#wrapper-ring']]);
});

test('focus partly under a fixed bar fails 2.4.12 at AAA and passes 2.4.11', () => {
  assert.deepEqual(mine('kb-partly-covered', 'AA'), []);
  assert.deepEqual(mine('kb-partly-covered'), [['failure', 'focus-partly-obscured', '#tall']]);
  const p = at(aaa, PAGES, 'kb-partly-covered');
  assert.match(p.issues.find((i) => i.id === 'focus-partly-obscured').message, /partly covered by #bar \(position: fixed\)/);
  assert.ok(!p.issues.some((i) => i.id === 'focus-not-obscured'), 'not entirely hidden, so 2.4.11 passes');
});

test('focus that lands off screen is a 2.4.7 problem, not 2.4.11', () => {
  // 2.4.11 is about focus hidden behind content the author put over it. A link moved off
  // screen with a transform cannot be seen at all, which is Focus Visible.
  const p = at(aaa, PAGES, 'kb-offscreen');
  const offscreen = p.issues.filter((i) => i.selector === '#hidden-link' && /^focus-/.test(i.id));
  assert.deepEqual(offscreen.map((i) => [i.kind, i.id, i.wcag]), [['failure', 'focus-visible', ['2.4.7']]]);
  assert.match(offscreen[0].message, /^a "Side menu link" takes keyboard focus while off screen/);
  assert.ok(!p.issues.some((i) => i.id === 'focus-not-obscured'), 'nothing covers it, so 2.4.11 is not named');
});

test('a stop drawn far down the page between two neighbours is a likely order problem', () => {
  assert.deepEqual(mine('kb-order-jump'), [['likely', 'focus-order', '#far']]);
  assert.match(at(aaa, PAGES, 'kb-order-jump').issues.find((i) => i.id === 'focus-order').message, /^Tab goes from a "First link" to a "Link drawn far below", \d+px further down the page, then back to a "Second link"$/);
});

test('a positive tabindex is named with the sequence it causes', () => {
  assert.deepEqual(mine('kb-order-tabindex'), [['likely', 'focus-order', '#donate']]);
  assert.match(at(aaa, PAGES, 'kb-order-tabindex').issues.find((i) => i.id === 'focus-order').message, /Tab visits a "Donate", then a "Home", then a "About"$/);
});

test('focus that loads a page fails 3.2.1, and the page load never reaches the server', () => {
  const p = at(aaa, PAGES, 'kb-focus-navigates');
  assert.deepEqual(mine('kb-focus-navigates'), [['failure', 'focus-changes-context', '#jump']]);
  assert.match(p.issues.find((i) => i.id === 'focus-changes-context').message, /loads http:\/\/127\.0\.0\.1:\d+\/left\.html\?from=focus as soon as it takes keyboard focus/);
  // The walk stayed on the page and finished it.
  assert.equal(p.tabStops, 2);
  assert.equal(wires.hits['/left.html'], 0);
});

test('background writes from analytics do not hide a 3.2.1 failure', () => {
  assert.deepEqual(mine('kb-focus-beacon'), [['failure', 'focus-changes-context', '#jump']]);
});

test('focus that opens a window, or a dialog that takes focus, fails 3.2.1', () => {
  assert.deepEqual(mine('kb-focus-window'), [['failure', 'focus-changes-context', '#help']]);
  assert.deepEqual(mine('kb-focus-dialog'), [['failure', 'focus-changes-context', '#email']]);
  assert.match(at(aaa, PAGES, 'kb-focus-dialog').issues.find((i) => i.id === 'focus-changes-context').message, /^input "Email" opens "Join our newsletter" as soon as it takes keyboard focus and moves focus into it$/);
});

test('a popup that is not caused by focus is not a 3.2.1 failure', () => {
  // popup.html opens on the second Tab press whatever has focus: a stand-in for a timed popup.
  assert.deepEqual(mine('popup'), []);
});

test('a single-letter shortcut on the document is flagged (2.1.4)', () => {
  assert.deepEqual(mine('kb-shortcut'), [['likely', 'character-shortcut', 'document']]);
  assert.match(at(aaa, PAGES, 'kb-shortcut').issues.find((i) => i.id === 'character-shortcut').message, /pressing "s" moves focus to input "Search"/);
  // Tags a script adds to <head> on every key press change nothing anyone sees.
  assert.deepEqual(mine('kb-head-script'), []);
});

test('keyboard failures count for 2.1.3 as well as 2.1.1', () => {
  const p = at(aaa, PAGES, 'unreachable');
  assert.deepEqual(p.issues.find((i) => i.id === 'keyboard-unreachable').wcag, ['2.1.1', '2.1.3']);
});
