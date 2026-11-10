// The HTML report is an accessibility deliverable, so it is held to the same audit:
// no failures and no best-practice notes, in both its "problems found" and "all clear" forms.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit, renderHtml, renderConsole } from '../src/index.mjs';
import { startSite } from './helpers.mjs';

let site, failing, clean;
const reports = {};

before(async () => {
  site = await startSite({ '/report-failing': () => reports.failing, '/report-clean': () => reports.clean });
  failing = await audit(site.origin, { paths: ['/focus.html', '/rules.html', '/headings.html', '/obscured.html', '/nope.html'] });
  clean = await audit(`${site.origin}/clean.html`);
  reports.failing = renderHtml(failing);
  reports.clean = renderHtml(clean);
});
after(() => site.close());

test('the report passes its own audit when it lists problems', async () => {
  const r = await audit(`${site.origin}/report-failing`);
  assert.deepEqual(r.pages[0].issues, []);
  assert.equal(r.pages[0].error, null);
  assert.ok(r.pages[0].tabStops > 5, 'links and disclosure controls are reachable by keyboard');
});

test('the report passes its own audit when there is nothing to fix', async () => {
  const r = await audit(`${site.origin}/report-clean`);
  assert.deepEqual(r.pages[0].issues, []);
  assert.match(reports.clean, /The automated checks found nothing to fix\./);
  assert.match(reports.clean, /No problems found by the automated checks/);
});

test('the report groups problems by rule and escapes page content', () => {
  assert.match(reports.failing, /<h3>No visible focus indicator<\/h3>/);
  assert.match(reports.failing, /<h3>Focused element is hidden<\/h3>/);
  assert.match(reports.failing, /<h2>Worth improving<\/h2>/);
  assert.match(reports.failing, /&lt;a id=&quot;no-ring&quot;/);
  assert.doesNotMatch(reports.failing, /<a id="no-ring"/);
  assert.match(reports.failing, /server answered 404/);
});

test('console output lists every page and a failures-by-rule table', () => {
  const out = renderConsole(failing);
  assert.match(out, /^\/focus\.html {2}1 failure {2}1 best-practice note {2}5 tab stops$/m);
  assert.match(out, /^Failures by rule$/m);
  assert.match(out, /1 page could not be audited/);
  assert.doesNotMatch(out, /\x1b\[/, 'no color codes unless asked for');
});
