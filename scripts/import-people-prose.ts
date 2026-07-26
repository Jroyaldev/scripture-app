/**
 * Import the three PEOPLE/PLACE prose sources, one separately attributed
 * artefact each, with the granularity guard applied at build time.
 *
 *   npm run import:people-prose            # all three
 *   npm run import:people-prose -- tw      # unfoldingWord translationWords
 *   npm run import:people-prose -- hitchcock
 *   npm run import:people-prose -- isbe
 *
 * I/O only. Every parsing decision lives in `src/core/entities/people-prose.ts`.
 *
 * RAW INPUTS, shipped byte-identical to upstream in `sources/`:
 *
 *   en_tw.zip        961,271 b  git.door43.org/unfoldingWord/en_tw @ 7198591
 *   en_tw-LICENSE.md   1,308 b  the CC BY-SA 4.0 notice and trademark rules,
 *                               shipped unpacked because a licence that a reader
 *                               has to unzip is not a licence a reader will read
 *   Hitchcock.zip     91,660 b  crosswire.org .../rawzip/Hitchcock.zip, v2.0
 *   ISBE.zip       9,987,447 b  crosswire.org .../rawzip/ISBE.zip, v2.2
 *
 * The two Sword modules are zLD — a compressed binary dictionary driver. They
 * are read with CrossWire's OWN reference tool, `mod2imp`, which is the
 * published way to read a published module; nothing is lifted out of another
 * application's index. `mod2imp` must be on PATH (`brew install sword`), or pass
 * `--imp <file>` with a dump you made earlier. The sha256 of the intermediate is
 * recorded in the artefact so a later run can prove it read the same bytes.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOsisVerseId } from "../src/core/language/oshb-osis.js";
import {
  PROSE_SOURCES,
  artifactRecords,
  auditProseGranularity,
  bearersByName,
  collectProseRecords,
  hitchcockBlock,
  isbeArticleBlock,
  isbeSegmentBlock,
  parseHitchcockImp,
  parseIsbeImp,
  parseTranslationWordsEntry,
  proseNameKey,
  scopeProse,
  resolveSubEntryCollisions,
  segmentIsbeRoster,
  translationWordsBlock,
  type NameBearer,
  type PeopleProseArtifact,
  type ProseRecord,
  type ProseSourceId,
} from "../src/core/entities/people-prose.js";

const HERE = fileURLToPath(import.meta.url);
const ROOT = resolve(HERE, "../..");
const OUT_DIR = resolve(ROOT, "data/scripture/names/people-prose");
const SOURCE_DIR = join(OUT_DIR, "sources");
const TIPNR_INDEX = resolve(ROOT, "data/scripture/names/tipnr-index.json");

/** Upstream provenance, pinned. Change these only alongside a new raw file. */
const UPSTREAM = {
  "unfoldingword-tw": {
    url: "https://git.door43.org/unfoldingWord/en_tw",
    rawFile: "sources/en_tw.zip",
    version: "master @ 71985910318bc7b3d551d40d76df41901319108d (2026-07-16), manifest version 89, issued 2026-06-24",
    retrievedAt: "2026-07-26",
  },
  hitchcock: {
    url: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/Hitchcock.zip",
    rawFile: "sources/Hitchcock.zip",
    version: 'CrossWire Sword module "Hitchcock" Version=2.0, History_2.0 "(2022-06-04) New build from CCEL text (2022)"',
    retrievedAt: "2026-07-26",
  },
  isbe: {
    url: "https://www.crosswire.org/ftpmirror/pub/sword/packages/rawzip/ISBE.zip",
    rawFile: "sources/ISBE.zip",
    version: 'CrossWire Sword module "ISBE" Version=2.2, SwordVersionDate=2009-09-07',
    retrievedAt: "2026-07-26",
  },
} as const satisfies Record<ProseSourceId, { url: string; rawFile: string; version: string; retrievedAt: string }>;

