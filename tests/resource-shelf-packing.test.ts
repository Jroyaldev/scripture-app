import assert from "node:assert/strict";
import { test } from "node:test";

import { SHELF_LIFT, packShelf, type ShelfTracks } from "../src/renderer/components/Resources.js";

/**
 * THE PUBLISHER SHELF'S LINE-BREAKER.
 *
 * The rule, and the defence of its bound, are written out at `packShelf` in
 * src/renderer/components/Resources.tsx. This file is the corpus that defence
 * cites — seven real chapters, measured in the running engine on 2026-07-31 at
 * the study column's own 332px, where a track is 163 — held against the rule so
 * that neither can drift from the other.
 *
 * Every composition here is REAL. A packing that looks tidy on Genesis 6 can
 * strand three plates on a chapter with a different mix, which is exactly why
 * the bound is defended on a corpus rather than on the chapter that raised the
 * question.
 */

/** A plate as the shelf hands it to the packer: its rank, and its width. */
interface Plate { readonly id: string; readonly rank: number; readonly tracks: ShelfTracks }

/** `bibleproject:1 forty-minutes-ot:2 …` — the ranking with each plate's width. */
function composition(said: string): Plate[] {
  return said.trim().split(/\s+/).map((entry, rank) => {
    const [id, tracks] = entry.split(":");
    return { id: id as string, rank, tracks: Number(tracks) as ShelfTracks };
  });
}

/**
 * The seven, in the ranking each chapter's room actually produced.
 *
 * The two-track publishers are the five whose identity is a NAME long enough to
 * overrun a track; the one-track ones are the six carrying artwork plus
 * Radically Christian, whose name is short enough to fit. Nothing here is
 * invented: `docs/ui-audit/resource-shelf/packing-before.json` is the same
 * seven read off the engine.
 */
const CORPUS: ReadonlyArray<{ passage: string; ranking: Plate[] }> = [
  { passage: "Genesis 1", ranking: composition(`
    spoken-gospel:1 bibleproject:1 listeners-commentary:2 forty-minutes-ot:2 naked-bible:1
    radically-christian:1 ask-nt-wright:2 five-minutes-church-history:2 the-gospel-coalition:1
    enter-the-bible:1 working-preacher:1`) },
  { passage: "Genesis 6", ranking: composition(`
    bibleproject:1 forty-minutes-ot:2 ask-nt-wright:2 listeners-commentary:2 spoken-gospel:1
    radically-christian:1 naked-bible:1 five-minutes-church-history:2 the-gospel-coalition:1
    enter-the-bible:1 working-preacher:1`) },
  { passage: "1 Samuel 30", ranking: composition(`
    forty-minutes-ot:2 naked-bible:1 bibleproject:1 spoken-gospel:1 enter-the-bible:1
    the-gospel-coalition:1`) },
  { passage: "Acts 19", ranking: composition(`
    listeners-commentary:2 naked-bible:1 radically-christian:1 bibleproject:1 ask-nt-wright:2
    spoken-gospel:1 five-minutes-church-history:2 forty-minutes-ot:2 the-gospel-coalition:1
    working-preacher:1 enter-the-bible:1`) },
  { passage: "Romans 5", ranking: composition(`
    listeners-commentary:2 spoken-gospel:1 bibleproject:1 radically-christian:1 ask-nt-wright:2
    forty-minutes-ot:2 naked-bible:1 five-minutes-church-history:2 the-gospel-coalition:1
    working-preacher:1 enter-the-bible:1`) },
  { passage: "Psalm 23", ranking: composition(`
    forty-minutes-ot:2 bibleproject:1 radically-christian:1 ask-nt-wright:2 spoken-gospel:1
    listeners-commentary:2 naked-bible:1 working-preacher:1 the-gospel-coalition:1
    enter-the-bible:1`) },
  { passage: "Jude", ranking: composition(`
    spoken-gospel:1 bibleproject:1 listeners-commentary:2 naked-bible:1 ask-nt-wright:2
    forty-minutes-ot:2 five-minutes-church-history:2 the-gospel-coalition:1 enter-the-bible:1`) },
];

