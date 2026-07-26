/**
 * Two UBS corpora that land on opposite sides of this app's centre of gravity:
 * a scholarly parallel-passage database (which touches the thing the app IS),
 * and a set of journey polylines (which touches the map).
 *
 * ─── Why the parallel-passage half needs a guard, measured on this machine ────
 *
 * `ParallelPassages.xml` numbers its Old Testament references in HEBREW (BHS)
 * versification. Our backbone is English-Protestant. Those two systems disagree
 * in 137 OT chapters — a figure this repo already carries as an open defect —
 * and the disagreement is not theoretical:
 *
 *   2,788 HEB member references. 337 of them (12.1%) land in a chapter whose
 *   WLC verse count differs from our backbone's. Of those, exactly 14 fail
 *   LOUDLY by running off the end of the English chapter; the other 323 are
 *   in-range integers that point at the WRONG VERSE.
 *
 * The 14 loud ones are a textbook list of the divergence points, which is how we
 * know the cause is versification and not corruption:
 *
 *   `2SA 22:51 ↔ PSA 18:51`   Hebrew Ps 18:51 = English Ps 18:50
 *   `PSA 14:7  ↔ PSA 53:7`    the twin psalm, Hebrew 53:7 = English 53:6
 *   `ISA 8:23  ↔ MAT 4:15`    Hebrew Isa 8:23 = English Isa 9:1
 *   `HOS 2:25  ↔ ROM 9:25`    Hebrew Hos 2:25 = English Hos 2:23
 *   `1KI 15:8  ↔ 2CH 13:23`   Hebrew 2 Chr 13:23 = English 2 Chr 14:1
 *
 * A silent off-by-one here is worse than a crash. This app draws connections
 * between passages; a connection anchored one verse away from the parallel it
 * claims is a false scholarly assertion rendered in the reader's own margin, and
 * nothing on the surface would reveal it.
 *
 * ─── What this module therefore refuses to do ────────────────────────────────
 *
 * `UbsMemberReference` is a discriminated union, not a struct with a warning
 * flag. A member reference is either `kind: "canonical"` — the chapter's verse
 * count agrees between the Hebrew source system and our backbone, so the integer
 * means what it says — or it is `kind: "divergent"` / `kind: "unparsable"`, and
 * then it carries no canonical coordinates at all. `canonicalVerseKeys` is the
 * only way to obtain verse keys and it THROWS `UbsVersificationError` on a
 * divergent reference. There is no coercion path and no default. A caller that
 * wants to seed a connection from this corpus has to handle the 337, and for
 * `PSA 18:51` it will throw rather than quietly point at Psalm 18:50.
 *
 * Greek members are exempt from the guard by construction, not by assumption:
 * UBSGNT5 and our NT backbone agree, and `sourceText` is what selects which
 * verse-count table a member is checked against.
 *
 * ─── Why the routes half carries no place identifiers ────────────────────────
 *
 * Also measured: across all 179 GeoJSON route files, 508 LineString features and
 * 23,951 coordinate pairs, the total number of place identifiers is ZERO. The
 * only `properties` key present anywhere is `name`, on 3 features, and its value
 * is the Adobe Illustrator layer label `"Overlay (Copy)"`. So there is nothing
 * to join to our OpenBible or Pleiades gazetteers — no TIPNR id, no Pleiades id,
 * no place name, not even a scripture reference. `UbsRoute.placeIdentifierCount`
 * exists to keep that measurable rather than remembered, and the importer
 * asserts it is zero so that a future upstream release which DOES add ids fails
 * the build loudly instead of being silently ignored.
 *
 * Pure TypeScript (INV-18): no I/O, no Node imports, no host globals. Node-side
 * acquisition lives in `scripts/import-ubs-routes-parallels.ts`.
 */

// ────────────────────────────────────────────────────────────────────────────
// Attribution — quoted verbatim from the source repository
// ────────────────────────────────────────────────────────────────────────────

/**
 * The parallel-passage credit line, copied character for character from
 * `parallel passages/README.md` (and repeated identically in the repository
 * root `README.md`). The parentheses and the trailing full stop are the
 * source's, not ours; do not tidy them.
 */
export const UBS_PARALLEL_PASSAGES_ATTRIBUTION =
  "(UBS Parallel Passage Database, © 2023 United Bible Societies.)";

/**
 * The routes credit line, verbatim from `ubs-bible-routes/README.md`. It is
 * terse to the point of looking like a placeholder; it is not, it is the whole
 * of what that README asserts as the copyright line.
 */
export const UBS_BIBLE_ROUTES_ATTRIBUTION = "(© United Bible Societies 2023)";

