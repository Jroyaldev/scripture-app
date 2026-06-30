/**
 * CLI entry point — the `library` command.
 * Commands: init, doctor, rebuild, migrate, query, demo
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { homedir } from "node:os";
import { ulid } from "ulid";
import type { BackboneData, BookNameMap, ScripturePackage } from "../core/reference/types.js";
import { parseBref, toBref, toDisplayString, parseHumanRef } from "../core/reference/parser.js";
import { validateBackboneData } from "../core/reference/backbone.js";
import { checkMigration } from "../core/migration/index.js";
import { runDoctor } from "../core/doctor/index.js";
import type { LibraryManifest } from "../core/interfaces.js";
import { LibraryEngine } from "../host/library.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../../data/scripture");

function loadBackbone(): BackboneData {
  const backbonePath = join(DATA_DIR, "backbone.json");
  const data = JSON.parse(readFileSync(backbonePath, "utf-8")) as BackboneData;
  const validation = validateBackboneData(data);
  if (!validation.ok) {
    console.error(`Backbone validation failed: ${validation.error}`);
    process.exit(1);
  }
  return data;
}

function loadBookNames(): BookNameMap {
  const namesPath = join(DATA_DIR, "book-names-en.json");
  return JSON.parse(readFileSync(namesPath, "utf-8")) as BookNameMap;
}

function getLibraryPath(): string {
  return process.env["LIBRARY_PATH"] ?? resolve(homedir(), "Documents", "ScriptureLibrary");
}

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "init": {
    const libraryPath = getLibraryPath();
    const backbone = loadBackbone();
    const bookNames = loadBookNames();
    const engine = new LibraryEngine(libraryPath, backbone, bookNames);

    engine.initLibrary();

    // Install backbone and versification data
    engine.installBackboneData(
      join(DATA_DIR, "backbone.json"),
      join(DATA_DIR, "versification"),
    );

    // Install WEB package manifest
    const webPackage: ScripturePackage = {
      id: "web",
      name: "World English Bible",
      language: "en",
      type: "translation",
      versification: "web",
      canonProfile: "protestant",
      license: {
        name: "Public Domain",
        attributionText: "World English Bible (WEB). Public Domain. No copyright. Free to use, copy, and distribute.",
        permissions: {
          bundle: true,
          index: true,
          display: true,
          quoteInNotes: true,
          export: true,
          syncToOwnDevices: true,
        },
      },
    };
    engine.installPackageManifest("web", webPackage);

    // Install KJV package manifest
    const kjvPackage: ScripturePackage = {
      id: "kjv",
      name: "King James Version",
      language: "en",
      type: "translation",
      versification: "kjv",
      canonProfile: "protestant",
      license: {
        name: "Public Domain",
        attributionText: "King James Version (KJV). Public Domain. Crown Copyright expired; no copyright restrictions in the United States and most jurisdictions.",
        permissions: {
          bundle: true,
          index: true,
          display: true,
          quoteInNotes: true,
          export: true,
          syncToOwnDevices: true,
        },
      },
    };
    engine.installPackageManifest("kjv", kjvPackage);

    console.log(`Library initialized at: ${libraryPath}`);
    break;
  }

  case "doctor": {
    const libraryPath = getLibraryPath();
    const backbone = loadBackbone();
    const bookNames = loadBookNames();
    const engine = new LibraryEngine(libraryPath, backbone, bookNames);

    const notes = engine.readAllNotes();
    const events = engine.readAllEvents();
    const manifest = engine.readManifest();

    // Read package manifests
    const packagesDir = join(libraryPath, ".artifacts/scripture/packages");
    const packageManifests: Array<{ id: string; license?: Record<string, unknown> }> = [];
    if (existsSync(packagesDir)) {
      const { readdirSync } = await import("node:fs");
      for (const pkgId of readdirSync(packagesDir)) {
        const manifestPath = join(packagesDir, pkgId, "manifest.json");
        if (existsSync(manifestPath)) {
          const pkgData = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
          packageManifests.push({ id: pkgId, license: pkgData["license"] as Record<string, unknown> | undefined });
        }
      }
    }

    // Get rebuild hash if SQLite exists
    let rebuildHash: string | null = null;
    let expectedRebuildHash: string | null = null;
    const dbPath = join(libraryPath, ".system/library.sqlite");
    if (existsSync(dbPath)) {
      const { SQLiteMaterializer } = await import("../host/sqlite.js");
      const db = new SQLiteMaterializer(dbPath);
      rebuildHash = db.getMeta("rebuild_hash") ?? null;
      db.close();

      // Rebuild to get expected hash
      expectedRebuildHash = engine.buildSqlite();
    }

    const report = runDoctor({
      notes,
      events,
      manifest,
      backbone,
      rebuildHash,
      expectedRebuildHash,
      packageManifests,
      sourceDirs: [],
      installedArtifactPaths: [],
    });

    console.log("\n=== Library Doctor Report ===\n");
    for (const diag of report.diagnostics) {
      const icon = diag.severity === "error" ? "ERROR" : diag.severity === "warning" ? "WARN " : "INFO ";
      console.log(`[${icon}] [${diag.category}] ${diag.message}`);
      if (diag.suggestion) {
        console.log(`        Suggestion: ${diag.suggestion}`);
      }
    }

    if (report.diagnostics.length === 0) {
      console.log("No issues found.");
    }

    console.log(`\nSummary: ${report.summary.errors} error(s), ${report.summary.warnings} warning(s), ${report.summary.infos} info(s)`);
    console.log(`Health: ${report.summary.healthy ? "HEALTHY" : "UNHEALTHY"}`);
    break;
  }

  case "rebuild": {
    const libraryPath = getLibraryPath();
    const backbone = loadBackbone();
    const bookNames = loadBookNames();
    const engine = new LibraryEngine(libraryPath, backbone, bookNames);

    const hash = engine.buildSqlite();
    const summary = engine.getSummary();

    console.log("\n=== Library Rebuild ===\n");
    console.log(`Notes found:      ${summary.notesFound}`);
    console.log(`Anchors found:    ${summary.anchorsFound}`);
    console.log(`Highlights found: ${summary.highlightsFound}`);
    console.log(`Facts found:      ${summary.factsFound}`);
    console.log(`Unresolved refs:  ${summary.unresolvedRefs}`);
    console.log(`Rebuild hash:     ${hash}`);
    break;
  }

  case "migrate": {
    const libraryPath = getLibraryPath();
    const dryRun = args.includes("--dry-run");
    const manifestPath = join(libraryPath, "config/library-manifest.json");

    if (!existsSync(manifestPath)) {
      console.error("No library-manifest.json found. Run 'library init' first.");
      process.exit(1);
    }

    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as LibraryManifest;
    const result = checkMigration(manifest, dryRun);

    console.log(`\n=== Library Migration ${dryRun ? "(dry run)" : ""} ===\n`);
    console.log(`Status: ${result.status}`);
    console.log(`${result.message}`);
    break;
  }

  case "query": {
    const libraryPath = getLibraryPath();
    const backbone = loadBackbone();
    const bookNames = loadBookNames();
    const engine = new LibraryEngine(libraryPath, backbone, bookNames);

    const queryArg = args[1];
    if (!queryArg) {
      console.error("Usage: library query <bref or human ref>");
      console.error("  Example: library query 'Acts 19:2'");
      console.error("  Example: library query 'bref:v1/ACT.19.2'");
      process.exit(1);
    }

    let book: string, chapter: number, verse: number;

    if (queryArg.startsWith("bref:")) {
      const parsed = parseBref(queryArg);
      if (!parsed.ok) {
        console.error(`Parse error: ${parsed.error}`);
        process.exit(1);
      }
      book = parsed.value.start.book;
      chapter = parsed.value.start.chapter;
      verse = parsed.value.start.verse;
    } else {
      const parsed = parseHumanRef(queryArg, bookNames, backbone);
      if (!parsed.ok) {
        console.error(`Parse error: ${parsed.error}`);
        process.exit(1);
      }
      book = parsed.value.start.book;
      chapter = parsed.value.start.chapter;
      verse = parsed.value.start.verse;
    }

    const results = engine.queryVerse(book, chapter, verse);
    console.log(`\n=== Everything anchored to ${book} ${chapter}:${verse} ===\n`);
    console.log(`Anchors: ${results.anchors.length}`);
    console.log(`Notes:   ${results.notes.length}`);
    console.log(`Highlights: ${results.highlights.length}`);

    for (const note of results.notes) {
      console.log(`  Note: "${note.title}" (${note.id})`);
    }
    for (const h of results.highlights) {
      console.log(`  Highlight: ${h.book} ${h.chapter}:${h.verse_start}-${h.verse_end} (${h.color})`);
    }
    break;
  }

  case "resolve": {
    const backbone = loadBackbone();
    const bookNames = loadBookNames();
    const refArg = args[1];
    if (!refArg) {
      console.error("Usage: library resolve <human ref>");
      process.exit(1);
    }

    const parsed = parseHumanRef(refArg, bookNames, backbone);
    if (!parsed.ok) {
      console.error(`Parse error: ${parsed.error}`);
      process.exit(1);
    }
    const bref = toBref(parsed.value);
    const display = toDisplayString(parsed.value, bookNames);
    console.log(`Input:    ${refArg}`);
    console.log(`bref:     ${bref}`);
    console.log(`Display:  ${display}`);
    break;
  }

  case "demo": {
    await runM1Demo();
    break;
  }

  default: {
    console.log(`Scripture-Native Knowledge Library CLI

Usage: library <command> [options]

Commands:
  init                  Initialize a new Library folder
  doctor                Run integrity checks on the Library
  rebuild               Rebuild .system/library.sqlite from substrate
  migrate [--dry-run]   Check/run migrations on the Library
  query <ref>           Query everything anchored to a verse
  resolve <ref>         Resolve a human-readable reference to bref
  demo                  Run the M1 acceptance demo

Environment:
  LIBRARY_PATH          Path to the Library folder (default: ./Library)
`);
  }
}

/**
 * Full M1 acceptance demo — runs all 11 DONE WHEN checks.
 */
