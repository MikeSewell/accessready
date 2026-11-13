// Walks the page with the Tab key, the way a keyboard user does, and at every stop checks:
//   2.4.7  Focus Visible: does anything on screen change when the element takes focus?
//   2.4.11 Focus Not Obscured (Minimum): is the focused element entirely hidden behind
//          something else (sticky header, cookie banner, chat bubble) or off screen?
//   2.4.12 Focus Not Obscured (Enhanced): is any part of it covered?
//   1.4.11 and 2.4.13: does the indicator reach 3:1 against how the same pixels looked
//          before, and (AAA) is that part as large as a 2px outline around the element?
//   3.2.1  On Focus: does taking focus load a page, submit a form, open a window or a dialog?
// and over the whole walk:
//   2.4.3  Focus Order: does Tab jump against the reading order?
// Focus visibility is judged from pixels, not CSS: the area around the element is
// screenshotted focused and blurred, and the two images are compared. That catches rings
// drawn on a wrapper, with :focus-within or with a pseudo-element, and it does not pass a
// style change that draws nothing.
import { PNG } from 'pngjs';
import { guard, issuer, startWatch, readWatch } from './observe.mjs';

const RING_MARGIN = 8; // px around the element where a focus ring may be drawn
const MIN_CHANGED_PIXELS = 8;
const CHANNEL_TOLERANCE = 12; // ignore anti-aliasing noise
const INNER_STOPS = 8; // Tab presses one element may absorb (a date field has up to six parts)
const MAX_FRAME_STOPS = 60; // consecutive Tab presses spent inside one iframe before giving up
const INDICATOR_RATIO = 3; // 1.4.11 and 2.4.13: the indicator's change of contrast
const AREA_SLACK = 0.9; // anti-aliasing on a ring exactly 2px thick loses a few pixels
const MAX_RELOOKS = 10; // second looks spent confirming weak indicators, per page
const MAX_SUSPECTS = 3; // stops re-tested in a fresh copy for 3.2.1, per page
const MAX_ORDER_FINDINGS = 3;

