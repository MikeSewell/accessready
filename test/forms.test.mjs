// Every form-*.html page plants one form problem. The audit tries each form with mistakes in
// a copy of the page that cannot reach the server; these tests pin down what is reported for
// each page, and prove that nothing the forms tried to send arrived.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { rules } from '../src/checks/forms.mjs';
import { startSite } from './helpers.mjs';

const OWN = new Set(Object.keys(rules));
const own = (page) => page.issues.filter((i) => OWN.has(i.id)).map((i) => [i.kind, i.id]);

// What each page reports at AA, from this module's rules. Every page has one problem.
const AA = {
  'form-silent': [['likely', 'form-error-silent']],
  'form-color-only': [['likely', 'form-error-color-only']],
  'form-not-linked': [['likely', 'form-error-not-linked']],
  'form-not-announced': [['likely', 'form-error-not-announced']],
  'form-vague': [['likely', 'form-error-vague']],
  'form-placeholder': [['likely', 'placeholder-only-label']],
  'form-required-unmarked': [['likely', 'required-not-shown']],
  'form-required-color': [['likely', 'required-color-only']],
  'form-required-code': [['likely', 'required-not-programmatic']],
  'form-format': [['likely', 'format-no-instruction'], ['likely', 'format-no-instruction']],
  'form-duplicate-labels': [['likely', 'label-duplicate']],
  'form-generic-label': [['likely', 'label-generic']],
  'form-autocomplete': [['likely', 'autocomplete-missing']],
  'form-payment': [['likely', 'error-prevention-financial']],
  'form-redundant': [['likely', 'redundant-entry']],
  'form-login-paste': [['likely', 'auth-paste-blocked']],
  'form-login-autocomplete': [['likely', 'auth-autocomplete-off']],
  'form-login-captcha': [['likely', 'auth-captcha']],
  'form-status': [['likely', 'status-not-live'], ['likely', 'status-not-live']],
  // Drawn by CSS: on screen, so the form is not silent, but not tied to the field.
  'form-pseudo-error': [['likely', 'form-error-not-linked']],
  // A message that takes a second to appear, and a form whose button stays disabled until
  // it is complete: neither is a silent form.
  'form-clean-slow': [],
  // Each of these was a false alarm: a donation whose review happens at the payment
  // provider, "(optional)" marking the other fields, a login with nothing marked, a plain
  // button that asks for the browser's own messages, read-only and disabled fields, and a
  // sign-up form taken for a login.
  'form-donate': [],
  'form-optional-marked': [],
  // A required radio group marked in its legend, not on each option.
  'form-legend-required': [],
  'form-login-plain': [],
  'form-report-validity': [],
  'form-readonly-date': [],
  'form-signup-captcha': [['likely', 'autocomplete-missing']],
  // Two search forms do not use up the forms tried, so the contact form, fourth on the page,
  // is reached and found silent.
  'form-many': [['likely', 'form-error-silent']],
  // Forms that send through ways request routing does not see. Nothing may arrive.
  'form-shared-worker': [],
  'form-leaks': [],
  // AAA problems only, so nothing at AA.
  'form-final': [],
  'form-help': [],
  'form-sends': [],
  'form-clean': [],
};
// Pages whose findings change at AAA.
const AAA = {
  'form-help': [['likely', 'form-no-help']],
  'form-login-captcha': [['likely', 'auth-captcha'], ['likely', 'auth-captcha-enhanced']],
  // Already covers 3.3.6, so it is not reported a second time as a plain form.
  'form-payment': [['likely', 'error-prevention-financial']],
  // Plain forms checked on the server: what happens there is never seen, so 3.3.6 is not claimed.
  'form-sends': [],
  'form-donate': [],
  // The page says the vote cannot be changed, and it went at once with nothing chosen.
  'form-final': [['likely', 'error-prevention-all']],
  'form-signup-captcha': [['likely', 'autocomplete-missing']],
  'form-clean': [],
};

let site, aa, aaa;
const at = (result, name) => result.pages.find((p) => new URL(p.url).pathname === `/${name}.html`);

