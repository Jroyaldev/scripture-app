// Tour Lab front end. No framework, no app CSS, no build step.

const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, kids = []) => {
  const n = Object.assign(document.createElement(tag), props);
  for (const k of [].concat(kids)) n.append(k);
  return n;
};

const mmss = (s) => {
  const t = Math.max(0, Math.round(s));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const sec = t % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
};
const usd = (n) => (n == null ? '—' : n < 0.01 ? `$${n.toFixed(5)}` : `$${n.toFixed(4)}`);
const num = (n) => (n ?? 0).toLocaleString();

let STATUS = null;
const PANELS = new Map();
// The last group of models fired together. Progress is derived from the panels
// themselves rather than counted here, so a Run pressed on top of a running
// Send to All cannot desynchronise the tally from what the page is showing.
let WAVE = null;

// -------------------------------------------------------------------- boot

async function boot() {
  STATUS = await (await fetch('./api/status')).json();

  $('#corpus-stats').replaceChildren(
    ...[
      ['episodes', num(STATUS.index.docCount)],
      ['index terms', num(STATUS.index.termCount)],
      ['postings', num(STATUS.index.postingCount)],
      ['index built in', `${(STATUS.index.buildMs / 1000).toFixed(1)}s`],
    ].map(([k, v]) => el('div', {}, [el('dt', { textContent: k }), el('dd', { textContent: v })]))
  );

  const fx = await (await fetch('./api/fixtures')).json();
  const sel = $('#fixtures');
  for (const p of fx.prompts) sel.append(el('option', { value: p.id, textContent: `${p.mode} — ${p.prompt.slice(0, 58)}…` }));
  sel.onchange = () => {
    const p = fx.prompts.find((x) => x.id === sel.value);
    if (p) {
      $('#prompt').value = p.prompt;
      $('#prompt').dataset.promptId = p.id;
    }
  };
  $('#prompt').oninput = () => delete $('#prompt').dataset.promptId;

  // Every model has its own Run button in its own panel header now; the only
  // button up here is the one that fires all of them at once.
  const sendAll = $('#send-all');
  sendAll.onclick = () => startRun(configuredKeys());
  const configured = STATUS.models.filter((m) => m.configured);
  sendAll.disabled = !configured.length;
  sendAll.lastElementChild.textContent = `${configured.length} configured model${configured.length === 1 ? '' : 's'}, in parallel`;

  const unconfigured = STATUS.models.filter((m) => !m.configured);
  $('#hint').textContent = unconfigured.length
    ? `${unconfigured.length} of ${STATUS.models.length} model(s) disabled — ${unconfigured.map((m) => `${m.label} needs ${m.keyEnvVar}`).join('; ')}.`
    : `All ${STATUS.models.length} models configured. Each run is capped at ${STATUS.limits.maxModelCalls} model calls and ${STATUS.limits.maxToolCalls} tool calls.`;

  $('#caveats').replaceChildren(...STATUS.caveats.map((c) => el('li', { textContent: c })));

  for (const m of STATUS.models) PANELS.set(m.key, makePanel(m));
  $('#panels').replaceChildren(...[...PANELS.values()].map((p) => p.root));

  await refreshHistory();
}

const configuredKeys = () => STATUS.models.filter((m) => m.configured).map((m) => m.key);

// ------------------------------------------------------------------ panels

function makePanel(model) {
  const status = el('span', { className: 'badge', textContent: model.configured ? 'idle' : 'no key' });
  const slug = el('span', { className: 'slug', textContent: model.requestedSlug });
  slug.title = `requested slug — the resolved one appears here once a run starts`;

  // What thinking budget this model runs at, and where that came from. An
  // effort the endpoint cannot carry is shown struck through rather than
  // quietly implied.
  const r = model.reasoning || {};
  const effort = el('span', {
    className: `effort ${r.effort ? (r.applied ? '' : 'inert') : 'default'}`,
    textContent: r.effort ? `effort ${r.effort}` : 'vendor default effort',
  });
  effort.title = r.effort
    ? `${r.effort} — from ${r.source}${r.applied ? '' : '; this endpoint has no unified reasoning field, so it is NOT being sent'}`
    : `nothing pinned (${r.source || 'no source'}); the vendor's own default applies`;

  const run = el('button', { className: model.configured ? 'run primary' : 'run', disabled: !model.configured }, [
    el('span', { textContent: 'Run' }),
  ]);
  if (!model.configured) run.title = model.reason;

  const head = el('div', { className: 'panel-head' }, [
    el('div', { className: 'panel-id' }, [el('b', { textContent: model.label }), slug]),
    el('div', { className: 'panel-tags' }, [effort, status, run]),
  ]);
  const banner = el('p', { className: 'note banner', hidden: true });
  const body = el('div', { className: 'panel-body' });
  const strip = el('div', { className: 'strip' });
  const root = el('section', { className: 'panel' }, [head, banner, body, strip]);
  const panel = { root, head, banner, body, strip, status, slug, run, model, busy: false, log: () => {} };
  run.onclick = () => startRun([model.key]);
  resetPanel(panel);
  return panel;
}

