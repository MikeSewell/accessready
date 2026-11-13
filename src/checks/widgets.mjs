// Checks that operate custom widgets and page furniture the way a visitor would, each in its
// own fresh copy of the page so whatever they change cannot reach the other checks:
//   4.1.2 Name, Role, Value     a widget that changes but does not say so (aria-expanded,
//                               aria-checked, aria-selected)
//   2.1.1 Keyboard              tabs and menus whose arrow keys do nothing; dialogs that
//                               Escape does not close
//   2.4.3 Focus Order           a dialog that drops focus when it closes
//   2.4.1 Bypass Blocks         a skip link that does not skip
//   3.2.2 On Input              a choice that loads a page by itself
//   1.4.13 Content on Hover     tooltips that cannot be dismissed, hovered or kept
//   2.1.4 Character Shortcuts   single keys that do something with focus on the page
//   3.2.5 Change on Request     new windows nobody asked for, or was told about
// Every fresh copy runs behind guard(): page loads are answered with "no content" and writes
// to the server are refused, so nothing a check sets off leaves the browser.
import { PNG } from 'pngjs';
import { guard, inPage, issuer, readWatch, recall, remember, startWatch, withFresh } from './observe.mjs';

const PAUSE = 300;
const MAX_WIDGETS = 6; // of each kind, per page
const MAX_TOOLTIPS = 4;
const MAX_CHOICES = 6;
const MAX_LINKS = 10;
const SHORTCUT_KEYS = ['/', '?', 's', 'f', 'j', 'k', 'n', 'p', 'g', 'm'];
const MIN_CHANGED_PIXELS = 8;

const changed = (a, b) => {
  const one = PNG.sync.read(a), two = PNG.sync.read(b);
  if (one.width !== two.width || one.height !== two.height) return Infinity;
  let n = 0;
  for (let i = 0; i < one.data.length; i += 4) if (Math.abs(one.data[i] - two.data[i]) + Math.abs(one.data[i + 1] - two.data[i + 1]) + Math.abs(one.data[i + 2] - two.data[i + 2]) > 36) n++;
  return n;
};
const shot = (locator) => locator.screenshot({ animations: 'disabled', caret: 'hide', timeout: 2000 }).catch(() => null);

// ---------------------------------------------------------------------------------------
// Look phase: count what each operate check would have to try, so a fresh copy is only
// opened for pages that have it. Reads the page, changes nothing.

function countCandidates() {
  const referenced = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  const KEYS = ['keydown', 'keyup', 'keypress'];
  return {
    disclosures: [...document.querySelectorAll('button[aria-controls], [role=button][aria-controls]')].filter((b) => shown(b) && (b.getAttribute('role') || 'button') === 'button').length,
    toggles: [...document.querySelectorAll('[role=checkbox], [role=switch]')].filter((el) => shown(el) && el.tagName !== 'INPUT').length,
    tablists: [...document.querySelectorAll('[role=tablist]')].filter(shown).length,
    menus: [...document.querySelectorAll('[role=menubar], [role=menu]')].filter(shown).length,
    dialogs: [...document.querySelectorAll('button, [role=button]')].filter((b) => shown(b) && (b.getAttribute('aria-haspopup') === 'dialog' || referenced(b, 'aria-controls').some((t) => t.matches('dialog, [role=dialog], [role=alertdialog]')))).length,
    tooltips: [...document.querySelectorAll('[aria-describedby], [role=tooltip]')].length,
    skip: [...document.querySelectorAll('a[href^="#"]')].some((a) => /skip|jump|main content|to content/i.test(a.textContent + (a.getAttribute('aria-label') || ''))),
    choices: [...document.querySelectorAll('select, input[type=radio], input[type=checkbox]')].filter(shown).length,
    keys: [window, document, document.documentElement, document.body].some((t) => t && typesOf(t).some((x) => KEYS.includes(x))),
  };
}

