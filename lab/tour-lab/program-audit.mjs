#!/usr/bin/env node
// Whole-program film audit for the /magic theater.
//
// The evidence audit (audit-director-runs.mjs) measures saved Luna directions.
// This audit measures the VIEWER'S experience of a whole compiled program:
// where the film holds still, how the shot rhythm breathes, whether rests chop
// mechanically at the cap, whether one component loops, whether callbacks land
// near their source material, and whether scene titles arrive attached to the
// moment the teacher turns to the passage.
//
// Provider-free and deterministic: it reads named replay fixtures and
// recompiles them through magic-editorial.mjs, never touching a model, the
// corpus search, or the network.
//
//   node lab/tour-lab/program-audit.mjs                      # every named replay
//   node lab/tour-lab/program-audit.mjs exodus-34-mercy-judgment
//   node lab/tour-lab/program-audit.mjs --json exodus-34-mercy-judgment
//   node lab/tour-lab/program-audit.mjs --compare before.json after.json
//
// Reports write to output/program-audit/<replay-id>.{json,md}. Comparing two
// JSON reports prints the key-metric deltas a film review cares about.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EDITORIAL_LIMITS,
  compileEditorialPlan,
  validateEditorialPlan,
} from './magic-editorial.mjs';
import { listReplayFixtures, readReplayFixture } from './director-evidence.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(LAB_DIR, '..', '..');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'output', 'program-audit');

const round = (value, places = 1) => {
  const factor = 10 ** places;
  return Math.round((Number(value) + 0.000001) * factor) / factor;
};
const pct = (value) => round(value * 100, 1);
const median = (values) => {
  if (!values.length) return 0;
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 ? ordered[middle] : (ordered[middle - 1] + ordered[middle]) / 2;
};

const LENGTH_BUCKETS = [
  ['0-3s', 0, 3],
  ['3-6s', 3, 6],
  ['6-10s', 6, 10],
  ['10-15s', 10, 15],
  ['15-18s', 15, 18],
  ['over-18s', 18, Number.POSITIVE_INFINITY],
];

function lengthHistogram(lengths) {
  const histogram = Object.fromEntries(LENGTH_BUCKETS.map(([label]) => [label, 0]));
  for (const length of lengths) {
    const bucket = LENGTH_BUCKETS.find(([, low, high]) => length >= low - 0.0001 && length < high - 0.0001)
      || LENGTH_BUCKETS.at(-1);
    histogram[bucket[0]] += 1;
  }
  return histogram;
}

/* The viewer reads any stretch without a semantic foreground as one held
   stillness, however the compiler labelled the pieces. Merge consecutive
   non-semantic shots into the runs a viewer actually experiences. */
function stillnessRuns(shots) {
  const runs = [];
  for (const shot of shots) {
    if (shot.role === 'semantic') continue;
    const last = runs.at(-1);
    if (last && Math.abs(last.toSec - shot.fromSec) <= 0.0001) {
      last.toSec = shot.toSec;
      last.shotCount += 1;
    } else {
      runs.push({ fromSec: shot.fromSec, toSec: shot.toSec, shotCount: 1 });
    }
  }
  return runs.map((run) => ({ ...run, lengthSec: round(run.toSec - run.fromSec) }));
}

function longestRepeatRun(shots, keyOf) {
  let longest = { length: 0, key: null };
  let current = { length: 0, key: null };
  for (const shot of shots) {
    const key = keyOf(shot);
    if (key === current.key) {
      current.length += 1;
    } else {
      current = { length: 1, key };
    }
    if (current.length > longest.length) longest = { ...current };
  }
  return longest;
}

function bandAnalysis(shots, durationSec) {
  const bandCount = Math.max(1, Math.ceil(durationSec / 60));
  const bands = Array.from({ length: bandCount }, (_, index) => ({
    fromSec: index * 60,
    toSec: Math.min(durationSec, (index + 1) * 60),
    semanticEntrances: 0,
    semanticSec: 0,
  }));
  for (const shot of shots) {
    if (shot.role !== 'semantic') continue;
    const band = bands[Math.min(bandCount - 1, Math.floor(shot.fromSec / 60))];
    band.semanticEntrances += 1;
    for (const candidate of bands) {
      const overlap = Math.max(0, Math.min(shot.toSec, candidate.toSec) - Math.max(shot.fromSec, candidate.fromSec));
      candidate.semanticSec += overlap;
    }
  }
  return bands.map((band) => ({
    ...band,
    occupancy: round(band.semanticSec / Math.max(0.1, band.toSec - band.fromSec), 3),
  }));
}

