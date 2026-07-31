// One OpenAI-compatible chat/completions client, parameterised per model.
//
// Nothing in here ever returns, logs, or serialises an API key. `describe()` is
// the only thing the browser sees and it reports presence, never value.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LAB_DIR, '..', '..');

// The models the maintainer named, verbatim. `requestedSlug` is what we are
// asked for; what the endpoint actually accepts is resolved at runtime.
export const MODELS = [
  {
    key: 'deepseek-v4-flash',
    requestedSlug: 'deepseek/deepseek-v4-flash-0731',
    label: 'DeepSeek V4 Flash',
    env: { key: 'DEEPSEEK_API_KEY', baseUrl: 'DEEPSEEK_BASE_URL', model: 'DEEPSEEK_MODEL' },
    defaultBaseUrl: 'https://api.deepseek.com',
  },
  {
    key: 'gpt-5.6-luna',
    requestedSlug: 'openai/gpt-5.6-luna',
    label: 'GPT-5.6 Luna',
    env: { key: 'OPENAI_API_KEY', baseUrl: 'OPENAI_BASE_URL', model: 'OPENAI_MODEL' },
    defaultBaseUrl: 'https://api.openai.com/v1',
  },
];

export const modelByKey = (key) => MODELS.find((m) => m.key === key || m.requestedSlug === key) || null;

// --------------------------------------------------------------- env loading

let ENV_CACHE = null;

function candidateEnvFiles() {
  const out = [];
  if (process.env.TOUR_LAB_ENV_FILE) out.push(process.env.TOUR_LAB_ENV_FILE);
  out.push(path.join(REPO_ROOT, '.env'));
  // This lab usually runs in a throwaway worktree; .env is untracked and lives
  // in whichever checkout the maintainer actually configured.
  try {
    const porcelain = execFileSync('git', ['-C', REPO_ROOT, 'worktree', 'list', '--porcelain'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    for (const line of porcelain.split('\n')) {
      if (line.startsWith('worktree ')) out.push(path.join(line.slice(9).trim(), '.env'));
    }
  } catch {
    /* not a git checkout; the repo-root candidate still applies */
  }
  return out;
}

function parseEnvFile(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const k = trimmed.slice(0, eq).trim();
    let v = trimmed.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[k] = v;
  }
  return out;
}

export function labEnv() {
  if (ENV_CACHE) return ENV_CACHE;
  const merged = {};
  const sources = [];
  for (const file of candidateEnvFiles()) {
    if (!fs.existsSync(file)) continue;
    const parsed = parseEnvFile(fs.readFileSync(file, 'utf8'));
    for (const [k, v] of Object.entries(parsed)) if (merged[k] === undefined) merged[k] = v;
    sources.push(file);
  }
  // Real process env always wins over a dotfile.
  for (const k of Object.keys(merged)) if (process.env[k]) merged[k] = process.env[k];
  for (const k of ['DEEPSEEK_API_KEY', 'DEEPSEEK_BASE_URL', 'DEEPSEEK_MODEL', 'OPENAI_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_MODEL']) {
    if (process.env[k]) merged[k] = process.env[k];
  }
  ENV_CACHE = { vars: merged, sources };
  return ENV_CACHE;
}

const readEnv = (name) => {
  const v = labEnv().vars[name];
  return v && String(v).trim() ? String(v).trim() : null;
};

// -------------------------------------------------------- slug resolution

// Aggregators route by `vendor/model`; a vendor's own endpoint wants the bare
// name. Decide from the host, then confirm against /models rather than guessing.
const AGGREGATOR_HOSTS = /(^|\.)(openrouter\.ai|together\.xyz|api\.together\.ai|litellm|helicone\.ai|openpipe\.ai)$/i;

export function endpointStyle(baseUrl) {
  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = '';
  }
  if (AGGREGATOR_HOSTS.test(host)) return { style: 'aggregator', host };
  return { style: 'direct', host };
}