// 3.2.5 from the page as loaded: links that open a new window without saying so, and windows
// a script opened with no click behind it.
function newWindows(max) {
  const SAYS = /new (tab|window|browser)|opens? (in )?(a )?(new|separate|another)|external (link|site)|\bexternal\b/i;
  const textOf = (el) => {
    const parts = [el.getAttribute('aria-label'), el.getAttribute('title'), el.textContent];
    for (const attr of ['aria-labelledby', 'aria-describedby']) for (const id of (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) parts.push(document.getElementById(id)?.textContent);
    for (const img of el.querySelectorAll('img[alt], [aria-label], svg title')) parts.push(img.getAttribute?.('alt'), img.getAttribute?.('aria-label'), img.tagName === 'title' ? img.textContent : '');
    return parts.filter(Boolean).join(' ');
  };
  const links = [...document.querySelectorAll('a[href][target]')].filter((a) => shown(a) && !/^(_self|_top|_parent|)$/i.test(a.getAttribute('target').trim()) && !SAYS.test(textOf(a)));
  return {
    links: links.slice(0, max).map((a) => ({ what: `link "${labelOf(a)}"`, selector: selectorOf(a), html: htmlOf(a) })),
    more: Math.max(0, links.length - max),
    unasked: (window.__accessready_log?.opened || []).filter((o) => !o.user).map((o) => o.url),
  };
}

async function look(page, ctx) {
  remember(ctx, 'widgets', await inPage(page, countCandidates));
  const issues = [];
  const notes = [];
  const w = await inPage(page, newWindows, MAX_LINKS);
  for (const url of w.unasked.slice(0, 1)) issues.push(issue('window-opened-unasked', { message: `the page opened a new window${url ? ` (${url})` : ''} by itself, with no click or key press behind it`, selector: 'window.open', html: '' }));
  // The link finding is AAA only: not worth listing at A or AA.
  if (ctx.level === 'AAA') {
    for (const l of w.links) issues.push(issue('new-window-unannounced', { message: `${l.what} opens in a new window or tab, and nothing in its text, label or icon says so`, selector: l.selector, html: l.html }));
    if (w.more) notes.push(`${w.more} more links open a new window without saying so; the first ${MAX_LINKS} are listed`);
  }
  return { issues, notes };
}

// ---------------------------------------------------------------------------------------
// 4.1.2 and 2.1.1: disclosures, custom checkboxes and switches, tabs, menus, dialogs.

function markWidgets(max) {
  const referenced = (el, attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  const mark = (list, kind) => list.slice(0, max).map((el, i) => { el.setAttribute('data-accessready-widget', `${kind}-${i}`); return { key: `${kind}-${i}`, what: `${el.tagName.toLowerCase()}${labelOf(el) ? ` "${labelOf(el)}"` : ''}`, label: labelOf(el), selector: selectorOf(el), html: htmlOf(el) }; });
  // Buttons in role only: a tab or a menu item that controls a panel is tested as a tab or menu.
  // A button that submits a form is left alone. A <button> with no type is "submit" even
  // outside a form, where it submits nothing (WordPress menu toggles are written that way),
  // so what counts is whether it belongs to a form.
  const buttons = [...document.querySelectorAll('button, [role=button]')].filter((b) => shown(b) && !b.disabled && !(b.form && b.type === 'submit') && b.getAttribute('aria-disabled') !== 'true' && (b.getAttribute('role') || 'button') === 'button');
  const opensDialog = (b) => b.getAttribute('aria-haspopup') === 'dialog' || referenced(b, 'aria-controls').some((t) => t.matches('dialog, [role=dialog], [role=alertdialog]'));
  return {
    disclosures: mark(buttons.filter((b) => b.hasAttribute('aria-controls') && referenced(b, 'aria-controls').length && !opensDialog(b)), 'disclosure'),
    toggles: mark([...document.querySelectorAll('[role=checkbox], [role=switch]')].filter((el) => shown(el) && el.tagName !== 'INPUT' && el.getAttribute('aria-disabled') !== 'true'), 'toggle'),
    tablists: mark([...document.querySelectorAll('[role=tablist]')].filter((t) => shown(t) && t.querySelectorAll('[role=tab]').length >= 2), 'tablist'),
    menus: mark([...document.querySelectorAll('[role=menubar], [role=menu]')].filter((m) => shown(m) && m.querySelectorAll('[role^=menuitem]').length >= 2), 'menu'),
    dialogs: mark(buttons.filter(opensDialog), 'dialog'),
  };
}

// In the page: the state of a marked widget and of what it controls.
function widgetState(key) {
  const el = document.querySelector(`[data-accessready-widget="${key}"]`);
  if (!el) return null;
  const referenced = (attr) => (el.getAttribute(attr) || '').split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)).filter(Boolean);
  const open = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden' && !d.closest('[hidden]'); };
  const dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].filter(open);
  const tabs = [...el.querySelectorAll('[role=tab]')];
  const items = [...el.querySelectorAll('[role^=menuitem]')];
  const a = document.activeElement;
  return {
    expanded: el.getAttribute('aria-expanded'),
    checked: el.getAttribute('aria-checked'),
    controlsShown: referenced('aria-controls').map(open).join(','),
    selected: tabs.findIndex((t) => t.getAttribute('aria-selected') === 'true'),
    tabs: tabs.length,
    tabFocus: tabs.indexOf(a),
    tabsTabbable: tabs.filter((t) => t.tabIndex >= 0).length,
    itemFocus: items.indexOf(a),
    itemsTabbable: items.filter((t) => t.tabIndex >= 0).length,
    dialog: dialogs.map((d) => (d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.id || 'dialog').trim().slice(0, 60))[0] || null,
    focusInDialog: dialogs.some((d) => d.contains(a)),
    focusOnTrigger: a === el || el.contains(a),
    focusOnBody: !a || a === document.body || a === document.documentElement,
  };
}

