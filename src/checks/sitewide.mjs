// Checks that compare what pages offer across the whole site: ways to find pages (2.4.5),
// the names of repeated links and controls (3.2.4), and where help sits (3.2.6). A look
// probe reads each page once; the site probes compare the pages seen the same way (same
// browser, same screen size), because a phone layout may reorder a page on purpose.
import { issue } from './index.mjs';

const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };

// Runs in the page. Everything the comparisons below need, and nothing they do not.
function readPage() {
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  // Text as a screen reader would read it: image descriptions included, aria-hidden parts left out.
  const textOf = (el) => {
    let s = '';
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1 && n.getAttribute('aria-hidden') !== 'true' && getComputedStyle(n).display !== 'none') s += ' ' + (n.tagName === 'IMG' ? n.alt || '' : textOf(n)) + ' ';
    }
    return s;
  };
  const nameOf = (el) => clean(el.getAttribute('aria-label')
    || (el.getAttribute('aria-labelledby') || '').split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ')
    || (el.tagName === 'INPUT' ? el.value || el.alt : textOf(el))
    || el.getAttribute('title'));
  const selectorOf = (el) => {
    if (el.id) return `#${CSS.escape(el.id)}`;
    const parts = [];
    for (let e = el; e && e !== document.body && parts.length < 4; e = e.parentElement) {
      if (e.id) { parts.unshift(`#${CSS.escape(e.id)}`); break; }
      const same = e.parentElement ? [...e.parentElement.children].filter((c) => c.tagName === e.tagName) : [];
      parts.unshift(e.tagName.toLowerCase() + (same.length > 1 ? `:nth-of-type(${same.indexOf(e) + 1})` : ''));
    }
    return parts.join(' > ');
  };
  const here = location.pathname.replace(/\/index\.html?$/, '/');
  // Same destination, written either way: /about, /about/ and /about/index.html are one page.
  // A link to a part of a page is not a link to that page: "/#work" and "/" are different
  // destinations, and an href of "#" or "#settings" is a control on this page, not a link.
  const destination = (a) => {
    if ((a.getAttribute('href') || '').trim().startsWith('#')) return null;
    let u;
    try { u = new URL(a.href); } catch { return null; }
    if (!/^https?:$/.test(u.protocol)) return null;
    const path = u.pathname.replace(/\/index\.html?$/, '/').replace(/(.)\/$/, '$1');
    const rest = u.search + (u.hash.length > 1 ? u.hash : '');
    return u.origin === location.origin ? path + rest : u.origin + path + rest;
  };
  const otherPage = (a) => { const d = destination(a)?.split("#")[0]; return d && d.startsWith('/') && d !== here.replace(/(.)\/$/, '$1'); };

  const main = document.querySelector('main, [role=main]');
  const inMain = (el) => !!main && main.contains(el);
  const region = (el) => {
    if (inMain(el)) return null;
    const lm = el.closest('header, [role=banner], footer, [role=contentinfo], nav, [role=navigation]');
    if (!lm) return null;
    if (lm.closest('header, [role=banner]')) return 'header';
    if (lm.closest('footer, [role=contentinfo]')) return 'footer';
    return 'nav';
  };

  // 2.4.5: the ways this page offers to find other pages.
  const SEARCH_FIELD = 'input[type=search], input[name=q], input[name=s], input[name=search], input[name=query], input[name=keywords], input[name=keyword]';
  const searchForms = [...document.querySelectorAll('form, [role=search], search')].filter((f) => f.querySelector(SEARCH_FIELD) || (f.matches('[role=search], search') && f.querySelector('input')));
  const links = [...document.querySelectorAll('a[href]')];
  const labelled = (el) => clean(el.getAttribute('aria-label') || el.querySelector('h2, h3, h4, h5, h6')?.textContent || '');
  const groups = [...document.querySelectorAll('nav, aside, section, [role=navigation], [role=complementary]')]
    .map((el) => ({ label: labelled(el), count: [...el.querySelectorAll('a[href]')].filter(otherPage).length }));
  // A navigation landmark with a link to another page, or a header with several. A lone link
  // in a header is usually the logo.
  const otherLinks = (el) => [...el.querySelectorAll('a[href]')].filter(otherPage).length;
  const ways = {
    navigation: [...document.querySelectorAll('nav, [role=navigation]')].some((n) => otherLinks(n) >= 1)
      || [...document.querySelectorAll('header, [role=banner]')].some((h) => otherLinks(h) >= 2),
    search: searchForms.some((f) => shown(f)) || links.some((a) => /^search$/i.test(nameOf(a)) || /\/search\/?$/i.test(new URL(a.href, location.href).pathname)),
    siteMap: links.some((a) => !/\.xml$/i.test(a.href) && (/\bsite ?map\b/i.test(nameOf(a)) || /\/site-?map(\.html?)?\/?$/i.test(new URL(a.href, location.href).pathname))),
    contents: groups.some((g) => g.count >= 2 && /table of contents|^contents$|\ba-z\b|\bindex\b/i.test(g.label)),
    related: groups.some((g) => g.count >= 1 && /related|see also|you (may|might) also|read next|more (articles|stories|posts|resources)/i.test(g.label)),
  };
  const body = clean(document.body?.innerText || '').slice(0, 6000);
  const processStep = /\bstep \d+ (of|\/) \d+\b/i.test(body) || !!document.querySelector('[aria-current=step]') || /\/(checkout|cart|basket|payment)(\/|$)/i.test(location.pathname);

  // 3.2.4: what the repeated parts of the page call each destination, and the search control.
  const repeated = [];
  for (const a of links) {
    const where = region(a);
    const to = destination(a);
    if (!where || !to || !shown(a)) continue;
    // "(current)" and similar hidden markers say which page this is, not what the link is called.
    const name = nameOf(a).replace(/\(?\s*current( page)?\s*\)?$/i, '').replace(/[\s›»→>|:]+$/, '').trim();
    if (name) repeated.push({ region: where, to, name, selector: selectorOf(a) });
  }
  const searchNames = [];
  for (const f of searchForms) {
    if (inMain(f) || !shown(f)) continue;
    const button = f.querySelector('button:not([type=button]):not([type=reset]), input[type=submit], input[type=image]');
    const field = f.querySelector(SEARCH_FIELD) || f.querySelector('input');
    const label = field && clean(field.getAttribute('aria-label') || (field.id && document.querySelector(`label[for="${CSS.escape(field.id)}"]`)?.textContent) || field.closest('label')?.textContent || field.placeholder || field.title);
    searchNames.push({ button: button ? nameOf(button) : '', field: label || '', selector: button ? selectorOf(button) : selectorOf(f) });
  }

  // 3.2.6: help mechanisms outside the main content, in document order, with which side of
  // the main content they are on. Without landmarks the page's repeated parts cannot be told
  // from its content, so nothing is collected.
  const zone = (el) => {
    if (main) {
      if (main.contains(el)) return null;
      return el.compareDocumentPosition(main) & Node.DOCUMENT_POSITION_FOLLOWING ? 'before' : 'after';
    }
    if (el.closest('header, [role=banner]')) return 'before';
    if (el.closest('footer, [role=contentinfo]')) return 'after';
    return null;
  };
  const HELP_NAME = /^(contact|contact us|get in touch|help|help center|help centre|help desk|faq|faqs|frequently asked questions|customer service|support|customer support|get support|technical support|tech support|support center|chat with us|live chat)$/i;
  const HELP_PATH = /^(contact|contact-us|contactus|help|faq|faqs|support|customer-service)$/i;
  const CHAT = /\b(live ?chat|chat with us|chat now|open chat)\b|intercom|drift-widget|zendesk|zopim|crisp|tawk|livechat|hubspot-messages|olark|freshchat|tidio/i;
  const help = [];
  const add = (el, kind, id, label) => {
    const z = zone(el);
    if (z) help.push({ el, key: `${kind}:${id}`, zone: z, label, selector: selectorOf(el) });
  };
  for (const el of document.querySelectorAll('a[href], button, [role=button], iframe')) {
    if (!shown(el)) continue;
    const href = el.getAttribute('href') || '';
    const name = nameOf(el);
    if (/^mailto:/i.test(href)) add(el, 'email', href.slice(7).split('?')[0].toLowerCase(), name || href.slice(7));
    else if (/^tel:/i.test(href)) add(el, 'phone', href.replace(/\D/g, ''), name || href.slice(4));
    else if (CHAT.test([el.id, typeof el.className === 'string' ? el.className : '', el.title, el.getAttribute('aria-label'), el.tagName === 'IFRAME' ? el.src : '', name].join(' '))) add(el, 'chat', 'chat', name || 'chat');
    else if (el.tagName === 'A') {
      const to = destination(el);
      const last = (to || '').split('?')[0].split('/').pop().replace(/\.html?$/, '');
      if (to && (HELP_NAME.test(name) || HELP_PATH.test(last))) add(el, 'link', to, name);
    }
  }
  // Phone numbers written out in the header or footer without a link.
  const PHONE = /(\+?\d{1,2}[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
  for (const box of document.querySelectorAll('header, [role=banner], footer, [role=contentinfo]')) {
    if (inMain(box)) continue;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const m = PHONE.exec(n.textContent);
      if (m && !n.parentElement.closest('a[href]') && shown(n.parentElement)) add(n.parentElement, 'phone', m[0].replace(/\D/g, '').replace(/^1(?=\d{10}$)/, ''), m[0]);
    }
  }
  // tel: links and written numbers for the same line count as one mechanism.
  for (const h of help) if (h.key.startsWith('phone:')) h.key = 'phone:' + h.key.slice(6).replace(/^1(?=\d{10}$)/, '');
  help.sort((a, b) => (a.el === b.el ? 0 : a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));

  return { ways, processStep, repeated, searchNames, help: help.map(({ el, ...h }) => h) };
}

