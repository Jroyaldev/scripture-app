import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import type { ConnectionRecordV2 } from "../src/core/annotations/types.js";
import {
  RETIRED_CONNECTION_ANCHOR_FIELDS,
  migrateRetiredV2AnchorFields,
  validateConnectionRecord,
  validateLegacyConnectionRecord,
  validateNewConnectionRecord,
} from "../src/core/annotations/index.js";
import {
  BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
} from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneTokenCatalog } from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneData } from "../src/core/reference/types.js";

const backbone: BackboneData = {
  version: "v1",
  psalmSuperscriptionPolicy: "fixture",
  verseSplitMergePolicy: "fixture",
  books: {
    PSA: { chapters: [6] },
  },
};

const tokenCounts = new Map<string, number>([
  ["PSA.1.1", 12],
  ["PSA.1.2", 10],
  ["PSA.1.3", 8],
  ["PSA.1.4", 9],
  ["PSA.1.5", 11],
  ["PSA.1.6", 10],
]);

const catalog: BackboneTokenCatalog = {
  layer: BACKBONE_TOKEN_LAYER,
  format_version: BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  tokenCount(book, chapter, verse) {
    return tokenCounts.get(`${book}.${chapter}.${verse}`);
  },
};

/**
 * Shaped exactly like the retired sidecar found in real libraries: a
 * format_version 1 object naming the content-word subset of the selection plus
 * the function-word lead/trail counts.
 */
function selectionShape(contentOccurrences: { verse: number; position: number }[]): unknown {
  return {
    format_version: 1,
    content_occurrences: contentOccurrences,
    own_occurrences: [],
    own_subclasses: [],
    lead_function_words: 0,
    trail_function_words: 0,
  };
}

function exactSelector(occurrences: { verse: number; position: number }[]): unknown {
  return {
    format_version: 1,
    layer: BACKBONE_TOKEN_LAYER,
    occurrences,
  };
}

function v2Record(anchors: unknown[]): unknown {
  return {
    id: "conn_retired_selection_shape",
    format_version: 2,
    kind: "series",
    label: "A relationship authored before selection_shape was retired",
    observation: "The repetition is the point.",
    anchors,
  };
}

/**
 * The disagreeing fidelity case measured in the reference library: `exact`
 * carries two occurrences where `content_occurrences` names only one, because
 * position 4 was a function word. The migration must keep `exact` — the wider,
 * identity-bearing set — byte-for-byte.
 */
const DISAGREEING_EXACT = [
  { verse: 3, position: 3 },
  { verse: 3, position: 5 },
];
const DISAGREEING_CONTENT = [{ verse: 3, position: 3 }];

test("a committed v2 anchor carrying selection_shape parses, and exact is untouched", () => {
  // WOULD CATCH: the cold-start boot failure regressing — a library whose
  // history contains selection_shape refusing to parse at all. It would also
  // catch a migration that "fixed" the boot by rewriting, reordering, or
  // narrowing exact.occurrences (e.g. intersecting them with
  // content_occurrences), which would silently change durable anchor identity.
  const inputExactA = [
    { verse: 2, position: 6 },
    { verse: 2, position: 7 },
  ];
  const inputExactB = DISAGREEING_EXACT;

  const record = v2Record([
    {
      book: "PSA",
      chapter: 1,
      verse_start: 2,
      verse_end: 2,
      exact: exactSelector(inputExactA),
      // Agreeing case: content_occurrences equals exact.occurrences (50 of 64).
      selection_shape: selectionShape(inputExactA),
    },
    {
      book: "PSA",
      chapter: 1,
      verse_start: 3,
      verse_end: 3,
      exact: exactSelector(inputExactB),
      // Disagreeing case: exact is strictly wider (14 of 64).
      selection_shape: selectionShape(DISAGREEING_CONTENT),
    },
  ]);

  const result = validateConnectionRecord(record, backbone, catalog);
  assert.equal(result.ok, true, "a v2 anchor carrying selection_shape must parse on the read path");
  if (!result.ok) return;

  assert.equal(result.value.format_version, 2);
  assert.equal(result.value.anchors.length, 2, "guard: both anchors must be present, not silently dropped");

  // Identity is IDENTICAL to the input's exact.occurrences, for both the
  // agreeing and the disagreeing anchor.
  assert.deepEqual(result.value.anchors[0]?.exact.occurrences, inputExactA);
  assert.deepEqual(result.value.anchors[1]?.exact.occurrences, inputExactB);

  // The retired field is gone from the parsed value, and no trace of it was
  // promoted onto the anchor under another name.
  for (const anchor of result.value.anchors) {
    assert.equal("selection_shape" in anchor, false);
    assert.deepEqual(
      Object.keys(anchor).sort(),
      ["book", "chapter", "exact", "verse_end", "verse_start"],
    );
  }
});

