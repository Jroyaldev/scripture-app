import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import {
  TipnrIndex,
  tokenLooksLikeProperName,
  formatTipnrDisplayName,
  type TipnrIndexFile,
} from "../src/core/language/tipnr.js";
import { KJV_EPISTLE_SUBSCRIPTION_REFS } from "../src/core/language/tipnr-subscriptions.js";
import { expandTipnrRefsField } from "../scripts/import-tipnr.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const indexPath = resolve(__dirname, "../data/scripture/names/tipnr-index.json");
const doctorPath = resolve(__dirname, "../data/scripture/names/tipnr-doctor-report.json");

test("TIPNR compact references retain book, chapter, comma, range, and LXX context", () => {
  assert.deepEqual(
    expandTipnrRefsField("2Co.1.1,23; 13.13,14").map(({ ref, translation }) => [ref, translation]),
    [
      ["2CO.1.1", null],
      ["2CO.1.23", null],
      ["2CO.13.13", null],
      ["2CO.13.14", null],
    ],
  );
  assert.deepEqual(expandTipnrRefsField("[Act.26.7]").map(({ ref }) => ref), ["ACT.26.7"]);
  assert.deepEqual(expandTipnrRefsField("LXX.Est.3.1; 7.9").map(({ ref, translation }) => [ref, translation]), [
    ["EST.3.1", "LXX"],
    ["EST.7.9", "LXX"],
  ]);
});

test("TIPNR Doctor proves exhaustive structured-row and provenance integrity", () => {
  const raw = readFileSync(indexPath, "utf8");
  const index = JSON.parse(raw) as TipnrIndexFile;
  const doctor = JSON.parse(readFileSync(doctorPath, "utf8")) as {
    status: string;
    coverage: {
      structuredRowsWithReferences: number;
      structuredRowsParsed: number;
      translationRowsPreserved: number;
      paratextReferenceEdges: number;
      subscriptionCoordinateCount: number;
      personProfileCount: number;
      sourcePersonRelationshipCount: number;
      resolvedPersonRelationshipCount: number;
      uncertainPersonRelationshipCount: number;
    };
    checks: Record<string, boolean>;
    artifact: { normalizedSha256: string };
    subscriptions: { coordinates: string[]; detectedInAkjv: string[] };
  };
  assert.equal(index.version, 4);
  assert.equal(doctor.status, "healthy");
  assert.deepEqual(Object.entries(doctor.checks).filter(([, passed]) => !passed), []);
  assert.equal(doctor.coverage.structuredRowsParsed, doctor.coverage.structuredRowsWithReferences);
  assert.ok(doctor.coverage.structuredRowsParsed >= 5_800);
  assert.ok(doctor.coverage.translationRowsPreserved >= 1_400);
  assert.equal(doctor.coverage.paratextReferenceEdges, 50);
  assert.equal(doctor.coverage.subscriptionCoordinateCount, 14);
  assert.equal(doctor.coverage.personProfileCount, 3_132);
  assert.equal(doctor.coverage.sourcePersonRelationshipCount, 9_461);
  assert.equal(doctor.coverage.resolvedPersonRelationshipCount, 9_461);
  assert.equal(doctor.coverage.uncertainPersonRelationshipCount, 251);
  assert.deepEqual(doctor.subscriptions.coordinates, KJV_EPISTLE_SUBSCRIPTION_REFS);
  assert.deepEqual(doctor.subscriptions.detectedInAkjv, KJV_EPISTLE_SUBSCRIPTION_REFS);
  assert.equal(createHash("sha256").update(raw).digest("hex"), doctor.artifact.normalizedSha256);
});

