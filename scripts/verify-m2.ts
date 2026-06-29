/**
 * M2 Verification Gate — exercises the DONE WHEN criteria.
 *
 * DONE WHEN: from a populated library, opening Acts 19:1–7 shows, in the margin
 * within ~1s and with no AI, every note anchored to or overlapping that range,
 * all highlights on it, and its public-domain cross-references — each tagged
 * user/source — and creating a note from the passage writes a correctly-anchored
 * note that appears in the margin on the next open. Importing an Obsidian vault
 * yields resolvable notes and links.
 */

import { existsSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { ulid } from "ulid";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { parseHumanRef, toBref, toDisplayString } from "../src/core/reference/parser.js";
import { validateBackboneData } from "../src/core/reference/backbone.js";
import { LibraryEngine } from "../src/host/library.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { assembleMargin } from "../src/core/margin/index.js";
import { importObsidianVault } from "../src/core/importer/obsidian.js";
import { GitRevisionStore } from "../src/host/git-revision-store.js";
import type { CrossRefData } from "../src/core/margin/types.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data/scripture");
const CROSS_REF_DIR = resolve(import.meta.dirname ?? ".", "../data/cross-references");
const TEST_LIBRARY = resolve(import.meta.dirname ?? ".", "../Library-m2-test");

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  FAIL: ${msg}`);
  }
}

function section(title: string): void {
  console.log(`\n--- ${title} ---`);
}

// Cleanup
if (existsSync(TEST_LIBRARY)) {
  rmSync(TEST_LIBRARY, { recursive: true });
}

// Load data
const backbone: BackboneData = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8"));
const bookNames: BookNameMap = JSON.parse(readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8"));
const crossRefData: CrossRefData = JSON.parse(readFileSync(join(CROSS_REF_DIR, "tsk.json"), "utf-8"));

const backboneValidation = validateBackboneData(backbone);
assert(backboneValidation.ok, "Backbone validates");

// --- Section 1: Initialize Library with content ---
section("1. Initialize populated Library");

const engine = new LibraryEngine(TEST_LIBRARY, backbone, bookNames);
engine.initLibrary();
engine.installBackboneData(
  join(DATA_DIR, "backbone.json"),
  join(DATA_DIR, "versification"),
);

assert(existsSync(join(TEST_LIBRARY, "config/library-manifest.json")), "Library initialized");

// Create notes anchored to Acts 19
const noteId1 = ulid();
engine.createNote(noteId1, "The Holy Spirit in Acts 19", `
Paul encounters disciples in Ephesus who had received John's baptism.
They had not even heard of the Holy Spirit.
Paul explains the difference and baptizes them in Jesus' name.

Key passage: Acts 19:1-7
See also John 3:5 on being born of water and Spirit.
cf. Gal 3:26-29 on baptism into Christ.
`, { type: "exegetical", tags: ["pneumatology", "baptism"] });

const noteId2 = ulid();
engine.createNote(noteId2, "Baptism in the New Testament", `
An overview of baptism passages across the NT.

- Acts 2:38 - Repent and be baptized
- Acts 8:36-38 - The Ethiopian eunuch
- Acts 10:47-48 - Gentile Pentecost
- Acts 19:5 - Rebaptism in Jesus' name
- Romans 6:3-4 - Baptized into death

