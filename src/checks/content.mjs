// Structure and wording a rule engine does not judge: text that looks like a heading or a
// list but is not marked up as one, reading order that differs from what is on screen,
// instructions that depend on color or position, titles, link text and headings that say
// nothing, and the AAA checks on landmarks, location and section headings.
// Everything here only reads the page. Most findings are `likely`: the code has found the
// pattern, a person confirms the meaning.
import { inPage, loadIssue } from './inpage.mjs';

const MAX_PER_RULE = 5;

function readStructure(h, { level, max }) {
  const out = [];
  const count = {};
  const add = (id, el, message) => {
    count[id] = (count[id] || 0) + 1;
    if (count[id] <= max) out.push({ id, message, selector: h.selector(el), html: h.snippet(el) });
  };
  const root = h.mainRoot();
  const OUTSIDE = 'h1, h2, h3, h4, h5, h6, [role=heading], label, legend, caption, button, a, summary, th, td, nav, header, footer, aside, form, li, dt, dd, figcaption, blockquote, table, pre, code, [role=navigation], [role=banner], [role=contentinfo], [aria-hidden=true]';

  // Body text size: the median size of real paragraphs.
  const sizes = [...root.querySelectorAll('p')].filter((p) => h.visible(p) && h.words(p.textContent).length >= 8).map((p) => parseFloat(getComputedStyle(p).fontSize)).sort((a, b) => a - b);
  const base = sizes.length ? sizes[Math.floor(sizes.length / 2)] : parseFloat(getComputedStyle(document.body).fontSize);
  const textStyle = (el) => {
    // The smallest size and lightest weight of any text inside, so one bold word in a
    // sentence does not make the whole line look bold.
    let size = Infinity, weight = Infinity;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!n.textContent.trim()) continue;
      const cs = getComputedStyle(n.parentElement);
      size = Math.min(size, parseFloat(cs.fontSize));
      weight = Math.min(weight, parseInt(cs.fontWeight, 10) || 400);
    }
    return { size, weight };
  };
  const nextText = (el) => {
    for (let n = el.nextElementSibling; n; n = n.nextElementSibling) if (h.visible(n) && h.clean(n.innerText)) return n;
    return null;
  };

  // 1.3.1: text styled as a heading. Short, standalone, larger or bolder than body text,
  // and followed by the content it introduces.
  for (const el of root.querySelectorAll('p, div')) {
    if (!h.visible(el) || el.closest(OUTSIDE) || el.querySelector('p, div, ul, ol, table, img, svg, input, button, a')) continue;
    const text = h.clean(el.innerText);
    const n = h.words(text).length;
    if (!n || n > 10 || text.length > 80 || /[.,;:!?…]$/.test(text) || /^\d+$/.test(text)) continue;
    const next = nextText(el);
    if (!next || next.matches('h1, h2, h3, h4, h5, h6, [role=heading]') || h.words(next.innerText).length < 8) continue;
    const { size, weight } = textStyle(el);
    const large = size >= base * 1.3;
    const bold = weight >= 600 && size >= base && n <= 8;
    if (large || bold) add('styled-as-heading', el, `"${text}" looks like a heading (${large ? `${Math.round(size)}px against ${Math.round(base)}px body text` : 'bold, on its own line'}) but is not marked up as one`);
  }

  // 1.3.1: lines typed with bullets or numbers instead of a list.
  const BULLET = /^([•·▪▫◦‣⁃○●■□►▸✓✔➤→*]|[-–—](?=\s)|\d{1,2}[.)](?=\s)|[a-h][.)](?=\s))\s*/;
  const sequential = (lines) => {
    const marks = lines.map((l) => (l.match(/^(\d{1,2}|[a-h])[.)]/) || [])[1]);
    if (marks.some((m) => !m)) return lines.every((l) => /^[•·▪▫◦‣⁃○●■□►▸✓✔➤→*\-–—]/.test(l)) && new Set(lines.map((l) => l[0])).size === 1;
    const value = (m) => (/\d/.test(m) ? +m : m.charCodeAt(0) - 96);
    return marks.every((m, i) => i === 0 || value(m) === value(marks[i - 1]) + 1);
  };
  const listed = new Set();
  for (const el of root.querySelectorAll('p, div')) {
    if (!h.visible(el) || el.closest('ul, ol, pre, code, table, nav, [role=list]') || el.querySelector('p, div, ul, ol, table')) continue;
    const lines = el.innerText.split('\n').map((l) => h.clean(l)).filter(Boolean);
    if (lines.length >= 3 && lines.every((l) => BULLET.test(l)) && sequential(lines)) { add('fake-list', el, `${lines.length} lines starting "${lines[0].slice(0, 30)}" are typed as a list but not marked up as one`); listed.add(el); }
  }
  for (const el of root.querySelectorAll('p')) {
    if (listed.has(el) || !h.visible(el) || el.closest('ul, ol, table') || (el.previousElementSibling?.tagName === 'P' && BULLET.test(h.clean(el.previousElementSibling.innerText)))) continue;
    const run = [];
    for (let n = el; n && n.tagName === 'P' && BULLET.test(h.clean(n.innerText)) && h.clean(n.innerText).split('\n').length === 1; n = n.nextElementSibling) run.push(h.clean(n.innerText));
    if (run.length >= 3 && sequential(run)) add('fake-list', el, `${run.length} paragraphs starting "${run[0].slice(0, 30)}" are typed as a list but not marked up as one`);
  }

  // 1.3.1: a table of data whose header row is only styled, not marked up.
  for (const table of document.querySelectorAll('table')) {
    if (!h.visible(table) || table.matches('[role=presentation], [role=none]') || table.parentElement.closest('table')) continue;
    if (table.querySelector('th, [scope], [headers], [role=columnheader], [role=rowheader]')) continue;
    if (table.querySelector('table, form, input, select, textarea, h1, h2, h3, h4, h5, h6, p, ul, ol')) continue; // a layout table
    const rows = [...table.rows];
    const cols = Math.max(0, ...rows.map((r) => r.cells.length));
    if (rows.length < 3 || cols < 2) continue;
    const firstBold = [...rows[0].cells].every((c) => h.clean(c.innerText) && textStyle(c).weight >= 600);
    const restBold = [...rows[1].cells].every((c) => textStyle(c).weight >= 600);
    const bg = (r) => getComputedStyle(r).backgroundColor + [...r.cells].map((c) => getComputedStyle(c).backgroundColor).join();
    const header = table.tHead || (firstBold && !restBold) || bg(rows[0]) !== bg(rows[1]) && bg(rows[1]) === bg(rows[2]);
    if (header) add('table-no-headers', table, `a ${rows.length}-row table has a header row that is only styled: no th cells or scope, so screen readers cannot say which column a value is in`);
  }

  // 1.3.2: CSS that shows blocks of text in a different order from the code.
  for (const box of root.querySelectorAll('*')) {
    const cs = getComputedStyle(box);
    if (!/flex|grid/.test(cs.display) || !h.visible(box) || box.closest('nav, [aria-hidden=true]')) continue;
    const kids = [...box.children].filter((c) => h.visible(c) && h.words(c.innerText).length >= 3 && getComputedStyle(c).position !== 'absolute' && getComputedStyle(c).position !== 'fixed');
    if (kids.length < 2) continue;
    const moved = /reverse/.test(cs.flexDirection) || (/flex/.test(cs.display) && /reverse/.test(cs.flexWrap)) ||
      kids.some((c) => getComputedStyle(c).order !== '0') ||
      (/grid/.test(cs.display) && kids.some((c) => getComputedStyle(c).gridRowStart !== 'auto' || getComputedStyle(c).gridColumnStart !== 'auto'));
    if (!moved) continue;
    const rtl = cs.direction === 'rtl';
    const shownOrder = [...kids].sort((a, b) => {
      const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
      if (Math.abs(ra.top - rb.top) > 4 && (ra.bottom <= rb.top + 4 || rb.bottom <= ra.top + 4)) return ra.top - rb.top;
      return rtl ? rb.left - ra.left : ra.left - rb.left;
    });
    const first = shownOrder.findIndex((k, i) => k !== kids[i]);
    if (first < 0) continue;
    add('reading-order', box, `"${h.clean(shownOrder[first].innerText).slice(0, 40)}" is shown before "${h.clean(kids[first].innerText).slice(0, 40)}", but a screen reader or keyboard reaches them the other way round (CSS ${/reverse/.test(cs.flexDirection + cs.flexWrap) ? cs.flexDirection : /grid/.test(cs.display) && !kids.some((c) => getComputedStyle(c).order !== '0') ? 'grid placement' : 'order'})`);
  }

  // 1.3.3: instructions that only work if you can see color, shape or position, or hear.
  const COLOR = '(green|red|blue|yellow|orange|purple|pink|grey|gray|black|white|round|square|circular|triangular|star-shaped|big|large|small|little)';
  const THING = '(button|icon|link|box|tab|arrow|circle|square|shape|bar|banner|panel|area|symbol|field|section|menu|column|sidebar|option)';
  const SENSORY = [
    new RegExp(`\\b(click|press|tap|select|use|choose|hit|push|find|see|look (at|for)|follow)\\b[^.!?]{0,25}\\bthe ${COLOR}( [a-z]+)? ${THING}s?\\b`, 'i'),
    new RegExp(`\\bthe ${THING}s? (on|to|at|in) the (left|right|top|bottom)\\b(?! of (this|the) (sentence|paragraph))`, 'i'),
    new RegExp(`\\b(on|in) the (left|right)[- ]hand (side|column|menu|corner)\\b`, 'i'),
    /\b(when you hear|after the (beep|tone|chime|sound)|listen for the (beep|tone|chime|sound))\b/i,
  ];
  const sensory = [...document.body.querySelectorAll('p, li, dd, td, label, legend, small, figcaption, blockquote, h1, h2, h3, h4, h5, h6, span, div')]
    .filter((el) => h.visible(el) && ![...el.children].some((c) => /^(P|DIV|LI|UL|OL|TABLE|SECTION)$/.test(c.tagName)) && !el.closest('script, style, code, pre'));
  const reported = [];
  for (const el of sensory) {
    const text = h.clean(el.innerText);
    const m = SENSORY.map((re) => text.match(re)).find(Boolean);
    if (!m || reported.some((r) => r.contains(el) || el.contains(r))) continue;
    reported.push(el);
    add('sensory-instructions', el, `"${m[0].slice(0, 60)}" relies on ${/hear|beep|tone|chime|sound/i.test(m[0]) ? 'hearing' : /left|right|top|bottom/i.test(m[0]) ? 'position on screen' : 'color, shape or size'} to identify something`);
  }

  // 2.4.6: headings and labels that say nothing.
  const GENERIC_HEADING = /^(heading( \d)?|title|subtitle|sub-?heading|section( \d+)?|untitled|lorem ipsum.*|placeholder|header|text|new section|(your|add|insert) (title|heading)( here)?|heading goes here|title goes here)$/i;
  for (const hd of document.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')) {
    if (h.visible(hd) && GENERIC_HEADING.test(h.accName(hd))) add('heading-generic', hd, `the heading "${h.accName(hd)}" does not describe the section it starts`);
  }

  // 2.4.4 and 2.4.9: link text.
  const VAGUE = /^(click here|click|here|tap here|press here|read more|read on|continue reading|learn more|more|more info|more information|info|details|link|this|this link|this page|continue|go|view|view more|see more|find out more)$/i;
  const strip = (s) => h.clean(s).replace(/[\s»›→>…:.]+$/u, '').toLowerCase();
  const context = (a) => {
    const own = h.clean(h.textOf(a));
    const described = h.clean(h.byIds(a.getAttribute('aria-describedby')).map(h.textOf).join(' '));
    if (h.words(described).length >= 2) return described;
    const block = a.closest('p, li, td, th, dd, dt, h1, h2, h3, h4, h5, h6, figcaption, blockquote');
    if (block) {
      const rest = h.clean(h.textOf(block)).replace(own, '');
      if (h.words(rest).length >= 3) return rest;
      if (block.matches('td')) {
        const table = block.closest('table');
        const col = block.cellIndex;
        const head = table && [...table.querySelectorAll('th')].find((th) => th.cellIndex === col);
        if (head && h.words(head.textContent).length) return h.clean(head.textContent);
      }
    }
    // A heading just before the link, in the same card or section (technique H80).
    for (let n = a.parentElement, d = 0; n && n !== document.body && d < 4; n = n.parentElement, d++) {
      const heads = [...n.querySelectorAll('h1, h2, h3, h4, h5, h6, [role=heading]')]
        .filter((hd) => hd.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING && !hd.contains(a));
      if (heads.length) return h.clean(heads[heads.length - 1].textContent);
    }
    return '';
  };
  const byName = new Map();
  for (const a of document.querySelectorAll('a[href]')) {
    if (!h.visible(a) || /^(javascript:|#$)/.test(a.getAttribute('href'))) continue;
    const name = strip(h.accName(a));
    if (!name) continue;
    if (VAGUE.test(name)) {
      if (!h.words(context(a)).length) add('link-no-context', a, `the link "${h.clean(h.accName(a))}" has nothing around it (sentence, list item, table cell or heading) that says where it goes`);
      if (level === 'AAA') add('link-text-vague', a, `the link "${h.clean(h.accName(a))}" does not say where it goes when read on its own, as in a screen reader's list of links`);
      continue;
    }
    // The same place written two ways (/ and /index.html, with or without tracking tags)
    // is one place.
    const url = new URL(a.href, location.href);
    url.hash = '';
    url.pathname = url.pathname.replace(/\/index\.(html?|php)$/, '/').replace(/(.)\/$/, '$1');
    for (const key of [...url.searchParams.keys()]) if (/^utm_/.test(key)) url.searchParams.delete(key);
    if (!byName.has(name)) byName.set(name, { a, urls: new Set() });
    byName.get(name).urls.add(url.href);
  }
  if (level === 'AAA') {
    for (const [, { a, urls }] of byName) {
      if (urls.size > 1) add('link-text-repeated', a, `${urls.size} links named "${h.clean(h.accName(a))}" go to different pages, so the name alone does not say which is which`);
    }
  }

  // 1.3.6 (AAA): a page with no landmarks at all.
  if (level === 'AAA' && h.words(document.body.innerText).length >= 30 &&
    !document.querySelector('main, nav, header, footer, aside, search, [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=search], [role=region][aria-label], [role=region][aria-labelledby], section[aria-label], section[aria-labelledby], form[aria-label], form[aria-labelledby]')) {
    add('no-landmarks', document.body, 'the page has no landmarks (main, navigation, header, footer), so nothing in the code says what each region is for');
  }

  // 2.4.10 (AAA): long stretches of text with no heading to break them up.
  if (level === 'AAA') {
    let paras = 0, count = 0, start = null, flagged = false;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.currentNode; el; el = walker.nextNode()) {
      if (el.matches('h1, h2, h3, h4, h5, h6, [role=heading]')) { paras = 0; count = 0; start = null; flagged = false; continue; }
      if (!el.matches('p, li, blockquote, dd') || el.closest('nav, header, footer, aside, form, [aria-hidden=true]') || !h.visible(el) || el.querySelector('p, li')) continue;
      const n = h.words(el.innerText).length;
      if (!n) continue;
      paras++; count += n; start ||= el;
      if (!flagged && paras >= 4 && count >= 300) { add('no-section-headings', start, `${paras} paragraphs and about ${Math.round(count / 10) * 10} words run on with no heading to say what each part is about`); flagged = true; }
    }
  }
  return { found: out, capped: Object.entries(count).filter(([, n]) => n > max).map(([id, n]) => [id, n]) };
}

