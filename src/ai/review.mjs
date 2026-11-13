// Runs the AI review once every page has been audited: one request per page, one more to
// compare pages when there is something to compare, answers kept on disk so a rerun costs
// nothing, and a hard cap on requests. Nothing here can fail the audit. Whatever goes
// wrong becomes a note on the page or the run.
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { issue } from '../checks/index.mjs';
import { criterionLabel, inLevel } from '../wcag.mjs';
import { rules } from './look.mjs';
import { itemKind, pagePrompt, readFindings, sitePrompt } from './prompt.mjs';
import { requestBody, send } from './providers.mjs';

const pathOf = (url) => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } };
const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim().toLowerCase();
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function readCache(dir, key) {
  try {
    const record = JSON.parse(readFileSync(join(dir, `${key}.json`), 'utf8'));
    return typeof record.answer === 'string' ? record.answer : null;
  } catch {
    return null;
  }
}

function writeCache(dir, key, record) {
  try {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${key}.json`), JSON.stringify(record, null, 1) + '\n');
    return true;
  } catch {
    return false;
  }
}

// The same address, written the way pages differ in writing it.
function sameAddress(href) {
  try {
    const u = new URL(href);
    u.hash = '';
    if (u.pathname.length > 1) u.pathname = u.pathname.replace(/\/+$/, '');
    return u.href;
  } catch {
    return href;
  }
}

// 3.2.4 Consistent Identification, the part code can do: find controls in the repeated
// parts of pages (header, navigation, footer, sidebar, search) that go to the same place
// in the same region but carry different names on different pages. A page that uses two
// names for one address has two different controls, such as a logo and a "Home" link, so
// such groups are left out. The model then judges whether the names mean the same thing.
export function findNameDifferences(looks) {
  const REPEATED = new Set(['header', 'navigation', 'footer', 'sidebar', 'search']);
  const groups = new Map();
  const add = (kind, region, target, name, url) => {
    if (!name) return;
    const key = `${kind}|${region}|${sameAddress(target)}`;
    if (!groups.has(key)) groups.set(key, { kind, region, target, byPage: new Map() });
    const g = groups.get(key);
    if (!g.byPage.has(url)) g.byPage.set(url, new Map());
    g.byPage.get(url).set(norm(name), name);
  };
  for (const [url, look] of looks) {
    for (const l of look.links) if (REPEATED.has(l.region)) add('link', l.region, l.href, l.name, url);
    for (const i of look.images) if (REPEATED.has(i.region) && !i.inLink) add('image', i.region, i.src, i.alt, url);
    for (const b of look.buttons) add('button', b.region, b.target, b.name, url);
  }
  const out = [];
  for (const g of groups.values()) {
    if (g.byPage.size < 2 || [...g.byPage.values()].some((names) => names.size !== 1)) continue;
    const names = new Map();
    for (const [url, m] of g.byPage) {
      const [key, name] = [...m][0];
      if (!names.has(key)) names.set(key, { name, urls: [] });
      names.get(key).urls.push(url);
    }
    if (names.size < 2) continue;
    // Most used name first; it is the one the others are compared with.
    const list = [...names.values()].sort((a, b) => b.urls.length - a.urls.length);
    out.push({ kind: g.kind, region: g.region, target: pathOf(sameAddress(g.target)), names: list.map((n) => ({ name: n.name, urls: n.urls, pages: n.urls.map(pathOf) })) });
  }
  return out.slice(0, 40).map((c, i) => ({ id: `C${i + 1}`, ...c }));
}

// A finding about one page item, as an issue in the shape every check uses.
function pageIssue(f, look, level) {
  const t = f.target;
  const wcag = rules[f.rule].criteria.filter((n) => inLevel(n, level));
  const make = (what, fields = {}) => issue(f.rule, { source: 'ai', wcag, reason: f.reason, message: `${what}. AI review: ${f.reason}`, ...fields });
  switch (itemKind(f.rule)) {
    case 'image':
      return make(f.rule === 'ai-image-of-text'
        ? `image ${t.file || t.selector} looks like text set as a picture`
        : t.alt ? `image ${t.file || t.selector} is described as "${t.alt}"` : `image ${t.file || t.selector} has an empty description (alt="")`,
      { selector: t.selector, html: t.html });
    case 'link': return make(`link "${t.name}" to ${pathOf(t.href)}`, { selector: t.selector });
    case 'heading': return make(`heading "${t.text}"`, { selector: t.selector });
    case 'field': return make(`field labelled "${t.label}"`, { selector: t.selector });
    case 'title': return make(`page title "${look.title}"`, { selector: 'title' });
    default: return make(`"${f.quote}"`);
  }
}

export async function reviewWithAi(pages, opts) {
  const { ai, level } = opts;
  const allowed = new Set(Object.keys(rules).filter((id) => rules[id].criteria.some((n) => inLevel(n, level))));
  const byUrl = new Map();
  const at = (url) => { if (!byUrl.has(url)) byUrl.set(url, { issues: [], notes: [] }); return byUrl.get(url); };
  const runNotes = [];
  const note = (prompt, text) => (prompt.kind === 'page' ? at(prompt.url).notes : runNotes).push(`AI review: ${text}`);

  // What each page showed, from the one view that read it. The raw reading (with its
  // pictures) is dropped from the page results here, so it never reaches the report.
  const looks = new Map();
  for (const url of new Set(pages.map((p) => p.url))) {
    const views = pages.filter((p) => p.url === url);
    const read = views.find((p) => p.aiLook);
    if (read) looks.set(url, read.aiLook);
    else if (views.some((p) => !p.error)) at(url).notes.push('AI review: this page was not reviewed, because it did not load in the first screen size and browser of the run');
    for (const v of views) delete v.aiLook;
  }

  const prompts = [];
  for (const [url, look] of looks) {
    const p = pagePrompt(look, { url, level, allowed });
    if (p) prompts.push(p);
  }
  if (allowed.has('ai-consistent-identification')) {
    const differences = findNameDifferences(looks);
    if (differences.length) prompts.push(sitePrompt(differences, { level }));
  }
  for (const p of prompts) {
    p.body = requestBody(ai, p);
    // Keyed on everything that decides the answer: who answers, which model, and the exact
    // request, pictures included. A changed page is a new key; an unchanged one is free.
    p.key = createHash('sha256').update(JSON.stringify({ provider: ai.provider, model: ai.model, endpoint: ai.endpoint, body: p.body })).digest('hex');
    p.cached = ai.cache ? readCache(ai.cacheDir, p.key) : null;
  }

  const waiting = prompts.filter((p) => p.cached === null);
  await ai.onPlan({
    provider: ai.provider, model: ai.model, endpoint: ai.endpoint, pages: looks.size,
    requests: Math.min(waiting.length, ai.maxRequests), wanted: waiting.length, maxRequests: ai.maxRequests,
    cached: prompts.length - waiting.length,
    images: waiting.reduce((n, p) => n + p.pictures.length, 0),
  });

  let used = 0, stopped = null, cacheFailed = false, succeeded = false;
  const usage = { inputTokens: 0, outputTokens: 0 };
  const take = () => (used < ai.maxRequests ? (used++, true) : false);
  const notAsked = { limit: [], stopped: [] };

  const handle = async (p) => {
    let answer = p.cached, fresh = false;
    if (answer === null) {
      if (stopped) return notAsked.stopped.push(p);
      if (used >= ai.maxRequests) return notAsked.limit.push(p);
      let res;
      try {
        res = await send(ai, p.body, take);
      } catch (e) {
        // A tool that fails before anything has worked is most likely set up wrong; asking
        // again for every page would only repeat the failure.
        if (e.fatal || (e.repeatable && !succeeded)) { stopped ||= e.message; return notAsked.stopped.push(p); }
        return note(p, `the request did not succeed (${e.message}); nothing was reported`);
      }
      succeeded = true;
      usage.inputTokens += res.usage.input;
      usage.outputTokens += res.usage.output;
      if (res.refused) return note(p, 'the model declined to answer; nothing was reported');
      if (res.cutOff) return note(p, 'the model\'s answer was cut off before it finished; nothing was reported');
      answer = res.text;
      fresh = true;
    }
    const read = readFindings(answer, p);
    if (read.error) return note(p, `${read.error}, so nothing was reported${fresh ? '' : ' (from the cache)'}`);
    // Only answers that could be used are kept, so a bad one is asked again next run.
    if (fresh && ai.cache && !writeCache(ai.cacheDir, p.key, { provider: ai.provider, model: ai.model, page: p.url || 'across pages', savedAt: new Date().toISOString(), answer })) cacheFailed = true;
    if (read.dropped) note(p, `${plural(read.dropped, 'finding')} from the model did not match anything on ${p.kind === 'page' ? 'this page' : 'the pages'} and ${read.dropped === 1 ? 'was' : 'were'} left out`);

    if (p.kind === 'page') {
      for (const f of read.findings) at(p.url).issues.push(pageIssue(f, p.look, level));
      return;
    }
    for (const f of read.findings) {
      const c = f.target;
      const [usual, ...others] = c.names;
      const wcag = rules[f.rule].criteria.filter((n) => inLevel(n, level));
      for (const other of others) for (const url of other.urls) {
        at(url).issues.push(issue(f.rule, {
          source: 'ai', scope: 'site', wcag, reason: f.reason, selector: c.region,
          message: `the ${c.kind} to ${c.target} in the ${c.region} is called "${other.name}" here and "${usual.name}" on ${plural(usual.urls.length, 'other page')}. AI review: ${f.reason}`,
        }));
      }
    }
  };

  // The first request goes alone, so a wrong key or model name is learned from one request
  // rather than from several sent at once. Then two at a time: quicker than one, gentle on
  // rate limits and local models. Requests are claimed in page order, so a limit always
  // cuts the same pages.
  let next = 0;
  while (next < prompts.length && !used && !stopped) await handle(prompts[next++]);
  const worker = async () => { for (let i = next++; i < prompts.length; i = next++) await handle(prompts[i]); };
  await Promise.all([worker(), worker()]);

  const describe = (list) => {
    const pagesLeft = list.filter((p) => p.kind === 'page').length;
    const site = list.some((p) => p.kind === 'site');
    return [pagesLeft ? plural(pagesLeft, 'page') : '', site ? 'the comparison across pages' : ''].filter(Boolean).join(' and ');
  };
  const verb = (list) => (list.length === 1 ? 'was' : 'were');
  if (stopped) runNotes.push(`AI review: stopped because of this answer: ${stopped}. ${describe(notAsked.stopped)} ${verb(notAsked.stopped)} not reviewed`);
  if (notAsked.limit.length) runNotes.push(`AI review: the limit of ${plural(ai.maxRequests, 'request')} was reached; ${describe(notAsked.limit)} ${verb(notAsked.limit)} not reviewed. Raise --ai-max-requests to include them`);
  if (ai.textOnly && [...looks.values()].some((l) => l.images.length)) runNotes.push(`AI review: images were not sent, because ${ai.provider} has no documented way to take them in non-interactive mode; image descriptions were judged by their words and nearby text only`);
  if (cacheFailed) runNotes.push(`AI review: answers could not be saved in ${ai.cacheDir}, so a rerun will ask again`);

  return {
    byUrl, notes: runNotes,
    summary: {
      provider: ai.provider, model: ai.model, endpoint: ai.endpoint, pages: looks.size,
      requests: used, cached: prompts.filter((p) => p.cached !== null).length,
      notReviewed: notAsked.limit.length + notAsked.stopped.length, usage,
    },
  };
}

// The line printed before the first request: what is sent, and to whom.
export function describePlan(plan) {
  const parts = [`AI review: sending the text, links, headings and form labels of ${plural(plan.pages, 'page')}`];
  if (plan.images) parts.push(` and ${plural(plan.images, 'image')}`);
  parts.push(` to ${plan.provider} (${plan.endpoint}), ${plan.model ? `model ${plan.model}` : 'with its default model'}.`);
  parts.push(` ${plan.requests ? `About ${plural(plan.requests, 'request')}` : 'No requests'}`);
  const more = [];
  if (plan.cached) more.push(`${plan.cached} answered from the cache`);
  if (plan.wanted > plan.maxRequests) more.push(`${plan.wanted - plan.maxRequests} over the limit of ${plan.maxRequests}, skipped`);
  parts.push(more.length ? ` (${more.join('; ')}).` : '.');
  return parts.join('');
}

// The AI findings for the console. Pages are printed as they finish, before the AI review
// runs, so its findings get their own block after them. Findings that compare pages are
// left to the summary's "Across the site" block, as for every other check.
export function renderAiConsole(result, { color = false } = {}) {
  if (!result.ai) return '';
  const wrap = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const yellow = wrap(33), dim = wrap(2), bold = wrap(1), cyan = wrap(36);
  const lines = [bold(`AI review (${result.ai.provider}, ${result.ai.model || 'default model'}): judgments a person should confirm`)];
  let any = false;
  for (const page of result.pages) {
    const found = page.issues.filter((i) => i.source === 'ai' && i.scope !== 'site');
    const notes = page.notes.filter((n) => n.startsWith('AI review: '));
    if (!found.length && !notes.length) continue;
    any = true;
    lines.push(`${bold(pathOf(page.url))}  ${found.length ? yellow(plural(found.length, 'likely problem')) : 'nothing found'}`);
    for (const i of found) {
      lines.push(`  ${yellow('AI')}  ${i.title}  ${dim(`${criterionLabel(i.wcag)} · ${i.id}`)}`);
      lines.push(`        ${i.message}`);
      if (i.selector) lines.push(`        ${cyan(i.selector)}`);
    }
    for (const n of notes) lines.push(dim(`  ${n}`));
  }
  if (!any) lines.push(dim('  nothing found on any page'));
  const u = result.ai;
  if (u.failed) return lines.join('\n');
  lines.push(dim(`  ${plural(u.requests, 'request')} sent, ${u.cached} answered from the cache${u.usage.inputTokens ? `, ${u.usage.inputTokens} tokens in and ${u.usage.outputTokens} out` : ''}`));
  return lines.join('\n');
}
