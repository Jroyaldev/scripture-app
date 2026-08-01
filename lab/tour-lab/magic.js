// The magic experiment: same pipeline, different manners.
//
// The anti-magic list, enforced here by absence: no chat transcript, no
// streaming tokens, no spinner, no progress bar toward "done", no
// percentages, no "regenerate", and the word "AI" appears nowhere a
// reader can see.
//
// The visual principle, after the reader's correction: visualizations
// never mark the page. They happen inside the STAGE — a box that opens on
// the playing card, where the podcast becomes something you watch: the
// words as they are said, the verse the teaching walks through, and the
// loom drawing over that verse at the moment the teacher reaches the
// words. The model directs; the house performs.

const $ = (s) => document.querySelector(s);
const MODEL = 'gpt-5.6-luna-medium'; // fast enough to watch, cheap enough to not think about

// ----------------------------------------------------------------- scenes

let sceneToken = 0;

function showScene(id) {
  const token = ++sceneToken;
  const cur = document.querySelector('.scene.on');
  const next = document.getElementById(id);
  const reveal = () => {
    if (token !== sceneToken) return;
    for (const sc of document.querySelectorAll('.scene')) {
      if (sc !== next) { sc.classList.remove('on', 'entering'); }
    }
    next.classList.add('entering');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (token === sceneToken) next.classList.add('on');
    }));
  };
  if (cur && cur !== next) {
    cur.classList.remove('on');
    setTimeout(reveal, 460);
  } else {
    reveal();
  }
}

// ------------------------------------------------------------- the making

const lineEl = () => $('#making-line');
let lineQueue = [];
let lineBusy = false;
let lastLineAt = 0;

function sayLine(text) {
  lineQueue = [text];
  drainLines();
}

function drainLines() {
  if (lineBusy || !lineQueue.length) return;
  const el = lineEl();
  const wait = Math.max(0, 1400 - (Date.now() - lastLineAt));
  lineBusy = true;
  setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      el.textContent = lineQueue.shift() || '';
      el.classList.add('show');
      lastLineAt = Date.now();
      lineBusy = false;
      drainLines();
    }, 260);
  }, wait);
}

function addMark() {
  const marks = $('#making-marks');
  if (marks.children.length >= 24) return;
  const d = document.createElement('span');
  d.className = 'mark';
  marks.appendChild(d);
  requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('on')));
}

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function actLine(name, args, summary) {
  const title = (summary && /of (.+)$/.exec(summary))?.[1];
  if (name === 'search_corpus') return 'asking who has taught this…';
  if (name === 'moments_for_passage') return 'gathering everyone who has walked this passage…';
  if (name === 'read_passage') return 'opening the text itself…';
  if (name === 'episode_skim') return title ? `leafing through “${trim(title, 60)}”…` : 'leafing through an episode…';
  if (name === 'transcript_window') return title ? `listening to “${trim(title, 60)}”…` : 'listening closely…';
  if (name === 'list_sources') return 'looking along the shelf…';
  return null;
}

// --------------------------------------------------------------- the ask

$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && $('#q').value.trim()) begin($('#q').value.trim());
});
for (const b of document.querySelectorAll('.eg')) {
  b.addEventListener('click', () => begin(b.textContent));
}
$('#again').addEventListener('click', () => {
  stopAudio();
  $('#q').value = '';
  $('#steps').innerHTML = '';
  $('#making-marks').innerHTML = '';
  showScene('ask');
  setTimeout(() => $('#q').focus(), 520);
});

// --------------------------------------------------------------- the run

async function begin(prompt) {
  showScene('making');
  sayLine('reading your question…');

  const res = await fetch('/api/tour', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, model: MODEL }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let tour = null;
  let sawTrouble = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.+)$/m.exec(frame)?.[1];
      const dataRaw = /^data: (.+)$/m.exec(frame)?.[1];
      if (!ev || !dataRaw) continue;
      let data;
      try { data = JSON.parse(dataRaw); } catch { continue; }
      if (ev === 'tool' && data.ok !== false) {
        const line = actLine(data.name, data.args, data.summary);
        if (line) sayLine(line);
        if (data.name === 'transcript_window') addMark();
      }
      if (ev === 'done' && data.record?.tour) tour = data.record.tour;
      if (ev === 'done' && !data.record?.tour) sawTrouble = true;
      if (ev === 'fatal') sawTrouble = true;
    }
  }

  if (!tour) {
    sayLine(sawTrouble ? 'that one is beyond me today — try asking another way.' : 'try asking another way.');
    setTimeout(() => showScene('ask'), 2600);
    return;
  }

  sayLine('setting the type…');
  setTimeout(() => presentTour(tour, prompt), 1200);
}

