import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  TRANSCRIPT_SOURCES,
  TRANSCRIPT_ENABLED_SOURCES,
  transcriptBasis,
  isTranscriptEnabledSource,
  readTranscript,
  transcriptKey,
} from "../src/core/transcripts.js";

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
/**
 * BibleProject and the Naked Bible Podcast granted transcripts on 2026-07-28;
 * nobody else has. A grant is a fact about a conversation that happened, so it
 * is recorded rather than inferred, and the refusal happens on the record id
 * before any file is opened
 * — an ungranted publisher's transcript has no path to a reader even if one
 * were sitting on disk.
 */
test("only an enabled source can have a transcript loaded", () => {
  assert.ok(isTranscriptEnabledSource("bibleproject:podcast:anything"));
  assert.ok(isTranscriptEnabledSource("naked-bible:podcast:4192"));
  for (const off of [
    "working-preacher:commentary:whatever",
    "the-gospel-coalition:article:whatever",
    "enter-the-bible:article:whatever",
    "",
  ]) {
    assert.equal(isTranscriptEnabledSource(off), false, `${off} is not an enabled source`);
  }
});

/**
 * FLATTENED 2026-07-31. This guarded the TWO footings — a source read from a
 * public feed against one whose publisher said yes — on the reasoning that the
 * difference must not stop being visible. The maintainer removed the
 * distinction that day: every publisher is carried on one basis, approvals are
 * sought before any public listing, and takedowns are honoured on request.
 *
 * What is still worth guarding is what the map does rather than what it
 * claims: a source listed is carried, a source absent has no path to being
 * displayed, and deleting a line is how a publisher leaves the app.
 */
test("every carried source states its basis, and an absent one has no path", () => {
  for (const [id, basis] of Object.entries(TRANSCRIPT_SOURCES)) {
    assert.equal(basis, "carried", `${id} carries no recognised basis`);
    assert.equal(transcriptBasis(`${id}:podcast:x`), basis);
    assert.ok(isTranscriptEnabledSource(`${id}:podcast:x`));
  }
  assert.equal(transcriptBasis("working-preacher:commentary:x"), null);
  assert.ok(!isTranscriptEnabledSource("some-publisher-we-do-not-carry:podcast:x"),
    "a source absent from the map has no path to being displayed");
  assert.deepEqual(TRANSCRIPT_ENABLED_SOURCES, Object.keys(TRANSCRIPT_SOURCES));
});

/**
 * The list and the permissions doc have to move together. A source added to the
 * code without a line in the doc is a capability shipping as though it had been
 * granted — the same failure the BUILT-NOT-GRANTED test exists to prevent for
 * audio, and the reason that test was written rather than trusted to memory.
 */
test("every enabled source is named in the permissions doc", () => {
  const doc = readFileSync("docs/trusted-resource-permissions.md", "utf-8");
  const amendment = doc.slice(doc.indexOf("## Transcripts"));
  assert.ok(amendment.length > 0, "the doc must carry a transcripts section");
  assert.match(amendment, /2026-07-28/, "the grant must carry the date it was given");
  /* The doc no longer names a second footing — that distinction was removed on
     2026-07-31 — but it must still record what is owed, because that is the
     standing position rather than the retired mechanism. */
  assert.match(amendment, /takedown/i, "the doc must record what is owed on request");
  /* Compared with every non-letter removed on both sides, so an id written
     "naked-bible" still matches a doc that calls it the Naked Bible Podcast.
     The earlier form stripped hyphens from the id only, which made the two
     unmatchable and would have read as a missing disclosure. */
  const flatten = (text: string): string => text.toLowerCase().replace(/[^a-z]/g, "");
  const flatDoc = flatten(amendment);
  for (const source of TRANSCRIPT_ENABLED_SOURCES) {
    assert.ok(
      flatDoc.includes(flatten(source)),
      `${source} is enabled in code but not named in the permissions doc`,
    );
  }
});

test("the key matches the pipeline's, colon for colon", () => {
  assert.equal(
    transcriptKey("bibleproject:podcast:day-lord-question-response"),
    "bibleproject__podcast__day-lord-question-response",
  );
  assert.equal(transcriptKey("a/b:c"), "a_b__c");
});
