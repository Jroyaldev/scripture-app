import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { test } from "node:test";

import {
  DIRECTOR_ARTIFACT_KINDS,
  DIRECTOR_COPY_LIMITS,
  DIRECTOR_LIMITS,
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_DIRECTOR_WHY_MAX_CHARS,
  MAGIC_MODEL_KEY,
  MAGIC_MODEL_ROLES,
  MAGIC_MODEL_RUNTIME,
  MAGIC_REPLAY_SCHEMA_VERSION,
  assertMagicModel,
  assertMagicReplyEvidence,
  assertMagicRuntime,
  buildVisualTimeline,
  computeDirectorHighlightCeiling,
  computeDirectorMovementBudget,
  createDirectorHousePrelude,
  directorCacheKey,
  directorRequestFingerprint,
  findScriptureOccurrence,
  measureSceneCadence,
  measureThoughtCadence,
  measureVisualCadence,
  normalizeDirectorPlan,
  planLoomGeometry,
  redactEvidence,
  resolveMagicSearchModels,
  resolveVisualComposition,
  stableTextHash,
  summarizeVisualProjection,
  upgradeDirectorPayload,
  upgradeReplayFixture,
  validateDirectorPayload,
  validateMagicRoleEvidence,
  validateReplayFixture,
  visualChannelForKind,
  visualEventIsActive,
} from "../lab/tour-lab/magic-contract.mjs";
import {
  listDirectorEvidence,
  listMagicRoleEvidence,
  listReplayFixtures,
  readDirectorEvidence,
  readMagicRoleEvidence,
  readReplayFixture,
  writeDirectorEvidence,
  writeMagicRoleEvidence,
  writeReplayFixture,
} from "../lab/tour-lab/director-evidence.mjs";
import {
  createSharedDirectorJobs,
  retireOwnedDirectorEntry,
} from "../lab/tour-lab/magic-jobs.mjs";

const TRANSCRIPT_HASH = "0123456789abcdef";
const WHY = "A grounded v2 direction";

const validModelEvidence = () => ({
  ...MAGIC_MODEL_RUNTIME,
  resolvedSlug: MAGIC_MODEL_RUNTIME.requestedSlug,
  provider: "OpenRouter",
  reasoning: {
    effort: MAGIC_MODEL_RUNTIME.reasoningEffort,
    applied: true,
  },
});

const validCall = () => ({
  role: "initial",
  latencyMs: 10,
  promptTokens: 20,
  completionTokens: 8,
  reasoningTokens: 3,
  cachedPromptTokens: 0,
  providerCostUsd: 0.001,
  finishReason: "stop",
  rawModel: MAGIC_MODEL_RUNTIME.requestedSlug,
  provider: "OpenAI",
  model: validModelEvidence(),
  validation: "accepted",
});

const modelScene = ({
  id = "scene-1",
  at = 0,
  ref = "Revelation 1:17",
  verses = [{
    verse: 17,
    text: "When I saw him, I fell at his feet like a dead man. He laid his right hand on me, saying, “Don’t be afraid. I am the first and the last,",
  }],
  cue = "do not be afraid",
  timingSource = "cue",
  origin = "model",
} = {}) => ({ id, origin, ref, verses, cue, at, timingSource });

function dataForKind(kind: string, at = 10): Record<string, unknown> {
  switch (kind) {
    case "group":
      return {
        words: ["first", "last"],
        occurrences: [0, 0],
        label: "the whole span",
        wordTimes: [{ word: "first", occurrence: 0, at: Math.max(0, at - 2), timingSource: "word" }],
      };
    case "footnote":
      return { word: "afraid", occurrence: 0, note: "The wording carries a textual claim." };
    case "term":
      return { term: "zōn", gloss: "the living one" };
    case "allusion":
      return { ref: "Isaiah 44:6", text: "I am the first, and I am the last.", note: "the stated echo" };
    case "compare":
      return {
        a: { ref: "Isaiah 44:6", text: "I am the first, and I am the last." },
        b: { ref: "Revelation 1:17", text: "I am the first and the last." },
        axis: "likeness",
        note: "the shared divine title",
      };
    case "chain":
      return {
        links: [
          { ref: "Isaiah 44:6", text: "I am the first, and I am the last." },
          { ref: "Revelation 1:17", text: "I am the first and the last." },
        ],
        note: "the title carried forward",
      };
    case "caveat":
      return { text: "The text does not make fear the final word." };
    case "aside":
      return { text: "John falls before the speaker answers him." };
    case "highlight":
      return { quote: "Do not be afraid. I am the first and the last." };
    default:
      throw new Error(`no fixture data for ${kind}`);
  }
}

const visualBeat = ({
  id = "beat-1",
  proposalId = `proposal-${id}`,
  sceneId = "scene-1",
  kind = "group",
  at = 10,
  cue = "copied transcript cue",
  timingSource = "cue",
  data = dataForKind(kind, at),
} = {}) => ({ id, proposalId, sceneId, kind, at, cue, timingSource, data });

function acceptedOutcomes(beats: Array<Record<string, unknown>>) {
  return beats.map((beat) => ({
    proposalId: beat.proposalId,
    beatId: beat.id,
    kind: beat.kind,
    sceneId: beat.sceneId,
  }));
}

function validDirectorPayload({
  durationSec = 60,
  sustainedTeachingSec = durationSec,
  scenes = [modelScene()],
  beats = [visualBeat()],
} = {}) {
  const budget = computeDirectorMovementBudget({ durationSec, sustainedTeachingSec });
  const normalized = normalizeDirectorPlan(
    { scenes, beats },
    { durationSec, sustainedTeachingSec, budget, addPrelude: false },
  );
  const projection = summarizeVisualProjection(normalized, durationSec);
  const requestIdentity = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    modelKey: MAGIC_MODEL_KEY,
    recordId: "fixture-record",
    fromSec: 10,
    toSec: 10 + durationSec,
    why: WHY,
  };
  const call = validCall();
  return {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    requestKey: directorCacheKey({ ...requestIdentity, transcriptHash: TRANSCRIPT_HASH }),
    requestFingerprint: directorRequestFingerprint(requestIdentity),
    clip: {
      fromSec: 10,
      toSec: 10 + durationSec,
      durationSec,
      sustainedTeachingSec,
      transcriptHash: TRANSCRIPT_HASH,
      transcriptHashSource: "full-segment-window",
    },
    budget,
    scenes: normalized.scenes,
    beats: normalized.beats,
    model: validModelEvidence(),
    metrics: {
      wallMs: 12,
      passes: 1,
      totalUsd: 0.001,
      calls: [call],
      tokens: { prompt: 20, completion: 8, reasoning: 3, cachedPrompt: 0 },
      normalization: normalized.report,
      outcomes: {
        completeness: "complete",
        proposed: normalized.beats.map((beat: Record<string, unknown>) => ({
          proposalId: beat.proposalId,
          pass: "initial",
          kind: beat.kind,
        })),
        rejected: [],
        accepted: acceptedOutcomes(normalized.beats),
        focusMasked: projection.focusMasked,
        superseded: projection.superseded,
        projectedVisible: projection.projectedVisible,
      },
    },
  };
}

function validReplayFixture() {
  const direction = validDirectorPayload();
  return {
    schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    id: "luna-local-replay",
    prompt: "Show the local fixture without a paid call",
    tour: {
      title: "Local Luna replay",
      intro: "A saved local replay.",
      closing: "The replay closes without a model call.",
      totalSeconds: 60,
      steps: [{
        id: "step-1",
        recordId: "fixture-record",
        startSec: 10,
        endSec: 70,
        why: WHY,
        episodeTitle: "Fixture episode",
        source: "Fixture source",
        audioUrl: "https://example.com/fixture.mp3",
      }],
    },
    whispers: ["A local fixture whisper"],
    form: { form: "standard" },
    directions: { "step-1": direction },
  };
}

function validLegacyDirectorPayload() {
  const call = validCall();
  return {
    schemaVersion: 1,
    requestKey: `1|${MAGIC_MODEL_KEY}|fixture-record|10|70|${stableTextHash(WHY)}`,
    clip: { fromSec: 10, toSec: 70, durationSec: 60 },
    scenes: [{
      ref: "Revelation 1:17",
      at: 0,
      timingSource: "cue",
      verses: [{
        verse: 17,
        text: "When I saw him, I fell at his feet like a dead man. He laid his right hand on me, saying, “Don’t be afraid. I am the first and the last,",
      }],
      groups: [{ ...dataForKind("group", 10), at: 10, timingSource: "cue", cue: "first and the last" }],
      footnotes: [],
      terms: [],
      allusions: [],
      asides: [],
      compare: null,
      chain: null,
      caveat: null,
      highlight: null,
    }],
    model: validModelEvidence(),
    metrics: {
      wallMs: 12,
      passes: 1,
      totalUsd: 0.001,
      calls: [call],
      tokens: { prompt: 20, completion: 8, reasoning: 3, cachedPrompt: 0 },
      normalization: { dropped: [], shifted: 0, clamped: 0, invented: 0, sceneCount: 1, artifactCount: 1 },
    },
  };
}

function validLegacyReplayFixture() {
  const direction = validLegacyDirectorPayload();
  return {
    schemaVersion: 1,
    id: "legacy-local-replay",
    prompt: "Open the old replay deterministically",
    tour: {
      title: "Legacy replay",
      intro: "A saved v1 replay.",
      closing: "The migration keeps the evidence honest.",
      totalSeconds: 60,
      steps: [{
        recordId: "fixture-record",
        startSec: 10,
        endSec: 70,
        why: WHY,
        episodeTitle: "Fixture episode",
        source: "Fixture source",
        audioUrl: "https://example.com/fixture.mp3",
      }],
    },
    whispers: ["A local fixture whisper"],
    form: { form: "standard" },
    directions: { [direction.requestKey]: direction },
  };
}

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

