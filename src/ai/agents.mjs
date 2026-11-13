// Coding-agent command line tools as AI review providers: Claude Code, OpenAI Codex, Gemini
// CLI and Qwen Code. Each one runs headless as a child process with the account its user is
// already logged in to, gets the same prompt as the API providers, and has its answer read
// the same way. These tools can edit files and run commands, so each is started with
// everything of that kind turned off, in an empty folder made for the one request and
// removed straight after.
//
// Flags checked against each tool's own --help on this machine (claude 2.1.310, codex
// 0.167.0, gemini 0.33.1; qwen was not installed) and against the docs (November 2026):
//   https://code.claude.com/docs/en/headless
//   https://code.claude.com/docs/en/cli-reference
//   https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode (image blocks on stdin)
//   https://learn.chatgpt.com/docs/non-interactive-mode (was developers.openai.com/codex/noninteractive)
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md
//   https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md
//   https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/approval-mode.md
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { AiRequestError } from './error.mjs';

// `images`: whether the tool takes pictures in non-interactive mode. Claude Code takes them
// as base64 blocks on stdin, Codex as files (--image). Neither Gemini CLI's nor Qwen Code's
// docs give a way to attach an image to a headless prompt, so they get text only.
export const AGENTS = {
  'claude-code': { bin: 'claude', name: 'Claude Code', install: 'curl -fsSL https://claude.ai/install.sh | bash (or npm install -g @anthropic-ai/claude-code)', images: true },
  codex: { bin: 'codex', name: 'OpenAI Codex', install: 'npm install -g @openai/codex (or brew install --cask codex)', images: true },
  'gemini-cli': { bin: 'gemini', name: 'Gemini CLI', install: 'npm install -g @google/gemini-cli', images: false },
  'qwen-code': { bin: 'qwen', name: 'Qwen Code', install: 'npm install -g @qwen-code/qwen-code@latest (or brew install qwen-code)', images: false },
};

// Codex features that act on the machine or the outside world. `-c features.<name>=false`
// is used instead of --disable because --disable rejects a name an older Codex does not
// know, while -c ignores it. Names from `codex features list` (0.167.0).
const CODEX_OFF = ['shell_tool', 'unified_exec', 'computer_use', 'browser_use', 'apps', 'plugins', 'hooks', 'multi_agent', 'image_generation'];

// Where a command lives on PATH, or null. Checked before any browser starts, so a missing
// tool is an argument error with install instructions rather than a failure later.
export function findCommand(bin, env = process.env) {
  const exts = process.platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : [''];
  for (const dir of (env.PATH || '').split(delimiter).filter(Boolean)) {
    for (const ext of exts) {
      const file = join(dir, bin + ext);
      try {
        accessSync(file, constants.X_OK);
        if (statSync(file).isFile()) return file;
      } catch { /* not here */ }
    }
  }
  return null;
}

// What is sent, and what the cache is keyed on. A tool that takes no images gets none.
export function agentBody(ai, { system, text, pictures }) {
  return { agent: ai.provider, model: ai.model || null, system, text, pictures: ai.images ? pictures : [] };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' };
const INSTRUCTION = 'Follow the instructions above. Answer with the JSON object only.';

// The command line and stdin for one request. Long prompts go on stdin, as each tool's docs
// recommend for piped input; arguments carry only flags.
export function agentCommand(ai, body, dir) {
  const model = (flag) => (ai.model ? [flag, ai.model] : []);
  const whole = `${body.system}\n\n${body.text}`;
  switch (ai.provider) {
    case 'claude-code': {
      // One user message in stream-json, so pictures travel as image blocks and Claude Code
      // needs no file tool to see them. --tools "" leaves it no tools at all, --safe-mode
      // skips the user's hooks, plugins, MCP servers and CLAUDE.md, and --system-prompt
      // replaces the coding-agent prompt with the review's own.
      const content = [{ type: 'text', text: body.text }];
      for (const pic of body.pictures) {
        content.push({ type: 'text', text: `Image ${pic.id}:` });
        content.push({ type: 'image', source: { type: 'base64', media_type: pic.mediaType, data: pic.data } });
      }
      return {
        args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
          '--system-prompt', body.system, '--tools', '', '--strict-mcp-config', '--safe-mode',
          '--permission-mode', 'dontAsk', '--no-session-persistence', ...model('--model')],
        input: JSON.stringify({ type: 'user', message: { role: 'user', content }, parent_tool_use_id: null }) + '\n',
      };
    }
    case 'codex': {
      // Pictures are written into the request's own folder and attached with --image. The
      // read-only sandbox is Codex's guarantee that nothing is changed; the features that
      // run commands or reach out are switched off on top of it. `--` ends the --image
      // list so the final `-` is read as "prompt on stdin".
      const files = body.pictures.map((pic) => {
        const file = join(dir, `${pic.id}.${EXT[pic.mediaType] || 'jpg'}`);
        writeFileSync(file, Buffer.from(pic.data, 'base64'));
        return file;
      });
      const order = body.pictures.length ? `\n\nThe attached images, in order, are items ${body.pictures.map((p) => p.id).join(', ')}.` : '';
      return {
        args: ['exec', '--sandbox', 'read-only', '--skip-git-repo-check', '--ephemeral', '--ignore-user-config', '--ignore-rules',
          '--color', 'never', ...CODEX_OFF.flatMap((f) => ['-c', `features.${f}=false`]),
          '-C', dir, '--output-last-message', join(dir, 'answer.txt'), ...model('-m'),
          ...files.flatMap((f) => ['--image', f]), '--', '-'],
        input: whole + order,
      };
    }
    default:
      // Gemini CLI and Qwen Code: plan mode is their read-only mode. The prompt is piped in
      // and -p, which forces headless mode, adds one line after it.
      return {
        args: ['--approval-mode', 'plan', '--output-format', 'json', ...model('-m'), '-p', INSTRUCTION],
        input: whole,
      };
  }
}

