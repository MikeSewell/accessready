// Rebuilds the images the README uses, from a real run against the demo pages:
//   node scripts/readme-images.mjs
// Writes docs/terminal.png, docs/report.png, docs/worklist.png and docs/social-preview.png.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { startSite } from '../test/helpers.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const docs = join(root, 'docs');
const work = mkdtempSync(join(tmpdir(), 'focuswalk-images-'));
const site = await startSite({}, 4173);

const pages = ['/focus.html', '/menu.html', '/trap.html', '/overimage.html', '/inventory.html'];
const reportFile = join(work, 'report.html');
// Not spawnSync: the demo server lives in this process and has to keep answering.
const run = await new Promise((done) => {
  const child = spawn(process.execPath, [join(root, 'bin/focuswalk.mjs'), site.origin, ...pages, '--concurrency', '1', '--html', reportFile], {
    env: { ...process.env, FORCE_COLOR: '1', NO_COLOR: '' },
  });
  let stdout = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.on('close', () => done({ stdout }));
});

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const COLORS = { 31: '#ff8f85', 32: '#7ee2a0', 33: '#ffd166', 36: '#8cc4ff', 2: '#93a0b1', 1: '#ffffff' };
const output = run.stdout.split(/\n\nReport: /)[0];
const ansi = esc(output).replace(/\x1b\[(\d+)m([\s\S]*?)\x1b\[0m/g, (_, code, text) => `<span style="color:${COLORS[code]};${code === '1' ? 'font-weight:700' : ''}">${text}</span>`);
const command = `npx focuswalk ${site.origin} ${pages.join(' ')}`;

const shell = (body, extra = '') => `<!doctype html><html lang="en"><meta charset="utf-8"><style>
  body { margin: 0; background: #0b0f14; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #e7ebf0; }
  ${extra}</style><body>${body}</body></html>`;

const terminal = shell(`<div class="win"><div class="bar"><i></i><i></i><i></i></div><pre><span class="prompt">$</span> ${esc(command)}\n\n${ansi}</pre></div>`, `
  body { padding: 28px; width: 1180px; }
  .win { background: #131a23; border: 1px solid #2a3544; border-radius: 10px; overflow: hidden; }
  .bar { height: 34px; background: #1b2430; display: flex; align-items: center; gap: 8px; padding: 0 14px; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #3a4656; }
  pre { margin: 0; padding: 20px 22px 24px; font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; color: #d5dde7; white-space: pre-wrap; }
  .prompt { color: #7ee2a0; }`);

const social = shell(`<div class="card"><p class="name">focuswalk</p>
  <p class="line">WCAG 2.2 AA audit for a whole site.</p>
  <p class="sub">Runs axe-core, then uses every page the way a keyboard user does, in real Chrome: missing focus rings, keyboard traps, hover-only menus, text too faint over photos.</p>
  <pre><span class="prompt">$</span> npx focuswalk https://example.org</pre>
  <p class="by">Open source · MIT · by Mike Sewell at Automate Impact</p></div>`, `
  body { width: 1280px; height: 640px; }
  .card { box-sizing: border-box; width: 1280px; height: 640px; padding: 72px 84px; border-left: 14px solid #ffd166; }
  .name { font-size: 92px; font-weight: 800; margin: 0 0 14px; letter-spacing: -2px; }
  .line { font-size: 40px; font-weight: 700; margin: 0 0 18px; color: #ffd166; }
  .sub { font-size: 26px; line-height: 1.45; margin: 0 0 34px; color: #c3cdd9; max-width: 1040px; }
  pre { display: inline-block; margin: 0 0 36px; padding: 16px 22px; background: #131a23; border: 1px solid #2a3544; border-radius: 8px; font: 26px ui-monospace, SFMono-Regular, Menlo, monospace; }
  .prompt { color: #7ee2a0; }
  .by { font-size: 22px; color: #93a0b1; margin: 0; }`);

const browser = await chromium.launch({ channel: 'chrome' }).catch(() => chromium.launch());
const shoot = async (html, file, viewport, clip) => {
  const page = await browser.newPage({ viewport, deviceScaleFactor: 2 });
  if (html.startsWith('file:')) await page.goto(html); else await page.setContent(html);
  await page.screenshot({ path: join(docs, file), fullPage: !clip, ...(clip ? { clip } : {}) });
  await page.close();
};
await shoot(terminal, 'terminal.png', { width: 1236, height: 600 });
await shoot(social, 'social-preview.png', { width: 1280, height: 640 }, { x: 0, y: 0, width: 1280, height: 640 });
{
  const page = await browser.newPage({ viewport: { width: 1180, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(reportFile).href);
  await page.locator('details').first().evaluate((d) => { d.open = true; });
  const bottom = await page.locator('.rule').nth(1).evaluate((el) => el.getBoundingClientRect().bottom + scrollY + 8);
  await page.screenshot({ path: join(docs, 'report.png'), fullPage: true, clip: { x: 0, y: 0, width: 1180, height: Math.round(bottom) } });
  // The worklist: from "Check these by hand" down to the forms.
  const from = await page.locator('h2', { hasText: 'Check these by hand' }).evaluate((el) => el.getBoundingClientRect().top + scrollY - 24);
  const to = await page.locator('h3', { hasText: 'Heading outlines' }).evaluate((el) => el.getBoundingClientRect().top + scrollY - 8);
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: join(docs, 'worklist.png'), fullPage: true, clip: { x: 0, y: Math.round(from), width: 1180, height: Math.round(to - from) } });
  await page.close();
}
await browser.close();
await site.close();
rmSync(work, { recursive: true, force: true });
console.log(readFileSync(join(docs, 'terminal.png')).length > 0 ? 'wrote docs/terminal.png, docs/report.png, docs/worklist.png, docs/social-preview.png' : 'failed');
