/**
 * UBS FLORA / FAUNA / REALIA — format, decoding, and attribution contracts.
 *
 * Two kinds of test live here and they are not interchangeable:
 *
 *  · Floors. Every count is asserted non-zero *and* against its measured
 *    value. The handbooks nest `LanguageSets` under `Sections/Section`, so the
 *    obvious parser finds nothing and passes. `finds nothing` must never be a
 *    pass, so `the trap parse finds nothing` is itself a test — it proves the
 *    real parse looked somewhere the naive one does not.
 *
 *  · Refutations. `decodeMarbleReference` names the tail a *morpheme* ordinal
 *    rather than a word index, and that claim is load-bearing for whether a
 *    plate can hang off a word. So the word-index reading is re-refuted here
 *    against oshb-wlc rather than taken on trust from the importer's report.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  UBS_FFR_ATTRIBUTION,
  UBS_FFR_HANDBOOKS,
  UBS_FFR_IMAGE_ARCHIVES,
  UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES,
  UBS_FFR_LICENSE,
  UBS_FFR_LICENSE_RIDERS,
  UBS_FFR_MIN_COUNTS,
  UBS_FFR_PATH_IS_UNUSABLE,
  decodeMarbleReference,
  greekLemmaSkeleton,
  hebrewConsonantalSkeleton,
  marbleBookToBookCode,
  marbleDeuterocanonName,
  marbleToBref,
  parseImageCopyright,
  resolveMarbleReference,
  splitLemmaAlternatives,
  type UbsFfrEntry,
} from "../src/core/entities/ubs-flora-fauna.js";
import { BOOK_CODES, type BookCode } from "../src/core/reference/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DIR = resolve(ROOT, "data/scripture/ubs/flora-fauna");

type IndexFile = {
  version: number;
  license: string;
  licenseRiders: string[];
  attribution: Record<string, string>;
  sourceSha256: Record<string, string>;
  counts: Record<string, number>;
  entries: UbsFfrEntry[];
};

type DoctorFile = {
  status: string;
  checks: Record<string, boolean>;
  failures: unknown[];
  counts: Record<string, number>;
  perHandbook: Record<string, Record<string, number>>;
  sourceSha256: Record<string, string>;
  resolution: {
    resolved: number;
    deuterocanon: number;
    versification: number;
    unknownBook: number;
    malformed: number;
    bySigil: Record<string, { resolved: number; failed: number }>;
  };
  pathQuirk: { distinctValues: Record<string, number>; floraImagesCarryingFaunaPath: number };
  lemmaJoins: Record<string, Record<string, unknown>>;
  imagePolicy: { downloaded: boolean; totalBytesNotDownloaded: number };
};

let indexCache: IndexFile | null = null;
function loadIndex(): IndexFile {
  indexCache ??= JSON.parse(readFileSync(resolve(DIR, "ubs-flora-fauna-index.json"), "utf8")) as IndexFile;
  return indexCache;
}
function loadDoctor(): DoctorFile {
  return JSON.parse(readFileSync(resolve(DIR, "ubs-flora-fauna-doctor-report.json"), "utf8")) as DoctorFile;
}

const BACKBONE = JSON.parse(readFileSync(resolve(ROOT, "data/scripture/backbone.json"), "utf8")) as {
  books: Record<string, { chapters: number[] }>;
};
const chaptersOf = (code: BookCode): readonly number[] | undefined => BACKBONE.books[code]?.chapters;

// ───────────────────────────── reference decoding ────────────────────────────

test("the two worked examples decode to the passages they are supposed to be", () => {
  // Judges 9:15 — the cedar of Jotham's parable, which is why FLORA cites it.
  const jdg = decodeMarbleReference("00700901500064");
  assert.ok(jdg, "Judges reference failed to decode");
  assert.equal(jdg.bookNumber, 7);
  assert.equal(marbleBookToBookCode(jdg.bookNumber), "JDG");
  assert.equal(jdg.chapter, 9);
  assert.equal(jdg.verse, 15);
  assert.equal(jdg.rawTail, 64);
  assert.equal(jdg.morphemeOrdinal, 32);

  const psa = decodeMarbleReference("01903703500014");
  assert.ok(psa, "Psalm reference failed to decode");
  assert.equal(marbleBookToBookCode(psa.bookNumber), "PSA");
  assert.equal(psa.chapter, 37);
  assert.equal(psa.verse, 35);
  assert.equal(psa.morphemeOrdinal, 7);

  for (const ref of [jdg, psa]) {
    const r = resolveMarbleReference(ref, chaptersOf);
    assert.equal(r.ok, true, `${ref.raw} should resolve`);
  }
  assert.equal(marbleToBref({ ok: true, book: "JDG", chapter: 9, verse: 15, morphemeOrdinal: 32 }), "bref:v1/JDG.9.15");
});

test("book numbering is contiguous over the canon: MAT is 40, not USFM's 41", () => {
  assert.equal(marbleBookToBookCode(1), "GEN");
  assert.equal(marbleBookToBookCode(39), "MAL");
  assert.equal(marbleBookToBookCode(40), "MAT");
  assert.equal(marbleBookToBookCode(66), "REV");
  assert.equal(BOOK_CODES.length, 66);
  // 67+ is deuterocanon: nameable, never resolvable against our backbone.
  assert.equal(marbleBookToBookCode(67), null);
  assert.equal(marbleDeuterocanonName(67), "TOB");
  assert.equal(marbleDeuterocanonName(71), "SIR");
  assert.equal(marbleDeuterocanonName(82), "2ES");
  // 112 is real in the data and NOT identified. It must not be silently named.
  assert.equal(marbleDeuterocanonName(112), null);
});

test("the Aramaic and Latin book sets are the independent check on the numbering", () => {
  const index = loadIndex();
  const booksFor = (language: string): Set<number> => {
    const out = new Set<number>();
    for (const e of index.entries) {
      for (const ls of e.languageSets) {
        if (ls.language !== language) continue;
        for (const r of ls.references) out.add(r.bookNumber);
      }
    }
    return out;
  };
  // Aramaic occurs in exactly Ezra and Daniel. Under this numbering that is
  // {15, 27} — a wrong mapping would not land on that pair.
  const aramaic = booksFor("Aramaic");
  assert.ok(aramaic.size > 0, "no Aramaic references found — parser looked in the wrong place");
  assert.deepEqual([...aramaic].sort((a, b) => a - b), [15, 27]);
  assert.equal(marbleBookToBookCode(15), "EZR");
  assert.equal(marbleBookToBookCode(27), "DAN");

  // Latin cites exactly one book, 82 = 2 Esdras, which survives in Latin and
  // not in Greek. That coincidence is what pins the deuterocanon offset.
  const latin = booksFor("Latin");
  assert.ok(latin.size > 0, "no Latin references found");
  assert.deepEqual([...latin], [82]);
  assert.equal(marbleDeuterocanonName(82), "2ES");
});

test("the corpus sigil is not the language set's language", () => {
  const index = loadIndex();
  let greekSetWithSeptuagintSigil = 0;
  let hebrewSetWithAramaicSigil = 0;
  for (const e of index.entries) {
    for (const ls of e.languageSets) {
      for (const r of ls.references) {
        if (ls.language === "Greek" && r.corpus === "septuagint") greekSetWithSeptuagintSigil += 1;
        if (ls.language === "Hebrew" && r.corpus === "biblical-aramaic") hebrewSetWithAramaicSigil += 1;
      }
    }
  }
  // If these were zero the "sigil == language" reading would be untested, not
  // confirmed. They are the counterexamples, so they must be non-zero.
  assert.ok(greekSetWithSeptuagintSigil > 0, "expected Greek sets carrying the L sigil");
  assert.ok(hebrewSetWithAramaicSigil > 0, "expected Hebrew sets carrying the A sigil");
  assert.equal(greekSetWithSeptuagintSigil, 1704);
  assert.equal(hebrewSetWithAramaicSigil, 20);
});

test("FLORA and FAUNA omit the sigil entirely; only REALIA writes one", () => {
  const index = loadIndex();
  const withSigil = new Map<string, number>();
  const without = new Map<string, number>();
  for (const e of index.entries) {
    for (const ls of e.languageSets) {
      for (const r of ls.references) {
        const bucket = r.corpus === null ? without : withSigil;
        bucket.set(e.handbook, (bucket.get(e.handbook) ?? 0) + 1);
      }
    }
  }
  assert.equal(withSigil.get("FLORA") ?? 0, 0);
  assert.equal(withSigil.get("FAUNA") ?? 0, 0);
  assert.equal((without.get("FLORA") ?? 0) + (without.get("FAUNA") ?? 0), 5507);
  assert.ok((withSigil.get("REALIA") ?? 0) > 0, "REALIA should carry sigils");
});

test("the tail is a morpheme ordinal, and the word-index reading is refuted", () => {
  // Re-run the refutation against oshb-wlc rather than trusting the report.
  // Only the Hebrew references, only books the backbone has, sampled for speed.
  const index = loadIndex();
  type Seg = { strong: string | null };
  const verses = new Map<string, Seg[]>();
  const wordsPerVerse = new Map<string, (string | null)[]>();
  const normStrong = (s: unknown): string | null => {
    const m = /^[HA]?0*(\d+)/.exec(String(s ?? ""));
    return m?.[1] ?? null;
  };
  for (const line of readFileSync(
    resolve(ROOT, "data/scripture/packages/oshb-wlc/tokens.jsonl"),
    "utf8",
  ).split("\n")) {
    if (line === "") continue;
    const t = JSON.parse(line) as { book: string; chapter: number; verse: number; surface: string; strong?: string };
    const key = `${t.book}.${t.chapter}.${t.verse}`;
    const segs = verses.get(key) ?? [];
    const strong = normStrong(t.strong);
    for (let i = 0; i < t.surface.split("/").length; i += 1) segs.push({ strong });
    verses.set(key, segs);
    const w = wordsPerVerse.get(key) ?? [];
    w.push(strong);
    wordsPerVerse.set(key, w);
  }
  assert.ok(verses.size > 20_000, `expected the whole OT, got ${verses.size} verses`);

  // FFR entries do not carry Strong codes, so score by "is the predicted index
  // inside the verse at all" — the discriminator that already separates the two
  // readings by 28 points.
  let morphemeInRange = 0;
  let wordInRange = 0;
  let tested = 0;
  for (const e of index.entries) {
    for (const ls of e.languageSets) {
      if (ls.language !== "Hebrew") continue;
      for (const r of ls.references) {
        const code = marbleBookToBookCode(r.bookNumber);
        if (!code) continue;
        const segs = verses.get(`${code}.${r.chapter}.${r.verse}`);
        const words = wordsPerVerse.get(`${code}.${r.chapter}.${r.verse}`);
        if (!segs || !words || r.morphemeOrdinal === null) continue;
        tested += 1;
        if (r.morphemeOrdinal <= segs.length) morphemeInRange += 1;
        if (r.morphemeOrdinal <= words.length) wordInRange += 1;
      }
    }
  }
  assert.ok(tested > 10_000, `expected a real sample, tested ${tested}`);
  const morphemePct = (100 * morphemeInRange) / tested;
  const wordPct = (100 * wordInRange) / tested;
  assert.ok(morphemePct > 97, `morpheme reading should be in range >97%, got ${morphemePct.toFixed(1)}%`);
  assert.ok(
    morphemePct - wordPct > 15,
    `morpheme reading should beat the word reading by >15 points, got ${morphemePct.toFixed(1)}% vs ${wordPct.toFixed(1)}%`,
  );
});

test("morphemeOrdinal halves the tail, and the odd tails are flagged rather than hidden", () => {
  const even = decodeMarbleReference("H00203300700030");
  assert.ok(even);
  assert.equal(even.tailWasOdd, false);
  assert.equal(even.morphemeOrdinal, 15);
  // 17 references in the corpus have an odd tail; halving is lossy for them,
  // so the flag has to survive into the decoded value.
  const odd = decodeMarbleReference("H00203300700031");
  assert.ok(odd);
  assert.equal(odd.rawTail, 31);
  assert.equal(odd.tailWasOdd, true);
  assert.equal(odd.morphemeOrdinal, 15);
  // Tail 0 means "no word given", which is a null ordinal, not ordinal 0.
  const zero = decodeMarbleReference("00100100100000");
  assert.ok(zero);
  assert.equal(zero.morphemeOrdinal, null);
});

test("decoding rejects malformed references instead of throwing", () => {
  for (const bad of ["", "007009015", "00700901500064X", "Z00700901500064", "abcdefghijklmn"]) {
    assert.equal(decodeMarbleReference(bad), null, `${bad} should not decode`);
  }
});

test("in-canon references the backbone rejects are reported as versification, not as bad data", () => {
  // Joel 4 exists in the Masoretic text; English Joel has three chapters.
  const joel = decodeMarbleReference("02900400300038");
  assert.ok(joel);
  assert.equal(marbleBookToBookCode(joel.bookNumber), "JOL");
  const r = resolveMarbleReference(joel, chaptersOf);
  assert.equal(r.ok, false);
  if (!r.ok) assert.equal(r.reason, "versification");

  // A deuterocanonical book is a different failure with a different remedy.
  const sirach = decodeMarbleReference("L07100100100010");
  assert.ok(sirach);
  const r2 = resolveMarbleReference(sirach, chaptersOf);
  assert.equal(r2.ok, false);
  if (!r2.ok) {
    assert.equal(r2.reason, "deuterocanon");
    assert.equal(r2.detail, "SIR");
  }
});

// ────────────────────────────── the nesting trap ─────────────────────────────

test("the naive ThemLex_Entry>LanguageSets parse finds nothing — which is why the floors exist", () => {
  const xml = readFileSync(resolve(DIR, "FLORA_1.1_en.xml"), "utf8");
  // The shape the brief describes: LanguageSets as a direct child of the entry.
  const naive = xml.match(/<ThemLex_Entry\b[^>]*>\s*(?:<Title>[^<]*<\/Title>\s*)?<LanguageSets>/g) ?? [];
  assert.equal(naive.length, 0, "if this ever matches, the source layout changed and the floors need re-measuring");
  // The real layout: under Sections/Section.
  assert.ok(/<Section\b[^>]*>[\s\S]{0,4000}?<LanguageSets>/.test(xml), "LanguageSets should sit under Section");
  // And the real parse found them.
  assert.equal(loadDoctor().perHandbook["FLORA"]?.["languageSets"], 283);
});

test("every measured floor is met and none is zero", () => {
  const doctor = loadDoctor();
  assert.equal(doctor.status, "healthy");
  assert.deepEqual(doctor.failures, []);
  for (const [name, ok] of Object.entries(doctor.checks)) assert.equal(ok, true, `check ${name} failed`);
  for (const handbook of UBS_FFR_HANDBOOKS) {
    const got = doctor.perHandbook[handbook];
    const floor = UBS_FFR_MIN_COUNTS[handbook];
    assert.ok(got, `no counts for ${handbook}`);
    for (const field of ["entries", "languageSets", "references", "images"] as const) {
      const value = got[field] ?? 0;
      assert.ok(value > 0, `${handbook}.${field} is zero`);
      assert.ok(value >= floor[field], `${handbook}.${field} ${value} < floor ${floor[field]}`);
    }
  }
  // The brief's own numbers for FLORA, confirmed.
  assert.equal(doctor.perHandbook["FLORA"]?.["references"], 1924);
  assert.equal(doctor.perHandbook["FLORA"]?.["images"], 202);
});

test("reference accounting balances: every reference lands in exactly one bucket", () => {
  const d = loadDoctor();
  const r = d.resolution;
  assert.equal(
    r.resolved + r.deuterocanon + r.versification + r.unknownBook + r.malformed,
    d.counts["references"],
  );
  assert.equal(r.malformed, 0);
  assert.equal(r.resolved, 19_786);
  assert.equal(d.counts["anchors"], r.resolved);
  // Septuagint and Vulgate references are wholly deuterocanonical: none of
  // them can resolve, and that is a property of the canon, not a bug.
  assert.equal(r.bySigil["septuagint"]?.resolved, 0);
  assert.equal(r.bySigil["vulgate-latin"]?.resolved, 0);
  assert.ok((r.bySigil["masoretic-hebrew"]?.resolved ?? 0) > 12_000);
});

// ──────────────────────────────── the Path trap ──────────────────────────────

test("Path is one wrong constant and is not carried into the output", () => {
  const doctor = loadDoctor();
  const values = Object.keys(doctor.pathQuirk.distinctValues);
  assert.deepEqual(values, [UBS_FFR_PATH_IS_UNUSABLE]);
  assert.match(UBS_FFR_PATH_IS_UNUSABLE, /\\/, "the upstream value is Windows-shaped");
  assert.match(UBS_FFR_PATH_IS_UNUSABLE, /FAUNA$/);
  // It says FAUNA, and FLORA's images carry it too.
  assert.ok(doctor.pathQuirk.floraImagesCarryingFaunaPath > 0);
  assert.equal(doctor.pathQuirk.floraImagesCarryingFaunaPath, 202);

  // No emitted image record has a path field at all — FileName + Collection
  // are the coordinates.
  const index = loadIndex();
  const images = index.entries.flatMap((e) => e.images);
  assert.ok(images.length > 0);
  for (const img of images.slice(0, 200)) {
    assert.ok(!("path" in img), "image records must not carry a path");
    assert.ok(!("Path" in img), "image records must not carry a Path");
    assert.ok(img.fileName.length > 0, `image ${img.id} has no fileName`);
  }
  const raw = readFileSync(resolve(DIR, "ubs-flora-fauna-index.json"), "utf8");
  assert.ok(!raw.includes("marble-images-flora-fauna-realia"), "the bad path leaked into the index");
});

// ───────────────────────────────── copyright ─────────────────────────────────

test("copyright is per image: a blanket UBS credit would be false attribution", () => {
  const index = loadIndex();
  const images = index.entries.flatMap((e) => e.images);
  const distinct = new Set(images.map((i) => i.copyright.raw));
  assert.ok(distinct.size >= 380, `expected >=380 distinct copyright strings, got ${distinct.size}`);

  // Real values from the source, which a blanket credit would erase.
  assert.ok([...distinct].some((c) => c === "Ray Pritz (UBS)"), "expected the Pritz credit");
  assert.ok(
    [...distinct].some((c) => c === "Olivier BEZES (Wikimedia Commons)"),
    "expected the Wikimedia contributor credit",
  );

  // The great majority are not UBS at all.
  const ubs = images.filter((i) => /United Bible Societies|\(UBS\)/i.test(i.copyright.raw)).length;
  assert.ok(ubs < images.length / 2, `${ubs}/${images.length} credit UBS — a blanket credit is still wrong`);

  // Machine-generated and unattributable plates are counted, not swept up.
  assert.equal(index.counts["machineGeneratedImages"], 80);
  assert.ok((index.counts["unattributableImages"] ?? 0) > 0);
});

test("parseImageCopyright keeps the raw string and only adds structure", () => {
  const wm = parseImageCopyright("© Mboesch, CC BY-SA 4.0, via Wikimedia Commons");
  assert.equal(wm.raw, "© Mboesch, CC BY-SA 4.0, via Wikimedia Commons");
  assert.equal(wm.holder, "Mboesch");
  assert.equal(wm.source, "Wikimedia Commons");
  assert.equal(wm.licenseHint, "CC BY-SA 4.0");
  assert.equal(wm.machineGenerated, false);
  assert.equal(wm.unattributable, false);

  const ai = parseImageCopyright("Image generated by ChatGPT using OpenAI technology");
  assert.equal(ai.machineGenerated, true);

  const empty = parseImageCopyright("");
  assert.equal(empty.unattributable, true);
  assert.equal(empty.raw, "");
  const unknown = parseImageCopyright("Source unknown");
  assert.equal(unknown.unattributable, true);
  assert.equal(unknown.raw, "Source unknown", "the raw string must survive verbatim");

  // The four Pritz spellings must not be silently merged into one credit.
  const spellings = [
    "Ray Pritz (UBS)",
    "© Ray Pritz (UBS)",
    "© Ray Pritz by United Bible Societies",
    "© Ray Pritz (UBS",
  ].map((s) => parseImageCopyright(s));
  for (const p of spellings) assert.equal(p.holder, "Ray Pritz");
  assert.equal(new Set(spellings.map((p) => p.raw)).size, 4, "raw strings must stay distinct");
});

// ──────────────────────────── attribution and licence ────────────────────────

test("attribution is verbatim, whole, and names each underlying monograph", () => {
  assert.equal(UBS_FFR_LICENSE, "CC-BY-SA-4.0");
  assert.match(UBS_FFR_ATTRIBUTION.FAUNA, /Edward R\. Hope © 2005 United Bible Societies\.$/);
  assert.match(UBS_FFR_ATTRIBUTION.FLORA, /Robert Koops © 2012 United Bible Societies\.$/);
  assert.match(UBS_FFR_ATTRIBUTION.REALIA, /Ray Pritz © 2009 United Bible Societies\.$/);
  assert.match(UBS_FFR_ATTRIBUTION.FAUNA, /^Animals in the Bible © United Bible Societies, 2025\./);
  assert.match(UBS_FFR_ATTRIBUTION.FLORA, /^Plants and Trees in the Bible © United Bible Societies, 2025\./);
  assert.match(UBS_FFR_ATTRIBUTION.REALIA, /^Human-made Things in the Bible © United Bible Societies, 2025\./);
  // The double space after "2025." is upstream. Preserve it.
  assert.ok(UBS_FFR_ATTRIBUTION.FLORA.includes("2025.  Adapted from:"));
  assert.ok(UBS_FFR_ATTRIBUTION.REALIA.includes("2025.  Adapted from:"));

  // Every string must appear in the shipped artefacts, not just in code.
  const index = loadIndex();
  for (const handbook of UBS_FFR_HANDBOOKS) {
    assert.equal(index.attribution[handbook], UBS_FFR_ATTRIBUTION[handbook]);
  }
  // And the README we copied must still contain them verbatim.
  const readme = readFileSync(resolve(DIR, "flora-fauna-realia-README.md"), "utf8");
  for (const handbook of UBS_FFR_HANDBOOKS) {
    assert.ok(readme.includes(UBS_FFR_ATTRIBUTION[handbook]), `${handbook} attribution not verbatim in the README`);
  }
});

test("the licence riders name the per-image problem and the missing REALIA PDF", () => {
  assert.ok(UBS_FFR_LICENSE_RIDERS.length >= 5);
  const all = UBS_FFR_LICENSE_RIDERS.join("\n");
  assert.match(all, /ShareAlike/);
  assert.match(all, /false attribution/i);
  assert.match(all, /NO equivalent PDF for REALIA/);
  assert.equal(loadIndex().licenseRiders.length, UBS_FFR_LICENSE_RIDERS.length);
});

// ───────────────────────────── images stay upstream ──────────────────────────

test("no image bytes were downloaded", () => {
  const files = readdirSync(DIR);
  for (const f of files) {
    assert.ok(!/\.(zip|jpg|jpeg|png|gif|webp|tif|tiff)$/i.test(f), `${f} looks like image payload`);
  }
  const doctor = loadDoctor();
  assert.equal(doctor.imagePolicy.downloaded, false);
  assert.equal(doctor.imagePolicy.totalBytesNotDownloaded, UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES);
  // The recorded sizes, so the 2.4 GB claim stays checkable.
  assert.equal(UBS_FFR_IMAGE_ARCHIVES.FAUNA.bytes, 391_931_013);
  assert.equal(UBS_FFR_IMAGE_ARCHIVES.FLORA.bytes, 369_165_143);
  assert.equal(UBS_FFR_IMAGE_ARCHIVES.REALIA.bytes, 1_629_685_060);
  assert.equal(
    UBS_FFR_IMAGE_ARCHIVES.FAUNA.bytes + UBS_FFR_IMAGE_ARCHIVES.FLORA.bytes + UBS_FFR_IMAGE_ARCHIVES.REALIA.bytes,
    UBS_FFR_IMAGE_ARCHIVE_TOTAL_BYTES,
  );
});

test("source files are byte-pinned by digest", () => {
  const doctor = loadDoctor();
  const expected: Record<string, string> = {
    "FLORA_1.1_en.xml": "4c28095fbe890b095ee67b936711ba244bce96c49c69aaa0d0878e8af65c44ab",
    "FAUNA_1.1_en.xml": "714331c25b0871d6fd406438c30241e96d6fbe4bd4820fc77b35cf3296be9fb5",
    "REALIA_1.1_en.xml": "5da878eb00cb6d283a0422ce94e095cfc476e0b6ec16c00e571366afc8c9fc55",
  };
  for (const [file, digest] of Object.entries(expected)) {
    const actual = createHash("sha256").update(readFileSync(resolve(DIR, file))).digest("hex");
    assert.equal(actual, digest, `${file} digest drifted`);
    assert.equal(doctor.sourceSha256[file], digest);
  }
});

// ──────────────────────────────── lemma joins ────────────────────────────────

test("lemma joins to the token packages are non-zero and reported per language", () => {
  const doctor = loadDoctor();
  const greek = doctor.lemmaJoins["greek"];
  assert.ok(greek, "no Greek join reported");
  assert.ok((greek["exact"] as number) > 0, "Greek join found nothing");
  assert.equal(greek["ffrDistinct"], 693);
  assert.equal(greek["exact"], 456);
  const hebrew = doctor.lemmaJoins["hebrew"];
  assert.ok((hebrew["inOshb"] as number) > 0, "Hebrew join reached nothing in oshb-wlc");
  assert.equal(hebrew["distinct"], 1059);
  // The bridge must be declared, because it is two hops and not a direct match.
  assert.match(String(hebrew["bridge"]), /Strong number/);
});

test("lemma helpers split alternatives and normalise both scripts", () => {
  assert.deepEqual(splitLemmaAlternatives("אֵלָה, אַלָּה").length, 2);
  assert.deepEqual(splitLemmaAlternatives("גֹּפֶר"), ["גֹּפֶר"]);
  // Points and cantillation go; final forms unify so a lemma joins an inflected
  // surface.
  assert.equal(hebrewConsonantalSkeleton("אֶ֖שֶׁל"), hebrewConsonantalSkeleton("אשל"));
  assert.equal(hebrewConsonantalSkeleton("מֶלֶךְ"), hebrewConsonantalSkeleton("מלכ"));
  assert.notEqual(hebrewConsonantalSkeleton("אשל"), "");
  // Greek: accents go, case folds.
  assert.equal(greekLemmaSkeleton("θρόνος"), greekLemmaSkeleton("ΘΡΟΝΟΣ".toLowerCase()));
  assert.notEqual(greekLemmaSkeleton("θρόνος"), "");
});

// ─────────────────────────── manifest shape and anchors ──────────────────────

test("the doctor report carries the manifest fields the other importers carry", () => {
  const doctor = loadDoctor() as unknown as Record<string, unknown>;
  for (const field of [
    "status",
    "snapshotDate",
    "generatedAt",
    "version",
    "source",
    "license",
    "licenseUrl",
    "licenseRiders",
    "attribution",
    "sourceSha256",
    "checks",
    "counts",
  ]) {
    assert.ok(field in doctor, `doctor report missing ${field}`);
  }
  assert.equal(doctor["license"], UBS_FFR_LICENSE);
});

test("anchors carry the morpheme ordinal without calling it a token position", () => {
  const anchors = JSON.parse(readFileSync(resolve(DIR, "ubs-flora-fauna-anchors.json"), "utf8")) as {
    note: string;
    anchors: Array<Record<string, unknown>>;
  };
  assert.ok(anchors.anchors.length > 19_000);
  const sample = anchors.anchors[0];
  assert.ok(sample);
  // The distinction that keeps a MARBLE ordinal from being mistaken for one of
  // our backbone-token slots.
  assert.ok("morphemeOrdinal" in sample);
  assert.ok(!("position" in sample), "must not emit a `position` field");
  assert.ok(!("tokenStart" in sample), "must not emit token narrowing");
  assert.match(anchors.note, /NOT a backbone-token position/);
  for (const a of anchors.anchors.slice(0, 500)) {
    assert.match(String(a["bref"]), /^bref:v1\/[A-Z0-9]{3}\.\d+\.\d+$/);
  }
});
