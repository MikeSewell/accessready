// How things look: text that stops growing or gets cut off when the page is zoomed, pages
// that only work one way up, pictures of text, the contrast of form fields and icon buttons,
// and, at level AAA, the shape of body text.
import { mkdirSync, existsSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { issue } from './index.mjs';
import { addStyles } from './layout.mjs';

const ZOOM_SETTLE = 250;
const MAX_TEXT = 1500;
const MAX_REPORTED = 5;
const MAX_OCR = 6;
const OCR_MIN = { width: 80, height: 24, area: 6000 };
const OCR_CONFIDENCE = 70;
const OCR_IDLE = 3000;
const OCR_MAX_SIDE = 800;        // larger pictures are scaled down first; their text is large too
const OCR_DOWNLOAD_TIMEOUT = 60_000;
// The English model tesseract.js itself downloads by default.
const OCR_DATA = 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz';


// In the page: wait for transitions a resize started (menus folding away, say) to finish,
// so what is measured is where the page comes to rest.
function settle(max) {
  const running = document.getAnimations().filter((a) => a instanceof CSSTransition && a.playState === 'running');
  return Promise.race([
    Promise.allSettled(running.map((a) => a.finished)),
    new Promise((done) => setTimeout(done, max)),
  ]).then(() => new Promise((done) => requestAnimationFrame(() => done())));
}

async function resize(page, size) {
  await page.setViewportSize(size);
  await page.waitForTimeout(ZOOM_SETTLE);
  await page.evaluate(settle, 1000).catch(() => {});
}

// ---------------------------------------------------------------------------------------
// 1.4.4 Resize Text and 1.3.4 Orientation. Both resize the window, so they share one fresh
// copy of the page. Zooming a browser to 200% lays the page out exactly as a window half as
// wide and half as tall at 100%, so that is how zoom is reproduced here, in every browser.

// In the page: remember each text element's font size and which text boxes already clip or
// overlap, so only what zoom changes is reported.
function zoomBaseline(max) {
  // Text inside a closed <details> or under content-visibility is laid out but not drawn.
  const rendered = (el) => (el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) : true);
  const texts = [];
  for (const el of document.body.querySelectorAll('*')) {
    if (texts.length >= max) break;
    if (/^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|OPTION)$/i.test(el.tagName) || el.closest('svg')) continue;
    const own = [...el.childNodes].some((n) => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.textContent));
    if (!own) continue;
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || !rendered(el)) continue;
    el.setAttribute('data-accessready-text', String(texts.length));
    texts.push(parseFloat(cs.fontSize));
  }
  window.__accessready_zoom = { sizes: texts, clipped: new Set(), overlaps: new Set() };
}

