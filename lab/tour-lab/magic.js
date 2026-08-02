// The magic experiment: same pipeline, different manners.
//
// The anti-magic list, enforced here by absence: no chat transcript, no
// streaming tokens, no spinner, no progress bar toward "done", no
// percentages, no "regenerate", and the word "AI" appears nowhere a
// reader can see.
//
// The venue, after the reader's second correction: when a reading plays,
// the page BECOMES the stage — the theater. Controls minimize to one quiet
// bar, the list waits behind, and the texts get the room: large type, side
// by side texts, boxes for what the teaching is doing. Nothing visual ever
// marks the list itself. The model directs; the house performs; all
// geometry — lanes, collisions, layout — is the house's arithmetic alone.

import {
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_MODEL_ROLES,
  directorCacheKey,
  validateDirectorPayload,
  validateReplayFixture,
} from './magic-contract.mjs';

const $ = (s) => document.querySelector(s);
const TH = () => $('#theater');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionMs = (ms) => (reducedMotion.matches ? 0 : ms);
const nextFrame = (fn) => reducedMotion.matches ? fn() : requestAnimationFrame(() => requestAnimationFrame(fn));

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
    nextFrame(() => {
      if (token === sceneToken) next.classList.add('on');
    });
  };
  if (cur && cur !== next) {
    cur.classList.remove('on');
    setTimeout(reveal, motionMs(460));
  } else {
    reveal();
  }
}

// ------------------------------------------------------------- the making

const lineEl = () => $('#making-line');
let lineQueue = [];
let lineBusy = false;
let lastLineAt = 0;
const makingTimers = new Set();

function makingDelay(fn, ms) {
  const timer = setTimeout(() => {
    makingTimers.delete(timer);
    fn();
  }, ms);
  makingTimers.add(timer);
  return timer;
}

function cancelMakingLines() {
  for (const timer of makingTimers) clearTimeout(timer);
  makingTimers.clear();
  lineQueue = [];
  lineBusy = false;
}

function sayLine(text) {
  lineQueue = [text];
  drainLines();
}

function drainLines() {
  if (lineBusy || !lineQueue.length) return;
  const el = lineEl();
  const wait = Math.max(0, 1400 - (Date.now() - lastLineAt));
  lineBusy = true;
  makingDelay(() => {
    el.classList.remove('show');
    makingDelay(() => {
      el.textContent = lineQueue.shift() || '';
      el.classList.add('show');
      lastLineAt = Date.now();
      lineBusy = false;
      drainLines();
    }, motionMs(260));
  }, wait);
}

function addMark() {
  const marks = $('#making-marks');
  if (marks.children.length >= 24) return;
  const d = document.createElement('span');
  d.className = 'mark';
  marks.appendChild(d);
  nextFrame(() => d.classList.add('on'));
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
  abortActiveRun();
  stopAudio();
  $('#q').value = '';
  $('#steps').innerHTML = '';
  $('#making-marks').innerHTML = '';
  showScene('ask');
  setTimeout(() => $('#q').focus(), 520);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAudio(); });
$('#th-stop').addEventListener('click', () => stopAudio());

// --------------------------------------------------------------- the run

let runCounter = 0;
let activeRun = null;

function abortActiveRun() {
  if (activeRun) activeRun.controller.abort();
  if (activeRun) {
    for (const timer of activeRun.timers) clearTimeout(timer);
    activeRun.timers.clear();
  }
  activeRun = null;
  cancelPendingPlay();
  cancelMakingLines();
  directorCache.clear();
}

function startRun({ mode = 'live' } = {}) {
  abortActiveRun();
  const run = { id: ++runCounter, mode, controller: new AbortController(), timers: new Set() };
  activeRun = run;
  return run;
}

const runIsActive = (run) => activeRun === run && !run.controller.signal.aborted;

function runDelay(run, fn, ms) {
  if (!runIsActive(run)) return null;
  const timer = setTimeout(() => {
    run.timers.delete(timer);
    if (runIsActive(run)) fn();
  }, ms);
  run.timers.add(timer);
  return timer;
}