const OUTPUT_FILE: Record<ProseSourceId, string> = {
  "unfoldingword-tw": "unfoldingword-tw.json",
  hitchcock: "hitchcock.json",
  isbe: "isbe.json",
};

type TipnrShape = {
  source: string;
  license: string;
  sourceSha256: string;
  entityCount: number;
  entities: Record<string, { kind: string; displayName: string; refs: string[] }>;
};

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function unzipTo(zip: string, dir: string): void {
  execFileSync("unzip", ["-o", "-q", zip, "-d", dir], { stdio: ["ignore", "ignore", "inherit"] });
}

/**
 * Dump a Sword module to IMP with CrossWire's own tool. `SWORD_PATH` points at
 * the unzipped module tree; `mod2imp` writes the dump to stdout.
 */
function dumpSwordModule(moduleRoot: string, moduleName: string): string {
  try {
    return execFileSync("mod2imp", [moduleName], {
      env: { ...process.env, SWORD_PATH: moduleRoot },
      encoding: "utf8",
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Could not run mod2imp for module "${moduleName}". It is CrossWire's reference reader for the ` +
        `zLD binary dictionary format and there is no pure-TypeScript substitute in this repo. ` +
        `Install it (macOS: brew install sword) or pass --imp <file> with a dump made earlier. ` +
        `Underlying error: ${(error as Error).message}`,
    );
  }
}

function loadTipnr(): { meta: PeopleProseArtifact["tipnr"]; bearers: Map<string, NameBearer[]> } {
  if (!existsSync(TIPNR_INDEX)) throw new Error(`Missing TIPNR index: ${TIPNR_INDEX}`);
  const index = JSON.parse(readFileSync(TIPNR_INDEX, "utf8")) as TipnrShape;
  const bearers = bearersByName(index.entities);
  if (bearers.size === 0) throw new Error("TIPNR bearer table is empty — refusing to scope against nothing");
  return {
    meta: {
      source: index.source,
      license: index.license,
      sourceSha256: index.sourceSha256,
      entityCount: index.entityCount,
    },
    bearers,
  };
}

function writeArtifact(artifact: PeopleProseArtifact): { path: string; bytes: number } {
  const path = join(OUT_DIR, OUTPUT_FILE[artifact.sourceId]);
  const text = `${JSON.stringify(artifact)}\n`;
  writeFileSync(path, text);
  return { path, bytes: Buffer.byteLength(text) };
}

/**
 * Every importer asserts non-zero on the things it claims to have found. A run
 * that parses nothing and reports no errors is a false pass.
 */
function assertNonZero(counts: Record<string, number>, required: readonly string[]): void {
  for (const key of required) {
    const value = counts[key];
    if (!value) throw new Error(`Refusing to write an artefact with ${key} = ${value ?? "undefined"}`);
  }
}

/** Increment a counter without tripping over `noUncheckedIndexedAccess`. */
function bump(counts: Record<string, number>, key: string, by = 1): void {
  counts[key] = (counts[key] ?? 0) + by;
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 1 — unfoldingWord translationWords
// ────────────────────────────────────────────────────────────────────────────

/**
 * `bible/names` is the corpus. `bible/kt` is imported only for the entries whose
 * name matches a TIPNR entity — measured, 13 of 190 (israel, jesus, satan,
 * hebrew, pharisee, sadducee, rabbi, passover, sabbath, lord, ephod, holyplace,
 * sin) — because the other 177 are theological terms that have no business in a
 * people-and-places index. `bible/other` is not imported at all: 4 of its 408
 * files match a TIPNR name and all four are TIPNR kind "other" (bear, judaism,
 * newmoon, selah), so it contributes no person and no place.
 */
function importTranslationWords(bearers: Map<string, NameBearer[]>, tipnr: PeopleProseArtifact["tipnr"]): PeopleProseArtifact {
  const zip = join(SOURCE_DIR, "en_tw.zip");
  if (!existsSync(zip)) throw new Error(`Missing raw source: ${zip}`);
  const work = mkdtempSync(join(tmpdir(), "en-tw-"));
  try {
    unzipTo(zip, work);
    const roots = readdirSync(work).map((name) => join(work, name));
    const repo = roots.find((path) => existsSync(join(path, "bible", "names")));
    if (!repo) throw new Error(`en_tw.zip does not contain bible/names (looked in ${roots.join(", ")})`);

    const records: ProseRecord[] = [];
    const counts: Record<string, number> = {
      namesFiles: 0,
      ktFiles: 0,
      ktImported: 0,
      parsed: 0,
      unparsedFiles: 0,
      matchedTipnr: 0,
      personScoped: 0,
      nameScoped: 0,
      selfDeclaredMultiPerson: 0,
      selfDeclaredMultiPersonThatAlsoMeasureMulti: 0,
      strongsTokens: 0,
      strongsHebrew: 0,
      strongsGreek: 0,
      strongsGreekWithVariant: 0,
      unparsedStrongsTokens: 0,
    };
    const ambiguous: Array<{ slug: string; bearers: number }> = [];
    const unparsedStrongs: string[] = [];

    for (const collection of ["names", "kt"] as const) {
      const dir = join(repo, "bible", collection);
      const files = readdirSync(dir).filter((name) => name.endsWith(".md")).sort();
      counts[collection === "names" ? "namesFiles" : "ktFiles"] = files.length;
      for (const file of files) {
        const slug = file.slice(0, -3);
        const nameKey = proseNameKey(slug);
        const found = bearers.get(nameKey) ?? [];
        if (collection === "kt" && found.length === 0) continue;
        const entry = parseTranslationWordsEntry(slug, collection, readFileSync(join(dir, file), "utf8"));
        if (!entry) {
          bump(counts, "unparsedFiles", 1);
          continue;
        }
        bump(counts, "parsed", 1);
        if (collection === "kt") bump(counts, "ktImported", 1);
        for (const token of entry.strongs) {
          bump(counts, "strongsTokens", 1);
          if (token.testament === "H") bump(counts, "strongsHebrew", 1);
          else {
            bump(counts, "strongsGreek", 1);
            if (token.variant && token.variant !== "0") bump(counts, "strongsGreekWithVariant", 1);
          }
        }
        bump(counts, "unparsedStrongsTokens", entry.unparsedStrongs.length);
        unparsedStrongs.push(...entry.unparsedStrongs.map((token) => `${slug}:${token}`));
        if (entry.selfDeclaredMultiPerson) {
          bump(counts, "selfDeclaredMultiPerson", 1);
          if (found.length > 1) bump(counts, "selfDeclaredMultiPersonThatAlsoMeasureMulti", 1);
        }
        if (found.length > 0) bump(counts, "matchedTipnr", 1);
        if (found.length > 1) ambiguous.push({ slug, bearers: found.length });

        const record = scopeProse({
          block: translationWordsBlock(entry),
          displayTerm: entry.headword,
          nameKey,
          bearers: found,
        });
        records.push(record);
        bump(counts, record.granularity === "person" ? "personScoped" : "nameScoped");
      }
    }

    assertNonZero(counts, ["namesFiles", "parsed", "matchedTipnr", "personScoped", "nameScoped", "strongsTokens", "ktImported"]);
    if ((counts.unparsedStrongsTokens ?? 0) > 0) {
      throw new Error(`Unreadable Strong's tokens in Word Data: ${unparsedStrongs.slice(0, 10).join(", ")}`);
    }
    ambiguous.sort((a, b) => b.bearers - a.bearers || a.slug.localeCompare(b.slug));

    const { byNameKey, byEntityId } = collectProseRecords(records);
    return {
      formatVersion: 1,
      sourceId: "unfoldingword-tw",
      attribution: PROSE_SOURCES["unfoldingword-tw"],
      provenance: {
        upstream: UPSTREAM["unfoldingword-tw"].url,
        rawFile: UPSTREAM["unfoldingword-tw"].rawFile,
        sourceSha256: sha256(readFileSync(zip)),
        upstreamVersion: UPSTREAM["unfoldingword-tw"].version,
        retrievedAt: UPSTREAM["unfoldingword-tw"].retrievedAt,
      },
      generatedAt: new Date().toISOString(),
      tipnr,
      counts: {
        ...counts,
        ambiguousNames: ambiguous.length,
        mostAmbiguousBearerCount: ambiguous[0]?.bearers ?? 0,
      },
      byNameKey,
      byEntityId,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 2 — Hitchcock
// ────────────────────────────────────────────────────────────────────────────

function importHitchcock(
  bearers: Map<string, NameBearer[]>,
  tipnr: PeopleProseArtifact["tipnr"],
  impOverride: string | null,
): PeopleProseArtifact {
  const zip = join(SOURCE_DIR, "Hitchcock.zip");
  if (!existsSync(zip)) throw new Error(`Missing raw source: ${zip}`);
  const { imp, about } = readSwordModule(zip, "Hitchcock", "hitchcock.conf", impOverride);
  const { entries, malformedRecords } = parseHitchcockImp(imp);
  if (entries.length === 0) throw new Error("Hitchcock parsed 0 entries");

  const records: ProseRecord[] = [];
  const counts: Record<string, number> = {
    swordRecords: imp.split("\n").filter((line) => line.startsWith("$$$")).length,
    definitionBlocks: entries.length,
    distinctKeys: new Set(entries.map((entry) => entry.key)).size,
    duplicatedKeys: 0,
    recoveredHeadwords: 0,
    editorialTextStripped: 0,
    matchedTipnr: 0,
    nameScoped: 0,
    personScoped: 0,
    malformedRecords: malformedRecords.length,
  };
  const perKey = new Map<string, number>();
  for (const entry of entries) perKey.set(entry.key, (perKey.get(entry.key) ?? 0) + 1);
  counts.duplicatedKeys = [...perKey.values()].filter((n) => n > 1).length;

  for (const entry of entries) {
    if (entry.recoveredHeadword) bump(counts, "recoveredHeadwords", 1);
    if (entry.droppedEditorialText) bump(counts, "editorialTextStripped", 1);
    const nameKey = proseNameKey(entry.headword);
    const found = bearers.get(nameKey) ?? [];
    if (found.length > 0) bump(counts, "matchedTipnr", 1);
    const record = scopeProse({
      block: hitchcockBlock(entry),
      displayTerm: entry.headword,
      nameKey,
      bearers: found,
    });
    records.push(record);
    bump(counts, record.granularity === "person" ? "personScoped" : "nameScoped");
  }

  // Hitchcock is declared name-only, so a person-scoped Hitchcock record would
  // mean the guard had been bypassed. Fail the build rather than ship it.
  if (counts.personScoped !== 0) {
    throw new Error(`Hitchcock is a name-level etymology source but produced ${counts.personScoped} person-scoped records`);
  }
  assertNonZero(counts, ["swordRecords", "definitionBlocks", "matchedTipnr", "nameScoped", "recoveredHeadwords"]);

  const { byNameKey, byEntityId } = collectProseRecords(records);
  return {
    formatVersion: 1,
    sourceId: "hitchcock",
    attribution: PROSE_SOURCES.hitchcock,
    provenance: {
      upstream: UPSTREAM.hitchcock.url,
      rawFile: UPSTREAM.hitchcock.rawFile,
      sourceSha256: sha256(readFileSync(zip)),
      upstreamVersion: UPSTREAM.hitchcock.version,
      intermediateSha256: sha256(imp),
      about,
      retrievedAt: UPSTREAM.hitchcock.retrievedAt,
    },
    generatedAt: new Date().toISOString(),
    tipnr,
    counts,
    byNameKey,
    byEntityId,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Mode 3 — ISBE
// ────────────────────────────────────────────────────────────────────────────

/**
 * Only entries whose headword — or one of its semicolon-separated spelling
 * variants — names a TIPNR entity are imported: 2,591 of 9,380. The other 6,789
 * are topical articles (GENEALOGY, SACRIFICE, TALMUD) that a people-and-places
 * index has no slot for, and they are 21.5 MB of the module's 27.3 MB of prose.
 *
 * For each imported entry we emit the whole article as name-scoped prose, and,
 * where the entry is a homonym roster AND a numbered sub-entry's own references
 * land on exactly one TIPNR bearer of that name, that paragraph as person-scoped
 * prose carrying the references as evidence.
 */
function importIsbe(
  bearers: Map<string, NameBearer[]>,
  tipnr: PeopleProseArtifact["tipnr"],
  impOverride: string | null,
): PeopleProseArtifact {
  const zip = join(SOURCE_DIR, "ISBE.zip");
  if (!existsSync(zip)) throw new Error(`Missing raw source: ${zip}`);
  const { imp, about } = readSwordModule(zip, "ISBE", "isbe.conf", impOverride);
  const resolver = (osisId: string): { book: string; chapter: number; verse: number } | null =>
    parseOsisVerseId(osisId);
  const { entries, malformedRecords } = parseIsbeImp(imp, resolver);
  if (entries.length === 0) throw new Error("ISBE parsed 0 entries");

  const records: ProseRecord[] = [];
  const counts: Record<string, number> = {
    swordRecords: entries.length,
    malformedRecords: malformedRecords.length,
    headwordsWithOrdinalSuffix: entries.filter((entry) => entry.headwordOrdinal !== null).length,
    importedEntries: 0,
    articleRecords: 0,
    rosterEntries: 0,
    rosterSegments: 0,
    segmentsBoundToOnePerson: 0,
    segmentsCoveringManyIndividuals: 0,
    segmentsWithoutReferenceEvidence: 0,
    segmentsMatchingNoBearer: 0,
    segmentsMatchingManyBearers: 0,
    segmentsDemotedByBearerCollision: 0,
    entitiesContestedByManySubEntries: 0,
    distinctPersonsBound: 0,
    nameScoped: 0,
    personScoped: 0,
    osisRefsResolved: 0,
  };
  const boundPersons = new Set<string>();
  const segmentRecords: ProseRecord[] = [];

  for (const entry of entries) {
    const keyed = entry.aliases
      .map((alias) => ({ alias, nameKey: proseNameKey(alias) }))
      .map((candidate) => ({ ...candidate, found: bearers.get(candidate.nameKey) ?? [] }))
      .filter((candidate) => candidate.found.length > 0);
    if (keyed.length === 0) continue;
    bump(counts, "importedEntries", 1);
    bump(counts, "osisRefsResolved", entry.refs.length);

    // The article itself is always about the name, however many bearers there
    // are: it holds the etymology line plus every bearer's paragraph, so even
    // for a sole bearer it is not that person's account. The per-individual
    // claim, where there is one, comes from the sub-entry path below.
    const primary = keyed[0]!;
    records.push(
      scopeProse({
        block: isbeArticleBlock(entry),
        displayTerm: entry.headword,
        nameKey: primary.nameKey,
        bearers: primary.found,
        blockScope: "name-by-construction",
      }),
    );
    bump(counts, "articleRecords");
    bump(counts, "nameScoped");

    const { segments, hasRosterShape } = segmentIsbeRoster(entry.teiBody, resolver);
    if (!hasRosterShape) continue;
    bump(counts, "rosterEntries", 1);
    for (const segment of segments) {
      bump(counts, "rosterSegments", 1);
      segmentRecords.push(
        scopeProse({
          block: isbeSegmentBlock(entry, segment),
          displayTerm: entry.headword,
          nameKey: primary.nameKey,
          bearers: primary.found,
          individualHook: { ordinals: segment.ordinals, refs: segment.refs },
        }),
      );
    }
  }

  // ISBE can distinguish more individuals than TIPNR carries, and then two
  // sub-entries land on one entity. Run over the whole source, because ISBE
  // splits long homonyms across separate articles. See resolveSubEntryCollisions.
  const resolved = resolveSubEntryCollisions(segmentRecords, bearers);
  bump(counts, "segmentsDemotedByBearerCollision", resolved.demoted);
  bump(counts, "entitiesContestedByManySubEntries", resolved.collidingEntityIds.length);

  for (const record of resolved.records) {
    records.push(record);
    if (record.granularity === "person") {
      bump(counts, "personScoped", 1);
      bump(counts, "segmentsBoundToOnePerson", 1);
      boundPersons.add(record.entityId);
      continue;
    }
    bump(counts, "nameScoped", 1);
    switch (record.unboundReason) {
      case "marker-covers-many-individuals":
        bump(counts, "segmentsCoveringManyIndividuals", 1);
        break;
      case "no-reference-evidence":
        bump(counts, "segmentsWithoutReferenceEvidence", 1);
        break;
      case "reference-matches-no-bearer":
        bump(counts, "segmentsMatchingNoBearer", 1);
        break;
      case "reference-matches-many-bearers":
        bump(counts, "segmentsMatchingManyBearers", 1);
        break;
      case "many-subentries-bind-to-same-bearer":
        break;
      default:
        break;
    }
  }
  counts.distinctPersonsBound = boundPersons.size;
  // The whole point of the collision pass: one person, at most one account.
  if (counts.distinctPersonsBound !== counts.segmentsBoundToOnePerson) {
    throw new Error(
      `ISBE bound ${counts.segmentsBoundToOnePerson} segments to only ${counts.distinctPersonsBound} distinct persons — ` +
        `some person carries two different individuals' paragraphs`,
    );
  }

  assertNonZero(counts, [
    "swordRecords",
    "importedEntries",
    "articleRecords",
    "rosterEntries",
    "rosterSegments",
    "segmentsBoundToOnePerson",
    "distinctPersonsBound",
    "osisRefsResolved",
  ]);

  const { byNameKey, byEntityId } = collectProseRecords(records);
  return {
    formatVersion: 1,
    sourceId: "isbe",
    attribution: PROSE_SOURCES.isbe,
    provenance: {
      upstream: UPSTREAM.isbe.url,
      rawFile: UPSTREAM.isbe.rawFile,
      sourceSha256: sha256(readFileSync(zip)),
      upstreamVersion: UPSTREAM.isbe.version,
      intermediateSha256: sha256(imp),
      about,
      retrievedAt: UPSTREAM.isbe.retrievedAt,
    },
    generatedAt: new Date().toISOString(),
    tipnr,
    counts,
    byNameKey,
    byEntityId,
  };
}

// ────────────────────────────────────────────────────────────────────────────

function readSwordModule(
  zip: string,
  moduleName: string,
  confName: string,
  impOverride: string | null,
): { imp: string; about: string } {
  const work = mkdtempSync(join(tmpdir(), `sword-${moduleName.toLowerCase()}-`));
  try {
    unzipTo(zip, work);
    const conf = readFileSync(join(work, "mods.d", confName), "utf8");
    const about = /^About=(.*)$/m.exec(conf)?.[1]?.trim() ?? "";
    const license = /^DistributionLicense=(.*)$/m.exec(conf)?.[1]?.trim() ?? "";
    if (license !== "Public Domain") {
      throw new Error(`${moduleName} declares DistributionLicense="${license}", expected "Public Domain"`);
    }
    const imp = impOverride ? readFileSync(impOverride, "utf8") : dumpSwordModule(work, moduleName);
    if (!imp.includes("$$$")) throw new Error(`${moduleName} dump contains no IMP records`);
    return { imp, about };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

function main(): void {
  const argv = process.argv.slice(2);
  const impIndex = argv.indexOf("--imp");
  const impOverride = impIndex >= 0 ? resolve(argv[impIndex + 1] ?? "") : null;
  const impValue = impIndex >= 0 ? argv[impIndex + 1] : undefined;
  const requested = argv.filter((arg, at) => !arg.startsWith("--") && !(impValue !== undefined && at === impIndex + 1));
  const modes: ProseSourceId[] =
    requested.length === 0
      ? ["unfoldingword-tw", "hitchcock", "isbe"]
      : requested.map((arg) => {
          const alias: Record<string, ProseSourceId> = {
            tw: "unfoldingword-tw",
            "unfoldingword-tw": "unfoldingword-tw",
            unfoldingword: "unfoldingword-tw",
            hitchcock: "hitchcock",
            isbe: "isbe",
          };
          const mode = alias[arg.toLowerCase()];
          if (!mode) throw new Error(`Unknown source "${arg}". Use tw, hitchcock or isbe.`);
          return mode;
        });

  const { meta, bearers } = loadTipnr();
  console.log(`TIPNR: ${meta.entityCount} entities, ${bearers.size} distinct name keys`);

  const doctor: Record<string, unknown> = {
    generatedAt: new Date().toISOString(),
    tipnr: meta,
    sources: {} as Record<string, unknown>,
    checks: {} as Record<string, boolean>,
  };
  const checks = doctor.checks as Record<string, boolean>;
  const sources = doctor.sources as Record<string, unknown>;

  for (const mode of modes) {
    console.log(`\n── ${PROSE_SOURCES[mode].name} ──`);
    const artifact =
      mode === "unfoldingword-tw"
        ? importTranslationWords(bearers, meta)
        : mode === "hitchcock"
          ? importHitchcock(bearers, meta, impOverride)
          : importIsbe(bearers, meta, impOverride);

    const violations = auditProseGranularity(artifactRecords(artifact), bearers);
    if (violations.length > 0) {
      throw new Error(
        `Granularity audit refused ${mode}: ${violations.length} violations, first ${JSON.stringify(violations[0])}`,
      );
    }
    const { path, bytes } = writeArtifact(artifact);
    checks[`${mode}:granularityAuditClean`] = true;
    checks[`${mode}:hasNameScopedProse`] = Object.keys(artifact.byNameKey).length > 0;
    checks[`${mode}:attributionNonEmpty`] =
      artifact.attribution.attributionText.length > 0 && artifact.attribution.date.length > 0;
    sources[mode] = {
      file: OUTPUT_FILE[mode],
      bytes,
      counts: artifact.counts,
      nameKeys: Object.keys(artifact.byNameKey).length,
      entityIds: Object.keys(artifact.byEntityId).length,
      provenance: artifact.provenance,
      attribution: {
        name: artifact.attribution.name,
        date: artifact.attribution.date,
        license: artifact.attribution.license,
        attributionText: artifact.attribution.attributionText,
        riderCount: artifact.attribution.riders.length,
      },
    };
    console.log(`  wrote ${path} (${bytes} bytes)`);
    console.log(`  name keys ${Object.keys(artifact.byNameKey).length}, entity ids ${Object.keys(artifact.byEntityId).length}`);
    for (const [key, value] of Object.entries(artifact.counts)) console.log(`    ${key}: ${value}`);
  }

  if (modes.length === 3) {
    const doctorPath = join(OUT_DIR, "doctor-report.json");
    (doctor as { status?: string }).status = Object.values(checks).every(Boolean) ? "healthy" : "unhealthy";
    writeFileSync(doctorPath, `${JSON.stringify(doctor, null, 2)}\n`);
    console.log(`\nDoctor: ${doctorPath} (${(doctor as { status?: string }).status})`);
    if ((doctor as { status?: string }).status !== "healthy") {
      throw new Error(`Doctor refused: ${JSON.stringify(checks)}`);
    }
  }
}

const invoked = process.argv[1] ? resolve(process.argv[1]) : "";
if (invoked === resolve(HERE)) main();