const pack = (ranking: readonly Plate[], lift = SHELF_LIFT): Plate[] =>
  packShelf(ranking, (plate) => plate.tracks, lift);

/**
 * What flexbox will do with that order, restated here so the assertions can be
 * about ROWS. The floor (`min-width: calc(50% - gap/2)`) means a line holds two
 * one-track plates, or one plate of either width, and never anything else.
 */
function rowsOf(packed: readonly Plate[]): Plate[][] {
  const rows: Plate[][] = [];
  for (const plate of packed) {
    const last = rows[rows.length - 1];
    const room = last !== undefined && last.length === 1 && last[0]?.tracks === 1 && plate.tracks === 1;
    if (room && last !== undefined) last.push(plate);
    else rows.push([plate]);
  }
  return rows;
}

test("the packed shelf is the ranking, rearranged and never rewritten", () => {
  for (const { passage, ranking } of CORPUS) {
    const packed = pack(ranking);
    assert.equal(packed.length, ranking.length, `${passage}: the packing lost or gained a publisher`);
    assert.deepEqual(
      [...packed].map((plate) => plate.id).sort(),
      [...ranking].map((plate) => plate.id).sort(),
      `${passage}: the packing is not a permutation of the ranking`,
    );
    assert.equal(packed[0]?.rank, 0,
      `${passage}: the shelf no longer opens with the publisher the ranking put first`);
  }
});

test("rank survives inside each width, and no plate is lifted past the bound", () => {
  for (const { passage, ranking } of CORPUS) {
    const packed = pack(ranking);
    for (const width of [1, 2] as const) {
      const ranks = packed.filter((plate) => plate.tracks === width).map((plate) => plate.rank);
      assert.deepEqual(ranks, [...ranks].sort((left, right) => left - right),
        `${passage}: the ${width}-track publishers left rank order among themselves`);
    }
    packed.forEach((plate, at) => {
      assert.ok(plate.rank - at <= SHELF_LIFT,
        `${passage}: ${plate.id} was lifted ${plate.rank - at} places, past the bound of ${SHELF_LIFT}`);
      assert.ok(at - plate.rank <= ranking.length,
        `${passage}: ${plate.id} fell off the shelf`);
    });
  }
});

test("no row is left with a hole a later plate could have filled", () => {
  for (const { passage, ranking } of CORPUS) {
    const packed = pack(ranking);
    const rows = rowsOf(packed);
    rows.forEach((row) => {
      if (row.length !== 1 || row[0]?.tracks !== 1) return;
      const from = packed.indexOf(row[0] as Plate) + 1;
      const reach = packed.slice(from, from + SHELF_LIFT + 1);
      const filler = reach.find((plate) => plate.tracks === 1);
      assert.equal(filler, undefined,
        `${passage}: ${row[0]?.id} sits alone while ${filler?.id} — ${reach.indexOf(filler as Plate)} places later — would have filled the row`);
    });
  }
});

test("an odd count of one-track plates leaves exactly one lone row, at the foot", () => {
  for (const { passage, ranking } of CORPUS) {
    const narrow = ranking.filter((plate) => plate.tracks === 1).length;
    assert.equal(narrow % 2, 1, `${passage}: the corpus fixture no longer has an odd count to prove this on`);
    const rows = rowsOf(pack(ranking));
    const lone = rows.filter((row) => row.length === 1 && row[0]?.tracks === 1);
    /* Parity, not zero. No arrangement of an odd number of half-width things
       fills every row, so the honest claim is that there is exactly ONE and
       that it is the last thing on the shelf — a short last line, not a hole. */
    assert.equal(lone.length, 1, `${passage}: ${lone.length} plates sit alone where the arithmetic allows one`);
    assert.equal(rows[rows.length - 1], lone[0],
      `${passage}: the one plate without a partner is stranded mid-shelf instead of ending the register`);
  }
});

