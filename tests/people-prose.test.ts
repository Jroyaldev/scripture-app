/**
 * People/place PROSE from three separately attributed sources.
 *
 * ─── What this file is actually defending ────────────────────────────────────
 *
 * The reader-facing failure mode here is not a crash. It is a fluent, confident,
 * well-punctuated paragraph on the wrong man's card. unfoldingWord's
 * translationWords is keyed by NAME; TIPNR is keyed by PERSON; the two look
 * joinable and are not. Measured below, independently of the importer: 306 of the
 * 355 tW `bible/names` entries match a TIPNR name, and those 306 names are borne
 * by 685 DISTINCT TIPNR entities. 124 of the 306 cover more than one person.
 * "Azariah" alone covers 19. A naive join hands one paragraph to nineteen people
 * and is wrong about eighteen of them, and nothing in the rendered result looks
 * wrong.
 *
 * So the assertions here are ordered by what they protect:
 *
 *   1. non-vacuity — every count this file leans on is pinned non-zero FIRST,
 *      because a guard test that silently measured an empty corpus would pass
 *      (tests/lsj.test.ts makes the same move for the same reason);
 *   2. the measurement, reproduced from TIPNR + the artefacts without consulting
 *      the importer's own counters, and the worst offenders pinned BY NAME;
 *   3. the guard — a name-scoped record must be incapable of appearing as an
 *      individual's biography, proved both by sweeping every shipped record
 *      through `individualProse` and by FORGING the four ways a hand-edited
 *      artefact could try it and requiring `auditProseGranularity` to catch each
 *      one. The forgeries run before the clean-artefact assertion, so "zero
 *      violations" is known to mean "the auditor looked and found nothing", not
 *      "the auditor is asleep";
 *   4. separate attribution — three files, three attribution rows, three dates,
 *      with the required strings checked VERBATIM against the bytes shipped in
 *      `sources/`;
 *   5. the shape of each source, measured rather than asserted from a hunch:
 *      Hitchcock's definitions are one-line etymologies (median 20 characters,
 *      longest 64), ISBE's articles are encyclopedia articles (median 405
 *      characters of visible text, mean 1,871);
 *   6. ISBE's numbered homonyms — the person-level hook translationWords does not
 *      have — with the parse yield pinned in both directions: what parses and
 *      what does not.
 *
 * Fixture-backed. Everything is measured against the shipped artefacts in
 * `data/scripture/names/people-prose/` and `data/scripture/names/tipnr-index.json`.
 * A rebuild of either that moves a number will fail here loudly, which is the
 * intent: these numbers are the claim.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { canonicalStrongsKey } from "../src/core/language/strongs-key.js";
import { parseOsisVerseId } from "../src/core/language/oshb-osis.js";
import {
  HITCHCOCK_ABOUT,
  ISBE_ABOUT,
  PROSE_SOURCES,
  ProseGranularityError,
  UNFOLDINGWORD_ATTRIBUTION,
  UNFOLDINGWORD_DERIVATIVE_RIDER,
  UNFOLDINGWORD_TRADEMARK_RIDER,
  artifactRecords,
  auditProseGranularity,
  bearersByName,
  demoteToNameScope,
  formatNameScopeLabel,
  individualProse,
  isNameScoped,
  isPersonScoped,
  parseIsbeOrdinals,
  parseUnfoldingWordStrongs,
  proseNameKey,
  resolveSubEntryCollisions,
  scopeProse,
  segmentIsbeRoster,
  stripTeiTags,
  type NameBearer,
  type NameScopedProse,
  type PeopleProseArtifact,
  type PersonScopedProse,
  type ProseBlock,
  type ProseRecord,
  type ProseSourceId,
  type ProseUnboundReason,
} from "../src/core/entities/people-prose.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const NAMES_DIR = resolve(__dirname, "../data/scripture/names");
const PROSE_DIR = resolve(NAMES_DIR, "people-prose");
const TIPNR_PATH = resolve(NAMES_DIR, "tipnr-index.json");
const DOCTOR_PATH = resolve(PROSE_DIR, "doctor-report.json");

const ARTIFACT_FILE: Readonly<Record<ProseSourceId, string>> = {
  "unfoldingword-tw": "unfoldingword-tw.json",
  hitchcock: "hitchcock.json",
  isbe: "isbe.json",
};

const ALL_SOURCES: readonly ProseSourceId[] = ["unfoldingword-tw", "hitchcock", "isbe"];

// ───────────────────────────────────────────────────────────────────────────
// Fixtures, loaded once. ~13 MB of JSON; measured at ~70 ms for all four files.
// ───────────────────────────────────────────────────────────────────────────

type TipnrEntity = {
  kind: string;
  displayName: string;
  baseStrong?: string;
  uStrong?: string;
  refs: string[];
};

type TipnrIndex = {
  source: string;
  license: string;
  sourceSha256: string;
  entityCount: number;
  personCount: number;
  entities: Record<string, TipnrEntity>;
  byBaseStrong?: Record<string, string[]>;
};

type Fixtures = {
  tipnr: TipnrIndex;
  bearers: Map<string, NameBearer[]>;
  artifacts: Record<ProseSourceId, PeopleProseArtifact>;
  records: Record<ProseSourceId, ProseRecord[]>;
  doctor: {
    tipnr: { entityCount: number };
    sources: Record<string, { counts: Record<string, number>; nameKeys: number; entityIds: number }>;
    checks: Record<string, boolean>;
    status: string;
  };
};

let cached: Fixtures | null = null;

function fixtures(): Fixtures {
  if (cached) return cached;
  const tipnr = JSON.parse(readFileSync(TIPNR_PATH, "utf8")) as TipnrIndex;
  const bearers = bearersByName(tipnr.entities);
  const artifacts = {} as Record<ProseSourceId, PeopleProseArtifact>;
  const records = {} as Record<ProseSourceId, ProseRecord[]>;
  for (const id of ALL_SOURCES) {
    const artifact = JSON.parse(
      readFileSync(resolve(PROSE_DIR, ARTIFACT_FILE[id]), "utf8"),
    ) as PeopleProseArtifact;
    artifacts[id] = artifact;
    records[id] = artifactRecords(artifact);
  }
  cached = {
    tipnr,
    bearers,
    artifacts,
    records,
    doctor: JSON.parse(readFileSync(DOCTOR_PATH, "utf8")) as Fixtures["doctor"],
  };
  return cached;
}

function bearersOf(nameKey: string): readonly NameBearer[] {
  return fixtures().bearers.get(nameKey) ?? [];
}

/**
 * Every record from all three sources, which is what the guard has to hold over.
 *
 * MUTATION-TESTED: refiling the tW Azariah record here as
 * `{granularity: "person", boundBy: {kind: "sole-bearer", bearerCount: 1}}` —
 * the exact forgery a hand-edited artefact would produce — fails both guard
 * tests below, each with a message that names the record and the bearer count.
 * Neither passes by accident.
 */
function allRecords(): ProseRecord[] {
  const { records } = fixtures();
  return [...records["unfoldingword-tw"], ...records.hitchcock, ...records.isbe];
}

/** tW records from `bible/names` only — the corpus the headline numbers describe. */
function twNamesRecords(): ProseRecord[] {
  return fixtures().records["unfoldingword-tw"].filter((record) =>
    record.block.sourceEntryId.startsWith("names/"),
  );
}

/** ISBE whole-article records; a segment id carries `#`. */
function isbeArticles(): ProseRecord[] {
  return fixtures().records.isbe.filter((record) => !record.block.sourceEntryId.includes("#"));
}

function isbeSegments(): ProseRecord[] {
  return fixtures().records.isbe.filter((record) => record.block.sourceEntryId.includes("#"));
}

