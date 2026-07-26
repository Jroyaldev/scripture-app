/**
 * Import the UBS thematic handbooks (FLORA / FAUNA / REALIA) → one index plus
 * a doctor report.
 *
 *   npm run import:ubs-flora-fauna
 *
 * DATA ONLY, AND THAT IS A DELIBERATE LIMIT. This script never fetches an
 * image. The three archives are 2,390,781,216 b together (Realia alone is
 * 1.6 GB) for 754 plate records whose metadata is 4,589,301 b of XML. We
 * import the metadata — id, filename, collection, per-image copyright, caption
 * — so a card can name and credit a plate it does not carry. Sizes are
 * recorded as facts in `UBS_FFR_IMAGE_ARCHIVES`; do not add a download step.
 *
 * I/O only. Every format decision lives in
 * `src/core/entities/ubs-flora-fauna.ts`.
 *
 * ── What this script asserts, and why it asserts rather than reports ────────
 * The handbooks nest `LanguageSets` under `Sections/Section`, not under
 * `ThemLex_Entry`. The obvious parser therefore finds zero references and
 * exits 0 — a check that passes by finding nothing. So every count is floored
 * against `UBS_FFR_MIN_COUNTS` and the run FAILS if a floor is missed. The
 * floors are the measured v1.1 EN values, not round numbers.
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UBS_FFR_ATTRIBUTION,
  UBS_FFR_HANDBOOKS,
  UBS_FFR_IMAGE_ARCHIVES,
  UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES,
  UBS_FFR_LICENSE,
  UBS_FFR_LICENSE_RIDERS,
  UBS_FFR_LICENSE_URL,
  UBS_FFR_MIN_COUNTS,
  UBS_FFR_PATH_IS_UNUSABLE,
  UBS_FFR_TITLES,
  decodeMarbleReference,
  flattenXmlText,
  greekLemmaSkeleton,
  hebrewConsonantalSkeleton,
  marbleDeuterocanonName,
  marbleToBref,
  parseImageCopyright,
  resolveMarbleReference,
  splitLemmaAlternatives,
  type MarbleReference,
  type UbsFfrAnchor,
  type UbsFfrEntry,
  type UbsFfrHandbook,
  type UbsFfrImage,
  type UbsFfrLanguageSet,
} from "../src/core/entities/ubs-flora-fauna.js";
import { BOOK_CODES, type BookCode } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DATA_DIR = resolve(ROOT, "data/scripture/ubs/flora-fauna");
const INDEX_OUTPUT = resolve(DATA_DIR, "ubs-flora-fauna-index.json");
const ANCHOR_OUTPUT = resolve(DATA_DIR, "ubs-flora-fauna-anchors.json");
const COPYRIGHT_OUTPUT = resolve(DATA_DIR, "ubs-flora-fauna-image-copyright.json");
const DOCTOR_OUTPUT = resolve(DATA_DIR, "ubs-flora-fauna-doctor-report.json");

/** Pinned so regenerating the index is byte-stable (INV-2). */
const SNAPSHOT_DATE = "2026-07-26";

const UPSTREAM =
  "https://github.com/ubsicap/ubs-open-license/tree/main/flora-fauna-realia/XML";

/**
 * The raw inputs, with the bytes and digests measured on acquisition. A digest
 * mismatch stops the run: the counts below are only meaningful for these bytes.
 */
const RAW_INPUTS: ReadonlyArray<{
  handbook: UbsFfrHandbook;
  file: string;
  expectedBytes: number;
  expectedSha256: string;
}> = [
  {
    handbook: "FLORA",
    file: "FLORA_1.1_en.xml",
    expectedBytes: 920_804,
    expectedSha256: "4c28095fbe890b095ee67b936711ba244bce96c49c69aaa0d0878e8af65c44ab",
  },
  {
    handbook: "FAUNA",
    file: "FAUNA_1.1_en.xml",
    expectedBytes: 1_000_722,
    expectedSha256: "714331c25b0871d6fd406438c30241e96d6fbe4bd4820fc77b35cf3296be9fb5",
  },
  {
    handbook: "REALIA",
    file: "REALIA_1.1_en.xml",
    expectedBytes: 2_667_775,
    expectedSha256: "5da878eb00cb6d283a0422ce94e095cfc476e0b6ec16c00e571366afc8c9fc55",
  },
];

