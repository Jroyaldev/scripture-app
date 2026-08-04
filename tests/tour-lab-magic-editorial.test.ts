import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  EDITORIAL_COMPONENTS,
  EDITORIAL_LIMITS,
  MAGIC_EDITORIAL_POLICY_VERSION,
  MAGIC_EDITORIAL_SCHEMA_VERSION,
  compileEditorialPlan,
  measureEditorialContinuity,
  resolveEditorialShot,
  truncateEditorialCopy,
  validateEditorialPlan,
} from "../lab/tour-lab/magic-editorial.mjs";
import { validateReplayFixture } from "../lab/tour-lab/magic-contract.mjs";

const scene = (id: string, at: number, passage = true) => ({
  id,
  origin: "model",
  ref: passage ? "Romans 1:16–17" : null,
  verses: passage ? [{ verse: 16, text: "For I am not ashamed of the Good News of Christ." }] : [],
  cue: "not ashamed of the Good News",
  at,
  timingSource: "cue",
});

const dataFor = (kind: string) => ({
  group: { words: ["ashamed", "Good News"], occurrences: [0, 0], wordTimes: [] },
  footnote: { word: "Good News", occurrence: 0, note: "The announced royal message." },
  term: { term: "euangelion", gloss: "Good News" },
  allusion: { ref: "Isaiah 52:7", text: "How beautiful on the mountains are the feet of him who brings good news!", note: "Paul echoes Isaiah." },
  compare: {
    a: { ref: "Romans 1:16", text: "For I am not ashamed of the Good News of Christ." },
    b: { ref: "Habakkuk 2:4", text: "But the righteous will live by his faith." },
    axis: "likeness",
    note: "The righteous life is by faith.",
  },
  chain: {
    links: [
      { ref: "Habakkuk 2:4", text: "But the righteous will live by his faith." },
      { ref: "Romans 1:17", text: "The righteous will live by faith." },
      { ref: "Galatians 3:11", text: "The righteous will live by faith." },
    ],
    note: "One line carried through Scripture.",
  },
  caveat: { text: "Paul is not embarrassed by the gospel." },
  aside: { text: "Rome is the imperial center of the letter's world." },
  highlight: { quote: "The righteous will live by faith." },
}[kind]);

const beat = (id: string, kind: string, at: number, sceneId = "scene-1") => ({
  id,
  proposalId: `proposal-${id}`,
  sceneId,
  kind,
  cue: "not ashamed of the Good News",
  at,
  timingSource: "cue",
  data: dataFor(kind),
});

test("editorial compiler maps all semantic kinds through a finite house registry", () => {
  const kinds = ["group", "footnote", "term", "allusion", "compare", "chain", "caveat", "aside", "highlight"];
  const direction = {
    scenes: [scene("scene-1", 0)],
    beats: kinds.map((kind, index) => beat(`beat-${kind}`, kind, 10 + index * 25)),
  };
  const plan = compileEditorialPlan(direction, { durationSec: 240, stepIndex: 0, stepCount: 1 });
  const check = validateEditorialPlan(plan, direction);
  assert.deepEqual(check, { ok: true, errors: [] });
  assert.equal(plan.schemaVersion, MAGIC_EDITORIAL_SCHEMA_VERSION);
  assert.equal(plan.policyVersion, MAGIC_EDITORIAL_POLICY_VERSION);
  assert.deepEqual(
    new Set(plan.shots.filter((shot: { role: string }) => shot.role === "semantic").map((shot: { semanticKind: string }) => shot.semanticKind)),
    new Set(kinds),
  );
  assert.deepEqual(
    new Set(Object.values(EDITORIAL_COMPONENTS).flatMap((entry: { kinds: readonly string[] }) => entry.kinds)),
    new Set(kinds),
  );
});

