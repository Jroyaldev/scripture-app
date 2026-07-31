// Tour Lab corpus layer.
//
// Read-only view over ~/ScriptureLibrary/.artifacts. Nothing here ever writes
// into the library; the only writes go to lab/tour-lab/.cache.
//
// Retrieval is deliberately two-stage so the 27.6M-token corpus is indexed once
// and never re-scanned per query:
//   stage 1  BM25 over whole episodes, from a cached inverted index
//   stage 2  windowed re-scoring inside the top episodes, loaded on demand
// Stage 2 is what produces the timestamps a tour step needs.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const CACHE_DIR = path.join(LAB_DIR, '.cache');

export const ARTIFACTS_DIR =
  process.env.TOUR_LAB_ARTIFACTS || path.join(os.homedir(), 'ScriptureLibrary', '.artifacts');

const TRANSCRIPTS_DIR = path.join(ARTIFACTS_DIR, 'transcripts');
const REFERENCES_DIR = path.join(ARTIFACTS_DIR, 'references');
const PASSAGE_INDEX = path.join(ARTIFACTS_DIR, 'passage-index.json');

const INDEX_VERSION = 3;

// recordIds carry colons; the artifact filenames mangle them to double underscore.
export const idToFile = (recordId) => `${String(recordId).split(':').join('__')}.json`;
export const fileToId = (file) => file.replace(/\.json$/, '').split('__').join(':');

const STOPWORDS = new Set(
  `a about above after again against all also am an and any are aren as at be because been before being
   below between both but by can cannot could couldn did didn do does doesn doing don down during each few
   for from further had hadn has hasn have haven having he her here hers herself him himself his how i if in
   into is isn it its itself just let ll me more most my myself no nor not of off on once only or other ought
   our ours ourselves out over own re same shan she should shouldn so some such than that the their theirs
   them themselves then there these they this those through to too under until up ve very was wasn we were
   weren what when where which while who whom why will with won would wouldn you your yours yourself
   yourselves gonna kind sort like really actually think know say says said thing things going want way lot
   yeah okay right well one two get got make made take see look come go`
    .split(/\s+/)
    .filter(Boolean)
);

// Conservative suffix folding: applied identically at index and query time, and
// never allowed to chew a word below four characters.
export function foldTerm(raw) {
  let t = raw;
  if (t.length > 6 && t.endsWith('ations')) t = t.slice(0, -6);
  else if (t.length > 5 && t.endsWith('ation')) t = t.slice(0, -5);
  else if (t.length > 6 && t.endsWith('ness')) t = t.slice(0, -4);
  else if (t.length > 6 && t.endsWith('ing')) t = t.slice(0, -3);
  else if (t.length > 6 && t.endsWith('ed')) t = t.slice(0, -2);
  else if (t.length > 6 && t.endsWith('ly')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('es') && !t.endsWith('ses')) t = t.slice(0, -2);
  else if (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') && !t.endsWith('us')) t = t.slice(0, -1);
  return t;
}

export function tokenize(text) {
  const out = [];
  const raw = String(text).toLowerCase().match(/[a-z0-9']+/g);
  if (!raw) return out;
  for (const w of raw) {
    const trimmed = w.replace(/^'+|'+$/g, '');
    if (trimmed.length < 3) continue;
    if (STOPWORDS.has(trimmed)) continue;
    out.push(foldTerm(trimmed));
  }
  return out;
}

const SOURCE_NAMES = {
  'ask-nt-wright': 'Ask NT Wright Anything',
  bibleproject: 'BibleProject',
  'five-minutes-church-history': '5 Minutes in Church History',
  'forty-minutes-ot': '40 Minutes in the Old Testament',
  'listeners-commentary': "The Listener's Commentary",
  'naked-bible': 'Naked Bible Podcast',
  'radically-christian': 'Radically Christian',
  'spoken-gospel': 'Spoken Gospel',
};

// Hosts that stitch ads in at request time, so a stored timestamp can sit
// meaningfully ahead of the same moment in today's stream.
const DRIFTING_SOURCES = new Set(['ask-nt-wright', 'spoken-gospel']);

export const sourceName = (id) => SOURCE_NAMES[id] || id;
export const sourceDrifts = (id) => DRIFTING_SOURCES.has(id);

// ---------------------------------------------------------------- index build

function readTranscriptFile(file) {
  const raw = fs.readFileSync(path.join(TRANSCRIPTS_DIR, file), 'utf8');
  return JSON.parse(raw);
}

export function indexExists() {
  return (
    fs.existsSync(path.join(CACHE_DIR, 'meta.json')) &&
    fs.existsSync(path.join(CACHE_DIR, 'postings.bin')) &&
    fs.existsSync(path.join(CACHE_DIR, 'terms.json')) &&
    fs.existsSync(path.join(CACHE_DIR, 'episodes.json')) &&
    JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'meta.json'), 'utf8')).version === INDEX_VERSION
  );
}

