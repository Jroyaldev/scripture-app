import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import type {
  RevisionAppend,
  RevisionAppendReceipt,
  RevisionReceipt,
  RevisionStore,
  RevisionTxn,
} from "../src/core/interfaces.js";
import type {
  ConnectionAnchorV2,
  CreateConnectionInput,
} from "../src/core/annotations/types.js";
import { CONNECTION_FORMAT_VERSION_V2 } from "../src/core/annotations/types.js";
import { BACKBONE_TOKEN_LAYER } from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneTokenCatalog } from "../src/core/annotations/backbone-token-anchor.js";
import type { BackboneData, BookNameMap } from "../src/core/reference/types.js";
import {
  LibraryEngine,
  type PlannedConnectionMutation,
} from "../src/host/library.js";
import { SnapshotRevisionStore } from "../src/host/snapshot-revision-store.js";
import {
  appendRevisionJsonl,
  revisionReceiptId,
} from "../src/host/revision-append.js";
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
  format_version: 1,
  tokenCount: () => 4_096,
};

const sqliteSkip = sqliteAvailable()
  ? false
  : "better-sqlite3 is built for the Electron ABI";

function anchor(verse: number, position = 1): ConnectionAnchorV2 {
  return {
    book: "PSA",
    chapter: 1,
    verse_start: verse,
    verse_end: verse,
    exact: {
      format_version: 1,
      layer: BACKBONE_TOKEN_LAYER,
      occurrences: [{ verse, position }],
    },
  };
}

function connectionInput(
  kind: CreateConnectionInput["kind"],
  label: string,
  anchors: ConnectionAnchorV2[],
  observation = "",
): CreateConnectionInput {
  return { kind, label, observation, anchors };
}

/** Same durable value with intentionally different insertion order at every level. */
function reorderedInput(input: CreateConnectionInput): CreateConnectionInput {
  return {
    anchors: input.anchors.map((value) => ({
      exact: {
        occurrences: value.exact.occurrences.map((occurrence) => ({
          position: occurrence.position,
          verse: occurrence.verse,
        })),
        layer: value.exact.layer,
        format_version: value.exact.format_version,
      },
      verse_end: value.verse_end,
      verse_start: value.verse_start,
      chapter: value.chapter,
      book: value.book,
    })),
    observation: input.observation,
    label: input.label,
    kind: input.kind,
  };
}

function expectedCommandFingerprint(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, candidate: unknown) => {
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return candidate;
    }
    const source = candidate as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source).sort().map((key) => [key, source[key]]),
    );
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function intent(
  action: UserConnectionMutationAction,
  commandId: string,
): ExplicitUserMutationIntent {
  return { source: "first-party-ui", action, commandId };
}

async function withLibrary(
  run: (root: string, engine: LibraryEngine) => Promise<void>,
  makeEngine: (root: string) => LibraryEngine = (root) => libraryEngine(root),
): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "scripture-user-broker-"));
  try {
    const engine = makeEngine(root);
    engine.initLibrary();
    await run(root, engine);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function libraryEngine(root: string): LibraryEngine {
  return new LibraryEngine(root, backbone, bookNames, tokenCatalog);
}

test("broker rejects invalid/spoofed commands and begin failures before Substrate changes", async () => {
  await withLibrary(async (root, engine) => {
    const logPath = join(root, "annotations/connections.jsonl");
    const broker = new UserMutationBroker(engine, new BeginFailingStore());
    const input = {
      kind: "series" as const,
      label: "unchanged",
      observation: "",
      anchors: [anchor(1), anchor(2)],
    };

    let poisonInputReads = 0;
    const poisonInput = {} as CreateConnectionInput;
    Object.defineProperty(poisonInput, "kind", {
      enumerable: true,
      get() {
        poisonInputReads++;
        throw new Error("connection input was read before its ids were bounded");
      },
    });

    assert.throws(
      () => broker.createConnection(
        { source: "plugin" as "first-party-ui", action: "connection:create", commandId: "spoofed-command" },
        input,
      ),
      /first-party user intent/,
    );
    assert.throws(
      () => broker.createConnection(
        intent("connection:create", "short"),
        poisonInput,
      ),
      /commandId is invalid/,
    );
    await assert.rejects(
      broker.updateConnection(
        intent("connection:update", "invalid-entity-before-input"),
        "not valid/connection/id",
        poisonInput,
        "evt_valid_base",
      ),
      /Connection id is invalid/,
    );
    assert.equal(poisonInputReads, 0, "unbounded ids reached input copying or hashing");
    await assert.rejects(
      broker.createConnection(intent("connection:create", "begin-failure"), input),
      /injected begin failure/,
    );
    const appendFailingBroker = new UserMutationBroker(engine, new AppendFailingStore());
    await assert.rejects(
      appendFailingBroker.createConnection(intent("connection:create", "append-failure"), input),
      /injected append failure/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "invalid-anchor"), {
        ...input,
        anchors: [anchor(1)],
      }),
      /2 to 64 anchors/,
    );

    assert.equal(readFileSync(logPath, "utf8"), "");
    assert.equal("createConnection" in engine, false, "LibraryEngine exposes no direct connection writer");
  });
});

