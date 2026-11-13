// A single self-contained HTML file written for the person who owns the site, not only the
// developer who fixes it. It has to pass its own audit; test/report.test.mjs checks that.
import { criterionLabel, understandingUrl, inLevel, STANDARDS, EXTRA, CRITERIA } from '../wcag.mjs';
import { RULES } from '../checks/index.mjs';
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
  const why = RULES[first.id]?.why || first.description || '';
  const link = first.helpUrl || understandingUrl(first.wcag[0]);
  const examples = items.slice(0, EXAMPLES).map(({ issue, page }) => `
        <li>
          <p><strong>${esc(pathOf(page.url))}</strong> ${esc(issue.message)}${issue.seenOn ? ` <span class="meta">(${esc(issue.seenOn.join(', '))} only)</span>` : ''}</p>
          ${issue.source === 'ai' && issue.reason ? `<p class="meta">AI judgment: ${esc(issue.reason)}</p>` : ''}
          ${issue.selector ? `<pre><code>${esc(issue.selector)}</code></pre>` : ''}
          ${issue.html ? `<pre><code>${esc(issue.html)}</code></pre>` : ''}
        </li>`).join('');
  return `
    <section class="rule ${first.kind}">
      <h3>${esc(first.title)}</h3>
      <p class="meta">${esc(criterionLabel(first.wcag))}${(first.extra || []).map((e) => ` · ${esc(EXTRA[e])}`).join('')}${first.source === 'ai' ? ' · AI review' : ''} · ${plural(items.length, 'place')} on ${plural(pages.size, 'page')}</p>
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

// Read the findings against each standard: which of its requirements have an automated failure.
function byStandard(result) {
  const level = result.level || 'AA';
  const failing = new Set();
  for (const p of result.pages) for (const i of p.issues) if (i.kind === 'failure') {
    for (const n of i.wcag) failing.add(n);
    for (const e of i.extra || []) failing.add(e);
  }
  return STANDARDS.filter((s) => s.wcag.every((n) => inLevel(n, level))).map((s) => {
    const failed = [...s.wcag, ...s.extra].filter((n) => failing.has(n));
    return { ...s, failed, total: s.wcag.length + s.extra.length };
  });
}

export function renderHtml(result) {
  const level = result.level || 'AA';
  const cov = coverage();
  const inScope = cov.rows.filter((r) => inLevel(r.number, level));
  const cover = {
    total: inScope.length,
    automated: inScope.filter((r) => r.status === 'checked' || r.status === 'likely' || r.status === 'ai').length,
    guided: inScope.filter((r) => r.status === 'guided').length,
    manual: inScope.filter((r) => r.status === 'manual'),
  };
  const t = result.totals;
  const failures = groupByRule(result.pages, 'failure');
  const likely = groupByRule(result.pages, 'likely');
  const advice = groupByRule(result.pages, 'advice');
  const standards = byStandard(result);
  const views = [...(result.viewports || []), ...((result.browsers || []).length ? [result.browsers.join(' and ')] : [])].join(', ');
  const date = new Date(result.finishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const verdict = t.errors
    ? `${plural(t.errors, 'page')} could not be checked`
    : t.failures
      ? `${plural(t.failures, 'problem')} found`
      : 'No problems found by the automated checks';

  const rows = result.pages.map((p) => {
    const f = p.issues.filter((i) => i.kind === 'failure').length;
    const l = p.issues.filter((i) => i.kind === 'likely').length;
    const a = p.issues.filter((i) => i.kind === 'advice').length;
    return `
          <tr>
            <th scope="row"><a href="${esc(p.url)}">${esc(pathOf(p.url))}</a></th>
            <td>${p.error ? esc(p.error) : f}</td>
            <td>${p.error ? '' : l}</td>
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
  .rule.advice { border-left-color: #8cc4ff; }
  .rule.likely { border-left-color: #ffd166; }
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
    <p class="meta">${esc(date)} · checked against ${esc(result.standard)} · ${plural(t.pages, 'page')}${views ? ` · ${esc(views)}` : ''}</p>
    <p class="verdict ${t.failures || t.errors ? 'bad' : 'good'}">${esc(verdict)}</p>
    <ul class="stats">
      <li><b>${t.failures}</b> problems to fix</li>
      <li><b>${t.likely || 0}</b> likely problems to confirm</li>
      <li><b>${t.pages}</b> pages checked</li>
      <li><b>${cover.automated} of ${cover.total}</b> WCAG ${esc(level)} requirements with an automated check</li>
    </ul>
  </div>
</header>
<main>
  <h2>What this report is</h2>
  <p>Each page was opened in a real browser${views ? ` (${esc(views)})` : ''} and tested two ways. First with axe-core, a widely used set of accessibility rules that covers things like color contrast, missing labels and image descriptions. Then by using the page the way people with disabilities do: pressing the Tab key through every link and button, opening menus and popups from the keyboard, trying forms with mistakes (with nothing sent to the site), widening the text spacing, zooming, turning a phone sideways and letting time pass.</p>
  <p><strong>Problems to fix</strong> are certain. <strong>Likely problems</strong> are where the checks found strong evidence that a person should confirm.</p>
  <p>Automated checks find some accessibility problems, not all of them. A clean report is a good sign. It is not proof that a site meets WCAG or any law.</p>

  <h2>What to fix</h2>
  ${failures.length ? failures.map(ruleCard).join('') : '<p>The automated checks found nothing to fix.</p>'}

  ${likely.length ? `<h2>Likely problems to confirm</h2>
  <p>The checks found strong evidence of each of these. A person should look at each one before it is fixed or dismissed.</p>
  ${likely.map(ruleCard).join('')}` : ''}

  ${advice.length ? `<h2>Worth improving</h2>
  <p>These are recognized good practice. They are not WCAG failures.</p>
  ${advice.map(ruleCard).join('')}` : ''}

  <h2>By standard</h2>
  <p>Laws and procurement rules name a version of WCAG, sometimes with more on top. This is what the automated checks found against each.</p>
  <table>
    <thead><tr><th scope="col">Standard</th><th scope="col">Requirements with an automated failure</th></tr></thead>
    <tbody>${standards.map((s) => `
          <tr>
            <th scope="row">${esc(s.name)}<br><span class="meta">${esc(s.basis)}</span></th>
            <td>${s.failed.length ? `${s.failed.length} of ${s.total}: ${esc(s.failed.map((n) => (CRITERIA[n] ? `${n} ${CRITERIA[n].name}` : EXTRA[n])).join('; '))}` : `None of ${s.total}`}</td>
          </tr>`).join('')}
    </tbody>
  </table>

  <h2>Check these by hand</h2>
  <p>No tool can tell whether a description makes sense or a form is usable. This is everything on the site that needs a person's judgment, gathered in one place.</p>
  ${byHand(result)}
  <h3>What is not listed anywhere</h3>
  <p>Of the ${cover.total} WCAG 2.2 ${esc(level)} requirements, this audit has automated checks for ${cover.automated} and lists what to review for ${cover.guided} more.${cover.manual.length ? ` These ${cover.manual.length} need a person and cannot be listed in advance: ${esc(cover.manual.map((r) => `${r.number} ${r.name}`).join('; '))}.` : ''} Even a requirement with an automated check is never fully covered by it, and how the site sounds in a screen reader such as VoiceOver or NVDA always needs a person.</p>
  <p><a href="https://github.com/MikeSewell/accessready/blob/main/docs/COVERAGE.md">See the full list, requirement by requirement</a>.</p>

  <h2>Pages checked</h2>
  <table>
    <thead><tr><th scope="col">Page</th><th scope="col">Problems</th><th scope="col">Likely</th><th scope="col">Notes</th><th scope="col">Tab stops</th></tr></thead>
    <tbody>${rows}
    </tbody>
  </table>
</main>
<footer>
  <p>Made with <a href="https://github.com/MikeSewell/accessready">accessready</a> ${esc(result.version)}${result.engine ? ` and ${esc(result.engine)}` : ''}. accessready is free and open source, built by <a href="https://msewell.com">Michael Sewell</a>.</p>
</footer>
</body>
</html>
`;
}
