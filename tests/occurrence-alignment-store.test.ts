import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  fstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  OccurrenceAlignmentStore,
  type OccurrenceAlignmentFileStat,
  type OccurrenceAlignmentStoreIo,
} from "../src/host/occurrence-alignment-store.ts";

const SOURCE_SHA = sha256("frozen bsb source");
const OTHER_SOURCE_SHA = sha256("other frozen bsb source");
const BACKBONE_SHA = sha256("frozen backbone");
const BSB_TEXT_SHA = sha256("frozen package tree");

interface JsonlIndexFixture {
  type: "jsonl-byte-offset-index";
  format_version: number;
  derived: true;
  rebuildable_from: "jsonl-artifact";
  artifact_type: string;
  layer: string;
  source_sha256: string;
  artifact_sha256: string;
  offset_unit: string;
  meta: [number, number];
  verses: Record<string, [number, number]>;
  unexpected?: boolean;
}

interface WrittenArtifact {
  path: string;
  indexPath: string;
  bytes: number;
  ranges: Record<string, [number, number]>;
  prefixCharacterLength: Record<string, number>;
}

interface FixtureOptions {
  tokenRows?: Record<string, Record<string, unknown>>;
  alignmentRows?: Record<string, Record<string, unknown>>;
  tokenSourceSha?: string;
  alignmentSourceSha?: string;
  mutateTokenIndex?: (index: JsonlIndexFixture) => void;
  mutateAlignmentIndex?: (index: JsonlIndexFixture) => void;
}

interface Fixture {
  root: string;
  token: WrittenArtifact;
  alignment: WrittenArtifact;
}

interface ReadOperation {
  path: string;
  position: number;
  requested: number;
  bytesRead: number;
}

class InstrumentedIo implements OccurrenceAlignmentStoreIo {
  readonly reads: ReadOperation[] = [];
  readonly closed: number[] = [];
  private readonly paths = new Map<number, string>();

  open(path: string): number {
    const fd = openSync(path, "r");
    this.paths.set(fd, path);
    return fd;
  }

  close(fd: number): void {
    closeSync(fd);
    this.closed.push(fd);
    this.paths.delete(fd);
  }

  read(
    fd: number,
    buffer: Buffer,
    offset: number,
    length: number,
    position: number,
  ): number {
    const bytesRead = readSync(fd, buffer, offset, length, position);
    this.reads.push({
      path: this.paths.get(fd) ?? "unknown",
      position,
      requested: length,
      bytesRead,
    });
    return bytesRead;
  }

  stat(path: string): OccurrenceAlignmentFileStat {
    return fileStat(statSync(path));
  }

  fstat(fd: number): OccurrenceAlignmentFileStat {
    return fileStat(fstatSync(fd));
  }
}

function tokenMeta(sourceSha = SOURCE_SHA): Record<string, unknown> {
  return {
    type: "backbone-token-meta",
    format_version: 1,
    layer: "backbone-token:v1",
    inventory_semantics: "frozen-edition-inclusive-bsb-table-source-slots",
    position_unit: "1-based-source-slot-within-verse",
    position_basis:
      "non-empty original-language rows sorted by Heb Sort for Hebrew/Aramaic or Greek Sort for Greek",
    cross_corpus_position_equivalence: "none",
    not_equivalent_to: ["MACULA", "OSHB"],
    surface_columns: {
      base: "WLC / Nestle Base TR RP WH NE NA SBL",
      edition_marked: "WLC / Nestle Base {TR} ⧼RP⧽ (WH) 〈NE〉 [NA] ‹SBL› [[ECM]]",
    },
    inputs: {
      bsb_tables_tsv: { basename: "bsb_tables.tsv", sha256: sourceSha },
      backbone: { version: "v1", sha256: BACKBONE_SHA },
    },
  };
}