test("one command is idempotent and cannot be reused for different content", async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const command = intent("connection:create", "stable-create-command");
    const input = {
      kind: "link:parallel" as const,
      label: "one command",
      observation: "Repeated blessing frames the whole psalm.",
      anchors: [anchor(1), anchor(3)],
    };

    const [first, retried] = await Promise.all([
      broker.createConnection(command, input),
      broker.createConnection(command, reorderedInput(input)),
    ]);
    assert.equal(retried.receipt.id, first.receipt.id);
    assert.equal(retried.connection?.id, first.connection?.id);
    const persisted = connectionEvents(root);
    assert.equal(persisted.length, 1);
    assert.equal(
      persisted[0]?.commandFingerprint,
      expectedCommandFingerprint([
        "connection:create",
        CONNECTION_FORMAT_VERSION_V2,
        input,
      ]),
      "durable create fingerprint omitted the v2 namespace",
    );
    assert.notEqual(
      persisted[0]?.commandFingerprint,
      expectedCommandFingerprint(["connection:create", input]),
      "v2 command reused the legacy unversioned fingerprint preimage",
    );

    await assert.rejects(
      broker.createConnection(command, { ...input, label: "different content" }),
      /reused for different content/,
    );
    await assert.rejects(
      broker.createConnection(command, { ...input, observation: "different observation" }),
      /reused for different content/,
    );
    await assert.rejects(
      broker.createConnection(command, {
        ...input,
        anchors: [
          {
            ...input.anchors[0]!,
            exact: {
              ...input.anchors[0]!.exact,
              layer: "backbone-token:changed" as typeof BACKBONE_TOKEN_LAYER,
            },
          },
          input.anchors[1]!,
        ],
      }),
      /reused for different content/,
    );
    await assert.rejects(
      broker.createConnection(command, {
        ...input,
        anchors: [
          {
            ...input.anchors[0]!,
            exact: {
              ...input.anchors[0]!.exact,
              occurrences: [{ verse: 2, position: 1 }],
            },
          },
          input.anchors[1]!,
        ],
      }),
      /reused for different content/,
    );
    await assert.rejects(
      broker.createConnection(command, {
        ...input,
        anchors: [anchor(1, 2), input.anchors[1]!],
      }),
      /reused for different content/,
    );
    assert.equal(connectionEvents(root).length, 1);
  });
});

test("broker snapshots nested v2 content before the serialized append lane runs", async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const input = connectionInput(
      "series",
      "copy before queue",
      [anchor(1, 1), anchor(2, 2)],
      "original observation",
    );

    const pending = broker.createConnection(
      intent("connection:create", "deep-copy-before-queue"),
      input,
    );
    input.observation = "mutated after admission";
    input.anchors[0]!.exact.occurrences[0]!.position = 99;

    const committed = await pending;
    assert.equal(committed.connection?.format_version, 2);
    if (committed.connection?.format_version !== 2) return;
    assert.equal(committed.connection.observation, "original observation");
    assert.equal(
      committed.connection.anchors[0]?.exact.occurrences[0]?.position,
      1,
    );
    assert.equal(connectionEvents(root).length, 1);
  });
});

test("command identity survives broker, engine, and RevisionStore restart", async () => {
  await withLibrary(async (root, firstEngine) => {
    const command = intent("connection:create", "restart-safe-create");
    const input = {
      kind: "link:echo" as const,
      label: "restart-safe command",
      observation: "The same exact words remain canonical after restart.",
      anchors: [anchor(1), anchor(4)],
    };
    const first = await new UserMutationBroker(
      firstEngine,
      new SnapshotRevisionStore(root),
    ).createConnection(command, input);

    const restartedEngine = libraryEngine(root);
    const restarted = await new UserMutationBroker(
      restartedEngine,
      new SnapshotRevisionStore(root),
    ).createConnection(command, reorderedInput(input));

    assert.equal(restarted.receipt.id, first.receipt.id);
    assert.equal(restarted.connection?.id, first.connection?.id);
    assert.equal(connectionEvents(root).length, 1, "restart Retry appended a duplicate create");
    await assert.rejects(
      new UserMutationBroker(
        libraryEngine(root),
        new SnapshotRevisionStore(root),
      ).createConnection(command, { ...input, label: "collision after restart" }),
      /reused for different content/,
    );
    await assert.rejects(
      new UserMutationBroker(
        libraryEngine(root),
        new SnapshotRevisionStore(root),
      ).createConnection(command, {
        ...input,
        anchors: [
          {
            ...input.anchors[0]!,
            exact: {
              ...input.anchors[0]!.exact,
              layer: "backbone-token:future" as typeof BACKBONE_TOKEN_LAYER,
            },
          },
          input.anchors[1]!,
        ],
      }),
      /reused for different content/,
      "durable command replay did not outrank semantic layer refusal",
    );

    const updateCommand = intent("connection:update", "restart-safe-update");
    const updateInput = { ...input, label: "restart-safe update" };
    const updated = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).updateConnection(
      updateCommand,
      first.connection!.id,
      updateInput,
      first.connection!.activeEventId,
    );
    assert.equal(
      connectionEvents(root)[1]?.commandFingerprint,
      expectedCommandFingerprint([
        "connection:update",
        CONNECTION_FORMAT_VERSION_V2,
        first.connection!.id,
        first.connection!.activeEventId,
        updateInput,
      ]),
      "durable update fingerprint omitted the v2 namespace",
    );
    const retriedUpdate = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).updateConnection(
      updateCommand,
      first.connection!.id,
      updateInput,
      first.connection!.activeEventId,
    );
    assert.equal(retriedUpdate.receipt.id, updated.receipt.id);
    assert.equal(connectionEvents(root).length, 2, "restart Retry appended a duplicate update");

    const deleteCommand = intent("connection:delete", "restart-safe-delete");
    const deleted = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).deleteConnection(deleteCommand, first.connection!.id, updated.connection!.activeEventId);
    const retriedDelete = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).deleteConnection(deleteCommand, first.connection!.id, updated.connection!.activeEventId);
    assert.equal(retriedDelete.receipt.id, deleted.receipt.id);
    assert.equal(connectionEvents(root).length, 3, "restart Retry appended a duplicate delete");
  });
});

