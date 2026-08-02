import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

import {
  DIRECTOR_LIMITS,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_MODEL_KEY,
  MAGIC_MODEL_ROLES,
  MAGIC_MODEL_RUNTIME,
  MAGIC_REPLAY_SCHEMA_VERSION,
  assertMagicModel,
  assertMagicRuntime,
  directorCacheKey,
  normalizeDirectorScenes,
  redactEvidence,
  resolveMagicSearchModels,
  validateDirectorPayload,
  validateReplayFixture,
} from "../lab/tour-lab/magic-contract.mjs";
import {
  listDirectorEvidence,
  listReplayFixtures,
  readDirectorEvidence,
  readReplayFixture,
  writeDirectorEvidence,
  writeReplayFixture,
} from "../lab/tour-lab/director-evidence.mjs";

const validModelEvidence = () => ({
  ...MAGIC_MODEL_RUNTIME,
  resolvedSlug: MAGIC_MODEL_RUNTIME.requestedSlug,
  provider: "OpenRouter",
  reasoning: {
    effort: MAGIC_MODEL_RUNTIME.reasoningEffort,
    applied: true,
  },
});

const validDirectorPayload = () => ({
  schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
  clip: { fromSec: 10, toSec: 70, durationSec: 60 },
  scenes: [],
  model: validModelEvidence(),
  metrics: {
    wallMs: 12,
    passes: 1,
    totalUsd: 0.001,
    calls: [{
      role: "director-initial",
      latencyMs: 10,
      promptTokens: 20,
      completionTokens: 8,
      reasoningTokens: 3,
      cachedPromptTokens: 0,
      providerCostUsd: 0.001,
      rawModel: MAGIC_MODEL_RUNTIME.requestedSlug,
      model: validModelEvidence(),
      validation: "accepted",
    }],
    normalization: { sceneCount: 0, artifactCount: 0, dropped: [] },
  },
});

const validReplayFixture = () => {
  const key = directorCacheKey({
    recordId: "fixture-record",
    fromSec: 10,
    toSec: 70,
    why: "A local replay direction",
  });
  const direction = { ...validDirectorPayload(), requestKey: key };
  return {
    schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION,
    id: "luna-local-replay",
    prompt: "Show the local fixture without a paid call",
    tour: {
      title: "Local Luna replay",
      steps: [{
        recordId: "fixture-record",
        startSec: 10,
        endSec: 70,
        why: "A local replay direction",
      }],
    },
    whispers: ["A local fixture whisper"],
    form: { kind: "timeline" },
    directions: { [key]: direction },
  };
};

function expectRuntimeRefusal(runtime: object, message: RegExp): void {
  assert.throws(
    () => assertMagicRuntime(runtime),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal((error as Error & { code?: string }).code, "MAGIC_RUNTIME_REFUSED");
      assert.match(error.message, message);
      return true;
    },
  );
}

function sceneArtifacts(scene: Record<string, unknown>): Array<Record<string, unknown>> {
  const arrays = ["groups", "footnotes", "terms", "allusions", "asides"]
    .flatMap((key) => Array.isArray(scene[key]) ? scene[key] as Array<Record<string, unknown>> : []);
  const singles = ["compare", "chain", "caveat", "highlight"]
    .map((key) => scene[key])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object");
  return [...arrays, ...singles];
}

