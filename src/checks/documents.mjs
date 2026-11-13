// Documents linked from the site. ADA Title II, Section 508 and EN 301 549 all cover PDFs a
// site offers, not only its web pages, and a PDF is where accessibility most often breaks: a
// scan with no text, or an export that dropped the tags. Each PDF linked from an audited page
// is downloaded once per audit and read with pdf.js (Mozilla's PDF reader), which reports
// what a screen reader would get: tags, title, language, text and bookmarks.
//
// Safety: only GET, at most MAX_DOCUMENTS files, each capped at MAX_BYTES and DOWNLOAD_TIMEOUT.
// PDFs on another host are still checked when an audited page links them, because the site is
// offering them to its visitors (a city's agendas on a document host are still the city's
// documents). Nothing else on another host is ever requested, and the report says which
// hosts were contacted.
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { issue } from './index.mjs';
import { cappedGet, TooLarge } from '../download.mjs';

const MAX_DOCUMENTS = 25;
const MAX_BYTES = 20 * 1024 * 1024;
const DOWNLOAD_TIMEOUT = 30000;
const PAGES_READ = 50; // enough to tell a scan from a text document without reading a 900-page manual
const LONG = 10; // pages; from here on a reader needs bookmarks to find their way
const AT_ONCE = 3;

const IMAGE_OPS = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
  OPS.paintImageXObjectRepeat, OPS.paintImageMaskXObjectRepeat, OPS.paintInlineImageXObjectGroup, OPS.paintImageMaskXObjectGroup].filter((n) => n !== undefined));

// Every link to a PDF on the page, hidden menus included: a link in a closed menu is still
// a document the site offers.
async function collectLinks(page, ctx) {
  ctx.result.documentLinks = await page.evaluate(() => {
    const out = new Map();
    for (const a of document.querySelectorAll('a[href]')) {
      let u;
      try { u = new URL(a.href); } catch { continue; }
      if (!/^https?:$/.test(u.protocol)) continue;
      const pdf = /\.pdf$/i.test(u.pathname) || /^application\/pdf\b/i.test(a.type || '');
      if (!pdf) continue;
      u.hash = '';
      if (!out.has(u.href)) out.set(u.href, { url: u.href, href: a.getAttribute('href'), html: a.outerHTML.replace(/\s+/g, ' ').slice(0, 160) });
      if (out.size >= 200) break;
    }
    return [...out.values()];
  });
  return [];
}

// Downloads one PDF. The size cap is asked of the server with a Range header (static hosts,
// CDNs and S3 honour it), checked against the size the server declares, and enforced on the
// decoded bytes as they arrive, so a server that ignores Range, or a small compressed body
// that expands to gigabytes, is dropped at the cap instead of filling memory.
async function download(context, url, proxy) {
  let res;
  try {
    res = await cappedGet(context, url, {
      maxBytes: MAX_BYTES, timeout: DOWNLOAD_TIMEOUT, maxRedirects: 5, proxy,
      headers: { Range: `bytes=0-${MAX_BYTES}` },
      inspect: (status, headers) => {
        const total = Number(/\/(\d+)$/.exec(headers['content-range'] || '')?.[1] || 0);
        if (total > MAX_BYTES) throw new TooLarge();
      },
    });
  } catch (e) {
    if (e instanceof TooLarge) return { error: `it is larger than ${MAX_BYTES / 1024 / 1024} MB` };
    throw e;
  }
  if (res.status >= 400) return { error: `the server answered ${res.status}` };
  if (!res.body.subarray(0, 1024).includes('%PDF-')) {
    return { error: /html/i.test(res.headers['content-type'] || '') ? 'the link returned a web page, not a PDF (a login page or an error page?)' : 'the file is not a PDF' };
  }
  return { body: res.body };
}

const asMap = (v) => (v instanceof Map ? v : new Map(Object.entries(v || {})));
const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