export function buildIndex({ onProgress } = {}) {
  const started = Date.now();
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const files = fs.readdirSync(TRANSCRIPTS_DIR).filter((f) => f.endsWith('.json')).sort();

  const episodes = [];
  /** @type {Map<string, number[]>} term -> flat [docId, tf, docId, tf, ...] */
  const postings = new Map();
  const docLens = new Int32Array(files.length);

  for (let docId = 0; docId < files.length; docId += 1) {
    const file = files[docId];
    let t;
    try {
      t = readTranscriptFile(file);
    } catch {
      episodes.push(null);
      continue;
    }
    const id = t.id || fileToId(file);
    const sourceId = String(id).split(':')[0];
    episodes.push({
      id,
      title: t.title || id,
      sourceId,
      audioUrl: t.audioUrl || null,
      audioSeconds: Math.round(Number(t.audioSeconds) || Number(t.lastWordEnd) || 0),
      segments: Array.isArray(t.segments) ? t.segments.length : 0,
      brefs: Array.isArray(t.brefs) ? t.brefs.slice(0, 24) : [],
    });

    const terms = tokenize(`${t.title || ''} ${t.title || ''} ${t.text || ''}`);
    docLens[docId] = terms.length;
    const tf = new Map();
    for (const term of terms) tf.set(term, (tf.get(term) || 0) + 1);
    for (const [term, n] of tf) {
      let arr = postings.get(term);
      if (!arr) {
        arr = [];
        postings.set(term, arr);
      }
      arr.push(docId, n);
    }
    if (onProgress && docId % 250 === 0) onProgress({ done: docId, total: files.length });
  }

  // Prune: corpus-wide noise words and one-off transcription garbage.
  const docCount = files.length;
  const maxDf = Math.floor(docCount * 0.6);
  const termIndex = {};
  const flat = [];
  for (const [term, arr] of postings) {
    const df = arr.length / 2;
    if (df > maxDf) continue;
    let total = 0;
    for (let i = 1; i < arr.length; i += 2) total += arr[i];
    if (df < 2 && total < 3) continue;
    termIndex[term] = [flat.length, df];
    for (const v of arr) flat.push(v);
  }

  const buf = Int32Array.from(flat);
  fs.writeFileSync(path.join(CACHE_DIR, 'postings.bin'), Buffer.from(buf.buffer));
  fs.writeFileSync(path.join(CACHE_DIR, 'doclens.bin'), Buffer.from(docLens.buffer));
  fs.writeFileSync(path.join(CACHE_DIR, 'terms.json'), JSON.stringify(termIndex));
  fs.writeFileSync(path.join(CACHE_DIR, 'episodes.json'), JSON.stringify(episodes));
  const meta = {
    version: INDEX_VERSION,
    builtAt: new Date().toISOString(),
    buildMs: Date.now() - started,
    docCount,
    termCount: Object.keys(termIndex).length,
    postingCount: flat.length / 2,
    avgLen: docLens.reduce((a, b) => a + b, 0) / Math.max(1, docCount),
    artifactsDir: ARTIFACTS_DIR,
  };
  fs.writeFileSync(path.join(CACHE_DIR, 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}

// ---------------------------------------------------------------- index load

let INDEX = null;

export function loadIndex() {
  if (INDEX) return INDEX;
  if (!indexExists()) throw new Error('corpus index not built');
  const meta = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'meta.json'), 'utf8'));
  const terms = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'terms.json'), 'utf8'));
  const episodes = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, 'episodes.json'), 'utf8'));
  const pb = fs.readFileSync(path.join(CACHE_DIR, 'postings.bin'));
  const db = fs.readFileSync(path.join(CACHE_DIR, 'doclens.bin'));
  const postings = new Int32Array(pb.buffer, pb.byteOffset, Math.floor(pb.length / 4));
  const docLens = new Int32Array(db.buffer, db.byteOffset, Math.floor(db.length / 4));
  const byId = new Map();
  episodes.forEach((e, i) => {
    if (e) byId.set(e.id, { ...e, docId: i });
  });
  // Prototype-free: a transcript really can contain the word "constructor".
  INDEX = { meta, terms: Object.assign(Object.create(null), terms), episodes, postings, docLens, byId };
  return INDEX;
}

