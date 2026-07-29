/**
 * Embeds machine transcripts into the library's embeddings store.
 *
 *   node --import tsx scripts/index-transcripts.ts [--limit N] [--dry-run]
 *   env ELECTRON_RUN_AS_NODE=1 electron --import tsx scripts/index-transcripts.ts --import
 *
 * TWO PHASES, BECAUSE TWO NATIVE MODULES DISAGREE
 *
 * better-sqlite3 is built against Electron's ABI, so plain node cannot open the
 * store (ERR_DLOPEN_FAILED). onnxruntime, underneath transformers.js, crashes
 * with SIGTRAP inside Electron-as-Node. Each runtime can do exactly one half of
 * this job, so the job is split at that seam rather than fought:
 *
 *   phase 1  plain node   embed -> vectors.bin + vectors.jsonl
 *   phase 2  electron     read those -> embeddings.sqlite
 *
 * The intermediate files are a feature rather than a workaround. Embedding is
 * the expensive half; keeping its output on disk means importing again, into a
 * rebuilt or relocated library, costs nothing.
 *
 * WHY LOCALLY, AND NOT ON A GPU SOMEWHERE
 *
 * Query vectors and document vectors have to come from the same model or
 * cosine similarity is meaningless, and the ways to break that quietly are
 * numerous: a quantised ONNX build drifting from fp32 weights, a task prefix
 * applied at index time but not at query time, a Matryoshka dimension chosen
 * differently. None of those fail loudly — they degrade retrieval while
 * appearing to work.
 *
 * Running through the same LocalEmbeddingProvider the app queries with removes
 * every one of those risks by construction rather than by discipline. The cost
 * is wall time on a one-time job, which is the cheapest thing being traded.
 *
 * WINDOWS, NOT LINES
 *
 * A transcript line is ~10 words and ~4 seconds — far too little to carry a
 * thought worth retrieving. Windows are built to a target duration instead, so
 * a hit is a passage of talk rather than a fragment, and they overlap because a
 * point that straddles a boundary would otherwise be half-represented in two
 * places and whole in neither.
 */
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, readSync, statSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { isTranscriptEnabledSource, readTranscript, readingLines } from "../src/core/transcripts.js";
import type { TranscriptLine } from "../src/core/transcripts.js";

/** Long enough to hold an argument, short enough that a hit points somewhere. */
const WINDOW_SECONDS = 45;
/** A thought that straddles a boundary should be whole on at least one side. */
const OVERLAP_SECONDS = 12;
/** The src_kind these rows carry, so they can be found and dropped as a set. */
const SRC_KIND = "transcript-window";
const BATCH = 16;

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const has = (name: string): boolean => process.argv.includes(`--${name}`);

const libraryPath = resolve(arg("library", join(process.env["HOME"] ?? "", "ScriptureLibrary"))!);
const transcriptDir = join(libraryPath, ".artifacts/transcripts");
const dbPath = join(libraryPath, ".system/embeddings.sqlite");
const limit = Number(arg("limit", "0"));
const dryRun = has("dry-run");
const importOnly = has("import");

/* Vectors on the external drive rather than in the library: they are derived
   data, rebuildable from the transcripts, and 140MB of float32 has no business
   in a store that is meant to be small enough to reason about. */
const vectorPath = resolve(arg("vectors", "/Volumes/External/Transcripts/vectors.bin")!);
const metaPath = `${vectorPath}.jsonl`;

/** The model id is written into the metadata rather than assumed at import:
    vectors from two models must never be mixed in one index, and the file
    itself should say which one it came from. */
const MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

/* Episode titles, for the document prompt's title slot. A window is 45 seconds
   of conversation with every antecedent stripped — "and so he's saying here
   that the fire..." is close to contentless alone. The model has a trained
   field for exactly this, and it was being filled with "none". */