async function begin(prompt) {
  const run = startRun({ mode: 'live' });
  showScene('making');
  sayLine('reading your question…');

  let res;
  try {
    res = await fetch('/api/tour', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, surface: 'magic' }),
      signal: run.controller.signal,
    });
    if (!res.ok) throw new Error(`tour request returned ${res.status}`);
  } catch (error) {
    if (error?.name === 'AbortError' || !runIsActive(run)) return;
    sayLine('I could not reach the listening room — try again in a moment.');
    runDelay(run, () => showScene('ask'), 2600);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let tour = null;
  let sawTrouble = null;

  while (true) {
    let packet;
    try {
      packet = await reader.read();
    } catch (error) {
      if (error?.name === 'AbortError' || !runIsActive(run)) return;
      sawTrouble = true;
      break;
    }
    const { done, value } = packet;
    if (done) break;
    if (!runIsActive(run)) return;
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

  if (!runIsActive(run)) return;

  if (!tour) {
    sayLine(sawTrouble ? 'that one is beyond me today — try asking another way.' : 'try asking another way.');
    runDelay(run, () => showScene('ask'), 2600);
    return;
  }

  sayLine('setting the type…');
  runDelay(run, () => presentTour(tour, prompt, run), 1200);
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

/* What two texts share, house arithmetic: significant words on both sides.
   The compare box highlights sameness without a model in the loop. */
/* Three letters and up, because "saw" and "ate" are often the whole point —
   the stoplist carries the weight the length floor used to. */
const STOP = new Set(['the', 'and', 'that', 'this', 'with', 'from', 'they', 'them', 'were', 'have', 'their', 'which',
  'shall', 'unto', 'upon', 'when', 'then', 'because', 'there', 'been', 'will', 'would', 'your', 'yours', 'was', 'she',
  'his', 'her', 'him', 'had', 'has', 'you', 'are', 'not', 'but', 'all', 'out', 'who', 'for', 'any', 'its', 'did',
  'said', 'says', 'also', 'into', 'some', 'more', 'what', 'these', 'those']);
function sharedWords(a, b) {
  const words = (t) => new Set(normalize(t).split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
  const wa = words(a);
  return [...words(b)].filter((w) => wa.has(w));
}

// -------------------------------------------------------------- the tour

let whispers = [];
let stageDirections = {};

function presentTour(tour, prompt, run, { replayFixture = null } = {}) {
  if (!runIsActive(run)) return;
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
  whispers = replayFixture ? [...replayFixture.whispers] : [];

  tour.steps.forEach((s, i) => {
    const li = document.createElement('li');
    li.className = 'step';
    li.innerHTML = `
      <div class="step-top">
        <span class="step-source"></span>
        <span class="step-mins">${Math.round((s.endSec - s.startSec) / 60)} min</span>
      </div>
      <button class="step-title" type="button" aria-expanded="false" title="Why this reading"></button>
      <div class="step-row">
        <button class="play" aria-label="Play">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
            <path d="M1 1 L11 7 L1 13 Z"></path>
          </svg>
        </button>
      </div>
      <div class="why"></div>
      ${s.adInsertionDrift ? '<p class="step-note">This show inserts ads, so the needle may land a little off — nudge if it does.</p>' : ''}
    `;
    li.querySelector('.step-source').textContent = s.source || s.sourceId;
    li.querySelector('.step-title').textContent = s.episodeTitle;
    const why = li.querySelector('.why');
    const whyId = `why-${run.id}-${i}`;
    why.id = whyId;
    why.textContent = s.why;
    const title = li.querySelector('.step-title');
    title.setAttribute('aria-controls', whyId);
    li.querySelector('.play').setAttribute('aria-label', `Play ${s.episodeTitle}`);
    li.querySelector('.play').addEventListener('click', () => toggleStep(li, s, i));
    const toggleWhy = () => {
      const open = why.classList.toggle('open');
      title.setAttribute('aria-expanded', String(open));
    };
    li.querySelector('.step-title').addEventListener('click', toggleWhy);
    list.appendChild(li);
  });

  showScene('tour');
  document.querySelectorAll('.step').forEach((el, i) => {
    runDelay(run, () => el.classList.add('in'), motionMs(350 + i * 240));
  });

  buildVoices(tour);
  if (replayFixture) {
    applyForm(replayFixture.form || { form: 'standard' });
    seedReplayDirections(tour, replayFixture);
  } else {
    fetchWhispers(tour, run);
    fetchForm(tour, prompt, run);
  }

  /* Prefetch every step's stage directions now, one at a time, so the
     first press of any play button finds them already waiting — the
     11-25s director latency happens while the reader is still reading
     the intro, not while they are listening. */
  if (!replayFixture) prefetchDirectors(tour, run);
}

async function fetchWhispers(tour, run) {
  try {
    const res = await fetch('/api/whispers', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ steps: tour.steps.map((s) => ({ source: s.source, episodeTitle: s.episodeTitle, why: s.why })) }),
      signal: run.controller.signal,
    });
    const data = await res.json();
    if (runIsActive(run)) whispers = data.whispers || [];
  } catch (error) {
    if (error?.name !== 'AbortError' && runIsActive(run)) whispers = [];
  }
}

// -------------------------------------------------- the tour's own form

async function fetchForm(tour, prompt, run) {
  let plan = { form: 'standard' };
  try {
    const res = await fetch('/api/form', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, tour: { steps: tour.steps.map((s) => ({ source: s.source, episodeTitle: s.episodeTitle, why: s.why })) } }),
      signal: run.controller.signal,
    });
    plan = await res.json();
  } catch (error) {
    if (error?.name === 'AbortError') return;
  }
  if (runIsActive(run)) applyForm(plan || { form: 'standard' });
}