before(async () => {
  site = await startSite();
  aa = await audit(site.origin, { viewports: ['desktop'], paths: Object.keys(AA).map((p) => `/${p}.html`), concurrency: 3 });
  aaa = await audit(site.origin, { viewports: ['desktop'], paths: Object.keys(AAA).map((p) => `/${p}.html`), concurrency: 3, level: 'AAA' });
  // A request a closing page lets slip out can land a moment after the audit returns.
  await new Promise((done) => setTimeout(done, 1500));
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

test('the clean form pages report nothing from any check, at AA or AAA', () => {
  assert.deepEqual(at(aa, 'form-clean').issues, []);
  assert.deepEqual(at(aa, 'form-clean-slow').issues, []);
  assert.deepEqual(at(aaa, 'form-clean').issues, []);
  assert.deepEqual(at(aa, 'form-clean').notes, []);
});

test('AAA form rules stay out of an AA audit', () => {
  const aaaOnly = Object.entries(rules).filter(([, r]) => r.criteria.every((n) => ['3.3.5', '3.3.6', '3.3.9'].includes(n))).map(([id]) => id);
  assert.deepEqual(aaaOnly.sort(), ['auth-captcha-enhanced', 'error-prevention-all', 'form-no-help']);
  for (const p of aa.pages) assert.ok(p.issues.every((i) => !aaaOnly.includes(i.id)), new URL(p.url).pathname);
});

test('messages name the field and what happened', () => {
  assert.match(at(aa, 'form-silent').issues[0].message, /^after "Send" with "Name \(required\)" left empty, the form did not send and nothing on screen changed$/);
  assert.match(at(aa, 'form-vague').issues[0].message, /says only "Invalid"/);
  assert.equal(at(aa, 'form-payment').issues[0].message, '"Donate now" sent the form at once with every field left empty, on a page that takes card details; nothing on this page offers a review step or a confirmation box, and whether the server checks it or a review step follows was not seen');
  assert.match(at(aaa, 'form-final').issues[0].message, /^"Cast my vote" sent the form at once with every field left empty, and the page says "cannot be changed"/);
  assert.match(at(aa, 'form-signup-captcha').issues[0].message, /^"Full name", "Email" ask for the user's own details/);
  assert.match(at(aa, 'form-status').issues.find((i) => i.selector === '#count').message, /^"Showing 2 programs" appeared/);
});

test('the counter of requests that reach the server works', async () => {
  const before = site.hits.length;
  await fetch(`${site.origin}/submit`, { method: 'POST', body: 'x' });
  assert.deepEqual(site.hits.slice(before), [{ method: 'POST', path: '/submit' }]);
  site.hits.splice(before);
});

test('nothing the forms tried to send reached the server', () => {
  // form-sends posts with a navigation, with fetch, with a beacon and into a new window;
  // form-payment and others post too. The audit saw each attempt and stopped it.
  assert.deepEqual(site.hits, []);
  const notes = at(aa, 'form-sends').notes;
  assert.deepEqual(notes, [
    '4 forms on this page; the first 3 were tried with mistakes',
    'the form "Message" tried to send with 1 field empty or invalid; accessready stopped the request, so errors that only the server reports were not seen',
    // The script form sent by fetch and beacon, not by navigating; it was still caught.
    'the form "Topic" tried to send with 1 field empty or invalid; accessready stopped the request, so errors that only the server reports were not seen',
  ]);
});

test('a form that posts through a shared worker is seen sending, and nothing arrives', () => {
  // The page posts through its own shared worker, one started from an empty iframe and one
  // from a new window. None of the requests may reach the server, and the attempt counts as
  // a send, so the form is not called silent.
  assert.deepEqual(site.hits, []);
  assert.deepEqual(at(aa, 'form-shared-worker').notes, [
    'the form "f" tried to send with 1 field empty or invalid; accessready stopped the request, so errors that only the server reports were not seen',
  ]);
});

test('workers, iframes, new windows, sockets, fetchLater and goodbye beacons send nothing', () => {
  // form-leaks sends through each of these when the button is pressed, and again as the page
  // is hidden or closed. The paths all start with /submit, so the server counts every one.
  assert.deepEqual(site.hits, []);
  assert.ok(at(aa, 'form-leaks').notes.some((n) => /^the form "f" tried to send/.test(n)));
});

test('search forms do not use up the forms tried, and the note counts them apart', () => {
  assert.deepEqual(at(aa, 'form-many').notes, ['4 forms on this page besides 2 search forms; the first 3 were tried with mistakes']);
  assert.equal(at(aa, 'form-many').issues.find((i) => i.id === 'form-error-silent').selector, '#name');
});