async function operateWidgets(_page, ctx) {
  const c = recall(ctx, 'widgets');
  if (!c || !(c.disclosures || c.toggles || c.tablists || c.menus || c.dialogs)) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    const marked = await inPage(page, markWidgets, MAX_WIDGETS);
    const issues = [];
    const loc = (key, inner = '') => page.locator(`[data-accessready-widget="${key}"]${inner}`).first();
    const state = (key) => page.evaluate(widgetState, key);
    const at = (m) => ({ selector: m.selector, html: m.html });
    // A real click by the mouse, with focus taken off again so a :focus style does not make
    // two pictures differ. The pointer stays where it is, so hover styles are the same in both.
    const click = async (l) => { const ok = await l.click({ timeout: 2000 }).then(() => true, () => false); await page.waitForTimeout(PAUSE); return ok; };
    const blur = () => page.evaluate(() => document.activeElement?.blur?.());

    for (const m of marked.disclosures) {
      const before = await state(m.key);
      if (!before || !(await click(loc(m.key)))) continue;
      const after = await state(m.key);
      if (!after || after.controlsShown === before.controlsShown) continue;
      if (before.expanded === null) {
        issues.push(issue('disclosure-state', { kind: 'likely', message: `${m.what} shows or hides the content it controls but has no aria-expanded, so a screen reader cannot tell whether it is open`, ...at(m) }));
      } else if (after.expanded === before.expanded) {
        issues.push(issue('disclosure-state', { message: `${m.what} shows or hides the content it controls, but aria-expanded stays "${before.expanded}", so a screen reader announces the wrong state`, ...at(m) }));
      }
      await click(loc(m.key));
    }

    for (const m of marked.toggles) {
      const l = loc(m.key);
      await l.hover({ timeout: 2000 }).catch(() => {});
      await blur();
      const before = await state(m.key), pic = await shot(l);
      if (!before || !pic || !(await click(l))) continue;
      await blur();
      await page.waitForTimeout(PAUSE);
      const after = await state(m.key), pic2 = await shot(l);
      if (!after || !pic2 || after.checked !== before.checked) continue;
      if (changed(pic, pic2) >= MIN_CHANGED_PIXELS) {
        issues.push(issue('toggle-state', { message: `clicking ${m.what} changes how it looks, but aria-checked stays "${before.checked ?? 'unset'}", so a screen reader announces the wrong state`, ...at(m) }));
      }
    }

    for (const m of marked.tablists) {
      const before = await state(m.key);
      if (!before) continue;
      const other = before.selected === 0 ? 1 : 0;
      const tab = loc(m.key, ` [role=tab] >> nth=${other}`);
      const area = page.locator(`[data-accessready-widget="${m.key}"]`).locator('xpath=..');
      await tab.hover({ timeout: 2000 }).catch(() => {});
      await blur();
      const pic = await shot(area);
      if (await click(tab)) {
        await blur();
        await page.waitForTimeout(PAUSE);
        const after = await state(m.key), pic2 = await shot(area);
        if (after && after.selected !== other && pic && pic2 && changed(pic, pic2) >= MIN_CHANGED_PIXELS) {
          issues.push(issue('tab-state', { message: `clicking tab ${other + 1} of ${m.what} changes what is shown, but aria-selected ${before.selected >= 0 ? `stays on tab ${before.selected + 1}` : 'is not set on it'}, so a screen reader announces the wrong tab`, ...at(m) }));
        }
      }
      // Arrow keys, from the tab that is selected now.
      const now = await state(m.key);
      const start = Math.max(0, now?.selected ?? 0);
      await loc(m.key, ` [role=tab] >> nth=${start}`).focus({ timeout: 2000 }).catch(() => {});
      let moved = false;
      for (const key of ['ArrowRight', 'ArrowDown']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(PAUSE);
        const s = await state(m.key);
        if (s && ((s.tabFocus >= 0 && s.tabFocus !== start) || s.selected !== now.selected)) { moved = true; break; }
      }
      if (!moved && now) {
        // Tabs left out of the Tab order can only be reached with the arrow keys.
        const unreachable = now.tabs - now.tabsTabbable;
        issues.push(issue('widget-arrow-keys', unreachable > 0
          ? { message: `the arrow keys do not move between the tabs of ${m.what}, and ${unreachable} of its ${now.tabs} tabs ${unreachable === 1 ? 'is' : 'are'} left out of the Tab order, so the keyboard cannot reach them`, ...at(m) }
          : { kind: 'advice', message: `the arrow keys do not move between the tabs of ${m.what}; every tab is in the Tab order, so they can be reached, but screen reader users expect arrow keys in a tab list`, ...at(m) }));
      }
    }

    for (const m of marked.menus) {
      const before = await state(m.key);
      if (!before) continue;
      await loc(m.key, ' [role^=menuitem] >> nth=0').focus({ timeout: 2000 }).catch(() => {});
      let moved = false;
      for (const key of ['ArrowDown', 'ArrowRight']) {
        await page.keyboard.press(key);
        await page.waitForTimeout(PAUSE);
        const s = await state(m.key);
        if (s && s.itemFocus > 0) { moved = true; break; }
        if (s && s.itemFocus < 0) await loc(m.key, ' [role^=menuitem] >> nth=0').focus({ timeout: 2000 }).catch(() => {});
      }
      if (!moved) {
        const items = await page.locator(`[data-accessready-widget="${m.key}"] [role^=menuitem]`).count();
        const unreachable = items - before.itemsTabbable;
        issues.push(issue('widget-arrow-keys', unreachable > 0
          ? { message: `the arrow keys do not move between the items of ${m.what}, and ${unreachable} of its ${items} items ${unreachable === 1 ? 'is' : 'are'} left out of the Tab order, so the keyboard cannot reach them`, ...at(m) }
          : { kind: 'advice', message: `the arrow keys do not move between the items of ${m.what}; screen reader users expect arrow keys in a menu`, ...at(m) }));
      }
    }

    for (const m of marked.dialogs) {
      const trigger = loc(m.key);
      if (!(await click(trigger))) continue;
      const open = await state(m.key);
      if (!open?.dialog) continue;
      // Escape goes wherever the dialog left focus: in it if it took focus, else the button.
      await page.keyboard.press('Escape');
      await page.waitForTimeout(PAUSE);
      let s = await state(m.key);
      if (s?.dialog) {
        issues.push(issue('dialog-escape', { message: `the dialog "${open.dialog}" opened by ${m.what} does not close when Escape is pressed`, ...at(m) }));
        // Close it the way a user would, with its own close button.
        const close = page.locator('dialog[open], [role=dialog], [role=alertdialog]').getByRole('button', { name: /close|cancel|dismiss|done|^x$|×/i }).first();
        await close.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(PAUSE);
        s = await state(m.key);
        if (s?.dialog) continue;
      }
      // Focus went into the dialog; when it closes, it should come back to the button.
      if (open.focusInDialog && s && !s.focusOnTrigger) {
        issues.push(issue('dialog-focus-return', { message: `when the dialog "${open.dialog}" opened by ${m.what} closes, keyboard focus goes ${s.focusOnBody ? 'back to the top of the page' : 'somewhere else'} instead of back to the button`, ...at(m) }));
      }
    }
    await g.stop();
    return issues;
  });
}

