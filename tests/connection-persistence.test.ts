import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import {
  CONNECTION_FORMAT_VERSION_V1,
  CONNECTION_FORMAT_VERSION_V2,
  CONNECTION_KINDS,
  isBinaryConnectionKind,
  validateConnectionRecord,
} from "../src/core/annotations/index.js";
import {
  BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
  BACKBONE_TOKEN_LAYER,
} from "../src/core/annotations/backbone-token-anchor.js";
import type {
  BackboneTokenCatalog,
} from "../src/core/annotations/backbone-token-anchor.js";
import type {
  ConnectionAnchorV1,
  ConnectionAnchorV2,
  ConnectionEventPayloadV1,
  ConnectionKind,
  ConnectionRecordV1,
  CreateConnectionInput,
} from "../src/core/annotations/types.js";
import type { LibraryEvent } from "../src/core/events/types.js";
import type { LibraryManifest } from "../src/core/interfaces.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import { LibraryEngine } from "../src/host/library.js";
import { appendRevisionJsonl } from "../src/host/revision-append.js";
import { SnapshotRevisionStore } from "../src/host/snapshot-revision-store.js";
import { SQLiteMaterializer } from "../src/host/sqlite.js";
import {
  UserMutationBroker,
  type ExplicitUserMutationIntent,
  type UserConnectionMutationAction,
} from "../src/host/user-mutation-broker.js";

const dataDir = resolve(import.meta.dirname, "../data/scripture");
const backbone = JSON.parse(
  readFileSync(join(dataDir, "backbone.json"), "utf8"),
) as BackboneData;
const bookNames = JSON.parse(
  readFileSync(join(dataDir, "book-names-en.json"), "utf8"),
) as BookNameMap;

const tokenCatalog: BackboneTokenCatalog = {
  layer: BACKBONE_TOKEN_LAYER,
  format_version: BACKBONE_TOKEN_CATALOG_FORMAT_VERSION,
  tokenCount: () => 512,
};

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

async function withLibrary(
  run: (
    root: string,
    engine: LibraryEngine,
    broker: UserMutationBroker,
  ) => Promise<void> | void,
  catalog: BackboneTokenCatalog | null = tokenCatalog,
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "scripture-connections-v2-"));
  try {
    const engine = new LibraryEngine(root, backbone, bookNames, catalog);
    engine.initLibrary();
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    await run(root, engine, broker);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

let commandSequence = 0;
function intent(action: UserConnectionMutationAction): ExplicitUserMutationIntent {
  commandSequence += 1;
  return {
    source: "first-party-ui",
    action,
    commandId: `persistence-command-${commandSequence}`,
  };
}

function exactAnchor(
  verse: number,
  positions: readonly number[] = [1],
): ConnectionAnchorV2 {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: verse,
    verse_end: verse,
    exact: {
      format_version: BACKBONE_TOKEN_EXACT_FORMAT_VERSION,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences: positions.map((position) => ({ verse, position })),
    },
  };
}

function legacyAnchor(
  verse: number,
  locator?: { package: string; char_start: number; char_end: number; quote: string },
): ConnectionAnchorV1 {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: verse,
    verse_end: verse,
    ...(locator ? { render_locator: locator } : {}),
  };
}

function connectionInput(
  label: string,
  anchors: ConnectionAnchorV2[],
  observation = "",
  kind: ConnectionKind = "series",
): CreateConnectionInput {
  return { kind, label, observation, anchors };
}

function manifestAt(appSchemaVersion: number): LibraryManifest {
  return {
    libraryId: "01JCONNECTIONPERSISTENCE00000",
    createdAt: "2026-07-20T12:34:56.000Z",
    appSchemaVersion,
    eventSchemaVersion: 1,
    referenceFormatVersion: "bref:v1",
    pluginApiVersion: "1",
  };
}

function legacyCreateEvent(
  entityId = "conn_legacy_v1",
  createdAt = "2026-07-20T13:00:00.000Z",
): LibraryEvent<ConnectionEventPayloadV1> {
  return {
    eventId: `evt-create-${entityId}`,
    schemaVersion: 1,
    entityType: "annotation",
    entityId,
    op: "create",
    actor: { kind: "user" },
    deviceId: "legacy-device",
    seq: 1,
    createdAt,
    payload: {
      format_version: CONNECTION_FORMAT_VERSION_V1,
      kind: "series",
      label: "legacy refrain",
      anchors: [
        legacyAnchor(1, { package: "web", char_start: 0, char_end: 7, quote: "Blessed" }),
        legacyAnchor(3),
      ],
    },
  };
}