function median(values: readonly number[]): number {
  assert.ok(values.length > 0, "median of an empty sample");
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

function mean(values: readonly number[]): number {
  assert.ok(values.length > 0, "mean of an empty sample");
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Collapse `\par` and runs of whitespace, so "verbatim" survives line wrapping. */
function normalizeQuoted(text: string): string {
  return text.replace(/\\par/g, " ").replace(/\s+/g, " ").trim();
}

const osisResolver = (osisId: string): { book: string; chapter: number; verse: number } | null =>
  parseOsisVerseId(osisId);

// ───────────────────────────────────────────────────────────────────────────
// 1 — Non-vacuity. Nothing below is allowed to measure an empty corpus.
// ───────────────────────────────────────────────────────────────────────────

test("the fixtures are present and non-empty before any count is trusted", () => {
  const { tipnr, bearers, artifacts, records, doctor } = fixtures();

  assert.equal(tipnr.entityCount, 4259, "TIPNR entity count drifted from the pinned snapshot");
  assert.equal(
    Object.keys(tipnr.entities).length,
    4259,
    "TIPNR entityCount disagrees with the entities it ships",
  );
  assert.ok(bearers.size > 0, "the TIPNR bearer table is empty — there is nothing to scope against");
  // 4,259 entities behind 2,785 distinct name keys: TIPNR itself is already
  // 1.5 entities per name before any source is joined to it.
  assert.equal(bearers.size, 2785, "distinct TIPNR name keys drifted");
  assert.ok(bearers.size < tipnr.entityCount, "there must be fewer names than entities, or nothing is shared");

  // Per-source record counts, pinned. These are the denominators for every
  // proportion below, so a silent drop to zero must fail here and not later.
  const expected: Record<ProseSourceId, { records: number; nameScoped: number; personScoped: number }> = {
    "unfoldingword-tw": { records: 368, nameScoped: 173, personScoped: 195 },
    hitchcock: { records: 2625, nameScoped: 2625, personScoped: 0 },
    isbe: { records: 4657, nameScoped: 3392, personScoped: 1265 },
  };
  for (const id of ALL_SOURCES) {
    const list = records[id];
    assert.ok(list.length > 0, `${id} shipped zero prose records`);
    assert.equal(list.length, expected[id].records, `${id} record count drifted`);
    assert.equal(
      list.filter(isNameScoped).length,
      expected[id].nameScoped,
      `${id} name-scoped count drifted`,
    );
    assert.equal(
      list.filter(isPersonScoped).length,
      expected[id].personScoped,
      `${id} person-scoped count drifted`,
    );
    assert.equal(artifacts[id].formatVersion, 1);
    assert.equal(artifacts[id].sourceId, id);
    assert.equal(
      artifacts[id].tipnr.sourceSha256,
      tipnr.sourceSha256,
      `${id} was scoped against a different TIPNR build than the one on disk`,
    );
  }

  // Hitchcock is the whole-file counter-case: 2,625 records, not one of them
  // person-scoped, because an etymology of a name is not a fact about a bearer.
  assert.equal(records.hitchcock.filter(isPersonScoped).length, 0);

  // The doctor report is a witness, not the source of truth: it must agree with
  // the artefacts we just counted.
  assert.equal(doctor.status, "healthy");
  assert.equal(doctor.tipnr.entityCount, 4259);
  assert.equal(doctor.sources["unfoldingword-tw"]!.counts.personScoped, 195);
  assert.equal(doctor.sources["unfoldingword-tw"]!.counts.nameScoped, 173);
  assert.equal(doctor.sources.isbe!.counts.personScoped, 1265);
  assert.equal(Object.values(doctor.checks).length, 9);
  assert.ok(Object.values(doctor.checks).every(Boolean), "a doctor check is false");
});

// ───────────────────────────────────────────────────────────────────────────
// 2 — The measurement, reproduced from TIPNR without asking the importer.
// ───────────────────────────────────────────────────────────────────────────

test("translationWords is name-level and TIPNR is person-level: 306 names, 685 entities", () => {
  const names = twNamesRecords();
  assert.equal(names.length, 355, "tW bible/names file count drifted");

  let matched = 0;
  let ambiguous = 0;
  let oneToOne = 0;
  const covered = new Set<string>();
  const byBearerCount: Array<{ nameKey: string; bearers: number }> = [];

  for (const record of names) {
    const bearers = bearersOf(record.nameKey);
    if (bearers.length > 0) {
      matched += 1;
      for (const bearer of bearers) covered.add(bearer.entityId);
    }
    if (bearers.length === 1) oneToOne += 1;
    if (bearers.length > 1) {
      ambiguous += 1;
      byBearerCount.push({ nameKey: record.nameKey, bearers: bearers.length });
    }
  }

  // Non-vacuity before the interesting part.
  assert.ok(matched > 0, "no tW entry matched any TIPNR name — the join key must be broken");
  assert.ok(covered.size > 0, "no TIPNR entity was covered");

  assert.equal(matched, 306, "tW names matching a TIPNR name drifted");
  assert.equal(covered.size, 685, "distinct TIPNR entities covered by tW names drifted");
  assert.equal(ambiguous, 124, "tW names covering more than one TIPNR entity drifted");
  assert.equal(oneToOne, 182, "tW names covering exactly one TIPNR entity drifted");
  assert.equal(oneToOne + ambiguous, matched, "matched entries must be 1:1 or ambiguous");

  // THE SHAPE OF THE TRAP, stated as an inequality rather than a pair of
  // constants: far more entities are covered than there are entries to cover
  // them, which is exactly what "one side is name-level" means.
  assert.ok(
    covered.size > matched * 2,
    `685 entities behind 306 entries is the whole problem; measured ${covered.size} behind ${matched}`,
  );
  assert.ok(
    ambiguous / matched > 0.4,
    `${ambiguous}/${matched} ambiguous is the base rate this module exists for`,
  );

  // The worst offenders, pinned BY NAME. If a future TIPNR rebuild collapses
  // Azariah to one person these fail, and that is correct — the guard's whole
  // premise would have changed.
  byBearerCount.sort((a, b) => b.bearers - a.bearers || a.nameKey.localeCompare(b.nameKey));
  assert.deepEqual(byBearerCount.slice(0, 4), [
    { nameKey: "azariah", bearers: 19 },
    { nameKey: "shimei", bearers: 16 },
    { nameKey: "hananiah", bearers: 15 },
    { nameKey: "joel", bearers: 14 },
  ]);

  // Said once more on its own, because it is the sentence that matters: the name
  // "Azariah" does not resolve to a person. It resolves to nineteen.
  const azariah = bearersOf("azariah");
  assert.ok(
    azariah.length > 1,
    "Azariah must resolve to MANY TIPNR persons; if this is 1 the join is silently safe and this file is pointless",
  );
  assert.equal(azariah.length, 19);
  assert.equal(new Set(azariah.map((bearer) => bearer.entityId)).size, 19, "19 bearers, 19 ids");
  assert.ok(
    azariah.every((bearer) => bearer.kind === "person"),
    "all nineteen Azariahs are people, so a place/person split cannot excuse the join",
  );
});

test("the 13 kt entries are all 1:1, so the 319 total is 306 ambiguous-capable plus 13 safe", () => {
  const { records } = fixtures();
  const kt = records["unfoldingword-tw"].filter((record) =>
    record.block.sourceEntryId.startsWith("kt/"),
  );
  assert.equal(kt.length, 13, "kt imported count drifted");
  assert.ok(kt.length > 0);
  for (const record of kt) {
    assert.equal(bearersOf(record.nameKey).length, 1, `${record.block.sourceEntryId} is not 1:1`);
  }
  const matchedAll = records["unfoldingword-tw"].filter(
    (record) => bearersOf(record.nameKey).length > 0,
  ).length;
  assert.equal(matchedAll, 319, "total tW entries matching TIPNR drifted");
  assert.equal(matchedAll, 306 + 13);
});

test("the Strong's number cannot rescue the join: all 19 Azariahs share one base", () => {
  const { tipnr } = fixtures();
  const azariah = bearersOf("azariah");
  assert.equal(azariah.length, 19);

  const bases = new Set<string>();
  const uStrongs = new Set<string>();
  for (const bearer of azariah) {
    const entity = tipnr.entities[bearer.entityId];
    assert.ok(entity, `TIPNR lost ${bearer.entityId}`);
    if (entity.baseStrong) bases.add(entity.baseStrong);
    if (entity.uStrong) uStrongs.add(entity.uStrong);
  }
  assert.ok(bases.size > 0, "no baseStrong found — this check would otherwise pass on nothing");
  assert.deepEqual([...bases], ["H5838"], "the nineteen Azariahs no longer share one base Strong's");
  assert.equal(uStrongs.size, 19, "TIPNR's disambiguated uStrong is per-person; that is the hook tW lacks");

  // What a tW file can actually express is the 4-digit base form, and that form
  // is a NAME-level key by construction.
  const parsed = parseUnfoldingWordStrongs("H5838");
  assert.ok(parsed, "H5838 must parse as a tW Hebrew token");
  assert.equal(parsed.base, "H5838");
  assert.equal(parsed.testament, "H");
  const behindBase = tipnr.byBaseStrong?.["H5838"] ?? [];
  assert.ok(
    behindBase.length >= 19,
    `base Strong's H5838 stands in front of ${behindBase.length} TIPNR entities, so it cannot name one`,
  );
});

test("the tW Azariah paragraph is name-scoped, says so, and carries all 19 entities", () => {
  const { artifacts } = fixtures();
  const bucket = artifacts["unfoldingword-tw"].byNameKey.azariah;
  assert.ok(bucket && bucket.length === 1, "expected exactly one tW record under the name azariah");
  const record = bucket[0]!;

  assert.equal(record.granularity, "name");
  assert.equal(record.block.sourceEntryId, "names/azariah");
  assert.equal(record.coversEntityIds.length, 19, "the record must not lose the bearer count");
  assert.deepEqual(
    [...record.coversEntityIds].sort(),
    bearersOf("azariah")
      .map((bearer) => bearer.entityId)
      .sort(),
    "the record's coverage must be exactly TIPNR's bearer list",
  );
  assert.equal(record.unboundReason, "many-bearers-no-hook");

  // The caveat is not optional text a render site might drop: it is derived from
  // the coverage list, so it cannot drift away from it.
  assert.equal(record.scopeLabel, "Shared by 19 people named Azariah");
  assert.equal(record.scopeLabel, formatNameScopeLabel(record.displayTerm, bearersOf("azariah")));
  assert.doesNotMatch(
    record.scopeLabel,
    /\bthis (person|man|woman)\b/i,
    "a name-scope label must never read as a claim about an individual",
  );

  // unfoldingWord knows this about itself, in its own first sentence.
  assert.match(record.block.text, /^Azariah was the name of several men in the Old Testament\./);

  // Azariah is not in byEntityId under ANY of its nineteen ids.
  for (const bearer of bearersOf("azariah")) {
    assert.equal(
      artifacts["unfoldingword-tw"].byEntityId[bearer.entityId],
      undefined,
      `tW prose is filed against the individual ${bearer.entityId}`,
    );
  }
});

test("31 tW entries declare their own multiplicity; 30 measure multi and the 1 exception is understood", () => {
  // Detected here with our own phrase list rather than the module's, so this is
  // an independent reading of the same 368 files.
  const phrases = [
    /\bwas the name of (?:several|two|three|four|five|many|at least)\b/i,
    /\bwere the names? of\b/i,
    /\bthere (?:were|are) (?:several|two|three|four|five|many)\b[^.]{0,40}\bnamed\b/i,
    /\bseveral (?:men|women|people|places|cities|towns)\b[^.]{0,30}\bnamed\b/i,
  ];
  const declared = fixtures().records["unfoldingword-tw"].filter((record) =>
    phrases.some((phrase) => phrase.test(record.block.text)),
  );
  assert.ok(declared.length > 0, "no tW entry declared multiplicity — the phrase list must be wrong");
  assert.equal(declared.length, 31, "self-declared multi-person tW entries drifted");

  const stillPersonScoped = declared.filter(isPersonScoped);
  // Exactly one, and it is a false positive of the phrase heuristic rather than a
  // guard failure: matthew.md's sentence "There are several other men named Levi
  // in the Bible" is about LEVI, and TIPNR carries exactly one Matthew.
  assert.deepEqual(
    stillPersonScoped.map((record) => record.block.sourceEntryId),
    ["names/matthew"],
    "a tW entry that declares it covers several people is filed against an individual",
  );
  const matthew = stillPersonScoped[0]!;
  assert.equal(bearersOf(matthew.nameKey).length, 1, "TIPNR must know exactly one Matthew");
  assert.equal(matthew.boundBy.kind, "sole-bearer");
  assert.match(matthew.block.text, /several other men named Levi/);

  // The other 30 are name-scoped AND independently measure as multi-bearer, so
  // the source's self-description and TIPNR agree.
  const declaredNameScoped = declared.filter(isNameScoped);
  assert.equal(declaredNameScoped.length, 30);
  for (const record of declaredNameScoped) {
    assert.ok(
      bearersOf(record.nameKey).length > 1,
      `${record.block.sourceEntryId} declares several bearers but TIPNR gives ${bearersOf(record.nameKey).length}`,
    );
  }
});

// ───────────────────────────────────────────────────────────────────────────
// 3 — THE GUARD. A name-scoped record must be unable to pose as a biography.
// ───────────────────────────────────────────────────────────────────────────

test("every name-scoped record refuses to be read as an individual's account", () => {
  const records = allRecords();
  assert.equal(records.length, 7650, "total shipped record count drifted");

  let yielded = 0;
  let refused = 0;
  const refusedBySource = new Map<ProseSourceId, number>();

  for (const record of records) {
    let got: PersonScopedProse | null = null;
    try {
      got = individualProse(record, "word card biography slot");
    } catch (error) {
      assert.ok(
        error instanceof ProseGranularityError,
        `individualProse threw ${String(error)} instead of ProseGranularityError`,
      );
      assert.equal(error.code, "prose-granularity");
      assert.equal(error.name, "ProseGranularityError");
      // The message has to be usable by whoever hits it at 2am: which source,
      // which name, how many entities, and what to do instead.
      assert.match(error.message, /is scoped to the NAME/);
      assert.match(error.message, /must not be presented as one individual's account/);
      assert.ok(
        error.message.includes(PROSE_SOURCES[record.block.sourceId].name),
        "the refusal must name the source",
      );
      assert.ok(error.message.includes(`"${record.displayTerm}"`), "the refusal must name the term");
      assert.ok(
        error.message.includes(String(error.record.coversEntityIds.length)),
        "the refusal must state how many entities the prose actually covers",
      );
      assert.match(error.message, /word card biography slot/, "the caller's context must survive");
      refused += 1;
      refusedBySource.set(
        record.block.sourceId,
        (refusedBySource.get(record.block.sourceId) ?? 0) + 1,
      );
      continue;
    }
    assert.ok(got, "individualProse returned nothing without throwing");
    assert.equal(got.granularity, "person");
    // The record that DID come back as a biography has to be entitled to be one,
    // and this is where a name-scoped record relabelled as person-scoped shows
    // up: it will be sitting on a name several people bear with nothing but a
    // sole-bearer claim behind it.
    const bearers = bearersOf(got.nameKey);
    assert.ok(
      got.boundBy.kind === "isbe-subentry-reference" || bearers.length === 1,
      `individualProse handed back "${got.displayTerm}" (${got.block.sourceEntryId}) as ONE person's account, ` +
        `but ${bearers.length} TIPNR entities bear that name and the record offers no per-individual evidence — ` +
        `this is the nineteen-Azariahs bug reaching a reader`,
    );
    yielded += 1;
  }

  // Both halves non-zero, and they account for every record. A version of this
  // test where `refused` were 0 would pass every assertion inside the catch.
  assert.ok(refused > 0, "nothing refused — the guard never fired, so nothing was proved");
  assert.ok(yielded > 0, "nothing yielded — the accessor is refusing everything, including the safe cases");
  assert.equal(refused + yielded, records.length);
  assert.equal(refused, 6190, "refusal count drifted (173 tW + 2,625 Hitchcock + 3,392 ISBE)");
  assert.equal(yielded, 1460, "person-scoped count drifted (195 tW + 1,265 ISBE)");
  assert.deepEqual(
    [...refusedBySource.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [
      ["hitchcock", 2625],
      ["isbe", 3392],
      ["unfoldingword-tw", 173],
    ],
  );
});

test("no shipped person-scoped record stands on a name that more than one entity bears", () => {
  const records = allRecords();
  const personScoped = records.filter(isPersonScoped);
  assert.ok(personScoped.length > 0, "no person-scoped records to check");

  let soleBearer = 0;
  let byReference = 0;
  const offenders: string[] = [];

  for (const record of personScoped) {
    const bearers = bearersOf(record.nameKey);
    const bearer = bearers.find((candidate) => candidate.entityId === record.entityId);
    if (!bearer) {
      offenders.push(`${record.block.sourceEntryId}: ${record.entityId} does not bear "${record.nameKey}"`);
      continue;
    }
    // A name-only source may never produce one of these at all.
    assert.equal(
      PROSE_SOURCES[record.block.sourceId].granularity,
      "name-and-individual",
      `${record.block.sourceEntryId} is person-scoped but its source is declared name-only`,
    );

    if (record.boundBy.kind === "sole-bearer") {
      soleBearer += 1;
      assert.equal(record.boundBy.bearerCount, 1);
      // THE assertion. A sole-bearer binding on an ambiguous name IS the
      // nineteen-Azariahs bug.
      if (bearers.length !== 1) {
        offenders.push(
          `${record.block.sourceEntryId}: claims to be the sole ${record.displayTerm} but ${bearers.length} entities bear the name`,
        );
      }
      continue;
    }

    byReference += 1;
    assert.equal(record.boundBy.kind, "isbe-subentry-reference");
    assert.ok(record.boundBy.ordinal >= 1, "a sub-entry binding must carry the printed ordinal");
    assert.ok(
      record.boundBy.evidenceRefs.length > 0,
      `${record.block.sourceEntryId} binds an individual with no evidence`,
    );
    // The evidence is not decoration: every one of these refs must be a verse
    // TIPNR actually attributes to this person.
    const held = record.boundBy.evidenceRefs.filter((ref) => bearer.refs.includes(ref));
    if (held.length !== record.boundBy.evidenceRefs.length) {
      offenders.push(
        `${record.block.sourceEntryId}: evidence [${record.boundBy.evidenceRefs.join(", ")}] is not all in ${record.entityId}`,
      );
    }
  }

  // The loud one first: any entry here is a paragraph about several people
  // presented as one person's biography, which is precisely what a reader cannot
  // detect for themselves.
  assert.deepEqual(
    offenders,
    [],
    `${offenders.length} person-scoped record(s) are NOT entitled to the individual they claim — ` +
      `a shared paragraph is being presented as one person's account:\n  ${offenders.join("\n  ")}`,
  );
  assert.equal(personScoped.length, 1460, "person-scoped record count drifted");
  assert.equal(soleBearer, 195, "sole-bearer bindings drifted");
  assert.equal(byReference, 1265, "reference-evidenced bindings drifted");
  assert.ok(soleBearer > 0 && byReference > 0, "both binding kinds must be exercised by the fixtures");

  // And the interesting subset: 1,206 of the reference-evidenced bindings sit on
  // a name with more than one bearer. Those are the ones the naive join gets
  // wrong, and they are only allowed here because they carry verse evidence.
  const contested = personScoped.filter(
    (record) => record.boundBy.kind === "isbe-subentry-reference" && record.boundBy.bearerCount > 1,
  );
  assert.equal(contested.length, 1206, "reference-evidenced bindings on ambiguous names drifted");
  assert.ok(contested.length > 0);
});

test("the artefact layout cannot file name-scoped prose against an individual", () => {
  const { artifacts } = fixtures();
  for (const id of ALL_SOURCES) {
    const artifact = artifacts[id];
    const nameBuckets = Object.entries(artifact.byNameKey);
    const entityBuckets = Object.entries(artifact.byEntityId);
    assert.ok(nameBuckets.length > 0, `${id} has no byNameKey buckets`);

    for (const [nameKey, bucket] of nameBuckets) {
      assert.ok(bucket.length > 0, `${id} byNameKey[${nameKey}] is empty`);
      for (const record of bucket) {
        assert.equal(record.granularity, "name", `${id} byNameKey[${nameKey}] holds person-scoped prose`);
        assert.equal(record.nameKey, nameKey, `${id} byNameKey[${nameKey}] holds a record keyed elsewhere`);
        assert.ok(record.scopeLabel.length > 0, `${id} ${record.block.sourceEntryId} has no scope label`);
        assert.equal(
          record.scopeLabel,
          formatNameScopeLabel(record.displayTerm, bearersOf(nameKey)),
          `${id} ${record.block.sourceEntryId} label does not follow from its coverage`,
        );
        assert.ok(record.unboundReason, `${id} ${record.block.sourceEntryId} is unbound with no reason given`);
      }
    }

    for (const [entityId, bucket] of entityBuckets) {
      for (const record of bucket) {
        assert.equal(record.granularity, "person", `${id} byEntityId[${entityId}] holds name-scoped prose`);
        assert.equal(record.entityId, entityId, `${id} byEntityId[${entityId}] holds another entity's prose`);
      }
    }
  }

  // ISBE distinguishes more individuals than TIPNR carries, so the one thing that
  // must never happen is two different men's paragraphs under one entity id.
  const isbe = artifacts.isbe;
  const doubled = Object.entries(isbe.byEntityId).filter(([, bucket]) => bucket.length > 1);
  assert.deepEqual(doubled.map(([id]) => id), [], "an entity carries two different sub-entries' prose");
  assert.equal(Object.keys(isbe.byEntityId).length, 1265);
  assert.equal(isbe.counts.distinctPersonsBound, isbe.counts.segmentsBoundToOnePerson);
});

test("the collision pass is live: it demotes a forged double claim and leaves the shipped file alone", () => {
  const { bearers, records } = fixtures();
  const isbe = records.isbe;

  // Negative control FIRST, so the zero below means something.
  const personScoped = isbe.filter(isPersonScoped);
  assert.ok(personScoped.length >= 2);
  const [first, second] = [personScoped[0]!, personScoped[1]!];
  const forged: ProseRecord[] = [first, { ...second, entityId: first.entityId }];
  const caught = resolveSubEntryCollisions(forged, bearers);
  assert.equal(caught.demoted, 2, "two sub-entries claiming one person must BOTH be demoted");
  assert.deepEqual(caught.collidingEntityIds, [first.entityId]);
  for (const record of caught.records) {
    assert.ok(isNameScoped(record));
    assert.equal(record.unboundReason, "many-subentries-bind-to-same-bearer");
  }

  // Now the shipped file: already collision-free, so the pass is a no-op.
  const rerun = resolveSubEntryCollisions(isbe, bearers);
  assert.equal(rerun.demoted, 0, "the shipped ISBE artefact still contains sub-entry collisions");
  assert.deepEqual(rerun.collidingEntityIds, []);
  assert.equal(rerun.records.length, isbe.length);
  // The importer reports what it had to demote to get here.
  assert.equal(fixtures().artifacts.isbe.counts.segmentsDemotedByBearerCollision, 122);
  assert.equal(fixtures().artifacts.isbe.counts.entitiesContestedByManySubEntries, 56);
});

test("auditProseGranularity catches all four ways a hand-edited artefact could forge a biography", () => {
  const { artifacts, bearers } = fixtures();
  const azariah = artifacts["unfoldingword-tw"].byNameKey.azariah![0]!;
  const aaron = artifacts.hitchcock.byNameKey.aaron![0]!;
  assert.equal(azariah.coversEntityIds.length, 19);

  // (a) the nineteen-Azariahs bug in its purest form: relabel the shared
  //     paragraph as one man's story and claim to be his sole bearer.
  const forgedSoleBearer: PersonScopedProse = {
    granularity: "person",
    nameKey: azariah.nameKey,
    displayTerm: azariah.displayTerm,
    entityId: azariah.coversEntityIds[0]!,
    boundBy: { kind: "sole-bearer", bearerCount: 1 },
    block: azariah.block,
  };
  const a = auditProseGranularity([forgedSoleBearer], bearers);
  assert.equal(a.length, 1, "a forged sole-bearer claim on a 19-bearer name went unnoticed");
  assert.equal(a[0]!.kind, "person-scoped-evidence-does-not-hold");
  assert.match(a[0]!.detail, /but 19 entities bear it/);
  assert.equal(a[0]!.sourceEntryId, "names/azariah");

  // (b) the same forgery dressed as evidence, with references that are not this
  //     person's. Fabricated evidence must fail, not merely be believed.
  const forgedEvidence: PersonScopedProse = {
    ...forgedSoleBearer,
    boundBy: {
      kind: "isbe-subentry-reference",
      ordinal: 1,
      evidenceRefs: ["GEN.1.1"],
      bearerCount: 19,
    },
  };
  const b = auditProseGranularity([forgedEvidence], bearers);
  assert.equal(b.length, 1, "fabricated verse evidence was accepted");
  assert.equal(b[0]!.kind, "person-scoped-evidence-does-not-hold");
  assert.match(b[0]!.detail, /none of the evidence references \[GEN\.1\.1\]/);

  // (c) an etymology promoted to a biography. Aaron has exactly ONE bearer, so
  //     every count in this record is arithmetically fine — it is wrong because
  //     of what KIND of claim Hitchcock makes, and the audit has to say so.
  assert.equal(bearersOf("aaron").length, 1);
  const forgedFromNameOnlySource: PersonScopedProse = {
    granularity: "person",
    nameKey: "aaron",
    displayTerm: aaron.displayTerm,
    entityId: bearersOf("aaron")[0]!.entityId,
    boundBy: { kind: "sole-bearer", bearerCount: 1 },
    block: aaron.block,
  };
  const c = auditProseGranularity([forgedFromNameOnlySource], bearers);
  assert.equal(c.length, 1, "a name-only source produced a person-scoped record and the audit allowed it");
  assert.equal(c[0]!.kind, "person-scoped-from-name-level-source");
  assert.match(c[0]!.detail, /is declared name-only/);

  // (d) the quiet one: keep the record name-scoped but retitle it so the reader
  //     sees a biography anyway. The label is checked against the coverage.
  const forgedLabel: NameScopedProse = { ...azariah, scopeLabel: "Azariah, son of Ahimaaz the priest" };
  const d = auditProseGranularity([forgedLabel], bearers);
  assert.equal(d.length, 1, "a name-scoped record was relabelled as an individual and passed");
  assert.equal(d[0]!.kind, "name-scoped-label-disagrees-with-coverage");

  // (e) coverage quietly trimmed so the caveat reads "1 person".
  const forgedCoverage: NameScopedProse = {
    ...azariah,
    coversEntityIds: [azariah.coversEntityIds[0]!],
  };
  const e = auditProseGranularity([forgedCoverage], bearers);
  assert.ok(
    e.some((violation) => violation.kind === "name-scoped-coverage-disagrees-with-bearers"),
    "coverage trimmed from 19 to 1 was not caught",
  );

  // Five distinct violation kinds exercised — the audit's whole vocabulary.
  const kinds = new Set([...a, ...b, ...c, ...d, ...e].map((violation) => violation.kind));
  assert.equal(kinds.size, 4);
});

test("with the auditor proved live, all 7,650 shipped records pass it clean", () => {
  const { bearers, records } = fixtures();
  let audited = 0;
  for (const id of ALL_SOURCES) {
    assert.ok(records[id].length > 0, `${id} has nothing to audit`);
    const violations = auditProseGranularity(records[id], bearers);
    assert.deepEqual(
      violations,
      [],
      `${id} granularity violations: ${JSON.stringify(violations.slice(0, 5), null, 2)}`,
    );
    audited += records[id].length;
  }
  assert.equal(audited, 7650, "the auditor did not see every shipped record");
});

test("scopeProse refuses to bind on every path, and its refusal vocabulary is complete", () => {
  const oneBearer: NameBearer[] = [
    { entityId: "Aaron@Exo.4.14-Heb=H0175", kind: "person", displayName: "Aaron", refs: ["EXO.4.14"] },
  ];
  const manyBearers: NameBearer[] = [
    { entityId: "Azariah@1Ch.2.8=H5838I", kind: "person", displayName: "Azariah", refs: ["1CH.2.8"] },
    { entityId: "Azariah@1Ch.2.38-=H5838J", kind: "person", displayName: "Azariah", refs: ["1CH.2.38"] },
    { entityId: "Azariah@1Ki.4.2-1Ch=H5838G", kind: "person", displayName: "Azariah", refs: ["1KI.4.2"] },
  ];
  const block = (sourceId: ProseSourceId): ProseBlock => ({
    sourceId,
    format: sourceId === "hitchcock" ? "plaintext" : sourceId === "isbe" ? "tei" : "markdown",
    text: "prose under test",
    sourceEntryId: `${sourceId}-fixture`,
    headword: "Azariah",
  });

  const reasons = new Set<ProseUnboundReason>();
  const expectName = (record: ProseRecord, reason: ProseUnboundReason, why: string): void => {
    assert.ok(isNameScoped(record), `${why}: expected name-scoped, got ${record.granularity}`);
    assert.equal(record.unboundReason, reason, why);
    reasons.add(reason);
  };

  expectName(
    scopeProse({ block: block("hitchcock"), displayTerm: "Aaron", bearers: oneBearer }),
    "source-is-name-level",
    "an etymology dictionary must not bind even to a sole bearer",
  );
  expectName(
    scopeProse({ block: block("isbe"), displayTerm: "Nobody", bearers: [] }),
    "name-not-in-tipnr",
    "a name TIPNR does not know has no individual to bind to",
  );
  expectName(
    scopeProse({
      block: block("isbe"),
      displayTerm: "Aaron",
      bearers: oneBearer,
      blockScope: "name-by-construction",
    }),
    "block-is-name-level",
    "a whole ISBE article is the roster, not one man's account",
  );
  expectName(
    scopeProse({ block: block("unfoldingword-tw"), displayTerm: "Azariah", bearers: manyBearers }),
    "many-bearers-no-hook",
    "three bearers and no hook must not bind",
  );
  expectName(
    scopeProse({
      block: block("isbe"),
      displayTerm: "Azariah",
      bearers: manyBearers,
      individualHook: { ordinals: [10, 11], refs: ["1CH.2.8"] },
    }),
    "marker-covers-many-individuals",
    "a `(10 and 11)` marker covers two men, so it names neither",
  );
  expectName(
    scopeProse({
      block: block("isbe"),
      displayTerm: "Azariah",
      bearers: manyBearers,
      individualHook: { ordinals: [2], refs: [] },
    }),
    "no-reference-evidence",
    "a sub-entry citing no verse has offered no evidence",
  );
  expectName(
    scopeProse({
      block: block("isbe"),
      displayTerm: "Azariah",
      bearers: manyBearers,
      individualHook: { ordinals: [2], refs: ["GEN.1.1"] },
    }),
    "reference-matches-no-bearer",
    "evidence that matches nobody must not bind",
  );
  expectName(
    scopeProse({
      block: block("isbe"),
      displayTerm: "Azariah",
      bearers: manyBearers,
      individualHook: { ordinals: [2], refs: ["1CH.2.8", "1CH.2.38"] },
    }),
    "reference-matches-many-bearers",
    "evidence that matches two men must not pick one",
  );
  reasons.add(
    demoteToNameScope(
      scopeProse({
        block: block("unfoldingword-tw"),
        displayTerm: "Aaron",
        bearers: oneBearer,
      }) as PersonScopedProse,
      oneBearer,
      "many-subentries-bind-to-same-bearer",
    ).unboundReason!,
  );

  // Every reason the type declares is reachable and exercised. If someone adds a
  // tenth refusal reason without a test, this fails.
  assert.deepEqual(
    [...reasons].sort(),
    [
      "block-is-name-level",
      "many-bearers-no-hook",
      "many-subentries-bind-to-same-bearer",
      "marker-covers-many-individuals",
      "name-not-in-tipnr",
      "no-reference-evidence",
      "reference-matches-many-bearers",
      "reference-matches-no-bearer",
      "source-is-name-level",
    ],
    "the set of refusal reasons under test drifted from ProseUnboundReason",
  );

  // And the two paths that ARE allowed to bind, so this is not a test that only
  // knows how to say no.
  const sole = scopeProse({
    block: block("unfoldingword-tw"),
    displayTerm: "Aaron",
    bearers: oneBearer,
  });
  assert.ok(isPersonScoped(sole));
  assert.equal(sole.entityId, "Aaron@Exo.4.14-Heb=H0175");
  assert.deepEqual(sole.boundBy, { kind: "sole-bearer", bearerCount: 1 });

  const evidenced = scopeProse({
    block: block("isbe"),
    displayTerm: "Azariah",
    bearers: manyBearers,
    individualHook: { ordinals: [2], refs: ["1CH.2.8"] },
  });
  assert.ok(isPersonScoped(evidenced));
  assert.equal(evidenced.entityId, "Azariah@1Ch.2.8=H5838I");
  assert.deepEqual(evidenced.boundBy, {
    kind: "isbe-subentry-reference",
    ordinal: 2,
    evidenceRefs: ["1CH.2.8"],
    bearerCount: 3,
  });
  // One verse, one man out of three: that is the whole hook, and it is auditable.
  assert.deepEqual(auditProseGranularity([evidenced], new Map([["azariah", manyBearers]])), []);
});

// ───────────────────────────────────────────────────────────────────────────
// 4 — Separate attribution. Three sources, three files, three dates.
// ───────────────────────────────────────────────────────────────────────────

test("three sources, three files, three attribution rows, never one prose field", () => {
  const { artifacts, records } = fixtures();
  assert.equal(Object.keys(PROSE_SOURCES).length, 3);
  assert.deepEqual(Object.keys(PROSE_SOURCES).sort(), ["hitchcock", "isbe", "unfoldingword-tw"]);

  const files = new Set<string>();
  const names = new Set<string>();
  const sigla = new Set<string>();
  for (const id of ALL_SOURCES) {
    const artifact = artifacts[id];
    files.add(ARTIFACT_FILE[id]);
    names.add(artifact.attribution.name);
    sigla.add(artifact.attribution.siglum);
    assert.equal(artifact.attribution.sourceId, id);
    assert.deepEqual(
      artifact.attribution,
      PROSE_SOURCES[id],
      `${id}'s shipped attribution has drifted from the module's registry`,
    );
    // Not one record in this file came from another source.
    const foreign = records[id].filter((record) => record.block.sourceId !== id);
    assert.deepEqual(foreign, [], `${id}.json carries prose attributed to another source`);
  }
  assert.equal(files.size, 3, "two sources share an output file");
  assert.equal(names.size, 3, "two sources share a credit line");
  assert.equal(sigla.size, 3, "two sources share a provenance kicker");

  // A ProseBlock's field set is closed, so there is no place for a merged
  // "prose" string to appear: one block, one sourceId, one text.
  const sample = records.isbe[0]!.block;
  assert.deepEqual(Object.keys(sample).sort(), [
    "format",
    "headword",
    "sourceEntryId",
    "sourceId",
    "text",
  ]);

  // The same name in all three sources yields three separate blocks, in three
  // separate files, in three different markup formats, and no one of them
  // contains another. Aaron is in all three.
  const aaronBlocks = [
    artifacts["unfoldingword-tw"].byEntityId["Aaron@Exo.4.14-Heb=H0175"]![0]!.block,
    artifacts.hitchcock.byNameKey.aaron![0]!.block,
    artifacts.isbe.byNameKey.aaron![0]!.block,
  ];
  assert.deepEqual(
    aaronBlocks.map((block) => block.sourceId),
    ["unfoldingword-tw", "hitchcock", "isbe"],
  );
  assert.deepEqual(
    aaronBlocks.map((block) => block.format),
    ["markdown", "plaintext", "tei"],
    "format must be declared per block so a render site never guesses",
  );
  // A `sourceEntryId` is unique only WITHIN its source — Hitchcock and ISBE both
  // key Aaron as "AARON" — so the identity of a block is the pair, and the pair
  // is what has to be distinct.
  assert.equal(
    new Set(aaronBlocks.map((block) => `${block.sourceId}:${block.sourceEntryId}`)).size,
    3,
  );
  assert.deepEqual(
    aaronBlocks.map((block) => block.sourceEntryId),
    ["names/aaron", "AARON", "AARON"],
  );
  for (const outer of aaronBlocks) {
    for (const inner of aaronBlocks) {
      if (outer === inner) continue;
      assert.ok(
        !outer.text.includes(inner.text),
        `${outer.sourceId} prose has swallowed ${inner.sourceId} prose`,
      );
    }
  }
  assert.equal(aaronBlocks[1]!.text, "a teacher; lofty; mountain of strength");
});

test("every source carries a visible date, and ISBE's is 1915", () => {
  for (const id of ALL_SOURCES) {
    const source = PROSE_SOURCES[id];
    assert.ok(source.date.length > 0, `${id} has no visible date`);
    assert.match(source.date, /^\d{4}$/, `${id}'s date is not a bare year a reader can read`);
    assert.ok(source.dateBasis.length > 20, `${id} states a date with no basis for it`);
    assert.ok(source.name.length > 0);
    assert.ok(source.attributionText.length > 0, `${id} has no attribution string`);
    assert.ok(source.riders.length > 0, `${id} declares no licence riders — even the PD ones have them`);
    assert.ok(source.changes.length > 0, `${id} declares no changes`);
  }

  // A reader weighting a claim needs to know 1915 scholarship from 2026
  // scholarship. These three strings are the ones that appear on the card.
  assert.equal(PROSE_SOURCES.isbe.date, "1915", "the reader must be told ISBE is 1915");
  assert.equal(PROSE_SOURCES.hitchcock.date, "1874");
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].date, "2026");
  assert.equal(new Set(ALL_SOURCES.map((id) => PROSE_SOURCES[id].date)).size, 3);

  // The two years that were inferred say so out loud, and the module's literal
  // "1844-1913 ed." is kept in the raw `about` rather than shown as a date.
  assert.match(PROSE_SOURCES.isbe.dateBasis, /^INFERRED/);
  assert.match(PROSE_SOURCES.hitchcock.dateBasis, /^INFERRED/);
  assert.doesNotMatch(PROSE_SOURCES["unfoldingword-tw"].dateBasis, /^INFERRED/);
  assert.match(PROSE_SOURCES.isbe.dateBasis, /1844-1913 ed\./);
  assert.match(ISBE_ABOUT, /1844-1913 ed\.$/);
  assert.doesNotMatch(PROSE_SOURCES.isbe.date, /1844/);

  // Licences and their consequences.
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].license, "CC BY-SA 4.0");
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].attributionRequired, true);
  assert.equal(PROSE_SOURCES.hitchcock.license, "Public Domain");
  assert.equal(PROSE_SOURCES.isbe.license, "Public Domain");
  assert.equal(PROSE_SOURCES.hitchcock.attributionRequired, false);
  assert.equal(PROSE_SOURCES.isbe.attributionRequired, false);
});

