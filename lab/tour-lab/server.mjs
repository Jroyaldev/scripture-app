// Tiny static + proxy server for the tour lab.  npm run lab:tour
//
// The browser never sees an API key: every model call goes out from here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, indexExists, loadIndex, loadTranscript, CACHE_DIR, ARTIFACTS_DIR } from './corpus.mjs';
import {
  DIRECTOR_REFERENCE_MAX_VERSES,
  readPassage,
  resolveDirectorPassageReference,
  resolveDirectorPassageReferences,
} from './scripture.mjs';
import { MODELS, clientFor } from './model-client.mjs';
import { runTour, listRuns, readRun, readLedger, loadPricing, CAVEATS, MAX_MODEL_CALLS, MAX_TOOL_CALLS } from './tour-agent.mjs';
import {
  DIRECTOR_COPY_LIMITS,
  DIRECTOR_LIMITS,
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_MODEL_ROLES,
  assertMagicModel,
  assertMagicReplyEvidence,
  assertMagicRuntime,
  computeDirectorMovementBudget,
  createDirectorHousePrelude,
  directorCacheKey,
  directorRequestFingerprint,
  normalizeDirectorPlan,
  resolveMagicSearchModels,
  stableTextHash,
  summarizeVisualProjection,
  validateDirectorPayload,
} from './magic-contract.mjs';
import {
  listDirectorEvidence,
  listMagicRoleEvidence,
  listReplayFixtures,
  readDirectorEvidence,
  readReplayFixture,
  writeDirectorEvidence,
  writeMagicRoleEvidence,
} from './director-evidence.mjs';
import { createSharedDirectorJobs } from './magic-jobs.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TOUR_LAB_PORT || 5599);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

const DIRECTOR_JOBS = createSharedDirectorJobs({ maxCompleted: 24 });

function requestAbortScope(req, res) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  req.once('aborted', abort);
  res.once('close', abort);
  return {
    signal: controller.signal,
    release() {
      req.off('aborted', abort);
      res.off('close', abort);
    },
  };
}

function magicRuntimeDescriptor(client, resolution) {
  const described = client.describe();
  return {
    key: described.key,
    requestedSlug: described.requestedSlug,
    resolvedSlug: resolution.slug,
    endpointHost: resolution.endpointHost,
    endpointStyle: resolution.endpointStyle,
    reasoning: {
      effort: client.reasoning.effort,
      source: client.reasoning.source,
      applied: Boolean(client.reasoning.effort) && resolution.endpointStyle === 'aggregator',
    },
  };
}

async function preflightMagicRole(role) {
  const key = assertMagicModel(MAGIC_MODEL_ROLES[role]);
  const client = clientFor(key);
  const resolution = await client.ensureResolved();
  const runtime = assertMagicRuntime(magicRuntimeDescriptor(client, resolution));
  return { client, runtime };
}

function magicCallEvidence(role, reply, runtime, validation) {
  const observed = assertMagicReplyEvidence(reply, runtime);
  return {
    role,
    latencyMs: Math.max(0, Number(reply.latencyMs) || 0),
    promptTokens: Math.max(0, Number(reply.usage?.promptTokens) || 0),
    completionTokens: Math.max(0, Number(reply.usage?.completionTokens) || 0),
    reasoningTokens: Math.max(0, Number(reply.usage?.reasoningTokens) || 0),
    cachedPromptTokens: Math.max(0, Number(reply.usage?.cachedPromptTokens) || 0),
    providerCostUsd: reply.usage?.providerCostUsd ?? null,
    finishReason: reply.finishReason || null,
    rawModel: observed.rawModel,
    provider: observed.provider,
    model: { ...runtime, provider: observed.provider },
    validation,
  };
}

function magicCallTotals(calls, wallMs) {
  const costs = calls.map((call) => call.providerCostUsd);
  return {
    wallMs: Math.max(0, Number(wallMs) || 0),
    passes: calls.length,
    calls,
    totalUsd: calls.length && costs.every((cost) => Number.isFinite(cost) && cost >= 0)
      ? costs.reduce((sum, cost) => sum + cost, 0)
      : null,
    tokens: {
      prompt: calls.reduce((sum, call) => sum + call.promptTokens, 0),
      completion: calls.reduce((sum, call) => sum + call.completionTokens, 0),
      reasoning: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
      cachedPrompt: calls.reduce((sum, call) => sum + call.cachedPromptTokens, 0),
    },
  };
}

function acquireDirectorJob(requestKey, req, res, create) {
  const acquired = DIRECTOR_JOBS.acquire(requestKey, create);
  const release = () => {
    req.off('aborted', release);
    res.off('close', release);
    acquired.release();
  };
  req.once('aborted', release);
  res.once('close', release);
  return { ...acquired, release };
}

function ensureIndex() {
  if (indexExists()) return loadIndex().meta;
  process.stdout.write('building corpus index (first boot, one time)… ');
  const meta = buildIndex({
    onProgress: ({ done, total }) => {
      if (done && done % 1000 === 0) process.stdout.write(`${done}/${total} `);
    },
  });
  console.log(`done in ${(meta.buildMs / 1000).toFixed(1)}s — ${meta.docCount} episodes, ${meta.termCount} terms`);
  return meta;
}

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    return {};
  }
}

const DIRECTOR_KINDS = Object.freeze([
  'group', 'footnote', 'term', 'allusion', 'compare', 'chain', 'caveat', 'aside', 'highlight',
]);
const DIRECTOR_KIND_SET = new Set(DIRECTOR_KINDS);

