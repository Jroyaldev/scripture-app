// The agent loop: a question in, a validated listening tour out, with every
// model call, token, and millisecond written down.
//
// The whole point of the experiment is that clip selection is driven by reading
// rather than by treatment length, so the loop gives the model tools and a hard
// stop, and refuses anything that doesn't satisfy the tour contract.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clientFor, modelByKey } from './model-client.mjs';
import {
  TOOL_SCHEMAS,
  runTool,
  validateTour,
  decorateTour,
  summarizeToolResult,
  MIN_CLIP_SECONDS,
  MAX_CLIP_SECONDS,
  MIN_STEPS,
  MAX_STEPS,
} from './tools.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const RUNS_DIR = path.join(LAB_DIR, 'runs');
const PRICING_FILE = path.join(LAB_DIR, 'pricing.json');
const LEDGER_FILE = path.join(RUNS_DIR, 'ledger.json');

export const MAX_MODEL_CALLS = 16;
export const MAX_TOOL_CALLS = 45;

const SYSTEM_PROMPT = `You are a listening guide for a corpus of 3,521 Bible-teaching podcast episodes (about 1,200 hours) that has been transcribed with word-level timestamps.

Given a person's question, a grief, a text, or a topic, you build them a TOUR: an ordered set of audio clips from real episodes that, listened to in order, actually answers what they brought. You are not assembling a playlist by length or by keyword. You are choosing clips because you have read what is in them and you know why each one earns its place.

HOW TO WORK
1. Read the request for what it really is. A doctrinal question wants an argument built; a grief wants company before explanation; a named text wants exposition; a whole-book request wants orientation.
2. Search widely before you commit. Run several differently-worded searches — the index is keyword-based, so search the words a teacher would say out loud, not abstract labels. If the person named a scripture text, call moments_for_passage — and read_passage the text itself, so you search for the words the passage actually uses and your "why" quotes the text rather than your memory of it.
3. READ THE TAPE before you pick a clip. Call transcript_window around every candidate timestamp. A search snippet tells you a topic is present; only the window tells you where the thought starts, where it lands, and whether it is any good.
4. Set clip boundaries at thought boundaries. Start where the speaker begins the point, end after they land it. Do not start mid-sentence.
5. Build an arc. ${MIN_STEPS}-${MAX_STEPS} steps, ordered so that each one is standing on the one before. Prefer several voices over several clips of one voice, unless one teacher genuinely carries the argument.
6. Call submit_tour. That is the only way to finish.

CLIP RULES (the server enforces these and will reject the tour)
- Every clip is at least ${MIN_CLIP_SECONDS}s and at most ${MAX_CLIP_SECONDS}s (15 minutes).
- endSec must not run past the episode's duration.
- recordId must be exactly as returned by the tools.

WRITING THE "why"
Each step's "why" says what this clip does for this listener and what is in it — and it should quote or closely paraphrase something the transcript actually says. These are machine transcripts of people talking; report what the speaker says, do not assert it as settled truth, and do not attribute to a speaker anything you did not read in a transcript window. If teachers in the corpus disagree, say so plainly rather than flattening them.

Write the intro and closing as if speaking to the person who asked, in plain warm prose. No headings, no bullet points, no markdown.`;

// ------------------------------------------------------------------ pricing

export function loadPricing() {
  return JSON.parse(fs.readFileSync(PRICING_FILE, 'utf8'));
}

function priceRun(modelKey, totals, providerCostUsd) {
  const pricing = loadPricing();
  const rates = pricing.models?.[modelKey] || null;
  if (providerCostUsd != null) {
    return {
      source: 'provider',
      totalUsd: Number(providerCostUsd.toFixed(6)),
      inputUsd: null,
      outputUsd: null,
      rateCard: rates,
      note: 'endpoint reported its own accounted cost; the local price table was not used',
    };
  }
  if (!rates) {
    return { source: 'unpriced', totalUsd: null, inputUsd: null, outputUsd: null, rateCard: null, note: `no rate entry for "${modelKey}" in pricing.json` };
  }
  const cached = Math.min(totals.cachedPromptTokens || 0, totals.promptTokens);
  const fresh = totals.promptTokens - cached;
  const inputUsd =
    (fresh / 1e6) * (rates.inputPerMTokensUsd || 0) +
    (cached / 1e6) * (rates.cachedInputPerMTokensUsd ?? rates.inputPerMTokensUsd ?? 0);
  const outputUsd = (totals.completionTokens / 1e6) * (rates.outputPerMTokensUsd || 0);
  return {
    source: 'price-table',
    inputUsd: Number(inputUsd.toFixed(6)),
    outputUsd: Number(outputUsd.toFixed(6)),
    totalUsd: Number((inputUsd + outputUsd).toFixed(6)),
    rateCard: rates,
    note: 'endpoint reported no cost field; cost = tokens x pricing.json (rates are UNVERIFIED placeholders)',
  };
}