function writeConnectionEvents(root: string, events: readonly LibraryEvent[]): Buffer {
  const bytes = Buffer.from(events.map((event) => JSON.stringify(event) + "\n").join(""), "utf8");
  writeFileSync(join(root, "annotations/connections.jsonl"), bytes);
  return bytes;
}

test("mixed connection contract keeps v1 readable and admits only catalog-validated v2 creates", () => {
  assert.deepEqual(CONNECTION_KINDS, [
    "link:parallel",
    "link:contrast",
    "link:echo",
    "mirror",
    "series",
    "hinge",
  ]);
  assert.deepEqual(
    CONNECTION_KINDS.filter((kind) => isBinaryConnectionKind(kind)),
    ["link:contrast", "mirror", "hinge"],
  );

  const legacy = validateConnectionRecord({
    id: "conn_v1",
    format_version: CONNECTION_FORMAT_VERSION_V1,
    kind: "series",
    label: "legacy",
    anchors: [legacyAnchor(1), legacyAnchor(2)],
  }, backbone);
  assert.equal(legacy.ok, true);

  for (const kind of CONNECTION_KINDS) {
    const current = validateConnectionRecord({
      id: `conn_${kind}`,
      format_version: CONNECTION_FORMAT_VERSION_V2,
      kind,
      label: kind,
      observation: "",
      anchors: [exactAnchor(1), exactAnchor(2)],
    }, backbone, tokenCatalog);
    assert.equal(current.ok, true, kind);
  }

  const noCatalog = validateConnectionRecord({
    id: "conn_no_catalog",
    format_version: CONNECTION_FORMAT_VERSION_V2,
    kind: "series",
    label: "exact",
    observation: "",
    anchors: [exactAnchor(1), exactAnchor(2)],
  }, backbone);
  assert.equal(noCatalog.ok, false);
  if (!noCatalog.ok) assert.equal(noCatalog.error.code, "exact-anchor-refused");

  const future = validateConnectionRecord({
    id: "conn_future",
    format_version: 3,
    kind: "series",
    label: "future",
    observation: "",
    anchors: [exactAnchor(1), exactAnchor(2)],
  }, backbone, tokenCatalog);
  assert.equal(future.ok, false);
  if (!future.ok) assert.equal(future.error.code, "unsupported-format-version");
});

