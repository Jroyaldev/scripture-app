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

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.TOUR_LAB_PORT || 5599);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(body);
};
const sendJson = (res, code, obj) => send(res, code, JSON.stringify(obj));

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
      });
    }

    if (p === '/api/fixtures') {
      return send(res, 200, fs.readFileSync(path.join(LAB_DIR, 'fixtures.json')));
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
      const modelKeys = (Array.isArray(body.models) && body.models.length
        ? body.models
        : [body.model]
      )
        .map((k) => String(k || '').trim())
        .filter(Boolean);
      if (!prompt) return sendJson(res, 400, { error: 'prompt is required' });
      if (!modelKeys.length) return sendJson(res, 400, { error: 'at least one model is required' });

      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // Each write is one whole frame, so concurrent runs interleave between
      // frames and never inside one.
      const emit = (event, data) => {
        if (res.writableEnded) return;
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
            await runTour({ prompt, modelKey, promptId: body.promptId || null, emit: tagged });
          } catch (err) {
            // Fail soft: the panel shows a sentence, never a stack trace.
            tagged('fatal', { message: err?.message || String(err) });
          }
        })
      );
      emit('batch-done', { models: modelKeys });
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
      try {
        const client = clientFor('gpt-5.6-luna-medium');
        const reply = await client.chat({
          maxTokens: 4000,
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
        return sendJson(res, 200, { whispers, usd: reply.usage?.providerCostUsd ?? null });
      } catch (err) {
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
      try {
        const client = clientFor('gpt-5.6-luna-medium');
        const reply = await client.chat({
          maxTokens: 4000,
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
        return sendJson(res, 200, plan);
      } catch (err) {
        return sendJson(res, 200, { form: 'standard', note: err?.message || String(err) });
      }
    }

    // The director's pass: one deeper call per playing step, grounded in
    // the ACTUAL tape and the ACTUAL verse text. The planning call works
    // from summaries; this one reads the clip's transcript, names the
    // scenes (verse + word groups + verbatim cue phrases), and every claim
    // is checked here against the real texts before the page sees it — a
    // word not in the verse or a cue not on the tape is silently dropped.
    if (p === '/api/direct' && req.method === 'POST') {
      const body = await readBody(req);
      const tr = loadTranscript(String(body.recordId || ''));
      if (!tr) return sendJson(res, 200, { scenes: [] });
      const from = Math.max(0, Number(body.fromSec) || 0);
      const to = Math.min(from + 900, Number(body.toSec) || from + 900);
      const tape = tr.segments.filter((s) => s.e >= from && s.s <= to).map((s) => s.t).join(' ').slice(0, 11000);
      if (tape.length < 200) return sendJson(res, 200, { scenes: [] });
      const norm = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();
      const tapeNorm = ` ${norm(tape)} `;
      try {
        const client = clientFor('gpt-5.6-luna-medium');
        const reply = await client.chat({
          maxTokens: 8000,
          messages: [{
            role: 'user',
            content: `You are directing a small visual stage a listener watches while a podcast clip plays. Here is the clip's full transcript:

${tape}

The clip's purpose in its tour: ${String(body.why || '').slice(0, 400)}

Direct up to 3 SCENES, in the order the clip reaches them. Each scene:
- "verse": the passage being discussed at that point — "Book chapter:verse" or a range of at most 3 verses. Only passages genuinely walked through, not passing mentions.
- "cue": a distinctive phrase of 3-8 words COPIED VERBATIM from the transcript at the moment this scene should appear.
- "groups": up to 2 word-groups inside that verse the teaching turns on — 2-4 single words each that appear in the verse text, a label (max 18 characters), and optionally that group's own verbatim cue phrase.
- "footnotes": up to 2 — when the teacher gives a translation or textual note about ONE word of the verse: {"word":"...","note":"the teacher's point, max 90 chars","cue":"..."}. The word must be in the verse text.
- "allusions": up to 2 — when the teacher says this verse echoes or draws on ANOTHER passage: {"verse":"Psalm 82:1","note":"what the teacher says it carries, max 60 chars","cue":"..."}. Only allusions the teacher actually makes.
- "terms": up to 2 — when the teacher explains an original-language word: {"term":"hesed","gloss":"the teacher's gloss, max 48 chars","cue":"..."}.
- "compare": at most 1 — when the teacher sets two passages side by side, for LIKENESS or for difference: {"a":"Genesis 6:2","b":"Genesis 3:6","note":"what the comparison shows, max 60 chars","cue":"..."}. The shared wording is found and shown automatically; your job is only naming the two texts.
- "chain": at most 1 — when the teacher traces one line through scripture (a quotation quoted, a phrase carried forward): {"refs":["Isaiah 53:1","John 12:38","Romans 10:16"],"note":"max 60 chars","cue":"..."} — 2 to 4 single verses in the order the chain runs.
- "caveat": at most 1 — when the teacher says what the passage does NOT say or claim: {"text":"the teacher's caution, max 90 chars","cue":"..."}.
- "highlight": at most 1, USED SPARINGLY — one sentence of the clip worth keeping, copied VERBATIM from the transcript (12-140 chars): {"quote":"..."}. It appears large at the moment it is spoken. Most clips have none.

Every artifact is optional and every cue is a verbatim transcript phrase; an artifact without a cue appears when its scene does. Fewer, truer artifacts beat coverage. A clip that discusses no specific verse gets {"scenes":[]}.
Answer ONLY with JSON: {"scenes":[{"verse":"Genesis 6:2","cue":"...","groups":[{"words":["saw","took"],"label":"Eden echo","cue":"..."}],"footnotes":[],"allusions":[],"terms":[],"compare":null,"chain":null,"caveat":null,"highlight":null}]}`,
          }],
        });
        const m = String(reply.message.content || '').match(/\{[\s\S]*\}/);
        const raw = m ? JSON.parse(m[0]) : null;
        const scenes = [];
        for (const sc of (Array.isArray(raw?.scenes) ? raw.scenes : []).slice(0, 3)) {
          const ref = String(sc?.verse || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?$/);
          if (!ref) continue;
          const fromV = Number(ref[3]);
          const toV = ref[4] ? Math.min(Number(ref[4]), fromV + 2) : fromV;
          const passage = readPassage({ book: ref[1], chapter: Number(ref[2]), fromVerse: fromV, toVerse: toV });
          if (passage.error || !passage.verses?.length) continue;
          const verseNorm = ` ${norm(passage.verses.map((v) => v.text).join(' '))} `;
          const cueOk = (c) => typeof c === 'string' && c.trim().length >= 8 && c.length <= 80 && tapeNorm.includes(` ${norm(c)} `);
          const groups = (Array.isArray(sc.groups) ? sc.groups : [])
            .filter((g) => g && Array.isArray(g.words) && g.words.length >= 2 && g.words.length <= 4)
            .map((g) => ({
              words: g.words.map((w) => String(w).trim()).filter((w) => w && !/\s/.test(w) && verseNorm.includes(` ${norm(w)} `)),
              label: (typeof g.label === 'string' && g.label.trim() && g.label.trim().length <= 18) ? g.label.trim() : null,
              cue: cueOk(g.cue) ? g.cue.trim() : null,
            }))
            .filter((g) => g.words.length >= 2)
            .slice(0, 2);
          const footnotes = (Array.isArray(sc.footnotes) ? sc.footnotes : [])
            .filter((f) => f && typeof f.word === 'string' && !/\s/.test(f.word.trim())
              && verseNorm.includes(` ${norm(f.word)} `)
              && typeof f.note === 'string' && f.note.trim().length >= 4)
            .slice(0, 2)
            .map((f) => ({ word: f.word.trim(), note: f.note.trim().slice(0, 90), cue: cueOk(f.cue) ? f.cue.trim() : null }));
          const allusions = [];
          for (const a of (Array.isArray(sc.allusions) ? sc.allusions : []).slice(0, 2)) {
            const ar = String(a?.verse || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3})(?::(\d{1,3}))?$/);
            if (!ar) continue;
            const av = ar[3] ? Number(ar[3]) : 1;
            const ap = readPassage({ book: ar[1], chapter: Number(ar[2]), fromVerse: av, toVerse: av });
            if (ap.error || !ap.verses?.length) continue;
            allusions.push({
              ref: `${ap.bookName} ${ap.chapter}:${av}`,
              text: ap.verses[0].text.slice(0, 170),
              note: (typeof a.note === 'string' && a.note.trim()) ? a.note.trim().slice(0, 60) : null,
              cue: cueOk(a.cue) ? a.cue.trim() : null,
            });
          }
          const terms = (Array.isArray(sc.terms) ? sc.terms : [])
            .filter((t) => t && typeof t.term === 'string' && t.term.trim().length >= 2 && t.term.trim().length <= 24
              && typeof t.gloss === 'string' && t.gloss.trim().length >= 3)
            .slice(0, 2)
            .map((t) => ({ term: t.term.trim(), gloss: t.gloss.trim().slice(0, 48), cue: cueOk(t.cue) ? t.cue.trim() : null }));
          const oneVerse = (refStr) => {
            const r = String(refStr || '').match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3}):(\d{1,3})$/);
            if (!r) return null;
            const pv = readPassage({ book: r[1], chapter: Number(r[2]), fromVerse: Number(r[3]), toVerse: Number(r[3]) });
            if (pv.error || !pv.verses?.length) return null;
            return { ref: `${pv.bookName} ${pv.chapter}:${r[3]}`, text: pv.verses[0].text };
          };
          let compare = null;
          if (sc.compare && typeof sc.compare === 'object') {
            const a = oneVerse(sc.compare.a);
            const b = oneVerse(sc.compare.b);
            if (a && b && a.ref !== b.ref) {
              compare = { a, b, note: (typeof sc.compare.note === 'string' && sc.compare.note.trim()) ? sc.compare.note.trim().slice(0, 60) : null, cue: cueOk(sc.compare.cue) ? sc.compare.cue.trim() : null };
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
          /* The highlight's own words are its cue — verbatim on tape or it
             does not exist. */
          const highlight = (sc.highlight && typeof sc.highlight.quote === 'string'
            && sc.highlight.quote.trim().length >= 12 && sc.highlight.quote.length <= 140
            && tapeNorm.includes(` ${norm(sc.highlight.quote)} `))
            ? { quote: sc.highlight.quote.trim() }
            : null;
          scenes.push({
            ref: `${passage.bookName} ${passage.chapter}:${fromV}${toV > fromV ? '–' + toV : ''}`,
            verses: passage.verses,
            cue: cueOk(sc.cue) ? sc.cue.trim() : null,
            groups,
            footnotes,
            allusions,
            terms,
            compare,
            chain,
            caveat,
            highlight,
          });
        }
        return sendJson(res, 200, { scenes, usd: reply.usage?.providerCostUsd ?? null });
      } catch (err) {
        return sendJson(res, 200, { scenes: [], note: err?.message || String(err) });
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
