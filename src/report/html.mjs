// A single self-contained HTML file written for the person who owns the site, not only the
// developer who fixes it. It has to pass its own audit; test/report.test.mjs checks that.
import { criterionLabel, WHY, UNDERSTANDING } from '../wcag.mjs';
import { coverage } from '../coverage.mjs';
import { pathOf } from './console.mjs';

const EXAMPLES = 5;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function groupByRule(pages, kind) {
  const groups = new Map();
  for (const page of pages) for (const issue of page.issues) {
    if (issue.kind !== kind) continue;
    if (!groups.has(issue.id)) groups.set(issue.id, { first: issue, items: [], pages: new Set() });
    const g = groups.get(issue.id);
    g.items.push({ issue, page });
    g.pages.add(page.url);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}

function ruleCard(group) {
  const { first, items, pages } = group;
  const why = WHY[first.id] || first.description || '';
  const link = first.helpUrl || UNDERSTANDING[first.id];
  const examples = items.slice(0, EXAMPLES).map(({ issue, page }) => `
        <li>
          <p><strong>${esc(pathOf(page.url))}</strong> ${esc(issue.message)}</p>
          ${issue.selector ? `<pre><code>${esc(issue.selector)}</code></pre>` : ''}
          ${issue.html ? `<pre><code>${esc(issue.html)}</code></pre>` : ''}
        </li>`).join('');
  return `
    <section class="rule">
      <h3>${esc(first.title)}</h3>
      <p class="meta">${esc(criterionLabel(first.wcag))} · ${plural(items.length, 'place')} on ${plural(pages.size, 'page')}</p>
      ${why ? `<p>${esc(why)}</p>` : ''}
      <details>
        <summary>Where it happens</summary>
        <ul class="examples">${examples}
        </ul>
        ${items.length > EXAMPLES ? `<p class="meta">And ${items.length - EXAMPLES} more. The JSON output lists every one.</p>` : ''}
      </details>
      ${link ? `<p><a href="${esc(link)}">How to fix this<span class="sr"> (${esc(first.title)})</span></a></p>` : ''}
    </section>`;
}

const LIST_CAP = 60;
const more = (n) => (n > LIST_CAP ? `<p class="meta">And ${n - LIST_CAP} more. The JSON output lists every one.</p>` : '');
const onPages = (set) => (set.size === 1 ? esc(pathOf([...set][0])) : `${set.size} pages, first on ${esc(pathOf([...set][0]))}`);

// Collapses the per-page inventories into one list per kind, with the pages each item is on.
function collect(pages, pick, keyOf) {
  const items = new Map();
  for (const page of pages) for (const item of (page.review ? pick(page.review) : [])) {
    const key = keyOf(item);
    if (!items.has(key)) items.set(key, { item, pages: new Set() });
    items.get(key).pages.add(page.url);
  }
  return [...items.values()];
}

// The part no tool can judge, laid out so a person can work down it instead of hunting.
function byHand(result) {
  const pages = result.pages.filter((p) => p.review);
  const parts = [];

  const images = collect(pages, (r) => r.images, (i) => `${i.src}|${i.alt}`);
  if (images.length) {
    parts.push(`
  <h3>Images and their descriptions</h3>
  <p>A screen reader reads the description in place of the image. For each one: does it say what the image is there for? An image marked decorative is skipped entirely, which is right for ornaments and wrong for anything that carries information. Images that contain text need that text in the description.</p>
  <ul class="rows">${images.slice(0, LIST_CAP).map(({ item, pages: on }) => `
    <li><img src="${esc(item.src)}" alt="" width="72" height="72">
      <div><p>${item.alt === null ? '<strong>No description at all.</strong>' : item.alt === '' ? '<strong>Marked decorative</strong>, so screen readers skip it.' : `&ldquo;${esc(item.alt)}&rdquo;`}</p>
      <p class="meta">${onPages(on)}${item.linked ? ' · this image is a link, so the description is also the link text' : ''}</p></div></li>`).join('')}
  </ul>${more(images.length)}`);
  }

  const media = collect(pages, (r) => r.media.filter((m) => !m.background), (m) => m.src);
  if (media.length) {
    parts.push(`
  <h3>Video and audio</h3>
  <p>Each needs accurate captions, and video needs its visual content described if the soundtrack does not already cover it. Auto-generated captions have to be reviewed by a person.</p>
  <ul class="plain">${media.slice(0, LIST_CAP).map(({ item, pages: on }) => `
    <li>${esc(item.kind)}${item.title ? ` &ldquo;${esc(item.title)}&rdquo;` : ''}: <a href="${esc(item.src)}">${esc(item.src.replace(/^https?:\/\//, '').slice(0, 70))}</a>
      <span class="meta">· ${item.captions === true ? 'has a caption track; check it is accurate' : item.captions === false ? 'no caption track found' : 'captions are set inside the player; check there'} · ${onPages(on)}</span></li>`).join('')}
  </ul>${more(media.length)}`);
  }

  const links = collect(pages, (r) => r.vagueLinks, (l) => `${l.text}|${l.href}`);
  if (links.length) {
    parts.push(`
  <h3>Links that do not say where they go</h3>
  <p>Screen reader users often move through a page by its links alone. Out of context, these all sound the same.</p>
  <ul class="plain">${links.slice(0, LIST_CAP).map(({ item, pages: on }) => `
    <li>&ldquo;${esc(item.text)}&rdquo; goes to <a href="${esc(item.href)}">${esc(item.href.replace(/^https?:\/\//, '').slice(0, 70))}<span class="sr"> (linked as ${esc(item.text)})</span></a> <span class="meta">· ${onPages(on)}</span></li>`).join('')}
  </ul>${more(links.length)}`);
  }

  const forms = pages.flatMap((p) => p.review.forms.map((f) => ({ ...f, url: p.url })));
  if (forms.length) {
    parts.push(`
  <h3>Forms</h3>
  <p>Fill each one in using only the keyboard. Then submit it with mistakes: is every error described in words, next to its field, and does it say how to fix it?</p>
  <ul class="plain">${forms.slice(0, LIST_CAP).map((f) => `
    <li><a href="${esc(f.url)}">${esc(pathOf(f.url))}<span class="sr"> form: ${esc(f.name || 'unnamed')}</span></a> ${f.name ? `&ldquo;${esc(f.name)}&rdquo;` : 'a form with no name'} <span class="meta">· ${plural(f.fields, 'field')}, ${f.required} required</span></li>`).join('')}
  </ul>${more(forms.length)}`);
  }

  const contrast = pages.flatMap((p) => p.review.contrast.filter((c) => c.text).map((c) => ({ ...c, url: p.url })));
  if (contrast.length) {
    parts.push(`
  <h3>Text over images</h3>
  <p>This text sits on a photo, gradient or video. Its contrast was measured from a screenshot and is good in some places and too low in others, so someone has to look at whether it is readable.</p>
  <ul class="plain">${contrast.slice(0, LIST_CAP).map((c) => `
    <li>&ldquo;${esc(c.text)}&rdquo; <span class="meta">· ${esc(pathOf(c.url))} · ${c.worst === undefined ? 'could not be measured' : `between ${c.worst}:1 and ${c.best}:1, needs ${c.needs}:1`}</span></li>`).join('')}
  </ul>${more(contrast.length)}`);
  }

  const outlines = pages.filter((p) => p.review.headings.length);
  if (outlines.length) {
    parts.push(`
  <h3>Heading outlines</h3>
  <p>Screen reader users skim a page by its headings, like a table of contents. Read each outline by itself: does it describe the page, in an order that makes sense?</p>
  ${outlines.slice(0, LIST_CAP).map((p) => `<details>
    <summary>${esc(pathOf(p.url))}<span class="sr"> heading outline</span></summary>
    <ul class="outline">${p.review.headings.map((h) => `<li style="margin-left:${(h.level - 1) * 18}px"><span class="meta">h${h.level}</span> ${esc(h.text) || '<strong>empty heading</strong>'}</li>`).join('')}</ul>
  </details>`).join('\n  ')}${more(outlines.length)}`);
  }

  const other = new Map();
  for (const page of result.pages) for (const r of page.needsReview) {
    if (r.id === 'color-contrast') continue; // listed above, with measurements
    const item = other.get(r.id) || { title: r.title, count: 0 };
    item.count += r.count;
    other.set(r.id, item);
  }
  if (other.size) {
    parts.push(`
  <h3>Other things the rules could not decide</h3>
  <ul class="plain">${[...other.values()].map((r) => `<li>${esc(r.title)} (${plural(r.count, 'element')})</li>`).join('')}</ul>`);
  }
  return parts.join('\n');
}

export function renderHtml(result) {
  const cover = coverage().counts;
  const t = result.totals;
  const failures = groupByRule(result.pages, 'failure');
  const advice = groupByRule(result.pages, 'advice');
  const date = new Date(result.finishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const verdict = t.errors
    ? `${plural(t.errors, 'page')} could not be checked`
    : t.failures
      ? `${plural(t.failures, 'problem')} found`
      : 'No problems found by the automated checks';

  const rows = result.pages.map((p) => {
    const f = p.issues.filter((i) => i.kind === 'failure').length;
    const a = p.issues.filter((i) => i.kind === 'advice').length;
    return `
          <tr>
            <th scope="row"><a href="${esc(p.url)}">${esc(pathOf(p.url))}</a></th>
            <td>${p.error ? esc(p.error) : f}</td>
            <td>${p.error ? '' : a}</td>
            <td>${p.error ? '' : p.tabStops}</td>
          </tr>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Accessibility report for ${esc(result.target)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; background: #10151c; color: #e7ebf0; font: 17px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main, footer { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  header { background: #171e28; border-bottom: 1px solid #2a3544; padding: 40px 0 32px; }
  header > div { max-width: 1100px; margin: 0 auto; padding: 0 24px; }
  h1 { font-size: 30px; line-height: 1.2; margin: 0 0 8px; overflow-wrap: anywhere; }
  h2 { font-size: 23px; margin: 48px 0 12px; }
  h3 { font-size: 19px; margin: 0 0 4px; }
  p { margin: 0 0 12px; }
  a { color: #8cc4ff; }
  a:focus-visible, summary:focus-visible { outline: 3px solid #ffd166; outline-offset: 3px; border-radius: 2px; }
  .meta { color: #a9b4c2; font-size: 15px; }
  .verdict { font-size: 22px; font-weight: 700; margin: 16px 0 4px; }
  .bad { color: #ff9b8f; } .good { color: #7ee2a0; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 24px 0 0; padding: 0; list-style: none; }
  .stats li { background: #10151c; border: 1px solid #2a3544; border-radius: 8px; padding: 14px 16px; }
  .stats b { display: block; font-size: 28px; line-height: 1.2; }
  .rule { background: #171e28; border: 1px solid #2a3544; border-left: 4px solid #ff9b8f; border-radius: 8px; padding: 18px 20px 8px; margin: 0 0 16px; }
  .rule.note { border-left-color: #ffd166; }
  summary { cursor: pointer; padding: 6px 0; min-height: 24px; color: #8cc4ff; }
  .examples { padding-left: 20px; margin: 8px 0 12px; }
  .examples li { margin-bottom: 14px; }
  pre { margin: 0 0 6px; background: #0b0f14; border: 1px solid #2a3544; border-radius: 6px; padding: 8px 10px; white-space: pre-wrap; overflow-wrap: anywhere; }
  code { font: 14px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; color: #d5dde7; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { text-align: left; vertical-align: top; padding: 10px 12px 10px 0; border-bottom: 1px solid #2a3544; overflow-wrap: anywhere; }
  thead th { color: #a9b4c2; font-size: 15px; }
  tbody th { font-weight: 400; width: 46%; }
  ul.plain { padding-left: 20px; }
  ul.rows { list-style: none; padding: 0; margin: 0 0 12px; }
  ul.rows li { display: flex; gap: 14px; align-items: flex-start; padding: 10px 0; border-bottom: 1px solid #2a3544; }
  ul.rows img { flex: none; width: 72px; height: 72px; object-fit: contain; background: #0b0f14; border: 1px solid #2a3544; border-radius: 6px; }
  ul.rows div { min-width: 0; overflow-wrap: anywhere; }
  ul.rows p { margin: 0 0 2px; }
  ul.outline { list-style: none; padding: 0; margin: 6px 0 14px; }
  ul.outline li { margin-bottom: 4px; }
  main h3 { margin-top: 28px; }
  .rule h3 { margin-top: 0; }
  ul.plain li { overflow-wrap: anywhere; }
  ul.plain li { margin-bottom: 6px; }
  footer { margin-top: 56px; margin-bottom: 40px; padding-top: 20px; border-top: 1px solid #2a3544; color: #a9b4c2; font-size: 15px; }
  .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (max-width: 520px) { body { font-size: 16px; } main, footer, header > div { padding: 0 16px; } h1 { font-size: 24px; } thead th, td, tbody th { font-size: 14px; padding-right: 8px; } tbody th { width: 52%; } }
</style>
</head>
<body>
<header>
  <div>
    <h1>Accessibility report for ${esc(result.target.replace(/^https?:\/\//, ''))}</h1>
    <p class="meta">${esc(date)} · checked against ${esc(result.standard)} · ${plural(t.pages, 'page')}</p>
    <p class="verdict ${t.failures || t.errors ? 'bad' : 'good'}">${esc(verdict)}</p>
    <ul class="stats">
      <li><b>${t.failures}</b> problems to fix</li>
      <li><b>${failures.length}</b> kinds of problem</li>
      <li><b>${t.pages}</b> pages checked</li>
      <li><b>${cover.checked} of ${cover.total}</b> WCAG requirements with an automated check</li>
    </ul>
  </div>
</header>
<main>
  <h2>What this report is</h2>
  <p>Each page was opened in Chrome and tested two ways. First with axe-core, a widely used set of accessibility rules that covers things like color contrast, missing labels and image descriptions. Then by using the page the way someone who cannot use a mouse does: pressing the Tab key through every link and button, opening menus from the keyboard, widening the text spacing and narrowing the window.</p>
  <p>Automated checks find some accessibility problems, not all of them. A clean report is a good sign. It is not proof that a site meets WCAG or any law.</p>

  <h2>What to fix</h2>
  ${failures.length ? failures.map(ruleCard).join('') : '<p>The automated checks found nothing to fix.</p>'}

  ${advice.length ? `<h2>Worth improving</h2>
  <p>These are recognized good practice. They are not WCAG failures.</p>
  ${advice.map(ruleCard).join('').replaceAll('class="rule"', 'class="rule note"')}` : ''}

  <h2>Check these by hand</h2>
  <p>No tool can tell whether a description makes sense or a form is usable. This is everything on the site that needs a person's judgment, gathered in one place.</p>
  ${byHand(result)}
  <h3>What is not listed anywhere</h3>
  <p>Of the ${cover.total} WCAG 2.2 A and AA requirements, this audit has automated checks for ${cover.checked} and lists what to review for ${cover.guided} more. The other ${cover.manual} need a person and cannot be listed in advance, among them:</p>
  <ul class="plain">
    <li>How the site sounds in a screen reader such as VoiceOver or NVDA.</li>
    <li>Whether custom widgets, such as sliders, carousels and drag and drop, work from the keyboard.</li>
    <li>Whether status messages (&ldquo;added to cart&rdquo;, &ldquo;3 results&rdquo;) are announced.</li>
    <li>Whether anything flashes, times out, or changes just because it received focus.</li>
  </ul>
  <p><a href="https://github.com/MikeSewell/focuswalk/blob/main/docs/COVERAGE.md">See the full list, requirement by requirement</a>.</p>

  <h2>Pages checked</h2>
  <table>
    <thead><tr><th scope="col">Page</th><th scope="col">Problems</th><th scope="col">Notes</th><th scope="col">Tab stops</th></tr></thead>
    <tbody>${rows}
    </tbody>
  </table>
</main>
<footer>
  <p>Made with <a href="https://github.com/MikeSewell/focuswalk">focuswalk</a> ${esc(result.version)}${result.engine ? ` and ${esc(result.engine)}` : ''}. focuswalk is free and open source, built by Mike Sewell at <a href="https://automateimpact.org">Automate Impact</a>.</p>
</footer>
</body>
</html>
`;
}