// 2.4.2: titles that do not describe the page. Also records what the site-wide checks need.
function readPage(h) {
  const title = h.clean(document.title);
  const host = location.hostname.replace(/^www\./, '');
  const siteName = h.clean(document.querySelector('meta[property="og:site_name"]')?.content || document.querySelector('meta[name="application-name"]')?.content || '');
  const nav = document.querySelectorAll('nav, [role=navigation], header');
  const current = !!document.querySelector('[aria-current]:not([aria-current=false])') ||
    [...nav].some((n) => [...n.querySelectorAll('a[href], li')].some((a) => /(^|\s)(active|current|selected|is-active|is-current|current-menu-item|current_page_item)(\s|$)/.test(typeof a.className === 'string' ? a.className : '')));
  const breadcrumb = !!document.querySelector('nav[aria-label*="breadcrumb" i], [class*="breadcrumb" i], [id*="breadcrumb" i], [itemtype*="BreadcrumbList"]');
  const sitemap = [...document.querySelectorAll('a[href]')].some((a) => /^site ?map$/i.test(h.clean(a.textContent)));
  const nested = [...nav].some((n) => !!n.querySelector('li li a[href], ul ul a[href]'));
  const navLinks = Math.max(0, ...[...document.querySelectorAll('nav, [role=navigation]')].map((n) => n.querySelectorAll('a[href]').length));
  return { title, host, siteName, path: location.pathname, current, breadcrumb, sitemap, nested, navLinks };
}

