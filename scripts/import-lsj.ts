/**
 * Import STEPBible TFLSJ → a byte-offset index over the raw lexicon.
 *
 *   npm run import:lsj
 *
 * The two source files stay on disk byte-identical (the TIPNR precedent). What
 * this script builds is not a copy of the prose but a map to it: for every one
 * of the 11,034 entries, which file its row is in, where the row starts, and
 * how long it is. A word card then seeks and reads one row.
 *
 * The offset table is sharded by Strong's-thousand — the grouping the source's
 * own file name (`0-5624`) already implies — so a cold card loads a ~40 KB
 * shard rather than the whole table.
 *
 * ── Why not one in-memory map (measured, this machine, node v24.9.0) ────────
 *
 *   approach                                     bytes read   wall    peak RSS
 *   ------------------------------------------   ----------   -----   --------
 *   empty node process (baseline)                         0       —    88.3 MB
 *   parse both raw files into Map<key, LsjEntry>  32,208,907   723ms   460.9 MB
 *   one lsj-index.json of every parsed entry      87,570,887   378ms   710.1 MB
 *   raw scan of the main file for one key         23,831,837    66ms   183.1 MB
 *   THIS: manifest + one shard + one row read         ~44 KB    <5ms    ~89 MB
 *
 * The single-blob index — the shape TIPNR uses, applied naively here — is
 * 87,570,887 b, 2.7x the raw source it indexes, and costs ~622 MB of resident
 * memory over baseline to answer one lookup. That is the measurement that
 * rejects it, and it is why this importer emits coordinates instead of prose.
 *
 * I/O only. Every format decision lives in `src/core/language/lsj.ts`.
 */

import { createHash } from "node:crypto";
import { closeSync, existsSync, openSync, readFileSync, readSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LSJ_ATTRIBUTION,
  LSJ_SOURCE_FILES,
  isLsjHeaderLine,
  lsjShardIdForKey,
  parseLsjEntry,
  parseLsjRow,
  type LsjIndexManifest,
  type LsjShardFile,
  type LsjShardMeta,
  type LsjSlice,
  type LsjSourceFile,
  type LsjSourceFileMeta,
} from "../src/core/language/lsj.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data/scripture/lexicons/lsj");
const MANIFEST_OUTPUT = resolve(DATA_DIR, "lsj-index.json");
const DOCTOR_OUTPUT = resolve(DATA_DIR, "lsj-doctor-report.json");

/**
 * Snapshot date, pinned so regenerating the index is byte-stable (INV-2, the
 * same reason `import-tipnr.ts` pins `TIPNR_SNAPSHOT_DATE`).
 */
const LSJ_SNAPSHOT_DATE = "2026-07-26";

const RAW_INPUTS: ReadonlyArray<{
  id: LsjSourceFile;
  path: string;
  upstreamName: string;
  expectedBytes: number;
  expectedSha256: string;
  expectedRows: number;
}> = [
  {
    id: 0,
    path: "TFLSJ-STEPBible-CC-BY.txt",
    upstreamName: LSJ_SOURCE_FILES[0],
    expectedBytes: 23_831_837,
    expectedSha256: "fcc2845412132a7bb91fc3dbb5a544c807daf57e4791c4d9af61efe209e97691",
    expectedRows: 5_709,
  },
  {
    id: 1,
    path: "TFLSJ-extra-STEPBible-CC-BY.txt",
    upstreamName: LSJ_SOURCE_FILES[1],
    expectedBytes: 8_377_070,
    expectedSha256: "fdb2840067faa11301b208a343a9453fbe40b367e94eac981071261626201bc2",
    expectedRows: 5_325,
  },
];

const UPSTREAM_BASE =
  "https://raw.githubusercontent.com/STEPBible/STEPBible-Data/master/Lexicons/";

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

type ScannedRow = {
  key: string;
  file: LsjSourceFile;
  offset: number;
  length: number;
  /** Populated only while auditing, so the scan itself stays cheap. */
  line: string;
};

/**
 * Walk one raw file byte-wise, recording where each data row starts and ends.
 *
 * Byte offsets, not character offsets: the files are UTF-8 and mostly Greek,
 * so a character offset would not survive `read(fd, …, position)`. Both files
 * are LF-only and newline-terminated (verified), so a row runs from the byte
 * after the previous newline to the byte before the next.
 */
