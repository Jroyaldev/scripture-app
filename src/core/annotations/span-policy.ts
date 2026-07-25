/**
 * Source-derived span extension.
 *
 * The reported defect: a connection widens (`Holy Spirit` paints as
 * `the Holy Spirit`) while a highlight stays precise. `occurrence-alignment.ts`
 * already detects this and calls it `widened`, and deliberately admits it.
 *
 * It cannot be fixed by better alignment. In `ACT.2.4` the BSB fragments are
 * `with[2] the[5] Holy[5] Spirit[4]` — the article shares position 5 with
 * `Holy`, so `Holy Spirit` and `the Holy Spirit` carry the *same* occurrence
 * set `{4,5}`. The information separating them is destroyed at the position
 * layer. It survives in exactly one place: the shape of what the user selected.
 *
 * So this module keeps the *shape* rather than the text. `SelectionShape` is
 * translation-free — counts and a closed vocabulary of word classes — so it can
 * ride on a durable anchor without becoming package render evidence (INV-5) and
 * without going stale when package text is repaired.
 *
 * The rule, in one line: **widening is an edge phenomenon.** A function word
 * between two selected content words already sits inside the projected hull and
 * cannot broaden it, so it is kept; a function word outside the hull is added
 * only if the user's own selection reached that far.
 */
import type { BackboneTokenOccurrenceV1 } from "./backbone-token-anchor.js";
import type { OccurrenceAlignmentFragmentV1 } from "./occurrence-alignment.js";

/** Closed-class inventory. Kept verbatim in step with the alignment harness so
 * "content" and "function" mean the same thing here as in its measurements. */
const FUNCTION_WORDS = new Set(
  `a an the this that these those
   i me my mine myself we us our ours ourselves you your yours yourself yourselves
   thou thee thy thine ye
   he him his himself she her hers herself it its itself they them their theirs themselves
   who whom whose which what whatever whoever whomever whichever
   am is are was were be been being becomest art wast
   have has had having hath hast do does did doing doth dost
   shall should will would may might must can could cant couldnt
   and or but nor yet so for because although though unless if then than as while whereas
   of in on at by to from with without within into onto upon over under above below
   before after between among against about through throughout during until toward towards
   across behind beneath beside besides beyond down up off out near per since till unto
   not no none nothing never neither either both all any some each every many much more most
   few less least such same other others another own very too also only just even still
   there here where when why how whither whence wherefore therefore thus hence
   o oh lo behold yea nay s t d ll re ve m`
    .split(/\s+/)
    .filter(Boolean),
);

/** Sub-classes exist because "the article attached to the head noun" is not
 * expressible without knowing which words are articles. Static table, not a tagger. */
const SUBCLASS_GROUPS: ReadonlyArray<readonly [SelectionFunctionSubclass, string]> = [
  ["article", "a an the"],
  ["determiner", "this that these those"],
  ["pronoun", `i me my mine myself we us our ours ourselves you your yours yourself yourselves
    thou thee thy thine ye he him his himself she her hers herself it its itself
    they them their theirs themselves who whom whose which what whatever whoever whomever whichever`],
  ["auxiliary", `am is are was were be been being becomest art wast have has had having hath hast
    do does did doing doth dost shall should will would may might must can could cant couldnt`],
  ["conjunction", "and or but nor yet so for because although though unless if then than as while whereas"],
  ["preposition", `of in on at by to from with without within into onto upon over under above below
    before after between among against about through throughout during until toward towards
    across behind beneath beside besides beyond down up off out near per since till unto`],
  ["negation", "not no none nothing never neither"],
  ["quantifier", "either both all any some each every many much more most few less least such same other others another own"],
  ["degree", "very too also only just even still"],
  ["proadverb", "there here where when why how whither whence wherefore therefore thus hence"],
  ["interjection", "o oh lo behold yea nay"],
  ["clitic", "s t d ll re ve m"],
];

export type SelectionFunctionSubclass =
  | "article" | "determiner" | "pronoun" | "auxiliary" | "conjunction" | "preposition"
  | "negation" | "quantifier" | "degree" | "proadverb" | "interjection" | "clitic";

const SUBCLASS = ((): ReadonlyMap<string, SelectionFunctionSubclass> => {
  const map = new Map<string, SelectionFunctionSubclass>();
  for (const [name, words] of SUBCLASS_GROUPS) {
    for (const word of words.split(/\s+/).filter(Boolean)) if (!map.has(word)) map.set(word, name);
  }
  return map;
})();

/** Normalize a display word the same way the alignment harness does. */
export function normalizeWord(raw: string): string {
  return raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^a-z]/g, "");
}

export function isFunctionWord(raw: string): boolean {
  return FUNCTION_WORDS.has(normalizeWord(raw));
}

export function functionSubclass(raw: string): SelectionFunctionSubclass | undefined {
  return SUBCLASS.get(normalizeWord(raw));
}

/**
 * Translation-free description of what the user selected. Durable: no package
 * text, no character offsets, nothing that a text repair can invalidate.
 */
