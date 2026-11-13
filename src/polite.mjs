// Keeps an audit from looking like an attack. One audit opens each page several times (phone
// and desktop, plus fresh copies for checks that change things), and a server with a rate
// limit and fail2ban will ban the machine running it. So, for requests to the audited site:
//   - stylesheets, scripts, images and fonts are downloaded once per audit and reused by every
//     copy of every page;
//   - everything else goes out no faster than `rate` requests a second, after a short burst;
//   - a "429 Too Many Requests" or "503" from the site slows the audit right down;
//   - a site that starts refusing connections partway through is not asked again.
// Requests to other hosts (CDNs, analytics) are left alone.

const CACHEABLE = new Set(['stylesheet', 'script', 'image', 'font']);
const MAX_ASSET = 5 * 1024 * 1024; // larger files are fetched each time, not kept in memory
const MAX_CACHE = 200 * 1024 * 1024;
const SLOW_RATE = 1; // requests a second after the site has asked us to slow down
const PAUSE_AFTER_LIMIT = 10_000;

// The body handed back is already decoded, so the headers must not say otherwise.
const DROP = new Set(['content-encoding', 'content-length', 'transfer-encoding']);
const clean = (headers) => Object.fromEntries(Object.entries(headers).filter(([k]) => !DROP.has(k.toLowerCase())));

const REFUSED = /ERR_CONNECTION_REFUSED|ERR_CONNECTION_RESET|ECONNREFUSED|ECONNRESET|ERR_NETWORK_ACCESS_DENIED/;

export function traffic(origin, { rate = 8 } = {}) {
  const unlimited = !rate;
  let perSecond = rate;
  // The burst is one second's worth: a server that allows `rate` a second plus any burst of
  // that size never sees more than it allows.
  const burst = () => Math.max(1, perSecond);
  let tokens = rate;
  let last = Date.now();
  let pausedUntil = 0;
  let queue = Promise.resolve();
  const cache = new Map();
  const pending = new Map(); // assets being fetched right now, so a second copy waits for the first
  let cached = 0;
  const stats = { requests: 0, reused: 0, limited: 0, refused: false, loaded: 0 };

  // A token bucket, served in order: each request waits for the one before it.
  const take = () => {
    if (unlimited) return Promise.resolve();
    queue = queue.then(async () => {
      for (;;) {
        const now = Date.now();
        if (now < pausedUntil) { await sleep(pausedUntil - now); continue; }
        tokens = Math.min(burst(), tokens + ((now - last) / 1000) * perSecond);
        last = now;
        if (tokens >= 1) { tokens -= 1; return; }
        await sleep(Math.ceil(((1 - tokens) / perSecond) * 1000));
      }
    });
    return queue;
  };

  const sameSite = (url) => { try { return new URL(url).origin === origin; } catch { return false; } };

  const slowDown = () => {
    stats.limited++;
    if (unlimited) return;
    perSecond = SLOW_RATE;
    tokens = 0;
    pausedUntil = Date.now() + PAUSE_AFTER_LIMIT;
  };

  const handler = async (route) => {
    const req = route.request();
    const url = req.url();
    if (req.method() === 'GET' && CACHEABLE.has(req.resourceType())) {
      const hit = cache.get(url) || await pending.get(url);
      if (hit) {
        stats.reused++;
        return route.fulfill({ status: hit.status, headers: hit.headers, body: hit.body }).catch(() => {});
      }
      let settle;
      pending.set(url, new Promise((done) => { settle = done; }));
      try {
        await take();
        stats.requests++;
        let response;
        try {
          response = await route.fetch();
        } catch (e) {
          if (REFUSED.test(String(e.message))) stats.refused = stats.loaded > 0;
          return route.abort().catch(() => {});
        }
        const status = response.status();
        if (status === 429 || status === 503) slowDown();
        const body = await response.body().catch(() => null);
        if (body && status === 200 && body.length <= MAX_ASSET && cached + body.length <= MAX_CACHE) {
          const entry = { status, headers: clean(response.headers()), body };
          cache.set(url, entry);
          cached += body.length;
          settle(entry);
        }
        return (body ? route.fulfill({ status, headers: clean(response.headers()), body }) : route.fulfill({ response })).catch(() => {});
      } finally {
        settle(null);
        pending.delete(url);
      }
    }
    await take();
    stats.requests++;
    return route.fallback().catch(() => {});
  };

  return {
    stats,
    // Installed on every browser context of the audit.
    async attach(context) {
      await context.route((url) => sameSite(url.href), handler);
      context.on('response', (res) => {
        if (sameSite(res.url()) && (res.status() === 429 || res.status() === 503) && !CACHEABLE.has(res.request().resourceType())) slowDown();
      });
    },
    // After a page load: remember that the site answered, or notice that it stopped answering.
    loaded() { stats.loaded++; },
    failed(message) { if (REFUSED.test(String(message)) && stats.loaded > 0) stats.refused = true; },
  };
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