test("shots cover the clip once, resolve half-open boundaries, and never reveal a beat early", () => {
  const direction = {
    scenes: [scene("prelude", 0, false), scene("scene-1", 30), scene("scene-2", 90)],
    beats: [
      beat("term-a", "term", 18, "prelude"),
      beat("group-a", "group", 42, "scene-1"),
      beat("aside-a", "aside", 70, "scene-1"),
      beat("compare-a", "compare", 110, "scene-2"),
    ],
  };
  const plan = compileEditorialPlan(direction, { durationSec: 150, stepIndex: 1, stepCount: 3 });
  assert.deepEqual(validateEditorialPlan(plan, direction), { ok: true, errors: [] });
  assert.equal(plan.shots[0].fromSec, 0);
  assert.equal(plan.shots.at(-1)?.toSec, 150);
  plan.shots.slice(1).forEach((shot: { fromSec: number }, index: number) => {
    assert.equal(shot.fromSec, plan.shots[index].toSec);
  });
  for (const shot of plan.shots.filter((candidate: { role: string }) => candidate.role === "semantic")) {
    const source = direction.beats.find((candidate) => candidate.id === shot.sourceBeatIds[0]);
    assert.ok(source);
    assert.ok(shot.fromSec >= Number(source?.at));
  }
  for (const shot of plan.shots) {
    const sample = shot.fromSec + Math.min(0.05, (shot.toSec - shot.fromSec) / 2);
    assert.equal(resolveEditorialShot(plan, sample)?.id, shot.id);
    if (shot.toSec < plan.durationSec) assert.notEqual(resolveEditorialShot(plan, shot.toSec)?.id, shot.id);
  }
  assert.equal(resolveEditorialShot(plan, 150)?.id, plan.shots.at(-1)?.id);
});

test("same-time semantic actions serialize and stable sorting makes compilation deterministic", () => {
  const scenes = [scene("scene-2", 80), scene("scene-1", 0)];
  const beats = [
    beat("same-b", "caveat", 40),
    beat("late", "highlight", 110, "scene-2"),
    beat("same-a", "term", 40),
  ];
  const a = compileEditorialPlan({ scenes, beats }, { durationSec: 150 });
  const b = compileEditorialPlan({ scenes: [...scenes].reverse(), beats: [...beats].reverse() }, { durationSec: 150 });
  assert.deepEqual(a, b);
  const sameTimeShots = a.shots.filter((shot: { sourceBeatIds: string[] }) => shot.sourceBeatIds.includes("same-a") || shot.sourceBeatIds.includes("same-b"));
  sameTimeShots.slice(1).forEach((shot: { fromSec: number }, index: number) => {
    assert.ok(shot.fromSec >= sameTimeShots[index].toSec);
  });
});

test("a third contiguous family beat gets grounded passage or listening punctuation without an early reveal", () => {
  for (const [hasPassage, expectedComponent] of [[true, "PassageFrame"], [false, "ListeningFrame"]] as const) {
    const direction = {
      scenes: [scene("scene-1", 0, hasPassage)],
      beats: [20, 40, 60].map((at, index) => beat(`caveat-${index}`, "caveat", at)),
    };
    const plan = compileEditorialPlan(direction, { durationSec: 120 });
    assert.deepEqual(validateEditorialPlan(plan, direction), { ok: true, errors: [] });
    const punctuation = plan.shots.find((shot: { ruleId: string }) => shot.ruleId === "house-family-punctuation");
    assert.ok(punctuation);
    assert.equal(punctuation.component, expectedComponent);
    assert.equal(punctuation.toSec, 60);
    assert.ok(punctuation.toSec - punctuation.fromSec <= EDITORIAL_LIMITS.passageResolveSec);
    assert.deepEqual(punctuation.sourceBeatIds, ["caveat-1"]);
    assert.deepEqual(punctuation.sourceSceneIds, ["scene-1"]);
    assert.equal(punctuation.semanticKind, "caveat");
    const secondPhases = plan.shots.filter((shot: { role: string; sourceBeatIds: string[] }) => (
      shot.role === "semantic" && shot.sourceBeatIds[0] === "caveat-1"
    ));
    assert.deepEqual(secondPhases.map((shot: { phase: string }) => shot.phase), ["boundary", "claim"]);
    assert.ok(secondPhases.every((shot: { fromSec: number; toSec: number }) => shot.toSec > shot.fromSec));
    const third = plan.shots.find((shot: { role: string; sourceBeatIds: string[] }) => (
      shot.role === "semantic" && shot.sourceBeatIds[0] === "caveat-2"
    ));
    assert.equal(third?.fromSec, 60);
    assert.equal(plan.metrics.maxSameFamilyRun, 2);
  }
});