// ------------------------------------------------------------------- ledger

export function readLedger() {
  if (!fs.existsSync(LEDGER_FILE)) return { updatedAt: null, models: {}, totalUsd: 0, runs: 0 };
  try {
    return JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf8'));
  } catch {
    return { updatedAt: null, models: {}, totalUsd: 0, runs: 0 };
  }
}

function appendLedger(record) {
  fs.mkdirSync(RUNS_DIR, { recursive: true });
  const ledger = readLedger();
  const key = record.model.key;
  const m = ledger.models[key] || {
    requestedSlug: record.model.requestedSlug,
    resolvedSlug: record.model.resolvedSlug,
    runs: 0,
    ok: 0,
    failed: 0,
    promptTokens: 0,
    completionTokens: 0,
    modelCalls: 0,
    toolCalls: 0,
    totalUsd: 0,
    costSources: {},
    efforts: {},
  };
  m.resolvedSlug = record.model.resolvedSlug;
  // A model's runs can span efforts, so the ledger counts them rather than
  // pretending one number covers the row.
  m.efforts = m.efforts || {};
  const effort = record.model.reasoning?.effort || 'vendor-default';
  m.efforts[effort] = (m.efforts[effort] || 0) + 1;
  m.runs += 1;
  if (record.status === 'ok') m.ok += 1;
  else m.failed += 1;
  m.promptTokens += record.totals.promptTokens;
  m.completionTokens += record.totals.completionTokens;
  m.modelCalls += record.totals.modelCalls;
  m.toolCalls += record.totals.toolCalls;
  m.totalUsd = Number((m.totalUsd + (record.cost.totalUsd || 0)).toFixed(6));
  m.costSources[record.cost.source] = (m.costSources[record.cost.source] || 0) + 1;
  ledger.models[key] = m;
  ledger.runs = (ledger.runs || 0) + 1;
  ledger.totalUsd = Number(
    Object.values(ledger.models).reduce((a, x) => a + (x.totalUsd || 0), 0).toFixed(6)
  );
  ledger.updatedAt = new Date().toISOString();
  fs.writeFileSync(LEDGER_FILE, `${JSON.stringify(ledger, null, 2)}\n`);
  return ledger;
}

/** The run files are the source of truth; this recomputes the ledger from them. */
export function rebuildLedger() {
  if (fs.existsSync(LEDGER_FILE)) fs.unlinkSync(LEDGER_FILE);
  if (!fs.existsSync(RUNS_DIR)) return readLedger();
  let ledger = readLedger();
  for (const f of fs.readdirSync(RUNS_DIR).filter((x) => x.endsWith('.json') && x !== 'ledger.json').sort()) {
    try {
      ledger = appendLedger(JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8')));
    } catch {
      /* skip an unreadable record rather than losing the rest */
    }
  }
  return ledger;
}

// ---------------------------------------------------------------- the loop

export const CAVEATS = [
  'Clips on ad-inserted hosts (Megaphone: ask-nt-wright, spoken-gospel) can land up to ~2 minutes off against today’s stream. This is a known corpus-wide drift, not a bug in this tour.',
  'A tour is model output over machine transcripts. The "why" text should report what a transcript says; it is not a claim that the speaker is right.',
  'The player streams each episode straight from its publisher. A few hosts (Substack’s CDN, for one) refuse hotlinked requests and the step will say so and offer the URL instead — the clip boundaries are still good, the playback path is not.',
];

const safeJson = (s) => {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
};

// Models sometimes wrap a tour in prose or a fence instead of calling the tool.
function extractJsonObject(text) {
  if (!text) return null;
  const direct = safeJson(text.trim());
  if (direct) return direct;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    const j = safeJson(fenced[1].trim());
    if (j) return j;
  }
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) return safeJson(text.slice(first, last + 1));
  return null;
}

const runId = (modelKey) =>
  `${new Date().toISOString().replace(/[:.]/g, '-').replace('Z', '')}-${modelKey}`;

/**
 * Run one tour. `emit` receives progress events for the SSE stream.
 * Always writes a run record, whether the run succeeded or failed.
 */
