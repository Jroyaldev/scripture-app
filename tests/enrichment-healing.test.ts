import assert from "node:assert/strict";
import { test } from "node:test";
import { healSuggestionOrder, inferredRefKey } from "../src/core/ai/note-enrichment.js";

// The E5 gate scenario: two shepherd notes. Confirming John 10 on note B
// re-ranks the suggestion on note A, deterministically and explainably.

const noteA_suggestions = [
  { book: "PSA", chapter: 23 },
  { book: "JHN", chapter: 10, verseStart: 3, verseEnd: 4 },
];

test("confirming a passage on a theme-sharing note boosts it on the next note", () => {
  const { suggestions, healedKeys } = healSuggestionOrder({
    noteThemes: ["shepherd", "identity-in-christ"],
    suggestions: noteA_suggestions,
    confirmations: [{ noteId: "note-b", refKey: "JHN.10.27-28" }],
    themesByNote: new Map([["note-b", ["shepherd"]]]),
  });
  assert.equal(suggestions[0]!.book, "JHN", "John 10 rises to the front");
  assert.equal(healedKeys.has(inferredRefKey(noteA_suggestions[1]!)), true);
});

test("confirmations from notes with NO shared theme do not heal (no doctrine profile)", () => {
  const { suggestions, healedKeys } = healSuggestionOrder({
    noteThemes: ["shepherd"],
    suggestions: noteA_suggestions,
    confirmations: [{ noteId: "note-c", refKey: "JHN.10.27-28" }],
    themesByNote: new Map([["note-c", ["justification"]]]),
  });
  assert.equal(suggestions[0]!.book, "PSA", "original model order preserved");
  assert.equal(healedKeys.size, 0);
});

test("healing matches at chapter identity, order is stable otherwise", () => {
  const { suggestions } = healSuggestionOrder({
    noteThemes: ["waiting"],
    suggestions: [
      { book: "ISA", chapter: 40, verseStart: 31, verseEnd: 31 },
      { book: "PSA", chapter: 27, verseStart: 14, verseEnd: 14 },
      { book: "LAM", chapter: 3, verseStart: 25, verseEnd: 26 },
    ],
    confirmations: [{ noteId: "other", refKey: "PSA.27" }],
    themesByNote: new Map([["other", ["waiting", "hope"]]]),
  });
  assert.deepEqual(suggestions.map((s) => s.book), ["PSA", "ISA", "LAM"]);
});

test("no confirmations → order untouched", () => {
  const { suggestions, healedKeys } = healSuggestionOrder({
    noteThemes: ["shepherd"],
    suggestions: noteA_suggestions,
    confirmations: [],
    themesByNote: new Map(),
  });
  assert.deepEqual(suggestions, noteA_suggestions);
  assert.equal(healedKeys.size, 0);
});