// ------------------------------------------------------- quotes & marking

function quotedPhrases(why) {
  const out = [];
  const re = /[“"]([^”"]{6,90})[”"]/g;
  let m;
  while ((m = re.exec(String(why || '')))) out.push(m[1]);
  return out;
}

const normalize = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

function markRelevant(text, phrases, { wholePhrasesOnly = false } = {}) {
  let html = escapeHtml(text);
  const terms = new Set();
  for (const p of phrases) {
    if (p.length <= 60) terms.add(p);
    if (wholePhrasesOnly) continue;
    for (const w of normalize(p).split(' ').filter((x) => x.length >= 5)) terms.add(w);
  }
  if (!terms.size) return html;
  const alternation = [...terms]
    .sort((a, b) => b.length - a.length)
    .map((t) => escapeHtml(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|');
  return html.replace(new RegExp(`(?<![\\w>])(${alternation})(?![\\w])`, 'gi'), (s) => `<em class="rel">${s}</em>`);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// -------------------------------------------------------------- the tour

let whispers = [];
let stageDirections = {};

function presentTour(tour, prompt) {
  delete $('#tour').dataset.form;
  document.querySelector('.lexicon')?.remove();
  stageDirections = {};
  $('#tour-title').textContent = tour.title;
  $('#tour-intro').textContent = tour.intro;
  $('#tour-closing').textContent = tour.closing;
  const mins = Math.round((tour.totalSeconds || 0) / 60);
  $('#tour-length').textContent = `${tour.steps.length} readings · ${mins} minutes`;

  const list = $('#steps');
  list.innerHTML = '';
  whispers = [];

  tour.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.innerHTML = `
      <div class="step-top">
        <span class="step-source"></span>
        <span class="step-mins">${Math.round((s.endSec - s.startSec) / 60)} min</span>
      </div>
      <div class="step-title" role="button" tabindex="0" title="Why this reading"></div>
      <div class="step-row">
        <button class="play" aria-label="Play">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
            <path class="p-play" d="M1 1 L11 7 L1 13 Z"></path>
            <g class="p-pause" style="display:none"><rect x="1" y="1" width="3.5" height="12"></rect><rect x="7.5" y="1" width="3.5" height="12"></rect></g>
          </svg>
        </button>
        <div class="whisper" title="Why this reading"></div>
      </div>
      <div class="stage">
        <blockquote class="verses"></blockquote>
        <div class="terms"></div>
        <div class="allusions"></div>
        <div class="footnotes"></div>
        <p class="caption" aria-live="off"></p>
      </div>
      <div class="why"></div>
      <div class="clip-progress" aria-hidden="true"></div>
      ${s.adInsertionDrift ? '<p class="step-note">This show inserts ads, so the needle may land a little off — nudge if it does.</p>' : ''}
    `;
    li.querySelector('.step-source').textContent = s.source || s.sourceId;
    li.querySelector('.step-title').textContent = s.episodeTitle;
    li.querySelector('.why').textContent = s.why;
    li.querySelector('.play').addEventListener('click', () => toggleStep(li, s, i));
    const toggleWhy = () => li.querySelector('.why').classList.toggle('open');
    li.querySelector('.whisper').addEventListener('click', toggleWhy);
    li.querySelector('.step-title').addEventListener('click', toggleWhy);
    li.querySelector('.step-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleWhy(); });
    list.appendChild(li);
    loadVersesFromWhy(li, s);
  });

  showScene('tour');
  document.querySelectorAll('.step').forEach((el, i) => {
    setTimeout(() => el.classList.add('in'), 350 + i * 240);
  });

  buildVoices(tour);
  fetchWhispers(tour);
  fetchForm(tour, prompt);
}

async function fetchWhispers(tour) {
  try {
    const res = await fetch('/api/whispers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: tour.steps.map((s) => ({ source: s.source, episodeTitle: s.episodeTitle, why: s.why })) }),
    });
    const data = await res.json();
    whispers = data.whispers || [];
  } catch { whispers = []; }
}

// -------------------------------------------------- the tour's own form

async function fetchForm(tour, prompt) {
  let plan = { form: 'standard' };
  try {
    const res = await fetch('/api/form', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, tour: { steps: tour.steps.map((s) => ({ source: s.source, episodeTitle: s.episodeTitle, why: s.why })) } }),
    });
    plan = await res.json();
  } catch { /* standard */ }
  applyForm(plan || { form: 'standard' });
}

