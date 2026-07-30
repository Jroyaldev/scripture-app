/**
 * Resume in the reference extractor, which is a question about money.
 *
 * Every episode sent to Codex costs a call, and the only thing standing
 * between a re-run and paying twice is what "already read" means. Until
 * 2026-07-30 it meant "appears in the output rows", which quietly excluded
 * every episode that was read and honestly found nothing — 313 of them across
 * eight sources, re-read on every pass forever. These tests hold the corrected
 * meaning: read is read, whatever the reading yielded.
 *
 * The integration cases run the real script against a fake `codex` on PATH, so
 * what is measured is the number of calls actually made rather than a
 * reimplementation of the decision to make them.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  READ_LOG_SCHEMA,
  emptyResume,
  parseReadLog,
  readLogPathFor,
  resumeFrom,
  serializeReadLog,
} from "../scripts/reference-read-log.js";

const repoRoot = resolve(import.meta.dirname, "..");

const row = (recordId: string): string => JSON.stringify({
  recordId, episode: recordId, bref: "bref:v1/GEN.1.1", book: "GEN", chapter: 1, verses: "1",
  at: 0, until: 30, seconds: 30, relation: "subject", named: true, confidence: "high",
  evidence: "in the beginning god created",
});

/* ------------------------------------------------------------------ */
/* The decision itself                                                 */
/* ------------------------------------------------------------------ */

test("an episode that yielded nothing is remembered as read", () => {
  const resume = resumeFrom({
    rows: `${row("src:podcast:fruitful")}\n`,
    log: serializeReadLog("src", "/x/refs.jsonl", ["src:podcast:fruitful", "src:podcast:barren"]),
  });

  assert.equal(resume.alreadyRead.has("src:podcast:barren"), true);
  assert.equal(resume.alreadyRead.has("src:podcast:fruitful"), true);
  assert.equal(resume.barren, 1, "the barren episode is known only from the ledger");
  assert.equal(resume.carried.length, 1);
});

test("an output written before the ledger existed still resumes on its rows", () => {
  const resume = resumeFrom({
    rows: `${row("src:podcast:a")}\n${row("src:podcast:a")}\n${row("src:podcast:b")}\n`,
    log: null,
  });

  assert.deepEqual([...resume.alreadyRead].sort(), ["src:podcast:a", "src:podcast:b"]);
  assert.equal(resume.barren, 0);
  assert.equal(resume.unreadableLog, false);
  assert.equal(resume.carried.length, 3, "every row is carried, not deduplicated");
});

test("the resume is the union, so neither file can shrink it", () => {
  const resume = resumeFrom({
    rows: `${row("src:podcast:only-in-rows")}\n`,
    log: serializeReadLog("src", "/x/refs.jsonl", ["src:podcast:only-in-log"]),
  });

  assert.deepEqual([...resume.alreadyRead].sort(), ["src:podcast:only-in-log", "src:podcast:only-in-rows"]);
});

test("a half-written ledger costs repeated calls, never the run", () => {
  const truncated = serializeReadLog("src", "/x/refs.jsonl", ["src:podcast:a"]).slice(0, 40);

  const resume = resumeFrom({ rows: `${row("src:podcast:b")}\n`, log: truncated });

  assert.equal(resume.unreadableLog, true);
  assert.deepEqual([...resume.alreadyRead], ["src:podcast:b"]);
});

test("a partial last row from a killed run is skipped, not fatal", () => {
  const resume = resumeFrom({ rows: `${row("src:podcast:a")}\n{"recordId":"src:pod`, log: null });

  assert.deepEqual([...resume.alreadyRead], ["src:podcast:a"]);
});

test("--restart forgets both files", () => {
  const resume = emptyResume();

  assert.equal(resume.alreadyRead.size, 0);
  assert.equal(resume.carried.length, 0);
  assert.equal(resume.barren, 0);
});

test("the ledger round-trips, sorted and deduplicated", () => {
  const text = serializeReadLog("src", "/x/codex-refs-src.jsonl", new Set(["c", "a", "b", "a"]));

  assert.deepEqual(parseReadLog(text), ["a", "b", "c"]);
  assert.equal((JSON.parse(text) as { schema: string }).schema, READ_LOG_SCHEMA);
  assert.equal((JSON.parse(text) as { out: string }).out, "codex-refs-src.jsonl");
});

