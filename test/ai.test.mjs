// The optional AI review, run against a fake model server. No test here talks to a real
// provider: the fake checks each request's shape the way the provider's docs describe it
// and answers with recorded JSON. The fixture pages each plant one problem a model would
// find (ai-*.html), and ai-clean.html plants none.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { audit } from '../src/index.mjs';
import { resolveAi } from '../src/ai/providers.mjs';
import { probes } from '../src/ai/look.mjs';
import { readFindings } from '../src/ai/prompt.mjs';
import { startSite } from './helpers.mjs';

const BIN = fileURLToPath(new URL('../bin/accessready.mjs', import.meta.url));
const PAGES = ['ai-image', 'ai-link', 'ai-sensory', 'ai-clean', 'ai-site-a', 'ai-site-b', 'ai-site-c'];

// What the model "said" about each page, by path. Item ids follow the page's own order:
// I1 is the first image, L1 the first link. Each of the planted answers also carries one
// finding that does not match the page, which has to be dropped.
const ANSWERS = {
  '/ai-image.html': { findings: [{ rule: 'ai-image-alt', item: 'I1', reason: 'The description is the file name, not what the photo shows.' }] },
  '/ai-link.html': { findings: [
    { rule: 'ai-link-purpose', item: 'L1', reason: 'More of what is not said; the sentence does not name the destination.' },
    { rule: 'ai-link-purpose', item: 'L9', reason: 'There is no such link.' },
  ] },
  '/ai-sensory.html': { findings: [
    { rule: 'ai-sensory-instruction', item: 'TEXT', quote: 'press the round green button on the right', reason: 'The button is identified only by shape, color and position.' },
    { rule: 'ai-sensory-instruction', item: 'TEXT', quote: 'click the red square', reason: 'Not on the page.' },
  ] },
  '/ai-clean.html': { findings: [] },
  '/ai-site-a.html': { findings: [] },
  '/ai-site-b.html': { findings: [] },
  '/ai-site-c.html': { findings: [] },
  site: { findings: [{ rule: 'ai-consistent-identification', item: 'C1', reason: 'The same contact link is called two different things.' }] },
};

// The prompt text of a request, in either wire format.
const promptOf = (body) => (body.system !== undefined ? body.messages[0].content[0].text : body.messages[1].content[0].text);
const pathIn = (body) => { const m = /"url":"([^"]+)"/.exec(promptOf(body)); return m ? new URL(m[1]).pathname : 'site'; };

function reply(format, text) {
  return format === 'anthropic'
    ? { content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 1000, output_tokens: 50 } }
    : { choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 50 } };
}

// A fake provider. `respond(body, n)` may return { status, json, headers } to override the
// recorded answer; n counts requests from 1.
async function startFake() {
  const fake = { requests: [], respond: null };
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (d) => { raw += d; });
    req.on('end', () => {
      const body = JSON.parse(raw);
      fake.requests.push({ method: req.method, path: req.url, headers: req.headers, body });
      const format = req.url.endsWith('/messages') ? 'anthropic' : 'openai';
      const out = fake.respond?.(body, fake.requests.length, format) || { json: reply(format, JSON.stringify(ANSWERS[pathIn(body)])) };
      res.writeHead(out.status || 200, { 'content-type': 'application/json', ...(out.headers || {}) });
      res.end(JSON.stringify(out.json));
    });
  });
  await new Promise((done) => server.listen(0, '127.0.0.1', done));
  fake.url = `http://127.0.0.1:${server.address().port}`;
  fake.reset = (respond = null) => { fake.requests = []; fake.respond = respond; };
  fake.close = () => new Promise((done) => server.close(done));
  return fake;
}

let site, fake, dir, first, sent, plans;
const aiFindings = (page) => page.issues.filter((i) => i.source === 'ai').map((i) => [i.id, i.selector]);
const aiNotes = (page) => page.notes.filter((n) => n.startsWith('AI review: '));
const run = (pages, ai, extra = {}) => audit(site.origin, { viewports: ['desktop'], paths: pages.map((p) => `/${p}.html`), ai: { retryDelay: 10, ...ai }, ...extra });
const anthropic = (more = {}) => ({ use: 'anthropic:test-model', baseUrl: `${fake.url}/v1`, env: { ANTHROPIC_API_KEY: 'test-key' }, ...more });