function scanRawFile(buffer: Buffer, file: LsjSourceFile): {
  rows: ScannedRow[];
  headerSeen: boolean;
  preambleLines: number;
} {
  const rows: ScannedRow[] = [];
  let headerSeen = false;
  let preambleLines = 0;
  let offset = 0;

  while (offset < buffer.length) {
    let end = buffer.indexOf(0x0a, offset);
    if (end < 0) end = buffer.length;
    const length = end - offset;
    // Cheap gate: a data row starts with `G` (0x47) then an ASCII digit. Only
    // decode the candidates, not 60 lines of licence prose or 24 MB of tails.
    const first = buffer[offset];
    if (first === 0x47) {
      const line = buffer.toString("utf8", offset, end);
      const row = parseLsjRow(line);
      if (row) rows.push({ key: row.key, file, offset, length, line });
      else preambleLines += 1;
    } else {
      const line = buffer.toString("utf8", offset, Math.min(end, offset + 64));
      if (isLsjHeaderLine(line)) headerSeen = true;
      preambleLines += 1;
    }
    offset = end + 1;
  }

  return { rows, headerSeen, preambleLines };
}

type ImportResult = {
  manifest: LsjIndexManifest;
  shards: LsjShardFile[];
  doctor: Record<string, unknown>;
};

