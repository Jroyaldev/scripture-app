import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  parseMaculaGreekTsv,
  parseOshbOsisBook,
  parseTokensJsonl,
} from "../src/core/language/index.js";
import { TokenPackageLoader } from "../src/host/token-package-loader.js";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = resolve(__dirname, "fixtures/macula-greek-1co13-sample.tsv");
const OSHB_FIXTURE = resolve(__dirname, "fixtures/oshb-gen1-sample.xml");
const HEBREW_GLOSS = resolve(__dirname, "../data/scripture/lexicons/strongs-hebrew-gloss.json");

function writeSamplePackage(root: string, packageId: string): string {
  const dir = join(root, packageId);
  mkdirSync(dir, { recursive: true });

  const tsv = readFileSync(FIXTURE, "utf8");
  const { tokens } = parseMaculaGreekTsv(tsv, {
    dataset: {
      id: packageId,
      name: "Test MACULA Greek",
      family: "macula-greek",
      edition: "Nestle1904",
      version: "test",
      language: "grc",
      license: {
        spdx: "CC-BY-4.0",
        name: "CC BY 4.0",
        attributionText: "test",
      },
    },
  });

  // Re-tag datasetId for package id
  const senseLabels: Record<string, string> = {
    "76.26": "to destroy, to cause to cease",
    "13.100": "to cease to exist",
    "13.162": "to pass away",
  };
  const lines = tokens.map((t) => JSON.stringify({
    ...t,
    datasetId: packageId,
    ...(t.louwNida && senseLabels[t.louwNida]
      ? { semanticSenses: [{ id: t.louwNida, label: senseLabels[t.louwNida] }] }
      : {}),
  }));
  writeFileSync(join(dir, "tokens.jsonl"), lines.join("\n") + "\n");
  writeFileSync(
    join(dir, "manifest.json"),
    JSON.stringify(
      {
        id: packageId,
        name: "Test MACULA Greek",
        language: "grc",
        type: "interlinear-data",
        formatVersion: 1,
        edition: "Nestle1904",
        family: "macula-greek",
        datasetVersion: "test",
        tokenCount: tokens.length,
        books: ["1CO"],
      },
      null,
      2,
    ),
  );
  return dir;
}

test("parseTokensJsonl round-trips TokenRecords", () => {
  const tsv = readFileSync(FIXTURE, "utf8");
  const { tokens } = parseMaculaGreekTsv(tsv);
  const jsonl = tokens.map((t) => JSON.stringify(t)).join("\n");
  const parsed = parseTokensJsonl(jsonl);
  assert.equal(parsed.stats.skipped, 0);
  assert.equal(parsed.tokens.length, tokens.length);
  assert.equal(parsed.tokens.find((t) => t.id === "n46013008008")?.lemma, "καταργέω");
});