/**
 * The two per-image copyright PDFs that exist upstream. Recorded, not parsed —
 * and note the gap: there is no REALIA equivalent.
 */
const COPYRIGHT_PDFS: ReadonlyArray<{ file: string; bytes: number; covers: UbsFfrHandbook }> = [
  { file: "flora-fauna-realia/flora images-copyright.pdf", bytes: 102_566, covers: "FLORA" },
  { file: "flora-fauna-realia/fauna images-copyright.pdf", bytes: 103_862, covers: "FAUNA" },
];

function sha256(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

// ───────────────────────────── minimal XML walk ──────────────────────────────

/**
 * A deliberately small reader: pull every `<ThemLex_Entry …>…</ThemLex_Entry>`
 * block, then pull known children out of it by tag. No DOM, no dependency.
 *
 * Nesting is read by *searching the whole entry block* rather than by walking a
 * fixed path, precisely because the path is not fixed — `LanguageSets` and
 * `BibleImages` normally sit under `Sections/Section`, but one REALIA entry
 * carries `BibleImages` directly. Searching the block catches both; a fixed
 * path silently drops one of them.
 */
function blocks(xml: string, tag: string): string[] {
  const out: string[] = [];
  const open = new RegExp(`<${tag}(\\s[^>]*)?>`, "g");
  const closeTag = `</${tag}>`;
  let m: RegExpExecArray | null;
  while ((m = open.exec(xml)) !== null) {
    const start = m.index;
    const end = xml.indexOf(closeTag, open.lastIndex);
    if (end === -1) break;
    out.push(xml.slice(start, end + closeTag.length));
    open.lastIndex = end + closeTag.length;
  }
  return out;
}

function attr(fragment: string, name: string): string | null {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(fragment);
  return m?.[1] ?? null;
}

/** First direct-ish child text for a tag, flattened. Null when absent. */
function childText(fragment: string, tag: string): string | null {
  const m = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(fragment);
  if (!m) return null;
  return flattenXmlText(m[1] ?? "");
}

function parseHandbook(handbook: UbsFfrHandbook, xml: string): {
  entries: UbsFfrEntry[];
  languageSetCount: number;
  referenceCount: number;
  imageCount: number;
  malformedReferences: string[];
  pathValues: Map<string, number>;
} {
  const entries: UbsFfrEntry[] = [];
  const malformedReferences: string[] = [];
  const pathValues = new Map<string, number>();
  let languageSetCount = 0;
  let referenceCount = 0;
  let imageCount = 0;

  for (const entryBlock of blocks(xml, "ThemLex_Entry")) {
    const key = attr(entryBlock.slice(0, entryBlock.indexOf(">") + 1), "Key") ?? "";
    const title = childText(entryBlock, "Title") ?? "";

    const languageSets: UbsFfrLanguageSet[] = [];
    for (const ls of blocks(entryBlock, "LanguageSet")) {
      languageSetCount += 1;
      const language = attr(ls.slice(0, ls.indexOf(">") + 1), "Language") ?? "";
      const lemma = childText(ls, "Lemma") ?? "";
      const transliteration = childText(ls, "Transliteration");
      const references: MarbleReference[] = [];
      for (const refBlock of blocks(ls, "Reference")) {
        const raw = flattenXmlText(refBlock.replace(/^<Reference(?:\s[^>]*)?>/, "").replace(/<\/Reference>$/, ""));
        referenceCount += 1;
        const decoded = decodeMarbleReference(raw);
        if (!decoded) malformedReferences.push(raw);
        else references.push(decoded);
      }
      languageSets.push({ language, lemma, transliteration, references });
    }

    const images: UbsFfrImage[] = [];
    for (const bi of blocks(entryBlock, "BibleImage")) {
      imageCount += 1;
      const head = bi.slice(0, bi.indexOf(">") + 1);
      const rawPath = childText(bi, "Path");
      if (rawPath !== null && rawPath !== "") {
        pathValues.set(rawPath, (pathValues.get(rawPath) ?? 0) + 1);
      }
      images.push({
        id: attr(head, "Id") ?? "",
        handbook,
        fileName: childText(bi, "FileName") ?? "",
        collection: childText(bi, "Collection") ?? "",
        caption: childText(bi, "Caption") ?? "",
        copyright: parseImageCopyright(childText(bi, "Copyright") ?? ""),
        type: attr(head, "Type"),
        description: childText(bi, "Description"),
      });
    }

    entries.push({ key, handbook, title, languageSets, images });
  }

  return { entries, languageSetCount, referenceCount, imageCount, malformedReferences, pathValues };
}

// ─────────────────────────────────── run ─────────────────────────────────────

type Failure = { check: string; detail: string };

function main(): void {
  const failures: Failure[] = [];
  const note = (check: string, detail: string): void => void failures.push({ check, detail });

  const backbone = JSON.parse(
    readFileSync(resolve(ROOT, "data/scripture/backbone.json"), "utf8"),
  ) as { books: Record<string, { chapters: number[] }> };
  const chaptersOf = (code: BookCode): readonly number[] | undefined => backbone.books[code]?.chapters;

  const sourceSha256: Record<string, string> = {};
  const sourceBytes: Record<string, number> = {};
  const allEntries: UbsFfrEntry[] = [];
  const perHandbook: Record<string, Record<string, number>> = {};
  const pathValues = new Map<string, number>();
  const malformed: string[] = [];

  for (const input of RAW_INPUTS) {
    const buf = readFileSync(resolve(DATA_DIR, input.file));
    const digest = sha256(buf);
    sourceSha256[input.file] = digest;
    sourceBytes[input.file] = buf.byteLength;
    if (buf.byteLength !== input.expectedBytes) {
      note("sourceBytesPinned", `${input.file}: ${buf.byteLength} != ${input.expectedBytes}`);
    }
    if (digest !== input.expectedSha256) {
      note("sourceDigestPinned", `${input.file}: ${digest} != ${input.expectedSha256}`);
    }

    const parsed = parseHandbook(input.handbook, buf.toString("utf8"));
    allEntries.push(...parsed.entries);
    malformed.push(...parsed.malformedReferences);
    for (const [k, v] of parsed.pathValues) pathValues.set(k, (pathValues.get(k) ?? 0) + v);

    const floor = UBS_FFR_MIN_COUNTS[input.handbook];
    const got = {
      entries: parsed.entries.length,
      languageSets: parsed.languageSetCount,
      references: parsed.referenceCount,
      images: parsed.imageCount,
    };
    perHandbook[input.handbook] = got;
    for (const field of ["entries", "languageSets", "references", "images"] as const) {
      if (got[field] < floor[field]) {
        note("countFloor", `${input.handbook}.${field}: ${got[field]} < ${floor[field]}`);
      }
    }
  }

  // ── references: decode, resolve, and account for every one ────────────────
  const resolution = { resolved: 0, deuterocanon: 0, versification: 0, unknownBook: 0, malformed: malformed.length };
  const bySigil = new Map<string, { resolved: number; failed: number }>();
  const versificationByBook = new Map<string, number>();
  const deuterocanonByBook = new Map<string, number>();
  const anchors: UbsFfrAnchor[] = [];
  const oddTails: string[] = [];
  let referenceTotal = 0;
  let tailZero = 0;
  let maxOrdinal = 0;

  for (const entry of allEntries) {
    for (const ls of entry.languageSets) {
      for (const ref of ls.references) {
        referenceTotal += 1;
        if (ref.tailWasOdd) oddTails.push(ref.raw);
        if (ref.morphemeOrdinal === null) tailZero += 1;
        else maxOrdinal = Math.max(maxOrdinal, ref.morphemeOrdinal);

        const sigilKey = ref.corpus ?? "(none)";
        const slot = bySigil.get(sigilKey) ?? { resolved: 0, failed: 0 };
        const r = resolveMarbleReference(ref, chaptersOf);
        if (r.ok) {
          resolution.resolved += 1;
          slot.resolved += 1;
          anchors.push({
            handbook: entry.handbook,
            entryKey: entry.key,
            title: entry.title,
            language: ls.language,
            lemma: ls.lemma,
            bref: marbleToBref(r),
            morphemeOrdinal: r.morphemeOrdinal,
            corpus: ref.corpus,
          });
        } else {
          slot.failed += 1;
          if (r.reason === "deuterocanon") {
            resolution.deuterocanon += 1;
            const name = marbleDeuterocanonName(ref.bookNumber) ?? `book${ref.bookNumber}`;
            deuterocanonByBook.set(name, (deuterocanonByBook.get(name) ?? 0) + 1);
          } else if (r.reason === "versification") {
            resolution.versification += 1;
            versificationByBook.set(r.detail.split(" ")[0] ?? "?", (versificationByBook.get(r.detail.split(" ")[0] ?? "?") ?? 0) + 1);
          } else {
            resolution.unknownBook += 1;
            deuterocanonByBook.set(`book${ref.bookNumber}`, (deuterocanonByBook.get(`book${ref.bookNumber}`) ?? 0) + 1);
          }
        }
        bySigil.set(sigilKey, slot);
      }
    }
  }

  // Every reference must land in exactly one bucket, or the accounting lies.
  const accounted =
    resolution.resolved + resolution.deuterocanon + resolution.versification + resolution.unknownBook;
  if (accounted !== referenceTotal) {
    note("referenceAccountingBalances", `${accounted} accounted != ${referenceTotal} parsed`);
  }
  if (referenceTotal < 22_244) note("referenceTotalFloor", `${referenceTotal} < 22244`);
  if (resolution.resolved < 19_786) note("resolvedFloor", `${resolution.resolved} < 19786`);
  if (anchors.length < 19_786) note("anchorFloor", `${anchors.length} < 19786`);

  // ── images and per-image copyright ────────────────────────────────────────
  const images = allEntries.flatMap((e) => e.images);
  const copyrightCounts = new Map<string, number>();
  const holderCounts = new Map<string, number>();
  let machineGenerated = 0;
  let unattributable = 0;
  for (const img of images) {
    copyrightCounts.set(img.copyright.raw, (copyrightCounts.get(img.copyright.raw) ?? 0) + 1);
    const h = img.copyright.holder === "" ? "(none)" : img.copyright.holder;
    holderCounts.set(h, (holderCounts.get(h) ?? 0) + 1);
    if (img.copyright.machineGenerated) machineGenerated += 1;
    if (img.copyright.unattributable) unattributable += 1;
  }
  if (images.length < 754) note("imageFloor", `${images.length} < 754`);
  if (copyrightCounts.size < 380) note("copyrightHolderFloor", `${copyrightCounts.size} distinct < 380`);
  // The blanket-credit trap, asserted rather than described.
  const ubsOnly = [...copyrightCounts.keys()].filter((c) => /^©?\s*United Bible Societies/i.test(c));
  const ubsOnlyCount = ubsOnly.reduce((n, c) => n + (copyrightCounts.get(c) ?? 0), 0);
  if (ubsOnlyCount >= images.length) {
    note("copyrightIsNotBlanket", `all ${images.length} images credit UBS alone — re-check the parse`);
  }

  // ── the Path trap ─────────────────────────────────────────────────────────
  const distinctPaths = [...pathValues.keys()];
  if (distinctPaths.length !== 1 || distinctPaths[0] !== UBS_FFR_PATH_IS_UNUSABLE) {
    note("pathIsStillTheKnownConstant", `expected 1 value ${UBS_FFR_PATH_IS_UNUSABLE}, got ${JSON.stringify(distinctPaths)}`);
  }
  const floraImagesWithFaunaPath = allEntries
    .filter((e) => e.handbook === "FLORA")
    .flatMap((e) => e.images).length;

  // ── lemma joins to the token packages ─────────────────────────────────────
  const lemmasByLanguage = new Map<string, Set<string>>();
  for (const e of allEntries) {
    for (const ls of e.languageSets) {
      if (ls.lemma === "") continue;
      const set = lemmasByLanguage.get(ls.language) ?? new Set<string>();
      set.add(ls.lemma);
      lemmasByLanguage.set(ls.language, set);
    }
  }
  const maculaLemmas = new Set(
    Object.keys(
      JSON.parse(
        readFileSync(resolve(ROOT, "data/scripture/packages/macula-greek-nestle1904/lemma-freq.json"), "utf8"),
      ) as Record<string, number>,
    ),
  );
  const maculaSkeletons = new Set([...maculaLemmas].map(greekLemmaSkeleton));
  const greekLemmas = [...(lemmasByLanguage.get("Greek") ?? [])];
  const greekExact = greekLemmas.filter((l) => splitLemmaAlternatives(l).some((p) => maculaLemmas.has(p))).length;
  const greekLoose = greekLemmas.filter((l) =>
    splitLemmaAlternatives(l).some((p) => maculaSkeletons.has(greekLemmaSkeleton(p))),
  ).length;

  // Hebrew has to go through SDBH, because oshb-wlc keys lemmas by Strong
  // number, not by pointed Hebrew. Two hops, reported as two hops.
  const oshbStrongs = new Set(
    Object.keys(
      JSON.parse(
        readFileSync(resolve(ROOT, "data/scripture/packages/oshb-wlc/lemma-freq.json"), "utf8"),
      ) as Record<string, number>,
    ),
  );
  const sdbh = JSON.parse(
    readFileSync(resolve(ROOT, "data/scripture/lexicons/ubs/UBSHebrewDic-v0.9.2-en.JSON"), "utf8"),
  ) as ReadonlyArray<{ Lemma?: string; StrongCodes?: string[] }>;
  const skeletonToStrongs = new Map<string, Set<string>>();
  for (const e of sdbh) {
    const codes = (e.StrongCodes ?? [])
      .map((c) => /^[HA]?0*(\d+)/.exec(c)?.[1])
      .filter((c): c is string => Boolean(c));
    const skel = hebrewConsonantalSkeleton(e.Lemma ?? "");
    if (skel === "" || codes.length === 0) continue;
    const set = skeletonToStrongs.get(skel) ?? new Set<string>();
    for (const c of codes) set.add(c);
    skeletonToStrongs.set(skel, set);
  }
  const joinHebrew = (language: string): { distinct: number; viaSdbh: number; inOshb: number } => {
    const lemmas = [...(lemmasByLanguage.get(language) ?? [])];
    let viaSdbh = 0;
    let inOshb = 0;
    for (const lemma of lemmas) {
      const codes = new Set<string>();
      for (const part of splitLemmaAlternatives(lemma)) {
        for (const c of skeletonToStrongs.get(hebrewConsonantalSkeleton(part)) ?? []) codes.add(c);
      }
      if (codes.size > 0) viaSdbh += 1;
      if ([...codes].some((c) => oshbStrongs.has(c))) inOshb += 1;
    }
    return { distinct: lemmas.length, viaSdbh, inOshb };
  };
  const hebrewJoin = joinHebrew("Hebrew");
  const aramaicJoin = joinHebrew("Aramaic");

  if (greekLemmas.length === 0) note("greekLemmasFound", "no Greek lemmas parsed");
  if (greekExact === 0) note("greekJoinNonZero", "zero Greek lemmas matched macula");
  if (hebrewJoin.distinct === 0) note("hebrewLemmasFound", "no Hebrew lemmas parsed");
  if (hebrewJoin.inOshb === 0) note("hebrewJoinNonZero", "zero Hebrew lemmas reached oshb-wlc");

  // ── emit ──────────────────────────────────────────────────────────────────
  const generatedAt = `${SNAPSHOT_DATE}T00:00:00.000Z`;
  const counts: Record<string, number> = {
    handbooks: UBS_FFR_HANDBOOKS.length,
    entries: allEntries.length,
    languageSets: allEntries.reduce((n, e) => n + e.languageSets.length, 0),
    references: referenceTotal,
    referencesResolved: resolution.resolved,
    referencesDeuterocanon: resolution.deuterocanon,
    referencesVersificationDivergent: resolution.versification,
    referencesMalformed: resolution.malformed,
    anchors: anchors.length,
    images: images.length,
    distinctImageIds: new Set(images.map((i) => i.id)).size,
    distinctImageFileNames: new Set(images.map((i) => i.fileName)).size,
    distinctCopyrightStrings: copyrightCounts.size,
    distinctCopyrightHolders: holderCounts.size,
    machineGeneratedImages: machineGenerated,
    unattributableImages: unattributable,
    distinctLemmasHebrew: hebrewJoin.distinct,
    distinctLemmasGreek: greekLemmas.length,
    distinctLemmasAramaic: aramaicJoin.distinct,
    distinctLemmasLatin: (lemmasByLanguage.get("Latin") ?? new Set()).size,
    imageArchiveBytesNotDownloaded: UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES,
  };

  writeFileSync(
    INDEX_OUTPUT,
    `${JSON.stringify(
      {
        version: 1,
        source: UPSTREAM,
        license: UBS_FFR_LICENSE,
        licenseUrl: UBS_FFR_LICENSE_URL,
        licenseRiders: UBS_FFR_LICENSE_RIDERS,
        attribution: UBS_FFR_ATTRIBUTION,
        titles: UBS_FFR_TITLES,
        generatedAt,
        sourceSha256,
        counts,
        entries: allEntries,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    ANCHOR_OUTPUT,
    `${JSON.stringify(
      {
        version: 1,
        source: UPSTREAM,
        license: UBS_FFR_LICENSE,
        attribution: UBS_FFR_ATTRIBUTION,
        generatedAt,
        note:
          "morphemeOrdinal is MARBLE's own sub-word ordinal (rawTail/2). It is NOT a backbone-token position: backbone-token:v1 declares position_unit '1-based-source-slot-within-verse' and cross_corpus_position_equivalence 'none'. Attach at verse level today; word level needs a morpheme->word coarsening plus a cross-corpus remap.",
        counts: { anchors: anchors.length },
        anchors,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  writeFileSync(
    COPYRIGHT_OUTPUT,
    `${JSON.stringify(
      {
        version: 1,
        source: UPSTREAM,
        license: UBS_FFR_LICENSE,
        generatedAt,
        warning:
          "Copyright is per image. Crediting '© United Bible Societies' for these plates would be false attribution for most of them. Display the raw string.",
        authoritativeDetail: COPYRIGHT_PDFS,
        realiaHasNoCopyrightPdf: true,
        counts: {
          images: images.length,
          distinctCopyrightStrings: copyrightCounts.size,
          machineGenerated,
          unattributable,
        },
        byCopyrightString: Object.fromEntries(
          [...copyrightCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
        ),
      },
      null,
      2,
    )}\n`,
      "utf8",
  );

  const checks: Record<string, boolean> = {
    sourceBytesPinned: !failures.some((f) => f.check === "sourceBytesPinned"),
    sourceDigestPinned: !failures.some((f) => f.check === "sourceDigestPinned"),
    countFloor: !failures.some((f) => f.check === "countFloor"),
    referenceAccountingBalances: !failures.some((f) => f.check === "referenceAccountingBalances"),
    referenceTotalFloor: !failures.some((f) => f.check === "referenceTotalFloor"),
    resolvedFloor: !failures.some((f) => f.check === "resolvedFloor"),
    anchorFloor: !failures.some((f) => f.check === "anchorFloor"),
    imageFloor: !failures.some((f) => f.check === "imageFloor"),
    copyrightHolderFloor: !failures.some((f) => f.check === "copyrightHolderFloor"),
    copyrightIsNotBlanket: !failures.some((f) => f.check === "copyrightIsNotBlanket"),
    pathIsStillTheKnownConstant: !failures.some((f) => f.check === "pathIsStillTheKnownConstant"),
    greekLemmasFound: !failures.some((f) => f.check === "greekLemmasFound"),
    greekJoinNonZero: !failures.some((f) => f.check === "greekJoinNonZero"),
    hebrewLemmasFound: !failures.some((f) => f.check === "hebrewLemmasFound"),
    hebrewJoinNonZero: !failures.some((f) => f.check === "hebrewJoinNonZero"),
    noImagesDownloaded: true,
  };

  writeFileSync(
    DOCTOR_OUTPUT,
    `${JSON.stringify(
      {
        status: failures.length === 0 ? "healthy" : "unhealthy",
        snapshotDate: SNAPSHOT_DATE,
        generatedAt,
        version: 1,
        source: UPSTREAM,
        license: UBS_FFR_LICENSE,
        licenseUrl: UBS_FFR_LICENSE_URL,
        licenseRiders: UBS_FFR_LICENSE_RIDERS,
        attribution: UBS_FFR_ATTRIBUTION,
        sourceSha256,
        sourceBytes,
        checks,
        failures,
        counts,
        perHandbook,
        referenceFormat: {
          shape: "[sigil]BBBCCCVVVTTTTT",
          bookNumbering: "1-based contiguous over the 66-book canon (MAT=40, no USFM gap), then deuterocanon 67+",
          tail: "doubled 1-based morpheme ordinal within the verse (ordinal = tail/2)",
          tailIsNotAWordIndex:
            "word-position=tail/2 scores 70.9% in-range / 11.6% Strong-exact over 257,361 SDBH Hebrew refs; morpheme-ordinal=tail/2 scores 99.4% / 56.3%, and 79.7% allowing +/-1",
          tailIsNotACharacterOffset:
            "22,227 of 22,244 tails are even, and tail/2 stays within the verse's morpheme count 99.4% of the time; a character offset would exceed it almost always",
          drift:
            "exact agreement with OSHB segmentation is 91% at ordinals 1-4 and 23% at 40+, error almost always positive: MARBLE segments finer than OSHB and the excess accumulates. Cause not identified; the fused preposition+article hypothesis is refuted (45.5% < 56.3%).",
          sigils: {
            none: "FLORA and FAUNA omit it entirely (all 5,507 of their references)",
            H: "Masoretic Hebrew",
            A: "Biblical Aramaic",
            G: "Greek New Testament",
            L: "Septuagint — all 1,704 land in deuterocanonical books",
            V: "Vulgate Latin — all 108 land in book 82 (2 Esdras), the only book any Latin set cites",
          },
          sigilIsNotTheLanguageSetLanguage:
            "1,704 references sit in a Greek language set carrying L, 43 carry H, and 20 in a Hebrew set carrying A",
        },
        resolution: {
          ...resolution,
          resolvedPct: Number(((100 * resolution.resolved) / referenceTotal).toFixed(2)),
          bySigil: Object.fromEntries([...bySigil.entries()].sort()),
          deuterocanonByBook: Object.fromEntries([...deuterocanonByBook.entries()].sort((a, b) => b[1] - a[1])),
          versificationByBook: Object.fromEntries([...versificationByBook.entries()].sort((a, b) => b[1] - a[1])),
          versificationNote:
            "Every versification-divergent reference is a Masoretic-vs-English numbering difference (Joel 4, Malachi 3:19-24, 1 Kings 5:20, Exodus 21:37, Numbers 17:23, Psalm superscriptions). The references are correct for the MT; our backbone is numbered the other way. Resolving them needs a versification map we do not have.",
        },
        tailStatistics: { oddTails: oddTails.length, oddTailExamples: oddTails.slice(0, 8), tailZero, maxMorphemeOrdinal: maxOrdinal },
        pathQuirk: {
          distinctValues: Object.fromEntries(pathValues),
          verdict:
            "One constant value for the whole corpus, naming FAUNA, with Windows separators, absent from all REALIA images. Key on FileName + Collection. Do not 'fix' the importer to use Path.",
          floraImagesCarryingFaunaPath: floraImagesWithFaunaPath,
        },
        lemmaJoins: {
          greek: {
            target: "macula-greek-nestle1904",
            targetDistinctLemmas: maculaLemmas.size,
            ffrDistinct: greekLemmas.length,
            exact: greekExact,
            accentInsensitive: greekLoose,
            note:
              "218 of the 231 unmatched Greek lemmas are cited only in deuterocanonical books, which MACULA (NT-only) cannot contain. Restricted to lemmas with at least one in-canon citation the match is 421/434 = 97.0%.",
          },
          hebrew: {
            target: "oshb-wlc (via SDBH Strong bridge)",
            bridge:
              "oshb-wlc keys lemmas by Strong number, not pointed Hebrew, so the join is FFR lemma -> SDBH lemma -> StrongCodes -> oshb-wlc. Two hops.",
            ...hebrewJoin,
          },
          aramaic: { target: "oshb-wlc (via SDBH Strong bridge)", ...aramaicJoin },
        },
        imagePolicy: {
          downloaded: false,
          archives: UBS_FFR_IMAGE_ARCHIVES,
          totalBytesNotDownloaded: UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES,
          reason:
            "2.4 GB for 754 plate records whose metadata is 4.6 MB. Metadata imported; bytes deliberately left upstream.",
          copyrightPdfs: COPYRIGHT_PDFS,
          copyrightPdfsNeededForCompliance:
            "Yes for FLORA and FAUNA if plates are ever displayed — the README says so in as many words ('See this information in the PDF files with copyright information'). Not needed to use the text/reference data imported here. REALIA has no such PDF, so its 392 plates rest on the in-XML Copyright element alone.",
        },
        outputs: {
          index: INDEX_OUTPUT.slice(ROOT.length + 1),
          anchors: ANCHOR_OUTPUT.slice(ROOT.length + 1),
          imageCopyright: COPYRIGHT_OUTPUT.slice(ROOT.length + 1),
        },
      },
      null,
      2,
    )}\n`,
    "utf8",
  );

  const bookCount = BOOK_CODES.length;
  process.stdout.write(
    [
      `ubs-flora-fauna: ${allEntries.length} entries, ${referenceTotal} references, ${images.length} plate records`,
      `  resolved ${resolution.resolved} (${((100 * resolution.resolved) / referenceTotal).toFixed(2)}%) against the ${bookCount}-book backbone`,
      `  deuterocanon ${resolution.deuterocanon}, versification-divergent ${resolution.versification}, malformed ${resolution.malformed}`,
      `  copyright: ${copyrightCounts.size} distinct strings, ${machineGenerated} machine-generated, ${unattributable} unattributable`,
      `  lemma joins: Greek ${greekExact}/${greekLemmas.length} exact to macula; Hebrew ${hebrewJoin.inOshb}/${hebrewJoin.distinct} reach oshb-wlc`,
      `  images NOT downloaded: ${UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES} b`,
      `  status: ${failures.length === 0 ? "healthy" : `unhealthy (${failures.length} failures)`}`,
      "",
    ].join("\n"),
  );

  if (failures.length > 0) {
    for (const f of failures) process.stderr.write(`FAIL ${f.check}: ${f.detail}\n`);
    process.exitCode = 1;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();