function applyForm(plan) {
  const tourEl = $('#tour');
  const items = [...$('#steps').children];
  tourEl.dataset.form = plan.form || 'standard';

  if (plan.form === 'lexicon') {
    const lex = document.createElement('div');
    lex.className = 'lexicon';
    for (const block of plan.terms || []) {
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
        b.addEventListener('click', () => items[r.steps[0]]?.scrollIntoView({ behavior: reducedMotion.matches ? 'auto' : 'smooth', block: 'center' }));
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
    for (const { step, marker } of plan.waypoints || []) {
      const li = items[step];
      if (!li || li.querySelector('.step-marker')) continue;
      const t = document.createElement('p');
      t.className = 'step-marker';
      t.textContent = marker;
      li.insertBefore(t, li.firstChild);
    }
  }

  for (const dir of plan.stage || []) {
    stageDirections[dir.step] = { verse: dir.verse, marks: (dir.marks || []).map((m) => ({ ...m, drawn: false })) };
  }
}

// -------------------------------------------------- the director's pass

const DIRECTOR_PREFETCH_CONCURRENCY = 2;
const directorCache = new Map();

function safeDirection(note = 'No stage direction is available for this reading.') {
  return {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    scenes: [],
    model: { key: MAGIC_MODEL_ROLES.director, source: 'house-fallback' },
    metrics: { wallMs: 0 },
    note,
  };
}

function requireValidDirection(payload) {
  const check = validateDirectorPayload(payload);
  if (!check.ok) throw new Error(`director payload refused: ${check.errors.join('; ')}`);
  return payload;
}

function keyForStep(step) {
  return directorCacheKey({
    modelKey: MAGIC_MODEL_ROLES.director,
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    recordId: step.recordId,
    fromSec: step.startSec,
    toSec: step.endSec,
    why: step.why,
  });
}

function directorEntry(step) {
  return directorCache.get(keyForStep(step)) || null;
}

function cacheResolvedDirection(step, index, payload) {
  const key = keyForStep(step);
  const value = requireValidDirection(payload);
  const entry = { key, index, status: 'resolved', value, promise: Promise.resolve(value) };
  directorCache.set(key, entry);
  return entry;
}

function seedReplayDirections(tour, fixture) {
  tour.steps.forEach((step, index) => {
    const key = keyForStep(step);
    const payload = fixture.directions[key] || safeDirection(`Replay ${fixture.id} has no direction for this reading.`);
    cacheResolvedDirection(step, index, payload);
  });
}

function fetchDirector(step, index, run = activeRun) {
  if (!run || !runIsActive(run)) return Promise.reject(new DOMException('stale tour', 'AbortError'));
  const key = keyForStep(step);
  const existing = directorCache.get(key);
  if (existing) return existing.promise;

  if (run.mode === 'replay') {
    return cacheResolvedDirection(step, index, safeDirection('Replay direction missing; no model request was made.')).promise;
  }

  const entry = { key, index, status: 'pending', value: null, promise: null };
  entry.promise = fetch('/api/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      model: MAGIC_MODEL_ROLES.director,
      recordId: step.recordId,
      fromSec: step.startSec,
      toSec: step.endSec,
      why: step.why,
    }),
    signal: run.controller.signal,
  })
    .then((response) => {
      if (!response.ok) throw new Error(`director request returned ${response.status}`);
      return response.json();
    })
    .then((data) => {
      if (!runIsActive(run)) throw new DOMException('stale tour', 'AbortError');
      const value = requireValidDirection(data);
      entry.status = 'resolved';
      entry.value = value;
      return value;
    })
    .catch((error) => {
      if (error?.name === 'AbortError') {
        directorCache.delete(key);
        throw error;
      }
      entry.status = 'resolved';
      entry.value = safeDirection(error?.message || String(error));
      return entry.value;
    });
  directorCache.set(key, entry); // cache the in-flight promise before another gesture can ask
  return entry.promise;
}

async function prefetchDirectors(tour, run) {
  let next = 0;
  const worker = async () => {
    while (runIsActive(run)) {
      const index = next;
      next += 1;
      if (index >= tour.steps.length) return;
      try {
        await fetchDirector(tour.steps[index], index, run);
      } catch (error) {
        if (error?.name === 'AbortError') return;
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(DIRECTOR_PREFETCH_CONCURRENCY, tour.steps.length) }, () => worker())
  );
}

/* The server resolved every cue to seconds; here that becomes one flat
   schedule. The page fires whatever is due — order-proof, replay-proof,
   and immune to a model that numbered its scenes wrong. */
function beginDirection(li, index, payload) {
  if (!current || current.li !== li) return;
  let direction;
  try {
    direction = requireValidDirection(payload);
  } catch (error) {
    honestNote(li, error.message);
    return;
  }
  if (!direction.scenes.length) return;
  const timeline = [];
  let order = 0;
  const add = (event, priority) => timeline.push({ ...event, priority, order: order++ });
  const copy = direction.scenes.map((s, i) => {
    const sc = {
      ...s,
      groups: (s.groups || []).map((g) => ({ ...g })),
      footnotes: (s.footnotes || []).map((f) => ({ ...f })),
      allusions: (s.allusions || []).map((a) => ({ ...a })),
      terms: (s.terms || []).map((t) => ({ ...t })),
      asides: (s.asides || []).map((a) => ({ ...a })),
      compare: s.compare ? { ...s.compare } : null,
      chain: s.chain ? { ...s.chain } : null,
      caveat: s.caveat ? { ...s.caveat } : null,
      highlight: s.highlight ? { ...s.highlight } : null,
    };
    add({ at: sc.at ?? 0, kind: 'scene', scene: sc, idx: i }, 0);
    for (const g of sc.groups) {
      for (const wt of g.wordTimes || []) {
        if (wt.at != null && wt.at < (g.at ?? Infinity)) {
          add({
            at: wt.at,
            kind: 'word',
            scene: sc,
            word: wt.word,
            occurrence: Number.isInteger(wt.occurrence) && wt.occurrence >= 0 ? wt.occurrence : 0,
          }, 1);
        }
      }
      add({ at: g.at ?? sc.at ?? 0, kind: 'group', scene: sc, a: g }, 3);
    }
    for (const [kind, list] of [['footnote', sc.footnotes], ['term', sc.terms], ['allusion', sc.allusions], ['aside', sc.asides || []]]) {
      for (const a of list) add({ at: a.at ?? sc.at ?? 0, kind, scene: sc, a }, 2);
    }
    for (const [kind, a] of [['compare', sc.compare], ['chain', sc.chain], ['caveat', sc.caveat], ['highlight', sc.highlight]]) {
      if (a) add({ at: a.at ?? sc.at ?? 0, kind, scene: sc, a }, 2);
    }
    return sc;
  });
  timeline.sort((x, y) => x.at - y.at || x.priority - y.priority || x.order - y.order);
  current.scenes = copy;
  current.timeline = timeline;
  current.fired = 0;
  current.sceneIdx = -1;
  rebuildStageAt(player.currentTime, { reason: 'direction' });
}

const TH_BOXES = ['.compare', '.chain', '.terms', '.allusions', '.footnotes', '.caveats', '.asides'];

function playDelay(owner, fn, ms) {
  if (!owner || current !== owner || owner.controller.signal.aborted) return null;
  const timer = setTimeout(() => {
    owner.timers.delete(timer);
    if (current === owner && !owner.controller.signal.aborted) fn();
  }, ms);
  owner.timers.add(timer);
  return timer;
}