test("v2 broker events preserve observation, exact anchors, and envelope-derived timestamps without leaking metadata", async () => {
  await withLibrary(async (root, _engine, broker) => {
    const input = connectionInput(
      "blessed and planted",
      [exactAnchor(1, [1, 2]), exactAnchor(3, [4])],
      "The opening blessing frames the tree image.",
      "link:parallel",
    );
    const created = (await broker.createConnection(
      intent("connection:create"),
      input,
    )).connection!;

    const connectionPath = join(root, "annotations/connections.jsonl");
    const firstBytes = readFileSync(connectionPath);
    const firstLine = firstBytes.toString("utf8").trim();
    const createEvent = JSON.parse(firstLine) as LibraryEvent<Record<string, unknown>>;
    assert.deepEqual(firstBytes, Buffer.from(`${JSON.stringify(createEvent)}\n`, "utf8"));
    assert.equal(createEvent.payload["format_version"], CONNECTION_FORMAT_VERSION_V2);
    assert.equal(createEvent.payload["observation"], input.observation);
    assert.deepEqual(createEvent.payload["anchors"], input.anchors);
    for (const derivedOnly of ["activeEventId", "createdAt", "updatedAt"]) {
      assert.equal(derivedOnly in createEvent.payload, false, `${derivedOnly} leaked into payload`);
    }
    assert.equal(created.activeEventId, createEvent.eventId);
    assert.equal(created.createdAt, createEvent.createdAt);
    assert.equal(created.updatedAt, createEvent.createdAt);

    const updateInput = connectionInput(
      "blessed, planted, and fruitful",
      [exactAnchor(1, [1, 2]), exactAnchor(3, [4]), exactAnchor(6, [2])],
      "Observation survives the full-record update.",
      "link:parallel",
    );
    const updated = (await broker.updateConnection(
      intent("connection:update"),
      created.id,
      updateInput,
      created.activeEventId,
    )).connection!;
    const lines = readFileSync(connectionPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    const updateEvent = JSON.parse(lines[1]!) as LibraryEvent<Record<string, unknown>>;
    assert.equal(updateEvent.baseEventId, createEvent.eventId);
    assert.equal(updateEvent.payload["observation"], updateInput.observation);
    assert.equal("activeEventId" in updateEvent.payload, false);
    assert.equal(updated.createdAt, createEvent.createdAt);
    assert.equal(updated.updatedAt, updateEvent.createdAt);
    assert.equal(updated.activeEventId, updateEvent.eventId);
  });
});

test("v2 fold and SQLite projection round-trip exact identity, observation, timestamps, query, and deterministic rebuild", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput(
        "same passage, distinct words",
        [exactAnchor(1, [1]), exactAnchor(1, [2]), exactAnchor(3, [4, 5])],
        "Exact occurrences sharing one verse must remain distinct.",
      ),
    )).connection!;

    assert.deepEqual(engine.queryConnectionById(created.id), created);
    assert.deepEqual(engine.queryConnectionsForVerse("PSA", 1, 1), [created]);
    assert.deepEqual(engine.queryConnectionsForRange("PSA", 1, 2, 3), [created]);
    assert.equal(engine.queryConnectionsForVerse("PSA", 1, 1).length, 1);

    const dbPath = join(root, ".system/library.sqlite");
    const beforeDb = new SQLiteMaterializer(dbPath);
    const derivedAnchors = beforeDb.queryAnchorsBySrcId(created.id);
    assert.equal(derivedAnchors.length, 3);
    assert.equal(new Set(derivedAnchors.map((anchor) => anchor.id)).size, 3);
    assert.ok(derivedAnchors.every((anchor) => (
      anchor.provenance.includes("connection-v2")
      && anchor.provenance.includes("identity-sha256-")
    )));
    const originalOrdinalZero = derivedAnchors.find((anchor) => (
      anchor.provenance.includes(":ordinal-0:")
    ));
    assert.ok(originalOrdinalZero);
    beforeDb.close();

    const rawDb = new Database(dbPath, { readonly: true });
    const projected = rawDb.prepare(
      `SELECT c.observation, c.created_at, c.updated_at, ca.ordinal, ca.anchor_json
       FROM connections c JOIN connection_anchors ca ON ca.connection_id = c.id
       WHERE c.id = ? ORDER BY ca.ordinal`,
    ).all(created.id) as Array<{
      observation: string;
      created_at: string;
      updated_at: string;
      ordinal: number;
      anchor_json: string;
    }>;
    rawDb.close();
    assert.deepEqual(projected.map((row) => JSON.parse(row.anchor_json)), created.anchors);
    assert.ok(projected.every((row) => row.observation === created.observation));
    assert.ok(projected.every((row) => row.created_at === created.createdAt));
    assert.ok(projected.every((row) => row.updated_at === created.updatedAt));

    const updated = (await broker.updateConnection(
      intent("connection:update"),
      created.id,
      connectionInput(
        "same passage, refined",
        [exactAnchor(1, [2]), exactAnchor(3, [4, 5])],
        "A refined durable observation.",
      ),
      created.activeEventId,
    )).connection!;
    assert.equal(updated.createdAt, created.createdAt);
    assert.deepEqual(engine.queryConnectionById(created.id), updated);
    const updatedDb = new SQLiteMaterializer(dbPath);
    const updatedOrdinalZero = updatedDb.queryAnchorsBySrcId(created.id).find((anchor) => (
      anchor.provenance.includes(":ordinal-0:")
    ));
    updatedDb.close();
    assert.ok(updatedOrdinalZero);
    assert.notEqual(
      updatedOrdinalZero.id,
      originalOrdinalZero.id,
      "changing the exact occurrence at one ordinal retained a passage-only Derived id",
    );

    const connectionPath = join(root, "annotations/connections.jsonl");
    const authoredBefore = readFileSync(connectionPath);
    const firstHash = engine.buildSqlite();
    const firstFold = engine.getAllConnections();
    engine.deleteSystemDir();
    const restarted = new LibraryEngine(root, backbone, bookNames, tokenCatalog);
    const secondHash = restarted.buildSqlite();
    assert.equal(secondHash, firstHash);
    assert.deepEqual(restarted.getAllConnections(), firstFold);
    assert.deepEqual(restarted.queryConnectionById(created.id), updated);
    assert.deepEqual(readFileSync(connectionPath), authoredBefore);
    assert.equal(restarted.isConnectionProjectionCurrent(), true);
  });
});

