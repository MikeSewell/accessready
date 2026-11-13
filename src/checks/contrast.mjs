// 1.4.3 Contrast for text that sits on a photo, gradient or video. A rules engine cannot
// compute a ratio there, so axe-core hands these back as "needs review". This measures them:
// hide the text, screenshot what is behind it, and compare the text color with every pixel.
//   every pixel fails  -> failure (no part of the text has enough contrast)
//   every pixel passes -> resolved, nothing to review
//   mixed              -> still for a person, with the measured range to go on
import { PNG } from 'pngjs';
import { addStyles } from './layout.mjs';

const MAX_ELEMENTS = 25;
const STEP = 2; // sample every other pixel; plenty for a background
const EDGE = 2;

const luminance = (r, g, b) => {
  const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

function describe(el) {
  const cs = getComputedStyle(el);
  const m = cs.color.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
  let opacity = 1;
  for (let n = el; n && n.nodeType === 1; n = n.parentElement) opacity *= +getComputedStyle(n).opacity;
  const size = parseFloat(cs.fontSize);
  return {
    color: { r: p[0], g: p[1], b: p[2], a: (p.length > 3 ? p[3] : 1) * opacity },
    // Text painted with a gradient or image has no single color to measure.
    painted: cs.backgroundClip === 'text' || cs.webkitBackgroundClip === 'text',
    needs: size >= 24 || (size >= 18.66 && +cs.fontWeight >= 700) ? 3 : 4.5,
    // A dropdown's text content is every option run together, and the browser draws it.
    text: el.tagName === 'SELECT' ? '' : (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
  };
}

const HIDE_TEXT = '[data-accessready-measure], [data-accessready-measure] * { color: transparent !important; -webkit-text-fill-color: transparent !important; text-shadow: none !important; caret-color: transparent !important; }';

export async function measureContrastOnImages(page, selectors) {
  const issues = [];
  const unresolved = [];
  let resolved = 0;
  const removeStyles = await addStyles(page, HIDE_TEXT);

  for (const selector of selectors.slice(0, MAX_ELEMENTS)) {
    const el = page.locator(selector).first();
    const info = await el.evaluate(describe, undefined, { timeout: 2000 }).catch(() => null);
    // Symbols with no letters or digits are icons. Icons fall under a different criterion
    // (1.4.11, 3:1) and are often decoration, so they are left for a person.
    if (!info || info.painted || !/[\p{L}\p{N}]/u.test(info.text)) { unresolved.push({ selector }); continue; }

    await el.evaluate((n) => n.setAttribute('data-accessready-measure', ''));
    const shot = await el.screenshot({ animations: 'disabled', timeout: 4000 }).catch(() => null);
    await el.evaluate((n) => n.removeAttribute('data-accessready-measure')).catch(() => {});
    if (!shot) { unresolved.push({ selector, text: info.text }); continue; }

    const png = PNG.sync.read(shot);
    const { r, g, b, a } = info.color;
    let worst = Infinity, best = 0;
    // Skip the outer edge: an element at a fractional position picks up a blended row of
    // whatever is next to it.
    const inset = Math.min(png.width, png.height) > 8 ? EDGE : 0;
    for (let y = inset; y < png.height - inset; y += STEP) for (let x = inset; x < png.width - inset; x += STEP) {
      const i = (y * png.width + x) * 4;
      const br = png.data[i], bg = png.data[i + 1], bb = png.data[i + 2];
      // Semi-transparent text blends with what is behind it.
      const c = ratio(luminance(r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a)), luminance(br, bg, bb));
      if (c < worst) worst = c;
      if (c > best) best = c;
    }

    if (best < info.needs) {
      issues.push({
        id: 'contrast-on-image', source: 'accessready', kind: 'failure', wcag: ['1.4.3'], impact: 'serious',
        title: 'Text over an image is too faint everywhere',
        message: `"${info.text}" reaches ${best.toFixed(2)}:1 at best against what is behind it; it needs ${info.needs}:1`,
        selector, html: info.html,
      });
    } else if (worst >= info.needs) {
      resolved++;
    } else {
      unresolved.push({ selector, text: info.text, worst: +worst.toFixed(2), best: +best.toFixed(2), needs: info.needs });
    }
  }
  for (const selector of selectors.slice(MAX_ELEMENTS)) unresolved.push({ selector });

  await removeStyles();
  return { issues, unresolved, resolved };
}

export const rules = {
  'contrast-on-image': {
    title: 'Text over an image is too faint everywhere', criteria: ['1.4.3'], kinds: ['failure'],
    covers: 'Text over images, gradients and video, measured from a screenshot with the text hidden.',
    why: 'Text without enough contrast against its background is hard or impossible to read for people with low vision, and for everyone in bright light.',
  },
};