export async function runTour({ prompt, modelKey, promptId = null, emit = () => {}, signal = null }) {
  const spec = modelByKey(modelKey);
  if (!spec) throw new Error(`unknown model "${modelKey}"`);
  const client = clientFor(spec.key);
  const id = runId(spec.key);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  const record = {
    runId: id,
    startedAt,
    promptId,
    prompt,
    model: {
      key: spec.key,
      label: spec.label,
      requestedSlug: spec.requestedSlug,
      resolvedSlug: null,
      resolution: null,
      // Which thinking budget this run asked for, where that came from, and
      // whether the endpoint could carry it. Written before the first call so
      // even a run that dies at resolution says what it was going to run at.
      reasoning: {
        effort: client.reasoning.effort,
        source: client.reasoning.source,
        envVar: spec.env.reasoning || null,
        applied: null,
      },
    },
    status: 'error',
    error: null,
    tour: null,
    calls: [],
    toolLog: [],
    rejections: [],
    totals: {
      modelCalls: 0,
      toolCalls: 0,
      promptTokens: 0,
      completionTokens: 0,
      reasoningTokens: 0,
      cachedPromptTokens: 0,
      wallMs: 0,
      modelLatencyMs: 0,
      toolMs: 0,
    },
    cost: { source: 'unpriced', totalUsd: null },
    caveats: CAVEATS,
  };

  const finish = (extra = {}) => {
    Object.assign(record, extra);
    record.totals.wallMs = Date.now() - t0;
    record.finishedAt = new Date().toISOString();
    const providerCost = record.calls.some((c) => c.providerCostUsd != null)
      ? record.calls.reduce((a, c) => a + (c.providerCostUsd || 0), 0)
      : null;
    record.cost = priceRun(spec.key, record.totals, providerCost);
    fs.mkdirSync(RUNS_DIR, { recursive: true });
    fs.writeFileSync(path.join(RUNS_DIR, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`);
    record.ledger = appendLedger(record);
    emit('done', { record });
    return record;
  };

  try {
    const resolution = await client.ensureResolved();
    record.model.resolvedSlug = resolution.slug;
    record.model.resolution = resolution;
    // The unified `reasoning` field only exists on aggregator endpoints.
    record.model.reasoning.applied =
      Boolean(client.reasoning.effort) && resolution.endpointStyle === 'aggregator';
    emit('model', { resolution, reasoning: record.model.reasoning });
  } catch (err) {
    // No key, or the endpoint could not be reached at all. Fail soft, in words.
    return finish({ status: 'error', error: { code: err.code || 'RESOLVE', message: err.message } });
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: `Build me a listening tour for this:\n\n${prompt}` },
  ];

  let toolCallCount = 0;

  /* The reply cap covers REASONING plus visible output on these endpoints,
     and the old 6,000 default was measured being eaten whole: luna at max
     effort spent 36,783 tokens thinking on one probe, hit `length` mid
     tool-call, and the provider delivered submit_tour with EMPTY arguments —
     which the validator then read as four missing fields. Every "rejected:
     4 problem(s)" across luna, luna-pro and deepseek on 2026-07-31 was this,
     and each one costs a whole extra model call to repair. The cap scales
     with the effort actually being sent, because the thinking budget is the
     thing the cap has to clear. */
  const effort = client.reasoningEffort;
  const maxTokens = effort === 'max' || effort === 'xhigh' ? 56000
    : effort === 'high' ? 28000
    : 12000;

  for (let step = 0; step < MAX_MODEL_CALLS; step += 1) {
    let reply;
    try {
      reply = await client.chat({ messages, tools: TOOL_SCHEMAS, maxTokens, signal });
    } catch (err) {
      return finish({ status: 'error', error: { code: err.code || 'CALL', message: err.message } });
    }

    record.totals.modelCalls += 1;
    record.totals.promptTokens += reply.usage.promptTokens;
    record.totals.completionTokens += reply.usage.completionTokens;
    record.totals.reasoningTokens += reply.usage.reasoningTokens;
    record.totals.cachedPromptTokens += reply.usage.cachedPromptTokens;
    record.totals.modelLatencyMs += reply.latencyMs;
    const calls = reply.message.tool_calls || [];
    record.calls.push({
      i: step,
      latencyMs: reply.latencyMs,
      promptTokens: reply.usage.promptTokens,
      completionTokens: reply.usage.completionTokens,
      reasoningTokens: reply.usage.reasoningTokens,
      cachedPromptTokens: reply.usage.cachedPromptTokens,
      toolCalls: calls.length,
      finishReason: reply.finishReason,
      providerCostUsd: reply.usage.providerCostUsd,
    });
    emit('call', { i: step, latencyMs: reply.latencyMs, usage: reply.usage, toolCalls: calls.length, totals: record.totals });

    // The assistant turn goes back verbatim so tool_call ids stay paired.
    messages.push({
      role: 'assistant',
      content: reply.message.content || '',
      ...(calls.length ? { tool_calls: calls } : {}),
    });

    if (calls.length) {
      let submitted = null;
      for (const call of calls) {
        const name = call.function?.name;
        const args = safeJson(call.function?.arguments || '{}') || {};
        toolCallCount += 1;
        record.totals.toolCalls = toolCallCount;

        if (name === 'submit_tour') {
          const check = validateTour(args);
          if (check.ok) {
            submitted = check.tour;
            messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify({ accepted: true }) });
            emit('tool', { name, ok: true, summary: 'tour accepted' });
          } else {
            record.rejections.push({ at: step, errors: check.errors, submitted: args });
            messages.push({
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({
                accepted: false,
                errors: check.errors,
                instruction: 'The tour was rejected and NOT saved. Fix exactly these problems and call submit_tour again. Do not change anything else.',
              }),
            });
            /* The model gets the full error list to repair against; the page
               was getting only the count, which made every rejection a
               question for the operator. Same list, both directions. */
            emit('tool', { name, ok: false, summary: `rejected: ${check.errors.length} problem(s)`, problems: check.errors });
          }
          continue;
        }

        if (toolCallCount > MAX_TOOL_CALLS) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: 'tool budget exhausted — submit_tour now with what you have' }),
          });
          continue;
        }

        const out = runTool(name, args);
        record.totals.toolMs += out.ms;
        const summary = summarizeToolResult(name, out.result);
        record.toolLog.push({ at: step, name, args, ms: out.ms, summary });
        messages.push({ role: 'tool', tool_call_id: call.id, content: out.payload });
        emit('tool', { name, args, ms: out.ms, summary, ok: !out.result?.error });
      }
      if (submitted) return finish({ status: 'ok', tour: decorateTour(submitted) });
      continue;
    }

    // No tool calls. Either it wrote the tour as text, or it stalled.
    const parsed = extractJsonObject(reply.message.content || '');
    if (parsed) {
      const check = validateTour(parsed);
      if (check.ok) return finish({ status: 'ok', tour: decorateTour(check.tour) });
      record.rejections.push({ at: step, errors: check.errors, submitted: parsed });
      messages.push({
        role: 'user',
        content: `That tour was rejected and NOT saved:\n- ${check.errors.join('\n- ')}\n\nFix exactly these problems and call the submit_tour tool.`,
      });
      emit('tool', { name: 'submit_tour', ok: false, summary: `rejected: ${check.errors.length} problem(s)`, problems: check.errors });
      continue;
    }

    messages.push({
      role: 'user',
      content:
        reply.finishReason === 'length'
          ? 'You ran out of output room before producing anything. Think more briefly, then call a tool or call submit_tour.'
          : 'You have not finished. Either use the tools to read more of the corpus, or call submit_tour with the finished tour. Do not answer in prose.',
    });
  }

  return finish({
    status: 'error',
    error: {
      code: 'NO_TOUR',
      message: `ran out of model calls (${MAX_MODEL_CALLS}) without a valid tour${record.rejections.length ? `; last rejection: ${record.rejections.at(-1).errors.join('; ')}` : ''}`,
    },
  });
}

// -------------------------------------------------------------- run history

export function listRuns({ limit = 60 } = {}) {
  if (!fs.existsSync(RUNS_DIR)) return [];
  return fs
    .readdirSync(RUNS_DIR)
    .filter((f) => f.endsWith('.json') && f !== 'ledger.json')
    .sort()
    .reverse()
    .slice(0, limit)
    .map((f) => {
      try {
        const r = JSON.parse(fs.readFileSync(path.join(RUNS_DIR, f), 'utf8'));
        return {
          runId: r.runId,
          startedAt: r.startedAt,
          promptId: r.promptId,
          prompt: r.prompt,
          model: r.model.key,
          resolvedSlug: r.model.resolvedSlug,
          effort: r.model.reasoning?.effort || null,
          status: r.status,
          title: r.tour?.title || null,
          steps: r.tour?.steps?.length || 0,
          totalUsd: r.cost?.totalUsd ?? null,
          costSource: r.cost?.source,
          wallMs: r.totals?.wallMs,
          toolCalls: r.totals?.toolCalls,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readRun(id) {
  const file = path.join(RUNS_DIR, `${path.basename(id)}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
