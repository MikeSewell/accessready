// Time and motion: what a page does by itself while nobody touches it, and what it does
// when someone scrolls and hovers.
//
// The main check opens a fresh copy of the page the way most visitors see it (no reduced
// motion asked for) on a clock it controls, then:
//   1. lists CSS animations that run for more than five seconds          2.2.2
//   2. records the screen for three seconds and counts flashes (Chromium)  2.3.1, 2.3.2
//   3. moves the clock on 50 seconds, a second at a time, and watches which parts of the
//      page change by themselves: carousels, tickers, script animation    2.2.2
//   4. moves the clock on to 20 minutes and watches for the page reloading or leaving,
//      "your session has expired", and popups nobody asked for           2.2.1, 2.2.3, 2.2.4, 2.2.6
// Moving a clock is what a visitor does by leaving a tab open, so nothing here goes beyond
// what a visitor could do. Native alert and confirm dialogs are dismissed.
import { PNG } from 'pngjs';
import { issue } from './index.mjs';

const WATCH_STEPS = 30;          // first pass: seconds watched for anything changing
const CONFIRM_STEPS = 20;        // second pass: seconds watched on the parts that changed
const TIMEOUT_MINUTES = 20;      // how far the clock is moved in all
const TIMEOUT_STEP = 30_000;
const MAX_REGIONS = 5;
const MAX_ANIMATIONS = 5;
const FLASH_LOOK = 300;          // ms to see whether anything is moving at all
const FLASH_RECORD = 3000;       // ms recorded when it is
const FLASH_WIDTH = 320;         // recorded frames are scaled down to this
// The WCAG 2.2 flash thresholds. A flash is a pair of opposing changes in relative luminance
// of 0.1 or more where the darker state is below 0.8; more than three in any second fails
// when they cover more than 25% of any 10 degree field of view, which WCAG estimates as a
// 341 x 256 pixel rectangle.
const FLASH_DELTA = 0.1;
const FLASH_DARK = 0.8;
const FLASH_TRANSITIONS = 7;     // more than three flashes = seven or more opposing changes
const FIELD = { width: 341, height: 256 };
const FIELD_SHARE = 0.25;

// Names of controls that stop motion. Page-wide switches count for every region.
const PAUSE = /pause|stop|play|freeze|halt|(start|resume) (automatic|auto|slide)|autoplay|auto-?rotat/i;
const PAUSE_ALL = /(pause|stop|freeze|turn off|disable|reduce) (all )?(animations?|motion|movement)|reduce motion/i;
// What a page says when it has timed out, and what it says just before.
const EXPIRED = /session (has |is )?(expired|ended|timed out)|(you have been|you were|you've been) (logged|signed) out|timed out due to inactivity|session time ?out|your time (is up|has expired)|page (has )?expired/i;
const WARNING = /(will|is about to|is going to) (expire|time ?out|end)|(be|being) (logged|signed) out (in|soon)|are you still (there|here|working)|still (there|here)\?|need more time|extend (your )?(session|time)|stay (logged|signed) in|continue (your )?session|session (expires|ends) in|inactiv/i;
const EXTEND = /continue|extend|stay|keep|more time|yes|still here|i'?m here|refresh|resume/i;

// In the page: running animations that last more than five seconds, by element.
function collectAnimations({ pause, pauseAll }) {
  const PAUSE_RE = new RegExp(pause, 'i'), ALL_RE = new RegExp(pauseAll, 'i');
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 4 && r.height >= 4 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const opacity = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const nameOf = (b) => clean(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '');
  const controls = [...document.querySelectorAll('button, [role=button], [role=switch], input[type=checkbox], a[href]')].filter(shown);
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return parts.join(' > ');
  };
  // A loading indicator is meant to move until the content arrives.
  const loader = (el) => !!el.closest('[role=progressbar], [aria-busy=true]') ||
    [el, el.parentElement, el.parentElement?.parentElement].some((n) => n && /spinner|loader|loading|skeleton|shimmer|placeholder/i.test(`${n.id} ${typeof n.className === 'string' ? n.className : ''}`));
  const pageSwitch = controls.some((b) => ALL_RE.test(nameOf(b)));

  const byElement = new Map();
  for (const a of document.getAnimations()) {
    // CSS animations and ones a script started with element.animate(); transitions end by themselves.
    if (a instanceof CSSTransition || a.playState !== 'running' || !a.effect || !a.effect.target) continue;
    const t = a.effect.getComputedTiming();
    const total = t.activeDuration === Infinity ? Infinity : (t.delay || 0) + t.activeDuration;
    if (total <= 5000) continue;
    // Keyframes that leave every property where it was change nothing anyone can see.
    const frames = a.effect.getKeyframes();
    const props = new Set();
    for (const f of frames) for (const k of Object.keys(f)) if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) props.add(k);
    const moving = [...props].filter((k) => new Set(frames.map((f) => String(f[k] ?? ''))).size > 1);
    if (!moving.length) continue;
    const el = a.effect.target;
    if (!shown(el) || opacity(el) < 0.05 || loader(el)) continue;
    if (byElement.has(el)) continue;
    const region = el.closest('section, article, aside, header, footer, figure, [role=region]') || el.parentElement?.parentElement || document.body;
    const paused = pageSwitch || controls.some((b) => (region.contains(b) || b.parentElement?.contains(el)) && PAUSE_RE.test(nameOf(b)));
    if (paused) continue;
    const r = el.getBoundingClientRect();
    byElement.set(el, {
      key: `${selector(el)}|${a.animationName || a.id}`,
      selector: selector(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      name: a.animationName || a.id || 'scripted', forever: total === Infinity, seconds: Math.round(total / 1000),
      properties: moving.slice(0, 3), area: Math.round(r.width * r.height),
    });
  }
  return [...byElement.values()].sort((a, b) => b.area - a.area);
}