/**
 * The routes carry a second credit that the licence text does not cover and
 * that a bare copyright line would drop: the cartographer. Verbatim from
 * `ubs-bible-routes/README.md`, final sentence.
 *
 * This is a naming obligation, not a licence term, which is exactly why it is
 * easy to lose. It is kept beside the copyright line so a render site that
 * shows one has the other in reach.
 */
export const UBS_BIBLE_ROUTES_CREATOR_CREDIT =
  "These routes are part of a collection of data created for UBS by Dr. Leen Ritmeyer.";

/**
 * The licence, verbatim from the shield sentence at the top of every one of the
 * three README files (repository root, `parallel passages/`, `ubs-bible-routes/`).
 */
export const UBS_LICENSE_SENTENCE =
  "This work is licensed under a\n[Creative Commons Attribution-ShareAlike 4.0 International License][cc-by-sa].";

/** SPDX-ish short form for both corpora. */
export const UBS_LICENSE = "CC BY-SA 4.0";

/** The canonical licence URL as the source writes it (http, not https). */
export const UBS_LICENSE_URL = "http://creativecommons.org/licenses/by-sa/4.0/";

/** Upstream repository both corpora come from. */
export const UBS_SOURCE_URL = "https://github.com/ubsicap/ubs-open-license";

// ────────────────────────────────────────────────────────────────────────────
// Parallel passages — word-level alignment digits
// ────────────────────────────────────────────────────────────────────────────

/**
 * Which base text a member's word numbering counts against. This is not
 * decoration: it selects the verse-count table the reference is validated
 * against, and therefore whether the versification guard applies.
 *
 * - `HEB` — words of the Hebrew text (BHS), and BHS verse numbering with it.
 * - `GRK` — words of UBSGNT5. Where a group mixes both, the README is explicit
 *   that a Greek member quoting the OT numbers the LXX words, not the Hebrew.
 */
export type UbsSourceText = "HEB" | "GRK";

/** How closely one word matches its counterpart in the parallel passage(s). */
export type UbsWordMatch = "none" | "partial" | "full";

/**
 * One word of one member, as the source's digit string describes it.
 *
 * `lineBreaksBefore` is presentation only. The README says so in as many words —
 * "This is purely for presentation purposes and is not in any intentional way
 * based on the published source texts" — so it must never be mistaken for
 * poetic structure the app can render as verse lines.
 */
export type UbsWordSlot = {
  readonly match: UbsWordMatch;
  readonly lineBreaksBefore: 0 | 1 | 2;
};

/**
 * Decode one digit of a `HEB=`/`GRK=` string.
 *
 * The README documents three bands of three: 0–2 are no/partial/full match, 3–5
 * "are equivalent to 0-3 but suggest the insertion of a new line", and 6–8 the
 * same with two new lines. The "0-3" in that sentence is a typo for 0–2; the
 * bands are plainly three wide, and the data agrees.
 *
 * Measured on the shipped file: digits 0–5 occur (0: 27,966, 1: 13,178,
 * 2: 45,842, 3: 1,758, 4: 1,070, 5: 3,605) and digits 6–8 NEVER occur. The
 * two-line band is documented but unused. It is decoded anyway, because a
 * decoder that only handles the digits present in today's snapshot is a decoder
 * that breaks on the next one.
 */
export function decodeWordSlot(digit: string): UbsWordSlot | null {
  if (digit.length !== 1) return null;
  const value = Number(digit);
  if (!Number.isInteger(value) || value < 0 || value > 8) return null;
  const band = Math.floor(value / 3);
  const within = value % 3;
  const match: UbsWordMatch = within === 2 ? "full" : within === 1 ? "partial" : "none";
  return { match, lineBreaksBefore: band as 0 | 1 | 2 };
}

/** Decode a whole digit string. Returns null if any digit is undecodable. */
export function decodeWordSlots(digits: string): readonly UbsWordSlot[] | null {
  const slots: UbsWordSlot[] = [];
  for (const digit of digits) {
    const slot = decodeWordSlot(digit);
    if (!slot) return null;
    slots.push(slot);
  }
  return slots;
}

// ────────────────────────────────────────────────────────────────────────────
// Parallel passages — references, and the versification guard
// ────────────────────────────────────────────────────────────────────────────

/** Thrown when a caller asks a non-canonical reference for canonical coordinates. */
export class UbsVersificationError extends Error {
  constructor(
    readonly raw: string,
    readonly reason: string,
  ) {
    super(`UBS reference ${raw} has no canonical coordinates: ${reason}`);
    this.name = "UbsVersificationError";
  }
}

