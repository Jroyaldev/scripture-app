import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import * as ReactModule from "react";
import {
  backNavigationHistory,
  type NavigationHistoryEntry,
} from "../src/renderer/utils/navigationHistory.js";
import { parsePeekRef } from "../src/renderer/components/VersePeek.js";

(globalThis as unknown as { React: typeof ReactModule }).React = ReactModule;
const { resolveMarginSubject, supersedeKeptReference } = await import(
  "../src/renderer/components/ScripturePage.js"
);

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(join(repoRoot, path), "utf8");
const page = read("src/renderer/components/ScripturePage.tsx");
const margin = read("src/renderer/components/LivingMargin.tsx");
const peek = read("src/renderer/components/VersePeek.tsx");
const main = read("src/electron/main.ts");
const api = read("src/renderer/api.ts");
const css = read("src/renderer/styles.css");

const base = {
  canvasBook: "ACT",
  canvasChapter: 19,
  canvasChapterEndVerse: 41,
  nearVerse: 8,
  kept: { book: "JHN", chapter: 3, verse: 16 },
};

test("one resolver enforces Selection over Kept over Following", () => {
  assert.deepEqual(resolveMarginSubject({ ...base, selection: { start: 5, end: 7 } }), {
    kind: "selection", book: "ACT", chapter: 19, verse: 5, endVerse: 7,
  });
  assert.deepEqual(resolveMarginSubject({ ...base, selection: null }), {
    kind: "kept", book: "JHN", chapter: 3, verse: 16, endVerse: 16,
  });
  assert.deepEqual(resolveMarginSubject({ ...base, selection: null, kept: null }), {
    kind: "following", book: "ACT", chapter: 19, verse: 8, endVerse: 8,
  });
  assert.deepEqual(resolveMarginSubject({ ...base, selection: null, kept: null, nearVerse: null }), {
    kind: "following", book: "ACT", chapter: 19, verse: 1, endVerse: 41,
  });
});

test("a canvas selection supersedes Kept only in the kept chapter", () => {
  const kept = { book: "JHN", chapter: 3, verse: 16 };
  assert.equal(supersedeKeptReference(kept, "JHN", 3), null);
  assert.equal(supersedeKeptReference(kept, "ACT", 19), kept);
  assert.match(page, /if \(!pinnedRange \|\| !keptContext \|\| !onKeptContextChange\) return;/);
  assert.match(page, /supersedeKeptReference\(keptContext, book, chapter\)/);
});

test("VersePeek parses canonical ranges and keeps without canvas navigation", () => {
  assert.deepEqual(parsePeekRef("bref:v1/ACT.18.19-ACT.18.20", "Acts 18:19–20"), {
    book: "ACT", chapter: 18, verse: 19, endVerse: 20, label: "Acts 18:19–20",
  });
  assert.equal(parsePeekRef("not-a-reference", "Invalid"), null);

  const actionStart = peek.indexOf('className="verse-peek-keep"');
  const actionEnd = peek.indexOf("</button>", actionStart);
  assert.ok(actionStart >= 0 && actionEnd > actionStart);
  const action = peek.slice(actionStart, actionEnd);
  assert.match(action, /onKeepReference\(peek\.target\)/);
  assert.match(action, /onClose\(\)/);
  assert.doesNotMatch(action, /navigate|onNavigate|goTo/);
  assert.match(peek, /role=\{onKeepReference \? "dialog" : "tooltip"\}/);
  assert.match(css, /\.verse-peek-keep[\s\S]{0,260}?color: var\(--text-tertiary\)/);

  const handlerStart = page.indexOf("const handleKeepPeekReference");
  const handlerEnd = page.indexOf("const handleNoteCaptureSaved", handlerStart);
  const handler = page.slice(handlerStart, handlerEnd);
  assert.match(handler, /onKeptContextChange\?\.\(\{/);
  assert.doesNotMatch(handler, /goTo|setBook|setChapter|setReferenceViewportTarget/);
  assert.match(page, /onKeepReference=\{handleKeepPeekReference\}/);
});

test("kept context survives ordinary canvas travel and has an explicit release", () => {
  const chapterEffectStart = page.indexOf("// Reset nearVerse immediately on chapter/book change");
  const chapterEffectEnd = page.indexOf("// Phrase offsets", chapterEffectStart);
  const chapterEffect = page.slice(chapterEffectStart, chapterEffectEnd);
  assert.match(chapterEffect, /setNearVerse\(null\)/);
  assert.doesNotMatch(chapterEffect, /onKeptContextChange/);

  const toggleStart = page.indexOf("const handleAmbientKeptChange");
  const toggleEnd = page.indexOf("const handleKeepPeekReference", toggleStart);
  const toggle = page.slice(toggleStart, toggleEnd);
  assert.match(toggle, /if \(!keep\)[\s\S]{0,100}?onKeptContextChange\(null\)/);
  assert.match(toggle, /book,[\s\S]{0,80}?chapter,[\s\S]{0,80}?verse: settledNearVerse/);
  assert.match(margin, /\{ambientKept \? "Follow reading" : "Keep"\}/);
});

test("all four Living Margin lenses receive one resolved cross-chapter subject", () => {
  assert.match(page, /book=\{marginSubject\.book\}/);
  assert.match(page, /chapter=\{marginSubject\.chapter\}/);
  assert.match(page, /marginData=\{subjectMarginData\}/);
  assert.match(page, /crossRefs=\{subjectCrossRefs\}/);
  assert.match(page, /semanticData=\{marginSubject\.kind === "kept" \? null : semanticData\}/);
  assert.match(page, /chapterVerseText=\{subjectChapterVerseText\}/);
  assert.match(page, /authoredConnections=\{subjectMarginData\.connections\}/);
  assert.match(margin, /<IntentOverview[\s\S]{0,420}?crossRefs=\{crossRefs\}[\s\S]{0,420}?semantic=\{semanticData\}/);
  assert.match(margin, /<LanguageWordsSection[\s\S]{0,220}?book=\{book\}[\s\S]{0,220}?chapter=\{chapter\}/);
});

test("history and validated settings preserve at most one kept subject", () => {
  const keptEntry: NavigationHistoryEntry = {
    book: "ACT",
    chapter: 19,
    packageId: "bsb",
    margin: {
      activeTab: "connections",
      scope: { kind: "kept", book: "JHN", chapter: 3, verse: 16, label: "John 3:16" },
    },
  };
  const current: NavigationHistoryEntry = {
    book: "ROM", chapter: 8, packageId: "bsb", margin: { activeTab: "overview", scope: null },
  };
  assert.deepEqual(backNavigationHistory({ back: [keptEntry], forward: [] }, current).target, keptEntry);
  assert.match(page, /return keptContext \? \{ kind: "kept", \.\.\.keptContext \} : null/);
  assert.match(page, /restoredScope\?\.kind === "kept"[\s\S]{0,360}?book: restoredScope\.book[\s\S]{0,160}?chapter: restoredScope\.chapter[\s\S]{0,160}?verse: restoredScope\.verse/);
  assert.match(api, /keptContext\?: \{[\s\S]{0,220}?book: string;[\s\S]{0,160}?verse: number;/);
  assert.match(main, /function normalizeKeptContext\(value: unknown\)/);
  assert.match(main, /hasKeptContext \? partial\.keptContext : store\.store\.keptContext/);
});
