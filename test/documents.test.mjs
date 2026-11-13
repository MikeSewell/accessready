// PDFs linked from audited pages: downloaded once per audit, read with pdf.js, one finding
// per problem per document, attached to the first page that links it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { audit } from '../src/index.mjs';
import { startSite } from './helpers.mjs';

const UNTAGGED = readFileSync(new URL('./fixtures/site/docs/untagged.pdf', import.meta.url));
let site, other, result, crossHost, edgeCases, oversized, peakGrowth;
const requests = [];
// Bytes the server that ignores Range managed to send before the download was dropped.
const streamed = { sent: 0, closed: false };
const MB = 1024 * 1024;
// 400 MB of zeros as 400 one-megabyte gzip members, back to back: a valid gzip body of about
// 400 KB, made in a moment.
const BOMB = Buffer.concat(Array(400).fill(gzipSync(Buffer.alloc(MB))));

// Sends 100 MB in answer to any request, Range or not, as fast as the reader takes it.
function sendForever(res) {
  res.writeHead(200, { 'content-type': 'application/pdf' });
  const chunk = Buffer.alloc(64 * 1024, 0x20);
  chunk.write('%PDF-1.4\n');
  res.on('close', () => { streamed.closed = true; });
  const pump = () => {
    while (streamed.sent < 100 * MB && !res.destroyed) {
      streamed.sent += chunk.length;
      if (!res.write(chunk)) return res.once('drain', pump);
    }
    if (!res.destroyed) res.end();
  };
  pump();
}

// A second host, for PDFs a site keeps somewhere else. It records every request it gets.
async function startOther() {
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, range: req.headers.range });
    if (req.url === '/handbook.pdf') { res.writeHead(200, { 'content-type': 'application/pdf' }); return res.end(UNTAGGED); }
    // Answers the Range request with a slice of a file far over the size cap.
    if (req.url === '/huge.pdf') { res.writeHead(206, { 'content-type': 'application/pdf', 'content-range': 'bytes 0-99/999999999' }); return res.end(UNTAGGED.subarray(0, 100)); }
    if (req.url === '/no-range.pdf') return sendForever(res);
    if (req.url === '/bomb.pdf') { res.writeHead(200, { 'content-type': 'application/pdf', 'content-encoding': 'gzip' }); return res.end(BOMB); }
    if (req.url === '/login.pdf') { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>Sign in</title>'); }
    res.writeHead(404); res.end();
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  // "localhost" and "127.0.0.1" are different hosts to a browser, so this is off the audited origin.
  return { origin: `http://localhost:${server.address().port}`, close: () => new Promise((done) => server.close(done)) };
}

