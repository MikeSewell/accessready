// The command line as a user runs it: arguments, sitemap discovery, files written, exit codes.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/focuswalk.mjs', import.meta.url));
let site, dir;

before(async () => { site = await startSite(); dir = mkdtempSync(join(tmpdir(), 'focuswalk-test-')); });
after(async () => { await site.close(); rmSync(dir, { recursive: true, force: true }); });

function run(...args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

test('exits 0 on a clean page', async () => {
  const r = await run(`${site.origin}/clean.html`);
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\/clean\.html {2}no failures/);
  assert.match(r.stdout, /No automated WCAG 2\.2 AA failures across 1 page {2}\(single page\)/);
});

test('exits 1 when a page has failures', async () => {
  const r = await run(site.origin, '/reflow.html');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /FAIL {2}Page scrolls sideways at 320px wide {2}1\.4\.10 Reflow · reflow/);
});

test('best-practice notes fail only with --strict', async () => {
  assert.equal((await run(`${site.origin}/headings.html`)).code, 0);
  assert.equal((await run(`${site.origin}/headings.html`, '--strict')).code, 1);
});

test('with no paths it reads the sitemap, drops duplicates and stays on the audited host', async () => {
  const r = await run(site.origin);
  assert.equal(r.code, 1);
  assert.match(r.stdout, /\/clean\.html {2}no failures/);
  assert.match(r.stdout, /\/reflow\.html {2}1 failure/);
  assert.match(r.stdout, /across 2 pages {2}\(sitemap \(2 pages\)\)/);
});

test('--max limits the pages taken from the sitemap', async () => {
  const r = await run(site.origin, '--max', '1');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /across 1 page {2}\(sitemap \(2 pages, first 1 audited\)\)/);
});

test('--sitemap follows a sitemap index', async () => {
  const r = await run(site.origin, '--sitemap', `${site.origin}/sitemap-index.xml`);
  assert.match(r.stdout, /across 3 pages {2}\(sitemap \(3 pages\)\)/);
  assert.match(r.stdout, /\/headings\.html {2}no failures/);
});

test('a site with no sitemap falls back to the home page and says so', async () => {
  const r = await run(site.origin, '--sitemap', `${site.origin}/missing.xml`);
  assert.equal(r.code, 0);
  assert.match(r.stdout, /across 1 page {2}\(no sitemap at .*\/missing\.xml; home page only\)/);
});

test('a page that will not load exits 2', async () => {
  const r = await run(site.origin, '/clean.html', '/nope.html');
  assert.equal(r.code, 2);
  assert.match(r.stdout, /\/nope\.html {2}server answered 404/);
  assert.match(r.stdout, /1 page could not be audited/);
});

test('--json - prints only JSON on stdout', async () => {
  const r = await run(`${site.origin}/rules.html`, '--json', '-');
  assert.equal(r.code, 1);
  const data = JSON.parse(r.stdout);
  assert.equal(data.tool, 'focuswalk');
  assert.equal(data.totals.failures, 3);
  assert.equal(data.pages[0].issues[0].source, 'axe');
  assert.match(r.stderr, /3 WCAG 2\.2 AA failures/);
});

test('--json and --html write files, creating folders as needed', async () => {
  const json = join(dir, 'nested', 'out.json'), html = join(dir, 'nested', 'report.html');
  const r = await run(`${site.origin}/focus.html`, '--json', json, '--html', html);
  assert.equal(r.code, 1);
  assert.equal(JSON.parse(readFileSync(json, 'utf8')).pages[0].tabStops, 5);
  const report = readFileSync(html, 'utf8');
  assert.match(report, /<h3>No visible focus indicator<\/h3>/);
  assert.match(report, /2\.4\.7 Focus Visible · 1 place on 1 page/);
});

test('bad arguments exit 2 with a message, before any browser starts', async () => {
  for (const [args, message] of [
    [[], /Usage/],
    [['not-a-url'], /Not a URL: not-a-url/],
    [['ftp://example.org'], /Only http and https URLs/],
    [[site.origin, '--max', '0'], /--max needs a whole number above 0/],
    [[site.origin, '--viewport', 'big'], /--viewport needs WIDTHxHEIGHT/],
    [[site.origin, '--browser', 'firefox'], /--browser must be auto, chrome or chromium/],
    [[site.origin, '--storage-state', join(dir, 'missing.json')], /--storage-state file not found/],
    [[site.origin, '--nonsense'], /Unknown option '--nonsense'/],
  ]) {
    const r = await run(...args);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, message);
  }
});

test('--version and --help exit 0', async () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal((await run('--version')).stdout.trim(), pkg.version);
  const help = await run('--help');
  assert.equal(help.code, 0);
  assert.match(help.stdout, /Exit codes/);
});

test('findings from comparing pages are printed once, under "Across the site"', async () => {
  const r = await run(site.origin, '/nav-a.html', '/nav-b.html', '/nav-c.html');
  assert.equal(r.code, 1);
  assert.match(r.stdout, /^\/nav-c\.html {2}no failures {2}4 tab stops$/m);
  assert.match(r.stdout, /Across the site\n {2}note {2}\/nav-a\.html {2}Page title is shared with another page/);
  assert.match(r.stdout, /FAIL {2}\/nav-c\.html {2}Navigation is in a different order on this page {2}3\.2\.3 Consistent Navigation/);
  assert.match(r.stdout, /1 WCAG 2\.2 AA failure across 3 pages/);
});
