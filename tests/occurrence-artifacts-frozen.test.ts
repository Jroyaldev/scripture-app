import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  closeSync,
  createReadStream,
  openSync,
  readFileSync,
  readSync,
  statSync,
} from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "..");
const tokenPath = resolve(repositoryRoot, "data/scripture/backbone-token-v1.jsonl");
const tokenIndexPath = resolve(repositoryRoot, "data/scripture/backbone-token-v1.index.json");
const alignmentPath = resolve(
  repositoryRoot,
  "data/scripture/packages/bsb/occurrence-alignments-v1.jsonl",
);
const alignmentIndexPath = resolve(
  repositoryRoot,
  "data/scripture/packages/bsb/occurrence-alignments-v1.index.json",
);

const FROZEN = {
  source: "d9abdcb05493c5f40369b0bdba864c3635ad33a47d1222035c0b638814f077b8",
  token: "c912cfcb432749a5cf96e04d8b236ec958f3f38a7c5af52dc6be1ce01b9bfc0f",
  tokenIndex: "a4714af2c2842a485d0f76a91cab1c9ee30c7c713a39f336d8c472fabae111e9",
  alignment: "ec0962bad2b69a0fe9fbd9f3bb65f157ec9f4def38d1085ea041dbf390d2c0c8",
  alignmentIndex: "e548a0c0c28239db743f3e4a88fab528f6fd138b14ed6c0a5722064da31467b5",
} as const;

type ArtifactIndex = {
  type: "jsonl-byte-offset-index";
  format_version: 1;
  derived: true;
  rebuildable_from: "jsonl-artifact";
  artifact_type: string;
  layer: "backbone-token:v1";
  source_sha256: string;
  artifact_sha256: string;
  offset_unit: "utf8-byte";
  meta: [number, number];
  verses: Record<string, [number, number]>;
};

type TokenVerse = {
  ref: string;
  tokens: Array<{
    position: number;
    source_sort: number;
    surface: string;
  }>;
};

type AlignmentVerse = {
  ref: string;
  target_state: "present" | "absent";
  text_sha256?: string;
  text_utf16_length?: number;
  fragments: Array<[number, number, number[]] | [number, number, number[], number]>;
};

test("frozen occurrence artifacts retain their byte identity and bounded package size", async () => {
  const tokenIndexBytes = readFileSync(tokenIndexPath);
  const alignmentIndexBytes = readFileSync(alignmentIndexPath);
  const tokenIndex = JSON.parse(tokenIndexBytes.toString("utf8")) as ArtifactIndex;
  const alignmentIndex = JSON.parse(alignmentIndexBytes.toString("utf8")) as ArtifactIndex;

  assert.equal(await sha256File(tokenPath), FROZEN.token);
  assert.equal(sha256Bytes(tokenIndexBytes), FROZEN.tokenIndex);
  assert.equal(await sha256File(alignmentPath), FROZEN.alignment);
  assert.equal(sha256Bytes(alignmentIndexBytes), FROZEN.alignmentIndex);
  assert.equal(tokenIndex.artifact_sha256, FROZEN.token);
  assert.equal(alignmentIndex.artifact_sha256, FROZEN.alignment);
  assert.equal(tokenIndex.source_sha256, FROZEN.source);
  assert.equal(alignmentIndex.source_sha256, FROZEN.source);
  assert.equal(Object.keys(tokenIndex.verses).length, 31_102);
  assert.equal(Object.keys(alignmentIndex.verses).length, 31_102);
  assert.equal(tokenIndex.derived, true);
  assert.equal(alignmentIndex.rebuildable_from, "jsonl-artifact");
  assert.equal(alignmentIndex.offset_unit, "utf8-byte");

  // Keep the distributable artifact below hosts' ordinary 100 MB per-file cap.
  assert.ok(statSync(alignmentPath).size < 100_000_000);
});