test("the bound of three is the one the corpus asks for", () => {
  /* THE DEFENCE, executable — and the measure is STRANDING rather than lone
     rows. An odd count of one-track plates always leaves one of them without a
     partner, so counting lone rows can never reach zero and would say nothing.
     What the reader actually saw is a plate sitting alone with the register
     still going on beneath it; a plate alone on the LAST row is a short last
     line. So: how many plates sit alone above the foot. */
  const stranded = (ranking: readonly Plate[], lift: number): number => {
    const rows = rowsOf(pack(ranking, lift));
    return rows.filter((row, at) => row.length === 1 && row[0]?.tracks === 1 && at < rows.length - 1).length;
  };

  const genesis6 = CORPUS.find((entry) => entry.passage === "Genesis 6")?.ranking as Plate[];
  const jude = CORPUS.find((entry) => entry.passage === "Jude")?.ranking as Plate[];

  /* Genesis 6 is the chapter that raised the question and it is also the one
     that sets the bound: its longest unbroken run of two-track publishers is
     three — 40 Minutes / Ask N.T. Wright / The Listener's Commentary — so no
     lift under three can reach past it and BibleProject stays stranded at the
     very head of the register, which is what the reader was looking at. */
  assert.equal(stranded(genesis6, 0), 2,
    "Genesis 6 with no lift should still strand the two plates the reader saw stranded");
  assert.equal(stranded(genesis6, 1), 1, "a bound of one should not be enough for Genesis 6");
  assert.equal(stranded(genesis6, 2), 1, "a bound of two should not be enough for Genesis 6");
  assert.equal(stranded(genesis6, 3), 0, "a bound of three should strand nobody on Genesis 6");
  assert.equal(stranded(jude, 2), 1, "a bound of two should not be enough for Jude");
  assert.equal(stranded(jude, 3), 0, "a bound of three should strand nobody on Jude");

  // And at three, nobody is stranded on any of the seven.
  for (const { passage, ranking } of CORPUS) {
    assert.equal(stranded(ranking, SHELF_LIFT), 0, `${passage}: a plate is stranded mid-shelf at the shipped bound`);
  }

  /* And four buys nothing anywhere, on any of the seven — which is the other
     half of the defence: the bound is as small as it can be and no smaller. */
  for (const { passage, ranking } of CORPUS) {
    assert.deepEqual(
      pack(ranking, 4).map((plate) => plate.id),
      pack(ranking, 3).map((plate) => plate.id),
      `${passage}: a bound of four rearranges the shelf, so three is no longer the smallest bound that works`,
    );
  }
});

test("a shelf of one width is left exactly as the ranking wrote it", () => {
  /* The narrow shell. The compact band gives the margin the whole page, the
     track goes from 163 to 431, and every publisher fits one — measured at a
     900px page on 2026-07-31. Nothing should move: the pass exists to fill
     rows, and every row already fills. */
  const wide = CORPUS[0]?.ranking.map((plate, rank) => ({ ...plate, rank, tracks: 1 as ShelfTracks })) as Plate[];
  assert.deepEqual(pack(wide).map((plate) => plate.rank), wide.map((plate) => plate.rank));

  // And a shelf of nothing but two-track plates is likewise untouched.
  const slabs = wide.map((plate) => ({ ...plate, tracks: 2 as ShelfTracks }));
  assert.deepEqual(pack(slabs).map((plate) => plate.rank), slabs.map((plate) => plate.rank));
});

test("the pass survives the degenerate shelves", () => {
  assert.deepEqual(pack([]), []);
  const one: Plate[] = [{ id: "bibleproject", rank: 0, tracks: 1 }];
  assert.deepEqual(pack(one), one);
  const slab: Plate[] = [{ id: "forty-minutes-ot", rank: 0, tracks: 2 }];
  assert.deepEqual(pack(slab), slab);
});