// Runs in the page. Describes the focused element and assigns it a stable number so the
// walk can tell when focus has come back round to somewhere it has already been.
function describeFocus() {
  const deepActive = () => {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  };
  const el = deepActive();
  if (!el || el === document.body || el === document.documentElement) return { kind: 'none' };
  if (el.tagName === 'IFRAME' || el.tagName === 'FRAME') return { kind: 'frame' };

  const state = (window.__accessready ||= { ids: new WeakMap(), next: 1 });
  if (!state.ids.has(el)) state.ids.set(el, state.next++);
  state.current = el;

  const parentOf = (n) => n.parentElement || (n.getRootNode() instanceof ShadowRoot ? n.getRootNode().host : null);
  const composedContains = (outer, inner) => { for (let n = inner; n; n = parentOf(n)) if (n === outer) return true; return false; };
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

  // A visually hidden control (custom checkbox, radio, file input) shows focus on its label
  // or wrapper, so that is the box to look at.
  const cs = getComputedStyle(el);
  const own = el.getBoundingClientRect();
  const hiddenControl = +cs.opacity === 0 || own.width <= 1 || own.height <= 1 || cs.clipPath === 'inset(50%)' || cs.clip === 'rect(0px, 0px, 0px, 0px)';
  const box = hiddenControl ? (el.closest('label') || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.parentElement || el) : el;
  const r = box.getBoundingClientRect();

  // Sample a 3x3 grid. The criterion fails only when the element is entirely hidden, so one
  // visible point is enough to pass.
  let onScreen = 0, visible = 0, cover = null;
  for (const fx of [0.1, 0.5, 0.9]) for (const fy of [0.15, 0.5, 0.85]) {
    const x = r.left + r.width * fx, y = r.top + r.height * fy;
    if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
    onScreen++;
    let top = document.elementFromPoint(x, y);
    while (top && top.shadowRoot && top.shadowRoot.elementFromPoint(x, y) && top.shadowRoot.elementFromPoint(x, y) !== top) top = top.shadowRoot.elementFromPoint(x, y);
    if (top && (composedContains(box, top) || composedContains(top, box))) visible++;
    else if (top && !cover) cover = top;
  }
  let coveredBy = '', coveredByModal = false, coverPinned = false;
  if (cover) {
    // Name the positioned ancestor doing the covering, which is the thing a developer has to fix.
    let c = cover;
    for (let n = cover; n && n !== document.body; n = parentOf(n)) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') { c = n; coverPinned = true; break; } }
    coveredBy = `${selector(c)} (position: ${getComputedStyle(c).position})`;
    const MODAL = 'dialog[open], [role=dialog], [role=alertdialog], [aria-modal=true]';
    coveredByModal = !!(cover.closest(MODAL) || c.matches(MODAL) || c.querySelector(MODAL));
  }

  const textEntry = el.isContentEditable || el.tagName === 'TEXTAREA' ||
    (el.tagName === 'INPUT' && !/^(button|submit|reset|checkbox|radio|range|color|file|image)$/.test(el.type));
  const label = (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.value || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  return {
    kind: 'element',
    id: state.ids.get(el),
    tag: el.tagName.toLowerCase(),
    label,
    selector: selector(el),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    rect: { x: r.left, y: r.top, width: r.width, height: r.height },
    viewport: { width: innerWidth, height: innerHeight },
    onScreen, visible, coveredBy, coveredByModal, coverPinned, textEntry,
    inModal: !!el.closest('dialog[open], [aria-modal=true]'),
    // For the indicator and order checks. The browser's own ring (outline-style: auto) is
    // exempt from 2.4.13, and a link that wraps onto two lines has no single box to measure.
    outlineAuto: cs.outlineStyle === 'auto',
    hiddenControl,
    fragments: el.getClientRects().length,
    docY: r.top + scrollY,
    pinned: (() => { for (let n = el; n && n.nodeType === 1; n = parentOf(n)) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; })(),
    tabindex: parseInt(el.getAttribute('tabindex'), 10) || 0,
    invisible: (() => { let o = 1; for (let n = box; n && n.nodeType === 1; n = parentOf(n)) o *= +getComputedStyle(n).opacity; return o < 0.05; })(),
  };
}

function settle() {
  // Let smooth scrolling and CSS transitions finish before anything is measured. A skip link
  // that slides in on focus is off screen for its first 200ms.
  const scrolling = new Promise((done) => {
    let last = -1, same = 0;
    const tick = () => {
      const y = scrollY;
      if (y === last && ++same > 3) return done();
      if (y !== last) same = 0;
      last = y;
      requestAnimationFrame(tick);
    };
    tick();
    setTimeout(done, 2500);
  });
  const transitions = Promise.race([
    Promise.allSettled(document.getAnimations().filter((a) => a instanceof CSSTransition).map((a) => a.finished)),
    new Promise((done) => setTimeout(done, 1000)),
  ]);
  return Promise.all([scrolling, transitions]).then(() => {});
}

// Modal dialogs on screen right now. One that opens partway through the walk (a timed
// newsletter popup) takes focus and hides the rest of the page from the walk.
function openDialogs() {
  return [...document.querySelectorAll('dialog[open], [role=dialog][aria-modal=true], [role=alertdialog][aria-modal=true]')]
    .filter((d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; })
    .map((d) => (d.getAttribute('aria-label') || document.getElementById(d.getAttribute('aria-labelledby') || '')?.textContent || d.id || 'dialog').trim().slice(0, 60));
}

// Runs in the page before each Tab press: forget which element took focus last time and
// remember how many dialogs and script-opened windows there are, so the step can tell what
// taking focus did. The listener is added once per page. It listens for "focus" in the
// capture phase on window, which runs before the element's own focus handlers, so an element
// whose handler moves focus on (into a dialog it opens) is still the one recorded.
function beginStep() {
  const s = (window.__accessready_step ||= {});
  if (!s.listening) {
    s.listening = true;
    window.addEventListener('focus', (e) => { if (!s.first && e.target !== window) s.first = e.composedPath()[0]; }, true);
  }
  const shown = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; };
  s.first = null;
  s.dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].filter(shown);
  s.opened = window.__accessready_log ? window.__accessready_log.opened.length : 0;
}

