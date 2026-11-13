// Pointer criteria: what a page asks of a mouse, a finger or the device itself.
//   2.1.3 Keyboard (No Exception)  pointer input with no keyboard path at all
//   2.5.1 Pointer Gestures         swipe-only carousels, pinch and rotate handlers
//   2.5.2 Pointer Cancellation     actions that fire as the button goes down
//   2.5.4 Motion Actuation         features worked by shaking or tilting the device
//   2.5.5 Target Size (Enhanced)   targets under 44 by 44 CSS px
//   2.5.6 Concurrent Input         controls that only answer touch
//   2.5.7 Dragging Movements       things that can only be dragged
// Most of this comes from the event listeners src/instrument.mjs records. A listener says
// what a page can respond to, not what it does with it, so those findings are "likely" and
// a person confirms them. 2.5.2 and 2.5.4 are tried for real in a fresh copy of the page.
import { guard, inPage, issuer, readWatch, recall, remember, startWatch, withFresh } from './observe.mjs';

const MAX_EACH = 5; // findings per rule per page from the listener scan
const MAX_PRESSES = 6; // elements pressed for 2.5.2
const MAX_TARGETS = 10; // small targets listed for 2.5.5
const PAUSE = 250;

// In the page: every element with listeners, sorted into what the pointer rules need.
function scanListeners() {
  const DOWN = ['pointerdown', 'mousedown', 'touchstart'];
  const MOVE = ['pointermove', 'mousemove', 'touchmove'];
  const KEYS = ['keydown', 'keyup', 'keypress'];
  const MOUSE = ['click', 'mousedown', 'mouseup', 'pointerdown', 'pointerup', 'dblclick'];
  const types = new Map();
  for (const el of [window, document, ...document.querySelectorAll('*')]) {
    const t = typesOf(el);
    if (t.length) types.set(el, new Set(t));
  }
  const has = (el, list) => list.some((t) => types.get(el)?.has(t));
  const up = (el) => { const out = []; for (let n = el; n; n = n.parentElement) out.push(n); out.push(document, window); return out; };
  const anyUp = (el, list) => up(el).some((n) => has(n, list));
  const where = (el) => ({ selector: selectorOf(el), html: htmlOf(el), label: labelOf(el), tag: el.tagName.toLowerCase() });
  const big = (el) => { const r = el.getBoundingClientRect(); return r.width >= 40 && r.height >= 40; };
  const native = (el) => el.matches('input, select, textarea, video, audio, iframe');
  // A container that holds its own buttons, or a parent that does, most likely offers a click
  // or tap way of doing the same thing (prev and next arrows, move up and down).
  const CONTROL = 'button, [role=button], input, select, a[href], [tabindex]:not([tabindex^="-"])';
  const hasControls = (el) => {
    for (let n = el, i = 0; n && n !== document.body && i < 3; n = n.parentElement, i++) {
      if ([...n.querySelectorAll(CONTROL)].some((c) => c !== el && shown(c))) return true;
      if ([...n.querySelectorAll('*')].some((c) => c !== el && has(c, ['click']) && shown(c))) return true;
    }
    return false;
  };
  const elements = [...types.keys()].filter((el) => el instanceof Element && el !== document.documentElement && el !== document.body && shown(el));
  const out = { pathOnly: [], swipe: [], gesture: [], drag: [], touchOnly: [], down: 0 };

  const CAROUSEL = '[aria-roledescription*=carousel i], [class*=carousel i], [class*=swiper i], [class*=slick i], [class*=splide i], [class*=glide i], [class*=slider i]';
  const swipeable = (el) => has(el, ['touchstart', 'touchmove']) || (has(el, ['pointerdown']) && has(el, ['pointermove']));
  const carousels = new Set();
  for (const c of document.querySelectorAll(CAROUSEL)) {
    // Outermost carousel only: querySelectorAll returns parents before children.
    if (!shown(c) || [...carousels].some((k) => k !== c && k.contains(c))) continue;
    const moving = [c, ...c.querySelectorAll('*')].find((n) => swipeable(n));
    if (!moving) continue;
    carousels.add(c);
    carousels.add(moving);
    if (!hasControls(moving) && ![...c.querySelectorAll(CONTROL)].some(shown)) out.swipe.push(where(c));
  }
  for (const el of [window, document, ...elements]) {
    if (has(el, ['gesturestart', 'gesturechange'])) {
      const target = el instanceof Element ? el : document.body;
      if (!hasControls(target)) out.gesture.push(where(target));
    }
  }
  for (const el of elements) {
    if (has(el, DOWN) && !el.matches('input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio]), select, textarea, [contenteditable]')) out.down++;
    const downMove = has(el, DOWN) && has(el, MOVE);
    // Freehand input (a signature pad, a drawing canvas): a pointer path, no keys anywhere and
    // no buttons near it. Carousels are judged by the swipe rule instead.
    if (downMove && big(el) && !native(el) && !carousels.has(el) && !el.closest(CAROUSEL) && !anyUp(el, KEYS) && !hasControls(el)) out.pathOnly.push(where(el));
    const draggable = el.getAttribute('draggable') === 'true' || has(el, ['dragstart']);
    if ((draggable || downMove) && !native(el) && el.tagName !== 'CANVAS' && !carousels.has(el) && !el.closest(CAROUSEL) && !anyUp(el, ['click']) && !hasControls(el)) out.drag.push(where(el));
    // Touch handlers with no mouse or pointer handler anywhere above: a mouse on the same
    // device cannot work this control.
    const operable = el.matches('a[href], button, [role], [tabindex]') || getComputedStyle(el).cursor === 'pointer';
    if (operable && has(el, ['touchstart', 'touchend']) && !anyUp(el, MOUSE)) out.touchOnly.push(where(el));
  }
  for (const k of ['pathOnly', 'swipe', 'gesture', 'drag', 'touchOnly']) out[k] = out[k].slice(0, 5);
  out.motion = window.__accessready_log ? window.__accessready_log.motion : 0;
  return out;
}