export type VerseSelectionShapeV1 = {
  /** Occurrence positions contributed by CONTENT words. The unconditional core. */
  readonly content_positions: readonly number[];
  /** Positions contributed by function words that own an original-language token. */
  readonly own_positions: readonly number[];
  /** Sub-classes of those own-token function words, for like-for-like matching. */
  readonly own_subclasses: readonly SelectionFunctionSubclass[];
  /** Fused function words the selection included before its first content word. */
  readonly lead_function_words: number;
  /** ...and after its last. */
  readonly trail_function_words: number;
};

type SourceWord = { readonly raw: string; readonly positions: readonly number[] };

/**
 * Derive the shape from the source words the user actually selected.
 * `words` must be the selected display words in document order.
 */
export function deriveSelectionShape(words: readonly SourceWord[]): VerseSelectionShapeV1 {
  const contentIdx: number[] = [];
  const contentPositions = new Set<number>();
  for (let i = 0; i < words.length; i++) {
    if (!isFunctionWord(words[i]!.raw)) {
      contentIdx.push(i);
      for (const p of words[i]!.positions) contentPositions.add(p);
    }
  }
  const ownPositions = new Set<number>();
  const ownSubclasses = new Set<SelectionFunctionSubclass>();
  // A selected function word is "fused" when it contributes no position of its
  // own — every position it carries is already carried by a selected content
  // word, or it carries none at all (no original-language counterpart).
  const fused = (w: SourceWord): boolean =>
    w.positions.length === 0 || w.positions.every((p) => contentPositions.has(p));
  for (const w of words) {
    if (!isFunctionWord(w.raw) || fused(w)) continue;
    for (const p of w.positions) if (!contentPositions.has(p)) ownPositions.add(p);
    const sub = functionSubclass(w.raw);
    if (sub) ownSubclasses.add(sub);
  }
  const first = contentIdx.length ? contentIdx[0]! : words.length;
  const last = contentIdx.length ? contentIdx[contentIdx.length - 1]! : -1;
  const countFused = (from: number, to: number): number => {
    let n = 0;
    for (let i = from; i < to; i++) {
      const w = words[i]!;
      if (isFunctionWord(w.raw) && fused(w)) n += 1;
    }
    return n;
  };
  return {
    content_positions: [...contentPositions].sort((a, b) => a - b),
    own_positions: [...ownPositions].sort((a, b) => a - b),
    own_subclasses: [...ownSubclasses].sort(),
    lead_function_words: countFused(0, first),
    trail_function_words: last < 0 ? 0 : countFused(last + 1, words.length),
  };
}

/** One candidate target display word, in document order. */
export type TargetWord = {
  readonly index: number;
  readonly raw: string;
  readonly positions: readonly number[];
};

/**
 * Apply the policy. Returns the indices of the target words to paint, or
 * `null` to abstain — the honest null for "the counterpart does not exist".
 */
export function applySpanPolicy(
  shape: VerseSelectionShapeV1,
  target: readonly TargetWord[],
): readonly number[] | null {
  const contentPositions = new Set(shape.content_positions);
  const ownPositions = new Set(shape.own_positions);
  const all = new Set<number>([...contentPositions, ...ownPositions]);
  const touches = (w: TargetWord): boolean => w.positions.some((p) => all.has(p));

  // (1) A function-word-only selection stays in the function class, preferring
  // the same sub-class. If the target renders no function word for those
  // positions the counterpart genuinely does not exist, so abstain.
  if (contentPositions.size === 0) {
    const candidates = target.filter((w) => isFunctionWord(w.raw) && touches(w));
    if (candidates.length === 0) return null;
    const wanted = new Set(shape.own_subclasses);
    const matched = candidates.filter((w) => {
      const sub = functionSubclass(w.raw);
      return sub !== undefined && wanted.has(sub);
    });
    return (matched.length ? matched : candidates).map((w) => w.index);
  }

  // (2) Content core: unconditional, never trimmed. This is where the accuracy lives.
  const keep = new Set<number>();
  for (const w of target) {
    if (!isFunctionWord(w.raw) && w.positions.some((p) => contentPositions.has(p))) keep.add(w.index);
  }

  // (3) Positions contributed by a function word that owns a token: whatever
  // renders them belongs, restricted to the matching sub-class when the target
  // offers one, so selecting `the` does not also drag in `of`.
  if (ownPositions.size) {
    let hits = target.filter((w) => w.positions.some((p) => ownPositions.has(p)));
    if (shape.own_subclasses.length) {
      const wanted = new Set(shape.own_subclasses);
      const narrowed = hits.filter((w) => {
        if (!isFunctionWord(w.raw)) return true;
        const sub = functionSubclass(w.raw);
        return sub !== undefined && wanted.has(sub);
      });
      if (narrowed.length) hits = narrowed;
    }
    for (const w of hits) keep.add(w.index);
  }

  if (keep.size === 0) return target.filter(touches).map((w) => w.index);

  const lo = Math.min(...keep);
  const hi = Math.max(...keep);

  // (4) Interior is free. A function word between two core words already lies
  // inside the projected hull, so keeping it cannot broaden the span — it can
  // only stop the span fragmenting. Unattached interior words stay out: that is
  // genuine word-order scatter, and claiming it would be a lie.
  for (const w of target) {
    if (w.index <= lo || w.index >= hi || keep.has(w.index)) continue;
    if (isFunctionWord(w.raw) && touches(w)) keep.add(w.index);
  }

  // (5) Edges extend by exactly the user's own budget. This is the whole policy:
  // if the selection did not include the article, the projection does not get one.
  const attached = (w: TargetWord): boolean => w.positions.length === 0 || touches(w);
  let budget = shape.lead_function_words;
  for (let i = lo - 1; i >= 0 && budget > 0; i--) {
    const w = target[i]!;
    if (!isFunctionWord(w.raw) || !attached(w)) break;
    keep.add(w.index); budget -= 1;
  }
  budget = shape.trail_function_words;
  for (let i = hi + 1; i < target.length && budget > 0; i++) {
    const w = target[i]!;
    if (!isFunctionWord(w.raw) || !attached(w)) break;
    keep.add(w.index); budget -= 1;
  }
  return [...keep].sort((a, b) => a - b);
}