test("/magic admits one exact Luna-medium OpenRouter role and refuses Sol or runtime drift", () => {
  assert.equal(MAGIC_MODEL_KEY, "gpt-5.6-luna-medium");
  assert.equal(MAGIC_DIRECTOR_SCHEMA_VERSION, 2);
  assert.equal(MAGIC_REPLAY_SCHEMA_VERSION, 2);
  assert.equal(MAGIC_DIRECTOR_POLICY_VERSION, "magic-director-3");
  assert.deepEqual(MAGIC_MODEL_ROLES, {
    search: MAGIC_MODEL_KEY,
    whispers: MAGIC_MODEL_KEY,
    form: MAGIC_MODEL_KEY,
    director: MAGIC_MODEL_KEY,
  });
  assert.equal(assertMagicModel(MAGIC_MODEL_KEY), MAGIC_MODEL_KEY);
  assert.equal(assertMagicRuntime(validModelEvidence()).resolvedSlug, "openai/gpt-5.6-luna");
  assert.deepEqual(resolveMagicSearchModels({ surface: "magic" }), [MAGIC_MODEL_KEY]);
  assert.deepEqual(resolveMagicSearchModels({ surface: "magic", models: [MAGIC_MODEL_KEY, MAGIC_MODEL_KEY] }), [MAGIC_MODEL_KEY]);
  assert.equal(resolveMagicSearchModels({ surface: "bench", model: "deepseek-v4-flash" }), null);
  assert.throws(() => resolveMagicSearchModels({ surface: "magic", model: "gpt-5.6-sol-high" }), /permits only gpt-5\.6-luna-medium/);

  for (const model of [undefined, "gpt-5.6-sol-high", "gpt-5.6-luna-high", "openai/gpt-5.6-luna"]) {
    assert.throws(
      () => assertMagicModel(model),
      (error: unknown) => error instanceof Error
        && (error as Error & { code?: string }).code === "MAGIC_MODEL_REFUSED",
    );
  }

  expectRuntimeRefusal({ ...validModelEvidence(), requestedSlug: "openai/gpt-5.6-sol" }, /requested slug/);
  expectRuntimeRefusal({ ...validModelEvidence(), resolvedSlug: "openai/gpt-5.6-luna-preview" }, /resolved slug/);
  expectRuntimeRefusal({ ...validModelEvidence(), endpointHost: "api.openai.com" }, /openrouter\.ai/);
  expectRuntimeRefusal({ ...validModelEvidence(), endpointStyle: "direct" }, /aggregator/);
  expectRuntimeRefusal({ ...validModelEvidence(), reasoning: { effort: "high", applied: true } }, /medium/);
  expectRuntimeRefusal({ ...validModelEvidence(), reasoning: { effort: "medium", applied: false } }, /must be applied/);

  assert.deepEqual(
    assertMagicReplyEvidence({ raw: { model: MAGIC_MODEL_RUNTIME.requestedSlug, provider: "OpenAI" } }, validModelEvidence()),
    { rawModel: MAGIC_MODEL_RUNTIME.requestedSlug, provider: "OpenAI" },
  );
});

test("browser fingerprints stay ephemeral while server cache keys bind policy and transcript", () => {
  const input = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    modelKey: MAGIC_MODEL_KEY,
    recordId: "record-a",
    fromSec: 12,
    toSec: 78,
    why: "The first reason",
  };
  const fingerprint = directorRequestFingerprint(input);
  const cacheKey = directorCacheKey({ ...input, transcriptHash: TRANSCRIPT_HASH });

  assert.match(fingerprint, /^2\|magic-director-3\|gpt-5\.6-luna-medium\|record-a\|12\|78\|[0-9a-f]{16}$/);
  assert.equal(fingerprint.includes(TRANSCRIPT_HASH), false);
  assert.equal(directorRequestFingerprint({ ...input }), fingerprint);
  assert.match(cacheKey, /^2\|magic-director-3\|gpt-5\.6-luna-medium\|record-a\|12\|78\|0123456789abcdef\|[0-9a-f]{16}$/);
  assert.notEqual(directorCacheKey({ ...input, transcriptHash: "fedcba9876543210" }), cacheKey);
  assert.notEqual(directorRequestFingerprint({ ...input, why: "A different reason" }), fingerprint);
  assert.throws(() => directorCacheKey(input), /requires.*transcriptHash/);
  assert.throws(() => directorCacheKey({ ...input, transcriptHash: "not-a-hash" }), /requires.*transcriptHash/);
  assert.throws(() => directorRequestFingerprint({ ...input, policyVersion: "magic-director-1" }), /policy.*not supported/);
  assert.throws(() => directorRequestFingerprint({ ...input, modelKey: "gpt-5.6-sol-high" }), /permits only/);
});

test("director payload identities reconcile the complete fingerprint and cannot be bypassed by migration metadata", () => {
  const base = validDirectorPayload();
  const identity = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    modelKey: MAGIC_MODEL_KEY,
    recordId: "fixture-record",
    fromSec: 10,
    toSec: 70,
    why: WHY,
  };

  for (const changed of [
    { ...identity, recordId: "different-record" },
    { ...identity, fromSec: 11 },
    { ...identity, toSec: 71 },
    { ...identity, why: "A different reason" },
  ]) {
    assert.notEqual(directorRequestFingerprint(changed), base.requestFingerprint);
    assert.notEqual(directorCacheKey({ ...changed, transcriptHash: TRANSCRIPT_HASH }), base.requestKey);
  }

  const wrongKey = structuredClone(base);
  wrongKey.requestKey = "2|magic-director-3|wrong-model|wrong-record|999|1000|0123456789abcdef|wrong-why-hash";
  assert.ok(validateDirectorPayload(wrongKey).errors.some((error: string) => /requestKey must exactly reconcile/.test(error)));

  const wrongFingerprint = structuredClone(base);
  wrongFingerprint.requestFingerprint = directorRequestFingerprint({ ...identity, recordId: "different-record" });
  assert.ok(validateDirectorPayload(wrongFingerprint).errors.some((error: string) => /requestKey must exactly reconcile/.test(error)));

  const missingFingerprint = structuredClone(base);
  delete missingFingerprint.requestFingerprint;
  assert.ok(validateDirectorPayload(missingFingerprint).errors.some((error: string) => /requestFingerprint must carry the complete/.test(error)));

  const migrationBypass = structuredClone(base);
  migrationBypass.requestKey = "bogus";
  migrationBypass.migration = {};
  const bypassCheck = validateDirectorPayload(migrationBypass);
  assert.equal(bypassCheck.ok, false);
  assert.ok(bypassCheck.errors.some((error: string) => /migration metadata is invalid/.test(error)));
  assert.ok(bypassCheck.errors.some((error: string) => /requestKey must exactly reconcile/.test(error)));
});

test("duration and sustained teaching derive movement budgets while reserving a house prelude", () => {
  const short = computeDirectorMovementBudget({ durationSec: 20, sustainedTeachingSec: 6 });
  const medium = computeDirectorMovementBudget({ durationSec: 84, sustainedTeachingSec: 84 });
  const sparseLong = computeDirectorMovementBudget({ durationSec: 900, sustainedTeachingSec: 90 });
  const fullLong = computeDirectorMovementBudget({ durationSec: 900, sustainedTeachingSec: 900 });

  assert.deepEqual(
    [short.targetThoughtEntrances, short.hardBeatCeiling, short.highlightCeiling, short.modelSceneCeiling, short.houseSceneReserve, short.finalSceneCeiling],
    [0, 0, 0, 0, 1, 1],
  );
  assert.deepEqual(
    [medium.targetThoughtEntrances, medium.hardBeatCeiling, medium.highlightCeiling, medium.modelSceneCeiling, medium.finalSceneCeiling],
    [3, 7, 1, 3, 4],
  );
  assert.deepEqual(
    [sparseLong.targetThoughtEntrances, sparseLong.hardBeatCeiling, sparseLong.highlightCeiling, sparseLong.modelSceneCeiling, sparseLong.finalSceneCeiling],
    [3, 8, 1, 3, 4],
  );
  assert.deepEqual(
    [fullLong.targetThoughtEntrances, fullLong.hardBeatCeiling, fullLong.highlightCeiling, fullLong.modelSceneCeiling, fullLong.finalSceneCeiling],
    [30, 48, 5, 12, 13],
  );

  assert.equal(computeDirectorHighlightCeiling({ sustainedTeachingSec: 80, hardBeatCeiling: 48 }), 1);
  assert.equal(computeDirectorHighlightCeiling({ sustainedTeachingSec: 300, hardBeatCeiling: 48 }), 2);
  assert.equal(computeDirectorHighlightCeiling({ sustainedTeachingSec: 900, hardBeatCeiling: 48 }), 5);

  const scenes = Array.from({ length: medium.modelSceneCeiling }, (_, index) => modelScene({
    id: `scene-${index + 1}`,
    at: 20 + index * 20,
    ref: `Revelation 1:${17 + index}`,
    verses: [{ verse: 17 + index, text: `Canonical verse ${17 + index}` }],
  }));
  const normalized = normalizeDirectorPlan({ scenes, beats: [] }, {
    durationSec: 84,
    sustainedTeachingSec: 84,
    addPrelude: true,
  });
  assert.equal(normalized.scenes.filter((scene: { origin: string }) => scene.origin === "model").length, medium.modelSceneCeiling);
  assert.equal(normalized.scenes.filter((scene: { origin: string }) => scene.origin === "house-prelude").length, 1);
  assert.equal(normalized.scenes.length, medium.finalSceneCeiling);
  assert.ok(scenes.every((scene) => normalized.scenes.some((kept: { id: string }) => kept.id === scene.id)));
  assert.equal(normalized.report.dropped.some((drop: { reason: string }) => drop.reason === "scene-safety-cap"), false);
});

test("the duration-derived highlight ceiling precisely caps a short focus burst", () => {
  const normalized = normalizeDirectorPlan({
    scenes: [modelScene()],
    beats: [
      visualBeat({ id: "highlight-1", proposalId: "p-highlight-1", kind: "highlight", at: 10 }),
      visualBeat({ id: "highlight-2", proposalId: "p-highlight-2", kind: "highlight", at: 30 }),
      visualBeat({ id: "highlight-3", proposalId: "p-highlight-3", kind: "highlight", at: 50 }),
    ],
  }, {
    durationSec: 84,
    sustainedTeachingSec: 84,
    addPrelude: false,
  });

  assert.equal(normalized.report.policyVersion, MAGIC_DIRECTOR_POLICY_VERSION);
  assert.deepEqual(normalized.beats.map((beat: { id: string }) => beat.id), ["highlight-1"]);
  assert.deepEqual(
    normalized.report.dropped.filter((drop: { reason: string }) => drop.reason === "kind-safety-cap"),
    [
      {
        id: "highlight-2",
        proposalId: "p-highlight-2",
        kind: "highlight",
        reason: "kind-safety-cap",
        ceiling: 1,
        count: 1,
      },
      {
        id: "highlight-3",
        proposalId: "p-highlight-3",
        kind: "highlight",
        reason: "kind-safety-cap",
        ceiling: 1,
        count: 1,
      },
    ],
  );
});

