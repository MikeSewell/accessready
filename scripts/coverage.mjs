// Rebuilds docs/COVERAGE.md and the coverage block in README.md from src/coverage.mjs and
// the installed axe-core:
//   node scripts/coverage.mjs
// test/coverage.test.mjs fails if either file is out of date.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coverage, STATUS_LABEL } from '../src/coverage.mjs';
import { RULES } from '../src/checks/index.mjs';

const START = '<!-- coverage:start -->', END = '<!-- coverage:end -->';
const cell = (s) => String(s).replace(/\|/g, '\\|');

export function renderCoverageDoc() {
  const { rows, counts, axeVersion } = coverage();
  const how = (r) => [
    r.tests,
    r.axeRules.length ? `axe-core: ${r.axeRules.map((id) => `\`${id}\``).join(', ')}.` : '',
    r.own.length ? `accessready: ${r.own.map((id) => `\`${id}\``).join(', ')}.` : '',
    // The optional AI review is named apart, so nobody reads it as a machine check.
    r.ai.length ? `With --ai: ${r.ai.map((id) => RULES[id].covers).join(' ')} AI review: ${r.ai.map((id) => `\`${id}\``).join(', ')}.` : '',
  ].filter(Boolean).join(' ');
  return `# WCAG 2.2 coverage

What accessready does about each of the ${counts.total} success criteria in WCAG 2.2, levels A, AA and AAA. Generated from \`src/coverage.mjs\` and axe-core ${axeVersion}; do not edit by hand.

${summaryTable()}

| Status | What it means |
|---|---|
| **${STATUS_LABEL.checked}** | At least one automated check can fail a page on this. It never covers the whole criterion; the last column says what is left. |
| **${STATUS_LABEL.likely}** | Automated checks find evidence of a failure, reported as a likely problem for a person to confirm. |
| **${STATUS_LABEL.ai}** | Only the optional AI review (\`--ai\`, with a model or coding agent you choose) judges this. Its findings are for a person to confirm. |
| **${STATUS_LABEL.guided}** | Nothing is judged automatically, but the HTML report lists exactly what a person has to look at. |
| **${STATUS_LABEL.manual}** | No tool support. A person has to test it. |

AA is checked by default; \`--level AAA\` adds the AAA criteria. No automated tool can establish that a site conforms to WCAG. This table is here so you can see what a clean run does and does not tell you.

| Criterion | Level | Status | What is tested automatically | What a person still checks |
|---|---|---|---|---|
${rows.map((r) => `| ${r.number} ${cell(r.name)} | ${r.level} | ${STATUS_LABEL[r.status]} | ${cell(how(r)) || 'Nothing.'} | ${cell(r.person)} |`).join('\n')}
`;
}

// Criteria per status and level, as a table.
function summaryTable() {
  const { counts, countAt } = coverage();
  const lines = ['| Of the 86 WCAG 2.2 criteria | A | AA | AAA | All |', '|---|---|---|---|---|'];
  for (const [status, label] of Object.entries(STATUS_LABEL)) {
    if (!counts[status]) continue;
    lines.push(`| ${label} | ${countAt(status, 'A')} | ${countAt(status, 'AA')} | ${countAt(status, 'AAA')} | ${counts[status]} |`);
  }
  return lines.join('\n');
}

export function renderReadmeBlock() {
  return `${START}
${summaryTable()}
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
  console.log(`wrote docs/COVERAGE.md and the README block: ${Object.entries(STATUS_LABEL).map(([s, l]) => `${counts[s]} ${l.toLowerCase()}`).join(', ')}`);
}
