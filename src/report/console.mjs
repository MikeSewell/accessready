import { criterionLabel } from '../wcag.mjs';

const EXAMPLES_PER_RULE = 3;

function palette(color) {
  const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  return { red: wrap(31), yellow: wrap(33), green: wrap(32), dim: wrap(2), bold: wrap(1), cyan: wrap(36) };
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function pathOf(url) {
  const u = new URL(url);
  return u.pathname + u.search;
}

// One page's block. Used live as each page finishes, and again by renderConsole.
export function renderPage(page, { color = false } = {}) {
  const c = palette(color);
  const lines = [];
  // Findings that come from comparing pages are printed once, in the summary.
  const own = page.issues.filter((i) => i.scope !== 'site');
  const failures = own.filter((i) => i.kind === 'failure');
  const likely = own.filter((i) => i.kind === 'likely');
  const advice = own.filter((i) => i.kind === 'advice');
  const head = page.error
    ? c.red(page.error)
    : failures.length
      ? c.red(plural(failures.length, 'failure'))
      : c.green('no failures');
  const extra = [];
  if (likely.length) extra.push(c.yellow(plural(likely.length, 'likely problem')));
  if (advice.length) extra.push(c.yellow(plural(advice.length, 'best-practice note')));
  if (!page.error) extra.push(c.dim(plural(page.tabStops, 'tab stop')));
  lines.push(`${c.bold(pathOf(page.url))}  ${head}${extra.length ? '  ' + extra.join('  ') : ''}`);

  const groups = new Map();
  for (const issue of own) {
    const key = `${issue.kind}|${issue.id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(issue);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const mark = first.kind === 'failure' ? c.red('FAIL') : first.kind === 'likely' ? c.yellow('LIKELY') : c.yellow('note');
    lines.push(`  ${mark}  ${first.title}  ${c.dim(`${criterionLabel(first.wcag)} · ${first.id}`)}${list.length > 1 ? `  x${list.length}` : ''}`);
    for (const issue of list.slice(0, EXAMPLES_PER_RULE)) {
      lines.push(`        ${issue.message}${issue.seenOn ? c.dim(`  (${issue.seenOn.join(', ')} only)`) : ''}`);
      if (issue.selector) lines.push(`        ${c.cyan(issue.selector)}`);
    }
    if (list.length > EXAMPLES_PER_RULE) lines.push(c.dim(`        and ${list.length - EXAMPLES_PER_RULE} more`));
    if (first.helpUrl) lines.push(c.dim(`        ${first.helpUrl}`));
  }
  for (const note of page.notes) lines.push(c.dim(`  ${note}`));
  return lines.join('\n');
}

export function renderSummary(result, { color = false } = {}) {
  const c = palette(color);
  const t = result.totals;
  const lines = [];

  // Rules that fail on many pages usually live in a shared header or footer: fix once.
  const byRule = new Map();
  for (const page of result.pages) for (const issue of page.issues) {
    if (issue.kind !== 'failure') continue;
    if (!byRule.has(issue.id)) byRule.set(issue.id, { title: issue.title, wcag: issue.wcag, count: 0, pages: new Set() });
    const r = byRule.get(issue.id);
    r.count++;
    r.pages.add(page.url);
  }
  if (byRule.size > 1 || result.pages.length > 1) {
    const rows = [...byRule.values()].sort((a, b) => b.count - a.count);
    if (rows.length) lines.push(c.bold('Failures by rule'));
    for (const r of rows) lines.push(`  ${String(r.count).padStart(4)}  ${r.title}  ${c.dim(`${criterionLabel(r.wcag)} · ${plural(r.pages.size, 'page')}`)}`);
    if (rows.length) lines.push('');
  }

  const acrossSite = result.pages.flatMap((p) => p.issues.filter((i) => i.scope === 'site').map((i) => ({ ...i, path: pathOf(p.url) })));
  if (acrossSite.length) {
    lines.push(c.bold('Across the site'));
    for (const i of acrossSite) {
      const mark = i.kind === 'failure' ? c.red('FAIL') : i.kind === 'likely' ? c.yellow('LIKELY') : c.yellow('note');
      lines.push(`  ${mark}  ${c.bold(i.path)}  ${i.title}  ${c.dim(criterionLabel(i.wcag))}`);
      lines.push(`        ${i.message}`);
    }
    lines.push('');
  }

  const verdict = t.errors
    ? c.red(`${plural(t.errors, 'page')} could not be audited`)
    : t.failures
      ? c.red(plural(t.failures, `${result.standard} failure`))
      : c.green(`No automated ${result.standard} failures`);
  const ENGINE = { chromium: 'Chrome', firefox: 'Firefox', webkit: 'WebKit (Safari)' };
  const views = [...(result.viewports || []), ...((result.browsers || []).length > 1 ? result.browsers.map((b) => ENGINE[b] || b) : [])];
  lines.push(`${c.bold(result.target)}  ${verdict} across ${plural(t.pages, 'page')}  ${c.dim(`(${result.discovery}${views.length > 1 ? `; ${views.join(', ')}` : ''})`)}`);
  const tr = result.traffic;
  if (tr?.limited) lines.push(c.yellow(`The site answered "too many requests" ${plural(tr.limited, 'time')}; the audit slowed to 1 request a second. Use a lower --rate next time.`));
  if (tr?.refused) lines.push(c.red('The site stopped accepting connections partway through and the remaining pages were not audited. It may be limiting or blocking this machine.'));
  if (t.likely) lines.push(c.yellow(`${plural(t.likely, 'likely problem')} a person should confirm; these do not fail the run unless --strict is set`));
  if (t.advice) lines.push(c.dim(`${plural(t.advice, 'best-practice note')}; these do not fail the run unless --strict is set`));
  if (t.needsReview) lines.push(c.dim(`${plural(t.needsReview, 'element')} the checks could not judge; a person has to look at them`));
  lines.push(c.dim('Automated checks find some accessibility problems, not all of them. A pass here is not a statement of conformance.'));
  return lines.join('\n');
}

export function renderConsole(result, opts = {}) {
  return result.pages.map((p) => renderPage(p, opts)).join('\n\n') + '\n\n' + renderSummary(result, opts);
}
