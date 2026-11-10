import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE = fileURLToPath(new URL('./fixtures/site/', import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.xml': 'application/xml', '.webm': 'video/webm', '.png': 'image/png' };

// Serves test/fixtures/site, on a free port unless one is given. `extra` maps a path to a function returning HTML,
// for pages a test builds itself.
export async function startSite(extra = {}, port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    try {
      if (extra[path]) {
        res.writeHead(200, { 'content-type': TYPES['.html'] });
        return res.end(extra[path]());
      }
      const file = join(SITE, normalize(path === '/' ? '/clean.html' : path));
      if (!file.startsWith(SITE)) throw new Error('outside the fixture folder');
      let body = await readFile(file);
      if (extname(file) === '.xml') body = body.toString().replaceAll('__ORIGIN__', origin);
      res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
    }
  });
  await new Promise((done) => server.listen(port, '127.0.0.1', done));
  const origin = `http://127.0.0.1:${server.address().port}`;
  return { origin, close: () => new Promise((done) => server.close(done)) };
}

// The ids of one page's issues of a given kind, sorted, so a test can compare them exactly.
export const ids = (page, kind = 'failure') => page.issues.filter((i) => i.kind === kind).map((i) => i.id).sort();