function activateScene(scene, idx, { force = false, immediate = false, onMounted = null } = {}) {
  if (!current || (!force && idx <= current.sceneIdx)) return;
  const owner = current;
  const generation = ++owner.sceneGeneration;
  owner.sceneIdx = idx;
  owner.sceneReady = false;
  owner.mountedScene = null;
  owner.eventQueue = [];
  const th = TH();
  const body = th.querySelector('.th-body');
  /* Exits are choreographed like entrances: the page breathes out, turns,
     and breathes back in — nothing is ever simply gone. */
  const firstScene = idx === 0 && !body.classList.contains('turning');
  body.classList.add('turning');
  body.setAttribute('aria-busy', 'true');
  releaseHighlight();
  playDelay(owner, () => {
    if (owner.sceneGeneration !== generation || owner.scenes?.[owner.sceneIdx] !== scene) return;
    for (const sel of TH_BOXES) th.querySelector(sel).innerHTML = '';
    owner.compareEl = null;
    owner.compareWords = null;
    const q = th.querySelector('.verses');
    if (scene.verses?.length) {
      q.innerHTML = scene.verses.map((v) => `<sup>${v.verse}</sup>${escapeHtml(v.text)}`).join(' ')
        + `<span class="verses-ref">${escapeHtml(scene.ref)}</span>`;
      q.classList.add('has');
    } else {
      /* A sceneless clip: the stage holds asides and, at most, one kept
         sentence — presence without pretending there is a passage. The
         room arranges itself around them. */
      q.classList.remove('has');
      q.innerHTML = '';
      body.classList.add('bare');
    }
    if (scene.verses?.length) body.classList.remove('bare');
    body.classList.remove('turning');
    body.setAttribute('aria-busy', 'false');
    owner.mountedScene = scene;
    owner.sceneReady = true;
    onMounted?.();
    const queued = owner.eventQueue;
    owner.eventQueue = [];
    for (const event of queued) renderEvent(event);
  }, immediate ? 0 : motionMs(firstScene ? 40 : 420));
}

/* One event from the schedule lands on the stage. Anything that needs the
   verse's laid-out geometry retries once, a beat after the scene's fade. */
function renderEvent(ev) {
  if (!current) return;
  if (ev.kind === 'scene') {
    activateScene(ev.scene, ev.idx);
    return;
  }
  if (current.scenes?.[current.sceneIdx] !== ev.scene) return;
  if (!current.sceneReady || current.mountedScene !== ev.scene) {
    if (!current.rebuilding && !current.eventQueue.includes(ev)) current.eventQueue.push(ev);
    return;
  }
  renderEventNow(ev);
}

function renderEventNow(ev, { reconstruct = false } = {}) {
  if (!current || current.mountedScene !== ev.scene) return;
  const th = TH();
  switch (ev.kind) {
    case 'word': {
      /* A word lights the moment it is said; its bracket completes when
         the group does. */
      const span = getOrWrap(th.querySelector('.verses'), ev.word, ev.occurrence);
      span?.classList.add('lit');
      break;
    }
    case 'group':
      drawMark(ev.a);
      break;
    case 'term': {
      const el = document.createElement('p');
      el.className = 'term-chip appear';
      el.innerHTML = `<i>${escapeHtml(ev.a.term)}</i> — ${escapeHtml(ev.a.gloss)}`;
      th.querySelector('.terms').appendChild(el);
      break;
    }
    case 'allusion': {
      for (const prev of th.querySelectorAll('.allusion')) prev.classList.add('past');
      const el = document.createElement('div');
      el.className = 'allusion appear';
      el.innerHTML = `<span class="box-ref">${escapeHtml(ev.a.ref)}</span>${wrapBoxWords(ev.a.text)}`
        + (ev.a.note ? `<span class="box-note">${escapeHtml(ev.a.note)}</span>` : '');
      th.querySelector('.allusions').appendChild(el);
      break;
    }
    case 'aside': {
      /* One quiet line naming what the teacher is doing — presence for the
         stretches where no verse language is in play. Only ever one. */
      const box = th.querySelector('.asides');
      box.innerHTML = `<p class="aside appear">${escapeHtml(ev.a.text)}</p>`;
      break;
    }
    case 'footnote': {
      /* Print's own answer to two notes on one page: the glyphs take
         turns — dagger, double dagger, section. */
      const glyph = ['†', '‡', '§'][th.querySelectorAll('.footnote').length % 3];
      const q = th.querySelector('.verses');
      const span = getOrWrap(q, ev.a.word, ev.a.occurrence);
      if (span && !span.querySelector('.fnmark')) span.insertAdjacentHTML('beforeend', `<sup class="fnmark">${glyph}</sup>`);
      const el = document.createElement('p');
      el.className = 'footnote appear';
      el.innerHTML = `<sup>${glyph}</sup> <b>${escapeHtml(ev.a.word)}</b> — ${escapeHtml(ev.a.note)}`;
      th.querySelector('.footnotes').appendChild(el);
      break;
    }
    case 'compare': {
      const { a, b, note, axis } = ev.a;
      /* When one side IS the verse already on stage, the box shows only
         its counterpart, full width — a compare that repeats the scene
         verse is furniture pretending to be information. */
      const sceneRef = normalize(ev.scene?.ref || '');
      const sides = [[a, b.text], [b, a.text]].filter(([side]) => normalize(side.ref) !== sceneRef);
      if (sides.length === 0) break;
      /* likeness underlines what binds the two texts; difference underlines
         each side's own pivots — the same box, cutting the other way. */
      const common = sharedWords(a.text, b.text);
      const marksFor = (own, other) => axis === 'difference'
        ? sharedWords(own, own).filter((w) => !sharedWords(other, other).includes(w)).slice(0, 5)
        : common;
      const el = document.createElement('div');
      el.className = 'compare-grid appear';
      if (sides.length === 1) el.classList.add('single');
      el.innerHTML = sides.map(([side, otherText]) =>
        `<div class="cmp"><span class="box-ref">${escapeHtml(side.ref)}</span>${markRelevant(side.text, marksFor(side.text, otherText))}</div>`
      ).join('') + (note ? `<span class="box-note cmp-note">${escapeHtml(note)}</span>` : '');
      th.querySelector('.compare').appendChild(el);
      current.compareEl = el;
      current.compareWords = new Set(common.map(normalize));
      break;
    }
    case 'chain': {
      /* Links assemble one at a time — a chain that appears is a list. */
      const el = document.createElement('div');
      el.className = `chain-box${reconstruct ? '' : ' appear'}`;
      th.querySelector('.chain').appendChild(el);
      const owner = current;
      ev.a.links.forEach((l, i) => {
        playDelay(owner, () => {
          if (!el.isConnected || owner.mountedScene !== ev.scene) return;
          const link = document.createElement('div');
          link.className = `chain-link${reconstruct ? '' : ' appear'}`;
          /* A link that IS the verse on stage is the chain's terminus —
             its reference gathers the line; repeating its text teaches
             nothing twice. */
          const isStage = normalize(l.ref) === normalize(ev.scene?.ref || '');
          link.innerHTML = isStage
            ? `<span class="box-ref">${escapeHtml(l.ref)} — the verse above</span>`
            : `<span class="box-ref">${escapeHtml(l.ref)}</span>${wrapBoxWords(trim(l.text, 110))}`;
          el.appendChild(link);
          if (i === ev.a.links.length - 1 && ev.a.note) {
            el.insertAdjacentHTML('beforeend', `<span class="box-note">${escapeHtml(ev.a.note)}</span>`);
          }
        }, reconstruct ? 0 : motionMs(i * 900));
      });
      break;
    }
    case 'caveat': {
      const el = document.createElement('p');
      el.className = 'caveat appear';
      el.innerHTML = `<span class="box-ref">what it does not say</span>${escapeHtml(ev.a.text)}`;
      th.querySelector('.caveats').appendChild(el);
      break;
    }
    case 'highlight': {
      /* A spotlight that doesn't lower the room isn't one: the verse dims a
         step while the sentence holds, then the room comes back. */
      const bq = th.querySelector('.big-quote');
      bq.textContent = `“${ev.a.quote}”`;
      bq.classList.add('mounted');
      nextFrame(() => bq.classList.add('show'));
      th.querySelector('.th-body').classList.add('spot');
      clearTimeout(current.hlTimer);
      current.hlTimer = playDelay(current, releaseHighlight, 11000);
      break;
    }
  }
}

