// Checks that need a real, rendered page rather than a rule engine.

// 2.2.2 Pause, Stop, Hide: a video that starts by itself and loops, or runs longer than five
// seconds, needs a way to pause it.
export async function checkMovingVideo(page) {
  return page.evaluate(() => {
    const out = [];
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
    const nameOf = (b) => (b.getAttribute('aria-label') || b.textContent || b.getAttribute('title') || '').trim();
    for (const v of document.querySelectorAll('video')) {
      if (!shown(v) || v.controls) continue;
      const moving = v.autoplay || !v.paused;
      if (!moving || (!v.loop && v.duration && v.duration <= 5)) continue;
      const scope = v.parentElement?.parentElement || document.body;
      const hasControl = [...scope.querySelectorAll('button, [role=button]')].some((b) => /pause|play|stop/i.test(nameOf(b)));
      if (hasControl) continue;
      out.push({
        id: 'moving-video', source: 'accessready', kind: 'failure', wcag: ['2.2.2'], impact: 'serious',
        title: 'Video plays by itself with no pause control',
        message: `video ${v.loop ? 'loops' : 'autoplays'} and has no controls or pause button near it`,
        selector: v.id ? `#${CSS.escape(v.id)}` : 'video',
        html: v.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
      });
    }
    return out;
  });
}

// 1.4.10 Reflow: at 320 CSS pixels wide (a 1280px screen zoomed to 400%) the page must not
// scroll sideways. Resizes the page, so run it last.
export async function checkReflow(page) {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.waitForTimeout(400);
  return page.evaluate(() => {
    const overflow = document.documentElement.scrollWidth - innerWidth;
    if (overflow <= 0) return [];
    // Point at the elements sticking out furthest, skipping ones that only contain a wider child.
    const wide = [...document.body.querySelectorAll('*')]
      .map((el) => ({ el, right: el.getBoundingClientRect().right }))
      .filter(({ el, right }) => right > innerWidth + 1 && getComputedStyle(el).position !== 'fixed')
      .filter(({ el, right }) => ![...el.children].some((c) => c.getBoundingClientRect().right >= right))
      .sort((a, b) => b.right - a.right)
      .slice(0, 3);
    const describe = (el) => el.id ? `#${el.id}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
    const first = wide[0]?.el;
    return [{
      id: 'reflow', source: 'accessready', kind: 'failure', wcag: ['1.4.10'], impact: 'serious',
      title: 'Page scrolls sideways at 320px wide',
      message: `${overflow}px of sideways scroll at 320px wide` + (wide.length ? `; widest: ${wide.map(({ el }) => describe(el)).join(', ')}` : ''),
      selector: first ? describe(first) : 'html',
      html: first ? first.outerHTML.replace(/\s+/g, ' ').slice(0, 160) : '',
    }];
  });
}

// Adds CSS through the CSSOM instead of a <style> tag, so a page whose Content Security
// Policy forbids inline styles is measured the same way as any other. Returns a remover.
export async function addStyles(page, css) {
  await page.evaluate((text) => {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    (window.__accessreadySheets ||= []).push(sheet);
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  }, css);
  return () => page.evaluate(() => {
    const sheet = window.__accessreadySheets.pop();
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
  }).catch(() => {});
}

// 1.4.12 Text Spacing: people with dyslexia or low vision widen line, letter and word
// spacing with their own styles. Nothing may be cut off when they do. This applies the
// spacing WCAG names and reports text that is clipped afterwards and was not before.
const SPACING = '* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; } p { margin-bottom: 2em !important; }';

function clippedText(mark) {
  const out = [];
  for (const el of document.body.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    const hidesY = /hidden|clip/.test(cs.overflowY), hidesX = /hidden|clip/.test(cs.overflowX);
    if (!hidesX && !hidesY) continue;
    if (el.clientWidth <= 1 || el.clientHeight <= 1 || cs.visibility === 'hidden') continue; // screen-reader-only text
    if (!(el.innerText || '').trim()) continue;
    const cut = (hidesY && el.scrollHeight - el.clientHeight > 1) || (hidesX && el.scrollWidth - el.clientWidth > 1);
    if (!cut) continue;
    if (mark) { el.setAttribute('data-accessready-clipped', ''); continue; }
    if (el.hasAttribute('data-accessready-clipped')) continue;
    out.push({ el });
  }
  if (mark) return [];
  // Report the innermost clipped box, not every ancestor that also clips.
  const found = out.filter(({ el }) => !out.some((o) => o.el !== el && el.contains(o.el)));
  const describe = (el) => el.id ? `#${CSS.escape(el.id)}` : el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '');
  return found.map(({ el }) => ({
    id: 'text-spacing', source: 'accessready', kind: 'failure', wcag: ['1.4.12'], impact: 'serious',
    title: 'Text is cut off when spacing is increased',
    message: `"${(el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 40)}" is clipped once line, letter and word spacing are widened`,
    selector: describe(el),
    html: el.outerHTML.replace(/\s+/g, ' ').slice(0, 160),
  }));
}

export async function checkTextSpacing(page) {
  await page.evaluate(clippedText, true);
  const remove = await addStyles(page, SPACING);
  await page.waitForTimeout(150);
  const issues = await page.evaluate(clippedText, false);
  await remove();
  await page.evaluate(() => document.querySelectorAll('[data-accessready-clipped]').forEach((el) => el.removeAttribute('data-accessready-clipped')));
  await page.waitForTimeout(100);
  return issues;
}

export const rules = {
  'moving-video': {
    title: 'Video plays by itself with no pause control', criteria: ['2.2.2'], kinds: ['failure'],
    covers: 'Video that plays by itself with no pause control.',
    why: 'Video that starts by itself and cannot be paused distracts people with attention or vestibular conditions, and can make the rest of the page unusable for them.',
  },
  reflow: {
    title: 'Page scrolls sideways at 320px wide', criteria: ['1.4.10'], kinds: ['failure'],
    covers: 'Sideways scrolling at 320px wide, with the widest element named.',
    why: 'People with low vision zoom the page to 400%. If the page then scrolls sideways, they have to scroll in two directions to read each line.',
  },
  'text-spacing': {
    title: 'Text is cut off when spacing is increased', criteria: ['1.4.12'], kinds: ['failure'],
    covers: 'Text that is cut off once line, letter, word and paragraph spacing are widened to the values WCAG names.',
    why: 'People with dyslexia or low vision widen the spacing between lines, letters and words to make text readable. Boxes with a fixed size then cut the text off.',
  },
};