function alignmentMeta(sourceSha = SOURCE_SHA): Record<string, unknown> {
  return {
    type: "occurrence-alignment-meta",
    format_version: 1,
    layer: "backbone-token:v1",
    package_id: "bsb",
    source_inventory_semantics: "frozen-edition-inclusive-bsb-table-source-slots",
    cross_corpus_position_equivalence: "none",
    target_offset_unit: "utf16-code-unit",
    target_fragment_unit: "whitespace-delimited-word-within-authored-bsb-row",
    fragment_tuple: {
      shape: "[char_start,char_end,occurrence_positions,optional_bsb_sort_group]",
      index_0: "inclusive UTF-16 char_start",
      index_1: "exclusive UTF-16 char_end",
      index_2: "sorted unique 1-based backbone-token:v1 occurrence positions; empty means uncovered",
      index_3: "optional BSB Sort row identity; present on authored display words and omitted on ungrouped gaps",
      quote_derivation: "SHA-bound package_text.slice(char_start,char_end); quote is not duplicated in this artifact",
    },
    fragment_group: "BSB Sort",
    gap_policy:
      "whitespace, punctuation, and display-only or otherwise uncovered text is retained with an empty occurrence list",
    absent_target_policy:
      "backbone verses absent from the BSB package emit target_state=absent with no text digest or fragments",
    detached_postscript_policy:
      "source slots remain canonical; table display beginning at an Hdg pshdg-only row absent from package text emits no target fragment",
    inputs: {
      bsb_tables_tsv: { basename: "bsb_tables.tsv", sha256: sourceSha },
      backbone: { version: "v1", sha256: BACKBONE_SHA },
      bsb_text: {
        sha256: BSB_TEXT_SHA,
        file_count: 1,
        digest_algorithm: "sha256(sorted relative-json-path + NUL + file-sha256 + LF)",
      },
    },
  };
}

function tokenRow(
  ref: string,
  token: { position: number; source_sort: number; surface: string } | null,
): Record<string, unknown> {
  return {
    type: "backbone-token-verse",
    format_version: 1,
    layer: "backbone-token:v1",
    ref,
    tokens: token === null
      ? []
      : [{ ...token, language: "Greek", strong: `G${token.position}` }],
  };
}

function presentAlignmentRow(
  ref: string,
  text: string,
  occurrencePosition: number,
): Record<string, unknown> {
  return {
    type: "occurrence-alignment-verse",
    format_version: 1,
    layer: "backbone-token:v1",
    package_id: "bsb",
    ref,
    target_state: "present",
    text_sha256: sha256(text),
    text_utf16_length: text.length,
    fragments: [[0, text.length, [occurrencePosition], 100 + occurrencePosition]],
  };
}

function absentAlignmentRow(ref: string): Record<string, unknown> {
  return {
    type: "occurrence-alignment-verse",
    format_version: 1,
    layer: "backbone-token:v1",
    package_id: "bsb",
    ref,
    target_state: "absent",
    fragments: [],
  };
}

function defaultTokenRows(): Record<string, Record<string, unknown>> {
  return {
    "bref:v1/ACT.19.7": tokenRow(
      "bref:v1/ACT.19.7",
      { position: 1, source_sort: 100.1, surface: "λόγος" },
    ),
    "bref:v1/ACT.19.8": tokenRow("bref:v1/ACT.19.8", null),
    "bref:v1/ACT.19.9": tokenRow(
      "bref:v1/ACT.19.9",
      { position: 1, source_sort: 101.5, surface: "ἄνθρωπος" },
    ),
  };
}

function defaultAlignmentRows(): Record<string, Record<string, unknown>> {
  return {
    "bref:v1/ACT.19.7": presentAlignmentRow("bref:v1/ACT.19.7", "café 🌿", 1),
    "bref:v1/ACT.19.8": absentAlignmentRow("bref:v1/ACT.19.8"),
    "bref:v1/ACT.19.9": presentAlignmentRow("bref:v1/ACT.19.9", "third", 1),
  };
}

function makeFixture(options: FixtureOptions = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), "occurrence-store-"));
  const tokenPath = join(root, "backbone-token-v1.jsonl");
  const alignmentPath = join(
    root,
    "packages",
    "bsb",
    "occurrence-alignments-v1.jsonl",
  );
  const tokenSourceSha = options.tokenSourceSha ?? SOURCE_SHA;
  const alignmentSourceSha = options.alignmentSourceSha ?? SOURCE_SHA;
  const token = writeArtifact(
    tokenPath,
    "backbone-token-v1",
    tokenSourceSha,
    tokenMeta(tokenSourceSha),
    options.tokenRows ?? defaultTokenRows(),
    options.mutateTokenIndex,
  );
  const alignment = writeArtifact(
    alignmentPath,
    "bsb-occurrence-alignments-v1",
    alignmentSourceSha,
    alignmentMeta(alignmentSourceSha),
    options.alignmentRows ?? defaultAlignmentRows(),
    options.mutateAlignmentIndex,
  );
  return { root, token, alignment };
}