test("the migration never invents an exact selector it was not given", () => {
  // WOULD CATCH: a migration that tried to be helpful by synthesizing an exact
  // selector out of selection_shape.content_occurrences. That would mint
  // durable anchor identity out of retired presentation evidence — and for the
  // 14 disagreeing anchors it would mint the WRONG identity (too few tokens).
  // An anchor with no canonical selector must stay invalid.
  const noExact = v2Record([
    {
      book: "PSA",
      chapter: 1,
      verse_start: 3,
      verse_end: 3,
      selection_shape: selectionShape(DISAGREEING_CONTENT),
    },
    {
      book: "PSA",
      chapter: 1,
      verse_start: 4,
      verse_end: 4,
      exact: exactSelector([{ verse: 4, position: 2 }]),
    },
  ]);

  const result = validateConnectionRecord(noExact, backbone, catalog);
  assert.equal(result.ok, false, "an anchor with selection_shape but no exact must not parse");
  if (result.ok) return;
  assert.equal(result.error.code, "invalid-exact-anchor");

  // And at the migration boundary itself: stripping the retired field leaves an
  // object with no exact, rather than manufacturing one.
  const migrated = migrateRetiredV2AnchorFields({
    book: "PSA",
    chapter: 1,
    verse_start: 3,
    verse_end: 3,
    selection_shape: selectionShape(DISAGREEING_CONTENT),
  });
  assert.equal("exact" in (migrated as Record<string, unknown>), false);
  assert.deepEqual(
    Object.keys(migrated as Record<string, unknown>).sort(),
    ["book", "chapter", "verse_end", "verse_start"],
  );
});

test("a NEWLY authored record carrying selection_shape is still rejected", () => {
  // WOULD CATCH: the migration leaking into the authoring path, which is what
  // would turn a one-time migration for existing history into a permanent
  // tolerance and let the retired field back into the append-only log forever.
  // planConnectionCreate and planConnectionUpdate both reach
  // validateNewConnectionRecord via LibraryHost.requireNewConnectionContent, so
  // this is the real authoring gate, not a proxy for it.
  const authored = v2Record([
    {
      book: "PSA",
      chapter: 1,
      verse_start: 2,
      verse_end: 2,
      exact: exactSelector([{ verse: 2, position: 6 }]),
      selection_shape: selectionShape([{ verse: 2, position: 6 }]),
    },
    {
      book: "PSA",
      chapter: 1,
      verse_start: 4,
      verse_end: 4,
      exact: exactSelector([{ verse: 4, position: 2 }]),
    },
  ]);

  const authoredResult = validateNewConnectionRecord(authored, backbone, catalog);
  assert.equal(authoredResult.ok, false, "new authoring must refuse a retired field");
  if (authoredResult.ok) return;
  assert.equal(authoredResult.error.code, "invalid-exact-anchor");
  assert.equal(authoredResult.error.anchorCode, "invalid-anchor");

  // The very same bytes are readable as existing history. The two paths differ
  // by intent, not by accident.
  const readResult = validateConnectionRecord(authored, backbone, catalog);
  assert.equal(readResult.ok, true, "the read path must still accept what authoring refuses");
});