// ---------------------------------------------------------------------------------------
// 2.4.1: the skip link, used from the keyboard.

function findSkip() {
  const a = document.activeElement;
  if (!a || a.tagName !== 'A' || !/^#./.test(a.getAttribute('href') || '')) return null;
  const text = (a.textContent + ' ' + (a.getAttribute('aria-label') || '')).trim();
  if (!/skip|jump|main content|to content/i.test(text)) return null;
  const id = decodeURIComponent(a.getAttribute('href').slice(1));
  const target = document.getElementById(id) || document.getElementsByName(id)[0] || null;
  if (target) target.setAttribute('data-accessready-skip', '');
  return { what: `link "${labelOf(a)}"`, href: a.getAttribute('href'), found: !!target, selector: selectorOf(a), html: htmlOf(a) };
}

function skipLanded() {
  const target = document.querySelector('[data-accessready-skip]');
  const a = document.activeElement;
  const top = target.getBoundingClientRect().top;
  if (a && a !== document.body && (target === a || target.contains(a) || (target.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING))) return 'landed';
  if ((!a || a === document.body) && top > -5 && top < innerHeight / 2) return 'landed';
  return a && a !== document.body && (target.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING) ? 'before' : 'unclear';
}

async function useSkipLink(_page, ctx) {
  if (!recall(ctx, 'widgets')?.skip) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    let link = null;
    for (let i = 0; i < 3 && !link; i++) {
      await page.keyboard.press('Tab');
      await page.waitForTimeout(150);
      link = await inPage(page, findSkip);
    }
    if (!link) { await g.stop(); return []; }
    const at = { selector: link.selector, html: link.html };
    if (!link.found) { await g.stop(); return [issue('skip-link-broken', { message: `${link.what} points at ${link.href}, but nothing on the page has that id, so it skips nowhere`, ...at })]; }
    // A link to a place on the same page: Enter only moves within the page. Anything that
    // tries to load a page instead is answered with no content by guard().
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    await page.keyboard.press('Tab');
    await page.waitForTimeout(200);
    const landed = await page.evaluate(skipLanded);
    await g.stop();
    if (landed === 'landed') return [];
    return [issue('skip-link-broken', {
      kind: landed === 'before' ? 'failure' : 'likely',
      message: landed === 'before'
        ? `pressing Enter on ${link.what} and then Tab puts focus back before ${link.href}, so it does not skip anything`
        : `after Enter on ${link.what}, neither focus nor the view moved to ${link.href}`,
      ...at,
    })];
  });
}

