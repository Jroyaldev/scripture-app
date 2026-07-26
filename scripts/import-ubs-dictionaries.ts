/**
 * Import the UBS semantic dictionaries → one built index.
 *
 *   npm run import:ubs-dictionaries
 *
 * Reads the four raw upstream files from `data/scripture/lexicons/ubs/` and
 * writes `data/scripture/lexicons/ubs/ubs-semantic-index.json` plus a doctor
 * report, in the manifest style `scripts/import-tipnr.ts` set: every generated
 * index states its source, its licence, and a sha256 of the input.
 *
 * Node I/O only. All parsing lives in
 * `src/core/language/ubs-semantic-dictionary.ts`.
 *
 * Source: https://github.com/ubsicap/ubs-open-license — CC BY-SA 4.0.
 * The verbatim attribution strings are carried in the pure module and copied
 * into the generated index; see UBS_ATTRIBUTION there.
 *
 * If a raw file is missing, run:
 *   B=https://raw.githubusercontent.com/ubsicap/ubs-open-license/main/dictionaries
 *   curl -sSLO "$B/hebrew/JSON/UBSHebrewDic-v0.9.2-en.JSON"
 *   curl -sSLO "$B/hebrew/JSON/UBSHebrewDicLexicalDomains-v0.9.2-en.JSON"
 *   curl -sSLO "$B/greek/JSON/UBSGreekNTDic-v1.1-en.JSON"
 *   curl -sSLO "$B/greek/JSON/UBSGreekNTDicLexicalDomains-v1.1-en.JSON"
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  UBS_DOMAIN_SCHEME_OF,
  UBS_SOURCES,
  buildUbsIndex,
  parseUbsDictionary,
  parseUbsDomainTree,
  type UbsDictionaryId,
  type UbsDomainNode,
  type UbsIndexFile,
  type UbsParsedDictionary,
} from "../src/core/language/ubs-semantic-dictionary.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const RAW_DIR = resolve(ROOT, "data/scripture/lexicons/ubs");
const OUTPUT = resolve(RAW_DIR, "ubs-semantic-index.json");
const DOCTOR_OUTPUT = resolve(RAW_DIR, "ubs-doctor-report.json");

/**
 * Snapshot date of the upstream download, recorded the way
 * `import-tipnr.ts` records `TIPNR_SNAPSHOT_DATE`. Upstream has no release
 * tags; the version lives in the filename and the digest below pins the bytes.
 */
const UBS_SNAPSHOT_DATE = "2026-07-26";

/**
 * Digests of the exact bytes this importer was written against, so a silent
 * upstream edit shows up as a doctor failure instead of a changed index.
 * Measured with `shasum -a 256` on the downloaded files.
 */
const EXPECTED_SHA256: Readonly<Record<string, string>> = {
  "UBSHebrewDic-v0.9.2-en.JSON":
    "1686a25dd31dc9afb7b932927e160070667c73caedad11aa7e4482c21f800e8e",
  "UBSHebrewDicLexicalDomains-v0.9.2-en.JSON":
    "fbc862b2c46966cf7f3bf19c2f3e79a7391c34f8c737e1979fa5178ac603d0df",
  "UBSGreekNTDic-v1.1-en.JSON":
    "d84bb9077a43fa4a4f7e571fe2ffa460fa655d7b78439b366281ce527fd56893",
  "UBSGreekNTDicLexicalDomains-v1.1-en.JSON":
    "a816a6bb2bdbdd7df6f46f771b5ddb1b9c019d73c3f0147e5a5cead5cfef8b4b",
};

/**
 * Floors on what a healthy parse must produce. Set from the measured run and
 * deliberately a little below it, so ordinary upstream growth passes and a
 * collapse fails. The point of the floors is the fail-open rule: a run that
 * parses nothing must not report success.
 */
const FLOORS = {
  sdbh: { entries: 7_900, meanings: 16_000, references: 250_000, strongKeys: 8_500 },
  sdgnt: { entries: 5_400, meanings: 9_000, references: 125_000, louwNida: 7_000 },
  domainNodes: { sdbh: 400, sdgnt: 700 },
} as const;

function sha256(buf: Buffer | string): string {
  return createHash("sha256").update(buf).digest("hex");
}

type LoadedFile = { path: string; bytes: number; sha256: string; json: unknown };