const episodeTitles = new Map<string, string>();
try {
  const resourceManifest = JSON.parse(readFileSync(
    join(libraryPath, ".artifacts/resources/bibleproject/manifest.json"), "utf-8",
  )) as { records: Array<{ id: string; title?: string }> };
  for (const record of resourceManifest.records) {
    if (record.title) episodeTitles.set(record.id, record.title);
  }
} catch {
  /* No manifest, no titles. The slot falls back to "none" and everything else
     still works — which is the point: a corpus with no metadata at all must
     still index. */
}

interface Window {
  /** `${recordId}#${start}` — the record and the second it starts at, which is
      everything a result needs to become a seek. The text is not stored; the
      transcript on disk is its own source of truth. */
  srcId: string;
  recordId: string;
  start: number;
  end: number;
  text: string;
}

/** Groups lines into overlapping windows of roughly WINDOW_SECONDS. */
function windowsOf(recordId: string, lines: readonly TranscriptLine[]): Window[] {
  if (lines.length === 0) return [];
  const windows: Window[] = [];
  let cursor = 0;

  while (cursor < lines.length) {
    const start = lines[cursor]!.s;
    let index = cursor;
    while (index < lines.length && lines[index]!.e - start < WINDOW_SECONDS) index += 1;
    const slice = lines.slice(cursor, Math.max(index, cursor + 1));
    const text = slice.map((line) => line.t).join(" ").replace(/\s+/g, " ").trim();

    if (text.length > 0) {
      windows.push({
        srcId: `${recordId}#${start.toFixed(1)}`,
        recordId,
        start,
        end: slice[slice.length - 1]!.e,
        text,
      });
    }

    /* Advance by window-minus-overlap, measured in time rather than in lines,
       because lines vary in length and a fixed line step would make the real
       overlap drift. Always advance at least one line: a single line longer
       than the whole window would otherwise loop forever. */
    const target = start + (WINDOW_SECONDS - OVERLAP_SECONDS);
    let next = cursor + 1;
    while (next < lines.length && lines[next]!.s < target) next += 1;
    cursor = next;
  }
  return windows;
}

if (!existsSync(transcriptDir)) {
  console.error(`no transcripts at ${transcriptDir}`);
  process.exit(1);
}

const files = readdirSync(transcriptDir).filter((f) => f.endsWith(".json"));
const all: Window[] = [];
let skippedUngranted = 0;
let skippedUnreadable = 0;

for (const file of files) {
  const parsed = JSON.parse(readFileSync(join(transcriptDir, file), "utf-8")) as { id?: string };
  const recordId = parsed.id ?? file.replace(/\.json$/, "").replace(/__/g, ":");

  /* The same grant that gates display gates indexing. A publisher who has not
     granted transcripts should not have their words in a search index either —
     an index is a use, not a neutral intermediate. */
  if (!isTranscriptEnabledSource(recordId)) { skippedUngranted += 1; continue; }

  const result = readTranscript(parsed, recordId);
  if (!result.ok) { skippedUnreadable += 1; continue; }
  all.push(...windowsOf(recordId, result.transcript.segments));
}

const pending = limit > 0 ? all.slice(0, limit) : all;
const episodes = new Set(pending.map((w) => w.recordId)).size;
const hours = pending.reduce((sum, w) => sum + (w.end - w.start), 0) / 3600;
const words = pending.reduce((sum, w) => sum + w.text.split(" ").length, 0);

const hashOf = (text: string): string => createHash("sha256").update(text).digest("hex").slice(0, 16);

interface VectorMeta { srcId: string; hash: string; dim: number; offset: number }

/** Metadata already written, so an interrupted run resumes rather than repeats. */
function writtenSoFar(): Map<string, VectorMeta> {
  const done = new Map<string, VectorMeta>();
  if (!existsSync(metaPath)) return done;
  for (const line of readFileSync(metaPath, "utf-8").split("\n")) {
    if (!line) continue;
    try {
      const meta = JSON.parse(line) as VectorMeta;
      done.set(meta.srcId, meta);
    } catch { /* a torn final line from a killed run; the window re-embeds */ }
  }
  return done;
}

// --- phase 2: import vectors into the store (Electron-as-Node) ----------------

