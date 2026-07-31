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

  const buttons = $('#run-buttons');
  for (const m of STATUS.models) {
    const b = el('button', { className: 'primary', disabled: !m.configured }, [
      el('span', { textContent: `Run ${m.label}` }),
      el('span', { className: 'why', textContent: m.configured ? m.requestedSlug : `no key configured (${m.keyEnvVar})` }),
    ]);
    if (!m.configured) {
      b.classList.remove('primary');
      b.title = m.reason;
    }
    b.onclick = () => runOne(m.key);
    buttons.append(b);
  }
  const both = el('button', {}, [el('span', { textContent: 'Run both' })]);
  both.onclick = () => STATUS.models.filter((m) => m.configured).forEach((m) => runOne(m.key));
  buttons.append(both);

  const unconfigured = STATUS.models.filter((m) => !m.configured);
  $('#hint').textContent = unconfigured.length
    ? `${unconfigured.map((m) => m.label).join(', ')} is disabled: ${unconfigured[0].reason}.`
    : `Both models configured. Each run is capped at ${STATUS.limits.maxModelCalls} model calls and ${STATUS.limits.maxToolCalls} tool calls.`;

  $('#caveats').replaceChildren(...STATUS.caveats.map((c) => el('li', { textContent: c })));

  for (const m of STATUS.models) PANELS.set(m.key, makePanel(m));
  $('#panels').replaceChildren(...[...PANELS.values()].map((p) => p.root));

  await refreshHistory();
}

// ------------------------------------------------------------------ panels

function makePanel(model) {
  const status = el('span', { className: 'badge', textContent: model.configured ? 'idle' : 'no key' });
  const slug = el('span', { className: 'slug', textContent: model.requestedSlug });
  const head = el('div', { className: 'panel-head' }, [el('b', { textContent: model.label }), slug, status]);
  const body = el('div', { className: 'panel-body' });
  const strip = el('div', { className: 'strip' });
  const root = el('section', { className: 'panel' }, [head, body, strip]);
  const panel = { root, head, body, strip, status, slug, model, busy: false };
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

// --------------------------------------------------------------- run + SSE

async function runOne(modelKey) {
  const panel = PANELS.get(modelKey);
  const prompt = $('#prompt').value.trim();
  if (!prompt) {
    $('#hint').textContent = 'Type a question first.';
    return;
  }
  if (panel.busy) return;
  panel.busy = true;
  badge(panel, 'running', 'run');

  const trace = el('ul', { className: 'trace' });
  panel.body.replaceChildren(el('p', { className: 'prose', textContent: 'Reading the corpus…' }), trace);
  panel.strip.replaceChildren();
  const log = (text, cls) => {
    trace.append(el('li', { className: cls || '', innerHTML: text }));
    trace.scrollTop = trace.scrollHeight;
  };

  let res;
  try {
    res = await fetch('./api/tour', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, model: modelKey, promptId: $('#prompt').dataset.promptId || null }),
    });
  } catch (err) {
    panel.busy = false;
    badge(panel, 'error', 'bad');
    return showError(panel, 'Could not reach the lab server', err.message);
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
      handleEvent(panel, event, data, log);
    }
  }
  panel.busy = false;
  await refreshHistory();
}

function handleEvent(panel, event, data, log) {
  if (event === 'model') {
    const r = data.resolution;
    panel.slug.textContent = r.exact ? `${panel.model.requestedSlug} → ${r.slug}` : `${panel.model.requestedSlug} ⇢ ${r.slug}`;
    panel.slug.title = r.note;
    if (!r.exact) log(`<span class="tfail">slug fallback:</span> ${escapeHtml(r.note)}`);
  }
  if (event === 'tool') {
    const arg = data.args ? Object.values(data.args).filter((v) => typeof v !== 'object').slice(0, 2).join(' ') : '';
    log(`<span class="${data.ok === false ? 'tfail' : 'tname'}">${escapeHtml(data.name)}</span> ${escapeHtml(String(arg).slice(0, 64))} — ${escapeHtml(data.summary || '')}`);
  }
  if (event === 'call') {
    log(`· call #${data.i} ${(data.latencyMs / 1000).toFixed(1)}s, ${num(data.usage.promptTokens)} in / ${num(data.usage.completionTokens)} out`);
  }
  if (event === 'fatal') {
    badge(panel, 'error', 'bad');
    showError(panel, 'The run stopped', data.message);
  }
  if (event === 'done') {
    const r = data.record;
    if (r.status === 'ok') {
      badge(panel, 'tour', 'ok');
      renderTour(panel, r);
    } else {
      badge(panel, 'no tour', 'bad');
      showError(panel, r.error?.code === 'NO_KEY' ? 'No key configured' : 'No valid tour', r.error?.message || 'unknown', r);
    }
    setStrip(panel, r);
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
        el('span', { className: 'who', textContent: r.model }),
        el('span', { className: 'what', textContent: r.title || `(${r.status}) ${r.prompt.slice(0, 90)}` }),
        el('span', { className: 'usd', textContent: usd(r.totalUsd) }),
        el('span', { className: 'n', textContent: r.status === 'ok' ? `${r.steps} steps` : '—' }),
      ]);
      row.onclick = () => loadRun(r.runId, r.model);
      return row;
    })
  );
}

async function loadRun(runId, modelKey) {
  const record = await (await fetch(`./api/run/${encodeURIComponent(runId)}`)).json();
  const panel = PANELS.get(modelKey) || [...PANELS.values()][0];
  $('#prompt').value = record.prompt;
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