function load(name: string): LoadedFile {
  const path = resolve(RAW_DIR, name);
  if (!existsSync(path)) {
    throw new Error(
      `Missing UBS source: ${path}\n` +
        "Download it from https://github.com/ubsicap/ubs-open-license " +
        "(dictionaries/hebrew/JSON or dictionaries/greek/JSON). " +
        "See the header of this file for the curl commands.",
    );
  }
  const raw = readFileSync(path);
  const digest = sha256(raw);
  return { path, bytes: statSync(path).size, sha256: digest, json: JSON.parse(raw.toString("utf8")) };
}

type Part = {
  id: UbsDictionaryId;
  parsed: UbsParsedDictionary;
  domainNodes: UbsDomainNode[];
  sourceSha256: string;
  sourceBytes: number;
  domainSha256: string;
  domainBytes: number;
  digestMatchedExpected: boolean;
  domainDigestMatchedExpected: boolean;
};

function importOne(id: UbsDictionaryId): Part {
  const descriptor = UBS_SOURCES[id];
  const scheme = UBS_DOMAIN_SCHEME_OF[id];
  console.log(`Reading ${descriptor.file}`);
  const dict = load(descriptor.file);
  console.log(`Reading ${descriptor.domainFile}`);
  const domainFile = load(descriptor.domainFile);

  const domainNodes = parseUbsDomainTree(scheme, domainFile.json);
  // Referential integrity of every domain code the dictionary cites is
  // checked against the tree, not assumed.
  const domainTree = new Set(domainNodes.map((n) => n.code));
  const parsed = parseUbsDictionary(id, dict.json, { domainTree, language: "en" });

  return {
    id,
    parsed,
    domainNodes,
    sourceSha256: dict.sha256,
    sourceBytes: dict.bytes,
    domainSha256: domainFile.sha256,
    domainBytes: domainFile.bytes,
    digestMatchedExpected: EXPECTED_SHA256[descriptor.file] === dict.sha256,
    domainDigestMatchedExpected: EXPECTED_SHA256[descriptor.domainFile] === domainFile.sha256,
  };
}

type Doctor = {
  status: "healthy" | "unhealthy";
  snapshotDate: string;
  generatedAt: string;
  checks: Record<string, boolean>;
  counts: Record<string, number>;
  notes: string[];
  perDictionary: Record<string, unknown>;
};