// In the page: start recording which elements change. Each change is filed under the
// second it happened in, on the element and every ancestor, so a carousel shows up as one
// element that changes every few seconds.
function startWatch() {
  const IGNORE = new Set(['SCRIPT', 'STYLE', 'HEAD', 'TITLE', 'NOSCRIPT', 'TEMPLATE', 'IFRAME', 'META', 'LINK']);
  const w = { step: 0, steps: new Map(), kinds: new Map(), dialogs: [] };
  const file = (el, kind) => {
    if (!el || el.nodeType !== 1 || IGNORE.has(el.tagName) || el.closest('head')) return;
    for (let n = el, depth = 0; n && n !== document.documentElement && depth < 40; n = n.parentElement, depth++) {
      if (!w.steps.has(n)) w.steps.set(n, new Set());
      w.steps.get(n).add(w.step);
      if (!w.kinds.has(n)) w.kinds.set(n, new Set());
      w.kinds.get(n).add(kind);
    }
  };
  const take = (records) => {
    for (const r of records.slice(0, 2000)) {
      if (r.type === 'characterData') file(r.target.parentElement, 'text');
      else if (r.type === 'childList') {
        const onlyText = [...r.addedNodes, ...r.removedNodes].every((n) => n.nodeType === 3);
        file(r.target, onlyText ? 'text' : 'structure');
      } else if (!/^data-accessready/.test(r.attributeName)) file(r.target, 'attributes');
    }
  };
  w.observer = new MutationObserver(take);
  w.observer.observe(document.body, {
    subtree: true, childList: true, characterData: true, attributes: true,
    attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'src', 'srcset', 'open', 'aria-selected', 'aria-current'],
  });
  w.flush = () => take(w.observer.takeRecords());
  Object.defineProperty(window, '__accessready_watch', { value: w, configurable: true });
}

function setStep(step) {
  const w = window.__accessready_watch;
  w.flush();
  w.step = step;
}

// In the page: the elements that changed in at least three different seconds, keeping the
// deepest one of each group, and marked so the second pass can find them again.
function pickRegions({ max, minStep }) {
  const w = window.__accessready_watch;
  w.flush();
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 8 && r.height >= 8 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const busy = (el) => { const s = w.steps.get(el); return !!s && s.size >= 3 && [...s].some((n) => n >= minStep); };
  let picked = [...w.steps.keys()].filter((el) => el.isConnected && busy(el) && ![...el.children].some(busy));
  // Slides that each change: the carousel is their parent.
  const parents = new Map();
  for (const el of picked) if (el.parentElement) parents.set(el.parentElement, (parents.get(el.parentElement) || 0) + 1);
  picked = [...new Set(picked.map((el) => (parents.get(el.parentElement) > 1 ? el.parentElement : el)))];
  picked = picked.filter((el) => el !== document.body && shown(el) && !picked.some((o) => o !== el && o.contains(el)));
  // The second pass starts counting afresh for the regions picked.
  w.picked = picked.slice(0, max);
  return w.picked.map((el, i) => {
    el.setAttribute('data-accessready-watch', String(i));
    const kinds = [...(w.kinds.get(el) || [])];
    w.steps.set(el, new Set());
    return { index: i, kinds };
  });
}

// In the page: what each marked region shows right now. Text and images whose middle lies
// inside the box that clips the region, and that are not transparent.
function regionState(count) {
  // Elements are told apart by identity, not by tag or position: slides are built alike.
  if (!window.__accessready_ids) Object.defineProperty(window, '__accessready_ids', { value: { map: new WeakMap(), next: 0 }, configurable: true });
  const ids = window.__accessready_ids;
  const idOf = (el) => { if (!ids.map.has(el)) ids.map.set(el, ids.next++); return ids.map.get(el); };
  const out = [];
  for (let i = 0; i < count; i++) {
    const region = document.querySelector(`[data-accessready-watch="${i}"]`);
    if (!region) { out.push(null); continue; }
    let clip = region;
    for (let n = region; n && n !== document.body; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (/hidden|clip|auto|scroll/.test(cs.overflowX + cs.overflowY)) { clip = n; break; }
    }
    const box = clip.getBoundingClientRect();
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (x < box.left || x > box.right || y < box.top || y > box.bottom) return false;
      let o = 1;
      for (let n = el; n && n !== clip.parentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none') return false;
        o *= +cs.opacity;
      }
      return o > 0.1;
    };
    const parts = [];
    const shownSet = [];
    for (const el of [region, ...region.querySelectorAll('*')].slice(0, 400)) {
      const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
      const media = /^(IMG|VIDEO|PICTURE|SVG|CANVAS)$/i.test(el.tagName);
      if (!own && !media) continue;
      if (!visible(el)) continue;
      parts.push(own || `${el.tagName}:${el.currentSrc || el.src || ''}`);
      shownSet.push(media ? `${idOf(el)}:${el.currentSrc || el.src || ''}` : idOf(el));
    }
    out.push({ text: parts.join('|'), elements: shownSet.join('|') });
  }
  return out;
}

