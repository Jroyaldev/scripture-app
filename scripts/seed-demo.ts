/**
 * Demo data seeder — populates a library with placeholder notes, highlights,
 * claims, overlays, and embeddings so the UI can be previewed.
 */
import { rmSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ulid } from "ulid";
import { LibraryEngine } from "../src/host/library.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { MockEmbeddingProvider } from "../src/host/ai-provider.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { validateBackboneData } from "../src/core/reference/backbone.js";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data/scripture");
const LIB_PATH = resolve(process.env["HOME"] ?? "~", "Documents", "ScriptureLibrary");

const backbone = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8")) as BackboneData;
const val = validateBackboneData(backbone);
if (!val.ok) throw new Error(`Backbone invalid: ${val.error}`);
const bookNames = JSON.parse(readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8")) as BookNameMap;

// Fresh start
if (existsSync(LIB_PATH)) rmSync(LIB_PATH, { recursive: true });
mkdirSync(LIB_PATH, { recursive: true });

const engine = new LibraryEngine(LIB_PATH, backbone, bookNames);
engine.initLibrary();
engine.installBackboneData(join(DATA_DIR, "backbone.json"), join(DATA_DIR, "versification"));

// --- Create notes (scripture refs in body text will auto-create anchors) ---
const notes: { id: string; title: string; body: string }[] = [
  {
    id: ulid(),
    title: "Acts 2 — Pentecost and the Spirit",
    body: "The Holy Spirit was poured out at Pentecost. Peter said repent and be baptized in the name of Jesus Christ for the remission of sins, and you shall receive the gift of the Holy Spirit. [[Acts 2:38]]",
  },
  {
    id: ulid(),
    title: "Acts 8 — Ethiopian eunuch baptism",
    body: "Philip preached Jesus to the Ethiopian eunuch. As they went on their way, they came to water and the eunuch was baptized. [[Acts 8:36-38]]",
  },
  {
    id: ulid(),
    title: "Acts 10 — Gentiles receive the Spirit",
    body: "While Peter spoke, the Holy Spirit fell on the Gentiles. They spoke in tongues and were baptized. [[Acts 10:44-48]]",
  },
  {
    id: ulid(),
    title: "John 3 — born of water and Spirit",
    body: "Jesus said unless one is born of water and the Spirit, he cannot enter the kingdom of God. [[John 3:5]]",
  },
  {
    id: ulid(),
    title: "Galatians 3 — baptized into Christ",
    body: "For as many of you as were baptized into Christ have put on Christ. [[Galatians 3:27]]",
  },
  {
    id: ulid(),
    title: "Repentance without resurrection",
    body: "If there is no resurrection, our faith is vain. Repentance and baptism point to the reality of new life in Christ. The Spirit is the guarantee of our inheritance.",
  },
  {
    id: ulid(),
    title: "Ephesian disciples and John's baptism",
    body: "Paul found disciples at Ephesus who had only received John's baptism. They were re-baptized in the name of Jesus and received the Spirit. [[Acts 19:1-7]]",
  },
];

for (const n of notes) {
  engine.createNote(n.id, n.title, n.body);
}

// Build SQLite (auto-creates anchors from scripture refs in note bodies)
engine.buildSqlite();

// --- Create highlights via event system ---
const hl1Id = "hl_" + ulid();
const ev1 = engine.createEvent("highlight", hl1Id, "create", {
  book: "ACT",
  chapter: 19,
  verse_start: 2,
  verse_end: 3,
  package: "web",
  color: "yellow",
  kind: "highlight",
});
engine.appendEvent(ev1);

const hl2Id = "hl_" + ulid();
const ev2 = engine.createEvent("highlight", hl2Id, "create", {
  book: "ACT",
  chapter: 19,
  verse_start: 5,
  verse_end: 6,
  package: "web",
  color: "blue",
  kind: "highlight",
});
engine.appendEvent(ev2);

// --- Insert a claim ---
const claimId = "claim_" + ulid();
engine.insertClaim({
  id: claimId,
  assertion: "The Holy Spirit is given through baptism in Jesus' name",
  claimType: "theological",
  confidence: 0.85,
  extractor: "mock-ai",
  created: new Date().toISOString(),
  status: "active",
  anchors: [{ book: "ACT", chapter: 19, verse: 2 }],
  sources: [{ kind: "note", ref: `note:${notes[0]!.id}` }],
});

// --- Insert an overlay ---
const overlayId = "ovl_" + ulid();
engine.insertOverlay({
  id: overlayId,
  book: "ACT",
  chapter: 19,
  verse: 2,
  charStart: 10,
  charEnd: 50,
  reason: "Key phrase: Did you receive the Holy Spirit when you believed?",
  extractor: "mock-ai",
});

// Rebuild to materialize everything
engine.buildSqlite();

// --- Embed notes ---
const embDbPath = join(LIB_PATH, ".system/embeddings.sqlite");
const embStore = new EmbeddingsStore(embDbPath);
const embProvider = new MockEmbeddingProvider();

const dbPath = join(LIB_PATH, ".system/library.sqlite");
const db = new SQLiteMaterializer(dbPath);
const allNotes = db.getAllNotes();
for (const note of allNotes) {
  const text = `${note.title} ${note.body_text}`;
  const vec = await embProvider.embed([text]);
  embStore.upsertEmbedding("note", note.id, vec[0]!);
}
db.close();
embStore.close();

console.log(`Demo library seeded at: ${LIB_PATH}`);
console.log(`  Notes: ${notes.length}`);
console.log(`  Highlights: 2`);
console.log(`  Claims: 1`);
console.log(`  Overlays: 1`);
console.log(`  Embeddings: ${notes.length}`);
console.log(`  Default chapter: Acts 19`);
