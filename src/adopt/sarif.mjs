// SARIF 2.1.0, the format GitHub code scanning (and most code-review tools) read. One rule
// per accessready rule and per axe-core rule that was reported, one result per finding.
// A finding is about a page, not a line of source code, so its location is the page URL
// and the element's selector goes in the message.
// Spec: https://docs.oasis-open.org/sarif/sarif/v2.1.0/sarif-v2.1.0.html
import { RULES } from '../checks/index.mjs';
import { criterionLabel, understandingUrl } from '../wcag.mjs';
import { fingerprint } from './baseline.mjs';

const LEVEL = { failure: 'error', likely: 'warning', advice: 'note' };
const pathOf = (url) => { const u = new URL(url); return u.pathname + u.search; };
const HOME = 'https://github.com/MikeSewell/accessready';

function descriptor(id, { title, criteria, covers, why, helpUrl, kind }) {
  const links = criteria.map((n) => understandingUrl(n)).filter(Boolean);
  const help = [why, criteria.length ? `WCAG: ${criterionLabel(criteria)}.` : 'Best practice, not a WCAG requirement.', ...links].filter(Boolean);
  return {
    id,
    shortDescription: { text: title },
    fullDescription: { text: covers || title },
    help: {
      text: help.join('\n'),
      markdown: [why, criteria.length ? `WCAG: ${criteria.map((n, i) => (links[i] ? `[${criterionLabel([n])}](${links[i]})` : criterionLabel([n]))).join(', ')}` : 'Best practice, not a WCAG requirement.'].filter(Boolean).join('\n\n'),
    },
    helpUri: helpUrl || links[0] || `${HOME}/blob/main/docs/COVERAGE.md`,
    defaultConfiguration: { level: LEVEL[kind] || 'warning' },
    properties: { tags: ['accessibility', ...criteria.map((n) => `wcag${n}`)] },
  };
}

export function toSarif(result) {
  // Every accessready rule, so code scanning can show its help even before it first fires,
  // then the axe-core rules that appear in this run (axe has about a hundred).
  const rules = Object.entries(RULES).map(([id, r]) => descriptor(id, { ...r, kind: r.kinds[0] }));
  const index = new Map(rules.map((r, i) => [r.id, i]));
  for (const p of result.pages) for (const issue of p.issues) {
    if (index.has(issue.id)) continue;
    index.set(issue.id, rules.length);
    rules.push(descriptor(issue.id, { title: issue.title, criteria: issue.wcag, covers: issue.description, helpUrl: issue.helpUrl, kind: issue.kind }));
  }

  const results = result.pages.flatMap((p) => p.issues.map((issue) => {
    const page = pathOf(p.url);
    const out = {
      ruleId: issue.id,
      ruleIndex: index.get(issue.id),
      level: LEVEL[issue.kind] || 'warning',
      message: { text: `${issue.message}${issue.selector ? `. Element: ${issue.selector}` : ''}. Page: ${page}${issue.seenOn ? ` (${issue.seenOn.join(', ')} only)` : ''}` },
      locations: [{
        physicalLocation: { artifactLocation: { uri: p.url } },
        ...(issue.selector ? { logicalLocations: [{ name: issue.selector, kind: 'element' }] } : {}),
      }],
      partialFingerprints: { 'accessready/v1': fingerprint(page, issue) },
      properties: { kind: issue.kind, wcag: issue.wcag, ...(issue.extra?.length ? { extra: issue.extra } : {}), ...(issue.scope ? { scope: issue.scope } : {}) },
    };
    if (issue.baseline) out.baselineState = issue.baseline === 'known' ? 'unchanged' : 'new';
    return out;
  }));

  const errors = result.pages.filter((p) => p.error);
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      tool: { driver: { name: 'accessready', version: result.version, semanticVersion: result.version, informationUri: HOME, rules } },
      automationDetails: { id: `accessready/${result.target}/` },
      invocations: [{
        executionSuccessful: errors.length === 0,
        startTimeUtc: result.startedAt, endTimeUtc: result.finishedAt,
        toolExecutionNotifications: errors.map((p) => ({ level: 'error', message: { text: `${pathOf(p.url)}: ${p.error}` } })),
      }],
      results,
      properties: { target: result.target, standard: result.standard, totals: result.totals },
    }],
  };
}