test("authoritative batch heads expose the folded append-only version while Derived is stale", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("derived head", [exactAnchor(1), exactAnchor(2)], "before"),
    )).connection!;
    const planned = engine.planConnectionUpdate(
      created.id,
      connectionInput("authored head", [exactAnchor(1), exactAnchor(3)], "after"),
      { commandId: "authoritative-batch-update", commandFingerprint: "f".repeat(64) },
      created.activeEventId,
    );
    appendRevisionJsonl(root, planned.append);

    assert.equal(
      engine.queryConnectionById(created.id)?.activeEventId,
      created.activeEventId,
      "the test did not leave the SQLite projection behind",
    );
    assert.deepEqual(
      engine.queryAuthoredConnectionHeads(["missing", created.id]),
      [planned.connection],
    );
    assert.equal(planned.connection.activeEventId, planned.event.eventId);
    assert.equal(planned.connection.observation, "after");
  });
});

test("future connection payloads cannot hide behind a later valid head or tombstone", async () => {
  for (const concealment of ["superseded", "tombstoned"] as const) {
    await withLibrary(async (_root, engine, broker) => {
      const created = (await broker.createConnection(
        intent("connection:create"),
        connectionInput(`${concealment} base`, [exactAnchor(1), exactAnchor(2)], "safe"),
      )).connection!;
      const futureEvent = engine.createEvent(
        "annotation",
        created.id,
        "update",
        {
          format_version: 3,
          kind: "series",
          label: `${concealment} future payload`,
          observation: "must never be folded away",
          anchors: [exactAnchor(1), exactAnchor(2)],
        },
        created.activeEventId,
      );
      engine.appendEvent(futureEvent);
      const coveringEvent = concealment === "tombstoned"
        ? engine.createEvent("annotation", created.id, "delete", {}, futureEvent.eventId)
        : engine.createEvent(
          "annotation",
          created.id,
          "update",
          {
            format_version: CONNECTION_FORMAT_VERSION_V2,
            kind: "series",
            label: "apparently valid descendant",
            observation: "must not conceal unsupported history",
            anchors: [exactAnchor(1), exactAnchor(3)],
          },
          futureEvent.eventId,
        );
      engine.appendEvent(coveringEvent);

      assert.throws(
        () => engine.queryAuthoredConnectionHeads([created.id]),
        /unsupported format_version 3/i,
        concealment,
      );
    });
  }
});

test("legacy v1 events remain byte-identical and readable without a token catalog", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, _engine) => {
    const legacyEvent = legacyCreateEvent();
    const authoredBytes = writeConnectionEvents(root, [legacyEvent]);
    const legacyEngine = new LibraryEngine(root, backbone, bookNames);
    const firstHash = legacyEngine.buildSqlite();
    const expected: ConnectionRecordV1 = {
      id: legacyEvent.entityId,
      ...legacyEvent.payload,
      activeEventId: legacyEvent.eventId,
      createdAt: legacyEvent.createdAt,
      updatedAt: legacyEvent.createdAt,
    };
    assert.deepEqual(legacyEngine.queryConnectionById(legacyEvent.entityId), expected);
    assert.deepEqual(readFileSync(join(root, "annotations/connections.jsonl")), authoredBytes);

    legacyEngine.deleteSystemDir();
    assert.equal(legacyEngine.buildSqlite(), firstHash);
    assert.deepEqual(legacyEngine.queryConnectionById(legacyEvent.entityId), expected);
    assert.deepEqual(readFileSync(join(root, "annotations/connections.jsonl")), authoredBytes);
  }, null);
});

