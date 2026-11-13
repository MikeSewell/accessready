// The optional AI review: the rules it can report, and the probe that reads what it needs
// from each page. This file imports nothing from the checks, so src/checks/index.mjs can list
// it as a module without an import cycle. The requests themselves are made in review.mjs,
// once every page has been audited.
//
// Every rule here is a judgment about wording and meaning that no rule engine can make, so
// each one is `likely`: a person confirms it. `source: 'ai'` tells src/coverage.mjs to count
// it as AI review rather than as a machine check.

export const rules = {
  'ai-image-alt': {
    title: 'Image description does not say what the image is for', criteria: ['1.1.1'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review looks at each image with its description and the text around it, and flags descriptions that are file names, filler, or do not say what the image shows or where its link goes.',
    why: 'Screen reader users hear the description instead of seeing the image. A file name or "image" tells them nothing.',
  },
  'ai-image-of-text': {
    title: 'Image shows text that could be real text', criteria: ['1.4.5', '1.4.9'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review looks at each image and flags pictures that are mostly text, such as banners and quote cards. Logos are left out.',
    why: 'Text in a picture cannot be resized, recolored or respaced by people with low vision or dyslexia, and it blurs when zoomed.',
  },
  'ai-link-purpose': {
    title: 'Link does not say where it goes', criteria: ['2.4.4'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review reads each link with its sentence and the heading above it, and flags links whose purpose is still unclear.',
    why: 'Screen reader users often move from link to link. A link that only makes sense to someone who can see the whole page leaves them guessing.',
  },
  'ai-link-purpose-alone': {
    title: 'Link text does not make sense on its own', criteria: ['2.4.9'], kinds: ['likely'], source: 'ai',
    covers: 'At AAA, the AI review flags links whose own text, read alone, does not say where they go.',
    why: 'In a list of links, as screen readers offer it, "read more" five times is five unknown destinations.',
  },
  'ai-heading': {
    title: 'Heading does not describe its section', criteria: ['2.4.6'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review reads each heading with the text that follows it and flags placeholders and headings about something else.',
    why: 'People who skim, and screen reader users who jump by heading, decide where to read from the headings alone.',
  },
  'ai-label': {
    title: 'Field label does not say what to enter', criteria: ['2.4.6'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review reads each form field\'s label and flags labels that do not say what goes in the field.',
    why: 'A label such as "Field 1" leaves everyone guessing, and screen reader users have nothing else to go by.',
  },
  'ai-sensory-instruction': {
    title: 'Instruction relies on shape, color, position or sound', criteria: ['1.3.3'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review reads the page text and flags instructions such as "click the green button on the right" that name nothing in words.',
    why: 'People who cannot see color, shape or layout, or cannot hear, cannot follow an instruction that only uses those.',
  },
  'ai-page-title': {
    title: 'Page title does not describe the page', criteria: ['2.4.2'], kinds: ['likely'], source: 'ai',
    covers: 'The AI review compares the page title with the page\'s heading and text, and flags titles that do not describe it.',
    why: 'The title is the first thing a screen reader announces and what tabs and bookmarks show.',
  },
  'ai-unusual-word': {
    title: 'Unusual word or idiom is not explained', criteria: ['3.1.3'], kinds: ['likely'], source: 'ai',
    covers: 'At AAA, the AI review flags jargon, idioms and unusual words that the page does not define.',
    why: 'People with cognitive disabilities, and people reading in a second language, may not know a word or idiom that the page assumes.',
  },
  'ai-pronunciation': {
    title: 'Meaning depends on how a word is pronounced', criteria: ['3.1.6'], kinds: ['likely'], source: 'ai',
    covers: 'At AAA, the AI review flags words whose meaning in the sentence depends on how they are said, with no help given.',
    why: 'Readers who cannot hear the word, and screen readers that guess the pronunciation, can take the wrong meaning.',
  },
  'ai-consistent-identification': {
    title: 'The same function is named differently on different pages', criteria: ['3.2.4'], kinds: ['likely'], source: 'ai',
    covers: 'Links, buttons and icons that do the same thing in the same part of different pages are compared; the AI review flags those named differently.',
    why: 'People who use a site by memory, and screen reader users, recognize a control by its name. A new name looks like a new function.',
  },
};

// How much of a page goes into one request. Enough for a real page, small enough that a
// page costs a predictable amount.
export const LIMITS = { text: 6000, links: 60, headings: 40, fields: 30, images: 20, pictures: 8, buttons: 30 };
// Images sent as pixels are scaled down to this long edge. Text in an image stays readable,
// and each picture costs a few hundred tokens instead of thousands.
const PICTURE_EDGE = 768;
const PICTURE_BYTES = 1_500_000;
const PICTURE_TOTAL = 6_000_000; // base64 characters across one page's pictures
const PICTURE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Runs in the page. Reads what the review needs and nothing else.
function collect({ limits, edge, pictures }) {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const hidden = (el) => !!el.closest('[aria-hidden=true], [hidden], [inert]');
  const selectorOf = (el) => {
    const parts = [];
    for (let node = el; node && node.nodeType === 1 && node !== document.body && parts.length < 5; node = node.parentElement) {
      if (node.id) { parts.unshift(`#${CSS.escape(node.id)}`); break; }
      const tag = node.tagName.toLowerCase();
      const same = [...(node.parentElement?.children || [])].filter((c) => c.tagName === node.tagName);
      parts.unshift(same.length > 1 ? `${tag}:nth-of-type(${same.indexOf(node) + 1})` : tag);
    }
    return parts.join(' > ');
  };
  const REGIONS = [['header, [role=banner]', 'header'], ['nav, [role=navigation]', 'navigation'], ['[role=search]', 'search'], ['footer, [role=contentinfo]', 'footer'], ['aside, [role=complementary]', 'sidebar']];
  const regionOf = (el) => {
    let best = null, depth = -1;
    for (const [sel, name] of REGIONS) {
      const r = el.closest(sel);
      if (!r) continue;
      let d = 0; for (let n = r; n; n = n.parentElement) d++;
      if (d > depth) { best = name; depth = d; }
    }
    return best || 'main';
  };
  const byIds = (ids) => clean((ids || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '));
  const linkName = (a) => byIds(a.getAttribute('aria-labelledby')) || clean(a.getAttribute('aria-label'))
    || clean(`${a.innerText} ${[...a.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ')}`) || clean(a.getAttribute('title'));
  const fieldLabel = (f) => byIds(f.getAttribute('aria-labelledby')) || clean(f.getAttribute('aria-label'))
    || clean([...(f.labels || [])].map((l) => l.innerText).join(' ')) || clean(f.getAttribute('title')) || clean(f.getAttribute('placeholder'));
  // The text around an element, centered on it, so a link's sentence is what the model sees.
  const BLOCK = 'p, li, td, th, dd, dt, figcaption, blockquote, label, legend, h1, h2, h3, h4, h5, h6';
  const around = (el, name, length = 220) => {
    const block = el.closest(BLOCK) || el.parentElement;
    const text = clean(block?.innerText);
    if (!text || text === name) return '';
    const at = name ? Math.max(0, text.indexOf(name)) : 0;
    const start = Math.max(0, at - Math.floor(length / 2));
    return (start > 0 ? '...' : '') + text.slice(start, start + length) + (start + length < text.length ? '...' : '');
  };

  const headingEls = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')].filter((h) => shown(h) && !hidden(h));
  const headingAbove = (el) => {
    let found = '';
    for (const h of headingEls) {
      if (h.contains(el)) return clean(h.innerText);
      if (h.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) found = clean(h.innerText); else break;
    }
    return found.slice(0, 120);
  };

  // Visible text nodes in document order, to read what follows each heading.
  const texts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode() && texts.length < 8000) {
    const n = walker.currentNode, p = n.parentElement;
    if (!p || !n.textContent.trim() || p.closest('script, style, noscript, template, [aria-hidden=true], [hidden]')) continue;
    if (p.checkVisibility && !p.checkVisibility()) continue;
    texts.push({ n, p });
  }
  const headings = [];
  let cursor = 0;
  for (const h of headingEls.slice(0, limits.headings)) {
    const after_ = (n) => (h.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING) && !h.contains(n);
    while (cursor < texts.length && !after_(texts[cursor].n)) cursor++;
    let after = '';
    for (let i = cursor; i < texts.length && after.length < 200; i++) {
      if (texts[i].p.closest('h1, h2, h3, h4, h5, h6, [role=heading]')) break;
      after += ' ' + texts[i].n.textContent;
    }
    headings.push({ id: `H${headings.length + 1}`, level: +(h.getAttribute('aria-level') || h.tagName[1] || 2), text: clean(h.innerText).slice(0, 150), textAfter: clean(after).slice(0, 200), selector: selectorOf(h) });
  }

  const links = [];
  const seenLinks = new Set();
  for (const a of document.querySelectorAll('a[href]')) {
    if (links.length >= limits.links) break;
    if (!shown(a) || hidden(a)) continue;
    const name = linkName(a);
    if (!name) continue; // a link with no name at all is axe-core's to report
    const key = `${name}|${a.href}`;
    if (seenLinks.has(key)) continue;
    seenLinks.add(key);
    links.push({ id: `L${links.length + 1}`, name: name.slice(0, 150), href: a.href, context: around(a, clean(a.innerText)), headingAbove: headingAbove(a), region: regionOf(a), selector: selectorOf(a) });
  }

  const fields = [];
  for (const f of document.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea')) {
    if (fields.length >= limits.fields) break;
    if (!shown(f) || hidden(f)) continue;
    const label = fieldLabel(f);
    if (!label) continue; // a field with no label is axe-core's to report
    fields.push({ id: `F${fields.length + 1}`, label: label.slice(0, 150), type: f.tagName === 'INPUT' ? f.type : f.tagName.toLowerCase(), hint: byIds(f.getAttribute('aria-describedby')).slice(0, 150), selector: selectorOf(f) });
  }

  // Buttons are only compared across pages (3.2.4), so only those that submit a form to a
  // known address are kept: that address is what makes two buttons the same function.
  const buttons = [];
  for (const b of document.querySelectorAll('button, input[type=submit]')) {
    if (buttons.length >= limits.buttons) break;
    const form = b.form;
    if (!form || !form.getAttribute('action') || !shown(b) || hidden(b)) continue;
    const name = clean(b.getAttribute('aria-label')) || clean(b.innerText || b.value);
    if (name) buttons.push({ name, target: form.action, region: regionOf(b) });
  }

  // The file name a person would recognize. Image services such as Next.js's /_next/image
  // carry the real path in a `url` parameter.
  const fileOf = (src) => {
    try {
      const u = new URL(src);
      const real = u.searchParams.get('url');
      const path = real ? new URL(real, u).pathname : u.pathname;
      return decodeURIComponent(path.split('/').pop() || '').slice(0, 80);
    } catch {
      return '';
    }
  };
  const images = [];
  for (const img of document.querySelectorAll('img')) {
    if (images.length >= limits.images) break;
    const r = img.getBoundingClientRect();
    if (!shown(img) || hidden(img) || r.width < 24 || r.height < 24) continue;
    if (!img.hasAttribute('alt')) continue; // no description at all is axe-core's to report
    const src = img.currentSrc || img.src;
    const link = img.closest('a[href]');
    const caption = img.closest('figure')?.querySelector('figcaption');
    const item = {
      id: `I${images.length + 1}`, alt: clean(img.alt).slice(0, 300), src,
      file: fileOf(src),
      inLink: link ? { href: link.href, text: clean(link.innerText).slice(0, 120) } : null,
      nearbyText: clean(caption?.innerText) || around(img, ''), region: regionOf(img),
      width: Math.round(r.width), height: Math.round(r.height), selector: selectorOf(img),
      html: img.outerHTML.replace(/\s+/g, ' ').slice(0, 200), picture: null, fetch: false,
    };
    // Scale the decoded image down on a canvas. A picture from another site taints the
    // canvas; those are fetched by the browser context instead, at full size.
    if (pictures && images.filter((i) => i.picture || i.fetch).length < limits.pictures) {
      try {
        if (!img.complete || !img.naturalWidth) throw new Error('not loaded');
        const scale = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff'; // transparent areas become white, not black, in a JPEG
        g.fillRect(0, 0, canvas.width, canvas.height);
        g.drawImage(img, 0, 0, canvas.width, canvas.height);
        item.picture = { mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.85).split(',')[1] };
      } catch {
        item.fetch = /^https?:/.test(src);
      }
    }
    images.push(item);
  }

  const root = document.querySelector('main, [role=main]') || document.body;
  const text = (root.innerText || '').replace(/[ \t ]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim().slice(0, limits.text);
  return { title: clean(document.title), lang: document.documentElement.lang || '', h1: clean(document.querySelector('h1')?.innerText).slice(0, 150), text, images, links, headings, fields, buttons };
}

async function fetchPicture(page, src) {
  try {
    const res = await page.context().request.get(src, { timeout: 10000 });
    const type = (res.headers()['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (!res.ok() || !PICTURE_TYPES.includes(type)) return null;
    const body = await res.body();
    return body.length <= PICTURE_BYTES ? { mediaType: type, data: body.toString('base64') } : null;
  } catch {
    return null;
  }
}

// Reads the page for the AI review, and only when the review is on. Each page is read once,
// in the run's first screen size and browser, so the input is the same from run to run and
// the cache in review.mjs can answer a rerun.
async function lookForAi(page, ctx) {
  const ai = ctx.opts.ai;
  if (!ai || ctx.viewport.name !== ai.view || ctx.browserName !== ai.engine) return [];
  const look = await page.evaluate(collect, { limits: LIMITS, edge: PICTURE_EDGE, pictures: ai.images !== false });
  // Pictures fetched at full size are capped in total too, so one request stays well under
  // the size limits of every provider and of the CLIs that read the prompt from stdin.
  let bytes = look.images.reduce((n, i) => n + (i.picture?.data.length || 0), 0);
  for (const image of look.images) {
    if (image.fetch && bytes < PICTURE_TOTAL) {
      image.picture = await fetchPicture(page, image.src);
      if (image.picture && (bytes += image.picture.data.length) > PICTURE_TOTAL) image.picture = null;
    }
    delete image.fetch;
  }
  ctx.result.aiLook = look;
  return [];
}

export const probes = [{ name: 'AI review reading', phase: 'look', run: lookForAi }];