const bare = (slug) => String(slug).split('/').pop();
const vendored = (slug, vendorHint) => (slug.includes('/') ? slug : `${vendorHint}/${slug}`);

async function listModels(baseUrl, apiKey) {
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, '')}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return null;
    const j = await res.json();
    const ids = (j.data || []).map((m) => m.id).filter(Boolean);
    return ids.length ? ids : null;
  } catch {
    return null;
  }
}

/**
 * Work out which model string this endpoint will actually accept, preferring
 * the slug we were asked for and degrading loudly, never silently.
 */
export async function resolveModelSlug(spec, { baseUrl, apiKey }) {
  const { style, host } = endpointStyle(baseUrl);
  const requested = spec.requestedSlug;
  const configured = readEnv(spec.env.model);
  const vendorHint = requested.includes('/') ? requested.split('/')[0] : spec.key.split('-')[0];

  const preferred = style === 'aggregator'
    ? [vendored(requested, vendorHint), bare(requested)]
    : [bare(requested), vendored(requested, vendorHint)];
  const fallbacks = configured
    ? style === 'aggregator'
      ? [vendored(configured, vendorHint), bare(configured)]
      : [bare(configured), vendored(configured, vendorHint)]
    : [];

  const tried = [...new Set([...preferred, ...fallbacks])];
  const available = await listModels(baseUrl, apiKey);

  if (available) {
    for (const cand of tried) {
      if (available.includes(cand)) {
        return {
          slug: cand,
          requested,
          configured,
          endpointStyle: style,
          endpointHost: host,
          form: cand.includes('/') ? 'vendor/model' : 'bare',
          via: 'models-list',
          exact: bare(cand) === bare(requested),
          tried,
          note:
            bare(cand) === bare(requested)
              ? `endpoint accepts the requested slug in ${cand.includes('/') ? 'vendor/model' : 'bare'} form`
              : `endpoint does not publish "${requested}"; fell back to "${cand}" (nearest configured/available model). Results are NOT from the exact requested build.`,
          availableSample: available.slice(0, 12),
        };
      }
    }
    // Nothing matched outright: take the longest listed id that prefixes the
    // requested bare name, i.e. the undated build of the same family.
    const wanted = bare(requested);
    const prefix = available
      .filter((id) => wanted.startsWith(bare(id)) || bare(id).startsWith(wanted))
      .sort((a, b) => bare(b).length - bare(a).length)[0];
    if (prefix) {
      return {
        slug: prefix,
        requested,
        configured,
        endpointStyle: style,
        endpointHost: host,
        form: prefix.includes('/') ? 'vendor/model' : 'bare',
        via: 'family-prefix-fallback',
        exact: false,
        tried,
        note: `endpoint rejects "${requested}" (published ids: ${available.slice(0, 6).join(', ')}). Fell back to the same family without the date suffix: "${prefix}". Numbers below are that build, not the dated one.`,
        availableSample: available.slice(0, 12),
      };
    }
  }

  // No usable /models listing: go with the style-preferred form and let the
  // first real call succeed or fail on its own terms.
  return {
    slug: tried[0],
    requested,
    configured,
    endpointStyle: style,
    endpointHost: host,
    form: tried[0].includes('/') ? 'vendor/model' : 'bare',
    via: 'unverified',
    exact: bare(tried[0]) === bare(requested),
    tried,
    note: 'endpoint did not serve a /models listing; using the form its URL style implies, unverified.',
    availableSample: [],
  };
}

// ------------------------------------------------------------------- client

export class ModelClient {
  constructor(spec) {
    this.spec = spec;
    this.apiKey = readEnv(spec.env.key);
    this.baseUrl = (readEnv(spec.env.baseUrl) || spec.defaultBaseUrl).replace(/\/$/, '');
    this.resolution = null;
  }

  get configured() {
    return Boolean(this.apiKey);
  }

