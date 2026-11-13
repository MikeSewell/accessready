import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { runAxe } from './checks/axe.mjs';
import { walkKeyboard } from './checks/keyboard.mjs';
import { checkMovingVideo, checkReflow, checkTextSpacing } from './checks/layout.mjs';
import { measureContrastOnImages } from './checks/contrast.mjs';
import { checkUnreachable, checkHoverMenus, checkDisclosures } from './checks/interact.mjs';
import { PROBES, SITE_PROBES } from './checks/index.mjs';
import { instrument } from './instrument.mjs';
import { takeInventory } from './inventory.mjs';
import { checkAcrossPages } from './site.mjs';
import { discoverFromSitemap } from './sitemap.mjs';
import { inLevel, LEVELS } from './wcag.mjs';
import { resolveAi } from './ai/providers.mjs';
import { reviewWithAi } from './ai/review.mjs';

export { renderConsole } from './report/console.mjs';
export { renderHtml } from './report/html.mjs';

export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const REJECT = /^(reject|decline|deny|reject all|reject non-essential|necessary only|essential only|only necessary)$/i;

export class AccessReadyError extends Error {}

// The two screen sizes every audit covers unless told otherwise.
export const VIEWPORTS = {
  desktop: { name: 'desktop', width: 1440, height: 900 },
  phone: { name: 'phone', width: 390, height: 844, isMobile: true, hasTouch: true },
};

export const BROWSERS = ['chrome', 'chromium', 'firefox', 'webkit'];

// Installed Chrome first: nothing to download, and it is what most visitors use. Then the
// Chromium that `npx playwright install chromium` provides. Firefox and WebKit (the engine
// inside Safari) come from Playwright's own builds: `npx playwright install firefox webkit`.
async function launch(choice, proxy) {
  const base = proxy ? { proxy: { server: proxy } } : {};
  const attempts = {
    auto: [[chromium, { channel: 'chrome' }], [chromium, {}]],
    chrome: [[chromium, { channel: 'chrome' }]],
    chromium: [[chromium, {}]],
    firefox: [[firefox, {}]],
    webkit: [[webkit, {}]],
  }[choice];
  let lastError;
  for (const [type, opts] of attempts) {
    try { return await type.launch({ ...base, ...opts }); } catch (e) { lastError = e; }
  }
  const install = choice === 'firefox' || choice === 'webkit' ? choice : 'chromium';
  throw new AccessReadyError(
    `Could not start ${choice === 'auto' ? 'a browser' : choice}. ${choice === 'auto' || choice === 'chrome' ? 'Install Google Chrome, or run' : 'Run'}:\n  npx playwright install ${install}\n\n${String(lastError.message).split('\n')[0]}`,
  );
}

const engineOf = (browser) => browser.browserType().name(); // chromium, firefox or webkit

// Some CDNs show an automated browser a "checking your browser" page with a 403 first.
// It clears itself after a few seconds, so wait and ask again.
async function open(page, url, timeout) {
  let res = await page.goto(url, { waitUntil: 'load', timeout });
  if (res && res.status() === 403) {
    await page.waitForTimeout(6000);
    res = await page.goto(url, { waitUntil: 'load', timeout });
  }
  return res;
}

async function newContext(browser, viewport, opts) {
  const { name, isMobile, hasTouch, ...size } = viewport;
  const context = await browser.newContext({
    viewport: size,
    // Firefox has no mobile emulation; it still renders at phone width.
    ...(isMobile && engineOf(browser) !== 'firefox' ? { isMobile: true } : {}),
    ...(hasTouch ? { hasTouch: true } : {}),
    reducedMotion: 'reduce',
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  await context.addInitScript(instrument);
  return context;
}

// Answer a cookie banner the way a visitor would, choosing Reject, so the page under it is
// what gets audited.
async function dismissBanner(page) {
  const button = page.getByRole('button', { name: REJECT }).first();
  if (!await button.count().catch(() => 0)) return null;
  const name = (await button.textContent().catch(() => '') || '').trim();
  if (!await button.click({ timeout: 2000 }).then(() => true, () => false)) return null;
  await page.waitForTimeout(300);
  return name;
}

async function loadPage(page, url, opts) {
  const res = await open(page, url, opts.timeout);
  await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});
  const dismissed = opts.dismiss ? await dismissBanner(page) : null;
  return { res, dismissed };
}

async function runProbe(probe, page, ctx, result) {
  try {
    const out = await probe.run(page, ctx);
    const issues = Array.isArray(out) ? out : out?.issues || [];
    result.issues.push(...issues);
    if (out?.notes) result.notes.push(...out.notes);
  } catch (e) {
    result.notes.push(`the ${probe.name} check could not finish: ${String(e.message).split('\n')[0]}`);
  }
}