test("render_locator on a format_version 1 record still parses via the v1 path", () => {
  // WOULD CATCH: collateral damage to the untouched legacy path. render_locator
  // is NOT a defect — it is a legitimate v1 anchor field handled by
  // parseLegacyAnchor — and the selection_shape migration must not have been
  // written in a way that strips it, refuses it, or reroutes v1 records through
  // the canonical v2 validator.
  const legacy = {
    id: "conn_legacy_render_locator",
    format_version: 1,
    kind: "series",
    label: "A passage-level relationship with translation render evidence",
    anchors: [
      {
        book: "PSA",
        chapter: 1,
        verse_start: 1,
        verse_end: 1,
        render_locator: {
          package: "pkg.bsb",
          char_start: 10,
          char_end: 24,
          quote: "walketh not",
        },
      },
      {
        book: "PSA",
        chapter: 1,
        verse_start: 2,
        verse_end: 2,
      },
    ],
  };

  for (const result of [
    validateConnectionRecord(legacy, backbone, catalog),
    validateLegacyConnectionRecord(legacy, backbone),
  ]) {
    assert.equal(result.ok, true, "a v1 record carrying render_locator must still parse");
    if (!result.ok) continue;
    assert.equal(result.value.format_version, 1);
    assert.equal(result.value.anchors.length, 2);
    assert.deepEqual(result.value.anchors[0]?.render_locator, {
      package: "pkg.bsb",
      char_start: 10,
      char_end: 24,
      quote: "walketh not",
    });
    assert.equal(result.value.anchors[1]?.render_locator, undefined);
  }
});

test("an anchor carrying any OTHER unknown key is still rejected on every path", () => {
  // WOULD CATCH: the migration degenerating into a blanket "ignore unknown
  // fields" step. Only the names enumerated in
  // RETIRED_CONNECTION_ANCHOR_FIELDS may be stripped; anything else must still
  // reach the closed validator and be refused, including when it rides
  // alongside a field that IS migrated.
  assert.deepEqual([...RETIRED_CONNECTION_ANCHOR_FIELDS], ["selection_shape"]);

  const unknownKeyOnly = v2Record([
    {
      book: "PSA",
      chapter: 1,
      verse_start: 2,
      verse_end: 2,
      exact: exactSelector([{ verse: 2, position: 6 }]),
      render_locator: {
        package: "pkg.bsb",
        char_start: 0,
        char_end: 4,
        quote: "his",
      },
    },
    {
      book: "PSA",
      chapter: 1,
      verse_start: 4,
      verse_end: 4,
      exact: exactSelector([{ verse: 4, position: 2 }]),
    },
  ]);
  const unknownResult = validateConnectionRecord(unknownKeyOnly, backbone, catalog);
  assert.equal(unknownResult.ok, false, "an unmigrated unknown v2 anchor key must still be refused");
  if (unknownResult.ok) return;
  assert.equal(unknownResult.error.anchorCode, "invalid-anchor");

  const unknownBesideRetired = v2Record([
    {
      book: "PSA",
      chapter: 1,
      verse_start: 2,
      verse_end: 2,
      exact: exactSelector([{ verse: 2, position: 6 }]),
      selection_shape: selectionShape([{ verse: 2, position: 6 }]),
      future_field: { anything: true },
    },
    {
      book: "PSA",
      chapter: 1,
      verse_start: 4,
      verse_end: 4,
      exact: exactSelector([{ verse: 4, position: 2 }]),
    },
  ]);
  const mixedResult = validateConnectionRecord(unknownBesideRetired, backbone, catalog);
  assert.equal(
    mixedResult.ok,
    false,
    "stripping selection_shape must not smuggle a second unknown key past the validator",
  );
  if (mixedResult.ok) return;
  assert.equal(mixedResult.error.anchorCode, "invalid-anchor");

  // At the migration boundary: the unknown key survives the strip verbatim.
  const migrated = migrateRetiredV2AnchorFields({
    book: "PSA",
    chapter: 1,
    verse_start: 2,
    verse_end: 2,
    exact: exactSelector([{ verse: 2, position: 6 }]),
    selection_shape: selectionShape([{ verse: 2, position: 6 }]),
    future_field: { anything: true },
  }) as Record<string, unknown>;
  assert.equal("selection_shape" in migrated, false);
  assert.deepEqual(migrated["future_field"], { anything: true });
});

