// Checks that operate the page the way a keyboard user would: things that can be clicked
// but not reached, menus that only open on hover, and buttons that only answer the mouse.
// These change the page's state, so they run after everything that only looks.

const MAX_MENUS = 8;
const MAX_DISCLOSURES = 8;
const PAUSE = 250;

// 2.1.1 Keyboard. Two strengths of evidence:
//   failure: the element says it is a control (role, onclick) and cannot take keyboard focus
//   note:    the element only looks clickable (pointer cursor); a person should confirm
export async function checkUnreachable(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
    const FOCUSABLE = 'a[href], button, input, select, textarea, summary, iframe, audio[controls], video[controls], [contenteditable=""], [contenteditable=true], [tabindex]:not([tabindex^="-"])';
    // Inside these, one element holds focus and arrow keys move between the rest.
    const COMPOSITE = '[role=toolbar], [role=menu], [role=menubar], [role=tablist], [role=listbox], [role=grid], [role=tree], [role=radiogroup], [role=combobox]';
    const skip = (el) =>
      !shown(el) || el.matches(FOCUSABLE) || el.closest(FOCUSABLE) || el.querySelector(FOCUSABLE) ||
      el.closest('label, [aria-hidden=true], [inert], [aria-disabled=true]') || el.closest(COMPOSITE) ||
      el === document.body || el === document.documentElement;
    const text = (el) => (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
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
    const issue = (el, kind, message) => ({
      id: kind === 'failure' ? 'keyboard-unreachable' : 'looks-clickable', source: 'accessready', kind, wcag: ['2.1.1'],
      impact: kind === 'failure' ? 'critical' : 'moderate',
      title: kind === 'failure' ? 'Control cannot be reached with the keyboard' : 'Looks clickable but cannot be reached with the keyboard',
      message, selector: selector(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    });

    const declared = new Set();
    for (const el of document.querySelectorAll('[onclick], [role=button], [role=link], [role=checkbox], [role=switch]')) {
      if (skip(el)) continue;
      declared.add(el);
      const why = el.hasAttribute('onclick') && !el.getAttribute('role') ? 'has a click handler' : `has role="${el.getAttribute('role')}"`;
      out.push(issue(el, 'failure', `${el.tagName.toLowerCase()} "${text(el)}" ${why} but Tab never reaches it, so it only works with a mouse`));
    }
    for (const el of document.body.querySelectorAll('*')) {
      if (getComputedStyle(el).cursor !== 'pointer') continue;
      // cursor is inherited: report the element that sets it, not everything inside.
      if (el.parentElement && getComputedStyle(el.parentElement).cursor === 'pointer') continue;
      if (declared.has(el) || skip(el)) continue;
      if (!text(el) && !el.querySelector('img, svg') && !/^(IMG|SVG)$/i.test(el.tagName)) continue;
      out.push(issue(el, 'advice', `${el.tagName.toLowerCase()} "${text(el)}" shows a pointer cursor but Tab never reaches it; if clicking it does something, keyboard users cannot do it`));
    }
    return out;
  });
}

// Marks submenus in navigation that are hidden until something reveals them, and returns
// how many there are. Each gets data-accessready-menu="<n>" on the item that owns it.
function markHiddenMenus() {
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  let n = 0;
  for (const item of document.querySelectorAll('nav li, header li, [role=navigation] li, [role=menubar] > *')) {
    if (!shown(item) || item.parentElement.closest('[data-accessready-menu]')) continue;
    const links = [...item.querySelectorAll('a[href]')];
    if (links.length < 2 || !links.slice(1).some((a) => !shown(a))) continue;
    item.setAttribute('data-accessready-menu', String(n++));
  }
  return n;
}

