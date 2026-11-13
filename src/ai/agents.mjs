// Coding-agent command line tools as AI review providers: Claude Code, OpenAI Codex, Gemini
// CLI and Qwen Code. Each one runs headless as a child process with the account its user is
// already logged in to, gets the same prompt as the API providers, and has its answer read
// the same way. These tools can edit files, run commands, fetch pages and load the user's
// own extensions, MCP servers and memory files, so each is started with all of that turned
// off, in a folder made for the one request (empty but for the files that lock Gemini CLI
// down) and removed straight after.
//
// Flags checked against each tool's own --help on this machine (claude 2.1.310, codex
// 0.167.0, gemini 0.33.1, whose source also has every Gemini flag used here; qwen was not
// installed) and against the docs (November 2026):
//   https://code.claude.com/docs/en/headless
//   https://code.claude.com/docs/en/cli-reference
//   https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode (image blocks on stdin)
//   https://learn.chatgpt.com/docs/non-interactive-mode (was developers.openai.com/codex/noninteractive)
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/headless.md
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/cli-reference.md
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md (-e none, project settings, context.fileName)
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/policy-engine.md (--policy, toolName "*")
//   https://github.com/google-gemini/gemini-cli/blob/main/docs/cli/trusted-folders.md (GEMINI_CLI_TRUST_WORKSPACE)
//   https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/headless.md (--safe-mode, --max-tool-calls)
//   https://github.com/QwenLM/qwen-code/blob/main/docs/users/configuration/settings.md (model.maxToolCalls: 0 allows none)
//   https://github.com/QwenLM/qwen-code/blob/main/docs/users/features/approval-mode.md
// Neither Gemini CLI nor Qwen Code is given an empty home folder (GEMINI_CLI_HOME, QWEN_HOME):
// the login lives there too, so an empty one would sign the user out.
import { spawn } from 'node:child_process';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { constants as osConstants, tmpdir } from 'node:os';
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

