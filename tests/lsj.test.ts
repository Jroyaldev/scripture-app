import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, readSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  LSJ_ATTRIBUTION,
  LSJ_CITATION_OPEN,
  LSJ_LICENSE,
  detectLsjProvenance,
  extractLsjApparatusRefs,
  isLsjDataLine,
  lookupLsjSlice,
  lsjLookupCandidates,
  lsjMeaningToText,
  lsjShardIdForKey,
  parseLsjCitationLabel,
  parseLsjEntry,
  parseLsjMeaning,
  parseLsjRelation,
  type LsjEntry,
  type LsjIndexManifest,
  type LsjShardFile,
} from "../src/core/language/lsj.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LSJ_DIR = resolve(__dirname, "../data/scripture/lexicons/lsj");
const MANIFEST_PATH = resolve(LSJ_DIR, "lsj-index.json");
const DOCTOR_PATH = resolve(LSJ_DIR, "lsj-doctor-report.json");

function loadManifest(): LsjIndexManifest {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as LsjIndexManifest;
}

function loadShard(path: string): LsjShardFile {
  return JSON.parse(readFileSync(resolve(LSJ_DIR, path), "utf8")) as LsjShardFile;
}

/**
 * Every byte the lookup touched, and how it touched it.
 *
 * `wholeFileReads` and `rangeReads` are separate on purpose. The claim under
 * test is not "few bytes were read" — that could be satisfied by accident — it
 * is "no source file was read whole". So the lookup performs *all* of its I/O
 * through this ledger, and the test asserts both that `wholeFileReads` contains
 * no `.txt` AND that it is non-empty, so a lookup that silently did nothing
 * cannot pass. (See the `assertions-that-fail-open` rule: a check that passes
 * by finding nothing has to prove it looked in the right place.)
 */
type ReadLedger = {
  bytesRead: number;
  wholeFileReads: string[];
  rangeReads: Array<{ path: string; offset: number; length: number }>;
};

function newLedger(): ReadLedger {
  return { bytesRead: 0, wholeFileReads: [], rangeReads: [] };
}

function readWhole(ledger: ReadLedger, path: string): string {
  const text = readFileSync(path, "utf8");
  ledger.bytesRead += Buffer.byteLength(text);
  ledger.wholeFileReads.push(path);
  return text;
}