test("the required attribution strings are verbatim from the bytes shipped in sources/", () => {
  // unfoldingWord: both halves of the trademark rule, from the LICENSE.md that
  // ships unpacked next to the zip.
  const license = readFileSync(resolve(PROSE_DIR, "sources/en_tw-LICENSE.md"), "utf8");
  assert.ok(license.length > 500, "the shipped unfoldingWord licence is suspiciously short");
  const flatLicense = normalizeQuoted(license);
  assert.ok(
    flatLicense.includes(normalizeQuoted(UNFOLDINGWORD_TRADEMARK_RIDER)),
    "UNFOLDINGWORD_TRADEMARK_RIDER is not verbatim from the shipped LICENSE.md",
  );
  assert.ok(
    flatLicense.includes(normalizeQuoted(UNFOLDINGWORD_DERIVATIVE_RIDER)),
    "UNFOLDINGWORD_DERIVATIVE_RIDER is not verbatim from the shipped LICENSE.md",
  );
  assert.ok(
    normalizeQuoted(UNFOLDINGWORD_DERIVATIVE_RIDER).includes(
      "The original work by unfoldingWord is available from",
    ),
    "the required attribution string must be lifted out of the rider, not invented",
  );
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].attributionText, UNFOLDINGWORD_ATTRIBUTION);
  assert.deepEqual(PROSE_SOURCES["unfoldingword-tw"].riders, [
    UNFOLDINGWORD_TRADEMARK_RIDER,
    UNFOLDINGWORD_DERIVATIVE_RIDER,
  ]);
  // The two riders point in OPPOSITE directions, and which one applies turns on
  // whether we modified the prose. We did not, so the trademark stays.
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].proseUnmodified, true);
  assert.match(UNFOLDINGWORD_TRADEMARK_RIDER, /keep the unfoldingWord® trademark intact/);
  assert.match(UNFOLDINGWORD_DERIVATIVE_RIDER, /indicate what changes you have made/);

  // The two Sword modules: the constants must equal what the module's own conf
  // said, as recorded in the artefact at import time.
  const { artifacts } = fixtures();
  for (const [id, expected] of [
    ["hitchcock", HITCHCOCK_ABOUT],
    ["isbe", ISBE_ABOUT],
  ] as const) {
    const about = artifacts[id].provenance.about;
    assert.ok(about && about.length > 100, `${id} recorded no Sword About field`);
    assert.equal(
      normalizeQuoted(about),
      normalizeQuoted(expected),
      `${id}'s About constant is not verbatim from the module conf recorded at import`,
    );
  }
  // Riders survive inside a file that claims a blanket licence: Hitchcock is
  // public domain and still tells you it is an incomplete inventory, and ISBE is
  // public domain and still tells you it is OCR-derived.
  assert.ok(
    PROSE_SOURCES.hitchcock.riders.some((rider) => /uncertain meaning have been left out/.test(rider)),
    "Hitchcock's incompleteness rider is missing",
  );
  assert.ok(
    PROSE_SOURCES.isbe.riders.some((rider) => /OCR/.test(rider)),
    "ISBE's OCR rider is missing",
  );
  assert.ok(HITCHCOCK_ABOUT.includes("It is out of copyright, so feel free to copy and distribute it."));
});