async function runM1Demo(): Promise<void> {
  const backbone = loadBackbone();
  const bookNames = loadBookNames();

  console.log("=== M1 Acceptance Demo ===\n");

  // 1. Create a new Library folder
  const libraryPath = resolve("./Library-demo");
  const engine = new LibraryEngine(libraryPath, backbone, bookNames);
  engine.initLibrary();
  console.log("[1] Created new Library folder at:", libraryPath);

  // Install backbone data
  engine.installBackboneData(
    join(DATA_DIR, "backbone.json"),
    join(DATA_DIR, "versification"),
  );

  // 2. Load WEB + KJV package manifests
  const webPackage: ScripturePackage = {
    id: "web",
    name: "World English Bible",
    language: "en",
    type: "translation",
    versification: "web",
    canonProfile: "protestant",
    license: {
      name: "Public Domain",
      attributionText: "World English Bible (WEB). Public Domain.",
      permissions: { bundle: true, index: true, display: true, quoteInNotes: true, export: true, syncToOwnDevices: true },
    },
  };
  const kjvPackage: ScripturePackage = {
    id: "kjv",
    name: "King James Version",
    language: "en",
    type: "translation",
    versification: "kjv",
    canonProfile: "protestant",
    license: {
      name: "Public Domain",
      attributionText: "King James Version (KJV). Public Domain.",
      permissions: { bundle: true, index: true, display: true, quoteInNotes: true, export: true, syncToOwnDevices: true },
    },
  };
  engine.installPackageManifest("web", webPackage);
  engine.installPackageManifest("kjv", kjvPackage);
  console.log("[2] Loaded WEB + KJV package manifests.");

  // 3. Resolve Acts 19:1-7, John 3:1-8, Gal 3:26-29 to bref:v1/...
  const testRefs = ["Acts 19:1-7", "John 3:1-8", "Gal 3:26-29"];
  console.log("[3] Resolving references:");
  for (const ref of testRefs) {
    const parsed = parseHumanRef(ref, bookNames, backbone);
    if (!parsed.ok) {
      console.error(`   FAIL: ${ref} -> ${parsed.error}`);
      process.exit(1);
    }
    const bref = toBref(parsed.value);
    const display = toDisplayString(parsed.value, bookNames);
    console.log(`   ${ref} -> ${bref} -> ${display}`);
  }

  // 4. Create two notes with frontmatter ULIDs; parse inline note-links and scripture refs
  const noteId1 = ulid();
  const noteId2 = ulid();

  engine.createNote(noteId1, "Acts 19 - The Holy Spirit", `
The passage in Acts 19:1-7 describes Paul's encounter with disciples in Ephesus.
They had received John's baptism but had not heard of the Holy Spirit.

See also John 3:5 on being born of water and Spirit.
cf. Gal 3:26-29 on baptism into Christ.

Related: [[note:${noteId2}|Baptism Theology Notes]]
`, { type: "exegetical", tags: ["baptism", "pneumatology"] });

  engine.createNote(noteId2, "Baptism Theology Notes", `
A study on baptism across the New Testament.

Key passages:
- Acts 2:38 - Repent and be baptized
- Acts 8:36-38 - The Ethiopian eunuch
- Acts 10:47-48 - The Gentile Pentecost
- Romans 6:3-4 - Baptized into his death

See also Acts 19:1-7 for John's baptism vs. Christian baptism.
`, { type: "topical", tags: ["baptism"] });

  console.log(`[4] Created two notes: ${noteId1}, ${noteId2}`);

  // Re-read to verify parsing
  const notes = engine.readAllNotes();
  for (const note of notes) {
    console.log(`   Note "${note.frontmatter.title}": ${note.scriptureRefs.length} scripture refs, ${note.noteLinks.length} note links`);
  }

  // 5. Append one highlight create event and one pinned-fact pin event
  const highlightEntityId = "hl_" + ulid();
  const highlightEvent = engine.createEvent("highlight", highlightEntityId, "create", {
    book: "ACT",
    chapter: 19,
    verse_start: 2,
    verse_end: 2,
    package: "web",
    color: "yellow",
    kind: "highlight",
  });
  engine.appendEvent(highlightEvent);

  const factEntityId = "fact_" + ulid();
  const factEvent = engine.createEvent("fact", factEntityId, "pin", {
    assertion: "In Acts 19, the Ephesian disciples had received John's baptism but were unaware of the Holy Spirit, prompting Paul to rebaptize them in the name of Jesus.",
    from_claim: null,
    user_note: null,
  });
  engine.appendEvent(factEvent);
  console.log("[5] Appended highlight create event and pinned-fact pin event.");

  // 6. Build .system/library.sqlite; record rebuild_hash in meta
  const hash1 = engine.buildSqlite();
  console.log(`[6] Built library.sqlite. rebuild_hash: ${hash1}`);

  // 7. Query "everything anchored to ACT.19.2"
  const queryResults = engine.queryVerse("ACT", 19, 2);
  console.log(`[7] Everything anchored to ACT 19:2:`);
  console.log(`   Anchors: ${queryResults.anchors.length}`);
  console.log(`   Notes:   ${queryResults.notes.length}`);
  console.log(`   Highlights: ${queryResults.highlights.length}`);
  for (const note of queryResults.notes) {
    console.log(`   -> Note: "${note.title}"`);
  }
  for (const h of queryResults.highlights) {
    console.log(`   -> Highlight: ${h.book} ${h.chapter}:${h.verse_start}-${h.verse_end} (${h.color})`);
  }

  // 8. Delete .system/, rebuild, confirm identical rebuild_hash
  engine.deleteSystemDir();
  console.log("[8] Deleted .system/ directory.");
  const hash2 = engine.buildSqlite();
  console.log(`   Rebuilt. New rebuild_hash: ${hash2}`);
  if (hash1 === hash2) {
    console.log("   PASS: rebuild_hash is identical after delete + rebuild.");
  } else {
    console.log("   FAIL: rebuild_hash mismatch!");
    console.log(`   First:  ${hash1}`);
    console.log(`   Second: ${hash2}`);
    process.exit(1);
  }

  // 9. library doctor
  const events = engine.readAllEvents();
  const manifest = engine.readManifest();

  const packagesDir = join(libraryPath, ".artifacts/scripture/packages");
  const { readdirSync } = await import("node:fs");
  const packageManifests: Array<{ id: string; license?: Record<string, unknown> }> = [];
  for (const pkgId of readdirSync(packagesDir)) {
    const manifestPath = join(packagesDir, pkgId, "manifest.json");
    if (existsSync(manifestPath)) {
      const pkgData = JSON.parse(readFileSync(manifestPath, "utf-8")) as Record<string, unknown>;
      packageManifests.push({ id: pkgId, license: pkgData["license"] as Record<string, unknown> | undefined });
    }
  }

  const doctorReport = runDoctor({
    notes,
    events,
    manifest,
    backbone,
    rebuildHash: hash2,
    expectedRebuildHash: hash2,
    packageManifests,
    sourceDirs: [],
    installedArtifactPaths: [],
  });

  console.log("[9] Library Doctor report:");
  for (const diag of doctorReport.diagnostics) {
    const icon = diag.severity === "error" ? "ERROR" : diag.severity === "warning" ? "WARN " : "INFO ";
    console.log(`   [${icon}] ${diag.message}`);
  }
  console.log(`   Summary: ${doctorReport.summary.errors} errors, ${doctorReport.summary.warnings} warnings, ${doctorReport.summary.infos} infos`);
  console.log(`   Health: ${doctorReport.summary.healthy ? "HEALTHY" : "UNHEALTHY"}`);

  // 10. library migrate --dry-run
  if (manifest) {
    const migrationResult = checkMigration(manifest, true);
    console.log(`[10] Migration --dry-run: ${migrationResult.status} — ${migrationResult.message}`);
  }

  // 11. CLI summary
  const summary = engine.getSummary();
  console.log("[11] CLI summary:");
  console.log(`   Notes found:      ${summary.notesFound}`);
  console.log(`   Anchors found:    ${summary.anchorsFound}`);
  console.log(`   Highlights found: ${summary.highlightsFound}`);
  console.log(`   Facts found:      ${summary.factsFound}`);
  console.log(`   Unresolved refs:  ${summary.unresolvedRefs}`);
  console.log(`   Errors:           ${summary.errors.length}`);

  console.log("\n=== M1 Demo Complete ===");
}
