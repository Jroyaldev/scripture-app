/**
 * M6 Verification — Folder-based sync.
 *
 * DONE WHEN: two libraries edited offline sync with zero data loss; overlapping
 * highlights both survive and are flagged by Doctor; conflicting note bodies
 * produce conflict copies; and a package with syncToOwnDevices:false syncs only
 * its pointer.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ulid } from "ulid";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { validateBackboneData } from "../src/core/reference/backbone.js";
import { runDoctor } from "../src/core/doctor/index.js";
import { LibraryEngine } from "../src/host/library.js";
import { FolderSyncAdapter } from "../src/host/sync.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data/scripture");
const LIB_A = resolve(import.meta.dirname ?? ".", "../Library-m6-a");
const LIB_B = resolve(import.meta.dirname ?? ".", "../Library-m6-b");

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

function noteBodies(root: string): string[] {
  return readdirSync(join(root, "notes"))
    .filter((file) => file.endsWith(".md"))
    .map((file) => readFileSync(join(root, "notes", file), "utf-8"));
}

async function main(): Promise<void> {
  for (const dir of [LIB_A, LIB_B]) {
    if (existsSync(dir)) rmSync(dir, { recursive: true });
  }

  const backbone = loadBackbone();
  const bookNames = loadBookNames();
  const engineA = new LibraryEngine(LIB_A, backbone, bookNames);
  const engineB = new LibraryEngine(LIB_B, backbone, bookNames);
  engineA.initLibrary();
  engineB.initLibrary();
  engineA.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));
  engineB.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));

  section("1. Simulate offline edits");
  const sharedNoteId = ulid();
  engineA.createNote(sharedNoteId, "Shared Note", "Library A edit for Acts 19:2.");
  engineB.createNote(sharedNoteId, "Shared Note", "Library B edit for Acts 19:2.");

  const highlightA = "hl_" + ulid();
  engineA.appendEvent(engineA.createEvent("highlight", highlightA, "create", {
    book: "ACT",
    chapter: 19,
    verse_start: 2,
    verse_end: 2,
    package: "web",
    color: "yellow",
    kind: "highlight",
  }));
  const highlightB = "hl_" + ulid();
  engineB.appendEvent(engineB.createEvent("highlight", highlightB, "create", {
    book: "ACT",
    chapter: 19,
    verse_start: 2,
    verse_end: 3,
    package: "web",
    color: "blue",
    kind: "highlight",
  }));

  const licensedPackage = join(LIB_A, ".artifacts/scripture/packages/licensed");
  mkdirSync(join(licensedPackage, "text/ACT"), { recursive: true });
  writeFileSync(join(licensedPackage, "manifest.json"), JSON.stringify({
    id: "licensed",
    name: "Licensed Test Package",
    license: { permissions: { syncToOwnDevices: false } },
  }, null, 2));
  writeFileSync(join(licensedPackage, "text/ACT/19.json"), JSON.stringify({ verses: ["licensed content"] }));
  check("Offline edits created", true);

  section("2. Sync libraries");
  const sync = new FolderSyncAdapter();
  const result = sync.syncLibraries(LIB_A, LIB_B);
  check("Highlight events copied both directions", result.eventsCopied >= 2, `eventsCopied=${result.eventsCopied}`);
  check("Note conflict copies created", result.noteConflicts >= 2, `noteConflicts=${result.noteConflicts}`);
  check("Artifact pointer copied", existsSync(join(LIB_B, ".artifacts/scripture/packages/licensed/manifest.json")));
  check("Licensed package content not synced", !existsSync(join(LIB_B, ".artifacts/scripture/packages/licensed/text/ACT/19.json")));

  section("3. Verify no authored data loss");
  const bodiesA = noteBodies(LIB_A).join("\n");
  const bodiesB = noteBodies(LIB_B).join("\n");
  check("Library A keeps both note bodies", bodiesA.includes("Library A edit") && bodiesA.includes("Library B edit"));
  check("Library B keeps both note bodies", bodiesB.includes("Library A edit") && bodiesB.includes("Library B edit"));

  engineB.buildSqlite();
  const query = engineB.queryVerse("ACT", 19, 2);
  check("Both overlapping highlights survive", query.highlights.length === 2, `highlights=${query.highlights.length}`);

  section("4. Doctor flags overlapping highlights");
  const doctor = runDoctor({
    notes: engineB.readAllNotes(),
    events: engineB.readAllEvents(),
    manifest: engineB.readManifest(),
    backbone,
    rebuildHash: null,
    expectedRebuildHash: null,
    packageManifests: [],
    sourceDirs: [],
    installedArtifactPaths: [],
  });
  check(
    "Doctor reports overlapping highlights",
    doctor.diagnostics.some((diagnostic) => diagnostic.category === "overlapping-highlights"),
  );

  rmSync(LIB_A, { recursive: true });
  rmSync(LIB_B, { recursive: true });

  console.log("\n=== M6 Verification Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log();

  if (failed > 0) {
    console.error("M6 VERIFICATION FAILED");
    process.exit(1);
  }

  console.log("M6 VERIFICATION PASSED");
}

void main().catch((err) => {
  console.error("M6 verification crashed:", err);
  process.exit(1);
});