const directorNorm = (value) => String(value ?? '')
  .toLowerCase()
  .replace(/[’']/g, "'")
  .replace(/[^a-z0-9' ]+/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const transcriptTupleText = (value) => String(value ?? '')
  .normalize('NFKC')
  .replace(/[’]/g, "'")
  .replace(/\s+/g, ' ')
  .trim();

const transcriptTupleNumber = (value) => Math.round(Number(value) * 1000) / 1000;

function transcriptWindowHash(segments) {
  const tuples = (Array.isArray(segments) ? segments : []).map((segment) => [
    transcriptTupleNumber(segment.s),
    transcriptTupleNumber(segment.e),
    transcriptTupleText(segment.t),
  ]);
  return stableTextHash(JSON.stringify(tuples));
}

function sustainedTeachingSeconds(segments, fromSec, toSec) {
  const intervals = (Array.isArray(segments) ? segments : [])
    .filter((segment) => transcriptTupleText(segment.t))
    .map((segment) => ({
      start: Math.max(fromSec, Number(segment.s)),
      end: Math.min(toSec, Number(segment.e)),
    }))
    .filter(({ start, end }) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = [];
  for (const interval of intervals) {
    const prior = merged.at(-1);
    if (prior && interval.start <= prior.end) prior.end = Math.max(prior.end, interval.end);
    else merged.push({ ...interval });
  }
  return Math.round(merged.reduce((sum, interval) => sum + interval.end - interval.start, 0) * 10) / 10;
}

function sampleTimedRows(rows, charBudget) {
  const safeRows = (Array.isArray(rows) ? rows : []).filter(Boolean);
  const budget = Math.max(1, Math.floor(Number(charBudget) || 1));
  const length = safeRows.reduce((sum, row) => sum + row.length + 1, 0);
  if (length <= budget) return safeRows.join('\n');
  const count = Math.max(2, Math.floor(safeRows.length * budget / Math.max(1, length)));
  return Array.from({ length: Math.min(count, safeRows.length) }, (_, index) => (
    safeRows[Math.round(index * (safeRows.length - 1) / Math.max(1, count - 1))]
  )).join('\n').slice(0, budget);
}

function evenlyDistributed(items, ceiling) {
  const list = Array.isArray(items) ? items : [];
  const cap = Math.max(0, Math.floor(Number(ceiling) || 0));
  if (list.length <= cap) return { kept: list, dropped: [] };
  if (!cap) return { kept: [], dropped: list };
  const indexes = new Set(Array.from({ length: cap }, (_, index) => (
    Math.round(index * (list.length - 1) / Math.max(1, cap - 1))
  )));
  return {
    kept: list.filter((_, index) => indexes.has(index)),
    dropped: list.filter((_, index) => !indexes.has(index)),
  };
}

const DIRECTOR_ACTION_GUIDE = `Classify the teacher's action before choosing a visual. Use exactly one most-specific kind for one teaching action; never duplicate the same moment as a specialized beat and a generic group. GROUP is only the fallback for a genuine pattern in the displayed passage's own wording.
For COMPARE, axis must be exactly "likeness" or "difference". Never substitute a synonym or silently reinterpret the teacher's comparison.
Write labels, glosses, notes, caveats, and asides as complete compact thoughts. Prefer one clause or one sentence under 16 words. Never submit a fragment that depends on the house truncating it; the house accepts copy whole or refuses it.
For GROUP, words must be a JSON array of exactly 2-4 items. Every item must be one exact single word copied from the displayed passage: never a phrase, comma-separated list, or explanatory label. If the teacher explicitly enumerates a wording pattern in a displayed passage, GROUP is the expected visual. The optional label must be at most four complete words and ${DIRECTOR_COPY_LIMITS.groupLabel} characters; omit it instead of shortening a word.
Shape examples only — never copy a cue or claim unless this transcript supports it:
- GROUP: {"kind":"group","sceneId":"s1","cue":"eyes that will not see","at":42,"data":{"words":["eyes","see","ears","hear"],"label":"refused senses"}}
- FOOTNOTE: {"kind":"footnote","sceneId":"s1","cue":"this is plural in Hebrew","at":54,"data":{"word":"rulers","note":"the teacher's translation point"}}
- TERM: {"kind":"term","cue":"the word hesed means","at":70,"data":{"term":"hesed","gloss":"loyal covenant love"}}
- ALLUSION: {"kind":"allusion","cue":"John is echoing Isaiah","at":82,"data":{"verse":"Isaiah 6:10","note":"the stated echo"}}
- COMPARE: {"kind":"compare","cue":"set these two passages together","at":96,"data":{"a":"Genesis 3:6","b":"Genesis 6:1-2","axis":"likeness","note":"the teacher's comparison"}}
- CHAIN: {"kind":"chain","cue":"Isaiah then John then Paul","at":112,"data":{"refs":["Isaiah 53:1","John 12:38","Romans 10:16"],"note":"the line being traced"}}
- CAVEAT: {"kind":"caveat","cue":"that is not what this says","at":128,"data":{"text":"The passage does not make that larger claim."}}
- ASIDE: {"kind":"aside","cue":"the city had become an empire","at":143,"data":{"text":"setting the ancient city's political context"}}
- HIGHLIGHT: {"kind":"highlight","at":158,"data":{"quote":"The point is not escape from creation but its renewal."}}`;

function buildDirectorInitialPrompt({ timedTape, why, budget }) {
  return `You direct a quiet editorial visual stage while a podcast clip plays. First identify structural passage/context movements. Then inventory the teacher's grounded actions and emit a flat chronological beat for each supported visual action. The [Ns] stamps are approximate seconds into this clip.

TIMECODED TRANSCRIPT COVERAGE FROM THE WHOLE CLIP:
${timedTape}

THE CLIP'S PURPOSE IN ITS TOUR:
${why}

STRUCTURAL SCENES:
- Return at most ${budget.modelSceneCeiling} model scenes. This is a safety ceiling, not a quota.
- Each scene needs a unique short id, a 3-8 word cue copied verbatim from the transcript, and its approximate integer second.
- verse is a canonical "Book chapter:verse" or same-chapter range of at most ${DIRECTOR_REFERENCE_MAX_VERSES} verses, or null for a substantial context/story/application movement with no displayed passage.
- Use a passage only when the teacher actually walks through it, not when it is merely mentioned.
- The house may add its own prelude; do not spend a scene on empty throat-clearing.

SEMANTIC BEATS:
- Return a flat beats array, independent of the scene objects, ordered by approximate time.
- Every beat needs kind, approximate at, data, and a distinctive 3-8 word cue copied verbatim from the transcript. A highlight's verbatim quote may serve as its cue.
- group and footnote also need sceneId because they are coordinates in that displayed passage. Other kinds may name sceneId, but verified podcast time owns their final scene.
- Compare and chain may use same-chapter ranges of at most ${DIRECTOR_REFERENCE_MAX_VERSES} verses per reference. A chain has 2-4 distinct references in order.
- The editorial target is about ${budget.targetThoughtEntrances} grounded visual entrances across this clip; the absolute hard maximum is ${budget.hardBeatCeiling}. Do not turn the ceiling into a quota. Silence is better than invention; distribute supported beats across the whole clip.
- Choose the most specific supported semantic action first: footnote, term, allusion, compare, chain, caveat, or aside. Use group only for a real pattern in displayed Scripture wording. Never substitute highlight for a more precise type.
- HIGHLIGHT IS RARE: zero is normal and this clip may retain at most ${budget.highlightCeiling}. It must be one exact, teacher-authored sentence that distills the teacher's own interpretive thesis. Never highlight a Scripture quotation or paraphrase, biblical narration, setup, transition, application slogan, or ordinary exposition.
- Do not author duration, layout, color, channel, Scripture wording, or rendering instructions. The house owns those.

${DIRECTOR_ACTION_GUIDE}

Answer ONLY with JSON:
{"scenes":[{"id":"s1","verse":"Genesis 6:1-2","cue":"copied scene cue here","at":40}],"beats":[{"kind":"term","cue":"copied beat cue here","at":58,"data":{"term":"...","gloss":"..."}}]}`;
}

function buildDirectorFillPrompt({ intervals, budget, existingBeats }) {
  const intervalText = intervals.map((interval) => `INTERVAL ${interval.id} · ${Math.round(interval.start)}-${Math.round(interval.end)}s
Available stages: ${interval.stages.map((stage) => `${stage.sceneId} (${stage.ref || 'context stage'}) ${stage.from}-${stage.to}s${stage.text ? ` · ${stage.text}` : ''}`).join(' | ')}
Transcript:
${interval.transcript}`).join('\n\n');
  const accepted = (Array.isArray(existingBeats) ? existingBeats : [])
    .map((beat) => `${beat.kind}@${Math.round(Number(beat.at) || 0)}s`)
    .join(', ') || 'none';
  const usedHighlights = (Array.isArray(existingBeats) ? existingBeats : [])
    .filter((beat) => beat.kind === 'highlight').length;
  const remainingHighlights = Math.max(0, budget.highlightCeiling - usedHighlights);
  return `A podcast visual stage already has grounded scenes and beats, but the following transcript-qualified visual intervals remain quiet. This is ONE batched fill pass.

ALREADY ACCEPTED BEATS: ${accepted}
REMAINING HIGHLIGHT CAPACITY: ${remainingHighlights} of ${budget.highlightCeiling}

${intervalText}

For each interval, return zero or one additional beat. Include its exact interval id as gapId. Its cue (or highlight quote) must be copied verbatim from that interval's transcript and its approximate at must fall inside that interval. A group or footnote must name one listed passage sceneId and use wording from that displayed passage. Do not duplicate an accepted cue, teaching action, or visual already listed above; duplicates are rejected. Choose a specific semantic type before group, and never use highlight when its remaining capacity is zero. A highlight must still be a rare teacher-authored distilled thesis, never Scripture quotation/paraphrase, narration, or ordinary exposition. Truth beats filling every interval. The total final beat safety ceiling is ${budget.hardBeatCeiling}.

${DIRECTOR_ACTION_GUIDE}

Answer ONLY with JSON: {"beats":[{"gapId":"gap:0","kind":"caveat","sceneId":"s1","cue":"copied cue from that interval","at":75,"data":{"text":"..."}}]}`;
}

async function handleDirectV2(req, res, body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return sendJson(res, 400, { error: 'director request body must be a JSON object' });
  }
  if (body.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    return sendJson(res, 409, {
      error: `director schema ${String(body.schemaVersion)} is not supported`,
      supportedSchemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    });
  }
  if (body.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    return sendJson(res, 409, {
      error: `director policy ${String(body.policyVersion)} is not supported`,
      supportedPolicyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    });
  }
  try {
    assertMagicModel(body.model);
  } catch (error) {
    return sendJson(res, 400, { error: error.message, code: error.code });
  }

  const recordId = String(body.recordId || '').trim();
  const fromInput = Number(body.fromSec);
  const toInput = Number(body.toSec);
  if (!recordId) return sendJson(res, 400, { error: 'recordId is required' });
  if (!Number.isFinite(fromInput) || !Number.isFinite(toInput)
    || fromInput < 0 || toInput <= fromInput || toInput - fromInput > 900) {
    return sendJson(res, 400, { error: 'director clip bounds must be finite, increasing, and no longer than 900 seconds' });
  }
  const from = Math.round(fromInput * 10) / 10;
  const to = Math.round(toInput * 10) / 10;
  const dur = Math.round((to - from) * 10) / 10;
  if (to <= from || dur <= 0 || dur > 900) {
    return sendJson(res, 400, { error: 'director clip bounds collapse or exceed 900 seconds at timeline precision' });
  }
  const whyFull = String(body.why || '');
  const why = whyFull.slice(0, 800);

  // Transcript identity is resolved before shared-job acquisition. A changed
  // local transcript must never reuse a paid result generated from older text.
  const tr = loadTranscript(recordId);
  if (!tr) return sendJson(res, 404, { error: 'unknown recording' });
  const segs = (Array.isArray(tr.segments) ? tr.segments : []).filter((segment) => (
    Number.isFinite(Number(segment?.s)) && Number.isFinite(Number(segment?.e))
    && Number(segment.e) > Number(segment.s)
    && Number(segment.e) > from && Number(segment.s) < to
  )).sort((a, b) => Number(a.s) - Number(b.s) || Number(a.e) - Number(b.e));
  const tape = segs.map((segment) => String(segment.t || '').trim()).filter(Boolean).join(' ');
  if (tape.length < 200) return sendJson(res, 422, { error: 'recording window has too little transcript' });

  const transcriptHash = transcriptWindowHash(segs);
  const sustainedSec = sustainedTeachingSeconds(segs, from, to);
  const budget = computeDirectorMovementBudget({
    durationSec: dur,
    sustainedTeachingSec: sustainedSec,
  });
  const requestIdentity = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    modelKey: body.model,
    recordId,
    fromSec: from,
    toSec: to,
    // Cache identity follows the effective prompt input. Text past the prompt
    // cap must not mint a fresh paid key for an otherwise identical request.
    why,
  };
  const requestFingerprint = directorRequestFingerprint(requestIdentity);
  const requestKey = directorCacheKey({ ...requestIdentity, transcriptHash });
  const directRequest = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    model: body.model,
    recordId,
    fromSec: from,
    toSec: to,
    why,
    transcriptHash,
    requestFingerprint,
    budget,
  };

  const timedRows = segs.map((segment) => (
    `[${Math.max(0, Math.round(segment.e - from))}s] ${String(segment.t || '').trim()}`
  ));
  const timedTape = sampleTimedRows(timedRows, 12000);
  const tapeNorm = ` ${directorNorm(tape)} `;

  const locatePhrase = (phrase, nearRel = null, { after = 0, before = dur } = {}) => {
    if (!phrase) return null;
    const normalizedCue = ` ${directorNorm(phrase)} `;
    if (normalizedCue === '  ') return null;
    let accumulated = '';
    const hits = [];
    for (const segment of segs) {
      accumulated += ` ${directorNorm(segment.t)}`;
      if ((` ${accumulated} `).includes(normalizedCue)) {
        const hit = Math.max(0, Math.round(segment.e - from));
        if (hit >= after && hit <= before && hits.at(-1) !== hit) hits.push(hit);
        accumulated = '';
      }
      accumulated = accumulated.slice(-500);
    }
    if (!hits.length) return null;
    if (!Number.isFinite(Number(nearRel))) return hits[0];
    return hits.sort((a, b) => Math.abs(a - Number(nearRel)) - Math.abs(b - Number(nearRel)) || a - b)[0];
  };

  const locateWordAfter = (word, afterRel, occurrence = 0, beforeRel = dur) => {
    const normalizedWord = ` ${directorNorm(word)} `;
    let seen = 0;
    for (const segment of segs) {
      const rel = segment.e - from;
      if (rel < afterRel) continue;
      if (rel > beforeRel) break;
      const text = ` ${directorNorm(segment.t)} `;
      let cursor = 0;
      while ((cursor = text.indexOf(normalizedWord, cursor)) >= 0) {
        if (seen === occurrence) return Math.round(rel);
        seen += 1;
        cursor += normalizedWord.length;
      }
    }
    return null;
  };

  const displayedMatches = (scene, phrase) => {
    const haystack = ` ${directorNorm((scene.verses || []).map((verse) => verse.text).join(' '))} `;
    const needle = ` ${directorNorm(phrase)} `;
    if (needle === '  ') return [];
    const matches = [];
    let cursor = 0;
    while (matches.length < 40) {
      const index = haystack.indexOf(needle, cursor);
      if (index < 0) break;
      matches.push({ index, end: index + needle.length, occurrence: matches.length });
      cursor = index + Math.max(1, needle.length - 1);
    }
    return matches;
  };

  const displayedOccurrences = (scene, words) => {
    const candidates = words.map((word) => displayedMatches(scene, word));
    if (candidates.some((matches) => !matches.length)) return null;
    let best = null;
    const visit = (wordIndex, previousEnd, picked) => {
      if (wordIndex === candidates.length) {
        const span = picked.at(-1).end - picked[0].index;
        if (!best || span < best.span || (span === best.span && picked[0].index < best.start)) {
          best = { span, start: picked[0].index, picked: [...picked] };
        }
        return;
      }
      for (const match of candidates[wordIndex]) {
        if (match.index < previousEnd) continue;
        visit(wordIndex + 1, match.end, [...picked, match]);
      }
    };
    visit(0, -1, []);
    return best ? best.picked.map((match) => match.occurrence) : null;
  };

  const acquired = acquireDirectorJob(requestKey, req, res, async (signal) => {
    const startedAt = new Date().toISOString();
    const wallStarted = Date.now();
    signal.throwIfAborted();
    let client;
    let runtime;
    try {
      ({ client, runtime } = await preflightMagicRole('director'));
    } catch (error) {
      if (signal.aborted) throw error;
      const observedClient = clientFor(MAGIC_MODEL_ROLES.director);
      const observedRuntime = observedClient.resolution
        ? magicRuntimeDescriptor(observedClient, observedClient.resolution)
        : observedClient.describe();
      const evidenceFile = writeDirectorEvidence({
        status: 'refused',
        startedAt,
        requestKey,
        request: directRequest,
        runtime: observedRuntime,
        calls: [{
          role: 'preflight',
          validation: 'runtime-refusal',
          error: { code: error?.code || 'PREFLIGHT', message: error?.message || String(error) },
        }],
        error: { code: error?.code || 'PREFLIGHT', message: error?.message || String(error) },
      });
      error.evidenceFile = path.basename(evidenceFile);
      throw error;
    }
    signal.throwIfAborted();

    const calls = [];
    const proposed = [];
    const semanticRejected = [];
    const sceneDrops = [];
    const normalizationPasses = [];
    let currentSnapshot = normalizeDirectorPlan({ scenes: [], beats: [] }, {
      durationSec: dur,
      sustainedTeachingSec: sustainedSec,
      budget,
      addPrelude: true,
    });

    const reject = (proposal, reason, detail = null) => {
      const record = {
        proposalId: proposal.proposalId,
        pass: proposal.pass,
        kind: proposal.kind,
        reason,
        ...(proposal.gapId ? { gapId: proposal.gapId } : {}),
        ...(detail ? { detail } : {}),
      };
      if (!semanticRejected.some((candidate) => candidate.proposalId === record.proposalId)) {
        semanticRejected.push(record);
      }
      return null;
    };

    const markLastCall = (outcome) => {
      if (!calls.length) return;
      calls.at(-1).validation = `${calls.at(-1).validation};${outcome}`;
    };

    const callModel = async (role, content, maxTokens = 16000) => {
      const callStarted = Date.now();
      let reply;
      try {
        reply = await client.chat({
          maxTokens,
          messages: [{ role: 'user', content }],
          signal,
        });
      } catch (error) {
        calls.push({
          role,
          latencyMs: Math.max(0, Number(error?.latencyMs) || Date.now() - callStarted),
          promptTokens: 0,
          completionTokens: 0,
          reasoningTokens: 0,
          cachedPromptTokens: 0,
          providerCostUsd: null,
          finishReason: null,
          rawModel: null,
          provider: null,
          model: { ...runtime, provider: 'unreported' },
          validation: 'call-error',
          error: { code: error?.code || 'CALL', message: error?.message || String(error) },
        });
        throw error;
      }

      const text = String(reply.message.content || '');
      let parsed = null;
      let validation = 'no-json-object';
      try {
        parsed = JSON.parse(text.trim());
        validation = 'json-parsed';
      } catch {
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          try {
            parsed = JSON.parse(match[0]);
            validation = 'json-extracted';
          } catch {
            validation = 'invalid-json';
          }
        }
      }
      let runtimeError = null;
      try {
        assertMagicReplyEvidence(reply, runtime);
      } catch (error) {
        runtimeError = error;
      }
      const rawModel = reply.raw?.model ?? null;
      const provider = reply.raw?.provider ?? null;
      calls.push({
        role,
        latencyMs: Math.max(0, Number(reply.latencyMs) || Date.now() - callStarted),
        promptTokens: reply.usage?.promptTokens || 0,
        completionTokens: reply.usage?.completionTokens || 0,
        reasoningTokens: reply.usage?.reasoningTokens || 0,
        cachedPromptTokens: reply.usage?.cachedPromptTokens || 0,
        providerCostUsd: reply.usage?.providerCostUsd ?? null,
        finishReason: reply.finishReason || null,
        rawModel,
        provider,
        model: { ...runtime, provider: provider || 'unreported' },
        validation: runtimeError ? 'runtime-mismatch' : validation,
      });
      if (runtimeError) throw runtimeError;
      return parsed;
    };

    // The remainder of this shared job is deliberately local to the request:
    // semantic validation needs the exact tape, canonical scenes, and locators.
    const STOPWORDS = new Set(['the', 'and', 'of', 'to', 'a', 'an', 'in', 'on', 'at', 'for', 'that', 'this', 'with', 'from',
      'they', 'them', 'were', 'was', 'is', 'are', 'be', 'been', 'have', 'has', 'had', 'his', 'her', 'him', 'she', 'he',
      'it', 'its', 'not', 'but', 'all', 'any', 'who', 'you', 'your', 'their', 'there', 'when', 'then', 'will', 'shall']);

    const sceneWindows = (scenes) => scenes.map((scene, index) => ({
      scene,
      start: scene.at,
      end: index + 1 < scenes.length ? scenes[index + 1].at : dur,
    }));

    const sceneForTime = (scenes, at) => {
      const windows = sceneWindows(scenes);
      return [...windows].reverse().find((window) => at >= window.start && at <= window.end)?.scene || null;
    };

    const makeHousePrelude = () => ({
      ...createDirectorHousePrelude(),
      modelId: null,
      verseNorm: '  ',
    });

    const normalizedPassageText = (scene) => ` ${directorNorm((scene?.verses || []).map((verse) => verse.text).join(' '))} `;

    const parseScenes = (rawScenes, rawBeats) => {
      const candidates = [];
      const seenModelIds = new Set();
      for (const [index, rawScene] of (Array.isArray(rawScenes) ? rawScenes : []).entries()) {
        const modelId = typeof rawScene?.id === 'string' ? rawScene.id.trim() : '';
        const sceneDrop = (reason, detail = null) => {
          sceneDrops.push({
            id: `scene:initial:${index}`,
            kind: 'scene',
            reason,
            ...(modelId ? { modelId } : {}),
            ...(detail ? { detail } : {}),
          });
        };
        if (!rawScene || typeof rawScene !== 'object' || Array.isArray(rawScene)) {
          sceneDrop('invalid-scene');
          continue;
        }
        if (!modelId) {
          sceneDrop('scene-id-required');
          continue;
        }
        if (seenModelIds.has(modelId)) {
          sceneDrop('scene-id-duplicate');
          continue;
        }
        seenModelIds.add(modelId);
        const cue = typeof rawScene.cue === 'string' ? rawScene.cue.trim() : '';
        if (cue.length < 8 || cue.length > 100 || !tapeNorm.includes(` ${directorNorm(cue)} `)) {
          sceneDrop('scene-cue-not-grounded');
          continue;
        }
        const atHint = Number.isFinite(Number(rawScene.at)) ? Number(rawScene.at) : null;
        const at = locatePhrase(cue, atHint);
        if (at == null) {
          sceneDrop('scene-cue-not-located');
          continue;
        }
        const id = `scene:initial:${index}`;
        if (rawScene.verse == null || String(rawScene.verse).trim().toLowerCase() === 'null') {
          candidates.push({
            id,
            modelId,
            origin: 'model',
            ref: null,
            verses: [],
            verseNorm: '  ',
            cue,
            at,
            timingSource: 'cue',
          });
          continue;
        }
        const resolved = resolveDirectorPassageReference(rawScene.verse);
        if (!resolved.ok) {
          sceneDrop(`canonical-${resolved.reason}`, resolved.message);
          continue;
        }
        candidates.push({
          id,
          modelId,
          origin: 'model',
          ref: resolved.value.ref,
          verses: resolved.value.verses,
          verseNorm: ` ${directorNorm(resolved.value.text)} `,
          cue,
          at,
          timingSource: 'cue',
        });
      }

      candidates.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
      const uniqueTimes = [];
      for (const scene of candidates) {
        if (uniqueTimes.some((candidate) => candidate.at === scene.at)) {
          sceneDrops.push({ id: scene.id, kind: 'scene', reason: 'scene-cue-collision', at: scene.at });
        } else {
          uniqueTimes.push(scene);
        }
      }
      const selected = evenlyDistributed(uniqueTimes, budget.modelSceneCeiling);
      for (const scene of selected.dropped) {
        sceneDrops.push({ id: scene.id, kind: 'scene', reason: 'safety-cap', at: scene.at });
      }
      const scenes = [...selected.kept];

      const earliestBeatCue = (Array.isArray(rawBeats) ? rawBeats : [])
        .map((rawBeat) => rawBeat?.kind === 'highlight' ? rawBeat?.data?.quote : rawBeat?.cue)
        .map((cue) => locatePhrase(cue, null))
        .filter((at) => at != null)
        .sort((a, b) => a - b)[0];
      const first = scenes[0];
      const needsPrelude = Boolean(first && first.at > 0 && (
        (first.verses.length && first.at >= DIRECTOR_LIMITS.preludeMinSec)
        || (earliestBeatCue != null && earliestBeatCue < first.at)
      ));
      const portableRawBeat = (Array.isArray(rawBeats) ? rawBeats : []).some((rawBeat) => (
        DIRECTOR_KIND_SET.has(rawBeat?.kind) && !['group', 'footnote'].includes(rawBeat.kind)
      ));
      if ((needsPrelude || (!scenes.length && portableRawBeat)) && budget.houseSceneReserve > 0) {
        scenes.unshift(makeHousePrelude());
      }
      return scenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    };

    const validateBeat = (rawBeat, index, pass, scenes, { gap = null, allowRepair = true } = {}) => {
      const rawKind = typeof rawBeat?.kind === 'string' ? rawBeat.kind.trim().toLowerCase() : '';
      const proposal = {
        proposalId: pass === 'fill' && rawBeat?.gapId
          ? `fill:${String(rawBeat.gapId)}:${index}`
          : `${pass}:${index}`,
        pass,
        kind: rawKind || 'unknown',
        ...(rawBeat?.gapId ? { gapId: String(rawBeat.gapId) } : {}),
      };
      proposed.push({ ...proposal });
      if (!rawBeat || typeof rawBeat !== 'object' || Array.isArray(rawBeat)) return reject(proposal, 'invalid-beat');
      if (!DIRECTOR_KIND_SET.has(rawKind)) return reject(proposal, 'unknown-kind');
      const data = rawBeat.data;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return reject(proposal, 'data-required');

      const quoteCue = rawKind === 'highlight' && typeof data.quote === 'string' ? data.quote.trim() : '';
      const cue = typeof rawBeat.cue === 'string' && rawBeat.cue.trim() ? rawBeat.cue.trim() : quoteCue;
      if (!cue) return reject(proposal, 'cue-required');
      if (cue.length < 8 || cue.length > 140) return reject(proposal, 'cue-length');
      if (!tapeNorm.includes(` ${directorNorm(cue)} `)) return reject(proposal, 'cue-not-in-transcript');
      const atHint = Number.isFinite(Number(rawBeat.at)) ? Number(rawBeat.at) : null;
      const at = locatePhrase(cue, atHint);
      if (at == null) return reject(proposal, 'cue-not-located');
      if (gap && (at < gap.start || at > gap.end)) {
        return reject(proposal, 'cue-outside-gap', `${at}s is outside ${gap.start}-${gap.end}s`);
      }

      const byId = new Map(scenes.flatMap((scene) => [
        [scene.id, scene],
        ...(scene.modelId ? [[scene.modelId, scene]] : []),
      ]));
      const declaredScene = typeof rawBeat.sceneId === 'string' ? byId.get(rawBeat.sceneId.trim()) : null;
      let owner = sceneForTime(scenes, at);
      let pendingPrelude = null;
      const portableFillBeforeFirstScene = pass === 'fill'
        && rawKind !== 'group' && rawKind !== 'footnote'
        && budget.houseSceneReserve > 0
        && !scenes.some((scene) => scene.origin === 'house-prelude')
        && (!scenes[0] || at < scenes[0].at);
      if (!owner && portableFillBeforeFirstScene) {
        // Provisional only: malformed or semantically rejected fill proposals
        // must not leave an empty structural scene behind.
        pendingPrelude = makeHousePrelude();
        owner = pendingPrelude;
      }
      if (rawKind === 'group' || rawKind === 'footnote') {
        if (!declaredScene) return reject(proposal, 'scene-id-unknown');
        if (!declaredScene.verses.length) return reject(proposal, 'scene-not-passage');
        const declaredWindow = sceneWindows(scenes).find((window) => window.scene === declaredScene);
        if (!declaredWindow || at < declaredWindow.start || at > declaredWindow.end) {
          return reject(proposal, 'cue-outside-scene');
        }
        owner = declaredScene;
      }
      if (!owner) return reject(proposal, 'scene-owner-missing');

      const beat = {
        id: `beat:${proposal.proposalId}`,
        proposalId: proposal.proposalId,
        sceneId: owner.id,
        kind: rawKind,
        cue,
        at,
        timingSource: 'cue',
        data: null,
        pass,
        ...(proposal.gapId ? { gapId: proposal.gapId } : {}),
        _owner: owner,
        _repairs: [],
      };

      if (rawKind === 'group') {
        if (!Array.isArray(data.words) || data.words.length < 2 || data.words.length > 4) {
          return reject(proposal, 'group-word-count');
        }
        const words = [];
        const seen = new Set();
        for (const rawWord of data.words) {
          const word = typeof rawWord === 'string' ? rawWord.trim() : '';
          const normalizedWord = directorNorm(word);
          if (!word || word.length > 28 || word.split(/\s+/).length > 3) return reject(proposal, 'group-word-shape');
          if (!word.includes(' ') && STOPWORDS.has(normalizedWord)) return reject(proposal, 'group-stopword', word);
          if (seen.has(normalizedWord)) return reject(proposal, 'group-word-duplicate', word);
          seen.add(normalizedWord);
          const slot = { spoken: word, resolved: owner.verseNorm.includes(` ${normalizedWord} `) ? word : null };
          if (!slot.resolved && !allowRepair) return reject(proposal, 'group-word-not-in-passage', word);
          if (!slot.resolved) beat._repairs.push(slot);
          words.push(slot);
        }
        const label = typeof data.label === 'string' ? data.label.trim() : '';
        if (label.length > DIRECTOR_COPY_LIMITS.groupLabel) return reject(proposal, 'group-label-too-long');
        beat.data = { words, label: label || null };
      } else if (rawKind === 'footnote') {
        const word = typeof data.word === 'string' ? data.word.trim() : '';
        const note = typeof data.note === 'string' ? data.note.trim() : '';
        if (!word || word.length > 28 || word.split(/\s+/).length > 3) return reject(proposal, 'footnote-word-shape');
        if (note.length < 4) return reject(proposal, 'footnote-note-required');
        if (note.length > DIRECTOR_COPY_LIMITS.footnoteNote) return reject(proposal, 'footnote-note-too-long');
        const slot = { spoken: word, resolved: owner.verseNorm.includes(` ${directorNorm(word)} `) ? word : null };
        if (!slot.resolved && !allowRepair) return reject(proposal, 'footnote-word-not-in-passage', word);
        if (!slot.resolved) beat._repairs.push(slot);
        beat.data = { word: slot, note };
      } else if (rawKind === 'term') {
        const term = typeof data.term === 'string' ? data.term.trim() : '';
        const gloss = typeof data.gloss === 'string' ? data.gloss.trim() : '';
        if (term.length < 2 || term.length > 24) return reject(proposal, 'term-shape');
        if (gloss.length < 3) return reject(proposal, 'term-gloss-required');
        if (gloss.length > DIRECTOR_COPY_LIMITS.termGloss) return reject(proposal, 'term-gloss-too-long');
        beat.data = { term, gloss };
      } else if (rawKind === 'allusion') {
        const resolved = resolveDirectorPassageReference(data.verse ?? data.ref);
        if (!resolved.ok) return reject(proposal, `canonical-${resolved.reason}`, resolved.message);
        const note = typeof data.note === 'string' ? data.note.trim() : '';
        if (note.length > DIRECTOR_COPY_LIMITS.relationNote) return reject(proposal, 'allusion-note-too-long');
        beat.data = {
          ref: resolved.value.ref,
          text: resolved.value.text,
          note: note || null,
        };
      } else if (rawKind === 'compare') {
        const resolved = resolveDirectorPassageReferences([data.a, data.b]);
        if (!resolved.ok) return reject(proposal, `canonical-${resolved.reason}`, resolved.message);
        const [a, b] = resolved.values;
        const overlaps = a.book === b.book && a.chapter === b.chapter
          && a.fromVerse <= b.toVerse && b.fromVerse <= a.toVerse;
        if (a.ref === b.ref || overlaps) return reject(proposal, 'compare-sides-not-distinct');
        if (!['likeness', 'difference'].includes(data.axis)) return reject(proposal, 'compare-axis-invalid');
        const note = typeof data.note === 'string' ? data.note.trim() : '';
        if (note.length > DIRECTOR_COPY_LIMITS.relationNote) return reject(proposal, 'compare-note-too-long');
        beat.data = {
          a: { ref: a.ref, text: a.text },
          b: { ref: b.ref, text: b.text },
          axis: data.axis,
          note: note || null,
        };
      } else if (rawKind === 'chain') {
        if (!Array.isArray(data.refs) || data.refs.length < 2 || data.refs.length > 4) {
          return reject(proposal, 'chain-link-count');
        }
        const resolved = resolveDirectorPassageReferences(data.refs);
        if (!resolved.ok) return reject(proposal, `canonical-${resolved.reason}`, resolved.message);
        const refs = resolved.values.map((value) => value.ref);
        if (new Set(refs).size !== refs.length) return reject(proposal, 'chain-link-duplicate');
        const note = typeof data.note === 'string' ? data.note.trim() : '';
        if (note.length > DIRECTOR_COPY_LIMITS.relationNote) return reject(proposal, 'chain-note-too-long');
        beat.data = {
          links: resolved.values.map((value) => ({ ref: value.ref, text: value.text })),
          note: note || null,
        };
      } else if (rawKind === 'caveat') {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (text.length < 8) return reject(proposal, 'caveat-text-required');
        if (text.length > DIRECTOR_COPY_LIMITS.marginText) return reject(proposal, 'caveat-text-too-long');
        beat.data = { text };
      } else if (rawKind === 'aside') {
        const text = typeof data.text === 'string' ? data.text.trim() : '';
        if (text.length < 8) return reject(proposal, 'aside-text-required');
        if (text.length > DIRECTOR_COPY_LIMITS.marginText) return reject(proposal, 'aside-text-too-long');
        beat.data = { text };
      } else if (rawKind === 'highlight') {
        const quote = typeof data.quote === 'string' ? data.quote.trim() : '';
        if (quote.length < 12 || quote.length > 140) return reject(proposal, 'highlight-quote-length');
        if (!tapeNorm.includes(` ${directorNorm(quote)} `)) return reject(proposal, 'highlight-not-verbatim');
        beat.data = { quote };
      }
      if (pendingPrelude) {
        const committedPrelude = scenes.find((scene) => scene.origin === 'house-prelude');
        if (committedPrelude) {
          beat.sceneId = committedPrelude.id;
          beat._owner = committedPrelude;
        } else {
          scenes.unshift(pendingPrelude);
          scenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
        }
      }
      return beat;
    };

    const repairAndFinalizeAnchors = async (beats) => {
      const repairs = beats.flatMap((beat) => beat._repairs.map((slot) => ({ beat, slot })));
      if (repairs.length) {
        try {
          const mapped = await callModel('repair', `A visual stage displays the World English Bible while a teacher may read another translation. For each numbered pair, return the word or short phrase (at most 3 words) FROM THE DISPLAYED TEXT that carries the same meaning as the teaching's wording, or null when there is no honest counterpart.

${repairs.map(({ beat, slot }, index) => `${index}. displayed text: "${beat._owner.verses.map((verse) => verse.text).join(' ').slice(0, 500)}"
   teaching wording: "${slot.spoken}"`).join('\n')}

Answer ONLY with JSON: {"map":["displayed wording",null]} with exactly ${repairs.length} entries.`, 5000);
          const map = Array.isArray(mapped?.map) ? mapped.map : [];
          repairs.forEach(({ beat, slot }, index) => {
            const candidate = typeof map[index] === 'string' ? map[index].trim() : '';
            if (candidate && candidate.length <= 28 && candidate.split(/\s+/).length <= 3
              && !(!candidate.includes(' ') && STOPWORDS.has(directorNorm(candidate)))
              && beat._owner.verseNorm.includes(` ${directorNorm(candidate)} `)) {
              slot.resolved = candidate;
            }
          });
          markLastCall(`semantic-repairs:${repairs.filter(({ slot }) => slot.resolved).length}/${repairs.length}`);
        } catch (error) {
          if (signal.aborted) throw error;
        }
      }

      const finalized = [];
      for (const beat of beats) {
        const proposal = {
          proposalId: beat.proposalId,
          pass: beat.pass,
          kind: beat.kind,
          ...(beat.gapId ? { gapId: beat.gapId } : {}),
        };
        if (beat.kind === 'group') {
          const words = beat.data.words.map((slot) => slot.resolved).filter(Boolean);
          if (words.length !== beat.data.words.length) {
            reject(proposal, 'repair-unresolved');
            continue;
          }
          const occurrences = displayedOccurrences(beat._owner, words);
          if (!occurrences) {
            reject(proposal, 'group-word-not-in-passage');
            continue;
          }
          const verseLength = Math.max(1, beat._owner.verseNorm.trim().length);
          if (words.length > 2 && words.reduce((sum, word) => sum + word.length, 0) > verseLength * 0.33) {
            reject(proposal, 'group-overcoverage');
            continue;
          }
          const wordOccurrences = new Map();
          const window = sceneWindows(currentScenes).find((candidate) => candidate.scene.id === beat.sceneId);
          const wordTimes = words.map((word, wordIndex) => {
            const key = directorNorm(word);
            const occurrence = wordOccurrences.get(key) || 0;
            wordOccurrences.set(key, occurrence + 1);
            return {
              word,
              occurrence: occurrences[wordIndex],
              at: locateWordAfter(word, window?.start ?? 0, occurrence, window?.end ?? dur),
              timingSource: 'word',
            };
          }).filter((wordTime) => wordTime.at != null);
          beat.data = { words, occurrences, wordTimes, label: beat.data.label };
        } else if (beat.kind === 'footnote') {
          const word = beat.data.word.resolved;
          if (!word) {
            reject(proposal, 'repair-unresolved');
            continue;
          }
          const occurrence = displayedOccurrences(beat._owner, [word])?.[0];
          if (!Number.isInteger(occurrence)) {
            reject(proposal, 'footnote-word-not-in-passage');
            continue;
          }
          beat.data = { word, note: beat.data.note, occurrence };
        }
        delete beat._owner;
        delete beat._repairs;
        finalized.push(beat);
      }
      return finalized;
    };

    const applyNormalization = (role, plan) => {
      const snapshot = normalizeDirectorPlan(plan, {
        durationSec: dur,
        sustainedTeachingSec: sustainedSec,
        budget,
        addPrelude: true,
      });
      normalizationPasses.push({ role, ...snapshot.report });
      currentSnapshot = snapshot;
      return snapshot;
    };

    const finish = (note = null, { allowAborted = false } = {}) => {
      if (!allowAborted) signal.throwIfAborted();
      const scenes = currentSnapshot.scenes.map((scene) => {
        const { verseNorm, modelId, ...publicScene } = scene;
        return publicScene;
      });
      const beats = currentSnapshot.beats.map((beat) => {
        const { pass, gapId, ...publicBeat } = beat;
        return publicBeat;
      });
      const allDrops = [
        ...sceneDrops,
        ...normalizationPasses.flatMap((entry) => entry.dropped || []),
      ];
      const uniqueDrops = [];
      const seenDrop = new Set();
      for (const drop of allDrops) {
        const key = JSON.stringify(drop);
        if (!seenDrop.has(key)) {
          seenDrop.add(key);
          uniqueDrops.push(drop);
        }
      }
      const projection = summarizeVisualProjection({ scenes, beats }, dur);
      const acceptedProposalIds = new Set(beats.map((beat) => beat.proposalId));
      const rejectedByProposal = new Map(semanticRejected.map((entry) => [entry.proposalId, entry]));
      for (const drop of uniqueDrops) {
        const proposalId = drop.proposalId || (typeof drop.id === 'string' && drop.id.startsWith('beat:')
          ? drop.id.slice('beat:'.length)
          : null);
        if (!proposalId || acceptedProposalIds.has(proposalId) || rejectedByProposal.has(proposalId)) continue;
        const source = proposed.find((entry) => entry.proposalId === proposalId);
        if (!source) continue;
        rejectedByProposal.set(proposalId, {
          ...source,
          reason: drop.reason || 'normalization-refused',
          ...(drop.at != null ? { at: drop.at } : {}),
        });
      }
      for (const proposal of proposed) {
        if (!acceptedProposalIds.has(proposal.proposalId) && !rejectedByProposal.has(proposal.proposalId)) {
          rejectedByProposal.set(proposal.proposalId, { ...proposal, reason: 'normalization-refused' });
        }
      }
      const outcomes = {
        completeness: 'complete',
        proposed,
        rejected: [...rejectedByProposal.values()],
        accepted: beats.map((beat) => ({
          proposalId: beat.proposalId,
          beatId: beat.id,
          kind: beat.kind,
          sceneId: beat.sceneId,
        })),
        focusMasked: projection.focusMasked,
        superseded: projection.superseded,
        projectedVisible: projection.projectedVisible,
      };
      const normalization = {
        ...currentSnapshot.report,
        dropped: uniqueDrops,
        passes: normalizationPasses,
        projection,
      };
      const provider = calls.find((call) => call.provider)?.provider || 'unreported';
      const costs = calls.map((call) => call.providerCostUsd);
      const payload = {
        schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
        policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
        requestKey,
        requestFingerprint,
        clip: {
          fromSec: from,
          toSec: to,
          durationSec: dur,
          transcriptHash,
          sustainedTeachingSec: sustainedSec,
        },
        budget,
        scenes,
        beats,
        model: { ...runtime, provider },
        metrics: {
          wallMs: Date.now() - wallStarted,
          passes: calls.length,
          calls,
          totalUsd: calls.length && costs.every((cost) => Number.isFinite(cost) && cost >= 0)
            ? costs.reduce((sum, cost) => sum + cost, 0)
            : null,
          tokens: {
            prompt: calls.reduce((sum, call) => sum + call.promptTokens, 0),
            completion: calls.reduce((sum, call) => sum + call.completionTokens, 0),
            reasoning: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
            cachedPrompt: calls.reduce((sum, call) => sum + call.cachedPromptTokens, 0),
          },
          normalization,
          outcomes,
        },
        ...(note ? { note } : {}),
      };
      const checked = validateDirectorPayload(payload);
      if (!checked.ok) throw new Error(`refusing invalid director payload: ${checked.errors.join('; ')}`);
      const evidenceFile = writeDirectorEvidence({
        startedAt,
        requestKey,
        request: directRequest,
        result: payload,
      });
      return { ...payload, evidenceFile: path.basename(evidenceFile) };
    };

    let currentScenes = [];
    try {
      const raw = await callModel('initial', buildDirectorInitialPrompt({ timedTape, why, budget }));
      const rawScenes = Array.isArray(raw?.scenes) ? raw.scenes : [];
      const rawBeats = Array.isArray(raw?.beats) ? raw.beats : [];
      currentScenes = parseScenes(rawScenes, rawBeats);
      const candidates = rawBeats
        .map((rawBeat, index) => validateBeat(rawBeat, index, 'initial', currentScenes))
        .filter(Boolean);
      const initialBeats = await repairAndFinalizeAnchors(candidates);
      markLastCall(`semantic-scenes:${currentScenes.filter((scene) => scene.origin === 'model').length};semantic-beats:${initialBeats.length}`);
      applyNormalization('initial', { scenes: currentScenes, beats: initialBeats });
      currentScenes = currentSnapshot.scenes;

      // The normalization report measures entrances that can actually project;
      // a beat hidden by focus does not make its interval visually occupied.
      const cadence = currentSnapshot.report.visualCadence;
      const candidateGaps = (cadence.gaps || [])
        .filter((gap) => gap.len > budget.fillGapSec)
        .sort((a, b) => a.start - b.start || a.end - b.end);
      const intervals = [];
      for (const gap of candidateGaps) {
        const stretchSegments = segs.filter((segment) => (
          segment.e - from >= gap.start && segment.s - from <= gap.end
        ));
        const stretchText = stretchSegments.map((segment) => String(segment.t || '').trim()).filter(Boolean).join(' ');
        const wordCount = transcriptTupleText(stretchText).split(/\s+/).filter(Boolean).length;
        const activeSec = sustainedTeachingSeconds(stretchSegments, from + gap.start, from + gap.end);
        if (wordCount < 20 || activeSec < 8) continue;
        const stages = sceneWindows(currentScenes)
          .filter((window) => window.end >= gap.start && window.start <= gap.end)
          .map((window) => ({
            sceneId: window.scene.id,
            ref: window.scene.ref,
            from: Math.max(gap.start, window.start),
            to: Math.min(gap.end, window.end),
            text: window.scene.verses?.length
              ? window.scene.verses.map((verse) => verse.text).join(' ').slice(0, 500)
              : '',
          }));
        if (!stages.length) continue;
        intervals.push({
          id: `gap:${intervals.length}`,
          start: gap.start,
          end: gap.end,
          len: gap.len,
          stages,
          transcript: '',
          _rows: stretchSegments.map((segment) => (
            `[${Math.max(0, Math.round(segment.e - from))}s] ${String(segment.t || '').trim()}`
          )),
        });
      }
      if (intervals.length) {
        const perIntervalBudget = Math.max(500, Math.floor(14000 / intervals.length));
        intervals.forEach((interval) => {
          interval.transcript = sampleTimedRows(interval._rows, perIntervalBudget);
          delete interval._rows;
        });
        const existingBeats = currentSnapshot.beats;
        const fillRaw = await callModel('fill', buildDirectorFillPrompt({
          intervals,
          budget,
          existingBeats,
        }), 12000);
        const byGap = new Map(intervals.map((interval) => [interval.id, interval]));
        const claimedGaps = new Set();
        const fillCandidates = [];
        const acceptedCueSignatures = new Set(existingBeats.map((beat) => {
          const cue = beat.kind === 'highlight' ? beat.data?.quote : beat.cue;
          return cue ? `${beat.kind}|${directorNorm(cue)}` : null;
        }).filter(Boolean));
        let acceptedFillHighlights = 0;
        const existingHighlightCount = existingBeats.filter((beat) => beat.kind === 'highlight').length;
        for (const [index, rawBeat] of (Array.isArray(fillRaw?.beats) ? fillRaw.beats : []).entries()) {
          const gapId = typeof rawBeat?.gapId === 'string' ? rawBeat.gapId : '';
          const gap = byGap.get(gapId);
          const kind = typeof rawBeat?.kind === 'string' && rawBeat.kind.trim()
            ? rawBeat.kind.trim().toLowerCase()
            : 'unknown';
          const proposal = { proposalId: `fill:${gapId || 'unknown'}:${index}`, pass: 'fill', kind, gapId };
          if (!gap) {
            proposed.push(proposal);
            reject(proposal, 'gap-id-unknown');
            continue;
          }
          if (claimedGaps.has(gapId)) {
            proposed.push(proposal);
            reject(proposal, 'gap-duplicate');
            continue;
          }
          claimedGaps.add(gapId);
          if (kind === 'highlight'
            && existingHighlightCount + acceptedFillHighlights >= budget.highlightCeiling) {
            proposed.push(proposal);
            reject(proposal, 'highlight-capacity-exhausted');
            continue;
          }
          const rawCue = kind === 'highlight' ? rawBeat?.data?.quote : rawBeat?.cue;
          const rawSignature = typeof rawCue === 'string' && rawCue.trim()
            ? `${kind}|${directorNorm(rawCue)}`
            : null;
          if (rawSignature && acceptedCueSignatures.has(rawSignature)) {
            proposed.push(proposal);
            reject(proposal, 'duplicate-existing-beat');
            continue;
          }
          const candidate = validateBeat(rawBeat, index, 'fill', currentScenes, { gap, allowRepair: false });
          if (candidate) {
            const cue = candidate.kind === 'highlight' ? candidate.data?.quote : candidate.cue;
            const signature = cue ? `${candidate.kind}|${directorNorm(cue)}` : null;
            if (signature && acceptedCueSignatures.has(signature)) {
              reject(candidate, 'duplicate-existing-beat');
              continue;
            }
            if (signature) acceptedCueSignatures.add(signature);
            if (candidate.kind === 'highlight') acceptedFillHighlights += 1;
            fillCandidates.push(candidate);
          }
        }
        const finalizedFill = await repairAndFinalizeAnchors(fillCandidates);
        markLastCall(`semantic-intervals:${intervals.length};semantic-beats:${finalizedFill.length}`);
        applyNormalization('fill', {
          scenes: currentScenes,
          beats: [...currentSnapshot.beats, ...finalizedFill],
        });
        currentScenes = currentSnapshot.scenes;
      }

      return finish();
    } catch (error) {
      if (signal.aborted) {
        if (calls.length) {
          const evidence = finish('director job aborted after its last consumer left', { allowAborted: true });
          error.evidenceFile = evidence.evidenceFile;
        }
        throw error;
      }
      if (error?.code === 'MAGIC_RUNTIME_REFUSED') {
        const evidenceFile = writeDirectorEvidence({
          status: 'refused',
          startedAt,
          requestKey,
          request: directRequest,
          runtime,
          calls,
          error: { code: error.code, message: error.message },
        });
        error.evidenceFile = path.basename(evidenceFile);
        throw error;
      }
      return finish(error?.message || String(error));
    }
  });

  try {
    const payload = await acquired.promise;
    acquired.release();
    return sendJson(res, 200, payload);
  } catch (error) {
    acquired.release();
    if (res.destroyed || res.writableEnded) return;
    return sendJson(res, 503, {
      error: error?.message || String(error),
      code: error?.code || 'DIRECTOR_FAILED',
      ...(error?.evidenceFile ? { evidenceFile: error.evidenceFile } : {}),
    });
  }
}

/* The strong heuristics behind on-the-fly forms: every parameter the model
   supplies is checked against what the tour actually contains, and any
   shortfall lands on 'standard'. A lexicon needs renderings that point at
   real steps; a path needs waypoints for most of the walk; a stage
   direction needs a verse that parses and words that fit. The model
   proposes; this disposes. */
function validateFormPlan(plan, nSteps) {
  const std = { form: 'standard' };
  if (!plan || typeof plan !== 'object') return std;
  const idxOk = (i) => Number.isInteger(i) && i >= 0 && i < nSteps;
  const short = (s, n) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= n;

  /* Stage directions ride any form. The model names a verse and the word
     groups the teaching turns on; the page shows the verse while the clip
     plays and draws each group the moment the teacher says one of its
     words. A verse that doesn't parse, or a group whose words the verse
     doesn't contain, is silently nothing — checked again at draw time. */
  const stageSeen = new Set();
  const stage = (Array.isArray(plan.stage) ? plan.stage : [])
    .filter((s) => s && idxOk(s.step) && !stageSeen.has(s.step) && short(s.verse, 40) && /\d/.test(s.verse))
    .filter((s) => { stageSeen.add(s.step); return true; })
    .slice(0, 4)
    .map((s) => ({
      step: s.step,
      verse: s.verse.trim(),
      marks: (Array.isArray(s.marks) ? s.marks : [])
        .filter((m) => m && Array.isArray(m.words) && m.words.length >= 2 && m.words.length <= 4
          && m.words.every((w) => short(w, 20) && !/\s/.test(w.trim())))
        .slice(0, 2)
        .map((m) => ({ words: m.words.map((w) => w.trim()), label: short(m.label, 18) ? m.label.trim() : null })),
    }));
  const withStage = (p) => (stage.length ? { ...p, stage } : p);

  switch (plan.form) {
    case 'quiet':
      return withStage({ form: 'quiet' });
    case 'lexicon': {
      /* One term or several — the old single-term shape still validates. */
      const raw = Array.isArray(plan.terms)
        ? plan.terms
        : (plan.term ? [{ term: plan.term, renderings: plan.renderings }] : []);
      const terms = raw
        .filter((t) => t && short(t.term, 24))
        .map((t) => ({
          term: t.term.trim(),
          renderings: (Array.isArray(t.renderings) ? t.renderings : [])
            .filter((r) => r && short(r.label, 22) && Array.isArray(r.steps) && r.steps.every(idxOk) && r.steps.length)
            .slice(0, 6)
            .map((r) => ({ label: r.label.trim(), steps: [...new Set(r.steps)] })),
        }))
        .filter((t) => t.renderings.length >= 2)
        .slice(0, 3);
      if (!terms.length) return withStage(std);
      return withStage({ form: 'lexicon', terms });
    }
    case 'path': {
      const waypoints = (Array.isArray(plan.waypoints) ? plan.waypoints : [])
        .filter((w) => w && idxOk(w.step) && short(w.marker, 18));
      const seen = new Set(waypoints.map((w) => w.step));
      if (seen.size < Math.ceil(nSteps / 2)) return withStage(std);
      return withStage({ form: 'path', waypoints: waypoints.map((w) => ({ step: w.step, marker: w.marker.trim() })) });
    }
    default:
      return withStage(std);
  }
}

function serveStatic(req, res, urlPath) {
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.join(LAB_DIR, rel);
  if (!file.startsWith(LAB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    return send(res, 404, 'not found', 'text/plain; charset=utf-8');
  }
  send(res, 200, fs.readFileSync(file), MIME[path.extname(file)] || 'application/octet-stream');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const p = url.pathname;

  try {
    if (p === '/api/status') {
      const meta = loadIndex().meta;
      return sendJson(res, 200, {
        index: meta,
        artifactsDir: ARTIFACTS_DIR,
        cacheDir: CACHE_DIR,
        models: MODELS.map((m) => clientFor(m.key).describe()),
        limits: { maxModelCalls: MAX_MODEL_CALLS, maxToolCalls: MAX_TOOL_CALLS },
        pricing: loadPricing(),
        caveats: CAVEATS,
        ledger: readLedger(),
        magic: {
          directorSchemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
          directorPolicyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
          roles: MAGIC_MODEL_ROLES,
        },
      });
    }

    if (p === '/api/fixtures') {
      return send(res, 200, fs.readFileSync(path.join(LAB_DIR, 'fixtures.json')));
    }

    if (p === '/api/direct-runs' && req.method === 'GET') {
      return sendJson(res, 200, { runs: listDirectorEvidence({ limit: 80 }) });
    }

    if (p === '/api/magic-role-runs' && req.method === 'GET') {
      return sendJson(res, 200, { runs: listMagicRoleEvidence({ limit: 80 }) });
    }

    if (p.startsWith('/api/direct-run/') && req.method === 'GET') {
      const record = readDirectorEvidence(decodeURIComponent(p.slice('/api/direct-run/'.length)));
      return record ? sendJson(res, 200, record) : sendJson(res, 404, { error: 'no such director run' });
    }

    if (p === '/api/replays' && req.method === 'GET') {
      return sendJson(res, 200, { replays: listReplayFixtures() });
    }

    if (p.startsWith('/api/replay/') && req.method === 'GET') {
      const id = decodeURIComponent(p.slice('/api/replay/'.length));
      const { fixture, errors } = readReplayFixture(id);
      if (fixture) return sendJson(res, 200, fixture);
      const missing = errors.includes('no such replay fixture');
      return sendJson(res, missing ? 404 : 422, { error: errors.join('; '), errors });
    }

    if (p === '/api/runs') return sendJson(res, 200, { runs: listRuns({ limit: 80 }), ledger: readLedger() });

    if (p.startsWith('/api/run/')) {
      const run = readRun(decodeURIComponent(p.slice('/api/run/'.length)));
      return run ? sendJson(res, 200, run) : sendJson(res, 404, { error: 'no such run' });
    }

    // Streaming run: progress events while the model reads around the corpus.
    //
    // One model or seven, this is the same endpoint and the same stream. `model`
    // runs one; `models: [...]` fires them ALL AT ONCE from here — Send to All —
    // and multiplexes their events down a single connection, every frame tagged
    // with the key of the model it belongs to so the page can route it to that
    // model's panel and no other.
    //
    // Concurrency is server-side on purpose. Seven parallel EventSources would
    // sit on the browser's ~6-connection-per-origin limit and the seventh panel
    // would wait on a free socket; one multiplexed stream has no such ceiling,
    // and the runs are genuinely simultaneous, so a model that thinks for three
    // minutes delays nothing but its own panel.
    if (p === '/api/tour' && req.method === 'POST') {
      const body = await readBody(req);
      const prompt = String(body.prompt || '').trim();
      const requestedKeys = (Array.isArray(body.models) && body.models.length
        ? body.models
        : body.model
          ? [body.model]
          : []
      )
        .map((k) => String(k || '').trim())
        .filter(Boolean);
      if (!prompt) return sendJson(res, 400, { error: 'prompt is required' });
      const abortScope = requestAbortScope(req, res);

      const isMagic = body.surface === 'magic';
      let modelKeys;
      let magicSearchRuntime = null;
      if (isMagic) {
        try {
          modelKeys = resolveMagicSearchModels(body);
          ({ runtime: magicSearchRuntime } = await preflightMagicRole('search'));
        } catch (error) {
          const status = error?.code === 'MAGIC_MODEL_REFUSED' ? 400 : 503;
          abortScope.release();
          return sendJson(res, status, { error: error?.message || String(error), code: error?.code || 'MAGIC_PREFLIGHT' });
        }
      } else {
        modelKeys = [...new Set(requestedKeys)];
      }
      if (!modelKeys.length) {
        abortScope.release();
        return sendJson(res, 400, { error: 'at least one model is required' });
      }
      if (abortScope.signal.aborted || res.destroyed) {
        abortScope.release();
        return;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // Each write is one whole frame, so concurrent runs interleave between
      // frames and never inside one.
      const emit = (event, data) => {
        if (res.destroyed || res.writableEnded || abortScope.signal.aborted) return;
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      emit('batch-start', { models: modelKeys, prompt });
      // allSettled, not all: a missing key, a rejected slug, or a provider 500
      // lands in its own panel and the other six keep going.
      await Promise.allSettled(
        modelKeys.map(async (modelKey) => {
          const tagged = (event, data) => emit(event, { ...data, model: modelKey });
          tagged('start', { prompt });
          try {
            await runTour({
              prompt,
              modelKey,
              promptId: body.promptId || null,
              emit: tagged,
              signal: abortScope.signal,
              replyGuard: isMagic
                ? (reply) => assertMagicReplyEvidence(reply, magicSearchRuntime)
                : null,
            });
          } catch (err) {
            // Fail soft: the panel shows a sentence, never a stack trace.
            tagged('fatal', { message: err?.message || String(err) });
          }
        })
      );
      emit('batch-done', { models: modelKeys });
      abortScope.release();
      if (res.destroyed || res.writableEnded) return;
      return res.end();
    }

    // ------------------------------------------------ the magic experiment
    // /magic is a presentation experiment over the same pipeline: same
    // corpus, same agent, same records — different manners.

    if (p === '/magic') return serveStatic(req, res, '/magic.html');

    // Segment timestamps for one clip, so the page can say the words as
    // they are said. Read-only, clip-sized, same cap as a submitted clip.
    if (p === '/api/window') {
      const tr = loadTranscript(url.searchParams.get('recordId') || '');
      if (!tr) return sendJson(res, 200, { error: 'unknown recording' });
      const from = Math.max(0, Number(url.searchParams.get('from')) || 0);
      const to = Math.min(from + 900, Number(url.searchParams.get('to')) || from + 900);
      const segments = tr.segments
        .filter((s) => s.e >= from && s.s <= to)
        .map((s) => ({ s: Math.round(s.s * 10) / 10, e: Math.round(s.e * 10) / 10, t: s.t }));
      return sendJson(res, 200, { segments });
    }

    if (p === '/api/passage') {
      return sendJson(res, 200, readPassage({
        book: url.searchParams.get('book') || '',
        chapter: Number(url.searchParams.get('chapter')),
        fromVerse: url.searchParams.get('from') ? Number(url.searchParams.get('from')) : null,
        toVerse: url.searchParams.get('to') ? Number(url.searchParams.get('to')) : null,
      }));
    }

    // One cheap model call turns each step's why into a docent's whisper —
    // the line a knowledgeable friend murmurs as the clip starts. The why is
    // the receipt; the whisper is its manner.
    if (p === '/api/whispers' && req.method === 'POST') {
      const body = await readBody(req);
      const steps = Array.isArray(body.steps) ? body.steps.slice(0, 8) : [];
      if (!steps.length) return sendJson(res, 400, { error: 'steps required' });
      const abortScope = requestAbortScope(req, res);
      const wallStarted = Date.now();
      const startedAt = new Date().toISOString();
      try {
        const { client, runtime } = await preflightMagicRole('whispers');
        const reply = await client.chat({
          maxTokens: 4000,
          signal: abortScope.signal,
          messages: [{
            role: 'user',
            content: `For each clip below, write ONE whisper: the single quiet line a knowledgeable friend leans over and says just as the clip begins. At most 12 words. Start with "Listen for", "Notice", or "Wait for". Point at something concrete the speaker actually says or does (draw it from the reason given). Plain words, no hype, no exclamation marks, never mention AI, tours, or clips.\n\n${steps.map((s, i) => `${i + 1}. [${s.source}] ${s.episodeTitle}\nreason: ${String(s.why || '').slice(0, 500)}`).join('\n\n')}\n\nAnswer with ONLY this JSON: {"whispers": ["...", ...]} — exactly ${steps.length} strings, in order.`,
          }],
        });
        const m = String(reply.message.content || '').match(/\{[\s\S]*\}/);
        let parsed = null;
        try { parsed = m ? JSON.parse(m[0]) : null; } catch { /* invalid output degrades honestly */ }
        const accepted = Array.isArray(parsed?.whispers)
          && parsed.whispers.length === steps.length
          && parsed.whispers.every((whisper) => typeof whisper === 'string' && whisper.trim());
        const whispers = accepted
          ? parsed.whispers.slice(0, steps.length).map((w) => String(w).slice(0, 120))
          : [];
        const call = magicCallEvidence('whispers', reply, runtime, accepted ? 'accepted' : 'invalid-output');
        const metrics = magicCallTotals([call], Date.now() - wallStarted);
        const evidenceFile = writeMagicRoleEvidence({
          role: 'whispers',
          startedAt,
          request: { stepCount: steps.length, stepsHash: stableTextHash(JSON.stringify(steps)) },
          model: call.model,
          metrics,
          result: { whispers },
        });
        abortScope.release();
        return sendJson(res, 200, {
          whispers,
          usd: reply.usage?.providerCostUsd ?? null,
          model: call.model,
          metrics,
          evidenceFile: path.basename(evidenceFile),
        });
      } catch (err) {
        abortScope.release();
        // The page degrades to no whisper, never to an error in the reader's face.
        return sendJson(res, 200, { whispers: [], note: err?.message || String(err) });
      }
    }

    // The tour chooses its form. The model composes, the house draws: one
    // cheap call returns a typed plan naming a form from the house
    // vocabulary and its parameters. Validation is strict and the failure
    // mode is always 'standard' — a bad plan degrades to the default form,
    // never to broken furniture.
    if (p === '/api/form' && req.method === 'POST') {
      const body = await readBody(req);
      const steps = Array.isArray(body.tour?.steps) ? body.tour.steps.slice(0, 8) : [];
      const ask = String(body.prompt || '').slice(0, 400);
      if (!steps.length) return sendJson(res, 400, { error: 'tour required' });
      const abortScope = requestAbortScope(req, res);
      const wallStarted = Date.now();
      const startedAt = new Date().toISOString();
      try {
        const { client, runtime } = await preflightMagicRole('form');
        const reply = await client.chat({
          maxTokens: 4000,
          signal: abortScope.signal,
          messages: [{
            role: 'user',
            content: `A listening tour was built for this request: "${ask}"

Steps:
${steps.map((s, i) => `${i}. [${s.source}] ${s.episodeTitle}\n   ${String(s.why || '').slice(0, 300)}`).join('\n')}

Choose the FORM this tour should be set in, from exactly these:
- "quiet"    — for grief, doubt, lament: the room lowers its voice. No parameters.
- "lexicon"  — ONLY for a word study where the whys name distinct English renderings. Give 1-3 terms, each with 2-6 renderings naming which step(s) argue for it.
- "path"     — for a walk through a book or story: give each step a short waypoint marker (a passage or scene name, max 18 characters).
- "standard" — when none of the above is clearly right. Choosing standard is a good answer, not a failure.

Separately: STAGE DIRECTIONS. While a clip plays, its card opens a small stage where the listener WATCHES the teaching. For up to 4 steps you may direct that stage: name the verse the teaching walks through (book chapter:from-to, at most 4 verses), and up to 2 word-groups inside that verse that the teaching turns on — 2-4 single words each, with a short label for what binds them (max 18 characters). The stage shows the verse while the clip plays and draws each word-group AT THE MOMENT the teacher says one of its words, so direct only words the teacher genuinely dwells on and that appear in the verse text.

Answer ONLY with JSON:
{"form":"...", "terms":[{"term":"...","renderings":[{"label":"...","steps":[0]}]}], "waypoints":[{"step":0,"marker":"..."}], "stage":[{"step":2,"verse":"Genesis 6:1-2","marks":[{"words":["saw","took"],"label":"echoes Eden"}]}]}
Include only the keys the chosen form needs; stage directions are optional and most steps need none.`,
          }],
        });
        const m = String(reply.message.content || '').match(/\{[\s\S]*\}/);
        let rawPlan = null;
        try { rawPlan = m ? JSON.parse(m[0]) : null; } catch { /* invalid output becomes standard */ }
        const plan = validateFormPlan(rawPlan, steps.length);
        const validation = rawPlan && typeof rawPlan === 'object'
          ? (plan.form === rawPlan.form || rawPlan.form === 'standard' ? 'accepted' : 'repaired-to-standard')
          : 'invalid-output';
        const call = magicCallEvidence('form', reply, runtime, validation);
        const metrics = magicCallTotals([call], Date.now() - wallStarted);
        plan.usd = reply.usage?.providerCostUsd ?? null;
        plan.model = call.model;
        plan.metrics = metrics;
        const evidenceFile = writeMagicRoleEvidence({
          role: 'form',
          startedAt,
          request: { stepCount: steps.length, askHash: stableTextHash(ask), stepsHash: stableTextHash(JSON.stringify(steps)) },
          model: call.model,
          metrics,
          result: plan,
        });
        plan.evidenceFile = path.basename(evidenceFile);
        abortScope.release();
        return sendJson(res, 200, plan);
      } catch (err) {
        abortScope.release();
        return sendJson(res, 200, { form: 'standard', note: err?.message || String(err) });
      }
    }

    // The v2 director keeps structural scenes and semantic visual beats as
    // separate, versioned timelines. The handler owns transcript identity,
    // shared paid-call dedupe, canonical grounding, and append-only evidence.
    if (p === '/api/direct' && req.method === 'POST') {
      const body = await readBody(req);
      return handleDirectV2(req, res, body);
    }
    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'no such endpoint' });
    return serveStatic(req, res, p);
  } catch (err) {
    if (res.headersSent) return res.end();
    return sendJson(res, 500, { error: err?.message || String(err) });
  }
});

ensureIndex();
server.listen(PORT, () => {
  const configured = MODELS.map((m) => clientFor(m.key)).filter((c) => c.configured).length;
  console.log(`\n  tour lab   http://localhost:${PORT}`);
  console.log(`  corpus     ${ARTIFACTS_DIR}`);
  console.log(`  models     ${configured}/${MODELS.length} configured`);
  for (const m of MODELS) {
    const d = clientFor(m.key).describe();
    const effort = d.reasoning.effort
      ? `  effort ${d.reasoning.effort}${d.reasoning.applied ? '' : ' (endpoint cannot carry it)'} via ${d.reasoning.source}`
      : '  effort vendor default';
    console.log(
      `             ${d.configured ? '✓' : '·'} ${d.requestedSlug}${d.configured ? ` → ${d.baseUrl}${effort}` : `  (${d.reason})`}`
    );
  }
  console.log('');
});
