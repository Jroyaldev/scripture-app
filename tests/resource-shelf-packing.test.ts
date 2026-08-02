import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const root = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(root, path), "utf8");

/**
 * THE PUBLISHER SHELF'S LINE-BREAKER, RETIRED · 2026-07-31.
 *
 * This file held a corpus of seven real chapters against `packShelf`, the
 * bounded line-breaking pass that ordered the two-track register. Both are
 * gone, and this file is kept rather than deleted because a mechanism removed
 * without its own words on the page is one nobody can argue with later.
 *
 * ── WHAT IT CLAIMED, quoted from its own head and from the rule it guarded ──
 *
 *   "The rule, and the defence of its bound, are written out at `packShelf` in
 *    src/renderer/components/Resources.tsx. This file is the corpus that
 *    defence cites — seven real chapters, measured in the running engine on
 *    2026-07-31 at the study column's own 332px, where a track is 163 — held
 *    against the rule so that neither can drift from the other. … A packing
 *    that looks tidy on Genesis 6 can strand three plates on a chapter with a
 *    different mix, which is exactly why the bound is defended on a corpus
 *    rather than on the chapter that raised the question."
 *
 *   "A row is two tracks. 1. A TWO-TRACK PLATE TAKES A ROW OF ITS OWN. 2. A
 *    ONE-TRACK PLATE WANTS A PARTNER … provided it is no more than three
 *    places further down the ranking. 3. IF THERE IS NONE WITHIN THREE, THE
 *    PLATE KEEPS ITS SINGLE TRACK and the row keeps its gap."
 *
 *   "The two-track publishers are the five whose identity is a NAME long
 *    enough to overrun a track; the one-track ones are the six carrying
 *    artwork plus Radically Christian, whose name is short enough to fit."
 *
 * ── WHY IT IS RETIRED ───────────────────────────────────────────────────────
 *
 * That last sentence is the whole answer. Every plate's width was decided by
 * whether it carried a NAME and by how long that name was, and the reader's
 * instruction of 2026-07-31 was to stop drawing names: "what if shelf we did
 * just logos … not fighting against different word sizes". A shelf of logos
 * has no widths to interleave, so it is a grid of equal cells, so there is no
 * line-breaking left to do and no bound to defend. The register is now exactly
 * the ranking, in order, with no plate ever moved — which is strictly better
 * than the three places of rank the pass had to spend to approximate it.
 *
 * What this file asserts now is that the retirement is REAL rather than
 * abandoned in place: the pass is gone from the component, the two attributes
 * it drove are gone from the markup, and the geometry that replaced it is the
 * one thing that makes all of the above true.
 */

test("the two-track register and its packing pass are retired, not disabled", () => {
  const room = read("src/renderer/components/Resources.tsx");
  const styles = read("src/renderer/styles.css");

  /* The pass and its plumbing, gone as CODE. The retirement note that quotes
     them stays in the file, which is why each of these is checked as a
     declaration rather than as a string anywhere. */
  for (const gone of [
    /export function packShelf/,
    /export const SHELF_LIFT/,
    /function measureShelfTracks/,
    /useLayoutEffect\(/,
    /new ResizeObserver\(/,
  ]) {
    assert.doesNotMatch(room, gone, `the packing pass is back: ${gone}`);
  }

  /* And the two attributes it drove. `data-tracks` was how a plate declared the
     width it had earned; `data-sizing` was the measuring beat. Neither has
     anything to say about a grid of equal cells. */
  assert.doesNotMatch(room, /"data-tracks"|data-sizing/,
    "the register is measuring plate widths again");
  assert.doesNotMatch(styles, /\.trusted-resource-imprint\[data-tracks|\.resource-shelf\[data-sizing/,
    "the stylesheet still has a track floor to drop for a measuring beat");

  /* THE GEOMETRY THAT REPLACED IT, and it is the whole reason none of the
     above is needed: equal cells, one row height, and no floor a plate's own
     content could raise. */
  const shelf = styles.slice(
    styles.indexOf("\n.resource-shelf {"),
    styles.indexOf("\n.resource-shelf .trusted-resource-imprint {"),
  );
  /* RESTATED 2026-08-02 — square cells at 72, where they were 92×56.
     What this gate holds is EQUAL CELLS with a height no plate's own content
     can raise, which is what made the measuring packer unnecessary. A square
     holds it more tightly than the old pair did: the height is the cell's own
     width, so there is not even a row value left for a plate to argue with.
     The shape changed with the cover face and then with the maintainer's word
     that the marks should match it. */
  assert.match(shelf, /grid-template-columns: repeat\(auto-fill, minmax\(72px, 1fr\)\)/,
    "the rack lost its equal cells; without them the widths come back and so does the packer");
  assert.match(
    styles.slice(styles.indexOf("\n.resource-shelf .trusted-resource-imprint {")),
    /aspect-ratio: 1;/,
    "the rack lost its one cell shape");
  /* The row value survives for exactly one consumer — the forced-colors block,
     where the plate becomes text and needs a floor rather than a ratio. */
  assert.match(shelf, /--shelf-row: 56px/, "the forced-palette floor is gone");
  assert.doesNotMatch(shelf, /min-width: calc\(50%/,
    "the two-track floor is back; that is the register this shelf replaced");

  /* THE REGISTER IS THE RANKING. `data-rank` survives — it is what lets
     qa:player hold this claim against the engine — and the component must hand
     the shelf straight to the grid rather than through any ordering of its
     own. */
  assert.match(room, /\{shelf\.map\(\(chip, rank\) => \(/,
    "something is standing between the ranking and the rack again");
  assert.match(room, /data-rank=\{rank\}/,
    "the plate no longer carries its rank; the ordering claim becomes unfalsifiable");
});