// In the page: text boxes that cut their text off, and pairs of text runs drawn on top of
// each other. `record` stores them as the starting state; otherwise only new ones return.
function zoomState(record) {
  const z = window.__accessready_zoom;
  const rendered = (el) => (el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) : true);
  const describe = (el) => el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.') : '');
  // A box that cuts text off shows part of it: a line or a word runs past its edge. A box
  // that hides whole elements (a folded accordion, a closed menu) is doing that on purpose.
  const partlyCut = (box) => {
    const r = box.getBoundingClientRect();
    const inner = { left: r.left + box.clientLeft, top: r.top + box.clientTop, right: r.left + box.clientLeft + box.clientWidth, bottom: r.top + box.clientTop + box.clientHeight };
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[\p{L}\p{N}]/u.test(n.textContent) || !rendered(n.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      let inside = false, outside = false;
      for (const l of range.getClientRects()) {
        if (l.width < 1 || l.height < 1) continue;
        const within = l.left >= inner.left - 1 && l.right <= inner.right + 1 && l.top >= inner.top - 1 && l.bottom <= inner.bottom + 1;
        const apart = l.right <= inner.left || l.left >= inner.right || l.bottom <= inner.top || l.top >= inner.bottom;
        if (within) inside = true; else if (apart) outside = true; else return true; // a line across the edge
        if (inside && outside) return true; // some lines shown, the rest cut away
      }
    }
    return false;
  };
  const clipped = [];
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const hidesY = /hidden|clip/.test(cs.overflowY), hidesX = /hidden|clip/.test(cs.overflowX);
    if (!hidesX && !hidesY) continue;
    if (el.clientWidth <= 1 || el.clientHeight <= 1 || cs.visibility === 'hidden') continue; // screen-reader-only text
    if (!(el.innerText || '').trim() || !rendered(el)) continue;
    // Truncation the design asks for (an ellipsis, a line clamp) is a choice, not an accident.
    if (cs.textOverflow === 'ellipsis' || (cs.webkitLineClamp && cs.webkitLineClamp !== 'none')) continue;
    const cut = (hidesY && el.scrollHeight - el.clientHeight > 2) || (hidesX && el.scrollWidth - el.clientWidth > 2);
    if (cut && partlyCut(el)) clipped.push(el);
  }
  const lines = [];
  for (const el of document.querySelectorAll('[data-accessready-text]')) {
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || !rendered(el)) continue;
    for (const n of el.childNodes) {
      if (n.nodeType !== 3 || !/[\p{L}\p{N}]/u.test(n.textContent)) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      for (const r of range.getClientRects()) if (r.width > 2 && r.height > 2) lines.push({ el, r });
    }
    if (lines.length > 3000) break;
  }
  lines.sort((a, b) => a.r.top - b.r.top);
  const overlaps = [];
  for (let i = 0; i < lines.length; i++) {
    const a = lines[i];
    for (let j = i + 1; j < lines.length && lines[j].r.top < a.r.bottom; j++) {
      const b = lines[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
      const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
      // Lines that touch, or share a pixel of descender, are not covering each other.
      if (w < 4 || h < Math.min(a.r.height, b.r.height) * 0.4) continue;
      const key = a.el.getAttribute('data-accessready-text') + '|' + b.el.getAttribute('data-accessready-text');
      overlaps.push({ key, a: a.el, b: b.el });
    }
  }
  if (record) {
    for (const el of clipped) z.clipped.add(el);
    for (const o of overlaps) z.overlaps.add(o.key);
    return null;
  }
  const text = (el) => (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
  const seen = new Set();
  return {
    clipped: clipped.filter((el) => !z.clipped.has(el) && !clipped.some((o) => o !== el && el.contains(o)))
      .map((el) => ({ selector: describe(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160), text: text(el) })),
    overlaps: overlaps.filter((o) => !z.overlaps.has(o.key) && !seen.has(o.key) && seen.add(o.key))
      .map((o) => ({ selector: describe(o.a), html: o.a.outerHTML.replace(/\s+/g, ' ').slice(0, 160), text: text(o.a), other: text(o.b) })),
    sideways: document.documentElement.scrollWidth - innerWidth,
  };
}

// In the page: each text element's font size now, against the size it started at.
function fontSizes() {
  const z = window.__accessready_zoom;
  const rendered = (el) => (el.checkVisibility ? el.checkVisibility({ contentVisibilityAuto: true, visibilityProperty: true, opacityProperty: true }) : true);
  const out = {};
  for (const el of document.querySelectorAll('[data-accessready-text]')) {
    const i = +el.getAttribute('data-accessready-text');
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || cs.visibility === 'hidden' || !rendered(el)) continue;
    out[i] = { size: parseFloat(cs.fontSize), was: z.sizes[i] };
  }
  return out;
}

async function checkZoom(page, ctx) {
  const issues = [];
  const { width, height } = ctx.viewport;
  await page.evaluate(zoomBaseline, MAX_TEXT);
  await page.evaluate(zoomState, true);
  await resize(page, { width: Math.round(width / 2), height: Math.round(height / 2) });
  const at200 = await page.evaluate(zoomState, false);
  const sizes200 = await page.evaluate(fontSizes);
  await resize(page, { width: Math.round(width / 4), height: Math.round(height / 4) });
  const sizes400 = await page.evaluate(fontSizes);

  // Text whose size is tied to the window (vw units, scripts that fit text to the width)
  // shrinks in CSS pixels exactly as fast as zoom enlarges it, so it never gets bigger. Text
  // that a responsive design makes smaller at 200% but that grows at 400% is fine.
  const stuck = Object.keys(sizes200).filter((i) => {
    const a = sizes200[i], b = sizes400[i];
    if (!b || !a.was) return false;
    return Math.max(2 * a.size, 4 * b.size) / a.was < 1.1;
  });
  if (stuck.length) {
    const found = await page.evaluate((ids) => {
      const sel = (el) => el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.') : '');
      return ids.map((i) => [i, document.querySelector(`[data-accessready-text="${i}"]`)]).filter(([, el]) => el)
        .map(([i, el]) => ({ i, selector: sel(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160), text: (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40) }));
    }, stuck.slice(0, MAX_REPORTED));
    for (const f of found) {
      const was = sizes200[f.i].was;
      issues.push(issue('text-does-not-scale', { selector: f.selector, html: f.html, message: `"${f.text}" stays about ${Math.round(was)}px on screen when the page is zoomed to 200% and 400%; its size is tied to the window width (for example vw units), so zoom cannot enlarge it` }));
    }
    if (stuck.length > MAX_REPORTED) issues.at(-1).message += ` (${stuck.length - MAX_REPORTED} more elements like it)`;
  }
  for (const c of at200.clipped.slice(0, MAX_REPORTED)) {
    issues.push(issue('zoom-clipped-text', { selector: c.selector, html: c.html, message: `"${c.text}" is cut off at 200% zoom and was not at 100%` }));
  }
  for (const o of at200.overlaps.slice(0, MAX_REPORTED)) {
    issues.push(issue('zoom-overlapping-text', { selector: o.selector, html: o.html, message: `"${o.text}" is drawn over "${o.other}" at 200% zoom and was not at 100%` }));
  }
  if (at200.sideways > 0) {
    issues.push(issue('zoom-sideways-scroll', { selector: 'html', message: `at 200% zoom in a ${width}px wide window the page scrolls sideways by ${at200.sideways}px` }));
  }
  return issues;
}