test("TokenPackageLoader lists, loads, and queries a package", () => {
  const root = mkdtempSync(join(tmpdir(), "tokpkg-"));
  try {
    writeSamplePackage(root, "macula-greek-nestle1904");
    // English-style package should be ignored (no interlinear-data type)
    mkdirSync(join(root, "web"), { recursive: true });
    writeFileSync(
      join(root, "web", "manifest.json"),
      JSON.stringify({
        id: "web",
        name: "WEB",
        language: "en",
        type: "translation",
        formatVersion: 1,
      }),
    );

    const loader = new TokenPackageLoader([root]);
    const listed = loader.listPackages();
    assert.equal(listed.length, 1);
    assert.equal(listed[0]?.id, "macula-greek-nestle1904");
    assert.equal(listed[0]?.loaded, false);

    assert.equal(loader.load("macula-greek-nestle1904"), true);
    assert.equal(loader.isLoaded("macula-greek-nestle1904"), true);

    const verse = loader.getVerseTokens("macula-greek-nestle1904", "1CO", 13, 8);
    assert.ok(verse);
    assert.ok(verse!.length >= 8);
    assert.equal(verse![0]?.order, 1);
    assert.ok(verse!.some((t) => t.displayGloss || t.gloss));

    const card = loader.getTokenCard("macula-greek-nestle1904", "n46013008008");
    assert.ok(card);
    assert.equal(card!.token.surface, "καταργηθήσονται");
    assert.ok(card!.displaySurface);
    assert.ok(card!.morphLabels.includes("future"));
    assert.ok(card!.morphLabels.includes("passive"));
    assert.ok(card!.morphExplain?.parts.some((p) => p.label === "future"));
    assert.ok(card!.gloss === "they will be done away" || card!.token.gloss === "they will be done away");
    assert.equal(card!.lemmaFreq.book, 4);
    assert.ok(card!.occurrencesInBook.length === 4);
    assert.ok(card!.marks.some((m) => m.kind === "repeat"));
    assert.equal(card!.semanticSenses?.total, 3);
    assert.equal(
      card!.semanticSenses?.senses.find((sense) => sense.current)?.ids[0],
      "13.100",
    );

    const lemmaHits = loader.getLemmaInBook("macula-greek-nestle1904", "1CO", "καταργέω");
    assert.equal(lemmaHits?.length, 4);

    assert.equal(loader.load("missing-package"), false);
    assert.equal(loader.getVerseTokens("missing-package", "1CO", 1, 1), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TokenPackageLoader attaches Strong's gloss + morph explain for Hebrew", () => {
  const root = mkdtempSync(join(tmpdir(), "tokpkg-heb-"));
  try {
    const dir = join(root, "oshb-wlc");
    mkdirSync(dir, { recursive: true });
    const xml = readFileSync(OSHB_FIXTURE, "utf8");
    const { tokens } = parseOshbOsisBook(xml, {
      dataset: {
        id: "oshb-wlc",
        name: "OSHB test",
        family: "oshb",
        edition: "WLC",
        version: "test",
        language: "hbo",
        license: { name: "test", attributionText: "test" },
      },
    });
    writeFileSync(join(dir, "tokens.jsonl"), tokens.map((t) => JSON.stringify(t)).join("\n") + "\n");
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        id: "oshb-wlc",
        name: "OSHB test",
        language: "hbo",
        type: "interlinear-data",
        formatVersion: 1,
        tokenCount: tokens.length,
      }),
    );

    const glossJson = readFileSync(HEBREW_GLOSS, "utf8");
    const loader = new TokenPackageLoader([root], { hebrewGlossJson: glossJson });
    assert.equal(loader.load("oshb-wlc"), true);
    const verse = loader.getVerseTokens("oshb-wlc", "GEN", 1, 1);
    assert.ok(verse && verse.length === 7);
    const baraChip = verse!.find((t) => t.id === "01Nvk");
    assert.ok(baraChip?.displayGloss && /create/i.test(baraChip.displayGloss));
    // strip labels stay short (not dictionary essays)
    assert.ok((baraChip!.displayGloss?.split(/\s+/).length ?? 99) <= 3);
    assert.equal(baraChip?.displaySurface, "בָּרָ֣א");
    const first = verse!.find((t) => t.id === "01xeN");
    assert.ok(first?.displaySurface && !first.displaySurface.includes("/"));
    assert.ok(first?.displayGloss && /begin/i.test(first.displayGloss));

    const card = loader.getTokenCard("oshb-wlc", "01Nvk");
    assert.ok(card);
    assert.equal(card!.token.surface, "בָּרָ֣א");
    assert.equal(card!.glossSource, "strongs-hebrew");
    assert.ok(card!.gloss && /create/i.test(card!.gloss));
    assert.ok(card!.morphExplain?.parts.some((p) => p.label === "qal"));
    assert.ok(card!.morphExplain?.parts.some((p) => p.meaning.length > 20));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("TokenPackageLoader first root wins on id collision", () => {
  const rootA = mkdtempSync(join(tmpdir(), "tokpkg-a-"));
  const rootB = mkdtempSync(join(tmpdir(), "tokpkg-b-"));
  try {
    writeSamplePackage(rootA, "macula-greek-nestle1904");
    writeSamplePackage(rootB, "macula-greek-nestle1904");
    // tweak name in B so we can see which loaded
    writeFileSync(
      join(rootB, "macula-greek-nestle1904", "manifest.json"),
      JSON.stringify({
        id: "macula-greek-nestle1904",
        name: "FROM-B",
        language: "grc",
        type: "interlinear-data",
        formatVersion: 1,
      }),
    );

    const loader = new TokenPackageLoader([rootA, rootB]);
    const listed = loader.listPackages();
    assert.equal(listed[0]?.name, "Test MACULA Greek"); // from A
  } finally {
    rmSync(rootA, { recursive: true, force: true });
    rmSync(rootB, { recursive: true, force: true });
  }
});
