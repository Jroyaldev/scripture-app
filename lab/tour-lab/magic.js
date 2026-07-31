// The magic experiment: same pipeline, different manners.
//
// The anti-magic list, enforced here by absence: no chat transcript, no
// streaming tokens, no spinner, no progress bar, no percentages, no
// "regenerate", and the word "AI" appears nowhere a reader can see.

const $ = (s) => document.querySelector(s);
const MODEL = 'gpt-5.6-luna-medium'; // fast enough to watch, cheap enough to not think about

// ----------------------------------------------------------------- scenes

function showScene(id) {
  for (const sc of document.querySelectorAll('.scene')) {
    if (sc.id === id) {
      sc.classList.add('entering');
      requestAnimationFrame(() => requestAnimationFrame(() => sc.classList.add('on')));
    } else {
      sc.classList.remove('on', 'entering');
      sc.style.display = '';
    }
  }
}

// ------------------------------------------------------------- the making
// One quiet line at a time. The lines are honest — each is the pipeline's
// actual current act, phrased the way a person would say it — but they are
// paced for reading, not for the machine: a new act may not interrupt a
// line that just appeared.

const lineEl = () => $('#making-line');
let lineQueue = [];
let lineBusy = false;
let lastLineAt = 0;

function sayLine(text) {
  // Collapse bursts: keep only the freshest pending line.
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

const trim = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

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
  $('#q').focus();
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
    // Fail like a person: one sentence, and the door stays open.
    sayLine(sawTrouble ? 'that one is beyond me today — try asking another way.' : 'try asking another way.');
    setTimeout(() => showScene('ask'), 2600);
    return;
  }

  sayLine('setting it in order…');
  setTimeout(() => presentTour(tour), 1200);
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
      <div class="step-title"></div>
      <div class="step-row">
        <button class="play" aria-label="Play">
          <svg width="12" height="14" viewBox="0 0 12 14" fill="currentColor" aria-hidden="true">
            <path class="p-play" d="M1 1 L11 7 L1 13 Z"></path>
            <g class="p-pause" style="display:none"><rect x="1" y="1" width="3.5" height="12"></rect><rect x="7.5" y="1" width="3.5" height="12"></rect></g>
          </svg>
        </button>
        <div class="whisper" title="Why this clip"></div>
      </div>
      <blockquote class="verses"></blockquote>
      <div class="why"></div>
      ${s.adInsertionDrift ? '<p class="step-note">This show inserts ads, so the needle may land a little off — nudge if it does.</p>' : ''}
    `;
    li.querySelector('.step-source').textContent = s.source || s.sourceId;
    li.querySelector('.step-title').textContent = s.episodeTitle;
    li.querySelector('.why').textContent = s.why;
    li.querySelector('.play').addEventListener('click', () => toggleStep(li, s, i));
    li.querySelector('.whisper').addEventListener('click', () => li.querySelector('.why').classList.toggle('open'));
    list.appendChild(li);
    loadVerses(li, s);
  });

  showScene('tour');
  // Steps lay themselves in one at a time — the gift being set on the table.
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

function loadVerses(li, step) {
  const m = String(step.why || '').match(/\b([1-3]?\s?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/);
  if (!m) return;
  const to = m[4] ? Number(m[4]) : Math.min(Number(m[3]) + 2, Number(m[3]) + 2);
  fetch(`/api/passage?book=${encodeURIComponent(m[1])}&chapter=${m[2]}&from=${m[3]}&to=${to}`)
    .then((r) => r.json())
    .then((p) => {
      if (p.error || !p.verses?.length) return;
      const q = li.querySelector('.verses');
      q.innerHTML = p.verses.slice(0, 3).map((v) => `<sup>${v.verse}</sup>${escapeHtml(v.text)}`).join(' ');
      q.classList.add('has');
    })
    .catch(() => {});
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// -------------------------------------------------------------- listening
// One clip at a time. Sound eases in and out — nothing on this page cuts.

const player = $('#player');
let current = null; // { li, step, index, raf, fadeRaf }

function toggleStep(li, step, index) {
  if (current && current.li === li) { stopAudio(); return; }
  stopAudio();
  if (!step.audioUrl) return;
  current = { li, step, index };
  li.classList.add('playing');
  setGlyph(li, true);

  player.src = step.audioUrl;
  player.currentTime = step.startSec;
  player.volume = 0;
  player.play().then(() => fadeTo(1, 420)).catch(() => stopAudio());

  const whisperEl = li.querySelector('.whisper');
  const w = whispers[index];
  whisperEl.textContent = w || '';
  if (w) setTimeout(() => whisperEl.classList.add('show'), 600);

  player.ontimeupdate = () => {
    if (!current) return;
    const remaining = step.endSec - player.currentTime;
    if (remaining <= 0.9) { fadeTo(0, 800); }
    if (remaining <= 0) stopAudio();
  };
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
  setGlyph(li, false);
  current = null;
}

$('#q').focus();