// In the page: details of a region for the report, and whether a pause control is near it.
function describeRegion({ index, pause, pauseAll }) {
  const PAUSE_RE = new RegExp(pause, 'i'), ALL_RE = new RegExp(pauseAll, 'i');
  const el = document.querySelector(`[data-accessready-watch="${index}"]`);
  if (!el) return null;
  const shown = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const nameOf = (b) => clean(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || '');
  const controls = [...document.querySelectorAll('button, [role=button], [role=switch], input[type=checkbox], a[href]')].filter(shown);
  let scope = el;
  for (let i = 0; i < 4 && scope.parentElement && scope.parentElement !== document.body; i++) scope = scope.parentElement;
  const near = el.closest('[aria-roledescription=carousel], section, article, aside, header, figure, [role=region]') || scope;
  const paused = controls.some((b) => ALL_RE.test(nameOf(b))) || controls.some((b) => (near.contains(b) || scope.contains(b)) && PAUSE_RE.test(nameOf(b)));
  const parts = [];
  for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
    if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
    let part = n.tagName.toLowerCase();
    const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
    if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
    parts.unshift(part);
  }
  el.removeAttribute('data-accessready-watch');
  const w = window.__accessready_watch;
  w.flush();
  return {
    // Seconds of the second pass in which anything inside it changed.
    busy: (w.steps.get(el) || new Set()).size,
    selector: parts.join(' > '), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160), paused,
    label: clean(el.getAttribute('aria-label') || near.getAttribute('aria-label') || el.innerText || '').slice(0, 40),
  };
}

// In the page: anything that looks like an interruption or a timeout right now.
function pageSignals({ expired, warning, extend }) {
  const EXP = new RegExp(expired, 'i'), WARN = new RegExp(warning, 'i'), EXT = new RegExp(extend, 'i');
  const shown = (n) => { const r = n.getBoundingClientRect(); const cs = getComputedStyle(n); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; };
  const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
  const nameOf = (b) => clean(b.getAttribute('aria-label') || b.getAttribute('title') || b.textContent || b.value || '');
  // Popups: dialogs, and anything fixed on top that covers a quarter of the window.
  const popups = [];
  // Overlays sit near the top of the document; looking only there keeps this cheap enough to
  // run every step.
  for (const el of document.querySelectorAll('dialog, [role=dialog], [role=alertdialog], [aria-modal=true], body > *, body > * > *, body > * > * > *')) {
    if (popups.length >= 5) break;
    const isDialog = el.matches('dialog, [role=dialog], [role=alertdialog], [aria-modal=true]');
    if (!isDialog) {
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed') continue;
      const r = el.getBoundingClientRect();
      if (r.width * r.height < innerWidth * innerHeight * 0.25) continue;
    }
    if (!shown(el) || popups.some((p) => p.el.contains(el))) continue;
    if (!el.hasAttribute('data-accessready-popup')) el.setAttribute('data-accessready-popup', String(document.querySelectorAll('[data-accessready-popup]').length));
    popups.push({ el, id: el.getAttribute('data-accessready-popup') });
  }
  const text = document.body ? document.body.innerText : '';
  const describe = (el) => ({
    id: el.getAttribute('data-accessready-popup'),
    selector: el.id ? `#${CSS.escape(el.id)}` : el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : el.tagName.toLowerCase(),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
    name: clean(el.getAttribute('aria-label') || document.getElementById(el.getAttribute('aria-labelledby') || '')?.textContent || el.innerText || '').slice(0, 60),
    text: clean(el.innerText).slice(0, 300),
    canExtend: [...el.querySelectorAll('button, [role=button], a[href], input[type=button], input[type=submit]')].some((b) => shown(b) && EXT.test(nameOf(b))),
  });
  // A warning outside a popup still needs a button somewhere to act on it.
  const extendButton = [...document.querySelectorAll('button, [role=button], input[type=button]')].some((b) => shown(b) && EXT.test(nameOf(b)) && WARN.test(clean(b.closest('section, div, form, aside, footer, header')?.innerText || '')));
  return {
    marker: !!window.__accessready_timing,
    url: location.href,
    popups: popups.map((p) => describe(p.el)),
    expired: EXP.test(text), warning: WARN.test(text), extendButton,
    mentionsLimit: /\b\d+\s*(minutes?|mins?|hours?)\b[^.]{0,60}(inactiv|idle|time ?out|expire)|(inactiv|idle|time ?out|expire)[^.]{0,60}\b\d+\s*(minutes?|mins?|hours?)\b/i.test(text),
  };
}

const luminance = (r, g, b) => {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return [f(r), f(g), f(b)];
};