// Runs in the page after the Tab press: the element Tab moved focus to, and what appeared.
function endStep() {
  const s = window.__accessready_step;
  const shown = (d) => { const r = d.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(d).visibility !== 'hidden'; };
  const dialogs = [...document.querySelectorAll('dialog[open], [role=dialog], [role=alertdialog]')].filter(shown).filter((d) => !s.dialogs.includes(d));
  const el = s.first;
  if (!el || el.nodeType !== 1) return null;
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
  return {
    selector: selector(el),
    // A selector into a shadow root cannot be used to find the element again.
    inShadow: el.getRootNode() instanceof ShadowRoot,
    what: (() => {
      const label = (el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent || el.value || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      return `${el.tagName.toLowerCase()}${label ? ` "${label}"` : ''}`;
    })(),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    dialogs: dialogs.length,
    opened: (window.__accessready_log ? window.__accessready_log.opened.length : 0) - s.opened,
  };
}

const luminance = (r, g, b) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

// Compares the focused and blurred pictures pixel by pixel. `changed` counts pixels that
// differ at all (2.4.7); `strong` those whose color changed by at least 3:1 (1.4.11, 2.4.13);
// `best` the largest change seen. `scale` is device pixels per CSS pixel.
function comparePixels(a, b, clip) {
  const one = PNG.sync.read(a), two = PNG.sync.read(b);
  if (one.width !== two.width || one.height !== two.height) return { changed: Infinity, strong: Infinity, best: Infinity, scale: 1 };
  let changed = 0, strong = 0, best = 1;
  for (let i = 0; i < one.data.length; i += 4) {
    if (Math.abs(one.data[i] - two.data[i]) > CHANNEL_TOLERANCE ||
        Math.abs(one.data[i + 1] - two.data[i + 1]) > CHANNEL_TOLERANCE ||
        Math.abs(one.data[i + 2] - two.data[i + 2]) > CHANNEL_TOLERANCE) {
      changed++;
      const l1 = luminance(one.data[i], one.data[i + 1], one.data[i + 2]), l2 = luminance(two.data[i], two.data[i + 1], two.data[i + 2]);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      if (ratio >= INDICATOR_RATIO) strong++;
      if (ratio > best) best = ratio;
    }
  }
  return { changed, strong, best, scale: one.width / clip.width };
}

function clipFor({ rect, viewport }) {
  const x = Math.max(0, Math.floor(rect.x - RING_MARGIN));
  const y = Math.max(0, Math.floor(rect.y - RING_MARGIN));
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + RING_MARGIN));
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + RING_MARGIN));
  if (right - x < 1 || bottom - y < 1) return null;
  // `full` when nothing around the element was cut off by the window's edge, so the area
  // of the indicator can be measured.
  const full = rect.x - RING_MARGIN >= 0 && rect.y - RING_MARGIN >= 0 &&
    rect.x + rect.width + RING_MARGIN <= viewport.width && rect.y + rect.height + RING_MARGIN <= viewport.height;
  return { x, y, width: right - x, height: bottom - y, full };
}

// 1.4.11 and 2.4.13 for one Tab stop, from the pictures already taken for 2.4.7. Returns
// null when the indicator cannot be judged: none at all (that is 2.4.7), the browser's own
// ring, a box cut off by the window, a hidden control drawn by its label, or a wrapped link.
function judgeIndicator({ f, pixels, clip }) {
  if (!pixels || f.kind !== 'element' || f.visible === 0 || pixels.changed < MIN_CHANGED_PIXELS || pixels.changed === Infinity) return null;
  if (f.outlineAuto || !clip?.full || f.hiddenControl || f.fragments > 1) return null;
  const area = pixels.strong / (pixels.scale * pixels.scale);
  const need = 4 * (f.rect.width + f.rect.height); // a 2px thick perimeter
  return {
    faint: pixels.strong < MIN_CHANGED_PIXELS,
    small: area < need * AREA_SLACK,
    area: Math.round(area), need: Math.round(need), best: Math.round(pixels.best * 100) / 100,
  };
}