test("each artefact's provenance sha256 matches the raw bytes shipped beside it", () => {
  const { artifacts } = fixtures();
  for (const id of ALL_SOURCES) {
    const provenance = artifacts[id].provenance;
    assert.ok(provenance.upstream.startsWith("https://"), `${id} has no upstream URL`);
    assert.ok(provenance.upstreamVersion.length > 0, `${id} pins no upstream version`);
    assert.equal(provenance.retrievedAt, "2026-07-26");
    const raw = readFileSync(resolve(PROSE_DIR, provenance.rawFile));
    assert.ok(raw.length > 0, `${id} ships an empty raw source`);
    assert.equal(
      createHash("sha256").update(raw).digest("hex"),
      provenance.sourceSha256,
      `${id}'s recorded sha256 does not match ${provenance.rawFile} on disk`,
    );
  }
  // The Sword modules are binary, so the intermediate we actually parsed is
  // hashed too — that is the byte-level claim behind "verbatim".
  assert.ok(artifacts.hitchcock.provenance.intermediateSha256);
  assert.ok(artifacts.isbe.provenance.intermediateSha256);
  assert.equal(artifacts["unfoldingword-tw"].provenance.intermediateSha256, undefined);
});

// ───────────────────────────────────────────────────────────────────────────
// 5 — What each source IS, measured. Hitchcock etymology, ISBE article.
// ───────────────────────────────────────────────────────────────────────────