const page = (body) => () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Documents ${Math.random()}</title></head><body><main><h1>Documents</h1><p>${body}</p></main></body></html>`;

before(async () => {
  other = await startOther();
  site = await startSite({
    '/elsewhere.html': page(`<a href="${other.origin}/handbook.pdf">Volunteer handbook (PDF)</a>`),
    '/edge.html': page(`<a href="${other.origin}/huge.pdf">Archive (PDF)</a>, <a href="${other.origin}/login.pdf">Members only (PDF)</a>`),
    '/oversized.html': page(`<a href="${other.origin}/no-range.pdf">Annual report (PDF)</a>, <a href="${other.origin}/bomb.pdf">Minutes (PDF)</a>`),
  });
  result = await audit(site.origin, { viewports: ['desktop'], paths: ['/site-docs.html', '/site-docs-2.html'] });
  // Both screen sizes, to show each PDF is still downloaded only once.
  crossHost = await audit(`${site.origin}/elsewhere.html`, { viewports: ['desktop', 'phone'] });
  edgeCases = await audit(`${site.origin}/edge.html`, { viewports: ['desktop'] });
  // Memory is sampled while the oversized files are fetched: reading either one whole would
  // add hundreds of megabytes to this process.
  const base = process.memoryUsage().rss;
  let peak = base;
  const sampler = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20);
  try { oversized = await audit(`${site.origin}/oversized.html`, { viewports: ['desktop'] }); } finally { clearInterval(sampler); }
  peakGrowth = peak - base;
});
after(async () => { await site.close(); await other.close(); });

test('each problem in each PDF is reported once, on the first page that links it', () => {
  const [first, second] = result.pages;
  assert.deepEqual(first.issues.map((i) => [i.kind, i.id, new URL(i.document).pathname]), [
    ['failure', 'pdf-untagged', '/docs/untagged.pdf'],
    ['failure', 'pdf-no-title', '/docs/untagged.pdf'],
    ['failure', 'pdf-no-language', '/docs/untagged.pdf'],
    ['failure', 'pdf-untagged', '/docs/scanned.pdf'],
    ['advice', 'pdf-title-hidden', '/docs/scanned.pdf'],
    ['failure', 'pdf-image-only', '/docs/scanned.pdf'],
    ['advice', 'pdf-no-bookmarks', '/docs/long.pdf'],
  ]);
  // The tagged, titled report is clean, and the handbook linked again is not counted twice.
  assert.deepEqual(second.issues, []);
  assert.ok(first.issues.every((i) => i.scope === 'site' && i.extra.includes('documents')));
});

test('each problem maps to the criterion it breaks', () => {
  const wcag = Object.fromEntries(result.pages[0].issues.map((i) => [i.id, i.wcag]));
  assert.deepEqual(wcag, {
    'pdf-untagged': ['1.3.1'], 'pdf-no-title': ['2.4.2'], 'pdf-no-language': ['3.1.1'],
    'pdf-image-only': ['1.1.1', '1.4.5'], 'pdf-title-hidden': ['2.4.2'], 'pdf-no-bookmarks': [],
  });
  const untagged = result.pages[0].issues[0];
  assert.equal(untagged.message, '/docs/untagged.pdf is not tagged, so screen readers get no headings, lists, tables or reading order');
  assert.equal(untagged.selector, 'a[href="docs/untagged.pdf"]');
  assert.match(result.pages[0].issues.at(-1).message, /^\/docs\/long\.pdf has 12 pages and no bookmarks/);
});

test('a PDF that cannot be fetched is a note, not a finding', () => {
  assert.deepEqual(result.pages[0].notes, ['the PDF /docs/missing.pdf could not be checked: the server answered 404']);
  assert.equal(result.totals.failures, 5);
});

test('a PDF on another host is checked once per audit, with a GET, and the report says so', () => {
  const p = crossHost.pages[0];
  assert.deepEqual(p.issues.map((i) => [i.id, i.seenOn]), [['pdf-untagged', null], ['pdf-no-title', null], ['pdf-no-language', null]]);
  assert.match(p.issues[0].message, new RegExp(`^${other.origin}/handbook\\.pdf is not tagged`));
  assert.ok(p.notes.includes(`PDFs linked from these pages but kept on another host were downloaded and checked too: ${new URL(other.origin).host}`), p.notes.join('\n'));
  const handbook = requests.filter((r) => r.path === '/handbook.pdf');
  assert.equal(handbook.length, 1, 'downloaded once for two screen sizes');
  assert.equal(handbook[0].method, 'GET');
  assert.equal(handbook[0].range, 'bytes=0-20971520');
  assert.ok(requests.every((r) => r.method === 'GET' && r.path.endsWith('.pdf')), 'nothing else on the other host was requested');
});

test('files over the size cap and links that return a web page are skipped with a note', () => {
  const p = edgeCases.pages[0];
  assert.deepEqual(p.issues, []);
  const host = new URL(other.origin).host;
  assert.deepEqual(p.notes.filter((n) => n.startsWith('the PDF')), [
    `the PDF ${other.origin}/huge.pdf could not be checked: it is larger than 20 MB`,
    `the PDF ${other.origin}/login.pdf could not be checked: the link returned a web page, not a PDF (a login page or an error page?)`,
  ]);
  assert.ok(p.notes.some((n) => n.endsWith(host)));
});

test('a server that ignores Range, and a small gzip body that expands to 400 MB, are dropped at the cap', () => {
  const p = oversized.pages[0];
  assert.deepEqual(p.issues, []);
  assert.deepEqual(p.notes.filter((n) => n.startsWith('the PDF')), [
    `the PDF ${other.origin}/no-range.pdf could not be checked: it is larger than 20 MB`,
    `the PDF ${other.origin}/bomb.pdf could not be checked: it is larger than 20 MB`,
  ]);
  // The connection was closed soon after the cap, not read to the end of its 100 MB.
  assert.ok(streamed.closed, 'the download was stopped');
  assert.ok(streamed.sent < 50 * MB, `${Math.round(streamed.sent / MB)} MB were sent`);
  assert.ok(peakGrowth < 150 * MB, `memory grew by ${Math.round(peakGrowth / MB)} MB`);
});