test("event-only crash window replays one authoritative command and synthesizes its receipt", async () => {
  await withLibrary(async (root, engine) => {
    const command = intent("connection:create", "event-only-crash-window");
    const input = {
      kind: "series" as const,
      label: "event survived response loss",
      observation: "",
      anchors: [anchor(1), anchor(2)],
    };
    await assert.rejects(
      new UserMutationBroker(engine, new EventOnlyThenFailStore(root))
        .createConnection(command, input),
      /response disappeared after append/,
    );
    const afterLoss = connectionEvents(root);
    assert.equal(afterLoss.length, 1);

    const historyBeforeRetry = await new SnapshotRevisionStore(root).history();
    assert.ok(historyBeforeRetry.some((receipt) => (
      receipt.id === revisionReceiptId(command.commandId)
      && receipt.entityId === afterLoss[0]?.entityId
    )), "authoritative event did not synthesize restart-safe history");

    const retried = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).createConnection(command, input);
    assert.equal(retried.connection?.id, afterLoss[0]?.entityId);
    assert.equal(retried.receipt.id, revisionReceiptId(command.commandId));
    assert.equal(connectionEvents(root).length, 1, "crash-window Retry appended a duplicate event");
  });
});

test("startup projection signature exposes an event fsynced before Derived projection", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    engine.buildSqlite();
    assert.equal(engine.isConnectionProjectionCurrent(), true);
    await assert.rejects(
      new UserMutationBroker(engine, new EventOnlyThenFailStore(root)).createConnection(
        intent("connection:create", "startup-reconcile-command"),
        connectionInput("mirror", "startup reconciliation", [anchor(1), anchor(4)]),
      ),
      /response disappeared after append/,
    );

    const restarted = libraryEngine(root);
    assert.equal(restarted.isConnectionProjectionCurrent(), false);
    restarted.buildSqlite();
    assert.equal(restarted.isConnectionProjectionCurrent(), true);
    const event = connectionEvents(root)[0]!;
    assert.equal(restarted.queryConnectionById(event.entityId!)?.label, "startup reconciliation");
  });
});

test("two provisional planners return and project only the one authoritative same-command event", async () => {
  await withLibrary(async (root, firstEngine) => {
    const secondEngine = libraryEngine(root);
    const barrier = new TwoPartyBarrier();
    const command = intent("connection:create", "two-planner-same-command");
    const input = {
      kind: "link:parallel" as const,
      label: "one authoritative winner",
      observation: "",
      anchors: [anchor(1), anchor(3)],
    };
    const results = await Promise.all([
      new UserMutationBroker(
        firstEngine,
        new CoordinatedSnapshotStore(root, barrier),
      ).createConnection(command, input),
      new UserMutationBroker(
        secondEngine,
        new CoordinatedSnapshotStore(root, barrier),
      ).createConnection(command, input),
    ]);

    const events = connectionEvents(root);
    assert.equal(events.length, 1);
    assert.equal(results[0]?.connection?.id, events[0]?.entityId);
    assert.equal(results[1]?.connection?.id, events[0]?.entityId);
    if (sqliteSkip === false) {
      const verifier = libraryEngine(root);
      if (!verifier.isConnectionProjectionCurrent()) verifier.buildSqlite();
      assert.deepEqual(
        verifier.getAllConnections().map((connection) => connection.id),
        [events[0]?.entityId],
        "a losing provisional connection leaked into Derived state",
      );
    }
  });
});

test("a replay parses intervening external events instead of blessing a stale hot-cache size", async () => {
  await withLibrary(async (root, firstEngine) => {
    const firstCommand = intent("connection:create", "cache-first-command");
    const firstInput = {
      kind: "series" as const,
      label: "first cached event",
      observation: "",
      anchors: [anchor(1), anchor(2)],
    };
    await new UserMutationBroker(firstEngine, new SnapshotRevisionStore(root))
      .createConnection(firstCommand, firstInput);
    const firstEvent = connectionEvents(root)[0]!;
    const provisionalReplay = firstEngine.planConnectionCreate(firstInput, {
      commandId: firstCommand.commandId,
      commandFingerprint: firstEvent.commandFingerprint!,
    });

    await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).createConnection(
      intent("connection:create", "cache-intervening-command"),
      connectionInput("series", "intervening event", [anchor(3), anchor(4)]),
    );

    const store = new SnapshotRevisionStore(root);
    const receipt = await store.commitAppend(
      await store.beginTransaction("Replay first command"),
      provisionalReplay.append,
    );
    firstEngine.resolveCommittedConnectionMutation(provisionalReplay, receipt);
    assert.equal(firstEngine.readAllEvents().connections.length, 2);
    assert.equal(firstEngine.readAllEvents().connections.length, 2, "stale cache signature was blessed twice");
  });
});

