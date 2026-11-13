// The AI review through coding-agent CLIs (Claude Code, Codex, Gemini CLI, Qwen Code). The
// real tools are never run: each test puts small fake ones on a PATH of its own. A fake
// logs the arguments, stdin and folder it was given, then prints a recorded answer in the
// output format of the tool it stands in for.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../src/index.mjs';
import { resolveAi } from '../src/ai/providers.mjs';
import { startSite } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/accessready.mjs', import.meta.url));
const ANSWERS = {
  '/ai-image.html': { findings: [{ rule: 'ai-image-alt', item: 'I1', reason: 'The description is the file name, not what the photo shows.' }] },
  '/ai-link.html': { findings: [{ rule: 'ai-link-purpose', item: 'L1', reason: 'More of what is not said.' }] },
  '/ai-clean.html': { findings: [] },
};
const INSTRUCTION = 'Follow the instructions above. Answer with the JSON object only.';

// One script stands in for all four tools; the name it is installed under says which.
const FAKE = String.raw`
const fs = require('fs'), path = require('path');
const BIN = path.basename(process.argv[1]);
const args = process.argv.slice(2);
let stdin = '';
process.stdin.on('data', (d) => { stdin += d; });
process.stdin.on('end', () => {
  const cwd = process.cwd();
  const read = (f) => { try { return fs.readFileSync(f, 'utf8'); } catch { return null; } };
  const files = fs.readdirSync(cwd).map((f) => (fs.statSync(path.join(cwd, f)).isDirectory()
    ? { name: f, dir: fs.readdirSync(path.join(cwd, f)) }
    : { name: f, head: fs.readFileSync(path.join(cwd, f)).subarray(0, 2).toString('hex') }));
  const policy = args.includes('--policy') ? read(args[args.indexOf('--policy') + 1]) : null;
  const settings = read(path.join(cwd, '.gemini', 'settings.json'));
  const mode = process.env.FAKE_MODE;
  // A helper in a process group of its own that inherits stdout and outlives the tool, the
  // way a language server or telemetry uploader started by a CLI can.
  let helper = null;
  if (mode === 'helper' || mode === 'helper-hang') {
    helper = require('child_process').spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { detached: true, stdio: ['ignore', 'inherit', 'inherit'] });
    helper.unref();
  }
  fs.appendFileSync(process.env.FAKE_LOG, JSON.stringify({ bin: BIN, args, cwd, stdin, files, policy, settings, trust: process.env.GEMINI_CLI_TRUST_WORKSPACE || null, pid: process.pid, helper: helper && helper.pid }) + '\n');
  if (mode === 'hang' || mode === 'helper-hang') return setTimeout(() => {}, 600000);
  if (mode === 'fail') { process.stderr.write('Error: not logged in. Run the CLI once to log in.\n'); process.exit(3); }
  if (mode === 'garbage') { process.stdout.write('Welcome! Tip of the day: try the new themes.\n'); return; }
  const prompt = BIN === 'claude' ? JSON.parse(stdin).message.content[0].text : stdin;
  const m = /"url":"([^"]+)"/.exec(prompt);
  const answers = JSON.parse(process.env.FAKE_ANSWERS);
  const text = mode === 'prose' ? 'Looks fine to me!' : JSON.stringify(answers[m ? new URL(m[1]).pathname : 'site'] || { findings: [] });
  if (BIN === 'claude') {
    console.log(JSON.stringify({ type: 'system', subtype: 'init', tools: [] }));
    console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 700, output_tokens: 30 } }));
  } else if (BIN === 'codex') {
    fs.writeFileSync(args[args.indexOf('--output-last-message') + 1], text);
    console.log(text);
  } else if (BIN === 'gemini') {
    console.log(JSON.stringify({ response: text, stats: {} }));
  } else {
    console.log(JSON.stringify([{ type: 'system', subtype: 'session_start' }, { type: 'result', subtype: 'success', is_error: false, result: text, usage: { input_tokens: 900, output_tokens: 40 } }]));
  }
});
`;