function auditStep(step, direction, { stepIndex, stepCount }) {
  const durationSec = round(Number(step.endSec) - Number(step.startSec), 1);
  const plan = compileEditorialPlan(direction, { durationSec, stepIndex, stepCount });
  const check = validateEditorialPlan(plan, direction);
  const shots = [...plan.shots].sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec);
  const semantic = shots.filter((shot) => shot.role === 'semantic');
  const rests = shots.filter((shot) => shot.role === 'intentional-rest');
  const beatsById = new Map((direction?.beats || []).map((beat) => [beat.id, beat]));
  const scenesById = new Map((direction?.scenes || []).map((scene) => [scene.id, scene]));

  const lengths = shots.map((shot) => round(shot.toSec - shot.fromSec));
  const stillness = stillnessRuns(shots);
  const restLengths = rests.map((shot) => round(shot.toSec - shot.fromSec));
  const restVariants = rests.map((shot) => String(shot.variant || ''));
  let parityFlips = 0;
  for (let index = 1; index < restVariants.length; index += 1) {
    const before = restVariants[index - 1].endsWith('-wide') ? 'wide' : 'close';
    const after = restVariants[index].endsWith('-wide') ? 'wide' : 'close';
    if (before !== after) parityFlips += 1;
  }

  const componentRun = longestRepeatRun(shots, (shot) => shot.component);
  const variantRun = longestRepeatRun(shots, (shot) => `${shot.component}/${shot.variant}`);

  const bands = bandAnalysis(shots, durationSec);
  const fullBands = bands.filter((band) => band.toSec - band.fromSec >= 30);

  const callbacks = semantic
    .filter((shot) => shot.ruleId === 'house-semantic-callback')
    .map((shot) => {
      const beat = beatsById.get(shot.sourceBeatIds?.[0]);
      return {
        id: shot.id,
        kind: shot.semanticKind,
        fromSec: shot.fromSec,
        distanceFromSourceSec: beat ? round(shot.fromSec - Number(beat.at)) : null,
        sameScene: beat ? shot.sceneId === beat.sceneId : null,
      };
    });

  const arrivals = shots
    .filter((shot) => shot.role === 'scene-arrival')
    .map((shot) => {
      const scene = scenesById.get(shot.sourceSceneIds?.[0]);
      return {
        id: shot.id,
        sceneId: shot.sourceSceneIds?.[0] || null,
        fromSec: shot.fromSec,
        driftSec: scene ? round(shot.fromSec - Number(scene.at)) : null,
      };
    });
  const arrivedScenes = new Set(arrivals.map((arrival) => arrival.sceneId));

  const transitions = {};
  for (const shot of shots) transitions[shot.transition] = (transitions[shot.transition] || 0) + 1;

  const firstSemantic = semantic[0]?.fromSec ?? null;
  const lastSemanticEnd = semantic.length ? Math.max(...semantic.map((shot) => shot.toSec)) : null;

  return {
    stepId: step.id,
    title: step.episodeTitle,
    durationSec,
    valid: check.ok,
    errors: check.errors,
    gates: plan.metrics.gates,
    shotCount: shots.length,
    semanticShotCount: semantic.length,
    semanticOccupancy: plan.metrics.semanticOccupancy,
    focusShare: plan.metrics.focusShare,
    maxSameFamilyRun: plan.metrics.maxSameFamilyRun,
    firstSemanticAtSec: firstSemantic,
    closingStillnessSec: lastSemanticEnd == null ? durationSec : round(durationSec - lastSemanticEnd),
    stillness: {
      runs: stillness,
      longestSec: stillness.reduce((max, run) => Math.max(max, run.lengthSec), 0),
      runsOver20Sec: stillness.filter((run) => run.lengthSec > 20).length,
    },
    shotLengths: {
      min: lengths.length ? Math.min(...lengths) : 0,
      median: round(median(lengths)),
      mean: round(lengths.reduce((sum, value) => sum + value, 0) / Math.max(1, lengths.length)),
      max: lengths.length ? Math.max(...lengths) : 0,
      histogram: lengthHistogram(lengths),
    },
    rests: {
      count: rests.length,
      totalSec: round(restLengths.reduce((sum, value) => sum + value, 0)),
      exactCapCount: restLengths.filter((length) => Math.abs(length - EDITORIAL_LIMITS.maxExplicitRestSec) < 0.05).length,
      parityFlipRate: restVariants.length > 1 ? round(parityFlips / (restVariants.length - 1), 3) : null,
    },
    monotony: {
      longestSameComponentRun: componentRun,
      longestSameVariantRun: variantRun,
    },
    bands: {
      perMinute: bands,
      minEntrancesInFullBand: fullBands.length ? Math.min(...fullBands.map((band) => band.semanticEntrances)) : null,
      zeroEntranceFullBands: fullBands.filter((band) => band.semanticEntrances === 0).length,
      minOccupancyInFullBand: fullBands.length ? Math.min(...fullBands.map((band) => band.occupancy)) : null,
    },
    callbacks: {
      count: callbacks.length,
      meanDistanceFromSourceSec: callbacks.length
        ? round(callbacks.reduce((sum, callback) => sum + (callback.distanceFromSourceSec || 0), 0) / callbacks.length)
        : null,
      sameScenePct: callbacks.length
        ? pct(callbacks.filter((callback) => callback.sameScene).length / callbacks.length)
        : null,
      detail: callbacks,
    },
    sceneArrivals: {
      count: arrivals.length,
      scenesWithoutArrival: (direction?.scenes || []).filter((scene) => !arrivedScenes.has(scene.id)).length,
      maxDriftSec: arrivals.length ? Math.max(...arrivals.map((arrival) => arrival.driftSec ?? 0)) : null,
      meanDriftSec: arrivals.length
        ? round(arrivals.reduce((sum, arrival) => sum + (arrival.driftSec || 0), 0) / arrivals.length)
        : null,
      detail: arrivals,
    },
    transitions,
  };
}