function resetPanel(panel) {
  panel.body.replaceChildren(
    el('p', {
      className: 'prose',
      textContent: panel.model.configured
        ? 'No run yet. Ask something above.'
        : panel.model.reason,
    })
  );
  panel.strip.replaceChildren();
}

function setStrip(panel, record) {
  const t = record.totals || {};
  const cost = record.cost || {};
  const cells = [
    ['cost', usd(cost.totalUsd), cost.source === 'price-table' ? 'est' : ''],
    ['cost basis', cost.source || '—', ''],
    ['tokens in', num(t.promptTokens), ''],
    ['tokens out', num(t.completionTokens), ''],
    ['model calls', num(t.modelCalls), ''],
    ['tool calls', num(t.toolCalls), ''],
    ['wall', `${((t.wallMs || 0) / 1000).toFixed(1)}s`, ''],
    ['model latency', `${((t.modelLatencyMs || 0) / 1000).toFixed(1)}s`, ''],
  ];
  if (t.reasoningTokens) cells.splice(4, 0, ['reasoning', num(t.reasoningTokens), '']);
  if (record.rejections?.length) cells.push(['tours rejected', String(record.rejections.length), 'est']);
  panel.strip.replaceChildren(
    ...cells.map(([k, v, cls]) =>
      el('div', {}, [el('span', { className: 'k', textContent: k }), el('span', { className: `v ${cls}`, textContent: v })])
    )
  );
}

function badge(panel, text, cls) {
  panel.status.className = `badge ${cls || ''}`;
  panel.status.textContent = text;
}

function setBanner(panel, text, cls) {
  if (!text) {
    panel.banner.hidden = true;
    panel.banner.textContent = '';
    return;
  }
  panel.banner.className = `note banner ${cls || ''}`;
  panel.banner.textContent = text;
  panel.banner.hidden = false;
}

// --------------------------------------------------------------- run + SSE

/**
 * One prompt, one or many models, one stream.
 *
 * The server fires every requested run at once and multiplexes their progress
 * down a single connection, each frame tagged with the model it belongs to, so
 * panels fill in as their model lands rather than in turn.
 */
async function startRun(modelKeys) {
  const prompt = $('#prompt').value.trim();
  if (!prompt) {
    $('#hint').textContent = 'Type a question first.';
    return;
  }
  const keys = modelKeys.filter((k) => {
    const p = PANELS.get(k);
    return p && p.model.configured && !p.busy;
  });
  if (!keys.length) return;

  for (const k of keys) armPanel(PANELS.get(k));
  WAVE = { keys };
  paintBatch();

  let res;
  try {
    res = await fetch('./api/tour', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, models: keys, promptId: $('#prompt').dataset.promptId || null }),
    });
  } catch (err) {
    for (const k of keys) {
      const p = PANELS.get(k);
      p.busy = false;
      badge(p, 'error', 'bad');
      showError(p, 'Could not reach the lab server', err.message);
    }
    return paintBatch();
  }

  if (!res.ok || !res.body) {
    let message = `server returned ${res.status}`;
    try {
      message = (await res.json())?.error || message;
    } catch {
      /* keep the status line */
    }
    for (const k of keys) {
      const p = PANELS.get(k);
      p.busy = false;
      badge(p, 'error', 'bad');
      showError(p, 'The run never started', message);
    }
    return paintBatch();
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const frames = buf.split('\n\n');
    buf = frames.pop();
    for (const frame of frames) {
      const evLine = frame.split('\n').find((l) => l.startsWith('event: '));
      const dataLine = frame.split('\n').find((l) => l.startsWith('data: '));
      if (!evLine || !dataLine) continue;
      const event = evLine.slice(7).trim();
      let data;
      try {
        data = JSON.parse(dataLine.slice(6));
      } catch {
        continue;
      }
      routeEvent(event, data);
    }
  }
  // Any panel the stream never finished (server died mid-batch) says so rather
  // than spinning forever.
  for (const k of keys) {
    const p = PANELS.get(k);
    if (!p.busy) continue;
    p.busy = false;
    badge(p, 'error', 'bad');
    showError(p, 'The stream ended early', 'the lab server closed the connection before this model reported back');
  }
  paintBatch();
  await refreshHistory();
}

