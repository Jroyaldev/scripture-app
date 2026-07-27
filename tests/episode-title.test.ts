/**
 * Matching a publisher's episode across two of their own catalogues.
 *
 * BibleProject's website and its RSS feed name the same episode differently,
 * and not in one way — the feed appends the series, the pages prefix it, one
 * writes "Q+R" where the other writes "Question and Response". Every rule here
 * exists because a real episode was falling through, and the two failing tests
 * at the bottom exist because a real episode was matched to the wrong audio.
 *
 * That asymmetry is the whole design. A missed match is a card with no duration
 * on it. A wrong match is a card that plays a different episode than the one it
 * names, to a reader who trusted it — so every loosening here is paired with a
 * guard, and the guards are what these tests mostly check.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { fold, fuzzyMatch, significantWords, titleKeys } from "../src/core/resources/episode-title.js";

const keys = (title: string): string[] => titleKeys(title);
const matches = (page: string, feed: string): boolean =>
  keys(page).some((key) => keys(feed).includes(key));

test("the same episode is found across the three ways the catalogues disagree", () => {
  // Trailing series tag, numbered as an episode.
  assert.ok(matches("A Cup of Wrath?", "A Cup of Wrath? – Character of God E8"));
  // Trailing series tag, numbered as a part — this one cost 33 episodes.
  assert.ok(matches("Weeds and Wheat", "Weeds and Wheat - Gospel of Matthew Part 21"));
  assert.ok(matches("Storms & Swine", "Storms and Swine - Gospel of Matthew Part 14"));
  // Leading series tag on the page instead.
  assert.ok(matches(
    "The Letter of Jude E1: A Family Legacy and a Short Letter",
    "Jude: A Family Legacy and a Short Letter",
  ));
});

test("Q+R and Question and Response are one abbreviation, not two episodes", () => {
  assert.equal(fold("Question and Response"), fold("Q+R"));
  assert.equal(fold("Questions & Responses"), fold("Q&R"));

  /* Found in the app, by eye: this record linked and refused to play. Folding
     the abbreviation is necessary but not sufficient — the two titles also put
     "Exodus" in different places, so no exact key can line them up and it is
     the fuzzy pass that has to close it. Asserting the fold alone would have
     looked like a fix and left the episode silent. */
  const page = "Exodus: Did God Try to Kill Moses? Question and Response";
  const feed = "Did God Try To Kill Moses? – Exodus Q+R";
  assert.ok(!matches(page, feed), "word order still differs; this is the fuzzy pass's job");
  assert.equal(
    fuzzyMatch(page, [
      { words: significantWords(feed), facts: "moses" },
      { words: significantWords("The Anointed Question and Response"), facts: "anointed" },
    ]),
    "moses",
  );
});

test("a generic tail never becomes a key, because generic tails collide", () => {
  /* The bug this pins shipped. "Numbers: Question and Response" and "The Holy
     Spirit: Question and Response" both reduced to "question and response", so
     one episode played the other's audio. The remainder after a colon has to
     carry three substantial words — measuring its length instead let a
     twenty-one-character phrase describing a dozen episodes through. */
  assert.ok(!matches("Numbers: Question and Response", "The Holy Spirit: Question and Response"));
  assert.ok(!matches("Exodus: Question and Response", "Leviticus: Question and Response"));

  // And the distinctive remainder still works, which is the point of the rule.
  assert.ok(matches("Jude: A Family Legacy and a Short Letter", "A Family Legacy and a Short Letter"));
});

test("the fuzzy fallback refuses to guess between near-identical names", () => {
  const candidates = [
    { words: significantWords("The Holy Spirit: Question and Response"), facts: "holy-spirit" },
    { words: significantWords("The Anointed Question and Response"), facts: "anointed" },
    { words: significantWords("Did God Try To Kill Moses? – Exodus Q+R"), facts: "moses" },
  ];

  // A clear winner is taken.
  assert.equal(fuzzyMatch("Exodus: Did God Try to Kill Moses? Question and Response", candidates), "moses");

  // A title with nothing distinctive in it must not resolve to anything. Every
  // candidate here shares its only real words, so any answer would be a coin toss.
  assert.equal(fuzzyMatch("Question and Response", candidates), undefined);
  // Too few substantial words to judge on at all.
  assert.equal(fuzzyMatch("Son of Man", candidates), undefined);
  assert.equal(fuzzyMatch("", candidates), undefined);
});

test("folding is about comparison, and never invents a difference", () => {
  assert.equal(fold("Story: God & Money"), fold("Story: God and Money"));
  assert.equal(fold("God Vs. Kings"), fold("god vs kings"));
  assert.equal(fold("Humans are... Trees?"), fold("Humans Are Trees"));
});
