// A baseline lets a site with known problems adopt accessready in CI today: save what is
// wrong now, and from then on fail only on what is new. Fixed findings are reported, so the
// baseline can be refreshed as the list shrinks.
//
// A finding is recognized across runs by its fingerprint: the rule, the page path (not the
// host, so a baseline taken on staging still matches a local build), the selector, and the
// message with its numbers taken out. Numbers are what move between runs: a contrast of
// 4.31:1 becomes 4.29:1 when a font renders a pixel differently, a port changes, a count of
// tab stops grows. The finding is the same.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';

export class BaselineError extends Error {}

const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };
export const normalizeMessage = (message) => String(message || '').replace(/\d+(?:[.,:]\d+)*/g, '#').replace(/\s+/g, ' ').trim();

export function fingerprint(pagePath, issue) {
  return createHash('sha256').update([issue.id, pagePath, issue.selector || '', normalizeMessage(issue.message)].join('\n')).digest('hex').slice(0, 20);
}

// Every finding in a result, in a stable order, ready to save or compare.
export function findingsOf(result) {
  return result.pages.flatMap((p) => p.issues.map((issue) => {
    const page = pathOf(p.url);
    return { fingerprint: fingerprint(page, issue), rule: issue.id, kind: issue.kind, page, selector: issue.selector || '', title: issue.title, message: issue.message };
  }));
}

export function baselineFile(result) {
  return {
    tool: 'accessready', version: result.version, created: result.finishedAt, target: result.target, standard: result.standard,
    findings: findingsOf(result),
  };
}

export function readBaseline(file) {
  if (!existsSync(file)) throw new BaselineError(`baseline file not found: ${file}. Create it with --update-baseline`);
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); } catch (e) {
    throw new BaselineError(`baseline ${file} is not valid JSON: ${e.message}`);
  }
  if (data?.tool !== 'accessready' || !Array.isArray(data.findings) || !data.findings.every((f) => typeof f?.fingerprint === 'string' && typeof f.page === 'string')) {
    throw new BaselineError(`${file} is not an accessready baseline. Create one with --update-baseline`);
  }
  return data;
}

// Splits the current findings into known and new, and lists what the baseline had that is
// gone. A finding on a page this run did not audit is not "fixed": it was not looked at.
// Marks each issue in the result with baseline: 'known' or 'new'.
export function compareWithBaseline(result, baseline) {
  const left = new Map();
  for (const f of baseline.findings) left.set(f.fingerprint, [...(left.get(f.fingerprint) || []), f]);
  const known = [], fresh = [];
  for (const p of result.pages) for (const issue of p.issues) {
    const page = pathOf(p.url);
    const pool = left.get(fingerprint(page, issue));
    const entry = { rule: issue.id, kind: issue.kind, page, selector: issue.selector || '', title: issue.title, message: issue.message };
    if (pool?.length) { pool.shift(); issue.baseline = 'known'; known.push(entry); } else { issue.baseline = 'new'; fresh.push(entry); }
  }
  const audited = new Set(result.pages.filter((p) => !p.error).map((p) => pathOf(p.url)));
  const remaining = [...left.values()].flat();
  return {
    known, new: fresh,
    fixed: remaining.filter((f) => audited.has(f.page)),
    notChecked: remaining.filter((f) => !audited.has(f.page)).length,
  };
}

// Exit code when a baseline is in use: only new findings can fail the run.
export function baselineExitCode(result, comparison, { strict = false } = {}) {
  if (result.totals.errors) return 2;
  const failing = comparison.new.filter((f) => f.kind === 'failure' || strict);
  return failing.length ? 1 : 0;
}