test("anything that is not a ledger reads as null rather than as an empty ledger", () => {
  assert.equal(parseReadLog("not json"), null);
  assert.equal(parseReadLog("[]"), null);
  assert.equal(parseReadLog(JSON.stringify({ schema: "something/v1", episodes: ["a"] })), null);
  assert.equal(parseReadLog(JSON.stringify({ schema: READ_LOG_SCHEMA })), null);
  assert.deepEqual(parseReadLog(JSON.stringify({ schema: READ_LOG_SCHEMA, episodes: [] })), []);
});

/**
 * The install step is `cat codex-refs-*.jsonl > combined`, so a ledger named
 * `.jsonl` would be concatenated into the references and then refused row by
 * row. The extension is load-bearing.
 */
test("the ledger cannot be swept up by the glob that collects references", () => {
  const path = readLogPathFor("/Volumes/External/Transcripts/codex-refs-naked-bible.jsonl");

  assert.equal(path, "/Volumes/External/Transcripts/codex-refs-naked-bible.read-log.json");
  assert.equal(path.endsWith(".jsonl"), false);
  assert.equal(readLogPathFor("/tmp/refs"), "/tmp/refs.read-log.json");
});

/* ------------------------------------------------------------------ */
/* The script, with a fake reader                                      */
/* ------------------------------------------------------------------ */

const SOURCE = "test-source";
const FRUITFUL = `${SOURCE}:podcast:fruitful`;
const BARREN = `${SOURCE}:podcast:barren`;

interface Harness { home: string; out: string; calls: string; bin: string }

function harness(codexBody: string): Harness {
  const root = mkdtempSync(join(tmpdir(), "refs-resume-"));
  const transcripts = join(root, "ScriptureLibrary/.artifacts/transcripts");
  const resources = join(root, `ScriptureLibrary/.artifacts/resources/${SOURCE}`);
  mkdirSync(transcripts, { recursive: true });
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, "manifest.json"), JSON.stringify({
    source: { name: "Test Source" },
    records: [{ id: FRUITFUL, kind: "podcast", title: "Fruitful" }],
  }));

  const transcript = (name: string, text: string): void => {
    writeFileSync(join(transcripts, `${SOURCE}__podcast__${name}.json`), JSON.stringify({
      schema: "transcript/v1", generated: true, model: "test", id: `${SOURCE}:podcast:${name}`,
      words: [], segments: [{ t: text, s: 0, e: 30 }], audioSeconds: 300,
    }));
  };
  transcript("fruitful", "In the beginning God created the heavens and the earth.");
  transcript("barren", "Today we discuss the Icelandic Reformation and nothing else at all.");

  const bin = join(root, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "codex"), codexBody);
  chmodSync(join(bin, "codex"), 0o755);

  return { home: root, out: join(root, "codex-refs-test.jsonl"), calls: join(root, "calls.log"), bin };
}

/** Answers for a transcript that names creation, and honestly finds nothing otherwise. */
const READER = `#!/bin/sh
body=$(cat)
echo call >> "$CODEX_CALL_LOG"
case "$body" in
  *"In the beginning God created"*)
    echo '{"references":[{"book":"Genesis","chapter":1,"verses":"1","at":"0:00","until":"0:30","relation":"subject","named":true,"confidence":"high","evidence":"In the beginning God created"}]}' ;;
  *)
    echo '{"references":[]}' ;;
esac
`;

/** Never answers at all, which is not a reading and must be retried. */
const REFUSER = `#!/bin/sh
cat > /dev/null
echo call >> "$CODEX_CALL_LOG"
echo "boom" >&2
exit 1
`;

function runExtractor(h: Harness, extra: string[] = []): { stdout: string; status: number | null } {
  const result = spawnSync(process.execPath, [
    "--import", "tsx", "scripts/extract-refs-codex.ts",
    "--source", SOURCE, "--episodes", "10", "--concurrency", "2",
    "--out", h.out, ...extra,
  ], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      HOME: h.home,
      PATH: `${h.bin}:${process.env["PATH"] ?? ""}`,
      CODEX_CALL_LOG: h.calls,
    },
  });
  return { stdout: `${result.stdout}${result.stderr}`, status: result.status };
}

const callCount = (h: Harness): number =>
  (existsSync(h.calls) ? readFileSync(h.calls, "utf-8").trim().split("\n").filter(Boolean).length : 0);

const ledger = (h: Harness): string[] =>
  parseReadLog(readFileSync(readLogPathFor(h.out), "utf-8")) ?? [];