function applyForm(plan) {
  const tourEl = $('#tour');
  const items = [...$('#steps').children];
  tourEl.dataset.form = plan.form || 'standard';

  if (plan.form === 'lexicon') {
    const lex = document.createElement('div');
    lex.className = 'lexicon';
    for (const block of plan.terms) {
      const term = document.createElement('p');
      term.className = 'lexicon-term';
      term.textContent = block.term;
      lex.appendChild(term);
      const row = document.createElement('div');
      row.className = 'lexicon-renderings';
      for (const r of block.renderings) {
        const b = document.createElement('button');
        b.className = 'rendering';
        b.textContent = r.label;
        b.addEventListener('click', () => items[r.steps[0]]?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
        row.appendChild(b);
        for (const idx of r.steps) {
          const li = items[idx];
          if (li && !li.querySelector('.rendering-tag')) {
            const t = document.createElement('p');
            t.className = 'rendering-tag';
            t.textContent = r.label;
            li.insertBefore(t, li.firstChild);
          }
        }
      }
      lex.appendChild(row);
    }
    $('#tour-intro').after(lex);
  }

  if (plan.form === 'path') {
    for (const { step, marker } of plan.waypoints) {
      const li = items[step];
      if (!li || li.querySelector('.step-marker')) continue;
      const t = document.createElement('p');
      t.className = 'step-marker';
      t.textContent = marker;
      li.insertBefore(t, li.firstChild);
    }
  }

  /* Stage directions: the verse the teaching walks through, and the word
     groups drawn the moment the teacher says them. Where a direction
     names a verse, it replaces the why-detected one. */
  for (const dir of plan.stage || []) {
    stageDirections[dir.step] = { verse: dir.verse, marks: (dir.marks || []).map((m) => ({ ...m, drawn: false })) };
    const li = items[dir.step];
    if (li) loadVersesFromRef(li, dir.verse);
  }
}

// ------------------------------------------------- scripture, in the stage

function loadVersesFromWhy(li, step) {
  const m = String(step.why || '').match(/\b([1-3]?\s?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/);
  if (!m) return;
  const from = Number(m[3]);
  const to = m[4] ? Math.min(Number(m[4]), from + 5) : from;
  fillVerses(li, m[1], Number(m[2]), from, to, quotedPhrases(step.why));
}

function loadVersesFromRef(li, ref) {
  const m = String(ref).match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?)?$/);
  if (!m) return;
  const from = m[3] ? Number(m[3]) : 1;
  const to = m[4] ? Math.min(Number(m[4]), from + 3) : (m[3] ? from : 4);
  fillVerses(li, m[1], Number(m[2]), from, to, []);
}

function fillVerses(li, book, chapter, from, to, phrases) {
  fetch(`/api/passage?book=${encodeURIComponent(book)}&chapter=${chapter}&from=${from}&to=${to}`)
    .then((r) => r.json())
    .then((p) => {
      if (p.error || !p.verses?.length) return;
      const q = li.querySelector('.verses');
      q.querySelector; // noop
      q.innerHTML = p.verses.map((v) => `<sup>${v.verse}</sup>${markRelevant(v.text, phrases)}`).join(' ')
        + `<span class="verses-ref">${escapeHtml(`${p.bookName} ${p.chapter}:${from}${to > from ? '–' + to : ''}`)}</span>`;
      q.classList.add('has');
    })
    .catch(() => {});
}

// ------------------------------------- the loom, performed on the stage
// Word groups the model directed draw themselves the moment the teacher
// says one of their words — underline runs gathered by one vertical and
// one soft corner, the label along the bracket. A word the verse doesn't
// contain is silently nothing.