test("TIPNR preserves person identity, affiliation, and fully resolved family structure", () => {
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as TipnrIndexFile;
  const aaron = index.entities["Aaron@Exo.4.14-Heb=H0175"];
  assert.ok(aaron?.person);
  assert.equal(aaron.person.description, "High Priest living at the time of Egypt and Wilderness");
  assert.equal(aaron.person.role, "High Priest");
  assert.equal(aaron.person.era, "Egypt and Wilderness");
  assert.equal(aaron.person.affiliation, "Tribe of Levi");
  assert.deepEqual(
    aaron.person.relationships.map((relationship) => [relationship.kind, relationship.displayName]),
    [
      ["parent", "Amram"],
      ["parent", "Jochebed"],
      ["sibling", "Moses"],
      ["sibling", "Miriam"],
      ["partner", "Elisheba"],
      ["offspring", "Nadab"],
      ["offspring", "Abihu"],
      ["offspring", "Ithamar"],
      ["offspring", "Eleazar"],
    ],
  );
  for (const relationship of aaron.person.relationships) {
    assert.ok(index.entities[relationship.targetId], relationship.targetId);
  }

  const paul = index.entities["Paul@Act.7.58-2Pe=G3972G"];
  assert.equal(paul?.person?.role, "Apostle");
  assert.equal(paul?.person?.era, "the New Testament");
  assert.deepEqual(paul?.person?.relationships, []);
});

test("TIPNR PERSON+PLACE source records use their declared Place schema", () => {
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as TipnrIndexFile;
  const schemaPlaces = [
    "Beth-gader@1Ch.2.51=H1013",
    "Eshtemoa@Jos.15.50-1Ch=H0851",
    "Ir-nahash@1Ch.4.12=H5904",
  ];
  for (const id of schemaPlaces) {
    assert.equal(index.entities[id]?.kind, "place", id);
    assert.equal(index.entities[id]?.person, undefined, id);
  }
  assert.equal(index.personCount, 3_132);
  assert.equal(index.placeCount, 1_013);
});

test("KJV subscriptions remain attributed paratext and never ordinary Scripture edges", () => {
  const index = JSON.parse(readFileSync(indexPath, "utf8")) as TipnrIndexFile;
  assert.deepEqual(Object.keys(index.byParatextRef ?? {}), KJV_EPISTLE_SUBSCRIPTION_REFS);
  for (const ref of KJV_EPISTLE_SUBSCRIPTION_REFS) {
    assert.ok((index.byParatextRef?.[ref]?.length ?? 0) > 0, ref);
    for (const id of index.byParatextRef?.[ref] ?? []) {
      assert.ok(!index.byRef[ref]?.includes(id), `${id} leaked from ${ref} paratext into byRef`);
      const entry = index.entities[id]?.paratextRefs?.find((candidate) => candidate.ref === ref);
      assert.equal(entry?.source, "KJV epistle subscription");
      assert.deepEqual(entry?.translations, ["KJV"]);
    }
  }

  const corinth = index.entities["Corinth@Act.18.1-2Ti=G2882"];
  assert.ok(corinth);
  assert.deepEqual(corinth.refs, [
    "ACT.18.1", "ACT.19.1", "1CO.1.2", "2CO.1.1", "2CO.1.23",
    "2TI.4.20", "ACT.18.8", "2CO.6.11", "2CO.13.13",
  ]);
  assert.deepEqual(corinth.paratextRefs?.map((entry) => entry.ref), [
    "ROM.16.27", "1CO.16.24", "2CO.13.14",
  ]);
  assert.ok(corinth.translationVariants?.some((variant) => (
    variant.form === "Corinthus" && variant.translations.includes("KJV")
  )));
});

test("TIPNR index resolves John Baptist at MAT 3:1 not the Apostle", () => {
  assert.ok(existsSync(indexPath), "run npx tsx scripts/import-tipnr.ts first");
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  assert.ok(idx.entityCount > 1000);

  const hit = idx.resolve({
    book: "MAT",
    chapter: 3,
    verse: 1,
    strong: "G2491",
    nameHint: "John",
  });
  assert.ok(hit);
  assert.match(hit!.entity.brief + hit!.entity.displayName, /Baptist|prophet|John/i);
  assert.ok(
    /Baptist|prepared the way|prophet/i.test(hit!.entity.brief + (hit!.entity.short ?? "")),
    `expected Baptist-ish brief, got: ${hit!.entity.brief}`,
  );

  const apostle = idx.resolve({
    book: "MAT",
    chapter: 4,
    verse: 21,
    strong: "G2491",
    nameHint: "John",
  });
  assert.ok(apostle);
  assert.notEqual(hit!.entity.id, apostle!.entity.id);
  assert.match(
    apostle!.entity.brief + (apostle!.entity.short ?? ""),
    /apostle|Zebedee|disciple/i,
  );
});