// 2.4.3: Tab order read against the page. Two patterns a person would call wrong: elements
// pulled ahead of everything by a positive tabindex, and a single stop far up (or down) the
// page between two neighbours that sit close together, as if one element were out of place.
// Fixed and sticky elements, dialogs and skip links are left out, because where they sit
// does not say where they belong.
function judgeOrder(stops, viewportHeight) {
  const out = [];
  const name = (s) => s.what;
  const positive = stops.filter((s) => s.tabindex > 0);
  if (positive.length) {
    const sequence = stops.slice(0, Math.min(stops.length, positive.length + 2)).map(name).join(', then ');
    out.push(issue('focus-order', {
      message: `${positive.length} element${positive.length === 1 ? ' has' : 's have'} a positive tabindex, which moves ${positive.length === 1 ? 'it' : 'them'} ahead of everything else: Tab visits ${sequence}`,
      selector: positive[0].selector, html: positive[0].html,
    }));
  }
  const flow = stops.filter((s) => !s.pinned && !s.inModal && s.visible > 0 && s.tabindex <= 0 && !/^(skip|jump)\b/i.test(s.label));
  const jump = Math.max(400, viewportHeight * 0.5);
  for (let i = 1; i < flow.length - 1 && out.length < MAX_ORDER_FINDINGS; i++) {
    const [a, b, c] = [flow[i - 1], flow[i], flow[i + 1]];
    const above = Math.min(a.docY, c.docY) - (b.docY + b.height);
    const below = b.docY - Math.max(a.docY + a.height, c.docY + c.height);
    if (Math.max(above, below) <= jump || Math.abs(a.docY - c.docY) >= jump / 2) continue;
    out.push(issue('focus-order', {
      message: `Tab goes from ${name(a)} to ${name(b)}, ${Math.round(Math.max(above, below))}px further ${above > below ? 'up' : 'down'} the page, then back to ${name(c)}`,
      selector: b.selector, html: b.html,
    }));
  }
  return out;
}

// 3.2.1: the walk saw something happen when an element took focus. Before calling it a
// failure, a fresh copy of the page is opened and left alone for a second (a timed popup or
// redirect shows itself then and is not this element's doing), and then only that element
// is focused. What happens then is the finding.
async function confirmOnFocus(fresh, s) {
  if (!fresh || s.inShadow) return { unconfirmed: true };
  const page = await fresh();
  try {
    const g = await guard(page, { writes: true });
    await page.evaluate(startWatch);
    await page.waitForTimeout(1000);
    const idle = await page.evaluate(readWatch);
    // Only page loads, windows and dialogs count as acting by itself. A refused analytics
    // beacon in that second is not a change of context and must not hide the finding.
    if (g.navigations().length || g.popups.length || idle.opened || idle.dialogs.length) return null;
    // element.focus() in the page, not locator.focus(): Playwright's focus puts focus back on
    // the element when a handler has moved it on, which would hide a dialog taking focus.
    if (!(await page.evaluate((sel) => { const el = document.querySelector(sel); if (!el) return false; el.focus(); return true; }, s.selector).catch(() => false))) return { unconfirmed: true };
    await page.waitForTimeout(700);
    const after = await page.evaluate(readWatch);
    await g.stop();
    return { navigations: g.navigations(), windows: Math.max(g.popups.length, after.opened), dialogs: after.dialogs, focusInDialog: after.focusInDialog, modal: after.modal };
  } finally {
    await page.context().close().catch(() => {});
  }
}

function onFocusIssues(s, seen) {
  const where = { selector: s.selector, html: s.html };
  if (seen.navigations?.length) {
    const n = seen.navigations[0];
    return [issue('focus-changes-context', {
      message: n.method === 'GET'
        ? `${s.what} loads ${n.url} as soon as it takes keyboard focus, before the user has chosen it`
        : `${s.what} submits a form (${n.method} ${n.url}) as soon as it takes keyboard focus`,
      ...where,
    })];
  }
  if (seen.windows) return [issue('focus-changes-context', { message: `${s.what} opens a new window as soon as it takes keyboard focus`, ...where })];
  if (seen.dialogs?.length && (seen.focusInDialog || seen.modal)) {
    return [issue('focus-changes-context', {
      kind: seen.focusInDialog ? 'failure' : 'likely',
      message: `${s.what} opens "${seen.dialogs[0]}" as soon as it takes keyboard focus${seen.focusInDialog ? ' and moves focus into it' : ''}`,
      ...where,
    })];
  }
  return [];
}

