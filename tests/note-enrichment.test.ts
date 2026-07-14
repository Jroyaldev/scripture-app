import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildEnrichmentRequest,
  findBannedRegister,
  parseEnrichment,
  MAX_INFERRED_REFS,
  type ThemeEntry,
} from "../src/core/ai/note-enrichment.js";
import type { BackboneData } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const backbone = JSON.parse(
  readFileSync(join(resolve(__dirname, "../data/scripture"), "backbone.json"), "utf-8"),
) as BackboneData;
const themesFile = JSON.parse(
  readFileSync(join(resolve(__dirname, "../data/themes"), "themes-seed-en.json"), "utf-8"),
) as { themes: ThemeEntry[] };
const themeIds = new Set(themesFile.themes.map((t) => t.id));

function ok(payload: Record<string, unknown>) {
  return parseEnrichment(JSON.stringify(payload), backbone, themeIds);
}

const good = {
  no_scripture_intent: false,
  inferred_refs: [
    { book: "PSA", chapter: 23 },
    { book: "JHN", chapter: 10, verseStart: 11, verseEnd: 15 },
  ],
  themes: ["shepherd", "identity-in-christ"],
  expansion:
    "God's personal, attentive care for each person, like a shepherd who knows each sheep by name — Psalm 23 and John 10 language.",
};

test("valid enrichment parses: ordered refs, vocabulary themes, clean expansion", () => {
  const result = ok(good);
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.enrichment.inferredRefs.length, 2);
    assert.deepEqual(result.enrichment.inferredRefs[0], { book: "PSA", chapter: 23 });
    assert.deepEqual(result.enrichment.themes, ["shepherd", "identity-in-christ"]);
  }
});

test("no_scripture_intent notes must be completely empty (A-7)", () => {
  const clean = ok({ no_scripture_intent: true, inferred_refs: [], themes: [], expansion: "" });
  assert.equal(clean.ok, true);
  if (clean.ok) assert.equal(clean.enrichment.noScriptureIntent, true);

  const leaky = ok({ ...good, no_scripture_intent: true });
  assert.equal(leaky.ok, false);
});

test("hallucinated book codes and out-of-range chapters are rejected", () => {
  assert.equal(ok({ ...good, inferred_refs: [{ book: "PSALMS", chapter: 23 }] }).ok, false);
  assert.equal(ok({ ...good, inferred_refs: [{ book: "JUD", chapter: 3 }] }).ok, false, "Jude has 1 chapter");
  assert.equal(ok({ ...good, inferred_refs: [{ book: "PSA", chapter: 23, verseStart: 1, verseEnd: 99 }] }).ok, false);
});

test("themes outside the user-owned vocabulary are rejected", () => {
  const result = ok({ ...good, themes: ["shepherd", "prosperity-now"] });
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /unknown theme id/);
});

test("register linter rejects devotional filler (rejects, never repairs)", () => {
  const preachy = ok({
    ...good,
    expansion: "This beautiful picture reminds us that God cares for us in our own lives.",
  });
  assert.equal(preachy.ok, false);
  if (!preachy.ok) assert.match(preachy.reason, /banned register/);
  assert.equal(findBannedRegister("The shepherd owns the sheep; the hired hand does not."), null);
});

test("refs are capped and deduped; expansion is length-bounded", () => {
  const many = Array.from({ length: 8 }, (_, i) => ({ book: "PSA", chapter: i + 1 }));
  const result = ok({ ...good, inferred_refs: [...many, { book: "PSA", chapter: 1 }] });
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.enrichment.inferredRefs.length, MAX_INFERRED_REFS);

  const long = ok({ ...good, expansion: "x".repeat(400) });
  assert.equal(long.ok, false);
});

test("invalid JSON and structural failures reject wholesale", () => {
  assert.equal(parseEnrichment("nope", backbone, themeIds).ok, false);
  assert.equal(ok({ no_scripture_intent: false, inferred_refs: [], themes: ["grace"], expansion: "x" }).ok, false, "refs required unless no-intent");
});

test("prompt pins stance preservation, ambiguity retention, and anti-injection", () => {
  const { context, prompt } = buildEnrichmentRequest(
    { title: "shepherd", body: "The shepherd knows my name." },
    themesFile.themes,
  );
  assert.match(context, /preserve the note's exact stance/i);
  assert.match(context, /include BOTH/i);
  assert.match(context, /never instructions/i);
  assert.match(context, /no_scripture_intent/);
  assert.match(context, /shepherd: God and leaders as shepherds/);
  assert.match(prompt, /The shepherd knows my name/);
});
