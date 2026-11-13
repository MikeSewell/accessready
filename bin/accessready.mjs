#!/usr/bin/env node
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { audit, exitCode, summarize, version, AccessReadyError, renderHtml, VIEWPORTS, BROWSERS } from '../src/index.mjs';
import { renderPage, renderSummary } from '../src/report/console.mjs';
import { loadConfig, ignoreOnPage, ConfigError, CONFIG_FILE } from '../src/adopt/config.mjs';
import { readBaseline, baselineFile, compareWithBaseline, baselineExitCode, BaselineError } from '../src/adopt/baseline.mjs';
import { toSarif } from '../src/adopt/sarif.mjs';
import { resolveAi } from '../src/ai/providers.mjs';
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
  --sarif <file>         write SARIF 2.1.0, for GitHub code scanning
  --config <file>        options and ignored findings from a JSON file
                         (default: ./accessready.config.json if it exists)
  --baseline <file>      fail only on findings that are not in this saved baseline
  --update-baseline      save the current findings to the --baseline file
  --sitemap <url>        sitemap to read instead of <url>/sitemap.xml
  --max <n>              most pages to audit from a sitemap (default 40)
  --concurrency <n>      pages audited at once (default 2)
  --storage-state <file> Playwright storage state, to audit logged-in pages
  --level <A|AA|AAA>     WCAG level to check against (default AA)
  --viewports <list>     screen sizes: desktop, phone, or WIDTHxHEIGHT, comma separated
                         (default desktop,phone)
  --viewport <WxH>       one screen size only, for example 768x1024
  --max-tab-stops <n>    most Tab presses per page (default 150)
  --rate <n>             most requests a second to the audited site, after a short burst
                         (default 8; 0 for no limit). Assets are fetched once per audit
                         and the audit slows down by itself if the site says it is busy
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
                         Or use a coding-agent CLI you already pay for. It runs headless
                         with the account it is logged in to, read-only, with its file
                         and command tools off where the CLI allows, in an empty
                         temporary folder. The model is optional (the CLI's default):
                           claude-code[:<model>]      Claude Code (claude)
                           codex[:<model>]            OpenAI Codex (codex)
                           gemini-cli[:<model>]       Gemini CLI (gemini), text only
                           qwen-code[:<model>]        Qwen Code (qwen), text only
  --ai-base-url <url>    send AI requests here instead of the provider's usual address
                         (API providers only)
  --ai-max-requests <n>  most AI requests in one run (default 50; 0 uses only the cache)
  --ai-no-cache          ask again instead of reusing answers kept in .accessready-cache/ai
  --ai-no-images         send no images, only text (for text-only models)

  The AI review sends each page's text, links, headings, form labels and images (scaled
  down) to the provider you name, or through the CLI you name to its service. Do not use
  it on pages whose content must not leave your machine, unless the model runs locally.
  Its findings are likely problems for a person to confirm, marked as AI judgments; they
  never fail the run unless --strict is set.

Options given here win over the config file. Every ignore in it needs a reason:
  { "url": "http://localhost:3000", "level": "AA",
    "ignore": [{ "rule": "color-contrast", "page": "/blog/*", "reason": "..." }] }

Exit codes
  0  no failures (with --baseline: no new failures)
  1  failures found (with --baseline: new failures found)
  2  the audit could not finish (bad arguments or config, no browser, a page would not load)
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
      // No defaults here: a flag left out falls back to the config file, then to DEFAULTS.
      html: { type: 'string' },
      json: { type: 'string' },
      sarif: { type: 'string' },
      config: { type: 'string' },
      baseline: { type: 'string' },
      'update-baseline': { type: 'boolean' },
      sitemap: { type: 'string' },
      max: { type: 'string' },
      concurrency: { type: 'string' },
      'storage-state': { type: 'string' },
      viewport: { type: 'string' },
      viewports: { type: 'string' },
      level: { type: 'string' },
      'max-tab-stops': { type: 'string' },
      rate: { type: 'string' },
      timeout: { type: 'string' },
      browser: { type: 'string' },
      proxy: { type: 'string' },
      'no-dismiss': { type: 'boolean' },
      strict: { type: 'boolean' },
      ai: { type: 'string' },
      'ai-base-url': { type: 'string' },
      'ai-max-requests': { type: 'string' },
      'ai-no-cache': { type: 'boolean' },
      'ai-no-images': { type: 'boolean' },
      'no-color': { type: 'boolean', default: false },
      version: { type: 'boolean', short: 'v', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  });
} catch (e) {
  fail(`${e.message}\nRun accessready --help for usage.`);
}
const { values: given, positionals } = parsed;

