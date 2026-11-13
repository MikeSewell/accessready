// accessready.config.json: defaults for any command-line option, so a project can commit how
// it is audited, plus `ignore`, the findings a team has decided to accept. Every ignore needs
// a reason, because an ignore nobody can explain later is how real barriers get buried.
//
//   {
//     "url": "http://localhost:3000",
//     "paths": ["/", "/donate"],
//     "level": "AA",
//     "viewports": ["desktop", "phone"],
//     "ignore": [
//       { "rule": "color-contrast", "page": "/blog/*", "selector": ".byline", "reason": "Third-party widget; vendor ticket 4411" }
//     ]
//   }
//
// Options given on the command line win over the file.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const CONFIG_FILE = 'accessready.config.json';

export class ConfigError extends Error {}

const str = (v) => typeof v === 'string' && v.trim() !== '';
const int = (v) => Number.isInteger(v) && v > 0;
const list = (v) => (Array.isArray(v) && v.every(str)) || str(v);

// Each key, what it must hold, and whether it names a file (resolved from the config's folder).
const KEYS = {
  url: [str, 'a URL'],
  paths: [(v) => Array.isArray(v) && v.every(str), 'a list of paths'],
  html: [str, 'a file name', true],
  json: [str, 'a file name', true],
  sarif: [str, 'a file name', true],
  baseline: [str, 'a file name', true],
  storageState: [str, 'a file name', true],
  sitemap: [str, 'a URL'],
  max: [int, 'a whole number above 0'],
  concurrency: [int, 'a whole number above 0'],
  maxTabStops: [int, 'a whole number above 0'],
  timeout: [int, 'a whole number above 0'],
  level: [(v) => ['A', 'AA', 'AAA'].includes(String(v).toUpperCase()), 'A, AA or AAA'],
  viewports: [list, 'a list of screen sizes'],
  viewport: [str, 'a screen size such as 768x1024'],
  browser: [list, 'a list of browsers'],
  proxy: [str, 'a URL'],
  dismiss: [(v) => typeof v === 'boolean', 'true or false'],
  strict: [(v) => typeof v === 'boolean', 'true or false'],
  ignore: [Array.isArray, 'a list'],
};
const IGNORE_KEYS = ['rule', 'page', 'selector', 'reason'];

function checkIgnore(entries, where) {
  return entries.map((entry, i) => {
    const at = `${where}: ignore[${i}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new ConfigError(`${at} must be an object such as { "rule": "...", "reason": "..." }`);
    const unknown = Object.keys(entry).filter((k) => !IGNORE_KEYS.includes(k));
    if (unknown.length) throw new ConfigError(`${at} has an unknown key "${unknown[0]}"; use ${IGNORE_KEYS.join(', ')}`);
    if (!str(entry.rule)) throw new ConfigError(`${at} needs a "rule": the id of the finding to ignore, such as "color-contrast"`);
    if (!str(entry.reason)) throw new ConfigError(`${at} (${entry.rule}) needs a "reason" saying why this finding is accepted`);
    for (const k of ['page', 'selector']) if (k in entry && !str(entry[k])) throw new ConfigError(`${at} (${entry.rule}): "${k}" must be text`);
    return { rule: entry.rule, page: entry.page || null, selector: entry.selector || null, reason: entry.reason.trim() };
  });
}

// Reads the config. With no file named, accessready.config.json in `cwd` is used if it exists.
export function loadConfig(file, cwd = process.cwd()) {
  const path = resolve(cwd, file || CONFIG_FILE);
  if (!existsSync(path)) {
    if (file) throw new ConfigError(`config file not found: ${file}`);
    return { path: null, config: {} };
  }
  const where = file || CONFIG_FILE;
  let raw;
  try { raw = JSON.parse(readFileSync(path, 'utf8')); } catch (e) {
    throw new ConfigError(`${where} is not valid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new ConfigError(`${where} must hold a JSON object`);
  const config = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key.startsWith('$')) continue; // "$schema" and notes for people
    const spec = KEYS[key];
    if (!spec) throw new ConfigError(`${where} has an unknown option "${key}"; use one of ${Object.keys(KEYS).join(', ')}`);
    const [ok, want, isFile] = spec;
    if (!ok(value)) throw new ConfigError(`${where}: "${key}" must be ${want}`);
    config[key] = key === 'ignore' ? checkIgnore(value, where) : isFile ? resolve(dirname(path), value) : value;
  }
  return { path, config };
}

const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };
// "/blog/*" matches every path under /blog/; anything else matches only itself.
const pageMatches = (pattern, path) => new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`).test(path);

// Removes the findings the config ignores from one page, in place, and returns them with
// the reason they were ignored.
export function ignoreOnPage(page, ignores) {
  if (!ignores?.length) return [];
  const path = pathOf(page.url);
  const removed = [];
  page.issues = page.issues.filter((issue) => {
    const rule = ignores.find((ig) => ig.rule === issue.id
      && (!ig.page || pageMatches(ig.page, path))
      && (!ig.selector || ig.selector === issue.selector));
    if (!rule) return true;
    removed.push({ rule: issue.id, page: path, kind: issue.kind, selector: issue.selector, message: issue.message, reason: rule.reason });
    return false;
  });
  return removed;
}