// Counts flashes, pixel by pixel, from frames recorded off the screen. Returns the worst
// one-second window: how much area flashed more than three times, as general flashes and as
// red flashes, in CSS pixels, both in total and inside the worst 10 degree field.
export function analyzeFlashes(frames, cssScale) {
  if (frames.length < 2) return null;
  const { width, height } = frames[0];
  const n = width * height;
  const series = { general: new Array(n), red: new Array(n) };
  const state = {
    general: { ref: new Float32Array(n), dir: new Int8Array(n) },
    red: { ref: new Float32Array(n), dir: new Int8Array(n) },
  };
  const step = (kind, i, v, t, first) => {
    const s = state[kind];
    if (first) { s.ref[i] = v; return; }
    const ref = s.ref[i], dir = s.dir[i];
    const delta = kind === 'general' ? FLASH_DELTA : 20;
    // Extend a change that keeps going the same way; count one that turns back.
    if ((dir > 0 && v > ref) || (dir < 0 && v < ref)) { s.ref[i] = v; return; }
    const change = v - ref;
    if (Math.abs(change) < delta) return;
    if (kind === 'general' && Math.min(v, ref) >= FLASH_DARK) return;
    s.dir[i] = change > 0 ? 1 : -1;
    s.ref[i] = v;
    (series[kind][i] ||= []).push(t);
  };
  frames.forEach((frame, k) => {
    if (frame.width !== width || frame.height !== height) return;
    const d = frame.data;
    for (let i = 0; i < n; i++) {
      const [r, g, b] = luminance(d[i * 4], d[i * 4 + 1], d[i * 4 + 2]);
      step('general', i, 0.2126 * r + 0.7152 * g + 0.0722 * b, frame.time, k === 0);
      // WCAG's saturated red: R/(R+G+B) >= 0.8, measured as (R - G - B) x 320.
      const sum = r + g + b;
      step('red', i, sum > 0 && r / sum >= 0.8 ? Math.max(0, r - g - b) * 320 : 0, frame.time, k === 0);
    }
  });

  const start = frames[0].time, end = frames[frames.length - 1].time;
  const pixelArea = cssScale * cssScale;
  const fieldW = Math.max(1, Math.round(FIELD.width / cssScale)), fieldH = Math.max(1, Math.round(FIELD.height / cssScale));
  const worst = { general: 0, red: 0, generalField: 0, redField: 0, rate: 0, box: null };
  for (let t0 = start; t0 <= Math.max(start, end - 1); t0 += 0.1) {
    for (const kind of ['general', 'red']) {
      const mask = new Uint8Array(n);
      let count = 0;
      for (let i = 0; i < n; i++) {
        const times = series[kind][i];
        if (!times || times.length < FLASH_TRANSITIONS) continue;
        let inWindow = 0;
        for (const t of times) if (t >= t0 && t < t0 + 1) inWindow++;
        if (inWindow >= FLASH_TRANSITIONS) {
          mask[i] = 1; count++;
          worst.rate = Math.max(worst.rate, inWindow / 2);
        }
      }
      if (!count) continue;
      // The most flashing area inside any field-sized rectangle, from a summed-area table.
      const sum = new Uint32Array((width + 1) * (height + 1));
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        sum[(y + 1) * (width + 1) + x + 1] = mask[y * width + x] + sum[y * (width + 1) + x + 1] + sum[(y + 1) * (width + 1) + x] - sum[y * (width + 1) + x];
      }
      const fw = Math.min(fieldW, width), fh = Math.min(fieldH, height);
      let most = 0;
      for (let y = 0; y + fh <= height; y += 2) for (let x = 0; x + fw <= width; x += 2) {
        const s = sum[(y + fh) * (width + 1) + x + fw] - sum[y * (width + 1) + x + fw] - sum[(y + fh) * (width + 1) + x] + sum[y * (width + 1) + x];
        if (s > most) most = s;
      }
      if (count * pixelArea > worst[kind]) {
        // Where it flashes, in CSS pixels, to point the report at an element.
        let x0 = width, y0 = height, x1 = 0, y1 = 0;
        for (let i = 0; i < n; i++) if (mask[i]) { const x = i % width, y = (i - x) / width; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
        if (!worst.box || count * pixelArea > Math.max(worst.general, worst.red)) worst.box = { x: x0 * cssScale, y: y0 * cssScale, width: (x1 - x0 + 1) * cssScale, height: (y1 - y0 + 1) * cssScale };
      }
      worst[kind] = Math.max(worst[kind], count * pixelArea);
      worst[`${kind}Field`] = Math.max(worst[`${kind}Field`], most * pixelArea);
    }
  }
  return worst;
}

