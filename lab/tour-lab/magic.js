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
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_MODEL_ROLES,
  buildVisualTimeline,
  directorRequestFingerprint,
  findScriptureOccurrence,
  planLoomGeometry,
  summarizeVisualProjection,
  upgradeReplayFixture,
  validateDirectorPayload,
  validateReplayFixture,
} from './magic-contract.mjs';
import {
  compileEditorialPlan,
  resolveEditorialShot,
  validateEditorialPlan,
} from './magic-editorial.mjs';
import { retireOwnedDirectorEntry } from './magic-jobs.mjs';

const $ = (s) => document.querySelector(s);
const TH = () => $('#theater');
const testParams = new URLSearchParams(window.location.search);
const qaIsEnabled = testParams.get('qa') === '1';
const forcedTheme = testParams.get('theme');
if (forcedTheme === 'light' || forcedTheme === 'dark') document.documentElement.dataset.theme = forcedTheme;
const forcedMotion = testParams.get('motion');
if (forcedMotion === 'reduce') document.documentElement.dataset.motion = 'reduce';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionIsReduced = () => forcedMotion === 'reduce' || reducedMotion.matches;
const motionMs = (ms) => (motionIsReduced() ? 0 : ms);
const nextFrame = (fn) => motionIsReduced() ? fn() : requestAnimationFrame(() => requestAnimationFrame(fn));

const MAX_VISUAL_OBSERVATIONS = 256;
const MAX_REFUSALS_PER_BEAT = 8;
const visualObservations = [];
const editorialObservations = [];
let visualObservationSequence = 0;
let editorialObservationSequence = 0;
let lastVisualOutcomeSnapshot = null;
let lastEditorialSnapshot = null;
/* QA-only: when a capture harness drives the program, playback state opens
   without touching the publisher audio stream, so whole-program QA is
   hermetic — local replay data, zero media or model traffic. Never set by
   any reader gesture; only the __magicQA drive methods below may set it. */
let qaSilentDrive = false;