// ---------------------------------------------------------------------------------------
// 3.2.2: choosing an option, a radio button or a checkbox.

function markChoices(max) {
  // Never in a login or payment form: those are the forms a visitor should be the one to send.
  const sensitive = (f) => !!f && !!f.querySelector('input[type=password], [autocomplete^=cc-], [name*=card i], [name*=cvv i], [name*=cvc i], [name*=iban i]');
  const all = [...document.querySelectorAll('select:not([multiple]), input[type=radio], input[type=checkbox]')]
    .filter((el) => shown(el) && !el.disabled && !sensitive(el.form || el.closest('form')) && (el.tagName !== 'SELECT' || el.options.length > 1))
    .filter((el) => el.type !== 'radio' || !el.checked);
  // One radio per group is enough.
  const groups = new Set();
  const picked = all.filter((el) => { if (el.type !== 'radio') return true; const k = (el.form?.id || '') + '|' + el.name; if (groups.has(k)) return false; groups.add(k); return true; }).slice(0, max);
  return picked.map((el, i) => {
    el.setAttribute('data-accessready-choice', String(i));
    const label = (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.name || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return { i, kind: el.tagName === 'SELECT' ? 'select' : el.type, index: el.tagName === 'SELECT' ? (el.selectedIndex + 1) % el.options.length : 0, what: `${el.tagName === 'SELECT' ? 'dropdown' : el.type}${label ? ` "${label}"` : ''}`, selector: selectorOf(el), html: htmlOf(el) };
  });
}

async function changeChoices(_page, ctx) {
  if (!recall(ctx, 'widgets')?.choices) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    const marked = await inPage(page, markChoices, MAX_CHOICES);
    const issues = [];
    for (const m of marked) {
      const l = page.locator(`[data-accessready-choice="${m.i}"]`);
      await page.evaluate(startWatch);
      const before = g.attempts.length, wins = g.popups.length;
      const done = m.kind === 'select'
        ? await l.selectOption({ index: m.index }, { timeout: 2000 }).then(() => true, () => false)
        : await l.click({ timeout: 2000 }).then(() => true, () => false);
      if (!done) continue;
      await page.waitForTimeout(600);
      const w = await page.evaluate(readWatch);
      const nav = g.attempts.slice(before).find((a) => a.navigation);
      const verb = m.kind === 'select' ? 'choosing an option in' : m.kind === 'radio' ? 'choosing' : 'ticking';
      if (nav) issues.push(issue('change-on-input', { message: `${verb} ${m.what} ${nav.method === 'GET' ? `loads ${nav.url}` : `submits the form (${nav.method} ${nav.url})`} straight away, with no button to confirm`, selector: m.selector, html: m.html }));
      else if (g.popups.length > wins || w.opened) issues.push(issue('change-on-input', { message: `${verb} ${m.what} opens a new window straight away`, selector: m.selector, html: m.html }));
    }
    await g.stop();
    return issues;
  });
}

// ---------------------------------------------------------------------------------------
// 1.4.13: tooltips and other content that appears on hover or focus.