/**
 * Why a reference could not be trusted as canonical.
 *
 * - `chapter-verse-count-differs` — the source's verse-count for this chapter
 *   and our backbone's disagree, so every verse number in the chapter is
 *   suspect even when it is in range. This is the silent-error case and the
 *   reason this union exists.
 * - `out-of-backbone-range` — the verse number exceeds our chapter length. The
 *   loud case; 14 of these in the shipped snapshot.
 * - `source-verse-count-unknown` — we have no verse count for this chapter in
 *   the member's own numbering system, so we cannot show the two systems agree.
 *   Distinct from `chapter-verse-count-differs` on purpose: one is a measured
 *   disagreement, the other is an absence of measurement, and collapsing them
 *   would let a missing table read as a clean bill of health.
 * - `unknown-book` — book code is not one of the 66.
 */
export type UbsDivergenceReason =
  | "chapter-verse-count-differs"
  | "out-of-backbone-range"
  | "source-verse-count-unknown"
  | "unknown-book";

/**
 * A member's reference, in one of three mutually exclusive states.
 *
 * Only `canonical` carries `verses`. That is the whole design: there is no
 * shape in which a divergent reference also offers coordinates, so no call site
 * can read them "just this once".
 */
export type UbsMemberReference =
  | {
      readonly kind: "canonical";
      readonly raw: string;
      readonly book: string;
      readonly chapter: number;
      /** Ascending, de-duplicated, expanded from ranges and comma lists. */
      readonly verses: readonly number[];
    }
  | {
      readonly kind: "divergent";
      readonly raw: string;
      readonly book: string;
      readonly chapter: number;
      readonly reason: UbsDivergenceReason;
      /** Verse count our backbone gives this chapter, or null if unknown. */
      readonly backboneVerseCount: number | null;
      /** Verse count the source's own system gives it, or null if unknown. */
      readonly sourceVerseCount: number | null;
    }
  | {
      readonly kind: "unparsable";
      readonly raw: string;
      readonly reason: string;
    };

/**
 * Verse-count tables the parser checks references against.
 *
 * Two separate lookups on purpose. `backboneVerseCount` is our coordinate
 * system. `sourceVerseCount` is the corpus's own — WLC for Hebrew members. A
 * chapter is only safe when both answer and both agree; if `sourceVerseCount`
 * returns null we do not know, and not knowing is not the same as agreeing, so
 * such a chapter is treated as divergent rather than waved through.
 *
 * That asymmetry is deliberate. The alternative — assume agreement when the
 * Hebrew table is silent — is precisely the check that passes by finding
 * nothing.
 */
export type UbsVersificationTables = {
  backboneVerseCount(book: string, chapter: number): number | null;
  /** Verse count in the member's own source system, or null if not known. */
  sourceVerseCount(sourceText: UbsSourceText, book: string, chapter: number): number | null;
};

/** `BOOK C:V`, `BOOK C:V-V`, `BOOK C:V,V`, `BOOK C:V-V,V`. */
const REFERENCE_PATTERN = /^([1-3A-Z][A-Z]{2})\s+(\d+):(\d[\d\-,\s]*)$/;

/**
 * Parse one `<Verse>` reference against the verse-count tables.
 *
 * Measured shapes in the shipped snapshot: 5,256 plain `BOOK C:V`, plus
 * `BOOK C:V-V` ranges, plus 10 comma forms (`MRK 9:43,45`-style). No reference
 * spans a chapter boundary, which is why `chapter` is a single number here — if
 * a future snapshot introduces `BOOK C:V-C:V` it will land in `unparsable`
 * rather than being silently truncated to the first chapter.
 */
export function parseUbsReference(
  raw: string,
  sourceText: UbsSourceText,
  tables: UbsVersificationTables,
): UbsMemberReference {
  const text = raw.trim();
  const match = REFERENCE_PATTERN.exec(text);
  if (!match) {
    return { kind: "unparsable", raw: text, reason: "not `BOOK C:V[-V][,V]`" };
  }
  const book = match[1]!;
  const chapter = Number(match[2]!);
  const verses: number[] = [];
  for (const part of match[3]!.split(",")) {
    const bounds = /^\s*(\d+)(?:-(\d+))?\s*$/.exec(part);
    if (!bounds) {
      return { kind: "unparsable", raw: text, reason: `bad verse term "${part.trim()}"` };
    }
    const from = Number(bounds[1]!);
    const to = bounds[2] ? Number(bounds[2]) : from;
    if (from < 1 || to < from) {
      return { kind: "unparsable", raw: text, reason: `reversed or zero range "${part.trim()}"` };
    }
    for (let verse = from; verse <= to; verse++) verses.push(verse);
  }
  const unique = [...new Set(verses)].sort((a, b) => a - b);

  const backboneVerseCount = tables.backboneVerseCount(book, chapter);
  if (backboneVerseCount === null) {
    return {
      kind: "divergent",
      raw: text,
      book,
      chapter,
      reason: "unknown-book",
      backboneVerseCount: null,
      sourceVerseCount: tables.sourceVerseCount(sourceText, book, chapter),
    };
  }
  const sourceVerseCount = tables.sourceVerseCount(sourceText, book, chapter);
  const last = unique[unique.length - 1]!;
  if (last > backboneVerseCount) {
    return {
      kind: "divergent",
      raw: text,
      book,
      chapter,
      reason: "out-of-backbone-range",
      backboneVerseCount,
      sourceVerseCount,
    };
  }
  if (sourceVerseCount === null) {
    // Not knowing is not the same as agreeing. Falling through to `canonical`
    // here would mean a missing or unloaded verse-count table silently blessed
    // every reference it could not check.
    return {
      kind: "divergent",
      raw: text,
      book,
      chapter,
      reason: "source-verse-count-unknown",
      backboneVerseCount,
      sourceVerseCount: null,
    };
  }
  if (sourceVerseCount !== backboneVerseCount) {
    return {
      kind: "divergent",
      raw: text,
      book,
      chapter,
      reason: "chapter-verse-count-differs",
      backboneVerseCount,
      sourceVerseCount,
    };
  }
  return { kind: "canonical", raw: text, book, chapter, verses: unique };
}

