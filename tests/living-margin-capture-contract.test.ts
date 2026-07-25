import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import * as ReactModule from "react";

(globalThis as unknown as { React: typeof ReactModule }).React = ReactModule;

const { buildNoteCaptureMarkdown } = await import("../src/renderer/components/NoteCapture.js");
const { buildMarginCaptureDraft } = await import("../src/renderer/components/ScripturePage.js");
const { buildEntityResearchCapture, formatMarginSourceCitation } = await import("../src/renderer/components/LivingMargin.js");
const { buildLanguageWordCapture, formatLanguageSourceCitation } = await import("../src/renderer/components/LanguageWordsSection.js");

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf-8");
const margin = read("src/renderer/components/LivingMargin.tsx");
const page = read("src/renderer/components/ScripturePage.tsx");
const capture = read("src/renderer/components/NoteCapture.tsx");
const language = read("src/renderer/components/LanguageWordsSection.tsx");
const disclosure = read("src/renderer/components/SourcesDisclosure.tsx");
const css = read("src/renderer/styles.css");

test("Living Margin capture produces readable Markdown with frozen provenance", () => {
  const draft = buildMarginCaptureDraft({
    excerpt: "For as yet he had fallen on none of them…",
    sourceAttribution: "OpenBible Cross References (CC-BY)",
    reference: "Acts 8:16",
    frozenOrigin: "Acts 19:5",
    originLabel: "Related verse",
  }, {
    book: "ACT", chapter: 19, verseStart: 5, verseEnd: 5, packageId: "bsb",
  });
  const expected = [
    "> For as yet he had fallen on none of them…",
    "",
    "— Source: OpenBible Cross References (CC-BY) · Acts 8:16 · captured while studying Acts 19:5",
  ].join("\n");
  assert.equal(draft.title, "Acts 8:16 — from Acts 19 study");
  assert.equal(draft.bodyPrefill, expected);
  assert.equal(buildNoteCaptureMarkdown(draft.quote, draft.bodyPrefill ?? ""), `${expected}\n`);
});

test("capture actions remain explicit and create-note stays behind Save", () => {
  // Was 4. Two of those capture verbs belonged to `CrossReferenceRow` and
  // `NoteCrossRefsBlock`, the Connections tab's cross-reference lists, which
  // Quire C·4 removed from that tab and which are now deleted — Overview
  // re-drew the edition's list on C4·2's compact row, whose verbs are Open and
  // Tab. The remaining two are unchanged and still explicit.
  assert.equal(margin.match(/Add to note…/g)?.length, 2);
  // Quire C·4 §3·3 moves the word entry's capture verb into the pane footer,
  // and C2·7 already ruled the ellipsis off it there: "Losing the ellipsis: it
  // opens inline, not a dialog." The drawn footer reads `Add to note`. The
  // action is still explicit and still exactly one — only its punctuation and
  // its position changed — so the count is asserted on the verb itself and the
  // ellipsis is asserted gone rather than counted.
  assert.equal(language.match(/Add to note(?!…)/g)?.length, 1);
  assert.doesNotMatch(language, /Add to note…/);
  // Was: /function CrossReferenceRow[\s\S]*className="margin-capture-action"/ —
  // the deleted cross-reference row. The surviving capture verbs still carry
  // the same explicit class, and one of them is still reached from a reference.
  assert.match(margin, /className="margin-capture-action"/);
  assert.match(margin, /className="margin-capture-action entity-research-capture"/);
  assert.match(language, /onCapture\(buildLanguageWordCapture\(\{/);
  assert.match(page, /onCapture=\{handleMarginCapture\}/);
  const handler = page.slice(page.indexOf("const handleMarginCapture"), page.indexOf("const handleNoteCaptureSaved"));
  assert.match(handler, /setNoteDraft\(buildMarginCaptureDraft/);
  assert.doesNotMatch(handler, /createNote/);
  assert.equal(capture.match(/window\.api\.library\.createNote/g)?.length, 1);
  assert.match(capture, /onExitControllerChange\?:/);
  assert.match(page, /noteExitControllerRef/);
  assert.match(capture, /tags: draft\.bodyPrefill \? \[\] : \["from-selection"\]/);
  assert.match(css, /\.margin-capture-action\s*\{[\s\S]*opacity: 0\.45/);
});

test("entity research captures only the source datasets actually present", () => {
  const data = {
    entity: {
      id: "Apollos",
      kind: "person",
      displayName: "Apollos",
      brief: "An Alexandrian teacher who knew only the baptism of John.",
      refs: ["ACT.18.24"],
      refCount: 1,
    },
    place: null,
    pleiades: null,
    imageDataUrl: null,
  } as unknown as Parameters<typeof buildEntityResearchCapture>[0];
  assert.deepEqual(buildEntityResearchCapture(data, {
    book: "ACT", chapter: 19, packageId: "bsb", verseStart: 5, verseEnd: 5,
  }, { ACT: ["Acts"] }), {
    excerpt: "Apollos — An Alexandrian teacher who knew only the baptism of John.",
    sourceAttribution: "STEPBible TIPNR (CC BY 4.0)",
    reference: "Apollos",
    frozenOrigin: "Acts 19:5",
    originLabel: "Entity research",
  });
});

test("word capture uses visible form, gloss, definition, package, and verse", () => {
  const card = {
    token: { id: "ACT.19.5.1", datasetId: "macula-greek-nestle1904", book: "ACT", chapter: 19, verse: 5, position: 1, surface: "λόγος", morph: {}, gloss: "word" },
    gloss: "word",
    definition: { firstSense: "Word, speech, message", full: "A word or saying.", xlit: "logos", source: "Strong's", id: "G3056" },
  } as unknown as Parameters<typeof buildLanguageWordCapture>[0]["card"];
  assert.deepEqual(buildLanguageWordCapture({
    card,
    packageId: "macula-greek-nestle1904",
    packageName: "MACULA Greek (Nestle 1904)",
    reference: "Acts 19:5",
  }), {
    excerpt: "λόγος · logos · word\nDefinition: Word, speech, message",
    sourceAttribution: "MACULA Greek (Nestle 1904) (CC BY 4.0); Strong's (Public domain)",
    reference: "Acts 19:5",
    frozenOrigin: "Acts 19:5",
    originLabel: "Word study",
  });
});

test("public-data surfaces consolidate provenance under Sources with Cite", () => {
  // "Every generated line carries a source count." The disclosure is the one
  // place counts live, so a bare "Sources" put the count behind a click on
  // every generated surface at once.
  assert.match(disclosure, /<summary>\{sources\.length\} \{sources\.length === 1 \? "source" : "sources"\}<\/summary>/);
  assert.match(disclosure, /navigator\.clipboard\.writeText\(formatSourceCitation\(source\)\)/);
  assert.match(margin, /formatSourceCitation\(source\)/);
  assert.match(language, /formatSourceCitation\(source\)/);
  assert.match(margin, /SourcesDisclosure/);
  assert.match(language, /SourcesDisclosure/);
  assert.doesNotMatch(margin, /className="crossref-attribution"|className="intent-attribution"|<footer className="entity-research-sources">/);
  assert.doesNotMatch(language, /lang-step-attr|lang-name-attr|lang-def-attr/);
  assert.equal(formatMarginSourceCitation({ name: "Pleiades 4.1", license: "CC BY 3.0", detail: "Ancient gazetteer" }), "Pleiades 4.1 · CC BY 3.0 · Ancient gazetteer");
  assert.equal(formatLanguageSourceCitation({ name: "Strong's", license: "Public domain", detail: "G3056" }), "Strong's · Public domain · G3056");
});