async function lookAtListeners(page, ctx) {
  const found = await inPage(page, scanListeners);
  remember(ctx, 'pointer', { down: found.down, motion: found.motion });
  const what = (w) => `${w.tag}${w.label ? ` "${w.label}"` : ''}`;
  const at = (w) => ({ selector: w.selector, html: w.html });
  const issues = [];
  for (const w of found.pathOnly.slice(0, MAX_EACH)) issues.push(issue('pointer-only-input', { message: `${what(w)} answers pointer presses and movement, and nothing on the page listens for keys, so what it does (drawing, signing, dragging) has no keyboard way`, ...at(w) }));
  for (const w of found.swipe.slice(0, MAX_EACH)) issues.push(issue('swipe-only', { message: `${what(w)} moves by swiping and has no buttons to go to the previous or next item`, ...at(w) }));
  for (const w of found.gesture.slice(0, 1)) issues.push(issue('multipoint-gesture', { message: `${what(w)} listens for pinch and rotate gestures and has no buttons near it that could do the same`, ...at(w) }));
  for (const w of found.drag.slice(0, MAX_EACH)) issues.push(issue('drag-only', { message: `${what(w)} can be dragged and has no click handler or buttons near it, so there may be no way to do the same with single clicks or taps`, ...at(w) }));
  for (const w of found.touchOnly.slice(0, MAX_EACH)) issues.push(issue('touch-only', { message: `${what(w)} answers touch but has no click, mouse or pointer handler, so a mouse or trackpad on the same device cannot use it`, ...at(w) }));
  return issues;
}

// In the page: the elements that act on a press, marked so the operate check can find them.
function markPressable(max) {
  const DOWN = ['pointerdown', 'mousedown', 'touchstart'];
  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (out.length >= max) break;
    if (el === document.body || el === document.documentElement || !shown(el)) continue;
    if (el.matches('input:not([type=button], [type=submit], [type=reset], [type=checkbox], [type=radio]), select, textarea, [contenteditable]')) continue;
    if (!typesOf(el).some((t) => DOWN.includes(t))) continue;
    el.setAttribute('data-accessready-press', String(out.length));
    out.push({ what: `${el.tagName.toLowerCase()}${labelOf(el) ? ` "${labelOf(el)}"` : ''}`, selector: selectorOf(el), html: htmlOf(el) });
  }
  return out;
}

// In the page: the state an action on this element would most likely change.
function pressState(i) {
  const el = document.querySelector(`[data-accessready-press="${i}"]`);
  if (!el) return null;
  window.__accessready_scope = el;
  const a = document.activeElement;
  return {
    aria: ['aria-expanded', 'aria-pressed', 'aria-checked', 'aria-selected'].map((n) => el.getAttribute(n)).join('|'),
    focusElsewhere: !!a && a !== document.body && a !== el && !el.contains(a),
  };
}

