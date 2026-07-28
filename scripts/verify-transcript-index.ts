/**
 * Checks the transcript embedding index is intact and internally consistent.
 *
 *   env ELECTRON_RUN_AS_NODE=1 npx electron --import tsx scripts/verify-transcript-index.ts
 *
 * Runs under Electron because better-sqlite3 is built against its ABI.
 *
 * The failures worth catching here are all silent ones. Vectors from two models
 * in one index, or two dimensions, produce cosine similarities that mean
 * nothing while still returning ranked results — search would appear to work
 * and quietly return noise. A float32 blob that lost bytes on the way through
 * SQLite decodes to a vector that is no longer unit length, which is a thing
 * you can check for free and would otherwise never notice.
 */
import Database from "better-sqlite3";
import { join } from "node:path";

const SRC_KIND = "transcript-window";
const libraryPath = process.argv[2] ?? join(process.env["HOME"] ?? "", "ScriptureLibrary");
const db = new Database(join(libraryPath, ".system/embeddings.sqlite"), { readonly: true });

const summary = db.prepare(`
  SELECT COUNT(*) n, COUNT(DISTINCT dim) dims, MIN(dim) dim,
         MAX(LENGTH(vector)) bytes, COUNT(DISTINCT model) models, MIN(model) model
  FROM embeddings WHERE src_kind = ?
`).get(SRC_KIND) as Record<string, number | string>;

if (Number(summary["n"]) === 0) {
  console.error(`no ${SRC_KIND} rows in ${libraryPath}`);
  process.exit(1);
}

const episodes = db.prepare(`
  SELECT COUNT(DISTINCT substr(src_id, 1, instr(src_id, '#') - 1)) n
  FROM embeddings WHERE src_kind = ?
`).get(SRC_KIND) as { n: number };

const kinds = db.prepare("SELECT src_kind, COUNT(*) n FROM embeddings GROUP BY src_kind")
  .all() as Array<{ src_kind: string; n: number }>;

console.log(`  rows:          ${summary["n"]}`);
console.log(`  episodes:      ${episodes.n}`);
console.log(`  dim:           ${summary["dim"]}`);
console.log(`  bytes/vector:  ${summary["bytes"]}  (expect dim x 4 = ${Number(summary["dim"]) * 4})`);
console.log(`  model:         ${summary["model"]}`);
console.log(`  src_kinds:     ${kinds.map((k) => `${k.src_kind}=${k.n}`).join(", ")}`);

/* Sampled rather than exhaustive: a truncation or endianness fault is a
   property of how the column was written, so it shows up in any row or in
   none. */
const sample = db.prepare(
  "SELECT src_id, dim, vector FROM embeddings WHERE src_kind = ? ORDER BY src_id LIMIT 200",
).all(SRC_KIND) as Array<{ src_id: string; dim: number; vector: Buffer }>;

let offNorm = 0;
let worst = 1;
for (const row of sample) {
  const v = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.dim);
  const norm = Math.sqrt(v.reduce((sum, x) => sum + x * x, 0));
  if (Math.abs(norm - 1) > 1e-3) offNorm += 1;
  if (Math.abs(norm - 1) > Math.abs(worst - 1)) worst = norm;
}
console.log(`  sampled ${sample.length}: ${offNorm} off unit length (worst ${worst.toFixed(6)})`);

const problems: string[] = [];
if (Number(summary["dims"]) !== 1) problems.push(`${summary["dims"]} different dimensions in one index`);
if (Number(summary["models"]) !== 1) problems.push(`${summary["models"]} different models in one index`);
if (Number(summary["bytes"]) !== Number(summary["dim"]) * 4) problems.push("vector bytes do not match dim x 4");
if (offNorm > 0) problems.push(`${offNorm} vectors are not unit length`);

if (problems.length > 0) {
  console.log("\nPROBLEMS");
  for (const problem of problems) console.log(`  ${problem}`);
  process.exitCode = 1;
} else {
  console.log("\nindex is consistent");
}
