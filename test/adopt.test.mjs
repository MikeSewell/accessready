// What a team needs to adopt accessready on a real site: a config file with ignores that
// carry a reason, a baseline so CI fails only on new problems, and SARIF for code scanning.
// Run through the command line, the way a project uses it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startSite } from './helpers.mjs';
import { fingerprint, normalizeMessage } from '../src/adopt/baseline.mjs';

const BIN = fileURLToPath(new URL('../bin/accessready.mjs', import.meta.url));
let site, dir;

// A page the tests change between runs: it starts with one problem (an image with no
// description) and can gain a second (a button with no name) or lose the first.
const state = { image: true, button: false };
const changing = () => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Changing page</title></head><body><main><h1>Changing page</h1>
${state.image ? '<img id="logo" src="photo.png" width="120" height="80">' : ''}
${state.button ? '<button id="send"></button>' : ''}
<p>Text.</p></main></body></html>`;

before(async () => {
  site = await startSite({ '/changing.html': changing });
  dir = mkdtempSync(join(tmpdir(), 'accessready-adopt-'));
});
after(async () => { await site.close(); rmSync(dir, { recursive: true, force: true }); });

function run(args, { cwd = dir } = {}) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { cwd, env: { ...process.env, NO_COLOR: '1' } });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}
const config = (name, content) => {
  const sub = mkdtempSync(join(dir, `${name}-`));
  writeFileSync(join(sub, 'accessready.config.json'), typeof content === 'string' ? content : JSON.stringify(content));
  return sub;
};
const json = (file) => JSON.parse(readFileSync(file, 'utf8'));

test('the config file in the working folder sets the url, paths and options', async () => {
  const cwd = config('defaults', { url: site.origin, paths: ['/headings.html'], viewports: ['desktop'], strict: true, json: 'out/result.json' });
  const r = await run([], { cwd });
  // headings.html has only a best-practice note, which fails the run because the config says strict.
  assert.equal(r.code, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /\/headings\.html {2}no failures {2}1 best-practice note/);
  assert.deepEqual(json(join(cwd, 'out/result.json')).viewports, ['desktop']);
  // A flag on the command line wins over the file.
  assert.equal((await run(['--no-color'], { cwd })).code, 1);
  const loose = await run([`${site.origin}/headings.html`, '--viewports', 'desktop'], { cwd: config('loose', { strict: false }) });
  assert.equal(loose.code, 0);
});

test('an ignore with a reason removes the finding from the totals and lists it in the JSON', async () => {
  const cwd = config('ignore', {
    url: site.origin, paths: ['/focus.html'], viewports: ['desktop'],
    ignore: [{ rule: 'focus-visible', page: '/focus*', selector: '#no-ring', reason: 'Design team fixing in ticket 12' }],
  });
  const r = await run(['--json', 'result.json'], { cwd });
  assert.equal(r.code, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^1 finding ignored by accessready\.config\.json; the JSON report lists each one with its reason$/m);
  assert.doesNotMatch(r.stdout, /No visible focus indicator/);
  const data = json(join(cwd, 'result.json'));
  assert.equal(data.totals.failures, 0);
  assert.deepEqual(data.ignored.map((i) => [i.rule, i.page, i.selector, i.reason]), [['focus-visible', '/focus.html', '#no-ring', 'Design team fixing in ticket 12']]);
  // The same ignore pointed at another element leaves the finding alone.
  const other = config('ignore-other', { url: site.origin, paths: ['/focus.html'], viewports: ['desktop'], ignore: [{ rule: 'focus-visible', selector: '#elsewhere', reason: 'Not this one' }] });
  assert.equal((await run([], { cwd: other })).code, 1);
});

test('baseline round trip: save, rerun unchanged, add a problem, fix one', async () => {
  const base = join(dir, 'baseline.json');
  const args = [`${site.origin}/changing.html`, '--viewports', 'desktop', '--baseline', base];
  state.image = true; state.button = false;

  const saved = await run([...args, '--update-baseline']);
  assert.equal(saved.code, 0, saved.stdout + saved.stderr);
  assert.match(saved.stdout, /Baseline: .*baseline\.json \(1 finding saved\)/);
  assert.deepEqual(json(base).findings.map((f) => [f.rule, f.page, f.selector]), [['image-alt', '/changing.html', '#logo']]);

  const same = await run(args);
  assert.equal(same.code, 0, same.stdout);
  assert.match(same.stdout, /^Baseline: 1 known finding skipped, 0 new, 0 fixed since the baseline$/m);

  state.button = true;
  const sarif = join(dir, 'new.sarif');
  const worse = await run([...args, '--sarif', sarif]);
  assert.equal(worse.code, 1, worse.stdout);
  assert.match(worse.stdout, /^Baseline: 1 known finding skipped, 1 new, 0 fixed since the baseline\n {2}NEW FAIL {2}\/changing\.html {2}Buttons must have discernible text {2}#send$/m);
  assert.deepEqual(json(sarif).runs[0].results.map((r) => [r.ruleId, r.baselineState]).sort(), [['button-name', 'new'], ['image-alt', 'unchanged']]);

  state.image = false;
  const better = await run(args);
  assert.equal(better.code, 1, 'the button is still new');
  assert.match(better.stdout, /^Baseline: 0 known findings skipped, 1 new, 1 fixed since the baseline$/m);
  assert.match(better.stdout, /^ {2}FIXED {2}\/changing\.html {2}Images must have alternative text {2}#logo$/m);
  state.image = true; state.button = false;
});

test('a fingerprint ignores numbers that change between runs, and the host', () => {
  const issue = { id: 'contrast-on-image', selector: '#faint', message: 'reaches 1.66:1 at best over 412 pixels' };
  assert.equal(normalizeMessage(issue.message), 'reaches # at best over # pixels');
  assert.equal(fingerprint('/a', issue), fingerprint('/a', { ...issue, message: 'reaches 1.71:1 at best over 398 pixels' }));
  assert.notEqual(fingerprint('/a', issue), fingerprint('/b', issue));
  assert.notEqual(fingerprint('/a', issue), fingerprint('/a', { ...issue, selector: '#other' }));
});

// The parts of SARIF 2.1.0 that the spec requires and that GitHub code scanning reads.
// No schema package: each rule is written out here from the OASIS spec, section by section.
function sarifProblems(log) {
  const out = [];
  const need = (ok, what) => { if (!ok) out.push(what); };
  const text = (m) => m && typeof m.text === 'string' && m.text.length > 0;
  const LEVELS = ['none', 'note', 'warning', 'error'];
  need(log.version === '2.1.0', 'sarifLog.version is "2.1.0" (3.13.2)');
  need(typeof log.$schema === 'string', 'sarifLog.$schema');
  need(Array.isArray(log.runs) && log.runs.length === 1, 'sarifLog.runs (3.13.4)');
  for (const run of log.runs || []) {
    const driver = run.tool?.driver;
    need(driver && typeof driver.name === 'string', 'run.tool.driver.name (3.18.2, 3.19.8)');
    const rules = driver?.rules || [];
    need(new Set(rules.map((r) => r.id)).size === rules.length, 'reportingDescriptor ids are unique');
    for (const rule of rules) {
      need(typeof rule.id === 'string' && rule.id, `rule.id (3.49.3) ${rule.id}`);
      need(text(rule.shortDescription) && text(rule.fullDescription) && text(rule.help), `rule ${rule.id} descriptions are multiformatMessageStrings with text (3.12)`);
      need(/^https?:\/\//.test(rule.helpUri || ''), `rule ${rule.id} helpUri`);
      need(LEVELS.includes(rule.defaultConfiguration?.level), `rule ${rule.id} defaultConfiguration.level (3.50.3)`);
    }
    need(Array.isArray(run.results), 'run.results (3.14.23)');
    for (const r of run.results || []) {
      need(text(r.message), 'result.message.text (3.27.11)');
      need(LEVELS.includes(r.level), `result.level ${r.level} (3.27.10)`);
      need(rules[r.ruleIndex]?.id === r.ruleId, `result.ruleIndex points at ruleId ${r.ruleId} (3.27.6)`);
      need(Array.isArray(r.locations) && r.locations.length === 1, 'result.locations');
      for (const loc of r.locations || []) {
        try { new URL(loc.physicalLocation.artifactLocation.uri); } catch { out.push('artifactLocation.uri is an absolute URI (3.4.3)'); }
      }
      need(Object.values(r.partialFingerprints || {}).every((v) => typeof v === 'string'), 'partialFingerprints are strings (3.27.17)');
      if ('baselineState' in r) need(['new', 'unchanged', 'updated', 'absent'].includes(r.baselineState), 'baselineState (3.27.24)');
    }
    for (const inv of run.invocations || []) need(typeof inv.executionSuccessful === 'boolean', 'invocation.executionSuccessful (3.20.14)');
  }
  return out;
}

test('SARIF output has the shape SARIF 2.1.0 and code scanning require', async () => {
  const file = join(dir, 'out.sarif');
  const r = await run([site.origin, '/focus.html', '/rules.html', '/nope.html', '--viewports', 'desktop', '--sarif', file]);
  assert.equal(r.code, 2, 'a page that would not load still exits 2');
  assert.match(r.stdout, /SARIF: {2}.*out\.sarif/);
  const log = json(file);
  assert.deepEqual(sarifProblems(log), []);
  const run0 = log.runs[0];
  const results = run0.results.map((x) => [x.ruleId, x.level, new URL(x.locations[0].physicalLocation.artifactLocation.uri).pathname]);
  assert.deepEqual(results, [
    ['focus-visible', 'error', '/focus.html'],
    // The pale yellow wrapper ring on focus.html is under 3:1 (1.4.11): a likely problem.
    ['focus-indicator-contrast', 'warning', '/focus.html'], ['focus-caret-only', 'note', '/focus.html'],
    // Three unrelated demo pages with no menu or search between them: a likely problem.
    ['multiple-ways', 'warning', '/focus.html'],
    ['color-contrast', 'error', '/rules.html'], ['target-size', 'error', '/rules.html'], ['target-size', 'error', '/rules.html'],
  ]);
  assert.match(run0.results[0].message.text, /\. Element: #no-ring\. Page: \/focus\.html$/);
  // Every accessready rule is described, with a link to the WCAG Understanding page.
  const focus = run0.tool.driver.rules.find((x) => x.id === 'focus-visible');
  assert.equal(focus.helpUri, 'https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html');
  assert.match(focus.help.text, /WCAG: 2\.4\.7 Focus Visible/);
  assert.ok(run0.tool.driver.rules.some((x) => x.id === 'pdf-untagged'));
  // axe-core rules carry axe's own help page.
  assert.match(run0.tool.driver.rules.find((x) => x.id === 'color-contrast').helpUri, /^https:\/\/dequeuniversity\.com\//);
  assert.equal(run0.invocations[0].executionSuccessful, false);
  assert.match(run0.invocations[0].toolExecutionNotifications[0].message.text, /^\/nope\.html: server answered 404$/);
});

test('config and baseline mistakes exit 2 with a message, before any browser starts', async () => {
  const cases = [
    [[], config('no-reason', { url: site.origin, ignore: [{ rule: 'color-contrast' }] }), /accessready\.config\.json: ignore\[0\] \(color-contrast\) needs a "reason"/],
    [[], config('blank-reason', { url: site.origin, ignore: [{ rule: 'color-contrast', reason: '  ' }] }), /needs a "reason"/],
    [[], config('no-rule', { url: site.origin, ignore: [{ reason: 'why' }] }), /ignore\[0\] needs a "rule"/],
    [[], config('ignore-key', { url: site.origin, ignore: [{ rule: 'x', reason: 'y', pages: '/' }] }), /ignore\[0\] has an unknown key "pages"/],
    [[], config('unknown', { url: site.origin, levle: 'AA' }), /unknown option "levle"/],
    [[], config('bad-type', { url: site.origin, max: 0 }), /"max" must be a whole number above 0/],
    [[], config('bad-json', '{ "url": '), /accessready\.config\.json is not valid JSON/],
    [[], config('bad-level', { url: site.origin, level: 'AAAA' }), /"level" must be A, AA or AAA/],
    [['--config', 'missing.json', site.origin], dir, /config file not found: missing\.json/],
    [[site.origin, '--update-baseline'], dir, /--update-baseline needs --baseline <file>/],
    [[site.origin, '--baseline', 'nowhere.json'], dir, /baseline file not found: nowhere\.json\. Create it with --update-baseline/],
    [[site.origin, '--baseline', 'accessready.config.json'], config('not-baseline', { url: site.origin }), /accessready\.config\.json is not an accessready baseline/],
  ];
  for (const [args, cwd, message] of cases) {
    const started = Date.now();
    const r = await run(args, { cwd });
    assert.equal(r.code, 2, `${args.join(' ')} in ${cwd}: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, message);
    assert.ok(Date.now() - started < 3000, 'failed before a browser started');
  }
});

test('a baseline is not written when a page could not be audited', async () => {
  const base = join(dir, 'partial.json');
  const r = await run([site.origin, '/clean.html', '/nope.html', '--viewports', 'desktop', '--baseline', base, '--update-baseline']);
  assert.equal(r.code, 2);
  assert.match(r.stderr, /the baseline was not written because 1 page could not be audited/);
});