function writeArtifact(
  path: string,
  artifactType: string,
  sourceSha: string,
  meta: Record<string, unknown>,
  rows: Record<string, Record<string, unknown>>,
  mutateIndex?: (index: JsonlIndexFixture) => void,
): WrittenArtifact {
  mkdirSync(dirname(path), { recursive: true });
  const records: Array<[string, Record<string, unknown>]> = [["meta", meta], ...Object.entries(rows)];
  const ranges: Record<string, [number, number]> = {};
  const prefixCharacterLength: Record<string, number> = {};
  const buffers: Buffer[] = [];
  let byteOffset = 0;
  let characterOffset = 0;
  let metaRange: [number, number] = [0, 0];
  for (const [ref, record] of records) {
    const json = JSON.stringify(record);
    const line = Buffer.from(json, "utf8");
    const range: [number, number] = [byteOffset, line.byteLength];
    if (ref === "meta") metaRange = range;
    else {
      ranges[ref] = range;
      prefixCharacterLength[ref] = characterOffset;
    }
    buffers.push(line, Buffer.from("\n", "utf8"));
    byteOffset += line.byteLength + 1;
    characterOffset += json.length + 1;
  }
  const artifact = Buffer.concat(buffers);
  writeFileSync(path, artifact);
  const index: JsonlIndexFixture = {
    type: "jsonl-byte-offset-index",
    format_version: 1,
    derived: true,
    rebuildable_from: "jsonl-artifact",
    artifact_type: artifactType,
    layer: "backbone-token:v1",
    source_sha256: sourceSha,
    artifact_sha256: sha256(artifact),
    offset_unit: "utf8-byte",
    meta: metaRange,
    verses: ranges,
  };
  mutateIndex?.(index);
  const indexPath = path.endsWith(".jsonl")
    ? `${path.slice(0, -".jsonl".length)}.index.json`
    : `${path}.index.json`;
  writeFileSync(indexPath, `${JSON.stringify(index)}\n`, "utf8");
  return { path, indexPath, bytes: artifact.byteLength, ranges, prefixCharacterLength };
}

function makeStore(
  fixture: Fixture,
  io = new InstrumentedIo(),
  overrides: Partial<ConstructorParameters<typeof OccurrenceAlignmentStore>[0]> = {},
): { store: OccurrenceAlignmentStore; io: InstrumentedIo } {
  return {
    store: new OccurrenceAlignmentStore({
      scriptureRoot: fixture.root,
      io,
      digestChunkBytes: 7,
      ...overrides,
    }),
    io,
  };
}

