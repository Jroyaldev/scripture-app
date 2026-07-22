import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import React from "react";
import {
  backNavigationHistory,
  type NavigationHistoryState,
} from "../src/renderer/utils/navigationHistory.js";
import type { PassageViewState } from "../src/renderer/utils/studyWorkspace.js";

// The renderer's classic JSX transform expects React on the browser global.
// Install it before dynamically loading the component that exports the pure
// session helpers exercised below.
Object.assign(globalThis, { React });
const {
  freshPassageNavigationEntry,
  passageRestoreEntryForContext,
  restorePassageSelection,
} = await import("../src/renderer/components/ScripturePage.js");

const page = readFileSync(
  resolve(import.meta.dirname, "../src/renderer/components/ScripturePage.tsx"),
  "utf8",
);

function view(overrides: Partial<PassageViewState> = {}): PassageViewState {
  return {
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
    verse: 2,
    verseOffset: 14,
    scrollTop: 320,
    margin: {
      activeTab: "overview",
      scope: null,
      scrollTopByTab: { overview: 44 },
      wordsVerse: 2,
      wordsFollowingReading: true,
    },
    ...overrides,
  };
}

test("initial restore keeps exact package-local phrase pieces ahead of the coarse scope", () => {
  const entry = view({
    selection: {
      packageId: "bsb",
      pieces: [
        { verse: 5, charStart: 12, charEnd: null },
        { verse: 6, charStart: null, charEnd: 9 },
      ],
    },
    margin: {
      activeTab: "passage",
      scope: { kind: "selection", start: 5, end: 6 },
      scrollTopByTab: { passage: 188 },
      wordsVerse: 6,
      wordsFollowingReading: false,
    },
  });

  assert.deepEqual(restorePassageSelection(entry), {
    phrase: {
      verseStart: 5,
      verseEnd: 6,
      charStart: 12,
      charEnd: 9,
    },
    verses: [],
    anchor: 5,
  });
});

test("Back target retains phrase, lens, per-lens scroll, Words state, and viewport", () => {
  const target = view({
    book: "JHN",
    chapter: 3,
    verse: 16,
    verseOffset: 37,
    scrollTop: 725,
    selection: {
      packageId: "bsb",
      pieces: [{ verse: 16, charStart: 4, charEnd: 22 }],
    },
    margin: {
      activeTab: "notes",
      scope: { kind: "selection", start: 16, end: 16 },
      scrollTopByTab: { overview: 12, notes: 418 },
      wordsVerse: 14,
      wordsFollowingReading: false,
    },
  });
  const history: NavigationHistoryState<PassageViewState> = {
    back: [target],
    forward: [],
  };
  const move = backNavigationHistory(history, view());

  assert.deepEqual(move.target, target);
  assert.deepEqual(restorePassageSelection(move.target!), {
    phrase: { verseStart: 16, verseEnd: 16, charStart: 4, charEnd: 22 },
    verses: [],
    anchor: 16,
  });
  assert.deepEqual(move.target?.margin, target.margin);
  assert.equal(move.target?.scrollTop, 725);
  assert.equal(move.target?.verseOffset, 37);
});

test("fresh chapter navigation starts a fresh subject scroll and resumes Words follow", () => {
  const current = view({
    margin: {
      activeTab: "passage",
      scope: { kind: "selection", start: 2, end: 3 },
      scrollTopByTab: { overview: 120, passage: 515 },
      wordsVerse: 2,
      wordsFollowingReading: false,
    },
  });
  const next = freshPassageNavigationEntry(current, {
    book: "ACT",
    chapter: 20,
    packageId: "bsb",
  });
  assert.equal(next.chapter, 20);
  assert.equal(next.scrollTop, 0);
  assert.deepEqual(next.margin.scrollTopByTab, {});
  assert.equal(next.margin.activeTab, "passage");
  assert.equal(next.margin.scope, null);
  assert.equal(next.margin.wordsVerse, undefined);
  assert.equal(Object.hasOwn(next.margin, "wordsVerse"), false);
  assert.equal(next.margin.wordsFollowingReading, true);
  assert.equal(next.selection, undefined);

  const reference = freshPassageNavigationEntry(current, {
    book: "ROM",
    chapter: 6,
    packageId: "web",
    verse: 3,
    rangeEnd: 4,
  });
  assert.deepEqual(reference.margin.scope, { kind: "selection", start: 3, end: 4 });
  assert.equal(reference.margin.wordsVerse, 3);
  assert.equal(reference.margin.wordsFollowingReading, true);
});

test("controlled selection restore accepts only the exact workspace owner and rendered text", () => {
  const entry = view({
    selection: {
      packageId: "bsb",
      pieces: [{ verse: 2, charStart: 37, charEnd: 48 }],
    },
  });
  const candidate = { ownerTabId: "passage-a", entry };

  assert.equal(
    passageRestoreEntryForContext(candidate, {
      ownerTabId: "passage-a",
      book: "ACT",
      chapter: 19,
      packageId: "bsb",
    }),
    entry,
  );
  assert.equal(
    passageRestoreEntryForContext(candidate, {
      ownerTabId: "passage-b",
      book: "ACT",
      chapter: 19,
      packageId: "bsb",
    }),
    null,
  );
  assert.equal(
    passageRestoreEntryForContext(candidate, {
      ownerTabId: "passage-a",
      book: "ACT",
      chapter: 19,
      packageId: "web",
    }),
    null,
  );
});

test("ScripturePage owner-tags restore, async context, viewport, and VersePeek lifetime", () => {
  assert.match(page, /useState<HighlightRange \| null>\(\s*\(\) => restorePassageSelection\(sessionEntry\)\.phrase/);
  assert.match(page, /pendingPassageRestoreRef = useRef<[\s\S]*?>\(\{\s*ownerTabId: sessionOwnerTabId,\s*entry: sessionEntry,\s*\}\)/);
  const ownerRestore = page.slice(
    page.indexOf("// A workspace owner switch is a controlled restore"),
    page.indexOf("// Invalidate every owner-sensitive request generation"),
  );
  assert.match(ownerRestore, /pendingPassageRestoreRef\.current = \{\s*ownerTabId: sessionOwnerTabId,\s*entry: sessionEntry,\s*\}/);
  assert.doesNotMatch(ownerRestore, /changesRenderedText/);
  assert.match(page, /if \(sessionOwnerTabIdRef\.current !== requestedOwnerTabId\) return;/);
  assert.match(page, /const targetEntry = opts\?\.restoreEntry \?\? freshPassageNavigationEntry/);
  assert.match(page, /onSessionEntryChange\(requestedOwnerTabId, targetEntry\)/);
  assert.match(page, /setSavedViewportTarget\(opts\?\.restoreEntry \? \{/);
  assert.match(page, /setSessionRestoreNonce\(\(current\) => current \+ 1\)/);
  assert.match(page, /key=\{sessionOwnerTabId\}[\s\S]*sessionRestoreNonce=\{sessionRestoreNonce\}/);
  assert.match(page, /`\$\{sessionOwnerTabId\}:\$\{book\}:\$\{chapter\}:\$\{packageId\}`/);
  assert.match(page, /key: `\$\{sessionOwnerTabId\}:\$\{sessionEntry\.book\}:\$\{sessionEntry\.chapter\}`/);
});
