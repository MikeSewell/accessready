// The coverage table is a public claim about what the tool checks, so it is held to the code:
// every check it names has to exist, and the generated docs have to be current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { coverage } from '../src/coverage.mjs';
import { CRITERIA, WHY, UNDERSTANDING } from '../src/wcag.mjs';
import { renderCoverageDoc, withCoverageBlock } from '../scripts/coverage.mjs';

const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const source = ['../src/site.mjs', ...readdirSync(fileURLToPath(new URL('../src/checks/', import.meta.url))).map((f) => `../src/checks/${f}`)].map(read).join('\n');
// Every id a check can emit, with the source line that builds it.
const lines = new Map();
for (const line of source.split('\n')) {
  if (!/\bid: .*source: 'accessready'/.test(line)) continue;
  for (const m of line.slice(0, line.indexOf('source:')).matchAll(/'([a-z-]+)'/g)) if (m[1] !== 'failure') lines.set(m[1], line);
}
const emitted = new Set(lines.keys());

test('all 55 level A and AA criteria are accounted for', () => {
  const { rows, counts } = coverage();
  assert.equal(rows.length, 55);
  assert.deepEqual(rows.map((r) => r.number), Object.keys(CRITERIA));
  assert.equal(rows.filter((r) => r.level === 'A').length, 31);
  assert.equal(counts.checked + counts.guided + counts.manual, 55);
  assert.ok(rows.every((r) => r.person), 'every criterion says what is left to a person');
});

test('every check the table credits exists in the code, and can fail a page', () => {
  assert.ok(emitted.size >= 14, `found ${emitted.size} check ids in the source`);
  for (const row of coverage().rows) for (const id of row.own) {
    assert.ok(emitted.has(id), `${row.number} names "${id}", which no check emits`);
    assert.match(lines.get(id), /kind: 'failure'|kind === 'failure' \? /, `${id} must be able to fail a page`);
  }
});

test('a criterion is only "checked" when a rule or check stands behind it', () => {
  for (const row of coverage().rows) {
    assert.equal(row.status === 'checked', row.axeRules.length + row.own.length > 0, row.number);
    if (row.status === 'checked') assert.ok(row.tests, `${row.number} says what is tested`);
  }
});

test('every check has a plain explanation and a WCAG link for the report', () => {
  for (const id of emitted) {
    assert.ok(WHY[id], `no explanation for ${id}`);
    assert.match(UNDERSTANDING[id] || '', /^https:\/\/www\.w3\.org\/WAI\/WCAG22\/Understanding\/[a-z-]+\.html$/, id);
  }
});

test('docs/COVERAGE.md and the README block are up to date (node scripts/coverage.mjs)', () => {
  assert.equal(read('../docs/COVERAGE.md'), renderCoverageDoc());
  const readme = read('../README.md');
  assert.equal(withCoverageBlock(readme), readme);
});