function wrapWord(root, word) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const re = new RegExp(`(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`, 'i');
  let node;
  while ((node = walker.nextNode())) {
    if (node.parentElement.closest('.sword, sup, .verses-ref')) continue;
    const m = re.exec(node.textContent);
    if (!m) continue;
    const hit = node.splitText(m.index);
    hit.splitText(m[0].length);
    const span = document.createElement('span');
    span.className = 'sword';
    hit.parentNode.insertBefore(span, hit);
    span.appendChild(hit);
    return span;
  }
  return null;
}

function drawMark(li, mark) {
  const q = li.querySelector('.verses');
  if (!q?.classList.contains('has')) return;
  const spans = mark.words.map((w) => {
    const s = wrapWord(q, w);
    if (s) s.dataset.w = w;
    return s;
  }).filter(Boolean);
  if (spans.length < 2) return;

  const NS = 'http://www.w3.org/2000/svg';
  let svg = q.querySelector('svg.smarks');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'smarks');
    q.appendChild(svg);
  }
  /* The current thought holds the light: earlier groups step back rather
     than compete, and each group owns its own gutter lane — two brackets
     sharing one lane wrote their labels over each other. */
  const priorGroups = [...svg.querySelectorAll('g.markg')];
  for (const g of priorGroups) g.classList.add('past');
  const laneIndex = priorGroups.length;
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'markg');
  svg.appendChild(g);

  const qr = q.getBoundingClientRect();
  const runs = spans.map((sp) => {
    const r = sp.getBoundingClientRect();
    return { x1: r.left - qr.left, x2: r.right - qr.left, y: r.bottom - qr.top + 1.5 };
  }).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const lane = -14 - laneIndex * 11;
  const R = 8;
  const first = runs[0];
  const last = runs[runs.length - 1];
  const parts = [`M ${first.x1} ${first.y} H ${lane + R} Q ${lane} ${first.y} ${lane} ${first.y + R} V ${last.y}`];
  for (const run of runs) {
    parts.push(`M ${run.x1} ${run.y} H ${run.x2}`);
    if (run !== first) parts.push(`M ${lane} ${run.y} H ${run.x1}`);
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', parts.join(' '));
  g.appendChild(path);
  if (mark.label) {
    const midY = (first.y + last.y) / 2;
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', lane - 5);
    label.setAttribute('y', midY);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('transform', `rotate(-90 ${lane - 5} ${midY})`);
    label.textContent = mark.label;
    g.appendChild(label);
  }
  /* Ink arriving, not appearing. */
  const len = path.getTotalLength();
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
}

/* Fires from the caption clock: a directed word group draws the moment one
   of its words is actually said. */
function cueMarks(segText) {
  const dir = stageDirections[current?.index];
  if (!dir?.marks?.length) return;
  const said = ` ${normalize(segText)} `;
  for (const mark of dir.marks) {
    if (mark.drawn) continue;
    if (mark.words.some((w) => said.includes(` ${normalize(w)} `))) {
      mark.drawn = true;
      drawMark(current.li, mark);
    }
  }
}

// -------------------------------------------------- the director's pass
// One deeper call per playing step, grounded server-side in the actual
// tape and the actual verse text. Its scenes run the stage: the verse in
// discussion (which can change mid-clip), word groups, footnotes, allusion
// boxes, term cards — each appearing when its verbatim cue phrase is
// actually said, with a proportional fallback if the tape never surfaces
// the cue. When the director has scenes, the coarse plan-stage yields.

const directorCache = {};

function fetchDirector(step, index) {
  if (directorCache[index]) return Promise.resolve(directorCache[index]);
  return fetch('/api/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ recordId: step.recordId, fromSec: step.startSec, toSec: step.endSec, why: step.why }),
  })
    .then((r) => r.json())
    .then((d) => { directorCache[index] = d; return d; })
    .catch(() => ({ scenes: [] }));
}

function beginDirection(li, index, scenes) {
  if (!current || current.li !== li || !scenes?.length) return;
  current.scenes = scenes.map((s) => ({
    ...s,
    shown: false,
    groups: (s.groups || []).map((g) => ({ ...g, drawn: false })),
    footnotes: (s.footnotes || []).map((f) => ({ ...f, drawn: false })),
    allusions: (s.allusions || []).map((a) => ({ ...a, drawn: false })),
    terms: (s.terms || []).map((t) => ({ ...t, drawn: false })),
  }));
  current.sceneIdx = -1;
  activateScene(0);
}

