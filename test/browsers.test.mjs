// The same audit in Firefox and WebKit (the engine inside Safari). Runs only when
// ACCESSREADY_BROWSERS lists them, because Playwright's builds of both are a separate
// download: CI installs them, a developer's machine usually has neither.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { audit } from '../src/index.mjs';
import { startSite, ids } from './helpers.mjs';

const engines = (process.env.ACCESSREADY_BROWSERS || '').split(',').map((s) => s.trim()).filter(Boolean);
let site;
before(async () => { site = await startSite(); });
after(() => site?.close());

for (const engine of engines) {
  test(`${engine}: a clean page stays clean and planted problems are found`, async () => {
    const r = await audit(site.origin, { browsers: [engine], viewports: ['desktop'], paths: ['/clean.html', '/focus.html', '/trap.html', '/reflow.html'] });
    const [clean, focus, trap, reflow] = r.pages;
    assert.equal(clean.error, null);
    assert.deepEqual(ids(clean), []);
    assert.ok(ids(focus).includes('focus-visible'), `${engine} focus page: ${ids(focus)}`);
    assert.ok(ids(trap).includes('keyboard-trap'), `${engine} trap page: ${ids(trap)}`);
    assert.deepEqual(ids(reflow), ['reflow']);
    assert.deepEqual(r.browsers, [engine]);
  });

  test(`${engine}: the phone screen size runs`, async () => {
    const r = await audit(`${site.origin}/clean.html`, { browsers: [engine], viewports: ['phone'] });
    assert.equal(r.pages[0].error, null);
    assert.deepEqual(r.pages[0].views.map((v) => v.viewport), ['phone']);
  });
}