test("reads only indexed UTF-8 verse slices, accepts decimal source sort, and never whole-parses JSONL", () => {
  const fixture = makeFixture();
  try {
    const { store, io } = makeStore(fixture);
    const second = store.readTokenVerse("ACT", 19, 8);
    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.value.tokens.length, 0);

    const first = store.readTokenVerse("ACT", 19, 7);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.value.tokens[0]?.source_sort, 100.1);
    assert.equal(first.value.tokens[0]?.surface, "λόγος");

    const secondRange = fixture.token.ranges["bref:v1/ACT.19.8"];
    assert.ok(secondRange);
    assert.ok(
      secondRange[0]
        > (fixture.token.prefixCharacterLength["bref:v1/ACT.19.8"] ?? Number.MAX_SAFE_INTEGER),
      "non-ASCII prefix makes UTF-8 byte offset differ from JavaScript character offset",
    );
    assert.ok(
      io.reads.some((operation) =>
        operation.path === fixture.token.path
        && operation.position === secondRange[0]
        && operation.requested === secondRange[1],
      ),
      "second verse is read directly from its indexed byte range",
    );
    assert.equal(
      io.reads.some((operation) =>
        operation.path.endsWith(".jsonl")
        && operation.position === 0
        && operation.requested === fixture.token.bytes),
      false,
      "no operation requests the full token JSONL as one parse buffer",
    );
    assert.ok(
      io.reads
        .filter((operation) => operation.path === fixture.token.path && operation.position < fixture.token.bytes)
        .some((operation) => operation.requested === 7),
      "artifact digest is streamed in bounded chunks",
    );
    const readsBeforeCacheHit = io.reads.length;
    assert.equal(store.readTokenCount("ACT", 19, 7).ok, true);
    assert.equal(io.reads.length, readsBeforeCacheHit, "cached lookup does not rehash or reread the artifact");
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("returns present and absent package targets as distinct successful records and validates expected text", () => {
  const fixture = makeFixture();
  try {
    const { store } = makeStore(fixture);
    const present = store.readAlignmentVerse("ACT", 19, 7, "café 🌿");
    assert.equal(present.ok, true);
    if (present.ok) {
      assert.equal(present.value.target_state, "present");
      if (present.value.target_state === "present") {
        assert.equal(present.value.text_utf16_length, "café 🌿".length);
        assert.deepEqual(present.value.fragments[0], [0, "café 🌿".length, [1], 101]);
      }
    }

    const absent = store.readAlignmentVerse("ACT", 19, 8);
    assert.equal(absent.ok, true);
    if (absent.ok) {
      assert.equal(absent.value.target_state, "absent");
      assert.deepEqual(absent.value.fragments, []);
      assert.equal("text_sha256" in absent.value, false);
    }

    const stale = store.readAlignmentVerse("ACT", 19, 7, "changed");
    assert.equal(stale.ok, false);
    if (!stale.ok) assert.equal(stale.error.code, "target-text-mismatch");

    const falselyPresent = store.readAlignmentVerse("ACT", 19, 8, "now present");
    assert.equal(falselyPresent.ok, false);
    if (!falselyPresent.ok) assert.equal(falselyPresent.error.code, "target-text-mismatch");
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("uses deterministic entry-and-byte bounded LRU eviction", () => {
  const fixture = makeFixture();
  try {
    const { store, io } = makeStore(fixture, new InstrumentedIo(), {
      maxCacheEntries: 2,
      maxCacheBytes: 32 * 1024,
    });
    assert.equal(store.readTokenCount("ACT", 19, 7).ok, true);
    assert.equal(store.readTokenCount("ACT", 19, 8).ok, true);
    assert.equal(store.readTokenCount("ACT", 19, 9).ok, true);
    assert.deepEqual(
      { entries: store.cacheStats().entries, evictions: store.cacheStats().evictions },
      { entries: 2, evictions: 1 },
    );
    const sevenRange = fixture.token.ranges["bref:v1/ACT.19.7"];
    assert.ok(sevenRange);
    const readsBefore = io.reads.filter((operation) =>
      operation.path === fixture.token.path
      && operation.position === sevenRange[0]
      && operation.requested === sevenRange[1],
    ).length;
    assert.equal(store.readTokenCount("ACT", 19, 7).ok, true);
    const readsAfter = io.reads.filter((operation) =>
      operation.path === fixture.token.path
      && operation.position === sevenRange[0]
      && operation.requested === sevenRange[1],
    ).length;
    assert.equal(readsAfter, readsBefore + 1, "least-recent token row is re-read after eviction");
    assert.equal(store.cacheStats().entries, 2);
    assert.ok(store.cacheStats().bytes <= store.cacheStats().maxBytes);
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("the LRU also evicts deterministically at its byte bound", () => {
  const fixture = makeFixture();
  try {
    const sevenBytes = fixture.token.ranges["bref:v1/ACT.19.7"]?.[1] ?? 0;
    const eightBytes = fixture.token.ranges["bref:v1/ACT.19.8"]?.[1] ?? 0;
    const byteBound = Math.max(sevenBytes, eightBytes);
    const { store } = makeStore(fixture, new InstrumentedIo(), {
      maxCacheEntries: 20,
      maxCacheBytes: byteBound,
    });
    assert.equal(store.readTokenVerse("ACT", 19, 7).ok, true);
    assert.equal(store.readTokenVerse("ACT", 19, 8).ok, true);
    assert.equal(store.cacheStats().entries, 1);
    assert.equal(store.cacheStats().evictions, 1);
    assert.ok(store.cacheStats().bytes <= byteBound);
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("returns typed refusal for digest mismatch without parsing a row", () => {
  const fixture = makeFixture({
    mutateTokenIndex: (index) => {
      index.artifact_sha256 = "0".repeat(64);
    },
  });
  try {
    const { store } = makeStore(fixture);
    const result = store.readTokenVerse("ACT", 19, 7);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "artifact-digest-mismatch");
    assert.equal(store.tokenCount("ACT", 19, 7), undefined);
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses an out-of-bounds sidecar range before a verse read", () => {
  const fixture = makeFixture({
    mutateTokenIndex: (index) => {
      index.verses["bref:v1/ACT.19.7"] = [9_999_999, 20];
    },
  });
  try {
    const { store } = makeStore(fixture);
    const result = store.readTokenVerse("ACT", 19, 7);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-byte-range");
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses a byte slice that incorrectly includes its trailing newline", () => {
  const fixture = makeFixture({
    mutateTokenIndex: (index) => {
      const range = index.verses["bref:v1/ACT.19.7"]!;
      index.verses["bref:v1/ACT.19.7"] = [range[0], range[1] + 1];
    },
  });
  try {
    const { store } = makeStore(fixture);
    const result = store.readTokenVerse("ACT", 19, 7);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.error.code, "invalid-row-boundary");
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("refuses row reference, package, and newer format mismatches instead of guessing", async (t) => {
  await t.test("row ref does not match index key", () => {
    const fixture = makeFixture({
      mutateTokenIndex: (index) => {
        index.verses["bref:v1/ACT.19.8"] = index.verses["bref:v1/ACT.19.7"]!;
      },
    });
    try {
      const { store } = makeStore(fixture);
      const result = store.readTokenVerse("ACT", 19, 8);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "row-ref-mismatch");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("alignment package differs", () => {
    const rows = defaultAlignmentRows();
    rows["bref:v1/ACT.19.7"] = {
      ...rows["bref:v1/ACT.19.7"],
      package_id: "other",
    };
    const fixture = makeFixture({ alignmentRows: rows });
    try {
      const { store } = makeStore(fixture);
      const result = store.readAlignmentVerse("ACT", 19, 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "row-package-mismatch");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("newer row version is refused", () => {
    const rows = defaultTokenRows();
    rows["bref:v1/ACT.19.7"] = {
      ...rows["bref:v1/ACT.19.7"],
      format_version: 2,
    };
    const fixture = makeFixture({ tokenRows: rows });
    try {
      const { store } = makeStore(fixture);
      const result = store.readTokenVerse("ACT", 19, 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "unsupported-row-version");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("refuses mismatched cross-artifact provenance and a missing verse", () => {
  const fixture = makeFixture({ alignmentSourceSha: OTHER_SOURCE_SHA });
  try {
    const { store } = makeStore(fixture);
    const mismatch = store.readAlignmentVerse("ACT", 19, 7);
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) assert.equal(mismatch.error.code, "provenance-mismatch");

    const missing = store.readTokenVerse("ACT", 19, 10);
    assert.equal(missing.ok, false);
    if (!missing.ok) assert.equal(missing.error.code, "verse-missing");
    store.close();
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("missing and changed files produce stable typed refusals", async (t) => {
  await t.test("missing index", () => {
    const fixture = makeFixture();
    try {
      unlinkSync(fixture.token.indexPath);
      const { store } = makeStore(fixture);
      const result = store.readTokenVerse("ACT", 19, 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "index-missing");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("missing artifact", () => {
    const fixture = makeFixture();
    try {
      unlinkSync(fixture.token.path);
      const { store } = makeStore(fixture);
      const result = store.readTokenVerse("ACT", 19, 7);
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.error.code, "artifact-missing");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });

  await t.test("artifact changes after validation", () => {
    const fixture = makeFixture();
    try {
      const { store } = makeStore(fixture);
      assert.equal(store.readTokenVerse("ACT", 19, 7).ok, true);
      appendFileSync(fixture.token.path, " ", "utf8");
      const changed = store.readTokenVerse("ACT", 19, 7);
      assert.equal(changed.ok, false);
      if (!changed.ok) assert.equal(changed.error.code, "artifact-changed");
      store.close();
    } finally {
      rmSync(fixture.root, { recursive: true, force: true });
    }
  });
});

test("close and dispose are idempotent, release descriptors, and make later reads refuse", () => {
  const fixture = makeFixture();
  try {
    const { store, io } = makeStore(fixture);
    assert.equal(store.readAlignmentVerse("ACT", 19, 7).ok, true);
    store.close();
    const closedCount = io.closed.length;
    assert.ok(closedCount >= 4, "index descriptors and both persistent artifact descriptors close");
    store.dispose();
    assert.equal(io.closed.length, closedCount);
    const afterClose = store.readTokenVerse("ACT", 19, 7);
    assert.equal(afterClose.ok, false);
    if (!afterClose.ok) assert.equal(afterClose.error.code, "store-closed");
    assert.deepEqual(store.cacheStats().entries, 0);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

function fileStat(stat: {
  size: number;
  mtimeMs: number;
  ctimeMs: number;
  dev: number;
  ino: number;
}): OccurrenceAlignmentFileStat {
  return {
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
    dev: stat.dev,
    ino: stat.ino,
  };
}