export function buildLsjIndex(
  inputs: ReadonlyArray<{ meta: (typeof RAW_INPUTS)[number]; buffer: Buffer }>,
): ImportResult {
  const rows: ScannedRow[] = [];
  const files: LsjSourceFileMeta[] = [];
  const perFileRowCounts: number[] = [];
  const headerSeen: boolean[] = [];

  for (const { meta, buffer } of inputs) {
    const scan = scanRawFile(buffer, meta.id);
    rows.push(...scan.rows);
    perFileRowCounts.push(scan.rows.length);
    headerSeen.push(scan.headerSeen);
    files.push({
      id: meta.id,
      path: meta.path,
      upstreamName: meta.upstreamName,
      bytes: buffer.length,
      sha256: sha256(buffer),
      rowCount: scan.rows.length,
    });
  }

  // ── keys ──────────────────────────────────────────────────────────────
  const duplicateKeys: string[] = [];
  const slices = new Map<string, LsjSlice>();
  const sourceOrder: string[] = [];
  for (const row of rows) {
    if (slices.has(row.key)) {
      duplicateKeys.push(row.key);
      continue;
    }
    slices.set(row.key, { file: row.file, offset: row.offset, length: row.length });
    sourceOrder.push(row.key);
  }

  // ── sense siblings: plain base → the suffixed keys that share it ───────
  const byBase = new Map<string, string[]>();
  for (const key of sourceOrder) {
    const match = /^([GH])(\d+)([A-Za-z]?)$/.exec(key);
    if (!match?.[1] || !match[2]) continue;
    const base = `${match[1]}${match[2]}`;
    const list = byBase.get(base) ?? [];
    list.push(key);
    byBase.set(base, list);
  }
  const senseSiblings: Record<string, string[]> = {};
  let splitBases = 0;
  for (const [base, keys] of byBase) {
    // Only bases that actually split earn an entry: 108 in the main file,
    // 1 in the extra. A base with a single key needs no picker.
    if (keys.length < 2) continue;
    senseSiblings[base] = keys;
    splitBases += 1;
  }

  // ── shards ────────────────────────────────────────────────────────────
  const shardBuckets = new Map<number, Map<string, LsjSlice>>();
  const unshardable: string[] = [];
  for (const [key, slice] of slices) {
    const id = lsjShardIdForKey(key);
    if (id == null) {
      unshardable.push(key);
      continue;
    }
    const bucket = shardBuckets.get(id) ?? new Map<string, LsjSlice>();
    bucket.set(key, slice);
    shardBuckets.set(id, bucket);
  }

  const shardMeta: LsjShardMeta[] = [];
  const shardFiles: LsjShardFile[] = [];
  for (const id of [...shardBuckets.keys()].sort((a, b) => a - b)) {
    const bucket = shardBuckets.get(id)!;
    const numbers = [...bucket.keys()].map((k) => Number(/\d+/.exec(k)![0]));
    shardMeta.push({
      id,
      path: `lsj-slices-${id}.json`,
      entryCount: bucket.size,
      lowest: Math.min(...numbers),
      highest: Math.max(...numbers),
    });
    shardFiles.push({
      version: 1,
      id,
      slices: Object.fromEntries([...bucket].sort((a, b) => a[0].localeCompare(b[0]))),
    });
  }

  const manifest: LsjIndexManifest = {
    version: 1,
    source: "STEPBible TFLSJ",
    license: "CC BY 4.0",
    attribution: LSJ_ATTRIBUTION,
    generatedAt: `${LSJ_SNAPSHOT_DATE}T00:00:00.000Z`,
    files,
    entryCount: slices.size,
    shards: shardMeta,
    senseSiblings,
  };

  // ── audit: parse every row's column 8 once, and prove the slices work ──
  let citations = 0;
  let bracketedCitations = 0;
  let suspectCitations = 0;
  let inlineCitations = 0;
  let senseMarkers = 0;
  let scriptureRefs = 0;
  let meaningChars = 0;
  const provenance: Record<string, number> = {};
  let emptyMeanings = 0;
  const relations: Record<string, number> = {};

  for (const row of rows) {
    const entry = parseLsjEntry(row.line);
    if (!entry) throw new Error(`Row scanned but not parseable: ${row.key}`);
    meaningChars += row.line.split("\t")[7]?.length ?? 0;
    provenance[entry.meaning.provenance] = (provenance[entry.meaning.provenance] ?? 0) + 1;
    if (entry.meaning.provenance === "empty") emptyMeanings += 1;
    relations[entry.relation] = (relations[entry.relation] ?? 0) + 1;
    for (const citation of entry.meaning.citations) {
      citations += 1;
      if (citation.bracketed) bracketedCitations += 1;
      if (citation.suspect) suspectCitations += 1;
      if (citation.inline) inlineCitations += 1;
      scriptureRefs += citation.refs.length;
    }
    for (const node of entry.meaning.nodes) {
      if (node.kind === "sense") senseMarkers += 1;
      if (node.kind === "scriptureRef") scriptureRefs += 1;
    }
  }

  // ── audit: every recorded slice must actually re-read its own row ──────
  let sliceReadsVerified = 0;
  const sliceReadFailures: string[] = [];
  for (const { meta, buffer } of inputs) {
    for (const [key, slice] of slices) {
      if (slice.file !== meta.id) continue;
      const text = buffer.toString("utf8", slice.offset, slice.offset + slice.length);
      const entry = parseLsjEntry(text);
      if (entry?.key === key) sliceReadsVerified += 1;
      else sliceReadFailures.push(key);
    }
  }

  const checks = {
    bothFilesPresent: inputs.length === RAW_INPUTS.length,
    headerFoundInEveryFile: headerSeen.every(Boolean),
    rowCountsMatchExpected: inputs.every((input, i) => perFileRowCounts[i] === input.meta.expectedRows),
    sha256MatchesPinnedSnapshot: inputs.every((input, i) => files[i]?.sha256 === input.meta.expectedSha256),
    byteCountsMatchPinnedSnapshot: inputs.every((input, i) => files[i]?.bytes === input.meta.expectedBytes),
    entryCountNonZero: slices.size > 0,
    entryCountIs11034: slices.size === 11_034,
    noDuplicateKeys: duplicateKeys.length === 0,
    everyKeyShardable: unshardable.length === 0,
    shardsCoverEveryEntry:
      shardMeta.reduce((sum, shard) => sum + shard.entryCount, 0) === slices.size,
    everySliceRereadsItsOwnRow:
      sliceReadFailures.length === 0 && sliceReadsVerified === slices.size,
    citationsNonZero: citations > 0,
    citationCountIs121856: citations === 121_856,
    citationsMostlyBracketed: bracketedCitations / Math.max(citations, 1) > 0.999,
    senseMarkersNonZero: senseMarkers > 0,
    scriptureRefsNonZero: scriptureRefs > 0,
    provenanceCoversEveryRow:
      Object.values(provenance).reduce((a, b) => a + b, 0) === rows.length,
    abbottSmithFallbackIsNotEmpty: (provenance["abbott-smith-fallback"] ?? 0) === 543,
    onlyExtraFileHasEmptyMeanings: emptyMeanings === 77,
    licenceLineIntact: inputs.every(({ buffer }) =>
      /STEPBible\.org CC BY/.test(buffer.toString("utf8", 0, 400))),
  };

  const doctor = {
    status: Object.values(checks).every(Boolean) ? "healthy" : "unhealthy",
    source: {
      name: "STEPBible TFLSJ",
      url: "https://github.com/STEPBible/STEPBible-Data",
      directory: "Lexicons/",
      license: "CC BY 4.0",
      attribution: LSJ_ATTRIBUTION,
      snapshotDate: LSJ_SNAPSHOT_DATE,
      files: files.map((file) => ({
        path: file.path,
        upstreamName: file.upstreamName,
        bytes: file.bytes,
        sha256: file.sha256,
        rowCount: file.rowCount,
      })),
    },
    coverage: {
      entryCount: slices.size,
      rowsScanned: rows.length,
      perFileRowCounts,
      distinctBases: byBase.size,
      splitBases,
      shardCount: shardMeta.length,
      meaningChars,
      meanMeaningChars: Math.round((meaningChars / rows.length) * 100) / 100,
      citations,
      bracketedCitations,
      unbracketedCitations: citations - bracketedCitations,
      inlineCitations,
      suspectCitations,
      senseMarkers,
      scriptureRefs,
      provenance,
      relations,
      sliceReadsVerified,
    },
    checks,
    review: {
      duplicateKeys,
      unshardableKeys: unshardable,
      sliceReadFailures,
    },
  };

  return { manifest, shards: shardFiles, doctor };
}