test("same-process stale siblings refuse instead of overwriting the first update", async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const created = (await broker.createConnection(
      intent("connection:create", "causal-create"),
      connectionInput("series", "created", [anchor(1), anchor(2)]),
    )).connection!;

    const settled = await Promise.allSettled([
      broker.updateConnection(
        intent("connection:update", "causal-update-a"),
        created.id,
        connectionInput("series", "updated a", [anchor(1), anchor(2), anchor(3)]),
        created.activeEventId,
      ),
      broker.updateConnection(
        intent("connection:update", "causal-update-b"),
        created.id,
        connectionInput("series", "updated b", [anchor(1), anchor(2), anchor(4)]),
        created.activeEventId,
      ),
    ]);

    const events = connectionEvents(root);
    assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(settled.filter((result) => result.status === "rejected").length, 1);
    const rejected = settled.find((result): result is PromiseRejectedResult => result.status === "rejected");
    assert.match(String(rejected?.reason), /changed elsewhere/);
    assert.equal(events.length, 2);
    assert.equal(events[1]?.baseEventId, events[0]?.eventId);
    assert.ok(events.every((event) => event.actor?.kind === "user"));
  });
});

test("two engines refuse stale full-record updates and deletes while exact-command Retry remains idempotent", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, firstEngine) => {
    firstEngine.buildSqlite();
    const firstBroker = new UserMutationBroker(firstEngine, new SnapshotRevisionStore(root));
    const created = (await firstBroker.createConnection(
      intent("connection:create", "optimistic-create"),
      connectionInput("series", "original label", [anchor(1), anchor(2)]),
    )).connection!;

    const externalCommand = intent("connection:update", "optimistic-external-label");
    const externalInput = {
      kind: "series" as const,
      label: "external label survives",
      observation: "external observation survives",
      anchors: [anchor(1), anchor(2)],
    };
    const external = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).updateConnection(
      externalCommand,
      created.id,
      externalInput,
      created.activeEventId,
    );

    await assert.rejects(
      firstBroker.updateConnection(
        intent("connection:update", "optimistic-stale-anchor"),
        created.id,
        {
          kind: created.kind,
          label: created.label,
          observation: created.format_version === 2 ? created.observation : "",
          anchors: [anchor(1), anchor(2), anchor(3)],
        },
        created.activeEventId,
      ),
      /changed elsewhere/,
    );
    await assert.rejects(
      firstBroker.deleteConnection(
        intent("connection:delete", "optimistic-stale-delete"),
        created.id,
        created.activeEventId,
      ),
      /changed elsewhere/,
    );
    assert.equal(connectionEvents(root).length, 2, "stale commands appended authored events");

    const exactRetry = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).updateConnection(
      externalCommand,
      created.id,
      externalInput,
      created.activeEventId,
    );
    assert.equal(exactRetry.receipt.id, external.receipt.id);
    assert.equal(exactRetry.connection?.activeEventId, external.connection?.activeEventId);
    assert.equal(connectionEvents(root).length, 2, "exact Retry appended a duplicate update");
    await assert.rejects(
      new UserMutationBroker(
        libraryEngine(root),
        new SnapshotRevisionStore(root),
      ).updateConnection(
        externalCommand,
        created.id,
        externalInput,
        external.connection!.activeEventId,
      ),
      /reused for different content/,
      "expectedBaseEventId was omitted from the durable command fingerprint",
    );

    const authoritative = libraryEngine(root);
    authoritative.buildSqlite();
    assert.equal(authoritative.queryConnectionById(created.id)?.label, "external label survives");
    assert.deepEqual(
      authoritative.queryConnectionById(created.id)?.anchors,
      [anchor(1), anchor(2)],
      "stale anchor payload overwrote externally updated content",
    );
  });
});

test("historical exact retries return the current tombstone instead of resurrecting cached records", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    engine.buildSqlite();
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const createCommand = intent("connection:create", "tombstone-replay-create");
    const createInput = {
      kind: "series" as const,
      label: "eventually removed",
      observation: "",
      anchors: [anchor(1), anchor(2)],
    };
    const created = (await broker.createConnection(createCommand, createInput)).connection!;
    const updateCommand = intent("connection:update", "tombstone-replay-update");
    const updateInput = { ...createInput, label: "updated before removal" };
    const updated = (await broker.updateConnection(
      updateCommand,
      created.id,
      updateInput,
      created.activeEventId,
    )).connection!;
    await broker.deleteConnection(
      intent("connection:delete", "tombstone-replay-delete"),
      created.id,
      updated.activeEventId,
    );

    const cachedCreateRetry = await broker.createConnection(createCommand, createInput);
    const durableUpdateRetry = await new UserMutationBroker(
      libraryEngine(root),
      new SnapshotRevisionStore(root),
    ).updateConnection(
      updateCommand,
      created.id,
      updateInput,
      created.activeEventId,
    );
    assert.equal(cachedCreateRetry.connection, undefined);
    assert.equal(durableUpdateRetry.connection, undefined);
    assert.equal(connectionEvents(root).length, 3, "historical Retry appended or resurrected an event");
    assert.equal(engine.queryConnectionById(created.id), undefined);
  });
});