async function auditPage(browser, url, viewport, opts) {
  const engine = engineOf(browser);
  const context = await newContext(browser, viewport, opts);
  const page = await context.newPage();
  const result = {
    url, viewport: viewport.name, browser: engine, status: null, error: null,
    issues: [], needsReview: [], review: null, tabStops: 0, notes: [],
  };
  const extraContexts = [];
  try {
    let loaded;
    try {
      loaded = await loadPage(page, url, opts);
    } catch (e) {
      result.error = `could not load: ${String(e.message).split('\n')[0]}`;
      return result;
    }
    const { res, dismissed } = loaded;
    result.status = res ? res.status() : null;
    if (res && res.status() >= 400) {
      result.error = `server answered ${res.status()}`;
      return result;
    }
    if (dismissed) result.notes.push(`clicked "${dismissed}" on a cookie banner first`);

    // A fresh copy of the page for a check that changes things. `clock` gives it a clock the
    // check can move forward, to see what the page does after minutes have passed.
    const fresh = async ({ clock = false } = {}) => {
      const ctx = await newContext(browser, viewport, opts);
      extraContexts.push(ctx);
      const p = await ctx.newPage();
      if (clock) await p.clock.install();
      await loadPage(p, url, opts);
      return p;
    };
    const probeCtx = { url, level: opts.level, viewport, browserName: engine, opts, result, fresh };
    const probes = (phase) => PROBES.filter((p) => p.phase === phase && (!p.browsers || p.browsers.includes(engine)));
    const runPhase = async (phase) => {
      for (const probe of probes(phase)) {
        if (probe.isolated || probe.clock) {
          let p;
          try { p = await fresh({ clock: !!probe.clock }); } catch (e) {
            result.notes.push(`the ${probe.name} check could not open the page again: ${String(e.message).split('\n')[0]}`);
            continue;
          }
          await runProbe(probe, p, probeCtx, result);
        } else {
          await runProbe(probe, page, probeCtx, result);
        }
      }
    };

    // Order matters. First everything that only looks at the page, then what measures it,
    // then the keyboard walk, then the checks that operate or resize it.
    const axe = await runAxe(page, opts.level);
    result.engine = axe.engine;
    result.review = await takeInventory(page);
    await runPhase('look');

    const contrast = await measureContrastOnImages(page, axe.unmeasuredContrast);
    // What is left for a person after measuring: axe's other undecided rules, plus the text
    // whose background passes in some places and fails in others.
    result.needsReview = axe.needsReview
      .map((r) => (r.id === 'color-contrast' ? { ...r, count: r.count - contrast.resolved - contrast.issues.length } : r))
      .filter((r) => r.count > 0);
    result.review.contrast = contrast.unresolved;
    const video = await checkMovingVideo(page);
    const unreachable = await checkUnreachable(page);
    const spacing = await checkTextSpacing(page);
    result.issues.push(...axe.issues, ...contrast.issues, ...video, ...unreachable, ...spacing);
    await runPhase('measure');

    const keyboard = await walkKeyboard(page, { maxStops: opts.maxTabStops, level: opts.level });
    result.tabStops = keyboard.stops;
    result.issues.push(...keyboard.issues);
    if (keyboard.capped) result.notes.push(`stopped after ${opts.maxTabStops} tab stops; the rest of the page was not walked`);
    if (keyboard.framesSkipped) result.notes.push(`${keyboard.framesSkipped} embedded frame(s) take focus; focus inside them was not checked`);
    for (const name of keyboard.dialogsOpened) result.notes.push(`a popup ("${name}") opened during the audit and covered the page; what is behind it was not fully walked. Use --storage-state with the popup already dismissed to audit the page itself`);

    // A popup that has taken over the page would make these report on the popup, not the page.
    if (!keyboard.dialogsOpened.length) {
      result.issues.push(...await checkHoverMenus(page));
      const toggles = await checkDisclosures(page);
      result.issues.push(...toggles.issues);
      result.notes.push(...toggles.notes);
    }
    // Reflow is defined at 320 CSS pixels on a desktop browser zoomed to 400%. A phone
    // emulation lays a page out differently, so it is measured from desktop windows only.
    if (!viewport.isMobile) result.issues.push(...await checkReflow(page));
    await runPhase('operate');

    // Only what belongs to the level asked for. Findings tied to no criterion (best practice,
    // or a requirement from a standard beyond WCAG) are always kept.
    result.issues = result.issues.filter((i) => !i.wcag.length || i.wcag.some((n) => inLevel(n, opts.level)));
    return result;
  } catch (e) {
    result.error = `audit failed: ${String(e.message).split('\n')[0]}`;
    return result;
  } finally {
    for (const ctx of extraContexts) await ctx.close().catch(() => {});
    await context.close();
  }
}