/**
 * The only way to get verse keys out of a reference. Throws on anything that is
 * not canonical.
 *
 * A render site that wants to place a UBS parallel on the page must call this,
 * and for the 337 exposed Hebrew references it will throw instead of returning
 * a coordinate that looks fine and is wrong.
 */
export function canonicalVerseKeys(reference: UbsMemberReference): readonly string[] {
  if (reference.kind !== "canonical") {
    const reason = reference.kind === "unparsable" ? reference.reason : reference.reason;
    throw new UbsVersificationError(reference.raw, reason);
  }
  return reference.verses.map((verse) => `${reference.book}.${reference.chapter}.${verse}`);
}

/** Non-throwing companion for callers that legitimately want to skip the unsafe ones. */
export function canonicalVerseKeysOrNull(reference: UbsMemberReference): readonly string[] | null {
  return reference.kind === "canonical" ? canonicalVerseKeys(reference) : null;
}

// ────────────────────────────────────────────────────────────────────────────
// Parallel passages — groups
// ────────────────────────────────────────────────────────────────────────────

/** One `<Verse>`: a reference, its base text, and its word-alignment digits. */
export type UbsParallelMember = {
  readonly sourceText: UbsSourceText;
  readonly digits: string;
  readonly slots: readonly UbsWordSlot[];
  readonly reference: UbsMemberReference;
};

/**
 * One `<Passage>`: a set of members the UBS editors judged parallel.
 *
 * A GROUP, not a pair. 1,699 of the 2,193 groups hold exactly two members, but
 * 494 hold three or more and one holds 39. That shape matters downstream: the
 * README says a word counts as a full match if it matches "at least one of the
 * other passages", so a member's digits describe its relation to the group, not
 * to any one sibling. Splitting a group into pairs therefore loses information,
 * and this type keeps the group whole so that the decision to pair is taken
 * explicitly by `parallelGroupPairs`.
 */
export type UbsParallelGroup = {
  /** Zero-based position in the file, so a reader can find the record again. */
  readonly index: number;
  readonly members: readonly UbsParallelMember[];
};

/** Everything the parse learned, including what it could not use. */
export type UbsParallelParseResult = {
  readonly groups: readonly UbsParallelGroup[];
  readonly memberCount: number;
  /** Members whose reference is `canonical`. */
  readonly canonicalMemberCount: number;
  /** Members whose reference is `divergent`, by reason. */
  readonly divergentByReason: Readonly<Record<UbsDivergenceReason, number>>;
  readonly unparsableCount: number;
  /** Members whose digit string held an undecodable character. */
  readonly undecodableDigitCount: number;
  /** Raw references that are not canonical, in file order, for the doctor report. */
  readonly rejectedReferences: readonly { raw: string; kind: string; reason: string }[];
};

const PASSAGE_PATTERN = /<Passage>([\s\S]*?)<\/Passage>/g;
const VERSE_PATTERN = /<Verse\s+(HEB|GRK)="([0-9]*)"\s*>([^<]*)<\/Verse>/g;

/**
 * Parse `ParallelPassages.xml`.
 *
 * Deliberately a regex scan rather than a DOM parse: the file is a flat
 * two-level structure with no mixed content, no namespaces and no attributes
 * beyond the two, and the core layer may not take an XML dependency (INV-18).
 * The element and attribute inventory was measured before this was written —
 * 1 `<Passages>`, 2,193 `<Passage>`, 5,266 `<Verse>`, and no attributes other
 * than `HEB`, `GRK` and the XML declaration's own — so there is no third
 * element for a scan to miss. `parsedMemberCount` against the file's `<Verse>`
 * count is asserted by the importer to keep that true.
 */