// Records the screen through the Chrome DevTools Protocol. Frames only arrive when something
// on screen changes, so a still page is recognized within FLASH_LOOK and costs no more.
async function recordFrames(page) {
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  let stopped = false;
  cdp.on('Page.screencastFrame', (f) => {
    if (!stopped) {
      try {
        const png = PNG.sync.read(Buffer.from(f.data, 'base64'));
        frames.push({ time: f.metadata.timestamp, width: png.width, height: png.height, data: png.data });
      } catch { /* a frame that does not decode is skipped */ }
    }
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  const viewport = page.viewportSize();
  await cdp.send('Page.startScreencast', { format: 'png', maxWidth: FLASH_WIDTH, maxHeight: Math.round(FLASH_WIDTH * viewport.height / viewport.width), everyNthFrame: 1 });
  await page.waitForTimeout(FLASH_LOOK);
  if (frames.length > 2) await page.waitForTimeout(FLASH_RECORD - FLASH_LOOK);
  stopped = true;
  await cdp.send('Page.stopScreencast').catch(() => {});
  await cdp.detach().catch(() => {});
  return { frames, cssScale: frames.length ? viewport.width / frames[0].width : 1 };
}

async function checkFlashes(page) {
  const { frames, cssScale } = await recordFrames(page);
  if (frames.length < FLASH_TRANSITIONS + 1) return [];
  const w = analyzeFlashes(frames, cssScale);
  if (!w || !w.rate) return [];
  const fieldArea = FIELD.width * FIELD.height;
  const general = w.generalField > fieldArea * FIELD_SHARE, red = w.redField > fieldArea * FIELD_SHARE;
  const rate = `about ${Math.round(w.rate)} times a second`;
  // The element drawn in the middle of the flashing area.
  const at = await page.evaluate((box) => {
    const el = box && document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    if (!el || el === document.documentElement || el === document.body) return { selector: 'html', html: '' };
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      if (n.id) { parts.unshift('#' + CSS.escape(n.id)); break; }
      let part = n.tagName.toLowerCase();
      const same = n.parentElement ? [...n.parentElement.children].filter((c) => c.tagName === n.tagName) : [];
      if (same.length > 1) part += `:nth-of-type(${same.indexOf(n) + 1})`;
      parts.unshift(part);
    }
    return { selector: parts.join(' > '), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160) };
  }, w.box).catch(() => ({ selector: 'html', html: '' }));
  if (general || red) {
    return [issue('flashing', {
      ...at,
      message: `${red && !general ? 'saturated red flashes' : 'content flashes'} ${rate} over ${Math.round(Math.max(w.generalField, w.redField) / fieldArea * 100)}% of a 341 x 256 pixel area, above the general${red ? ' and red' : ''} flash threshold`,
    })];
  }
  return [issue('flashing-small', {
    ...at,
    message: `content flashes ${rate} over about ${Math.round(Math.max(w.general, w.red))} square pixels: under the area threshold for 2.3.1, but any flashing faster than three times a second fails 2.3.2`,
  })];
}

const minutes = (ms) => (ms < 60_000 ? `${Math.round(ms / 1000)} seconds` : `${Math.round(ms / 60_000)} minute${Math.round(ms / 60_000) === 1 ? '' : 's'}`);

