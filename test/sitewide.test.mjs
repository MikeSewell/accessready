// Checks that compare what pages offer across a site: ways to find pages (2.4.5), names of
// repeated links and controls (3.2.4) and where help sits (3.2.6). Each set of fixture pages
// is audited as its own small site.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { startSite } from './helpers.mjs';

let site;
const runs = {};
const found = (r) => r.pages.map((p) => [new URL(p.url).pathname, p.issues.map((i) => `${i.kind}:${i.id}`)]);
const set = (...names) => audit(site.origin, { viewports: ['desktop'], paths: names.map((n) => `/site-${n}.html`) });

before(async () => {
  site = await startSite();
  runs.consistent = await set('home', 'about', 'contact');
  runs.problems = await set('home', 'renamed', 'moved');
  runs.menuOnly = await set('plain-1', 'plain-2');
  runs.siteMap = await set('plain-1', 'sitemap');
  runs.steps = await set('step-1', 'step-2');
  runs.single = await audit(`${site.origin}/site-plain-1.html`, { viewports: ['desktop'] });
  runs.fromSitemap = await audit(site.origin, { viewports: ['desktop'], sitemap: `${site.origin}/sitemap-plain.xml`, max: 1 });
});
after(() => site.close());

test('pages with the same menu, search and help in the same places report nothing', () => {
  assert.deepEqual(found(runs.consistent), [['/site-home.html', []], ['/site-about.html', []], ['/site-contact.html', []]]);
});

test('a renamed footer link and search button are likely problems; moved help fails', () => {
  assert.deepEqual(found(runs.problems), [
    ['/site-home.html', []],
    ['/site-renamed.html', ['likely:inconsistent-identification', 'likely:inconsistent-identification']],
    ['/site-moved.html', ['failure:inconsistent-help']],
  ]);
  const [link, button] = runs.problems.pages[1].issues;
  assert.equal(link.message, 'the footer link to /site-contact.html is called "Get in touch" here but "Contact us" on /site-home.html, /site-moved.html');
  assert.equal(link.selector, 'footer > p > a:nth-of-type(3)');
  assert.equal(button.message, 'the search button is called "Go" here but "Search" on /site-home.html, /site-moved.html');
  const help = runs.problems.pages[2].issues[0];
  assert.match(help.message, /^"555-555-0100" comes before the main content here but after the main content on \/site-home\.html;/);
  assert.deepEqual(help.wcag, ['3.2.6']);
  assert.ok(runs.problems.pages.every((p) => p.issues.every((i) => i.scope === 'site')));
});

test('a site with only a menu is flagged once, on the first page', () => {
  assert.deepEqual(found(runs.menuOnly), [['/site-plain-1.html', ['likely:multiple-ways']], ['/site-plain-2.html', []]]);
  assert.match(runs.menuOnly.pages[0].issues[0].message, /^only one way to reach other pages was found \(a navigation menu\) on the 2 pages audited, in a site of 2 pages;/);
  assert.deepEqual(runs.menuOnly.pages[0].issues[0].wcag, ['2.4.5']);
});

test('a menu and a site map page are two ways', () => {
  assert.deepEqual(found(runs.siteMap), [['/site-plain-1.html', []], ['/site-sitemap.html', []]]);
});

test('steps in a process are exempt from multiple ways', () => {
  assert.deepEqual(found(runs.steps), [['/site-step-1.html', []], ['/site-step-2.html', []]]);
});

test('one page on its own is not a set of pages', () => {
  assert.deepEqual(found(runs.single), [['/site-plain-1.html', []]]);
});

test('pages in the sitemap count toward the site, even past --max', () => {
  assert.deepEqual(found(runs.fromSitemap), [['/site-plain-1.html', ['likely:multiple-ways']]]);
  assert.match(runs.fromSitemap.pages[0].issues[0].message, /on the 1 page audited, in a site of 2 pages;/);
});