export function parseParallelPassages(
  xml: string,
  tables: UbsVersificationTables,
): UbsParallelParseResult {
  const body = xml.replace(/^﻿/, "");
  const groups: UbsParallelGroup[] = [];
  const rejectedReferences: { raw: string; kind: string; reason: string }[] = [];
  const divergentByReason: Record<UbsDivergenceReason, number> = {
    "chapter-verse-count-differs": 0,
    "out-of-backbone-range": 0,
    "source-verse-count-unknown": 0,
    "unknown-book": 0,
  };
  let memberCount = 0;
  let canonicalMemberCount = 0;
  let unparsableCount = 0;
  let undecodableDigitCount = 0;

  PASSAGE_PATTERN.lastIndex = 0;
  let passage: RegExpExecArray | null;
  let index = 0;
  while ((passage = PASSAGE_PATTERN.exec(body)) !== null) {
    const members: UbsParallelMember[] = [];
    VERSE_PATTERN.lastIndex = 0;
    let verse: RegExpExecArray | null;
    while ((verse = VERSE_PATTERN.exec(passage[1]!)) !== null) {
      memberCount++;
      const sourceText = verse[1] as UbsSourceText;
      const digits = verse[2]!;
      const raw = verse[3]!.trim();
      const slots = decodeWordSlots(digits);
      if (slots === null) undecodableDigitCount++;
      const reference = parseUbsReference(raw, sourceText, tables);
      if (reference.kind === "canonical") {
        canonicalMemberCount++;
      } else if (reference.kind === "divergent") {
        divergentByReason[reference.reason]++;
        rejectedReferences.push({ raw, kind: "divergent", reason: reference.reason });
      } else {
        unparsableCount++;
        rejectedReferences.push({ raw, kind: "unparsable", reason: reference.reason });
      }
      members.push({ sourceText, digits, slots: slots ?? [], reference });
    }
    groups.push({ index, members });
    index++;
  }

  return {
    groups,
    memberCount,
    canonicalMemberCount,
    divergentByReason,
    unparsableCount,
    undecodableDigitCount,
    rejectedReferences,
  };
}

/**
 * Unordered member pairs within one group, as `[i, j]` index pairs with i < j.
 *
 * Pairing is a lossy read of a group (see `UbsParallelGroup`), so it is a
 * separate call a caller has to make rather than the shape the parse returns.
 */
export function parallelGroupPairs(group: UbsParallelGroup): readonly (readonly [number, number])[] {
  const pairs: (readonly [number, number])[] = [];
  for (let i = 0; i < group.members.length; i++) {
    for (let j = i + 1; j < group.members.length; j++) pairs.push([i, j]);
  }
  return pairs;
}

/**
 * A stable, order-independent key for an unordered pair of verse keys.
 * Used to compare this corpus against another edge set without letting
 * direction create phantom differences.
 */
export function unorderedPairKey(a: string, b: string): string {
  return a <= b ? `${a}|${b}` : `${b}|${a}`;
}

/** Count word slots by match class across a whole parse. */
export function summarizeWordSlots(
  groups: readonly UbsParallelGroup[],
): { total: number; full: number; partial: number; none: number; withLineBreak: number } {
  let total = 0;
  let full = 0;
  let partial = 0;
  let none = 0;
  let withLineBreak = 0;
  for (const group of groups) {
    for (const member of group.members) {
      for (const slot of member.slots) {
        total++;
        if (slot.match === "full") full++;
        else if (slot.match === "partial") partial++;
        else none++;
        if (slot.lineBreaksBefore > 0) withLineBreak++;
      }
    }
  }
  return { total, full, partial, none, withLineBreak };
}

// ────────────────────────────────────────────────────────────────────────────
// Routes — GeoJSON
// ────────────────────────────────────────────────────────────────────────────

/** `[longitude, latitude]`, RFC 7946 axis order. */
export type UbsLonLat = readonly [longitude: number, latitude: number];

/** One LineString out of a route file. */
export type UbsRouteFeature = {
  readonly coordinates: readonly UbsLonLat[];
  /**
   * Every `properties` key this feature carried. Measured across the corpus:
   * only `name`, only 3 times, always the Illustrator label `"Overlay (Copy)"`.
   * Kept so `placeIdentifierCount` can be computed rather than asserted.
   */
  readonly propertyKeys: readonly string[];
};

export type UbsBoundingBox = {
  readonly minLon: number;
  readonly minLat: number;
  readonly maxLon: number;
  readonly maxLat: number;
};

