// Walks the page with the Tab key, the way a keyboard user does, and at every stop checks:
//   2.4.7  Focus Visible: does anything on screen change when the element takes focus?
//   2.4.11 Focus Not Obscured (Minimum): is the focused element entirely hidden behind
//          something else (sticky header, cookie banner, chat bubble) or off screen?
// Focus visibility is judged from pixels, not CSS: the area around the element is
// screenshotted focused and blurred, and the two images are compared. That catches rings
// drawn on a wrapper, with :focus-within or with a pseudo-element, and it does not pass a
// style change that draws nothing.
import { PNG } from 'pngjs';

const RING_MARGIN = 8; // px around the element where a focus ring may be drawn
const MIN_CHANGED_PIXELS = 8;
const CHANNEL_TOLERANCE = 12; // ignore anti-aliasing noise
const INNER_STOPS = 8; // Tab presses one element may absorb (a date field has up to six parts)
const MAX_FRAME_STOPS = 60; // consecutive Tab presses spent inside one iframe before giving up

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
  let coveredBy = '', coveredByModal = false;
  if (cover) {
    // Name the positioned ancestor doing the covering, which is the thing a developer has to fix.
    let c = cover;
    for (let n = cover; n && n !== document.body; n = parentOf(n)) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') { c = n; break; } }
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
    onScreen, visible, coveredBy, coveredByModal, textEntry,
    inModal: !!el.closest('dialog[open], [aria-modal=true]'),
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

function changedPixels(a, b) {
  const one = PNG.sync.read(a), two = PNG.sync.read(b);
  if (one.width !== two.width || one.height !== two.height) return Infinity;
  let n = 0;
  for (let i = 0; i < one.data.length; i += 4) {
    if (Math.abs(one.data[i] - two.data[i]) > CHANNEL_TOLERANCE ||
        Math.abs(one.data[i + 1] - two.data[i + 1]) > CHANNEL_TOLERANCE ||
        Math.abs(one.data[i + 2] - two.data[i + 2]) > CHANNEL_TOLERANCE) n++;
  }
  return n;
}

function clipFor({ rect, viewport }) {
  const x = Math.max(0, Math.floor(rect.x - RING_MARGIN));
  const y = Math.max(0, Math.floor(rect.y - RING_MARGIN));
  const right = Math.min(viewport.width, Math.ceil(rect.x + rect.width + RING_MARGIN));
  const bottom = Math.min(viewport.height, Math.ceil(rect.y + rect.height + RING_MARGIN));
  if (right - x < 1 || bottom - y < 1) return null;
  return { x, y, width: right - x, height: bottom - y };
}

export async function walkKeyboard(page, { maxStops = 150 } = {}) {
  const issues = [];
  const seen = new Set();
  let lastId = null, sameStops = 0;
  let stops = 0, emptyStops = 0, frameStops = 0, framesSkipped = 0, capped = false;

  await page.evaluate(() => { document.activeElement?.blur?.(); window.scrollTo(0, 0); });
  const dialogsAtStart = await page.evaluate(openDialogs);

  // One look at whatever has focus: where it is, whether it can be seen, and how many
  // pixels change between focused and blurred.
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
    return { f, changed: changedPixels(focused, blurred) };
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

  for (;;) {
    if (stops >= maxStops) { capped = true; break; }
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
    if (failing(look)) {
      // Look twice before reporting. Late-loading styles or something still animating can
      // make one reading wrong; a real problem is still there a moment later.
      await page.waitForTimeout(300);
      const again = await inspect();
      if (again.f.kind === 'element' && again.f.id === look.f.id) look = again;
    }
    const { f, changed } = look;

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
  }

  const dialogsOpened = (await page.evaluate(openDialogs)).filter((d) => !dialogsAtStart.includes(d));

  return { issues, stops, capped, framesSkipped, dialogsOpened };
}
