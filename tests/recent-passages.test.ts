import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatRecentLabel,
  normalizeRecents,
  pushRecent,
  recentKey,
  removeRecent,
  RECENT_PASSAGES_MAX,
  type RecentPassage,
} from "../src/renderer/utils/recentPassages.js";

const base = (over: Partial<RecentPassage> = {}): RecentPassage => ({
  book: "ACT",
  chapter: 19,
  packageId: "web",
  visitedAt: 1000,
  ...over,
});

test("pushRecent puts the visit first and drops older duplicates", () => {
  const a = base({ book: "ACT", chapter: 19, visitedAt: 1 });
  const b = base({ book: "JHN", chapter: 3, visitedAt: 2 });
  const a2 = base({ book: "ACT", chapter: 19, packageId: "kjv", verse: 4, visitedAt: 3 });
  const next = pushRecent(pushRecent([a], b), a2);
  assert.equal(next.length, 2);
  assert.equal(next[0]!.book, "ACT");
  assert.equal(next[0]!.packageId, "kjv");
  assert.equal(next[0]!.verse, 4);
  assert.equal(next[1]!.book, "JHN");
});

test("pushRecent caps at RECENT_PASSAGES_MAX", () => {
  let list: RecentPassage[] = [];
  for (let i = 1; i <= RECENT_PASSAGES_MAX + 3; i++) {
    list = pushRecent(list, base({ book: "PSA", chapter: i, visitedAt: i }));
  }
  assert.equal(list.length, RECENT_PASSAGES_MAX);
  assert.equal(list[0]!.chapter, RECENT_PASSAGES_MAX + 3);
});

test("removeRecent drops only the matching book+chapter", () => {
  const list = [base({ book: "ACT", chapter: 19 }), base({ book: "JHN", chapter: 3 })];
  const next = removeRecent(list, { book: "ACT", chapter: 19 });
  assert.deepEqual(next.map(recentKey), ["JHN:3"]);
});

test("normalizeRecents sanitizes junk and dedupes", () => {
  const raw = [
    { book: "ACT", chapter: 19, packageId: "web", visitedAt: 5 },
    { book: "ACT", chapter: 19, packageId: "kjv", visitedAt: 9 },
    { book: "", chapter: 1 },
    null,
    { book: "ROM", chapter: "8", packageId: "web", visitedAt: 1 },
  ];
  const list = normalizeRecents(raw);
  assert.equal(list.length, 2);
  assert.equal(list[0]!.book, "ACT");
  assert.equal(list[0]!.packageId, "web");
  assert.equal(list[1]!.book, "ROM");
  assert.equal(list[1]!.chapter, 8);
});

test("formatRecentLabel uses display name and optional verse", () => {
  const names = { ACT: ["Acts"] };
  assert.equal(formatRecentLabel(base(), names), "Acts 19");
  assert.equal(formatRecentLabel(base({ verse: 2 }), names), "Acts 19:2");
});