export type UbsRoute = {
  /** Source file stem, e.g. `015. GEN 16 Hagar`. */
  readonly fileName: string;
  /** Leading sequence number, e.g. `15`, or null when the stem has none. */
  readonly routeNumber: number | null;
  /** Disambiguating letter on the number, e.g. `a` in `107a`. */
  readonly routeSuffix: string | null;
  /** Stem with the number stripped, e.g. `GEN 16 Hagar`. Empty when absent. */
  readonly title: string;
  readonly topLevelType: "Feature" | "FeatureCollection";
  readonly features: readonly UbsRouteFeature[];
  readonly vertexCount: number;
  readonly bbox: UbsBoundingBox | null;
  /**
   * Properties that could join to a gazetteer. Zero for every file in the
   * shipped snapshot; the importer asserts that, so a future release that adds
   * identifiers breaks the build instead of passing unnoticed.
   */
  readonly placeIdentifierCount: number;
  /** Features present in the file that carried no usable geometry. */
  readonly emptyFeatureCount: number;
  /** Whether the file declared a `crs` member (none do; RFC 7946 forbids it). */
  readonly declaresCrs: boolean;
};

/**
 * Property keys that would let a route waypoint join to a place record.
 *
 * The list is what we would ACCEPT, not what is present — nothing is present.
 * Naming the accepted keys is what makes the zero meaningful: the check knows
 * what it is looking for, so finding none is evidence rather than an absence of
 * evidence.
 */
const PLACE_IDENTIFIER_KEYS = new Set([
  "id",
  "place",
  "placeId",
  "place_id",
  "pleiades",
  "pleiadesId",
  "pleiades_id",
  "tipnr",
  "tipnrId",
  "openbible",
  "openbibleId",
  "osmId",
  "geonames",
  "geonamesId",
  "wikidata",
  "wikidataId",
  "ref",
  "refs",
  "scripture",
  "verse",
]);

function isFiniteLonLat(value: unknown): value is UbsLonLat {
  return (
    Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180
    && Math.abs(value[1]) <= 90
  );
}

/**
 * Split a route file stem into number, suffix and title.
 *
 * Needed because the corpus is inconsistent about it: `100.geojson` lost its
 * title entirely while its SVG sibling kept it (`100. Solomon's Temple_1.svg`),
 * and `107a`/`107b` share a number. So the number is the join key and the title
 * is not.
 */
export function parseRouteFileStem(stem: string): {
  routeNumber: number | null;
  routeSuffix: string | null;
  title: string;
} {
  const match = /^\s*0*(\d+)\s*([a-z])?\s*\.?\s*(.*)$/.exec(stem);
  if (!match) return { routeNumber: null, routeSuffix: null, title: stem.trim() };
  return {
    routeNumber: Number(match[1]!),
    routeSuffix: match[2] ?? null,
    title: match[3]!.trim(),
  };
}

/**
 * Read one route file's already-parsed JSON.
 *
 * Takes a `unknown` rather than a string so the core layer never owns a JSON
 * parse of untrusted bytes, and so a malformed file surfaces at the I/O edge.
 */
export function parseRouteGeoJson(fileName: string, json: unknown): UbsRoute | null {
  if (typeof json !== "object" || json === null) return null;
  const root = json as Record<string, unknown>;
  const type = root["type"];
  if (type !== "Feature" && type !== "FeatureCollection") return null;

  const rawFeatures: unknown[] = type === "FeatureCollection"
    ? Array.isArray(root["features"]) ? (root["features"] as unknown[]) : []
    : [root];

  const features: UbsRouteFeature[] = [];
  let vertexCount = 0;
  let placeIdentifierCount = 0;
  let emptyFeatureCount = 0;
  let minLon = Number.POSITIVE_INFINITY;
  let minLat = Number.POSITIVE_INFINITY;
  let maxLon = Number.NEGATIVE_INFINITY;
  let maxLat = Number.NEGATIVE_INFINITY;

  for (const candidate of rawFeatures) {
    if (typeof candidate !== "object" || candidate === null) {
      emptyFeatureCount++;
      continue;
    }
    const feature = candidate as Record<string, unknown>;
    const properties = feature["properties"];
    const propertyKeys = typeof properties === "object" && properties !== null
      ? Object.keys(properties as Record<string, unknown>)
      : [];
    for (const key of propertyKeys) {
      if (PLACE_IDENTIFIER_KEYS.has(key)) placeIdentifierCount++;
    }
    const geometry = feature["geometry"];
    if (typeof geometry !== "object" || geometry === null) {
      emptyFeatureCount++;
      continue;
    }
    const geom = geometry as Record<string, unknown>;
    if (geom["type"] !== "LineString" || !Array.isArray(geom["coordinates"])) {
      emptyFeatureCount++;
      continue;
    }
    const coordinates: UbsLonLat[] = [];
    for (const point of geom["coordinates"] as unknown[]) {
      if (!isFiniteLonLat(point)) continue;
      const lonLat: UbsLonLat = [point[0], point[1]];
      coordinates.push(lonLat);
      vertexCount++;
      if (lonLat[0] < minLon) minLon = lonLat[0];
      if (lonLat[0] > maxLon) maxLon = lonLat[0];
      if (lonLat[1] < minLat) minLat = lonLat[1];
      if (lonLat[1] > maxLat) maxLat = lonLat[1];
    }
    if (coordinates.length === 0) {
      emptyFeatureCount++;
      continue;
    }
    features.push({ coordinates, propertyKeys });
  }

  const stem = parseRouteFileStem(fileName);
  return {
    fileName,
    routeNumber: stem.routeNumber,
    routeSuffix: stem.routeSuffix,
    title: stem.title,
    topLevelType: type,
    features,
    vertexCount,
    bbox: Number.isFinite(minLon) ? { minLon, minLat, maxLon, maxLat } : null,
    placeIdentifierCount,
    emptyFeatureCount,
    declaresCrs: Object.prototype.hasOwnProperty.call(root, "crs"),
  };
}