const DEFAULT_TITLE = /^(untitled( document| page)?|document|react app|vite( \+ [a-z]+)*( app)?|create next app|next\.js app|angular app|vue app|svelte(kit)? app|my (website|site|page|app)|new page|page title|title|localhost|index\.html?|welcome to (nginx|apache)!?|apache2 (ubuntu|debian) default page.*|test page)$/i;
const GENERIC_TITLE = /^(home|home ?page|welcome|index|main|page|website|web site|site|landing|landing page|default)$/i;
const isHome = (path) => /^\/(index\.[a-z]+)?$/.test(path);

async function lookAtContent(page, ctx) {
  const issue = await loadIssue();
  const info = await inPage(page, readPage);
  ctx.result.contentInfo = info;
  const issues = [];
  const where = { selector: 'title', html: '' };
  if (info.title && DEFAULT_TITLE.test(info.title)) {
    issues.push(issue('default-title', { ...where, message: `the title "${info.title}" is a placeholder left by a tool or template; it does not say what the page is` }));
  } else if (info.title && (GENERIC_TITLE.test(info.title) || info.title.toLowerCase().replace(/^www\./, '') === info.host.toLowerCase())) {
    issues.push(issue('generic-title', { ...where, message: `the title "${info.title}" does not say what this page is or whose it is` }));
  } else if (info.siteName && !isHome(info.path) && info.title.toLowerCase() === info.siteName.toLowerCase()) {
    issues.push(issue('title-is-site-name', { ...where, message: `the title is only the site name, "${info.title}", so it does not say which page of the site this is` }));
    info.flagged = true;
  }
  const { found, capped } = await inPage(page, readStructure, { level: ctx.level, max: MAX_PER_RULE });
  for (const { id, ...fields } of found) issues.push(issue(id, fields));
  const notes = capped.map(([id, n]) => `${n} places match "${issue(id).title}"; the first ${MAX_PER_RULE} are listed`);
  return { issues, notes };
}

