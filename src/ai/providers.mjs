// The model providers the AI review can talk to, and the one request each of them takes.
// Two wire formats cover all of them: Anthropic's Messages API, and OpenAI's Chat
// Completions, which LM Studio, Ollama and Google Gemini also accept. Node's own fetch is
// used, so there is no SDK to install or keep up to date.
//
// Formats checked against the providers' docs (November 2026):
//   https://platform.claude.com/docs/en/api/messages
//   https://platform.claude.com/docs/en/api/versioning
//   https://platform.claude.com/docs/en/build-with-claude/vision
//   https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
//   https://developers.openai.com/api/docs/guides/images-vision
//   https://aistudio.google.com/docs/openai (was ai.google.dev/gemini-api/docs/openai)
//   https://docs.ollama.com/api/openai-compatibility
//   https://lmstudio.ai/docs/developer/openai-compat
import { resolve } from 'node:path';

// The latest Messages API version. It only removes sampling parameters, which are not sent.
const ANTHROPIC_VERSION = '2026-10-21';

export const PROVIDERS = {
  anthropic: { format: 'anthropic', base: 'https://api.anthropic.com/v1', key: 'ANTHROPIC_API_KEY' },
  openai: { format: 'openai', base: 'https://api.openai.com/v1', key: 'OPENAI_API_KEY', role: 'developer', jsonMode: true },
  gemini: { format: 'openai', base: 'https://generativelanguage.googleapis.com/v1beta/openai', key: 'GEMINI_API_KEY' },
  lmstudio: { format: 'openai', base: 'http://localhost:1234/v1' },
  ollama: { format: 'openai', base: 'http://localhost:11434/v1' },
  'openai-compatible': { format: 'openai', base: null },
};

export const AI_DEFAULTS = { maxRequests: 50, cache: true, images: true, timeout: 180_000, retryDelay: 2000 };

// Turns what the user asked for ("anthropic:<model>" or an object) into everything a request
// needs. Returns { error } instead of throwing, so the CLI can report it in its own words
// before any browser starts, and audit() can raise it as its own error type.
export function resolveAi(input, env = process.env) {
  const given = typeof input === 'string' ? { use: input } : { ...input };
  let { provider, model } = given;
  if (given.use) {
    // Split on the first colon only: Ollama model names have colons of their own (name:tag).
    const at = given.use.indexOf(':');
    provider = at < 0 ? given.use : given.use.slice(0, at);
    model = at < 0 ? '' : given.use.slice(at + 1);
  }
  provider = String(provider || '').trim().toLowerCase();
  model = String(model || '').trim();
  const known = Object.keys(PROVIDERS);
  if (!PROVIDERS[provider]) return { error: `AI provider must be one of ${known.join(', ')}, got "${provider}"` };
  if (!model) return { error: `name the model as provider:model, for example ${provider}:<model name from your provider>` };
  const p = PROVIDERS[provider];

  const base = given.baseUrl || p.base;
  if (!base) return { error: `${provider} needs a base URL (--ai-base-url), for example http://localhost:8080/v1` };
  let url;
  try { url = new URL(base); } catch { return { error: `AI base URL is not a URL: ${base}` }; }
  if (!/^https?:$/.test(url.protocol)) return { error: `AI base URL must be http or https: ${base}` };

  // ACCESSREADY_AI_KEY first, so a key kept for this tool alone wins over a general one.
  const key = given.apiKey || env.ACCESSREADY_AI_KEY || (p.key ? env[p.key] : '') || '';
  if (p.key && !key) return { error: `${provider} needs an API key: set ${p.key} (or ACCESSREADY_AI_KEY)` };

  const path = p.format === 'anthropic' ? '/messages' : '/chat/completions';
  const trimmed = url.href.replace(/\/+$/, '');
  const endpoint = trimmed.endsWith(path) ? trimmed : trimmed + path;

  const maxRequests = given.maxRequests ?? AI_DEFAULTS.maxRequests;
  if (!Number.isInteger(maxRequests) || maxRequests < 0) return { error: `the AI request limit must be a whole number, got ${maxRequests}` };

  return {
    ai: {
      provider, model, format: p.format, endpoint, key,
      role: p.role || 'system', jsonMode: !!p.jsonMode,
      maxRequests,
      cache: given.cache ?? AI_DEFAULTS.cache,
      cacheDir: given.cacheDir || resolve('.accessready-cache', 'ai'),
      images: given.images ?? AI_DEFAULTS.images,
      timeout: given.timeout ?? AI_DEFAULTS.timeout,
      retryDelay: given.retryDelay ?? AI_DEFAULTS.retryDelay,
      onPlan: given.onPlan || (() => {}),
    },
  };
}