// The tool's own JSON output, which may follow a line or two of startup messages.
function envelope(stdout, bin) {
  const s = stdout.trim();
  const tries = [s];
  for (const [open, close] of [['{', '}'], ['[', ']']]) {
    const a = s.indexOf(open), b = s.lastIndexOf(close);
    if (a >= 0 && b > a) tries.push(s.slice(a, b + 1));
  }
  for (const t of tries) { try { return JSON.parse(t); } catch { /* next */ } }
  throw new AiRequestError(`${bin} printed something that is not its JSON output: "${s.replace(/\s+/g, ' ').slice(0, 120)}"`, { repeatable: true });
}

const tokens = (u) => ({ input: u?.input_tokens || u?.prompt_tokens || 0, output: u?.output_tokens || u?.completion_tokens || 0 });

// The model's answer text from what the tool printed, in the shape send() returns.
export function readAgentOutput(ai, stdout, dir) {
  const bin = AGENTS[ai.provider].bin;
  if (ai.provider === 'codex') {
    // Codex writes its final message to --output-last-message; stdout holds the same.
    const file = join(dir, 'answer.txt');
    return { text: existsSync(file) ? readFileSync(file, 'utf8') : stdout, cutOff: false, refused: false, usage: tokens(null) };
  }
  if (ai.provider === 'claude-code') {
    // stream-json: one JSON object per line; the last `result` line holds the answer.
    const lines = stdout.split('\n').map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const result = lines.filter((l) => l.type === 'result').pop();
    if (!result) throw new AiRequestError(`${bin} printed no result: "${stdout.replace(/\s+/g, ' ').trim().slice(0, 120)}"`, { repeatable: true });
    if (result.is_error || result.subtype !== 'success') throw new AiRequestError(`Claude Code reported an error: ${String(result.result || result.subtype).slice(0, 200)}`, { repeatable: true });
    return { text: String(result.result || ''), cutOff: false, refused: false, usage: tokens(result.usage) };
  }
  const out = envelope(stdout, bin);
  if (ai.provider === 'gemini-cli') {
    // { response, stats, error }
    if (out.error) throw new AiRequestError(`Gemini CLI reported an error: ${String(out.error.message || JSON.stringify(out.error)).slice(0, 200)}`, { repeatable: true });
    return { text: String(out.response || ''), cutOff: false, refused: false, usage: tokens(null) };
  }
  // Qwen Code: an array of messages, the result last.
  const result = (Array.isArray(out) ? out : [out]).filter((m) => m && m.type === 'result').pop();
  if (!result) throw new AiRequestError(`${bin} printed no result message`, { repeatable: true });
  if (result.is_error) throw new AiRequestError(`Qwen Code reported an error: ${String(result.result || result.subtype).slice(0, 200)}`, { repeatable: true });
  return { text: String(result.result || ''), cutOff: false, refused: false, usage: tokens(result.usage) };
}

// Runs a command with stdin, a time limit, and the whole process group stopped on timeout
// (these tools start helpers of their own).
function run(cmd, args, { cwd, env, input, timeout }) {
  return new Promise((done) => {
    let finished = false;
    const finish = (r) => { if (!finished) { finished = true; clearTimeout(timer); done(r); } };
    const group = process.platform !== 'win32';
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: group });
    let stdout = '', stderr = '', timedOut = false;
    const stop = (signal) => { try { if (group) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already gone */ } };
    const timer = setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      setTimeout(() => stop('SIGKILL'), 2000).unref();
    }, timeout);
    child.stdout.on('data', (d) => { if (stdout.length < 20_000_000) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1_000_000) stderr += d; });
    child.on('error', (error) => finish({ error }));
    child.on('close', (code, signal) => finish({ code, signal, stdout, stderr, timedOut }));
    child.stdin.on('error', () => { /* the tool exited before reading all of stdin */ });
    child.stdin.end(input);
  });
}

const lastLine = (s) => s.split('\n').map((l) => l.trim()).filter(Boolean).pop() || '';

// One request through a coding-agent CLI. The folder it runs in holds only the pictures for
// this request and is removed whatever happens.
export async function runAgent(ai, body) {
  const agent = AGENTS[ai.provider];
  const dir = mkdtempSync(join(tmpdir(), 'accessready-ai-'));
  try {
    const { args, input } = agentCommand(ai, body, dir);
    const res = await run(ai.bin, args, { cwd: dir, env: ai.env, input, timeout: ai.timeout });
    if (res.error) {
      throw new AiRequestError(`the ${agent.bin} command could not be started (${res.error.code || res.error.message}). Install ${agent.name} with: ${agent.install}`, { fatal: true });
    }
    if (res.timedOut) throw new AiRequestError(`${ai.provider} gave no answer within ${Math.round(ai.timeout / 1000)} seconds`);
    if (res.code !== 0) {
      const why = lastLine(res.stderr) || lastLine(res.stdout);
      throw new AiRequestError(`${agent.bin} exited with code ${res.code ?? res.signal}${why ? `: ${why.slice(0, 200)}` : ''}`, { repeatable: true });
    }
    return readAgentOutput(ai, res.stdout, dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