// 2.5.2: press the mouse button on each element that listens for a press, and hold it. If
// the action has already happened before the button comes back up, the user cannot change
// their mind by sliding off. The button is then released somewhere else, which is how a
// user cancels, and if that undoes the action the element passes.
async function tryPressWithoutRelease(_page, ctx) {
  if (!recall(ctx, 'pointer')?.down) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    const marked = await inPage(page, markPressable, MAX_PRESSES);
    // A page that keeps changing by itself (a ticker, a carousel) cannot be read this way.
    await page.evaluate(startWatch);
    await page.waitForTimeout(400);
    const quiet = (await page.evaluate(readWatch)).mutations === 0;
    const issues = [];
    for (let i = 0; i < marked.length; i++) {
      const el = page.locator(`[data-accessready-press="${i}"]`);
      await el.scrollIntoViewIfNeeded({ timeout: 1000 }).catch(() => {});
      const box = await el.boundingBox().catch(() => null);
      if (!box) continue;
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const hit = await page.evaluate(([px, py, n]) => { const t = document.elementFromPoint(px, py); const e = document.querySelector(`[data-accessready-press="${n}"]`); return !!t && !!e && (e === t || e.contains(t)); }, [x, y, i]);
      if (!hit) continue;
      await page.mouse.move(x, y);
      await page.waitForTimeout(150);
      const before = await page.evaluate(pressState, i);
      await page.evaluate(startWatch);
      const navs = g.attempts.length, wins = g.popups.length;
      await page.mouse.down();
      await page.waitForTimeout(PAUSE);
      const w = await page.evaluate(readWatch);
      const held = await page.evaluate(pressState, i);
      const effects = [];
      if (g.navigations().length > 0 && g.attempts.slice(navs).some((a) => a.navigation)) effects.push('starts loading another page');
      if (g.popups.length > wins || w.opened) effects.push('opens a new window');
      if (w.dialogs.length) effects.push(`opens "${w.dialogs[0]}"`);
      if (held && before && held.aria !== before.aria) effects.push('changes its state');
      if (held?.focusElsewhere && !before?.focusElsewhere) effects.push('moves focus elsewhere');
      if (!effects.length && quiet && w.outside > 0) effects.push('changes the page');
      // Cancel the way a user would: slide off, then let go.
      await page.mouse.move(1, 1, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(PAUSE);
      if (!effects.length) continue;
      // Undone by letting go somewhere else? Then the press was cancellable after all. Only a
      // state change or a dialog can be seen to come back; a page load or window cannot.
      const after = await page.evaluate(pressState, i);
      const now = await page.evaluate(readWatch);
      const undoable = effects.every((e) => e === 'changes its state' || e.startsWith('opens "'));
      if (undoable && after && before && after.aria === before.aria && !now.dialogs.length) continue;
      const m = marked[i];
      issues.push(issue('down-event-action', { message: `${m.what} ${effects.join(' and ')} as soon as the mouse button goes down, before it is released, so a press cannot be cancelled by sliding off`, selector: m.selector, html: m.html }));
    }
    await g.stop();
    return issues;
  });
}

// 2.5.4: the page listens for device motion or orientation. Shake it, then tilt it, with
// synthetic sensor events in a fresh copy, and see whether anything happens.
async function tryShaking(_page, ctx) {
  if (!recall(ctx, 'pointer')?.motion) return [];
  return withFresh(ctx, async (page) => {
    const g = await guard(page, { writes: true });
    await page.evaluate(startWatch);
    await page.waitForTimeout(400);
    const quiet = (await page.evaluate(readWatch)).mutations === 0;
    const found = [];
    for (const motion of ['shaking', 'tilting']) {
      await page.evaluate(startWatch);
      const navs = g.attempts.length;
      await page.evaluate(async (kind) => {
        const make = (type, init) => {
          try { return type === 'devicemotion' ? new DeviceMotionEvent(type, init) : new DeviceOrientationEvent(type, init); } catch {
            const e = new Event(type);
            for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v });
            return e;
          }
        };
        for (let i = 0; i < 12; i++) {
          const s = i % 2 ? 1 : -1;
          if (kind === 'shaking') {
            const a = { x: 25 * s, y: 20 * s, z: 15 * s };
            window.dispatchEvent(make('devicemotion', { acceleration: a, accelerationIncludingGravity: { x: a.x, y: a.y, z: a.z + 9.8 }, rotationRate: { alpha: 180 * s, beta: 180 * s, gamma: 180 * s }, interval: 16 }));
          } else {
            window.dispatchEvent(make('deviceorientation', { alpha: 0, beta: 5 * i, gamma: 5 * i, absolute: false }));
          }
          await new Promise((r) => setTimeout(r, 40));
        }
      }, motion);
      await page.waitForTimeout(400);
      const w = await page.evaluate(readWatch);
      const effect = g.attempts.slice(navs).some((a) => a.navigation) ? 'loads another page'
        : w.opened || g.popups.length ? 'opens a new window'
        : w.dialogs.length ? `opens "${w.dialogs[0]}"`
        : w.scrolled ? 'scrolls the page'
        : quiet && w.mutations > 0 ? 'changes the page'
        : null;
      if (effect) found.push(`${motion} the device ${effect}`);
    }
    await g.stop();
    return found.length ? [issue('motion-actuation', { message: `${found.join(', and ')}; check that a button can do the same and that responding to motion can be turned off`, selector: 'window', html: '' })] : [];
  });
}

