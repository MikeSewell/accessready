// A single self-contained HTML file written for the person who owns the site, not only the
// developer who fixes it. It has to pass its own audit; test/report.test.mjs checks that.
import { criterionLabel, WHY, UNDERSTANDING } from '../wcag.mjs';
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

export function renderHtml(result) {
  const t = result.totals;
  const failures = groupByRule(result.pages, 'failure');
  const advice = groupByRule(result.pages, 'advice');
  const date = new Date(result.finishedAt).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

  const review = new Map();
  for (const page of result.pages) for (const r of page.needsReview) {
    const item = review.get(r.id) || { title: r.title, count: 0 };
    item.count += r.count;
    review.set(r.id, item);
  }

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
      <li><b>${t.needsReview}</b> items a person must check</li>
    </ul>
  </div>
</header>
<main>
  <h2>What this report is</h2>
  <p>Each page was opened in Chrome and tested two ways. First with axe-core, a widely used set of accessibility rules that covers things like color contrast, missing labels and image descriptions. Then by pressing the Tab key through the whole page, the way someone who cannot use a mouse does, to see whether they can always tell where they are.</p>
  <p>Automated checks find some accessibility problems, not all of them. A clean report is a good sign. It is not proof that a site meets WCAG or any law.</p>

  <h2>What to fix</h2>
  ${failures.length ? failures.map(ruleCard).join('') : '<p>The automated checks found nothing to fix.</p>'}

  ${advice.length ? `<h2>Worth improving</h2>
  <p>These are recognized good practice. They are not WCAG failures.</p>
  ${advice.map(ruleCard).join('').replaceAll('class="rule"', 'class="rule note"')}` : ''}

  <h2>What a person still has to check</h2>
  ${review.size ? `<p>The rules engine flagged these for a person to look at, because it could not decide by itself:</p>
  <ul class="plain">${[...review.values()].map((r) => `<li>${esc(r.title)} (${plural(r.count, 'element')})</li>`).join('')}</ul>` : ''}
  <p>No tool can judge the following, on any site:</p>
  <ul class="plain">
    <li>Whether image descriptions and link text make sense to someone who cannot see the page.</li>
    <li>Whether menus, popups and forms can be operated with the keyboard alone, and whether error messages are announced.</li>
    <li>How the page sounds in a screen reader such as VoiceOver or NVDA.</li>
    <li>Whether videos have accurate captions.</li>
  </ul>

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