test("Hitchcock is etymology-only: 2,625 definitions, median 20 characters, longest 64", () => {
  const records = fixtures().records.hitchcock;
  const lengths = records.map((record) => record.block.text.length);
  assert.ok(lengths.length > 0, "no Hitchcock definitions to measure");
  assert.equal(lengths.length, 2625);

  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  assert.ok(shortest > 0, "a Hitchcock definition is empty");
  assert.equal(shortest, 2, "shortest Hitchcock definition drifted");
  assert.equal(median(lengths), 20, "median Hitchcock definition length drifted");
  assert.equal(longest, 64, "longest Hitchcock definition drifted");
  assert.equal(Math.round(mean(lengths) * 10) / 10, 22.2, "mean Hitchcock definition length drifted");

  // The claim is a measurement, not a hunch: the LONGEST entry in the whole
  // dictionary is 64 characters, so there is no article-length prose in here at
  // all. Nothing exceeds even a single line.
  assert.equal(lengths.filter((length) => length > 120).length, 0, "a Hitchcock entry is longer than one line");
  assert.ok(longest < 100);

  // The form is "sense; sense; sense" — a gloss of the word, equally true of
  // every bearer, which is why the source is declared name-only.
  const withSenseSeparator = records.filter((record) => record.block.text.includes(";")).length;
  assert.equal(withSenseSeparator, 1273, "Hitchcock entries carrying `;` sense lists drifted");
  assert.ok(withSenseSeparator > lengths.length * 0.4);
  assert.equal(PROSE_SOURCES.hitchcock.granularity, "name-only");
  assert.equal(fixtures().artifacts.hitchcock.counts.personScoped, 0);

  // 1,875 of the 2,625 land on a TIPNR name, and every one of them stays
  // name-scoped even where TIPNR knows exactly one bearer.
  assert.equal(fixtures().artifacts.hitchcock.counts.matchedTipnr, 1875);
  const soleBearerMatches = records.filter((record) => bearersOf(record.nameKey).length === 1);
  assert.ok(soleBearerMatches.length > 0, "no sole-bearer Hitchcock entry to check the rule against");
  assert.equal(soleBearerMatches.length, 1362, "Hitchcock entries on a sole-bearer name drifted");
  for (const record of soleBearerMatches) {
    assert.ok(isNameScoped(record));
    assert.equal(record.unboundReason, "source-is-name-level");
  }
});