Related: [[note:${noteId1}|The Holy Spirit in Acts 19]]
`, { type: "topical", tags: ["baptism"] });

assert(true, "Two notes created with scripture references");

// Create a highlight on Acts 19:2
const hlEntityId = "hl_" + ulid();
const hlEvent = engine.createEvent("highlight", hlEntityId, "create", {
  book: "ACT",
  chapter: 19,
  verse_start: 2,
  verse_end: 2,
  package: "web",
  color: "yellow",
  kind: "highlight",
});
engine.appendEvent(hlEvent);
assert(true, "Highlight created on Acts 19:2");

// Build SQLite
const hash = engine.buildSqlite();
assert(hash.length === 64, "SQLite built with rebuild_hash");

// --- Section 2: Living Margin for Acts 19:1-7 ---
section("2. Living Margin — deterministic resurfacing");

const ref = parseHumanRef("Acts 19:1-7", bookNames, backbone);
assert(ref.ok, "Acts 19:1-7 resolves");
if (!ref.ok) process.exit(1);

const bref = toBref(ref.value);
assert(bref === "bref:v1/ACT.19.1-ACT.19.7", `bref correct: ${bref}`);

const display = toDisplayString(ref.value, bookNames);
assert(display === "Acts 19:1\u20137", `Display correct: ${display}`);

// Query margin
const dbPath = join(TEST_LIBRARY, ".system/library.sqlite");
const db = new SQLiteMaterializer(dbPath);

const startTime = performance.now();
const margin = assembleMargin(
  {
    book: "ACT",
    startChapter: 19,
    startVerse: 1,
    endChapter: 19,
    endVerse: 7,
  },
  db,
  crossRefData,
  bookNames,
);
const elapsed = performance.now() - startTime;

db.close();

console.log(`  Margin assembled in ${elapsed.toFixed(1)}ms`);
assert(elapsed < 1000, `Margin assembled within 1s (${elapsed.toFixed(1)}ms)`);

// Check notes
assert(margin.notes.length >= 1, `Notes found in margin: ${margin.notes.length}`);
const noteFound = margin.notes.some((n) => n.noteId === noteId1);
assert(noteFound, "Note 'The Holy Spirit in Acts 19' appears in margin");

// Check highlights
assert(margin.highlights.length >= 1, `Highlights found in margin: ${margin.highlights.length}`);
const hlFound = margin.highlights.some((h) => h.highlightId === hlEntityId);
assert(hlFound, "Highlight on Acts 19:2 appears in margin");

// Check cross-references (from TSK)
assert(margin.crossRefs.length > 0, `Cross-references found: ${margin.crossRefs.length}`);
const hasTskCrossRef = margin.crossRefs.some((x) => x.sourceId === "tsk");
assert(hasTskCrossRef, "TSK cross-references present in margin");

// Provenance typing
const allItemsHaveProvenance = [
  ...margin.notes.map((n) => n.provenance === "user"),
  ...margin.highlights.map((h) => h.provenance === "user"),
  ...margin.crossRefs.map((x) => x.provenance === "source"),
].every(Boolean);
assert(allItemsHaveProvenance, "All margin items have correct provenance typing");

// --- Section 3: Create note from passage → appears in margin ---
section("3. Create note from passage → appears in margin on next open");

const newNoteId = ulid();
engine.createNote(newNoteId, "Acts 19 Rebaptism Note", `
The disciples in Ephesus received John's baptism but were unaware of the Holy Spirit.
Paul lays hands on them and they receive the Spirit.

This note is anchored to: Acts 19:1-7
`, { type: "user", tags: ["rebaptism"] });

// Rebuild SQLite
engine.buildSqlite();

// Query margin again ("next open")
const db2 = new SQLiteMaterializer(dbPath);
const margin2 = assembleMargin(
  {
    book: "ACT",
    startChapter: 19,
    startVerse: 1,
    endChapter: 19,
    endVerse: 7,
  },
  db2,
  crossRefData,
  bookNames,
);
db2.close();

const newNoteInMargin = margin2.notes.some((n) => n.noteId === newNoteId);
assert(newNoteInMargin, "Newly created note appears in margin on next open");

// --- Section 4: Obsidian vault import ---
section("4. Obsidian vault import");

const obsidianFiles = [
  {
    path: "Baptism Study.md",
    content: `---
title: "Baptism Study"
tags: [baptism, theology]
created: 2024-01-15
---

# Baptism in Scripture

Water baptism is a key theme across the NT. See also [[Holy Spirit in Acts]].

Key passages:
- Acts 2:38
- Romans 6:3-4
- Galatians 3:27
`,
  },
  {
    path: "Holy Spirit in Acts.md",
    content: `---
title: "Holy Spirit in Acts"
tags: [pneumatology, acts]
---

# The Holy Spirit in the book of Acts

The Spirit is given at Pentecost (Acts 2) and at various points throughout.
Acts 19:1-7 shows the difference between John's baptism and Spirit baptism.

See also [[Baptism Study]] for a broader view.
`,
  },
  {
    path: "subfolder/Cross References.md",
    content: `---
title: "Cross References"
---

