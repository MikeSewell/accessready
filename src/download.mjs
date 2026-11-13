// A GET that stops reading at a size cap. Playwright's request context reads the whole
// response into memory before it hands any of it back, so a server that ignores a Range
// header, or a small gzip body that expands to hundreds of megabytes, could take the
// memory of the whole audit. Here the body is read as it arrives, decoded as it arrives,
// and the download is dropped the moment the decoded bytes pass the cap.
//
// Cookies come from the browser context the audit uses, asked again for each address on
// the way, so --storage-state sign-ins reach the file the way they would in a browser.
// --proxy is honoured with Node's own proxy support (Node 22.21 or 24.5 and later); where
// that is missing, the download is refused rather than sent around the proxy.
import http from 'node:http';
import https from 'node:https';
import zlib from 'node:zlib';

const DECODERS = { gzip: () => zlib.createGunzip(), 'x-gzip': () => zlib.createGunzip(), deflate: () => zlib.createInflate(), br: () => zlib.createBrotliDecompress() };

export class TooLarge extends Error {}

function proxySupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return major > 24 || (major === 24 && minor >= 5) || (major === 22 && minor >= 21);
}

function agentFor(url, proxy) {
  if (!proxy) return undefined;
  if (!/^https?:\/\//i.test(proxy)) throw new Error(`files cannot be downloaded through the proxy ${proxy}: only http and https proxies are supported for downloads`);
  if (!proxySupported()) throw new Error(`files cannot be downloaded through --proxy on Node ${process.versions.node}; Node 22.21 or 24.5 and later can`);
  return url.protocol === 'https:' ? new https.Agent({ proxyEnv: { HTTPS_PROXY: proxy } }) : new http.Agent({ proxyEnv: { HTTP_PROXY: proxy } });
}

// One hop. Resolves with the response once its headers are in; the body is read by readBody.
function request(url, { headers, signal, proxy }) {
  return new Promise((done, fail) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method: 'GET', headers, signal, agent: agentFor(url, proxy) }, done);
    req.on('error', fail);
    req.end();
  });
}

function readBody(res, maxBytes, signal) {
  return new Promise((done, fail) => {
    const encoding = String(res.headers['content-encoding'] || '').trim().toLowerCase();
    if (encoding && encoding !== 'identity' && !DECODERS[encoding]) {
      res.destroy();
      return fail(new Error(`the server sent it with an encoding this tool cannot read (${encoding})`));
    }
    // Without an encoding the declared length is the decoded length, so it can be refused
    // before a byte of the body is read.
    if (!DECODERS[encoding] && Number(res.headers['content-length']) > maxBytes) {
      res.destroy();
      return fail(new TooLarge());
    }
    const decoded = DECODERS[encoding] ? res.pipe(DECODERS[encoding]()) : res;
    const chunks = [];
    let size = 0;
    let settled = false;
    const stop = (error, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', onAbort);
      if (error) { res.destroy(); if (decoded !== res) decoded.destroy(); fail(error); } else done(value);
    };
    const onAbort = () => stop(signal.reason instanceof Error ? signal.reason : new Error('the download was stopped'));
    signal.addEventListener('abort', onAbort);
    decoded.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBytes) return stop(new TooLarge());
      chunks.push(chunk);
    });
    decoded.on('end', () => stop(null, Buffer.concat(chunks, size)));
    decoded.on('error', (e) => stop(new Error(`the file could not be decoded: ${e.message}`)));
    res.on('error', (e) => stop(e));
    res.on('aborted', () => stop(new Error('the server closed the connection part way')));
  });
}

// GET `url` with the cookies `context` holds for it. Resolves with { status, headers, body }
// (headers lowercased, the body decoded), or rejects with TooLarge once the decoded body
// passes `maxBytes`, or with an error on a network failure or when `timeout` (for the whole
// download, redirects included) runs out. `inspect(status, headers)` runs before the body is
// read and may throw (TooLarge, say) to drop the download there.
export async function cappedGet(context, url, { maxBytes, timeout, maxRedirects = 5, headers = {}, proxy = null, inspect = null }) {
  const signal = AbortSignal.timeout(timeout);
  let current = new URL(url);
  try {
    for (let hop = 0; ; hop++) {
      if (!/^https?:$/.test(current.protocol)) throw new Error(`it redirects to ${current.protocol} address, which is not downloaded`);
      const cookies = await context.cookies(current.href).catch(() => []);
      const res = await request(current, {
        signal, proxy,
        headers: {
          'accept-encoding': 'gzip, deflate, br',
          ...(cookies.length ? { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') } : {}),
          ...headers,
        },
      });
      const location = res.headers.location;
      if (res.statusCode >= 300 && res.statusCode < 400 && location) {
        res.resume();
        if (hop >= maxRedirects) throw new Error(`it redirects more than ${maxRedirects} times`);
        current = new URL(location, current);
        continue;
      }
      if (res.statusCode >= 400) {
        res.resume();
        return { status: res.statusCode, headers: res.headers, body: Buffer.alloc(0) };
      }
      try { inspect?.(res.statusCode, res.headers); } catch (e) { res.destroy(); throw e; }
      return { status: res.statusCode, headers: res.headers, body: await readBody(res, maxBytes, signal) };
    }
  } catch (e) {
    if (signal.aborted && !(e instanceof TooLarge)) throw new Error(`no complete answer within ${Math.round(timeout / 1000)} seconds`);
    throw e;
  }
}
