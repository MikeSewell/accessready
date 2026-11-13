#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit, exitCode, version, AccessReadyError, renderHtml } from '../src/index.mjs';
import { renderPage, renderSummary } from '../src/report/console.mjs';

const HELP = `accessready ${version}
WCAG 2.2 AA audit for a whole site, in real Chrome.

Usage
  accessready <url> [path ...] [options]

  accessready https://example.org              every page in /sitemap.xml
  accessready https://example.org / /donate    only these paths
  accessready https://example.org/donate       only this page
  accessready http://localhost:3000            a local build, before it ships

Options
  --html <file>          write a report a non-developer can read
  --json <file>          write the full results as JSON ("-" for stdout)
  --sitemap <url>        sitemap to read instead of <url>/sitemap.xml
  --max <n>              most pages to audit from a sitemap (default 40)
  --concurrency <n>      pages audited at once (default 2)
  --storage-state <file> Playwright storage state, to audit logged-in pages
  --viewport <WxH>       browser window size (default 1440x900)
  --max-tab-stops <n>    most Tab presses per page (default 150)
  --timeout <ms>         page load timeout (default 45000)
  --browser <name>       auto, chrome or chromium (default auto)
  --proxy <url>          send browser traffic through a proxy
  --no-dismiss           leave cookie banners alone instead of clicking Reject
  --strict               also fail on best-practice notes
  --no-color             plain output
  -v, --version
  -h, --help

Exit codes
  0  no failures
  1  failures found
  2  the audit could not finish (bad arguments, no browser, a page would not load)
`;

function fail(message) {
  console.error(`accessready: ${message}`);
  process.exit(2);
}

function positiveInt(value, flag) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) fail(`${flag} needs a whole number above 0, got "${value}"`);
  return n;
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      html: { type: 'string' },
      json: { type: 'string' },
      sitemap: { type: 'string' },
      max: { type: 'string', default: '40' },
      concurrency: { type: 'string', default: '2' },
      'storage-state': { type: 'string' },
      viewport: { type: 'string', default: '1440x900' },
      'max-tab-stops': { type: 'string', default: '150' },
      timeout: { type: 'string', default: '45000' },
      browser: { type: 'string', default: 'auto' },
      proxy: { type: 'string' },
      'no-dismiss': { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
      'no-color': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (e) {
  fail(`${e.message}\nRun accessready --help for usage.`);
}
const { values: flags, positionals } = parsed;

if (flags.version) { console.log(version); process.exit(0); }
if (flags.help) { console.log(HELP); process.exit(0); }
if (!positionals.length) { console.error(HELP); process.exit(2); }

const [target, ...paths] = positionals;
const size = /^(\d+)x(\d+)$/.exec(flags.viewport);
if (!size) fail(`--viewport needs WIDTHxHEIGHT, for example 390x844, got "${flags.viewport}"`);
if (!['auto', 'chrome', 'chromium'].includes(flags.browser)) fail(`--browser must be auto, chrome or chromium, got "${flags.browser}"`);
if (flags['storage-state'] && !existsSync(flags['storage-state'])) fail(`--storage-state file not found: ${flags['storage-state']}`);

const jsonToStdout = flags.json === '-';
const color = !flags['no-color'] && !process.env.NO_COLOR && !jsonToStdout && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
// With --json - the JSON owns stdout, so progress goes to stderr.
const say = jsonToStdout ? console.error : console.log;

function write(file, content) {
  const full = resolve(file);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, content);
  return full;
}

try {
  const result = await audit(target, {
    paths,
    sitemap: flags.sitemap || null,
    max: positiveInt(flags.max, '--max'),
    concurrency: positiveInt(flags.concurrency, '--concurrency'),
    storageState: flags['storage-state'] || null,
    viewport: { width: +size[1], height: +size[2] },
    maxTabStops: positiveInt(flags['max-tab-stops'], '--max-tab-stops'),
    timeout: positiveInt(flags.timeout, '--timeout'),
    browser: flags.browser,
    proxy: flags.proxy || null,
    dismiss: !flags['no-dismiss'],
    onPage: (page) => say(renderPage(page, { color }) + '\n'),
  });

  say(renderSummary(result, { color }));
  if (flags.html) say(`\nReport: ${write(flags.html, renderHtml(result))}`);
  if (jsonToStdout) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else if (flags.json) say(`JSON:   ${write(flags.json, JSON.stringify(result, null, 2) + '\n')}`);

  process.exit(exitCode(result, { strict: flags.strict }));
} catch (e) {
  if (e instanceof AccessReadyError) fail(e.message);
  throw e;
}
