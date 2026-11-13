import { readFileSync } from 'node:fs';
import { chromium, firefox, webkit } from 'playwright';
import { runAxe } from './checks/axe.mjs';
import { walkKeyboard } from './checks/keyboard.mjs';
import { checkMovingVideo, checkReflow, checkTextSpacing } from './checks/layout.mjs';
import { measureContrastOnImages } from './checks/contrast.mjs';
import { checkUnreachable, checkHoverMenus, checkDisclosures } from './checks/interact.mjs';
import { PROBES, SITE_PROBES } from './checks/index.mjs';
import { instrument } from './instrument.mjs';
import { traffic } from './polite.mjs';
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

// Checks that work on their own copy of a page and may run at the same time.
const ISOLATED_AT_ONCE = 2;

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

// Pages are audited with reduced motion asked for, so animations hold still for screenshots.
// A check about motion itself can ask for 'no-preference', which is what most visitors have.
// `extra` holds further context options (serviceWorkers).
async function newContext(browser, viewport, opts, { reducedMotion = 'reduce', ...extra } = {}) {
  const { name, isMobile, hasTouch, ...size } = viewport;
  const context = await browser.newContext({
    viewport: size,
    // Firefox has no mobile emulation; it still renders at phone width.
    ...(isMobile && engineOf(browser) !== 'firefox' ? { isMobile: true } : {}),
    ...(hasTouch ? { hasTouch: true } : {}),
    reducedMotion,
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
    ...extra,
  });
  await context.addInitScript(instrument);
  await opts.traffic?.attach(context);
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

// How long each step took on each page, in milliseconds, kept in the JSON output so a slow
// check can be found on a real site.
async function timed(result, name, fn) {
  const start = Date.now();
  try { return await fn(); } finally { result.timings[name] = (result.timings[name] || 0) + Date.now() - start; }
}

// Runs one check and returns what it found, { issues, notes }, so checks that run at the same
// time can still be added to the result in a fixed order.
async function runProbe(probe, page, ctx, result) {
  const start = Date.now();
  try {
    const out = await probe.run(page, ctx);
    return { issues: Array.isArray(out) ? out : out?.issues || [], notes: out?.notes || [] };
  } catch (e) {
    return { issues: [], notes: [`the ${probe.name} check could not finish: ${String(e.message).split('\n')[0]}`], crashed: /Target crashed|Target page, context or browser has been closed/i.test(String(e.message)) };
  } finally {
    result.timings[probe.name] = (result.timings[probe.name] || 0) + Date.now() - start;
  }
}

async function auditPage(browser, url, viewport, opts) {
  const engine = engineOf(browser);
  const context = await newContext(browser, viewport, opts);
  // Cookies from pages already audited, the way a visitor's browser carries them from page to
  // page: a host's bot check passed on the first page is not met again on every other.
  if (opts.jar?.cookies.length) await context.addCookies(opts.jar.cookies).catch(() => {});
  const page = await context.newPage();
  const result = {
    url, viewport: viewport.name, browser: engine, status: null, error: null,
    issues: [], needsReview: [], review: null, tabStops: 0, notes: [], timings: {},
  };
  const extraContexts = [];
  try {
    let loaded;
    try {
      loaded = await timed(result, 'load', () => loadPage(page, url, opts));
      opts.traffic?.loaded();
    } catch (e) {
      opts.traffic?.failed(e.message);
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
    // Fresh copies start with the cookies the first load ended with. A host's bot check that
    // was passed once is not met again (msewell.com's host answers each new session with a
    // 403 first, which cost six seconds per copy), and a cookie banner already declined stays
    // declined. Local storage is not carried over, and the clock check starts as a brand-new
    // visitor: popups shown only on a first visit are what it looks for.
    const cookies = await context.cookies().catch(() => []);
    if (opts.jar && cookies.length) opts.jar.cookies = cookies;

    // A fresh copy of the page for a check that changes things. `clock` gives it a clock the
    // check can move forward, to see what the page does after minutes have passed.
    // `prepare(context)` runs before the copy loads, so a check can install request routing
    // first. `serviceWorkers: 'block'` keeps service workers out of the copy: requests they
    // make would bypass that routing.
    // `reducedMotion: 'no-preference'` loads it the way a visitor without that setting sees it.
    const fresh = async ({ clock = false, prepare = null, serviceWorkers = 'allow', reducedMotion } = {}) => {
      const ctx = await newContext(browser, viewport, opts, { serviceWorkers, reducedMotion });
      if (!clock && cookies.length) await ctx.addCookies(cookies).catch(() => {});
      extraContexts.push(ctx);
      if (prepare) await prepare(ctx);
      const p = await ctx.newPage();
      if (clock) await p.clock.install();
      await loadPage(p, url, opts);
      return p;
    };
    const probeCtx = { url, level: opts.level, viewport, browserName: engine, opts, result, fresh };
    const probes = (phase) => PROBES.filter((p) => p.phase === phase && (!p.browsers || p.browsers.includes(engine)));
    // Checks on the page itself run one after another. Checks that get their own copy cannot
    // affect each other, so up to ISOLATED_AT_ONCE of them run at the same time; their findings
    // are still added in the order the checks are listed.
    const runPhase = async (phase) => {
      const list = probes(phase);
      const outputs = new Array(list.length);
      const isolated = list.map((probe, i) => ({ probe, i })).filter(({ probe }) => probe.isolated || probe.clock);
      let next = 0;
      const worker = async () => {
        for (let k = next++; k < isolated.length; k = next++) {
          const { probe, i } = isolated[k];
          let p;
          try { p = await timed(result, probe.name, () => fresh({ clock: !!probe.clock, reducedMotion: probe.reducedMotion })); } catch (e) {
            outputs[i] = { issues: [], notes: [`the ${probe.name} check could not open the page again: ${String(e.message).split('\n')[0]}`] };
            continue;
          }
          outputs[i] = await runProbe(probe, p, probeCtx, result);
          await p.context().close().catch(() => {});
          // A renderer that crashed under load takes its page with it. Try once more on a new copy.
          if (outputs[i].crashed) {
            const again = await timed(result, probe.name, () => fresh({ clock: !!probe.clock, reducedMotion: probe.reducedMotion })).catch(() => null);
            if (again) {
              outputs[i] = await runProbe(probe, again, probeCtx, result);
              await again.context().close().catch(() => {});
            }
          }
        }
      };
      const running = Promise.all(Array.from({ length: Math.min(ISOLATED_AT_ONCE, isolated.length) }, worker));
      for (const [i, probe] of list.entries()) {
        if (!(probe.isolated || probe.clock)) outputs[i] = await runProbe(probe, page, probeCtx, result);
      }
      await running;
      for (const out of outputs) {
        result.issues.push(...out.issues);
        result.notes.push(...out.notes);
      }
    };

    // Order matters. First everything that only looks at the page, then what measures it,
    // then the keyboard walk, then the checks that operate or resize it.
    const axe = await timed(result, 'axe', () => runAxe(page, opts.level));
    result.engine = axe.engine;
    result.review = await timed(result, 'inventory', () => takeInventory(page));
    await runPhase('look');

    const contrast = await timed(result, 'contrast-on-image', () => measureContrastOnImages(page, axe.unmeasuredContrast, { level: opts.level }));
    // What is left for a person after measuring: axe's other undecided rules, plus the text
    // whose background passes in some places and fails in others.
    result.needsReview = axe.needsReview
      .map((r) => (r.id === 'color-contrast' ? { ...r, count: r.count - contrast.resolved - contrast.issues.length } : r))
      .filter((r) => r.count > 0);
    result.review.contrast = contrast.unresolved;
    const video = await timed(result, 'moving-video', () => checkMovingVideo(page));
    const unreachable = await timed(result, 'unreachable', () => checkUnreachable(page));
    const spacing = await timed(result, 'text-spacing', () => checkTextSpacing(page));
    result.issues.push(...axe.issues, ...contrast.issues, ...video, ...unreachable, ...spacing);
    await runPhase('measure');

    // `fresh` lets the walk confirm, in a copy of the page, what it saw happen on focus.
    const keyboard = await timed(result, 'keyboard-walk', () => walkKeyboard(page, { maxStops: opts.maxTabStops, level: opts.level, fresh }));
    result.tabStops = keyboard.stops;
    result.issues.push(...keyboard.issues);
    result.notes.push(...(keyboard.notes || []));
    if (keyboard.capped) result.notes.push(`stopped after ${opts.maxTabStops} tab stops; the rest of the page was not walked`);
    if (keyboard.framesSkipped) result.notes.push(`${keyboard.framesSkipped} embedded frame(s) take focus; focus inside them was not checked`);
    for (const name of keyboard.dialogsOpened) result.notes.push(`a popup ("${name}") opened during the audit and covered the page; what is behind it was not fully walked. Use --storage-state with the popup already dismissed to audit the page itself`);

    // A popup that has taken over the page would make these report on the popup, not the page.
    if (!keyboard.dialogsOpened.length) {
      result.issues.push(...await timed(result, 'hover-menus', () => checkHoverMenus(page)));
      const toggles = await timed(result, 'disclosures', () => checkDisclosures(page));
      result.issues.push(...toggles.issues);
      result.notes.push(...toggles.notes);
    }
    // Reflow is defined at 320 CSS pixels on a desktop browser zoomed to 400%. A phone
    // emulation lays a page out differently, so it is measured from desktop windows only.
    if (!viewport.isMobile) result.issues.push(...await timed(result, 'reflow', () => checkReflow(page)));
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
export function mergeViews(audits) {
  const byUrl = new Map();
  for (const a of audits) {
    if (!byUrl.has(a.url)) byUrl.set(a.url, []);
    byUrl.get(a.url).push(a);
  }
  const label = (a) => a.viewport + (new Set(audits.map((x) => x.browser)).size > 1 ? ` ${a.browser}` : '');
  return [...byUrl.values()].map((views) => {
    // A view that could not be audited makes the page an error: its findings are missing, and
    // calling the others "desktop only" would hide that.
    const ok = views.filter((v) => !v.error);
    const failed = views.filter((v) => v.error);
    const first = ok[0] || views[0];
    const issues = new Map();
    for (const v of ok) for (const i of v.issues) {
      const key = `${i.kind}|${i.id}|${i.selector}|${i.message}`;
      if (!issues.has(key)) issues.set(key, { ...i, seenOn: [] });
      issues.get(key).seenOn.push(label(v));
    }
    const everywhere = ok.map(label);
    const notes = new Map();
    for (const v of ok) for (const n of v.notes) {
      if (!notes.has(n)) notes.set(n, []);
      notes.get(n).push(label(v));
    }
    const error = !failed.length ? null
      : !ok.length ? first.error
      : failed.map((v) => `${label(v)}: ${v.error}`).join('; ');
    return {
      url: first.url, status: first.status, error,
      engine: first.engine,
      issues: [...issues.values()].map((i) => ({ ...i, seenOn: i.seenOn.length === everywhere.length ? null : i.seenOn })),
      needsReview: first.needsReview, review: first.review, tabStops: first.tabStops,
      notes: [...notes].map(([n, on]) => (on.length === everywhere.length ? n : `${n} (${on.join(', ')})`)),
      views: views.map((v) => ({ viewport: v.viewport, browser: v.browser, tabStops: v.tabStops, error: v.error, timings: v.timings })),
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
    dismiss: true, proxy: null, storageState: null, rate: 8, ai: null,
    onPage: () => {},
    ...options,
  };
  opts.jar = { cookies: [] };
  if (opts.rate !== 0 && !(Number.isFinite(opts.rate) && opts.rate > 0)) throw new AccessReadyError(`--rate needs a number of requests a second, or 0 for no limit; got ${opts.rate}`);
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
  opts.traffic = traffic(start.origin, { rate: opts.rate });
  const browsers = [];
  try {
    for (const b of opts.browsers) browsers.push(await launch(b, opts.proxy));
    // The AI review reads each page in one view only, the run's first screen size and
    // browser, so the same page gives the same input and a rerun is answered from the cache.
    if (opts.ai) opts.ai = { ...opts.ai, view: viewports[0].name, engine: engineOf(browsers[0]) };

    // What to audit: the paths given; or the one page named; or everything in the sitemap.
    // `siteUrls` is every page known to be part of the site, including sitemap entries past
    // --max: checks such as multiple ways (2.4.5) depend on how many pages the site has.
    let urls, discovery, siteUrls;
    const namedPage = start.pathname !== '/' || start.search;
    if (opts.paths.length) {
      urls = opts.paths.map((p) => new URL(p, start.origin).href);
      discovery = 'paths given';
    } else if (namedPage && !opts.sitemap) {
      urls = [start.href];
      discovery = 'single page';
    } else {
      const found = await discoverFromSitemap(browsers[0], opts.sitemap || start.origin + '/sitemap.xml', start.origin, opts);
      siteUrls = found.urls;
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
        // A site that stopped accepting connections partway through is probably limiting or
        // blocking this machine. Asking again would only make that worse.
        pages[i] = opts.traffic.stats.refused
          ? { url, viewport: viewport.name, browser: engineOf(browser), status: null, issues: [], needsReview: [], review: null, tabStops: 0, notes: [], timings: {},
              error: 'not audited: the site stopped accepting connections partway through, so it may be limiting or blocking this machine. Wait a while, then try again with a lower --rate or --concurrency 1' }
          : await auditPage(browser, url, viewport, opts);
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
    const siteCtx = { level: opts.level, opts, browser: browsers[0], origin: start.origin, siteUrls: siteUrls || urls, cache: new Map() };
    for (const group of groups.values()) {
      checkAcrossPages(group);
      for (const probe of SITE_PROBES) {
        try { await probe.run(group.filter((p) => !p.error), siteCtx); } catch (e) {
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
      traffic: { rate: opts.rate, ...opts.traffic.stats },
      totals: summarize(merged), pages: merged,
      ...(ai ? { ai: ai.summary } : {}),
    };
  } finally {
    for (const b of browsers) await b.close().catch(() => {});
  }
}

