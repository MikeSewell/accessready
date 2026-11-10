import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { runAxe } from './checks/axe.mjs';
import { walkKeyboard } from './checks/keyboard.mjs';
import { checkMovingVideo, checkReflow, checkTextSpacing } from './checks/layout.mjs';
import { measureContrastOnImages } from './checks/contrast.mjs';
import { checkUnreachable, checkHoverMenus, checkDisclosures } from './checks/interact.mjs';
import { takeInventory } from './inventory.mjs';
import { checkAcrossPages } from './site.mjs';
import { discoverFromSitemap } from './sitemap.mjs';

export { renderConsole } from './report/console.mjs';
export { renderHtml } from './report/html.mjs';

export const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;

const REJECT = /^(reject|decline|deny|reject all|reject non-essential|necessary only|essential only|only necessary)$/i;

export class FocuswalkError extends Error {}

// Installed Chrome first: nothing to download, and it is what visitors use. Then the
// Chromium that `npx playwright install chromium` provides.
async function launch({ browser: choice = 'auto', proxy }) {
  const base = proxy ? { proxy: { server: proxy } } : {};
  const attempts = choice === 'chrome' ? [{ channel: 'chrome' }] : choice === 'chromium' ? [{}] : [{ channel: 'chrome' }, {}];
  let lastError;
  for (const opts of attempts) {
    try { return await chromium.launch({ ...base, ...opts }); } catch (e) { lastError = e; }
  }
  throw new FocuswalkError(
    `Could not start a browser. Install Google Chrome, or run:\n  npx playwright install chromium\n\n${String(lastError.message).split('\n')[0]}`,
  );
}

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

async function auditPage(browser, url, opts) {
  const context = await browser.newContext({
    viewport: opts.viewport,
    reducedMotion: 'reduce',
    ...(opts.storageState ? { storageState: opts.storageState } : {}),
  });
  const page = await context.newPage();
  const result = { url, status: null, error: null, issues: [], needsReview: [], review: null, tabStops: 0, notes: [] };
  try {
    let res;
    try {
      res = await open(page, url, opts.timeout);
    } catch (e) {
      result.error = `could not load: ${String(e.message).split('\n')[0]}`;
      return result;
    }
    result.status = res ? res.status() : null;
    if (res && res.status() >= 400) {
      result.error = `server answered ${res.status()}`;
      return result;
    }
    await page.waitForLoadState('networkidle', { timeout: 3000 }).catch(() => {});

    if (opts.dismiss) {
      // Answer a cookie banner the way a visitor would, choosing Reject, so the page under it
      // is what gets audited.
      const button = page.getByRole('button', { name: REJECT }).first();
      if (await button.count().catch(() => 0)) {
        const name = (await button.textContent().catch(() => '') || '').trim();
        if (await button.click({ timeout: 2000 }).then(() => true, () => false)) {
          result.notes.push(`clicked "${name}" on a cookie banner first`);
          await page.waitForTimeout(300);
        }
      }
    }

    // Order matters. First everything that only looks at the page, then the keyboard walk,
    // then the checks that operate or resize it.
    const axe = await runAxe(page);
    result.engine = axe.engine;
    result.review = await takeInventory(page);
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

    const keyboard = await walkKeyboard(page, { maxStops: opts.maxTabStops });
    result.tabStops = keyboard.stops;
    if (keyboard.capped) result.notes.push(`stopped after ${opts.maxTabStops} tab stops; the rest of the page was not walked`);
    if (keyboard.framesSkipped) result.notes.push(`${keyboard.framesSkipped} embedded frame(s) take focus; focus inside them was not checked`);
    for (const name of keyboard.dialogsOpened) result.notes.push(`a popup ("${name}") opened during the audit and covered the page; what is behind it was not fully walked. Use --storage-state with the popup already dismissed to audit the page itself`);

    // A popup that has taken over the page would make these report on the popup, not the page.
    let menus = [], toggles = { issues: [], notes: [] };
    if (!keyboard.dialogsOpened.length) {
      menus = await checkHoverMenus(page);
      toggles = await checkDisclosures(page);
      result.notes.push(...toggles.notes);
    }
    const reflow = await checkReflow(page);
    result.issues = [...axe.issues, ...contrast.issues, ...video, ...unreachable, ...spacing, ...keyboard.issues, ...menus, ...toggles.issues, ...reflow];
    return result;
  } catch (e) {
    result.error = `audit failed: ${String(e.message).split('\n')[0]}`;
    return result;
  } finally {
    await context.close();
  }
}

export function summarize(pages) {
  const count = (kind) => pages.reduce((n, p) => n + p.issues.filter((i) => i.kind === kind).length, 0);
  return {
    pages: pages.length,
    failures: count('failure'),
    advice: count('advice'),
    needsReview: pages.reduce((n, p) => n + p.needsReview.reduce((m, r) => m + r.count, 0), 0),
    errors: pages.filter((p) => p.error).length,
  };
}

// Exit code for a finished audit. --strict also fails on best-practice advice.
export function exitCode(result, { strict = false } = {}) {
  if (result.totals.errors) return 2;
  if (result.totals.failures || (strict && result.totals.advice)) return 1;
  return 0;
}

export async function audit(target, options = {}) {
  const opts = {
    paths: [], sitemap: null, max: 40, concurrency: 2, timeout: 45000, maxTabStops: 150,
    viewport: { width: 1440, height: 900 }, dismiss: true, browser: 'auto', proxy: null, storageState: null,
    onPage: () => {},
    ...options,
  };
  let start;
  try { start = new URL(target); } catch { throw new FocuswalkError(`Not a URL: ${target}`); }
  if (!/^https?:$/.test(start.protocol)) throw new FocuswalkError(`Only http and https URLs can be audited: ${target}`);

  const startedAt = new Date().toISOString();
  const browser = await launch(opts);
  try {
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
      const found = await discoverFromSitemap(browser, opts.sitemap || start.origin + '/sitemap.xml', start.origin, opts);
      urls = found.urls.slice(0, opts.max);
      discovery = found.urls.length
        ? `sitemap (${found.urls.length} page${found.urls.length === 1 ? '' : 's'}${found.urls.length > opts.max ? `, first ${opts.max} audited` : ''})`
        : `no sitemap at ${found.tried}; home page only`;
      if (!urls.length) urls = [start.origin + '/'];
    }

    const pages = new Array(urls.length);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < urls.length; i = next++) {
        pages[i] = await auditPage(browser, urls[i], opts);
        opts.onPage(pages[i], i, urls.length);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(opts.concurrency, urls.length)) }, worker));
    checkAcrossPages(pages);

    return {
      tool: 'focuswalk', version, target: start.origin, discovery, startedAt, finishedAt: new Date().toISOString(),
      engine: pages.find((p) => p.engine)?.engine || null,
      standard: 'WCAG 2.2 AA', viewport: opts.viewport,
      totals: summarize(pages), pages,
    };
  } finally {
    await browser.close();
  }
}