if (given.version) { console.log(version); process.exit(0); }
if (given.help) { console.log(HELP); process.exit(0); }

let config, configPath;
try { ({ config, path: configPath } = loadConfig(given.config)); } catch (e) {
  if (e instanceof ConfigError) fail(e.message);
  throw e;
}

// One value per option: the flag if given, else the config file, else the default. Flags
// arrive as strings; config values can also be numbers and lists, so they are turned into
// the same strings and checked by the same code below.
const DEFAULTS = { max: '40', concurrency: '2', rate: '8', viewports: 'desktop,phone', level: 'AA', 'max-tab-stops': '150', timeout: '45000', browser: 'auto' };
const CONFIG_KEY = {
  html: 'html', json: 'json', sarif: 'sarif', baseline: 'baseline', sitemap: 'sitemap', max: 'max', concurrency: 'concurrency',
  'storage-state': 'storageState', viewport: 'viewport', viewports: 'viewports', level: 'level', 'max-tab-stops': 'maxTabStops',
  timeout: 'timeout', browser: 'browser', proxy: 'proxy', rate: 'rate',
};
const flags = {};
for (const [flag, key] of Object.entries(CONFIG_KEY)) {
  const value = config[key];
  flags[flag] = given[flag] ?? (value === undefined ? DEFAULTS[flag] : Array.isArray(value) ? value.join(',') : String(value));
}
// --viewports on the command line replaces a single viewport set in the config.
if (given.viewports && !given.viewport) flags.viewport = undefined;
flags.strict = given.strict ?? config.strict ?? false;
flags['no-dismiss'] = given['no-dismiss'] ?? config.dismiss === false;

// With a url in the config, the command line can name just paths: accessready /donate
const pathsOnly = config.url && positionals.length && positionals[0].startsWith('/');
const target = pathsOnly ? config.url : positionals[0] ?? config.url;
// The config's paths apply to a site's root URL given here (staging instead of production,
// say), but not when the command line names one page.
const isRoot = (url) => { try { const u = new URL(url); return u.pathname === '/' && !u.search; } catch { return false; } };
const paths = pathsOnly ? positionals
  : positionals.length > 1 ? positionals.slice(1)
    : !positionals.length || isRoot(positionals[0]) ? config.paths || [] : [];
if (!target) { console.error(HELP); process.exit(2); }

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
  if (!given.ai && (given[f] !== undefined && given[f] !== false)) fail(`--${f} needs --ai <provider:model>`);
}
if (given.ai !== undefined) {
  const max = given['ai-max-requests'];
  if (max !== undefined && !/^\d+$/.test(max)) fail(`--ai-max-requests needs a whole number, got "${max}"`);
  ai = {
    use: given.ai,
    baseUrl: given['ai-base-url'],
    maxRequests: max === undefined ? undefined : Number(max),
    cache: !given['ai-no-cache'],
    images: !given['ai-no-images'],
  };
  const { error } = resolveAi(ai);
  if (error) fail(`--ai: ${error}`);
}

// The baseline is read now, so a missing or broken file stops the run before a browser starts.
const updateBaseline = !!given['update-baseline'];
if (updateBaseline && !flags.baseline) fail('--update-baseline needs --baseline <file> (or "baseline" in the config file) to know where to write');
let baseline = null;
if (flags.baseline && !updateBaseline) {
  try { baseline = readBaseline(flags.baseline); } catch (e) {
    if (e instanceof BaselineError) fail(e.message);
    throw e;
  }
}
const ignores = config.ignore || [];

const jsonToStdout = flags.json === '-';
const color = !flags['no-color'] && !process.env.NO_COLOR && !jsonToStdout && (process.stdout.isTTY || !!process.env.FORCE_COLOR);
// With --json - the JSON owns stdout, so progress goes to stderr.
const say = jsonToStdout ? console.error : console.log;

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const MARK = { failure: 'FAIL', likely: 'LIKELY', advice: 'note' };