/* Boxes light their words as the teacher says them: significant words in
   an allusion or chain text are wrapped so the caption clock can find and
   gild them the moment they are spoken — the teacher usually alludes to a
   word, and the box should answer. */
function wrapBoxWords(text) {
  return escapeHtml(text).replace(/(?<![\w>])([A-Za-z][\w'’-]{2,})(?![\w])/g, (w) => {
    const n = normalize(w);
    if (n.length < 3 || STOP.has(n)) return w;
    return `<span class="bw" data-bw="${escapeHtml(n)}">${w}</span>`;
  });
}

function lightBoxWords(segText) {
  const said = new Set(normalize(segText).split(' '));
  if (!said.size) return;
  for (const el of TH().querySelectorAll('.bw:not(.lit-word)')) {
    if (said.has(el.dataset.bw)) el.classList.add('lit-word');
  }
}

function releaseHighlight({ immediate = false } = {}) {
  const th = TH();
  const bq = th.querySelector('.big-quote');
  bq.classList.remove('show');
  if (immediate || !current) {
    bq.classList.remove('mounted');
  } else {
    playDelay(current, () => { if (!bq.classList.contains('show')) bq.classList.remove('mounted'); }, motionMs(950));
  }
  th.querySelector('.th-body').classList.remove('spot');
  if (current) {
    clearTimeout(current.hlTimer);
    current.timers.delete(current.hlTimer);
    current.hlTimer = null;
  }
}

function occurrenceIndex(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

function getOrWrap(root, word, occurrence = 0) {
  if (!root || !word) return null;
  const lex = normalize(word);
  const wanted = occurrenceIndex(occurrence);
  const existing = [...root.querySelectorAll('.sword')].find((span) =>
    (span.dataset.lex || normalize(span.dataset.w || span.textContent)) === lex
      && occurrenceIndex(span.dataset.occurrence) === wanted
  );
  if (existing) return existing;
  const span = wrapWord(root, word, wanted);
  if (span) {
    span.dataset.w = word;
    span.dataset.lex = lex;
    span.dataset.occurrence = String(wanted);
  }
  return span;
}

// ------------------------------------- the loom, performed in the theater
// All geometry is house arithmetic: each group is assigned the first
// gutter lane whose occupied span it does not intersect, so brackets
// share lanes when they can and step outward only when they must.

function wrapWord(root, word, occurrence = 0) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const source = `(?<![A-Za-z])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z])`;
  const re = new RegExp(source, 'gi');
  const countedSwords = new Set();
  let seen = 0;
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('sup, .verses-ref, svg')) continue;
    const sword = parent.closest('.sword');
    if (sword) {
      if (!countedSwords.has(sword)) {
        countedSwords.add(sword);
        if ((sword.dataset.lex || normalize(sword.dataset.w || sword.textContent)) === normalize(word)) {
          if (seen === occurrence) return sword;
          seen += 1;
        }
      }
      continue;
    }
    re.lastIndex = 0;
    const matches = [...node.textContent.matchAll(re)];
    if (seen + matches.length <= occurrence) {
      seen += matches.length;
      continue;
    }
    const m = matches[occurrence - seen];
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

function drawMark(mark) {
  const q = TH().querySelector('.verses');
  if (!q?.classList.contains('has')) return;
  const spans = mark.words.map((w, index) =>
    getOrWrap(q, w, mark.wordTimes?.[index]?.occurrence ?? mark.occurrences?.[index] ?? 0)
  ).filter(Boolean);
  if (spans.length < 2) return;

  const NS = 'http://www.w3.org/2000/svg';
  let svg = q.querySelector('svg.smarks');
  if (!svg) {
    svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('class', 'smarks');
    svg._lanes = [];
    q.appendChild(svg);
  }
  for (const g of svg.querySelectorAll('g.markg')) g.classList.add('past');

  const qr = q.getBoundingClientRect();
  const runs = spans.map((sp) => {
    const r = sp.getBoundingClientRect();
    return { x1: r.left - qr.left, x2: r.right - qr.left, y: r.bottom - qr.top + 1.5 };
  }).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const first = runs[0];
  const last = runs[runs.length - 1];

  /* Lane assignment by interval overlap — never by arrival order. */
  const span = [first.y - 14, last.y + 14];
  const lanes = svg._lanes;
  let laneIndex = lanes.findIndex((occupied) => occupied.every(([y1, y2]) => span[1] < y1 || span[0] > y2));
  if (laneIndex === -1) { laneIndex = lanes.length; lanes.push([]); }
  lanes[laneIndex].push(span);
  const gutter = Number.parseFloat(getComputedStyle(q).paddingLeft) || 64;
  const lane = Math.max(8, gutter - 24 - laneIndex * 11);


  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'markg');
  svg.appendChild(g);
  /* Stage grammar, learned the hard way: a connector that travels to the
     word at underline height reads as underlining the whole line. On this
     wide stage the words carry their own underlines, and the lane carries
     the gathering — one soft corner into a short leader at the top, a
     short tick at each other run — nothing ever runs beneath the text. */
  const R = 8;
  const leader = 10;
  /* The label's slot is settled BEFORE the geometry is drawn, and the
     geometry attaches to it — a dash at one group's line was striking
     through another group's slotted label because the two systems never
     spoke. */
  svg._labelSlots = svg._labelSlots || [];
  const narrow = window.innerWidth < 900;
  const labelExtent = narrow && mark.label ? Math.min(72, Math.max(18, mark.label.length * 5.2)) : 16;
  const labelX = narrow ? lane - 5 : Math.max(8, gutter - 14);
  const slotForY = (wantY) => {
    const half = labelExtent / 2;
    const low = half + 2;
    const high = Math.max(low, q.clientHeight - half - 2);
    const base = Math.max(low, Math.min(high, wantY));
    let y = base;
    let step = 0;
    while (svg._labelSlots.some((slot) =>
      Math.abs(slot.x - labelX) < 10 && y + half > slot.y1 && y - half < slot.y2
    ) && step < 16) {
      step += 1;
      y = Math.max(low, Math.min(high, base + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * (labelExtent + 4)));
    }
    svg._labelSlots.push({ x: labelX, y1: y - half, y2: y + half });
    return y;
  };
  const midY = (first.y + last.y) / 2;
  const labelY = mark.label ? slotForY(midY + 3) : null;
  const parts = [];
  for (const run of runs) parts.push(`M ${run.x1} ${run.y} H ${run.x2}`);
  if (last.y - first.y > R + 2) {
    parts.push(`M ${lane + R + leader} ${first.y} H ${lane + R} Q ${lane} ${first.y} ${lane} ${first.y + R} V ${last.y}`);
    for (const run of runs) {
      if (run !== first) parts.push(`M ${lane} ${run.y} H ${lane + leader}`);
    }
    /* A label slotted beyond the bracket extends the lane to reach it. */
    if (labelY != null && labelY > last.y + 4) parts.push(`M ${lane} ${last.y} V ${labelY}`);
    if (labelY != null && labelY < first.y - 4) parts.push(`M ${lane} ${first.y} V ${labelY}`);
  } else {
    /* One line: a tick at the words' line, the dash at the label's own
       slot, and a stub joining them when they differ. */
    const dashY = labelY ?? first.y;
    parts.push(`M ${lane} ${dashY} H ${lane + R + leader}`);
    if (Math.abs(dashY - first.y) > 4) {
      parts.push(`M ${lane} ${first.y} H ${lane + leader}`);
      parts.push(`M ${lane} ${Math.min(dashY, first.y)} V ${Math.max(dashY, first.y)}`);
    }
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', parts.join(' '));
  g.appendChild(path);
  if (mark.label) {
    /* Horizontal, right-aligned against the lane — the rotated label was
       the only sideways text anywhere and the hardest to read exactly when
       it mattered. Rotation survives only as the narrow-viewport fallback,
       where the left margin cannot hold a word. */
    const label = document.createElementNS(NS, 'text');
    if (!narrow) {
      /* One ledger column for every label, outside the deepest common
         lanes — per-lane alignment scattered stacked labels diagonally
         into each other's dashes. */
      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);
      label.setAttribute('text-anchor', 'end');
    } else {
      label.setAttribute('x', labelX);
      label.setAttribute('y', labelY);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('transform', `rotate(-90 ${labelX} ${labelY})`);
      if (mark.label.length > 13) {
        label.setAttribute('textLength', String(labelExtent));
        label.setAttribute('lengthAdjust', 'spacingAndGlyphs');
      }
    }
    label.textContent = mark.label;
    g.appendChild(label);
  }
  const len = path.getTotalLength();
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  if (reducedMotion.matches) path.style.strokeDashoffset = '0';
  else requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
}