let site, dir, binDir, log;
const entries = () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const envFor = (mode = 'ok', path = binDir) => ({ PATH: [path, dirname(process.execPath)].join(delimiter), FAKE_LOG: log, FAKE_MODE: mode, FAKE_ANSWERS: JSON.stringify(ANSWERS) });
const aiFindings = (page) => page.issues.filter((i) => i.source === 'ai').map((i) => [i.id, i.selector]);
const notesOf = (r) => r.pages.flatMap((p) => p.notes.filter((n) => n.startsWith('AI review: ')));
const run = (pages, use, { mode = 'ok', ...more } = {}) => {
  rmSync(log, { force: true });
  return audit(site.origin, { viewports: ['desktop'], paths: pages.map((p) => `/${p}.html`), ai: { use, env: envFor(mode), cache: false, ...more } });
};
const allCwds = [];
const logged = () => { const e = entries(); allCwds.push(...e.map((x) => x.cwd)); return e; };

before(async () => {
  site = await startSite();
  dir = mkdtempSync(join(tmpdir(), 'accessready-agents-test-'));
  binDir = join(dir, 'bin');
  log = join(dir, 'calls.jsonl');
  mkdirSync(binDir);
  for (const name of ['claude', 'codex', 'gemini', 'qwen']) {
    writeFileSync(join(binDir, name), `#!/usr/bin/env node\n${FAKE}`);
    chmodSync(join(binDir, name), 0o755);
  }
});
after(async () => { await site.close(); rmSync(dir, { recursive: true, force: true }); });

test('claude-code: print mode, no tools, safe mode, the review\'s own system prompt, images as blocks on stdin', async () => {
  const r = await run(['ai-image'], 'claude-code:test-model');
  const [call] = logged();
  const sys = call.args[call.args.indexOf('--system-prompt') + 1];
  assert.match(sys, /Answer with one JSON object and nothing else/);
  assert.deepEqual(call.args, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
    '--system-prompt', sys, '--tools', '', '--strict-mcp-config', '--safe-mode', '--permission-mode', 'dontAsk',
    '--no-session-persistence', '--model', 'test-model']);
  const message = JSON.parse(call.stdin);
  assert.equal(message.type, 'user');
  assert.equal(message.message.role, 'user');
  const pictures = message.message.content.filter((c) => c.type === 'image');
  assert.equal(pictures.length, 2);
  assert.ok(pictures.every((p) => p.source.type === 'base64' && p.source.media_type === 'image/jpeg' && Buffer.from(p.source.data, 'base64')[0] === 0xff));
  assert.match(call.cwd, /accessready-ai-/);
  assert.deepEqual(call.files, [], 'it runs in an empty folder');
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
  assert.deepEqual(r.ai.usage, { inputTokens: 700, outputTokens: 30 });
  assert.match(r.ai.endpoint, /^Claude Code, the claude command, with the account it is logged in to$/);
  assert.deepEqual(notesOf(r), []);
});

test('codex: exec in a read-only sandbox, shell off, images as files in its own folder, prompt on stdin', async () => {
  const r = await run(['ai-image'], 'codex');
  const [call] = logged();
  // The folder as accessready named it (the fake's own cwd may be its real path).
  const cwd = call.args[call.args.indexOf('-C') + 1];
  assert.match(cwd, /accessready-ai-/);
  const off = ['shell_tool', 'unified_exec', 'computer_use', 'browser_use', 'apps', 'plugins', 'hooks', 'multi_agent', 'image_generation'];
  assert.deepEqual(call.args, ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
    '--color', 'never', ...off.flatMap((f) => ['-c', `features.${f}=false`]), '-C', cwd, '--output-last-message', join(cwd, 'answer.txt'),
    '--image', join(cwd, 'I1.jpg'), '--image', join(cwd, 'I2.jpg'), '--', '-'], 'no -m: the model is left to Codex');
  assert.deepEqual(call.files, [{ name: 'I1.jpg', head: 'ffd8' }, { name: 'I2.jpg', head: 'ffd8' }]);
  assert.match(call.stdin, /^You review web pages for accessibility problems/);
  assert.match(call.stdin, /The attached images, in order, are items I1, I2\.$/);
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
});