test("an impossible tenth-second collision is refused instead of silently accepted", () => {
  const direction = {
    scenes: [scene("scene-1", 0), scene("scene-2", 10.1)],
    beats: [
      beat("same-term", "term", 10, "scene-1"),
      beat("same-caveat", "caveat", 10, "scene-1"),
    ],
  };
  const plan = compileEditorialPlan(direction, { durationSec: 30 });
  assert.equal(plan.metrics.semanticBeatCount, 1);
  assert.match(validateEditorialPlan(plan, direction).errors.join("; "), /source beat .* is not represented/);
});

test("tenth-second rounding cannot exceed the hard semantic ceiling", () => {
  const direction = {
    scenes: [scene("scene-1", 0)],
    beats: [5, 10, 15, 20, 25].map((at, index) => beat(`dense-${index}`, "term", at)),
  };
  const plan = compileEditorialPlan(direction, { durationSec: 30 });
  assert.ok(plan.metrics.semanticOccupancy <= EDITORIAL_LIMITS.hardSemanticOccupancyMax);
  assert.equal(plan.metrics.gates.semanticOccupancyHard, true);
  assert.deepEqual(validateEditorialPlan(plan, direction), { ok: true, errors: [] });
});

test("rests are explicit, bounded, and quality metrics distinguish semantic occupancy from pacing", () => {
  const direction = {
    scenes: [scene("prelude", 0, false), scene("scene-1", 45), scene("scene-2", 150)],
    beats: [
      beat("term-1", "term", 20, "prelude"),
      beat("caveat-1", "caveat", 72, "scene-1"),
      beat("aside-1", "aside", 105, "scene-1"),
      beat("term-2", "term", 120, "scene-1"),
      beat("highlight-1", "highlight", 180, "scene-2"),
      beat("footnote-1", "footnote", 220, "scene-2"),
      beat("term-3", "term", 260, "scene-2"),
    ],
  };
  const plan = compileEditorialPlan(direction, { durationSec: 300 });
  const metrics = measureEditorialContinuity({ ...plan, scenes: direction.scenes });
  assert.equal(metrics.maxAccidentalGapSec, 0);
  assert.ok(metrics.maxExplicitRestSec <= EDITORIAL_LIMITS.maxExplicitRestSec);
  assert.ok(metrics.semanticOccupancy >= EDITORIAL_LIMITS.targetSemanticOccupancyMin);
  assert.ok(metrics.semanticOccupancy <= EDITORIAL_LIMITS.hardSemanticOccupancyMax);
  assert.ok(metrics.maxSameFamilyRun <= EDITORIAL_LIMITS.maxSameFamilyRun);
  assert.ok(metrics.focusShare <= EDITORIAL_LIMITS.maxFocusShare);
  assert.equal(metrics.sceneCoverage, 1);
  assert.equal(metrics.gates.accidentalGap, true);
  assert.equal(metrics.gates.explicitRest, true);
});

