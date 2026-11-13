// One audit opens each page many times. These tests hold it to what a server with a rate
// limit and fail2ban tolerates: assets fetched once per audit, requests paced, a slowdown when
// the site says it is busy, and no more requests once the site stops answering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { audit } from '../src/index.mjs';

const IMAGES = 12;
const page = (title) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title>
<link rel="stylesheet" href="/style.css"><script src="/app.js" defer></script></head>
<body><main><h1>${title}</h1>${Array.from({ length: IMAGES }, (_, i) => `<img src="/img/${i}.svg" alt="Picture ${i}" width="40" height="40">`).join('')}
<p><a href="/a">First page</a> <a href="/b">Second page</a></p></main></body></html>`;
const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#246"/></svg>';

// A small site that counts what it is asked for. `limit` makes it answer 503 the way nginx's
// limit_req does: `limit` requests a second, plus a burst of `limit`, and refused past that.
async function site({ limit = Infinity } = {}) {
  const hits = new Map();
  let excess = 0, last = Date.now();
  let busy = 0;
  const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    hits.set(path, (hits.get(path) || 0) + 1);
    const now = Date.now();
    excess = Math.max(0, excess - ((now - last) / 1000) * limit) + 1;
    last = now;
    if (excess > limit * 2) { excess -= 1; busy++; res.writeHead(503); return res.end('slow down'); }
    if (path === '/style.css') { res.writeHead(200, { 'content-type': 'text/css' }); return res.end('body { font: 18px sans-serif; }'); }
    if (path === '/app.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); return res.end('window.ready = true;'); }
    if (path.startsWith('/img/')) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(svg); }
    if (path === '/a' || path === '/b' || path === '/c') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end(page(`Page ${path.slice(1).toUpperCase()}`)); }
    res.writeHead(404); res.end('not found');
  });
  const sockets = new Set();
  server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  return {
    origin: `http://127.0.0.1:${server.address().port}`, hits, busy: () => busy,
    // Stop answering at all, the way a firewall ban looks from outside.
    refuse: () => { server.close(); for (const s of sockets) s.destroy(); },
    close: () => new Promise((done) => { for (const s of sockets) s.destroy(); server.close(() => done()); }),
  };
}

test('every copy of every page reuses the stylesheets, scripts and images fetched the first time', async () => {
  const s = await site();
  const r = await audit(s.origin, { paths: ['/a', '/b'], viewports: ['desktop', 'phone'] });
  await s.close();
  assert.equal(r.totals.errors, 0);
  // Two pages, two screen sizes, and fresh copies for several checks: many page loads, but
  // each asset was requested once.
  assert.ok(s.hits.get('/a') >= 4, `page /a was loaded ${s.hits.get('/a')} times`);
  assert.equal(s.hits.get('/style.css'), 1);
  assert.equal(s.hits.get('/app.js'), 1);
  for (let i = 0; i < IMAGES; i++) assert.equal(s.hits.get(`/img/${i}.svg`), 1, `image ${i}`);
  assert.ok(r.traffic.reused > 0);
});

test('a site that limits requests a second never has to turn the audit away', async () => {
  // 10 a second with a burst of 10, a common nginx limit_req setting.
  const s = await site({ limit: 10 });
  const r = await audit(s.origin, { paths: ['/a', '/b', '/c'], viewports: ['desktop', 'phone'], concurrency: 3 });
  await s.close();
  assert.equal(s.busy(), 0);
  assert.equal(r.traffic.limited, 0);
  assert.equal(r.totals.errors, 0);
});

test('when the site answers 503, the audit slows down and says so', async () => {
  const s = await site({ limit: 2 });
  const r = await audit(s.origin, { paths: ['/a'], viewports: ['desktop'], rate: 50 });
  await s.close();
  assert.ok(s.busy() > 0);
  assert.ok(r.traffic.limited > 0);
});

test('a site that stops answering partway through is not asked again', async () => {
  const s = await site();
  let first = true;
  const r = await audit(s.origin, {
    paths: ['/a', '/b', '/c'], viewports: ['desktop'], concurrency: 1,
    onPage: () => { if (first) { first = false; s.refuse(); } },
  });
  assert.equal(r.pages[0].error, null);
  assert.match(r.pages[1].error, /could not load/);
  assert.match(r.pages[2].error, /^not audited: the site stopped accepting connections partway through/);
  assert.equal(r.traffic.refused, true);
});

test('--rate 0 turns the pacing off; a negative rate is refused', async () => {
  await assert.rejects(audit('http://127.0.0.1:9/', { rate: -1 }), /--rate needs a number/);
  const s = await site();
  const r = await audit(s.origin, { paths: ['/a'], viewports: ['desktop'], rate: 0 });
  await s.close();
  assert.equal(r.totals.errors, 0);
  assert.equal(r.traffic.rate, 0);
});