function copyForQa(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function visualOutcomeSnapshot(owner) {
  if (!owner?.visualOutcomes) return null;
  return {
    playToken: owner.playToken,
    stepId: owner.step?.id || `step-${owner.index + 1}`,
    outcomes: [...owner.visualOutcomes.values()].map((outcome) => copyForQa(outcome)),
  };
}

function editorialSnapshot(owner) {
  if (!owner?.editorialPlan) return null;
  return copyForQa({
    playToken: owner.playToken,
    stepId: owner.step?.id || `step-${owner.index + 1}`,
    activeShot: owner.activeEditorialShot || null,
    metrics: owner.editorialPlan.metrics,
    shots: owner.editorialPlan.shots,
  });
}

function appendEditorialObservation(owner, shot, phase, detail = {}) {
  if (!owner || !shot?.id) return;
  const atSec = Number.isFinite(Number(owner.visualRel))
    ? Math.round(Number(owner.visualRel) * 1000) / 1000
    : Number(shot.fromSec) || 0;
  editorialObservations.push({
    sequence: ++editorialObservationSequence,
    playToken: owner.playToken,
    stepId: owner.step?.id || `step-${owner.index + 1}`,
    shotId: shot.id,
    role: shot.role,
    family: shot.family,
    component: shot.component,
    phase,
    editorialPhase: shot.phase,
    variant: shot.variant,
    sourceBeatIds: [...(shot.sourceBeatIds || [])],
    sourceSceneIds: [...(shot.sourceSceneIds || [])],
    atSec,
    ...detail,
  });
  if (editorialObservations.length > MAX_VISUAL_OBSERVATIONS * 2) editorialObservations.shift();
}

function appendVisualObservation(owner, beat, phase, detail = {}) {
  if (!owner || !beat?.beatId) return;
  const outcome = owner.visualOutcomes?.get(beat.beatId);
  if (!outcome) return;
  const atSec = Number.isFinite(Number(owner.visualRel))
    ? Math.round(Number(owner.visualRel) * 1000) / 1000
    : Number(beat.at) || 0;
  if (phase === 'mounted') {
    outcome.actual.mounts += 1;
    outcome.actual.lastMountedAtSec = atSec;
  } else if (phase === 'revealed') {
    outcome.actual.reveals += 1;
    outcome.actual.lastRevealedAtSec = atSec;
  } else if (phase === 'refused') {
    outcome.actual.refusals.push({ atSec, reason: detail.reason || 'render-refused' });
    if (outcome.actual.refusals.length > MAX_REFUSALS_PER_BEAT) outcome.actual.refusals.shift();
  }
  visualObservations.push({
    sequence: ++visualObservationSequence,
    playToken: owner.playToken,
    stepId: owner.step?.id || `step-${owner.index + 1}`,
    beatId: beat.beatId,
    kind: beat.kind,
    phase,
    atSec,
    ...detail,
  });
  if (visualObservations.length > MAX_VISUAL_OBSERVATIONS) visualObservations.shift();
}

function initializeVisualOutcomes(owner, direction, projection) {
  const masked = new Map((projection?.focusMasked || []).map((entry) => [entry.beatId, entry]));
  const superseded = new Map((projection?.superseded || []).map((entry) => [entry.beatId, entry]));
  const projectedVisible = new Set((projection?.projectedVisible || []).map((entry) => entry.beatId));
  owner.visualOutcomes = new Map((direction.beats || []).map((beat) => {
    const mask = masked.get(beat.id) || null;
    const replacement = superseded.get(beat.id) || null;
    return [beat.id, {
      beatId: beat.id,
      proposalId: beat.proposalId || null,
      kind: beat.kind,
      sceneId: beat.sceneId,
      at: beat.at,
      projection: {
        visible: projectedVisible.has(beat.id),
        focusMasked: Boolean(mask),
        maskedByBeatId: mask?.byBeatId || null,
        superseded: Boolean(replacement),
        supersededByBeatId: replacement?.byBeatId || null,
        reason: mask?.reason || replacement?.reason || null,
      },
      actual: {
        mounts: 0,
        reveals: 0,
        refusals: [],
        lastMountedAtSec: null,
        lastRevealedAtSec: null,
      },
    }];
  }));
}

if (qaIsEnabled) {
  window.__magicQA = Object.freeze({
    getVisualOutcomes() {
      return copyForQa({
        current: visualOutcomeSnapshot(current),
        last: lastVisualOutcomeSnapshot,
        observations: visualObservations,
      });
    },
    getEditorialState() {
      return copyForQa({
        current: editorialSnapshot(current),
        last: lastEditorialSnapshot,
        observations: editorialObservations,
      });
    },
    /* Whole-program drive for the maintained capture/parity command. The
       compiled shot list is deterministic, so the harness can walk every
       shot boundary of every step and reconcile the shot the stage actually
       resolves against the plan — the same media-time projection a reader's
       own seek would produce. */
    program() {
      const tour = activeRun?.tour;
      if (!tour) return null;
      return copyForQa({
        title: tour.title,
        mode: activeRun?.mode || null,
        steps: tour.steps.map((step, index) => {
          const entry = directorEntry(step);
          const direction = entry?.status === 'resolved' ? entry.value : null;
          const plan = direction
            ? compileEditorialPlan(direction, {
              durationSec: Number(step.endSec) - Number(step.startSec),
              stepIndex: index,
              stepCount: tour.steps.length,
            })
            : null;
          return {
            index,
            id: step.id,
            title: step.episodeTitle,
            source: step.source || step.sourceId,
            startSec: step.startSec,
            endSec: step.endSec,
            directed: Boolean(direction),
            shots: plan?.shots || null,
          };
        }),
      });
    },
    openStepSilent(index) {
      const tour = activeRun?.tour;
      const step = tour?.steps?.[index];
      const li = document.querySelectorAll('#steps .step')[index];
      if (!step || !li) return false;
      qaSilentDrive = true;
      toggleStep(li, step, index);
      return current?.step === step && Boolean(current?.editorialPlan);
    },
    seekSilent(atMediaSec) {
      if (!current) return false;
      seekTo(Number(atMediaSec));
      return true;
    },
    closeStepSilent() {
      stopAudio({ restoreFocus: false });
      return true;
    },
  });
}

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
  setTimeout(() => { if (!activeRun) $('#q').focus(); }, motionMs(520));
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
  if (current) stopAudio({ restoreFocus: false });
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

function returnToAsk(run, delay) {
  runDelay(run, () => {
    showScene('ask');
    runDelay(run, () => $('#q').focus({ preventScroll: false }), motionMs(520));
  }, delay);
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
    returnToAsk(run, 2600);
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
    returnToAsk(run, 2600);
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
  run.tour = tour;
  delete $('#tour').dataset.form;
  document.querySelector('.lexicon')?.remove();
  stageDirections = {};
  const tourTitle = $('#tour-title');
  tourTitle.textContent = tour.title;
  tourTitle.tabIndex = -1;
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
  runDelay(run, () => {
    if (!current && $('#tour').classList.contains('on')) tourTitle.focus({ preventScroll: false });
  }, motionMs(520));
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
        b.addEventListener('click', () => items[r.steps[0]]?.scrollIntoView({ behavior: motionIsReduced() ? 'auto' : 'smooth', block: 'center' }));
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

function requireValidDirection(payload, expectedFingerprint = null) {
  const check = validateDirectorPayload(payload);
  if (!check.ok) throw new Error(`director payload refused: ${check.errors.join('; ')}`);
  if (expectedFingerprint != null && payload.requestFingerprint !== expectedFingerprint) {
    throw new Error('director payload refused: response belongs to a different tour step');
  }
  return payload;
}

function keyForStep(step) {
  return directorRequestFingerprint({
    modelKey: MAGIC_MODEL_ROLES.director,
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
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
  const value = requireValidDirection(payload, key);
  const entry = { key, index, status: 'resolved', value, promise: Promise.resolve(value) };
  directorCache.set(key, entry);
  return entry;
}

function cacheDirectionFallback(step, index, note) {
  const key = keyForStep(step);
  const entry = { key, index, status: 'resolved', value: null, note, promise: Promise.resolve(null) };
  directorCache.set(key, entry);
  return entry;
}

function surfaceDirectionNote(li, entry) {
  const payloadNote = typeof entry?.value?.note === 'string' ? entry.value.note.trim() : '';
  const fallbackNote = typeof entry?.note === 'string' ? entry.note.trim() : '';
  const note = payloadNote || fallbackNote;
  if (!note) return;
  honestNote(li, `${payloadNote ? 'Visual direction was partial.' : 'Visual direction was unavailable.'} ${note}`);
}

function seedReplayDirections(tour, fixture) {
  tour.steps.forEach((step, index) => {
    cacheResolvedDirection(step, index, fixture.directions[step.id]);
  });
}

function fetchDirector(step, index, run = activeRun) {
  if (!run || !runIsActive(run)) return Promise.reject(new DOMException('stale tour', 'AbortError'));
  const key = keyForStep(step);
  const existing = directorCache.get(key);
  if (existing) return existing.promise;

  if (run.mode === 'replay') {
    return cacheDirectionFallback(step, index, 'Replay direction missing; no model request was made.').promise;
  }

  const entry = { key, index, status: 'pending', value: null, promise: null };
  entry.promise = fetch('/api/direct', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
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
      const value = requireValidDirection(data, key);
      entry.status = 'resolved';
      entry.value = value;
      return value;
    })
    .catch((error) => {
      if (error?.name === 'AbortError') {
        // An older run can settle after a newer tour has already populated the
        // same logical key. Only retire the entry this promise actually owns;
        // otherwise the stale abort reopens the paid-call dedupe window.
        retireOwnedDirectorEntry(directorCache, key, entry);
        throw error;
      }
      entry.status = 'resolved';
      entry.value = null;
      entry.note = error?.message || String(error);
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
  if (!payload) return;
  let direction;
  let timeline;
  let projection;
  let editorialPlan;
  try {
    direction = requireValidDirection(payload);
    timeline = buildVisualTimeline({ scenes: direction.scenes, beats: direction.beats }, direction.clip.durationSec);
    projection = summarizeVisualProjection(
      { scenes: direction.scenes, beats: direction.beats },
      direction.clip.durationSec,
    );
    editorialPlan = compileEditorialPlan(direction, {
      durationSec: direction.clip.durationSec,
      stepIndex: index,
      stepCount: current.run?.tour?.steps?.length || 1,
    });
    const editorialCheck = validateEditorialPlan(editorialPlan, direction);
    if (!editorialCheck.ok) {
      throw new Error(`editorial plan refused: ${editorialCheck.errors.join('; ')}`);
    }
  } catch (error) {
    honestNote(li, error.message);
    return;
  }
  current.direction = direction;
  current.scenes = timeline.scenes;
  current.timeline = timeline;
  current.editorialPlan = editorialPlan;
  current.beatById = new Map(direction.beats.map((beat) => [beat.id, beat]));
  current.sceneById = new Map(timeline.scenes.map((scene) => [scene.id, scene]));
  current.eventByBeatId = new Map(timeline
    .filter((event) => event.beatId && event.kind !== 'word')
    .map((event) => [event.beatId, event]));
  current.activeVisualEvent = null;
  current.refusedVisualEvent = null;
  current.activeEditorialShot = null;
  current.refusedEditorialShotId = null;
  current.fired = 0;
  current.sceneIdx = -1;
  initializeVisualOutcomes(current, direction, projection);
  exposeEditorialMetrics(current);
  rebuildStageAt(player.currentTime, { reason: 'direction' });
}

const stageIsNarrow = () => window.innerWidth <= 620;

const editorialFrame = () => TH()?.querySelector('.shot-frame');

function exposeEditorialMetrics(owner) {
  const theater = TH();
  const metrics = owner?.editorialPlan?.metrics;
  if (!theater || !metrics) return;
  theater.dataset.editorialPolicy = owner.editorialPlan.policyVersion;
  theater.dataset.editorialShotCount = String(metrics.shotCount);
  theater.dataset.editorialSemanticOccupancy = String(metrics.semanticOccupancy);
  theater.dataset.editorialMaxRestSec = String(metrics.maxExplicitRestSec);
  theater.dataset.editorialMaxFamilyRun = String(metrics.maxSameFamilyRun);
  theater.dataset.editorialSceneCoverage = String(metrics.sceneCoverage);
}

function clearEditorialTrace() {
  const frame = editorialFrame();
  if (!frame) return;
  for (const key of [
    'shotId', 'shotRole', 'shotFamily', 'shotComponent', 'shotPhase',
    'shotVariant', 'shotTransition', 'sourceBeatIds', 'sourceSceneIds',
    'sourceSegmentIds',
  ]) delete frame.dataset[key];
}

function applyEditorialTrace(shot, element = null) {
  const frame = editorialFrame();
  if (!frame || !shot) return;
  const values = {
    shotId: shot.id,
    shotRole: shot.role,
    shotFamily: shot.family,
    shotComponent: shot.component,
    shotPhase: shot.phase,
    shotVariant: shot.variant,
    shotTransition: shot.transition,
    sourceBeatIds: (shot.sourceBeatIds || []).join(','),
    sourceSceneIds: (shot.sourceSceneIds || []).join(','),
  };
  for (const [key, value] of Object.entries(values)) frame.dataset[key] = String(value ?? '');
  const segmentId = current?.captionSegmentId || frame.dataset.sourceSegmentIds || '';
  frame.dataset.sourceSegmentIds = segmentId;
  if (element) {
    for (const [key, value] of Object.entries(values)) element.dataset[key] = String(value ?? '');
    element.dataset.sourceSegmentIds = segmentId;
  }
}

function currentEditorialCopy() {
  const owner = current;
  const tour = owner?.run?.tour || {};
  const step = owner?.step || {};
  const nextStep = tour.steps?.[owner ? owner.index + 1 : 1] || null;
  return {
    tourTitle: String(tour.title || ''),
    tourClosing: String(tour.closing || ''),
    source: String(step.source || step.sourceId || ''),
    episodeTitle: String(step.episodeTitle || ''),
    nextEpisodeTitle: String(nextStep?.episodeTitle || ''),
    movementTitle: String(owner?.li?.querySelector('.step-marker')?.textContent || ''),
    movementIndex: owner ? owner.index + 1 : 1,
    movementCount: tour.steps?.length || 1,
    totalMinutes: Math.max(1, Math.round(Number(tour.totalSeconds) / 60) || 1),
  };
}

function firstCompleteSentence(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const match = text.match(/^.*?[.!?](?=\s|$)/u);
  return match?.[0] || text;
}

function bookendTitleMarkup(value) {
  const text = String(value || '').trim();
  const reference = text.match(/^(.+?\s+\d+:\d+(?:\s*[–—-]\s*\d+)?)(.*)$/u);
  if (!reference) return escapeHtml(text);
  return `<span class="bookend-title-ref">${escapeHtml(reference[1])}</span>${escapeHtml(reference[2])}`;
}

function bookendComposition(shot) {
  const copy = currentEditorialCopy();
  const element = compositionElement('bookend');
  element.dataset.bookendRole = shot.role;
  if (shot.role === 'opening') {
    const movements = `${copy.movementCount} movement${copy.movementCount === 1 ? '' : 's'}`;
    element.innerHTML = `<span class="bookend-position">A listening path · ${movements} · ${copy.totalMinutes} minutes</span>
      <h2 class="bookend-title">${bookendTitleMarkup(copy.tourTitle || copy.movementTitle || copy.episodeTitle)}</h2>
      <p class="bookend-reference">Begins with · ${escapeHtml(copy.episodeTitle)}</p>`;
  } else if (shot.role === 'transition') {
    element.innerHTML = `<span class="bookend-position">Movement ${copy.movementIndex} of ${copy.movementCount}</span>
      <h2 class="bookend-title">${bookendTitleMarkup(copy.movementTitle || copy.episodeTitle)}</h2>
      ${copy.movementTitle && copy.episodeTitle ? `<p class="bookend-reference">${escapeHtml(copy.episodeTitle)}</p>` : ''}`;
  } else if (shot.role === 'movement-close') {
    element.innerHTML = `<span class="bookend-position">Movement ${copy.movementIndex} complete</span>
      <h2 class="bookend-title">${bookendTitleMarkup(copy.episodeTitle || copy.movementTitle)}</h2>
      <span class="bookend-endpoint" aria-hidden="true"></span>
      ${copy.nextEpisodeTitle ? `<div class="bookend-next"><span>Next · movement ${copy.movementIndex + 1}</span><p>${escapeHtml(copy.nextEpisodeTitle)}</p></div>` : ''}`;
  } else {
    const coda = firstCompleteSentence(copy.tourClosing);
    const movements = `${copy.movementCount} movement${copy.movementCount === 1 ? '' : 's'}`;
    element.innerHTML = `<span class="bookend-position">Tour complete</span>
      <h2 class="bookend-title">${bookendTitleMarkup(copy.tourTitle || copy.movementTitle || copy.episodeTitle)}</h2>
      ${coda ? `<p class="bookend-coda">${escapeHtml(coda)}</p>` : ''}
      <p class="bookend-tour">${copy.totalMinutes} minutes · ${movements}</p>`;
  }
  return element;
}

function listeningComposition(shot) {
  const copy = currentEditorialCopy();
  const element = compositionElement('listening');
  const arrival = shot.role === 'scene-arrival';
  const scene = current?.sceneById?.get(shot.sceneId);
  element.dataset.listeningRole = shot.role;
  element.dataset.listeningVariant = shot.variant;
  element.innerHTML = arrival
    ? `<div class="listening-meta">${kicker(scene?.ref ? 'Passage arriving' : `Movement ${copy.movementIndex}`)}
      ${scene?.ref ? `<p class="listening-reference">${escapeHtml(scene.ref)}</p>` : ''}</div>
      <blockquote class="listening-line">${escapeHtml(current?.captionText || '')}</blockquote>`
    : `<div class="listening-meta">${kicker(shot.variant === 'listening-punctuation' ? 'A turn in the thought' : 'Listening')}</div>
      <blockquote class="listening-line">${escapeHtml(current?.captionText || '')}</blockquote>`;
  return element;
}

function retireWhisper() {
  if (!current) return;
  TH().querySelector('.th-whisper')?.classList.remove('show');
  clearTimeout(current.whisperTimer);
  current.timers.delete(current.whisperTimer);
  current.whisperTimer = null;
}

function clearVerseAnnotations() {
  const verses = TH()?.querySelector('.verses');
  if (!verses) return;
  verses.querySelector('svg.smarks')?.remove();
  for (const mark of verses.querySelectorAll('.fnmark')) mark.remove();
  for (const span of [...verses.querySelectorAll('.sword')]) span.replaceWith(...span.childNodes);
  verses.normalize();
}

function clearStageComposition({ immediate = false } = {}) {
  const th = TH();
  if (!th) return;
  const owner = current;
  const host = th.querySelector('.thought-current');
  const outgoing = th.querySelector('.thought-outgoing');
  if (!host || !outgoing) return;
  for (const timer of owner?.compositionTimers || []) {
    clearTimeout(timer);
    owner.timers.delete(timer);
  }
  owner?.compositionTimers?.clear();
  outgoing.replaceChildren();
  const departing = host.firstElementChild;
  if (departing && !immediate && !motionIsReduced() && owner) {
    outgoing.appendChild(departing);
    departing.classList.remove('is-entering');
    departing.classList.add('is-leaving');
    const timer = playDelay(owner, () => {
      owner.compositionTimers.delete(timer);
      if (outgoing.contains(departing)) departing.remove();
    }, 320);
    if (timer) owner.compositionTimers.add(timer);
  } else {
    host.replaceChildren();
  }
  clearVerseAnnotations();
  th.querySelector('.th-body')?.classList.remove('spot');
  th.classList.remove('focus-mode');
  th.querySelector('.th-body')?.removeAttribute('data-active-kind');
}

function clearAllVisualChannels({ immediate = true } = {}) {
  clearStageComposition({ immediate });
  if (current) {
    current.activeVisualEvent = null;
    current.refusedVisualEvent = null;
    current.activeEditorialShot = null;
    current.refusedEditorialShotId = null;
  }
}

function mountComposition(element, event, { immediate = false } = {}) {
  const owner = current;
  if (!owner || !element) return { mounted: false, reason: 'composition-unavailable' };
  const th = TH();
  const host = th.querySelector('.thought-current');
  if (!host) return { mounted: false, reason: 'thought-slot-missing' };
  element.classList.add('th-composition');
  element.dataset.visualKind = event.kind;
  if (event.beatId) element.dataset.beatId = event.beatId;
  const shot = event.editorialShot || null;
  if (shot) {
    applyEditorialTrace(shot, element);
    element.classList.add(`shot-family--${shot.family}`, `shot-component--${shot.component}`);
    element.classList.add(`shot-phase--${shot.phase}`, `shot-transition--${shot.transition}`);
  }
  if (!immediate && !motionIsReduced()) element.classList.add('is-entering');
  host.replaceChildren(element);
  appendVisualObservation(owner, event, 'mounted');
  if (shot) appendEditorialObservation(owner, shot, 'mounted');
  th.querySelector('.th-body')?.setAttribute('data-active-kind', event.kind);
  if (event.kind === 'highlight' || shot?.family === 'focus') {
    th.querySelector('.th-body')?.classList.add('spot');
    th.classList.add('focus-mode');
  }
  const reveal = () => {
    if (current !== owner || !element.isConnected || host.firstElementChild !== element) return;
    element.classList.remove('is-entering');
    appendVisualObservation(owner, event, 'revealed');
    if (shot) appendEditorialObservation(owner, shot, 'revealed');
  };
  if (element.classList.contains('is-entering')) playNextFrame(owner, reveal);
  else reveal();
  // Editorial shots are composed to the frame. Automatic scrolling would be
  // an unplanned camera move, so retain it only for the legacy fallback.
  if (!owner.editorialPlan) keepVisualInFrame(element, { immediate });
  return { mounted: true, element };
}

function semanticEventForShot(owner, shot) {
  const beatId = shot?.sourceBeatIds?.[0];
  if (!beatId || shot.sourceBeatIds.length !== 1) return null;
  const event = owner.eventByBeatId?.get(beatId);
  const beat = owner.beatById?.get(beatId);
  if (!event || !beat) return null;
  return {
    ...event,
    beat,
    a: beat.data,
    scene: owner.sceneById?.get(shot.sceneId) || event.scene,
    editorialShot: shot,
    editorialPhase: shot.phase,
    editorialVariant: shot.variant,
  };
}

function renderHouseShot(shot, { reconstruct = false } = {}) {
  const owner = current;
  if (!owner) return { mounted: false, reason: 'playback-unavailable' };
  if (shot.sceneId && owner.mountedScene?.id !== shot.sceneId) {
    return { mounted: false, reason: 'scene-not-mounted', pending: true };
  }
  applyEditorialTrace(shot);
  const body = TH().querySelector('.th-body');
  body?.setAttribute('data-active-kind', shot.component);
  if (shot.component === 'PassageFrame') {
    appendEditorialObservation(owner, shot, 'mounted');
    appendEditorialObservation(owner, shot, 'revealed');
    return { mounted: true, passive: true };
  }
  if (shot.component === 'BookendSlate') {
    return mountComposition(bookendComposition(shot), {
      kind: 'bookend', editorialShot: shot,
    }, { immediate: reconstruct });
  }
  if (shot.component === 'ListeningFrame') {
    return mountComposition(listeningComposition(shot), {
      kind: 'listening', editorialShot: shot,
    }, { immediate: reconstruct });
  }
  return { mounted: false, reason: 'unsupported-house-shot' };
}

function syncGroundedWordCues(owner, shot, rel) {
  const verses = TH().querySelector('.verses');
  for (const span of verses.querySelectorAll('.sword.lit')) span.classList.remove('lit');
  if (!shot || shot.family === 'focus') return;

  if (shot.semanticKind === 'group') {
    if (shot.phase === 'anchors') {
      const beat = owner.beatById?.get(shot.sourceBeatIds?.[0]);
      for (const [index, word] of (beat?.data?.words || []).entries()) {
        getOrWrap(verses, word, beat.data.occurrences?.[index] || 0)?.classList.add('lit');
      }
    }
    return;
  }

  for (const event of owner.timeline || []) {
    const exitAt = Number(event?.[stageIsNarrow() ? 'exitAtNarrow' : 'exitAtWide']);
    if (event?.kind !== 'word' || Number(event.at) > rel || !Number.isFinite(exitAt) || rel >= exitAt) continue;
    getOrWrap(verses, event.word, event.occurrence)?.classList.add('lit');
  }
}

function syncVisualLifecycles(rel, { immediate = false } = {}) {
  if (!current?.timeline || !current.editorialPlan) return;
  const owner = current;
  owner.visualRel = rel;
  const desired = resolveEditorialShot(owner.editorialPlan, rel);
  if (!desired) return;
  if (desired.sceneId && owner.mountedScene?.id !== desired.sceneId) return;
  if (owner.refusedEditorialShotId && desired.id !== owner.refusedEditorialShotId) {
    owner.refusedEditorialShotId = null;
  }
  if (desired.id !== owner.activeEditorialShot?.id && desired.id !== owner.refusedEditorialShotId) {
    const focusBoundary = desired.family === 'focus' || owner.activeEditorialShot?.family === 'focus';
    const componentBoundary = Boolean(owner.activeEditorialShot?.component
      && owner.activeEditorialShot.component !== desired.component);
    const cutBoundary = desired.transition === 'cut';
    if ((desired.component === 'BookendSlate' || desired.component === 'ListeningFrame')
      && (componentBoundary || cutBoundary)) TH().scrollTop = 0;
    clearStageComposition({ immediate: immediate || focusBoundary || componentBoundary || cutBoundary });
    applyEditorialTrace(desired);
    owner.activeEditorialShot = null;
    owner.activeVisualEvent = null;
    let event = null;
    let result;
    try {
      if (desired.role === 'semantic') {
        event = semanticEventForShot(owner, desired);
        result = event
          ? renderEventNow(event, { reconstruct: immediate })
          : { mounted: false, reason: 'semantic-source-unavailable' };
      } else {
        result = renderHouseShot(desired, { reconstruct: immediate });
      }
    } catch {
      result = { mounted: false, reason: 'render-error' };
    }
    if (result?.mounted) {
      owner.activeEditorialShot = desired;
      owner.activeVisualEvent = event;
      owner.refusedVisualEvent = null;
    } else if (!result?.pending) {
      owner.refusedEditorialShotId = desired.id;
      owner.refusedVisualEvent = event;
      if (event) appendVisualObservation(owner, event, 'refused', {
        reason: result?.reason || 'render-refused',
      });
      appendEditorialObservation(owner, desired, 'refused', {
        reason: result?.reason || 'render-refused',
      });
    }
  }
  syncGroundedWordCues(owner, desired, rel);
}

function playDelay(owner, fn, ms) {
  if (!owner || current !== owner || owner.controller.signal.aborted) return null;
  const timer = setTimeout(() => {
    owner.timers.delete(timer);
    if (current === owner && !owner.controller.signal.aborted) fn();
  }, ms);
  owner.timers.add(timer);
  return timer;
}

function cancelPlayFrame(owner, ticket) {
  if (!owner || !ticket) return;
  if (ticket.outer != null) cancelAnimationFrame(ticket.outer);
  if (ticket.inner != null) cancelAnimationFrame(ticket.inner);
  owner.frameTickets.delete(ticket);
}

function cancelAllPlayFrames(owner) {
  if (!owner) return;
  for (const ticket of [...owner.frameTickets]) cancelPlayFrame(owner, ticket);
}

/* Two-frame reveals are scoped to the exact playback, scene, and seek that
   scheduled them. A stale spotlight can therefore never reappear after a
   scene turn, seek reconstruction, or theater close. */
function playNextFrame(owner, fn) {
  if (!owner || current !== owner || owner.controller.signal.aborted) return null;
  const scope = {
    playToken: owner.playToken,
    sceneGeneration: owner.sceneGeneration,
    seekGeneration: owner.seekGeneration,
  };
  const valid = () => current === owner
    && !owner.controller.signal.aborted
    && owner.playToken === scope.playToken
    && owner.sceneGeneration === scope.sceneGeneration
    && owner.seekGeneration === scope.seekGeneration;
  if (motionIsReduced()) {
    if (valid()) fn();
    return null;
  }
  const ticket = { outer: null, inner: null };
  owner.frameTickets.add(ticket);
  const finish = () => {
    owner.frameTickets.delete(ticket);
    if (valid()) fn();
  };
  ticket.outer = requestAnimationFrame(() => {
    ticket.outer = null;
    if (!valid()) {
      cancelPlayFrame(owner, ticket);
      return;
    }
    ticket.inner = requestAnimationFrame(() => {
      ticket.inner = null;
      finish();
    });
  });
  return ticket;
}

function keepVisualInFrame(element, { immediate = false } = {}) {
  const owner = current;
  if (!owner || !element) return;
  const reveal = () => {
    if (current !== owner || !element.isConnected) return;
    const theater = TH();
    const rect = element.getBoundingClientRect();
    const topGuard = window.innerWidth <= 620 ? 112 : 96;
    const railRects = [theater.querySelector('.caption'), theater.querySelector('.th-controls')]
      .map((rail) => rail?.getBoundingClientRect())
      .filter((rail) => rail && rail.height > 0);
    const railTop = railRects.length ? Math.min(...railRects.map((rail) => rail.top)) : window.innerHeight;
    const bottomGuard = railTop - 16;
    if (rect.top >= topGuard && rect.bottom <= bottomGuard) return;
    const top = rect.bottom > bottomGuard
      ? theater.scrollTop + (rect.bottom - bottomGuard) + 16
      : theater.scrollTop - (topGuard - rect.top) - 16;
    theater.scrollTo({ top, behavior: immediate || motionIsReduced() ? 'auto' : 'smooth' });
  };
  if (immediate || motionIsReduced()) reveal();
  else playNextFrame(owner, reveal);
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
  playDelay(owner, () => {
    if (owner.sceneGeneration !== generation || owner.scenes?.[owner.sceneIdx] !== scene) return;
    clearAllVisualChannels({ immediate: true });
    th.scrollTop = 0;
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
    syncVisualLifecycles(owner.visualRel, { immediate });
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
  syncVisualLifecycles(player.currentTime - current.step.startSec);
}

function compositionElement(kind, tag = 'article') {
  const element = document.createElement(tag);
  element.className = `th-composition--${kind}`;
  return element;
}

function kicker(text) {
  return `<span class="thought-kicker">${escapeHtml(text)}</span>`;
}

function completeEditorialDisplay(value) {
  // The director contract already accepts compact semantic copy whole or
  // refuses it. The renderer may normalize whitespace, but never edits the
  // end of a stored gloss, note, caveat, or margin sentence.
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/* Machine transcripts carry spoken disfluencies that should never become
   display type. This is presentation hygiene on house-owned transcript copy
   only — the stored segment and every cue verified against it stay raw. */
function transcriptDisplay(value) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/\b(um|uh|er|ah|mm-hm|mm),?\s+/giu, '');
  text = text.replace(/\b([A-Za-z']+),?\s+\1\b/giu, '$1');
  text = text.replace(/\s+([,.!?;:])/gu, '$1');
  text = text.replace(/,\s*,+/gu, ' ').replace(/\s{2,}/gu, ' ').trim();
  return text ? `${text[0].toLocaleUpperCase()}${text.slice(1)}` : '';
}

/* The caption is the program's subtitle track: the sentence the teacher is
   speaking, shown whole. Segments carry no intra-segment clock, so the
   current sentence is estimated by interpolating the playback position
   across the segment's character span — deterministic, monotonic, and it
   always returns a complete sentence rather than a sliced fragment. */
function captionSentenceFor(seg, t) {
  const text = transcriptDisplay(seg?.t);
  if (!text) return '';
  const boundaries = [...text.matchAll(/[.!?…]+["'”’)]*\s+/gu)].map((match) => match.index + match[0].length);
  if (!boundaries.length) return text;
  const spans = [];
  let start = 0;
  for (const boundary of boundaries) {
    if (boundary < text.length) spans.push([start, boundary]);
    start = boundary;
  }
  if (start < text.length) spans.push([start, text.length]);
  if (spans.length <= 1) return text;
  const proportion = Math.min(0.9999, Math.max(0, (Number(t) - seg.s) / Math.max(0.1, seg.e - seg.s)));
  const target = proportion * text.length;
  const [from, to] = spans.find(([spanStart, spanEnd]) => target >= spanStart && target < spanEnd) || spans.at(-1);
  return text.slice(from, to).trim();
}

function groupTitle(mark, sourceSpan = '') {
  // Policy-2/3 used a destructive 18-character slice. Exact-cap labels in
  // saved evidence may therefore end mid-word and are deliberately hidden.
  // SourceSpan remains available as provenance, never as repeated display.
  const label = String(mark.label || '').replace(/\s+/g, ' ').trim();
  if (label && label.length !== 18 && label.length <= 36) return label;
  return '';
}

function loomComposition(mark, anchoredWords, sourceSpan) {
  const element = compositionElement('loom');
  const title = groupTitle({ ...mark, words: anchoredWords }, sourceSpan);
  const count = Math.max(2, Math.min(4, anchoredWords.length));
  const countWord = ['', '', 'Two', 'Three', 'Four'][count] || String(count);
  element.dataset.loomAnchors = JSON.stringify(anchoredWords);
  element.dataset.sourceSpan = sourceSpan;
  const nodes = anchoredWords.map(() => '<i></i>').join('');
  element.innerHTML = `<div class="loom-caption">${kicker('Textual pattern')}<span class="loom-count">${count} anchors</span></div>
    <div class="loom-readout"><span class="loom-thread-map" style="--loom-count:${count}" aria-hidden="true">${nodes}</span>
    <p class="loom-title${title ? '' : ' loom-title--fallback'}">${escapeHtml(title || `${countWord}-part wording`)}</p></div>`;
  return element;
}

function displayQuote(value) {
  const text = String(value || '').trim();
  const balanced = (text.startsWith('“') && text.endsWith('”'))
    || (text.startsWith('"') && text.endsWith('"'))
    || (text.startsWith('‘') && text.endsWith('’'));
  return balanced ? text : `“${text}”`;
}

/* Compare and chain passages are already bounded at admission to one to
   three canonical verses. The display chooses the complete span that carries
   the claim — a whole sentence, or one whole semicolon/em-dash clause of an
   exceptionally long sentence — scored by the words the composition is about
   to mark. It never appends an ellipsis: a quoted excerpt is a complete
   thought on screen or it is not quoted at all. */
function editorialClause(value, anchorWords = []) {
  let text = String(value || '').replace(/\s+/g, ' ').trim();
  const curlyOpen = text.indexOf('“');
  const straightOpen = text.indexOf('"');
  const open = [curlyOpen, straightOpen].filter((index) => index >= 0).sort((a, b) => a - b)[0];
  if (open != null) {
    const closing = text[open] === '“' ? '”' : '"';
    text = text.slice(open + 1);
    const close = text.indexOf(closing);
    if (close >= 0) text = text.slice(0, close);
  }
  const anchors = anchorWords.map((word) => normalize(word)).filter(Boolean);
  const score = (part) => {
    if (!anchors.length) return 0;
    const lex = ` ${normalize(part)} `;
    return anchors.reduce((hits, anchor) => hits + (anchor && lex.includes(` ${anchor} `) ? 1 : 0), 0);
  };
  // Equal scores prefer the later span, preserving the claim-bearing final
  // clause bias the excerpt has always had.
  const pick = (spans) => {
    let best = spans[0] || '';
    let bestScore = score(best);
    for (const span of spans.slice(1)) {
      const spanScore = score(span);
      if (spanScore >= bestScore) { best = span; bestScore = spanScore; }
    }
    return best;
  };
  const sentences = text.split(/(?<=[.!?])\s+/u).map((part) => part.trim()).filter(Boolean);
  let chosen = sentences.length > 1 ? pick(sentences) : (sentences[0] || text);
  if (chosen.split(/\s+/u).filter(Boolean).length > 44) {
    const clauses = chosen.split(/(?<=[;:])\s+|\s+[—–]\s+/u).map((part) => part.trim()).filter(Boolean);
    if (clauses.length > 1) chosen = pick(clauses);
  }
  return displayQuote(chosen.replace(/^[“”"']+|[“”"']+$/gu, '').trim());
}

function sentenceDisplay(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const sentence = `${text[0].toLocaleUpperCase()}${text.slice(1)}`;
  return /[.!?…]$/u.test(sentence) ? sentence : `${sentence}.`;
}

function referenceParts(value) {
  const match = String(value || '').trim().match(/^(.+?)\s+(\d+):(\d+)(?:\s*[–—-]\s*(\d+))?$/u);
  if (!match) return null;
  return {
    book: normalize(match[1]),
    chapter: Number(match[2]),
    from: Number(match[3]),
    to: Number(match[4] || match[3]),
  };
}

function referenceIsOnStage(reference, sceneReference) {
  const candidate = referenceParts(reference);
  const stage = referenceParts(sceneReference);
  return Boolean(candidate && stage
    && candidate.book === stage.book
    && candidate.chapter === stage.chapter
    && candidate.from >= stage.from
    && candidate.to <= stage.to);
}

function termAnchorFor(root, gloss) {
  const text = scriptureTextMap(root).text;
  const phrase = String(gloss || '').trim();
  if (!phrase || !findScriptureOccurrence(text, phrase, 0) || findScriptureOccurrence(text, phrase, 1)) return null;
  return getOrWrap(root, phrase, 0);
}

function renderEventNow(ev, { reconstruct = false } = {}) {
  if (!current) return { mounted: false, reason: 'playback-unavailable' };
  if (current.mountedScene !== ev.scene) return { mounted: false, reason: 'scene-not-mounted' };
  const th = TH();
  const verses = th.querySelector('.verses');
  const phase = ev.editorialPhase || 'full';
  if (ev.kind !== 'word') retireWhisper();
  switch (ev.kind) {
    case 'word':
      getOrWrap(verses, ev.word, ev.occurrence)?.classList.add('lit');
      return { mounted: false, reason: 'word-cue-only' };
    case 'group': {
      if (phase === 'anchors') {
        const anchors = ev.a.words.map((word, index) => (
          getOrWrap(verses, word, ev.a.occurrences?.[index] || 0)
        ));
        if (anchors.some((anchor) => !anchor)) return { mounted: false, reason: 'scripture-anchor-missing' };
        anchors.forEach((anchor) => anchor.classList.add('lit', 'group-target'));
        const element = loomComposition(ev.a, anchors.map((anchor) => anchor.textContent), '');
        element.classList.add('is-anchor-phase');
        return mountComposition(element, ev, { immediate: reconstruct });
      }
      const loom = drawMark(ev.a, { immediate: reconstruct });
      if (loom?.refused) return { mounted: false, reason: loom.refused };
      return mountComposition(
        loomComposition(ev.a, loom.words, loom.sourceSpan),
        ev,
        { immediate: reconstruct },
      );
    }
    case 'term': {
      const anchor = termAnchorFor(verses, ev.a.gloss);
      if (anchor) {
        anchor.classList.add('term-target');
        anchor.dataset.anchorFor = 'term';
      }
      const el = compositionElement('term');
      el.dataset.phase = phase;
      el.innerHTML = `${kicker(anchor ? `Word in the passage · ${anchor.textContent}` : 'Word in view')}
        <div class="term-lockup"><i class="term-form">${escapeHtml(ev.a.term)}</i>
        ${phase === 'term' ? '' : `<span class="term-rule"></span><span class="term-gloss">${escapeHtml(completeEditorialDisplay(ev.a.gloss))}</span>`}</div>`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'footnote': {
      const glyph = '†';
      const anchor = getOrWrap(verses, ev.a.word, ev.a.occurrence);
      if (!anchor) return { mounted: false, reason: 'scripture-anchor-missing' };
      anchor.classList.add('footnote-target');
      anchor.dataset.anchorFor = 'footnote';
      anchor.insertAdjacentHTML('beforeend', `<sup class="fnmark">${glyph}</sup>`);
      const el = compositionElement('footnote');
      el.dataset.phase = phase;
      el.innerHTML = `<span class="footnote-glyph" aria-hidden="true">${glyph}</span><div>
        ${kicker('Textual note')}<p><b class="footnote-word">${escapeHtml(ev.a.word)}</b>
        ${phase === 'anchor' ? '' : `<span class="footnote-copy">${escapeHtml(completeEditorialDisplay(ev.a.note))}</span>`}</p></div>`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'allusion': {
      const stageText = scriptureTextMap(verses).text;
      const showConnection = phase !== 'source';
      const shared = showConnection ? sharedWords(stageText, ev.a.text).slice(0, 3) : [];
      const el = compositionElement('allusion');
      const onStage = referenceIsOnStage(ev.a.ref, ev.scene?.ref);
      if (onStage) el.classList.add('is-stage-reference');
      el.dataset.phase = phase;
      el.innerHTML = `<header class="allusion-meta">${kicker(onStage ? 'Echo in view' : 'Echo')}<span class="thought-ref">${escapeHtml(ev.a.ref)}</span></header>
        <div class="allusion-copy">${onStage ? '' : `<blockquote class="allusion-passage">${markRelevant(ev.a.text, shared)}</blockquote>`}
        ${showConnection && ev.a.note ? `<p class="thought-note">${escapeHtml(completeEditorialDisplay(ev.a.note))}</p>` : ''}</div>`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'compare': {
      const { a, b, note, axis } = ev.a;
      const showAxis = phase !== 'sources';
      const common = showAxis ? sharedWords(a.text, b.text).slice(0, 5) : [];
      const marksFor = (own, other) => !showAxis ? [] : axis === 'difference'
        ? sharedWords(own, own).filter((word) => !sharedWords(other, other).includes(word)).slice(0, 4)
        : common;
      const sideMarkup = (side, other) => {
        const onStage = referenceIsOnStage(side.ref, ev.scene?.ref);
        return `<section class="compare-side${onStage ? ' compare-side--stage' : ''}">
          <div class="compare-meta"><span class="thought-ref">${escapeHtml(side.ref)}</span>
          ${onStage ? '<span class="compare-stage-label">Current passage</span>' : ''}</div>
          <blockquote class="compare-excerpt">${markRelevant(editorialExcerpt(side.text, 14), marksFor(side.text, other.text))}</blockquote>
        </section>`;
      };
      const axisTitle = axis === 'difference' ? 'The distinction' : 'A shared claim';
      const el = compositionElement('compare');
      el.dataset.axis = axis;
      el.dataset.phase = phase;
      el.innerHTML = `<header>${kicker('Comparison')}${showAxis ? `<h3 class="compare-heading">${axisTitle}</h3>` : ''}</header>
        <div class="compare-sides">${sideMarkup(a, b)}<span class="compare-axis" aria-hidden="true"></span>${sideMarkup(b, a)}</div>
        ${showAxis && note ? `<p class="thought-note">${escapeHtml(completeEditorialDisplay(note))}</p>` : ''}`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'chain': {
      const stageIndex = ev.a.links.findIndex((link) => referenceIsOnStage(link.ref, ev.scene?.ref));
      const direction = stageIndex === ev.a.links.length - 1
        ? 'Earlier → here'
        : (stageIndex >= 0 ? 'Here in the sequence' : 'Passage to passage');
      const links = ev.a.links.map((link, index) => {
        const onStage = referenceIsOnStage(link.ref, ev.scene?.ref);
        return `<li class="chain-node${onStage ? ' chain-node--stage' : ''}" data-chain-link="${index}">
          <span class="chain-dot" aria-hidden="true"></span><div><span class="thought-ref">${escapeHtml(link.ref)}</span>
          <blockquote class="chain-excerpt">${escapeHtml(editorialExcerpt(link.text, 18))}</blockquote>
          ${onStage ? '<span class="chain-stage-label">In the passage above</span>' : ''}</div></li>`;
      }).join('');
      const el = compositionElement('chain');
      const showClaim = phase !== 'route';
      el.dataset.stageIndex = String(stageIndex);
      el.dataset.phase = phase;
      el.style.setProperty('--chain-count', String(Math.max(1, ev.a.links.length)));
      el.innerHTML = `<header>${kicker('A line through Scripture')}${showClaim ? `<span class="chain-direction">${escapeHtml(direction)}</span>` : ''}</header>
        <ol class="chain-route" data-chain-edge>${links}</ol>
        ${showClaim && ev.a.note ? `<p class="thought-note">${escapeHtml(completeEditorialDisplay(ev.a.note))}</p>` : ''}`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'caveat': {
      const el = compositionElement('caveat');
      el.dataset.phase = phase;
      el.innerHTML = `<span class="caveat-boundary" aria-hidden="true"></span><div>
        ${kicker('Reading limit')}${phase === 'boundary' ? '' : `<p>${escapeHtml(completeEditorialDisplay(ev.a.text))}</p>`}</div>`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'aside': {
      const el = compositionElement('aside', 'p');
      if (th.querySelector('.th-body').classList.contains('bare')) el.classList.add('is-bare');
      el.innerHTML = `<span class="aside-mark" aria-hidden="true"></span><span class="aside-copy">${escapeHtml(sentenceDisplay(ev.a.text))}</span>`;
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    case 'highlight': {
      const el = compositionElement('highlight', 'blockquote');
      el.textContent = displayQuote(ev.a.quote);
      return mountComposition(el, ev, { immediate: reconstruct });
    }
    default:
      return { mounted: false, reason: 'unsupported-visual-kind' };
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

function scriptureTextMap(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let text = '';
  let node;
  while ((node = walker.nextNode())) {
    const parent = node.parentElement;
    if (!parent || parent.closest('sup, .verses-ref, svg')) continue;
    const start = text.length;
    text += node.data;
    nodes.push({ node, start, end: text.length });
  }
  return { text, nodes };
}

/* Geometry reads the laid-out text through a Range instead of wrapping it.
   A short phrase can break across two lines, and getClientRects preserves
   those fragments. Keeping this lookup read-only also means one group's
   phrase never creates markup that prevents a later overlapping phrase
   from being found. */
function textRangeFor(root, phrase, occurrence = 0) {
  if (!root || !phrase) return null;
  const { text, nodes } = scriptureTextMap(root);
  const match = findScriptureOccurrence(text, phrase, occurrenceIndex(occurrence));
  if (!match) return null;
  const startOffset = match.start;
  const endOffset = match.end;
  const startNode = nodes.find((entry) => startOffset >= entry.start && startOffset < entry.end);
  const endNode = nodes.find((entry) => endOffset > entry.start && endOffset <= entry.end);
  if (!startNode || !endNode) return null;
  const range = document.createRange();
  range.setStart(startNode.node, startOffset - startNode.start);
  range.setEnd(endNode.node, endOffset - endNode.start);
  return range;
}

function wrapWord(root, word, occurrence = 0) {
  const range = textRangeFor(root, word, occurrence);
  if (!range) return null;
  const span = document.createElement('span');
  span.className = 'sword';
  try {
    span.appendChild(range.extractContents());
    range.insertNode(span);
    return span;
  } catch {
    return null;
  }
}

function animateLoomPath(path, immediate) {
  if (immediate || motionIsReduced()) return;
  const length = path.getTotalLength();
  path.style.strokeDasharray = String(length);
  path.style.strokeDashoffset = String(length);
  requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
}

function scriptureLineRects(root, bounds) {
  return scriptureTextMap(root).nodes.flatMap(({ node }) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    return [...range.getClientRects()]
      .filter((rect) => rect.width > 0 && rect.height > 0)
      .map((rect) => ({
        x1: rect.left - bounds.left,
        x2: rect.right - bounds.left,
        top: rect.top - bounds.top,
        bottom: rect.bottom - bounds.top,
      }));
  });
}

function drawMark(mark, { immediate = false } = {}) {
  const q = TH().querySelector('.verses');
  if (!q?.classList.contains('has') || !Array.isArray(mark?.words) || mark.words.length < 2) {
    return { refused: 'invalid-group-stage' };
  }
  const scriptureText = scriptureTextMap(q).text;
  const offsets = mark.words.map((word, index) => (
    findScriptureOccurrence(scriptureText, word, mark.occurrences?.[index] ?? mark.wordTimes?.[index]?.occurrence ?? 0)
  ));
  const ranges = mark.words.map((word, index) =>
    textRangeFor(q, word, mark.occurrences?.[index] ?? mark.wordTimes?.[index]?.occurrence ?? 0)
  );
  // A named relationship is all-or-nothing: a partial weave would make a
  // stronger visual claim than the verified Scripture anchors support.
  if (ranges.some((range) => !range) || offsets.some((offset) => !offset)) {
    return { refused: 'scripture-anchor-missing' };
  }
  const anchoredWords = ranges.map((range) => range.toString());

  const NS = 'http://www.w3.org/2000/svg';
  const qr = q.getBoundingClientRect();
  const targetRuns = ranges.map((range) => [...range.getClientRects()]
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x1: rect.left - qr.left,
      x2: rect.right - qr.left,
      top: rect.top - qr.top,
      bottom: rect.bottom - qr.top,
    })));
  if (targetRuns.some((runs) => runs.length === 0)) return { refused: 'geometry-unavailable' };
  const plan = planLoomGeometry({
    targets: targetRuns.flat(),
    lineRects: scriptureLineRects(q, qr),
    boundsWidth: q.clientWidth,
    safeInset: 8,
  });
  if (!plan) return { refused: 'geometry-unavailable' };

  q.querySelector('svg.smarks')?.remove();
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'smarks');
  svg.setAttribute('viewBox', `0 0 ${q.clientWidth} ${q.clientHeight}`);
  svg.setAttribute('aria-hidden', 'true');
  q.appendChild(svg);

  const addPath = (className, d, dataName = null) => {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('class', className);
    path.setAttribute('d', d);
    if (dataName) path.setAttribute(dataName, '');
    svg.appendChild(path);
    animateLoomPath(path, immediate);
  };
  plan.contacts.forEach((contact) => {
    addPath('loom-contact', `M ${contact.x1} ${contact.contactY} H ${contact.x2}`, 'data-loom-contact');
    addPath('loom-pin', `M ${contact.pinX} ${contact.contactY + 1.5} V ${contact.corridorY}`);
  });
  plan.wefts.forEach((weft) => addPath('loom-weft', `M ${weft.x1} ${weft.y} H ${weft.x2}`));
  if (plan.warp) addPath('loom-warp', `M ${plan.warp.x} ${plan.warp.y1} V ${plan.warp.y2}`);
  plan.knots.forEach((knot) => {
    const circle = document.createElementNS(NS, 'circle');
    circle.setAttribute('class', 'loom-knot');
    circle.setAttribute('cx', knot.x);
    circle.setAttribute('cy', knot.y);
    circle.setAttribute('r', '1.8');
    svg.appendChild(circle);
  });
  mark.words.forEach((word, index) => {
    const anchor = getOrWrap(q, word, mark.occurrences?.[index] ?? mark.wordTimes?.[index]?.occurrence ?? 0);
    if (!anchor) return;
    anchor.classList.add('group-target');
    anchor.dataset.anchorIndex = String(index);
    anchor.dataset.anchorWord = word;
    anchor.dataset.anchorOccurrence = String(mark.occurrences?.[index] ?? mark.wordTimes?.[index]?.occurrence ?? 0);
  });
  const sourceSpan = scriptureText.slice(
    Math.min(...offsets.map((offset) => offset.start)),
    Math.max(...offsets.map((offset) => offset.end)),
  );
  return { words: anchoredWords, sourceSpan };
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
      showFallbackMark(mark);
    }
  }
}

function showFallbackMark(mark, { immediate = false } = {}) {
  if (!current) return false;
  clearStageComposition({ immediate });
  const loom = drawMark(mark, { immediate });
  if (loom?.refused) return false;
  const event = { kind: 'group' };
  current.activeVisualEvent = event;
  mountComposition(loomComposition(mark, loom.words, loom.sourceSpan), event, { immediate });
  return true;
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
      surfaceDirectionNote(li, directorEntry(step));
      startStepPlayback(li, step, index, direction);
    }).catch((error) => {
      if (pendingPlay === intent) cancelPendingPlay();
      if (error?.name !== 'AbortError') honestNote(li, 'The stage directions could not be opened.');
    });
    return;
  }
  surfaceDirectionNote(li, entry);
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
    compositionTimers: new Set(),
    frameTickets: new Set(),
    segments: null,
    phrases: quotedPhrases(step.why),
    capKey: null,
    captionText: '',
    captionSegmentId: '',
    direction: null,
    scenes: null,
    timeline: null,
    editorialPlan: null,
    beatById: new Map(),
    sceneById: new Map(),
    eventByBeatId: new Map(),
    fired: 0,
    sceneIdx: -1,
    sceneGeneration: 0,
    seekGeneration: 0,
    sceneReady: false,
    mountedScene: null,
    eventQueue: [],
    rebuilding: false,
    activeVisualEvent: null,
    refusedVisualEvent: null,
    activeEditorialShot: null,
    refusedEditorialShotId: null,
    visualOutcomes: new Map(),
    visualRel: 0,
    playToken: ++playCounter,
    returnFocus: playButton,
  };
  const owner = current;
  for (const mark of stageDirections[index]?.marks || []) mark.drawn = false;
  li.classList.add('playing');

  const th = TH();
  th.scrollTop = 0;
  th.querySelector('.th-source').textContent = step.source || step.sourceId;
  th.querySelector('.th-title').textContent = step.episodeTitle;
  th.querySelector('.th-whisper').textContent = '';
  th.querySelector('.verses').classList.remove('has');
  th.querySelector('.verses').innerHTML = '';
  th.querySelector('.caption').classList.remove('show');
  th.querySelector('.th-body').classList.remove('turning', 'spot', 'bare');
  th.querySelector('.th-body').setAttribute('aria-busy', 'false');
  clearEditorialTrace();
  clearAllVisualChannels({ immediate: true });
  updateProgress(step.startSec);
  th.classList.add('on');
  th.setAttribute('aria-hidden', 'false');
  $('#main').inert = true;
  $('#main').setAttribute('aria-hidden', 'true');
  document.body.classList.add('in-theater');
  nextFrame(() => { if (current === owner) $('#th-stop').focus({ preventScroll: true }); });

  const silentDrive = qaIsEnabled && qaSilentDrive;
  if (!silentDrive) {
    player.onended = () => {
      if (current === owner) stopAudio();
    };
    player.onerror = () => {
      if (current !== owner) return;
      honestNote(li, 'The audio stopped before this reading was finished.');
      stopAudio();
    };
    player.src = step.audioUrl;
    player.currentTime = step.startSec;
    player.volume = 0;
  }
  beginDirection(li, index, direction);
  if (!owner.scenes) fallbackVerse(step, index);

  if (!silentDrive) {
    player.play().then(() => {
      if (current === owner) fadeTo(1, 420);
    }).catch(() => {
      if (current !== owner) return;
      honestNote(li, 'This publisher asks you to listen on their own site — the tour will still be here.');
      stopAudio();
    });
  }

  const w = whispers[index];
  if (w) {
    th.querySelector('.th-whisper').textContent = w;
    playDelay(owner, () => th.querySelector('.th-whisper').classList.add('show'), motionMs(700));
    owner.whisperTimer = playDelay(owner, () => th.querySelector('.th-whisper').classList.remove('show'), 8700);
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
    if (owner.timeline) {
      if (!owner.rebuilding) {
        /* The schedule, resolved server-side, simply plays out. */
        const rel = t - step.startSec;
        while (owner.fired < owner.timeline.length && owner.timeline[owner.fired].at <= rel) {
          renderEvent(owner.timeline[owner.fired]);
          owner.fired += 1;
          if (current !== owner) return;
        }
        syncVisualLifecycles(rel);
      }
    } else if (frac > 0.7) {
      const dir = stageDirections[index];
      for (const mark of dir?.marks || []) {
        if (!mark.drawn) { mark.drawn = true; showFallbackMark(mark); }
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

function rebuildStageAt(t, { reason = 'seek', immediate = false } = {}) {
  if (!current?.timeline || !current.editorialPlan) return;
  const owner = current;
  const { step, scenes } = owner;
  const rel = Math.max(0, Math.min(step.endSec - step.startSec, t - step.startSec));
  owner.visualRel = rel;
  const generation = ++owner.seekGeneration;
  owner.rebuilding = true;
  owner.eventQueue = [];
  owner.activeEditorialShot = null;
  owner.refusedEditorialShotId = null;
  let k = -1;
  for (let i = 0; i < scenes.length; i++) if ((scenes[i].at ?? 0) <= rel) k = i;
  owner.fired = owner.timeline.findIndex((event) => event.at > rel);
  if (owner.fired === -1) owner.fired = owner.timeline.length;
  if (k < 0) {
    owner.sceneGeneration += 1;
    owner.sceneIdx = -1;
    owner.sceneReady = false;
    owner.mountedScene = null;
    owner.eventQueue = [];
    const th = TH();
    clearAllVisualChannels();
    const q = th.querySelector('.verses');
    q.classList.remove('has');
    q.innerHTML = '';
    th.querySelector('.th-body').classList.remove('turning', 'spot', 'bare');
    th.querySelector('.th-body').setAttribute('aria-busy', 'false');
    owner.rebuilding = false;
    owner.capKey = null;
    updateCaption(t);
    syncVisualLifecycles(rel, { immediate: true });
    return;
  }
  const scene = scenes[k];
  activateScene(scene, k, {
    force: true,
    immediate: immediate || reason === 'resize',
    onMounted: () => {
      if (current !== owner || owner.seekGeneration !== generation || owner.mountedScene !== scene) return;
      updateCaption(t);
      syncVisualLifecycles(rel, { immediate: true });
      owner.rebuilding = false;
      owner.capKey = null;
    },
  });
}

function resetFallbackStage(t) {
  if (!current || current.timeline) return;
  const dir = stageDirections[current.index];
  for (const mark of dir?.marks || []) mark.drawn = false;
  const q = TH().querySelector('.verses');
  q.querySelector('svg.smarks')?.remove();
  for (const span of q.querySelectorAll('.sword')) span.classList.remove('lit');
  for (const mark of q.querySelectorAll('.fnmark')) mark.remove();
  const frac = (t - current.step.startSec) / (current.step.endSec - current.step.startSec);
  if (frac > 0.7) {
    for (const mark of dir?.marks || []) { mark.drawn = true; showFallbackMark(mark, { immediate: true }); }
  }
}

function seekTo(t) {
  if (!current) return;
  const owner = current;
  const { step } = owner;
  t = Math.max(step.startSec, Math.min(step.endSec - 1, t));
  cancelAnimationFrame(owner.fadeRaf);
  owner.fading = false;
  if (player.volume < 0.99) fadeTo(1, 220);
  player.currentTime = t;
  owner.capKey = null;
  updateProgress(t);
  updateCaption(t);
  if (owner.timeline) rebuildStageAt(t);
  else resetFallbackStage(t);
}

$('#th-back').addEventListener('click', () => current && seekTo(player.currentTime - 15));
$('#th-fwd').addEventListener('click', () => current && seekTo(player.currentTime + 15));
document.addEventListener('keydown', (e) => {
  if (!current || e.target.closest('input, button, [role="slider"], [contenteditable="true"]')) return;
  if (e.key === 'ArrowLeft') { e.preventDefault(); seekTo(player.currentTime - 15); }
  if (e.key === 'ArrowRight') { e.preventDefault(); seekTo(player.currentTime + 15); }
});

function clockText(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

function updateProgress(t) {
  const bar = document.querySelector('.th-progress');
  if (!current) {
    bar.querySelector('i').style.width = '0%';
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', '0');
    bar.setAttribute('aria-valuenow', '0');
    bar.setAttribute('aria-valuetext', 'Not playing');
    return;
  }
  const duration = Math.max(1, current.step.endSec - current.step.startSec);
  const maxElapsed = Math.max(0, duration - 1);
  const elapsed = Math.max(0, Math.min(maxElapsed, t - current.step.startSec));
  bar.querySelector('i').style.width = `${maxElapsed ? (elapsed / maxElapsed) * 100 : 0}%`;
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', String(Math.round(maxElapsed)));
  bar.setAttribute('aria-valuenow', String(Math.round(elapsed)));
  bar.setAttribute('aria-valuetext', `${clockText(elapsed)} of ${clockText(maxElapsed)}`);
}

(() => {
  const bar = document.querySelector('.th-progress');
  const toTime = (e) => {
    const r = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const playable = Math.max(0, current.step.endSec - current.step.startSec - 1);
    return current.step.startSec + frac * playable;
  };
  let dragging = false;
  const preview = (e) => { if (current) updateProgress(toTime(e)); };
  const cancelDrag = () => {
    if (!dragging) return;
    dragging = false;
    bar.classList.remove('dragging');
    if (current) updateProgress(player.currentTime);
  };
  bar.addEventListener('pointerdown', (e) => {
    if (!current) return;
    e.preventDefault();
    dragging = true;
    bar.classList.add('dragging');
    bar.setPointerCapture(e.pointerId);
    preview(e);
  });
  bar.addEventListener('pointermove', (e) => {
    if (!dragging || !current) return;
    preview(e);
  });
  bar.addEventListener('pointerup', (e) => {
    if (!dragging || !current) return;
    dragging = false;
    bar.classList.remove('dragging');
    seekTo(toTime(e));
  });
  bar.addEventListener('pointercancel', cancelDrag);
  bar.addEventListener('lostpointercapture', cancelDrag);
  bar.addEventListener('keydown', (e) => {
    if (!current) return;
    const keys = new Set(['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End']);
    if (!keys.has(e.key)) return;
    e.preventDefault();
    let target = player.currentTime;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') target -= 5;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') target += 5;
    if (e.key === 'PageDown') target -= 15;
    if (e.key === 'PageUp') target += 15;
    if (e.key === 'Home') target = current.step.startSec;
    if (e.key === 'End') target = current.step.endSec - 1;
    seekTo(target);
  });
})();

function updateCaption(t) {
  if (!current?.segments?.length) return;
  let seg = null;
  for (const s of current.segments) { if (s.s <= t) seg = s; else break; }
  const silent = !seg || t > seg.e + 1.5;
  const key = silent ? null : seg.s;
  const segmentId = silent ? '' : `segment:${seg.s}:${seg.e}`;
  const fullCaptionText = silent ? '' : String(seg.t || '');
  const cap = TH().querySelector('.caption');
  current.captionText = fullCaptionText;
  if (!silent) cap.textContent = wordBoundaryExcerpt(fullCaptionText, stageIsNarrow() ? 88 : 116);
  current.captionSegmentId = segmentId;
  const syncSegmentProvenance = () => {
    const composition = TH().querySelector('.thought-current > .th-composition');
    if (composition) composition.dataset.sourceSegmentIds = segmentId;
    if (editorialFrame()) editorialFrame().dataset.sourceSegmentIds = segmentId;
    const listeningLine = composition?.querySelector('.listening-line');
    if (listeningLine) listeningLine.textContent = current.captionText;
  };
  if (key === current.capKey) {
    syncSegmentProvenance();
    return;
  }
  current.capKey = key;
  if (silent) cap.classList.remove('show');
  else {
    cap.classList.add('show');
  }
  syncSegmentProvenance();
  if (silent) return;
  if (!current.timeline) cueMarks(seg.t);
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
  const owner = current;
  cancelAnimationFrame(owner.fadeRaf);
  if (ms <= 0) { player.volume = target; return; }
  const startVol = player.volume;
  const t0 = performance.now();
  const tick = (t) => {
    if (current !== owner) return;
    // Some WebKit/embedded-browser clocks can hand the first animation frame
    // a timestamp just before this performance.now() sample. Clamp both the
    // interpolation and the media value so a fade never writes outside the
    // HTMLMediaElement [0, 1] volume contract.
    const k = Math.max(0, Math.min(1, (t - t0) / ms));
    const volume = startVol + (target - startVol) * k;
    player.volume = Math.max(0, Math.min(1, volume));
    if (k < 1) owner.fadeRaf = requestAnimationFrame(tick);
  };
  owner.fadeRaf = requestAnimationFrame(tick);
}

function stopAudio({ restoreFocus = true } = {}) {
  if (!current) return;
  const owner = current;
  const { li, fadeRaf, returnFocus } = owner;
  cancelAnimationFrame(fadeRaf);
  cancelAllPlayFrames(owner);
  owner.controller.abort();
  for (const timer of owner.timers) clearTimeout(timer);
  owner.timers.clear();
  player.pause();
  player.ontimeupdate = null;
  player.onended = null;
  player.onerror = null;
  li.classList.remove('playing');
  const th = TH();
  th.classList.remove('on');
  th.setAttribute('aria-hidden', 'true');
  th.querySelector('.th-whisper').classList.remove('show');
  /* The theater empties when it closes — nothing from one clip may ever
     greet the next. */
  th.querySelector('.verses').classList.remove('has');
  th.querySelector('.verses').innerHTML = '';
  th.querySelector('.caption').classList.remove('show');
  th.querySelector('.th-body').classList.remove('turning', 'spot', 'bare');
  th.querySelector('.th-body').setAttribute('aria-busy', 'false');
  th.querySelector('.th-progress').classList.remove('dragging');
  lastVisualOutcomeSnapshot = visualOutcomeSnapshot(owner);
  lastEditorialSnapshot = editorialSnapshot(owner);
  clearAllVisualChannels({ immediate: true });
  clearEditorialTrace();
  for (const key of [
    'editorialPolicy', 'editorialShotCount', 'editorialSemanticOccupancy',
    'editorialMaxRestSec', 'editorialMaxFamilyRun', 'editorialSceneCoverage',
  ]) delete th.dataset[key];
  document.body.classList.remove('in-theater');
  $('#main').inert = false;
  $('#main').removeAttribute('aria-hidden');
  current = null;
  updateProgress(0);
  if (restoreFocus && returnFocus?.isConnected) {
    const closingToken = owner.playToken;
    nextFrame(() => {
      if (!current && playCounter === closingToken && returnFocus.isConnected) {
        returnFocus.focus({ preventScroll: true });
      }
    });
  }
}

let layoutTimer = null;
function scheduleStageRedraw() {
  if (!current) return;
  const owner = current;
  if (layoutTimer) {
    clearTimeout(layoutTimer);
    owner.timers.delete(layoutTimer);
  }
  layoutTimer = playDelay(owner, () => {
    layoutTimer = null;
    if (owner.timeline) {
      rebuildStageAt(player.currentTime, { reason: 'resize', immediate: true });
      return;
    }
    const drawn = (stageDirections[owner.index]?.marks || []).filter((mark) => mark.drawn);
    const mark = drawn.at(-1);
    if (mark) showFallbackMark(mark, { immediate: true });
  }, motionMs(140));
}

window.addEventListener('resize', scheduleStageRedraw, { passive: true });
window.addEventListener('orientationchange', scheduleStageRedraw, { passive: true });
window.visualViewport?.addEventListener('resize', scheduleStageRedraw, { passive: true });
document.fonts?.ready.then(scheduleStageRedraw).catch(() => {});
reducedMotion.addEventListener('change', scheduleStageRedraw);

TH().addEventListener('keydown', (event) => {
  if (event.key !== 'Tab' || !current) return;
  const controls = [...TH().querySelectorAll('button:not([disabled]), [tabindex="0"]')]
    .filter((element) => element.getClientRects().length);
  if (!controls.length) return;
  const first = controls[0];
  const last = controls[controls.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
});

async function loadReplay(id) {
  const run = startRun({ mode: 'replay' });
  showScene('making');
  sayLine('opening a saved performance…');
  if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) {
    sayLine('that saved performance name is not valid.');
    returnToAsk(run, 1800);
    return;
  }
  try {
    const response = await fetch(`/api/replay/${encodeURIComponent(id)}`, { signal: run.controller.signal });
    if (!response.ok) throw new Error(`replay request returned ${response.status}`);
    const data = await response.json();
    const fixture = upgradeReplayFixture(data.fixture || data);
    const check = validateReplayFixture(fixture);
    if (!check.ok) throw new Error(`replay refused: ${check.errors.join('; ')}`);
    if (!runIsActive(run)) return;
    sayLine('setting the type…');
    runDelay(run, () => presentTour(fixture.tour, fixture.prompt || '', run, { replayFixture: fixture }), motionMs(320));
  } catch (error) {
    if (error?.name === 'AbortError' || !runIsActive(run)) return;
    sayLine('that saved performance could not be opened.');
    returnToAsk(run, 2200);
  }
}

function bootstrap() {
  const replayId = new URLSearchParams(window.location.search).get('replay');
  if (replayId) loadReplay(replayId);
  else $('#q').focus();
}

bootstrap();