test("validation refuses overlap, orphan provenance, pre-cue reveal, and future policy", () => {
  const direction = { scenes: [scene("scene-1", 0)], beats: [beat("term", "term", 20)] };
  const valid = compileEditorialPlan(direction, { durationSec: 60 });
  const overlap = structuredClone(valid);
  overlap.shots[1].fromSec -= 1;
  assert.match(validateEditorialPlan(overlap, direction).errors.join("; "), /half-open boundary/);

  const orphan = structuredClone(valid);
  const semantic = orphan.shots.find((shot: { role: string }) => shot.role === "semantic");
  semantic.sourceBeatIds = ["missing"];
  assert.match(validateEditorialPlan(orphan, direction).errors.join("; "), /orphan beat/);

  const early = structuredClone(valid);
  const earlySemantic = early.shots.find((shot: { role: string }) => shot.role === "semantic");
  const previous = early.shots[early.shots.indexOf(earlySemantic) - 1];
  previous.toSec = 19;
  earlySemantic.fromSec = 19;
  assert.match(validateEditorialPlan(early, direction).errors.join("; "), /before its cue/);

  const future = structuredClone(valid);
  future.policyVersion = "magic-editorial-99";
  assert.match(validateEditorialPlan(future, direction).errors.join("; "), /policy/);

  const futureDirection = { ...direction, schemaVersion: 99, policyVersion: "magic-director-99" };
  assert.match(validateEditorialPlan(valid, futureDirection).errors.join("; "), /source director schema/);

  const forged = structuredClone(valid);
  const forgedSemantic = forged.shots.find((shot: { role: string }) => shot.role === "semantic");
  forgedSemantic.semanticKind = "highlight";
  forgedSemantic.component = "FocusFrame";
  forgedSemantic.family = "focus";
  forgedSemantic.sceneId = "ghost";
  assert.match(validateEditorialPlan(forged, direction).errors.join("; "), /semantic kind|component mapping|scene ownership/);

  const futureOwned = {
    scenes: [scene("scene-1", 0), scene("scene-2", 20)],
    beats: [beat("future-owned", "term", 10, "scene-2")],
  };
  const futureOwnedPlan = compileEditorialPlan(futureOwned, { durationSec: 40 });
  assert.match(validateEditorialPlan(futureOwnedPlan, futureOwned).errors.join("; "), /outside its owning scene/);
});

test("validation recomputes grounded callback opportunity instead of trusting a preferred-target claim", () => {
  const direction = {
    scenes: [scene("scene-1", 0)],
    beats: [beat("term-a", "term", 20), beat("aside-a", "aside", 70)],
  };
  const valid = compileEditorialPlan(direction, { durationSec: 120 });
  assert.deepEqual(validateEditorialPlan(valid, direction), { ok: true, errors: [] });
  const callbackIndex = valid.shots.findIndex((shot: { ruleId: string }) => shot.ruleId === "house-semantic-callback");
  assert.ok(callbackIndex >= 0);
  const underfilled = structuredClone(valid);
  const callback = underfilled.shots[callbackIndex];
  callback.role = "intentional-rest";
  callback.component = "PassageFrame";
  callback.family = "passage";
  callback.variant = "reading-wide";
  callback.phase = "hold";
  callback.ruleId = "house-rest-grid";
  callback.sourceBeatIds = [];
  callback.semanticKind = null;
  underfilled.metrics.gates.semanticOccupancyTargetOrExhausted = true;
  assert.match(
    validateEditorialPlan(underfilled, direction).errors.join("; "),
    /legal grounded callback unused/,
  );
  const measured = measureEditorialContinuity(
    { ...underfilled, scenes: direction.scenes, beats: direction.beats },
    direction,
  );
  assert.ok(measured.semanticOccupancy < EDITORIAL_LIMITS.targetSemanticOccupancyMin);
  assert.ok(measured.legalCallbackOpportunitySec >= EDITORIAL_LIMITS.callbackMinSec);
  assert.equal(measured.semanticTargetExhausted, false);
  assert.equal(measured.gates.semanticOccupancyTargetOrExhausted, false);
});

test("the saved 23-minute Romans tour recompiles without a provider into one bounded editorial system", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../lab/tour-lab/replays/romans-1-good-news-human-problem.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(validateReplayFixture(fixture), { ok: true, errors: [] });
  assert.equal(fixture.tour.steps.length, 5);

  let durationSec = 0;
  let semanticSec = 0;
  let focusSec = 0;
  const roles = new Set<string>();
  fixture.tour.steps.forEach((step: { id: string }, index: number) => {
    const direction = fixture.directions[step.id];
    const plan = compileEditorialPlan(direction, {
      durationSec: direction.clip.durationSec,
      stepIndex: index,
      stepCount: fixture.tour.steps.length,
    });
    assert.deepEqual(validateEditorialPlan(plan, direction), { ok: true, errors: [] });
    assert.equal(plan.metrics.semanticBeatCount, direction.beats.length);
    assert.ok(plan.metrics.semanticOccupancy >= EDITORIAL_LIMITS.targetSemanticOccupancyMin);
    assert.ok(plan.metrics.semanticOccupancy <= EDITORIAL_LIMITS.targetSemanticOccupancyMax);
    assert.equal(plan.metrics.maxAccidentalGapSec, 0);
    assert.ok(plan.metrics.maxExplicitRestSec <= EDITORIAL_LIMITS.maxExplicitRestSec);
    assert.ok(plan.metrics.maxSameFamilyRun <= EDITORIAL_LIMITS.maxSameFamilyRun);
    assert.equal(plan.metrics.sceneCoverage, 1);
    plan.shots.forEach((shot: { role: string }) => roles.add(shot.role));
    durationSec += plan.durationSec;
    semanticSec += plan.metrics.semanticSec;
    focusSec += plan.metrics.focusSec;
  });

  assert.equal(durationSec, 1396);
  assert.ok(semanticSec / durationSec >= EDITORIAL_LIMITS.targetSemanticOccupancyMin);
  assert.ok(semanticSec / durationSec <= EDITORIAL_LIMITS.targetSemanticOccupancyMax);
  assert.ok(focusSec / durationSec <= EDITORIAL_LIMITS.maxFocusShare);
  assert.ok(roles.has("opening"));
  assert.ok(roles.has("transition"));
  assert.ok(roles.has("closing"));
  assert.ok(roles.has("intentional-rest"));
});

