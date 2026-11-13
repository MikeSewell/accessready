#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit, exitCode, version, AccessReadyError, renderHtml, VIEWPORTS, BROWSERS } from '../src/index.mjs';
import { renderPage, renderSummary } from '../src/report/console.mjs';
import { resolveAi, PROVIDERS } from '../src/ai/providers.mjs';
import { describePlan, renderAiConsole } from '../src/ai/review.mjs';

const HELP = `accessready ${version}
WCAG 2.2 audit for a whole site: every page, on a phone and a desktop screen.

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
  --level <A|AA|AAA>     WCAG level to check against (default AA)
  --viewports <list>     screen sizes: desktop, phone, or WIDTHxHEIGHT, comma separated
                         (default desktop,phone)
  --viewport <WxH>       one screen size only, for example 768x1024
  --max-tab-stops <n>    most Tab presses per page (default 150)
  --timeout <ms>         page load timeout (default 45000)
  --browser <list>       auto, chrome, chromium, firefox, webkit, or all; comma separated
                         (default auto: installed Chrome, else Playwright's Chromium)
  --proxy <url>          send browser traffic through a proxy
  --no-dismiss           leave cookie banners alone instead of clicking Reject
  --strict               also fail on likely problems and best-practice notes
  --no-color             plain output
  -v, --version
  -h, --help

AI review (optional; you choose the provider and pay it yourself)
  --ai <provider:model>  also judge wording and meaning with a model: image descriptions,
                         images of text, link text, headings, labels, page titles,
                         instructions that rely on color or shape, and names that change
                         between pages. Providers:
                           anthropic:<model>          key in ANTHROPIC_API_KEY
                           openai:<model>             key in OPENAI_API_KEY
                           gemini:<model>             key in GEMINI_API_KEY
                           lmstudio:<model>           LM Studio at http://localhost:1234/v1
                           ollama:<model>             Ollama at http://localhost:11434/v1
                           openai-compatible:<model>  any Chat Completions server, with
                                                      --ai-base-url
                         ACCESSREADY_AI_KEY is used for any provider when set. The model
                         name is the one your provider lists, for example
                         ollama:qwen2.5vl:7b.
  --ai-base-url <url>    send AI requests here instead of the provider's usual address
  --ai-max-requests <n>  most AI requests in one run (default 50; 0 uses only the cache)
  --ai-no-cache          ask again instead of reusing answers kept in .accessready-cache/ai
  --ai-no-images         send no images, only text (for text-only models)

  The AI review sends each page's text, links, headings, form labels and images (scaled
  down) to the provider you name. Do not use it on pages whose content must not leave
  your machine, unless the model runs locally. Its findings are likely problems for a
  person to confirm, marked as AI judgments; they never fail the run unless --strict is
  set.

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
      viewport: { type: 'string' },
      viewports: { type: 'string', default: 'desktop,phone' },
      level: { type: 'string', default: 'AA' },
      'max-tab-stops': { type: 'string', default: '150' },
      timeout: { type: 'string', default: '45000' },
      browser: { type: 'string', default: 'auto' },
      proxy: { type: 'string' },
      'no-dismiss': { type: 'boolean', default: false },
      ai: { type: 'string' },
      'ai-base-url': { type: 'string' },
      'ai-max-requests': { type: 'string' },
      'ai-no-cache': { type: 'boolean', default: false },
      'ai-no-images': { type: 'boolean', default: false },
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
if (flags.viewport && !/^\d+x\d+$/.test(flags.viewport)) fail(`--viewport needs WIDTHxHEIGHT, for example 390x844, got "${flags.viewport}"`);
const viewports = flags.viewport ? [flags.viewport] : flags.viewports.split(',').map((v) => v.trim()).filter(Boolean);
for (const v of viewports) if (!VIEWPORTS[v] && !/^\d+x\d+$/.test(v)) fail(`--viewports takes desktop, phone or WIDTHxHEIGHT, got "${v}"`);
const browsers = flags.browser === 'all' ? ['auto', 'firefox', 'webkit'] : flags.browser.split(',').map((b) => b.trim());
for (const b of browsers) if (b !== 'auto' && !BROWSERS.includes(b)) fail(`--browser takes auto, ${BROWSERS.join(', ')} or all, got "${b}"`);
const level = flags.level.toUpperCase();
if (!['A', 'AA', 'AAA'].includes(level)) fail(`--level must be A, AA or AAA, got "${flags.level}"`);
if (flags['storage-state'] && !existsSync(flags['storage-state'])) fail(`--storage-state file not found: ${flags['storage-state']}`);

// The AI review is checked here, before any browser starts, so a missing key or a typo in
// the provider costs nothing.
let ai = null;
for (const f of ['ai-base-url', 'ai-max-requests', 'ai-no-cache', 'ai-no-images']) {
  if (!flags.ai && (flags[f] !== undefined && flags[f] !== false)) fail(`--${f} needs --ai <provider:model>`);
}
if (flags.ai !== undefined) {
  if (!flags.ai.includes(':')) fail(`--ai needs provider:model, for example anthropic:<model>; providers are ${Object.keys(PROVIDERS).join(', ')}`);
  const max = flags['ai-max-requests'];
  if (max !== undefined && !/^\d+$/.test(max)) fail(`--ai-max-requests needs a whole number, got "${max}"`);
  ai = {
    use: flags.ai,
    baseUrl: flags['ai-base-url'],
    maxRequests: max === undefined ? undefined : Number(max),
    cache: !flags['ai-no-cache'],
    images: !flags['ai-no-images'],
  };
  const { error } = resolveAi(ai);
  if (error) fail(`--ai: ${error}`);
}

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
    viewports,
    level,
    maxTabStops: positiveInt(flags['max-tab-stops'], '--max-tab-stops'),
    timeout: positiveInt(flags.timeout, '--timeout'),
    browsers,
    proxy: flags.proxy || null,
    dismiss: !flags['no-dismiss'],
    ai: ai && { ...ai, onPlan: (plan) => say(describePlan(plan) + '\n') },
    onPage: (page) => say(renderPage(page, { color }) + '\n'),
  });

  if (result.ai) say(renderAiConsole(result, { color }) + '\n');
  say(renderSummary(result, { color }));
  if (flags.html) say(`\nReport: ${write(flags.html, renderHtml(result))}`);
  if (jsonToStdout) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else if (flags.json) say(`JSON:   ${write(flags.json, JSON.stringify(result, null, 2) + '\n')}`);

  process.exit(exitCode(result, { strict: flags.strict }));
} catch (e) {
  if (e instanceof AccessReadyError) fail(e.message);
  throw e;
}