// What a screen reader would get from the file.
async function read(body) {
  const task = getDocument({ data: new Uint8Array(body), verbosity: 0, isEvalSupported: false, disableFontFace: true, useSystemFonts: false, stopAtErrors: false });
  try {
    const doc = await task.promise;
    const { info, metadata } = await doc.getMetadata();
    const out = {
      pages: doc.numPages,
      title: clean(metadata?.get?.('dc:title') || info?.Title),
      lang: clean(info?.Language),
      marked: asMap(await doc.getMarkInfo()).get('Marked') === true,
      showsTitle: asMap(await doc.getViewerPreferences()).get('DisplayDocTitle') === true,
      bookmarks: ((await doc.getOutline()) || []).length > 0,
      tree: false, treeLang: false, textChars: 0, picturePages: [], read: Math.min(doc.numPages, PAGES_READ),
    };
    for (let n = 1; n <= out.read; n++) {
      const page = await doc.getPage(n);
      const tree = await page.getStructTree().catch(() => null);
      if (tree?.children?.length) {
        out.tree = true;
        if (tree.lang || tree.children.some((c) => c.lang)) out.treeLang = true;
      }
      const chars = (await page.getTextContent()).items.reduce((sum, item) => sum + clean(item.str).length, 0);
      out.textChars += chars;
      if (!chars && (await page.getOperatorList()).fnArray.some((fn) => IMAGE_OPS.has(fn))) out.picturePages.push(n);
      page.cleanup();
    }
    return out;
  } finally {
    await task.destroy().catch(() => {});
  }
}

// One finding per problem, in the order a person would fix them.
function problems(d) {
  const out = [];
  if (!d.tree) out.push(['pdf-untagged', 'failure', 'is not tagged, so screen readers get no headings, lists, tables or reading order']);
  else if (!d.marked) out.push(['pdf-untagged', 'likely', 'has tags but is not marked as tagged (MarkInfo Marked is not true), so some readers ignore them']);
  if (!d.title) out.push(['pdf-no-title', 'failure', 'has no document title, so readers announce the file name instead']);
  else if (!d.showsTitle) out.push(['pdf-title-hidden', 'advice', `has the title "${d.title.slice(0, 70)}" but is not set to show it (DisplayDocTitle), so the window shows the file name`]);
  if (!d.lang && !d.treeLang) out.push(['pdf-no-language', 'failure', 'declares no language, so screen readers guess how to pronounce it']);
  if (!d.textChars && d.picturePages.length) {
    // A scan with tags might carry a text alternative on its figures; a person checks that.
    out.push(['pdf-image-only', d.tree ? 'likely' : 'failure', `is ${d.pages === 1 ? 'a picture' : 'pictures'} of text with no real text${d.tree ? '; unless its figures carry a full text alternative, screen readers get nothing' : ', so screen readers get nothing and the text cannot be enlarged or searched'}`]);
  } else if (d.picturePages.length) {
    const list = d.picturePages.slice(0, 5).join(', ') + (d.picturePages.length > 5 ? ` and ${d.picturePages.length - 5} more` : '');
    out.push(['pdf-image-only', 'likely', `page${d.picturePages.length === 1 ? '' : 's'} ${list} ${d.picturePages.length === 1 ? 'is a picture' : 'are pictures'} with no real text, probably scanned`]);
  }
  if (d.pages >= LONG && !d.bookmarks) out.push(['pdf-no-bookmarks', 'advice', `has ${d.pages} pages and no bookmarks to jump between sections`]);
  return out;
}

async function check(context, url, proxy) {
  try {
    const got = await download(context, url, proxy);
    if (got.error) return { note: `could not be checked: ${got.error}` };
    return { problems: problems(await read(got.body)) };
  } catch (e) {
    if (e?.name === 'PasswordException') return { note: 'could not be checked: it is password protected' };
    return { note: `could not be checked: ${String(e.message).split('\n')[0]}` };
  }
}