// `fresh` opens a new copy of the page; with it, what the walk sees happen on focus is
// confirmed before it is reported (3.2.1). `level` decides which second looks are worth
// their time.
export async function walkKeyboard(page, { maxStops = 150, level = 'AA', fresh = null } = {}) {
  const issues = [];
  const seen = new Set();
  let lastId = null, sameStops = 0;
  let stops = 0, emptyStops = 0, frameStops = 0, framesSkipped = 0, capped = false;
  const order = [];
  const suspects = new Map();
  let relooks = 0;

  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const dialogsAtStart = await page.evaluate(openDialogs);
  // Taking focus must never take the walk off the page. A page load that focus sets off is
  // answered with "no content", so the page stays, and the attempt is the 3.2.1 evidence.
  const nav = await guard(page).catch(() => null);

  // One look at whatever has focus: where it is, whether it can be seen, and how the pixels
  // around it change between focused and blurred.
  const inspect = async () => {
    await page.evaluate(settle);
    const f = await page.evaluate(describeFocus);
    if (f.kind !== 'element' || f.visible === 0) return { f, changed: null };
    const clip = clipFor(f);
    if (!clip) return { f, changed: null };
    const shot = () => page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
    const focused = await shot();
    await page.evaluate(() => window.__accessready.current.blur());
    const blurred = await shot();
    await page.evaluate(() => window.__accessready.current.focus({ preventScroll: true }));
    const pixels = comparePixels(focused, blurred, clip);
    return { f, changed: pixels.changed, pixels, clip };
  };
  // Is a weak indicator worth a second look? 1.4.11 always; the 2.4.13 size only at AAA.
  const weak = (look) => {
    const v = judgeIndicator(look);
    return !!v && (v.faint || (level === 'AAA' && v.small));
  };
  // 2.1.2 No Keyboard Trap, the other direction.
  const stuckBackwards = async (id) => {
    for (let i = 0; i < INNER_STOPS; i++) {
      await page.keyboard.press('Shift+Tab');
      await page.waitForTimeout(60);
      const now = await page.evaluate(describeFocus);
      if (now.kind !== 'element' || now.id !== id) return false;
    }
    return true;
  };
  const failing = ({ f, changed }) => f.kind === 'element' && (f.visible === 0 || (changed !== null && changed < MIN_CHANGED_PIXELS));

  // 3.2.1: did taking focus load a page, open a window or put up a dialog? Read at the end of
  // each stop, after the pictures, so a handler that acts a moment late is still caught.
  // Confirmed in a fresh copy after the walk.
  let pending = null;
  const settleStep = async () => {
    if (!pending) return;
    const { navsBefore, popupsBefore } = pending;
    pending = null;
    const step = await page.evaluate(endStep).catch(() => null);
    const navigations = nav ? nav.attempts.slice(navsBefore).filter((a) => a.navigation) : [];
    const windows = Math.max(step?.opened || 0, nav ? nav.popups.length - popupsBefore : 0);
    if (step && (navigations.length || windows || step.dialogs) && !suspects.has(step.selector)) {
      suspects.set(step.selector, { ...step, navigations, windows });
    }
  };

  for (;;) {
    await settleStep();
    if (stops >= maxStops) { capped = true; break; }
    await page.evaluate(beginStep);
    pending = { navsBefore: nav ? nav.attempts.length : 0, popupsBefore: nav ? nav.popups.length : 0 };
    await page.keyboard.press('Tab');
    await page.waitForTimeout(60);

    // Still on the same element? Then do not blur and refocus it to take pictures: that
    // would send a date field back to its first part and the walk would never get out.
    const quick = await page.evaluate(describeFocus);
    if (quick.kind === 'element' && quick.id === lastId) {
      // Date and time fields have several parts inside one element, so keep pressing. Past
      // that, and if Shift+Tab cannot leave either, focus is stuck. A modal dialog is
      // allowed to hold focus.
      if (++sameStops <= INNER_STOPS) continue;
      if (!quick.inModal && await stuckBackwards(quick.id)) {
        issues.push({
          id: 'keyboard-trap', source: 'accessready', kind: 'failure', wcag: ['2.1.2'], impact: 'critical',
          title: 'Keyboard focus gets stuck',
          message: `${quick.tag}${quick.label ? ` "${quick.label}"` : ''} holds keyboard focus: neither Tab nor Shift+Tab moves off it, so everything after it is out of reach`,
          selector: quick.selector, html: quick.html,
        });
      }
      break;
    }
    sameStops = 0;

    let look = await inspect();
    if (failing(look) || (weak(look) && relooks++ < MAX_RELOOKS)) {
      // Look twice before reporting. Late-loading styles or something still animating can
      // make one reading wrong; a real problem is still there a moment later.
      await page.waitForTimeout(300);
      const again = await inspect();
      if (again.f.kind === 'element' && again.f.id === look.f.id) look = again;
    }
    const { f, changed } = look;
    const indicator = judgeIndicator(look);

    if (f.kind === 'none') {
      // Focus is on nothing: either the walk has run off the end of the page, or it started
      // from a spot with nothing after it (a cookie banner that was just dismissed). One more
      // Tab wraps to the top; a second empty stop means there is nothing left to visit.
      if (emptyStops++) break;
      continue;
    }
    if (f.kind === 'frame') {
      // Focus is inside an embedded frame. Keep tabbing until it comes back out.
      if (frameStops === 0) framesSkipped++;
      if (++frameStops > MAX_FRAME_STOPS) break;
      continue;
    }
    frameStops = 0;
    if (seen.has(f.id)) break; // back where we started
    seen.add(f.id);
    lastId = f.id;
    stops++;

    const where = { selector: f.selector, html: f.html };
    const what = `${f.tag}${f.label ? ` "${f.label}"` : ''}`;
    order.push({ what, label: f.label, selector: f.selector, html: f.html, docY: f.docY, height: f.rect.height, pinned: f.pinned, inModal: f.inModal, visible: f.visible, tabindex: f.tabindex });

    if (f.visible === 0 && f.coveredByModal) {
      // A popup has opened over the page. Whether focus is behind it because the popup is
      // broken or because this walk was mid-step when it opened cannot be told apart, so
      // nothing is reported: the walk ends here and the caller notes the popup.
      stops--;
      break;
    }
    if (f.visible === 0) {
      issues.push({
        id: 'focus-not-obscured', source: 'accessready', kind: 'failure', wcag: ['2.4.11'], impact: 'serious',
        title: 'Focused element is hidden',
        message: f.onScreen === 0
          ? `${what} takes keyboard focus while off screen, so the user cannot see where they are`
          : `${what} takes keyboard focus while completely covered by ${f.coveredBy || 'another element'}`,
        ...where,
      });
    } else if (changed !== null && changed < MIN_CHANGED_PIXELS) {
      // WCAG counts the text cursor as a focus indicator, so a text field with nothing else
      // is weak but not a failure.
      issues.push(f.textEntry ? {
        id: 'focus-caret-only', source: 'accessready', kind: 'advice', wcag: ['2.4.7'], impact: 'moderate',
        title: 'Only the text cursor shows focus',
        message: `${what} shows no outline or other change when focused, only the text cursor`,
        ...where,
      } : {
        id: 'focus-visible', source: 'accessready', kind: 'failure', wcag: ['2.4.7'], impact: 'serious',
        title: 'No visible focus indicator',
        message: f.invisible
          ? `${what} takes keyboard focus while invisible (opacity 0), so the user cannot see where they are`
          : `${what} looks the same focused and unfocused, so a keyboard user cannot see where they are`,
        ...where,
      });
    }

    // 2.4.12: some of the element is covered. Behind a fixed or sticky bar that is certain;
    // anything else covering it (an overlapping sibling, a tooltip) is for a person to see.
    if (f.visible > 0 && f.visible < f.onScreen && f.coveredBy && !f.coveredByModal) {
      issues.push(issue('focus-partly-obscured', {
        kind: f.coverPinned ? 'failure' : 'likely',
        message: `${what} is partly covered by ${f.coveredBy} while it has keyboard focus`,
        ...where,
      }));
    }
    // 1.4.11 and 2.4.13: an indicator is there, but is it strong enough?
    if (indicator?.faint) {
      issues.push(issue('focus-indicator-contrast', {
        message: `the change when ${what} takes focus reaches only ${indicator.best}:1 against how the same pixels looked before; a focus indicator needs 3:1`,
        ...where,
      }));
    }
    if (indicator?.small) {
      issues.push(issue('focus-appearance', {
        message: `the part of ${what}'s focus indicator that changes by 3:1 covers ${indicator.area} square px, less than the ${indicator.need} square px of a 2px outline around it`,
        ...where,
      }));
    }
  }

  await settleStep();
  const dialogsOpened = (await page.evaluate(openDialogs)).filter((d) => !dialogsAtStart.includes(d));
  await nav?.stop();

  issues.push(...judgeOrder(order, (await page.evaluate(() => innerHeight).catch(() => 900))));

  // 3.2.1, confirmed one element at a time in a fresh copy of the page.
  const notes = [];
  for (const s of [...suspects.values()].slice(0, MAX_SUSPECTS)) {
    let seenThere;
    try { seenThere = await confirmOnFocus(fresh, s); } catch { seenThere = { unconfirmed: true }; }
    if (!seenThere) continue;
    if (seenThere.unconfirmed) {
      // Only the walk saw it. A page load or window right after focus is still strong
      // evidence; a dialog could have been on a timer.
      for (const i of onFocusIssues(s, { navigations: s.navigations, windows: s.windows })) issues.push({ ...i, kind: 'likely' });
      continue;
    }
    issues.push(...onFocusIssues(s, seenThere));
  }
  if (suspects.size > MAX_SUSPECTS) notes.push(`${suspects.size} elements did something on focus; the first ${MAX_SUSPECTS} were checked`);

  return { issues, stops, capped, framesSkipped, dialogsOpened, notes };
}