test("house preludes are exact house-owned reserve and false claims cannot steal model capacity", () => {
  const badTiming = validDirectorPayload({ scenes: [modelScene({ at: 20 })], beats: [] });
  badTiming.scenes.unshift({
    id: "bad-prelude",
    origin: "house-prelude",
    ref: null,
    verses: [],
    at: 5,
    timingSource: "cue",
    cue: "model-made reserved scene",
  });
  assert.ok(validateDirectorPayload(badTiming).errors.some((error: string) => (
    /house prelude must be an untimed house entrance at 0/.test(error)
  )));

  const verseful = validDirectorPayload({ scenes: [modelScene({ at: 20 })], beats: [] });
  verseful.scenes.unshift({
    id: "verseful-prelude",
    origin: "house-prelude",
    ref: "Revelation 1:17",
    verses: [{ verse: 17, text: "Do not be afraid." }],
    at: 0,
    timingSource: "house",
    cue: null,
  });
  assert.ok(validateDirectorPayload(verseful).errors.some((error: string) => /house prelude must be verse-less/.test(error)));

  const budget = computeDirectorMovementBudget({ durationSec: 60, sustainedTeachingSec: 60 });
  const normalized = normalizeDirectorPlan({
    scenes: [
      modelScene({ id: "model-1", at: 0, ref: null, verses: [] }),
      modelScene({ id: "model-2", at: 15, ref: null, verses: [] }),
      modelScene({
        id: "fake-house",
        origin: "house-prelude",
        at: 30,
        ref: null,
        verses: [],
        timingSource: "cue",
        cue: "model-made reserved scene",
      }),
    ],
    beats: [],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });
  assert.equal(normalized.scenes.length, budget.modelSceneCeiling);
  assert.equal(normalized.scenes.filter((scene: { origin: string }) => scene.origin === "house-prelude").length, 0);
  assert.ok(normalized.report.dropped.some((drop: { id: string; reason: string }) => (
    drop.id === "fake-house" && drop.reason === "scene-safety-cap"
  )));

  const generated = normalizeDirectorPlan({
    scenes: [modelScene({ id: "late-passage", at: 20 })],
    beats: [],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: true });
  const prelude = generated.scenes.find((scene: { origin: string }) => scene.origin === "house-prelude");
  assert.deepEqual(prelude && {
    origin: prelude.origin,
    at: prelude.at,
    timingSource: prelude.timingSource,
    cue: prelude.cue,
    ref: prelude.ref,
    verses: prelude.verses,
  }, {
    origin: "house-prelude",
    at: 0,
    timingSource: "house",
    cue: null,
    ref: null,
    verses: [],
  });
});

test("the exact house prelude owns portable pre-scene thoughts but not passage-coordinate beats", () => {
  const prelude = createDirectorHousePrelude();
  assert.deepEqual(prelude, {
    id: "house:prelude",
    origin: "house-prelude",
    ref: null,
    verses: [],
    cue: null,
    at: 0,
    timingSource: "house",
  });

  const normalized = normalizeDirectorPlan({
    scenes: [prelude, modelScene({ id: "model-passage", at: 15 })],
    beats: [
      visualBeat({
        id: "portable-aside",
        proposalId: "p-portable-aside",
        sceneId: "model-passage",
        kind: "aside",
        at: 5,
      }),
      visualBeat({
        id: "portable-term",
        proposalId: "p-portable-term",
        sceneId: "model-passage",
        kind: "term",
        at: 8,
      }),
      visualBeat({
        id: "early-group",
        proposalId: "p-early-group",
        sceneId: "model-passage",
        kind: "group",
        at: 5,
      }),
      visualBeat({
        id: "early-footnote",
        proposalId: "p-early-footnote",
        sceneId: "model-passage",
        kind: "footnote",
        at: 6,
      }),
    ],
  }, {
    durationSec: 60,
    sustainedTeachingSec: 60,
    addPrelude: false,
  });

  assert.deepEqual(
    normalized.scenes.map((scene: { id: string; origin: string; at: number }) => [scene.id, scene.origin, scene.at]),
    [["house:prelude", "house-prelude", 0], ["model-passage", "model", 15]],
  );
  assert.equal(normalized.scenes.filter((scene: { origin: string }) => scene.origin === "model").length, 1);
  assert.equal(normalized.scenes.filter((scene: { origin: string }) => scene.origin === "house-prelude").length, 1);
  assert.deepEqual(
    normalized.beats.map((beat: { id: string; sceneId: string; at: number }) => [beat.id, beat.sceneId, beat.at]),
    [["portable-aside", "house:prelude", 5], ["portable-term", "house:prelude", 8]],
  );
  assert.equal(normalized.report.reassigned, 2);
  assert.deepEqual(
    normalized.report.dropped
      .filter((drop: { id: string }) => ["early-group", "early-footnote"].includes(drop.id))
      .map((drop: { id: string; reason: string }) => [drop.id, drop.reason]),
    [["early-group", "anchored-outside-owner"], ["early-footnote", "anchored-outside-owner"]],
  );

  const invalidEarlyPortable = normalizeDirectorPlan({
    scenes: [modelScene({ id: "only-model-scene", at: 15 })],
    beats: [{
      ...visualBeat({
        id: "invalid-early-aside",
        proposalId: "p-invalid-early-aside",
        sceneId: "only-model-scene",
        kind: "aside",
        at: 5,
      }),
      data: null,
    }],
  }, {
    durationSec: 60,
    sustainedTeachingSec: 60,
    addPrelude: false,
  });
  assert.deepEqual(invalidEarlyPortable.scenes.map((scene: { id: string }) => scene.id), ["only-model-scene"]);
  assert.equal(invalidEarlyPortable.beats.length, 0);
  assert.ok(invalidEarlyPortable.report.dropped.some((drop: { id: string; reason: string }) => (
    drop.id === "invalid-early-aside" && drop.reason === "invalid-data"
  )));
});

test("a supplied prelude colliding with an early cue scene is omitted rather than shifted", () => {
  const normalized = normalizeDirectorPlan({
    scenes: [
      {
        id: "supplied-prelude",
        origin: "house-prelude",
        ref: null,
        verses: [],
        at: 0,
        timingSource: "house",
        cue: null,
      },
      modelScene({ id: "early-cue", at: 5 }),
    ],
    beats: [],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });

  assert.deepEqual(normalized.scenes.map((scene: { id: string; at: number }) => [scene.id, scene.at]), [["early-cue", 5]]);
  assert.equal(normalized.report.shifted, 0);
  assert.ok(normalized.report.dropped.some((drop: { id: string; reason: string; at: number }) => (
    drop.id === "supplied-prelude" && drop.reason === "no-house-slot" && drop.at === 0
  )));
});

test("normalization always derives safety budgets and ignores supplied or NaN overrides", () => {
  const raw = {
    scenes: Array.from({ length: 20 }, (_, index) => modelScene({
      id: `budget-scene-${index + 1}`,
      at: index * 2,
      ref: null,
      verses: [],
    })),
    beats: [],
  };
  const expected = computeDirectorMovementBudget({ durationSec: 60, sustainedTeachingSec: 60 });
  for (const budget of [
    {
      ...expected,
      modelSceneCeiling: 99,
      hardBeatCeiling: 99,
      houseSceneReserve: 99,
      finalSceneCeiling: 198,
    },
    {
      ...expected,
      modelSceneCeiling: Number.NaN,
      hardBeatCeiling: Number.NaN,
      houseSceneReserve: 99,
      finalSceneCeiling: 99,
    },
  ]) {
    const normalized = normalizeDirectorPlan(raw, {
      durationSec: 60,
      sustainedTeachingSec: 60,
      budget,
      addPrelude: false,
    });
    assert.equal(normalized.scenes.length, expected.modelSceneCeiling);
    assert.equal(normalized.report.dropped.filter((drop: { reason: string }) => drop.reason === "scene-safety-cap").length, 18);
  }
});

test("flat scenes and beats have unique identities, portable ownership, and half-open passage bounds", () => {
  const scenes = [
    modelScene({ id: "scene-left", at: 0 }),
    modelScene({ id: "scene-right", at: 30, ref: "Revelation 1:18", verses: [{ verse: 18, text: "I am alive forevermore." }] }),
  ];
  const normalized = normalizeDirectorPlan({
    scenes,
    beats: [
      visualBeat({ id: "left-group", proposalId: "p-left", sceneId: "scene-left", kind: "group", at: 29.9 }),
      visualBeat({ id: "boundary-group", proposalId: "p-boundary", sceneId: "scene-left", kind: "group", at: 30 }),
      visualBeat({ id: "portable", proposalId: "p-portable", sceneId: "scene-left", kind: "term", at: 35 }),
      visualBeat({ id: "duplicate", proposalId: "p-duplicate", sceneId: "scene-right", kind: "caveat", at: 40 }),
      visualBeat({ id: "duplicate", proposalId: "p-duplicate", sceneId: "scene-right", kind: "caveat", at: 50 }),
    ],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });

  assert.equal(normalized.beats.some((beat: { id: string }) => beat.id === "left-group"), true);
  assert.equal(normalized.beats.some((beat: { id: string }) => beat.id === "boundary-group"), false);
  assert.ok(normalized.report.dropped.some((drop: { id: string; reason: string }) => (
    drop.id === "boundary-group" && drop.reason === "anchored-outside-owner"
  )));
  assert.equal(normalized.beats.find((beat: { id: string }) => beat.id === "portable")?.sceneId, "scene-right");
  assert.equal(normalized.report.reassigned, 1);
  assert.equal(new Set(normalized.scenes.map((scene: { id: string }) => scene.id)).size, normalized.scenes.length);
  assert.equal(new Set(normalized.beats.map((beat: { id: string }) => beat.id)).size, normalized.beats.length);
  assert.equal(new Set(normalized.beats.map((beat: { proposalId: string }) => beat.proposalId)).size, normalized.beats.length);
  assert.ok(normalized.scenes.every((scene: Record<string, unknown>) => !Object.hasOwn(scene, "groups") && !Object.hasOwn(scene, "highlight")));
});

test("portable beats cannot precede the first scene and shifted groups discard later word cues", () => {
  const beforeFirst = normalizeDirectorPlan({
    scenes: [modelScene({ id: "first-scene", at: 10 })],
    beats: [visualBeat({
      id: "too-early",
      proposalId: "p-too-early",
      sceneId: "first-scene",
      kind: "term",
      at: 5,
      timingSource: "cue",
    })],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });
  assert.equal(beforeFirst.beats.length, 0);
  assert.ok(beforeFirst.report.dropped.some((drop: { id: string; reason: string }) => (
    drop.id === "too-early" && drop.reason === "no-scene-at-time"
  )));

  const houseGroup = {
    ...visualBeat({
      id: "shifted-group",
      proposalId: "p-shifted-group",
      sceneId: "passage",
      kind: "group",
      at: 10,
      data: {
        ...dataForKind("group", 10),
        wordTimes: [{ word: "first", occurrence: 0, at: 8, timingSource: "word" }],
      },
    }),
    cue: null,
    timingSource: "house",
  };
  const shifted = normalizeDirectorPlan({
    scenes: [modelScene({ id: "passage", at: 0 })],
    beats: [
      visualBeat({ id: "anchored-term", proposalId: "p-anchored-term", sceneId: "passage", kind: "term", at: 10 }),
      houseGroup,
    ],
  }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });
  const finalGroup = shifted.beats.find((beat: { id: string }) => beat.id === "shifted-group");
  assert.equal(finalGroup?.at, 5);
  assert.deepEqual(finalGroup?.data.wordTimes, []);
  assert.equal(shifted.report.shifted, 1);
});