test("/magic admits one exact Luna medium role and runtime", () => {
  assert.equal(MAGIC_MODEL_KEY, "gpt-5.6-luna-medium");
  assert.deepEqual(MAGIC_MODEL_ROLES, {
    search: "gpt-5.6-luna-medium",
    whispers: "gpt-5.6-luna-medium",
    form: "gpt-5.6-luna-medium",
    director: "gpt-5.6-luna-medium",
  });
  assert.equal(assertMagicModel(MAGIC_MODEL_KEY), MAGIC_MODEL_KEY);
  assert.equal(assertMagicRuntime(validModelEvidence()).resolvedSlug, "openai/gpt-5.6-luna");
  assert.deepEqual(resolveMagicSearchModels({ surface: "magic" }), [MAGIC_MODEL_KEY]);
  assert.deepEqual(
    resolveMagicSearchModels({ surface: "magic", models: [MAGIC_MODEL_KEY, MAGIC_MODEL_KEY] }),
    [MAGIC_MODEL_KEY],
  );
  assert.equal(resolveMagicSearchModels({ surface: "bench", model: "deepseek-v4-flash" }), null);
  assert.throws(
    () => resolveMagicSearchModels({ surface: "magic", model: "gpt-5.6-sol-high" }),
    /search permits only gpt-5\.6-luna-medium/,
  );

  for (const model of [undefined, "gpt-5.6-sol-high", "gpt-5.6-luna-high", "openai/gpt-5.6-luna"]) {
    assert.throws(
      () => assertMagicModel(model),
      (error: unknown) => error instanceof Error
        && (error as Error & { code?: string }).code === "MAGIC_MODEL_REFUSED",
    );
  }

  expectRuntimeRefusal(
    { ...validModelEvidence(), requestedSlug: "openai/gpt-5.6-sol" },
    /requested slug must be openai\/gpt-5\.6-luna/,
  );
  expectRuntimeRefusal(
    { ...validModelEvidence(), resolvedSlug: "openai/gpt-5.6-luna-preview" },
    /resolved slug must be exactly openai\/gpt-5\.6-luna/,
  );
  expectRuntimeRefusal(
    { ...validModelEvidence(), endpointHost: "api.openai.com" },
    /endpoint host must be openrouter\.ai/,
  );
  expectRuntimeRefusal(
    { ...validModelEvidence(), endpointStyle: "direct" },
    /endpoint style must be aggregator/,
  );
  expectRuntimeRefusal(
    { ...validModelEvidence(), reasoning: { effort: "high", applied: true } },
    /reasoning effort must be medium/,
  );
  expectRuntimeRefusal(
    { ...validModelEvidence(), reasoning: { effort: "medium", applied: false } },
    /reasoning effort must be applied/,
  );
});

test("director cache identity binds the admitted model, schema, record, bounds, and why", () => {
  const input = {
    modelKey: MAGIC_MODEL_KEY,
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    recordId: "record-a",
    fromSec: 12,
    toSec: 78,
    why: "The first reason",
  };
  const base = directorCacheKey(input);

  assert.match(base, /^1\|gpt-5\.6-luna-medium\|record-a\|12\|78\|[0-9a-f]{16}$/);
  assert.equal(directorCacheKey({ ...input }), base, "identical logical requests must deduplicate");
  assert.notEqual(directorCacheKey({ ...input, schemaVersion: 2 }), base);
  assert.notEqual(directorCacheKey({ ...input, recordId: "record-b" }), base);
  assert.notEqual(directorCacheKey({ ...input, fromSec: 13 }), base);
  assert.notEqual(directorCacheKey({ ...input, toSec: 79 }), base);
  assert.notEqual(directorCacheKey({ ...input, fromSec: 12.4 }), base);
  assert.notEqual(directorCacheKey({ ...input, why: "A different reason" }), base);
  assert.throws(
    () => directorCacheKey({ ...input, modelKey: "gpt-5.6-sol-high" }),
    /permits only gpt-5\.6-luna-medium/,
    "an unapproved model cannot mint a lookalike cache identity",
  );
});