// ---------------------------------------------------------------- transcripts

const TRANSCRIPT_LRU = new Map();
const LRU_MAX = 24;

export function loadTranscript(recordId) {
  if (TRANSCRIPT_LRU.has(recordId)) {
    const v = TRANSCRIPT_LRU.get(recordId);
    TRANSCRIPT_LRU.delete(recordId);
    TRANSCRIPT_LRU.set(recordId, v);
    return v;
  }
  const file = path.join(TRANSCRIPTS_DIR, idToFile(recordId));
  if (!fs.existsSync(file)) return null;
  const t = JSON.parse(fs.readFileSync(file, 'utf8'));
  const segments = (Array.isArray(t.segments) ? t.segments : []).map((s) => ({
    t: s.t,
    s: Number(s.s) || 0,
    e: Number(s.e) || 0,
  }));
  const compact = {
    id: t.id || recordId,
    title: t.title || recordId,
    audioUrl: t.audioUrl || null,
    audioSeconds: Math.round(Number(t.audioSeconds) || Number(t.lastWordEnd) || 0),
    brefs: Array.isArray(t.brefs) ? t.brefs : [],
    segments,
  };
  TRANSCRIPT_LRU.set(recordId, compact);
  if (TRANSCRIPT_LRU.size > LRU_MAX) TRANSCRIPT_LRU.delete(TRANSCRIPT_LRU.keys().next().value);
  return compact;
}

export function episodeMeta(recordId) {
  const idx = loadIndex();
  return idx.byId.get(recordId) || null;
}

// ---------------------------------------------------------------- retrieval

function bm25Episodes(queryTerms, { sourceId, pool = 60 } = {}) {
  const idx = loadIndex();
  const N = idx.meta.docCount;
  const avg = idx.meta.avgLen || 1;
  const k1 = 1.2;
  const b = 0.75;
  const scores = new Map();
  const seen = new Set();
  for (const term of queryTerms) {
    if (seen.has(term)) continue;
    seen.add(term);
    const entry = idx.terms[term];
    if (!entry) continue;
    const [offset, df] = entry;
    const idf = Math.log(1 + (N - df + 0.5) / (df + 0.5));
    for (let i = 0; i < df; i += 1) {
      const docId = idx.postings[offset + i * 2];
      const tf = idx.postings[offset + i * 2 + 1];
      const ep = idx.episodes[docId];
      if (!ep) continue;
      if (sourceId && ep.sourceId !== sourceId) continue;
      const len = idx.docLens[docId] || avg;
      const denom = tf + k1 * (1 - b + (b * len) / avg);
      scores.set(docId, (scores.get(docId) || 0) + (idf * (tf * (k1 + 1))) / denom);
    }
  }
  return [...scores.entries()]
    .sort((a, b2) => b2[1] - a[1])
    .slice(0, pool)
    .map(([docId, score]) => ({ docId, score, episode: idx.episodes[docId] }));
}

const WINDOW_SECONDS = 50;