function markTooltips(max) {
  const hidden = (el) => !shown(el);
  const out = [];
  const add = (trigger, tip) => {
    if (out.length >= max || !shown(trigger) || out.some((o) => o.trigger === trigger)) return;
    if (tip.matches('[role=alert], [aria-live]')) return; // an input error is exempt
    out.push({ trigger, tip });
  };
  for (const t of document.querySelectorAll('[aria-describedby]')) {
    for (const id of t.getAttribute('aria-describedby').split(/\s+/)) {
      const tip = document.getElementById(id);
      if (tip && hidden(tip)) add(t, tip);
    }
  }
  for (const tip of document.querySelectorAll('[role=tooltip]')) {
    if (!hidden(tip) || out.some((o) => o.tip === tip)) continue;
    const ref = tip.id && document.querySelector(`[aria-describedby~="${CSS.escape(tip.id)}"], [aria-labelledby~="${CSS.escape(tip.id)}"], [aria-controls~="${CSS.escape(tip.id)}"]`);
    add(ref || tip.parentElement, tip);
  }
  return out.map(({ trigger, tip }, i) => {
    trigger.setAttribute('data-accessready-trigger', String(i));
    tip.setAttribute('data-accessready-tip', String(i));
    return { i, what: `${trigger.tagName.toLowerCase()}${labelOf(trigger) ? ` "${labelOf(trigger)}"` : ''}`, selector: selectorOf(trigger), html: htmlOf(trigger) };
  });
}

// In the page: is the tip shown, and does it sit over other content? Content that covers
// nothing is exempt from having to be dismissible.
function tipState(i) {
  const tip = document.querySelector(`[data-accessready-tip="${i}"]`);
  if (!tip || !shown(tip)) return { shown: false };
  const r = tip.getBoundingClientRect();
  let covers = false;
  for (const fx of [0.2, 0.5, 0.8]) for (const fy of [0.25, 0.75]) {
    const stack = document.elementsFromPoint(r.left + r.width * fx, r.top + r.height * fy);
    const under = stack.find((el) => !tip.contains(el) && !el.contains(tip) && el !== document.body && el !== document.documentElement);
    if (under && ((under.textContent || '').trim() || under.matches('img, svg, video, canvas, input, button'))) covers = true;
  }
  return { shown: true, covers, x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

async function hoverContent(_page, ctx) {
  if (!recall(ctx, 'widgets')?.tooltips) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    const marked = await inPage(page, markTooltips, MAX_TOOLTIPS);
    const issues = [];
    const tip = (i) => inPage(page, tipState, i);
    for (const m of marked) {
      const trigger = page.locator(`[data-accessready-trigger="${m.i}"]`);
      const at = { selector: m.selector, html: m.html };
      const box = await trigger.boundingBox().catch(() => null);
      if (!box) continue;
      const hoverTrigger = async () => { await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 2 }); await page.waitForTimeout(400); };
      const away = async () => { await page.mouse.move(1, 1, { steps: 2 }); await page.evaluate(() => document.activeElement?.blur?.()); await page.waitForTimeout(400); };
      await away();
      await hoverTrigger();
      let how = (await tip(m.i)).shown ? 'hover' : null;
      if (!how) {
        await away();
        await trigger.focus({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(400);
        how = (await tip(m.i)).shown ? 'focus' : null;
      }
      if (!how) continue;
      const shownBy = how === 'hover' ? 'hovering over' : 'focusing';

      // Persistent: it stays while the pointer or focus stays.
      await page.waitForTimeout(1500);
      if (!(await tip(m.i)).shown) {
        issues.push(issue('hover-content-persistent', { message: `the content shown by ${shownBy} ${m.what} disappears by itself after a moment, while the ${how === 'hover' ? 'pointer is still on it' : 'focus is still there'}`, ...at }));
        continue;
      }
      // Hoverable: the pointer can move onto it without it vanishing.
      if (how === 'hover') {
        const s = await tip(m.i);
        await page.mouse.move(s.x, s.y, { steps: 8 });
        await page.waitForTimeout(400);
        if (!(await tip(m.i)).shown) issues.push(issue('hover-content-hoverable', { message: `the content shown by hovering over ${m.what} disappears when the pointer moves onto it, so it cannot be read with screen magnification or copied`, ...at }));
        await hoverTrigger();
      }
      // Dismissible: Escape hides it without moving the pointer or focus.
      const open = await tip(m.i);
      if (!open.shown) continue;
      await page.keyboard.press('Escape');
      await page.waitForTimeout(PAUSE);
      if ((await tip(m.i)).shown && open.covers) issues.push(issue('hover-content-dismiss', { message: `the content shown by ${shownBy} ${m.what} covers other content and Escape does not hide it, so the only way to get rid of it is to move the ${how === 'hover' ? 'pointer' : 'focus'}`, ...at }));
      await away();
    }
    await g.stop();
    return issues;
  });
}

