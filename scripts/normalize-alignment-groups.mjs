#!/usr/bin/env node
/**
 * Give every word-bearing fragment a group id, so "uncovered" is signalled by an empty
 * position list rather than by looking like whitespace.
 *
 *   node scripts/normalize-alignment-groups.mjs <artifact.jsonl> <textDir|textJson> [--write]
 *
 * Dry-run by default; --write edits in place.
 *
 * This is the repair for the divergence `verify-alignment-conformance` detects.  Two
 * artifacts shipped it independently (YLT 192,637 words, AKJV 461,450), which is why the
 * fix lives in a script rather than being applied by hand a third time.
 *
 * Only fragments containing a letter or digit are promoted.  Punctuation-only gaps are
 * left alone: BSB groups an authored punctuation mark when its source table says so, but
 * nothing licenses inventing that for an artifact whose builder never made the distinction.
 */
import fs from 'node:fs';
import path from 'node:path';

const [, , artifactArg, textArg, ...rest] = process.argv;
const WRITE = rest.includes('--write');
if (!artifactArg || !textArg) {
  console.error('usage: normalize-alignment-groups.mjs <artifact.jsonl> <textDir|textJson> [--write]');
  process.exit(2);
}
const artifact = path.resolve(artifactArg);
const textPath = path.resolve(textArg);
const HAS_WORD = /[\p{L}\p{N}]/u;

function loadText(p) {
  const m = new Map();
  if (fs.statSync(p).isFile()) {
    for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(p, 'utf8')))) m.set(k, v);
    return m;
  }
  for (const book of fs.readdirSync(p)) {
    const bd = path.join(p, book);
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

const text = loadText(textPath);
const out = [];
let rows = 0, promoted = 0, touchedRows = 0, skippedNoText = 0;

for (const line of fs.readFileSync(artifact, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  const o = JSON.parse(line);
  if (o.type === 'occurrence-alignment-verse' && o.target_state === 'present') {
    rows++;
    const t = text.get((o.ref || '').replace(/^bref:v1\//, ''));
    if (t == null) { skippedNoText++; out.push(JSON.stringify(o)); continue; }
    let next = 0;
    for (const f of o.fragments) if (f.length === 4 && Number.isInteger(f[3]) && f[3] > next) next = f[3];
    let touched = false;
    for (const f of o.fragments) {
      if (f.length === 4) continue;
      if (!HAS_WORD.test(t.slice(f[0], f[1]))) continue;
      f.push(++next);
      promoted++; touched = true;
    }
    if (touched) touchedRows++;
  }
  out.push(JSON.stringify(o));
}

console.log(`artifact : ${path.relative(process.cwd(), artifact)}`);
console.log(`rows     : ${rows}${skippedNoText ? `  (${skippedNoText} skipped, no text)` : ''}`);
console.log(`promoted : ${promoted} word-bearing fragments in ${touchedRows} rows`);
if (WRITE) {
  fs.writeFileSync(artifact, out.join('\n') + '\n');
  console.log('WRITTEN in place.  Rebuild any byte-offset index for this artifact.');
} else {
  console.log('dry run — pass --write to apply');
}