// In the page: what can be read, and whether the page asks to be turned around.
function orientationState(rotate) {
  const ROTATE = new RegExp(rotate, 'i');
  const text = (document.body?.innerText || '').replace(/\s+/g, ' ').trim();
  const main = document.querySelector('main, [role=main]') || document.body;
  const r = main.getBoundingClientRect(), cs = getComputedStyle(main);
  return { length: text.length, rotate: (text.match(ROTATE) || [''])[0], mainShown: r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' };
}

const ROTATE = /rotate your (device|phone|screen|tablet)|turn your (device|phone|screen|tablet)( around| sideways)?|(switch|change|flip) to (portrait|landscape)|(best|only) (viewed|seen|works|available) in (portrait|landscape)|please (use|hold) (your (device|phone) )?in (portrait|landscape)|(portrait|landscape) (mode|orientation) (only|is required|required)/i;

async function checkOrientation(page, ctx) {
  const { width, height } = ctx.viewport;
  const portrait = await page.evaluate(orientationState, ROTATE.source);
  await resize(page, { width: height, height: width });
  const landscape = await page.evaluate(orientationState, ROTATE.source);
  const out = [];
  for (const [name, other, state, base] of [['landscape', 'portrait', landscape, portrait], ['portrait', 'landscape', portrait, landscape]]) {
    if (state.rotate && !base.rotate) {
      out.push(issue('orientation-locked', { selector: 'body', message: `held ${name}, the page says "${state.rotate}" instead of showing its content` }));
    } else if (base.length >= 200 && (state.length < base.length * 0.1 || (!state.mainShown && base.mainShown))) {
      out.push(issue('orientation-locked', { selector: 'body', message: `held ${name}, the page hides its content: ${state.length} characters of text against ${base.length} held ${other}` }));
    }
  }
  return out.slice(0, 1);
}

// One fresh copy for both: phones are turned, desktop windows are zoomed.
async function checkResize(page, ctx) {
  return ctx.viewport.isMobile ? checkOrientation(page, ctx) : checkZoom(page, ctx);
}

// ---------------------------------------------------------------------------------------
// 1.4.11 Non-text Contrast: form fields whose outline is too faint to find, and buttons
// that are only an icon drawn too faintly. Colors are read from computed styles, so each
// ratio is exact; anything over an image or gradient, or drawn with shadows, filters or
// gradients, is left alone.

// The browser's own look for each kind of field, from a blank page. WCAG exempts controls
// whose appearance the author has not changed.
const uaDefaults = new Map();
async function fieldDefaults(page, browserName) {
  if (uaDefaults.has(browserName)) return uaDefaults.get(browserName);
  const browser = page.context().browser();
  if (!browser) return null;
  const context = await browser.newContext();
  try {
    const blank = await context.newPage();
    const found = await blank.evaluate(() => {
      const out = {};
      const pick = (el) => { const cs = getComputedStyle(el); return ['Top', 'Right', 'Bottom', 'Left'].map((s) => `${cs[`border${s}Width`]} ${cs[`border${s}Style`]} ${cs[`border${s}Color`]}`).join(',') + '|' + cs.backgroundColor + '|' + cs.boxShadow; };
      for (const html of ['<input type="text">', '<input type="email">', '<input type="search">', '<input type="password">', '<input type="number">', '<input type="tel">', '<input type="url">', '<input type="date">', '<select><option>a</option></select>', '<textarea></textarea>']) {
        const holder = document.createElement('div');
        holder.innerHTML = html;
        document.body.append(holder);
        const el = holder.firstElementChild;
        out[el.tagName === 'INPUT' ? `input:${el.type}` : el.tagName.toLowerCase()] = pick(el);
      }
      return out;
    });
    uaDefaults.set(browserName, found);
    return found;
  } finally {
    await context.close().catch(() => {});
  }
}

function nonTextContrast(defaults) {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (x, y) => { const a = lum(x), b = lum(y); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
  // The solid color behind an element, or null when an image, gradient or dark canvas is
  // involved and there is no single color to measure against.
  const backgroundOf = (start) => {
    const layers = [];
    for (let n = start; n && n.nodeType === 1; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage !== 'none' || cs.filter !== 'none' || cs.mixBlendMode !== 'normal' || cs.backdropFilter && cs.backdropFilter !== 'none') return null;
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    let color;
    if (layers.length && layers[layers.length - 1].a >= 1) color = layers.pop();
    else if (/dark/.test(getComputedStyle(document.documentElement).colorScheme)) return null; // the canvas is not white
    else color = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) color = over(layers[i], color);
    return color;
  };
  const opacityOf = (el, stop) => { let o = 1; for (let n = el; n && n !== stop?.parentElement && n.nodeType === 1; n = n.parentElement) o *= +getComputedStyle(n).opacity; return o; };
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width >= 8 && r.height >= 8 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden=true], [inert]'); };
  const describe = (el) => {
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
  const out = [];

  const TEXTLIKE = /^(text|email|search|password|number|tel|url|date|datetime-local|month|week|time)$/;
  for (const el of document.querySelectorAll('input, select, textarea')) {
    if (out.length >= 20) break;
    if (el.tagName === 'INPUT' && !TEXTLIKE.test(el.type)) continue;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !shown(el)) continue;
    const cs = getComputedStyle(el);
    const key = el.tagName === 'INPUT' ? `input:${el.type}` : el.tagName.toLowerCase();
    const look = ['Top', 'Right', 'Bottom', 'Left'].map((s) => `${cs[`border${s}Width`]} ${cs[`border${s}Style`]} ${cs[`border${s}Color`]}`).join(',') + '|' + cs.backgroundColor + '|' + cs.boxShadow;
    if (defaults && defaults[key] === look) continue; // the browser's own look
    if (cs.boxShadow !== 'none' || cs.backgroundImage !== 'none') continue;
    const outside = backgroundOf(el.parentElement);
    const own = parse(cs.backgroundColor);
    if (!outside || !own) continue;
    const fill = over(own, outside);
    const opacity = opacityOf(el);
    let best = ratio(fill, outside), drawn = best > 1.1;
    for (const s of ['Top', 'Right', 'Bottom', 'Left']) {
      const c = parse(cs[`border${s}Color`]);
      if (!c || parseFloat(cs[`border${s}Width`]) < 1 || /none|hidden/.test(cs[`border${s}Style`])) continue;
      const color = over({ ...c, a: c.a * opacity }, fill);
      const r = ratio(color, outside);
      if (r > 1.1) drawn = true;
      best = Math.max(best, r);
    }
    if (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 1) {
      const c = parse(cs.outlineColor);
      if (c) best = Math.max(best, ratio(over(c, outside), outside));
    }
    // A field with no outline at all is a different question (can it be found?), left to a person.
    if (!drawn || best >= 3) continue;
    out.push({ type: 'field', selector: describe(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160), ratio: +best.toFixed(2), name: (el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.placeholder || el.name || '').trim().slice(0, 40) });
  }

  // Icon-only controls: no visible letters, drawn by an inline SVG or an icon font glyph.
  const visibleText = (el) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (!/[\p{L}\p{N}]/u.test(n.textContent)) continue;
      const p = n.parentElement, r = p.getBoundingClientRect(), cs = getComputedStyle(p);
      if (r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.clipPath === 'none' && cs.clip === 'auto' && !p.closest('svg')) return true;
    }
    return false;
  };
  let icons = 0;
  for (const el of document.querySelectorAll('button, a[href], [role=button], [role=link], summary')) {
    if (icons >= 20 || out.length >= 30) break;
    if (el.disabled || el.getAttribute('aria-disabled') === 'true' || !shown(el) || visibleText(el)) continue;
    if (el.querySelector('img, picture, canvas, video, input')) continue;
    const svg = [...el.querySelectorAll('svg')].find((s) => { const r = s.getBoundingClientRect(); return r.width >= 6 && r.height >= 6; });
    const colors = [];
    let unknown = false, behind = null;
    if (svg) {
      if (svg.querySelector('image, foreignObject, linearGradient, radialGradient, pattern, filter, mask')) continue;
      behind = backgroundOf(svg.parentElement);
      for (const shape of svg.querySelectorAll('path, circle, rect, ellipse, line, polyline, polygon, text, use')) {
        const r = shape.getBoundingClientRect();
        if (r.width < 1 && r.height < 1) continue;
        const cs = getComputedStyle(shape);
        if (cs.display === 'none' || cs.visibility === 'hidden') continue;
        const o = opacityOf(shape, el);
        for (const [paint, alpha] of [[cs.fill, +cs.fillOpacity], [cs.stroke, cs.strokeWidth && parseFloat(cs.strokeWidth) > 0 ? +cs.strokeOpacity : 0]]) {
          if (!paint || paint === 'none' || !alpha) continue;
          if (/url\(/.test(paint)) { unknown = true; continue; }
          const c = parse(paint);
          if (c && c.a * alpha * o > 0) colors.push({ ...c, a: c.a * alpha * o });
        }
      }
    } else {
      const glyph = (el.textContent || '').trim();
      const before = getComputedStyle(el, '::before');
      const icon = glyph && !/[\p{L}\p{N}]/u.test(glyph) ? el : before.content && !/^(none|normal|""|'')$/.test(before.content) && !/[\p{L}\p{N}]/u.test(before.content.replace(/\\[0-9a-f]+/gi, '')) ? 'before' : null;
      if (!icon) continue;
      const cs = icon === 'before' ? before : getComputedStyle(el);
      behind = backgroundOf(el);
      const c = parse(cs.color);
      if (c) colors.push({ ...c, a: c.a * opacityOf(el) });
    }
    if (unknown || !behind || !colors.length) continue;
    icons++;
    const best = Math.max(...colors.map((c) => ratio(over(c, behind), behind)));
    if (best >= 3) continue;
    out.push({ type: 'icon', selector: describe(el), html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160), ratio: +best.toFixed(2), name: (el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 40) });
  }
  return out;
}