// ---------------------------------------------------------------------------------------
// 2.1.4: single character keys pressed with focus on the page itself.

async function pressLetters(_page, ctx) {
  if (!recall(ctx, 'widgets')?.keys) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    const reset = () => page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
    await reset();
    await page.evaluate(startWatch);
    await page.waitForTimeout(400);
    const quiet = (await page.evaluate(readWatch)).mutations === 0;
    // One try: press `key` (or nothing, for a control try) and name what changed, if anything.
    const trial = async (key) => {
      await reset();
      await page.waitForTimeout(50);
      await page.evaluate(startWatch);
      const navs = g.attempts.length, wins = g.popups.length;
      if (key) await page.keyboard.press(key);
      await page.waitForTimeout(250);
      const w = await page.evaluate(readWatch);
      const focus = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? `${a.tagName.toLowerCase()}${(a.getAttribute('aria-label') || a.getAttribute('placeholder') || a.labels?.[0]?.textContent || '').trim() ? ` "${(a.getAttribute('aria-label') || a.getAttribute('placeholder') || a.labels?.[0]?.textContent || '').trim().slice(0, 40)}"` : ''}` : null; });
      return g.attempts.slice(navs).some((a) => a.navigation) ? 'loads another page'
        : g.popups.length > wins || w.opened ? 'opens a new window'
        : w.dialogs.length ? `opens "${w.dialogs[0]}"`
        : focus ? `moves focus to ${focus}`
        : w.scrolled ? 'scrolls the page'
        : quiet && w.mutations > 0 ? 'changes the page'
        : null;
    };
    const found = [];
    for (const key of SHORTCUT_KEYS) {
      const effect = await trial(key);
      if (!effect) continue;
      // A page that animates or scrolls by itself can change at the moment a key is pressed.
      // Count a key only when pressing it again does the same, and two tries with no key
      // pressed do not.
      if (await trial(key) !== effect) continue;
      if (await trial(null) === effect || await trial(null) === effect) continue;
      found.push(`"${key}" ${effect}`);
      if (found.length >= 3) break;
    }
    await g.stop();
    if (!found.length) return [];
    return [issue('character-shortcut', {
      message: `with focus on the page and no other key held, pressing ${found.join('; ')}. Speech input users set these off by accident; there should be a way to turn them off or change them`,
      selector: 'document', html: '',
    })];
  });
}

export const probes = [
  { name: 'widget scan and new windows', phase: 'look', run: look },
  // Each of these opens its own fresh copy, and only when the scan found something for it to
  // try. They never touch the page they are given.
  { name: 'widget states', phase: 'operate', run: operateWidgets },
  { name: 'skip link', phase: 'operate', run: useSkipLink },
  { name: 'change on input', phase: 'operate', run: changeChoices },
  { name: 'content on hover or focus', phase: 'operate', run: hoverContent },
  { name: 'character key shortcuts', phase: 'operate', run: pressLetters },
];

