// The magic experiment: same pipeline, different manners.
//
// The anti-magic list, enforced here by absence: no chat transcript, no
// streaming tokens, no spinner, no progress bar toward "done", no
// percentages, no "regenerate", and the word "AI" appears nowhere a
// reader can see.

const $ = (s) => document.querySelector(s);
const MODEL = 'gpt-5.6-luna-medium'; // fast enough to watch, cheap enough to not think about

// ----------------------------------------------------------------- scenes
// Fade the leaving scene fully out before the arriving one fades in — a
// page that blinks between rooms breaks the spell.

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

  sayLine('setting it in order…');
  setTimeout(() => presentTour(tour), 1200);
}

// ------------------------------------------------------- quotes & marking
// Everything highlighted on this page is something a teacher actually said
// or the tour actually cites — relevance drawn from the record, never
// decoration.

function quotedPhrases(why) {
  const out = [];
  const re = /[“"]([^”"]{6,90})[”"]/g;
  let m;
  while ((m = re.exec(String(why || '')))) out.push(m[1]);
  return out;
}

const normalize = (s) => String(s).toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

/* Mark occurrences of any phrase (or its significant words) in plain text;
   returns HTML. Words under five letters stay unmarked — highlighting "the"
   helps nobody. */
function markRelevant(text, phrases, { wholePhrasesOnly = false } = {}) {
  let html = escapeHtml(text);
  const terms = new Set();
  for (const p of phrases) {
    if (p.length <= 60) terms.add(p);
    /* Verses mark single significant words too; the live caption marks only
       whole quoted phrases — exploding a long quote into words turned half
       the caption gold, which stops meaning anything. */
    if (wholePhrasesOnly) continue;
    for (const w of normalize(p).split(' ').filter((x) => x.length >= 5)) terms.add(w);
  }
  if (!terms.size) return html;
  /* One combined pass, longest alternative first, so a word can never
     re-match inside a phrase already marked — sequential replacement
     nested tags ("goodness in <em>action</em>" inside an <em>). */
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

function presentTour(tour) {
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
      <p class="caption" aria-live="off"></p>
      <blockquote class="verses"></blockquote>
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
    loadVerses(li, s);
  });

  showScene('tour');
  document.querySelectorAll('.step').forEach((el, i) => {
    setTimeout(() => el.classList.add('in'), 350 + i * 240);
  });

  fetchWhispers(tour);
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

// ------------------------------------------------- scripture, braided in
// Only the cited verses; a citation of one verse shows one verse. The
// words the tour itself quotes are underscored in gold.

function loadVerses(li, step) {
  const m = String(step.why || '').match(/\b([1-3]?\s?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/);
  if (!m) return;
  const from = Number(m[3]);
  const to = m[4] ? Math.min(Number(m[4]), from + 5) : from;
  fetch(`/api/passage?book=${encodeURIComponent(m[1])}&chapter=${m[2]}&from=${from}&to=${to}`)
    .then((r) => r.json())
    .then((p) => {
      if (p.error || !p.verses?.length) return;
      const phrases = quotedPhrases(step.why);
      const q = li.querySelector('.verses');
      q.innerHTML = p.verses.map((v) => `<sup>${v.verse}</sup>${markRelevant(v.text, phrases)}`).join(' ')
        + `<span class="verses-ref">${escapeHtml(`${p.bookName} ${p.chapter}:${from}${to > from ? '–' + to : ''}`)}</span>`;
      q.classList.add('has');
    })
    .catch(() => {});
}

// -------------------------------------------------------------- listening
// One clip at a time. Sound eases in and out; the words appear as they are
// said, and a phrase the tour quoted turns gold in the moment it is spoken.

const player = $('#player');
let current = null; // { li, step, index, fadeRaf, segments, phrases, capKey }

function toggleStep(li, step, index) {
  if (current && current.li === li) { stopAudio(); return; }
  stopAudio();
  if (!step.audioUrl) { honestNote(li, 'This publisher keeps its audio on its own site.'); return; }
  current = { li, step, index, segments: null, phrases: quotedPhrases(step.why), capKey: null };
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

  player.ontimeupdate = () => {
    if (!current) return;
    const t = player.currentTime;
    updateCaption(t);
    updateProgress(li, step, t);
    const remaining = step.endSec - t;
    if (remaining <= 0.9 && !current.fading) { current.fading = true; fadeTo(0, 800); }
    if (remaining <= 0) stopAudio();
  };
}

/* The words as they are said: the current segment's text, crossfaded on
   change, with any phrase the tour quoted turning gold as it is spoken. */
function updateCaption(t) {
  if (!current?.segments?.length) return;
  /* The last segment that has begun. Speech has hairline gaps between every
     segment (median 0.24s in this corpus) — a caption that hid in each one
     flickered four times a second. It holds through gaps and yields only to
     real silence. */
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
  const cap = li.querySelector('.caption');
  cap.classList.remove('show');
  li.querySelector('.clip-progress').style.transform = 'scaleX(0)';
  setGlyph(li, false);
  current = null;
}

$('#q').focus();