before(async () => {
  site = await startSite();
  fake = await startFake();
  dir = mkdtempSync(join(tmpdir(), 'accessready-ai-'));
  plans = [];
  first = await run(PAGES, anthropic({ cacheDir: join(dir, 'cache'), onPlan: (p) => plans.push(p) }));
  sent = fake.requests;
});
after(async () => { await site.close(); await fake.close(); rmSync(dir, { recursive: true, force: true }); });

const page = (name) => first.pages[PAGES.indexOf(name)];

test('anthropic: each request has the Messages API shape, with the images attached', () => {
  assert.equal(sent.length, 8, 'one per page and one comparing pages');
  for (const r of sent) {
    assert.equal(r.method, 'POST');
    assert.equal(r.path, '/v1/messages');
    assert.equal(r.headers['x-api-key'], 'test-key');
    assert.equal(r.headers['anthropic-version'], '2026-10-21');
    assert.equal(r.headers['content-type'], 'application/json');
    assert.equal(r.body.model, 'test-model');
    assert.equal(typeof r.body.max_tokens, 'number');
    assert.match(r.body.system, /Answer with one JSON object and nothing else/);
    assert.deepEqual(r.body.messages.map((m) => m.role), ['user']);
    assert.equal(r.body.temperature, undefined, 'the current API version rejects sampling parameters');
  }
  const images = sent.find((r) => pathIn(r.body) === '/ai-image.html').body.messages[0].content;
  const parts = images.filter((c) => c.type === 'image');
  assert.equal(parts.length, 2);
  for (const p of parts) {
    assert.equal(p.source.type, 'base64');
    assert.equal(p.source.media_type, 'image/jpeg');
    assert.deepEqual([...Buffer.from(p.source.data, 'base64').subarray(0, 2)], [0xff, 0xd8], 'a real JPEG');
  }
  assert.deepEqual(images.filter((c) => c.type === 'text').slice(1).map((c) => c.text), ['Image I1:', 'Image I2:']);
  assert.match(promptOf(sent[0].body), /"alt":"IMG_2041\.jpg"/);
});

test('before the first request, the plan says what goes where', () => {
  assert.equal(plans.length, 1);
  assert.deepEqual({ ...plans[0], endpoint: undefined }, { provider: 'anthropic', model: 'test-model', endpoint: undefined, pages: 7, requests: 8, wanted: 8, maxRequests: 50, cached: 0, images: 3 });
  assert.equal(plans[0].endpoint, `${fake.url}/v1/messages`);
});

test('the AI findings land on their pages, as likely problems marked as AI judgments', () => {
  assert.deepEqual(aiFindings(page('ai-image')), [['ai-image-alt', '#bad']]);
  const alt = page('ai-image').issues.find((i) => i.source === 'ai');
  assert.equal(alt.kind, 'likely');
  assert.deepEqual(alt.wcag, ['1.1.1']);
  assert.equal(alt.reason, 'The description is the file name, not what the photo shows.');
  assert.equal(alt.message, 'image photo.png is described as "IMG_2041.jpg". AI review: The description is the file name, not what the photo shows.');
  assert.deepEqual(aiFindings(page('ai-link')), [['ai-link-purpose', '#vague']]);
  assert.deepEqual(aiFindings(page('ai-sensory')), [['ai-sensory-instruction', '']]);
  assert.match(page('ai-sensory').issues.find((i) => i.source === 'ai').message, /^"press the round green button on the right"\. AI review: /);
  assert.ok(first.pages.every((p) => p.issues.every((i) => i.source !== 'ai' || (i.kind === 'likely' && i.reason))));
});

test('findings that do not match the page are dropped, with a note', () => {
  assert.deepEqual(aiNotes(page('ai-link')), ['AI review: 1 finding from the model did not match anything on this page and was left out']);
  assert.deepEqual(aiNotes(page('ai-sensory')), ['AI review: 1 finding from the model did not match anything on this page and was left out']);
});

test('the clean page gets no AI findings and no AI notes', () => {
  assert.deepEqual(aiFindings(page('ai-clean')), []);
  assert.deepEqual(aiNotes(page('ai-clean')), []);
});

