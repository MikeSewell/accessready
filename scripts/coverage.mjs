// Rebuilds docs/COVERAGE.md and the coverage block in README.md from src/coverage.mjs and
// the installed axe-core:
//   node scripts/coverage.mjs
// test/coverage.test.mjs fails if either file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coverage, STATUS_LABEL } from '../src/coverage.mjs';

const START = '<!-- coverage:start -->', END = '<!-- coverage:end -->';
const cell = (s) => String(s).replace(/\|/g, '\\|');

export function renderCoverageDoc() {
  const { rows, counts, axeVersion } = coverage();
  const how = (r) => [
    r.tests,
    r.axeRules.length ? `axe-core: ${r.axeRules.map((id) => `\`${id}\``).join(', ')}.` : '',
    r.own.length ? `focuswalk: ${r.own.map((id) => `\`${id}\``).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return `# WCAG 2.2 coverage

What focuswalk does about each of the ${counts.total} level A and AA success criteria in WCAG 2.2. Generated from \`src/coverage.mjs\` and axe-core ${axeVersion}; do not edit by hand.

| | Criteria | What it means |
|---|---|---|
| **${STATUS_LABEL.checked}** | ${counts.checked} | At least one automated check can fail a page on this. It never covers the whole criterion; the last column says what is left. |
| **${STATUS_LABEL.guided}** | ${counts.guided} | Nothing is judged automatically, but the HTML report lists exactly what a person has to look at. |
| **${STATUS_LABEL.manual}** | ${counts.manual} | No tool support. A person has to test it. |

No automated tool can establish that a site conforms to WCAG. This table is here so you can see what a clean run does and does not tell you.

| Criterion | Level | Status | What is tested automatically | What a person still checks |
|---|---|---|---|---|
${rows.map((r) => `| ${r.number} ${cell(r.name)} | ${r.level} | ${STATUS_LABEL[r.status]} | ${cell(how(r)) || 'Nothing.'} | ${cell(r.person)} |`).join('\n')}
`;
}

export function renderReadmeBlock() {
  const { counts } = coverage();
  return `${START}
| Of the ${counts.total} WCAG 2.2 A and AA criteria | |
|---|---|
| ${counts.checked} | have at least one automated check that can fail a page |
| ${counts.guided} | are not judged, but the HTML report lists exactly what a person has to look at |
| ${counts.manual} | need a person, with no help from the tool |
${END}`;
}

export function withCoverageBlock(readme) {
  const start = readme.indexOf(START), end = readme.indexOf(END);
  if (start < 0 || end < 0) throw new Error('README.md is missing the coverage markers');
  return readme.slice(0, start) + renderReadmeBlock() + readme.slice(end + END.length);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const docs = fileURLToPath(new URL('../docs/COVERAGE.md', import.meta.url));
  const readme = fileURLToPath(new URL('../README.md', import.meta.url));
  writeFileSync(docs, renderCoverageDoc());
  writeFileSync(readme, withCoverageBlock(readFileSync(readme, 'utf8')));
  const { counts } = coverage();
  console.log(`wrote docs/COVERAGE.md and the README block: ${counts.checked} checked, ${counts.guided} listed for review, ${counts.manual} by hand`);
}
