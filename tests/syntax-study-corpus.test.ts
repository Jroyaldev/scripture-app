import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildPhraseDiagramProjection,
  buildSyntaxStudyModel,
  phraseDiagramPolicy,
  type PhraseDiagramNode,
  type SyntaxNode,
  type SyntaxPackageIndex,
  type SyntaxStudyPhraseNode,
} from "../src/core/language/index.js";

type PackageName = "macula-greek-nestle1904" | "macula-hebrew-wlc";

function loadBook(packageName: PackageName, book: string): SyntaxPackageIndex {
  return JSON.parse(
    readFileSync(`data/scripture/syntax/${packageName}/${book}.json`, "utf8"),
  ) as SyntaxPackageIndex;
}

function normalizedSurface(value?: string): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLocaleLowerCase();
}

function fixture(
  packageName: PackageName,
  book: string,
  refLabel: string,
  surface: string,
) {
  const sentence = loadBook(packageName, book).sentences.find(
    (candidate) => candidate.refLabel === refLabel,
  );
  assert.ok(sentence, `missing syntax fixture ${refLabel}`);
  let focusTokenId = "";
  (function walk(node: SyntaxNode): void {
    if (node.tokenId && normalizedSurface(node.surface) === normalizedSurface(surface)) {
      focusTokenId ||= node.tokenId;
    }
    for (const child of node.children ?? []) walk(child);
  })(sentence.root);
  assert.ok(focusTokenId, `missing focus ${surface} in ${refLabel}`);
  return buildSyntaxStudyModel(sentence.root, focusTokenId);
}

function phraseNodes(root: SyntaxStudyPhraseNode): SyntaxStudyPhraseNode[] {
  return [root, ...root.children.flatMap(phraseNodes)];
}

function allPhrases(model: ReturnType<typeof buildSyntaxStudyModel>): SyntaxStudyPhraseNode[] {
  return model.clauses.flatMap((clause) =>
    clause.groups.flatMap((group) => (group.phrase ? phraseNodes(group.phrase) : [])),
  );
}

function projectedNodes(root: PhraseDiagramNode): PhraseDiagramNode[] {
  return [root, ...root.children.flatMap(projectedNodes)];
}

test("shipped Genesis copular clause and Hebrew construct stay grammatically honest", () => {
  const model = fixture("macula-hebrew-wlc", "GEN", "GEN 1:2", "תֹהוּ");
  assert.equal(
    model.clauses.flatMap((clause) => clause.groups).find((group) => group.isFocus)?.label,
    "Predicate",
  );

  const spirit = fixture("macula-hebrew-wlc", "GEN", "GEN 1:2", "רוּחַ");
  const construct = allPhrases(spirit).find((node) => node.relation === "Head + dependent");
  assert.ok(construct);
  assert.deepEqual(construct.children.map((child) => child.label), ["Noun", "Noun"]);
});

test("shipped explicit O2 and OC functions do not fall back to generic Phrase", () => {
  const greekSecond = fixture("macula-greek-nestle1904", "1CO", "1CO 3:2", "γάλα");
  assert.ok(greekSecond.clauses.some((clause) =>
    clause.groups.some((group) => group.isFocus && group.label === "Second object"),
  ));

  const greekComplement = fixture("macula-greek-nestle1904", "1JN", "1JN 1:10", "ψεύστην");
  assert.ok(greekComplement.clauses.some((clause) =>
    clause.groups.some((group) => group.isFocus && group.label === "Object complement"),
  ));

  const hebrewSecond = fixture("macula-hebrew-wlc", "1CH", "1CH 4:9", "יַעְבֵּץ");
  assert.ok(hebrewSecond.clauses.some((clause) =>
    clause.groups.some((group) => group.label === "Second object"),
  ));
});