test("frozen indexed rows preserve reordered Acts identity and honest package gaps", () => {
  const tokenIndex = readIndex(tokenIndexPath);
  const alignmentIndex = readIndex(alignmentIndexPath);
  const actsSevenTokens = readIndexed<TokenVerse>(
    tokenPath,
    tokenIndex,
    "bref:v1/ACT.19.7",
  );
  const actsSevenAlignment = readIndexed<AlignmentVerse>(
    alignmentPath,
    alignmentIndex,
    "bref:v1/ACT.19.7",
  );
  const actsEightAlignment = readIndexed<AlignmentVerse>(
    alignmentPath,
    alignmentIndex,
    "bref:v1/ACT.19.8",
  );
  const absent = readIndexed<AlignmentVerse>(
    alignmentPath,
    alignmentIndex,
    "bref:v1/MAT.17.21",
  );
  const habakkukTokens = readIndexed<TokenVerse>(
    tokenPath,
    tokenIndex,
    "bref:v1/HAB.3.19",
  );
  const habakkukAlignment = readIndexed<AlignmentVerse>(
    alignmentPath,
    alignmentIndex,
    "bref:v1/HAB.3.19",
  );

  assert.deepEqual(
    actsSevenTokens.tokens.map(({ position, surface }) => [position, surface]),
    [
      [1, "ἦσαν"],
      [2, "δὲ"],
      [3, "οἱ"],
      [4, "πάντες"],
      [5, "ἄνδρες"],
      [6, "ὡσεὶ"],
      [7, "δώδεκα"],
    ],
  );

  const actsSevenText = bsbVerseText("ACT", 19, 7);
  assert.deepEqual(
    alignedWords(actsSevenAlignment, actsSevenText)
      .filter(({ quote }) => ["men", "in", "all"].includes(quote)),
    [
      { quote: "men", positions: [5] },
      { quote: "in", positions: [4] },
      { quote: "all", positions: [4] },
    ],
  );
  const actsEightText = bsbVerseText("ACT", 19, 8);
  assert.deepEqual(
    alignedWords(actsEightAlignment, actsEightText)
      .filter(({ quote }) => quote === "of" || quote === "God"),
    [
      { quote: "of", positions: [18] },
      { quote: "God", positions: [18] },
    ],
  );

  assert.equal(absent.target_state, "absent");
  assert.deepEqual(absent.fragments, []);
  assert.equal("text_sha256" in absent, false);

  assert.equal(habakkukTokens.tokens.length, 11);
  const projectedHabakkukPositions = new Set(
    habakkukAlignment.fragments.flatMap((fragment) => fragment[2]),
  );
  assert.equal(projectedHabakkukPositions.has(10), false);
  assert.equal(projectedHabakkukPositions.has(11), false);
});

function readIndex(path: string): ArtifactIndex {
  return JSON.parse(readFileSync(path, "utf8")) as ArtifactIndex;
}

function readIndexed<T>(
  path: string,
  index: ArtifactIndex,
  ref: string,
): T {
  const range = index.verses[ref];
  assert.ok(range, `index contains ${ref}`);
  const [offset, length] = range;
  const buffer = Buffer.allocUnsafe(length);
  const fd = openSync(path, "r");
  try {
    assert.equal(readSync(fd, buffer, 0, length, offset), length);
  } finally {
    closeSync(fd);
  }
  return JSON.parse(buffer.toString("utf8")) as T;
}

function alignedWords(
  row: AlignmentVerse,
  text: string,
): Array<{ quote: string; positions: number[] }> {
  assert.equal(row.target_state, "present");
  assert.equal(row.text_utf16_length, text.length);
  return row.fragments
    .filter((fragment) => fragment[2].length > 0)
    .map((fragment) => ({
      quote: text.slice(fragment[0], fragment[1]),
      positions: fragment[2],
    }));
}

function bsbVerseText(book: string, chapter: number, verse: number): string {
  const path = resolve(repositoryRoot, `data/scripture/text/bsb/${book}/${chapter}.json`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    verses: Array<{ verse: number; text: string }>;
  };
  const record = parsed.verses.find((candidate) => candidate.verse === verse);
  assert.ok(record, `BSB contains ${book}.${chapter}.${verse}`);
  return record.text;
}

async function sha256File(path: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(path)) digest.update(chunk as Buffer);
  return digest.digest("hex");
}

function sha256Bytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