async function checkNonTextContrast(page, ctx) {
  const defaults = await fieldDefaults(page, ctx.browserName).catch(() => null);
  const found = await page.evaluate(nonTextContrast, defaults);
  return found.map((f) => f.type === 'field'
    ? issue('faint-field-border', { selector: f.selector, html: f.html, message: `the outline of the field${f.name ? ` "${f.name}"` : ''} reaches ${f.ratio}:1 against the background around it; it needs 3:1` })
    : issue('faint-icon-control', { selector: f.selector, html: f.html, message: `the icon of the control${f.name ? ` "${f.name}"` : ''} reaches ${f.ratio}:1 against its background; it needs 3:1` }));
}

// ---------------------------------------------------------------------------------------
// 1.4.8 Visual Presentation, level AAA: the shape of body text. WCAG lets a browser or a site
// setting provide these, so each is a likely problem, reported once per page with a count.

function presentation() {
  const out = { justified: [], long: [], tight: [], spacing: [] };
  const latin = (s) => (s.match(/[A-Za-zÀ-ɏ]/g) || []).length > s.length * 0.5;
  const describe = (el) => el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).map((c) => CSS.escape(c)).join('.') : '');
  const blocks = [...document.querySelectorAll('p, li, dd, blockquote')].slice(0, 300);
  const info = new Map();
  for (const el of blocks) {
    if (el.closest('nav, header, footer, [role=navigation], [aria-hidden=true]')) continue;
    if ([...el.children].some((c) => /^(P|UL|OL|DIV|LI)$/.test(c.tagName))) continue; // containers, not paragraphs
    const text = (el.innerText || '').trim();
    if (text.length < 80) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || (el.checkVisibility && !el.checkVisibility({ contentVisibilityAuto: true }))) continue;
    const range = document.createRange();
    range.selectNodeContents(el);
    // One rectangle per line box, merged across inline elements on the same line.
    const rows = [];
    for (const r of range.getClientRects()) {
      if (r.width < 1) continue;
      const row = rows.find((x) => Math.abs(x.top - r.top) < r.height / 2);
      if (row) { row.left = Math.min(row.left, r.left); row.right = Math.max(row.right, r.right); } else rows.push({ top: r.top, left: r.left, right: r.right });
    }
    if (rows.length < 2) continue;
    const size = parseFloat(cs.fontSize);
    const lineHeight = cs.lineHeight === 'normal' ? size * 1.2 : parseFloat(cs.lineHeight);
    const sel = describe(el);
    info.set(el, { lineHeight });
    if (cs.textAlign === 'justify') out.justified.push(sel);
    if (lineHeight / size < 1.5 - 0.01) out.tight.push(sel);
    if (latin(text)) {
      const widths = rows.map((r) => r.right - r.left);
      const perPx = text.replace(/\s+/g, ' ').length / widths.reduce((a, b) => a + b, 0);
      if (Math.max(...widths) * perPx > 80) out.long.push(sel);
    }
  }
  // Paragraph spacing, baseline to baseline across the gap, against line spacing.
  for (const [el, { lineHeight }] of info) {
    const next = el.nextElementSibling;
    if (!next || !info.has(next) || el.tagName !== 'P' || next.tagName !== 'P') continue;
    const gap = next.getBoundingClientRect().top - el.getBoundingClientRect().bottom;
    if (gap + lineHeight < lineHeight * 1.5 - 0.5) out.spacing.push(describe(el));
  }
  return out;
}