function readRange(ledger: ReadLedger, path: string, offset: number, length: number): string {
  const fd = openSync(path, "r");
  try {
    const buffer = Buffer.allocUnsafe(length);
    const n = readSync(fd, buffer, 0, length, offset);
    ledger.bytesRead += n;
    ledger.rangeReads.push({ path, offset, length: n });
    return buffer.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/**
 * Fetch one entry the way a word card will: manifest → shard → positioned read
 * of exactly the row's bytes. All I/O goes through the ledger.
 */
function fetchEntry(
  key: string,
  ledger: ReadLedger = newLedger(),
): { entry: LsjEntry; ledger: ReadLedger; rowBytes: number } {
  const manifest = JSON.parse(readWhole(ledger, MANIFEST_PATH)) as LsjIndexManifest;

  const shardId = lsjShardIdForKey(key);
  assert.notEqual(shardId, null, `no shard for ${key}`);
  const shardMeta = manifest.shards.find((shard) => shard.id === shardId);
  assert.ok(shardMeta, `manifest names no shard ${shardId}`);
  const shard = JSON.parse(
    readWhole(ledger, resolve(LSJ_DIR, shardMeta.path)),
  ) as LsjShardFile;

  const hit = lookupLsjSlice(shard, key);
  assert.ok(hit, `shard ${shardId} has no slice for ${key}`);
  const sourceFile = manifest.files[hit.slice.file];
  assert.ok(sourceFile, `manifest has no file ${hit.slice.file}`);

  const row = readRange(
    ledger,
    resolve(LSJ_DIR, sourceFile.path),
    hit.slice.offset,
    hit.slice.length,
  );
  const entry = parseLsjEntry(row);
  assert.ok(entry, `row at ${hit.slice.offset} did not parse`);
  return { entry, ledger, rowBytes: Buffer.byteLength(row) };
}

// ───────────────────────────────────────────────────────────────────────────
// The headline claim: one entry, without loading the file.
// ───────────────────────────────────────────────────────────────────────────

test("one LSJ entry is fetched without loading either source file", () => {
  const manifest = loadManifest();
  const rawBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  assert.equal(rawBytes, 32_208_907, "raw corpus size drifted from the pinned snapshot");

  const started = performance.now();
  const { entry, ledger, rowBytes } = fetchEntry("G749");
  const elapsedMs = performance.now() - started;

  // ── the structural claim: no source file was read whole ─────────────────
  // Proved twice over: nothing in the whole-file list is a .txt, and the two
  // .txt files are only ever touched by a positioned range read.
  assert.deepEqual(
    ledger.wholeFileReads.filter((path) => path.endsWith(".txt")),
    [],
    "the lookup read a raw source file in its entirety",
  );
  // Non-vacuity: it really did read the index, so the check above is not
  // passing merely because no I/O happened at all.
  assert.equal(ledger.wholeFileReads.length, 2, "expected exactly manifest + one shard");
  assert.ok(ledger.wholeFileReads[0]!.endsWith("lsj-index.json"));
  assert.match(ledger.wholeFileReads[1]!, /lsj-slices-0\.json$/);
  assert.equal(ledger.rangeReads.length, 1, "expected exactly one positioned read");
  assert.match(ledger.rangeReads[0]!.path, /TFLSJ-STEPBible-CC-BY\.txt$/);
  assert.ok(ledger.rangeReads[0]!.offset > 0, "the row must be found by offset, not at byte 0");

  // ── the byte bound ──────────────────────────────────────────────────────
  // Manifest (5,386 b) + one shard (49,727 b) + one row (1,265 b) = 56,378 b.
  // Generous ceiling so a reshard does not break the test, but still 500x
  // under the corpus and provably not a full read.
  assert.ok(
    ledger.bytesRead < 250_000,
    `expected < 250,000 b for one entry, read ${ledger.bytesRead}`,
  );
  assert.ok(
    ledger.bytesRead * 100 < rawBytes,
    `one lookup cost ${ledger.bytesRead} b, more than 1% of the ${rawBytes} b corpus`,
  );
  assert.ok(rowBytes < 8_000, `expected a small row, read ${rowBytes} b`);
  assert.equal(rowBytes, 1_265, "G749's row byte length drifted");

  // ── the time bound ──────────────────────────────────────────────────────
  // Measured at ~1.5 ms. Parsing both files into a Map measured 723 ms, so a
  // 250 ms ceiling still fails loudly if this ever regresses to a full parse.
  assert.ok(elapsedMs < 250, `expected < 250 ms for one entry, took ${elapsedMs.toFixed(1)} ms`);

  // ── non-vacuity: the entry must actually be an entry ────────────────────
  assert.equal(entry.key, "G749");
  assert.equal(entry.padded, "G0749");
  assert.equal(entry.greekNormalized, "ἀρχιερεύς".normalize("NFC"));
  assert.equal(entry.transliteration, "archiereus");
  assert.equal(entry.gloss, "high-priest");
  assert.equal(entry.meaning.provenance, "lsj");
  assert.ok(entry.meaning.nodes.length >= 20, `only ${entry.meaning.nodes.length} nodes`);
  assert.equal(entry.meaning.citations.length, 5);

  const text = lsjMeaningToText(entry.meaning);
  assert.ok(text.length > 200, `definition text is only ${text.length} chars`);
  assert.match(text, /chief-priest/);
  // The parity doc measured column 8 at 1,070 chars for this word. Hold that.
  assert.equal(readColumn8("G749").length, 1_070);
});

/** Re-read one row and hand back column 8 verbatim, for length assertions. */
function readColumn8(key: string): string {
  const manifest = loadManifest();
  const shard = loadShard(manifest.shards.find((s) => s.id === lsjShardIdForKey(key))!.path);
  const hit = lookupLsjSlice(shard, key)!;
  const fd = openSync(resolve(LSJ_DIR, manifest.files[hit.slice.file]!.path), "r");
  try {
    const buffer = Buffer.allocUnsafe(hit.slice.length);
    readSync(fd, buffer, 0, hit.slice.length, hit.slice.offset);
    return buffer.toString("utf8").split("\t")[7] ?? "";
  } finally {
    closeSync(fd);
  }
}

test("random access holds for the largest entry and the last shard", () => {
  // λόγος is the biggest entry in the corpus at 72,003 chars of column 8.
  const logos = fetchEntry("G3056");
  assert.equal(logos.entry.greekNormalized, "λόγος".normalize("NFC"));
  assert.ok(logos.rowBytes > 70_000, `expected the big row, got ${logos.rowBytes} b`);
  assert.ok(
    logos.ledger.bytesRead < 250_000,
    `even the largest entry must stay small: ${logos.ledger.bytesRead} b`,
  );
  assert.deepEqual(logos.ledger.wholeFileReads.filter((p) => p.endsWith(".txt")), []);
  assert.ok(logos.entry.meaning.citations.length > 100);
  assert.ok(lsjMeaningToText(logos.entry.meaning).length > 10_000);

  // An entry from the extra file, proving both files are addressable.
  const extra = fetchEntry("G6000");
  assert.equal(extra.entry.greekNormalized, "ἀγγέλλω".normalize("NFC"));
  assert.equal(extra.entry.gloss, "to report");
  assert.ok(lsjMeaningToText(extra.entry.meaning).length > 100);
});

// ───────────────────────────────────────────────────────────────────────────
// Citations: separated, never stripped.
// ───────────────────────────────────────────────────────────────────────────

test("citation apparatus is lifted out of the prose, not discarded", () => {
  const { entry } = fetchEntry("G749");
  const text = lsjMeaningToText(entry.meaning);

  // The definition side must be clean of the citation machinery. In
  // particular the javascript: href must never reach a render surface.
  assert.doesNotMatch(text, /javascript:/);
  assert.doesNotMatch(text, /<a\b/);
  assert.doesNotMatch(text, /title=/);
  assert.doesNotMatch(text, /<\/?Level\d>/);
  assert.doesNotMatch(text, /Refs \d/, "a citation label leaked into the prose");

  // And the apparatus side must still be there, in full.
  for (const citation of entry.meaning.citations) {
    assert.ok(citation.label.length > 0, "citation lost its label");
    assert.ok(citation.apparatus.length > 0, "citation lost its apparatus");
    assert.ok(citation.apparatusText.length > 0, "apparatus did not resolve to text");
    assert.doesNotMatch(citation.apparatusText, /<[a-z]/i, "markup survived in apparatusText");
    assert.equal(citation.inline, false);
  }

  const first = entry.meaning.citations[0]!;
  assert.equal(first.label, "Refs 5th c.BC+");
  assert.equal(first.bracketed, true);
  assert.equal(first.openEnded, true);
  assert.deepEqual(first.dating, { centuries: [5], era: "BC", uncertain: false });
  assert.match(first.apparatus, /Herodotus/);

  // This word's apparatus names a NT reference; it must be captured verbatim
  // and NOT remapped to an app book id.
  const withNt = entry.meaning.citations.find((c) => c.corpora.includes("NT"));
  assert.ok(withNt, "expected an NT citation on G749");
  assert.deepEqual(withNt.refs, ["LXX.Lev.4.3", "NT.Matt.26.3"]);
  assert.ok(
    withNt.refs.some((ref) => ref.startsWith("NT.")),
    "an NT-labelled citation must name at least one NT reference",
  );

  // Every citation must be reachable from the prose by its placeholder, and
  // the placeholders must be in reading order with no dangling index.
  const placeholders = entry.meaning.nodes.filter((n) => n.kind === "citation");
  assert.equal(placeholders.length, entry.meaning.citations.length);
  placeholders.forEach((node, i) => {
    assert.equal(node.kind === "citation" && node.citation, i);
  });
});

test("the source's own [ ] delimiters are removed from prose and recorded", () => {
  const meaning = parseLsjMeaning(
    `<b>without weight,</b> [${LSJ_CITATION_OPEN} 4th c.BC: Aristoteles\">Refs 4th c.BC+</a>]; <b>light,</b>`,
  );
  assert.equal(meaning.citations.length, 1);
  assert.equal(meaning.citations[0]!.bracketed, true);
  assert.equal(meaning.citations[0]!.label, "Refs 4th c.BC+");
  assert.equal(meaning.citations[0]!.apparatus, " 4th c.BC: Aristoteles");
  const text = lsjMeaningToText(meaning);
  assert.equal(text, "without weight, ; light,");
  assert.doesNotMatch(text, /[[\]]/, "a bracket delimiter survived into the prose");
});

test("an unbracketed citation keeps whatever bracket the source did write", () => {
  // Open bracket with no closing one: the `[` belongs to the prose, so it must
  // survive rather than being eaten with the marker.
  const meaning = parseLsjMeaning(`ἀ. χρῆμα [${LSJ_CITATION_OPEN}apparatus\">Refs</a> tail`);
  assert.equal(meaning.citations.length, 1);
  assert.equal(meaning.citations[0]!.bracketed, false);
  assert.match(lsjMeaningToText(meaning), /\[/);
});

test("citation labels parse into corpora, dating and open-endedness", () => {
  assert.deepEqual(parseLsjCitationLabel("Refs 5th c.BC+"), {
    corpora: [],
    dating: { centuries: [5], era: "BC", uncertain: false },
    openEnded: true,
  });
  assert.deepEqual(parseLsjCitationLabel("LXX+NT"), {
    corpora: ["LXX", "NT"],
    dating: null,
    openEnded: false,
  });
  assert.deepEqual(parseLsjCitationLabel("NT"), {
    corpora: ["NT"],
    dating: null,
    openEnded: false,
  });
  assert.deepEqual(parseLsjCitationLabel("Refs 2nd c.AD"), {
    corpora: [],
    dating: { centuries: [2], era: "AD", uncertain: false },
    openEnded: false,
  });
  // A span states two centuries. It must keep both rather than silently
  // collapsing to one — for BC the larger number is the earlier one.
  const span = parseLsjCitationLabel("LXX+5th-6th c.BC+");
  assert.deepEqual(span.corpora, ["LXX"]);
  assert.deepEqual(span.dating, { centuries: [5, 6], era: "BC", uncertain: false });
  assert.equal(span.openEnded, true);
  assert.equal(parseLsjCitationLabel("Refs 5th c.AD(?)").dating?.uncertain, true);
});

test("apparatus scripture refs are captured verbatim, LXX dual numbering included", () => {
  assert.deepEqual(extractLsjApparatusRefs(" NT.Luke.8.31, NT.Rom.10.7, NT.Rev.9.1, etc."), [
    "NT.Luke.8.31",
    "NT.Rom.10.7",
    "NT.Rev.9.1",
  ]);
  assert.deepEqual(extractLsjApparatusRefs("LXX.1Ki.21(20).23. "), ["LXX.1Ki.21(20).23"]);
  assert.deepEqual(extractLsjApparatusRefs("no references here"), []);
});

// ───────────────────────────────────────────────────────────────────────────
// Sense structure.
// ───────────────────────────────────────────────────────────────────────────

test("Level markers become sense dividers, never literal tags", () => {
  const meaning = parseLsjMeaning(
    "first sense<br /><Level2><b>__II</b></Level2> second sense" +
      "<br /><Level3><b>__II.1</b></Level3> a sub-sense",
  );
  const senses = meaning.nodes.filter((n) => n.kind === "sense");
  assert.equal(senses.length, 2);
  assert.deepEqual(senses[0], { kind: "sense", depth: 2, label: "II" });
  assert.deepEqual(senses[1], { kind: "sense", depth: 3, label: "II.1" });
  assert.equal(meaning.maxSenseDepth, 3);
  assert.doesNotMatch(lsjMeaningToText(meaning), /Level|__/);
});

test("an unclosed Level marker does not swallow the rest of the entry", () => {
  // 4 rows upstream open a Level and never close it, using it as a bare indent.
  const meaning = parseLsjMeaning("before<br /><Level1><br /><Level4><b>__b</b></Level4> after");
  const senses = meaning.nodes.filter((n) => n.kind === "sense");
  assert.equal(senses.length, 2);
  assert.equal(senses[0]!.kind === "sense" && senses[0].depth, 1);
  assert.equal(senses[1]!.kind === "sense" && senses[1].depth, 4);
  assert.match(lsjMeaningToText(meaning), /after/);
});

test("scripture references keep both machine ref and printed text", () => {
  const meaning = parseLsjMeaning("<b>Aaron</b> (<ref='Exo.4.14'>Exo.4:14</ref>, al.)");
  const refs = meaning.nodes.filter((n) => n.kind === "scriptureRef");
  assert.equal(refs.length, 1);
  assert.deepEqual(refs[0], { kind: "scriptureRef", ref: "Exo.4.14", text: "Exo.4:14" });
  assert.match(lsjMeaningToText(meaning), /Aaron \(Exo\.4:14, al\.\)/);
});

test("inline <date><author> citations are marked as having no hover text", () => {
  const meaning = parseLsjMeaning(
    "<b>Epicurean </b>, [<date><i>variant</i> dates<author>Anthology Palantina</author></date>;",
  );
  assert.equal(meaning.citations.length, 1);
  const citation = meaning.citations[0]!;
  assert.equal(citation.inline, true);
  assert.match(citation.apparatusText, /Anthology Palantina/);
  assert.doesNotMatch(lsjMeaningToText(meaning), /<date>|<author>/);
});

// ───────────────────────────────────────────────────────────────────────────
// Provenance: the Abbott-Smith rows are not empty.
// ───────────────────────────────────────────────────────────────────────────

test("provenance markers are detected and mutually exclusive", () => {
  assert.equal(detectLsjProvenance(""), "empty");
  assert.equal(detectLsjProvenance("   "), "empty");
  assert.equal(
    detectLsjProvenance("prose <BR />  (From Abbott-Smith. LSJ has no entry)"),
    "abbott-smith-fallback",
  );
  assert.equal(detectLsjProvenance("prose  (Middle Liddel)"), "middle-liddell");
  assert.equal(detectLsjProvenance("Transliteration of Hebrew. Not in LSJ."), "not-in-lsj");
  assert.equal(detectLsjProvenance("<b>ἀβαρής</b>, ές"), "lsj");
});

test("the 543 Abbott-Smith fallback rows carry real prose, not an empty stub", () => {
  // docs/step-word-card-parity.md §3 says to treat these as absent. Measured:
  // they are 102-1,436 chars of Abbott-Smith with senses and references. The
  // right move is a different byline, not a dropped block.
  const aaron = fetchEntry("G2");
  assert.equal(aaron.entry.meaning.provenance, "abbott-smith-fallback");
  const text = lsjMeaningToText(aaron.entry.meaning);
  assert.ok(text.length > 60, `Abbott-Smith fallback row was ${text.length} chars`);
  assert.match(text, /Aaron/);
  assert.ok(
    aaron.entry.meaning.nodes.some((n) => n.kind === "scriptureRef"),
    "expected scripture references in the fallback prose",
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Keys.
// ───────────────────────────────────────────────────────────────────────────

test("column 2 is the key, and it is canonicalised unpadded", () => {
  const line = [
    "G0002",
    "G0002 = the Greek of",
    "H0175",
    "Ἀαρών",
    "Aarōn",
    "N:N-M-P",
    "Aaron",
    "<b>Ἀαρών</b>",
  ].join("\t");
  const entry = parseLsjEntry(line);
  assert.ok(entry);
  assert.equal(entry.key, "G2");
  assert.equal(entry.padded, "G0002");
  assert.equal(entry.dStrong, "G0002");
  assert.equal(entry.eStrong, "G0002");
  assert.equal(entry.uStrong, "H0175", "uStrong is a cross-reference, kept as written");
  assert.equal(entry.relation, "the Greek of");
});

test("relation phrases parse to the closed set, unknown text does not leak", () => {
  assert.equal(parseLsjRelation("G0001G ="), "");
  assert.equal(parseLsjRelation("G0002 = the Greek of"), "the Greek of");
  assert.equal(parseLsjRelation("G0005 = a Name of"), "a Name of");
  assert.equal(parseLsjRelation("G0009 = something invented"), "");
});

test("lookup falls back from a sense-suffixed key to its plain base", () => {
  assert.deepEqual(lsjLookupCandidates("G4245G"), ["G4245G", "G4245"]);
  assert.deepEqual(lsjLookupCandidates("G0749"), ["G749"]);
  assert.deepEqual(lsjLookupCandidates("g749"), ["G749"]);
  assert.deepEqual(lsjLookupCandidates("nonsense"), []);
  assert.equal(lsjShardIdForKey("G0749"), 0);
  assert.equal(lsjShardIdForKey("G21502"), 21);
  assert.equal(lsjShardIdForKey("H430"), null, "Hebrew keys have no LSJ shard");
});

test("a split base reaches its senses through the manifest, without guessing one", () => {
  const manifest = loadManifest();
  // πρεσβύτερος — the parity doc's worked case. Plain G4245 has no row of its
  // own; the two senses must be offered, not silently picked.
  assert.deepEqual(manifest.senseSiblings["G4245"], ["G4245G", "G4245H"]);
  const shard = loadShard(manifest.shards.find((s) => s.id === 4)!.path);
  assert.equal(shard.slices["G4245"], undefined, "plain G4245 should not exist");
  assert.ok(shard.slices["G4245G"], "G4245G must be addressable");

  const elder = fetchEntry("G4245G");
  assert.equal(elder.entry.greekNormalized, "πρεσβύτερος".normalize("NFC"));
  assert.ok(lsjMeaningToText(elder.entry.meaning).length > 100);

  // 109 bases split across the corpus (108 in the main file, 1 in the extra).
  assert.equal(Object.keys(manifest.senseSiblings).length, 109);
  assert.equal(manifest.senseSiblings["G3137"]?.length, 7, "Μαρία splits 7 ways");
});

// ───────────────────────────────────────────────────────────────────────────
// Adversarial input.
// ───────────────────────────────────────────────────────────────────────────

test("the row gate rejects preamble, prose and malformed lines", () => {
  assert.equal(isLsjDataLine(""), false);
  assert.equal(isLsjDataLine("eStrong\tdStrong\tuStrong\tGreek"), false);
  assert.equal(isLsjDataLine("====="), false);
  assert.equal(isLsjDataLine("\tData created by www.STEPBible.org"), false);
  assert.equal(isLsjDataLine("* Gloss = a meaning in one word"), false);
  assert.equal(isLsjDataLine("G0001\tG0001G =\tG0001G"), true);
  assert.equal(isLsjDataLine("H0175\tH0175 ="), false, "Hebrew rows are not TFLSJ data");
  assert.equal(parseLsjEntry("not a row at all"), null);
  assert.equal(parseLsjEntry("G0001\ttoo\tfew"), null);
  assert.equal(parseLsjEntry(""), null);
});

test("the parser survives truncated markup without losing text", () => {
  // Unterminated title: keep the text rather than silently dropping the tail.
  const truncated = parseLsjMeaning(`prose [${LSJ_CITATION_OPEN}apparatus with no close`);
  assert.match(lsjMeaningToText(truncated), /prose/);

  // Unterminated ref, unknown tag, unquoted attribute, stray close tag.
  assert.match(lsjMeaningToText(parseLsjMeaning("a <ref='X.1.1'>text")), /text/);
  assert.match(
    lsjMeaningToText(parseLsjMeaning("τὸ <span class=hiunderline>σκλα καὶ στρα")),
    /σκλα καὶ στρα/,
  );
  assert.match(lsjMeaningToText(parseLsjMeaning("orphan</a> tail")), /orphan tail/);
  assert.match(lsjMeaningToText(parseLsjMeaning("dangling <")), /dangling/);
  assert.equal(lsjMeaningToText(parseLsjMeaning("")), "");
  assert.equal(parseLsjMeaning("").citations.length, 0);
});

test("a title containing markup and '>' still parses as one citation", () => {
  // 5 anchors upstream put <b>/<i> inside the title, so the value contains '>'.
  // A `<a[^>]*>` regex would split the anchor; the scan terminates on '">'.
  const meaning = parseLsjMeaning(
    `head [${LSJ_CITATION_OPEN} Thucydides 1.37; ἐπ᾽ ἀγαθῇ <b>with.. </b>, cf. NT.Rom.4.1\">Refs 5th c.BC+</a>] tail`,
  );
  assert.equal(meaning.citations.length, 1);
  assert.match(meaning.citations[0]!.apparatus, /<b>with\.\. <\/b>/);
  assert.equal(meaning.citations[0]!.apparatusText.includes("<b>"), false);
  assert.deepEqual(meaning.citations[0]!.refs, ["NT.Rom.4.1"]);
  assert.equal(lsjMeaningToText(meaning), "head tail");
});

test("the one upstream unterminated-title row is flagged, not silently reflowed", () => {
  // G7417 ἐπικλύζω, extra file: a `title="` runs on and swallows definition
  // prose including a `</a>`. Deterministic outcome, marked suspect.
  const { entry } = fetchEntry("G7417");
  assert.equal(entry.greekNormalized, "ἐπικλύζω".normalize("NFC"));
  const suspect = entry.meaning.citations.filter((c) => c.suspect);
  assert.equal(suspect.length, 1, "expected exactly one suspect citation on G7417");
  assert.match(suspect[0]!.apparatus, /<\/a>/);
  assert.ok(lsjMeaningToText(entry.meaning).length > 100, "the entry still yields prose");
});

test("empty column 8 is reported as empty rather than faked", () => {
  const { entry } = fetchEntry("G21425");
  assert.equal(entry.meaning.provenance, "empty");
  assert.equal(entry.meaning.nodes.length, 0);
  assert.equal(entry.meaning.citations.length, 0);
  assert.equal(lsjMeaningToText(entry.meaning), "");
});

// ───────────────────────────────────────────────────────────────────────────
// Whole-corpus sweep. Exact counts, so a loop that finds nothing fails.
// ───────────────────────────────────────────────────────────────────────────

test("every row in both files parses, with exact counts and no markup leaks", () => {
  const manifest = loadManifest();
  let rows = 0;
  let citations = 0;
  let bracketed = 0;
  let inline = 0;
  let suspect = 0;
  let senseMarkers = 0;
  let scriptureRefs = 0;
  let column8Chars = 0;
  let mainRows = 0;
  let mainColumn8Chars = 0;
  let emptyMeanings = 0;
  let leaks = 0;
  let labelledCitations = 0;
  const provenance = new Map<string, number>();
  const keys = new Set<string>();

  for (const file of manifest.files) {
    const text = readFileSync(resolve(LSJ_DIR, file.path), "utf8");
    let fileRows = 0;
    for (const line of text.split("\n")) {
      const entry = parseLsjEntry(line);
      if (!entry) continue;
      rows += 1;
      fileRows += 1;
      keys.add(entry.key);
      const column8 = line.split("\t")[7] ?? "";
      column8Chars += column8.length;
      if (file.id === 0) {
        mainRows += 1;
        mainColumn8Chars += column8.length;
      }
      provenance.set(
        entry.meaning.provenance,
        (provenance.get(entry.meaning.provenance) ?? 0) + 1,
      );
      if (entry.meaning.provenance === "empty") emptyMeanings += 1;
      citations += entry.meaning.citations.length;
      for (const citation of entry.meaning.citations) {
        if (citation.bracketed) bracketed += 1;
        if (citation.inline) inline += 1;
        if (citation.suspect) suspect += 1;
        if (citation.label.length > 0) labelledCitations += 1;
        scriptureRefs += citation.refs.length;
      }
      for (const node of entry.meaning.nodes) {
        if (node.kind === "sense") senseMarkers += 1;
        if (node.kind === "scriptureRef") scriptureRefs += 1;
        if (node.kind === "text" && /javascript:|<a\b|<\/a>|<Level\d>|title="/.test(node.text)) {
          leaks += 1;
        }
      }
    }
    assert.equal(fileRows, file.rowCount, `row count drifted in ${file.path}`);
  }

  // Exact, non-zero, and matched to the parity doc where it measured them.
  assert.equal(rows, 11_034);
  assert.equal(keys.size, 11_034, "keys must be unique across both files");
  assert.equal(mainRows, 5_709, "docs/step-word-card-parity.md §4: 5,709 TFLSJ rows");
  assert.equal(
    Math.round((mainColumn8Chars / mainRows) * 100) / 100,
    3_559.3,
    "docs/step-word-card-parity.md §4: mean 3,559 chars per entry",
  );
  assert.equal(column8Chars, 27_368_537);
  assert.equal(citations, 121_856);
  assert.equal(labelledCitations, 121_856, "every citation must keep a label");
  assert.equal(bracketed, 121_824);
  assert.equal(citations - bracketed, 32);
  assert.equal(inline, 3);
  assert.equal(suspect, 1);
  assert.equal(senseMarkers, 33_592);
  assert.equal(scriptureRefs, 13_314);
  assert.equal(leaks, 0, "citation markup leaked into definition prose");
  assert.equal(emptyMeanings, 77);
  assert.deepEqual(
    [...provenance.entries()].sort(),
    [
      ["abbott-smith-fallback", 543],
      ["empty", 77],
      ["lsj", 10_260],
      ["middle-liddell", 33],
      ["not-in-lsj", 121],
    ],
  );
});

test("every recorded slice re-reads exactly its own row", () => {
  const manifest = loadManifest();
  const shards = manifest.shards.map((shard) => loadShard(shard.path));
  let verified = 0;
  let mismatches = 0;

  for (const file of manifest.files) {
    const buffer = readFileSync(resolve(LSJ_DIR, file.path));
    for (const shard of shards) {
      for (const [key, slice] of Object.entries(shard.slices)) {
        if (slice.file !== file.id) continue;
        const row = buffer.toString("utf8", slice.offset, slice.offset + slice.length);
        const entry = parseLsjEntry(row);
        if (entry?.key === key) verified += 1;
        else mismatches += 1;
        // The slice must stop at the row boundary, never spill into the next.
        if (row.includes("\n")) mismatches += 1;
      }
    }
  }

  assert.equal(mismatches, 0);
  assert.equal(verified, 11_034, "every entry must be reachable by its slice");
  assert.equal(
    manifest.shards.reduce((sum, shard) => sum + shard.entryCount, 0),
    11_034,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Provenance of the artefact itself.
// ───────────────────────────────────────────────────────────────────────────

test("the index states its source, licence and a sha256 of every input", () => {
  const manifest = loadManifest();
  assert.equal(manifest.version, 1);
  assert.equal(manifest.source, "STEPBible TFLSJ");
  assert.equal(manifest.license, "CC BY 4.0");
  assert.equal(manifest.attribution, LSJ_ATTRIBUTION);
  assert.equal(LSJ_ATTRIBUTION, "STEPBible TFLSJ, CC BY 4.0, stepbible.org.");
  assert.equal(LSJ_LICENSE, "CC-BY-4.0");
  assert.match(manifest.generatedAt, /^\d{4}-\d{2}-\d{2}T00:00:00\.000Z$/);
  assert.equal(manifest.entryCount, 11_034);
  assert.equal(manifest.files.length, 2);

  for (const file of manifest.files) {
    const path = resolve(LSJ_DIR, file.path);
    const bytes = readFileSync(path);
    assert.equal(statSync(path).size, file.bytes, `${file.path} size drifted`);
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      file.sha256,
      `${file.path} content drifted from the recorded sha256`,
    );
    // Shipped byte-identical: the upstream licence block must still be there.
    assert.match(bytes.toString("utf8", 0, 400), /STEPBible\.org CC BY/);
    assert.ok(file.upstreamName.includes("Translators Formatted full LSJ"));
  }
  // The upstream name of the first file really does carry a double space.
  assert.ok(manifest.files[0]!.upstreamName.startsWith("TFLSJ  0-5624"));

  assert.equal(manifest.files[0]!.bytes, 23_831_837);
  assert.equal(manifest.files[1]!.bytes, 8_377_070);
});

test("the index is a small fraction of the corpus it indexes", () => {
  const manifest = loadManifest();
  const rawBytes = manifest.files.reduce((sum, file) => sum + file.bytes, 0);
  let indexBytes = statSync(MANIFEST_PATH).size;
  for (const shard of manifest.shards) {
    indexBytes += statSync(resolve(LSJ_DIR, shard.path)).size;
  }
  assert.ok(indexBytes > 0);
  // Measured 555,697 b = 1.73%. A single-blob index of parsed entries measured
  // 87,570,887 b, i.e. 272% of the corpus — see scripts/import-lsj.ts.
  assert.ok(
    indexBytes * 20 < rawBytes,
    `index is ${indexBytes} b against ${rawBytes} b of source, over 5%`,
  );
  assert.ok(statSync(MANIFEST_PATH).size < 32_768, "the manifest must stay tiny");
  for (const shard of manifest.shards) {
    assert.ok(
      statSync(resolve(LSJ_DIR, shard.path)).size < 131_072,
      `shard ${shard.id} is too big to load for one entry`,
    );
  }
});

test("the LSJ Doctor passed every check on the shipped artefact", () => {
  const doctor = JSON.parse(readFileSync(DOCTOR_PATH, "utf8")) as {
    status: string;
    checks: Record<string, boolean>;
    coverage: Record<string, unknown>;
    source: { attribution: string; license: string };
  };
  assert.equal(doctor.status, "healthy");
  assert.deepEqual(
    Object.entries(doctor.checks).filter(([, passed]) => !passed),
    [],
  );
  assert.ok(Object.keys(doctor.checks).length >= 20, "the Doctor must actually check things");
  assert.equal(doctor.coverage.entryCount, 11_034);
  assert.equal(doctor.coverage.citations, 121_856);
  assert.equal(doctor.coverage.sliceReadsVerified, 11_034);
  assert.equal(doctor.source.attribution, LSJ_ATTRIBUTION);
  assert.equal(doctor.source.license, "CC BY 4.0");
});