// In the page: 2.5.5. Targets smaller than 44 by 44 CSS px, after the exceptions: inline in
// a sentence or block of text, an equivalent target elsewhere that is large enough, and a
// native checkbox or radio whose size the browser decides.
function smallTargets(max) {
  const TARGETS = 'a[href], button, input:not([type=hidden]), select, textarea, summary, [role=button], [role=link], [role=checkbox], [role=radio], [role=switch], [role=tab], [role=menuitem], [role=option], [onclick], [tabindex]:not([tabindex^="-"])';
  const MIN = 44;
  const all = [...document.querySelectorAll(TARGETS)].filter((el) => shown(el) && !el.disabled && !el.closest('[aria-hidden=true], [inert]'));
  const boxOf = (el) => {
    let r = el.getBoundingClientRect();
    // Clicking a label works its field, so the label is part of the target.
    for (const l of el.labels || []) {
      const lr = l.getBoundingClientRect();
      if (!lr.width || !lr.height) continue;
      const left = Math.min(r.left, lr.left), top = Math.min(r.top, lr.top);
      r = { left, top, width: Math.max(r.right ?? r.left + r.width, lr.right) - left, height: Math.max(r.bottom ?? r.top + r.height, lr.bottom) - top };
    }
    return { width: r.width, height: r.height };
  };
  const big = (el) => { const b = boxOf(el); return b.width >= MIN && b.height >= MIN; };
  const inline = (el) => {
    if (!getComputedStyle(el).display.startsWith('inline')) return false;
    let block = el.parentElement;
    while (block && getComputedStyle(block).display.startsWith('inline')) block = block.parentElement;
    if (!block) return false;
    const own = (el.textContent || '').trim();
    const rest = (block.textContent || '').replace(own, '');
    return /\p{L}{2,}/u.test(rest);
  };
  const same = (a, b) => (a.href && a.href === b.href) || (labelOf(a) && labelOf(a) === labelOf(b) && a.tagName === b.tagName && (a.getAttribute('role') || '') === (b.getAttribute('role') || ''));
  const out = [];
  let more = 0;
  for (const el of all) {
    // A target inside a target is part of the outer one.
    if (el.parentElement?.closest(TARGETS) && all.includes(el.parentElement.closest(TARGETS))) continue;
    const r = el.getBoundingClientRect();
    // Visually hidden until focused (skip links) and off-canvas elements are not targets yet.
    if (r.width <= 2 || r.height <= 2 || r.right <= 0 || r.bottom + scrollY <= 0 || r.left >= document.documentElement.scrollWidth) continue;
    if (big(el)) continue;
    if (el.matches('input[type=checkbox], input[type=radio]') && getComputedStyle(el).appearance !== 'none') continue;
    if (inline(el)) continue;
    if (all.some((o) => o !== el && same(o, el) && big(o))) continue;
    if (out.length >= max) { more++; continue; }
    const b = boxOf(el);
    out.push({ what: `${el.tagName.toLowerCase()}${labelOf(el) ? ` "${labelOf(el)}"` : ''}`, w: Math.round(b.width), h: Math.round(b.height), selector: selectorOf(el), html: htmlOf(el) });
  }
  return { out, more };
}

