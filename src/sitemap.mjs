// Reads a sitemap through the browser, so a CDN that challenges plain HTTP clients still
// answers, and follows one level of sitemap index.
const MAX_CHILD_SITEMAPS = 20;

const locs = (xml) => [...xml.matchAll(/<loc>\s*(?:<!\[CDATA\[)?\s*([^<\]\s]+)\s*(?:\]\]>)?\s*<\/loc>/gi)]
  .map((m) => m[1].replace(/&amp;/g, '&'));

async function fetchXml(context, url, timeout) {
  let res = await context.request.get(url, { timeout, failOnStatusCode: false });
  if (res.status() === 403) {
    // Same CDN challenge the page loader waits out: let a real page clear it, then retry.
    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'load', timeout }).catch(() => {});
    await page.waitForTimeout(6000);
    await page.close();
    res = await context.request.get(url, { timeout, failOnStatusCode: false });
  }
  return res.ok() ? res.text() : '';
}

export async function discoverFromSitemap(browser, sitemapUrl, origin, { timeout = 45000, storageState } = {}) {
  const context = await browser.newContext(storageState ? { storageState } : {});
  try {
    const xml = await fetchXml(context, sitemapUrl, timeout).catch(() => '');
    let found = locs(xml);
    if (/<sitemapindex[\s>]/i.test(xml)) {
      const children = found.slice(0, MAX_CHILD_SITEMAPS);
      found = [];
      for (const child of children) found.push(...locs(await fetchXml(context, child, timeout).catch(() => '')));
    }
    // Only pages on the site being audited. www and non-www count as the same site, and
    // every URL is rewritten onto the origin that was asked for (a local build's sitemap
    // usually lists the production domain).
    const bare = (host) => host.replace(/^www\./, '');
    const want = new URL(origin);
    const urls = [];
    for (const loc of found) {
      let u;
      try { u = new URL(loc); } catch { continue; }
      if (bare(u.hostname) !== bare(want.hostname) && !isLocal(want.hostname)) continue;
      urls.push(want.origin + u.pathname + u.search);
    }
    return { urls: [...new Set(urls)], tried: sitemapUrl };
  } finally {
    await context.close();
  }
}

const isLocal = (host) => host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