test("the migration is a read-time normalization and never mutates its input", () => {
  // WOULD CATCH: an in-place `delete anchor.selection_shape`. The host holds the
  // parsed event payload in its connection event cache and re-serializes
  // records elsewhere; mutating the caller's object would let a read-time
  // normalization propagate into memory that other code treats as the log's
  // content, which is exactly what "the bytes stay on disk" forbids.
  const original = {
    book: "PSA",
    chapter: 1,
    verse_start: 3,
    verse_end: 3,
    exact: exactSelector(DISAGREEING_EXACT),
    selection_shape: selectionShape(DISAGREEING_CONTENT),
  };
  const before = JSON.stringify(original);

  const migrated = migrateRetiredV2AnchorFields(original) as Record<string, unknown>;
  assert.notEqual(migrated, original, "a strip must return a copy, not the caller's object");
  assert.equal(JSON.stringify(original), before, "the caller's anchor must be byte-identical after");
  assert.equal("selection_shape" in original, true);
  assert.equal("selection_shape" in migrated, false);
  assert.equal(migrated["exact"], original.exact, "exact is passed through by reference, unrewritten");

  // A clean anchor is returned unchanged, without an allocation.
  const clean = {
    book: "PSA",
    chapter: 1,
    verse_start: 4,
    verse_end: 4,
    exact: exactSelector([{ verse: 4, position: 2 }]),
  };
  assert.equal(migrateRetiredV2AnchorFields(clean), clean);

  // Non-objects are passed straight through for the validator to refuse.
  for (const notAnAnchor of [null, undefined, 7, "anchor", [1, 2]]) {
    assert.equal(migrateRetiredV2AnchorFields(notAnAnchor), notAnAnchor);
  }
});

test("every anchor shape observed in real committed history parses on the read path", () => {
  // WOULD CATCH: a fix that handles the isolated selection_shape case but not
  // the real cross-product of format_version and anchor shape found on disk.
  // The four cases below are the complete set of anchor SHAPES observed in the
  // reference library. Only the shape classes are asserted, never their counts:
  // the library is live and appends while this branch is worked on, so the
  // totals drift by design. (At the last measurement — 121 events, 70 of them
  // non-delete, 286 anchors — the split was fv1 bare 2, fv1 + render_locator
  // 20, fv2 bare 200, fv2 + selection_shape 64. Treat those as indicative.
  // The one figure the migration's doc comment depends on is the 64 that carry
  // the retired field and their 50-agree / 14-disagree / 0-missing-exact
  // fidelity split; that is recorded in retired-anchor-fields.ts.)
  const cases: { name: string; record: unknown }[] = [
    {
      name: "fv1 bare",
      record: {
        id: "conn_fv1_bare",
        format_version: 1,
        kind: "series",
        label: "fv1 bare",
        anchors: [
          { book: "PSA", chapter: 1, verse_start: 1, verse_end: 1 },
          { book: "PSA", chapter: 1, verse_start: 2, verse_end: 2 },
        ],
      },
    },
    {
      name: "fv1 + render_locator",
      record: {
        id: "conn_fv1_locator",
        format_version: 1,
        kind: "series",
        label: "fv1 with render evidence",
        anchors: [
          {
            book: "PSA",
            chapter: 1,
            verse_start: 1,
            verse_end: 1,
            render_locator: { package: "pkg.bsb", char_start: 0, char_end: 3, quote: "the" },
          },
          { book: "PSA", chapter: 1, verse_start: 2, verse_end: 2 },
        ],
      },
    },
    {
      name: "fv2 bare",
      record: v2Record([
        {
          book: "PSA",
          chapter: 1,
          verse_start: 2,
          verse_end: 2,
          exact: exactSelector([{ verse: 2, position: 6 }]),
        },
        {
          book: "PSA",
          chapter: 1,
          verse_start: 4,
          verse_end: 4,
          exact: exactSelector([{ verse: 4, position: 2 }]),
        },
      ]),
    },
    {
      name: "fv2 + selection_shape",
      record: v2Record([
        {
          book: "PSA",
          chapter: 1,
          verse_start: 3,
          verse_end: 3,
          exact: exactSelector(DISAGREEING_EXACT),
          selection_shape: selectionShape(DISAGREEING_CONTENT),
        },
        {
          book: "PSA",
          chapter: 1,
          verse_start: 4,
          verse_end: 4,
          exact: exactSelector([{ verse: 4, position: 2 }]),
          selection_shape: selectionShape([{ verse: 4, position: 2 }]),
        },
      ]),
    },
  ];

  // Guard against a vacuous loop: assert the census is the size we expect
  // BEFORE iterating, so a truncated or empty case list cannot pass by
  // finding nothing to check.
  assert.equal(cases.length, 4, "guard: all four observed anchor shapes must be exercised");

  let checked = 0;
  for (const testCase of cases) {
    const result = validateConnectionRecord(testCase.record, backbone, catalog);
    assert.equal(result.ok, true, `${testCase.name} must parse on the read path`);
    if (!result.ok) continue;
    assert.equal(result.value.anchors.length, 2, `${testCase.name} must keep both anchors`);
    checked++;
  }
  assert.equal(checked, cases.length, "every census case must have been validated, not skipped");
});