test("clip-wide beat and per-kind limits are explicit safety ceilings with precise drops", () => {
  const scene = modelScene();
  const tooManyGroups = Array.from({ length: DIRECTOR_LIMITS.maxByKind.group + 1 }, (_, index) => visualBeat({
    id: `group-${index + 1}`,
    proposalId: `proposal-group-${index + 1}`,
    kind: "group",
    at: index + 1,
  }));
  const kindCapped = normalizeDirectorPlan({ scenes: [scene], beats: tooManyGroups }, {
    durationSec: 900,
    sustainedTeachingSec: 900,
    addPrelude: false,
  });
  assert.equal(kindCapped.beats.length, DIRECTOR_LIMITS.maxByKind.group);
  assert.ok(kindCapped.report.dropped.some((drop: Record<string, unknown>) => (
    drop.id === `group-${DIRECTOR_LIMITS.maxByKind.group + 1}`
      && drop.proposalId === `proposal-group-${DIRECTOR_LIMITS.maxByKind.group + 1}`
      && drop.kind === "group"
      && drop.reason === "kind-safety-cap"
      && drop.ceiling === DIRECTOR_LIMITS.maxByKind.group
  )));

  const mixed = [
    ...Array.from({ length: 24 }, (_, index) => visualBeat({ id: `g-${index}`, proposalId: `pg-${index}`, kind: "group", at: index + 1 })),
    ...Array.from({ length: 12 }, (_, index) => visualBeat({ id: `t-${index}`, proposalId: `pt-${index}`, kind: "term", at: 30 + index })),
    ...Array.from({ length: 12 }, (_, index) => visualBeat({ id: `a-${index}`, proposalId: `pa-${index}`, kind: "allusion", at: 50 + index })),
    visualBeat({ id: "global-extra", proposalId: "p-global-extra", kind: "caveat", at: 70 }),
  ];
  const globallyCapped = normalizeDirectorPlan({ scenes: [scene], beats: mixed }, {
    durationSec: 900,
    sustainedTeachingSec: 900,
    addPrelude: false,
  });
  assert.equal(globallyCapped.beats.length, DIRECTOR_LIMITS.maxBeats);
  assert.ok(globallyCapped.report.dropped.some((drop: Record<string, unknown>) => (
    drop.id === "global-extra" && drop.proposalId === "p-global-extra"
      && drop.reason === "beat-safety-cap" && drop.ceiling === DIRECTOR_LIMITS.maxBeats
  )));
});

test("aside replaces adjacent ordinary thoughts but only another aside triggers cooldown", () => {
  const scenes = [
    modelScene({ id: "scene-left", at: 0 }),
    modelScene({ id: "scene-right", at: 30, ref: null, verses: [], cue: "context turns" }),
  ];
  const adjacent = normalizeDirectorPlan({ scenes, beats: [
    visualBeat({ id: "ordinary", proposalId: "p-ordinary", sceneId: "scene-left", kind: "caveat", at: 28 }),
    visualBeat({ id: "aside-left", proposalId: "p-aside-left", sceneId: "scene-left", kind: "aside", at: 29 }),
    visualBeat({ id: "aside-too-soon", proposalId: "p-aside-too-soon", sceneId: "scene-right", kind: "aside", at: 36 }),
    visualBeat({ id: "aside-threshold", proposalId: "p-aside-threshold", sceneId: "scene-right", kind: "aside", at: 37 }),
  ] }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });

  assert.deepEqual(
    adjacent.beats.map((beat: { id: string }) => beat.id),
    ["ordinary", "aside-left", "aside-threshold"],
  );
  assert.ok(adjacent.report.dropped.some((drop: Record<string, unknown>) => (
    drop.id === "aside-too-soon" && drop.reason === "aside-cooldown"
  )));
  assert.equal(37 - 29, DIRECTOR_LIMITS.asideCooldownSec);
});

test("structural, thought, and all-visual cadence remain independently measurable", () => {
  const scenes = [
    modelScene({ id: "s1", at: 0 }),
    modelScene({ id: "s2", at: 30 }),
    modelScene({ id: "s3", at: 60 }),
  ];
  const beats = [
    visualBeat({ id: "b1", proposalId: "p1", sceneId: "s1", kind: "term", at: 20 }),
    visualBeat({ id: "b2", proposalId: "p2", sceneId: "s3", kind: "aside", at: 70 }),
  ];
  assert.equal(measureSceneCadence(scenes, 90).maxGapSec, 30);
  assert.equal(measureThoughtCadence([], 90).maxGapSec, 90);
  assert.equal(measureThoughtCadence(beats, 90).maxGapSec, 50);
  assert.equal(measureThoughtCadence(beats, 90, { excludedBeatIds: ["b2"] }).maxGapSec, 70);
  assert.equal(measureThoughtCadence(beats, 90).entranceCount, 2);

  const mixedChannels = [
    visualBeat({ id: "focus", proposalId: "p-focus", kind: "highlight", at: 10 }),
    visualBeat({ id: "thought", proposalId: "p-thought", kind: "term", at: 30 }),
  ];
  const focusAndThought = measureThoughtCadence(mixedChannels, 60);
  assert.equal(focusAndThought.entranceCount, 1);
  assert.equal(focusAndThought.firstEntranceSec, 30);
  assert.equal(focusAndThought.artifactCounts.highlight, 1);
  assert.equal(focusAndThought.artifactCounts.term, 1);
  const allVisuals = measureVisualCadence(mixedChannels, 60);
  assert.equal(allVisuals.entranceCount, 2);
  assert.equal(allVisuals.firstEntranceSec, 10);
  assert.equal(allVisuals.artifactCounts.highlight, 1);
  assert.equal(allVisuals.artifactCounts.term, 1);

  const focusOnlyBeat = visualBeat({ id: "focus-only", proposalId: "p-focus-only", kind: "highlight", at: 10 });
  const focusOnly = measureThoughtCadence([focusOnlyBeat], 60);
  assert.equal(focusOnly.entranceCount, 0);
  assert.equal(focusOnly.maxGapSec, 60);
  assert.equal(focusOnly.artifactCounts.highlight, 1);
  const focusOnlyVisual = measureVisualCadence([focusOnlyBeat], 60);
  assert.equal(focusOnlyVisual.entranceCount, 1);
  assert.equal(focusOnlyVisual.firstEntranceSec, 10);

  const normalized = normalizeDirectorPlan({ scenes: [modelScene()], beats: mixedChannels }, {
    durationSec: 60,
    sustainedTeachingSec: 60,
    addPrelude: false,
  });
  assert.equal(normalized.report.thoughtCadence.entranceCount, 1);
  assert.equal(normalized.report.thoughtCadence.firstEntranceSec, 30);
  assert.equal(normalized.report.visualCadence.entranceCount, 2);
  assert.equal(normalized.report.visualCadence.firstEntranceSec, 10);
});

test("flat visual timelines preserve word lead-ins, one thought, specificity, and exclusive focus", () => {
  const scene = modelScene();
  const plan = {
    scenes: [scene],
    beats: [
      visualBeat({ id: "group", proposalId: "p-group", kind: "group", at: 5, data: {
        ...dataForKind("group", 5),
        wordTimes: [{ word: "first", occurrence: 0, at: 3, timingSource: "word" }],
      } }),
      visualBeat({ id: "term", proposalId: "p-term", kind: "term", at: 6 }),
      visualBeat({ id: "allusion", proposalId: "p-allusion", kind: "allusion", at: 10 }),
      visualBeat({ id: "footnote", proposalId: "p-footnote", kind: "footnote", at: 12 }),
      visualBeat({ id: "aside", proposalId: "p-aside", kind: "aside", at: 25 }),
      visualBeat({ id: "compare", proposalId: "p-compare", kind: "compare", at: 28 }),
      visualBeat({ id: "highlight", proposalId: "p-highlight", kind: "highlight", at: 50 }),
      visualBeat({ id: "under-focus", proposalId: "p-under-focus", kind: "term", at: 55 }),
      visualBeat({ id: "after-focus", proposalId: "p-after-focus", kind: "caveat", at: 62 }),
    ],
  };
  const timeline = buildVisualTimeline(plan, 70);
  const mountedScene = timeline.scenes[0];
  const events = Object.fromEntries(timeline.filter((event: { beatId?: string }) => event.beatId)
    .map((event: { beatId: string }) => [event.beatId, event]));

  assert.equal(visualChannelForKind("term"), "thought");
  assert.equal(visualChannelForKind("compare"), "thought");
  assert.equal(visualChannelForKind("highlight"), "focus");
  assert.equal(events.group.exitAtWide, 6);
  assert.equal(events.term.exitAtWide, 10);
  assert.equal(events.highlight.exitAtWide, 61);
  assert.deepEqual(resolveVisualComposition(timeline, 4, { scene: mountedScene }).wordCues.map((event: { beatId: string }) => event.beatId), ["group"]);
  assert.equal(resolveVisualComposition(timeline, 7, { scene: mountedScene }).thought?.beatId, "term");
  assert.equal(resolveVisualComposition(timeline, 52, { scene: mountedScene }).focus?.beatId, "highlight");
  assert.equal(resolveVisualComposition(timeline, 52, { scene: mountedScene }).thought, null);
  assert.equal(resolveVisualComposition(timeline, 61.5, { scene: mountedScene }).thought, null, "a thought entering under focus never resurrects");
  assert.equal(resolveVisualComposition(timeline, 63, { scene: mountedScene }).thought?.beatId, "after-focus");
  assert.equal(visualEventIsActive(events.allusion, 11), true);
  assert.equal(visualEventIsActive(events.allusion, 12), false);

  const tied = buildVisualTimeline({
    scenes: [scene],
    beats: [
      visualBeat({ id: "generic", proposalId: "p-generic", kind: "group", at: 8 }),
      visualBeat({ id: "specific", proposalId: "p-specific", kind: "term", at: 8 }),
    ],
  }, 30);
  assert.equal(resolveVisualComposition(tied, 8, { scene: tied.scenes[0] }).thought?.beatId, "specific");
});