async function checkMotion(page, ctx) {
  const issues = [];
  const notes = [];
  const signals = { expired: EXPIRED.source, warning: WARNING.source, extend: EXTEND.source };

  // 1. Animations as most visitors get them. Whether they stop when reduced motion is asked
  // for is checked at the end: switching it now could make a page stop its carousel for good.
  const animations = await page.evaluate(collectAnimations, { pause: PAUSE.source, pauseAll: PAUSE_ALL.source });

  // 2. Flashing, recorded in real time.
  if (ctx.browserName === 'chromium') issues.push(...await checkFlashes(page));

  // 3 and 4 need the clock and a page that stays put.
  let elapsed = 0;
  const dialogs = [];
  page.on('dialog', (d) => { dialogs.push({ at: elapsed, message: d.message(), type: d.type() }); d.dismiss().catch(() => {}); });
  const startUrl = page.url();
  await page.evaluate(() => Object.defineProperty(window, '__accessready_timing', { value: true, configurable: true }));
  const first = await page.evaluate(pageSignals, signals);
  const knownPopups = new Set(first.popups.map((p) => p.id));
  const timeline = [];
  let gone = null;

  // The page has gone when its document has been replaced: a reload, or a new address. A
  // script that only rewrites the address bar (a slide number in the hash) has not.
  const look = async () => {
    let s = await page.evaluate(pageSignals, signals).catch(() => null);
    if (!s || !s.marker) {
      await page.waitForLoadState('load', { timeout: 5000 }).catch(() => {});
      s = await page.evaluate(pageSignals, signals).catch(() => null);
      if (!s || !s.marker) {
        gone = { at: elapsed, reload: page.url() === startUrl };
        return null;
      }
    }
    timeline.push({ at: elapsed, ...s, popups: s.popups.filter((p) => !knownPopups.has(p.id)) });
    for (const p of s.popups) knownPopups.add(p.id);
    return s;
  };
  const forward = async (ms) => { await page.clock.fastForward(ms); elapsed += ms; };

  // 3. Parts of the page that change by themselves.
  await page.evaluate(startWatch);
  for (let s = 1; s <= WATCH_STEPS && !gone; s++) {
    await page.evaluate(setStep, s).catch(() => {});
    await forward(1000);
    await look();
  }
  if (!gone) {
    const regions = await page.evaluate(pickRegions, { max: MAX_REGIONS, minStep: 6 }).catch(() => []);
    if (regions.length) {
      const states = [await page.evaluate(regionState, regions.length)];
      for (let s = 0; s < CONFIRM_STEPS && !gone; s++) {
        await page.evaluate(setStep, WATCH_STEPS + 1 + s).catch(() => {});
        await forward(1000);
        if (!await look()) break;
        states.push(await page.evaluate(regionState, regions.length).catch(() => []));
      }
      for (const r of regions) {
        const seen = states.map((st) => st[r.index]).filter(Boolean);
        const changes = (key) => seen.filter((st, i) => i > 0 && st[key] !== seen[i - 1][key]).length;
        const d = await page.evaluate(describeRegion, { index: r.index, pause: PAUSE.source, pauseAll: PAUSE_ALL.source }).catch(() => null);
        if (!d || d.paused) continue;
        const swaps = changes('elements'), edits = changes('text');
        // Still changing after more than half a minute, so it lasts more than five seconds.
        const times = (n) => `${n} time${n === 1 ? '' : 's'}`;
        if (swaps >= 1 && !(r.kinds.length === 1 && r.kinds[0] === 'text')) {
          issues.push(issue('carousel-no-pause', { selector: d.selector, html: d.html, message: `this part of the page switches what it shows by itself (${times(swaps)} in ${CONFIRM_STEPS} seconds, still going after half a minute) and has no pause or stop control` }));
        } else if (edits >= 1) {
          issues.push(issue('auto-update-no-pause', { selector: d.selector, html: d.html, message: `the text here ("${d.label}") updates by itself (${times(edits)} in ${CONFIRM_STEPS} seconds, still going after half a minute) with no pause, stop or hide control` }));
        } else if (r.kinds.includes('attributes') && d.busy >= 3) {
          issues.push(issue('animation-no-pause', { selector: d.selector, html: d.html, message: 'a script keeps moving or restyling this element (it was still changing after half a minute) and there is no pause control' }));
        }
      }
    }
  }

  await page.evaluate(() => window.__accessready_watch && window.__accessready_watch.observer.disconnect()).catch(() => {});

  // 4. On to twenty minutes.
  while (!gone && elapsed < TIMEOUT_MINUTES * 60_000) {
    await forward(TIMEOUT_STEP);
    await look();
  }

  if (animations.length) {
    let still = null;
    if (!gone) {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.waitForTimeout(100);
      still = new Set((await page.evaluate(collectAnimations, { pause: PAUSE.source, pauseAll: PAUSE_ALL.source }).catch(() => [])).map((a) => a.key));
    }
    for (const a of animations.slice(0, MAX_ANIMATIONS)) {
      const reduced = !still ? '' : still.has(a.key) ? '; it keeps running when reduced motion is asked for' : '; it stops when reduced motion is asked for, but visitors without that setting cannot stop it';
      issues.push(issue('animation-no-pause', {
        selector: a.selector, html: a.html,
        message: `the "${a.name}" animation (${a.properties.join(', ')}) runs ${a.forever ? 'forever' : `for ${a.seconds} seconds`} with no pause control${reduced}`,
      }));
    }
    if (animations.length > MAX_ANIMATIONS) notes.push(`${animations.length - MAX_ANIMATIONS} more long-running animations were not listed`);
  }

  // What happened, in order.
  const warned = timeline.find((t) => (t.warning && !first.warning && (t.extendButton || t.popups.some((p) => p.canExtend))) || t.popups.some((p) => p.canExtend && new RegExp(WARNING.source, 'i').test(p.text)))
    || dialogs.find((d) => WARNING.test(d.message) || d.type === 'confirm');
  const expiredAt = timeline.find((t) => t.expired && !first.expired);
  if (gone) {
    const what = gone.reload ? 'reloads itself' : 'leaves for another address by itself';
    issues.push(warned
      ? issue('page-changes-by-itself', { selector: 'html', kind: 'likely', message: `the page ${what} after about ${minutes(gone.at)}, after warning first; check the warning gives at least 20 seconds and a way to extend the time` })
      : issue('page-changes-by-itself', { selector: 'html', message: `the page ${what} after about ${minutes(gone.at)} without anyone touching it, and gave no warning with a way to stay` }));
  } else if (expiredAt) {
    issues.push(warned
      ? issue('timeout-warned', { selector: 'html', message: `the page warns, then times out after about ${minutes(expiredAt.at)} of inactivity${first.mentionsLimit ? '' : '; nothing on the page says up front how long that is'}` })
      : issue('timeout-no-warning', { selector: 'html', message: `the page says the session has expired after about ${minutes(expiredAt.at)} of inactivity, and showed no warning with a way to extend it before that` }));
  }
  if (gone && warned) {
    // Reported above as likely for 2.2.1; at AAA any time limit at all is the finding.
    issues.push(issue('timeout-warned', { selector: 'html', message: `the page warns, then ${gone.reload ? 'reloads' : 'moves on'} after about ${minutes(gone.at)}${first.mentionsLimit ? '' : '; nothing on the page says up front how long that is'}` }));
  }

  // Popups that opened with nobody touching the page, other than the timeout warning itself.
  const timeoutPopup = (p) => new RegExp(`${EXPIRED.source}|${WARNING.source}`, 'i').test(p.text);
  const popups = timeline.flatMap((t) => t.popups.map((p) => ({ ...p, at: t.at }))).filter((p) => !timeoutPopup(p));
  for (const p of popups.slice(0, 2)) {
    const id = ctx.level === 'AAA' ? 'timed-popup' : 'timed-popup-note';
    issues.push(issue(id, { selector: p.selector, html: p.html, message: `a popup${p.name ? ` ("${p.name}")` : ''} opened by itself after about ${minutes(p.at)}, while nobody was using the page` }));
  }
  for (const d of dialogs.filter((x) => !WARNING.test(x.message) && !EXPIRED.test(x.message)).slice(0, 1)) {
    const id = ctx.level === 'AAA' ? 'timed-popup' : 'timed-popup-note';
    issues.push(issue(id, { selector: 'html', message: `a browser ${d.type} ("${d.message.slice(0, 60)}") opened by itself after about ${minutes(d.at)}` }));
  }
  return { issues, notes };
}

