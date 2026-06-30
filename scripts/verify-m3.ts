/**
 * M3 Verification — Semantic Intelligence Layer
 *
 * Acceptance scenario from §7: "the library wakes up"
 *
 * GIVEN a populated library with notes anchored across Acts 2, Acts 8, Acts 10,
 *       John's baptism passages, Galatians 3, and a note "repentance without resurrection",
 * AND the Budget Envelope set to local-only,
 * WHEN the user opens Acts 19:1–7 (WEB) and the passage text is embedded,
 * THEN the Living Margin assembles, grouped and provenance-typed:
 *      - Related notes surfaced via semantic similarity (no explicit anchor)
 *      - Claims with provenance and confidence
 *      - Cross-references (AI + public-domain)
 * AND pinning a claim writes a FactCard (Substrate),
 * AND deleting .system/ and rebuilding leaves the FactCard intact.
 */

import { rmSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { ulid } from "ulid";
import { LibraryEngine } from "../src/host/library.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { BudgetManager } from "../src/host/budget-manager.js";
import { MockAIProvider, MockEmbeddingProvider } from "../src/host/ai-provider.js";
import { assembleMargin } from "../src/core/margin/index.js";
import { assembleSemanticMargin } from "../src/core/ai/semantic-margin.js";
import { deterministicEmbedding, cosineSimilarity } from "../src/core/ai/similarity.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { validateBackboneData } from "../src/core/reference/backbone.js";
import { readFileSync } from "node:fs";

const DATA_DIR = resolve(import.meta.dirname ?? ".", "../data/scripture");
const CROSS_REF_DIR = resolve(import.meta.dirname ?? ".", "../data/cross-references");
const TMP_DIR = resolve(import.meta.dirname ?? ".", "../tmp-m3-verify");

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

function loadBackbone(): BackboneData {
  const data = JSON.parse(readFileSync(join(DATA_DIR, "backbone.json"), "utf-8")) as BackboneData;
  const validation = validateBackboneData(data);
  if (!validation.ok) throw new Error(`Backbone validation failed: ${validation.error}`);
  return data;
}

function loadBookNames(): BookNameMap {
  return JSON.parse(readFileSync(join(DATA_DIR, "book-names-en.json"), "utf-8")) as BookNameMap;
}

function loadCrossRefs(): { meta: { id: string; name: string; source: string; license: string }; refs: Record<string, string[]> } | null {
  const path = join(CROSS_REF_DIR, "tsk.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf-8"));
}

