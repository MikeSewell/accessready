// Rule-based checks come from axe-core: contrast, names, labels, ARIA, alt text, target size
// and the rest. It is the engine most accessibility tools share, and it is far better
// tested than anything hand-written here would be.
import { AxeBuilder } from '@axe-core/playwright';

// axe-core tags its rules by WCAG version and level. The level asked for decides which run.
const TAGS = {
  A: ['wcag2a', 'wcag21a', 'wcag22a'],
  AA: ['wcag2a', 'wcag21a', 'wcag22a', 'wcag2aa', 'wcag21aa', 'wcag22aa'],
  AAA: ['wcag2a', 'wcag21a', 'wcag22a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'wcag2aaa', 'wcag21aaa', 'wcag22aaa'],
};

// 'wcag143' -> '1.4.3', 'wcag2411' -> '2.4.11'
const criteria = (tags) => tags
  .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
  .filter(Boolean)
  .map((m) => `${m[1]}.${m[2]}.${m[3]}`);

export async function runAxe(page, level = 'AA') {
  const WCAG_TAGS = TAGS[level];
  const results = await new AxeBuilder({ page })
    // The wcag22aa tag matters: target-size (2.5.8) is off in axe-core unless it is asked for.
    .withTags([...WCAG_TAGS, 'best-practice'])
    .analyze();

  const issues = [];
  for (const v of results.violations) {
    const isWcag = v.tags.some((t) => WCAG_TAGS.includes(t));
    for (const node of v.nodes) {
      const check = [...node.any, ...node.all, ...node.none][0];
      issues.push({
        id: v.id,
        source: 'axe',
        kind: isWcag ? 'failure' : 'advice',
        wcag: criteria(v.tags),
        impact: node.impact || v.impact || 'moderate',
        title: v.help,
        description: v.description,
        message: check ? check.message : v.description,
        selector: node.target.flat().join(' '),
        html: (node.html || '').replace(/\s+/g, ' ').slice(0, 160),
        helpUrl: v.helpUrl,
      });
    }
  }

  // "Incomplete" means axe could not decide, for example text over a photo. A person has to look.
  const needsReview = results.incomplete.map((v) => ({ id: v.id, title: v.help, count: v.nodes.length, helpUrl: v.helpUrl }));
  // Contrast that axe could not compute can be measured from a screenshot. Only elements in
  // the main document with a plain selector; frames and shadow roots stay for a person.
  const unmeasuredContrast = (results.incomplete.find((v) => v.id === 'color-contrast')?.nodes || [])
    .filter((n) => n.target.length === 1 && typeof n.target[0] === 'string')
    .map((n) => n.target[0]);
  return { issues, needsReview, unmeasuredContrast, engine: `axe-core ${results.testEngine.version}` };
}