// 2.3.3 at level AAA: with reduced motion asked for (as every audit does), scroll and hover
// and see whether anything still moves. A fresh copy, since this scrolls and hovers.
async function checkInteractionMotion(page, ctx) {
  if (ctx.level !== 'AAA') return [];
  const p = await ctx.fresh();
  await p.evaluate(() => {
    const log = [];
    const MOVE = /^(transform|translate|scale|rotate|top|left|right|bottom|inset|margin|offset|background-position)/;
    const size = (el) => { const r = el.getBoundingClientRect(); return r.width * r.height; };
    const shift = (from, to) => {
      try {
        const a = new DOMMatrix(from === 'none' ? undefined : from), b = new DOMMatrix(to === 'none' ? undefined : to);
        const scale = Math.abs(Math.hypot(a.a, a.b) - Math.hypot(b.a, b.b));
        const turn = Math.abs(Math.atan2(a.b, a.a) - Math.atan2(b.b, b.a)) * 180 / Math.PI;
        return Math.hypot(a.e - b.e, a.f - b.f) >= 16 || scale >= 0.1 || turn >= 10;
      } catch { return true; }
    };
    const px = (from, to) => Math.abs((parseFloat(from) || 0) - (parseFloat(to) || 0)) >= 16;
    const record = (el, anim, prop) => {
      if (!el || el.nodeType !== 1 || size(el) < 2500) return;
      const frames = anim?.effect?.getKeyframes?.() || [];
      const values = frames.map((f) => f[prop.replace(/-([a-z])/g, (_, c) => c.toUpperCase())] ?? f[prop]).filter((v) => v !== undefined);
      if (values.length >= 2) {
        const big = /^transform|^translate|^scale|^rotate/.test(prop) ? values.some((v) => shift(values[0], v)) : values.some((v) => px(values[0], v));
        if (!big) return;
      }
      log.push({ el, prop });
    };
    document.addEventListener('transitionrun', (e) => {
      if (!MOVE.test(e.propertyName)) return;
      const anim = e.target.getAnimations().find((a) => a.transitionProperty === e.propertyName);
      record(e.target, anim, e.propertyName);
    }, true);
    document.addEventListener('animationstart', (e) => {
      const anim = e.target.getAnimations().find((a) => a.animationName === e.animationName);
      const props = new Set((anim?.effect?.getKeyframes?.() || []).flatMap((f) => Object.keys(f)));
      const prop = [...props].map((k) => k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())).find((k) => MOVE.test(k));
      if (prop) record(e.target, anim, prop);
    }, true);
    // Script-driven parallax: inline transforms that change while the page scrolls.
    new MutationObserver((records) => {
      for (const r of records) {
        const was = ((r.oldValue || '').match(/transform:\s*([^;]+)/) || [])[1] || 'none';
        const now = r.target.style.transform || 'none';
        if (now !== was && shift(was, now) && size(r.target) >= 2500) log.push({ el: r.target, prop: 'transform (script)' });
      }
    }).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['style'], attributeOldValue: true });
    Object.defineProperty(window, '__accessready_motion', { value: log, configurable: true });
  });

  const { height } = p.viewportSize();
  for (let i = 0; i < 4; i++) {
    await p.mouse.move(200, Math.round(height / 2));
    await p.mouse.wheel(0, Math.round(height * 0.8));
    await p.waitForTimeout(250);
  }
  await p.evaluate(() => window.scrollTo(0, 0));
  await p.waitForTimeout(150);
  // Hover what is on the first screen, as a visitor moving the mouse around would.
  const targets = await p.$$eval('a[href], button, [role=button], [class*=card]', (els) => els.map((el, i) => {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { i, x: r.left + r.width / 2, y: r.top + r.height / 2, ok: r.width > 4 && r.height > 4 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth && cs.visibility !== 'hidden' };
  }).filter((t) => t.ok).slice(0, 8));
  for (const t of targets) {
    await p.mouse.move(t.x, t.y);
    await p.waitForTimeout(120);
  }
  const found = await p.evaluate(() => {
    const seen = new Map();
    for (const { el, prop } of window.__accessready_motion) {
      if (!el.isConnected || seen.has(el)) continue;
      seen.set(el, {
        prop,
        selector: el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.') : ''),
        html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
    return [...seen.values()];
  });
  if (!found.length) return [];
  return [issue('motion-on-interaction', {
    selector: found[0].selector, html: found[0].html,
    message: `${found.length} element${found.length === 1 ? '' : 's'} still move${found.length === 1 ? 's' : ''} when the page is scrolled or hovered with reduced motion asked for (${found.slice(0, 3).map((f) => `${f.selector}: ${f.prop}`).join('; ')})`,
  })];
}

export const probes = [
  { name: 'motion and timing', phase: 'operate', clock: true, reducedMotion: 'no-preference', run: checkMotion },
  { name: 'motion from interaction', phase: 'operate', run: checkInteractionMotion },
];

export const rules = {
  'animation-no-pause': {
    title: 'Animation runs on with no way to pause it', criteria: ['2.2.2'], kinds: ['likely'],
    covers: 'CSS animations that run for more than five seconds, and elements a script keeps moving for more than half a minute, with no pause or stop control nearby or for the whole page. Loading indicators are left out. Says whether the animation also stops when reduced motion is asked for.',
    why: 'Movement that never stops pulls attention away from reading. For people with attention deficits or vestibular disorders it can make the page unusable, and they need a way to stop it.',
  },
  'carousel-no-pause': {
    title: 'Carousel moves by itself with no pause control', criteria: ['2.2.2'], kinds: ['failure'],
    covers: 'Parts of the page that switch what they show by themselves, still going after half a minute on a clock moved forward a second at a time, with no pause or stop button.',
    why: 'Slides that change by themselves move on before slow readers, screen magnifier users and people with cognitive disabilities have finished reading, and pull attention from everything else.',
  },
  'auto-update-no-pause': {
    title: 'Content updates by itself with no pause control', criteria: ['2.2.2'], kinds: ['likely'],
    covers: 'Text that keeps changing by itself (tickers, feeds, counters) with no pause, stop or hide control.',
    why: 'Text that rewrites itself is hard to read for people who read slowly, and screen reader users can lose their place in it.',
  },
  flashing: {
    title: 'Content flashes more than three times a second', criteria: ['2.3.1', '2.3.2'], kinds: ['failure'], impact: 'critical',
    covers: 'Three seconds of the screen recorded in Chromium and measured pixel by pixel against the WCAG general and red flash thresholds: more than three flashes in a second over more than a quarter of a 341 x 256 pixel area.',
    why: 'Flashing above these limits can cause seizures in people with photosensitive epilepsy. It is one of the few accessibility problems that can do physical harm.',
  },
  'flashing-small': {
    title: 'Something flashes more than three times a second', criteria: ['2.3.2'], kinds: ['failure'],
    covers: 'At level AAA, anything that flashes more than three times a second, however small.',
    why: 'Even small flashing areas can affect people who are very sensitive to flashing light.',
  },
  'page-changes-by-itself': {
    title: 'Page reloads or moves on by itself', criteria: ['2.2.1', '2.2.3', '2.2.4'], kinds: ['failure', 'likely'],
    covers: 'Pages that reload or go to another address by themselves within 20 minutes, on a clock moved forward while nobody uses the page. Likely rather than failed when a warning came first.',
    why: 'People who read slowly, use a screen reader or switch access, or step away for a moment lose their place, and anything they typed, when the page changes under them.',
  },
  'timeout-no-warning': {
    title: 'Session expires without warning', criteria: ['2.2.1', '2.2.3'], kinds: ['likely'],
    covers: 'Pages that start saying the session has expired, or that the visitor was logged out, within 20 minutes of nobody using them, with no warning offering more time before that.',
    why: 'People who need longer to read, type or find their way, including many disabled people, run out of time and lose their work unless they are warned and can ask for more.',
  },
  'timeout-warned': {
    title: 'Page has a time limit', criteria: ['2.2.3', '2.2.6'], kinds: ['likely'],
    covers: 'At level AAA, pages that time out within 20 minutes even though they warn first, and whether the page says up front how long inactivity can last.',
    why: 'At the highest level, timing should not be part of the task at all, and people should be told before they start how long they can step away without losing data.',
  },
  'timed-popup': {
    title: 'Popup interrupts by itself', criteria: ['2.2.4'], kinds: ['likely'],
    covers: 'At level AAA, popups and browser dialogs that open by themselves while nobody uses the page.',
    why: 'Interruptions nobody asked for break concentration and pull screen reader focus away. People with attention and memory difficulties may not find their way back.',
  },
  'timed-popup-note': {
    title: 'Popup opens by itself', criteria: [], kinds: ['advice'],
    covers: 'Popups and browser dialogs that open by themselves while nobody uses the page (a note below level AAA).',
    why: 'A popup that opens by itself interrupts whatever the visitor was doing and can move screen reader focus without warning.',
  },
  'motion-on-interaction': {
    title: 'Motion on scroll or hover ignores reduced motion', criteria: ['2.3.3'], kinds: ['likely'],
    covers: 'At level AAA, elements that still slide, scale or rotate (CSS transitions and animations, or scripts setting transforms) when the page is scrolled or hovered with reduced motion asked for.',
    why: 'Motion tied to scrolling, such as parallax and elements sliding in, can cause dizziness and nausea in people with vestibular disorders. They ask for reduced motion to avoid exactly this.',
  },
};