// 2.4.2: an inner page whose title is only the site name. The site name is the part most
// titles share, such as "Acme" in "About | Acme" and "Programs | Acme".
function titlesAcrossPages(pages, issue) {
  const SPLIT = /\s+[|·•–—:-]\s+/;
  const tally = new Map();
  for (const p of pages) {
    const title = p.contentInfo?.title || '';
    if (!SPLIT.test(title)) continue;
    for (const part of new Set(title.split(SPLIT).map((s) => s.trim().toLowerCase()).filter(Boolean))) tally.set(part, (tally.get(part) || 0) + 1);
  }
  const best = [...tally].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 2) return;
  for (const p of pages) {
    const info = p.contentInfo;
    if (!info || info.flagged || isHome(info.path) || info.title.toLowerCase() !== best[0]) continue;
    p.issues.push({ ...issue('title-is-site-name', { selector: 'title', html: '', message: `the title is only the site name, "${info.title}", which other pages use as a suffix, so it does not say which page of the site this is` }), scope: 'site' });
  }
}

// 2.4.8 (AAA): on a site with more than one level, each page should say where it is: a
// breadcrumb, a marked current page in the navigation, or a site map.
function locationAcrossPages(pages, issue) {
  const infos = pages.map((p) => p.contentInfo).filter(Boolean);
  const deep = infos.some((i) => i.nested || i.path.split('/').filter(Boolean).length >= 2);
  if (!deep) return;
  for (const p of pages) {
    const info = p.contentInfo;
    // A page with no site navigation of its own (a landing page, a step in a process) is
    // left to a person.
    if (!info || isHome(info.path) || info.navLinks < 3 || info.breadcrumb || info.current || info.sitemap) continue;
    p.issues.push({ ...issue('no-location-cue', { selector: 'nav', html: '', message: 'nothing on this page shows where it sits in the site: no breadcrumb, no site map link, and the navigation does not mark the current page (aria-current)' }), scope: 'site' });
  }
}