test("ISBE is article-length: median 405 characters of visible text against Hitchcock's 20", () => {
  const articles = isbeArticles();
  const segments = isbeSegments();
  assert.equal(articles.length, 2591);
  assert.equal(segments.length, 2066);
  assert.ok(articles.length > 0 && segments.length > 0);

  const articleLengths = articles.map((record) => stripTeiTags(record.block.text).length);
  const segmentLengths = segments.map((record) => stripTeiTags(record.block.text).length);
  const hitchcockMedian = median(fixtures().records.hitchcock.map((record) => record.block.text.length));

  assert.equal(median(articleLengths), 405, "median ISBE article length drifted");
  assert.equal(Math.round(mean(articleLengths)), 1871, "mean ISBE article length drifted");
  assert.equal(Math.max(...articleLengths), 175_160, "longest ISBE article drifted");

  // Two orders of magnitude apart at the median, and the mean is dragged up by
  // genuinely long articles. This is the difference between a gloss and an
  // encyclopedia entry, and it is why only one of them can be read as a life.
  assert.ok(
    median(articleLengths) > hitchcockMedian * 15,
    `ISBE median ${median(articleLengths)} vs Hitchcock ${hitchcockMedian} — the two sources are no longer different in kind`,
  );
  assert.equal(articleLengths.filter((length) => length > 400).length, 1301);
  assert.equal(articleLengths.filter((length) => length > 200).length, 1810);
  assert.ok(articleLengths.filter((length) => length > 2000).length > 300);

  // A roster paragraph sits between the two: longer than a gloss, far shorter
  // than the article it was cut from. That is what a per-person note looks like.
  assert.equal(median(segmentLengths), 111, "median ISBE roster segment length drifted");
  assert.ok(median(segmentLengths) < median(articleLengths));
  assert.ok(median(segmentLengths) > hitchcockMedian);
  assert.equal(Math.min(...segmentLengths), 10);

  assert.equal(PROSE_SOURCES.isbe.granularity, "name-and-individual");
  assert.equal(PROSE_SOURCES["unfoldingword-tw"].granularity, "name-and-individual");
});