test("a barren episode is read once and never again", () => {
  const h = harness(READER);
  try {
    const first = runExtractor(h);
    assert.equal(first.status, 0, first.stdout);
    assert.equal(callCount(h), 2, "both episodes are read on the first pass");
    assert.deepEqual(ledger(h).sort(), [BARREN, FRUITFUL].sort());
    assert.equal(readFileSync(h.out, "utf-8").trim().split("\n").length, 1,
      "only the fruitful episode writes a reference row");

    const second = runExtractor(h);
    assert.equal(second.status, 0, second.stdout);
    assert.equal(callCount(h), 2, "the barren episode is not read again");
    assert.match(second.stdout, /2 episodes already read \(1 of them yielded nothing\)/);
  } finally {
    rmSync(h.home, { recursive: true, force: true });
  }
});

test("--dry-run reports what is left and spends nothing", () => {
  const h = harness(READER);
  try {
    const before = runExtractor(h, ["--dry-run"]);
    assert.equal(before.status, 0, before.stdout);
    assert.match(before.stdout, /test-source: 2 transcripts, 0 already read, 2 left to read/);
    assert.equal(callCount(h), 0);
    assert.equal(existsSync(readLogPathFor(h.out)), false, "a dry run writes nothing");

    runExtractor(h);
    const after = runExtractor(h, ["--dry-run"]);
    assert.match(after.stdout, /test-source: 2 transcripts, 2 already read, 0 left to read/);
    assert.equal(callCount(h), 2, "the dry runs added no calls");
  } finally {
    rmSync(h.home, { recursive: true, force: true });
  }
});

test("an episode that never answered is not marked read", () => {
  const h = harness(REFUSER);
  try {
    runExtractor(h);
    assert.equal(callCount(h), 2);
    assert.equal(existsSync(readLogPathFor(h.out)), false, "no answer, no ledger");

    runExtractor(h);
    assert.equal(callCount(h), 4, "a refusal is retried on the next pass");
  } finally {
    rmSync(h.home, { recursive: true, force: true });
  }
});

test("--only reads the episode named and no other", () => {
  const h = harness(READER);
  try {
    const run = runExtractor(h, ["--only", BARREN]);
    assert.equal(run.status, 0, run.stdout);
    assert.equal(callCount(h), 1);
    assert.deepEqual(ledger(h), [BARREN]);
    assert.equal(readFileSync(h.out, "utf-8").trim(), "", "it found nothing, so it wrote no reference row");

    const left = runExtractor(h, ["--dry-run"]);
    assert.match(left.stdout, /test-source: 2 transcripts, 1 already read, 1 left to read/);
  } finally {
    rmSync(h.home, { recursive: true, force: true });
  }
});

test("--restart reads the whole source again and rebuilds the ledger", () => {
  const h = harness(READER);
  try {
    runExtractor(h);
    assert.equal(callCount(h), 2);

    const again = runExtractor(h, ["--restart"]);
    assert.equal(again.status, 0, again.stdout);
    assert.equal(callCount(h), 4, "--restart forgets the ledger too");
    assert.deepEqual(ledger(h).sort(), [BARREN, FRUITFUL].sort());
    assert.equal(readFileSync(h.out, "utf-8").trim().split("\n").length, 1,
      "and does not double the rows it carried");
  } finally {
    rmSync(h.home, { recursive: true, force: true });
  }
});

/**
 * The only downstream reader of these files. A row it refuses is counted as a
 * refusal, which is a data-quality signal — so the resume ledger has to stay
 * out of the `.jsonl` entirely rather than ride along inside it.
 */
test("install-references knows nothing about the ledger, which is the point of keeping it beside", () => {
  const source = readFileSync(join(repoRoot, "scripts/install-references.ts"), "utf-8");

  assert.match(source, /--from/, "install takes an explicit jsonl path");
  assert.equal(source.includes("read-log"), false);
});

/**
 * Dry run, and against a throwaway HOME, so this can never reach the real
 * library. What is being proved is only that an extraction which found nothing
 * does not take the install down with it.
 */
test("install-references survives an output file that holds no references", () => {
  const home = mkdtempSync(join(tmpdir(), "refs-install-"));
  try {
    const empty = join(home, "codex-refs-empty.jsonl");
    writeFileSync(empty, "\n");
    const blanks = join(home, "codex-refs-blanks.jsonl");
    writeFileSync(blanks, `\n${row("src:podcast:a")}\n\n`);

    for (const [path, expected] of [[empty, /^0 extracted/m], [blanks, /^1 extracted/m]] as const) {
      const result = spawnSync(process.execPath, [
        "--import", "tsx", "scripts/install-references.ts", "--dry-run", "--from", path,
      ], { cwd: repoRoot, encoding: "utf-8", env: { ...process.env, HOME: home } });

      assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
      assert.match(result.stdout, expected);
      assert.match(result.stdout, /\(dry run\)/);
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