function main(): void {
  const inputs: Array<{ meta: (typeof RAW_INPUTS)[number]; buffer: Buffer }> = [];
  for (const meta of RAW_INPUTS) {
    const path = resolve(DATA_DIR, meta.path);
    if (!existsSync(path)) {
      throw new Error(
        `Missing TFLSJ input: ${path}\n` +
          `Download it (CC BY 4.0, attribute ${LSJ_ATTRIBUTION}) from\n` +
          `  ${UPSTREAM_BASE}${encodeURIComponent(meta.upstreamName)}\n` +
          `Note the double space after "TFLSJ" in the first file's name; the URL 404s without it.`,
      );
    }
    console.log("Reading", path);
    inputs.push({ meta, buffer: readFileSync(path) });
  }

  const { manifest, shards, doctor } = buildLsjIndex(inputs);
  if (doctor.status !== "healthy") {
    writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
    const failed = Object.entries((doctor as { checks: Record<string, boolean> }).checks)
      .filter(([, passed]) => !passed)
      .map(([name]) => name);
    throw new Error(`TFLSJ Doctor refused import. Failed checks: ${failed.join(", ")}`);
  }

  writeFileSync(MANIFEST_OUTPUT, `${JSON.stringify(manifest)}\n`);
  let shardBytes = 0;
  for (const shard of shards) {
    const path = resolve(DATA_DIR, `lsj-slices-${shard.id}.json`);
    const body = `${JSON.stringify(shard)}\n`;
    writeFileSync(path, body);
    shardBytes += Buffer.byteLength(body);
  }
  writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);

  const coverage = (doctor as { coverage: Record<string, number> }).coverage;
  const manifestBytes = Buffer.byteLength(`${JSON.stringify(manifest)}\n`);
  const rawBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);

  console.log(`Wrote ${MANIFEST_OUTPUT}`);
  console.log(`  entries: ${manifest.entryCount} across ${manifest.shards.length} shards`);
  console.log(`  raw source: ${rawBytes} b (shipped byte-identical, sha256 pinned)`);
  console.log(`  manifest:   ${manifestBytes} b`);
  console.log(`  shards:     ${shardBytes} b total, largest ${Math.max(...shards.map((s) => Buffer.byteLength(JSON.stringify(s))))} b`);
  console.log(`  index total: ${manifestBytes + shardBytes} b = ${((manifestBytes + shardBytes) / rawBytes * 100).toFixed(2)}% of the raw source`);
  console.log(`  citations: ${coverage.citations} (${coverage.bracketedCitations} bracketed, ${coverage.inlineCitations} inline, ${coverage.suspectCitations} suspect)`);
  console.log(`  sense markers: ${coverage.senseMarkers}; scripture refs: ${coverage.scriptureRefs}`);
  console.log(`  mean column-8 chars: ${coverage.meanMeaningChars}`);
  console.log(`  provenance:`, (doctor as { coverage: { provenance: unknown } }).coverage.provenance);
  console.log(`  Doctor: ${DOCTOR_OUTPUT}`);

  // Prove the point of the whole exercise: one entry, read without loading
  // either source file. Same code path a word card will take.
  const probeKey = "G749";
  const shardId = lsjShardIdForKey(probeKey)!;
  const shardPath = resolve(DATA_DIR, `lsj-slices-${shardId}.json`);
  const shard = JSON.parse(readFileSync(shardPath, "utf8")) as LsjShardFile;
  const slice = shard.slices[probeKey]!;
  const fd = openSync(resolve(DATA_DIR, manifest.files[slice.file]!.path), "r");
  const buffer = Buffer.allocUnsafe(slice.length);
  readSync(fd, buffer, 0, slice.length, slice.offset);
  closeSync(fd);
  const entry = parseLsjEntry(buffer.toString("utf8"))!;
  console.log(
    `  probe ${probeKey}: ${entry.greek} (${entry.transliteration}) — ${slice.length} b read, ` +
      `${entry.meaning.citations.length} citations, ${entry.meaning.nodes.length} nodes`,
  );
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