async function checkPresentation(page, ctx) {
  if (ctx.level !== 'AAA') return [];
  const found = await page.evaluate(presentation);
  const report = (id, list, what) => (list.length ? [issue(id, { selector: list[0], message: `${list.length} paragraph${list.length === 1 ? '' : 's'} ${what}` })] : []);
  return [
    ...report('justified-text', found.justified, 'set in justified text (aligned to both edges)'),
    ...report('long-lines', found.long, 'with lines longer than 80 characters'),
    ...report('tight-line-height', found.tight, 'with line spacing under 1.5'),
    ...report('tight-paragraph-spacing', found.spacing, 'followed by another with less than 1.5 times the line spacing between them'),
  ];
}

// ---------------------------------------------------------------------------------------
// 1.4.5 and 1.4.9 Images of Text: pictures read with OCR (tesseract.js, English). The model
// is downloaded once into the user's cache folder; a failed download leaves a note.

let ocr = null; // { worker: Promise, timer }
const cacheDir = () => join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'accessready', 'ocr');

async function ocrData() {
  const dir = cacheDir();
  const file = join(dir, 'eng.traineddata');
  if (existsSync(file)) return dir;
  mkdirSync(dir, { recursive: true });
  const res = await fetch(OCR_DATA, { signal: AbortSignal.timeout(OCR_DOWNLOAD_TIMEOUT) });
  if (!res.ok) throw new Error(`the OCR language data download answered ${res.status}`);
  const gz = Buffer.from(await res.arrayBuffer());
  // Written under a temporary name first, so a run in parallel never reads half a file.
  const part = `${file}.${process.pid}.part`;
  writeFileSync(part, gunzipSync(gz));
  renameSync(part, file);
  return dir;
}

