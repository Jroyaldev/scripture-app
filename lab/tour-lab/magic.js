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

const $ = (s) => document.querySelector(s);
const MODEL = 'gpt-5.6-luna-medium'; // fast enough to watch, cheap enough to not think about
const TH = () => $('#theater');

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
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAudio(); });
$('#th-stop').addEventListener('click', () => stopAudio());

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
            <path d="M1 1 L11 7 L1 13 Z"></path>
          </svg>
        </button>
      </div>
      <div class="why"></div>
      ${s.adInsertionDrift ? '<p class="step-note">This show inserts ads, so the needle may land a little off — nudge if it does.</p>' : ''}
    `;
    li.querySelector('.step-source').textContent = s.source || s.sourceId;
    li.querySelector('.step-title').textContent = s.episodeTitle;
    li.querySelector('.why').textContent = s.why;
    li.querySelector('.play').addEventListener('click', () => toggleStep(li, s, i));
    const toggleWhy = () => li.querySelector('.why').classList.toggle('open');
    li.querySelector('.step-title').addEventListener('click', toggleWhy);
    li.querySelector('.step-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') toggleWhy(); });
    list.appendChild(li);
  });

  showScene('tour');
  document.querySelectorAll('.step').forEach((el, i) => {
    setTimeout(() => el.classList.add('in'), 350 + i * 240);
  });

  buildVoices(tour);
  fetchWhispers(tour);
  fetchForm(tour, prompt);

  /* Prefetch every step's stage directions now, one at a time, so the
     first press of any play button finds them already waiting — the
     11-25s director latency happens while the reader is still reading
     the intro, not while they are listening. */
  (async () => {
    for (let i = 0; i < tour.steps.length; i++) {
      try { await fetchDirector(tour.steps[i], i); } catch { /* next */ }
    }
  })();
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

  for (const dir of plan.stage || []) {
    stageDirections[dir.step] = { verse: dir.verse, marks: (dir.marks || []).map((m) => ({ ...m, drawn: false })) };
  }
}

// -------------------------------------------------- the director's pass

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

/* The server resolved every cue to seconds; here that becomes one flat
   schedule. The page fires whatever is due — order-proof, replay-proof,
   and immune to a model that numbered its scenes wrong. */
function beginDirection(li, index, scenes) {
  if (!current || current.li !== li || !scenes?.length) return;
  const timeline = [];
  const copy = scenes.map((s, i) => {
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
    timeline.push({ at: sc.at ?? 0, kind: 'scene', scene: sc, idx: i });
    for (const g of sc.groups) {
      for (const wt of g.wordTimes || []) {
        if (wt.at != null && wt.at < (g.at ?? Infinity)) timeline.push({ at: wt.at, kind: 'word', scene: sc, word: wt.word });
      }
      timeline.push({ at: g.at ?? sc.at ?? 0, kind: 'group', scene: sc, a: g });
    }
    for (const [kind, list] of [['footnote', sc.footnotes], ['term', sc.terms], ['allusion', sc.allusions], ['aside', sc.asides || []]]) {
      for (const a of list) timeline.push({ at: a.at ?? sc.at ?? 0, kind, scene: sc, a });
    }
    for (const [kind, a] of [['compare', sc.compare], ['chain', sc.chain], ['caveat', sc.caveat], ['highlight', sc.highlight]]) {
      if (a) timeline.push({ at: a.at ?? sc.at ?? 0, kind, scene: sc, a });
    }
    return sc;
  });
  timeline.sort((x, y) => x.at - y.at);
  current.scenes = copy;
  current.timeline = timeline;
  current.fired = 0;
  current.sceneIdx = -1;
}

const TH_BOXES = ['.compare', '.chain', '.terms', '.allusions', '.footnotes', '.caveats', '.asides'];

function activateScene(scene, idx) {
  if (!current || idx <= current.sceneIdx) return;
  current.sceneIdx = idx;
  const th = TH();
  const body = th.querySelector('.th-body');
  /* Exits are choreographed like entrances: the page breathes out, turns,
     and breathes back in — nothing is ever simply gone. */
  const firstScene = idx === 0 && !body.classList.contains('turning');
  body.classList.add('turning');
  releaseHighlight();
  const token = current.playToken;
  setTimeout(() => {
    if (current?.playToken !== token || current.scenes?.[current.sceneIdx] !== scene) return;
    for (const sel of TH_BOXES) th.querySelector(sel).innerHTML = '';
    const q = th.querySelector('.verses');
    q.innerHTML = scene.verses.map((v) => `<sup>${v.verse}</sup>${escapeHtml(v.text)}`).join(' ')
      + `<span class="verses-ref">${escapeHtml(scene.ref)}</span>`;
    q.classList.add('has');
    body.classList.remove('turning');
  }, firstScene ? 40 : 420);
}

/* One event from the schedule lands on the stage. Anything that needs the
   verse's laid-out geometry retries once, a beat after the scene's fade. */
function renderEvent(ev) {
  if (!current) return;
  const th = TH();
  const verseReady = th.querySelector('.verses').classList.contains('has');
  if (!verseReady && ['word', 'group', 'footnote'].includes(ev.kind)) {
    /* Deferred renders carry their play's token: a retry from one clip can
       never land on the next clip's stage. */
    const token = current.playToken;
    setTimeout(() => { if (current?.playToken === token) renderEvent(ev); }, 380);
    return;
  }
  switch (ev.kind) {
    case 'scene':
      activateScene(ev.scene, ev.idx);
      break;
    case 'word': {
      /* A word lights the moment it is said; its bracket completes when
         the group does. */
      if (current.scenes?.[current.sceneIdx] !== ev.scene) break;
      const span = getOrWrap(th.querySelector('.verses'), ev.word);
      span?.classList.add('lit');
      break;
    }
    case 'group':
      if (current.scenes?.[current.sceneIdx] === ev.scene) drawMark(ev.a);
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
      const q = th.querySelector('.verses');
      const span = getOrWrap(q, ev.a.word);
      if (span && !span.querySelector('.fnmark')) span.insertAdjacentHTML('beforeend', '<sup class="fnmark">†</sup>');
      const el = document.createElement('p');
      el.className = 'footnote appear';
      el.innerHTML = `<sup>†</sup> <b>${escapeHtml(ev.a.word)}</b> — ${escapeHtml(ev.a.note)}`;
      th.querySelector('.footnotes').appendChild(el);
      break;
    }
    case 'compare': {
      const { a, b, note, axis } = ev.a;
      /* likeness underlines what binds the two texts; difference underlines
         each side's own pivots — the same box, cutting the other way. */
      const common = sharedWords(a.text, b.text);
      const marksFor = (own, other) => axis === 'difference'
        ? sharedWords(own, own).filter((w) => !sharedWords(other, other).includes(w)).slice(0, 5)
        : common;
      const el = document.createElement('div');
      el.className = 'compare-grid appear';
      el.innerHTML = [[a, b.text], [b, a.text]].map(([side, otherText]) =>
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
      el.className = 'chain-box appear';
      th.querySelector('.chain').appendChild(el);
      const chainToken = current.playToken;
      ev.a.links.forEach((l, i) => {
        setTimeout(() => {
          if (current?.playToken !== chainToken || !el.isConnected) return;
          const link = document.createElement('div');
          link.className = 'chain-link appear';
          link.innerHTML = `<span class="box-ref">${escapeHtml(l.ref)}</span>${wrapBoxWords(trim(l.text, 110))}`;
          el.appendChild(link);
          if (i === ev.a.links.length - 1 && ev.a.note) {
            el.insertAdjacentHTML('beforeend', `<span class="box-note">${escapeHtml(ev.a.note)}</span>`);
          }
        }, i * 900);
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
      requestAnimationFrame(() => bq.classList.add('show'));
      th.querySelector('.verses').classList.add('dimmed');
      clearTimeout(current.hlTimer);
      current.hlTimer = setTimeout(releaseHighlight, 11000);
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

function releaseHighlight() {
  const th = TH();
  const bq = th.querySelector('.big-quote');
  bq.classList.remove('show');
  setTimeout(() => { if (!bq.classList.contains('show')) bq.classList.remove('mounted'); }, 950);
  th.querySelector('.verses').classList.remove('dimmed');
  if (current) clearTimeout(current.hlTimer);
}

function getOrWrap(root, word) {
  const existing = root.querySelector(`.sword[data-w="${CSS.escape(word)}"]`);
  if (existing) return existing;
  const span = wrapWord(root, word);
  if (span) span.dataset.w = word;
  return span;
}

// ------------------------------------- the loom, performed in the theater
// All geometry is house arithmetic: each group is assigned the first
// gutter lane whose occupied span it does not intersect, so brackets
// share lanes when they can and step outward only when they must.

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

function drawMark(mark) {
  const q = TH().querySelector('.verses');
  if (!q?.classList.contains('has')) return;
  const spans = mark.words.map((w) => getOrWrap(q, w)).filter(Boolean);
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
  const lane = -14 - laneIndex * 11;


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
  const slotForY = (wantY) => {
    let y = wantY;
    let step = 0;
    while (svg._labelSlots.some((v) => Math.abs(v - y) < 13)) {
      step += 1;
      y = wantY + (step % 2 ? 1 : -1) * Math.ceil(step / 2) * 15;
    }
    svg._labelSlots.push(y);
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
    if (window.innerWidth >= 900) {
      label.setAttribute('x', lane - 8);
      label.setAttribute('y', labelY);
      label.setAttribute('text-anchor', 'end');
    } else {
      label.setAttribute('x', lane - 5);
      label.setAttribute('y', midY);
      label.setAttribute('text-anchor', 'middle');
      label.setAttribute('transform', `rotate(-90 ${lane - 5} ${midY})`);
    }
    label.textContent = mark.label;
    g.appendChild(label);
  }
  const len = path.getTotalLength();
  path.style.strokeDasharray = String(len);
  path.style.strokeDashoffset = String(len);
  requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
}

/* The fallback layer when the director has no scenes: the plan's stage
   direction, or the passage the why cites. */
function fallbackVerse(step, index) {
  const dirRef = stageDirections[index]?.verse;
  const m = dirRef
    ? String(dirRef).match(/^([1-3]?\s?[A-Za-z ]+?)\s+(\d{1,3})(?::(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?)?$/)
    : String(step.why || '').match(/\b([1-3]?\s?[A-Z][a-z]+)\s+(\d{1,3}):(\d{1,3})(?:\s*[–-]\s*(\d{1,3}))?/);
  if (!m) return;
  const from = m[3] ? Number(m[3]) : 1;
  const to = m[4] ? Math.min(Number(m[4]), from + 5) : (m[3] ? from : 4);
  fetch(`/api/passage?book=${encodeURIComponent(m[1])}&chapter=${m[2]}&from=${from}&to=${to}`)
    .then((r) => r.json())
    .then((p) => {
      if (p.error || !p.verses?.length || !current || current.index !== index || current.scenes) return;
      const q = TH().querySelector('.verses');
      q.innerHTML = p.verses.map((v) => `<sup>${v.verse}</sup>${markRelevant(v.text, current.phrases)}`).join(' ')
        + `<span class="verses-ref">${escapeHtml(`${p.bookName} ${p.chapter}:${from}${to > from ? '–' + to : ''}`)}</span>`;
      q.classList.add('has');
    })
    .catch(() => {});
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

function toggleStep(li, step, index) {
  if (pendingPlay === index) { pendingPlay = null; li.querySelector('.play').classList.remove('waiting'); return; }
  if (current && current.li === li) { stopAudio(); return; }
  stopAudio();
  if (!step.audioUrl) { honestNote(li, 'This publisher keeps its audio on its own site.'); return; }
  /* The stage never opens undirected: if this step's directions are still
     on their way (rare — they prefetch while the intro is read), the press
     waits for them, the button breathing quietly instead of spinning. */
  if (!directorCache[index]) {
    pendingPlay = index;
    li.querySelector('.play').classList.add('waiting');
    fetchDirector(step, index).then(() => {
      li.querySelector('.play').classList.remove('waiting');
      if (pendingPlay !== index) return;
      pendingPlay = null;
      toggleStep(li, step, index);
    });
    return;
  }
  current = { li, step, index, segments: null, phrases: quotedPhrases(step.why), capKey: null, scenes: null, timeline: null, fired: 0, sceneIdx: -1, playToken: ++playCounter };
  li.classList.add('playing');

  const th = TH();
  th.querySelector('.th-source').textContent = step.source || step.sourceId;
  th.querySelector('.th-title').textContent = step.episodeTitle;
  th.querySelector('.th-whisper').textContent = '';
  th.querySelector('.verses').classList.remove('has');
  th.querySelector('.verses').innerHTML = '';
  th.querySelector('.big-quote').classList.remove('show');
  th.querySelector('.caption').classList.remove('show');
  for (const sel of TH_BOXES) th.querySelector(sel).innerHTML = '';
  th.querySelector('.th-progress i').style.width = '0%';
  th.classList.add('on');
  document.body.classList.add('in-theater');

  player.src = step.audioUrl;
  player.currentTime = step.startSec;
  player.volume = 0;
  player.play().then(() => fadeTo(1, 420)).catch(() => {
    honestNote(li, 'This publisher asks you to listen on their own site — the tour will still be here.');
    stopAudio();
  });

  const w = whispers[index];
  if (w) {
    th.querySelector('.th-whisper').textContent = w;
    setTimeout(() => th.querySelector('.th-whisper').classList.add('show'), 700);
  }

  fetch(`/api/window?recordId=${encodeURIComponent(step.recordId)}&from=${step.startSec}&to=${step.endSec}`)
    .then((r) => r.json())
    .then((d) => { if (current && current.li === li && Array.isArray(d.segments)) current.segments = d.segments; })
    .catch(() => {});

  fetchDirector(step, index).then((d) => beginDirection(li, index, d.scenes));
  fallbackVerse(step, index);

  player.ontimeupdate = () => {
    if (!current) return;
    const t = player.currentTime;
    updateCaption(t);
    const frac = (t - step.startSec) / (step.endSec - step.startSec);
    th.querySelector('.th-progress i').style.width = `${Math.max(0, Math.min(100, frac * 100))}%`;
    if (current.timeline) {
      /* The schedule, resolved server-side, simply plays out. */
      const rel = t - step.startSec;
      while (current.fired < current.timeline.length && current.timeline[current.fired].at <= rel) {
        renderEvent(current.timeline[current.fired]);
        current.fired += 1;
        if (!current) return;
      }
    } else if (frac > 0.7) {
      const dir = stageDirections[index];
      for (const mark of dir?.marks || []) {
        if (!mark.drawn) { mark.drawn = true; drawMark(mark); }
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
