// Every content-*.html and lang-*.html page plants one problem with structure, wording or
// language. These tests pin down what is reported for each, at AA and at AAA.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules as contentRules } from '../src/checks/content.mjs';
import { rules as languageRules, readingGrade } from '../src/checks/language.mjs';
import { startSite } from './helpers.mjs';

const OWN = new Set([...Object.keys(contentRules), ...Object.keys(languageRules)]);
const own = (page) => page.issues.filter((i) => OWN.has(i.id)).map((i) => [i.kind, i.id]);

const AA = {
  'content-heading': [['likely', 'styled-as-heading']],
  'content-list': [['likely', 'fake-list']],
  'content-table': [['likely', 'table-no-headers']],
  'content-order': [['likely', 'reading-order']],
  'content-sensory': [['likely', 'sensory-instructions']],
  'content-title-default': [['failure', 'default-title']],
  'content-title-generic': [['likely', 'generic-title']],
  'content-title-site': [['likely', 'title-is-site-name']],
  'content-link': [['likely', 'link-no-context']],
  'content-heading-generic': [['likely', 'heading-generic']],
  'lang-mismatch': [['failure', 'page-lang-mismatch']],
  'lang-part': [['likely', 'part-lang-unmarked']],
  // AAA problems only, so nothing at AA.
  'content-repeated-links': [],
  'content-location': [],
  'content-sections': [],
  'content-landmarks': [],
  'lang-abbr': [],
  'lang-reading': [],
  'content-clean': [],
  'lang-clean': [],
};
const AAA = {
  'content-link': [['likely', 'link-no-context'], ['failure', 'link-text-vague']],
  'content-repeated-links': [['likely', 'link-text-repeated']],
  'content-location': [['likely', 'no-location-cue']],
  'content-sections': [['likely', 'no-section-headings']],
  'content-landmarks': [['likely', 'no-landmarks']],
  'lang-abbr': [['likely', 'abbr-unexpanded'], ['likely', 'abbr-unexpanded']],
  'lang-reading': [['likely', 'reading-level']],
  'lang-mismatch': [['failure', 'page-lang-mismatch']],
  'content-clean': [],
  'lang-clean': [],
};

let site, aa, aaa;
const at = (result, name) => result.pages.find((p) => new URL(p.url).pathname === `/${name}.html`);

before(async () => {
  site = await startSite();
  aa = await audit(site.origin, { viewports: ['desktop'], paths: Object.keys(AA).map((p) => `/${p}.html`), concurrency: 3 });
  aaa = await audit(site.origin, { viewports: ['desktop'], paths: Object.keys(AAA).map((p) => `/${p}.html`), concurrency: 3, level: 'AAA' });
});
after(() => site.close());

for (const [name, expected] of Object.entries(AA)) {
  test(`AA: ${name} reports ${expected.length ? expected.map((e) => e[1]).join(', ') : 'nothing'}`, () => {
    const p = at(aa, name);
    assert.equal(p.error, null);
    assert.deepEqual(own(p), expected);
  });
}

for (const [name, expected] of Object.entries(AAA)) {
  test(`AAA: ${name} reports ${expected.length ? expected.map((e) => e[1]).join(', ') : 'nothing'}`, () => {
    assert.deepEqual(own(at(aaa, name)), expected);
  });
}

test('the clean pages report nothing from any check, at AA or AAA', () => {
  for (const name of ['content-clean', 'lang-clean']) {
    assert.deepEqual(at(aa, name).issues, [], name);
    assert.deepEqual(at(aaa, name).issues, [], name);
  }
});

test('messages say what was found', () => {
  assert.match(at(aa, 'content-heading').issues[0].message, /^"Our programs" looks like a heading \(28px against 18px body text\)/);
  assert.equal(at(aa, 'lang-mismatch').issues[0].message, 'the page says lang="en" (English), but its text reads as Spanish');
  assert.match(at(aa, 'lang-part').issues[0].message, /reads as Spanish, but has no lang attribute/);
  assert.deepEqual(at(aaa, 'lang-abbr').issues.map((i) => i.message.split('"')[1]), ['CDC', 'FEMA']);
  assert.match(at(aa, 'content-order').issues[0].message, /^"Then come to the hall.*" is shown before "First, call us/);
});

test('reading level is measured for English only, and says so for other languages', () => {
  assert.ok(at(aaa, 'lang-mismatch').notes.includes('reading level (3.1.5) is measured for English only; this page is in Spanish'));
  assert.ok(readingGrade([{ text: 'We hand out food every Saturday. You do not need to bring papers.' }]).grade < 9);
  assert.ok(readingGrade([{ text: 'Eligibility determinations are administered by the county, which evaluates documentation substantiating household composition.' }]).grade > 9);
});

test('an inner page titled only with the name the other titles share is flagged', async () => {
  const page = (title) => () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title></head><body><main><h1>${title}</h1><p>We hand out food boxes every Saturday morning at the hall.</p></main></body></html>`;
  const local = await startSite({ '/about': page('About us | Riverside'), '/programs': page('Programs | Riverside'), '/contact': page('Riverside') });
  try {
    const r = await audit(local.origin, { viewports: ['desktop'], paths: ['/about', '/programs', '/contact'] });
    assert.deepEqual(r.pages.map((p) => own(p)), [[], [], [['likely', 'title-is-site-name']]]);
    assert.equal(r.pages[2].issues.find((i) => i.id === 'title-is-site-name').scope, 'site');
  } finally {
    await local.close();
  }
});
