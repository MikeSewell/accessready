// Rule-based checks come from axe-core: contrast, names, labels, ARIA, alt text, target size
// and the rest. It is the engine most accessibility tools share, and it is far better
// tested than anything hand-written here would be.
import { AxeBuilder } from '@axe-core/playwright';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

// 'wcag143' -> '1.4.3', 'wcag2411' -> '2.4.11'
const criteria = (tags) => tags
  .map((t) => /^wcag(\d)(\d)(\d+)$/.exec(t))
  .filter(Boolean)
  .map((m) => `${m[1]}.${m[2]}.${m[3]}`);

export async function runAxe(page) {
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
  return { issues, needsReview, engine: `axe-core ${results.testEngine.version}` };
}