function armPanel(panel) {
  panel.busy = true;
  panel.run.disabled = true;
  badge(panel, 'queued', 'run');
  setBanner(panel, null);
  const trace = el('ul', { className: 'trace' });
  panel.body.replaceChildren(el('p', { className: 'prose', textContent: 'Reading the corpus…' }), trace);
  panel.strip.replaceChildren();
  panel.log = (text, cls) => {
    trace.append(el('li', { className: cls || '', innerHTML: text }));
    trace.scrollTop = trace.scrollHeight;
  };
}

function routeEvent(event, data) {
  if (event === 'batch-start' || event === 'batch-done') return;
  const panel = PANELS.get(data.model);
  if (!panel) return;
  handleEvent(panel, event, data, panel.log);
}

function paintBatch() {
  const anyBusy = [...PANELS.values()].some((p) => p.busy);
  $('#send-all').disabled = anyBusy || !configuredKeys().length;
  for (const p of PANELS.values()) p.run.disabled = p.busy || !p.model.configured;
  if (!WAVE) {
    $('#batch-status').textContent = '';
    return;
  }
  const going = WAVE.keys.filter((k) => PANELS.get(k).busy);
  const done = WAVE.keys.length - going.length;
  $('#batch-status').textContent = going.length
    ? `${done}/${WAVE.keys.length} landed — still running: ${going.map((k) => PANELS.get(k).model.label).join(', ')}`
    : `${WAVE.keys.length}/${WAVE.keys.length} landed.`;
}

const landed = () => paintBatch();

function handleEvent(panel, event, data, log) {
  if (event === 'start') {
    badge(panel, 'running', 'run');
  }
  if (event === 'model') {
    const r = data.resolution;
    panel.slug.textContent = r.exact ? `${panel.model.requestedSlug} → ${r.slug}` : `${panel.model.requestedSlug} ⇢ ${r.slug}`;
    panel.slug.title = r.note;
    if (data.reasoning) {
      panel.slug.title += `\n\neffort: ${data.reasoning.effort || 'vendor default'} (from ${data.reasoning.source})${
        data.reasoning.effort && !data.reasoning.applied ? ' — NOT sent, this endpoint has no reasoning field' : ''
      }`;
    }
    setBanner(
      panel,
      r.exact ? `Exact: this endpoint publishes ${r.slug} and that is what ran.` : r.note,
      r.exact ? 'exact' : ''
    );
    if (!r.exact) log(`<span class="tfail">slug fallback:</span> ${escapeHtml(r.note)}`);
  }
  if (event === 'tool') {
    const arg = data.args ? Object.values(data.args).filter((v) => typeof v !== 'object').slice(0, 2).join(' ') : '';
    log(`<span class="${data.ok === false ? 'tfail' : 'tname'}">${escapeHtml(data.name)}</span> ${escapeHtml(String(arg).slice(0, 64))} — ${escapeHtml(data.summary || '')}`);
    /* A rejection's actual problems, not just their count — an operator
       watching "rejected: 4 problem(s)" repeat has no way to tell an empty
       submit call from a clip running past the tape. */
    for (const p of Array.isArray(data.problems) ? data.problems : []) {
      log(`<span class="tfail">    ✗</span> ${escapeHtml(String(p).slice(0, 200))}`);
    }
  }
  if (event === 'call') {
    log(`· call #${data.i} ${(data.latencyMs / 1000).toFixed(1)}s, ${num(data.usage.promptTokens)} in / ${num(data.usage.completionTokens)} out`);
  }
  if (event === 'fatal') {
    panel.busy = false;
    badge(panel, 'error', 'bad');
    showError(panel, 'The run stopped', data.message);
    landed(panel.model.key);
  }
  if (event === 'done') {
    const r = data.record;
    panel.busy = false;
    if (r.status === 'ok') {
      badge(panel, 'tour', 'ok');
      renderTour(panel, r);
    } else {
      badge(panel, 'no tour', 'bad');
      showError(panel, r.error?.code === 'NO_KEY' ? 'No key configured' : 'No valid tour', r.error?.message || 'unknown', r);
    }
    setStrip(panel, r);
    landed(panel.model.key);
  }
}

const escapeHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function showError(panel, title, message, record) {
  const nodes = [el('div', { className: 'error' }, [el('b', { textContent: title }), el('span', { textContent: message })])];
  if (record?.rejections?.length) {
    nodes.push(
      el('p', { className: 'note', textContent: `Rejected ${record.rejections.length} tour(s): ${record.rejections.at(-1).errors.slice(0, 3).join('; ')}` })
    );
  }
  panel.body.replaceChildren(...nodes);
}

// ----------------------------------------------------------------- the tour

function renderTour(panel, record) {
  const tour = record.tour;
  const kids = [];

  if (record.model.resolution && !record.model.resolution.exact) {
    kids.push(el('p', { className: 'note', textContent: record.model.resolution.note }));
  }
  if (record.rejections?.length) {
    kids.push(el('p', { className: 'note', textContent: `The server rejected ${record.rejections.length} earlier draft(s) of this tour; the model fixed and resubmitted.` }));
  }

  kids.push(el('h3', { className: 'tour-title', textContent: tour.title }));
  kids.push(el('p', { className: 'prose', textContent: tour.intro }));

  const audio = el('audio', { controls: true, preload: 'none' });
  const now = el('span', { className: 'now', textContent: 'Nothing loaded.' });
  const prev = el('button', { textContent: '‹ Prev' });
  const next = el('button', { textContent: 'Next ›' });
  const fallback = el('p', { className: 'step-drift', hidden: true });
  const player = el('div', { className: 'player' }, [
    el('div', { className: 'player-row' }, [prev, next, now]),
    audio,
    fallback,
  ]);

  let current = -1;
  const stepNodes = [];

  // Some podcast CDNs refuse hotlinked range requests (Substack's, for one).
  // Say so and hand over the URL rather than leaving a dead player.
  audio.addEventListener('error', () => {
    const s = tour.steps[current];
    if (!s || !s.audioUrl) return;
    let host = s.audioUrl;
    try {
      host = new URL(s.audioUrl).host;
    } catch {
      /* keep the raw string */
    }
    fallback.hidden = false;
    fallback.replaceChildren(
      document.createTextNode(`This host refused the audio request (${host}). Open it directly and seek to ${mmss(s.startSec)}: `),
      el('a', { href: s.audioUrl, target: '_blank', rel: 'noopener noreferrer', textContent: 'episode audio ↗' })
    );
  });

  const play = (i) => {
    const s = tour.steps[i];
    if (!s) return;
    current = i;
    fallback.hidden = true;
    stepNodes.forEach((n, j) => n.classList.toggle('playing', j === i));
    now.textContent = `Step ${i + 1}/${tour.steps.length} — ${s.source}: ${s.episodeTitle} (${mmss(s.startSec)}–${mmss(s.endSec)})`;
    prev.disabled = i === 0;
    next.disabled = i === tour.steps.length - 1;
    if (!s.audioUrl) {
      now.textContent += ' — no audio URL recorded for this episode';
      return;
    }
    const seek = () => {
      try {
        audio.currentTime = s.startSec;
      } catch {
        /* some hosts refuse a seek before enough is buffered */
      }
      audio.play().catch(() => {});
    };
    if (audio.dataset.src === s.audioUrl) seek();
    else {
      audio.dataset.src = s.audioUrl;
      audio.src = s.audioUrl;
      audio.addEventListener('loadedmetadata', seek, { once: true });
      audio.load();
    }
  };

  // Stop at the end of the clip rather than rolling on into the next segment.
  audio.addEventListener('timeupdate', () => {
    const s = tour.steps[current];
    if (s && audio.currentTime >= s.endSec) audio.pause();
  });
  prev.onclick = () => play(current - 1);
  next.onclick = () => play(current + 1);
  prev.disabled = true;

  const list = el('ol', { className: 'steps' });
  tour.steps.forEach((s, i) => {
    const btn = el('button', { textContent: '▶ Play' });
    btn.onclick = () => play(i);
    const node = el('li', { className: 'step' }, [
      el('div', { className: 'step-head' }, [
        el('span', { className: 'step-n', textContent: String(i + 1) }),
        el('span', { className: 'step-ep', textContent: s.episodeTitle }),
        el('span', { className: 'step-meta', textContent: `${s.source} · ${mmss(s.startSec)}–${mmss(s.endSec)} · ${mmss(s.endSec - s.startSec)}` }),
        btn,
      ]),
      el('p', { className: 'step-why', textContent: s.why }),
    ]);
    if (s.adInsertionDrift) {
      node.append(el('p', { className: 'step-drift', textContent: 'Ad-inserted host — this timestamp can sit up to ~2 min off against today’s stream.' }));
    }
    stepNodes.push(node);
    list.append(node);
  });

  kids.push(list, player);
  kids.push(el('p', { className: 'prose', style: 'margin-top:14px', textContent: tour.closing }));
  kids.push(
    el('p', { className: 'step-meta', textContent: `${tour.steps.length} clips · ${mmss(tour.totalSeconds)} of audio · run ${record.runId}` })
  );
  panel.body.replaceChildren(...kids);
}