function main(): void {
  const generatedAt = new Date().toISOString();
  const hebrew = importOne("sdbh");
  const greek = importOne("sdgnt");

  const index: UbsIndexFile = buildUbsIndex({
    generatedAt,
    parts: [hebrew, greek].map((p) => ({
      parsed: p.parsed,
      domainNodes: p.domainNodes,
      sourceSha256: p.sourceSha256,
      sourceBytes: p.sourceBytes,
      domainSha256: p.domainSha256,
      domainBytes: p.domainBytes,
    })),
  });

  const hDiag = hebrew.parsed.diagnostics;
  const gDiag = greek.parsed.diagnostics;
  const hRefs = hebrew.parsed.meanings.reduce((n, m) => n + m.references.length, 0);
  const gRefs = greek.parsed.meanings.reduce((n, m) => n + m.references.length, 0);
  const hebrewStrongKeys = new Set(hebrew.parsed.entries.flatMap((e) => e.strongKeys));
  const greekLouwNida = new Set(
    greek.parsed.meanings.map((m) => m.louwNida?.code).filter((c): c is string => Boolean(c)),
  );

  const counts: Record<string, number> = {
    sdbhEntries: hebrew.parsed.entries.length,
    sdbhMeanings: hebrew.parsed.meanings.length,
    sdbhReferences: hRefs,
    sdbhStrongKeys: hebrewStrongKeys.size,
    sdbhDomainNodes: hebrew.domainNodes.length,
    sdgntEntries: greek.parsed.entries.length,
    sdgntMeanings: greek.parsed.meanings.length,
    sdgntReferences: gRefs,
    sdgntLouwNidaCodes: greekLouwNida.size,
    sdgntDomainNodes: greek.domainNodes.length,
    byStrongKeys: Object.keys(index.byStrong).length,
    byStrongConstituentKeys: Object.keys(index.byStrongConstituent).length,
    byLouwNidaKeys: Object.keys(index.byLouwNida).length,
    byDomainKeys: Object.keys(index.byDomain).length,
    byRefKeys: Object.keys(index.byRef).length,
    domainNodesTotal: Object.keys(index.domains).length,
    entriesTotal: Object.keys(index.entries).length,
    meaningsTotal: Object.keys(index.meanings).length,
  };

  const checks: Record<string, boolean> = {
    // Non-zero floors. A parse that found nothing is a failure, not a pass.
    sdbhEntryFloor: counts.sdbhEntries! >= FLOORS.sdbh.entries,
    sdbhMeaningFloor: counts.sdbhMeanings! >= FLOORS.sdbh.meanings,
    sdbhReferenceFloor: counts.sdbhReferences! >= FLOORS.sdbh.references,
    sdbhStrongKeyFloor: counts.sdbhStrongKeys! >= FLOORS.sdbh.strongKeys,
    sdgntEntryFloor: counts.sdgntEntries! >= FLOORS.sdgnt.entries,
    sdgntMeaningFloor: counts.sdgntMeanings! >= FLOORS.sdgnt.meanings,
    sdgntReferenceFloor: counts.sdgntReferences! >= FLOORS.sdgnt.references,
    sdgntLouwNidaFloor: counts.sdgntLouwNidaCodes! >= FLOORS.sdgnt.louwNida,
    sdbhDomainNodeFloor: counts.sdbhDomainNodes! >= FLOORS.domainNodes.sdbh,
    sdgntDomainNodeFloor: counts.sdgntDomainNodes! >= FLOORS.domainNodes.sdgnt,
    // Bytes are the ones this importer was written against.
    hebrewDigestPinned: hebrew.digestMatchedExpected,
    hebrewDomainDigestPinned: hebrew.domainDigestMatchedExpected,
    greekDigestPinned: greek.digestMatchedExpected,
    greekDomainDigestPinned: greek.domainDigestMatchedExpected,
    // Referential integrity: every cited domain code exists in its own tree.
    sdbhDomainCodesResolve: hDiag.domainCodesNotInTree.length === 0,
    sdgntDomainCodesResolve: gDiag.domainCodesNotInTree.length === 0,
    // No inline markup shape went unmodelled.
    sdbhNoUnknownInlineTags: Object.keys(hDiag.unknownInlineTags).length === 0,
    sdgntNoUnknownInlineTags: Object.keys(gDiag.unknownInlineTags).length === 0,
    // Every reference decoded, footnote markers and all.
    sdbhAllReferencesDecoded: hDiag.referencesUndecodable === 0,
    sdgntAllReferencesDecoded: gDiag.referencesUndecodable === 0,
    // SDBH must be Strong's-keyed for the join to exist at all.
    sdbhIsStrongKeyed:
      hDiag.entriesWithoutStrongCode / Math.max(1, hDiag.entriesSeen) < 0.01,
    // SDGNT must carry Louw-Nida entry codes; SDBH must carry none.
    sdgntCarriesLouwNida: greekLouwNida.size > 0,
    sdbhCarriesNoLouwNida: hebrew.parsed.meanings.every((m) => m.louwNida === undefined),
    // The namespacing invariant: no bare domain code ever reaches the index.
    allDomainKeysNamespaced: Object.keys(index.byDomain).every(
      (k) => k.startsWith("sdbh:") || k.startsWith("louw-nida:"),
    ),
  };

  const notes: string[] = [
    `SDBH carries NO LEXEntryCode on any of its ${counts.sdbhMeanings} meanings; ` +
      "SDGNT carries one on essentially all of its. The Louw-Nida key exists on the " +
      "Greek side only, and MACULA already ships it on our Greek tokens.",
    `Domain codes are namespaced. ${counts.byDomainKeys} keys, all prefixed ` +
      "\"sdbh:\" or \"louw-nida:\". 18 bare codes collide between the two trees " +
      "with zero label agreement, so a bare code is never a valid key.",
    `SDBH StrongCodes rejected by reason: ${JSON.stringify(hDiag.strongCodesRejected)}. ` +
      "These are upstream data defects, not parser failures; each is recorded, none guessed.",
    `${hDiag.aramaicSigilCodes} SDBH codes used the Aramaic \"A\" sigil and were ` +
      "rewritten A→H with the number untouched (Strong's interleaves Aramaic in the " +
      "one H series; proved against bdb-kjv.json H3/H4, H69, H412).",
    `${hDiag.aramaicHebrewNumberClashes.length} numbers carry both an H and an A code ` +
      `across different entries (${hDiag.aramaicHebrewNumberClashes.join(", ")}); each ` +
      "looks like an upstream off-by-one. NOT merged.",
    `${hDiag.contestedIdentityKeys.length} Hebrew and ${gDiag.contestedIdentityKeys.length} ` +
      "Greek canonical keys are claimed as an identity by more than one entry.",
    `${hDiag.constituentClaims} SDBH and ${gDiag.constituentClaims} SDGNT codes are ` +
      "constituent claims from a multi-word headword, routed to byStrongConstituent so " +
      "\"Ebenezer\" never attaches to every occurrence of \"stone\".",
    `${hDiag.referenceFootnotesInline} SDBH and ${gDiag.referenceFootnotesInline} SDGNT ` +
      "LEXReferences values carry an inline {N:nnn} footnote marker inside the reference " +
      "string, making the field variable-length. All handled.",
    "LEXReferences word field is an EVEN-numbered MORPHEME ordinal (word/2), not a token " +
      "ordinal. Our tokens keep Hebrew prefixes glued, so word-level joins need the " +
      "package change in docs/step-word-card-parity.md §2 field 40. Verse-level joins work now.",
  ];

  const doctor: Doctor = {
    status: Object.values(checks).every(Boolean) ? "healthy" : "unhealthy",
    snapshotDate: UBS_SNAPSHOT_DATE,
    generatedAt,
    checks,
    counts,
    notes,
    perDictionary: {
      sdbh: {
        file: UBS_SOURCES.sdbh.file,
        sourceSha256: hebrew.sourceSha256,
        sourceBytes: hebrew.sourceBytes,
        domainSha256: hebrew.domainSha256,
        domainBytes: hebrew.domainBytes,
        diagnostics: hDiag,
      },
      sdgnt: {
        file: UBS_SOURCES.sdgnt.file,
        sourceSha256: greek.sourceSha256,
        sourceBytes: greek.sourceBytes,
        domainSha256: greek.domainSha256,
        domainBytes: greek.domainBytes,
        diagnostics: gDiag,
      },
    },
  };

  writeFileSync(DOCTOR_OUTPUT, `${JSON.stringify(doctor, null, 2)}\n`);
  if (doctor.status !== "healthy") {
    const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
    throw new Error(
      `UBS Doctor refused the import. Failing checks: ${failed.join(", ")}. ` +
        `Report: ${DOCTOR_OUTPUT}`,
    );
  }

  const serialized = JSON.stringify(index);
  writeFileSync(OUTPUT, serialized);

  console.log(`Wrote ${OUTPUT}`);
  console.log(`  size: ${Buffer.byteLength(serialized)} bytes`);
  console.log(`  SDBH : ${counts.sdbhEntries} entries, ${counts.sdbhMeanings} meanings, ${counts.sdbhReferences} refs, ${counts.sdbhDomainNodes} domain nodes`);
  console.log(`  SDGNT: ${counts.sdgntEntries} entries, ${counts.sdgntMeanings} meanings, ${counts.sdgntReferences} refs, ${counts.sdgntDomainNodes} domain nodes`);
  console.log(`  byStrong keys           : ${counts.byStrongKeys}`);
  console.log(`  byStrongConstituent keys: ${counts.byStrongConstituentKeys}`);
  console.log(`  byLouwNida keys         : ${counts.byLouwNidaKeys}`);
  console.log(`  byDomain keys           : ${counts.byDomainKeys}`);
  console.log(`  byRef keys              : ${counts.byRefKeys}`);
  console.log(`  Doctor: ${DOCTOR_OUTPUT} (${doctor.status})`);
  console.log("  H3   ->", index.byStrong.H3, index.entryIds[index.byStrong.H3?.[0] ?? -1]);
  console.log("  H68  ->", index.byStrong.H68, "(constituents:", index.byStrongConstituent.H68, ")");
  console.log("  LN 53.89 ->", index.byLouwNida["53.89"]);
  console.log("  SNG.6.11 meanings:", index.byRef["SNG.6.11"]?.length ?? 0);
  console.log(`  licence: ${index.license} — attribution is carried verbatim in the index.`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) main();

export { EXPECTED_SHA256, FLOORS, UBS_SNAPSHOT_DATE };