function auditReplay(id) {
  const { fixture, errors } = readReplayFixture(id);
  if (!fixture) return { id, errors, steps: [], program: null };
  const steps = fixture.tour.steps.map((step, stepIndex) => auditStep(
    step,
    fixture.directions[step.id],
    { stepIndex, stepCount: fixture.tour.steps.length },
  ));
  const ready = steps.filter((step) => step.valid);
  const allShots = steps.flatMap((step) => step.stillness.runs.map((run) => ({ step: step.stepId, ...run })));
  const totalDuration = round(steps.reduce((sum, step) => sum + step.durationSec, 0));
  const totalShots = steps.reduce((sum, step) => sum + step.shotCount, 0);
  const allRests = steps.reduce((sum, step) => sum + step.rests.count, 0);
  const exactCaps = steps.reduce((sum, step) => sum + step.rests.exactCapCount, 0);
  const transitions = {};
  for (const step of steps) {
    for (const [transition, count] of Object.entries(step.transitions)) {
      transitions[transition] = (transitions[transition] || 0) + count;
    }
  }
  return {
    id,
    errors,
    provenance: fixture.provenance || null,
    title: fixture.tour.title,
    steps,
    program: {
      stepCount: steps.length,
      validSteps: ready.length,
      allPlansValid: ready.length === steps.length,
      totalDurationSec: totalDuration,
      totalShots,
      shotEntrancesPerMinute: round(totalShots / Math.max(0.1, totalDuration / 60), 2),
      semanticEntrancesPerMinute: round(
        steps.reduce((sum, step) => sum + step.semanticShotCount, 0) / Math.max(0.1, totalDuration / 60),
        2,
      ),
      longestStillnessSec: allShots.reduce((max, run) => Math.max(max, run.lengthSec), 0),
      stillnessRunsOver20Sec: allShots.filter((run) => run.lengthSec > 20).length,
      stillnessRunsOver30Sec: allShots.filter((run) => run.lengthSec > 30).length,
      restExactCapShare: allRests ? round(exactCaps / allRests, 3) : null,
      zeroEntranceFullBands: steps.reduce((sum, step) => sum + step.bands.zeroEntranceFullBands, 0),
      longestSameComponentRun: steps.reduce(
        (max, step) => (step.monotony.longestSameComponentRun.length > max.length ? step.monotony.longestSameComponentRun : max),
        { length: 0, key: null },
      ),
      longestSameVariantRun: steps.reduce(
        (max, step) => (step.monotony.longestSameVariantRun.length > max.length ? step.monotony.longestSameVariantRun : max),
        { length: 0, key: null },
      ),
      callbackCount: steps.reduce((sum, step) => sum + step.callbacks.count, 0),
      maxArrivalDriftSec: steps.reduce((max, step) => Math.max(max, step.sceneArrivals.maxDriftSec ?? 0), 0),
      scenesWithoutArrival: steps.reduce((sum, step) => sum + step.sceneArrivals.scenesWithoutArrival, 0),
      transitions,
    },
  };
}

