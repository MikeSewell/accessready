// The coverage table is a public claim about what the tool checks, so it is held to the code:
// every rule it credits has to be used by a check, and the generated docs have to be current.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { coverage, STATUS_LABEL } from '../src/coverage.mjs';
import { CRITERIA, EXTRA, STANDARDS } from '../src/wcag.mjs';
import { RULES } from '../src/checks/index.mjs';
import { renderCoverageDoc, withCoverageBlock } from '../scripts/coverage.mjs';

const root = fileURLToPath(new URL('../src/', import.meta.url));
const read = (path) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : f.endsWith('.mjs') ? [join(dir, f)] : []));
const source = walk(root).map((f) => readFileSync(f, 'utf8')).join('\n');

test('all 86 WCAG 2.2 criteria are accounted for', () => {
  const { rows, counts } = coverage();
  assert.equal(rows.length, 86);
  assert.deepEqual(rows.map((r) => r.number), Object.keys(CRITERIA));
  assert.deepEqual(['A', 'AA', 'AAA'].map((l) => rows.filter((r) => r.level === l).length), [31, 24, 31]);
  assert.equal(Object.keys(STATUS_LABEL).reduce((n, s) => n + counts[s], 0), 86);
  assert.ok(rows.every((r) => r.person), 'every criterion says what is left to a person');
});

test('the standards hold the criteria their versions define', () => {
  const size = Object.fromEntries(STANDARDS.map((s) => [s.id, s.wcag.length]));
  // 4.1.1 Parsing is left out everywhere: removed in 2.2, always met for HTML before that.
  assert.deepEqual(size, { 'wcag22-aa': 55, 'wcag22-aaa': 86, 'ada-title-ii': 49, 'section-508': 37, 'en-301-549': 49, aoda: 35 });
  for (const s of STANDARDS) for (const e of s.extra) assert.ok(EXTRA[e], `${s.id} names unknown requirement ${e}`);
});

test('every rule is complete and points at real criteria', () => {
  assert.ok(Object.keys(RULES).length >= 15);
  for (const [id, r] of Object.entries(RULES)) {
    assert.match(id, /^[a-z0-9-]+$/, id);
    assert.ok(r.title && r.covers && r.why, `${id} needs a title, what it covers and why it matters`);
    assert.ok(r.kinds.length && r.kinds.every((k) => ['failure', 'likely', 'advice'].includes(k)), `${id} kinds`);
    for (const n of r.criteria) assert.ok(CRITERIA[n], `${id} names unknown criterion ${n}`);
    for (const e of r.extra || []) assert.ok(EXTRA[e], `${id} names unknown requirement ${e}`);
    assert.ok(r.criteria.length || (r.extra || []).length || r.kinds.every((k) => k === 'advice'), `${id} must belong to a criterion or requirement`);
  }
});

test('every rule is used by a check, not only declared', () => {
  const code = source.replace(/export const rules = \{[\s\S]*?\n\};/g, '');
  for (const id of Object.keys(RULES)) assert.ok(code.includes(`'${id}'`), `${id} is declared but no check reports it`);
});

test('a criterion is "checked" only when a rule that can fail a page stands behind it', () => {
  for (const row of coverage().rows) {
    const failing = row.own.some((id) => RULES[id].kinds.includes('failure'));
    assert.equal(row.status === 'checked', row.axeRules.length > 0 || failing, row.number);
    if (row.status === 'checked' || row.status === 'likely') assert.ok(row.tests, `${row.number} says what is tested`);
  }
});

test('docs/COVERAGE.md and the README block are up to date (node scripts/coverage.mjs)', () => {
  assert.equal(read('../docs/COVERAGE.md'), renderCoverageDoc());
  const readme = read('../README.md');
  assert.equal(withCoverageBlock(readme), readme);
});