test("a projection failure keeps one authored event and performs one bounded rebuild", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    engine.buildSqlite();
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const committed = await broker.createConnection(
      intent("connection:create", "projection-recovery"),
      connectionInput("hinge", "recover projection", [anchor(1), anchor(4)]),
    );

    assert.equal(committed.projection, "rebuilt");
    assert.match(committed.projectionError ?? "", /injected projection failure/);
    assert.equal(connectionEvents(root).length, 1);
    assert.deepEqual(engine.queryConnectionById(committed.connection!.id), committed.connection);
  }, (root) => new ProjectionFailOnceEngine(root, backbone, bookNames, tokenCatalog));
});

test("a missing Derived database is rebuilt before a committed connection is reported current", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    const committed = await new UserMutationBroker(
      engine,
      new SnapshotRevisionStore(root),
    ).createConnection(
      intent("connection:create", "missing-derived-rebuild"),
      connectionInput("mirror", "rebuild missing index", [anchor(1), anchor(5)]),
    );

    assert.equal(committed.projection, "rebuilt");
    assert.match(committed.projectionError ?? "", /index is missing/);
    assert.deepEqual(engine.queryConnectionById(committed.connection!.id), committed.connection);
  });
});

test("same-command Retry reruns a previously pending Derived recovery", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const command = intent("connection:create", "pending-recovery-retry");
    const input = connectionInput("hinge", "retry projection", [anchor(1), anchor(5)]);
    const first = await broker.createConnection(command, input);
    assert.equal(first.projection, "pending");
    const retried = await broker.createConnection(command, input);
    assert.equal(retried.projection, "rebuilt");
    assert.equal(connectionEvents(root).length, 1);
    assert.deepEqual(engine.queryConnectionById(retried.connection!.id), retried.connection);
    assert.equal((engine as ProjectionAndRebuildFailOnceEngine).rebuildAttempts, 2);
  }, (root) => new ProjectionAndRebuildFailOnceEngine(root, backbone, bookNames, tokenCatalog));
});

test("an append during the bounded rebuild is reported pending until an explicit Retry catches up", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const command = intent("connection:create", "append-during-rebuild");
    const input = {
      kind: "hinge" as const,
      label: "rebuild snapshot",
      observation: "",
      anchors: [anchor(1), anchor(4)],
    };

    const first = await broker.createConnection(command, input);
    assert.equal(first.projection, "pending");
    assert.match(first.projectionError ?? "", /Substrate changed during the bounded Derived rebuild/);
    assert.equal(engine.isConnectionProjectionCurrent(), false);
    assert.equal(connectionEvents(root).length, 2, "the concurrent append was not preserved");

    const retried = await broker.createConnection(command, input);
    assert.equal(retried.projection, "rebuilt");
    assert.equal(engine.isConnectionProjectionCurrent(), true);
    assert.deepEqual(
      engine.getAllConnections().map((connection) => connection.label).sort(),
      ["concurrent rebuild append", "rebuild snapshot"],
    );
    assert.equal(connectionEvents(root).length, 2, "Retry duplicated an authored event");
  }, (root) => new AppendDuringFirstRebuildEngine(root, backbone, bookNames, tokenCatalog));
});

test("a physically last sibling branch cannot replace the deterministic folded winner incrementally", { skip: sqliteSkip }, async () => {
  await withLibrary(async (root, engine) => {
    engine.buildSqlite();
    const created = (await new UserMutationBroker(
      engine,
      new SnapshotRevisionStore(root),
    ).createConnection(
      intent("connection:create", "branch-base-create"),
      connectionInput("series", "branch base", [anchor(1), anchor(2)]),
    )).connection!;

    const winnerEngine = libraryEngine(root);
    const loserEngine = libraryEngine(root);
    (winnerEngine as unknown as { deviceId: string }).deviceId = "zz-folded-winner";
    (loserEngine as unknown as { deviceId: string }).deviceId = "aa-physical-loser";

    // Both siblings are planned from the same causal base. The deterministic
    // tie-break orders aa before zz, so the first physical append remains the
    // folded winner even after the aa sibling lands last in the file.
    const winner = winnerEngine.planConnectionUpdate(
      created.id,
      connectionInput("series", "folded winner", [anchor(1), anchor(3)]),
      { commandId: "branch-folded-winner", commandFingerprint: "a".repeat(64) },
      created.activeEventId,
    );
    const loser = loserEngine.planConnectionUpdate(
      created.id,
      connectionInput("series", "physical loser", [anchor(1), anchor(4)]),
      { commandId: "branch-physical-loser", commandFingerprint: "b".repeat(64) },
      created.activeEventId,
    );
    assert.equal(loser.event.baseEventId, winner.event.baseEventId);

    appendRevisionJsonl(root, winner.append);
    winnerEngine.projectCommittedConnectionMutation(winner);
    assert.equal(winnerEngine.queryConnectionById(created.id)?.label, "folded winner");

    appendRevisionJsonl(root, {
      ...loser.append,
      expectedByteLength: statSync(join(root, "annotations/connections.jsonl")).size,
    });
    assert.throws(
      () => loserEngine.projectCommittedConnectionMutation(loser),
      /not the folded active state/,
    );

    loserEngine.buildSqlite();
    assert.equal(loserEngine.isConnectionProjectionCurrent(), true);
    assert.equal(loserEngine.queryConnectionById(created.id)?.label, "folded winner");
  });
});