// Gemini CLI lockdown files, written into the request's own folder (see agentCommand).
const NO_MCP_SERVER = 'accessready-allows-no-mcp-server';
const NO_TOOLS_POLICY = '# Written by accessready for one review request: the model gets no tools at all.\n[[rule]]\ntoolName = "*"\ndecision = "deny"\npriority = 999\n';
const GEMINI_SETTINGS = {
  context: { fileName: 'accessready-reads-no-context-file.md', includeDirectoryTree: false, memoryBoundaryMarkers: ['.gemini'] },
  mcp: { allowed: [NO_MCP_SERVER] },
  skills: { enabled: false },
  hooksConfig: { enabled: false },
  experimental: { autoMemory: false },
};
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
    case 'gemini-cli': {
      // Plan mode is Gemini CLI's read-only mode, but it still loads the user's extensions,
      // MCP servers and GEMINI.md files and offers read-only tools such as web fetch, and a
      // page under review could steer the model into using them. So: -e none turns off every
      // extension; --allowed-mcp-server-names with a name no server has connects none; a
      // policy that denies "*" removes every tool from what the model is offered; and
      // project settings in the request's own folder point the context file at a name that
      // does not exist (so no GEMINI.md, global or local, is read) and turn off skills,
      // hooks and automatic memory. Project settings are only read in a trusted folder;
      // GEMINI_CLI_TRUST_WORKSPACE trusts this one folder, which accessready just made, for
      // this one run. It is an environment variable rather than --skip-trust because older
      // versions reject a flag they do not know.
      mkdirSync(join(dir, '.gemini'));
      writeFileSync(join(dir, '.gemini', 'settings.json'), JSON.stringify(GEMINI_SETTINGS, null, 2));
      writeFileSync(join(dir, 'no-tools.toml'), NO_TOOLS_POLICY);
      return {
        args: ['--approval-mode', 'plan', '--extensions', 'none', '--allowed-mcp-server-names', NO_MCP_SERVER,
          '--policy', join(dir, 'no-tools.toml'), '--output-format', 'json', ...model('-m'), '-p', INSTRUCTION],
        input: whole,
        env: { GEMINI_CLI_TRUST_WORKSPACE: 'true' },
      };
    }
    default:
      // Qwen Code: --safe-mode skips context files (QWEN.md), hooks, extensions, skills, MCP
      // servers, memory and the user's permission rules; plan mode is its read-only mode; and
      // --max-tool-calls 0 allows no tool call at all (the run stops if the model tries one).
      return {
        args: ['--safe-mode', '--approval-mode', 'plan', '--max-tool-calls', '0', '--output-format', 'json', ...model('-m'), '-p', INSTRUCTION],
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

// Anthropic counts tokens served from or written to its prompt cache apart from input_tokens.
const tokens = (u) => ({ input: (u?.input_tokens || u?.prompt_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0), output: u?.output_tokens || u?.completion_tokens || 0 });

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

// Every CLI run still going, so Ctrl-C can stop them. Each runs in a process group of its
// own (so a timeout can stop the helpers it starts), which also means the terminal's SIGINT
// never reaches it, and Node exits on a signal without running any finally block. While a
// run is going, SIGINT and SIGTERM stop every group, remove every request folder, and exit
// with the code a shell gives that signal (130, 143). An exit by any other route stops and
// removes them too.
const running = new Set();
const cleanUp = () => {
  for (const r of running) {
    if (r.pid) { try { if (r.group) process.kill(-r.pid, 'SIGKILL'); else process.kill(r.pid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(r.dir, { recursive: true, force: true });
  }
  running.clear();
};
const onSignal = (signal) => { cleanUp(); process.exit(128 + osConstants.signals[signal]); };
function track(entry) {
  if (!running.size) { process.on('SIGINT', onSignal); process.on('SIGTERM', onSignal); process.on('exit', cleanUp); }
  running.add(entry);
}
function untrack(entry) {
  running.delete(entry);
  if (!running.size) { process.off('SIGINT', onSignal); process.off('SIGTERM', onSignal); process.off('exit', cleanUp); }
}

// How long output may still arrive after the tool itself has exited. A helper it started
// can hold stdout open for as long as it likes; past this, what arrived is what counts.
const EXIT_GRACE = 1000;
// How long a tool gets to stop after SIGTERM before it, and its group, get SIGKILL.
const KILL_AFTER = 2000;

// Runs a command with stdin and a time limit. It is over when the tool exits (plus
// EXIT_GRACE for the last of its output) or the time limit runs out, whether or not its
// pipes have closed: then the pipes are dropped and its whole process group is stopped, so a
// helper left holding stdout cannot keep the review waiting.
function run(cmd, args, { cwd, env, input, timeout, entry }) {
  return new Promise((done) => {
    let finished = false, grace = null, kill = null;
    const group = process.platform !== 'win32';
    const child = spawn(cmd, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: group });
    Object.assign(entry, { pid: child.pid, group });
    let stdout = '', stderr = '', timedOut = false;
    const stop = (signal) => { try { if (group) process.kill(-child.pid, signal); else child.kill(signal); } catch { /* already gone */ } };
    const finish = (r) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(grace); clearTimeout(kill);
      for (const pipe of [child.stdin, child.stdout, child.stderr]) pipe?.destroy();
      if (child.pid) stop('SIGKILL');
      done(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      stop('SIGTERM');
      kill = setTimeout(() => finish({ code: null, signal: 'SIGKILL', stdout, stderr, timedOut }), KILL_AFTER);
    }, timeout);
    child.stdout.on('data', (d) => { if (stdout.length < 20_000_000) stdout += d; });
    child.stderr.on('data', (d) => { if (stderr.length < 1_000_000) stderr += d; });
    child.on('error', (error) => finish({ error }));
    child.on('exit', (code, signal) => { grace = setTimeout(() => finish({ code, signal, stdout, stderr, timedOut }), EXIT_GRACE); });
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
  const entry = { dir, pid: null, group: false };
  track(entry);
  try {
    const { args, input, env } = agentCommand(ai, body, dir);
    const res = await run(ai.bin, args, { cwd: dir, env: env ? { ...(ai.env || process.env), ...env } : ai.env, input, timeout: ai.timeout, entry });
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
    untrack(entry);
    rmSync(dir, { recursive: true, force: true });
  }
}