/* The fallback layer when the director has no scenes: the plan's stage
   direction, or the passage the why cites. */
function fallbackVerse(step, index) {
  const owner = current;
  if (!owner) return;
  const dirRef = stageDirections[index]?.verse;
  const m = dirRef
    ? String(dirRef).match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?)?$/)
    : String(step.why || '').match(/\b([1-3]?\s?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/);
  if (!m) return;
  const from = m[3] ? Number(m[3]) : 1;
  const to = m[4] ? Math.min(Number(m[4]), from + 5) : (m[3] ? from : 4);
  fetch(`/api/passage?book=${encodeURIComponent(m[1])}&chapter=${m[2]}&from=${from}&to=${to}`, {
    signal: owner.controller.signal,
  })
    .then((r) => r.json())
    .then((p) => {
      if (p.error || !p.verses?.length || current !== owner || owner.index !== index || owner.scenes) return;
      const q = TH().querySelector('.verses');
      q.innerHTML = p.verses.map((v) => `<sup>${v.verse}</sup>${markRelevant(v.text, owner.phrases)}`).join(' ')
        + `<span class="verses-ref">${escapeHtml(`${p.bookName} ${p.chapter}:${from}${to > from ? '–' + to : ''}`)}</span>`;
      q.classList.add('has');
    })
    .catch((error) => { if (error?.name !== 'AbortError') { /* quiet fallback */ } });
}