test("schema-v1 legacy reads and deletes stay dormant while the first explicit v2 plan publishes schema2 before append", async () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-connection-schema-boundary-"));
  try {
    const bootstrap = new LibraryEngine(root, backbone, bookNames, tokenCatalog);
    bootstrap.initLibrary();
    const manifestPath = join(root, "config/library-manifest.json");
    const legacyManifest = manifestAt(1);
    writeFileSync(manifestPath, JSON.stringify(legacyManifest, null, 2));
    const legacyEvent = legacyCreateEvent("conn_schema1_legacy");
    const legacyBytes = writeConnectionEvents(root, [legacyEvent]);

    const engine = new LibraryEngine(root, backbone, bookNames, tokenCatalog);
    engine.planConnectionDelete(
      legacyEvent.entityId,
      { commandId: "legacy-delete-plan", commandFingerprint: "a".repeat(64) },
      legacyEvent.eventId,
    );
    assert.equal(engine.readManifest()?.appSchemaVersion, 1, "legacy delete planning auto-migrated");
    assert.deepEqual(readFileSync(join(root, "annotations/connections.jsonl")), legacyBytes);

    const plan = engine.planConnectionCreate(
      connectionInput("first exact connection", [exactAnchor(1), exactAnchor(2)], "v2 boundary"),
      { commandId: "first-v2-plan", commandFingerprint: "b".repeat(64) },
    );
    const migrated = engine.readManifest();
    assert.equal(migrated?.appSchemaVersion, 2);
    assert.equal(migrated?.libraryId, legacyManifest.libraryId);
    assert.equal(migrated?.createdAt, legacyManifest.createdAt);
    assert.deepEqual(
      readFileSync(join(root, "annotations/connections.jsonl")),
      legacyBytes,
      "manifest publication falsely included or rewrote the pending event append",
    );

    // This is the intentional ordered recovery boundary: after a crash here,
    // schema2 + untouched v1 bytes is valid. The same append plan can resume.
    appendRevisionJsonl(root, plan.append);
    const authoredAfterAppend = readFileSync(join(root, "annotations/connections.jsonl"));
    assert.deepEqual(authoredAfterAppend.subarray(0, legacyBytes.length), legacyBytes);
    assert.equal(authoredAfterAppend.subarray(legacyBytes.length).toString("utf8"), plan.append.content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid catalog and future manifests refuse v2 planning before authored bytes or schema are changed", () => {
  const root = mkdtempSync(join(tmpdir(), "scripture-connection-refusal-"));
  try {
    const bootstrap = new LibraryEngine(root, backbone, bookNames);
    bootstrap.initLibrary();
    const manifestPath = join(root, "config/library-manifest.json");
    const connectionPath = join(root, "annotations/connections.jsonl");
    writeFileSync(manifestPath, JSON.stringify(manifestAt(1), null, 2));
    const authoredBefore = readFileSync(connectionPath);

    assert.throws(
      () => bootstrap.planConnectionCreate(
        connectionInput("no catalog", [exactAnchor(1), exactAnchor(2)]),
        { commandId: "no-catalog", commandFingerprint: "c".repeat(64) },
      ),
      /catalog/i,
    );
    assert.equal(bootstrap.readManifest()?.appSchemaVersion, 1);
    assert.deepEqual(readFileSync(connectionPath), authoredBefore);

    writeFileSync(manifestPath, JSON.stringify(manifestAt(3), null, 2));
    const futureEngine = new LibraryEngine(root, backbone, bookNames, tokenCatalog);
    assert.throws(
      () => futureEngine.planConnectionCreate(
        connectionInput("future", [exactAnchor(1), exactAnchor(2)]),
        { commandId: "future-manifest", commandFingerprint: "d".repeat(64) },
      ),
      /newer than the app understands/i,
    );
    assert.deepEqual(readFileSync(connectionPath), authoredBefore);
    assert.throws(() => futureEngine.buildSqlite(), /newer than the app understands/i);
    assert.throws(
      () => futureEngine.queryConnectionById("conn_any"),
      /newer than the app understands/i,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("future or malformed active payloads roll back Derived publication and never rewrite authoritative JSONL", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("last complete projection", [exactAnchor(1), exactAnchor(6)], "safe", "hinge"),
    )).connection!;
    const connectionPath = join(root, "annotations/connections.jsonl");
    const futureEvent = engine.createEvent(
      "annotation",
      created.id,
      "update",
      {
        format_version: 3,
        kind: "hinge",
        label: "must be refused",
        observation: "future",
        anchors: [exactAnchor(1), exactAnchor(6)],
      },
      created.activeEventId,
    );
    engine.appendEvent(futureEvent);
    const authoredWithFuture = readFileSync(connectionPath);

    assert.throws(() => engine.buildSqlite(), /unsupported format_version 3/i);
    assert.deepEqual(readFileSync(connectionPath), authoredWithFuture);
    const oldProjection = new SQLiteMaterializer(join(root, ".system/library.sqlite"));
    try {
      assert.equal(oldProjection.queryConnectionById(created.id)?.label, "last complete projection");
    } finally {
      oldProjection.close();
    }
    assert.equal(engine.isConnectionProjectionCurrent(), false);
  });
});