test("projection summaries distinguish visible, focus-masked, and superseded beats", () => {
  const plan = {
    scenes: [modelScene()],
    beats: [
      visualBeat({ id: "focus", proposalId: "p-focus", kind: "highlight", at: 10 }),
      visualBeat({ id: "masked", proposalId: "p-masked", kind: "compare", at: 12 }),
      visualBeat({ id: "visible-aside", proposalId: "p-aside", kind: "aside", at: 22 }),
      visualBeat({ id: "generic-tie", proposalId: "p-generic", kind: "group", at: 30 }),
      visualBeat({ id: "specific-tie", proposalId: "p-specific", kind: "term", at: 30 }),
    ],
  };
  const summary = summarizeVisualProjection(plan, 50);
  assert.deepEqual(summary.focusMasked, [{ beatId: "masked", byBeatId: "focus", reason: "entered-during-highlight" }]);
  assert.ok(summary.projectedVisible.some((entry: { beatId: string }) => entry.beatId === "focus"));
  assert.ok(summary.projectedVisible.some((entry: { beatId: string }) => entry.beatId === "visible-aside"));
  assert.ok(summary.projectedVisible.some((entry: { beatId: string }) => entry.beatId === "specific-tie"));
  assert.ok(summary.superseded.some((entry: { beatId: string; byBeatId: string }) => (
    entry.beatId === "generic-tie" && entry.byBeatId === "specific-tie"
  )));
});

test("Scripture anchors tolerate punctuation while preserving occurrences", () => {
  const text = "Don’t be afraid. Don't turn back — do not fear. The everlasting one is last.";
  assert.deepEqual(findScriptureOccurrence(text, "Don't", 0), { start: 0, end: 5 });
  assert.deepEqual(findScriptureOccurrence(text, "Don’t", 1), { start: 17, end: 22 });
  assert.deepEqual(findScriptureOccurrence(text, "back - do", 0), { start: 28, end: 37 });
  assert.deepEqual(findScriptureOccurrence("Do not be afraid.", "afraid,", 0), { start: 10, end: 16 });
  assert.deepEqual(findScriptureOccurrence("I am the first, and the last", "first and", 0), { start: 9, end: 19 });
  assert.equal(findScriptureOccurrence(text, "last", 0)?.start, text.lastIndexOf("last"));
  assert.equal(findScriptureOccurrence(text, "ever", 0), null);
  assert.equal(findScriptureOccurrence(text, "missing", 0), null);
});

test("loom plans are deterministic connected weaves without a label gutter", () => {
  const sameLine = {
    targets: [
      { x1: 40, x2: 76, top: 10, bottom: 28 },
      { x1: 212, x2: 248, top: 10, bottom: 28 },
    ],
    lineRects: [{ x1: 32, x2: 268, top: 10, bottom: 28 }],
    boundsWidth: 300,
    safeInset: 8,
  };
  const first = planLoomGeometry(sameLine);
  const second = planLoomGeometry(sameLine);
  assert.deepEqual(first, second);
  assert.equal(first?.contacts.length, 2);
  assert.equal(first?.wefts.length, 1);
  assert.equal(first?.route, "inline");
  assert.equal(first?.warp, null);
  assert.deepEqual(first?.wefts[0], { x1: 58, x2: 230, y: 35 });
  assert.ok(first?.contacts.every((contact: { corridorY: number }) => contact.corridorY === first.wefts[0].y));

  const multiLine = planLoomGeometry({
    targets: [
      { x1: 34, x2: 71, top: 10, bottom: 28 },
      { x1: 196, x2: 242, top: 10, bottom: 28 },
      { x1: 60, x2: 108, top: 48, bottom: 66 },
      { x1: 174, x2: 225, top: 48, bottom: 66 },
    ],
    lineRects: [
      { x1: 30, x2: 250, top: 10, bottom: 28 },
      { x1: 30, x2: 250, top: 48, bottom: 66 },
    ],
    boundsWidth: 280,
    safeInset: 8,
  });
  assert.equal(multiLine?.contacts.length, 4);
  assert.equal(multiLine?.wefts.length, 2);
  assert.equal(multiLine?.route, "stacked");
  assert.equal(multiLine?.warp, null);
  assert.ok(multiLine?.wefts.every((weft: { x1: number; x2: number }) => weft.x1 <= weft.x2));

  const tightGap = planLoomGeometry({
    targets: [
      { x1: 44, x2: 78, top: 105.5, bottom: 124.25 },
      { x1: 182, x2: 228, top: 105.5, bottom: 124.25 },
    ],
    lineRects: [
      { x1: 30, x2: 250, top: 105.5, bottom: 124.25 },
      { x1: 30, x2: 250, top: 130.25, bottom: 149 },
    ],
    boundsWidth: 280,
    safeInset: 8,
  });
  assert.ok((tightGap?.wefts[0].y || 0) > 124.25 && (tightGap?.wefts[0].y || 999) < 130.25);
  assert.equal(planLoomGeometry({ targets: [{ x1: 1, x2: 2, top: 0, bottom: 2 }] }), null);
});

test("semantic display copy is accepted whole or refused instead of severed", () => {
  const aside = validDirectorPayload({
    beats: [visualBeat({
      kind: "aside",
      data: { text: "a".repeat(DIRECTOR_COPY_LIMITS.marginText) },
    })],
  });
  assert.deepEqual(validateDirectorPayload(aside), { ok: true, errors: [] });
  const longAside = structuredClone(aside);
  longAside.beats[0].data.text += "a";
  assert.match(validateDirectorPayload(longAside).errors.join("; "), /text is required and bounded/);

  const compare = validDirectorPayload({
    beats: [visualBeat({
      kind: "compare",
      data: {
        ...dataForKind("compare"),
        note: "n".repeat(DIRECTOR_COPY_LIMITS.relationNote),
      },
    })],
  });
  assert.deepEqual(validateDirectorPayload(compare), { ok: true, errors: [] });
  const longCompare = structuredClone(compare);
  longCompare.beats[0].data.note += "n";
  assert.match(validateDirectorPayload(longCompare).errors.join("; "), /note is too long/);
});

test("strict v2 validation refuses malformed identities, ownership, order, nesting, and house-authored fields", () => {
  const base = validDirectorPayload();
  assert.deepEqual(validateDirectorPayload(base), { ok: true, errors: [] });

  const duplicateScene = structuredClone(base);
  duplicateScene.scenes.push({ ...duplicateScene.scenes[0], at: 30 });
  assert.ok(validateDirectorPayload(duplicateScene).errors.some((error: string) => /scene.*id must be unique/i.test(error)));

  const badId = structuredClone(base);
  badId.beats[0].id = "bad id";
  assert.ok(validateDirectorPayload(badId).errors.some((error: string) => /beats\[0\]\.id is invalid/.test(error)));

  const badProposalId = structuredClone(base);
  badProposalId.beats[0].proposalId = "bad proposal id";
  assert.ok(validateDirectorPayload(badProposalId).errors.some((error: string) => /proposalId is invalid/.test(error)));

  const missingOwner = structuredClone(base);
  missingOwner.beats[0].sceneId = "no-such-scene";
  assert.ok(validateDirectorPayload(missingOwner).errors.some((error: string) => /sceneId does not name/.test(error)));

  const twoBeatBase = validDirectorPayload({ beats: [
    visualBeat({ id: "first", proposalId: "p-first", kind: "term", at: 10 }),
    visualBeat({ id: "second", proposalId: "p-second", kind: "caveat", at: 20 }),
  ] });
  const unordered = structuredClone(twoBeatBase);
  unordered.beats.reverse();
  assert.ok(validateDirectorPayload(unordered).errors.some((error: string) => /beats must be ordered/.test(error)));

  const boundaryBase = validDirectorPayload({
    scenes: [modelScene({ id: "left", at: 0 }), modelScene({ id: "right", at: 30 })],
    beats: [visualBeat({ id: "boundary", proposalId: "p-boundary", sceneId: "left", kind: "group", at: 29 })],
  });
  boundaryBase.beats[0].at = 30;
  assert.ok(validateDirectorPayload(boundaryBase).errors.some((error: string) => /outside its scene/.test(error)));

  const nested = structuredClone(base);
  nested.scenes[0].groups = [];
  assert.ok(validateDirectorPayload(nested).errors.some((error: string) => /v1 nested artifact field/.test(error)));

  const authoredDwell = structuredClone(base);
  authoredDwell.beats[0].data.dwellSec = 15;
  assert.ok(validateDirectorPayload(authoredDwell).errors.some((error: string) => /house-owned/.test(error)));

  const newer = { ...base, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1 };
  assert.ok(validateDirectorPayload(newer).errors.some((error: string) => /newer than supported/.test(error)));
  const wrongPolicy = { ...base, policyVersion: "magic-director-4" };
  assert.ok(validateDirectorPayload(wrongPolicy).errors.some((error: string) => /policy.*not supported/.test(error)));

  const futureReplay = { ...validReplayFixture(), schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION + 1 };
  assert.ok(validateReplayFixture(futureReplay).errors.some((error: string) => /newer than supported/.test(error)));
});

test("current-schema policy-2 director and replay evidence is preserved but explicitly superseded", () => {
  const previousDirector = structuredClone(validDirectorPayload());
  previousDirector.policyVersion = "magic-director-2";
  assert.ok(validateDirectorPayload(previousDirector).errors.some((error: string) => /policy.*not supported/.test(error)));
  assert.throws(
    () => upgradeDirectorPayload(previousDirector),
    /director policy magic-director-2 is preserved historical calibration evidence and is not upgraded to magic-director-3/,
  );

  const previousReplay = structuredClone(validReplayFixture());
  previousReplay.policyVersion = "magic-director-2";
  assert.ok(validateReplayFixture(previousReplay).errors.some((error: string) => /policy.*not supported/.test(error)));
  assert.throws(
    () => upgradeReplayFixture(previousReplay),
    /replay policy magic-director-2 is superseded by magic-director-3; regenerate the local fixture without rewriting evidence/,
  );
});

test("malformed structural scenes are rejected without making validation or normalization throw", () => {
  const base = validDirectorPayload();
  for (const malformedScene of [null, [], "not-a-scene", 42]) {
    const malformed = structuredClone(base);
    malformed.scenes = [base.scenes[0], malformedScene];
    malformed.beats = [];
    malformed.metrics.normalization.sceneCount = 2;
    malformed.metrics.normalization.beatCount = 0;
    malformed.metrics.normalization.artifactCount = 0;
    malformed.metrics.outcomes = {
      completeness: "complete",
      proposed: [],
      rejected: [],
      accepted: [],
      focusMasked: [],
      superseded: [],
      projectedVisible: [],
    };
    let check = { ok: true, errors: [] as string[] };
    assert.doesNotThrow(() => { check = validateDirectorPayload(malformed); });
    assert.equal(check.ok, false);
    assert.ok(check.errors.some((error: string) => /scenes\[1\] must be an object/.test(error)));
  }

  let normalized: ReturnType<typeof normalizeDirectorPlan> | null = null;
  assert.doesNotThrow(() => {
    normalized = normalizeDirectorPlan({
      scenes: [null, modelScene(), [], "not-a-scene"],
      beats: [],
    }, { durationSec: 60, sustainedTeachingSec: 60, addPrelude: false });
  });
  assert.deepEqual(normalized?.scenes.map((scene: { id: string }) => scene.id), ["scene-1"]);
  assert.equal(normalized?.report.dropped.filter((drop: { reason: string }) => drop.reason === "invalid-scene").length, 3);
});