test("final normalization reapplies combined caps, half-open ownership, silence, and finite clip bounds", () => {
  const cueList = (count: number, start: number) => Array.from({ length: count }, (_, index) => ({
    id: `${start}-${index}`,
    at: start + index * 3,
    timingSource: "cue",
  }));
  const rawScenes = [
    {
      id: "leaving",
      at: 0,
      timingSource: "cue",
      verses: [],
      groups: cueList(6, 5),
      footnotes: [
        { id: "wrong-owner", at: 50, timingSource: "cue" },
        { id: "kept-in-first", at: 22, timingSource: "cue" },
        ...cueList(2, 25),
      ],
      terms: cueList(4, 28),
      allusions: cueList(4, 34),
      asides: cueList(4, 12),
      compare: { at: 39, timingSource: "cue" },
      chain: { at: 42, timingSource: "cue" },
      caveat: { at: 45, timingSource: "cue" },
      highlight: { at: 48, timingSource: "cue" },
    },
    {
      id: "arriving",
      at: 50,
      timingSource: "cue",
      verses: [],
      footnotes: [{ id: "right-owner", at: 50, timingSource: "cue" }],
    },
    {
      id: "invent-finite",
      at: 80,
      timingSource: "cue",
      verses: [],
      terms: [{ id: "invented", at: Number.POSITIVE_INFINITY, timingSource: "house" }],
    },
    {
      id: "clamp-to-clip",
      at: 110,
      timingSource: "cue",
      verses: [],
      terms: [{ id: "clamped", at: 999, timingSource: "house" }],
    },
    { id: "over-scene-cap", at: 115, timingSource: "cue", verses: [] },
  ];

  const { scenes, report } = normalizeDirectorScenes(rawScenes, 120);
  assert.equal(scenes.length, DIRECTOR_LIMITS.maxScenes);
  assert.ok(report.invented >= 1);
  assert.ok(report.clamped >= 1);
  for (const kind of ["scene", "group", "footnote", "term", "allusion", "aside"]) {
    assert.ok(report.dropped.some((drop: { reason: string; kind: string }) => drop.reason === "cap" && drop.kind === kind));
  }

  assert.equal(scenes[0].footnotes.some((artifact: { id?: string }) => artifact.id === "wrong-owner"), false);
  assert.equal(scenes[1].footnotes.some((artifact: { id?: string }) => artifact.id === "right-owner"), true);
  assert.ok(report.dropped.some((drop: { reason: string; at?: number }) => (
    drop.reason === "anchored-outside-scene" && drop.at === 50
  )));
  assert.ok(report.dropped.some((drop: { reason: string }) => drop.reason === "aside-not-silent"));

  scenes.forEach((scene: Record<string, unknown>, index: number) => {
    const start = Number(scene.at);
    const nextStart = index + 1 < scenes.length ? Number(scenes[index + 1].at) : 120;
    assert.ok(Number.isFinite(start) && start >= 0 && start <= 120);
    assert.ok((scene.groups as unknown[]).length <= DIRECTOR_LIMITS.maxGroups);
    assert.ok((scene.footnotes as unknown[]).length <= DIRECTOR_LIMITS.maxFootnotes);
    assert.ok((scene.terms as unknown[]).length <= DIRECTOR_LIMITS.maxTerms);
    assert.ok((scene.allusions as unknown[]).length <= DIRECTOR_LIMITS.maxAllusions);
    assert.ok((scene.asides as unknown[]).length <= DIRECTOR_LIMITS.maxBareAsides);
    assert.ok(
      sceneArtifacts(scene).length
        <= DIRECTOR_LIMITS.maxGroups
          + DIRECTOR_LIMITS.maxFootnotes
          + DIRECTOR_LIMITS.maxTerms
          + DIRECTOR_LIMITS.maxAllusions
          + DIRECTOR_LIMITS.maxBareAsides
          + 4,
      "the combined post-pass scene cannot exceed its field caps",
    );
    for (const artifact of sceneArtifacts(scene)) {
      const at = Number(artifact.at);
      assert.ok(Number.isFinite(at), "every final artifact time must be finite");
      assert.ok(at >= start && at <= 120, "every final artifact belongs to its clip");
      if (index + 1 < scenes.length) {
        assert.ok(at < nextStart, "the next scene boundary is half-open");
      }
    }
  });
});

test("normalization moves only house time, preserves cue and word truth, and defaults occurrences to zero", () => {
  const { scenes, report } = normalizeDirectorScenes([{
    at: 0,
    timingSource: "cue",
    verses: [],
    groups: [
      { id: "cue", at: 10, timingSource: "cue" },
      {
        id: "word",
        at: 10.1,
        timingSource: "word",
        wordTimes: [
          { word: "faith", at: 10.1, timingSource: "word" },
          { word: "faith", at: 10.2, occurrence: -1, timingSource: "word" },
          { word: "faith", at: 10.3, occurrence: 2, timingSource: "word" },
        ],
      },
      { id: "house", at: 10.2, timingSource: "house" },
    ],
  }], 20);
  const [cue, word, house] = scenes[0].groups;

  assert.equal(cue.at, 10);
  assert.equal(word.at, 10.1);
  assert.notEqual(house.at, 10.2);
  assert.ok(Math.abs(house.at - cue.at) >= DIRECTOR_LIMITS.fieldMinGapSec);
  assert.ok(Math.abs(house.at - word.at) >= DIRECTOR_LIMITS.fieldMinGapSec);
  assert.deepEqual(word.wordTimes.map((entry: { occurrence: number }) => entry.occurrence), [0, 0, 2]);
  assert.ok(word.wordTimes.every((entry: { timingSource: string }) => entry.timingSource === "word"));
  assert.ok(report.shifted >= 1);

  const silent = normalizeDirectorScenes([{
    at: 0,
    timingSource: "cue",
    verses: [],
    groups: [{ at: 50, timingSource: "cue" }],
    asides: [
      { id: "too-close", at: 60, timingSource: "cue" },
      { id: "quiet", at: 80, timingSource: "cue" },
    ],
  }], 100);
  assert.deepEqual(silent.scenes[0].asides.map((aside: { id: string }) => aside.id), ["quiet"]);
});

