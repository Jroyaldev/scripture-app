/**
 * M4 Verification — Source ingestion.
 *
 * DONE WHEN: importing a PDF produces locator-accurate chunks, the margin can
 * surface a chunk cross-referenced to the active passage, and pinning a snippet
 * yields a note citation whose page/locator stays correct after a re-chunk.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { validateBackboneData } from "../src/core/reference/backbone.js";
import { LibraryEngine } from "../src/host/library.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { assembleMargin } from "../src/core/margin/index.js";
import type { CrossRefData } from "../src/core/margin/types.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data/scripture");
const CROSS_REF_DIR = resolve(import.meta.dirname ?? ".", "../data/cross-references");
const TEST_LIBRARY = resolve(import.meta.dirname ?? ".", "../Library-m4-test");
const TMP_DIR = resolve(import.meta.dirname ?? ".", "../tmp-m4");

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean, detail?: string): void {
  if (ok) {
    passed++;
    console.log(`  \u2714 ${label}`);
  } else {
    failed++;
    console.error(`  \u2717 ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

function loadBackbone(): BackboneData {
  const data = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8")) as BackboneData;
  const validation = validateBackboneData(data);
  if (!validation.ok) throw new Error(`Backbone validation failed: ${validation.error}`);
  return data;
}

function loadBookNames(): BookNameMap {
  return JSON.parse(readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8")) as BookNameMap;
}

function loadCrossRefs(): CrossRefData {
  return JSON.parse(readFileSync(join(CROSS_REF_DIR, "tsk.json"), "utf-8")) as CrossRefData;
}

function writeSimplePdf(path: string, text: string): void {
  const escaped = text.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n",
    "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];
  const stream = `BT\n/F1 12 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  objects.push(`5 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf-8")} >>\nstream\n${stream}endstream\nendobj\n`);

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf-8"));
    pdf += object;
  }
  const xrefStart = Buffer.byteLength(pdf, "utf-8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= objects.length; i++) {
    pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  writeFileSync(path, pdf);
}

async function main(): Promise<void> {
  if (existsSync(TEST_LIBRARY)) rmSync(TEST_LIBRARY, { recursive: true });
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const backbone = loadBackbone();
  const bookNames = loadBookNames();
  const crossRefs = loadCrossRefs();
  const pdfPath = join(TMP_DIR, "acts-19-source.pdf");
  writeSimplePdf(
    pdfPath,
    "A source paragraph for Acts 19:1-7. The disciples received the Holy Spirit, and this citation should stay pinned.",
  );

  section("1. Initialize library and import PDF source");
  const engine = new LibraryEngine(TEST_LIBRARY, backbone, bookNames);
  engine.initLibrary();
  engine.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));
  engine.buildSqlite();

  const imported = await engine.importPdfSource(pdfPath, {
    title: "Acts 19 Source",
    rights: { userProvided: true, canQuoteInNotes: true, canExportQuotes: true },
    syncPolicy: { syncOriginal: false, syncDerivedChunks: false, syncEmbeddings: false },
  });

  check("Source ID created", imported.source.id.startsWith("src_"));
  check("Original PDF copied into sources/", existsSync(join(TEST_LIBRARY, "sources", imported.source.id, "original.pdf")));
  check("Metadata persisted", existsSync(join(TEST_LIBRARY, "sources", imported.source.id, "metadata.json")));
  check("At least one source chunk created", imported.chunks.length > 0);

  const firstChunk = imported.chunks[0];
  check("Chunk text extracted from PDF", firstChunk?.text.includes("received the Holy Spirit") === true);
  check("Chunk locator records page 1", firstChunk?.locator.kind === "pdf" && firstChunk.locator.page === 1);
  check("Chunk locator has positive bbox", firstChunk != null && firstChunk.locator.bbox.width > 0 && firstChunk.locator.bbox.height > 0);

  section("2. Living Margin surfaces source chunk for Acts 19:1-7");
  const dbPath = join(TEST_LIBRARY, ".system/library.sqlite");
  const db = new SQLiteMaterializer(dbPath);
  const margin = assembleMargin(
    { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    db,
    crossRefs,
    bookNames,
  );
  db.close();

  check("Source chunk appears in margin", margin.sourceChunks.some((chunk) => chunk.chunkId === firstChunk?.id));
  check(
    "Source chunk keeps locator in margin",
    margin.sourceChunks.some((chunk) => chunk.chunkId === firstChunk?.id && chunk.locator.page === 1),
  );

  section("3. Pin snippet copies quote and locator into note");
  if (!firstChunk) throw new Error("No source chunk was created");
  const pinned = engine.pinSourceChunkToNote(firstChunk.id, {
    title: "Pinned Acts 19 Source",
    quote: firstChunk.text,
  });
  const pinnedBefore = readFileSync(pinned.notePath, "utf-8");
  check("Pinned note file written", existsSync(pinned.notePath));
  check("Pinned note includes quote", pinnedBefore.includes("received the Holy Spirit"));
  check("Pinned note includes page locator", pinnedBefore.includes("page: 1"));
  check("Pinned note includes source chunk ID", pinnedBefore.includes(firstChunk.id));

  section("4. Re-chunk preserves pinned citation locator");
  const rechunked = await engine.rechunkSource(imported.source.id);
  const pinnedAfter = readFileSync(pinned.notePath, "utf-8");
  check("Re-chunk produced chunks", rechunked.length > 0);
  check("Pinned note locator remains page 1 after re-chunk", pinnedAfter.includes("page: 1"));
  check("Pinned note still references original source", pinnedAfter.includes(imported.source.id));

  rmSync(TEST_LIBRARY, { recursive: true });
  rmSync(TMP_DIR, { recursive: true });

  console.log("\n=== M4 Verification Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log();

  if (failed > 0) {
    console.error("M4 VERIFICATION FAILED");
    process.exit(1);
  }

  console.log("M4 VERIFICATION PASSED");
}

void main().catch((err) => {
  console.error("M4 verification crashed:", err);
  process.exit(1);
});