test("replay directions bind record, reason, and clip bounds to their tour step", () => {
  const base = validReplayFixture();
  assert.deepEqual(validateReplayFixture(base), { ok: true, errors: [] });

  for (const mutate of [
    (fixture: ReturnType<typeof validReplayFixture>) => { fixture.tour.steps[0].recordId = "different-record"; },
    (fixture: ReturnType<typeof validReplayFixture>) => { fixture.tour.steps[0].why = "A different reason"; },
  ]) {
    const changed = structuredClone(base);
    mutate(changed);
    assert.ok(validateReplayFixture(changed).errors.some((error: string) => /different record or why identity/.test(error)));
  }

  const changedBounds = structuredClone(base);
  changedBounds.tour.steps[0].startSec = 11;
  changedBounds.tour.totalSeconds = 59;
  assert.ok(validateReplayFixture(changedBounds).errors.some((error: string) => /different clip bounds/.test(error)));

  const whyPrefix = "w".repeat(MAGIC_DIRECTOR_WHY_MAX_CHARS);
  const longWhy = structuredClone(base);
  longWhy.tour.steps[0].why = `${whyPrefix}first suffix`;
  const requestIdentity = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    modelKey: MAGIC_MODEL_KEY,
    recordId: longWhy.tour.steps[0].recordId,
    fromSec: longWhy.tour.steps[0].startSec,
    toSec: longWhy.tour.steps[0].endSec,
    why: longWhy.tour.steps[0].why,
  };
  longWhy.directions["step-1"].requestFingerprint = directorRequestFingerprint(requestIdentity);
  longWhy.directions["step-1"].requestKey = directorCacheKey({ ...requestIdentity, transcriptHash: TRANSCRIPT_HASH });
  assert.deepEqual(validateReplayFixture(longWhy), { ok: true, errors: [] });
  const equivalentSuffix = structuredClone(longWhy);
  equivalentSuffix.tour.steps[0].why = `${whyPrefix}different suffix`;
  assert.deepEqual(validateReplayFixture(equivalentSuffix), { ok: true, errors: [] });
});

test("replay steps may share a request fingerprint only when their directions are contract-equal", () => {
  const base = validReplayFixture();
  const sharedDirection = validDirectorPayload();
  const shared = {
    ...base,
    tour: {
      ...base.tour,
      totalSeconds: 120,
      steps: [
        { ...base.tour.steps[0], id: "step-1" },
        { ...base.tour.steps[0], id: "step-2" },
      ],
    },
    whispers: ["The first shared direction", "The second shared direction"],
    directions: {
      "step-1": structuredClone(sharedDirection),
      "step-2": structuredClone(sharedDirection),
    },
  };
  assert.deepEqual(validateReplayFixture(shared), { ok: true, errors: [] });

  const divergent = structuredClone(shared);
  divergent.directions["step-2"] = validDirectorPayload({
    beats: [visualBeat({
      id: "divergent-term",
      proposalId: "p-divergent-term",
      kind: "term",
      at: 20,
    })],
  });
  assert.equal(
    divergent.directions["step-1"].requestFingerprint,
    divergent.directions["step-2"].requestFingerprint,
  );
  assert.deepEqual(validateDirectorPayload(divergent.directions["step-1"]), { ok: true, errors: [] });
  assert.deepEqual(validateDirectorPayload(divergent.directions["step-2"]), { ok: true, errors: [] });
  assert.deepEqual(validateReplayFixture(divergent), {
    ok: false,
    errors: ["directions[step-2] conflicts with directions[step-1] for the same requestFingerprint"],
  });
});

test("v1 director and replay shapes upgrade deterministically without inventing missing evidence", () => {
  const legacyDirection = validLegacyDirectorPayload();
  const first = upgradeDirectorPayload(legacyDirection);
  const second = upgradeDirectorPayload(legacyDirection);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, MAGIC_DIRECTOR_SCHEMA_VERSION);
  assert.equal(first.policyVersion, MAGIC_DIRECTOR_POLICY_VERSION);
  assert.equal(first.migration.fromSchemaVersion, 1);
  assert.equal(first.metrics.outcomes.completeness, "legacy-survivors-only");
  assert.equal(first.metrics.outcomes.proposed, null);
  assert.equal(first.metrics.outcomes.rejected, null);
  assert.equal(first.beats.length, 1);
  assert.deepEqual(first.beats[0].data.words, ["first", "last"]);
  assert.ok(first.scenes.every((scene: Record<string, unknown>) => !Object.hasOwn(scene, "groups")));
  assert.deepEqual(validateDirectorPayload(first), { ok: true, errors: [] });

  const legacyReplay = validLegacyReplayFixture();
  const replayA = upgradeReplayFixture(legacyReplay);
  const replayB = upgradeReplayFixture(legacyReplay);
  assert.deepEqual(replayA, replayB);
  assert.equal(replayA.schemaVersion, MAGIC_REPLAY_SCHEMA_VERSION);
  assert.equal(replayA.policyVersion, MAGIC_DIRECTOR_POLICY_VERSION);
  assert.deepEqual(replayA.tour.steps.map((step: { id: string }) => step.id), ["step-1"]);
  assert.deepEqual(Object.keys(replayA.directions), ["step-1"]);
  assert.deepEqual(validateReplayFixture(replayA), { ok: true, errors: [] });
  assert.throws(() => upgradeDirectorPayload({ ...legacyDirection, schemaVersion: 99 }), /newer than supported/);
  assert.throws(() => upgradeReplayFixture({ ...legacyReplay, schemaVersion: 99 }), /newer than supported/);
});

test("v1 migration preserves counters and drop multiplicity while refusing lossy members and positional replay fallback", () => {
  const legacy = validLegacyDirectorPayload();
  const duplicateDrop = { id: "legacy-drop", kind: "group", reason: "semantic-rejection", count: 1 };
  legacy.metrics.normalization = {
    ...legacy.metrics.normalization,
    shifted: 2,
    clamped: 3,
    invented: 4,
    dropped: [duplicateDrop, structuredClone(duplicateDrop)],
  };
  const upgraded = upgradeDirectorPayload(legacy);
  assert.equal(upgraded.metrics.normalization.shifted, 2);
  assert.equal(upgraded.metrics.normalization.clamped, 3);
  assert.equal(upgraded.metrics.normalization.invented, 4);
  assert.deepEqual(upgraded.metrics.normalization.dropped, [duplicateDrop, duplicateDrop]);
  assert.equal(upgraded.migration.normalizationEvidencePreserved, true);

  const nullScene = validLegacyDirectorPayload();
  nullScene.scenes = [null];
  assert.throws(() => upgradeDirectorPayload(nullScene), /legacy director scene 0 cannot be migrated without loss/);
  const nullArtifact = validLegacyDirectorPayload();
  nullArtifact.scenes[0].groups = [null];
  assert.throws(() => upgradeDirectorPayload(nullArtifact), /scene 0\.groups\[0\] cannot be migrated without loss/);
  const malformedSingleton = validLegacyDirectorPayload();
  malformedSingleton.scenes[0].compare = "not-an-object";
  assert.throws(() => upgradeDirectorPayload(malformedSingleton), /scene 0\.compare cannot be migrated without loss/);

  const positional = validLegacyReplayFixture();
  const direction = structuredClone(Object.values(positional.directions)[0]);
  direction.requestKey = "positional-only";
  positional.directions = { "positional-only": direction };
  assert.throws(() => upgradeReplayFixture(positional), /does not have one deterministic identity match/);
});

test("every checked-in v1 director record remains readable through the deterministic migration", () => {
  const directorRunsUrl = new URL("../lab/tour-lab/director-runs/", import.meta.url);
  const legacyRecords = readdirSync(directorRunsUrl)
    .filter((file) => file.endsWith(".json"))
    .map((file) => ({
      file,
      stored: JSON.parse(readFileSync(new URL(file, directorRunsUrl), "utf8")),
    }))
    .filter(({ stored }) => (stored.result || stored).schemaVersion === 1);
  assert.ok(legacyRecords.length > 0, "the compatibility sweep needs saved v1 evidence");

  for (const { file, stored } of legacyRecords) {
    let upgraded: ReturnType<typeof upgradeDirectorPayload> | null = null;
    assert.doesNotThrow(() => { upgraded = upgradeDirectorPayload(stored.result || stored); }, file);
    assert.equal(upgraded?.migration.fromSchemaVersion, 1, file);
    assert.deepEqual(validateDirectorPayload(upgraded), { ok: true, errors: [] }, file);
  }
});

test("both checked-in replays are strict v2 and the zero-cost atlas covers all nine flat beat kinds", () => {
  const listed = listReplayFixtures();
  assert.ok(listed.some((fixture: { id: string }) => fixture.id === "revelation-1-pastoral-center"));
  assert.ok(listed.some((fixture: { id: string }) => fixture.id === "visual-artifact-atlas"));

  for (const id of ["revelation-1-pastoral-center", "visual-artifact-atlas"]) {
    const raw = JSON.parse(readFileSync(new URL(`../lab/tour-lab/replays/${id}.json`, import.meta.url), "utf8"));
    assert.equal(raw.schemaVersion, MAGIC_REPLAY_SCHEMA_VERSION);
    assert.equal(raw.policyVersion, MAGIC_DIRECTOR_POLICY_VERSION);
    assert.deepEqual(validateReplayFixture(raw), { ok: true, errors: [] });
    assert.ok(raw.tour.steps.every((step: { id?: string }) => typeof step.id === "string"));
    assert.ok(Object.values(raw.directions).every((direction: any) => (
      direction.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION
        && direction.policyVersion === MAGIC_DIRECTOR_POLICY_VERSION
        && Array.isArray(direction.beats)
        && direction.scenes.every((scene: Record<string, unknown>) => !Object.hasOwn(scene, "groups"))
    )));
  }

  const { fixture: atlas, errors } = readReplayFixture("visual-artifact-atlas");
  assert.deepEqual(errors, []);
  assert.ok(atlas);
  assert.equal(atlas.provenance, "house-qa");
  const directions = Object.values(atlas.directions) as Array<{ beats: Array<{ kind: string }>; metrics: { passes: number } }>;
  assert.ok(directions.every((direction) => direction.metrics.passes === 0));
  const kinds = new Set(directions.flatMap((direction) => direction.beats.map((beat) => beat.kind)));
  assert.deepEqual([...kinds].sort(), [...DIRECTOR_ARTIFACT_KINDS].sort());
});