test("all six checked-in Exodus directions satisfy hard gates and are preferred-target or grounded-exhausted", () => {
  const fixture = JSON.parse(readFileSync(
    new URL("../lab/tour-lab/replays/exodus-34-mercy-judgment.json", import.meta.url),
    "utf8",
  ));
  assert.deepEqual(validateReplayFixture(fixture), { ok: true, errors: [] });
  assert.equal(fixture.tour.steps.length, 6);

  let preferredCount = 0;
  let exhaustedCount = 0;
  let punctuationCount = 0;
  fixture.tour.steps.forEach((step: { id: string }, index: number) => {
    const direction = fixture.directions[step.id];
    const plan = compileEditorialPlan(direction, {
      durationSec: direction.clip.durationSec,
      stepIndex: index,
      stepCount: fixture.tour.steps.length,
    });
    assert.deepEqual(validateEditorialPlan(plan, direction), { ok: true, errors: [] });
    assert.equal(plan.shots[0].fromSec, 0);
    assert.equal(plan.shots.at(-1)?.toSec, direction.clip.durationSec);
    plan.shots.slice(1).forEach((shot: { fromSec: number }, shotIndex: number) => {
      assert.equal(shot.fromSec, plan.shots[shotIndex].toSec);
    });
    assert.equal(plan.metrics.semanticBeatCount, direction.beats.length);
    assert.equal(plan.metrics.gates.semanticOccupancyHard, true);
    assert.equal(plan.metrics.gates.accidentalGap, true);
    assert.equal(plan.metrics.gates.explicitRest, true);
    assert.equal(plan.metrics.gates.sameFamilyRun, true);
    assert.equal(plan.metrics.gates.focusShare, true);
    assert.equal(plan.metrics.gates.sceneCoverage, true);
    assert.equal(plan.metrics.gates.semanticOccupancyTargetOrExhausted, true);
    preferredCount += Number(plan.metrics.gates.semanticOccupancyTarget);
    exhaustedCount += Number(plan.metrics.semanticTargetExhausted);
    punctuationCount += plan.shots.filter((shot: { ruleId: string }) => (
      shot.ruleId === "house-family-punctuation"
    )).length;
  });

  assert.equal(preferredCount, 4);
  assert.equal(exhaustedCount, 2);
  assert.equal(punctuationCount, 0);
});

test("editorial copy truncation ends at sentence or word boundaries", () => {
  assert.equal(truncateEditorialCopy("available for his mission", 18), "available for his");
  assert.equal(truncateEditorialCopy("the two main categories", 18, { ellipsis: true }), "the two main…");
  assert.equal(truncateEditorialCopy("A complete sentence. Another thought follows.", 24), "A complete sentence.");
  assert.equal(truncateEditorialCopy("short copy", 24), "short copy");
  assert.equal(truncateEditorialCopy("supercalifragilisticexpialidocious", 8, { ellipsis: true }), "superca…");
  assert.equal(truncateEditorialCopy("a phrase cut at cap", 19, { ellipsis: true }), "a phrase cut at…");
});