test('a control named differently on one page is reported there, compared across pages', () => {
  const site = sent.find((r) => pathIn(r.body) === 'site');
  assert.match(promptOf(site.body), /"name":"Get in touch"/);
  assert.deepEqual(aiFindings(page('ai-site-a')), []);
  assert.deepEqual(aiFindings(page('ai-site-b')), []);
  const [found] = page('ai-site-c').issues.filter((i) => i.source === 'ai');
  assert.equal(found.id, 'ai-consistent-identification');
  assert.equal(found.scope, 'site');
  assert.match(found.message, /^the link to \/clean\.html in the navigation is called "Get in touch" here and "Contact us" on 2 other pages\. AI review: /);
});

test('the run reports what the AI review cost', () => {
  assert.deepEqual(first.ai, {
    provider: 'anthropic', model: 'test-model', endpoint: `${fake.url}/v1/messages`, pages: 7,
    requests: 8, cached: 0, notReviewed: 0, usage: { inputTokens: 8000, outputTokens: 400 },
  });
  // Only the AI's own findings: the machine checks also flag likely problems on these pages.
  assert.equal(first.pages.flatMap((p) => p.issues).filter((i) => i.source === 'ai' && i.kind === 'likely').length, 4);
  assert.equal(JSON.stringify(first).includes('"data"'), false, 'no image data in the results');
});

test('a rerun is answered from the cache and sends nothing', async () => {
  fake.reset();
  const again = await run(PAGES, anthropic({ cacheDir: join(dir, 'cache') }));
  assert.equal(fake.requests.length, 0);
  assert.deepEqual(again.pages.map(aiFindings), first.pages.map(aiFindings));
  assert.equal(again.ai.cached, 8);
  assert.equal(readdirSync(join(dir, 'cache')).length, 8);
});

test('openai: Chat Completions with a bearer key, image_url data URLs and JSON mode', async () => {
  fake.reset();
  const r = await run(['ai-image'], { use: 'openai:test-model', baseUrl: `${fake.url}/v1`, env: { OPENAI_API_KEY: 'test-key' }, cache: false });
  assert.equal(fake.requests.length, 1);
  const { path, headers, body } = fake.requests[0];
  assert.equal(path, '/v1/chat/completions');
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.equal(body.model, 'test-model');
  assert.deepEqual(body.messages.map((m) => m.role), ['developer', 'user']);
  assert.deepEqual(body.response_format, { type: 'json_object' });
  assert.equal(body.max_tokens, undefined);
  const pictures = body.messages[1].content.filter((c) => c.type === 'image_url');
  assert.equal(pictures.length, 2);
  assert.ok(pictures.every((c) => c.image_url.url.startsWith('data:image/jpeg;base64,/9j/')));
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
});

test('ollama (and other compatible servers): system role, no key, no JSON mode; --ai-no-images sends text only', async () => {
  fake.reset();
  const r = await run(['ai-image'], { use: 'ollama:llava:7b', baseUrl: `${fake.url}/v1`, env: {}, cache: false, images: false });
  const { path, headers, body } = fake.requests[0];
  assert.equal(path, '/v1/chat/completions');
  assert.equal(headers.authorization, undefined);
  assert.equal(body.model, 'llava:7b');
  assert.deepEqual(body.messages.map((m) => m.role), ['system', 'user']);
  assert.equal(body.response_format, undefined);
  assert.equal(body.messages[1].content.filter((c) => c.type === 'image_url').length, 0);
  assert.deepEqual(aiFindings(r.pages[0]), [['ai-image-alt', '#bad']]);
});