test("v2 evidence is redacted and append-only while legacy evidence upgrades only in memory", () => {
  assert.deepEqual(
    redactEvidence({
      apiKey: "key-value",
      nested: {
        authorization: "Bearer credential",
        bearer: "credential",
        accessToken: "credential",
        promptTokens: 42,
        message: "request failed with Bearer abcdefghijklmnop",
      },
    }),
    {
      apiKey: "[redacted]",
      nested: {
        authorization: "[redacted]",
        bearer: "[redacted]",
        accessToken: "[redacted]",
        promptTokens: 42,
        message: "request failed with [redacted]",
      },
    },
  );

  const root = mkdtempSync(join(tmpdir(), "quire-magic-contract-"));
  const runsDir = join(root, "director-runs");
  const replayDir = join(root, "replays");
  const roleDir = join(root, "role-runs");
  try {
    const result = validDirectorPayload();
    const record = {
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
      startedAt: "2026-08-02T12:34:56.789Z",
      requestKey: result.requestKey,
      request: {
        schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
        policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
        model: MAGIC_MODEL_KEY,
        recordId: "fixture-record",
        fromSec: result.clip.fromSec,
        toSec: result.clip.toSec,
        why: WHY,
        transcriptHash: result.clip.transcriptHash,
        requestFingerprint: result.requestFingerprint,
        budget: result.budget,
        apiKey: "must-not-land",
        headers: { authorization: "Bearer must-not-land" },
      },
      result,
    };
    const first = writeDirectorEvidence(record, { dir: runsDir });
    const second = writeDirectorEvidence(record, { dir: runsDir });
    assert.notEqual(first, second);
    assert.match(basename(second), /-1\.json$/);
    assert.equal(listDirectorEvidence({ dir: runsDir }).length, 2);
    const read = readDirectorEvidence(basename(first), { dir: runsDir });
    assert.equal(read?.request.apiKey, "[redacted]");
    assert.equal(read?.request.headers.authorization, "[redacted]");
    assert.equal(read?.effectiveSchemaVersion, MAGIC_DIRECTOR_SCHEMA_VERSION);
    assert.equal(read?.evidenceReadStatus, "ready");
    assert.throws(() => writeDirectorEvidence({ ...record, schemaVersion: 1 }, { dir: runsDir }), /not supported for writes/);
    assert.throws(
      () => writeDirectorEvidence({ ...record, policyVersion: "magic-director-2" }, { dir: runsDir }),
      /not supported for writes/,
    );
    assert.throws(
      () => writeDirectorEvidence({ ...record, requestKey: `${record.requestKey}-contradiction` }, { dir: runsDir }),
      /contradictory director evidence envelope/,
    );
    assert.throws(
      () => writeDirectorEvidence({
        ...record,
        request: { ...record.request, budget: { ...record.request.budget, hardBeatCeiling: 999 } },
      }, { dir: runsDir }),
      /contradictory director evidence envelope/,
    );
    assert.throws(
      () => writeDirectorEvidence({
        ...record,
        status: "refused",
        calls: [validCall()],
        error: { message: "contradictory outcome" },
      }, { dir: runsDir }),
      /refusal evidence cannot carry a result/,
    );
    for (const [field, value] of [
      ["recordId", "another-record"],
      ["fromSec", 11],
      ["toSec", 69],
      ["why", "A different direction"],
    ] as const) {
      assert.throws(
        () => writeDirectorEvidence({
          ...record,
          request: { ...record.request, [field]: value },
        }, { dir: runsDir }),
        /contradictory director evidence envelope/,
      );
    }

    const allusionResult = validDirectorPayload({ beats: [visualBeat({ kind: "allusion" })] });
    allusionResult.beats[0].data.text = "A fictitious rendering that is not the bundled WEB text.";
    assert.equal(validateDirectorPayload(allusionResult).ok, true, "browser-safe validation is intentionally not the canonical I/O gate");
    assert.throws(() => writeDirectorEvidence({
      ...record,
      requestKey: allusionResult.requestKey,
      request: {
        ...record.request,
        transcriptHash: allusionResult.clip.transcriptHash,
        requestFingerprint: allusionResult.requestFingerprint,
        budget: allusionResult.budget,
      },
      result: allusionResult,
    }, { dir: runsDir }), /non-canonical director evidence/);

    const legacyStored = {
      schemaVersion: 1,
      startedAt: "2026-08-01T00:00:00.000Z",
      requestKey: validLegacyDirectorPayload().requestKey,
      request: {
        schemaVersion: 1,
        model: MAGIC_MODEL_KEY,
        recordId: "fixture-record",
        fromSec: 10,
        toSec: 70,
        why: WHY,
      },
      result: validLegacyDirectorPayload(),
    };
    const legacyFile = join(runsDir, "legacy.json");
    const legacyText = `${JSON.stringify(legacyStored, null, 2)}\n`;
    writeFileSync(legacyFile, legacyText, { flag: "wx" });
    const upgradedRead = readDirectorEvidence("legacy.json", { dir: runsDir });
    assert.equal(upgradedRead?.result.schemaVersion, MAGIC_DIRECTOR_SCHEMA_VERSION);
    assert.equal(upgradedRead?.result.migration.fromSchemaVersion, 1);
    assert.equal(readFileSync(legacyFile, "utf8"), legacyText, "read-time migration must not rewrite append-only evidence");

    const corruptDirectorText = "{ definitely not JSON\n";
    writeFileSync(join(runsDir, "corrupt.json"), corruptDirectorText, { flag: "wx" });
    const futureOuter = { ...record, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1 };
    const futureNested = {
      ...record,
      result: { ...record.result, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1 },
    };
    const contradictoryStored = {
      ...record,
      request: { ...record.request, recordId: "contradictory-record" },
    };
    const contradictoryOutcome = {
      ...record,
      status: "refused",
      calls: [validCall()],
      error: { message: "contradictory outcome" },
    };
    const contradictoryLegacyWhy = {
      ...legacyStored,
      request: { ...legacyStored.request, why: "A different legacy direction" },
    };
    const contradictoryLegacySchema = {
      ...legacyStored,
      request: { ...legacyStored.request, schemaVersion: 999 },
    };
    const supersededPolicy = {
      ...record,
      policyVersion: "magic-director-2",
      request: { ...record.request, policyVersion: "magic-director-2" },
      result: { ...record.result, policyVersion: "magic-director-2" },
    };
    writeFileSync(join(runsDir, "future-outer.json"), `${JSON.stringify(futureOuter)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "future-nested.json"), `${JSON.stringify(futureNested)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "contradictory.json"), `${JSON.stringify(contradictoryStored)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "contradictory-outcome.json"), `${JSON.stringify(contradictoryOutcome)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "contradictory-legacy-why.json"), `${JSON.stringify(contradictoryLegacyWhy)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "contradictory-legacy-schema.json"), `${JSON.stringify(contradictoryLegacySchema)}\n`, { flag: "wx" });
    writeFileSync(join(runsDir, "superseded-policy.json"), `${JSON.stringify(supersededPolicy)}\n`, { flag: "wx" });
    assert.equal(readDirectorEvidence("corrupt.json", { dir: runsDir })?.refusal.code, "corrupt-json");
    assert.equal(readDirectorEvidence("future-outer.json", { dir: runsDir })?.refusal.code, "future-schema");
    assert.equal(readDirectorEvidence("future-nested.json", { dir: runsDir })?.refusal.code, "future-schema");
    assert.equal(readDirectorEvidence("contradictory.json", { dir: runsDir })?.refusal.code, "invalid-envelope");
    assert.equal(readDirectorEvidence("contradictory-outcome.json", { dir: runsDir })?.refusal.code, "invalid-outcome");
    assert.equal(readDirectorEvidence("contradictory-legacy-why.json", { dir: runsDir })?.refusal.code, "invalid-envelope");
    assert.equal(readDirectorEvidence("contradictory-legacy-schema.json", { dir: runsDir })?.refusal.code, "invalid-envelope");
    assert.equal(readDirectorEvidence("superseded-policy.json", { dir: runsDir })?.refusal.code, "superseded-policy");
    assert.equal(readFileSync(join(runsDir, "corrupt.json"), "utf8"), corruptDirectorText);
    const directorList = listDirectorEvidence({ dir: runsDir, limit: 20 });
    assert.equal(directorList.length, 11, "corrupt, future, superseded, and contradictory records remain visible as explicit refusals");
    assert.equal(directorList.filter((entry: { evidenceReadStatus: string }) => entry.evidenceReadStatus === "refused").length, 8);

    const roleCall = { ...validCall(), role: "whispers" };
    const roleMetrics = {
      wallMs: 12,
      passes: 1,
      totalUsd: 0.001,
      calls: [roleCall],
      tokens: { prompt: 20, completion: 8, reasoning: 3, cachedPrompt: 0 },
    };
    const roleRecord = {
      role: "whispers",
      startedAt: "2026-08-02T12:34:56.789Z",
      request: { stepCount: 1, stepsHash: stableTextHash("fixture steps") },
      model: validModelEvidence(),
      metrics: roleMetrics,
      result: { whispers: ["Listen for the local fixture"] },
    };
    assert.equal(validateMagicRoleEvidence(roleRecord).ok, true);
    const firstRole = writeMagicRoleEvidence(roleRecord, { dir: roleDir });
    writeMagicRoleEvidence(roleRecord, { dir: roleDir });
    assert.equal(listMagicRoleEvidence({ dir: roleDir }).length, 2);
    assert.equal(readMagicRoleEvidence(basename(firstRole), { dir: roleDir })?.evidenceReadStatus, "ready");
    assert.throws(
      () => writeMagicRoleEvidence({ ...roleRecord, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1 }, { dir: roleDir }),
      /not supported for writes/,
    );
    const contradictoryRole = {
      ...roleRecord,
      metrics: {
        ...roleRecord.metrics,
        calls: [{ ...roleCall, role: "form" }],
      },
      result: { form: "path", waypoints: [] },
    };
    assert.throws(
      () => writeMagicRoleEvidence(contradictoryRole, { dir: roleDir }),
      /invalid role result/,
    );
    const dualRole = {
      ...roleRecord,
      result: {
        ...roleRecord.result,
        form: "path",
        waypoints: [{ step: 0, marker: "Start" }],
      },
    };
    assert.throws(
      () => writeMagicRoleEvidence(dualRole, { dir: roleDir }),
      /cannot also carry form result fields/,
    );
    const futureRole = { ...roleRecord, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION + 1 };
    const invalidRole = {
      ...roleRecord,
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
      metrics: { ...roleRecord.metrics, totalUsd: 99 },
    };
    writeFileSync(join(roleDir, "future-role.json"), `${JSON.stringify(futureRole)}\n`, { flag: "wx" });
    writeFileSync(join(roleDir, "invalid-role.json"), `${JSON.stringify(invalidRole)}\n`, { flag: "wx" });
    writeFileSync(join(roleDir, "contradictory-role.json"), `${JSON.stringify({
      ...contradictoryRole,
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    })}\n`, { flag: "wx" });
    writeFileSync(join(roleDir, "dual-role.json"), `${JSON.stringify({
      ...dualRole,
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    })}\n`, { flag: "wx" });
    assert.equal(readMagicRoleEvidence("future-role.json", { dir: roleDir })?.refusal.code, "future-schema");
    assert.equal(readMagicRoleEvidence("invalid-role.json", { dir: roleDir })?.refusal.code, "invalid-role-evidence");
    assert.equal(readMagicRoleEvidence("contradictory-role.json", { dir: roleDir })?.refusal.code, "invalid-role-evidence");
    assert.equal(readMagicRoleEvidence("dual-role.json", { dir: roleDir })?.refusal.code, "invalid-role-evidence");
    assert.equal(listMagicRoleEvidence({ dir: roleDir, limit: 20 }).length, 6, "invalid role evidence is classified, not hidden");

    const fixture = { ...validReplayFixture(), secret: "must-not-land" };
    const fixtureFile = writeReplayFixture(fixture, { dir: replayDir });
    assert.equal(basename(fixtureFile), `${fixture.id}.json`);
    const replay = readReplayFixture(fixture.id, { dir: replayDir });
    assert.deepEqual(replay.errors, []);
    assert.equal(replay.fixture?.secret, "[redacted]");
    assert.deepEqual(replay.fixture?.directions, fixture.directions);
    const nonCanonicalReplay = structuredClone(validReplayFixture());
    nonCanonicalReplay.directions["step-1"].scenes[0].ref = "Revelation 1:18";
    nonCanonicalReplay.directions["step-1"].scenes[0].verses[0].verse = 18;
    assert.equal(validateReplayFixture(nonCanonicalReplay).ok, true);
    assert.throws(
      () => writeReplayFixture({ ...nonCanonicalReplay, id: "non-canonical-replay" }, { dir: replayDir }),
      /non-canonical replay fixture/,
    );
    assert.throws(() => writeReplayFixture(fixture, { dir: replayDir }), (error: unknown) => (
      error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST"
    ));
    assert.throws(() => writeReplayFixture(validLegacyReplayFixture(), { dir: replayDir }), /replay schema 1 is not supported/);
    assert.equal(readDirectorEvidence("..", { dir: runsDir }), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("director jobs coalesce in flight, cache validated completions, and retire only owned entries", async () => {
  const jobs = createSharedDirectorJobs({ maxCompleted: 2 });
  let starts = 0;
  let signal: AbortSignal | null = null;
  let resolveWork: ((value: { value: number }) => void) | null = null;
  const create = async (nextSignal: AbortSignal) => {
    starts += 1;
    signal = nextSignal;
    return await new Promise<{ value: number }>((resolve) => { resolveWork = resolve; });
  };

  const first = jobs.acquire("same", create);
  const second = jobs.acquire("same", () => { throw new Error("duplicate job started"); });
  await Promise.resolve();
  assert.equal(starts, 1);
  assert.equal(first.cacheState, "miss");
  assert.equal(second.cacheState, "inflight");
  first.release();
  assert.equal(signal?.aborted, false);
  assert.ok(resolveWork);
  resolveWork({ value: 7 });
  assert.deepEqual(await first.promise, { value: 7 });
  assert.deepEqual(await second.promise, { value: 7 });
  second.release();

  const replayed = jobs.acquire("same", () => { throw new Error("completed result was not cached"); });
  assert.equal(replayed.cacheState, "completed");
  assert.deepEqual(await replayed.promise, { value: 7 });
  assert.equal(starts, 1);

  const cache = new Map<string, object>();
  const stale = {};
  const fresh = {};
  cache.set("same", fresh);
  assert.equal(retireOwnedDirectorEntry(cache, "same", stale), false);
  assert.equal(cache.get("same"), fresh);
  assert.equal(retireOwnedDirectorEntry(cache, "same", fresh), true);
  assert.equal(cache.has("same"), false);
});

test("server source locks action-first examples, one batched fill, policy/hash identity, and no Sol", () => {
  const serverSource = readFileSync(new URL("../lab/tour-lab/server.mjs", import.meta.url), "utf8");
  const clientSource = readFileSync(new URL("../lab/tour-lab/magic.js", import.meta.url), "utf8");
  const contractSource = readFileSync(new URL("../lab/tour-lab/magic-contract.mjs", import.meta.url), "utf8");

  assert.match(serverSource, /Classify the teacher's action before choosing a visual/);
  assert.match(serverSource, /complete compact thoughts/);
  assert.match(serverSource, /the house accepts copy whole or refuses it/);
  assert.doesNotMatch(serverSource, /\.slice\(0, (?:18|48|60|69|70|90)\)/);
  assert.match(serverSource, /words must be a JSON array of exactly 2-4 items/);
  assert.match(serverSource, /Every item must be one exact single word copied from the displayed passage/);
  assert.match(clientSource, /function completeEditorialDisplay/);
  assert.match(clientSource, /function wordBoundaryExcerpt/);
  assert.doesNotMatch(clientSource, /cappedEditorialDisplay/);
  assert.match(clientSource, /function firstCompleteSentence/);
  assert.match(clientSource, /function bookendTitleMarkup/);
  assert.doesNotMatch(clientSource, /truncateEditorialCopy/);
  assert.match(clientSource, /is-stage-reference/);
  assert.match(serverSource, /GROUP is only the fallback for a genuine pattern/);
  assert.ok(serverSource.includes('For COMPARE, axis must be exactly "likeness" or "difference".'));
  assert.match(serverSource, /flat chronological beat/);
  for (const kind of DIRECTOR_ARTIFACT_KINDS) {
    assert.match(serverSource, new RegExp(`- ${kind.toUpperCase()}: \\{`), `missing positive ${kind} example`);
  }
  assert.match(serverSource, /The editorial target is about \$\{budget\.targetThoughtEntrances\} grounded visual entrances/);
  assert.match(serverSource, /the absolute hard maximum is \$\{budget\.hardBeatCeiling\}/);
  assert.match(serverSource, /HIGHLIGHT IS RARE: zero is normal/);
  assert.match(serverSource, /teacher-authored sentence that distills the teacher's own interpretive thesis/);
  assert.match(
    serverSource,
    /Never highlight a Scripture quotation or paraphrase, biblical narration, setup, transition, application slogan, or ordinary exposition/,
  );
  assert.match(serverSource, /ONE batched fill pass/);
  assert.match(serverSource, /zero or one additional beat/);
  assert.ok(serverSource.includes(".map((beat) => `${beat.kind}@${Math.round(Number(beat.at) || 0)}s`)"));
  assert.match(serverSource, /ALREADY ACCEPTED BEATS: \$\{accepted\}/);
  assert.match(serverSource, /REMAINING HIGHLIGHT CAPACITY: \$\{remainingHighlights\} of \$\{budget\.highlightCeiling\}/);
  assert.match(serverSource, /Do not duplicate an accepted cue, teaching action, or visual already listed above; duplicates are rejected/);
  assert.match(serverSource, /reject\(proposal, 'gap-duplicate'\)/);
  assert.match(serverSource, /reject\(proposal, 'highlight-capacity-exhausted'\)/);
  assert.match(serverSource, /reject\(proposal, 'duplicate-existing-beat'\)/);
  assert.match(serverSource, /const cadence = currentSnapshot\.report\.visualCadence/);
  assert.doesNotMatch(serverSource, /const cadence = currentSnapshot\.report\.thoughtCadence/);
  assert.match(serverSource, /const makeHousePrelude = \(\) => \(\{\s*\.\.\.createDirectorHousePrelude\(\)/);
  assert.match(
    serverSource,
    /const portableFillBeforeFirstScene = pass === 'fill'[\s\S]{0,180}rawKind !== 'group' && rawKind !== 'footnote'/,
  );
  assert.match(
    serverSource,
    /if \(!owner && portableFillBeforeFirstScene\) \{[\s\S]{0,180}pendingPrelude = makeHousePrelude\(\);\s*owner = pendingPrelude/,
  );
  assert.match(
    serverSource,
    /if \(pendingPrelude\) \{\s*const committedPrelude = scenes\.find\(\(scene\) => scene\.origin === 'house-prelude'\)[\s\S]{0,260}scenes\.unshift\(pendingPrelude\)/,
  );
  const validateBeatSource = serverSource.slice(
    serverSource.indexOf("const validateBeat ="),
    serverSource.indexOf("const applyNormalization ="),
  );
  assert.ok(validateBeatSource.indexOf("pendingPrelude = makeHousePrelude()") >= 0);
  assert.ok(validateBeatSource.indexOf("if (pendingPrelude)") > validateBeatSource.indexOf("highlight-not-verbatim"));
  assert.equal((serverSource.match(/callModel\('fill'/g) || []).length, 1, "all qualified gaps share one fill call");
  assert.doesNotMatch(serverSource, /callModel\(`fill-/);
  assert.match(serverSource, /const transcriptHash = transcriptWindowHash\(segs\)/);
  assert.match(serverSource, /directorRequestFingerprint\(requestIdentity\)/);
  assert.match(serverSource, /directorCacheKey\(\{ \.\.\.requestIdentity, transcriptHash \}\)/);
  assert.match(clientSource, /directorRequestFingerprint\(/);
  assert.match(clientSource, /function requireValidDirection\(payload, expectedFingerprint = null\)/);
  assert.match(clientSource, /payload\.requestFingerprint !== expectedFingerprint/);
  assert.match(clientSource, /function cacheResolvedDirection[\s\S]*?requireValidDirection\(payload, key\)/);
  assert.match(clientSource, /function seedReplayDirections[\s\S]*?cacheResolvedDirection\(step, index, fixture\.directions\[step\.id\]\)/);
  assert.match(clientSource, /function fetchDirector[\s\S]*?requireValidDirection\(data, key\)/);
  assert.doesNotMatch(`${serverSource}\n${clientSource}\n${contractSource}`, /gpt-5\.6-sol/i);
});
