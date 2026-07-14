import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { chunkContentHash, embedAllNotes } from "../src/host/embeddings-sync.js";
import { prefixTexts, EMBEDDING_PREFIXES } from "../src/host/local-embeddings.js";
import type { EmbeddingKind } from "../src/core/interfaces.js";

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "emb-gate2-"));
}

// Preserve the A1 contract that `npm test` is ABI-independent: better-sqlite3
// may currently be built for the Electron ABI. Skip (don't fail) the
// sqlite-backed tests in that state, mirroring the app's preflight approach.
function sqliteAvailable(): boolean {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}
const sqliteSkip = sqliteAvailable()
  ? false
  : "better-sqlite3 is built for the Electron ABI — run `npm run rebuild:node` to include these tests";

test("store migrates a pre-Gate-2 table shape by dropping it (Derived data)", { skip: sqliteSkip }, () => {
  const dir = tempDir();
  try {
    const dbPath = join(dir, "embeddings.sqlite");
    // Create the OLD schema (no model/content_hash) with a row in it.
    const raw = new Database(dbPath);
    raw.exec(
      "CREATE TABLE embeddings (src_kind TEXT, src_id TEXT, dim INTEGER, vector BLOB, created TEXT, PRIMARY KEY (src_kind, src_id))",
    );
    raw
      .prepare("INSERT INTO embeddings VALUES (?, ?, ?, ?, ?)")
      .run("note", "old1", 4, Buffer.alloc(16), "2026-01-01");
    raw.close();

    const store = new EmbeddingsStore(dbPath);
    assert.equal(store.getAllEmbeddings().length, 0, "old-shape rows must be dropped");
    store.upsertEmbedding("note", "n1", new Float32Array([1, 0, 0]), "m1", "h1");
    assert.equal(store.getAllEmbeddings().length, 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("isCurrent matches only on same model AND same content hash", { skip: sqliteSkip }, () => {
  const dir = tempDir();
  try {
    const store = new EmbeddingsStore(join(dir, "e.sqlite"));
    store.upsertEmbedding("note", "n1", new Float32Array([1]), "model-a", "hash-1");

    assert.equal(store.isCurrent("note", "n1", "model-a", "hash-1"), true);
    assert.equal(store.isCurrent("note", "n1", "model-a", "hash-2"), false, "content changed");
    assert.equal(store.isCurrent("note", "n1", "model-b", "hash-1"), false, "model changed");
    assert.equal(store.isCurrent("note", "n2", "model-a", "hash-1"), false, "unknown note");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pruneOtherModels removes only foreign-model vectors; getAllEmbeddings filters by model", { skip: sqliteSkip }, () => {
  const dir = tempDir();
  try {
    const store = new EmbeddingsStore(join(dir, "e.sqlite"));
    store.upsertEmbedding("note", "n1", new Float32Array([1]), "model-a", "h");
    store.upsertEmbedding("note", "n2", new Float32Array([2]), "model-b", "h");
    store.upsertEmbedding("note", "n3", new Float32Array([3]), "model-a", "h");

    assert.equal(store.getAllEmbeddings("model-a").length, 2);
    assert.equal(store.getAllEmbeddings("model-b").length, 1);

    const pruned = store.pruneOtherModels("model-a");
    assert.equal(pruned, 1);
    assert.equal(store.getAllEmbeddings().length, 2);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("embedAllNotes is incremental: unchanged chunks skipped, edits re-embedded", { skip: sqliteSkip }, async () => {
  const dir = tempDir();
  try {
    const store = new EmbeddingsStore(join(dir, "e.sqlite"));
    let embedCalls = 0;
    const provider = {
      dim: 3,
      modelId: "fake-model",
      embed: async (texts: string[], _kind?: EmbeddingKind) => {
        embedCalls += texts.length;
        return texts.map(() => new Float32Array([1, 2, 3]));
      },
    };
    const notes = [
      { id: "a", title: "Alpha", body_text: "first" },
      { id: "b", title: "Beta", body_text: "second" },
    ];
    const db = { getAllNotes: () => notes };

    const first = await embedAllNotes(db, store, provider);
    assert.deepEqual(
      { embedded: first.embedded, skipped: first.skipped },
      { embedded: 2, skipped: 0 },
    );
    assert.equal(embedCalls, 2);

    const second = await embedAllNotes(db, store, provider);
    assert.deepEqual(
      { embedded: second.embedded, skipped: second.skipped },
      { embedded: 0, skipped: 2 },
    );
    assert.equal(embedCalls, 2, "no embed calls on unchanged content");

    notes[1] = { id: "b", title: "Beta", body_text: "second EDITED" };
    const third = await embedAllNotes(db, store, provider);
    assert.deepEqual(
      { embedded: third.embedded, skipped: third.skipped },
      { embedded: 1, skipped: 1 },
    );
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("embedAllNotes stores per-paragraph chunks and sweeps stale/legacy rows", { skip: sqliteSkip }, async () => {
  const dir = tempDir();
  try {
    const store = new EmbeddingsStore(join(dir, "e.sqlite"));
    const provider = {
      dim: 2,
      modelId: "fake-model",
      embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 1])),
    };
    // Legacy whole-note row (pre-B3.5) must be swept.
    store.upsertEmbedding("note", "a", new Float32Array([9, 9]), "fake-model", "legacy");

    const longPara = "Resurrection theology and its implications. ".repeat(20).trim();
    const otherPara = "Committee logistics and scheduling for autumn. ".repeat(20).trim();
    const notes = [{ id: "a", title: "Multi", body_text: `${longPara}\n\n${otherPara}` }];
    const db = { getAllNotes: () => notes };

    const first = await embedAllNotes(db, store, provider);
    assert.equal(first.embedded, 2, "two paragraph chunks embedded");
    assert.deepEqual(
      store.listEmbeddings().map((r) => r.srcId).sort(),
      ["a#0", "a#1"],
      "chunk ids stored, legacy whole-note row swept",
    );
    assert.ok(first.pruned >= 1, "legacy row counted as pruned");

    // Note shrinks to one paragraph → stale chunk swept.
    notes[0] = { id: "a", title: "Multi", body_text: longPara };
    const second = await embedAllNotes(db, store, provider);
    assert.deepEqual(store.listEmbeddings().map((r) => r.srcId), ["a#0"]);
    assert.equal(second.skipped, 1, "unchanged first chunk skipped");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("model switch prunes and re-embeds everything", { skip: sqliteSkip }, async () => {
  const dir = tempDir();
  try {
    const store = new EmbeddingsStore(join(dir, "e.sqlite"));
    const makeProvider = (modelId: string) => ({
      dim: 2,
      modelId,
      embed: async (texts: string[]) => texts.map(() => new Float32Array([1, 1])),
    });
    const db = { getAllNotes: () => [{ id: "a", title: "T", body_text: "B" }] };

    await embedAllNotes(db, store, makeProvider("model-a"));
    const result = await embedAllNotes(db, store, makeProvider("model-b"));
    assert.equal(result.pruned, 1, "model-a vector pruned");
    assert.equal(result.embedded, 1, "re-embedded under model-b");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("chunkContentHash changes with content, stable otherwise", () => {
  assert.equal(chunkContentHash("T\nB"), chunkContentHash("T\nB"));
  assert.notEqual(chunkContentHash("T\nB"), chunkContentHash("T\nB2"));
});

test("prefixTexts applies the exact EmbeddingGemma asymmetric prefixes", () => {
  assert.deepEqual(prefixTexts(["find this"], "query"), ["task: search result | query: find this"]);
  assert.deepEqual(prefixTexts(["a doc"], "document"), ["title: none | text: a doc"]);
  // Guard the literal strings — silently changing them degrades retrieval.
  assert.equal(EMBEDDING_PREFIXES.query, "task: search result | query: ");
  assert.equal(EMBEDDING_PREFIXES.document, "title: none | text: ");
});