test('gemini-cli: plan mode, no extensions, no MCP servers, no tools, no context files; JSON output, prompt on stdin, text only with a note', async () => {
  const r = await run(['ai-image'], 'gemini-cli:test-model');
  const [call] = logged();
  const cwd = dirname(call.args[call.args.indexOf('--policy') + 1]);
  assert.match(cwd, /accessready-ai-/);
  assert.deepEqual(call.args, ['--approval-mode', 'plan', '--extensions', 'none', '--allowed-mcp-server-names', 'accessready-allows-no-mcp-server',
    '--policy', join(cwd, 'no-tools.toml'), '--output-format', 'json', '-m', 'test-model', '-p', INSTRUCTION]);
  // A policy that denies every tool, and project settings that load no GEMINI.md, skills,
  // hooks or memory, in a folder trusted for this run only.
  assert.match(call.policy, /^\[\[rule\]\]\ntoolName = "\*"\ndecision = "deny"\npriority = 999$/m);
  assert.deepEqual(JSON.parse(call.settings), {
    context: { fileName: 'accessready-reads-no-context-file.md', includeDirectoryTree: false, memoryBoundaryMarkers: ['.gemini'] },
    mcp: { allowed: ['accessready-allows-no-mcp-server'] }, skills: { enabled: false }, hooksConfig: { enabled: false }, experimental: { autoMemory: false },
  });
  assert.equal(call.trust, 'true');
  assert.deepEqual(call.files, [{ name: '.gemini', dir: ['settings.json'] }, { name: 'no-tools.toml', head: '2320' }]);
  assert.doesNotMatch(call.stdin, /base64|\/9j\//);
  assert.match(call.stdin, /"alt":"IMG_2041\.jpg"/);
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
  assert.deepEqual(notesOf(r), ['AI review: images were not sent, because gemini-cli has no documented way to take them in non-interactive mode; image descriptions were judged by their words and nearby text only']);
});

test('qwen-code: safe mode, plan mode, no tool calls; the result message read from its JSON array', async () => {
  const r = await run(['ai-link'], 'qwen-code');
  const [call] = logged();
  assert.deepEqual(call.args, ['--safe-mode', '--approval-mode', 'plan', '--max-tool-calls', '0', '--output-format', 'json', '-p', INSTRUCTION]);
  assert.equal(call.trust, null);
  assert.deepEqual(call.files, [], 'it runs in an empty folder');
  assert.equal(call.bin, 'qwen');
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-link-purpose', '#vague']]);
  assert.deepEqual(r.ai.usage, { inputTokens: 900, outputTokens: 40 });
});

test('an answer from the cache runs no CLI at all', async () => {
  const cacheDir = join(dir, 'cache');
  await run(['ai-image'], 'claude-code', { cache: true, cacheDir });
  assert.equal(logged().length, 1);
  const again = await run(['ai-image'], 'claude-code', { cache: true, cacheDir });
  assert.equal(entries().length, 0);
  assert.deepEqual(aiFindings(again.pages[0]), [['ai-image-alt', '#bad']]);
});

test('output that is not the CLI\'s JSON stops the review after the first page, with a note', async () => {
  const r = await run(['ai-image', 'ai-link'], 'gemini-cli', { mode: 'garbage' });
  assert.equal(logged().length, 1);
  assert.ok(r.pages.every((p) => !p.error && !aiFindings(p).length));
  assert.ok(notesOf(r).includes('AI review: stopped because of this answer: gemini printed something that is not its JSON output: "Welcome! Tip of the day: try the new themes.". 2 pages were not reviewed'));
});

test('a model answer that is not the JSON asked for becomes a note', async () => {
  const r = await run(['ai-clean'], 'qwen-code', { mode: 'prose' });
  assert.equal(logged().length, 1);
  assert.deepEqual(r.pages[0].notes.filter((n) => n.startsWith('AI review: the model')), ['AI review: the model\'s answer was not the JSON list it was asked for, so nothing was reported']);
});

test('a CLI that exits with an error stops the review with its message', async () => {
  const r = await run(['ai-image', 'ai-link'], 'claude-code', { mode: 'fail' });
  assert.equal(logged().length, 1);
  assert.ok(r.pages.every((p) => !p.error));
  assert.ok(notesOf(r).includes('AI review: stopped because of this answer: claude exited with code 3: Error: not logged in. Run the CLI once to log in.. 2 pages were not reviewed'));
});

test('a CLI that does not answer in time is stopped, and the audit carries on', async () => {
  const r = await run(['ai-clean'], 'codex', { mode: 'hang', timeout: 2000 });
  const [call] = logged();
  assert.deepEqual(notesOf(r), ['AI review: the request did not succeed (codex gave no answer within 2 seconds); nothing was reported']);
  assert.throws(() => process.kill(call.pid, 0), /ESRCH/, 'the hung process was stopped');
  assert.equal(r.pages[0].error, null);
});

test('a CLI that exits while a helper it started holds stdout open is read once it exits', { timeout: 30000 }, async () => {
  const started = Date.now();
  const r = await run(['ai-image'], 'claude-code', { mode: 'helper' });
  const [call] = logged();
  try {
    assert.ok(Date.now() - started < 20000, 'the review did not wait for the helper');
    assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
    assert.deepEqual(notesOf(r), []);
  } finally {
    try { process.kill(call.helper, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('the time limit holds when a helper keeps stdout open after the CLI is stopped', { timeout: 30000 }, async () => {
  const r = await run(['ai-clean'], 'codex', { mode: 'helper-hang', timeout: 2000 });
  const [call] = logged();
  try {
    assert.deepEqual(notesOf(r), ['AI review: the request did not succeed (codex gave no answer within 2 seconds); nothing was reported']);
    assert.throws(() => process.kill(call.pid, 0), /ESRCH/, 'the hung CLI was stopped');
    assert.equal(r.pages[0].error, null);
  } finally {
    try { process.kill(call.helper, 'SIGKILL'); } catch { /* gone */ }
  }
});

for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) test(`${signal === 'SIGINT' ? 'Ctrl-C' : 'SIGTERM'} during the review stops the CLI, removes its folder and exits ${code}`, { timeout: 60000 }, async () => {
  rmSync(log, { force: true });
  const child = spawn(process.execPath, [BIN, `${site.origin}/ai-clean.html`, '--viewports', 'desktop', '--ai', 'codex', '--ai-no-cache', '--json', '-'],
    { env: { NO_COLOR: '1', ...envFor('hang'), HOME: process.env.HOME }, cwd: dir, stdio: 'ignore' });
  const exited = new Promise((done) => child.on('exit', (code, signal) => done({ code, signal })));
  // Wait for the fake CLI to start, then send the signal to accessready alone, the way a
  // terminal's Ctrl-C reaches the foreground process group the CLI is no longer part of.
  let call;
  for (let waited = 0; !(call = entries()[0]) && waited < 45000; waited += 100) await new Promise((done) => setTimeout(done, 100));
  try {
    assert.ok(call, 'the fake CLI was started');
    allCwds.push(call.cwd);
    child.kill(signal);
    assert.deepEqual(await exited, { code, signal: null });
    await new Promise((done) => setTimeout(done, 200));
    assert.throws(() => process.kill(call.pid, 0), /ESRCH/, 'the CLI was stopped');
    assert.equal(existsSync(call.cwd), false, 'its folder was removed');
  } finally {
    child.kill('SIGKILL');
    if (call) { try { process.kill(-call.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
});

test('no folder or file is left behind by any CLI run', () => {
  assert.ok(allCwds.length >= 9);
  for (const cwd of allCwds) assert.equal(existsSync(cwd), false, cwd);
});

test('the model is optional, and a CLI that is not installed is an error with install steps', () => {
  const env = envFor();
  assert.equal(resolveAi('codex', env).ai.model, '');
  assert.equal(resolveAi('claude-code:opus', env).ai.model, 'opus');
  const missing = resolveAi('claude-code', { PATH: join(dir, 'nowhere') }).error;
  assert.match(missing, /^claude-code runs the claude command \(Claude Code\), which is not installed or not on PATH\. Install it with: curl -fsSL https:\/\/claude\.ai\/install\.sh \| bash/);
  assert.match(resolveAi({ use: 'codex', baseUrl: 'http://x' }, env).error, /does not apply to codex/);
});

test('CLI: a coding-agent CLI that is missing exits 2 before any browser starts; one that is there runs', async () => {
  const cli = (args, env) => new Promise((done) => {
    const child = spawn(process.execPath, [BIN, ...args], { env: { NO_COLOR: '1', ...env }, cwd: dir });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
  const missing = await cli([site.origin, '--ai', 'qwen-code'], { PATH: join(dir, 'nowhere'), HOME: process.env.HOME });
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /qwen-code runs the qwen command \(Qwen Code\), which is not installed or not on PATH\. Install it with: npm install -g @qwen-code\/qwen-code@latest/);
  assert.doesNotMatch(missing.stdout, /tab stop/);

  rmSync(log, { force: true });
  const ok = await cli([`${site.origin}/ai-image.html`, '--viewports', 'desktop', '--ai', 'claude-code', '--ai-no-cache', '--json', '-'], { ...envFor(), HOME: process.env.HOME });
  logged();
  assert.equal(ok.code, 0, ok.stderr);
  assert.match(ok.stderr, /AI review: sending .* to claude-code \(Claude Code, the claude command, with the account it is logged in to\), with its default model\. About 1 request\./);
  assert.deepEqual(JSON.parse(ok.stdout).pages[0].issues.filter((i) => i.source === 'ai').map((i) => i.id), ['ai-image-alt']);
});