// Each page was audited once per screen size and browser. Fold those into one entry per page:
// a finding seen everywhere is listed once, one seen only somewhere says where.
function mergeViews(audits) {
  const byUrl = new Map();
  for (const a of audits) {
    if (!byUrl.has(a.url)) byUrl.set(a.url, []);
    byUrl.get(a.url).push(a);
  }
  const label = (a) => a.viewport + (new Set(audits.map((x) => x.browser)).size > 1 ? ` ${a.browser}` : '');
  return [...byUrl.values()].map((views) => {
    const first = views[0];
    const issues = new Map();
    for (const v of views) for (const i of v.issues) {
      const key = `${i.kind}|${i.id}|${i.selector}|${i.message}`;
      if (!issues.has(key)) issues.set(key, { ...i, seenOn: [] });
      issues.get(key).seenOn.push(label(v));
    }
    const everywhere = views.map(label);
    const notes = new Map();
    for (const v of views) for (const n of v.notes) {
      if (!notes.has(n)) notes.set(n, []);
      notes.get(n).push(label(v));
    }
    const review = first.review;
    return {
      url: first.url, status: first.status,
      error: views.every((v) => v.error) ? first.error : null,
      engine: first.engine,
      issues: [...issues.values()].map((i) => ({ ...i, seenOn: i.seenOn.length === everywhere.length ? null : i.seenOn })),
      needsReview: first.needsReview, review, tabStops: first.tabStops,
      notes: [...notes].map(([n, on]) => (on.length === everywhere.length ? n : `${n} (${on.join(', ')})`)),
      views: views.map((v) => ({ viewport: v.viewport, browser: v.browser, tabStops: v.tabStops, error: v.error })),
    };
  });
}

export function summarize(pages) {
  const count = (kind) => pages.reduce((n, p) => n + p.issues.filter((i) => i.kind === kind).length, 0);
  return {
    pages: pages.length,
    failures: count('failure'),
    likely: count('likely'),
    advice: count('advice'),
    needsReview: pages.reduce((n, p) => n + p.needsReview.reduce((m, r) => m + r.count, 0), 0),
    errors: pages.filter((p) => p.error).length,
  };
}

// Exit code for a finished audit. --strict also fails on likely problems and best-practice notes.
export function exitCode(result, { strict = false } = {}) {
  if (result.totals.errors) return 2;
  if (result.totals.failures || (strict && (result.totals.likely || result.totals.advice))) return 1;
  return 0;
}

const parseViewport = (v) => {
  if (typeof v === 'object') return { name: v.name || `${v.width}x${v.height}`, ...v };
  if (VIEWPORTS[v]) return VIEWPORTS[v];
  const m = /^(\d+)x(\d+)$/.exec(String(v));
  if (!m) throw new AccessReadyError(`Not a screen size: ${v}. Use desktop, phone, or WIDTHxHEIGHT such as 768x1024`);
  return { name: `${m[1]}x${m[2]}`, width: +m[1], height: +m[2] };
};