export const rules = {
  'focus-visible': {
    title: 'No visible focus indicator', criteria: ['2.4.7'], kinds: ['failure'],
    covers: 'Every Tab stop is screenshotted focused and unfocused; if nothing on screen changes, it fails.',
    why: 'People who use a keyboard instead of a mouse move through a page with the Tab key. If nothing on screen shows which link or button is selected, they cannot tell where they are.',
  },
  'focus-caret-only': {
    title: 'Only the text cursor shows focus', criteria: ['2.4.7'], kinds: ['advice'],
    covers: 'Text fields whose only sign of focus is the text cursor are noted.',
    why: 'A thin text cursor is easy to miss, especially for people with low vision. An outline around the field makes the selected field obvious.',
  },
  'focus-not-obscured': {
    title: 'Focused element is hidden', criteria: ['2.4.11'], kinds: ['failure'],
    covers: 'Every Tab stop is checked for being completely covered by something else or off screen.',
    why: 'When the selected link or button is covered by a sticky header, a cookie banner or a chat bubble, a keyboard user is working blind.',
  },
  'focus-partly-obscured': {
    title: 'Focused element is partly covered', criteria: ['2.4.12'], kinds: ['failure', 'likely'],
    covers: 'Every Tab stop is sampled at nine points; if some but not all are covered by other content, it is reported (a failure when the cover is a fixed or sticky element).',
    why: 'Even part of the selected control hidden under a sticky header or a chat button makes it harder for keyboard users with low vision to see where they are.',
  },
  'focus-indicator-contrast': {
    title: 'Focus indicator is too faint', criteria: ['1.4.11'], kinds: ['likely'],
    covers: 'The focused and unfocused screenshots are compared pixel by pixel; if no changed pixel reaches 3:1 against its unfocused color, the indicator is flagged. The browser default ring is not judged.',
    why: 'A pale focus highlight, such as a light tint behind a link, is invisible to many people with low vision or on a screen in sunlight, so keyboard users lose their place.',
  },
  'focus-appearance': {
    title: 'Focus indicator is smaller than a 2px outline', criteria: ['2.4.13'], kinds: ['failure'],
    covers: 'The pixels that change by at least 3:1 between focused and unfocused are measured; together they must cover at least the area of a 2px outline around the element. The browser default ring, wrapped links and hidden inputs are not judged.',
    why: 'A thin or partial indicator is easy to lose for people with low vision. A solid 2px outline, or something as large, can be found at a glance.',
  },
  'focus-order': {
    title: 'Tab order jumps around the page', criteria: ['2.4.3'], kinds: ['likely'],
    covers: 'The Tab sequence is compared with where each stop sits on the page: a positive tabindex that pulls elements ahead, or one stop far up or down the page between two neighbours, is flagged with the sequence.',
    why: 'Keyboard and screen reader users follow the Tab order to understand the page. When it jumps out of reading order they lose track of where they are and what comes next.',
  },
  'focus-changes-context': {
    title: 'Taking focus changes the page', criteria: ['3.2.1'], kinds: ['failure', 'likely'],
    covers: 'During the Tab walk, a stop that loads another page, submits a form, opens a window or opens a dialog is noted, then confirmed in a fresh copy by focusing only that element. Page loads are answered with no content, so nothing leaves the page.',
    why: 'Keyboard users move through a page by giving each control focus in turn. If focus alone sends them somewhere else, they cannot explore the page without being thrown off it.',
  },
  'keyboard-trap': {
    title: 'Keyboard focus gets stuck', criteria: ['2.1.2'], kinds: ['failure'],
    covers: 'An element that Tab and Shift+Tab cannot leave.',
    why: 'Once keyboard focus is stuck on one element, a keyboard user cannot reach anything after it, and often cannot leave the page without closing the browser.',
  },
};

// Built after the rules exist; used by the checks above at run time.
const issue = issuer(rules);