function renderBaseline({ known, new: fresh, fixed, notChecked }) {
  const lines = [`Baseline: ${plural(known.length, 'known finding')} skipped, ${fresh.length} new, ${fixed.length} fixed since the baseline${notChecked ? ` (${notChecked} on pages not audited this time)` : ''}`];
  for (const f of fresh.slice(0, 20)) lines.push(`  NEW ${MARK[f.kind]}  ${f.page}  ${f.title}${f.selector ? `  ${f.selector}` : ''}`);
  if (fresh.length > 20) lines.push(`  and ${fresh.length - 20} more new`);
  for (const f of fixed.slice(0, 10)) lines.push(`  FIXED  ${f.page}  ${f.title}${f.selector ? `  ${f.selector}` : ''}`);
  if (fixed.length > 10) lines.push(`  and ${fixed.length - 10} more fixed`);
  if (fixed.length) lines.push('  Run with --update-baseline to drop fixed findings from the baseline.');
  return lines.join('\n');
}

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
    rate: (() => { const n = Number(flags.rate); if (!Number.isFinite(n) || n < 0) fail(`--rate needs a number of requests a second, or 0 for no limit, got "${flags.rate}"`); return n; })(),
    timeout: positiveInt(flags.timeout, '--timeout'),
    browsers,
    proxy: flags.proxy || null,
    dismiss: !flags['no-dismiss'],
    ai: ai && { ...ai, onPlan: (plan) => say(describePlan(plan) + '\n') },
    // Ignored findings are left out of what is printed as each page finishes, too.
    onPage: (page) => { ignoreOnPage(page, ignores); say(renderPage(page, { color }) + '\n'); },
  });

  // Findings the config ignores leave the totals and the reports, and are listed in the
  // JSON with their reason, so the decision stays visible.
  if (ignores.length) {
    result.ignored = result.pages.flatMap((p) => ignoreOnPage(p, ignores));
    result.totals = summarize(result.pages);
  }
  const comparison = baseline ? compareWithBaseline(result, baseline) : null;
  if (comparison) result.baseline = { file: resolve(flags.baseline), known: comparison.known.length, new: comparison.new, fixed: comparison.fixed, notChecked: comparison.notChecked };

  if (result.ai) say(renderAiConsole(result, { color }) + '\n');
  say(renderSummary(result, { color }));
  if (result.ignored) say(`${plural(result.ignored.length, 'finding')} ignored by ${configPath ? relative(process.cwd(), configPath) || CONFIG_FILE : CONFIG_FILE}; the JSON report lists each one with its reason`);
  if (comparison) say(renderBaseline(comparison));
  if (flags.html) say(`\nReport: ${write(flags.html, renderHtml(result))}`);
  if (jsonToStdout) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  else if (flags.json) say(`JSON:   ${write(flags.json, JSON.stringify(result, null, 2) + '\n')}`);
  if (flags.sarif) say(`SARIF:  ${write(flags.sarif, JSON.stringify(toSarif(result), null, 2) + '\n')}`);

  if (updateBaseline) {
    // A page that did not load has no findings, and saving that would hide its problems later.
    if (result.totals.errors) fail(`the baseline was not written because ${plural(result.totals.errors, 'page')} could not be audited`);
    const saved = baselineFile(result);
    say(`Baseline: ${write(flags.baseline, JSON.stringify(saved, null, 2) + '\n')} (${plural(saved.findings.length, 'finding')} saved)`);
    process.exit(0);
  }
  process.exit(comparison ? baselineExitCode(result, comparison, { strict: flags.strict }) : exitCode(result, { strict: flags.strict }));
} catch (e) {
  // Anything that stops the audit, expected or not, is exit 2: 1 means failures were found.
  if (!(e instanceof AccessReadyError) && process.env.ACCESSREADY_DEBUG) console.error(e);
  fail(e instanceof AccessReadyError ? e.message : `the audit stopped: ${String(e?.message || e).split('\n')[0]}${process.env.ACCESSREADY_DEBUG ? '' : ' (set ACCESSREADY_DEBUG=1 for details)'}`);
}