function activateScene(k) {
  if (!current?.scenes || k >= current.scenes.length || k <= current.sceneIdx) return;
  current.sceneIdx = k;
  const scene = current.scenes[k];
  scene.shown = true;
  const li = current.li;
  const q = li.querySelector('.verses');
  for (const sel of ['.terms', '.allusions', '.footnotes']) li.querySelector(sel).innerHTML = '';
  q.classList.remove('has');
  setTimeout(() => {
    if (!current || current.scenes?.[current.sceneIdx] !== scene) return;
    q.innerHTML = scene.verses.map((v) => `<sup>${v.verse}</sup>${escapeHtml(v.text)}`).join(' ')
      + `<span class="verses-ref">${escapeHtml(scene.ref)}</span>`;
    q.classList.add('has');
    cueArtifacts('');
  }, 240);
}

/* Uncued artifacts appear with their scene; cued ones wait to be said. */
function cueArtifacts(saidBuf, { force = false } = {}) {
  const scene = current?.scenes?.[current.sceneIdx];
  if (!scene) return;
  const li = current.li;
  const ready = (a) => !a.drawn && (force || !a.cue || saidBuf.includes(` ${normalize(a.cue)} `));
  for (const g of scene.groups) {
    if (ready(g)) { g.drawn = true; drawMark(li, g); }
  }
  for (const t of scene.terms) {
    if (!ready(t)) continue;
    t.drawn = true;
    const el = document.createElement('p');
    el.className = 'term-chip';
    el.innerHTML = `<i>${escapeHtml(t.term)}</i> — ${escapeHtml(t.gloss)}`;
    li.querySelector('.terms').appendChild(el);
  }
  for (const a of scene.allusions) {
    if (!ready(a)) continue;
    a.drawn = true;
    for (const prev of li.querySelectorAll('.allusion')) prev.classList.add('past');
    const el = document.createElement('div');
    el.className = 'allusion';
    el.innerHTML = `<span class="allusion-ref">${escapeHtml(a.ref)}</span>${escapeHtml(a.text)}`
      + (a.note ? `<span class="allusion-note">${escapeHtml(a.note)}</span>` : '');
    li.querySelector('.allusions').appendChild(el);
  }
  for (const f of scene.footnotes) {
    if (!ready(f)) continue;
    f.drawn = true;
    const q = li.querySelector('.verses');
    const span = wrapWord(q, f.word);
    if (span) span.insertAdjacentHTML('beforeend', '<sup class="fnmark">†</sup>');
    const el = document.createElement('p');
    el.className = 'footnote';
    el.innerHTML = `<sup>†</sup> <b>${escapeHtml(f.word)}</b> — ${escapeHtml(f.note)}`;
    li.querySelector('.footnotes').appendChild(el);
  }
}

// ------------------------------------------- the voices, measured honestly

function buildVoices(tour) {
  document.querySelector('.voices')?.remove();
  const shares = new Map();
  for (const s of tour.steps) {
    const key = s.source || s.sourceId;
    shares.set(key, (shares.get(key) || 0) + (s.endSec - s.startSec));
  }
  if (shares.size < 2) return;
  const total = [...shares.values()].reduce((a, b) => a + b, 0);
  const wrap = document.createElement('div');
  wrap.className = 'voices';
  const bar = document.createElement('div');
  bar.className = 'voices-bar';
  const legend = document.createElement('p');
  legend.className = 'voices-legend';
  const names = [];
  for (const [name, sec] of shares) {
    const span = document.createElement('span');
    span.style.flexGrow = String(sec / total);
    span.title = `${name} · ${Math.round(sec / 60)} min`;
    bar.appendChild(span);
    names.push(`${name} ${Math.round(sec / 60)}`);
  }
  legend.textContent = names.join('  ·  ');
  wrap.append(bar, legend);
  $('#tour-intro').after(wrap);
}

// -------------------------------------------------------------- listening

const player = $('#player');
let current = null; // { li, step, index, fadeRaf, segments, phrases, capKey, fading }