/** First and last vertex of every feature — the only vertices that could be places. */
export function routeEndpoints(route: UbsRoute): readonly UbsLonLat[] {
  const endpoints: UbsLonLat[] = [];
  for (const feature of route.features) {
    const first = feature.coordinates[0];
    const last = feature.coordinates[feature.coordinates.length - 1];
    if (first) endpoints.push(first);
    if (last) endpoints.push(last);
  }
  return endpoints;
}

/** Great-circle distance in kilometres. */
export function haversineKm(a: UbsLonLat, b: UbsLonLat): number {
  const rad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const h = Math.sin(dLat / 2) ** 2
    + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371.0088 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

// ────────────────────────────────────────────────────────────────────────────
// Routes — the SVG siblings, and why they are derived rather than primary
// ────────────────────────────────────────────────────────────────────────────

export type UbsSvgFrame = {
  readonly fileName: string;
  /** `[minX, minY, width, height]`, or null — 16 files declare no viewBox. */
  readonly viewBox: readonly [number, number, number, number] | null;
  readonly pathCount: number;
  readonly strokeColors: readonly string[];
  /**
   * On-curve anchor points across every path, one per drawing command.
   *
   * This is the number that proves the SVG is the GeoJSON rather than an
   * independent drawing: for 176 of the 179 routes it equals the GeoJSON's
   * vertex count exactly. Fitting a per-axis affine on top of that reproduces
   * every anchor within 1.5 SVG units for 158 of those 176, and the fitted
   * x/y scale ratio divided by cos(mid latitude) is 1.0000 at the median and
   * within 2% of 1.0 for 174 of 176 — so the transform is equirectangular with
   * longitude scaled by cos(latitude), and nothing else.
   */
  readonly anchorCount: number;
};

const VIEW_BOX_PATTERN = /viewBox="([\d.\s+-]+)"/;
const STROKE_PATTERN = /stroke:\s*(#[0-9A-Fa-f]{3,8})/g;
const PATH_D_PATTERN = /<path\b[^>]*\sd="([^"]*)"/g;

/** How many coordinate numbers each path command consumes per anchor produced. */
const COMMAND_ARITY: Record<string, number> = {
  M: 2, L: 2, T: 2, C: 6, S: 4, Q: 4, H: 1, V: 1, A: 7,
};

/**
 * Count on-curve anchors in one path's `d`.
 *
 * A command letter may be followed by several coordinate groups (SVG's implicit
 * repetition), and each group lands one anchor, so the count is the number of
 * groups rather than the number of letters. `Z` closes without adding a point.
 */
function countPathAnchors(d: string): number {
  const tokens = d.match(/[A-Za-z]|-?\d*\.?\d+(?:[eE][-+]?\d+)?/g);
  if (!tokens) return 0;
  let anchors = 0;
  let command: string | null = null;
  let index = 0;
  while (index < tokens.length) {
    const token = tokens[index]!;
    if (/^[A-Za-z]$/.test(token)) {
      command = token;
      index++;
      if (command === "Z" || command === "z") anchors += 0;
      continue;
    }
    const arity = command ? COMMAND_ARITY[command.toUpperCase()] ?? 0 : 0;
    if (arity === 0) {
      index++;
      continue;
    }
    let consumed = 0;
    while (consumed < arity && index < tokens.length && !/^[A-Za-z]$/.test(tokens[index]!)) {
      index++;
      consumed++;
    }
    if (consumed === arity) anchors++;
  }
  return anchors;
}