// One worker for the whole process. It is shut down after a few seconds without work, so a
// finished audit does not keep Node running.
async function ocrWorker() {
  if (!ocr) {
    ocr = {
      worker: (async () => {
        const cachePath = await ocrData();
        const { createWorker } = await import('tesseract.js');
        return createWorker('eng', 1, { cachePath, logger: () => {}, errorHandler: () => {} });
      })(),
    };
    // A failed download is not retried for every page of the audit.
    ocr.worker.catch(() => {});
  }
  clearTimeout(ocr.timer);
  return ocr.worker;
}
function ocrIdle() {
  if (!ocr) return;
  clearTimeout(ocr.timer);
  const current = ocr;
  current.timer = setTimeout(() => {
    if (ocr !== current) return;
    ocr = null;
    current.worker.then((w) => w.terminate()).catch(() => {});
  }, OCR_IDLE);
  current.timer.unref?.();
}

function imageCandidates({ min, max }) {
  const LOGO = /logo|brand|wordmark|logotype|emblem/i;
  const out = [];
  for (const img of document.querySelectorAll('img, input[type=image]')) {
    const r = img.getBoundingClientRect(), cs = getComputedStyle(img);
    if (r.width < min.width || r.height < min.height || r.width * r.height < min.area || cs.visibility === 'hidden' || cs.display === 'none' || +cs.opacity < 0.1) continue;
    // Logotypes are allowed by both criteria.
    const home = img.closest('a[href]');
    const homeLink = home && /^\/?$|^\/(index\.html?)?$/.test(new URL(home.href, location.href).pathname) && img.closest('header, nav, [role=banner]');
    if (LOGO.test(`${img.alt} ${img.src} ${img.id} ${typeof img.className === 'string' ? img.className : ''} ${img.parentElement?.className || ''}`) || homeLink) continue;
    out.push({ img, area: r.width * r.height });
  }
  out.sort((a, b) => b.area - a.area);
  const describe = (el) => {
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
  return {
    total: out.length,
    picked: out.slice(0, max).map(({ img }, i) => {
      img.setAttribute('data-accessready-ocr', String(i));
      return { index: i, selector: describe(img), html: img.outerHTML.replace(/\s+/g, ' ').slice(0, 160) };
    }),
  };
}

// Scales a screenshot down by a whole factor, averaging each block of pixels, so a large
// photo does not take seconds to read.
function shrink(buffer) {
  const png = PNG.sync.read(buffer);
  const f = Math.ceil(Math.max(png.width, png.height) / OCR_MAX_SIDE);
  if (f <= 1) return buffer;
  const out = new PNG({ width: Math.floor(png.width / f), height: Math.floor(png.height / f) });
  for (let y = 0; y < out.height; y++) for (let x = 0; x < out.width; x++) {
    const sum = [0, 0, 0, 0];
    for (let dy = 0; dy < f; dy++) for (let dx = 0; dx < f; dx++) {
      const i = ((y * f + dy) * png.width + x * f + dx) * 4;
      for (let c = 0; c < 4; c++) sum[c] += png.data[i + c];
    }
    for (let c = 0; c < 4; c++) out.data[(y * out.width + x) * 4 + c] = sum[c] / (f * f);
  }
  return PNG.sync.write(out);
}

// Words tesseract is sure of that look like words, not noise read from a photo.
export function wordsIn(data) {
  const words = (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  return words.filter((w) => w.confidence >= OCR_CONFIDENCE && /^[\p{L}\p{N}]/u.test(w.text) && (w.text.match(/[\p{L}\p{N}]/gu) || []).length >= 2 && (/[aeiouy]/i.test(w.text) || /^\d+$/.test(w.text)))
    .map((w) => w.text);
}

async function checkImagesOfText(page) {
  const { total, picked } = await page.evaluate(imageCandidates, { min: OCR_MIN, max: MAX_OCR });
  if (!picked.length) return [];
  const notes = [];
  const issues = [];
  let worker;
  try {
    worker = await ocrWorker();
  } catch (e) {
    await page.evaluate(() => document.querySelectorAll('[data-accessready-ocr]').forEach((el) => el.removeAttribute('data-accessready-ocr')));
    return { issues: [], notes: [`images were not read for text: ${String(e.message || e).split('\n')[0]}`] };
  }
  // Only the picture itself is read: everything else is hidden while it is photographed, so
  // text a page lays over an image (a caption, a menu, a banner) is not taken for part of it.
  const removeStyles = await addStyles(page, `body *:not([data-accessready-ocr-now]), body *::before, body *::after { visibility: hidden !important; } [data-accessready-ocr-now] { visibility: visible !important; }`);
  for (const p of picked) {
    const el = page.locator(`[data-accessready-ocr="${p.index}"]`).first();
    await el.evaluate((n) => n.setAttribute('data-accessready-ocr-now', '')).catch(() => {});
    const shot = await el.screenshot({ animations: 'disabled', timeout: 4000 }).catch(() => null);
    await el.evaluate((n) => n.removeAttribute('data-accessready-ocr-now')).catch(() => {});
    if (!shot) continue;
    const result = await worker.recognize(shrink(shot), {}, { blocks: true }).catch(() => null);
    if (!result) continue;
    const words = wordsIn(result.data);
    const letters = words.join('').length;
    if (words.length < 3 || letters < 10) continue;
    issues.push(issue('image-of-text', { selector: p.selector, html: p.html, message: `the image shows text ("${words.slice(0, 8).join(' ')}${words.length > 8 ? ' ...' : ''}"); unless it is a logo or the look of the text is essential, use real text styled with CSS` }));
  }
  await removeStyles();
  ocrIdle();
  await page.evaluate(() => {
    document.querySelectorAll('[data-accessready-ocr]').forEach((el) => el.removeAttribute('data-accessready-ocr'));
    window.scrollTo(0, 0);
  });
  if (total > MAX_OCR) notes.push(`read the ${MAX_OCR} largest images for text; ${total - MAX_OCR} smaller ones were not read`);
  return { issues, notes };
}

export const probes = [
  { name: 'non-text contrast', phase: 'look', run: checkNonTextContrast },
  { name: 'visual presentation', phase: 'look', run: checkPresentation },
  { name: 'images of text', phase: 'measure', run: checkImagesOfText },
  { name: 'zoom and orientation', phase: 'operate', isolated: true, run: checkResize },
];

export const rules = {
  'text-does-not-scale': {
    title: 'Text does not get bigger when zoomed', criteria: ['1.4.4'], kinds: ['failure'],
    covers: 'Text whose size on screen stays the same when the page is zoomed to 200% and to 400% (sizes tied to the window, such as vw units).',
    why: 'People with low vision zoom in to read. Text sized to the window shrinks back as they zoom, so it never gets any bigger for them.',
  },
  'zoom-clipped-text': {
    title: 'Text is cut off at 200% zoom', criteria: ['1.4.4'], kinds: ['likely'],
    covers: 'Text in a box that hides overflow and cuts the text off at 200% zoom, when it did not at 100%. Truncation the design asks for (ellipsis, line clamp) is left out.',
    why: 'People with low vision zoom to 200% to read. Boxes sized for normal text cut off the words they are trying to read.',
  },
  'zoom-overlapping-text': {
    title: 'Text overlaps other text at 200% zoom', criteria: ['1.4.4'], kinds: ['likely'],
    covers: 'Lines of text drawn over other text at 200% zoom that were apart at 100%.',
    why: 'Text drawn on top of other text cannot be read by anyone, and zooming in is how people with low vision read.',
  },
  'zoom-sideways-scroll': {
    title: 'Page scrolls sideways at 200% zoom', criteria: ['1.4.8'], kinds: ['likely'],
    covers: 'At level AAA, pages that scroll sideways at 200% zoom in a full desktop window.',
    why: 'Scrolling back and forth along every line is slow and tiring, and people with low vision who zoom lose their place doing it.',
  },
  'orientation-locked': {
    title: 'Page only works one way up', criteria: ['1.3.4'], kinds: ['failure'],
    covers: 'On a phone, pages that ask to be rotated, or hide almost all their text, when turned to landscape or back to portrait.',
    why: 'People who use a phone or tablet mounted on a wheelchair or bed cannot turn it around. A page locked to one orientation shuts them out.',
  },
  'faint-field-border': {
    title: 'Form field outline is too faint', criteria: ['1.4.11'], kinds: ['failure'],
    covers: 'Text fields, dropdowns and text areas whose border and fill all stay under 3:1 against the background around them. Fields left with the browser\'s own look are exempt, as WCAG allows.',
    why: 'People with low vision find a field by its outline. If the outline is too faint they cannot see where to click or type.',
  },
  'faint-icon-control': {
    title: 'Icon button is too faint', criteria: ['1.4.11'], kinds: ['failure'],
    covers: 'Buttons and links that show only an icon (an inline SVG or an icon font glyph) whose colors all stay under 3:1 against the background behind them.',
    why: 'When an icon is the only thing that says what a button does, people with low vision need to be able to see it.',
  },
  'justified-text': {
    title: 'Text is justified', criteria: ['1.4.8'], kinds: ['likely'],
    covers: 'At level AAA, paragraphs aligned to both edges.',
    why: 'Justified text leaves uneven gaps between words. People with dyslexia see rivers of white space running down the page and lose their place.',
  },
  'long-lines': {
    title: 'Lines are longer than 80 characters', criteria: ['1.4.8'], kinds: ['likely'],
    covers: 'At level AAA, paragraphs whose longest line holds more than 80 characters, measured from the rendered lines.',
    why: 'Long lines make it hard to find the start of the next one, which is a common difficulty for people with dyslexia and low vision.',
  },
  'tight-line-height': {
    title: 'Line spacing is under 1.5', criteria: ['1.4.8'], kinds: ['likely'],
    covers: 'At level AAA, paragraphs of two or more lines with line spacing under 1.5 times the font size.',
    why: 'Lines set close together run into each other for people with dyslexia and low vision.',
  },
  'tight-paragraph-spacing': {
    title: 'Paragraphs are too close together', criteria: ['1.4.8'], kinds: ['likely'],
    covers: 'At level AAA, consecutive paragraphs whose spacing, measured baseline to baseline across the gap, is less than 1.5 times their line spacing.',
    why: 'Clear space between paragraphs shows where one idea ends and the next begins, which helps people with cognitive and reading disabilities.',
  },
  'image-of-text': {
    title: 'Image shows text', criteria: ['1.4.5', '1.4.9'], kinds: ['likely'],
    covers: 'The largest images on the page (up to six) read with OCR in English; images showing several words are reported. Images named or placed as logos are left out.',
    why: 'Text in a picture cannot be resized, recolored, respaced or reflowed. People with low vision and dyslexia who adjust text to read it get nothing from those settings.',
  },
};