// ───────────────────────────────────────────────────────────────────────────
// 6 — ISBE's numbered homonyms: the person-level hook tW does not have.
// ───────────────────────────────────────────────────────────────────────────

test("ISBE's `(N)` headword suffix parses on every one of the 216 imported keys", () => {
  const keys = isbeArticles().map((record) => record.block.sourceEntryId);
  assert.equal(keys.length, 2591);
  assert.equal(new Set(keys).size, 2591, "two ISBE articles share a source entry id");

  const numbered = keys.filter((key) => /\(\d+\)\s*$/.test(key));
  assert.ok(numbered.length > 0, "no numbered ISBE headwords found — the convention must have changed");
  assert.equal(numbered.length, 216, "imported keys ending in `(N)` drifted");

  const bases = new Map<string, number[]>();
  let parsed = 0;
  const failed: string[] = [];
  for (const key of numbered) {
    const marker = /\((\d+)\)\s*$/.exec(key)![1]!;
    const ordinals = parseIsbeOrdinals(marker);
    if (ordinals && ordinals.length === 1 && ordinals[0] === Number(marker)) parsed += 1;
    else failed.push(key);
    const base = key.replace(/\s*\(\d+\)\s*$/, "");
    const bucket = bases.get(base) ?? [];
    bucket.push(Number(marker));
    bases.set(base, bucket);
  }
  assert.deepEqual(failed, [], "an ISBE `(N)` headword did not parse");
  assert.equal(parsed, 216, "every numbered headword must parse — this is the reliability claim");
  assert.equal(bases.size, 105, "distinct numbered bases drifted");

  // 103 of the 105 run 1…N with no gaps. The two that do not are gaps left by
  // the import filter — only entries whose name matches TIPNR are imported, so
  // BILHAN (1)/(2) and DAN (1) were never brought across. That is a filter
  // artefact, NOT a parse failure, and the distinction matters: every ordinal
  // present parsed.
  const gapped = [...bases.entries()]
    .filter(([, ordinals]) => {
      const sorted = [...ordinals].sort((a, b) => a - b);
      return !sorted.every((value, index) => value === index + 1);
    })
    .map(([base, ordinals]) => [base, [...ordinals].sort((a, b) => a - b)] as const);
  assert.deepEqual(gapped, [
    ["BILHAN", [3]],
    ["DAN", [2, 3]],
  ]);
  assert.equal(bases.size - gapped.length, 103);
  assert.deepEqual(bases.get("GAD"), [1, 2, 3, 4], "GAD's four-part homonym split drifted");

  // And the point about AZARIAH: it has NO `(N)` headword at all. Its nineteen
  // men are numbered INSIDE one article, which is why the segment parse below is
  // the hook that matters rather than the key suffix.
  assert.deepEqual(keys.filter((key) => /^AZARIAH/.test(key)), ["AZARIAH"]);
});

test("ISBE's in-article `(N)` markers: 2,931 of 3,222 parse, and the 291 that do not are outline letters", () => {
  const articles = isbeArticles();
  assert.ok(articles.length > 0);

  let markerParagraphs = 0;
  let parsed = 0;
  const unparsed: string[] = [];
  let rosterEntries = 0;
  let rosterSegments = 0;

  for (const record of articles) {
    const body = record.block.text;
    for (const paragraph of body.matchAll(/<p>([\s\S]*?)<\/p>/g)) {
      const visible = stripTeiTags(paragraph[1]!).trim();
      const marker = /^\(([^)]{1,24})\)/.exec(visible)?.[1];
      if (marker === undefined) continue;
      markerParagraphs += 1;
      if (parseIsbeOrdinals(marker)) parsed += 1;
      else unparsed.push(marker.trim());
    }
    const { segments, hasRosterShape } = segmentIsbeRoster(body, osisResolver);
    if (!hasRosterShape) continue;
    rosterEntries += 1;
    rosterSegments += segments.length;
  }

  assert.ok(markerParagraphs > 0, "no parenthesised paragraph markers found at all");
  assert.equal(markerParagraphs, 3222, "paragraphs opening with a parenthesised marker drifted");
  assert.equal(parsed, 2931, "markers that parse as ordinals drifted");
  assert.equal(unparsed.length, 291, "markers that do not parse drifted");
  assert.equal(parsed + unparsed.length, markerParagraphs);
  assert.ok(parsed / markerParagraphs > 0.9, "the numeric marker parse rate has fallen below 90%");

  // The 291 refusals are correct refusals, not misses: not one of them starts
  // with a digit. They are outline markers — `(a)`, `(b)` — and prose asides.
  const numericLooking = unparsed.filter((marker) => /^\d/.test(marker));
  assert.deepEqual(numericLooking, [], "a numeric-looking marker was refused by the ordinal parser");
  const distinct = [...new Set(unparsed)].sort();
  assert.ok(distinct.length > 0);
  assert.ok(distinct.includes("a") && distinct.includes("b"), "letter outline markers must be among the refusals");
  assert.ok(distinct.includes("Apocrypha"));

  // Re-segmenting the stored TEI reproduces the importer's own yield exactly:
  // 606 roster entries, 2,066 segments. So the artefact is what the parser says.
  const counts = fixtures().artifacts.isbe.counts;
  assert.equal(rosterEntries, 606);
  assert.equal(rosterSegments, 2066);
  assert.equal(rosterEntries, counts.rosterEntries);
  assert.equal(rosterSegments, counts.rosterSegments);
  assert.equal(rosterSegments, isbeSegments().length);
});