test("final invariants survive scene allocation, duplicate boundaries, and post-shift aside checks", () => {
  const allocated = normalizeDirectorScenes([
    { id: "cue-a", at: 0, timingSource: "cue", verses: [] },
    { id: "house", at: 5, timingSource: "house", verses: [] },
    { id: "cue-b", at: 10, timingSource: "cue", verses: [] },
  ], 40);
  const house = allocated.scenes.find((scene: { id?: string }) => scene.id === "house");
  assert.ok(house);
  assert.ok(allocated.scenes
    .filter((scene: { id?: string }) => scene.id !== "house")
    .every((scene: { at: number }) => Math.abs(scene.at - house.at) >= DIRECTOR_LIMITS.sceneMinGapSec));

  const duplicate = normalizeDirectorScenes([
    {
      id: "leaving",
      at: 10,
      timingSource: "cue",
      verses: [],
      groups: [{ id: "must-drop", at: 10, timingSource: "cue" }],
    },
    { id: "arriving", at: 10, timingSource: "cue", verses: [] },
  ], 30);
  assert.equal(duplicate.scenes[0].groups.length, 0);
  assert.ok(duplicate.report.dropped.some((drop: { reason: string }) => drop.reason === "zero-width-scene"));

  const aside = normalizeDirectorScenes([{
    at: 0,
    timingSource: "cue",
    verses: [],
    groups: [
      { id: "anchor", at: 0, timingSource: "cue" },
      { id: "moved-house", at: 0, timingSource: "house" },
    ],
    asides: [{ id: "aside", at: 25, timingSource: "cue" }],
  }], 60);
  assert.equal(aside.scenes[0].asides.length, 0);
  assert.ok(aside.report.dropped.some((drop: { reason: string }) => drop.reason === "aside-not-silent"));

  const wordTruth = normalizeDirectorScenes([{
    at: 0,
    timingSource: "cue",
    verses: [],
    groups: [{
      at: 20,
      timingSource: "word",
      wordTimes: [
        { word: "unverified", at: 18, occurrence: 0 },
        { word: "verified", at: 19, occurrence: 1, timingSource: "word" },
      ],
    }],
  }], 30);
  assert.deepEqual(wordTruth.scenes[0].groups[0].wordTimes.map((entry: { word: string }) => entry.word), ["verified"]);
});

test("director validation refuses malformed, over-cap, out-of-window, and per-call model drift", () => {
  const malformed = { ...validDirectorPayload(), scenes: [{ at: 0 }] };
  assert.doesNotThrow(() => validateDirectorPayload(malformed));
  assert.equal(validateDirectorPayload(malformed).ok, false);

  const impossible = validDirectorPayload();
  impossible.scenes = Array.from({ length: DIRECTOR_LIMITS.maxScenes + 1 }, (_, index) => ({
    at: index * 2,
    timingSource: "cue",
    verses: [],
    groups: Array.from({ length: DIRECTOR_LIMITS.maxGroups + 1 }, () => ({ at: 59, timingSource: "cue" })),
    footnotes: [], terms: [], allusions: [], asides: [],
    compare: null, chain: null, caveat: null, highlight: null,
  }));
  const impossibleCheck = validateDirectorPayload(impossible);
  assert.equal(impossibleCheck.ok, false);
  assert.ok(impossibleCheck.errors.some((error: string) => /exceeds cap|outside its scene/.test(error)));

  const noCallRuntime = validDirectorPayload();
  delete (noCallRuntime.metrics.calls[0] as { model?: object }).model;
  assert.equal(validateDirectorPayload(noCallRuntime).ok, false);

  const negativeWall = validDirectorPayload();
  negativeWall.metrics.wallMs = -1;
  assert.equal(validateDirectorPayload(negativeWall).ok, false);
});