function bestWindows(transcript, queryTerms, { limit = 2 } = {}) {
  const segs = transcript.segments;
  if (!segs.length) return [];
  const wanted = new Map();
  for (const t of queryTerms) wanted.set(t, (wanted.get(t) || 0) + 1);
  const idx = loadIndex();
  const N = idx.meta.docCount;
  const idfOf = (t) => {
    const e = idx.terms[t];
    if (!e) return 0;
    return Math.log(1 + (N - e[1] + 0.5) / (e[1] + 0.5));
  };

  const scored = [];
  for (let i = 0; i < segs.length; i += 1) {
    const start = segs[i].s;
    let j = i;
    let text = '';
    while (j < segs.length && segs[j].e - start <= WINDOW_SECONDS) {
      text += `${segs[j].t} `;
      j += 1;
    }
    if (j === i) {
      text = segs[i].t;
      j = i + 1;
    }
    const toks = tokenize(text);
    let score = 0;
    const hitTerms = new Set();
    const counts = new Map();
    for (const tk of toks) if (wanted.has(tk)) counts.set(tk, (counts.get(tk) || 0) + 1);
    for (const [tk, c] of counts) {
      score += idfOf(tk) * (1 + Math.log(c));
      hitTerms.add(tk);
    }
    // Reward windows that carry several distinct query terms, not one repeated.
    score *= 1 + 0.35 * (hitTerms.size - 1);
    if (score > 0) {
      scored.push({
        startSec: Math.round(start),
        endSec: Math.round(segs[j - 1].e),
        score,
        matched: [...hitTerms],
        text: text.trim(),
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const w of scored) {
    if (picked.some((p) => Math.abs(p.startSec - w.startSec) < WINDOW_SECONDS * 2)) continue;
    picked.push(w);
    if (picked.length >= limit) break;
  }
  return picked;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function searchCorpus({ query, sourceId = null, limit = 8 }) {
  const terms = tokenize(query);
  if (!terms.length) return { query, hits: [], note: 'query had no indexable terms' };
  const pool = bm25Episodes(terms, { sourceId, pool: Math.max(24, limit * 5) });
  const hits = [];
  for (const cand of pool) {
    if (hits.length >= limit) break;
    const tr = loadTranscript(cand.episode.id);
    if (!tr) continue;
    const windows = bestWindows(tr, terms, { limit: 1 });
    if (!windows.length) continue;
    const w = windows[0];
    hits.push({
      recordId: cand.episode.id,
      title: cand.episode.title,
      sourceId: cand.episode.sourceId,
      source: sourceName(cand.episode.sourceId),
      durationSec: cand.episode.audioSeconds,
      atSec: w.startSec,
      matched: w.matched,
      quote: clip(w.text, 460),
      score: Number((cand.score + w.score / 4).toFixed(3)),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return { query, sourceId, hits };
}

// ---------------------------------------------------------------- passages

let PASSAGES = null;

function loadPassages() {
  if (PASSAGES) return PASSAGES;
  const raw = JSON.parse(fs.readFileSync(PASSAGE_INDEX, 'utf8'));
  const list = Array.isArray(raw.index) ? raw.index : Object.values(raw.index || {});
  const byChapter = new Map();
  const nameToCode = new Map();
  for (const entry of list) {
    if (!entry || !entry.book) continue;
    byChapter.set(`${entry.book}.${entry.chapter}`, entry);
    const sample = (entry.moments || [])[0];
    if (sample && sample.title) {
      const name = String(sample.title).replace(/\s+\d+(?::.*)?$/, '').trim();
      if (name) nameToCode.set(name.toLowerCase(), entry.book);
    }
    nameToCode.set(String(entry.book).toLowerCase(), entry.book);
  }
  PASSAGES = { byChapter, nameToCode, count: list.length };
  return PASSAGES;
}

function resolveBook(book) {
  const p = loadPassages();
  const key = String(book).trim().toLowerCase();
  if (p.nameToCode.has(key)) return p.nameToCode.get(key);
  const compact = key.replace(/\s+/g, ' ');
  for (const [name, code] of p.nameToCode) {
    if (name === compact) return code;
  }
  for (const [name, code] of p.nameToCode) {
    if (name.startsWith(compact) || compact.startsWith(name)) return code;
  }
  return null;
}

function versesTouch(spec, verse) {
  if (verse == null) return true;
  if (!spec) return true; // whole-chapter moment
  const n = Number(verse);
  for (const part of String(spec).split(/[,;]/)) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?/);
    if (!m) continue;
    const lo = Number(m[1]);
    const hi = m[2] ? Number(m[2]) : lo;
    if (n >= lo && n <= hi) return true;
  }
  return false;
}

export function momentsForPassage({ book, chapter, verse = null, limit = 25 }) {
  const code = resolveBook(book);
  if (!code) return { book, chapter, verse, moments: [], note: `unknown book "${book}"` };
  const entry = loadPassages().byChapter.get(`${code}.${Number(chapter)}`);
  if (!entry) return { book: code, chapter, verse, moments: [], note: 'no moments recorded for that chapter' };
  const moments = (entry.moments || [])
    .filter((m) => versesTouch(m.verses, verse))
    .slice(0, limit)
    .map((m) => ({
      recordId: m.id,
      episode: m.episode,
      sourceId: m.sourceId,
      source: m.sourceName || sourceName(m.sourceId),
      atSec: Math.round(Number(m.at) || 0),
      dwellSec: Math.round(Number(m.seconds) || 0),
      relation: m.relation,
      reference: m.title,
    }));
  return { book: code, chapter: Number(chapter), verse: verse == null ? null : Number(verse), total: (entry.moments || []).length, moments };
}

// ---------------------------------------------------------------- windows

export const MAX_WINDOW_SECONDS = 180;

export function transcriptWindow({ recordId, fromSec, toSec }) {
  const tr = loadTranscript(recordId);
  if (!tr) return { error: `unknown recordId "${recordId}"` };
  const from = Math.max(0, Math.floor(Number(fromSec) || 0));
  let to = Math.ceil(Number(toSec));
  if (!Number.isFinite(to) || to <= from) to = from + 60;
  let truncated = false;
  if (to - from > MAX_WINDOW_SECONDS) {
    to = from + MAX_WINDOW_SECONDS;
    truncated = true;
  }
  const parts = [];
  for (const s of tr.segments) {
    if (s.e < from) continue;
    if (s.s > to) break;
    parts.push(s.t);
  }
  return {
    recordId: tr.id,
    title: tr.title,
    fromSec: from,
    toSec: to,
    durationSec: tr.audioSeconds,
    truncated,
    truncationNote: truncated ? `windows are capped at ${MAX_WINDOW_SECONDS}s of transcript` : undefined,
    text: parts.join(' ').trim() || '(no transcript text in that span)',
  };
}

// ---------------------------------------------------------------- episode info

export function episodeInfo({ recordId }) {
  const meta = episodeMeta(recordId);
  const tr = loadTranscript(recordId);
  if (!meta && !tr) return { error: `unknown recordId "${recordId}"` };
  const base = meta || tr;
  let references = [];
  const refFile = path.join(REFERENCES_DIR, idToFile(recordId));
  if (fs.existsSync(refFile)) {
    try {
      const rj = JSON.parse(fs.readFileSync(refFile, 'utf8'));
      references = (rj.references || []).slice(0, 40).map((r) => ({
        reference: r.title,
        atSec: Math.round(Number(r.at) || 0),
        relation: r.relation,
        evidence: r.evidence ? clip(String(r.evidence), 160) : undefined,
      }));
    } catch {
      references = [];
    }
  }
  const outline = tr
    ? tr.segments
        .filter((_, i) => i % Math.max(1, Math.ceil(tr.segments.length / 12)) === 0)
        .slice(0, 12)
        .map((s) => ({ atSec: Math.round(s.s), text: clip(s.t, 120) }))
    : [];
  return {
    recordId: base.id,
    title: base.title,
    sourceId: base.sourceId || String(base.id).split(':')[0],
    source: sourceName(base.sourceId || String(base.id).split(':')[0]),
    durationSec: base.audioSeconds,
    audioUrl: base.audioUrl,
    adInsertionDrift: sourceDrifts(base.sourceId || String(base.id).split(':')[0]),
    scriptureMoments: references,
    outline,
  };
}

export function listSources() {
  const idx = loadIndex();
  const counts = new Map();
  for (const e of idx.episodes) {
    if (!e) continue;
    const cur = counts.get(e.sourceId) || { episodes: 0, seconds: 0 };
    cur.episodes += 1;
    cur.seconds += e.audioSeconds;
    counts.set(e.sourceId, cur);
  }
  return {
    corpusEpisodes: idx.meta.docCount,
    sources: [...counts.entries()]
      .map(([id, c]) => ({
        sourceId: id,
        name: sourceName(id),
        episodes: c.episodes,
        hours: Math.round(c.seconds / 360) / 10,
        adInsertionDrift: sourceDrifts(id),
      }))
      .sort((a, b) => b.episodes - a.episodes),
  };
}