async function lookAtTargetSize(page, ctx) {
  // An AAA criterion only: not worth the time at A or AA.
  if (ctx.level !== 'AAA') return [];
  const { out, more } = await inPage(page, smallTargets, MAX_TARGETS);
  const issues = out.map((t) => issue('target-size-enhanced', { message: `${t.what} is ${t.w} by ${t.h} px; at AAA a target needs 44 by 44 px unless it sits in a line of text or a larger one does the same thing`, selector: t.selector, html: t.html }));
  return { issues, notes: more ? [`${more} more targets under 44 by 44 px were not listed`] : [] };
}

export const probes = [
  { name: 'pointer listeners', phase: 'look', run: lookAtListeners },
  { name: 'target size (enhanced)', phase: 'look', run: lookAtTargetSize },
  // These two open their own fresh copy, and only when the scan found something to try, so a
  // page with nothing to press or shake costs nothing. They never touch the page they get.
  { name: 'pointer cancellation', phase: 'operate', run: tryPressWithoutRelease },
  { name: 'motion actuation', phase: 'operate', run: tryShaking },
];

export const rules = {
  'pointer-only-input': {
    title: 'Works with a pointer only', criteria: ['2.1.3'], kinds: ['likely'],
    covers: 'Elements that listen for a pointer press and pointer movement (drawing areas, signature pads) on a page where nothing listens for keys.',
    why: 'People who cannot use a mouse or a touch screen, including many with tremors or paralysis, rely on the keyboard or a switch. A feature worked only by moving a pointer leaves them out.',
  },
  'swipe-only': {
    title: 'Carousel moves by swiping only', criteria: ['2.5.1'], kinds: ['likely'],
    covers: 'Carousels and sliders that listen for touch or pointer movement and have no previous, next or dot buttons.',
    why: 'Swiping is hard or impossible for people with limited hand movement, and for anyone using a head pointer or mouth stick. Buttons let them move the carousel with single taps.',
  },
  'multipoint-gesture': {
    title: 'Pinch or rotate gesture with no buttons', criteria: ['2.5.1'], kinds: ['likely'],
    covers: 'Elements that listen for pinch and rotate gestures and have no buttons nearby that could do the same.',
    why: 'Two-finger gestures need two working hands and fine control. Zoom or rotate buttons make the same feature usable with one finger.',
  },
  'down-event-action': {
    title: 'Acts as soon as the button is pressed', criteria: ['2.5.2'], kinds: ['likely'],
    covers: 'Elements with a press handler are pressed and held in a fresh copy of the page; if they act before the button is released, and sliding off and letting go does not undo it, they are flagged.',
    why: 'People with tremors or limited control often press the wrong thing. Acting on release lets them slide off and cancel; acting on press does not.',
  },
  'motion-actuation': {
    title: 'Responds to shaking or tilting the device', criteria: ['2.5.4'], kinds: ['likely'],
    covers: 'Pages that listen for device motion are shaken and tilted with sensor events in a fresh copy; if the page reacts, it is flagged.',
    why: 'Someone with a device mounted on a wheelchair cannot shake or tilt it, and someone with tremors may set it off by accident. The same feature needs a button and a way to switch motion off.',
  },
  'target-size-enhanced': {
    title: 'Target is smaller than 44 by 44 pixels', criteria: ['2.5.5'], kinds: ['failure'],
    covers: 'Every link, button and control is measured, its label included; anything under 44 by 44 CSS px fails unless it sits in a line of text, a larger target does the same thing, or it is a native checkbox or radio the browser sizes.',
    why: 'Small targets are hard to hit for people with tremors or limited dexterity, and for anyone using a phone with one hand.',
  },
  'touch-only': {
    title: 'Control answers touch only', criteria: ['2.5.6'], kinds: ['likely'],
    covers: 'Controls with touch handlers and no click, mouse or pointer handler anywhere above them.',
    why: 'Many people use a mouse, a trackpad or a stylus on a touch-screen device, or switch between them. A control that only answers touch shuts them out.',
  },
  'drag-only': {
    title: 'Can only be dragged', criteria: ['2.5.7'], kinds: ['likely'],
    covers: 'Draggable elements, and elements that follow the pointer while pressed, that have no click handler and no buttons near them.',
    why: 'Dragging means holding a button down while moving, which many people with motor disabilities cannot do. Clicking or tapping to pick up and put down, or arrow buttons, does the same job.',
  },
};

// Built after the rules exist; used by the checks above at run time.
const issue = issuer(rules);