test("connection payload bytes are bounded before hashing or queue retention", async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const base = connectionInput("series", "bounded", [anchor(1), anchor(2)]);
    await assert.rejects(
      broker.createConnection(intent("connection:create", "oversized-label"), {
        ...base,
        label: "x".repeat(513),
      }),
      /no longer than 512/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "huge-whitespace-label"), {
        ...base,
        label: " ".repeat(2 * 1_024 * 1_024),
      }),
      /no longer than 512/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "oversized-anchor-count"), {
        ...base,
        anchors: Array.from({ length: 65 }, () => anchor(1)),
      }),
      /2 to 64 anchors/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "legacy-render-locator"), {
        ...base,
        anchors: [
          {
            ...anchor(1),
            render_locator: { package: "bsb", char_start: 0, char_end: 1, quote: "B" },
          },
          anchor(2),
        ],
      } as CreateConnectionInput),
      /only its passage and exact selector/,
    );
    for (const [field, fieldValue] of [
      ["package", "bsb"],
      ["quote", "Blessed"],
      ["char_start", 0],
      ["char_end", 7],
    ] as const) {
      await assert.rejects(
        broker.createConnection(
          intent("connection:create", `forbidden-exact-${field.replace("_", "-")}`),
          {
            ...base,
            anchors: [
              {
                ...anchor(1),
                exact: {
                  ...anchor(1).exact,
                  [field]: fieldValue,
                },
              },
              anchor(2),
            ],
          } as CreateConnectionInput,
        ),
        /exact selector must contain only format_version, layer, and occurrences/,
      );
    }
    await assert.rejects(
      broker.createConnection(
        intent("connection:create", "missing-v2-observation"),
        {
          kind: base.kind,
          label: base.label,
          anchors: base.anchors,
        } as CreateConnectionInput,
      ),
      /observation must be no longer than 32768/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "oversized-occurrence-count"), {
        ...base,
        anchors: [
          {
            ...anchor(1),
            exact: {
              ...anchor(1).exact,
              occurrences: Array.from({ length: 2_049 }, (_, index) => ({
                verse: 1,
                position: index + 1,
              })),
            },
          },
          anchor(2),
        ],
      }),
      /1 to 2048 occurrences/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "aggregate-anchor-occurrences"), {
        ...base,
        anchors: Array.from({ length: 64 }, (_, anchorIndex) => ({
          book: "PSA" as const,
          chapter: 1,
          verse_start: 1,
          verse_end: 1,
          exact: {
            format_version: 1 as const,
            layer: BACKBONE_TOKEN_LAYER,
            occurrences: Array.from({ length: 2_048 }, (_, occurrenceIndex) => ({
              verse: 1,
              position: anchorIndex * 2_048 + occurrenceIndex + 1,
            })),
          },
        })),
      }),
      /serialized input exceeds 393216 bytes/,
    );
    await assert.rejects(
      broker.createConnection(intent("connection:create", "oversized-observation"), {
        ...base,
        observation: "x".repeat(32 * 1_024 + 1),
      }),
      /observation must be no longer than 32768/,
    );
    const state = broker as unknown as {
      commands: Map<string, unknown>;
      pendingCommandCount: number;
    };
    assert.equal(state.commands.size, 0, "rejected payload entered the command cache");
    assert.equal(state.pendingCommandCount, 0, "rejected payload entered the pending queue");
    assert.equal(connectionEvents(root).length, 0);
  });
});

test("settled command retries are byte-budgeted without weakening durable idempotency", async () => {
  await withLibrary(async (root, engine) => {
    const broker = new UserMutationBroker(engine, new SnapshotRevisionStore(root));
    const largeInput = {
      kind: "series" as const,
      label: "large retained command",
      observation: "o".repeat(32 * 1_024),
      anchors: Array.from({ length: 64 }, (_, index) => anchor(index % 6 + 1)),
    };

    for (let index = 0; index < 72; index++) {
      await broker.createConnection(
        intent("connection:create", `weighted-cache-${String(index).padStart(3, "0")}`),
        largeInput,
      );
    }

    const state = broker as unknown as {
      commands: Map<string, unknown>;
      settledCommandBytes: number;
    };
    assert.ok(state.settledCommandBytes <= 2 * 1_024 * 1_024);
    assert.equal(state.commands.has("weighted-cache-000"), false, "oldest large result was not pruned");

    await broker.createConnection(
      intent("connection:create", "weighted-cache-000"),
      largeInput,
    );
    assert.equal(connectionEvents(root).length, 72, "an evicted cache Retry appended a duplicate event");
    assert.ok(state.settledCommandBytes <= 2 * 1_024 * 1_024);
  }, (root) => new ProjectionCurrentEngine(root, backbone, bookNames, tokenCatalog));
});