function cueMarks(segText) {
  const dir = stageDirections[current?.index];
  if (!dir?.marks?.length) return;
  const said = ` ${normalize(segText)} `;
  for (const mark of dir.marks) {
    if (mark.drawn) continue;
    if (mark.words.some((w) => said.includes(` ${normalize(w)} `))) {
      mark.drawn = true;
      drawMark(mark);
    }
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
let current = null;
let playCounter = 0;

let pendingPlay = null;

function cancelPendingPlay() {
  if (!pendingPlay) return;
  pendingPlay.button.classList.remove('waiting');
  pendingPlay.button.removeAttribute('aria-busy');
  pendingPlay = null;
}

function toggleStep(li, step, index) {
  const key = keyForStep(step);
  if (pendingPlay?.key === key) { cancelPendingPlay(); return; }
  if (current && current.li === li) { stopAudio(); return; }
  cancelPendingPlay();
  stopAudio({ restoreFocus: false });
  if (!step.audioUrl) { honestNote(li, 'This publisher keeps its audio on its own site.'); return; }
  /* The stage never opens undirected: if this step's directions are still
     on their way (rare — they prefetch while the intro is read), the press
     waits for them, the button breathing quietly instead of spinning. */
  const entry = directorEntry(step);
  if (!entry || entry.status !== 'resolved') {
    const button = li.querySelector('.play');
    const intent = { key, li, button, run: activeRun };
    pendingPlay = intent;
    button.classList.add('waiting');
    button.setAttribute('aria-busy', 'true');
    fetchDirector(step, index, activeRun).then((direction) => {
      if (pendingPlay !== intent || !runIsActive(intent.run)) return;
      cancelPendingPlay();
      startStepPlayback(li, step, index, direction);
    }).catch((error) => {
      if (pendingPlay === intent) cancelPendingPlay();
      if (error?.name !== 'AbortError') honestNote(li, 'The stage directions could not be opened.');
    });
    return;
  }
  startStepPlayback(li, step, index, entry.value);
}

function startStepPlayback(li, step, index, direction) {
  if (!activeRun || !runIsActive(activeRun)) return;
  const playButton = li.querySelector('.play');
  current = {
    li, step, index,
    run: activeRun,
    controller: new AbortController(),
    timers: new Set(),
    segments: null,
    phrases: quotedPhrases(step.why),
    capKey: null,
    scenes: null,
    timeline: null,
    fired: 0,
    sceneIdx: -1,
    sceneGeneration: 0,
    seekGeneration: 0,
    sceneReady: false,
    mountedScene: null,
    eventQueue: [],
    rebuilding: false,
    playToken: ++playCounter,
    returnFocus: playButton,
  };
  const owner = current;
  li.classList.add('playing');

  const th = TH();
  th.querySelector('.th-source').textContent = step.source || step.sourceId;
  th.querySelector('.th-title').textContent = step.episodeTitle;
  th.querySelector('.th-whisper').textContent = '';
  th.querySelector('.verses').classList.remove('has');
  th.querySelector('.verses').innerHTML = '';
  th.querySelector('.big-quote').classList.remove('show');
  th.querySelector('.caption').classList.remove('show');
  th.querySelector('.th-body').classList.remove('turning', 'spot', 'bare');
  th.querySelector('.th-body').setAttribute('aria-busy', 'false');
  for (const sel of TH_BOXES) th.querySelector(sel).innerHTML = '';
  updateProgress(step.startSec);
  th.classList.add('on');
  th.setAttribute('aria-hidden', 'false');
  $('#main').inert = true;
  $('#main').setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-theater');
  nextFrame(() => { if (current === owner) $('#th-stop').focus({ preventScroll: true }); });

  player.src = step.audioUrl;
  player.currentTime = step.startSec;
  player.volume = 0;
  beginDirection(li, index, direction);
  if (!owner.scenes) fallbackVerse(step, index);

  player.play().then(() => {
    if (current === owner) fadeTo(1, 420);
  }).catch(() => {
    if (current !== owner) return;
    honestNote(li, 'This publisher asks you to listen on their own site — the tour will still be here.');
    stopAudio();
  });

  const w = whispers[index];
  if (w) {
    th.querySelector('.th-whisper').textContent = w;
    playDelay(owner, () => th.querySelector('.th-whisper').classList.add('show'), motionMs(700));
  }

  fetch(`/api/window?recordId=${encodeURIComponent(step.recordId)}&from=${step.startSec}&to=${step.endSec}`, {
    signal: owner.controller.signal,
  })
    .then((r) => r.json())
    .then((d) => { if (current === owner && Array.isArray(d.segments)) owner.segments = d.segments; })
    .catch((error) => { if (error?.name !== 'AbortError') { /* captions are optional */ } });

  player.ontimeupdate = () => {
    if (current !== owner) return;
    const t = player.currentTime;
    updateCaption(t);
    const frac = (t - step.startSec) / (step.endSec - step.startSec);
    updateProgress(t);
    if (owner.timeline && !owner.rebuilding) {
      /* The schedule, resolved server-side, simply plays out. */
      const rel = t - step.startSec;
      while (owner.fired < owner.timeline.length && owner.timeline[owner.fired].at <= rel) {
        renderEvent(owner.timeline[owner.fired]);
        owner.fired += 1;
        if (current !== owner) return;
      }
    } else if (frac > 0.7) {
      const dir = stageDirections[index];
      for (const mark of dir?.marks || []) {
        if (!mark.drawn) { mark.drawn = true; drawMark(mark); }
      }
    }
    const remaining = step.endSec - t;
    if (remaining <= 0.9 && !owner.fading) { owner.fading = true; fadeTo(0, 800); }
    if (remaining <= 0) stopAudio();
  };
}

// ----------------------------------------------------------------- seeking
// The whole performance is one resolved timeline keyed to clip time, so a
// seek — either direction — is just "rebuild the stage for time t": the
// scene whose window holds t, dressed with everything already due, spent
// transients skipped, and the schedule pointer set to the next future beat.

function seekTo(t) {
  if (!current) return;
  const { step } = current;
  t = Math.max(step.startSec, Math.min(step.endSec - 1, t));
  player.currentTime = t;
  const rel = t - step.startSec;
  current.capKey = null;
  if (!current.timeline) return;
  const scenes = current.scenes;
  let k = 0;
  for (let i = 0; i < scenes.length; i++) if ((scenes[i].at ?? 0) <= rel) k = i;
  const scene = scenes[k];
  const token = current.playToken;
  activateScene(scene, k, { force: true });
  releaseHighlight();
  setTimeout(() => {
    if (!current || current.playToken !== token || current.sceneIdx !== k) return;
    for (const ev of current.timeline) {
      if (ev.scene !== scene || ev.kind === 'scene' || ev.at > rel) continue;
      /* A spent spotlight stays spent. */
      if (ev.kind === 'highlight' && rel > ev.at + 11) continue;
      renderEvent(ev);
    }
  }, 520);
  current.fired = current.timeline.findIndex((ev) => ev.at > rel);
  if (current.fired === -1) current.fired = current.timeline.length;
}

$('#th-back').addEventListener('click', () => current && seekTo(player.currentTime - 15));
$('#th-fwd').addEventListener('click', () => current && seekTo(player.currentTime + 15));
document.addEventListener('keydown', (e) => {
  if (!current || e.target.tagName === 'INPUT') return;
  if (e.key === 'ArrowLeft') seekTo(player.currentTime - 15);
  if (e.key === 'ArrowRight') seekTo(player.currentTime + 15);
});
(() => {
  const bar = document.querySelector('.th-progress');
  const toTime = (e) => {
    const r = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    return current.step.startSec + frac * (current.step.endSec - current.step.startSec);
  };
  let dragging = false;
  bar.addEventListener('pointerdown', (e) => { if (!current) return; dragging = true; bar.setPointerCapture(e.pointerId); });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging || !current) return;
    const frac = Math.max(0, Math.min(1, (e.clientX - bar.getBoundingClientRect().left) / bar.getBoundingClientRect().width));
    bar.querySelector('i').style.width = `${frac * 100}%`;
  });
  bar.addEventListener('pointerup', (e) => {
    if (!dragging || !current) return;
    dragging = false;
    seekTo(toTime(e));
  });
})();