if (importOnly) {
  const { EmbeddingsStore } = await import("../src/host/embeddings-store.js");
  const store = new EmbeddingsStore(dbPath);
  const metas = [...writtenSoFar().values()];
  if (metas.length === 0) { console.error(`no vectors at ${metaPath}`); process.exit(1); }

  const fd = openSync(vectorPath, "r");
  let imported = 0;
  let skipped = 0;
  for (const meta of metas) {
    if (store.isCurrent(SRC_KIND, meta.srcId, MODEL_ID, meta.hash)) { skipped += 1; continue; }
    const bytes = Buffer.allocUnsafe(meta.dim * 4);
    readSync(fd, bytes, 0, bytes.length, meta.offset);
    const vector = new Float32Array(bytes.buffer, bytes.byteOffset, meta.dim);
    store.upsertEmbedding(SRC_KIND, meta.srcId, vector, MODEL_ID, meta.hash);
    imported += 1;
    if (imported % 5000 === 0) console.log(`  ${imported}/${metas.length}`);
  }
  console.log(`imported ${imported}, already current ${skipped}, total ${metas.length}`);
  process.exit(0);
}

// --- phase 1: embed (plain node) ---------------------------------------------

console.log(`${pending.length} windows from ${episodes} episodes`);
console.log(`  ~${Math.round(words / pending.length)} words and ${((hours * 3600) / pending.length).toFixed(0)}s per window`);
console.log(`  model: ${MODEL_ID}`);
if (skippedUngranted > 0) console.log(`  skipped, source not granted: ${skippedUngranted}`);
if (skippedUnreadable > 0) console.log(`  skipped, unreadable: ${skippedUnreadable}`);
if (dryRun) process.exit(0);

const { LocalEmbeddingProvider } = await import("../src/host/local-embeddings.js");
const provider = new LocalEmbeddingProvider({});

mkdirSync(dirname(vectorPath), { recursive: true });
const already = writtenSoFar();
/* Resumable by content, not by position: a window whose exact text is already
   embedded is skipped, so re-running after editing one episode re-embeds that
   episode and nothing else. */
const todo = pending.filter((w) => already.get(w.srcId)?.hash !== hashOf(w.text));
console.log(`  already embedded: ${pending.length - todo.length}`);
console.log(`  to embed:         ${todo.length}\n`);

const out = openSync(vectorPath, existsSync(vectorPath) ? "r+" : "w+");
let offset = existsSync(vectorPath) ? statSync(vectorPath).size : 0;
const started = Date.now();
let done = 0;

for (let i = 0; i < todo.length; i += BATCH) {
  const batch = todo.slice(i, i + BATCH);
  const vectors = await provider.embed(batch.map((w) => w.text), "document");

  /* Vector first, then its metadata line. A run killed between the two leaves
     bytes nothing points at — wasted space, reclaimed on the next full pass —
     rather than a metadata entry pointing at bytes that were never written,
     which would import as silent garbage. */
  const lines: string[] = [];
  for (let j = 0; j < batch.length; j += 1) {
    const window = batch[j]!;
    const vector = vectors[j]!;
    const bytes = Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
    writeSync(out, bytes, 0, bytes.length, offset);
    lines.push(JSON.stringify({ srcId: window.srcId, hash: hashOf(window.text), dim: vector.length, offset }));
    offset += bytes.length;
  }
  appendFileSync(metaPath, `${lines.join("\n")}\n`);
  done += batch.length;

  if (done % 320 < BATCH || done === todo.length) {
    const elapsed = (Date.now() - started) / 1000;
    const rate = done / elapsed;
    console.log(
      `  ${done}/${todo.length}  ${rate.toFixed(1)}/s  `
      + `${Math.floor(elapsed / 60)}m elapsed, ~${Math.ceil((todo.length - done) / rate / 60)}m left`,
    );
  }
}

console.log(`\nembedded ${done} windows in ${Math.round((Date.now() - started) / 1000 / 60)}m`);
console.log(`  vectors: ${vectorPath}`);
console.log(`\nnow import them:`);
console.log(`  env ELECTRON_RUN_AS_NODE=1 npx electron --import tsx scripts/index-transcripts.ts --import`);
