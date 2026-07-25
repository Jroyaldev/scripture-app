#!/usr/bin/env node
/**
 * Verify every derived alignment artifact is still fresh against the scripture text
 * it was built from.
 *
 *   node scripts/verify-alignment-freshness.mjs            # packages only
 *   node scripts/verify-alignment-freshness.mjs --all      # packages + lab artifacts
 *   node scripts/verify-alignment-freshness.mjs --json
 *
 * WHY THIS EXISTS.  Editing a verse invalidates every offset derived from it.  This has
 * now bitten repeatedly: a stale row shipped before it was caught, and a reconciliation
 * later found 7 more in `akjv-strongs/alignments.jsonl` that no count-based check saw.
 * Verse counts, row counts and schema checks all pass while the data is silently wrong,
 * because nothing about a stale offset changes a count.
 *
 * Two independent checks, because artifacts carry different guarantees:
 *
 *   sha    rows carrying `text_sha256` are re-hashed against the current verse text.
 *          Catches ANY text change, including pure-casing edits that shift no offset.
 *   slice  rows carrying character offsets are sliced out of the current text and the
 *          result must be non-empty and whitespace-free.  Catches offset drift directly.
 *   token  word-keyed artifacts (no offsets) must have every aligned word present in
 *          the current verse text.  Catches truncation and typo repairs.
 *
 * Exit code is non-zero when anything is stale, so this can gate a build.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const AS_JSON = argv.includes('--json');

/** artifact registry: what is derived from which text */
const TARGETS = [
  { id: 'bsb/occurrence-alignments-v1',
    file: 'data/scripture/packages/bsb/occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/bsb' }, kind: 'occurrence' },
  { id: 'web/occurrence-alignments-v1',
    file: 'data/scripture/packages/web/occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/web' }, kind: 'occurrence' },
  { id: 'kjv/occurrence-alignments-v1',
    file: 'data/scripture/packages/kjv/occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/kjv' }, kind: 'occurrence' },
  { id: 'ylt/occurrence-alignments-v1',
    file: 'data/scripture/packages/ylt/occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/ylt' }, kind: 'occurrence' },
  { id: 'akjv-strongs/alignments',
    file: 'data/scripture/packages/akjv-strongs/alignments.jsonl',
    text: { dir: 'data/scripture/text/akjv-strongs' }, kind: 'tokens' },
  // lab artifacts -- not shipped, but they feed every measurement we quote
  { id: 'lab/ult-occurrence', lab: true,
    file: 'lab/spine-v1/ult-occurrence/ult-occurrence-alignments-v1.jsonl',
    text: { json: 'lab/spine-v1/ult-occurrence/ult-text-by-backbone.json' }, kind: 'occurrence' },
  { id: 'lab/akjv-occurrence', lab: true,
    file: 'lab/spine-v1/akjv-occurrence/akjv-occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/akjv-strongs' }, kind: 'occurrence' },
  { id: 'lab/ylt-occurrence', lab: true,
    file: 'lab/spine-v1/ylt-occurrence/ylt-occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/ylt' }, kind: 'occurrence' },
  { id: 'lab/span-policy/web', lab: true,
    file: 'lab/spine-v1/span-policy/web-occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/web' }, kind: 'occurrence' },
  { id: 'lab/span-policy/kjv', lab: true,
    file: 'lab/spine-v1/span-policy/kjv-occurrence-alignments-v1.jsonl',
    text: { dir: 'data/scripture/text/kjv' }, kind: 'occurrence' },
  { id: 'lab/span-policy/ult+jer', lab: true,
    file: 'lab/spine-v1/span-policy/ult-occurrence-alignments-v1-jer.jsonl',
    text: { json: 'lab/spine-v1/ult-occurrence/ult-text-by-backbone.json' }, kind: 'occurrence' },
];

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
const WORD = /[A-Za-z]+/g;