test("semantic v2 refusals never consume cache capacity behind a blocked append", async () => {
  await withLibrary(async (root, engine) => {
    const store = new BlockingAppendStore(root);
    const broker = new UserMutationBroker(engine, store);
    const admitted = broker.createConnection(
      intent("connection:create", "semantic-lane-admitted"),
      connectionInput("series", "admitted", [anchor(1), anchor(2)]),
    );
    const base = connectionInput("series", "refused", [anchor(1), anchor(2)]);
    const invalidInputs: Array<[string, CreateConnectionInput, RegExp]> = [
      [
        "unknown-kind",
        { ...base, kind: "future-kind" as CreateConnectionInput["kind"] },
        /kind .* unsupported/,
      ],
      [
        "binary-count",
        { ...base, kind: "mirror", anchors: [anchor(1), anchor(2), anchor(3)] },
        /requires exactly two anchors/,
      ],
      [
        "exact-version",
        {
          ...base,
          anchors: [
            {
              ...anchor(1),
              exact: {
                ...anchor(1).exact,
                format_version: 2 as 1,
              },
            },
            anchor(2),
          ],
        },
        /format_version is unsupported/,
      ],
      [
        "exact-layer",
        {
          ...base,
          anchors: [
            {
              ...anchor(1),
              exact: {
                ...anchor(1).exact,
                layer: "backbone-token:future" as typeof BACKBONE_TOKEN_LAYER,
              },
            },
            anchor(2),
          ],
        },
        /token layer is unsupported/,
      ],
      [
        "duplicate-occurrence",
        {
          ...base,
          anchors: [
            {
              ...anchor(1),
              exact: {
                ...anchor(1).exact,
                occurrences: [
                  { verse: 1, position: 1 },
                  { verse: 1, position: 1 },
                ],
              },
            },
            anchor(2),
          ],
        },
        /unique and strictly ordered/,
      ],
      [
        "unordered-occurrence",
        {
          ...base,
          anchors: [
            {
              ...anchor(1),
              exact: {
                ...anchor(1).exact,
                occurrences: [
                  { verse: 1, position: 2 },
                  { verse: 1, position: 1 },
                ],
              },
            },
            anchor(2),
          ],
        },
        /unique and strictly ordered/,
      ],
      [
        "outside-passage",
        {
          ...base,
          anchors: [
            {
              ...anchor(1),
              exact: {
                ...anchor(1).exact,
                occurrences: [{ verse: 2, position: 1 }],
              },
            },
            anchor(2),
          ],
        },
        /outside its passage/,
      ],
    ];

    for (const [suffix, invalidInput, expected] of invalidInputs) {
      await assert.rejects(
        broker.createConnection(
          intent("connection:create", `semantic-refusal-${suffix}`),
          invalidInput,
        ),
        expected,
      );
    }

    const state = broker as unknown as {
      commands: Map<string, unknown>;
      pendingCommandCount: number;
    };
    assert.equal(state.pendingCommandCount, 1);
    assert.deepEqual([...state.commands.keys()], ["semantic-lane-admitted"]);
    assert.equal(connectionEvents(root).length, 0, "blocked append unexpectedly landed");

    store.release();
    await admitted;
    assert.equal(connectionEvents(root).length, 1);
  });
});

test("a stalled append applies bounded backpressure instead of retaining an unbounded queue", async () => {
  await withLibrary(async (root, engine) => {
    const store = new BlockingAppendStore(root);
    const broker = new UserMutationBroker(engine, store);
    const pending = Array.from({ length: 64 }, (_, index) => broker.createConnection(
      intent("connection:create", `backpressure-${String(index).padStart(3, "0")}`),
      connectionInput("series", `queued ${index}`, [anchor(1), anchor(2)]),
    ));
    await assert.rejects(
      broker.createConnection(
        intent("connection:create", "backpressure-overflow"),
        connectionInput("series", "overflow", [anchor(1), anchor(2)]),
      ),
      /Too many authored changes/,
    );
    store.release();
    await Promise.all(pending);
    await broker.createConnection(
      intent("connection:create", "backpressure-after-drain"),
      connectionInput("series", "after drain", [anchor(1), anchor(2)]),
    );
    assert.equal(connectionEvents(root).length, 65, "drained queue did not reclaim capacity");
  });
});

class BeginFailingStore implements RevisionStore {
  async beginTransaction(_label: string): Promise<RevisionTxn> {
    throw new Error("injected begin failure");
  }

  async commit(_txn: RevisionTxn): Promise<RevisionReceipt> {
    throw new Error("unexpected commit");
  }

  async commitAppend(_txn: RevisionTxn, _append: RevisionAppend): Promise<RevisionAppendReceipt> {
    throw new Error("unexpected append");
  }

  async history(_entityId?: string): Promise<RevisionReceipt[]> {
    return [];
  }

  async restore(_receiptId: string): Promise<void> {}
}

class AppendFailingStore implements RevisionStore {
  async beginTransaction(label: string): Promise<RevisionTxn> {
    return { id: "append-failing-transaction", label, files: [] };
  }

  async commit(_txn: RevisionTxn): Promise<RevisionReceipt> {
    throw new Error("unexpected commit");
  }

  async commitAppend(_txn: RevisionTxn, _append: RevisionAppend): Promise<RevisionAppendReceipt> {
    throw new Error("injected append failure");
  }

  async history(_entityId?: string): Promise<RevisionReceipt[]> {
    return [];
  }

  async restore(_receiptId: string): Promise<void> {}
}

class BlockingAppendStore implements RevisionStore {
  private delegate: SnapshotRevisionStore;
  private releaseGate: (() => void) | null = null;
  private gate = new Promise<void>((resolveGate) => {
    this.releaseGate = resolveGate;
  });

