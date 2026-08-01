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

  sayLine('setting the type…');
  setTimeout(() => presentTour(tour, prompt), 1200);
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

function presentTour(tour, prompt) {
  delete $('#tour').dataset.form;
  document.querySelector('.lexicon')?.remove();
  currentThreads = null;
  $('#steps').classList.remove('has-threads');
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

  buildVoices(tour);
  fetchWhispers(tour);
  fetchForm(tour, prompt);
}

// -------------------------------------------------- the tour's own form
// The model composes, the house draws: the plan arriving here has already
// been validated against the tour's real contents, so everything below is
// pure typesetting from the house vocabulary.

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

const SIDE_WORDS = { yes: 'answers yes', no: 'answers no', map: 'maps the territory', synthesis: 'refuses the either-or' };

function applyForm(plan) {
  const tourEl = $('#tour');
  const items = [...$('#steps').children];
  tourEl.dataset.form = plan.form || 'standard';

  if (plan.form === 'debate') {
    for (const { step, side } of plan.stances) {
      const li = items[step];
      if (!li) continue;
      li.dataset.side = side;
      const tag = document.createElement('p');
      tag.className = 'stance';
      tag.textContent = SIDE_WORDS[side];
      li.insertBefore(tag, li.firstChild);
    }
  }

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

  if (plan.threads?.length) {
    currentThreads = plan.threads;
    // Draw once the stagger has finished laying the cards down.
    setTimeout(drawThreads, 500 + items.length * 240 + 500);
  }

  scriptureMarks = {};
  for (const m of plan.marks || []) scriptureMarks[m.step] = m;
}

// ------------------------------------- the loom, over the scripture itself
// While a clip plays, the model's named words in the cited verse carry the
// connection grammar: an underline run under each word, one vertical
// gathering them in the margin, one soft corner, the label in words. The
// model picked the words; every coordinate is the house's; a word the
// verse doesn't contain is silently nothing.

let scriptureMarks = {};

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

function annotateScripture(li, mark) {
  const q = li.querySelector('.verses');
  if (!q?.classList.contains('has') || !mark) return;
  q.querySelector('svg.smarks')?.remove();
  const spans = mark.words.map((w) => q.querySelector(`.sword[data-w="${CSS.escape(w)}"]`) || (() => {
    const s = wrapWord(q, w);
    if (s) s.dataset.w = w;
    return s;
  })()).filter(Boolean);
  if (spans.length < 2) return;

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'smarks');
  const qr = q.getBoundingClientRect();
  const runs = spans.map((sp) => {
    const r = sp.getBoundingClientRect();
    return { x1: r.left - qr.left, x2: r.right - qr.left, y: r.bottom - qr.top + 1.5 };
  }).sort((a, b) => a.y - b.y || a.x1 - b.x1);
  const lane = -14;
  const R = 8;
  const parts = [];
  /* One vertical gathers every run; its top turns one soft corner into the
     first run's underline — the bracket grammar, nothing else. */
  const first = runs[0];
  const last = runs[runs.length - 1];
  parts.push(`M ${first.x1} ${first.y} H ${lane + R} Q ${lane} ${first.y} ${lane} ${first.y + R} V ${last.y}`);
  for (const run of runs) {
    parts.push(`M ${run.x1} ${run.y} H ${run.x2}`);
    if (run !== first) parts.push(`M ${lane} ${run.y} H ${run.x1}`);
  }
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', parts.join(' '));
  svg.appendChild(path);
  if (mark.label) {
    /* Along the gathering vertical, book-margin style, matching the
       threads — a dense verse block has no empty line to rest a
       horizontal label on. */
    const midY = (first.y + last.y) / 2;
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', lane - 5);
    label.setAttribute('y', midY);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('transform', `rotate(-90 ${lane - 5} ${midY})`);
    label.textContent = mark.label;
    svg.appendChild(label);
  }
  q.appendChild(svg);
  /* The loom draws itself in — ink arriving, not appearing. */
  const len = path.getTotalLength();
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
}

// -------------------------------------------------- threads, house-drawn
// The loom principle, pointed at audio: the model named which steps speak
// to each other and in which of three house words; every coordinate below
// is ours. Lines run down the left gutter — an exit, one soft corner, a
// vertical, one soft corner, an entrance — and redraw whenever the layout
// breathes (a card opening its verses shifts everything under it).

let currentThreads = null;

function drawThreads() {
  const list = $('#steps');
  list.querySelector('svg.threads')?.remove();
  if (!currentThreads?.length) { list.classList.remove('has-threads'); return; }
  list.classList.add('has-threads');
  const items = [...list.children].filter((el) => el.classList?.contains('step'));
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'threads');
  const lr = list.getBoundingClientRect();
  const R = 8; // the app's corner radius canon
  currentThreads.forEach((t, i) => {
    const A = items[Math.min(t.a, t.b)];
    const B = items[Math.max(t.a, t.b)];
    if (!A || !B) return;
    const ra = A.getBoundingClientRect();
    const rb = B.getBoundingClientRect();
    const x0 = ra.left - lr.left;                 // the cards' shared left edge
    const ya = ra.top - lr.top + 30;
    const yb = rb.top - lr.top + 30;
    const gx = 14 + i * 12;                       // this thread's own gutter lane
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d',
      `M ${x0} ${ya} H ${gx + R} Q ${gx} ${ya} ${gx} ${ya + R} V ${yb - R} Q ${gx} ${yb} ${gx + R} ${yb} H ${x0}`);
    svg.appendChild(path);
    /* The kind runs along its own line, book-margin style — horizontal
       labels at the card tops collided with the forms' own tags. */
    const midY = (ya + yb) / 2;
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', gx - 4);
    label.setAttribute('y', midY);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('transform', `rotate(-90 ${gx - 4} ${midY})`);
    label.textContent = t.kind;
    svg.appendChild(label);
  });
  list.appendChild(svg);
}

/* Layout breathes when a card plays (verses unfold) or the window resizes;
   the threads follow. */
const rethread = (() => {
  let raf = null;
  return () => {
    if (!currentThreads) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(drawThreads);
  };
})();
window.addEventListener('resize', rethread);
new ResizeObserver(rethread).observe($('#steps'));

// ------------------------------------------- the voices, measured honestly
// Not model output: the strip is arithmetic on the tour itself — each
// publisher's share of the listening, in order of first appearance.

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

  // The verses become visible with the playing state; the loom needs their
  // laid-out geometry, so it draws a beat later.
  setTimeout(() => { if (current?.li === li) annotateScripture(li, scriptureMarks[index]); }, 700);

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