async function collect(page, ctx) {
  ctx.result.sitewide = await page.evaluate(readPage);
  return [];
}

const WAY_NAMES = { navigation: 'a navigation menu', search: 'search', siteMap: 'a site map page', contents: 'a table of contents or A to Z index', related: 'related links' };

// 2.4.5 Multiple Ways: in a set of pages, more than one way to find each page, except pages
// that are a step in a process. What the site offers is pooled across the pages audited: a
// search box on the home page searches every page.
function multipleWays(pages, ctx) {
  const read = pages.filter((p) => p.sitewide);
  const known = new Set([...read.map((p) => pathOf(p.url)), ...(ctx.siteUrls || []).map(pathOf)]);
  if (known.size < 2) return; // one page is not a set of pages
  const candidates = read.filter((p) => !p.sitewide.processStep);
  if (!candidates.length) return;
  const found = Object.keys(WAY_NAMES).filter((w) => read.some((p) => p.sitewide.ways[w]));
  if (found.length >= 2) return;
  const exempt = read.length - candidates.length;
  candidates[0].issues.push(issue('multiple-ways', {
    scope: 'site', selector: 'body',
    message: `${found.length ? `only one way to reach other pages was found (${WAY_NAMES[found[0]]})` : 'no way to reach other pages was found'} on the ${read.length} page${read.length === 1 ? '' : 's'} audited, in a site of ${known.size} pages; there should be at least two, such as a menu and search, or a menu and a site map page${exempt ? `. ${exempt} page${exempt === 1 ? ' is a step' : 's are steps'} in a process and ${exempt === 1 ? 'was' : 'were'} left out` : ''}`,
  }));
}

