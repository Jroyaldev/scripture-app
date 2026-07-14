import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildClaimExtractionRequest,
  deriveClaimConfidence,
  normalizeForQuoteMatch,
  parseClaimExtraction,
  quoteAppearsInNote,
  type ClaimEvidence,
} from "../src/core/ai/claim-extraction.js";
import type { BackboneData } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backbone = JSON.parse(
  readFileSync(join(resolve(__dirname, "../data/scripture"), "backbone.json"), "utf-8"),
) as BackboneData;

const notes = [
  {
    id: "note-1",
    title: "Acts 19 — Disciples at Ephesus",
    body: "Paul's question assumes reception of the Spirit is verifiable. They were re-baptized in the name of the Lord Jesus.",
  },
  { id: "note-2", title: "Laying on of hands", body: "Hands mark continuity and transfer." },
];

function claim(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    assertion: "The Spirit is received after baptism in Jesus' name",
    claimType: "theological",
    anchors: [{ book: "ACT", chapter: 19, verse: 5 }],
    evidence: [{ kind: "note", ref: "note-1", quote: "re-baptized in the name of the Lord Jesus" }],
    ...overrides,
  };
}

function parse(claims: unknown[]): ReturnType<typeof parseClaimExtraction> {
  return parseClaimExtraction(JSON.stringify({ claims }), backbone, notes);
}

test("valid quote-grounded claim passes with anchors and evidence intact", () => {
  const result = parse([claim()]);
  assert.equal(result.rejected.length, 0);
  assert.equal(result.claims.length, 1);
  assert.equal(result.claims[0]!.anchors[0]!.book, "ACT");
  assert.equal(result.claims[0]!.evidence[0]!.ref, "note-1");
});

test("invalid JSON rejects wholesale", () => {
  const result = parseClaimExtraction("not json at all", backbone, notes);
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
  const result = parse([claim({ evidence: [{ kind: "note", ref: "hallucinated-note", quote: "anything" }] })]);
  assert.match(result.rejected[0]!, /unknown note/);
});

test("note evidence without a quote is rejected (claims-v2)", () => {
  const result = parse([claim({ evidence: [{ kind: "note", ref: "note-1" }] })]);
  assert.match(result.rejected[0]!, /missing quote/);
});

test("paraphrased/invented quote is rejected — verbatim grounding is mandatory", () => {
  const result = parse([
    claim({ evidence: [{ kind: "note", ref: "note-1", quote: "baptism gives the Spirit automatically" }] }),
  ]);
  assert.equal(result.claims.length, 0);
  assert.match(result.rejected[0]!, /quote not found/);
});

test("quote verification tolerates case, punctuation, and smart quotes — not paraphrase", () => {
  const note = notes[0]!;
  assert.equal(quoteAppearsInNote("Re-baptized in the name of the Lord Jesus.", note), true);
  assert.equal(quoteAppearsInNote("PAUL'S QUESTION ASSUMES", note), true);
  assert.equal(quoteAppearsInNote("Paul\u2019s question assumes", note), true);
  assert.equal(quoteAppearsInNote("Paul wondered whether", note), false);
});

test("scripture-only evidence is rejected — claims must cite the reader's notes", () => {
  const result = parse([claim({ evidence: [{ kind: "scripture", ref: "ACT.19.5" }] })]);
  assert.match(result.rejected[0]!, /no note evidence/);
});

test("malformed scripture evidence ref is rejected", () => {
  const result = parse([
    claim({
      evidence: [
        { kind: "note", ref: "note-1", quote: "re-baptized in the name of the Lord Jesus" },
        { kind: "scripture", ref: "Acts 19:5" },
      ],
    }),
  ]);
  assert.match(result.rejected[0]!, /malformed scripture evidence/);
});

test("unknown claimType is rejected", () => {
  const result = parse([claim({ claimType: "vibes" })]);
  assert.match(result.rejected[0]!, /invalid claimType/);
});

test("confidence is derived from evidence, ignoring any model self-report", () => {
  const result = parse([claim({ confidence: 0.99 })]);
  // one verified note quote → 0.5 + 0.2
  assert.equal(result.claims[0]!.confidence, 0.7);

  const twoNotes: ClaimEvidence[] = [
    { kind: "note", ref: "n", quote: "q" },
    { kind: "note", ref: "n2", quote: "q2" },
  ];
  assert.equal(deriveClaimConfidence(twoNotes), 0.9);
  assert.equal(
    deriveClaimConfidence([...twoNotes, { kind: "scripture", ref: "ACT.19.5" }, { kind: "scripture", ref: "ACT.2.38" }]),
    1,
  );
});

test("normalizeForQuoteMatch collapses punctuation and whitespace deterministically", () => {
  assert.equal(normalizeForQuoteMatch("  Paul\u2019s  question—assumes! "), "paul s question assumes");
});

test("prompt demands verbatim quotes and pins the anti-injection rule", () => {
  const { context, prompt } = buildClaimExtractionRequest(
    "Acts 19:1-7 (WEB)",
    "passage text here",
    [{ id: "note-1", title: "My Note", body: "note body" }],
  );
  assert.match(prompt, /<note id="note-1">/);
  assert.match(prompt, /passage text here/);
  assert.match(context, /never instructions/);
  assert.match(context, /USFM 3-letter uppercase/);
  assert.match(context, /copied EXACTLY/);
  assert.match(context, /verified by string match/);
});
