// What a person has to look at, collected so they do not have to hunt for it: every image
// with its description, every video, every form, and the links whose text says nothing.
// None of this is judged here. It feeds the "check by hand" section of the report and the
// checks that compare pages with each other.
export async function takeInventory(page) {
  return page.evaluate(() => {
    const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none'; };
    const clean = (s) => (s || '').trim().replace(/\s+/g, ' ');
    const hidden = (el) => !!el.closest('[aria-hidden=true], [hidden], [inert]');

    const images = [];
    for (const img of document.querySelectorAll('img')) {
      const r = img.getBoundingClientRect();
      if (!shown(img) || hidden(img) || r.width < 24 || r.height < 24) continue; // icons and tracking pixels
      images.push({ src: img.currentSrc || img.src, alt: img.hasAttribute('alt') ? clean(img.alt) : null, linked: !!img.closest('a[href]') });
    }

    const media = [];
    for (const v of document.querySelectorAll('video, audio')) {
      if (v.tagName === 'VIDEO' && !shown(v)) continue;
      media.push({
        kind: v.tagName.toLowerCase(), src: v.currentSrc || v.src || v.querySelector('source')?.src || '',
        captions: !!v.querySelector('track[kind=captions], track[kind=subtitles]'),
        // A muted, looping, control-less clip is decoration, not content that needs captions.
        background: v.tagName === 'VIDEO' && v.muted && v.loop && !v.controls,
      });
    }
    for (const f of document.querySelectorAll('iframe[src]')) {
      if (!/youtube\.com|youtu\.be|youtube-nocookie\.com|vimeo\.com|wistia\.|loom\.com|vidyard\.com/.test(f.src)) continue;
      media.push({ kind: 'embedded video', src: f.src, title: clean(f.title), captions: null, background: false });
    }

    const forms = [];
    const fieldsOf = (root) => [...root.querySelectorAll('input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), select, textarea')].filter(shown);
    for (const form of document.querySelectorAll('form')) {
      const fields = fieldsOf(form);
      if (!fields.length) continue;
      forms.push({
        name: clean(form.getAttribute('aria-label') || form.querySelector('legend, h1, h2, h3, h4')?.textContent || form.id || form.getAttribute('name') || ''),
        fields: fields.length,
        required: fields.filter((f) => f.required || f.getAttribute('aria-required') === 'true').length,
      });
    }

    const VAGUE = /^(click here|here|read more|learn more|more|more info|info|details|link|this|continue|go|view|see more|find out more)$/i;
    const vagueLinks = [];
    for (const a of document.querySelectorAll('a[href]')) {
      if (!shown(a) || hidden(a) || a.getAttribute('aria-label') || a.getAttribute('aria-labelledby') || a.title) continue;
      const text = clean(a.textContent);
      if (VAGUE.test(text)) vagueLinks.push({ text, href: a.href });
    }

    const headings = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].filter((h) => shown(h) && !hidden(h)).slice(0, 80)
      .map((h) => ({ level: +h.tagName[1], text: clean(h.textContent).slice(0, 90) }));

    // The main navigation, in order, for comparing pages with each other.
    const navEl = document.querySelector('header nav, nav, [role=navigation]');
    const nav = navEl ? [...navEl.querySelectorAll('a[href]')].map((a) => clean(a.textContent) || clean(a.getAttribute('aria-label'))).filter(Boolean) : [];

    return { title: clean(document.title), lang: document.documentElement.lang || '', images, media, forms, vagueLinks, headings, nav, contrast: [] };
  });
}