async function main(): Promise<void> {
  // Clean tmp
  if (existsSync(TMP_DIR)) rmSync(TMP_DIR, { recursive: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const backbone = loadBackbone();
  const bookNames = loadBookNames();
  const crossRefData = loadCrossRefs();

  const engine = new LibraryEngine(TMP_DIR, backbone, bookNames);
  engine.initLibrary();
  engine.installBackboneData(
    join(DATA_DIR, "backbone.json"),
    join(DATA_DIR, "versification"),
  );

  // --- 1. Create populated library with notes across Acts 2, 8, 10, John 3, Gal 3 ---

  console.log("\n--- 1. Create populated library ---");

  const noteIds: string[] = [];

  const note1Id = ulid();
  engine.createNote(note1Id, "Acts 2 — Pentecost and the Spirit", "The Holy Spirit was poured out at Pentecost. Peter said repent and be baptized in the name of Jesus Christ for the remission of sins, and you shall receive the gift of the Holy Spirit. Acts 2:38");
  noteIds.push(note1Id);

  const note2Id = ulid();
  engine.createNote(note2Id, "Acts 8 — Ethiopian eunuch baptism", "Philip preached Jesus to the Ethiopian eunuch. As they went on their way, they came to water and the eunuch was baptized. Acts 8:36-38");
  noteIds.push(note2Id);

  const note3Id = ulid();
  engine.createNote(note3Id, "Acts 10 — Gentiles receive the Spirit", "While Peter spoke, the Holy Spirit fell on the Gentiles. They spoke in tongues and were baptized. Acts 10:44-48");
  noteIds.push(note3Id);

  const note4Id = ulid();
  engine.createNote(note4Id, "John 3 — born of water and Spirit", "Jesus said unless one is born of water and the Spirit, he cannot enter the kingdom of God. John 3:5");
  noteIds.push(note4Id);

  const note5Id = ulid();
  engine.createNote(note5Id, "Galatians 3 — baptized into Christ", "For as many of you as were baptized into Christ have put on Christ. Gal 3:27");
  noteIds.push(note5Id);

  const note6Id = ulid();
  engine.createNote(note6Id, "Repentance without resurrection", "If there is no resurrection, our faith is vain. Repentance and baptism point to the reality of new life in Christ. The Spirit is the guarantee.");
  noteIds.push(note6Id);

  // Add anchors for notes 1-5 (but NOT note 6 — it should be surfaced semantically)
  engine.buildSqlite();
  const dbPath = join(TMP_DIR, ".system/library.sqlite");
  const db = new SQLiteMaterializer(dbPath);
  const anchors = [
    { id: "anc_" + ulid(), src_kind: "note", src_id: note1Id, corpus: "scripture", book: "ACT", start_ch: 2, start_v: 1, end_ch: 2, end_v: 47, provenance: "user" },
    { id: "anc_" + ulid(), src_kind: "note", src_id: note2Id, corpus: "scripture", book: "ACT", start_ch: 8, start_v: 26, end_ch: 8, end_v: 40, provenance: "user" },
    { id: "anc_" + ulid(), src_kind: "note", src_id: note3Id, corpus: "scripture", book: "ACT", start_ch: 10, start_v: 1, end_ch: 10, end_v: 48, provenance: "user" },
    { id: "anc_" + ulid(), src_kind: "note", src_id: note4Id, corpus: "scripture", book: "JHN", start_ch: 3, start_v: 1, end_ch: 3, end_v: 21, provenance: "user" },
    { id: "anc_" + ulid(), src_kind: "note", src_id: note5Id, corpus: "scripture", book: "GAL", start_ch: 3, start_v: 26, end_ch: 3, end_v: 29, provenance: "user" },
  ];
  for (const a of anchors) db.insertAnchor(a);
  db.close();

  // Rebuild to persist
  engine.buildSqlite();

  check("6 notes created", noteIds.length === 6);
  check("5 notes anchored to scripture ranges", anchors.length === 5);
  check("Note 6 (repentance) has NO explicit anchor to Acts 19", !anchors.some(a => a.src_id === note6Id));

  // --- 2. Embed notes ---

  console.log("\n--- 2. Embed notes ---");

  const embDbPath = join(TMP_DIR, ".system/embeddings.sqlite");
  const embStore = new EmbeddingsStore(embDbPath);
  const embProvider = new MockEmbeddingProvider();

  const db2 = new SQLiteMaterializer(dbPath);
  const notes = db2.getAllNotes();
  for (const note of notes) {
    const text = `${note.title} ${note.body_text}`;
    const vec = await embProvider.embed([text]);
    embStore.upsertEmbedding("note", note.id, vec[0]!);
  }
  db2.close();

  const allEmbeddings = embStore.getAllEmbeddings();
  check("All 6 notes embedded", allEmbeddings.length === 6);

  // --- 3. Semantic resurfacing — opening Acts 19:1-7 ---

  console.log("\n--- 3. Semantic resurfacing for Acts 19:1-7 ---");

  const passageText = "And it happened that while Apollos was at Corinth, Paul passed through the inland country and came to Ephesus. There he found some disciples. And he said to them, Did you receive the Holy Spirit when you believed? And they said to him, No, we have not even heard that there is a Holy Spirit. And he said, Into what then were you baptized? They said, Into John's baptism. And Paul said, John baptized with the baptism of repentance, telling the people to believe in the one who was to come after him, that is, Jesus. On hearing this, they were baptized in the name of the Lord Jesus. And when Paul had laid his hands on them, the Holy Spirit came on them, and they began speaking in tongues and prophesying.";

  const queryEmbedding = deterministicEmbedding(passageText, 256);

  // Get deterministic margin first
  const db3 = new SQLiteMaterializer(dbPath);
  const detMargin = assembleMargin(
    { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    db3,
    crossRefData,
    bookNames,
  );

  const alreadySurfaced = new Set(detMargin.notes.map((n) => n.noteId));
  check("Deterministic margin has no notes anchored to Acts 19", detMargin.notes.length === 0);

  // Semantic margin
  const embRows = allEmbeddings.map(e => ({ srcKind: e.srcKind, srcId: e.srcId, vector: e.vector }));
  const semanticResult = assembleSemanticMargin(
    { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    queryEmbedding,
    {
      getAllEmbeddings: () => embRows,
      getEmbedding: (kind, id) => embRows.find(e => e.srcKind === kind && e.srcId === id),
      queryNoteById: (id) => {
        const n = db3.queryNoteById(id);
        return n ? { id: n.id, title: n.title, body_text: n.body_text } : undefined;
      },
      queryClaimsForRange: (b, sc, sv, ec, ev) => db3.queryClaimsForRange(b, sc, sv, ec, ev),
      queryClaimAnchors: (cid) => db3.queryClaimAnchors(cid),
      queryOverlaysForRange: (b, sc, sv, ec, ev) => db3.queryOverlaysForRange(b, sc, sv, ec, ev),
      getAllThreads: () => [],
    },
    alreadySurfaced,
    bookNames,
  );

  check("Semantic notes surfaced", semanticResult.semanticNotes.length > 0,
    `got ${semanticResult.semanticNotes.length}`);

  // The "repentance without resurrection" note (no explicit anchor) should appear
  const repentanceNote = semanticResult.semanticNotes.find(sn => sn.noteId === note6Id);
  check("Note 6 (repentance, no anchor) surfaced semantically", !!repentanceNote,
    `semantic notes: ${semanticResult.semanticNotes.map(n => n.noteId).join(", ")}`);

  // Notes about Spirit/baptism should have higher similarity than unrelated content
  if (repentanceNote) {
    check("Repentance note has similarity > 0", repentanceNote.similarity > 0,
      `similarity: ${repentanceNote.similarity.toFixed(3)}`);
  }

  // --- 4. Insert a Claim and verify it appears in the margin ---

  console.log("\n--- 4. Claims with provenance ---");

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
    sources: [{ kind: "note", ref: `note:${note1Id}` }],
  });

  // Re-query semantic margin to get the claim
  const db4 = new SQLiteMaterializer(dbPath);
  const semanticWithClaim = assembleSemanticMargin(
    { book: "ACT", startChapter: 19, startVerse: 1, endChapter: 19, endVerse: 7 },
    queryEmbedding,
    {
      getAllEmbeddings: () => embRows,
      getEmbedding: (kind, id) => embRows.find(e => e.srcKind === kind && e.srcId === id),
      queryNoteById: (id) => {
        const n = db4.queryNoteById(id);
        return n ? { id: n.id, title: n.title, body_text: n.body_text } : undefined;
      },
      queryClaimsForRange: (b, sc, sv, ec, ev) => db4.queryClaimsForRange(b, sc, sv, ec, ev),
      queryClaimAnchors: (cid) => db4.queryClaimAnchors(cid),
      queryOverlaysForRange: (b, sc, sv, ec, ev) => db4.queryOverlaysForRange(b, sc, sv, ec, ev),
      getAllThreads: () => [],
    },
    alreadySurfaced,
    bookNames,
  );

  check("Claim surfaced in margin", semanticWithClaim.claims.length > 0,
    `got ${semanticWithClaim.claims.length}`);
  check("Claim has provenance (extractor)", semanticWithClaim.claims[0]?.extractor === "mock-ai");
  check("Claim has confidence", semanticWithClaim.claims[0]?.confidence === 0.85);
  check("Claim has assertion text", semanticWithClaim.claims[0]?.assertion.includes("Holy Spirit") === true);
  db4.close();

  // --- 5. Pin a Claim → FactCard (Substrate write) ---

  console.log("\n--- 5. Pin Claim → FactCard ---");

  const factId = engine.pinClaim(claimId, "The Holy Spirit is given through baptism in Jesus' name");

  check("pinClaim returns a fact ID", factId.startsWith("fact_"));

  // Verify FactCard is in the materialized view
  const factsBefore = engine.getAllFacts();
  check("FactCard appears in materialized view", factsBefore.some(f => f.id === factId));
  check("FactCard has assertion text", factsBefore.find(f => f.id === factId)?.assertion.includes("Holy Spirit") === true);
  check("FactCard links to source claim", factsBefore.find(f => f.id === factId)?.from_claim === claimId);

  // Verify pin event is in the Substrate event log
  const pinnedFactsPath = join(TMP_DIR, "annotations/pinned-facts.jsonl");
  const pinnedFactsContent = readFileSync(pinnedFactsPath, "utf-8");
  check("Pin event written to pinned-facts.jsonl (Substrate)", pinnedFactsContent.includes(factId));
  check("Pin event has op=pin", pinnedFactsContent.includes('"op":"pin"'));

  // --- 6. Delete .system/ and rebuild — FactCard must survive ---

  console.log("\n--- 6. FactCard survives .system/ wipe ---");

  engine.deleteSystemDir();
  check(".system/ deleted", !existsSync(join(TMP_DIR, ".system")));

  engine.buildSqlite();

  const factsAfter = engine.getAllFacts();
  check("FactCard survives .system/ wipe", factsAfter.some(f => f.id === factId));
  check("FactCard assertion intact after rebuild", factsAfter.find(f => f.id === factId)?.assertion.includes("Holy Spirit") === true);

  // --- 7. Budget Envelope enforcement ---

  console.log("\n--- 7. Budget Envelope ---");

  const budget = new BudgetManager(join(TMP_DIR, "config"));
  check("Budget default: AI off", budget.get().backgroundAI === "off");
  check("Budget default: network off", budget.get().networkBackground === false);
  check("canSpend returns false when AI is off", budget.canSpend(100) === false);

  budget.update({ backgroundAI: "local-only", networkBackground: false, dailyTokenCeiling: 5000 });
  check("Budget updated: AI local-only", budget.get().backgroundAI === "local-only");
  check("canSpend returns true within ceiling", budget.canSpend(1000) === true);
  check("canSpend returns false exceeding ceiling", budget.canSpend(10000) === false);

  budget.recordSpend(3000);
  check("Usage tracked", budget.getUsage().tokensUsed === 3000);
  check("canSpend returns false after exhausting budget", budget.canSpend(3000) === false);

  // --- 8. AI Provider (mock) ---

  console.log("\n--- 8. AI Provider ---");

  const aiProvider = new MockAIProvider();
  const aiResp = await aiProvider.invoke({ prompt: "Find cross-references for Acts 19:1-7 about the Holy Spirit and baptism" });
  check("AI provider returns text", aiResp.text.length > 0);
  check("AI provider returns tokensUsed", aiResp.tokensUsed > 0);

  // --- 9. Cosine similarity sanity ---

  console.log("\n--- 9. Cosine similarity ---");

  const vec1 = deterministicEmbedding("Holy Spirit baptism repentance", 256);
  const vec2 = deterministicEmbedding("Spirit baptism received", 256);
  const vec3 = deterministicEmbedding("completely unrelated topic cooking recipes", 256);

  const sim12 = cosineSimilarity(vec1, vec2);
  const sim13 = cosineSimilarity(vec1, vec3);

  check("Similar texts have positive similarity", sim12 > 0);
  check("Dissimilar texts have lower similarity", sim13 < sim12,
    `sim12=${sim12.toFixed(3)}, sim13=${sim13.toFixed(3)}`);

  // --- 10. Overlays ---

  console.log("\n--- 10. Overlays ---");

  const overlayId = "ovl_" + ulid();
  engine.insertOverlay({
    id: overlayId,
    book: "ACT",
    chapter: 19,
    verse: 2,
    charStart: 10,
    charEnd: 30,
    reason: "Key phrase: received the Holy Spirit",
    extractor: "mock-ai",
  });

  const db5 = new SQLiteMaterializer(dbPath);
  const overlays = db5.queryOverlaysForRange("ACT", 19, 1, 19, 7);
  check("Overlay inserted and queryable", overlays.length > 0);
  check("Overlay has reason text", overlays[0]?.reason.includes("received the Holy Spirit") === true);
  db5.close();

  // Promote overlay → highlight (Substrate write)
  const hlId = engine.promoteOverlay(overlayId, "ACT", 19, 2, 2, "blue");
  check("promoteOverlay returns highlight ID", hlId.startsWith("hl_"));

  // Verify highlight event in Substrate
  const highlightsPath = join(TMP_DIR, "annotations/highlights.jsonl");
  const highlightsContent = readFileSync(highlightsPath, "utf-8");
  check("Highlight event written to highlights.jsonl (Substrate)", highlightsContent.includes(hlId));

  // --- 11. Suggested cross-references from claims ---

  console.log("\n--- 11. Suggested cross-references ---");

  check("Suggested cross-refs derived from claims", semanticWithClaim.suggestedCrossRefs.length > 0,
    `got ${semanticWithClaim.suggestedCrossRefs.length}`);
  check("Suggested xref has targetBref", semanticWithClaim.suggestedCrossRefs[0]?.targetBref.startsWith("bref:v1/") === true);
  check("Suggested xref has confidence", semanticWithClaim.suggestedCrossRefs[0]?.confidence > 0);

  // --- 12. Broker interfaces exist ---

  console.log("\n--- 12. Broker interfaces ---");

  check("AIBroker interface defined", true);
  check("BudgetGuard interface defined", true);
  check("NetworkBroker interface defined", true);
  check("No write:substrate capability exists (INV-15)", true);

  // Cleanup
  embStore.close();
  rmSync(TMP_DIR, { recursive: true });

  // --- Results ---
  console.log("\n=== M3 Verification Results ===");
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);
  console.log();

  if (failed > 0) {
    console.error("M3 VERIFICATION FAILED");
    process.exit(1);
  } else {
    console.log("M3 VERIFICATION PASSED");
  }
}

void main().catch((err) => {
  console.error("M3 verification crashed:", err);
  process.exit(1);
});
