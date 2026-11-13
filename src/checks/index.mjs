// Every check module in one place. A module exports:
//   rules   { id: { title, criteria, extra?, kinds, covers, why, impact? } }
//           One entry per kind of finding it can report. `criteria` are WCAG numbers, `extra`
//           ids from EXTRA in wcag.mjs, `kinds` the finding kinds it can produce (failure,
//           likely, advice), `covers` what it tests in plain words (for docs/COVERAGE.md),
//           `why` who it affects (for the HTML report).
//   probes  [{ name, phase, run(page, ctx), isolated?, clock?, browsers? }]
//           Code that runs on each page. Phases run in this order:
//             look     reads the page, changes nothing
//             measure  takes screenshots, may restyle the page and puts it back
//             operate  presses keys, clicks, hovers, resizes. With `isolated: true` it gets a
//                      fresh copy of the page, so whatever it does cannot affect other checks.
//                      With `clock: true` that copy runs on a controllable clock.
//           `browsers` limits a probe to some engines (chromium, firefox, webkit).
//           run() returns an array of issues, or { issues, notes }.
//   siteProbes [{ name, run(pages, ctx) }]  run once after every page, to compare pages.
//           ctx: { level, opts, browser, origin, siteUrls, cache }. `siteUrls` is every page
//           the audit knows of (the whole sitemap, even past --max). `cache` lives for the
//           whole audit, so work done for one screen size is not repeated for the next.
// Modules built into src/index.mjs (axe, keyboard walk, layout, interact, contrast, site)
// export only rules; their order is fixed there.
import * as keyboard from './keyboard.mjs';
import * as interact from './interact.mjs';
import * as layout from './layout.mjs';
import * as contrast from './contrast.mjs';
import * as site from '../site.mjs';
import * as sitewide from './sitewide.mjs';
import * as documents from './documents.mjs';
import * as pointer from './pointer.mjs';
import * as widgets from './widgets.mjs';
import * as forms from './forms.mjs';
import * as content from './content.mjs';
import * as language from './language.mjs';

export const MODULES = [keyboard, interact, layout, contrast, site, sitewide, documents, pointer, widgets, forms, content, language];

export const RULES = Object.assign({}, ...MODULES.map((m) => m.rules || {}));
export const PROBES = MODULES.flatMap((m) => m.probes || []);
export const SITE_PROBES = MODULES.flatMap((m) => m.siteProbes || []);
export const PHASES = ['look', 'measure', 'operate'];

// Builds an issue for one of the rules above, so title and criteria always match the rule.
export function issue(id, fields = {}) {
  const rule = RULES[id];
  if (!rule) throw new Error(`accessready: no rule named ${id}`);
  return {
    id, source: 'accessready', kind: rule.kinds[0], wcag: rule.criteria, extra: rule.extra || [],
    impact: rule.impact || 'serious', title: rule.title, selector: '', html: '', ...fields,
  };
}