test("tokenLooksLikeProperName detects HNp and Greek proper", () => {
  assert.equal(tokenLooksLikeProperName({ morphCode: "HNp" }), true);
  assert.equal(tokenLooksLikeProperName({ wordType: "proper", morphCode: "N-NSM" }), true);
  assert.equal(tokenLooksLikeProperName({ morphCode: "V-AAI-3S", wordType: "common" }), false);
});

test("formatTipnrDisplayName softens machine ids", () => {
  assert.equal(formatTipnrDisplayName("Olives_Mount"), "Mount of Olives");
  assert.equal(formatTipnrDisplayName("Mary_Magdalene"), "Mary Magdalene");
  assert.equal(formatTipnrDisplayName("Moab_Plains"), "Plains of Moab");
  assert.equal(formatTipnrDisplayName("Halak_Mount"), "Mount Halak");
  assert.equal(formatTipnrDisplayName("Jesus"), "Jesus");
});

test("TIPNR covers people and places across OT and NT", () => {
  assert.ok(existsSync(indexPath), "run npx tsx scripts/import-tipnr.ts first");
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  assert.ok(idx.entityCount >= 4000, `expected full TIPNR set, got ${idx.entityCount}`);

  const jesus = idx.resolve({
    book: "ACT",
    chapter: 19,
    verse: 10,
    strong: "G2424",
    nameHint: "Jesus",
  });
  assert.ok(jesus);
  assert.equal(jesus!.entity.displayName, "Jesus");
  assert.match(jesus!.match, /strong|ref/);

  const moses = idx.resolve({
    book: "EXO",
    chapter: 2,
    verse: 10,
    strong: "H4872",
    nameHint: "Moses",
  });
  assert.ok(moses);
  assert.equal(moses!.entity.displayName, "Moses");
  assert.equal(moses!.entity.kind, "person");

  const jerusalem = idx.resolve({
    book: "REV",
    chapter: 21,
    verse: 2,
    strong: "G2419",
    nameHint: "Jerusalem",
  });
  assert.ok(jerusalem);
  assert.equal(jerusalem!.entity.displayName, "Jerusalem");
  assert.equal(jerusalem!.entity.kind, "place");

  const goliath = idx.resolve({
    book: "1SA",
    chapter: 17,
    verse: 4,
    strong: "H1555",
    nameHint: "Goliath",
  });
  assert.ok(goliath);
  assert.equal(goliath!.entity.displayName, "Goliath");
});

test("TIPNR returns unique people and places in first-appearance order for a range", () => {
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));

  const entities = idx.entitiesForRange("ACT", 19, 1, 7);
  assert.ok(entities.length > 0);
  assert.equal(new Set(entities.map((entity) => entity.id)).size, entities.length);
  assert.ok(entities.some((entity) => entity.displayName === "Paul"));
  assert.ok(entities.every((entity) => entity.kind === "person" || entity.kind === "place"));
});

test("TIPNR search gives name closeness priority over definition text", () => {
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  const results = idx.search("Paul", 12);
  assert.ok(results.length > 0);
  assert.equal(results[0]?.entity.displayName, "Paul");
  assert.equal(results[0]?.match, "name");
  const firstDescription = results.findIndex((result) => result.match === "description");
  const lastName = results.map((result) => result.match).lastIndexOf("name");
  assert.ok(firstDescription === -1 || firstDescription > lastName);
});

test("TIPNR search supports typos and generic roles", () => {
  const idx = new TipnrIndex();
  idx.loadJson(readFileSync(indexPath, "utf8"));
  assert.equal(idx.search("Pual", 5)[0]?.entity.displayName, "Paul");
  const apostles = idx.search("apostle", 20);
  assert.ok(apostles.length >= 3);
  assert.ok(apostles.every((result) => result.entity.kind === "person" || result.entity.kind === "place"));
  assert.ok(apostles.some((result) => /apostle/i.test(`${result.entity.brief} ${result.entity.short ?? ""}`)));
});