test('provider addresses and keys', () => {
  const env = { ANTHROPIC_API_KEY: 'a', OPENAI_API_KEY: 'o', GEMINI_API_KEY: 'g' };
  const ep = (use, more = {}) => resolveAi({ use, ...more }, env).ai.endpoint;
  assert.equal(ep('anthropic:m'), 'https://api.anthropic.com/v1/messages');
  assert.equal(ep('openai:m'), 'https://api.openai.com/v1/chat/completions');
  assert.equal(ep('gemini:m'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');
  assert.equal(ep('lmstudio:m'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(ep('ollama:m'), 'http://localhost:11434/v1/chat/completions');
  assert.equal(ep('openai-compatible:m', { baseUrl: 'https://llm.example.org/v1/' }), 'https://llm.example.org/v1/chat/completions');
  assert.equal(ep('openai-compatible:m', { baseUrl: 'https://llm.example.org/v1/chat/completions' }), 'https://llm.example.org/v1/chat/completions');
  assert.equal(resolveAi('gemini:m', env).ai.key, 'g');
  assert.equal(resolveAi('gemini:m', { ...env, ACCESSREADY_AI_KEY: 'x' }).ai.key, 'x');
  assert.equal(resolveAi('ollama:qwen2.5vl:7b', {}).ai.model, 'qwen2.5vl:7b');
  assert.match(resolveAi('anthropic:m', {}).error, /ANTHROPIC_API_KEY/);
  assert.match(resolveAi('mistral:m', env).error, /must be one of/);
  assert.match(resolveAi('openai:', env).error, /openai needs provider:model/);
  assert.match(resolveAi({ use: 'ollama:m', baseUrl: 'ftp://x' }, env).error, /http or https/);
});

test('the request limit is respected, and the pages it cut are named in a note', async () => {
  fake.reset();
  const r = await run(['ai-image', 'ai-link', 'ai-sensory', 'ai-clean'], anthropic({ cache: false, maxRequests: 2 }));
  assert.equal(fake.requests.length, 2);
  assert.deepEqual(fake.requests.map((q) => pathIn(q.body)).sort(), ['/ai-image.html', '/ai-link.html']);
  assert.ok(r.pages[0].notes.includes('AI review: the limit of 2 requests was reached; 2 pages were not reviewed. Raise --ai-max-requests to include them'));
  assert.deepEqual(r.pages.map(aiFindings), [[['ai-image-alt', '#bad']], [['ai-link-purpose', '#vague']], [], []]);
  assert.equal(r.ai.notReviewed, 2);
});

test('a busy server is retried once; an answer that is not the JSON asked for becomes a note and is not cached', async () => {
  fake.reset((body, n, format) => (n === 1
    ? { status: 503, headers: { 'retry-after': '0' }, json: { error: { message: 'overloaded' } } }
    : { json: reply(format, 'Here is what I found: the page looks fine to me!') }));
  const cacheDir = join(dir, 'broken');
  const r = await run(['ai-clean'], anthropic({ cacheDir }));
  assert.equal(fake.requests.length, 2);
  assert.equal(r.pages[0].error, null);
  assert.deepEqual(aiFindings(r.pages[0]), []);
  assert.deepEqual(aiNotes(r.pages[0]), ['AI review: the model\'s answer was not the JSON list it was asked for, so nothing was reported']);
  assert.equal(existsSync(cacheDir), false, 'an unusable answer is asked again next time');
});

test('a refused key stops the review after one request; the audit still finishes', async () => {
  fake.reset(() => ({ status: 401, json: { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } } }));
  const r = await run(['ai-image', 'ai-link', 'ai-clean'], anthropic({ cache: false }));
  assert.equal(fake.requests.length, 1);
  assert.ok(r.pages.every((p) => !p.error));
  assert.deepEqual(r.pages.map(aiFindings), [[], [], []]);
  assert.ok(r.pages[0].notes.includes('AI review: stopped because of this answer: anthropic answered 401: invalid x-api-key. 3 pages were not reviewed'));
});

test('a fault inside the AI review itself becomes a note, not a failed audit', async () => {
  fake.reset();
  const r = await run(['ai-clean'], anthropic({ cache: false, onPlan: () => { throw new Error('the plan could not be printed'); } }));
  assert.equal(r.pages[0].error, null);
  assert.ok(r.pages[0].notes.includes('AI review: could not finish: the plan could not be printed'));
  assert.equal(fake.requests.length, 0);
  assert.equal(r.ai.failed, true);
});

test('without --ai nothing is sent and nothing is read for it', async () => {
  fake.reset();
  const r = await audit(site.origin, { viewports: ['desktop'], paths: ['/ai-image.html'] });
  assert.equal(fake.requests.length, 0);
  assert.equal(r.ai, undefined);
  assert.deepEqual(aiFindings(r.pages[0]), []);
  // The probe returns before it touches the page at all.
  const untouchable = new Proxy({}, { get: (_, prop) => { throw new Error(`the page was used (${String(prop)})`); } });
  const result = {};
  assert.deepEqual(await probes[0].run(untouchable, { opts: { level: 'AA' }, result, viewport: { name: 'desktop' }, browserName: 'chromium' }), []);
  assert.deepEqual(await probes[0].run(untouchable, { opts: { ai: { view: 'desktop', engine: 'chromium' } }, result, viewport: { name: 'phone' }, browserName: 'chromium' }), [], 'and only one view reads it');
  assert.deepEqual(result, {});
});

test('answers are checked strictly: wrong rule, wrong item kind, missing reason, rules not asked', () => {
  const look = { images: [{ id: 'I1', picture: null }], links: [{ id: 'L1' }], headings: [], fields: [], text: 'Press the red button.' };
  const prompt = { kind: 'page', rules: ['ai-image-alt', 'ai-link-purpose', 'ai-sensory-instruction', 'ai-image-of-text'], look };
  const answer = JSON.stringify({ findings: [
    { rule: 'ai-image-alt', item: 'L1', reason: 'wrong kind' },
    { rule: 'ai-link-purpose', item: 'L1' },
    { rule: 'ai-pronunciation', item: 'TEXT', quote: 'red', reason: 'not asked' },
    { rule: 'ai-image-of-text', item: 'I1', reason: 'the image was not attached' },
    { rule: 'ai-sensory-instruction', item: 'TEXT', quote: 'press the RED   button', reason: 'color only' },
    { rule: 'ai-sensory-instruction', item: 'TEXT', quote: 'Press the red button', reason: 'the same again' },
  ] });
  const read = readFindings('```json\n' + answer + '\n```', prompt);
  assert.equal(read.dropped, 4);
  assert.deepEqual(read.findings.map((f) => [f.rule, f.quote]), [['ai-sensory-instruction', 'press the RED button']]);
  assert.match(readFindings('{"result": []}', prompt).error, /not the JSON list/);
  assert.match(readFindings('', prompt).error, /not the JSON list/);
});

function cli(args, env, cwd) {
  return new Promise((done) => {
    const clean = { ...process.env, NO_COLOR: '1', ...env };
    for (const k of ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'ACCESSREADY_AI_KEY']) if (!(k in env)) delete clean[k];
    const child = spawn(process.execPath, [BIN, ...args], { env: clean, cwd });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => done({ code, stdout, stderr }));
  });
}

test('CLI: with --json - the plan goes to stderr, the findings into the JSON, the cache into the working folder', async () => {
  fake.reset();
  const cwd = mkdtempSync(join(dir, 'cli-'));
  const r = await cli([`${site.origin}/ai-image.html`, '--viewports', 'desktop', '--ai', 'anthropic:test-model', '--ai-base-url', `${fake.url}/v1`, '--json', '-'], { ANTHROPIC_API_KEY: 'test-key' }, cwd);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stderr, new RegExp(`AI review: sending the text, links, headings and form labels of 1 page and 2 images to anthropic \\(${fake.url}/v1/messages\\), model test-model\\. About 1 request\\.`));
  assert.match(r.stderr, /AI review \(anthropic, test-model\): judgments a person should confirm\n\/ai-image\.html {2}1 likely problem\n {2}AI {2}Image description does not say what the image is for {2}1\.1\.1 Non-text Content · ai-image-alt/);
  const data = JSON.parse(r.stdout);
  assert.deepEqual(data.pages[0].issues.filter((i) => i.source === 'ai').map((i) => [i.id, i.reason]), [['ai-image-alt', 'The description is the file name, not what the photo shows.']]);
  assert.equal(readdirSync(join(cwd, '.accessready-cache', 'ai')).length, 1);
});

test('CLI: AI mistakes in the arguments exit 2 before any browser starts', async () => {
  for (const [args, env, message] of [
    [['--ai', 'mistral:large'], {}, /AI provider must be one of anthropic, openai, gemini, lmstudio, ollama, openai-compatible, claude-code, codex, gemini-cli, qwen-code, got "mistral"/],
    [['--ai', 'anthropic'], {}, /anthropic needs provider:model/],
    [['--ai', 'anthropic:m'], {}, /anthropic needs an API key: set ANTHROPIC_API_KEY \(or ACCESSREADY_AI_KEY\)/],
    [['--ai', 'openai-compatible:m'], {}, /needs a base URL \(--ai-base-url\)/],
    [['--ai', 'ollama:m', '--ai-max-requests', 'lots'], {}, /--ai-max-requests needs a whole number/],
    [['--ai-max-requests', '3'], {}, /--ai-max-requests needs --ai/],
  ]) {
    const r = await cli([site.origin, ...args], env);
    assert.equal(r.code, 2, args.join(' '));
    assert.match(r.stderr, message);
    assert.doesNotMatch(r.stdout, /tab stop/, 'no page was audited');
  }
});