// The request body for one prompt: a system text, a user text, and pictures each labelled
// with the item they belong to. The body is also what the cache is keyed on.
export function requestBody(ai, { system, text, pictures = [] }) {
  if (ai.format === 'anthropic') {
    const content = [{ type: 'text', text }];
    for (const pic of pictures) {
      content.push({ type: 'text', text: `Image ${pic.id}:` });
      content.push({ type: 'image', source: { type: 'base64', media_type: pic.mediaType, data: pic.data } });
    }
    // The answer is a short JSON list; 4096 tokens leaves room for a long page's findings.
    return { model: ai.model, max_tokens: 4096, system, messages: [{ role: 'user', content }] };
  }
  const content = [{ type: 'text', text }];
  for (const pic of pictures) {
    content.push({ type: 'text', text: `Image ${pic.id}:` });
    content.push({ type: 'image_url', image_url: { url: `data:${pic.mediaType};base64,${pic.data}` } });
  }
  // No token limit is sent: OpenAI's reasoning models count their thinking against it, and
  // the field differs between OpenAI and the compatible servers. JSON mode is only asked of
  // OpenAI itself; the others document it differently or not at all, and the prompt already
  // asks for JSON only.
  return {
    model: ai.model,
    messages: [{ role: ai.role, content: system }, { role: 'user', content }],
    ...(ai.jsonMode ? { response_format: { type: 'json_object' } } : {}),
  };
}

function headers(ai) {
  if (ai.format === 'anthropic') return { 'content-type': 'application/json', 'x-api-key': ai.key, 'anthropic-version': ANTHROPIC_VERSION };
  return { 'content-type': 'application/json', ...(ai.key ? { authorization: `Bearer ${ai.key}` } : {}) };
}

// What the model said, whether it was cut short, and what it cost in tokens.
function readAnswer(ai, json) {
  if (ai.format === 'anthropic') {
    const text = (json?.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    return { text, cutOff: json?.stop_reason === 'max_tokens', refused: json?.stop_reason === 'refusal', usage: { input: json?.usage?.input_tokens || 0, output: json?.usage?.output_tokens || 0 } };
  }
  const choice = json?.choices?.[0];
  return { text: choice?.message?.content || '', cutOff: choice?.finish_reason === 'length', refused: !!choice?.message?.refusal || choice?.finish_reason === 'content_filter', usage: { input: json?.usage?.prompt_tokens || 0, output: json?.usage?.completion_tokens || 0 } };
}

export class AiRequestError extends Error {
  constructor(message, { fatal = false } = {}) { super(message); this.fatal = fatal; }
}

async function errorDetail(res) {
  const body = await res.text().catch(() => '');
  try {
    const j = JSON.parse(body);
    return String(j?.error?.message || j?.message || (typeof j?.error === 'string' ? j.error : '') || '').slice(0, 200);
  } catch {
    return body.replace(/\s+/g, ' ').trim().slice(0, 200);
  }
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

// Sends one request, with one retry when the provider is busy (429) or failing (5xx).
// `take()` is asked before every attempt, so the retry counts against the request limit
// like any other call. Errors that will repeat for every page (a refused key, an unknown
// model, nothing listening) are marked fatal so the run stops asking.
export async function send(ai, body, take) {
  const host = new URL(ai.endpoint).host;
  for (let attempt = 0; ; attempt++) {
    if (!take()) throw new AiRequestError('the AI request limit was reached before a retry could be sent');
    let res;
    try {
      res = await fetch(ai.endpoint, { method: 'POST', headers: headers(ai), body: JSON.stringify(body), signal: AbortSignal.timeout(ai.timeout) });
    } catch (e) {
      if (e.name === 'TimeoutError') throw new AiRequestError(`${ai.provider} gave no answer within ${Math.round(ai.timeout / 1000)} seconds`);
      const code = e.cause?.code || '';
      throw new AiRequestError(`could not reach ${host}${code ? ` (${code})` : ''}`, { fatal: ['ECONNREFUSED', 'ENOTFOUND'].includes(code) });
    }
    if (res.ok) {
      const json = await res.json().catch(() => null);
      if (!json) throw new AiRequestError(`${ai.provider} sent an answer that is not JSON`);
      return readAnswer(ai, json);
    }
    const detail = await errorDetail(res);
    if (attempt === 0 && (res.status === 429 || res.status >= 500)) {
      // Retry-After in seconds when the provider sends it (capped, so a run never stalls).
      const header = res.headers.get('retry-after');
      const after = header === null ? NaN : Number(header);
      await sleep(Number.isFinite(after) && after >= 0 ? Math.min(after, 30) * 1000 : ai.retryDelay);
      continue;
    }
    throw new AiRequestError(`${ai.provider} answered ${res.status}${detail ? `: ${detail}` : ''}`, { fatal: [401, 403, 404].includes(res.status) });
  }
}