async function checkDocuments(pages, ctx) {
  // Each PDF once, on the first page that links it.
  const first = new Map();
  for (const p of pages) for (const link of p.documentLinks || []) if (!first.has(link.url)) first.set(link.url, { page: p, link });
  if (!first.size) return;
  const docs = [...first.values()].slice(0, MAX_DOCUMENTS);
  const lead = pages[0];
  if (first.size > MAX_DOCUMENTS) lead.notes.push(`${first.size} PDFs are linked; the first ${MAX_DOCUMENTS} were checked`);
  const origin = new URL(ctx.origin);
  const elsewhere = [...new Set(docs.map((d) => new URL(d.link.url)).filter((u) => u.host !== origin.host).map((u) => u.host))];
  if (elsewhere.length) lead.notes.push(`PDFs linked from these pages but kept on ${elsewhere.length === 1 ? 'another host' : 'other hosts'} were downloaded and checked too: ${elsewhere.join(', ')}`);

  // The audit runs this once per screen size and browser; the cache makes each download
  // happen once for the whole audit.
  const cache = ctx.cache || new Map();
  let context;
  const contextFor = async () => (context ||= await ctx.browser.newContext(ctx.opts?.storageState ? { storageState: ctx.opts.storageState } : {}));
  const queue = docs.filter((d) => !cache.has(`document ${d.link.url}`));
  try {
    const worker = async () => {
      for (let d = queue.shift(); d; d = queue.shift()) {
        const key = `document ${d.link.url}`;
        const pending = contextFor().then((c) => check(c, d.link.url, ctx.opts?.proxy));
        cache.set(key, pending);
        await pending;
      }
    };
    await Promise.all(Array.from({ length: AT_ONCE }, worker));
  } finally {
    if (context) await context.close().catch(() => {});
  }

  for (const { page, link } of docs) {
    const found = await cache.get(`document ${link.url}`);
    const u = new URL(link.url);
    const label = u.host === origin.host ? u.pathname + u.search : u.href;
    if (found.note) { page.notes.push(`the PDF ${label} ${found.note}`); continue; }
    for (const [id, kind, message] of found.problems) {
      page.issues.push(issue(id, {
        kind, scope: 'site', document: link.url, message: `${label} ${message}`,
        selector: `a[href="${link.href.replace(/["\\]/g, '\\$&')}"]`, html: link.html,
      }));
    }
  }
}

export const probes = [{ name: 'document links', phase: 'look', run: collectLinks }];
export const siteProbes = [{ name: 'documents', run: checkDocuments }];

export const rules = {
  'pdf-untagged': {
    title: 'PDF is not tagged', criteria: ['1.3.1'], extra: ['documents'], kinds: ['failure', 'likely'], impact: 'serious',
    covers: 'Each PDF linked from an audited page is downloaded and read: one with no structure tree fails, one with tags that is not marked as tagged is flagged.',
    why: 'Tags are how a PDF tells a screen reader what is a heading, a list, a table and in what order to read. Without them a blind reader gets one long stream of words, or nothing.',
  },
  'pdf-no-title': {
    title: 'PDF has no document title', criteria: ['2.4.2'], extra: ['documents'], kinds: ['failure'], impact: 'moderate',
    covers: 'Linked PDFs with no title in their document properties.',
    why: 'The title is what a screen reader announces when the file opens and what a tab or window shows. Without one, people hear a file name such as "scan_0042.pdf".',
  },
  'pdf-title-hidden': {
    title: 'PDF title is not shown when it opens', criteria: ['2.4.2'], extra: ['documents'], kinds: ['advice'], impact: 'minor',
    covers: 'Linked PDFs that have a title but are not set to display it (DisplayDocTitle).',
    why: 'When the title is not set to display, readers show and announce the file name instead, which rarely says what the document is.',
  },
  'pdf-no-language': {
    title: 'PDF does not declare its language', criteria: ['3.1.1'], extra: ['documents'], kinds: ['failure'], impact: 'serious',
    covers: 'Linked PDFs with no language in the document catalog or on their tags.',
    why: 'Screen readers pick their voice and pronunciation from the declared language. Without it, a Spanish document can be read aloud with English rules and make no sense.',
  },
  'pdf-image-only': {
    title: 'PDF is a picture of text', criteria: ['1.1.1', '1.4.5'], extra: ['documents'], kinds: ['failure', 'likely'], impact: 'critical',
    covers: 'Linked PDFs whose pages have pictures and no text at all, such as scans: an untagged one fails, a tagged one or one with only some scanned pages is flagged.',
    why: 'A scanned page is a photograph. A screen reader finds no words in it, and people who enlarge text or change its colors cannot, so the document is closed to them.',
  },
  'pdf-no-bookmarks': {
    title: 'Long PDF has no bookmarks', criteria: [], extra: ['documents'], kinds: ['advice'], impact: 'minor',
    covers: `Linked PDFs of ${LONG} pages or more with no bookmarks.`,
    why: 'Bookmarks let people jump to a section instead of paging through the whole file, which matters most to people using a keyboard or a screen reader.',
  },
};
