// Helpers shared by the form, content and language checks. They run inside the page, so
// they are written as one function whose source is sent along with each check: a function
// passed to page.evaluate cannot see anything defined outside it.

export function helpers() {
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const shown = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0;
  };
  const hidden = (el) => !!el.closest('[aria-hidden=true], [hidden], [inert]');
  const visible = (el) => shown(el) && !hidden(el);
  const selector = (node) => {
    const parts = [];
    for (let n = node; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  const snippet = (el) => el.outerHTML.replace(/\s+/g, ' ').slice(0, 160);
  const words = (s) => clean(s).split(' ').filter((w) => /\p{L}/u.test(w));
  const byIds = (ids) => clean(ids).split(' ').filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  // Text a screen reader would read for an element, close enough for comparing names:
  // aria-labelledby, aria-label, then content with image descriptions, then title.
  const textOf = (el) => {
    if (el.nodeType === 3) return el.textContent;
    if (el.nodeType !== 1 || el.matches('script, style, template, noscript')) return '';
    if (el.tagName === 'IMG' || el.getAttribute('role') === 'img') return el.getAttribute('alt') || el.getAttribute('aria-label') || '';
    return [...el.childNodes].map(textOf).join(' ');
  };
  const accName = (el) => {
    const by = byIds(el.getAttribute('aria-labelledby'));
    if (by.length) return clean(by.map(textOf).join(' '));
    if (clean(el.getAttribute('aria-label'))) return clean(el.getAttribute('aria-label'));
    return clean(textOf(el)) || clean(el.getAttribute('title'));
  };
  // The name of a form field and where it comes from. `source` tells a check whether a
  // field is labelled at all, or only by its placeholder.
  const fieldName = (f) => {
    const by = byIds(f.getAttribute('aria-labelledby'));
    if (by.length) return { name: clean(by.map(textOf).join(' ')), source: 'labelledby' };
    if (clean(f.getAttribute('aria-label'))) return { name: clean(f.getAttribute('aria-label')), source: 'aria-label' };
    const labels = [...(f.labels || [])].map((l) => clean(textOf(l))).filter(Boolean);
    if (labels.length) return { name: labels.join(' '), source: 'label' };
    if (clean(f.getAttribute('title'))) return { name: clean(f.getAttribute('title')), source: 'title' };
    if (clean(f.getAttribute('placeholder'))) return { name: clean(f.getAttribute('placeholder')), source: 'placeholder' };
    return { name: '', source: 'none' };
  };
  // Fields a person fills in. Hidden fields and buttons are not.
  const FIELD = 'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea';
  const fieldsOf = (root) => [...root.querySelectorAll(FIELD)].filter((f) => visible(f) || (f.labels && [...f.labels].some(visible)));
  const isSearch = (form) => form.matches('[role=search]') || !!form.closest('[role=search], search') ||
    (fieldsOf(form).length === 1 && (fieldsOf(form)[0].type === 'search' || /^(q|s|query|search|keywords?)$/i.test(fieldsOf(form)[0].name || '')));
  // The main text of the page: the main landmark if there is one, without navigation,
  // header, footer, asides and anything hidden.
  const mainRoot = () => document.querySelector('main, [role=main]') || document.body;
  const SKIP = 'nav, header, footer, aside, [role=navigation], [role=banner], [role=contentinfo], [role=complementary], script, style, noscript, template, [aria-hidden=true], [hidden], form, button, select, textarea, code, pre';
  const blocks = (root = mainRoot()) => [...root.querySelectorAll('p, li, blockquote, dd, td, th, figcaption, h1, h2, h3, h4, h5, h6')]
    .filter((el) => !el.closest(SKIP) && shown(el) && !el.querySelector('p, li, blockquote, dd, td'));
  return { clean, shown, hidden, visible, selector, snippet, words, byIds, textOf, accName, fieldName, FIELD, fieldsOf, isSearch, mainRoot, blocks };
}

// Runs fn(h, arg) in the page, where h is the object helpers() returns. Named functions in
// `deps` are defined alongside, for checks that share in-page code.
export function inPage(page, fn, arg = null, deps = []) {
  const defs = deps.map((d) => `const ${d.name} = ${d};`).join('\n');
  return page.evaluate(`(() => { ${defs}\n return (${fn})((${helpers})(), ${JSON.stringify(arg)}); })()`);
}

// The issue() helper from checks/index.mjs. That file imports every check module, so a
// module that imported it back at load time would break whenever it was loaded first.
export async function loadIssue() {
  return (await import('./index.mjs')).issue;
}