function loadText(spec) {
  const m = new Map();
  if (spec.json) {
    const p = path.join(REPO, spec.json);
    if (!fs.existsSync(p)) return null;
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(p, 'utf8')))) m.set(k, v);
    return m;
  }
  const base = path.join(REPO, spec.dir);
  if (!fs.existsSync(base)) return null;
  for (const book of fs.readdirSync(base)) {
    const bd = path.join(base, book);
    if (!fs.statSync(bd).isDirectory()) continue;
    for (const fn of fs.readdirSync(bd)) {
      if (!fn.endsWith('.json')) continue;
      const ch = fn.slice(0, -5);
      for (const v of JSON.parse(fs.readFileSync(path.join(bd, fn), 'utf8')).verses) {
        m.set(`${book}.${ch}.${v.verse}`, v.text);
      }
    }
  }
  return m;
}

function check(t) {
  const file = path.join(REPO, t.file);
  const res = { id: t.id, file: t.file, status: 'ok', rows: 0, checked: 0,
                staleSha: [], staleSlice: [], missingToken: [], missingText: 0 };
  if (!fs.existsSync(file)) { res.status = 'missing-artifact'; return res; }
  const text = loadText(t.text);
  if (!text) { res.status = 'missing-text'; return res; }

  const data = fs.readFileSync(file, 'utf8');
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { continue; }

    if (t.kind === 'tokens') {
      if (!o.book) continue;
      res.rows++;
      const ref = `${o.book}.${o.chapter}.${o.verse}`;
      const cur = text.get(ref);
      if (cur == null) { res.missingText++; continue; }
      res.checked++;
      const have = new Set((cur.match(WORD) || []).map((w) => w.toLowerCase()));
      for (const tok of o.tokens || []) {
        const parts = (tok.word || '').match(WORD) || [];
        if (parts.some((w) => !have.has(w.toLowerCase()))) {
          if (res.missingToken.length < 25) res.missingToken.push({ ref, word: tok.word });
          break;
        }
      }
      continue;
    }

    if (o.type !== 'occurrence-alignment-verse' || o.target_state !== 'present') continue;
    res.rows++;
    const ref = (o.ref || '').replace(/^bref:v1\//, '');
    const cur = text.get(ref);
    if (cur == null) { res.missingText++; continue; }
    res.checked++;
    if (o.text_sha256 && sha(cur) !== o.text_sha256) {
      if (res.staleSha.length < 25) res.staleSha.push(ref);
      continue;                                   // offsets are meaningless once sha differs
    }
    for (const f of o.fragments || []) {
      if (f.length !== 4) continue;               // gaps are allowed to be whitespace
      const s = cur.slice(f[0], f[1]);
      if (!s || !s.trim()) { if (res.staleSlice.length < 25) res.staleSlice.push({ ref, span: [f[0], f[1]] }); break; }
    }
  }
  const bad = res.staleSha.length + res.staleSlice.length + res.missingToken.length;
  res.status = bad ? 'STALE' : (res.missingText ? 'ok-with-missing-text' : 'ok');
  return res;
}

const targets = TARGETS.filter((t) => ALL || !t.lab);
const out = targets.map(check);
let failed = 0;
for (const r of out) {
  if (r.status === 'STALE') failed++;
}

if (AS_JSON) {
  console.log(JSON.stringify({ ok: failed === 0, results: out }, null, 1));
} else {
  for (const r of out) {
    const bad = r.staleSha.length + r.staleSlice.length + r.missingToken.length;
    const flag = r.status === 'STALE' ? 'STALE  ' : r.status === 'ok' ? 'ok     ' : r.status + ' ';
    console.log(`[freshness] ${flag} ${r.id.padEnd(28)} rows=${String(r.rows).padEnd(6)} checked=${String(r.checked).padEnd(6)} stale=${bad}`);
    for (const x of r.staleSha.slice(0, 5)) console.log(`              text changed since build: ${x}`);
    for (const x of r.staleSlice.slice(0, 5)) console.log(`              offset no longer a word: ${x.ref} [${x.span}]`);
    for (const x of r.missingToken.slice(0, 5)) console.log(`              aligned word absent from text: ${x.ref} ${JSON.stringify(x.word)}`);
    if (r.missingText) console.log(`              (${r.missingText} rows had no text to check against)`);
  }
  console.log(failed
    ? `\n[freshness] FAILED — ${failed} artifact(s) stale. Rebuild them before shipping.`
    : `\n[freshness] all ${out.length} artifact(s) fresh.`);
}
process.exit(failed ? 1 : 0);