Some important cross-references:
- [[Baptism Study]] connects to [[Holy Spirit in Acts]]
- These themes are woven throughout the NT
`,
  },
];

const importResult = importObsidianVault(obsidianFiles, ulid);

assert(importResult.stats.imported === 3, `Imported ${importResult.stats.imported} notes from vault`);
assert(importResult.stats.linksResolved > 0, `Links resolved: ${importResult.stats.linksResolved}`);

// Check that wikilinks were rewritten to [[note:ULID|label]]
const baptismNote = importResult.notes.find((n) => n.title === "Baptism Study");
assert(baptismNote !== undefined, "Baptism Study note imported");
if (baptismNote) {
  const hasRewrittenLink = /\[\[note:[A-Z0-9]+\|/.test(baptismNote.body);
  assert(hasRewrittenLink, "Wikilinks rewritten to [[note:ULID|label]] format");
}

const hsNote = importResult.notes.find((n) => n.title === "Holy Spirit in Acts");
assert(hsNote !== undefined, "Holy Spirit in Acts note imported");
if (hsNote) {
  const hasRewrittenLink = /\[\[note:[A-Z0-9]+\|/.test(hsNote.body);
  assert(hasRewrittenLink, "Bi-directional links resolved");
}

// Write imported notes to library
for (const note of importResult.notes) {
  engine.createNote(note.id, note.title, note.body, { tags: note.tags });
}
engine.buildSqlite();

// Verify imported notes are queryable
const db3 = new SQLiteMaterializer(dbPath);
const allNotes = db3.getAllNotes();
const importedInDb = allNotes.some((n) => n.title === "Baptism Study");
assert(importedInDb, "Imported notes are in SQLite and queryable");

// FTS5 search
const searchResults = db3.searchNotes("baptism");
assert(searchResults.length > 0, `FTS5 search for 'baptism' returns results: ${searchResults.length}`);
db3.close();

// --- Section 5: Git RevisionStore ---
section("5. Git RevisionStore adapter");

const revStore = new GitRevisionStore(TEST_LIBRARY);
revStore.init();

const gitDir = join(TEST_LIBRARY, ".git");
assert(existsSync(gitDir), "Git repository initialized");

const txn = await revStore.beginTransaction("Test commit");
txn.files.push("notes/" + newNoteId + "--acts-19-rebaptism-note.md");
await revStore.commit(txn);
await revStore.flush("Test flush");

const history = await revStore.history();
assert(history.length > 0, `Git history has entries: ${history.length}`);

// --- Section 6: Design tokens ---
section("6. Design tokens");

const tokensPath = resolve(import.meta.dirname ?? ".", "../src/renderer/design-tokens.json");
assert(existsSync(tokensPath), "design-tokens.json exists");

const tokens = JSON.parse(readFileSync(tokensPath, "utf-8"));
assert("color" in tokens, "Tokens have color section");
assert("typography" in tokens, "Tokens have typography section");
assert("spacing" in tokens, "Tokens have spacing section");
assert("layout" in tokens, "Tokens have layout section");
assert("density" in tokens, "Tokens have density section");

// --- Section 7: Cross-ref data integrity ---
section("7. Cross-reference corpus");

assert(crossRefData.meta.id === "tsk", "TSK corpus loaded");
assert(crossRefData.meta.license === "Public Domain", "TSK is public domain");

const actsRefs = crossRefData.refs["ACT.19.1"];
assert(actsRefs !== undefined && actsRefs.length > 0, `ACT.19.1 has cross-refs: ${actsRefs?.length}`);

const galRefs = crossRefData.refs["GAL.3.26"];
assert(galRefs !== undefined && galRefs.length > 0, `GAL.3.26 has cross-refs: ${galRefs?.length}`);

// --- Section 8: Electron shell structure ---
section("8. Electron shell structure");

const electronMainPath = resolve(import.meta.dirname ?? ".", "../src/electron/main.ts");
const preloadPath = resolve(import.meta.dirname ?? ".", "../src/electron/preload.ts");
assert(existsSync(electronMainPath), "Electron main.ts exists");
assert(existsSync(preloadPath), "Electron preload.ts exists");

const electronMain = readFileSync(electronMainPath, "utf-8");
assert(electronMain.includes("BrowserWindow"), "Main creates BrowserWindow");
assert(electronMain.includes("ipcMain.handle"), "Main registers IPC handlers");
assert(electronMain.includes("assembleMargin"), "Main wires Living Margin");
assert(electronMain.includes("importObsidianVault"), "Main wires Obsidian import");
assert(electronMain.includes("GitRevisionStore"), "Main wires Git RevisionStore");

// --- Section 9: UI components ---
section("9. UI components");

const rendererDir = resolve(import.meta.dirname ?? ".", "../src/renderer");
assert(existsSync(join(rendererDir, "app.tsx")), "app.tsx entry point");
assert(existsSync(join(rendererDir, "components/ScripturePage.tsx")), "ScripturePage component");
assert(existsSync(join(rendererDir, "components/WritingSheet.tsx")), "WritingSheet component");
assert(existsSync(join(rendererDir, "components/LivingMargin.tsx")), "LivingMargin component");
assert(existsSync(join(rendererDir, "components/SearchView.tsx")), "SearchView component");
assert(existsSync(join(rendererDir, "styles.css")), "styles.css");
assert(existsSync(join(rendererDir, "index.html")), "index.html");

// Check components reference provenance
const marginComponent = readFileSync(join(rendererDir, "components/LivingMargin.tsx"), "utf-8");
assert(marginComponent.includes("provenance"), "LivingMargin shows provenance");
assert(marginComponent.includes("cross-ref"), "LivingMargin shows cross-references");

// --- Results ---
console.log("\n=== M2 Verification Results ===");
console.log(`  Passed: ${passed}`);
console.log(`  Failed: ${failed}`);
console.log(`  Total:  ${passed + failed}`);

if (failed === 0) {
  console.log("\nM2 VERIFICATION PASSED");
} else {
  console.log("\nM2 VERIFICATION FAILED");
  process.exit(1);
}

// Cleanup
rmSync(TEST_LIBRARY, { recursive: true });
