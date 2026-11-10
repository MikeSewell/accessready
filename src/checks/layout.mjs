// Two checks that need a real, rendered page rather than a rule engine.

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
        id: 'moving-video', source: 'focuswalk', kind: 'failure', wcag: ['2.2.2'], impact: 'serious',
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
      id: 'reflow', source: 'focuswalk', kind: 'failure', wcag: ['1.4.10'], impact: 'serious',
      title: 'Page scrolls sideways at 320px wide',
      message: `${overflow}px of sideways scroll at 320px wide` + (wide.length ? `; widest: ${wide.map(({ el }) => describe(el)).join(', ')}` : ''),
      selector: first ? describe(first) : 'html',
      html: first ? first.outerHTML.replace(/\s+/g, ' ').slice(0, 160) : '',
    }];
  });
}