  describe() {
    const { style, host } = endpointStyle(this.baseUrl);
    return {
      key: this.spec.key,
      label: this.spec.label,
      requestedSlug: this.spec.requestedSlug,
      configured: this.configured,
      keyEnvVar: this.spec.env.key,
      baseUrlEnvVar: this.spec.env.baseUrl,
      modelEnvVar: this.spec.env.model,
      baseUrl: this.configured ? this.baseUrl : null,
      endpointStyle: style,
      endpointHost: this.configured ? host : null,
      reason: this.configured ? null : `no key configured — set ${this.spec.env.key} (and optionally ${this.spec.env.baseUrl}) in the repo .env`,
    };
  }

  async ensureResolved() {
    if (!this.configured) {
      const err = new Error(
        `${this.spec.label} has no key configured. Set ${this.spec.env.key} in the repo .env (optionally ${this.spec.env.baseUrl}) and reload.`
      );
      err.code = 'NO_KEY';
      throw err;
    }
    if (!this.resolution) {
      this.resolution = await resolveModelSlug(this.spec, { baseUrl: this.baseUrl, apiKey: this.apiKey });
    }
    return this.resolution;
  }

  /** One chat/completions round trip with usage + latency captured. */
  async chat({ messages, tools, maxTokens = 6000, temperature = 0.3, signal }) {
    const resolution = await this.ensureResolved();
    const body = {
      model: resolution.slug,
      messages,
      max_tokens: maxTokens,
      temperature,
    };
    if (tools && tools.length) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }
    // OpenRouter-style endpoints will hand back their own accounted cost.
    if (resolution.endpointStyle === 'aggregator') body.usage = { include: true };

    const started = Date.now();
    let res;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal,
      });
    } catch (cause) {
      const err = new Error(`${this.spec.label}: network error reaching ${this.baseUrl} — ${cause.message}`);
      err.code = 'NETWORK';
      throw err;
    }
    // Measured after the body lands: fetch resolves on headers, and for a
    // reasoning model most of the wall clock is spent after that point.
    const text = await res.text();
    const latencyMs = Date.now() - started;
    if (!res.ok) {
      let detail = text.slice(0, 400);
      try {
        detail = JSON.parse(text)?.error?.message || detail;
      } catch {
        /* keep raw */
      }
      const err = new Error(`${this.spec.label}: endpoint returned ${res.status} — ${detail}`);
      err.code = 'HTTP_' + res.status;
      err.latencyMs = latencyMs;
      throw err;
    }
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      const err = new Error(`${this.spec.label}: endpoint returned non-JSON body`);
      err.code = 'BAD_JSON';
      throw err;
    }
    const choice = (json.choices || [])[0] || {};
    const message = choice.message || {};
    const usage = json.usage || {};
    return {
      message,
      finishReason: choice.finish_reason || choice.native_finish_reason || null,
      latencyMs,
      usage: {
        promptTokens: usage.prompt_tokens ?? 0,
        completionTokens: usage.completion_tokens ?? 0,
        totalTokens: usage.total_tokens ?? (usage.prompt_tokens ?? 0) + (usage.completion_tokens ?? 0),
        reasoningTokens: usage.completion_tokens_details?.reasoning_tokens ?? 0,
        cachedPromptTokens:
          usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0,
        // Only some endpoints account cost themselves; when they do we prefer it.
        providerCostUsd:
          typeof usage.cost === 'number'
            ? usage.cost
            : typeof json.cost === 'number'
              ? json.cost
              : null,
      },
      raw: { id: json.id, model: json.model, provider: json.provider || null },
    };
  }
}

const CLIENTS = new Map();
export function clientFor(key) {
  const spec = modelByKey(key);
  if (!spec) throw new Error(`unknown model "${key}"`);
  if (!CLIENTS.has(spec.key)) CLIENTS.set(spec.key, new ModelClient(spec));
  return CLIENTS.get(spec.key);
}