test("catalog-invalid v2 anchors refuse a rebuild while the last complete projection remains readable", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("catalog-valid head", [exactAnchor(1), exactAnchor(2)], "safe"),
    )).connection!;
    const malformed = engine.createEvent(
      "annotation",
      created.id,
      "update",
      {
        format_version: CONNECTION_FORMAT_VERSION_V2,
        kind: "series",
        label: "out of catalog",
        observation: "must refuse",
        anchors: [exactAnchor(1, [513]), exactAnchor(2)],
      },
      created.activeEventId,
    );
    engine.appendEvent(malformed);
    const connectionPath = join(root, "annotations/connections.jsonl");
    const authoredWithMalformed = readFileSync(connectionPath);

    assert.throws(() => engine.buildSqlite(), /exceeds .* 512 tokens/i);
    assert.deepEqual(readFileSync(connectionPath), authoredWithMalformed);
    const previous = new SQLiteMaterializer(join(root, ".system/library.sqlite"));
    try {
      assert.equal(previous.queryConnectionById(created.id)?.label, "catalog-valid head");
    } finally {
      previous.close();
    }
  });
});

test("SQLite hydration refuses future formats and mixed v1/v2 anchor rows without touching Substrate", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("strict hydration", [exactAnchor(1), exactAnchor(2)], "closed rows"),
    )).connection!;
    const connectionPath = join(root, "annotations/connections.jsonl");
    const authoredBefore = readFileSync(connectionPath);
    const dbPath = join(root, ".system/library.sqlite");

    const futureDb = new Database(dbPath);
    futureDb.prepare("UPDATE connections SET format_version = 3 WHERE id = ?").run(created.id);
    futureDb.close();
    const futureReader = new SQLiteMaterializer(dbPath);
    try {
      assert.throws(
        () => futureReader.queryConnectionById(created.id),
        /unsupported format_version 3/i,
      );
    } finally {
      futureReader.close();
    }

    engine.buildSqlite();
    const mixedDb = new Database(dbPath);
    mixedDb.prepare(
      "UPDATE connection_anchors SET anchor_json = ? WHERE connection_id = ? AND ordinal = 0",
    ).run(JSON.stringify(legacyAnchor(1)), created.id);
    mixedDb.close();
    const mixedReader = new SQLiteMaterializer(dbPath);
    try {
      assert.throws(
        () => mixedReader.queryConnectionById(created.id),
        /mixed or open JSON shape/i,
      );
    } finally {
      mixedReader.close();
    }

    assert.deepEqual(readFileSync(connectionPath), authoredBefore);
    engine.buildSqlite();
    assert.deepEqual(engine.queryConnectionById(created.id), created);
  });
});

test("an old connection projection marker is invalidated and rebuilt without touching authored bytes", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    await broker.createConnection(
      intent("connection:create"),
      connectionInput("projection v2", [exactAnchor(1), exactAnchor(2)], "marker"),
    );
    const connectionPath = join(root, "annotations/connections.jsonl");
    const authoredBefore = readFileSync(connectionPath);
    const dbPath = join(root, ".system/library.sqlite");
    const rawDb = new Database(dbPath);
    rawDb.prepare("DELETE FROM meta WHERE key IN (?, ?)").run(
      "connections_projection_v2",
      "connections_projection_schema",
    );
    rawDb.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      "connections_projection_v1",
      "v1:stale",
    );
    rawDb.close();

    assert.equal(engine.isConnectionProjectionCurrent(), false);
    engine.buildSqlite();
    assert.equal(engine.isConnectionProjectionCurrent(), true);
    assert.deepEqual(readFileSync(connectionPath), authoredBefore);
    const rebuiltDb = new SQLiteMaterializer(dbPath);
    try {
      assert.equal(rebuiltDb.getMeta("connections_projection_schema"), "2");
      assert.match(rebuiltDb.getMeta("connections_projection_v2") ?? "", /^v2:/);
      assert.equal(rebuiltDb.getMeta("connections_projection_v1"), undefined);
    } finally {
      rebuiltDb.close();
    }
  });
});