test("director and replay validators refuse unsupported newer schemas", () => {
  const newerDirector = {
    ...validDirectorPayload(),
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1,
  };
  const directorCheck = validateDirectorPayload(newerDirector);
  assert.equal(directorCheck.ok, false);
  assert.ok(directorCheck.errors.some((error: string) => /newer than supported/.test(error)));

  const newerReplay = {
    ...validReplayFixture(),
    schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION + 1,
  };
  const replayCheck = validateReplayFixture(newerReplay);
  assert.equal(replayCheck.ok, false);
  assert.ok(replayCheck.errors.some((error: string) => /newer than supported/.test(error)));
});

test("evidence is recursively redacted, append-only, and replay fixtures round-trip offline", () => {
  assert.deepEqual(
    redactEvidence({
      apiKey: "key-value",
      nested: {
        authorization: "Bearer credential",
        bearer: "credential",
        accessToken: "credential",
        promptTokens: 42,
      },
    }),
    {
      apiKey: "[redacted]",
      nested: {
        authorization: "[redacted]",
        bearer: "[redacted]",
        accessToken: "[redacted]",
        promptTokens: 42,
      },
    },
  );

  const root = mkdtempSync(join(tmpdir(), "quire-magic-contract-"));
  const runsDir = join(root, "director-runs");
  const replayDir = join(root, "replays");
  try {
    const record = {
      startedAt: "2026-08-02T12:34:56.789Z",
      requestKey: "same-logical-direction",
      request: {
        recordId: "fixture-record",
        apiKey: "must-not-land",
        headers: { authorization: "Bearer must-not-land" },
      },
      result: validDirectorPayload(),
    };
    const first = writeDirectorEvidence(record, { dir: runsDir });
    const second = writeDirectorEvidence(record, { dir: runsDir });
    assert.notEqual(first, second, "the second observation appends instead of overwriting");
    assert.match(basename(second), /-1\.json$/);
    assert.equal(listDirectorEvidence({ dir: runsDir }).length, 2);
    assert.equal(readDirectorEvidence(basename(first), { dir: runsDir })?.request.apiKey, "[redacted]");
    assert.equal(
      readDirectorEvidence(basename(first), { dir: runsDir })?.request.headers.authorization,
      "[redacted]",
    );

    const fixture = { ...validReplayFixture(), secret: "must-not-land" };
    const fixtureFile = writeReplayFixture(fixture, { dir: replayDir });
    assert.equal(basename(fixtureFile), `${fixture.id}.json`);
    const replay = readReplayFixture(fixture.id, { dir: replayDir });
    assert.deepEqual(replay.errors, []);
    assert.equal(replay.fixture?.secret, "[redacted]");
    assert.deepEqual(replay.fixture?.directions, fixture.directions);
    assert.deepEqual(listReplayFixtures({ dir: replayDir }), [{
      id: fixture.id,
      prompt: fixture.prompt,
      title: fixture.tour.title,
      steps: 1,
    }]);
    assert.throws(
      () => writeReplayFixture(fixture, { dir: replayDir }),
      (error: unknown) => (
        error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST"
      ),
      "a named replay fixture is append-only",
    );
    assert.throws(
      () => writeReplayFixture({
        ...validReplayFixture(),
        id: "future-write",
        schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION + 1,
      }, { dir: replayDir }),
      /newer than supported/,
      "the writer must refuse rather than downgrade a future fixture",
    );
    assert.equal(readDirectorEvidence("..", { dir: runsDir }), null);

    const newer = { ...validReplayFixture(), id: "future-replay", schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION + 1 };
    mkdirSync(replayDir, { recursive: true });
    writeFileSync(join(replayDir, `${newer.id}.json`), `${JSON.stringify(newer)}\n`, { flag: "wx" });
    const refused = readReplayFixture(newer.id, { dir: replayDir });
    assert.equal(refused.fixture, null);
    assert.ok(refused.errors.some((error: string) => /newer than supported/.test(error)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
