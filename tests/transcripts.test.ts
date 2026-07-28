import assert from "node:assert/strict";
import test from "node:test";
import { readTranscript, transcriptKey } from "../src/core/transcripts.js";

function valid(overrides: Record<string, unknown> = {}): unknown {
  return {
    schema: "transcript/v1",
    generated: true,
    model: "nvidia/parakeet-tdt-0.6b-v3",
    id: "bibleproject:podcast:example",
    words: [{ w: "In", s: 0.08, e: 0.24 }, { w: "the", s: 0.24, e: 0.32 }],
    segments: [{ t: "In the", s: 0.08, e: 0.32 }],
    audioSeconds: 3570.1,
    ...overrides,
  };
}

test("a well-formed machine transcript is accepted whole", () => {
  const result = readTranscript(valid(), "fallback");
  assert.ok(result.ok);
  assert.equal(result.transcript.model, "nvidia/parakeet-tdt-0.6b-v3");
  assert.equal(result.transcript.words.length, 2);
  assert.equal(result.transcript.segments.length, 1);
  assert.equal(result.transcript.audioSeconds, 3570.1);
});

/**
 * The one refusal that is not about correctness. These transcripts are machine
 * output, and the maintainer's permission to hold them is conditioned on not
 * mischaracterizing them. A file that does not declare itself generated could
 * be rendered as though a person wrote it, so it is refused rather than shown —
 * the claim is enforced at the boundary instead of trusted downstream.
 */
test("a transcript that does not declare itself machine-made is refused", () => {
  for (const missing of [{ generated: false }, { generated: undefined }, { model: "" }]) {
    const result = readTranscript(valid(missing), "fallback");
    assert.equal(result.ok, false, `${JSON.stringify(missing)} must not load`);
  }
});

/**
 * An earlier pipeline bug wrote well-formed but wordless transcripts. Shown to
 * a reader, an empty panel reads as "this episode contains no speech", which is
 * a lie about the episode rather than an admission about us.
 */
test("an empty transcript is a failed one, not an episode without speech", () => {
  assert.equal(readTranscript(valid({ words: [] }), "fallback").ok, false);
});

test("unrecognised or malformed input is refused rather than half-read", () => {
  for (const bad of [
    null,
    "transcript",
    valid({ schema: "transcript/v2" }),
    valid({ words: [{ w: "no timing" }] }),
    valid({ words: [{ w: "nan", s: Number.NaN, e: 1 }] }),
    valid({ segments: [{ t: "no timing", s: 0 }] }),
  ]) {
    assert.equal(readTranscript(bad, "fallback").ok, false, `${JSON.stringify(bad)?.slice(0, 60)}`);
  }
});

/**
 * The player finds the active line by scanning for the last span that has
 * started, and does not sort first. Out-of-order spans would therefore select
 * the wrong line silently rather than failing, so the order is established here
 * instead of being assumed of whatever wrote the file.
 */
test("spans are ordered on the way out, not trusted on the way in", () => {
  const result = readTranscript(valid({
    words: [{ w: "second", s: 9, e: 10 }, { w: "first", s: 1, e: 2 }],
    segments: [{ t: "later", s: 9, e: 10 }, { t: "earlier", s: 1, e: 2 }],
  }), "fallback");
  assert.ok(result.ok);
  assert.deepEqual(result.transcript.words.map((w) => w.w), ["first", "second"]);
  assert.deepEqual(result.transcript.segments.map((s) => s.t), ["earlier", "later"]);
});

test("a transcript missing its own id falls back to the record that asked", () => {
  const result = readTranscript(valid({ id: undefined }), "bibleproject:podcast:asked-for");
  assert.ok(result.ok);
  assert.equal(result.transcript.id, "bibleproject:podcast:asked-for");
});

/**
 * The filename is the join between a record and its transcript, and the
 * pipeline that writes it lives in another language. If these two ever disagree
 * every transcript becomes unreachable at once, and nothing else would say so.
 */
test("the key matches the pipeline's, colon for colon", () => {
  assert.equal(
    transcriptKey("bibleproject:podcast:day-lord-question-response"),
    "bibleproject__podcast__day-lord-question-response",
  );
  assert.equal(transcriptKey("a/b:c"), "a_b__c");
});
