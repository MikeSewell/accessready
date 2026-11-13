// Every fixture page plants one kind of problem. These tests pin down exactly what is
// reported for each, so a check that goes quiet or starts over-reporting fails here.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { audit } from '../src/index.mjs';
import { checkReflow } from '../src/checks/layout.mjs';
import { startSite, ids, tripwires } from './helpers.mjs';

const PAGES = ['clean', 'focus', 'obscured', 'reflow', 'video', 'rules', 'headings', 'banner', 'frame', 'shadow', 'skiplink', 'popup', 'popup-behind', 'trap', 'unreachable', 'spacing', 'menu', 'toggle', 'overimage', 'inventory'];
// Pages that try to take the audit somewhere else, or hide overflow out of reach.
const STAY = ['interact-link-button', 'interact-menu-link', 'interact-pushstate', 'reflow-hidden'];
const wires = tripwires('/left.html');
let site, result, stay;
const page = (name) => result.pages[PAGES.indexOf(name)];
const stayed = (name) => stay.pages[STAY.indexOf(name)];

before(async () => {
  site = await startSite(wires.routes);
  result = await audit(site.origin, { viewports: ['desktop'], paths: PAGES.map((p) => `/${p}.html`), concurrency: 3 });
  stay = await audit(site.origin, { viewports: ['desktop'], paths: STAY.map((p) => `/${p}.html`) });
});
after(() => site.close());

