// Tiny static + proxy server for the tour lab.  npm run lab:tour
//
// The browser never sees an API key: every model call goes out from here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, indexExists, loadIndex, loadTranscript, CACHE_DIR, ARTIFACTS_DIR } from './corpus.mjs';
import { readPassage } from './scripture.mjs';
import { MODELS, clientFor } from './model-client.mjs';
import { runTour, listRuns, readRun, readLedger, loadPricing, CAVEATS, MAX_MODEL_CALLS, MAX_TOOL_CALLS } from './tour-agent.mjs';
import {
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_MODEL_ROLES,
  assertMagicModel,
  assertMagicRuntime,
  directorCacheKey,
  normalizeDirectorScenes,
  resolveMagicSearchModels,
  validateDirectorPayload,
} from './magic-contract.mjs';
import {
  listDirectorEvidence,
  listReplayFixtures,
  readDirectorEvidence,
  readReplayFixture,
  writeDirectorEvidence,
} from './director-evidence.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TOUR_LAB_PORT || 5599);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

const DIRECTOR_INFLIGHT = new Map();

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

function acquireDirectorJob(requestKey, req, res, create) {
  let job = DIRECTOR_INFLIGHT.get(requestKey);
  if (job?.controller.signal.aborted) {
    DIRECTOR_INFLIGHT.delete(requestKey);
    job = null;
  }
  if (!job) {
    const controller = new AbortController();
    job = { controller, consumers: new Set(), settled: false, promise: null };
    job.promise = Promise.resolve()
      .then(() => create(controller.signal))
      .finally(() => {
        job.settled = true;
        if (DIRECTOR_INFLIGHT.get(requestKey) === job) DIRECTOR_INFLIGHT.delete(requestKey);
      });
    DIRECTOR_INFLIGHT.set(requestKey, job);
  }

  const consumer = Symbol(requestKey);
  job.consumers.add(consumer);
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    req.off('aborted', release);
    res.off('close', release);
    job.consumers.delete(consumer);
    if (!job.settled && job.consumers.size === 0) job.controller.abort();
  };
  req.once('aborted', release);
  res.once('close', release);
  return { promise: job.promise, release };
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
        magic: { directorSchemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION, roles: MAGIC_MODEL_ROLES },
      });
    }

    if (p === '/api/fixtures') {
      return send(res, 200, fs.readFileSync(path.join(LAB_DIR, 'fixtures.json')));
    }

    if (p === '/api/direct-runs' && req.method === 'GET') {
      return sendJson(res, 200, { runs: listDirectorEvidence({ limit: 80 }) });
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

      const isMagic = body.surface === 'magic';
      let modelKeys;
      if (isMagic) {
        try {
          modelKeys = resolveMagicSearchModels(body);
          await preflightMagicRole('search');
        } catch (error) {
          const status = error?.code === 'MAGIC_MODEL_REFUSED' ? 400 : 503;
          return sendJson(res, status, { error: error?.message || String(error), code: error?.code || 'MAGIC_PREFLIGHT' });
        }
      } else {
        modelKeys = [...new Set(requestedKeys)];
      }
      if (!modelKeys.length) return sendJson(res, 400, { error: 'at least one model is required' });

      const abortScope = requestAbortScope(req, res);

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
        const parsed = m ? JSON.parse(m[0]) : null;
        const whispers = Array.isArray(parsed?.whispers)
          ? parsed.whispers.slice(0, steps.length).map((w) => String(w).slice(0, 120))
          : [];
        abortScope.release();
        return sendJson(res, 200, {
          whispers,
          usd: reply.usage?.providerCostUsd ?? null,
          model: { ...runtime, provider: reply.raw?.provider || 'OpenRouter' },
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
        const plan = validateFormPlan(m ? JSON.parse(m[0]) : null, steps.length);
        plan.usd = reply.usage?.providerCostUsd ?? null;
        plan.model = { ...runtime, provider: reply.raw?.provider || 'OpenRouter' };
        abortScope.release();
        return sendJson(res, 200, plan);
      } catch (err) {
        abortScope.release();
        return sendJson(res, 200, { form: 'standard', note: err?.message || String(err) });
      }
    }

    // The director's pass: one deeper call per playing step, grounded in
    // the ACTUAL tape and the ACTUAL verse text, returning a RESOLVED
    // TIMELINE — every scene and artifact carries `at` seconds into the
    // clip, located on the tape here, so the page is a scheduler and never
    // a guesser. When the resolved timeline leaves a dead stretch longer
    // than 45s, a second cheap call reads exactly that stretch and buys
    // more beats for it. Every claim from either pass is checked against
    // the real texts before the page sees it.
    if (p === '/api/direct' && req.method === 'POST') {
      const body = await readBody(req);
      if (body.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
        return sendJson(res, 409, {
          error: `director schema ${String(body.schemaVersion)} is not supported`,
          supportedSchemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
        });
      }
      try {
        assertMagicModel(body.model);
      } catch (error) {
        return sendJson(res, 400, { error: error.message, code: error.code });
      }

      const recordId = String(body.recordId || '');
      const from = Math.max(0, Number(body.fromSec) || 0);
      const to = Math.min(from + 900, Number(body.toSec) || from + 900);
      const dur = to - from;
      const whyFull = String(body.why || '');
      const why = whyFull.slice(0, 400);
      const requestKey = directorCacheKey({
        schemaVersion: body.schemaVersion,
        modelKey: body.model,
        recordId,
        fromSec: from,
        toSec: to,
        why: whyFull,
      });
      const directRequest = {
        schemaVersion: body.schemaVersion,
        model: body.model,
        recordId,
        fromSec: from,
        toSec: to,
        why,
      };
      const tr = loadTranscript(recordId);
      const segs = (tr?.segments || []).filter((s) => s.e >= from && s.s <= to);
      const tape = segs.map((s) => s.t).join(' ').slice(0, 11000);
      const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const tapeNorm = ` ${norm(tape)} `;

      /* Locators — the house's clock. A phrase resolves to the second its
         segment ends; a word resolves to its first utterance after a time. */
      const locatePhrase = (phrase) => {
        if (!phrase) return null;
        const nc = ` ${norm(phrase)} `;
        let acc = '';
        for (const s of segs) {
          acc += ' ' + norm(s.t);
          if ((` ${acc} `).includes(nc)) return Math.max(0, Math.round(s.e - from));
          acc = acc.slice(-500);
        }
        return null;
      };
      const locateWordAfter = (word, afterRel, occurrence = 0) => {
        const nw = ` ${norm(word)} `;
        let seen = 0;
        for (const s of segs) {
          const rel = s.e - from;
          if (rel < afterRel) continue;
          const text = ` ${norm(s.t)} `;
          let cursor = 0;
          while ((cursor = text.indexOf(nw, cursor)) >= 0) {
            if (seen === occurrence) return Math.round(rel);
            seen += 1;
            cursor += nw.length;
          }
        }
        return null;
      };

      /* Occurrence is a coordinate in the displayed verse, not the tape. For
         a repeated word-group, choose the tightest left-to-right combination
         the displayed text permits; transcript timing remains independent. */
      const displayedMatches = (scene, phrase) => {
        const haystack = ` ${norm((scene.verses || []).map((verse) => verse.text).join(' '))} `;
        const needle = ` ${norm(phrase)} `;
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
        if (candidates.some((matches) => !matches.length)) return words.map(() => 0);
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
        return best ? best.picked.map((match) => match.occurrence) : words.map(() => 0);
      };

      const oneVerse = (refStr) => {
        const r = String(refStr || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3}):(\d{1,3})$/);
        if (!r) return null;
        const pv = readPassage({ book: r[1], chapter: Number(r[2]), fromVerse: Number(r[3]), toVerse: Number(r[3]) });
        if (pv.error || !pv.verses?.length) return null;
        return { ref: `${pv.bookName} ${pv.chapter}:${r[3]}`, text: pv.verses[0].text };
      };

      /* One validator for both passes: everything checked against the scene's
         real verse text and the pass's own stretch of tape. */
      /* Function words never carry a bracket: lighting "of" and "the" as
         they are said is noise wearing the loom's clothes. */
      const STOPWORDS = new Set(['the', 'and', 'of', 'to', 'a', 'an', 'in', 'on', 'for', 'that', 'this', 'with', 'from',
        'they', 'them', 'were', 'was', 'is', 'are', 'be', 'been', 'have', 'has', 'had', 'his', 'her', 'him', 'she', 'he',
        'it', 'its', 'not', 'but', 'all', 'any', 'who', 'you', 'your', 'their', 'there', 'when', 'then', 'will', 'shall']);
      const validateArtifacts = (sc, verseNorm, cueNorm) => {
        const cueOk = (c) => typeof c === 'string' && c.trim().length >= 8 && c.length <= 80 && cueNorm.includes(` ${norm(c)} `);
        /* A word the displayed translation phrases differently is not
           rejected — it is held for the repair exchange, where the model
           maps the teaching's wording onto the displayed text's wording
           (meaning for meaning, never a dictionary), and the mapped phrase
           must still exist verbatim in the verse. */
        const groups = (Array.isArray(sc.groups) ? sc.groups : [])
          .filter((g) => g && Array.isArray(g.words) && g.words.length >= 2 && g.words.length <= 4)
          .map((g) => {
            const words = [];
            const dropped = [];
            for (const raw of g.words) {
              const w = String(raw).trim();
              if (!w || w.length > 28 || w.split(/\s+/).length > 3) continue;
              const isPhrase = /\s/.test(w);
              if (!isPhrase && STOPWORDS.has(norm(w))) continue; // a function word is not repairable, it is noise
              if (verseNorm.includes(` ${norm(w)} `)) words.push(w);
              else dropped.push(w);
            }
            /* A group that blankets the verse stops emphasizing anything:
               words are trimmed, longest first, until they cover at most a
               third of the verse text. */
            const verseLen = verseNorm.length;
            let kept = [...words].sort((a, b) => b.length - a.length);
            while (kept.length > 2 && kept.reduce((n, w) => n + w.length, 0) > verseLen * 0.33) kept.shift();
            return {
              words: words.filter((w) => kept.includes(w)),
              dropped,
              label: (typeof g.label === 'string' && g.label.trim() && g.label.trim().length <= 18) ? g.label.trim() : null,
              cue: cueOk(g.cue) ? g.cue.trim() : null,
            };
          })
          .filter((g) => g.words.length + g.dropped.length >= 2)
          .slice(0, 2);
        const footnotes = (Array.isArray(sc.footnotes) ? sc.footnotes : [])
          .filter((f) => f && typeof f.word === 'string' && f.word.trim() && f.word.trim().split(/\s+/).length <= 3
            && typeof f.note === 'string' && f.note.trim().length >= 4)
          .slice(0, 2)
          .map((f) => ({
            word: f.word.trim(),
            note: f.note.trim().slice(0, 90),
            cue: cueOk(f.cue) ? f.cue.trim() : null,
            missing: !verseNorm.includes(` ${norm(f.word.trim())} `),
          }));
        const allusions = [];
        for (const a of (Array.isArray(sc.allusions) ? sc.allusions : []).slice(0, 2)) {
          const ar = String(a?.verse || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3})(?::(\d{1,3}))?$/);
          if (!ar) continue;
          const av = ar[3] ? Number(ar[3]) : 1;
          const ap = readPassage({ book: ar[1], chapter: Number(ar[2]), fromVerse: av, toVerse: av });
          if (ap.error || !ap.verses?.length) continue;
          const atext = ap.verses[0].text;
          allusions.push({
            ref: `${ap.bookName} ${ap.chapter}:${av}`,
            text: atext.length > 170 ? atext.slice(0, 170).replace(/\s+\S*$/, '') + '…' : atext,
            note: (typeof a.note === 'string' && a.note.trim()) ? a.note.trim().slice(0, 60) : null,
            cue: cueOk(a.cue) ? a.cue.trim() : null,
          });
        }
        const terms = (Array.isArray(sc.terms) ? sc.terms : [])
          .filter((t) => t && typeof t.term === 'string' && t.term.trim().length >= 2 && t.term.trim().length <= 24
            && typeof t.gloss === 'string' && t.gloss.trim().length >= 3)
          .slice(0, 2)
          .map((t) => ({ term: t.term.trim(), gloss: t.gloss.trim().slice(0, 48), cue: cueOk(t.cue) ? t.cue.trim() : null }));
        let compare = null;
        if (sc.compare && typeof sc.compare === 'object') {
          const a = oneVerse(sc.compare.a);
          const b = oneVerse(sc.compare.b);
          if (a && b && a.ref !== b.ref) {
            const AXES = new Set(['likeness', 'difference']);
            compare = {
              a, b,
              axis: AXES.has(sc.compare.axis) ? sc.compare.axis : 'likeness',
              note: (typeof sc.compare.note === 'string' && sc.compare.note.trim()) ? sc.compare.note.trim().slice(0, 60) : null,
              cue: cueOk(sc.compare.cue) ? sc.compare.cue.trim() : null,
            };
          }
        }
        let chain = null;
        if (sc.chain && Array.isArray(sc.chain.refs)) {
          const links = sc.chain.refs.slice(0, 4).map(oneVerse).filter(Boolean);
          if (links.length >= 2) {
            chain = { links, note: (typeof sc.chain.note === 'string' && sc.chain.note.trim()) ? sc.chain.note.trim().slice(0, 60) : null, cue: cueOk(sc.chain.cue) ? sc.chain.cue.trim() : null };
          }
        }
        const caveat = (sc.caveat && typeof sc.caveat.text === 'string' && sc.caveat.text.trim().length >= 8)
          ? { text: sc.caveat.text.trim().slice(0, 90), cue: cueOk(sc.caveat.cue) ? sc.caveat.cue.trim() : null }
          : null;
        const highlight = (sc.highlight && typeof sc.highlight.quote === 'string'
          && sc.highlight.quote.trim().length >= 12 && sc.highlight.quote.length <= 140
          && cueNorm.includes(` ${norm(sc.highlight.quote)} `))
          ? { quote: sc.highlight.quote.trim() }
          : null;
        /* A verse scene earns one aside — the movement, not the play-by-play.
           Only the verse-less scene, whose asides ARE the stage, keeps two. */
        const asides = (Array.isArray(sc.asides) ? sc.asides : [])
          .filter((a) => a && typeof a.text === 'string' && a.text.trim().length >= 8)
          .slice(0, verseNorm.trim() ? 1 : 2)
          .map((a) => {
            const t = a.text.trim();
            return { text: t.length > 70 ? t.slice(0, 70).replace(/\s+\S*$/, '') + '…' : t, cue: cueOk(a.cue) ? a.cue.trim() : null };
          });
        return { groups, footnotes, allusions, terms, compare, chain, caveat, highlight, asides };
      };

      const acquired = acquireDirectorJob(requestKey, req, res, async (signal) => {
        const startedAt = new Date().toISOString();
        const wallStarted = Date.now();
        signal.throwIfAborted();
        const { client, runtime } = await preflightMagicRole('director');
        signal.throwIfAborted();
        const calls = [];

        const finish = (rawScenes, note = null) => {
          signal.throwIfAborted();
          for (const scene of rawScenes) delete scene.verseNorm;
          const normalized = normalizeDirectorScenes(rawScenes, dur);
          const costs = calls.filter((call) => call.providerCostUsd != null).map((call) => call.providerCostUsd);
          const provider = calls.find((call) => call.provider)?.provider || 'OpenRouter';
          const payload = {
            schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
            requestKey,
            scenes: normalized.scenes,
            model: { ...runtime, provider },
            metrics: {
              wallMs: Date.now() - wallStarted,
              passes: calls.length,
              calls,
              totalUsd: costs.length ? costs.reduce((sum, cost) => sum + cost, 0) : null,
              tokens: {
                prompt: calls.reduce((sum, call) => sum + call.promptTokens, 0),
                completion: calls.reduce((sum, call) => sum + call.completionTokens, 0),
                reasoning: calls.reduce((sum, call) => sum + call.reasoningTokens, 0),
                cachedPrompt: calls.reduce((sum, call) => sum + call.cachedPromptTokens, 0),
              },
              normalization: normalized.report,
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
              rawModel: runtime.resolvedSlug,
              provider: 'OpenRouter',
              validation: 'call-error',
              error: { code: error?.code || 'CALL', message: error?.message || String(error) },
            });
            throw error;
          }

          const text = String(reply.message.content || '');
          const match = text.match(/\{[\s\S]*\}/);
          let parsed = null;
          let validation = 'no-json-object';
          if (match) {
            try {
              parsed = JSON.parse(match[0]);
              validation = 'json-parsed';
            } catch {
              validation = 'invalid-json';
            }
          }
          const rawModel = reply.raw?.model || runtime.resolvedSlug;
          const runtimeMismatch = Boolean(reply.raw?.model) && reply.raw.model !== runtime.resolvedSlug;
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
            provider: reply.raw?.provider || 'OpenRouter',
            validation: runtimeMismatch ? 'runtime-mismatch' : validation,
          });
          if (runtimeMismatch) {
            const error = new Error(`\/magic director resolved ${runtime.resolvedSlug}, but provider returned ${rawModel}`);
            error.code = 'MAGIC_RUNTIME_REFUSED';
            throw error;
          }
          return parsed;
        };

        if (!tr) return finish([], 'unknown recording');
        if (tape.length < 200) return finish([], 'recording window has too little transcript');

        let scenes = [];
        try {
          const raw = await callModel('initial', `You are directing a small visual stage a listener watches while a podcast clip plays. Here is the clip's full transcript:

${tape}

The clip's purpose in its tour: ${why}

Direct up to 4 SCENES — as many as the teaching has MOVEMENTS, no more. ONE scene is common; use several only when the teacher genuinely moves between passages. Each scene:
- "verse": the passage being discussed at that point — "Book chapter:verse" or a range of at most 3 verses. Only passages genuinely walked through, not passing mentions.
- "cue": a distinctive phrase of 3-8 words COPIED VERBATIM from the transcript at the moment this scene should appear.
- "groups": up to 2 word-groups inside that verse the teaching turns on — 2-4 single words each that appear in the verse text, a label (max 18 characters), and optionally that group's own verbatim cue phrase. The best groups catch a pattern in the verse's own wording — a parallelism, an echoed pair, the words the argument physically turns on ("eyes, see, ears, hear" when the teacher dwells on refused senses) — not just topic words.
- "footnotes": up to 2 — when the teacher gives a translation or textual note about ONE word of the verse: {"word":"...","note":"the teacher's point, max 90 chars","cue":"..."}. The word must be in the verse text.
- "allusions": up to 2 — when the teacher says this verse echoes or draws on ANOTHER passage: {"verse":"Psalm 82:1","note":"what the teacher says it carries, max 60 chars","cue":"..."}. Only allusions the teacher actually makes.
- "terms": up to 2 — when the teacher explains an original-language word: {"term":"hesed","gloss":"the teacher's gloss, max 48 chars","cue":"..."}. Any transliterated Hebrew or Greek word the teacher dwells on (elohim, hesed, hilasterion, shalom) deserves its card.
- "compare": at most 1 — when the teacher sets two passages side by side: {"a":"Genesis 6:2","b":"Genesis 3:6","axis":"likeness" or "difference","note":"max 60 chars","cue":"..."}. The shared or contrasting wording is found automatically; your job is naming the two texts and which way the comparison cuts.
- "chain": at most 1 — when the teacher traces one line through scripture: {"refs":["Isaiah 53:1","John 12:38","Romans 10:16"],"note":"max 60 chars","cue":"..."} — 2 to 4 single verses in the order the chain runs. The classic case: an Old Testament line quoted in the New — when the teacher makes that move, the chain is the right box, not two separate scenes.
- "caveat": at most 1 — when the teacher says what the passage does NOT say: {"text":"max 90 chars","cue":"..."}.
- "highlight": at most 1, USED SPARINGLY — one sentence worth keeping ABOUT THE TEXT OR ITS MEANING, copied VERBATIM from the transcript (12-140 chars): {"quote":"..."}. Never a sentence about method, markers, the episode, or the speakers themselves. Most clips have none.
- "asides": at most 1 per scene — for a stretch where the teacher is talking but no verse language is in play (context, story, setup): one line naming the MOVEMENT they are making, never the play-by-play: {"text":"outlining the sign act and its explanation","cue":"..."} — max 70 chars, present tense, no hype. "Setting the letter's context" is an aside; "explains the daytime gathering" is narration and belongs to nobody.

The stage displays the World English Bible; the teacher may read another translation. Direct with the words the TEACHING turns on even if the displayed translation phrases them differently ("none" against "no one", "sons of God" against "God's sons") — mismatches are mapped onto the displayed text afterward, meaning for meaning. A word may be a short phrase of up to 3 words.
Spread your directions across the WHOLE clip — the stage draws each artifact at the moment its cue is spoken, and long empty stretches are dead air. Every cue is verbatim from the transcript. Fewer, truer artifacts beat coverage. A clip that discusses no specific verse gets {"scenes":[]}.
Answer ONLY with JSON: {"scenes":[{"verse":"Genesis 6:2","cue":"...","groups":[{"words":["saw","took"],"label":"Eden echo","cue":"..."}],"footnotes":[],"allusions":[],"terms":[],"compare":null,"chain":null,"caveat":null,"highlight":null,"asides":[]}]}`);

        scenes = [];
        for (const sc of (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, 4)) {
          const ref = String(sc?.verse || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?$/);
          if (!ref) { console.log(`[direct] dropped scene, unparsable verse: "${sc?.verse}"`); continue; }
          const fromV = Number(ref[3]);
          const toV = ref[4] ? Math.min(Number(ref[4]), fromV + 2) : fromV;
          const passage = readPassage({ book: ref[1], chapter: Number(ref[2]), fromVerse: fromV, toVerse: toV });
          if (passage.error || !passage.verses?.length) { console.log(`[direct] dropped scene, passage lookup failed: "${sc?.verse}"`); continue; }
          const verseNorm = ` ${norm(passage.verses.map((v) => v.text).join(' '))} `;
          scenes.push({
            ref: `${passage.bookName} ${passage.chapter}:${fromV}${toV > fromV ? '–' + toV : ''}`,
            verses: passage.verses,
            verseNorm,
            cue: (typeof sc.cue === 'string' && sc.cue.trim().length >= 8) ? sc.cue.trim() : null,
            ...validateArtifacts(sc, verseNorm, tapeNorm),
          });
        }

        /* ---- the sceneless clip: presence without a verse ----
           A topical or story clip that walks through no passage still
           deserves a stage that breathes: a handful of asides naming what
           the teacher is doing, and at most one sentence worth keeping.
           They ride in one verse-less scene the page knows how to dress. */
        if (!scenes.length) {
          try {
            const bare = await callModel('sceneless', `A visual stage accompanies this podcast clip, but the clip walks through no specific Bible passage. Here is its transcript:

${tape.slice(0, 8000)}

Direct 2-4 ASIDES — one quiet line each naming what the teacher is doing at that point ("telling the story of...", "answering why...", max 70 chars, present tense) — each with a cue phrase of 3-8 words COPIED VERBATIM from the transcript at that moment. Optionally ONE highlight: a sentence worth keeping about the subject, verbatim (12-140 chars).
Answer ONLY with JSON: {"asides":[{"text":"...","cue":"..."}],"highlight":null}`, 5000);
            if (bare) {
              const extra = validateArtifacts({ asides: bare.asides, highlight: bare.highlight }, '  ', tapeNorm);
              if (extra.asides.length) {
                scenes.push({
                  ref: null,
                  verses: [],
                  verseNorm: '  ',
                  cue: null,
                  groups: [], footnotes: [], allusions: [], terms: [],
                  compare: null, chain: null, caveat: null,
                  highlight: extra.highlight,
                  asides: extra.asides,
                });
              }
            }
          } catch (error) {
            if (signal.aborted) throw error;
            /* an empty stage stays empty honestly */
          }
        }

        /* ---- the repair exchange: meaning for meaning ----
           Words the displayed translation phrases differently were held,
           not rejected. One small call maps each onto the displayed text's
           own wording — and the mapping only stands if the mapped phrase
           exists verbatim in the verse. The model does the semantics; the
           house still does the checking. */
        const repairs = [];
        for (const sc of scenes) {
          for (const g of sc.groups) for (const w of g.dropped) repairs.push({ sc, apply: (t) => g.words.push(t), spoken: w });
          for (const f of sc.footnotes) if (f.missing) repairs.push({ sc, apply: (t) => { f.word = t; f.missing = false; }, spoken: f.word });
        }
        if (repairs.length) {
          try {
            const mapRaw = await callModel('repair', `A visual stage displays Bible verses in one translation while a teacher, possibly reading another translation, is heard. For each numbered pair below, name the word or short phrase (at most 3 words) FROM THE DISPLAYED TEXT that carries the same meaning as the teaching's word — or null if the displayed text truly has no counterpart.

${repairs.map((r, i) => `${i}. displayed text: "${r.sc.verses.map((v) => v.text).join(' ').slice(0, 400)}"
   the teaching's word: "${r.spoken}"`).join('\n')}

Answer ONLY with JSON: {"map":["no one", null, ...]} — exactly ${repairs.length} entries, in order.`, 4000);
            const mapped = Array.isArray(mapRaw?.map) ? mapRaw.map : [];
            repairs.forEach((r, i) => {
              const t = mapped[i];
              const tt = typeof t === 'string' ? t.trim() : '';
              if (tt && tt.length <= 28 && tt.split(/\s+/).length <= 3
                && !(!/\s/.test(tt) && STOPWORDS.has(norm(tt)))
                && r.sc.verseNorm.includes(` ${norm(tt)} `)) {
                r.apply(tt);
              }
            });
          } catch (error) {
            if (signal.aborted) throw error;
            /* unrepaired words simply stay absent */
          }
        }
        for (const sc of scenes) {
          sc.groups = sc.groups.filter((g) => { delete g.dropped; return g.words.length >= 2; });
          sc.footnotes = sc.footnotes.filter((f) => { const keep = !f.missing; delete f.missing; return keep; });
        }

        /* ---- the timeline, resolved by the house ---- */
        scenes.forEach((sc, i) => {
          const located = locatePhrase(sc.cue);
          sc.at = located ?? (i === 0 ? 0 : null);
          sc.timingSource = located == null ? 'house' : 'cue';
        });
        scenes.forEach((sc, i) => {
          if (sc.at != null) return;
          sc.at = Math.round((dur * i) / Math.max(1, scenes.length));
          sc.timingSource = 'house';
        });
        scenes.sort((a, b) => a.at - b.at);

        const artifactsOf = (sc) => [
          ...sc.groups, ...sc.footnotes, ...sc.terms, ...sc.allusions, ...(sc.asides || []),
          ...[sc.compare, sc.chain, sc.caveat, sc.highlight].filter(Boolean),
        ];
        scenes.forEach((sc, i) => {
          const winStart = sc.at;
          const winEnd = i + 1 < scenes.length ? scenes[i + 1].at : dur;
          const span = Math.max(10, winEnd - winStart);
          const tapeOccurrences = new Map();
          for (const g of sc.groups) {
            const verseOccurrences = displayedOccurrences(sc, g.words);
            g.wordTimes = g.words.map((word, wordIndex) => {
              const wordKey = norm(word);
              const tapeOccurrence = tapeOccurrences.get(wordKey) || 0;
              tapeOccurrences.set(wordKey, tapeOccurrence + 1);
              return {
                word,
                occurrence: verseOccurrences[wordIndex],
                at: locateWordAfter(word, winStart, tapeOccurrence),
                timingSource: 'word',
              };
            });
            const lastWord = Math.max(...g.wordTimes.map((w) => w.at ?? -1));
            const cueAt = locatePhrase(g.cue);
            g.at = cueAt ?? (lastWord >= 0 ? lastWord : null);
            g.timingSource = cueAt != null ? 'cue' : lastWord >= 0 ? 'word' : 'house';
          }
          for (const a of sc.footnotes) {
            a.occurrence = displayedOccurrences(sc, [a.word])[0];
          }
          for (const a of [...sc.footnotes, ...sc.terms, ...sc.allusions, ...(sc.asides || [])]) {
            a.at = locatePhrase(a.cue);
            a.timingSource = a.at == null ? 'house' : 'cue';
          }
          for (const a of [sc.compare, sc.chain, sc.caveat].filter(Boolean)) {
            a.at = locatePhrase(a.cue);
            a.timingSource = a.at == null ? 'house' : 'cue';
          }
          if (sc.highlight) {
            sc.highlight.at = locatePhrase(sc.highlight.quote);
            sc.highlight.timingSource = sc.highlight.at == null ? 'house' : 'cue';
          }
          /* The attention budget, by channel. Cue-located beats keep their
             moment — the teacher's own speech paced them, and sync is
             sacred. The highlight is substitutive (it dims the room and
             becomes the field), so it is governed by scarcity, never
             density. Only beats whose timing the house INVENTED are
             budgeted: each seeks the center of the largest empty stretch,
             at least 15s from anything located. */
          const anchored = artifactsOf(sc)
            .filter((a) => a.at != null && a.at >= winStart - 2 && a.at <= winEnd + 5)
            .map((a) => a.at);
          const missing = artifactsOf(sc).filter((a) => a.at == null || a.at < winStart - 2 || a.at > winEnd + 5);
          for (const a of missing) {
            const marks = [winStart, ...anchored.sort((x, y) => x - y), winEnd];
            let best = { len: -1, at: winStart + span / 2 };
            for (let m = 1; m < marks.length; m++) {
              const len = marks[m] - marks[m - 1];
              if (len > best.len) best = { len, at: (marks[m] + marks[m - 1]) / 2 };
            }
            a.at = Math.round(best.at);
            a.timingSource = 'house';
            anchored.push(a.at);
          }
        });

        /* ---- the second pass: buy beats for the starved stretch ---- */
        /* A fourteen-minute commentary clip cannot be rescued by one
           helping: the fill re-measures and goes again, twice at most. */
        const fillRounds = dur > 480 ? 2 : 1;
        for (let round = 0; round < fillRounds; round++) {
        const beatTimes = [0, ...scenes.map((s) => s.at), ...scenes.flatMap(artifactsOf).map((e) => e.at)].sort((a, b) => a - b);
        let gap = { len: 0, start: 0 };
        for (let i = 1; i < beatTimes.length; i++) {
          if (beatTimes[i] - beatTimes[i - 1] > gap.len) gap = { len: beatTimes[i] - beatTimes[i - 1], start: beatTimes[i - 1] };
        }
        const tail = dur - (beatTimes.at(-1) ?? 0);
        if (tail > gap.len) gap = { len: tail, start: beatTimes.at(-1) ?? 0 };
        if (!(scenes.length && gap.len > 45)) break;
        if (scenes.length && gap.len > 45) {
          const host = [...scenes].reverse().find((s) => s.at <= gap.start + 1) || scenes[0];
          const stretchSegs = segs.filter((s) => s.e - from >= gap.start + 2 && s.s - from <= gap.start + gap.len);
          const stretch = stretchSegs.map((s) => s.t).join(' ').slice(0, 6000);
          if (stretch.length > 300) {
            const extraRaw = await callModel(`fill-${round + 1}`, `A visual stage is showing ${host.ref} while a podcast clip plays, and nothing new appears for ${Math.round(gap.len)} seconds. Here is the transcript of exactly that quiet stretch:

${stretch}

Direct 1-3 additional artifacts drawn FROM THIS STRETCH ONLY, for that same verse (its text: ${host.verses.map((v) => v.text).join(' ').slice(0, 600)}). Same rules as before — group words must appear in the verse text, every cue is a phrase copied verbatim from THIS stretch, fewer and truer beats coverage.
An "aside" is often the right direction for a stretch like this — one line naming the MOVEMENT the teacher is making, never the play-by-play: {"asides":[{"text":"setting the letter's context","cue":"..."}]} (max 70 chars, present tense). At most one aside; "explains the daytime gathering" is narration, not an aside.\nAnswer ONLY with JSON: {"groups":[...],"footnotes":[],"terms":[],"allusions":[],"asides":[],"caveat":null,"highlight":null}`, 6000);
            if (extraRaw) {
              const stretchNorm = ` ${norm(stretch)} `;
              const extra = validateArtifacts(extraRaw, host.verseNorm, stretchNorm);
              const clampIn = (a) => {
                const cueAt = locatePhrase(a.cue || a.quote);
                const wordAt = Math.max(...(a.wordTimes || []).map((wordTime) => wordTime.at ?? -1));
                if (cueAt != null && cueAt >= gap.start && cueAt <= gap.start + gap.len + 5) {
                  a.at = cueAt;
                  a.timingSource = 'cue';
                } else if (wordAt >= gap.start && wordAt <= gap.start + gap.len + 5) {
                  a.at = wordAt;
                  a.timingSource = 'word';
                } else {
                  a.at = Math.round(gap.start + gap.len / 2);
                  a.timingSource = 'house';
                }
                return a;
              };
              const fillTapeOccurrences = new Map();
              for (const g of extra.groups.slice(0, 2)) {
                const verseOccurrences = displayedOccurrences(host, g.words);
                g.wordTimes = g.words.map((word, wordIndex) => {
                  const wordKey = norm(word);
                  const tapeOccurrence = fillTapeOccurrences.get(wordKey) || 0;
                  fillTapeOccurrences.set(wordKey, tapeOccurrence + 1);
                  return {
                    word,
                    occurrence: verseOccurrences[wordIndex],
                    at: locateWordAfter(word, gap.start, tapeOccurrence),
                    timingSource: 'word',
                  };
                });
                host.groups.push(clampIn(g));
              }
              for (const f of extra.footnotes.slice(0, 1)) {
                f.occurrence = displayedOccurrences(host, [f.word])[0];
                host.footnotes.push(clampIn(f));
              }
              for (const t of extra.terms.slice(0, 1)) host.terms.push(clampIn(t));
              for (const a of extra.allusions.slice(0, 1)) host.allusions.push(clampIn(a));
              host.asides = host.asides || [];
              for (const a of (extra.asides || []).slice(0, 1)) host.asides.push(clampIn(a));
              if (extra.caveat && !host.caveat) host.caveat = clampIn(extra.caveat);
              if (extra.highlight && !host.highlight) host.highlight = clampIn(extra.highlight);
            }
          }
        }

        }
          return finish(scenes);
        } catch (error) {
          if (signal.aborted) throw error;
          if (error?.code === 'MAGIC_RUNTIME_REFUSED') {
            const evidence = finish(scenes, error.message);
            error.evidenceFile = evidence.evidenceFile;
            throw error;
          }
          return finish(scenes, error?.message || String(error));
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