function markdownReport(report) {
  const lines = [];
  lines.push(`# Program film audit — ${report.id}`);
  lines.push('');
  if (report.errors?.length) {
    lines.push(`REFUSED: ${report.errors.join('; ')}`);
    return lines.join('\n');
  }
  const program = report.program;
  lines.push(`${report.title} — ${program.stepCount} steps, ${Math.floor(program.totalDurationSec / 60)}:${String(Math.round(program.totalDurationSec % 60)).padStart(2, '0')}, ${program.totalShots} shots, provenance ${report.provenance || 'unknown'}.`);
  lines.push('');
  lines.push('## Whole-program read');
  lines.push('');
  lines.push('| Metric | Value | Film question it answers |');
  lines.push('|---|---:|---|');
  lines.push(`| Shot entrances / minute | ${program.shotEntrancesPerMinute} | Does the cut breathe or metronome? |`);
  lines.push(`| Semantic entrances / minute | ${program.semanticEntrancesPerMinute} | How often something new to think about |`);
  lines.push(`| Longest stillness | ${program.longestStillnessSec}s | The longest the viewer waits with nothing new |`);
  lines.push(`| Stillness runs over 20s / 30s | ${program.stillnessRunsOver20Sec} / ${program.stillnessRunsOver30Sec} | Accidental-feeling holds |`);
  lines.push(`| Rests chopped at exactly the cap | ${(program.restExactCapShare == null ? '—' : `${pct(program.restExactCapShare)}%`)} | The mechanical tell |`);
  lines.push(`| Full bands with zero semantic entrances | ${program.zeroEntranceFullBands} | Dead minutes |`);
  lines.push(`| Longest same-component run | ${program.longestSameComponentRun.length} (${program.longestSameComponentRun.key || '—'}) | UI-carousel feel |`);
  lines.push(`| Longest same-variant run | ${program.longestSameVariantRun.length} (${program.longestSameVariantRun.key || '—'}) | Exact repetition |`);
  lines.push(`| Callbacks | ${program.callbackCount} | Grounded re-returns used |`);
  lines.push(`| Max scene-arrival drift | ${program.maxArrivalDriftSec}s | Titles detached from the teacher's turn |`);
  lines.push(`| Scenes with no arrival | ${program.scenesWithoutArrival} | Silent scene changes |`);
  lines.push(`| Plans valid | ${program.validSteps}/${program.stepCount} | House contract holds |`);
  lines.push('');
  lines.push('## Steps');
  lines.push('');
  lines.push('| Step | Dur | Shots | Occ | First semantic | Longest still | Rests at cap | Parity flips | 0-bands | Max drift | Gates |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|');
  for (const step of report.steps) {
    const gatesPassed = Object.values(step.gates || {}).filter(Boolean).length;
    const gateCount = Object.keys(step.gates || {}).length;
    lines.push(`| ${step.stepId} | ${step.durationSec}s | ${step.shotCount} | ${pct(step.semanticOccupancy)}% | ${step.firstSemanticAtSec ?? '—'}s | ${step.stillness.longestSec}s | ${step.rests.exactCapCount}/${step.rests.count} | ${step.rests.parityFlipRate ?? '—'} | ${step.bands.zeroEntranceFullBands} | ${step.sceneArrivals.maxDriftSec ?? '—'}s | ${step.valid ? `${gatesPassed}/${gateCount}` : `INVALID (${step.errors.length})`} |`);
  }
  lines.push('');
  lines.push('Transitions: ' + Object.entries(program.transitions).map(([name, count]) => `${name} ${count}`).join(' · '));
  lines.push('');
  return lines.join('\n');
}

