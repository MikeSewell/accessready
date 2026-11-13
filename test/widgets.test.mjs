// Widgets operated in a fresh copy of the page: 4.1.2 states, arrow keys and dialogs, the
// skip link (2.4.1), changes on input (3.2.2), content on hover (1.4.13) and new windows
// (3.2.5). Each widget-* page plants one problem; widget-clean has every widget done right.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules } from '../src/checks/widgets.mjs';
import { startSite, tripwires, findings } from './helpers.mjs';

const OWN = new Set(Object.keys(rules));
const PAGES = ['widget-clean', 'widget-disclosure', 'widget-switch', 'widget-tabs', 'widget-tabs-arrows', 'widget-menu-arrows', 'widget-dialog-escape', 'widget-dialog-focus',
  'widget-skip-missing', 'widget-skip-swallowed', 'widget-onchange', 'widget-onchange-login', 'widget-tooltip-escape', 'widget-tooltip-hover', 'widget-tooltip-timeout',
  'widget-newtab', 'widget-popup-onload', 'skiplink', 'toggle', 'menu'];
const AA_PAGES = ['widget-clean', 'widget-newtab', 'widget-popup-onload'];
const wires = tripwires('/login', '/results.html');
let site, aaa, aa;
const page = (name) => aaa.pages[PAGES.indexOf(name)];
const mine = (name) => findings(page(name), OWN);
const message = (name, id) => page(name).issues.find((i) => i.id === id).message;

before(async () => {
  site = await startSite(wires.routes);
  const run = (level, list) => audit(site.origin, { viewports: ['desktop'], level, paths: list.map((p) => `/${p}.html`), concurrency: 3 });
  aaa = await run('AAA', PAGES);
  aa = await run('AA', AA_PAGES);
});
after(() => site.close());

test('every widget done right reports nothing, even at AAA', () => {
  assert.deepEqual(mine('widget-clean'), []);
  assert.deepEqual(findings(aa.pages[0], OWN), []);
  // The older fixtures with working skip links, buttons and menus stay clean too.
  for (const name of ['skiplink', 'toggle', 'menu']) assert.deepEqual(mine(name), [], name);
});

test('a disclosure whose aria-expanded never changes fails 4.1.2', () => {
  assert.deepEqual(mine('widget-disclosure'), [['failure', 'disclosure-state', '#faq']]);
  assert.match(message('widget-disclosure', 'disclosure-state'), /aria-expanded stays "false"/);
});

test('a switch that moves but keeps aria-checked fails 4.1.2', () => {
  assert.deepEqual(mine('widget-switch'), [['failure', 'toggle-state', '#alerts']]);
});

test('a tab whose aria-selected does not move fails 4.1.2', () => {
  assert.deepEqual(mine('widget-tabs').map(([k, id]) => [k, id]), [['failure', 'tab-state']]);
  assert.match(message('widget-tabs', 'tab-state'), /^clicking tab 2 of div "Programs" changes what is shown, but aria-selected stays on tab 1/);
});

test('tabs and menu items reachable only by arrow keys that do nothing fail 2.1.1', () => {
  assert.deepEqual(mine('widget-tabs-arrows').map(([k, id]) => [k, id]), [['failure', 'widget-arrow-keys']]);
  assert.match(message('widget-tabs-arrows', 'widget-arrow-keys'), /1 of its 2 tabs is left out of the Tab order/);
  assert.deepEqual(mine('widget-menu-arrows').map(([k, id]) => [k, id]), [['failure', 'widget-arrow-keys']]);
  assert.match(message('widget-menu-arrows', 'widget-arrow-keys'), /2 of its 3 items are left out of the Tab order/);
});

test('a dialog Escape does not close is a note; one that drops focus on closing is flagged', () => {
  assert.deepEqual(mine('widget-dialog-escape'), [['advice', 'dialog-escape', '#open']]);
  assert.deepEqual(mine('widget-dialog-focus'), [['likely', 'dialog-focus-return', '#open']]);
});

test('a skip link to a missing target, or one that does not move focus, fails 2.4.1', () => {
  assert.deepEqual(mine('widget-skip-missing').map(([k, id]) => [k, id]), [['failure', 'skip-link-broken']]);
  assert.match(message('widget-skip-missing', 'skip-link-broken'), /points at #main, but nothing on the page has that id/);
  assert.deepEqual(mine('widget-skip-swallowed').map(([k, id]) => [k, id]), [['failure', 'skip-link-broken']]);
  assert.match(message('widget-skip-swallowed', 'skip-link-broken'), /puts focus back before #content/);
});

test('a dropdown that loads a page is flagged (3.2.2), and nothing reaches the server', () => {
  assert.deepEqual(mine('widget-onchange'), [['likely', 'change-on-input', '#sort']]);
  assert.match(message('widget-onchange', 'change-on-input'), /loads http:\/\/127\.0\.0\.1:\d+\/results\.html\?sort=old straight away/);
  assert.equal(wires.hits['/results.html'], 0);
});

test('a login form is never operated, so its auto-submitting checkbox never sends', () => {
  assert.deepEqual(mine('widget-onchange-login'), []);
  assert.equal(wires.hits['/login'], 0);
});

test('tooltips that cannot be dismissed, hovered or kept fail 1.4.13', () => {
  assert.deepEqual(mine('widget-tooltip-escape'), [['failure', 'hover-content-dismiss', '#info']]);
  assert.deepEqual(mine('widget-tooltip-hover'), [['failure', 'hover-content-hoverable', '#info']]);
  assert.deepEqual(mine('widget-tooltip-timeout'), [['failure', 'hover-content-persistent', '#info']]);
});

test('a new-window link that does not say so is flagged at AAA only (3.2.5)', () => {
  assert.deepEqual(mine('widget-newtab'), [['likely', 'new-window-unannounced', '#quiet']]);
  assert.deepEqual(findings(aa.pages[1], OWN), []);
});

test('a window opened by script on load fails 3.2.1 and 3.2.5, at every level', () => {
  assert.deepEqual(mine('widget-popup-onload'), [['failure', 'window-opened-unasked', 'window.open']]);
  assert.deepEqual(findings(aa.pages[2], OWN), [['failure', 'window-opened-unasked', 'window.open']]);
  assert.deepEqual(aa.pages[2].issues.find((i) => i.id === 'window-opened-unasked').wcag, ['3.2.1', '3.2.5']);
});