function updateCaption(t) {
  if (!current?.segments?.length) return;
  let seg = null;
  for (const s of current.segments) { if (s.s <= t) seg = s; else break; }
  const silent = !seg || t > seg.e + 1.5;
  const key = silent ? null : seg.s;
  if (key === current.capKey) return;
  current.capKey = key;
  const cap = TH().querySelector('.caption');
  if (silent) { cap.classList.remove('show'); return; }
  cap.textContent = seg.t;
  cap.classList.add('show');
  if (current.timeline) {
    lightBoxWords(seg.t);
    /* The compare box breathes with the tape: when the teacher says one of
       the words that binds the two texts, it pulses once. */
    if (current.compareEl?.isConnected && current.compareWords) {
      const said = new Set(normalize(seg.t).split(' '));
      if ([...current.compareWords].some((w) => said.has(w))) {
        for (const em of current.compareEl.querySelectorAll('em.rel')) {
          em.classList.remove('pulse');
          void em.offsetWidth;
          em.classList.add('pulse');
        }
      }
    }
  } else {
    cueMarks(seg.t);
  }
}

function honestNote(li, text) {
  if (li.querySelector('.honest')) return;
  const p = document.createElement('p');
  p.className = 'step-note honest';
  p.textContent = text;
  li.appendChild(p);
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
  const { li, fadeRaf, hlTimer } = current;
  cancelAnimationFrame(fadeRaf);
  clearTimeout(hlTimer);
  player.pause();
  player.ontimeupdate = null;
  li.classList.remove('playing');
  releaseHighlight();
  const th = TH();
  th.classList.remove('on');
  th.querySelector('.th-whisper').classList.remove('show');
  /* The theater empties when it closes — nothing from one clip may ever
     greet the next. */
  th.querySelector('.verses').classList.remove('has');
  th.querySelector('.verses').innerHTML = '';
  th.querySelector('.caption').classList.remove('show');
  for (const sel of TH_BOXES) th.querySelector(sel).innerHTML = '';
  document.body.classList.remove('in-theater');
  current = null;
}

$('#q').focus();