const COMPARE_ROWS = [
  ['Shot entrances / minute', (program) => program.shotEntrancesPerMinute],
  ['Semantic entrances / minute', (program) => program.semanticEntrancesPerMinute],
  ['Longest stillness (s)', (program) => program.longestStillnessSec],
  ['Stillness runs > 20s', (program) => program.stillnessRunsOver20Sec],
  ['Stillness runs > 30s', (program) => program.stillnessRunsOver30Sec],
  ['Rests at exact cap (share)', (program) => program.restExactCapShare],
  ['Zero-entrance full bands', (program) => program.zeroEntranceFullBands],
  ['Longest same-component run', (program) => program.longestSameComponentRun?.length],
  ['Longest same-variant run', (program) => program.longestSameVariantRun?.length],
  ['Callbacks', (program) => program.callbackCount],
  ['Max scene-arrival drift (s)', (program) => program.maxArrivalDriftSec],
  ['Scenes with no arrival', (program) => program.scenesWithoutArrival],
];

function compareReports(beforeFile, afterFile) {
  const before = JSON.parse(fs.readFileSync(beforeFile, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterFile, 'utf8'));
  const lines = [];
  lines.push(`# Program comparison — ${before.id} → ${after.id}`);
  lines.push('');
  lines.push('| Metric | Before | After | Δ |');
  lines.push('|---|---:|---:|---:|');
  for (const [label, read] of COMPARE_ROWS) {
    const left = read(before.program || {});
    const right = read(after.program || {});
    const delta = typeof left === 'number' && typeof right === 'number' ? round(right - left, 2) : '—';
    lines.push(`| ${label} | ${left ?? '—'} | ${right ?? '—'} | ${delta} |`);
  }
  return lines.join('\n');
}

function main() {
  const args = process.argv.slice(2);
  const compareIndex = args.indexOf('--compare');
  if (compareIndex >= 0) {
    const [beforeFile, afterFile] = args.slice(compareIndex + 1);
    if (!beforeFile || !afterFile) {
      console.error('usage: --compare <before.json> <after.json>');
      process.exit(1);
    }
    console.log(compareReports(beforeFile, afterFile));
    return;
  }
  const json = args.includes('--json');
  const outIndex = args.indexOf('--out');
  const outDir = outIndex >= 0 ? args[outIndex + 1] : DEFAULT_OUT_DIR;
  const ids = args.filter((arg, index) => !arg.startsWith('--') && args[index - 1] !== '--out');
  const replayIds = ids.length ? ids : listReplayFixtures().map((fixture) => fixture.id);
  if (!replayIds.length) {
    console.error('no replay fixtures found');
    process.exit(1);
  }
  fs.mkdirSync(outDir, { recursive: true });
  let refused = 0;
  for (const id of replayIds) {
    const report = auditReplay(id);
    if (report.errors?.length) refused += 1;
    if (json) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      fs.writeFileSync(path.join(outDir, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`);
      fs.writeFileSync(path.join(outDir, `${id}.md`), markdownReport(report));
      const program = report.program;
      console.log(program
        ? `${id}: ${program.totalShots} shots, ${program.shotEntrancesPerMinute}/min, longest stillness ${program.longestStillnessSec}s, cap-chopped rests ${program.restExactCapShare == null ? '—' : pct(program.restExactCapShare)}%, valid ${program.validSteps}/${program.stepCount}`
        : `${id}: refused — ${report.errors.join('; ')}`);
    }
  }
  if (!json) console.log(`reports written to ${path.relative(REPO_ROOT, outDir)}/`);
  if (refused === replayIds.length) process.exit(1);
}

main();