function toggleStep(li, step, index) {
  if (current && current.li === li) { stopAudio(); return; }
  stopAudio();
  if (!step.audioUrl) { honestNote(li, 'This publisher keeps its audio on its own site.'); return; }
  current = { li, step, index, segments: null, phrases: quotedPhrases(step.why), capKey: null, saidBuf: '', scenes: null, sceneIdx: -1 };
  li.classList.add('playing');
  setGlyph(li, true);

  player.src = step.audioUrl;
  player.currentTime = step.startSec;
  player.volume = 0;
  player.play().then(() => fadeTo(1, 420)).catch(() => {
    honestNote(li, 'This publisher asks you to listen on their own site — the tour will still be here.');
    stopAudio();
  });

  const whisperEl = li.querySelector('.whisper');
  const w = whispers[index];
  whisperEl.textContent = w || '';
  if (w) setTimeout(() => whisperEl.classList.add('show'), 600);

  fetch(`/api/window?recordId=${encodeURIComponent(step.recordId)}&from=${step.startSec}&to=${step.endSec}`)
    .then((r) => r.json())
    .then((d) => { if (current && current.li === li && Array.isArray(d.segments)) current.segments = d.segments; })
    .catch(() => {});

  fetchDirector(step, index).then((d) => beginDirection(li, index, d.scenes));

  player.ontimeupdate = () => {
    if (!current) return;
    const t = player.currentTime;
    updateCaption(t);
    updateProgress(li, step, t);
    /* Proportional fallbacks: cues that the tape never surfaced must not
       strand a scene or its artifacts. */
    const frac = (t - step.startSec) / (step.endSec - step.startSec);
    if (current.scenes) {
      const n = current.scenes.length;
      const due = Math.min(n - 1, Math.floor(frac * (n + 0.6)));
      if (due > current.sceneIdx) activateScene(due);
      if (frac > 0.85) cueArtifacts('', { force: true });
    } else if (frac > 0.7) {
      const dir = stageDirections[index];
      for (const mark of dir?.marks || []) {
        if (!mark.drawn) { mark.drawn = true; drawMark(li, mark); }
      }
    }
    const remaining = step.endSec - t;
    if (remaining <= 0.9 && !current.fading) { current.fading = true; fadeTo(0, 800); }
    if (remaining <= 0) stopAudio();
  };
}

function updateCaption(t) {
  if (!current?.segments?.length) return;
  let seg = null;
  for (const s of current.segments) { if (s.s <= t) seg = s; else break; }
  const silent = !seg || t > seg.e + 1.5;
  const key = silent ? null : seg.s;
  if (key === current.capKey) return;
  current.capKey = key;
  const cap = current.li.querySelector('.caption');
  if (silent) { cap.classList.remove('show'); return; }
  cap.innerHTML = markRelevant(seg.t, current.phrases, { wholePhrasesOnly: true });
  cap.classList.add('show');
  if (current.scenes) {
    current.saidBuf = (current.saidBuf + ' ' + normalize(seg.t)).slice(-600);
    const buf = ` ${current.saidBuf} `;
    const next = current.scenes[current.sceneIdx + 1];
    if (next?.cue && buf.includes(` ${normalize(next.cue)} `)) activateScene(current.sceneIdx + 1);
    cueArtifacts(buf);
  } else {
    cueMarks(seg.t);
  }
}

function updateProgress(li, step, t) {
  const k = Math.max(0, Math.min(1, (t - step.startSec) / (step.endSec - step.startSec)));
  li.querySelector('.clip-progress').style.transform = `scaleX(${k})`;
}

function honestNote(li, text) {
  if (li.querySelector('.honest')) return;
  const p = document.createElement('p');
  p.className = 'step-note honest';
  p.textContent = text;
  li.appendChild(p);
}

function setGlyph(li, playing) {
  li.querySelector('.p-play').style.display = playing ? 'none' : '';
  li.querySelector('.p-pause').style.display = playing ? '' : 'none';
}

function fadeTo(target, ms) {
  if (!current) return;
  cancelAnimationFrame(current.fadeRaf);
  const startVol = player.volume;
  const t0 = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    player.volume = startVol + (target - startVol) * k;
    if (k < 1 && current) current.fadeRaf = requestAnimationFrame(tick);
  };
  current.fadeRaf = requestAnimationFrame(tick);
}

function stopAudio() {
  if (!current) return;
  const { li, fadeRaf } = current;
  cancelAnimationFrame(fadeRaf);
  player.pause();
  player.ontimeupdate = null;
  li.classList.remove('playing');
  li.querySelector('.whisper').classList.remove('show');
  li.querySelector('.caption').classList.remove('show');
  li.querySelector('.clip-progress').style.transform = 'scaleX(0)';
  setGlyph(li, false);
  current = null;
}

$('#q').focus();