/** Display words of an alignment row, in document order. Words carry a group id;
 * whitespace and punctuation gaps do not. */
export function targetWordsFromFragments(
  fragments: readonly OccurrenceAlignmentFragmentV1[],
  text: string,
): readonly (TargetWord & {
  readonly char_start: number;
  readonly char_end: number;
  readonly fragment_index: number;
})[] {
  const out: (TargetWord & { char_start: number; char_end: number; fragment_index: number })[] = [];
  let index = 0;
  for (let fragmentIndex = 0; fragmentIndex < fragments.length; fragmentIndex++) {
    const fragment = fragments[fragmentIndex]!;
    if (fragment.length !== 4) continue;
    out.push({
      index: index++,
      raw: text.slice(fragment[0], fragment[1]),
      positions: fragment[2],
      char_start: fragment[0],
      char_end: fragment[1],
      fragment_index: fragmentIndex,
    });
  }
  return out;
}


// ---------------------------------------------------------------- durable shape
/**
 * The durable, verse-scoped shape carried on an anchor. Occurrences use the same
 * `{verse, position}` vocabulary as `exact.occurrences`, so nothing package-specific
 * and nothing offset-based enters the anchor.
 */
export type SelectionShapeV1 = {
  readonly format_version: 1;
  readonly content_occurrences: readonly BackboneTokenOccurrenceV1[];
  readonly own_occurrences: readonly BackboneTokenOccurrenceV1[];
  readonly own_subclasses: readonly SelectionFunctionSubclass[];
  readonly lead_function_words: number;
  readonly trail_function_words: number;
};

/** Selected source words grouped by verse, each list in document order. */
export type SourceWordsByVerse = ReadonlyArray<{ readonly verse: number; readonly words: readonly SourceWord[] }>;

export function deriveAnchorSelectionShape(byVerse: SourceWordsByVerse): SelectionShapeV1 {
  const ordered = [...byVerse].sort((a, b) => a.verse - b.verse);
  const flat: SourceWord[] = ordered.flatMap((v) => [...v.words]);
  const whole = deriveSelectionShape(flat);
  const content: BackboneTokenOccurrenceV1[] = [];
  const own: BackboneTokenOccurrenceV1[] = [];
  for (const { verse, words } of ordered) {
    const perVerse = deriveSelectionShape([...words]);
    // Re-scope against the whole selection so a content word in verse 1 still
    // licenses a function word in verse 2 (INV: the selection is one act).
    for (const position of perVerse.content_positions) content.push({ verse, position });
    for (const position of perVerse.own_positions) {
      if (whole.own_positions.includes(position)) own.push({ verse, position });
    }
  }
  return {
    format_version: 1,
    content_occurrences: content,
    own_occurrences: own,
    own_subclasses: whole.own_subclasses,
    lead_function_words: whole.lead_function_words,
    trail_function_words: whole.trail_function_words,
  };
}

/**
 * Project the durable shape onto one verse. The lead budget belongs to the first
 * verse of the selection and the trail budget to the last; an interior verse gets
 * neither, because the user's selection did not stop there.
 */
export function verseShapeFor(
  shape: SelectionShapeV1,
  verse: number,
  options: { readonly isFirstVerse: boolean; readonly isLastVerse: boolean },
): VerseSelectionShapeV1 {
  return {
    content_positions: shape.content_occurrences.filter((o) => o.verse === verse).map((o) => o.position),
    own_positions: shape.own_occurrences.filter((o) => o.verse === verse).map((o) => o.position),
    own_subclasses: shape.own_subclasses,
    lead_function_words: options.isFirstVerse ? shape.lead_function_words : 0,
    trail_function_words: options.isLastVerse ? shape.trail_function_words : 0,
  };
}