// --------------------------------------------------------------- history

async function refreshHistory() {
  const { runs, ledger } = await (await fetch('./api/runs')).json();
  const parts = Object.entries(ledger.models || {}).map(([k, m]) => `${k} ${m.runs} run(s) ${usd(m.totalUsd)}`);
  $('#ledger-summary').textContent = parts.length ? `${parts.join('  ·  ')}  ·  total ${usd(ledger.totalUsd)}` : 'no spend recorded yet';

  $('#history').replaceChildren(
    ...runs.map((r) => {
      const row = el('button', { className: `history-row ${r.status === 'ok' ? '' : 'failed'}` }, [
        el('span', { className: 'when', textContent: new Date(r.startedAt).toLocaleString() }),
        // Runs made before the record carried an effort say so rather than
        // claiming a vendor default they may well not have used.
        el('span', { className: 'who', textContent: `${r.model} · ${r.effort || 'unrecorded'}` }),
        el('span', { className: 'what', textContent: r.title || `(${r.status}) ${r.prompt.slice(0, 90)}` }),
        el('span', { className: 'usd', textContent: usd(r.totalUsd) }),
        el('span', { className: 'n', textContent: r.status === 'ok' ? `${r.steps} steps` : '—' }),
      ]);
      row.title = `${r.resolvedSlug || r.model} at effort ${r.effort || 'not recorded in this run'}`;
      row.onclick = () => loadRun(r.runId, r.model);
      return row;
    })
  );
}

async function loadRun(runId, modelKey) {
  const record = await (await fetch(`./api/run/${encodeURIComponent(runId)}`)).json();
  const panel = PANELS.get(modelKey) || [...PANELS.values()][0];
  if (panel.busy) {
    $('#hint').textContent = `${panel.model.label} is mid-run; let it land before loading an old run into its panel.`;
    return;
  }
  $('#prompt').value = record.prompt;
  const res = record.model?.resolution;
  setBanner(
    panel,
    res
      ? `${res.exact ? 'Exact' : 'Fallback'}: ${record.model.resolvedSlug} at effort ${record.model.reasoning?.effort || 'vendor default'} — from a past run.`
      : null,
    res?.exact ? 'exact' : ''
  );
  if (record.status === 'ok') {
    badge(panel, 'loaded', 'warn');
    renderTour(panel, record);
  } else {
    badge(panel, 'no tour', 'bad');
    showError(panel, 'No valid tour', record.error?.message || 'unknown', record);
  }
  setStrip(panel, record);
  panel.root.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

boot().catch((err) => {
  document.body.prepend(
    el('div', { className: 'error', textContent: `Lab failed to start: ${err.message}` })
  );
});