function menuState(index) {
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const item = document.querySelector(`[data-accessready-menu="${index}"]`);
  if (!item) return null;
  const links = [...item.querySelectorAll('a[href]')];
  const trigger = item.querySelector('a[href], button, [tabindex]:not([tabindex^="-"])');
  return {
    visible: links.filter(shown).length,
    total: links.length,
    label: ((trigger || item).getAttribute('aria-label') || (trigger || item).firstChild?.textContent || (trigger || item).textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    triggerIsButton: !!trigger && (trigger.tagName === 'BUTTON' || trigger.getAttribute('role') === 'button'),
    hasTrigger: !!trigger,
    html: item.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
  };
}

// 2.1.1 Keyboard: a submenu that opens when the mouse hovers but not when the keyboard
// focuses it leaves every link inside it out of reach.
export async function checkHoverMenus(page) {
  const issues = [];
  const count = Math.min(await page.evaluate(markHiddenMenus), MAX_MENUS);
  for (let i = 0; i < count; i++) {
    const item = page.locator(`[data-accessready-menu="${i}"]`);
    const before = await page.evaluate(menuState, i);
    if (!before) continue;
    if (!(await item.hover({ timeout: 2000 }).then(() => true, () => false))) continue;
    await page.waitForTimeout(PAUSE);
    const hovered = await page.evaluate(menuState, i);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(PAUSE);
    if (!hovered || hovered.visible <= before.visible) continue; // hover reveals nothing: not a hover menu

    // Does the keyboard get the same result? Focus the trigger, then try the keys that open
    // a menu button, then focus a link inside in case the menu opens on :focus-within.
    let reached = false;
    const more = async () => ((await page.evaluate(menuState, i))?.visible ?? 0) > before.visible;
    if (before.hasTrigger) {
      await page.evaluate((n) => document.querySelector(`[data-accessready-menu="${n}"]`).querySelector('a[href], button, [tabindex]:not([tabindex^="-"])').focus(), i);
      await page.waitForTimeout(PAUSE);
      reached = await more();
      if (!reached && before.triggerIsButton) {
        for (const key of ['Enter', 'Space', 'ArrowDown']) {
          await page.keyboard.press(key);
          await page.waitForTimeout(PAUSE);
          if ((reached = await more())) { await page.keyboard.press('Escape'); break; }
        }
      }
    }
    if (!reached) {
      await page.evaluate((n) => document.querySelector(`[data-accessready-menu="${n}"]`).querySelectorAll('a[href]')[1]?.focus(), i);
      await page.waitForTimeout(PAUSE);
      reached = await more();
    }
    await page.evaluate(() => document.activeElement?.blur?.());
    if (reached) continue;

    const hiddenLinks = hovered.visible - before.visible;
    issues.push({
      id: 'hover-only-menu', source: 'accessready', kind: 'failure', wcag: ['2.1.1'], impact: 'critical',
      title: 'Menu opens on mouse hover only',
      message: `the menu under "${before.label}" opens when the mouse hovers over it but not from the keyboard, so ${hiddenLinks} link${hiddenLinks === 1 ? '' : 's'} cannot be reached without a mouse`,
      selector: `nav item "${before.label}"`, html: before.html,
    });
  }
  await page.evaluate(() => document.querySelectorAll('[data-accessready-menu]').forEach((el) => el.removeAttribute('data-accessready-menu')));
  return issues;
}

function markDisclosures() {
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
  let n = 0;
  // Buttons only: pressing Enter on a link or a submit button would leave the page.
  for (const el of document.querySelectorAll('button[aria-expanded="false"], [role=button][aria-expanded="false"]')) {
    if (!shown(el) || el.disabled || el.getAttribute('aria-disabled') === 'true' || el.type === 'submit') continue;
    el.setAttribute('data-accessready-toggle', String(n++));
  }
  return n;
}

function toggleState(index) {
  const el = document.querySelector(`[data-accessready-toggle="${index}"]`);
  if (!el) return null;
  const shown = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; };
  const dialog = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].find(shown) || null;
  return {
    expanded: el.getAttribute('aria-expanded') === 'true',
    label: (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    dialogOpen: !!dialog,
    focusInDialog: !!dialog && dialog.contains(document.activeElement),
  };
}

// 2.1.1 Keyboard: a button that announces it opens something (aria-expanded) has to open it
// from the keyboard, not only on click. Also notes a dialog that opens without taking focus.
export async function checkDisclosures(page) {
  const issues = [];
  const notes = [];
  const startUrl = page.url();
  const count = Math.min(await page.evaluate(markDisclosures), MAX_DISCLOSURES);
  for (let i = 0; i < count; i++) {
    const el = page.locator(`[data-accessready-toggle="${i}"]`);
    const state = () => page.evaluate(toggleState, i);
    const before = await state();
    if (!before || before.expanded) continue;
    const where = { selector: `button "${before.label}"`, html: before.html };

    if (!(await el.focus({ timeout: 2000 }).then(() => true, () => false))) continue;
    let opened = false;
    for (const key of ['Enter', 'Space']) {
      await page.keyboard.press(key);
      await page.waitForTimeout(PAUSE);
      if (page.url() !== startUrl) break;
      if ((opened = (await state())?.expanded ?? false)) break;
    }
    if (page.url() !== startUrl) { notes.push('a button navigated away while being tested; the remaining buttons on this page were not operated'); break; }

    if (!opened) {
      // Only a failure if the mouse can do what the keyboard could not.
      if (!(await el.click({ timeout: 2000 }).then(() => true, () => false))) continue;
      await page.waitForTimeout(PAUSE);
      if ((await state())?.expanded) {
        issues.push({
          id: 'keyboard-activation', source: 'accessready', kind: 'failure', wcag: ['2.1.1'], impact: 'critical',
          title: 'Button works with the mouse but not the keyboard',
          message: `"${before.label}" opens when clicked but not when Enter or Space is pressed`,
          ...where,
        });
        await el.click({ timeout: 2000 }).catch(() => {});
        await page.waitForTimeout(PAUSE);
      }
      continue;
    }

    const open = await state();
    if (open.dialogOpen && !before.dialogOpen && !open.focusInDialog) {
      issues.push({
        id: 'dialog-focus', source: 'accessready', kind: 'advice', wcag: ['2.4.3'], impact: 'moderate',
        title: 'Dialog opens without taking keyboard focus',
        message: `"${before.label}" opens a dialog but keyboard focus stays on the page behind it`,
        ...where,
      });
    }
    // Put the page back: Escape first, then the button itself.
    await page.keyboard.press('Escape');
    await page.waitForTimeout(PAUSE);
    if ((await state())?.expanded) {
      await el.focus({ timeout: 2000 }).catch(() => {});
      await page.keyboard.press('Enter');
      await page.waitForTimeout(PAUSE);
    }
    if ((await state())?.expanded) { notes.push(`"${before.label}" could not be closed again; the remaining buttons on this page were not operated`); break; }
  }
  await page.evaluate(() => document.querySelectorAll('[data-accessready-toggle]').forEach((el) => el.removeAttribute('data-accessready-toggle'))).catch(() => {});
  return { issues, notes };
}