export async function audit(target, options = {}) {
  const opts = {
    paths: [], sitemap: null, max: 40, concurrency: 2, timeout: 45000, maxTabStops: 150,
    viewports: ['desktop', 'phone'], browsers: ['auto'], level: 'AA',
    dismiss: true, proxy: null, storageState: null, ai: null,
    onPage: () => {},
    ...options,
  };
  // Older option names: a single viewport size and a single browser.
  if (options.viewport) opts.viewports = [options.viewport];
  if (options.browser) opts.browsers = [options.browser];
  if (!LEVELS.includes(opts.level)) throw new AccessReadyError(`Level must be A, AA or AAA, got ${opts.level}`);
  const viewports = opts.viewports.map(parseViewport);
  for (const b of opts.browsers) if (b !== 'auto' && !BROWSERS.includes(b)) throw new AccessReadyError(`Unknown browser: ${b}. Use auto, ${BROWSERS.join(', ')}`);
  // The optional AI review: 'provider:model' or an object (see src/ai/providers.mjs).
  if (opts.ai) {
    const { ai, error } = resolveAi(opts.ai, opts.ai.env);
    if (error) throw new AccessReadyError(error);
    opts.ai = ai;
  }

  let start;
  try { start = new URL(target); } catch { throw new AccessReadyError(`Not a URL: ${target}`); }
  if (!/^https?:$/.test(start.protocol)) throw new AccessReadyError(`Only http and https URLs can be audited: ${target}`);

  const startedAt = new Date().toISOString();
  const browsers = [];
  try {
    for (const b of opts.browsers) browsers.push(await launch(b, opts.proxy));
    // The AI review reads each page in one view only, the run's first screen size and
    // browser, so the same page gives the same input and a rerun is answered from the cache.
    if (opts.ai) opts.ai = { ...opts.ai, view: viewports[0].name, engine: engineOf(browsers[0]) };

    // What to audit: the paths given; or the one page named; or everything in the sitemap.
    let urls, discovery;
    const namedPage = start.pathname !== '/' || start.search;
    if (opts.paths.length) {
      urls = opts.paths.map((p) => new URL(p, start.origin).href);
      discovery = 'paths given';
    } else if (namedPage && !opts.sitemap) {
      urls = [start.href];
      discovery = 'single page';
    } else {
      const found = await discoverFromSitemap(browsers[0], opts.sitemap || start.origin + '/sitemap.xml', start.origin, opts);
      urls = found.urls.slice(0, opts.max);
      discovery = found.urls.length
        ? `sitemap (${found.urls.length} page${found.urls.length === 1 ? '' : 's'}${found.urls.length > opts.max ? `, first ${opts.max} audited` : ''})`
        : `no sitemap at ${found.tried}; home page only`;
      if (!urls.length) urls = [start.origin + '/'];
    }

    // One job per page, per screen size, per browser.
    const jobs = [];
    for (const browser of browsers) for (const viewport of viewports) for (const url of urls) jobs.push({ browser, viewport, url });
    const pages = new Array(jobs.length);
    // Report a page as soon as every view of it is done.
    const perUrl = jobs.length / urls.length;
    const done = new Map();
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < jobs.length; i = next++) {
        const { browser, viewport, url } = jobs[i];
        pages[i] = await auditPage(browser, url, viewport, opts);
        done.set(url, [...(done.get(url) || []), pages[i]]);
        if (done.get(url).length === perUrl) opts.onPage(mergeViews(done.get(url))[0], urls.indexOf(url), urls.length);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, jobs.length)) }, worker));

    // Pages are compared with others seen the same way: same browser, same screen size.
    const groups = new Map();
    for (const p of pages) {
      const key = `${p.browser} ${p.viewport}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    for (const group of groups.values()) {
      checkAcrossPages(group);
      for (const probe of SITE_PROBES) {
        try { await probe.run(group.filter((p) => !p.error), { level: opts.level, opts, browser: browsers[0], origin: start.origin }); } catch (e) {
          group[0]?.notes.push(`the ${probe.name} check could not finish: ${String(e.message).split('\n')[0]}`);
        }
      }
      for (const p of group) p.issues = p.issues.filter((i) => !i.wcag.length || i.wcag.some((n) => inLevel(n, opts.level)));
    }
    if (!viewports.some((v) => !v.isMobile)) pages[0]?.notes.push('reflow (1.4.10) is measured in a desktop window; add desktop to --viewports to check it');
    // After every page, so the requests can be counted, capped and announced before the
    // first one is sent. Its findings are judged once per page, not once per view.
    // An AI failure never fails the audit: a fault in the review itself becomes a note.
    let ai = null;
    if (opts.ai) {
      try { ai = await reviewWithAi(pages, opts); } catch (e) {
        ai = { byUrl: new Map(), notes: [`AI review: could not finish: ${String(e.message).split('\n')[0]}`], summary: { provider: opts.ai.provider, model: opts.ai.model, endpoint: opts.ai.endpoint, failed: true } };
      }
      for (const p of pages) delete p.aiLook;
    }
    const merged = mergeViews(pages);
    if (ai) {
      for (const p of merged) {
        const found = ai.byUrl.get(p.url);
        if (found) { p.issues.push(...found.issues.map((i) => ({ ...i, seenOn: null }))); p.notes.push(...found.notes); }
      }
      merged[0]?.notes.push(...ai.notes);
    }

    return {
      tool: 'accessready', version, target: start.origin, discovery, startedAt, finishedAt: new Date().toISOString(),
      engine: pages.find((p) => p.engine)?.engine || null,
      standard: `WCAG 2.2 ${opts.level}`, level: opts.level,
      viewports: viewports.map((v) => v.name), browsers: [...new Set(pages.map((p) => p.browser))],
      totals: summarize(merged), pages: merged,
      ...(ai ? { ai: ai.summary } : {}),
    };
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
  }
}