test('a clean page reports nothing', () => {
  // The demo pages, taken together as a site, offer only a menu to find pages by. That
  // site-level finding (2.4.5) lands on the first page audited; the page itself is clean.
  assert.deepEqual(page('clean').issues.filter((i) => i.scope !== 'site'), []);
  assert.deepEqual(page('clean').issues.map((i) => [i.kind, i.id]), [['likely', 'multiple-ways']]);
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

test('overflow put out of reach by overflow-x: hidden is not sideways scrolling', () => {
  // An off-canvas menu parked at left: 100% under body { overflow-x: hidden } makes the page
  // wider than the window, but nobody can scroll to it.
  assert.deepEqual(ids(stayed('reflow-hidden')), []);
});

test('reflow puts the window back the size it was', async () => {
  // Checks that run after reflow on the same page must see the desktop layout, not 320px.
  const browser = await chromium.launch({ channel: 'chrome' });
  try {
    const p = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(`${site.origin}/reflow.html`);
    const found = await checkReflow(p);
    assert.deepEqual(found.map((i) => i.id), ['reflow']);
    assert.match(found[0].message, /at 320px wide/);
    assert.deepEqual(p.viewportSize(), { width: 1440, height: 900 });
    assert.equal(await p.evaluate(() => innerWidth), 1440);
  } finally {
    await browser.close();
  }
});

test('pressing Enter on a link with role="button" never takes the audit off the page', () => {
  const p = stayed('interact-link-button');
  assert.equal(p.error, null);
  // Reflow found the wide box, so it measured this page and not the one the link points at.
  assert.deepEqual(ids(p), ['reflow']);
  assert.match(p.issues.find((i) => i.id === 'reflow').message, /widest: #wide-box$/);
  assert.equal(wires.hits['/left.html'], 0);
});

test('a hover menu behind a link with role="button" is still tested, on the same page', () => {
  const p = stayed('interact-menu-link');
  assert.equal(p.error, null);
  assert.deepEqual(ids(p), ['hover-only-menu']);
  assert.match(p.issues.find((i) => i.id === 'hover-only-menu').message, /^the menu under "Programs" opens when the mouse hovers over it but not from the keyboard, so 2 links/);
  assert.equal(wires.hits['/left.html'], 0);
});

test('a button that rewrites the address sends the audit back to the audited page', () => {
  const p = stayed('interact-pushstate');
  assert.equal(p.error, null);
  assert.ok(p.notes.some((n) => /^the address changed to .*\/gallery-view while the page was being used, so it was loaded again/.test(n)), p.notes.join('; '));
  // Reflow measured the page as audited, with its wide box, not the view the button swapped in.
  assert.deepEqual(ids(p), ['reflow']);
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
  assert.match(p.notes[0], /^a popup \("Join our newsletter"\) opened during the audit and covered the page/);
  assert.deepEqual(p.issues, []);
});

test('links left behind a popup that opened mid-walk are not reported as hidden', () => {
  const p = page('popup-behind');
  assert.deepEqual(p.issues, []);
  assert.match(p.notes[0], /^a popup \("Join our newsletter"\) opened during the audit/);
});

test('a field that swallows Tab is a keyboard trap; a date field is not', () => {
  const p = page('trap');
  assert.deepEqual(p.issues.map((i) => [i.id, i.selector, i.wcag[0]]), [['keyboard-trap', '#sticky', '2.1.2']]);
  // The link, the date field (several Tab presses, one stop) and the field that traps.
  assert.equal(p.tabStops, 3);
});

test('controls that cannot take focus fail; a pointer cursor alone is a note', () => {
  const p = page('unreachable');
  assert.deepEqual(p.issues.filter((i) => i.kind === 'failure').map((i) => [i.id, i.selector]), [['keyboard-unreachable', '#fake-button'], ['keyboard-unreachable', '#inline-handler']]);
  // Not reported: the real button, the card with a link inside, the label, the toolbar item.
  assert.deepEqual(p.issues.filter((i) => i.kind === 'advice').map((i) => [i.id, i.selector]), [['looks-clickable', '#pointer-only']]);
  assert.equal(p.tabStops, 4);
});

test('text cut off by wider spacing is reported, text already cut off is not', () => {
  assert.deepEqual(page('spacing').issues.map((i) => [i.id, i.selector, i.wcag[0]]), [['text-spacing', '#tight-box', '1.4.12']]);
});

test('a menu that opens on hover only fails; focus and button menus pass', () => {
  const p = page('menu');
  assert.deepEqual(ids(p), ['hover-only-menu']);
  assert.match(p.issues[0].message, /^the menu under "Programs" opens when the mouse hovers over it but not from the keyboard, so 2 links cannot be reached/);
});

test('a button that only answers the mouse fails; a dialog that ignores focus is a note', () => {
  const p = page('toggle');
  assert.deepEqual(p.issues.map((i) => [i.kind, i.id, i.selector]), [
    ['failure', 'keyboard-activation', 'button "Shipping details"'],
    ['advice', 'dialog-focus', 'button "Contact us"'],
  ]);
  assert.deepEqual(p.notes, [], 'every button was closed again');
});

test('contrast over an image is measured: fails everywhere, passes everywhere, or mixed', () => {
  const p = page('overimage');
  assert.deepEqual(p.issues.map((i) => [i.id, i.selector]), [['contrast-on-image', '#faint']]);
  assert.match(p.issues[0].message, /reaches 1\.66:1 at best .* needs 4\.5:1$/);
  // #readable passed everywhere and is no longer waiting for review; #mixed still is.
  // A faint icon glyph is not text: it is left for a person, without a measurement.
  assert.deepEqual(p.review.contrast.map((c) => [c.selector, c.worst < 4.5, c.best > 4.5]), [['#icon', false, false], ['#mixed', true, true]]);
  assert.deepEqual(p.needsReview.map((r) => [r.id, r.count]), [['color-contrast', 2]]);
});

test('the inventory lists what a person has to look at', () => {
  const r = page('inventory').review;
  assert.deepEqual(r.images.map((i) => [new URL(i.src).pathname, i.alt]), [['/photo.png', 'Volunteers sorting food donations'], ['/photo.png', '']]);
  assert.deepEqual(r.vagueLinks.map((l) => l.text), ['Click here']);
  assert.deepEqual(r.forms, [{ name: 'Newsletter sign-up', fields: 2, required: 1 }]);
  assert.deepEqual(r.headings, [{ level: 1, text: 'Things a person checks' }, { level: 2, text: 'Our work' }]);
  assert.equal(r.title, 'Things a person checks');
  assert.deepEqual(page('video').review.media.map((m) => [m.kind, m.background, m.captions]), [['video', true, false], ['video', true, false]]);
});

test('totals add up', () => {
  // Three likely problems: the demo pages taken as one site offer only a menu (2.4.5);
  // focus.html's wrapper ring is a pale yellow tint (#ffe08a on white, about 1.3:1) that 2.4.7
  // accepts as visible and 1.4.11 flags as too faint; inventory.html's required Email field is
  // not marked as required.
  assert.deepEqual(result.totals, { pages: 20, failures: 15, likely: 3, advice: 4, needsReview: result.totals.needsReview, errors: 0 });
  assert.equal(result.standard, 'WCAG 2.2 AA');
  assert.match(result.engine, /^axe-core \d+\.\d+\.\d+$/);
});

test('pages are compared with each other: navigation order and shared titles', async () => {
  const r = await audit(site.origin, { viewports: ['desktop'], paths: ['/nav-a.html', '/nav-b.html', '/nav-c.html', '/nav-d.html'] });
  const found = r.pages.map((p) => p.issues.map((i) => `${i.kind}:${i.id}`));
  // a and b share a title; c lists Donate before Programs; d only drops a link, which is fine.
  // The menu is the only way to find pages, which is flagged once, on the first page (2.4.5).
  assert.deepEqual(found, [['advice:duplicate-title', 'likely:multiple-ways'], ['advice:duplicate-title'], ['failure:inconsistent-navigation'], []]);
  assert.match(r.pages[2].issues[0].message, /"Programs" in a different place .* \(usual order: Home, Programs, Donate, Contact\)$/);
  assert.ok(r.pages.every((p) => p.issues.every((i) => i.scope === 'site')));
  assert.deepEqual(r.totals, { pages: 4, failures: 1, likely: 1, advice: 2, needsReview: 0, errors: 0 });
});

test('a menu that lists a label twice, the same way on every page, is not reported as reordered', async () => {
  // Home, Donate, About, Programs, Donate: the second Donate is a button at the end.
  const r = await audit(site.origin, { viewports: ['desktop'], paths: ['/nav-repeat-a.html', '/nav-repeat-b.html'] });
  assert.deepEqual(r.pages.map((p) => p.review.nav), [['Home', 'Donate', 'About', 'Programs', 'Donate'], ['Home', 'Donate', 'About', 'Programs', 'Donate']]);
  assert.deepEqual(r.pages.map((p) => p.issues.filter((i) => i.id === 'inconsistent-navigation')), [[], []]);
});

test('with dismissal off, the banner is reported as covering the page', async () => {
  const r = await audit(`${site.origin}/banner.html`, { viewports: ['desktop'], dismiss: false });
  assert.equal(r.discovery, 'single page');
  assert.deepEqual(ids(r.pages[0]), ['focus-not-obscured']);
  assert.match(r.pages[0].issues[0].message, /#cookie-banner/);
});

test('the tab stop limit is honoured and reported', async () => {
  const r = await audit(`${site.origin}/focus.html`, { viewports: ['desktop'], maxTabStops: 2 });
  assert.equal(r.pages[0].tabStops, 2);
  assert.deepEqual(r.pages[0].notes, ['stopped after 2 tab stops; the rest of the page was not walked']);
});
