// Tiny static + proxy server for the tour lab.  npm run lab:tour
//
// The browser never sees an API key: every model call goes out from here.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildIndex, indexExists, loadIndex, CACHE_DIR, ARTIFACTS_DIR } from './corpus.mjs';
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
        return sendJson(res, 200, { whispers });
      } catch (err) {
        // The page degrades to no whisper, never to an error in the reader's face.
        return sendJson(res, 200, { whispers: [], note: err?.message || String(err) });
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