// The most common value of key(page) among pages that have one, and how often it occurs.
function usual(pages, key) {
  const tally = new Map();
  for (const p of pages) {
    const k = key(p);
    if (k === undefined) continue;
    tally.set(k, (tally.get(k) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

// 3.2.4 Consistent Identification: something that does the same thing on every page has the
// same name on every page. Compared for links in the header, footer and navigation (same
// destination, same part of the page) and for the search control.
function consistentIdentification(pages) {
  const read = pages.filter((p) => p.sitewide);
  if (read.length < 2) return;
  // Per page, the names given to each destination in each repeated part of the page. A logo
  // and a "Home" link both go home on every page; that pair is the usual set, not a conflict.
  const namesOn = (p, slot) => [...new Set(p.sitewide.repeated.filter((r) => `${r.region} ${r.to}` === slot).map((r) => r.name.toLowerCase()))].sort();
  const slots = new Set(read.flatMap((p) => p.sitewide.repeated.map((r) => `${r.region} ${r.to}`)));
  for (const slot of slots) {
    const having = read.filter((p) => namesOn(p, slot).length);
    if (having.length < 2) continue;
    const reference = JSON.parse(usual(having, (p) => JSON.stringify(namesOn(p, slot))));
    // Names are compared without case; the message quotes them as the pages write them.
    const written = new Map(having.flatMap((p) => p.sitewide.repeated.filter((r) => `${r.region} ${r.to}` === slot).map((r) => [r.name.toLowerCase(), r.name])).reverse());
    for (const p of having) {
      const odd = namesOn(p, slot).filter((n) => !reference.includes(n));
      if (!odd.length) continue;
      const r = p.sitewide.repeated.find((x) => `${x.region} ${x.to}` === slot && x.name.toLowerCase() === odd[0]);
      const others = having.filter((o) => o !== p && namesOn(o, slot).some((n) => reference.includes(n))).map((o) => pathOf(o.url));
      p.issues.push(issue('inconsistent-identification', {
        scope: 'site', selector: r.selector,
        message: `the ${r.region === 'nav' ? 'navigation' : r.region} link to ${r.to} is called "${r.name}" here but "${reference.map((n) => written.get(n)).join('" or "')}" on ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}`,
      }));
    }
  }
  for (const part of ['button', 'field']) {
    const having = read.filter((p) => p.sitewide.searchNames[0]?.[part]);
    if (having.length < 2) continue;
    const name = (p) => p.sitewide.searchNames[0][part].toLowerCase();
    const reference = usual(having, name);
    for (const p of having) {
      if (name(p) === reference) continue;
      const others = having.filter((o) => name(o) === reference).map((o) => pathOf(o.url));
      p.issues.push(issue('inconsistent-identification', {
        scope: 'site', selector: p.sitewide.searchNames[0].selector,
        message: `the search ${part === 'button' ? 'button' : 'field'} is called "${p.sitewide.searchNames[0][part]}" here but "${having.find((o) => name(o) === reference).sitewide.searchNames[0][part]}" on ${others.slice(0, 3).join(', ')}${others.length > 3 ? ` and ${others.length - 3} more` : ''}`,
      }));
    }
  }
}

// 3.2.6 Consistent Help: contact details, contact forms, self-help and chat that repeat on
// several pages come in the same order relative to the rest of the page. Each page's help
// is a sequence of mechanisms, each before or after the main content; the most common
// sequence is the reference. A mechanism on the other side of the main content, or two
// mechanisms swapped, fails. Missing from a page is not a failure: the criterion only asks
// for consistency where help is offered.
function consistentHelp(pages) {
  const read = pages.filter((p) => p.sitewide?.help.length);
  if (read.length < 2) return;
  const tokens = (p) => {
    const seen = new Set();
    return p.sitewide.help.filter((h) => { const t = `${h.key}@${h.zone}`; if (seen.has(t)) return false; seen.add(t); return true; });
  };
  const refPage = (() => { const k = usual(read, (p) => JSON.stringify(tokens(p).map((h) => `${h.key}@${h.zone}`))); return read.find((p) => JSON.stringify(tokens(p).map((h) => `${h.key}@${h.zone}`)) === k); })();
  const ref = tokens(refPage);
  const zonesIn = (list, key) => new Set(list.filter((h) => h.key === key).map((h) => h.zone));
  const SIDE = { before: 'before the main content', after: 'after the main content' };
  for (const p of read) {
    if (p === refPage) continue;
    const mine = tokens(p);
    let problem;
    for (const h of mine) {
      const theirs = zonesIn(ref, h.key);
      const ours = zonesIn(mine, h.key);
      if (theirs.size && ![...ours].some((z) => theirs.has(z))) {
        problem = { h, message: `"${h.label}" comes ${SIDE[h.zone]} here but ${SIDE[[...theirs][0]]} on ${pathOf(refPage.url)}` };
        break;
      }
    }
    if (!problem) {
      const order = ref.map((h) => `${h.key}@${h.zone}`);
      const shared = mine.filter((h) => order.includes(`${h.key}@${h.zone}`));
      for (let i = 1; i < shared.length && !problem; i++) {
        const before = shared[i - 1], after = shared[i];
        if (order.indexOf(`${after.key}@${after.zone}`) < order.indexOf(`${before.key}@${before.zone}`)) {
          problem = { h: after, message: `"${after.label}" comes after "${before.label}" here but before it on ${pathOf(refPage.url)}` };
        }
      }
    }
    if (problem) p.issues.push(issue('inconsistent-help', { scope: 'site', selector: problem.h.selector, message: `${problem.message}; help that repeats across pages has to stay in the same place relative to the rest of the page` }));
  }
}

export const probes = [{ name: 'site-wide reading', phase: 'look', run: collect }];
export const siteProbes = [
  { name: 'multiple ways', run: multipleWays },
  { name: 'consistent identification', run: consistentIdentification },
  { name: 'consistent help', run: consistentHelp },
];

export const rules = {
  'multiple-ways': {
    title: 'Only one way to find pages', criteria: ['2.4.5'], kinds: ['likely'], impact: 'moderate',
    covers: 'Across the pages audited and the sitemap, looks for a navigation menu, search, a site map page, a table of contents or A to Z index, and related links. A site of several pages with fewer than two of these is flagged. Pages that say they are a step in a process are left out.',
    why: 'People find pages in different ways. Someone using a screen reader or with a memory or attention difficulty may find a search box or a site map far easier than a large menu, and the other way round.',
  },
  'inconsistent-identification': {
    title: 'Same link or control has different names on different pages', criteria: ['3.2.4'], kinds: ['likely'], impact: 'moderate',
    covers: 'Links in the header, footer and navigation that go to the same place but are named differently on different pages, and search buttons and fields labelled differently from page to page.',
    why: 'Screen reader users and people with cognitive disabilities learn what a control is called. When "Contact" becomes "Get in touch" on another page, they cannot tell it is the same thing.',
  },
  'inconsistent-help': {
    title: 'Help is in a different place on this page', criteria: ['3.2.6'], kinds: ['failure'], impact: 'moderate',
    covers: 'Contact links, phone numbers, email links, help and FAQ links and chat widgets outside the main content are compared across pages; one that moves to the other side of the main content, or swaps order with another, fails.',
    why: 'People who need help, often those with cognitive disabilities, look for it where they found it last time. If the contact details move from page to page, they may not find them at all.',
  },
};