test("shipped passive designation clause exposes its predicate complement", () => {
  const sentence = loadBook("macula-greek-nestle1904", "ROM").sentences.find(
    (candidate) => candidate.refLabel === "ROM 1:1–7",
  );
  assert.ok(sentence);
  const model = buildSyntaxStudyModel(sentence.root, "n45001004003");
  const focusGroup = model.clauses
    .flatMap((clause) => clause.groups)
    .find((group) => group.isFocus);
  assert.equal(focusGroup?.label, "Predicate complement");
  assert.equal(focusGroup?.surface, "Υἱοῦ Θεοῦ");
});

test("long shipped genealogies collapse depth without dropping or duplicating leaves", () => {
  const model = fixture("macula-greek-nestle1904", "LUK", "LUK 3:23–38", "Ἠλεὶ");
  const chain = allPhrases(model).find(
    (node) => node.relation === "Linked noun chain",
  );
  assert.ok(chain);
  assert.ok(chain.children.length > 100);

  const words = phraseNodes(chain)
    .filter((node) => node.kind === "word")
    .map((node) => node.id);
  assert.equal(words.length, new Set(words).size);
  assert.equal(words.length, chain.wordCount);

  let maxDepth = 0;
  (function depth(node: SyntaxStudyPhraseNode, level: number): void {
    maxDepth = Math.max(maxDepth, level);
    for (const child of node.children) depth(child, level + 1);
  })(chain, 1);
  assert.ok(maxDepth <= 3, `genealogy chain depth regressed to ${maxDepth}`);
});

test("wide shipped Greek and Hebrew inventories retain coordination labels", () => {
  const greek = fixture("macula-greek-nestle1904", "LUK", "LUK 6:13–16", "Ἰούδαν");
  assert.ok(allPhrases(greek).some(
    (node) => node.relation === "Coordinated noun phrases" && node.children.length >= 20,
  ));

  const hebrew = fixture("macula-hebrew-wlc", "JOS", "JOS 7:24", "עָכָן");
  assert.ok(allPhrases(hebrew).some(
    (node) => node.relation === "Coordinated noun phrases" && node.children.length >= 20,
  ));
});

test("shipped late-item diagrams stay bounded and keep their selected word", () => {
  const greekSentence = loadBook("macula-greek-nestle1904", "LUK").sentences.find(
    (candidate) => candidate.refLabel === "LUK 6:13–16",
  );
  assert.ok(greekSentence);
  const greek = buildSyntaxStudyModel(greekSentence.root, "n42006016005");
  const greekPhrase = greek.clauses
    .flatMap((clause) => clause.groups)
    .find((group) => group.isFocus)?.phrase;
  assert.ok(greekPhrase);
  assert.equal(phraseDiagramPolicy(greekPhrase).defaultView, "outline");
  const greekProjection = buildPhraseDiagramProjection(greekPhrase);
  assert.ok(projectedNodes(greekProjection.root).some((node) => node.id === "n42006016005"));
  assert.ok(projectedNodes(greekProjection.root).every((node) => node.children.length <= 3));
  assert.ok(greekProjection.hiddenNodeCount > 20);

  const genealogySentence = loadBook("macula-greek-nestle1904", "LUK").sentences.find(
    (candidate) => candidate.refLabel === "LUK 3:23–38",
  );
  assert.ok(genealogySentence);
  const genealogy = buildSyntaxStudyModel(genealogySentence.root, "n42003036008");
  const genealogyPhrase = genealogy.clauses
    .flatMap((clause) => clause.groups)
    .find((group) => group.isFocus)?.phrase;
  assert.ok(genealogyPhrase);
  const lineage = buildPhraseDiagramProjection(genealogyPhrase);
  assert.equal(lineage.strategy, "lineage");
  assert.ok(projectedNodes(lineage.root).some((node) => node.id === "n42003036008"));
});

test("non-nominal shipped NPofNP shapes do not manufacture an of gloss", () => {
  const model = fixture("macula-hebrew-wlc", "1CH", "1CH 4:33", "הִתְיַחְשׂ");
  const focusGroup = model.clauses
    .flatMap((clause) => clause.groups)
    .find((group) => group.isFocus);
  assert.ok(focusGroup);
  assert.doesNotMatch(focusGroup.gloss, /\bof\b/i);
});