  constructor(root: string) {
    this.delegate = new SnapshotRevisionStore(root);
  }

  release(): void {
    this.releaseGate?.();
    this.releaseGate = null;
  }

  async beginTransaction(label: string): Promise<RevisionTxn> {
    return this.delegate.beginTransaction(label);
  }

  async commit(_txn: RevisionTxn): Promise<RevisionReceipt> {
    throw new Error("unexpected commit");
  }

  async commitAppend(txn: RevisionTxn, append: RevisionAppend): Promise<RevisionAppendReceipt> {
    await this.gate;
    return this.delegate.commitAppend(txn, append);
  }

  async history(_entityId?: string): Promise<RevisionReceipt[]> {
    return [];
  }

  async restore(_receiptId: string): Promise<void> {}
}

class EventOnlyThenFailStore implements RevisionStore {
  constructor(private readonly root: string) {}

  async beginTransaction(label: string): Promise<RevisionTxn> {
    return { id: `event-only-${label}`, label, files: [] };
  }

  async commit(_txn: RevisionTxn): Promise<RevisionReceipt> {
    throw new Error("unexpected commit");
  }

  async commitAppend(_txn: RevisionTxn, append: RevisionAppend): Promise<RevisionAppendReceipt> {
    appendRevisionJsonl(this.root, append);
    throw new Error("response disappeared after append");
  }

  async history(_entityId?: string): Promise<RevisionReceipt[]> {
    return [];
  }

  async restore(_receiptId: string): Promise<void> {}
}

class TwoPartyBarrier {
  private arrivals = 0;
  private releaseBarrier: (() => void) | null = null;
  private barrier = new Promise<void>((resolveBarrier) => {
    this.releaseBarrier = resolveBarrier;
  });

  async arrive(): Promise<void> {
    this.arrivals++;
    if (this.arrivals === 2) this.releaseBarrier?.();
    await this.barrier;
  }
}

class CoordinatedSnapshotStore implements RevisionStore {
  private delegate: SnapshotRevisionStore;

  constructor(root: string, private readonly barrier: TwoPartyBarrier) {
    this.delegate = new SnapshotRevisionStore(root);
  }

  async beginTransaction(label: string): Promise<RevisionTxn> {
    const txn = await this.delegate.beginTransaction(label);
    await this.barrier.arrive();
    return txn;
  }

  commit(txn: RevisionTxn): Promise<RevisionReceipt> {
    return this.delegate.commit(txn);
  }

  commitAppend(txn: RevisionTxn, append: RevisionAppend): Promise<RevisionAppendReceipt> {
    return this.delegate.commitAppend(txn, append);
  }

  history(entityId?: string): Promise<RevisionReceipt[]> {
    return this.delegate.history(entityId);
  }

  restore(receiptId: string): Promise<void> {
    return this.delegate.restore(receiptId);
  }
}

class ProjectionCurrentEngine extends LibraryEngine {
  override projectCommittedConnectionMutation(_plan: PlannedConnectionMutation): void {
    // This focused broker-cache test does not need a disposable SQLite view.
  }
}

class ProjectionFailOnceEngine extends LibraryEngine {
  private failProjection = true;

  override projectCommittedConnectionMutation(plan: PlannedConnectionMutation): void {
    if (this.failProjection) {
      this.failProjection = false;
      throw new Error("injected projection failure");
    }
    super.projectCommittedConnectionMutation(plan);
  }
}

class ProjectionAndRebuildFailOnceEngine extends LibraryEngine {
  rebuildAttempts = 0;

  override projectCommittedConnectionMutation(_plan: PlannedConnectionMutation): void {
    throw new Error("injected persistent incremental projection failure");
  }

  override buildSqlite(): string {
    this.rebuildAttempts++;
    if (this.rebuildAttempts === 1) throw new Error("injected first rebuild failure");
    return super.buildSqlite();
  }
}

class AppendDuringFirstRebuildEngine extends LibraryEngine {
  private injectedConcurrentAppend = false;

  override projectCommittedConnectionMutation(_plan: PlannedConnectionMutation): void {
    throw new Error("injected persistent incremental projection failure");
  }

  override buildSqlite(): string {
    const hash = super.buildSqlite();
    if (!this.injectedConcurrentAppend) {
      this.injectedConcurrentAppend = true;
      const external = libraryEngine(this.rootPath);
      const plan = external.planConnectionCreate(
        {
          kind: "mirror",
          label: "concurrent rebuild append",
          observation: "",
          anchors: [anchor(2), anchor(5)],
        },
        {
          commandId: "concurrent-rebuild-append",
          commandFingerprint: "c".repeat(64),
        },
      );
      appendRevisionJsonl(this.rootPath, plan.append);
    }
    return hash;
  }
}

type PersistedEvent = {
  eventId: string;
  entityId?: string;
  baseEventId?: string;
  commandId?: string;
  commandFingerprint?: string;
  actor?: { kind?: string };
};

function connectionEvents(root: string): PersistedEvent[] {
  return readFileSync(join(root, "annotations/connections.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as PersistedEvent);
}

function sqliteAvailable(): boolean {
  try {
    new Database(":memory:").close();
    return true;
  } catch {
    return false;
  }
}