test("the marker reader handles every numeric form the module uses and refuses the rest", () => {
  assert.deepEqual(parseIsbeOrdinals("3"), [3]);
  assert.deepEqual(parseIsbeOrdinals(" 7 "), [7]);
  assert.deepEqual(parseIsbeOrdinals("10 and 11"), [10, 11]);
  assert.deepEqual(parseIsbeOrdinals("2, 3"), [2, 3]);
  assert.deepEqual(parseIsbeOrdinals("4-6"), [4, 5, 6]);
  assert.deepEqual(parseIsbeOrdinals("4–6"), [4, 5, 6], "en dash ranges appear in the module");
  assert.equal(parseIsbeOrdinals("a"), null);
  assert.equal(parseIsbeOrdinals("iv"), null);
  assert.equal(parseIsbeOrdinals("Apocrypha"), null);
  assert.equal(parseIsbeOrdinals("See 2Sa 3:6-38."), null);
  assert.equal(parseIsbeOrdinals("6-4"), null, "a reversed range is not a marker");
  assert.equal(parseIsbeOrdinals("1-500"), null, "an absurd range is refused rather than expanded");

  // A marker covering several men can never bind, and the shipped artefact has
  // exactly 11 of them.
  assert.equal(fixtures().artifacts.isbe.counts.segmentsCoveringManyIndividuals, 11);
  const many = isbeSegments().filter(
    (record) => isNameScoped(record) && record.unboundReason === "marker-covers-many-individuals",
  );
  assert.equal(many.length, 11);
  assert.ok(many.length > 0);
  for (const record of many) {
    assert.match(record.block.sourceEntryId, /#\d+\+\d+/, "a multi-ordinal segment id must show both ordinals");
  }
});

test("the sub-entry hook reaches individuals that translationWords cannot: 1,265 people, 364 names", () => {
  const segments = isbeSegments();
  const bound = segments.filter(isPersonScoped);
  const unbound = segments.filter(isNameScoped);
  assert.ok(bound.length > 0, "no ISBE segment bound to a person — the hook did not work at all");

  assert.equal(bound.length, 1265, "segments bound to exactly one person drifted");
  assert.equal(unbound.length, 801);
  assert.equal(bound.length + unbound.length, 2066);
  assert.equal(new Set(bound.map((record) => record.entityId)).size, 1265, "one person, at most one account");

  // Why the other 801 did not bind, pinned. Each of these is a refusal the
  // module chose over a guess.
  const reasons = new Map<string, number>();
  for (const record of unbound) {
    const reason = record.unboundReason ?? "(none)";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  assert.deepEqual(
    [...reasons.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    [
      ["no-reference-evidence", 346],
      ["reference-matches-no-bearer", 232],
      ["many-subentries-bind-to-same-bearer", 122],
      ["reference-matches-many-bearers", 90],
      ["marker-covers-many-individuals", 11],
    ],
    "the distribution of ISBE binding refusals drifted",
  );

  // The payoff, stated as a comparison. 481 names got at least one individual
  // out of ISBE and 364 of them got two or more — where translationWords, on the
  // same 124 ambiguous names, reached exactly nobody.
  const perName = new Map<string, number>();
  for (const record of bound) perName.set(record.nameKey, (perName.get(record.nameKey) ?? 0) + 1);
  assert.equal(perName.size, 481, "names with at least one ISBE individual drifted");
  assert.equal([...perName.values()].filter((count) => count >= 2).length, 364);
  const ranked = [...perName.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  assert.deepEqual(ranked.slice(0, 4), [
    ["shemaiah", 22],
    ["zechariah", 22],
    ["hananiah", 13],
    ["azariah", 12],
  ]);

  const twAmbiguous = twNamesRecords().filter((record) => bearersOf(record.nameKey).length > 1);
  assert.equal(twAmbiguous.length, 124);
  assert.equal(
    twAmbiguous.filter(isPersonScoped).length,
    0,
    "translationWords reached an individual on an ambiguous name, which it has no key for",
  );
});

test("AZARIAH: ISBE resolves 12 of the 19 men by verse, and refuses the other 10 segments", () => {
  const azariah = fixtures().records.isbe.filter((record) => record.nameKey === "azariah");
  assert.ok(azariah.length > 0, "ISBE has no Azariah records to measure");
  assert.equal(azariah.length, 23, "ISBE Azariah records drifted (1 article + 22 roster segments)");

  const article = azariah.filter((record) => !record.block.sourceEntryId.includes("#"));
  assert.equal(article.length, 1);
  const whole = article[0]!;
  assert.ok(isNameScoped(whole), "the whole AZARIAH article must never be one man's account");
  assert.equal(whole.unboundReason, "block-is-name-level");
  // The label carries ISBE's own uppercase headword, because display always uses
  // the source's spelling and never the lookup key. Same count, same caveat, the
  // source's own house style.
  const ISBE_AZARIAH_LABEL = "Shared by 19 people named AZARIAH";
  assert.equal(whole.displayTerm, "AZARIAH");
  assert.equal(whole.scopeLabel, ISBE_AZARIAH_LABEL);
  assert.equal(
    fixtures().artifacts["unfoldingword-tw"].byNameKey.azariah![0]!.scopeLabel,
    "Shared by 19 people named Azariah",
    "the same 19 bearers, spelled the way translationWords spells them",
  );

  const bound = azariah.filter(isPersonScoped);
  assert.equal(bound.length, 12, "Azariah sub-entries bound to an individual drifted");
  assert.ok(bound.length > 1, "the hook must reach SEVERAL Azariahs, or it is not a person-level hook");
  assert.equal(new Set(bound.map((record) => record.entityId)).size, 12);

  for (const record of bound) {
    assert.equal(record.boundBy.kind, "isbe-subentry-reference");
    assert.ok(record.boundBy.kind === "isbe-subentry-reference");
    assert.equal(record.boundBy.bearerCount, 19, "the binding must remember it beat 19 candidates");
    assert.ok(record.boundBy.evidenceRefs.length > 0);
    assert.match(record.block.sourceEntryId, /^AZARIAH#\d+$/);
    assert.equal(
      Number(record.block.sourceEntryId.split("#")[1]),
      record.boundBy.ordinal,
      "the record id must carry the ordinal ISBE itself printed",
    );
    const bearer = bearersOf("azariah").find((candidate) => candidate.entityId === record.entityId);
    assert.ok(bearer, `${record.entityId} is not one of the nineteen`);
    for (const ref of record.boundBy.evidenceRefs) {
      assert.ok(bearer.refs.includes(ref), `${ref} is not a verse TIPNR gives ${record.entityId}`);
    }
  }
  // Ordinal 2 → the Azariah of 1 Chronicles 2:8, by that verse and no other.
  const second = bound.find(
    (record) => record.boundBy.kind === "isbe-subentry-reference" && record.boundBy.ordinal === 2,
  );
  assert.ok(second, "AZARIAH#2 did not bind");
  assert.equal(second.entityId, "Azariah@1Ch.2.8=H5838I");
  assert.deepEqual(
    second.boundBy.kind === "isbe-subentry-reference" ? second.boundBy.evidenceRefs : [],
    ["1CH.2.8"],
  );

  const refused = azariah.filter(isNameScoped).filter((record) => record.block.sourceEntryId.includes("#"));
  assert.equal(refused.length, 10);
  const reasons = new Map<string, number>();
  for (const record of refused) {
    const reason = record.unboundReason ?? "(none)";
    reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
  }
  assert.deepEqual(
    [...reasons.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    [
      ["marker-covers-many-individuals", 1],
      ["no-reference-evidence", 1],
      ["reference-matches-many-bearers", 3],
      ["reference-matches-no-bearer", 5],
    ],
    "Azariah's refusal reasons drifted",
  );
  // Every one of the ten still carries the caveat, so a render site that shows
  // them shows them under the name.
  for (const record of refused) assert.equal(record.scopeLabel, ISBE_AZARIAH_LABEL);
});

// ───────────────────────────────────────────────────────────────────────────
// 7 — Small parsers the above leans on.
// ───────────────────────────────────────────────────────────────────────────

test("the name key is the form that reproduces the 306/685/124/182 measurement", () => {
  // The three sources punctuate the same name three ways; the key is what makes
  // them the same key. TIPNR and ISBE also spell it differently (maachah /
  // maacah), which is a genuine miss the key cannot fix and does not pretend to.
  assert.equal(proseNameKey("Abel-beth-maachah"), "abelbethmaachah");
  assert.equal(proseNameKey("ABEL-BETH-MAACAH"), "abelbethmaacah");
  assert.equal(proseNameKey("Abel Beth Maacah"), "abelbethmaacah");
  assert.equal(proseNameKey("abelbethmaacah"), "abelbethmaacah");
  assert.equal(proseNameKey("Jesus Christ"), "jesuschrist");
  assert.equal(proseNameKey("  Bath-sheba's  "), "bathshebas");
  assert.equal(proseNameKey("!!!"), "", "a key that reduces to nothing must be empty, not a wildcard");
  // Lossy and lookup-only: display always comes off the block's own headword.
  const aaron = fixtures().artifacts.hitchcock.byNameKey.aaron![0]!;
  assert.equal(aaron.nameKey, "aaron");
  assert.equal(aaron.block.headword, "Aaron", "display must use the source's own spelling");
});

test("unfoldingWord's Strong's padding is read as base + variant, not as one integer", () => {
  const hebrew = parseUnfoldingWordStrongs("H0175");
  assert.ok(hebrew);
  assert.equal(hebrew.base, "H175");
  assert.equal(hebrew.variant, null);

  // G00020 is Strong's G2 with variant index 0 — NOT G20. This is the reading
  // the shared canonicaliser cannot know, which is why the module has its own.
  const greek = parseUnfoldingWordStrongs("G00020");
  assert.ok(greek);
  assert.equal(greek.base, "G2");
  assert.equal(greek.variant, "0");
  assert.equal(canonicalStrongsKey("G00020"), "G20", "the shared parser's answer, documented as wrong here");
  assert.notEqual(greek.base, canonicalStrongsKey("G00020"));

  const variant = parseUnfoldingWordStrongs("G43195");
  assert.ok(variant);
  assert.equal(variant.base, "G4319");
  assert.equal(variant.variant, "5");

  assert.equal(parseUnfoldingWordStrongs("G20"), null, "an unpadded token is not the corpus's form");
  assert.equal(parseUnfoldingWordStrongs("H175"), null);
  assert.equal(parseUnfoldingWordStrongs(""), null);
  // The importer measured 762 tokens with 0 unreadable, and refuses to write on
  // a single unreadable one.
  const counts = fixtures().artifacts["unfoldingword-tw"].counts;
  assert.equal(counts.strongsTokens, 762);
  assert.equal(counts.strongsHebrew, 475);
  assert.equal(counts.strongsGreek, 287);
  assert.equal((counts.strongsHebrew ?? 0) + (counts.strongsGreek ?? 0), 762);
  assert.equal(counts.unparsedStrongsTokens, 0);
  assert.equal(counts.unparsedFiles, 0);
});

test("formatNameScopeLabel counts people and places separately and never says `this person`", () => {
  const person = (id: string): NameBearer => ({ entityId: id, kind: "person", displayName: "X", refs: [] });
  const place = (id: string): NameBearer => ({ entityId: id, kind: "place", displayName: "X", refs: [] });
  assert.equal(formatNameScopeLabel("Nobody", []), "About the name Nobody");
  assert.equal(formatNameScopeLabel("Aaron", [person("a")]), "About the name Aaron");
  assert.equal(formatNameScopeLabel("Joel", [person("a"), person("b")]), "Shared by 2 people named Joel");
  assert.equal(
    formatNameScopeLabel("Abel", [person("a"), place("b")]),
    "Shared by 1 person and 1 place named Abel",
  );
  // Abel really is one person and one place in TIPNR, which is why the label has
  // to be able to say so rather than assuming everything is a man.
  assert.equal(
    formatNameScopeLabel("Abel", bearersOf("abel")),
    "Shared by 1 person and 1 place named Abel",
  );
  for (const record of allRecords()) {
    if (!isNameScoped(record)) continue;
    assert.doesNotMatch(record.scopeLabel, /\bthis (person|man|woman)\b/i);
  }
});
