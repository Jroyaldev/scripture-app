import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Database from "better-sqlite3";
import { EmbeddingsStore } from "../src/host/embeddings-store.js";
import { claimSourceHash, sweepStaleClaims } from "../src/host/claims-sync.js";

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

function makeStore(dir: string): EmbeddingsStore {
  return new EmbeddingsStore(join(dir, "e.sqlite"));
}

function seedClaim(
  store: EmbeddingsStore,
  id: string,
  noteRef: string,
  sourceHash?: string,
): void {
  store.insertClaim({
    id,
    assertion: `assertion for ${id}`,
    claim_type: "theological",
    confidence: 0.7,
    extractor: "test@claims-v2",
    created: "2026-07-02T00:00:00Z",
    status: "active",
  });
  store.insertClaimAnchor({ claim_id: id, book: "ACT", chapter: 19, verse: 2 });
  store.insertClaimSource({ claim_id: id, kind: "note", ref: noteRef, quote: "q", source_hash: sourceHash });
}

test("claims persist in the AI-derived store and surface for their range (B-1)", { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-b1-"));
  try {
    const store = makeStore(dir);
    seedClaim(store, "c1", "n1");
    const rows = store.queryClaimsForRange("ACT", 19, 1, 19, 7);
    assert.equal(rows.length, 1);
    assert.equal(store.queryClaimSources("c1")[0]!.ref, "n1");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweep deletes claims whose source note was deleted", { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-b1-"));
  try {
    const store = makeStore(dir);
    seedClaim(store, "gone", "deleted-note");
    seedClaim(store, "kept", "live-note");
    const notes = new Map([["live-note", { title: "T", body_text: "B" }]]);
    const removed = sweepStaleClaims(store, (id) => notes.get(id));
    assert.equal(removed, 1);
    assert.deepEqual(store.getAllClaims().map((c) => c.id), ["kept"]);
    assert.equal(store.queryClaimSources("gone").length, 0, "anchors/sources cascade");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sweep deletes claims whose source note text changed since extraction", { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-b1-"));
  try {
    const store = makeStore(dir);
    const original = { title: "Acts note", body_text: "the Spirit came with laying on of hands" };
    seedClaim(store, "c1", "n1", claimSourceHash(original.title, original.body_text));

    // Unchanged → survives.
    assert.equal(sweepStaleClaims(store, () => original), 0);
    assert.equal(store.getAllClaims().length, 1);

    // Edited → the claim's verified quote can no longer be trusted → deleted.
    const edited = { title: "Acts note", body_text: "totally rewritten thought" };
    assert.equal(sweepStaleClaims(store, () => edited), 1);
    assert.equal(store.getAllClaims().length, 0);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("claims without a stored hash are kept while their note exists (legacy tolerance)", { skip: sqliteSkip }, () => {
  const dir = mkdtempSync(join(tmpdir(), "claims-b1-"));
  try {
    const store = makeStore(dir);
    seedClaim(store, "legacy", "n1"); // no source_hash
    assert.equal(sweepStaleClaims(store, () => ({ title: "T", body_text: "anything" })), 0);
    assert.equal(store.getAllClaims().length, 1);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