/**
 * better-sqlite3 is compiled against the Electron ABI in this repo, so the
 * projection tests below only run under `npm run test:connections:native`
 * (Electron-as-Node) and skip under plain `npm test`, matching the convention in
 * tests/connection-persistence.test.ts.
 */
function sqliteAvailable(): boolean {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}

const sqliteSkip = sqliteAvailable()
  ? false
  : "better-sqlite3 is built for the Electron ABI — run this suite through Electron-as-Node";

/**
 * Drive one connection through the DERIVED PROJECTION with the retired field
 * present in its stored `anchor_json`, exactly as a projection built by an older
 * build holds it.
 *
 * This is the SECOND read path (`hydrateExactConnectionAnchor`,
 * src/host/sqlite.ts) and it is the one that is load-bearing for a library whose
 * projection marker still matches its log: `isConnectionProjectionCurrent()`
 * returns true, no rebuild runs, and the stale rows survive indefinitely. Cold
 * boot can therefore succeed while the first connection query still throws.
 *
 * WOULD CATCH: removing the migration call in hydrateExactConnectionAnchor as
 * apparently-redundant (a freshly rebuilt projection never contains the field,
 * so nothing else in the suite notices) — and equally, replacing it with a
 * blanket unknown-key strip.
 */
function withProjection(run: (materializer: SQLiteMaterializer, dbPath: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "retired-anchor-projection-"));
  const dbPath = join(root, "library.sqlite");
  try {
    const materializer = new SQLiteMaterializer(dbPath);
    // A canonical v2 connection, written the way the real materializer writes it.
    const record: ConnectionRecordV2 = {
      id: "conn_projection_retired_field",
      format_version: 2,
      kind: "series",
      label: "projection carries a retired field",
      observation: "Stored by an older build.",
      anchors: [
        {
          book: "PSA",
          chapter: 1,
          verse_start: 3,
          verse_end: 3,
          exact: {
            format_version: 1,
            layer: BACKBONE_TOKEN_LAYER,
            occurrences: [{ verse: 3, position: 3 }, { verse: 3, position: 5 }],
          },
        },
        {
          book: "PSA",
          chapter: 1,
          verse_start: 4,
          verse_end: 4,
          exact: {
            format_version: 1,
            layer: BACKBONE_TOKEN_LAYER,
            occurrences: [{ verse: 4, position: 2 }],
          },
        },
      ],
      activeEventId: "01JAAAAAAAAAAAAAAAAAAAAAAA",
      createdAt: "2026-07-01T00:00:00.000Z",
      updatedAt: "2026-07-01T00:00:00.000Z",
    };
    materializer.upsertConnectionWithAnchors(record, []);
    materializer.close();
    run(new SQLiteMaterializer(dbPath), dbPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** Rewrite one stored anchor_json, adding sibling keys to the canonical shape. */
function patchStoredAnchor(dbPath: string, ordinal: number, extras: Record<string, unknown>): void {
  const raw = new Database(dbPath);
  try {
    const row = raw
      .prepare("SELECT anchor_json FROM connection_anchors WHERE ordinal = ?")
      .get(ordinal) as { anchor_json: string } | undefined;
    assert.ok(row, `fixture must have an anchor at ordinal ${ordinal}`);
    const stored = JSON.parse(row.anchor_json) as Record<string, unknown>;
    raw
      .prepare("UPDATE connection_anchors SET anchor_json = ? WHERE ordinal = ?")
      .run(JSON.stringify({ ...stored, ...extras }), ordinal);
  } finally {
    raw.close();
  }
}

test("a projection row whose anchor_json still carries selection_shape hydrates", { skip: sqliteSkip }, () => {
  withProjection((materializer, dbPath) => {
    materializer.close();
    // Ordinal 0 gets the DISAGREEING fidelity case: exact carries two tokens,
    // content_occurrences only one. Dropping the sidecar must not narrow `exact`.
    patchStoredAnchor(dbPath, 0, {
      selection_shape: selectionShape([{ verse: 3, position: 3 }]),
    });
    patchStoredAnchor(dbPath, 1, {
      selection_shape: selectionShape([{ verse: 4, position: 2 }]),
    });

    // Guard the fixture: prove the retired field really is in the stored bytes,
    // otherwise this test could pass by having patched nothing.
    const raw = new Database(dbPath, { readonly: true });
    const storedRows = raw
      .prepare("SELECT ordinal, anchor_json FROM connection_anchors ORDER BY ordinal")
      .all() as { ordinal: number; anchor_json: string }[];
    raw.close();
    assert.equal(storedRows.length, 2);
    for (const row of storedRows) {
      const stored = JSON.parse(row.anchor_json) as Record<string, unknown>;
      assert.ok(
        "selection_shape" in stored,
        `fixture ordinal ${row.ordinal} must actually carry the retired field`,
      );
      assert.equal(Object.keys(stored).length, 6);
    }

    const reader = new SQLiteMaterializer(dbPath);
    try {
      const connections = reader.getAllConnections();
      assert.equal(connections.length, 1, "the connection must hydrate, not throw");
      const hydrated = connections[0];
      assert.equal(hydrated.format_version, 2);
      assert.equal(hydrated.anchors.length, 2);

      for (let ordinal = 0; ordinal < hydrated.anchors.length; ordinal++) {
        const anchor = hydrated.anchors[ordinal] as unknown as Record<string, unknown>;
        assert.deepEqual(
          Object.keys(anchor).sort(),
          ["book", "chapter", "exact", "verse_end", "verse_start"],
          `hydrated anchor ${ordinal} must expose exactly the canonical keys`,
        );
        // `exact` must survive byte-identical to what the projection stored —
        // in particular ordinal 0 keeps BOTH tokens and is not narrowed to the
        // single content_occurrence.
        const storedExact = (JSON.parse(storedRows[ordinal].anchor_json) as Record<string, unknown>)["exact"];
        assert.deepEqual(anchor["exact"], storedExact, `hydrated anchor ${ordinal} altered its exact selector`);
      }
      assert.equal(
        ((hydrated.anchors[0].exact as { occurrences: unknown[] }).occurrences).length,
        2,
        "the disagreeing anchor must keep both exact tokens",
      );
    } finally {
      reader.close();
    }
  });
});

test("the projection hydrator is not a blanket unknown-key strip", { skip: sqliteSkip }, () => {
  withProjection((materializer, dbPath) => {
    materializer.close();
    // A key that is NOT enumerated as retired must still fail the closed shape
    // check, even when it rides alongside one that is.
    patchStoredAnchor(dbPath, 0, {
      selection_shape: selectionShape([{ verse: 3, position: 3 }]),
      future_field: { anything: true },
    });

    const reader = new SQLiteMaterializer(dbPath);
    try {
      assert.throws(
        () => reader.getAllConnections(),
        /has a mixed or open JSON shape/,
        "an unenumerated sibling key must still be refused by the projection hydrator",
      );
    } finally {
      reader.close();
    }
  });
});

test("every field the projection hydrator strips is the shared enumeration", { skip: sqliteSkip }, () => {
  // WOULD CATCH: the two read paths drifting apart — a field retired in one and
  // not the other. Both import RETIRED_CONNECTION_ANCHOR_FIELDS, so assert the
  // projection tolerates exactly those names and nothing else.
  for (const field of RETIRED_CONNECTION_ANCHOR_FIELDS) {
    withProjection((materializer, dbPath) => {
      materializer.close();
      patchStoredAnchor(dbPath, 0, { [field]: { format_version: 1 } });
      const reader = new SQLiteMaterializer(dbPath);
      try {
        assert.equal(
          reader.getAllConnections().length,
          1,
          `the projection must tolerate the retired field ${field}`,
        );
      } finally {
        reader.close();
      }
    });
  }
});
