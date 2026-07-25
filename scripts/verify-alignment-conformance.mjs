#!/usr/bin/env node
/**
 * Check every occurrence-alignment package against ONE shared contract.
 *
 *   node scripts/verify-alignment-conformance.mjs
 *   node scripts/verify-alignment-conformance.mjs --all     # include lab artifacts
 *   node scripts/verify-alignment-conformance.mjs --json
 *
 * WHY THIS IS NOT THE FRESHNESS CHECK.  `verify-alignment-freshness` asks "has the text
 * moved under this artifact?".  This asks a different question: "does this artifact obey
 * the same rules as every other one?"  Each package was built by a different pass, and
 * they agree on the format only as far as someone happened to look.
 *
 * The check that motivated this: YLT emitted UNCOVERED display words as 3-tuples,
 * structurally identical to whitespace gaps, while BSB and ULT give every display word a
 * group id.  192,637 words -- one in five -- were invisible to any consumer that finds
 * display words by "has a group id", which is what the BSB meta row specifies.  The file
 * was internally consistent, passed every count, every row check and every integrity test,
 * and was silently a different format.  Nothing was looking across packages.
 *
 * The contract is BSB's own meta row, which is the normative description:
 *   index_0  inclusive UTF-16 char_start
 *   index_1  exclusive UTF-16 char_end
 *   index_2  sorted unique 1-based backbone positions; empty means uncovered
 *   index_3  present on authored display words, omitted on ungrouped gaps
 *   gap_policy: uncovered text is RETAINED with an empty occurrence list
 *
 * ERROR   would corrupt or silently mislead a consumer.  Exits non-zero.
 * WARN    legal but divergent; reported so drift is visible rather than discovered later.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const ALL = argv.includes('--all');
const AS_JSON = argv.includes('--json');

const PACKAGES = [
  { id: 'bsb', file: 'data/scripture/packages/bsb/occurrence-alignments-v1.jsonl', text: 'data/scripture/text/bsb', reference: true },
  { id: 'ylt', file: 'data/scripture/packages/ylt/occurrence-alignments-v1.jsonl', text: 'data/scripture/text/ylt' },
  { id: 'web', file: 'data/scripture/packages/web/occurrence-alignments-v1.jsonl', text: 'data/scripture/text/web' },
  { id: 'kjv', file: 'data/scripture/packages/kjv/occurrence-alignments-v1.jsonl', text: 'data/scripture/text/kjv' },
  { id: 'lab/akjv', lab: true, file: 'lab/spine-v1/akjv-occurrence/akjv-occurrence-alignments-v1.jsonl', text: 'data/scripture/text/akjv-strongs' },
  { id: 'lab/ult', lab: true, file: 'lab/spine-v1/ult-occurrence/ult-occurrence-alignments-v1.jsonl', textJson: 'lab/spine-v1/ult-occurrence/ult-text-by-backbone.json' },
  { id: 'lab/ult+jer', lab: true, file: 'lab/spine-v1/span-policy/ult-occurrence-alignments-v1-jer.jsonl', textJson: 'lab/spine-v1/ult-occurrence/ult-text-by-backbone.json' },
];

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

// ---------------------------------------------------------------- backbone inventory
function loadBackbone() {
  const counts = new Map();
  const data = fs.readFileSync(path.join(REPO, 'data/scripture/backbone-token-v1.jsonl'), 'utf8');
  for (const line of data.split('\n')) {
    if (!line.trim()) continue;
    const o = JSON.parse(line);
    if (o.type !== 'backbone-token-verse') continue;
    counts.set(o.ref.replace(/^bref:v1\//, ''), (o.tokens || []).length);
  }
  return counts;
}

function loadText(p) {
  const m = new Map();
  if (p.textJson) {
    const f = path.join(REPO, p.textJson);
    if (!fs.existsSync(f)) return null;
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(f, 'utf8')))) m.set(k, v);
    return m;
  }
  const base = path.join(REPO, p.text);
  if (!fs.existsSync(base)) return null;
  for (const book of fs.readdirSync(base)) {
    const bd = path.join(base, book);
    if (!fs.statSync(bd).isDirectory()) continue;
    for (const fn of fs.readdirSync(bd)) {
      if (!fn.endsWith('.json')) continue;
      for (const v of JSON.parse(fs.readFileSync(path.join(bd, fn), 'utf8')).verses) {
        m.set(`${book}.${fn.slice(0, -5)}.${v.verse}`, v.text);
      }
    }
  }
  return m;
}

const BACKBONE = loadBackbone();

function inspect(p) {
  const file = path.join(REPO, p.file);
  const R = { id: p.id, file: p.file, errors: {}, warns: {}, examples: {},
              rows: 0, present: 0, absent: 0, words: 0, gaps: 0, linkedWords: 0, meta: null };
  const err = (k, ex) => { R.errors[k] = (R.errors[k] || 0) + 1; if (ex && (R.examples[k] ||= []).length < 4) R.examples[k].push(ex); };
  const warn = (k, ex) => { R.warns[k] = (R.warns[k] || 0) + 1; if (ex && (R.examples[k] ||= []).length < 4) R.examples[k].push(ex); };

  if (!fs.existsSync(file)) { R.fatal = 'missing-artifact'; return R; }
  const text = loadText(p);
  if (!text) { R.fatal = 'missing-text'; return R; }

  const seen = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch { err('unparseable-line'); continue; }

    if (o.type === 'occurrence-alignment-meta') { R.meta = o; continue; }
    if (o.type !== 'occurrence-alignment-verse') { warn('unknown-row-type', o.type); continue; }

    R.rows++;
    const ref = (o.ref || '').replace(/^bref:v1\//, '');
    if (!o.ref) err('row-without-ref');
    if (seen.has(ref)) err('duplicate-ref', ref);
    seen.add(ref);
    if (!BACKBONE.has(ref)) err('ref-not-in-backbone', ref);

    if (o.target_state === 'absent') {
      R.absent++;
      if (Array.isArray(o.fragments) && o.fragments.length) err('absent-row-carries-fragments', ref);
      if (o.text_sha256) err('absent-row-carries-digest', ref);
      continue;
    }
    if (o.target_state !== 'present') { err('bad-target-state', `${ref}:${o.target_state}`); continue; }
    R.present++;

    const t = text.get(ref);
    if (t == null) { warn('present-row-without-text', ref); continue; }
    if (typeof o.text_sha256 !== 'string') err('present-row-without-digest', ref);
    else if (o.text_sha256 !== sha(t)) err('digest-mismatch', ref);
    if (o.text_utf16_length !== t.length) err('length-field-wrong', `${ref} ${o.text_utf16_length}!=${t.length}`);

    const frs = o.fragments;
    if (!Array.isArray(frs)) { err('present-row-without-fragments', ref); continue; }

    let cursor = 0;
    const npos = BACKBONE.get(ref) ?? 0;
    for (const f of frs) {
      if (!Array.isArray(f) || f.length < 3 || f.length > 4) { err('bad-tuple-shape', `${ref} ${JSON.stringify(f)}`); continue; }
      const [a, b, pos, grp] = f;
      if (!Number.isInteger(a) || !Number.isInteger(b)) err('non-integer-offsets', ref);
      if (b <= a) err('non-positive-span', `${ref} [${a},${b}]`);
      if (a < 0 || b > t.length) err('offset-out-of-text', `${ref} [${a},${b}] len=${t.length}`);
      if (a !== cursor) err(a < cursor ? 'fragments-overlap' : 'fragments-leave-gap', `${ref} at ${a}, expected ${cursor}`);
      cursor = Math.max(cursor, b);

      if (!Array.isArray(pos)) { err('index2-not-array', ref); continue; }
      if (pos.some((q) => !Number.isInteger(q))) err('position-not-integer', ref);
      if (pos.some((q) => q < 1)) err('position-not-1-based', ref);
      if (pos.some((q) => q > npos)) err('position-exceeds-backbone', `${ref} max=${npos}`);
      for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) { err('positions-unsorted-or-duplicated', ref); break; }

      // ---- THE CROSS-PACKAGE RULE the YLT bug violated
      // A display word is signalled by index_3, NOT by its content.  BSB legitimately
      // groups an authored punctuation mark ('”' in GEN.37.35 carries group 26050 and
      // position 9 alongside the words around it), and legitimately gaps display-only
      // insertions that contain letters (' [of silver] ' in EXO.38.28).  Judging by
      // content instead of by group id misreads both.
      const slice = t.slice(a, b);
      const hasLetters = /[\p{L}\p{N}]/u.test(slice);
      if (f.length === 4) {
        R.words++;
        if (pos.length) R.linkedWords++;
        if (grp === null || grp === undefined) err('null-group-id', ref);
      } else {
        R.gaps++;
        // a fragment with no group id is a gap, and a gap cannot be aligned
        if (pos.length) err('groupless-fragment-carries-positions', `${ref} [${a},${b}] ${JSON.stringify(slice)}`);
        // ...and real word content should not be hiding in one.  A handful is deliberate
        // (display-only insertions); a fifth of the corpus is a format divergence.
        if (hasLetters) {
          R.grouplessLetters = (R.grouplessLetters || 0) + 1;
          if ((R.examples['word-content-in-groupless-fragment'] ||= []).length < 4)
            R.examples['word-content-in-groupless-fragment'].push(`${ref} ${JSON.stringify(slice)} [${a},${b}]`);
        }
      }
    }
    if (cursor !== t.length) err('fragments-do-not-tile-to-end', `${ref} ended ${cursor} of ${t.length}`);
  }

  // ---- coverage of the backbone ref set
  for (const ref of BACKBONE.keys()) if (!seen.has(ref)) { warn('backbone-ref-missing-from-package', ref); }
  if (!R.meta) err('no-meta-row');
  else {
    if (R.meta.target_offset_unit !== 'utf16-code-unit') warn('meta-offset-unit-differs', R.meta.target_offset_unit);
    if (!R.meta.package_id) warn('meta-without-package-id');
    if (R.meta.format_version !== 1) warn('meta-format-version-differs', R.meta.format_version);
  }
  // Rate-based divergence: BSB has 4 deliberate display-only insertions; YLT had 192,637
  // and AKJV 461,450 because they emit every UNCOVERED word this way.  Threshold, not zero.
  const gl = R.grouplessLetters || 0;
  const totalFrags = R.words + R.gaps;
  R.grouplessLetterPct = totalFrags ? +(100 * gl / totalFrags).toFixed(3) : 0;
  if (gl) {
    const key = 'word-content-in-groupless-fragment';
    if (R.grouplessLetterPct > 0.5) R.errors[key] = gl; else R.warns[key] = gl;
  }
  R.errorCount = Object.values(R.errors).reduce((a, b) => a + b, 0);
  R.warnCount = Object.values(R.warns).reduce((a, b) => a + b, 0);
  R.linkedWordPct = R.words ? +(100 * R.linkedWords / R.words).toFixed(2) : null;
  return R;
}

const results = PACKAGES.filter((p) => ALL || !p.lab).map(inspect);
let failed = 0;
for (const r of results) if (r.fatal || r.errorCount) failed++;

if (AS_JSON) {
  console.log(JSON.stringify({ ok: failed === 0, results }, null, 1));
} else {
  for (const r of results) {
    if (r.fatal) { console.log(`[conform] FATAL   ${r.id.padEnd(12)} ${r.fatal}`); continue; }
    const st = r.errorCount ? 'FAIL   ' : r.warnCount ? 'ok/warn' : 'ok     ';
    console.log(`[conform] ${st} ${r.id.padEnd(12)} rows=${r.rows} present=${r.present} absent=${r.absent} words=${r.words} linked=${r.linkedWordPct}% errors=${r.errorCount} warns=${r.warnCount}`);
    for (const [k, n] of Object.entries(r.errors).sort((a, b) => b[1] - a[1])) {
      console.log(`            ERROR  ${k} x${n}`);
      for (const e of (r.examples[k] || []).slice(0, 3)) console.log(`                   e.g. ${e}`);
    }
    for (const [k, n] of Object.entries(r.warns).sort((a, b) => b[1] - a[1])) {
      console.log(`            warn   ${k} x${n}`);
      for (const e of (r.examples[k] || []).slice(0, 2)) console.log(`                   e.g. ${e}`);
    }
  }
  console.log(failed
    ? `\n[conform] FAILED — ${failed} package(s) violate the shared contract.`
    : `\n[conform] all ${results.length} package(s) conform.`);
}
process.exit(failed ? 1 : 0);