/** Read the frame of one SVG route. Geometry is deliberately not parsed. */
export function parseSvgFrame(fileName: string, svg: string): UbsSvgFrame {
  const viewBoxMatch = VIEW_BOX_PATTERN.exec(svg);
  let viewBox: readonly [number, number, number, number] | null = null;
  if (viewBoxMatch) {
    const parts = viewBoxMatch[1]!.trim().split(/\s+/).map(Number);
    if (parts.length === 4 && parts.every((value) => Number.isFinite(value))) {
      viewBox = [parts[0]!, parts[1]!, parts[2]!, parts[3]!];
    }
  }
  const strokeColors = new Set<string>();
  STROKE_PATTERN.lastIndex = 0;
  let stroke: RegExpExecArray | null;
  while ((stroke = STROKE_PATTERN.exec(svg)) !== null) {
    strokeColors.add(stroke[1]!.toUpperCase());
  }
  let anchorCount = 0;
  PATH_D_PATTERN.lastIndex = 0;
  let path: RegExpExecArray | null;
  while ((path = PATH_D_PATTERN.exec(svg)) !== null) {
    anchorCount += countPathAnchors(path[1]!);
  }
  return {
    fileName,
    viewBox,
    pathCount: (svg.match(/<path\b/g) ?? []).length,
    strokeColors: [...strokeColors].sort(),
    anchorCount,
  };
}

/**
 * The aspect ratio an equirectangular (Plate Carrée) plot of a bbox would have,
 * with longitude compressed by the cosine of the bbox's mid latitude.
 *
 * This is the function that settles which of the two route formats is the data.
 * Measured: for 148 of the 164 route pairs whose SVG declares a viewBox, this
 * prediction matches the SVG's own `width/height` to within 2%. The 16 misses
 * are square or padded Illustrator canvases (several are exactly 1.0000), not a
 * different projection.
 *
 * So the SVG carries no geometry the GeoJSON lacks. It is a per-file crop at a
 * per-file scale — measured spread of viewBox units per degree of latitude runs
 * from 3.66 to 13,778 — and its viewBox origin is always `0 0`, so the crop's
 * position on the globe is not recorded anywhere in the SVG. An SVG route
 * therefore cannot be placed on a map without recovering the bbox from the
 * GeoJSON first, at which point the SVG is redundant.
 */
export function equirectangularAspect(bbox: UbsBoundingBox): number | null {
  const dLon = bbox.maxLon - bbox.minLon;
  const dLat = bbox.maxLat - bbox.minLat;
  if (!(dLat > 0) || !(dLon > 0)) return null;
  const midLat = ((bbox.minLat + bbox.maxLat) / 2) * (Math.PI / 180);
  return (dLon * Math.cos(midLat)) / dLat;
}

/** Aspect ratio the SVG itself declares, or null without a usable viewBox. */
export function svgAspect(frame: UbsSvgFrame): number | null {
  if (!frame.viewBox) return null;
  const [, , width, height] = frame.viewBox;
  if (!(width > 0) || !(height > 0)) return null;
  return width / height;
}

// ────────────────────────────────────────────────────────────────────────────
// Routes — metadata.csv
// ────────────────────────────────────────────────────────────────────────────

/**
 * One row of `metadata.csv`.
 *
 * Named for what it is rather than what its filename suggests. The file is
 * TAB-separated despite the `.csv` extension, carries no header row, and its
 * four columns are a MAP-IMAGE index, not a route index: story number, story
 * title, figure number, and an image filename ending `.jpg`. Those JPEGs are in
 * the 2.4 GB MARBLE image collection, which this repo does not fetch.
 *
 * It carries no scripture reference and no route filename. 168 of its 228
 * distinct image stems (73.7%) happen to match a route file stem, because
 * Ritmeyer drew both from the same numbered figure series — that coincidence is
 * the only bridge between the two, and it is a filename bridge, not a key.
 */
export type UbsRouteMetadataRow = {
  readonly storyId: string;
  readonly storyTitle: string;
  readonly figureId: string;
  readonly imageFile: string;
};

/** Parse the tab-separated, header-less `metadata.csv`. */
export function parseRouteMetadata(text: string): {
  rows: readonly UbsRouteMetadataRow[];
  malformedLineCount: number;
} {
  const rows: UbsRouteMetadataRow[] = [];
  let malformedLineCount = 0;
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    if (cells.length !== 4) {
      malformedLineCount++;
      continue;
    }
    rows.push({
      storyId: cells[0]!.trim(),
      storyTitle: cells[1]!.trim(),
      figureId: cells[2]!.trim(),
      imageFile: cells[3]!.trim(),
    });
  }
  return { rows, malformedLineCount };
}

/**
 * Normalize a route stem or image stem to a comparable key.
 *
 * Lower-cased, leading zeros dropped, punctuation and whitespace collapsed, and
 * the curly apostrophe folded to a straight one — the corpus mixes `Abram's`
 * and `Abram’s` across the two directories.
 */
export function routeJoinKey(stem: string): string {
  const parsed = parseRouteFileStem(stem);
  const title = parsed.title
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9']+/gi, " ")
    .trim()
    .toLowerCase();
  return `${parsed.routeNumber ?? ""}${parsed.routeSuffix ?? ""}|${title}`;
}