test("connection deletion keeps append-only history and removes all Derived parent/member rows", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("choice and consequence", [exactAnchor(1), exactAnchor(6)], "", "hinge"),
    )).connection!;
    await broker.deleteConnection(
      intent("connection:delete"),
      created.id,
      created.activeEventId,
    );
    assert.equal(engine.queryConnectionById(created.id), undefined);
    const db = new SQLiteMaterializer(join(root, ".system/library.sqlite"));
    assert.equal(db.queryAnchorsBySrcId(created.id).length, 0);
    db.close();
    const events = engine.readAllEvents().connections;
    assert.equal(events.length, 2);
    assert.equal(events[0]?.op, "create");
    assert.equal(events[1]?.op, "delete");
    assert.equal(events[1]?.baseEventId, events[0]?.eventId);
    const authoredBefore = readFileSync(join(root, "annotations/connections.jsonl"));
    const deletedHash = engine.buildSqlite();
    engine.deleteSystemDir();
    assert.equal(engine.buildSqlite(), deletedHash);
    assert.deepEqual(readFileSync(join(root, "annotations/connections.jsonl")), authoredBefore);
  });
});

test("startup rebuild quarantines garbage Derived state without touching Substrate", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    const systemDir = join(root, ".system");
    const dbPath = join(systemDir, "library.sqlite");
    const connectionPath = join(root, "annotations/connections.jsonl");
    const authoredBefore = readFileSync(connectionPath);
    const garbage = Buffer.from("not a sqlite database\u0000derived-only garbage", "utf8");
    mkdirSync(systemDir, { recursive: true });
    writeFileSync(dbPath, garbage);

    assert.equal(engine.isConnectionProjectionCurrent(), false);
    const hash = engine.buildSqlite();
    assert.equal(engine.isConnectionProjectionCurrent(), true);
    assert.deepEqual(readFileSync(connectionPath), authoredBefore);
    const quarantined = readdirSync(systemDir)
      .filter((entry) => /^library\.sqlite\.corrupt-[0-9A-Z]{26}$/.test(entry));
    assert.equal(quarantined.length, 1);
    assert.deepEqual(readFileSync(join(systemDir, quarantined[0]!)), garbage);
    const rebuilt = new SQLiteMaterializer(dbPath);
    try {
      assert.equal(rebuilt.getMeta("rebuild_hash"), hash);
      assert.deepEqual(rebuilt.getAllConnections(), []);
    } finally {
      rebuilt.close();
    }
  });
});

test("existing WAL readers observe a complete rebuilt v2 projection on the same database inode", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine, broker) => {
    engine.buildSqlite();
    const created = (await broker.createConnection(
      intent("connection:create"),
      connectionInput("reader sees old snapshot", [exactAnchor(1), exactAnchor(2)], "before"),
    )).connection!;
    const dbPath = join(root, ".system/library.sqlite");
    const existingReader = new SQLiteMaterializer(dbPath);
    try {
      assert.equal(existingReader.queryConnectionById(created.id)?.label, "reader sees old snapshot");
      const update = engine.planConnectionUpdate(
        created.id,
        connectionInput("reader sees rebuilt head", [exactAnchor(1), exactAnchor(3)], "after"),
        { commandId: "live-reader-v2-update", commandFingerprint: "e".repeat(64) },
        created.activeEventId,
      );
      appendRevisionJsonl(root, update.append);
      engine.buildSqlite();
      assert.equal(existingReader.queryConnectionById(created.id)?.label, "reader sees rebuilt head");
      assert.equal(existingReader.queryConnectionById(created.id)?.createdAt, created.createdAt);
    } finally {
      existingReader.close();
    }
  });
});

test("test harness really exercises the configured connection log", async () => {
  await withLibrary((root) => {
    assert.equal(existsSync(join(root, "annotations/connections.jsonl")), true);
  });
});
