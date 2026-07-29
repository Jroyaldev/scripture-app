/**
 * Can a natural-language question find the conversation that answers it,
 * with no language model anywhere in the loop?
 *
 *   node --import tsx scripts/probe-question-search.ts
 *
 * THE FREE EVALUATION SET
 *
 * 136 of the episodes are titled with a question — "Can a City Be Good?",
 * "Are Humans Naturally Immortal?". Each is a real question a reader might ask,
 * and the episode it names is, by construction, where it is answered. Ground
 * truth with no labelling and no generated data.
 *
 * The measure is where the answering episode's windows land when the question
 * is scored against all 47,496 of them. Recall@1 is the hard version: of every
 * window in the corpus, is the single best one from the right episode?
 *
 * The title is stripped of its series prefix first, because "The City E6: Can a
 * City Be Good?" would otherwise be partly a lookup by series name, which is
 * not the thing being tested.
 */
import { openSync, readFileSync, readSync } from "node:fs";
import { join } from "node:path";
import { LocalEmbeddingProvider } from "../src/host/local-embeddings.js";

const LIBRARY = join(process.env["HOME"] ?? "", "ScriptureLibrary");
const VECTORS = "/Volumes/External/Transcripts/vectors.bin";
const DIM = 768;

interface Meta { srcId: string; dim: number; offset: number; start: number; episode: string }
const metas: Meta[] = [];
for (const line of readFileSync(`${VECTORS}.jsonl`, "utf-8").split("\n")) {
  if (!line) continue;
  let m: Meta;
  try { m = JSON.parse(line) as Meta; } catch { continue; }
  const cut = m.srcId.lastIndexOf("#");
  m.start = Number(m.srcId.slice(cut + 1));
  m.episode = m.srcId.slice(0, cut);
  metas.push(m);
}

const fd = openSync(VECTORS, "r");
const all = new Float32Array(metas.length * DIM);
{
  const buf = Buffer.allocUnsafe(DIM * 4);
  metas.forEach((m, i) => {
    readSync(fd, buf, 0, buf.length, m.offset);
    all.set(new Float32Array(buf.buffer, buf.byteOffset, DIM), i * DIM);
  });
}
console.log(`${metas.length} windows loaded`);

/* Centre and renormalise in place — the single transformation that mattered
   everywhere else it was measured. */
const centre = new Float32Array(DIM);
for (let i = 0; i < metas.length; i += 1) {
  for (let d = 0; d < DIM; d += 1) centre[d]! += all[i * DIM + d]!;
}
for (let d = 0; d < DIM; d += 1) centre[d]! /= metas.length;
for (let i = 0; i < metas.length; i += 1) {
  let n = 0;
  for (let d = 0; d < DIM; d += 1) { all[i * DIM + d]! -= centre[d]!; n += all[i * DIM + d]! ** 2; }
  n = Math.sqrt(n) || 1;
  for (let d = 0; d < DIM; d += 1) all[i * DIM + d]! /= n;
}

function centredQuery(v: Float32Array): Float32Array {
  const o = new Float32Array(DIM);
  let n = 0;
  for (let d = 0; d < DIM; d += 1) { o[d] = v[d]! - centre[d]!; n += o[d]! ** 2; }
  n = Math.sqrt(n) || 1;
  for (let d = 0; d < DIM; d += 1) o[d]! /= n;
  return o;
}

const manifest = JSON.parse(
  readFileSync(join(LIBRARY, ".artifacts/resources/bibleproject/manifest.json"), "utf-8"),
) as { records: Array<{ id: string; kind: string; title: string }> };

const indexed = new Set(metas.map((m) => m.episode));
/** "The City E6: Can a City Be Good?" -> "Can a City Be Good?" */
function bareQuestion(title: string): string {
  const afterColon = title.includes(":") ? title.slice(title.lastIndexOf(":") + 1) : title;
  return afterColon.replace(/^\s*[–—-]\s*/, "").trim();
}

const questions = manifest.records
  .filter((r) => r.kind === "podcast" && r.title.includes("?") && indexed.has(r.id))
  .map((r) => ({ id: r.id, title: r.title, q: bareQuestion(r.title) }))
  .filter((r) => r.q.length >= 12 && r.q.includes("?"));

console.log(`${questions.length} question-titled episodes as the eval set\n`);

const provider = new LocalEmbeddingProvider({});

interface Tally { r1: number; r5: number; r10: number; mrr: number; n: number }
const tally: Tally = { r1: 0, r5: 0, r10: 0, mrr: 0, n: 0 };
const worst: Array<{ q: string; rank: number }> = [];

for (let i = 0; i < questions.length; i += 16) {
  const batch = questions.slice(i, i + 16);
  /* "query" prefix on the question, against windows embedded as documents —
     the asymmetric setup this model is built for. */
  const embedded = await provider.embed(batch.map((b) => b.q), "query");

  embedded.forEach((raw, j) => {
    const q = centredQuery(raw);
    /* Best window per episode, then rank episodes. A question is answered by an
       episode, not by a window, and one episode contributing its ten adjacent
       windows to the top ten would flatter the result enormously. */
    const bestPer = new Map<string, number>();
    for (let w = 0; w < metas.length; w += 1) {
      let s = 0;
      for (let d = 0; d < DIM; d += 1) s += q[d]! * all[w * DIM + d]!;
      const held = bestPer.get(metas[w]!.episode);
      if (held === undefined || s > held) bestPer.set(metas[w]!.episode, s);
    }
    const ranked = [...bestPer.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const rank = ranked.indexOf(batch[j]!.id) + 1;

    tally.n += 1;
    if (rank === 1) tally.r1 += 1;
    if (rank >= 1 && rank <= 5) tally.r5 += 1;
    if (rank >= 1 && rank <= 10) tally.r10 += 1;
    if (rank > 0) tally.mrr += 1 / rank;
    if (rank > 10 || rank === 0) worst.push({ q: batch[j]!.q, rank });
  });
  if (i % 48 === 0) console.log(`  ${Math.min(i + 16, questions.length)}/${questions.length}`);
}

const pct = (n: number): string => `${((n / tally.n) * 100).toFixed(1)}%`;
console.log(`\n  the answering episode ranks first of ${indexed.size}:   ${pct(tally.r1)}`);
console.log(`  ... in the top 5:                            ${pct(tally.r5)}`);
console.log(`  ... in the top 10:                           ${pct(tally.r10)}`);
console.log(`  mean reciprocal rank:                        ${(tally.mrr / tally.n).toFixed(3)}`);
console.log(`  chance (1 of ${indexed.size}):${" ".repeat(30 - String(indexed.size).length)}${((1 / indexed.size) * 100).toFixed(2)}%`);

if (worst.length > 0) {
  console.log(`\n  ${worst.length} questions ranked outside the top 10:`);
  for (const w of worst.slice(0, 8)) console.log(`    rank ${String(w.rank).padStart(4)}  ${w.q.slice(0, 62)}`);
}