export const probes = [{ name: 'content structure', phase: 'look', run: lookAtContent }];

export const siteProbes = [{
  name: 'titles and location',
  async run(pages, ctx) {
    const issue = await loadIssue();
    titlesAcrossPages(pages, issue);
    if (ctx.level === 'AAA') locationAcrossPages(pages, issue);
  },
}];

export const rules = {
  'styled-as-heading': {
    title: 'Text looks like a heading but is not marked up as one', criteria: ['1.3.1'], kinds: ['likely'],
    covers: 'Short standalone lines that are larger or bolder than the body text and introduce the paragraph after them, but are not heading elements.',
    why: 'Screen reader users jump between headings to find their way around a page. Text that only looks like a heading is skipped.',
  },
  'fake-list': {
    title: 'List typed with bullets or numbers', criteria: ['1.3.1'], kinds: ['likely'],
    covers: 'Three or more lines or paragraphs that start with bullet characters or consecutive numbers but are not a ul or ol.',
    why: 'A screen reader announces a real list and how many items it has. Typed bullets are read as stray symbols, and the list can not be skipped.',
  },
  'table-no-headers': {
    title: 'Table header row is only styled', criteria: ['1.3.1'], kinds: ['likely'],
    covers: 'Data tables of three or more rows whose first row is bold, shaded or in a thead, with no th cells, scope or headers.',
    why: 'Without header cells, a screen reader reads each value without saying which column it is in, so the numbers lose their meaning.',
  },
  'reading-order': {
    title: 'Visual order differs from reading order', criteria: ['1.3.2'], kinds: ['likely'],
    covers: 'Flex and grid containers that use order, row-reverse, column-reverse or grid placement to show blocks of text in a different order from the code.',
    why: 'Screen readers and the Tab key follow the code order. When it differs from what is on screen, the content can read out of sequence.',
  },
  'sensory-instructions': {
    title: 'Instructions rely on color, shape, position or sound', criteria: ['1.3.3'], kinds: ['likely'],
    covers: 'Text such as "click the green button", "the menu on the right" or "when you hear the tone".',
    why: 'People who are blind, color blind or deaf, or who use a phone where the layout changes, cannot follow an instruction that only describes how something looks or sounds.',
  },
  'default-title': {
    title: 'Page title is a template placeholder', criteria: ['2.4.2'], kinds: ['failure'],
    covers: 'Titles left by a tool or template: "React App", "Untitled", "Document", "Create Next App" and similar.',
    why: 'The title is the first thing a screen reader announces and what tabs and bookmarks show. A placeholder tells nobody what the page is.',
  },
  'generic-title': {
    title: 'Page title is generic', criteria: ['2.4.2'], kinds: ['likely'],
    covers: 'Titles such as "Home", "Welcome" or the bare domain name.',
    why: 'People with many tabs open, and screen reader users, tell pages apart by their titles.',
  },
  'title-is-site-name': {
    title: 'Page title is only the site name', criteria: ['2.4.2'], kinds: ['likely'],
    covers: 'Inner pages whose title is only the site name (from og:site_name, or the part most other titles share).',
    why: 'When every page has the same title, screen reader users and people with many tabs open cannot tell which page they are on.',
  },
  'link-no-context': {
    title: 'Vague link with no context', criteria: ['2.4.4'], kinds: ['likely'],
    covers: 'Links such as "click here" or "read more" whose sentence, list item, table cell, header cell, description or heading just before give no clue where they go.',
    why: 'Screen reader users often move from link to link. "Read more" with nothing around it gives them no idea where it leads.',
  },
  'link-text-vague': {
    title: 'Link text does not say where it goes', criteria: ['2.4.9'], kinds: ['failure'],
    covers: 'Links whose whole accessible name is "click here", "read more", "learn more" or similar.',
    why: 'In a screen reader\'s list of links, ten links called "read more" are indistinguishable.',
  },
  'link-text-repeated': {
    title: 'Links with the same text go to different places', criteria: ['2.4.9'], kinds: ['likely'],
    covers: 'Links with the same accessible name that point to different addresses.',
    why: 'When several links read the same, people using a list of links cannot tell which one they need.',
  },
  'heading-generic': {
    title: 'Heading does not describe its section', criteria: ['2.4.6'], kinds: ['likely'],
    covers: 'Headings left as "Heading", "Title", "Section 2", "Lorem ipsum" and similar.',
    why: 'People scan headings, by eye or with a screen reader, to find the section they want. A placeholder heading tells them nothing.',
  },
  'no-location-cue': {
    title: 'Page does not show where it is in the site', criteria: ['2.4.8'], kinds: ['likely'],
    covers: 'On sites with more than one level (nested navigation, or nested paths), inner pages with no breadcrumb, no site map link and no aria-current or current-page class in the navigation.',
    why: 'People with cognitive or memory disabilities, and screen reader users, lose track of where they are in a deep site without a breadcrumb or a marked current page.',
  },
  'no-section-headings': {
    title: 'Long text has no section headings', criteria: ['2.4.10'], kinds: ['likely'],
    covers: 'Runs of four or more paragraphs and at least 300 words with no heading between them.',
    why: 'Headings let people skim, find their place again and skip what they do not need, which matters most for people with reading or attention difficulties.',
  },
  'no-landmarks': {
    title: 'Page has no landmarks', criteria: ['1.3.6'], kinds: ['likely'],
    covers: 'Pages with no main, navigation, header, footer, aside or labelled region at all.',
    why: 'Landmarks tell assistive tools what each region is for, so screen reader users can jump to the main content and tools can simplify the page.',
  },
};