export const rules = {
  'disclosure-state': {
    title: 'Button opens content but does not say it is open', criteria: ['4.1.2'], kinds: ['failure', 'likely'],
    covers: 'Buttons that control another element are clicked; if that element appears or disappears and aria-expanded does not change (or is missing), it is reported.',
    why: 'A screen reader announces "collapsed" or "expanded" from aria-expanded. When it is wrong or missing, blind users cannot tell whether the section they just opened is open.',
  },
  'toggle-state': {
    title: 'Switch or checkbox changes but does not say so', criteria: ['4.1.2'], kinds: ['failure'],
    covers: 'Custom checkboxes and switches are clicked and screenshotted; if they look different afterwards but aria-checked has not changed, it is reported.',
    why: 'Screen reader users hear "not checked" while the screen shows checked, so they cannot tell what they turned on or off.',
  },
  'tab-state': {
    title: 'Tab changes but aria-selected does not move', criteria: ['4.1.2'], kinds: ['failure'],
    covers: 'Another tab in each tab list is clicked; if what is shown changes but aria-selected stays where it was, it is reported.',
    why: 'Screen reader users are told which tab is selected from aria-selected. If it does not follow the click, they hear the wrong tab name for what is on screen.',
  },
  'widget-arrow-keys': {
    title: 'Arrow keys do not move through a tab list or menu', criteria: ['2.1.1', '2.1.3'], kinds: ['failure', 'advice'],
    covers: 'Focus is put on a tab or menu item and the arrow keys are pressed; if focus does not move, it fails when the other items are out of the Tab order, and is a note otherwise.',
    why: 'Keyboard and screen reader users move through tabs and menus with the arrow keys. When those items are also left out of the Tab order, there is no other way to reach them.',
  },
  'dialog-escape': {
    title: 'Dialog does not close with Escape', criteria: ['2.1.1'], kinds: ['advice'],
    covers: 'Buttons that open a dialog are clicked, then Escape is pressed; a dialog that stays open is noted.',
    why: 'Escape is the key keyboard users reach for to close a dialog. Without it they have to find the close button, which may be far down a long dialog.',
  },
  'dialog-focus-return': {
    title: 'Focus is lost when a dialog closes', criteria: ['2.4.3'], kinds: ['likely'],
    covers: 'A dialog that took focus is opened and closed again; if focus does not come back to the button that opened it, it is flagged.',
    why: 'When focus falls back to the top of the page, keyboard and screen reader users have to find their place again from the start.',
  },
  'skip-link-broken': {
    title: 'Skip link does not skip', criteria: ['2.4.1'], kinds: ['failure', 'likely'],
    covers: 'The skip link among the first Tab stops is pressed with Enter, then Tab; it fails if its target does not exist or focus comes back before the target.',
    why: 'Keyboard users press the skip link to get past the menu on every page. One that goes nowhere makes them Tab through the whole menu each time.',
  },
  'change-on-input': {
    title: 'Choosing an option changes the page by itself', criteria: ['3.2.2'], kinds: ['likely'],
    covers: 'Dropdowns, radio buttons and checkboxes outside login and payment forms are changed in a fresh copy; if that loads a page, submits the form or opens a window, it is flagged. Every page load and form submission is stopped before it reaches the server.',
    why: 'Keyboard users move through a dropdown with the arrow keys, which changes it at every step. If each change loads a new page, they never get past the first option. It is fine if the page says beforehand that this will happen.',
  },
  'hover-content-dismiss': {
    title: 'Popup text cannot be dismissed with Escape', criteria: ['1.4.13'], kinds: ['failure'],
    covers: 'Tooltips and descriptions that appear on hover or focus and cover other content are tested with Escape, without moving the pointer.',
    why: 'People using screen magnification see a small part of the screen. A tooltip they cannot dismiss can sit over exactly what they need to read.',
  },
  'hover-content-hoverable': {
    title: 'Popup text vanishes when the pointer moves onto it', criteria: ['1.4.13'], kinds: ['failure'],
    covers: 'Content that appears on hover is checked again after the pointer moves from the trigger onto it.',
    why: 'People who magnify the screen have to move the pointer to read a tooltip. If it disappears when they do, they can never read it.',
  },
  'hover-content-persistent': {
    title: 'Popup text disappears by itself', criteria: ['1.4.13'], kinds: ['failure'],
    covers: 'Content that appears on hover or focus is checked again after a second and a half with the pointer or focus still on the trigger.',
    why: 'People who read slowly, or use magnification, need content to stay until they move away from it.',
  },
  'character-shortcut': {
    title: 'Single-key shortcut', criteria: ['2.1.4'], kinds: ['likely'],
    covers: 'On pages with key handlers on the document, ten letter and punctuation keys are pressed one at a time in a fresh copy with focus on the page; any that load a page, move focus, scroll, open something or change the page are flagged.',
    why: 'Speech input users speak words that the computer types as letters, and keyboard users with tremors press keys by accident. Shortcuts on a single key fire when they did not mean them.',
  },
  'new-window-unannounced': {
    title: 'Link opens a new window without saying so', criteria: ['3.2.5'], kinds: ['likely'],
    covers: 'Links with a target that opens a new window or tab, whose text, label and icons do not mention it.',
    why: 'A new window takes screen reader and magnifier users somewhere unexpected, and the Back button no longer works. Saying "opens in a new tab" lets them decide.',
  },
  'window-opened-unasked': {
    title: 'Page opens a window by itself', criteria: ['3.2.1', '3.2.5'], kinds: ['failure'],
    covers: 'Windows opened by a script while the page loaded, with no click or key press behind them.',
    why: 'A window that opens by itself moves screen reader users away from the page they chose, often without them knowing.',
  },
};

// Built after the rules exist; used by the checks above at run time.
const issue = issuer(rules);
