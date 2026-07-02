import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClaimExtractionRequest,
  parseClaimExtraction,
} from "../src/core/ai/claim-extraction.js";
import type { BackboneData } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backbone = JSON.parse(
  readFileSync(join(resolve(__dirname, "../data/scripture"), "backbone.json"), "utf-8"),
) as BackboneData;

const noteIds = new Set(["note-1", "note-2"]);

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assertion: "The Spirit is received after baptism in Jesus' name",
    claimType: "theological",
    confidence: 0.9,
    anchors: [{ book: "ACT", chapter: 19, verse: 5 }],
    evidence: [{ kind: "note", ref: "note-1" }],
    ...overrides,
  };
}

function parse(claims: unknown[]): ReturnType<typeof parseClaimExtraction> {
  return parseClaimExtraction(JSON.stringify({ claims }), backbone, noteIds);
}

test("valid claim passes with anchors and note evidence intact", () => {
  const result = parse([claim()]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]!.anchors[0]!.book, "ACT");
  assert.equal(result.claims[0]!.evidence[0]!.ref, "note-1");
});

test("invalid JSON rejects wholesale", () => {
  const result = parseClaimExtraction("not json at all", backbone, noteIds);
  assert.equal(result.claims.length, 0);
  assert.equal(result.rejected.length, 1);
});

test("claim with invalid book code is rejected, valid sibling survives", () => {
  const result = parse([claim({ anchors: [{ book: "ACTS", chapter: 19, verse: 5 }] }), claim()]);
  assert.equal(result.claims.length, 1);
  assert.match(result.rejected[0]!, /invalid book code/);
});

test("out-of-range verse is rejected against real backbone counts", () => {
  // ACT 19 has 41 verses in the backbone
  const result = parse([claim({ anchors: [{ book: "ACT", chapter: 19, verse: 99 }] })]);
  assert.equal(result.claims.length, 0);
  assert.match(result.rejected[0]!, /verse out of range/);
});

test("out-of-range chapter is rejected", () => {
  const result = parse([claim({ anchors: [{ book: "ACT", chapter: 40, verse: 1 }] })]);
  assert.match(result.rejected[0]!, /chapter out of range/);
});

test("claim without evidence is rejected — grounding is mandatory", () => {
  const result = parse([claim({ evidence: [] })]);
  assert.equal(result.claims.length, 0);
  assert.match(result.rejected[0]!, /no evidence/);
});

test("evidence citing an unknown note id is rejected", () => {
  const result = parse([claim({ evidence: [{ kind: "note", ref: "hallucinated-note" }] })]);
  assert.match(result.rejected[0]!, /unknown note/);
});

test("malformed scripture evidence ref is rejected", () => {
  const result = parse([claim({ evidence: [{ kind: "scripture", ref: "Acts 19:5" }] })]);
  assert.match(result.rejected[0]!, /malformed scripture evidence/);
});

test("confidence outside 0..1 is rejected", () => {
  const result = parse([claim({ confidence: 1.5 })]);
  assert.match(result.rejected[0]!, /confidence out of range/);
});

test("unknown claimType is rejected", () => {
  const result = parse([claim({ claimType: "vibes" })]);
  assert.match(result.rejected[0]!, /invalid claimType/);
});

test("prompt embeds note ids and pins the anti-injection rule", () => {
  const { context, prompt } = buildClaimExtractionRequest(
    "Acts 19:1-7 (WEB)",
    "passage text here",
    [{ id: "note-1", title: "My Note", body: "note body" }],
  );
  assert.match(prompt, /<note id="note-1">/);
  assert.match(prompt, /passage text here/);
  assert.match(context, /never instructions/);
  assert.match(context, /USFM 3-letter uppercase/);
});
