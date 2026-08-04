#!/usr/bin/env node

// Deterministic, provider-free audit of the append-only /magic director evidence.
//
// The current evidence reader performs supported read-time migrations. The one
// deliberately superseded policy-2 calibration is measured from its preserved
// raw result and is labelled as such; it is never presented as current policy.

import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readDirectorEvidence } from './director-evidence.mjs';
import {
  compileEditorialPlan,
  EDITORIAL_LIMITS,
  MAGIC_EDITORIAL_POLICY_VERSION,
  validateEditorialPlan,
} from './magic-editorial.mjs';
import {
  buildVisualTimeline,
  DIRECTOR_ARTIFACT_KINDS,
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION,
  measureVisualCadence,
  summarizeVisualProjection,
  validateReplayFixture,
} from './magic-contract.mjs';

const AUDIT_VERSION = 1;
const MINIMUM_AUDITABLE_RECORDS = 20;
const RUNS_DIR = fileURLToPath(new URL('./director-runs/', import.meta.url));
const EXODUS_REPLAY_URL = new URL('./replays/exodus-34-mercy-judgment.json', import.meta.url);
const ROMANS_FIVE_STEP_PREFIX = '2026-08-03T23-';
const EXODUS_SIX_STEP_PREFIX = '2026-08-04T00-';

const KIND_ABBREVIATIONS = Object.freeze({
  group: 'G',
  footnote: 'Fn',
  term: 'T',
  allusion: 'Al',
  compare: 'Co',
  chain: 'Ch',
  caveat: 'Cv',
  aside: 'As',
  highlight: 'H',
});

// These are renderer families, not semantic equivalences. They let the audit
// notice a run of similarly composed cards even when their semantic kinds vary.
const VISUAL_FAMILY = Object.freeze({
  group: 'scripture-loom',
  footnote: 'editorial-card',
  term: 'editorial-card',
  allusion: 'scripture-relation',
  compare: 'scripture-relation',
  chain: 'scripture-relation',
  caveat: 'editorial-card',
  aside: 'editorial-card',
  highlight: 'focus',
});

const round = (value, digits = 1) => {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
};

const mean = (rows, key) => rows.length
  ? rows.reduce((sum, row) => sum + (Number(row[key]) || 0), 0) / rows.length
  : 0;

function countsByKind(items) {
  const counts = Object.fromEntries(DIRECTOR_ARTIFACT_KINDS.map((kind) => [kind, 0]));
  for (const item of Array.isArray(items) ? items : []) {
    if (Object.hasOwn(counts, item?.kind)) counts[item.kind] += 1;
  }
  return counts;
}

function compactKinds(counts, unavailable = false) {
  if (unavailable) return '—';
  const tokens = DIRECTOR_ARTIFACT_KINDS
    .filter((kind) => Number(counts?.[kind]) > 0)
    .map((kind) => `${KIND_ABBREVIATIONS[kind]}${counts[kind]}`);
  return tokens.join(' ') || 'none';
}

function unionIntervals(intervals) {
  const ordered = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const union = [];
  for (const interval of ordered) {
    const previous = union.at(-1);
    if (previous && interval[0] <= previous[1]) previous[1] = Math.max(previous[1], interval[1]);
    else union.push([...interval]);
  }
  return union;
}

function maximumRun(items, classifier) {
  let maximum = 0;
  let current = 0;
  let previous = null;
  for (const item of items) {
    const value = classifier(item);
    current = value === previous ? current + 1 : 1;
    previous = value;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

function shortRunId(file) {
  const match = /T(\d{2})-(\d{2})-(\d{2})-[^Z]*Z-([a-z0-9]+)/i.exec(file);
  if (!match) return file.replace(/\.json$/i, '');
  return `${match[1]}-${match[2]}-${match[3]}-${match[4].slice(0, 4)}`;
}

function auditEditorialDirection(direction, { durationSec, stepIndex = 0, stepCount = 1 } = {}) {
  try {
    const plan = compileEditorialPlan(direction, { durationSec, stepIndex, stepCount });
    const validation = validateEditorialPlan(plan, direction);
    const metrics = plan.metrics || {};
    const gateEntries = Object.entries(metrics.gates || {}).sort(([left], [right]) => left.localeCompare(right));
    const traceable = plan.shots.find((shot) => (
      shot.role === 'semantic'
      && Array.isArray(shot.sourceBeatIds) && shot.sourceBeatIds.length
      && Array.isArray(shot.sourceSceneIds) && shot.sourceSceneIds.length
    )) || plan.shots.find((shot) => (
      (shot.sourceBeatIds?.length || 0) + (shot.sourceSceneIds?.length || 0) > 0
    )) || null;
    return {
      status: 'ready',
      policyVersion: plan.policyVersion,
      stepIndex: plan.stepIndex,
      stepCount: plan.stepCount,
      shotCount: metrics.shotCount || 0,
      semanticShotCount: metrics.semanticShotCount || 0,
      semanticBeatCount: metrics.semanticBeatCount || 0,
      semanticSec: round(metrics.semanticSec),
      semanticOccupancyPct: round(Number(metrics.semanticOccupancy || 0) * 100),
      semanticTargetGapSec: round(metrics.semanticTargetGapSec),
      legalCallbackOpportunitySec: round(metrics.legalCallbackOpportunitySec),
      semanticTargetExhausted: Boolean(metrics.semanticTargetExhausted),
      callbackShotCount: plan.shots.filter((shot) => shot.ruleId === 'house-semantic-callback').length,
      punctuationShotCount: plan.shots.filter((shot) => shot.ruleId === 'house-family-punctuation').length,
      explicitRestSec: round(metrics.explicitRestSec),
      maxExplicitRestSec: round(metrics.maxExplicitRestSec),
      coveredSec: round(metrics.coveredSec),
      uncoveredSec: round(Math.max(0, Number(plan.durationSec) - Number(metrics.coveredSec || 0))),
      maxAccidentalGapSec: round(metrics.maxAccidentalGapSec),
      maxSameFamilyRun: metrics.maxSameFamilyRun || 0,
      focusSec: round(metrics.focusSec),
      focusSharePct: round(Number(metrics.focusShare || 0) * 100),
      sceneCoveragePct: round(Number(metrics.sceneCoverage || 0) * 100),
      representedScenes: round(Number(metrics.sceneCoverage || 0) * (direction.scenes?.length || 0)),
      gates: Object.fromEntries(gateEntries),
      passedGates: gateEntries.filter(([, passed]) => passed).length,
      gateCount: gateEntries.length,
      failedGates: gateEntries.filter(([, passed]) => !passed).map(([name]) => name),
      valid: validation.ok,
      validationErrors: validation.errors,
      traceableShot: traceable ? {
        id: traceable.id,
        fromSec: traceable.fromSec,
        toSec: traceable.toSec,
        role: traceable.role,
        component: traceable.component,
        family: traceable.family,
        variant: traceable.variant,
        phase: traceable.phase,
        ruleId: traceable.ruleId,
        semanticKind: traceable.semanticKind,
        sourceBeatIds: [...traceable.sourceBeatIds],
        sourceSceneIds: [...traceable.sourceSceneIds],
      } : null,
    };
  } catch (error) {
    return {
      status: 'refused',
      policyVersion: MAGIC_EDITORIAL_POLICY_VERSION,
      stepIndex,
      stepCount,
      error: error?.message || String(error),
      gates: {},
      passedGates: 0,
      gateCount: 0,
      failedGates: ['compiler'],
      valid: false,
      validationErrors: [error?.message || String(error)],
      traceableShot: null,
    };
  }
}

function readAuditableRecord(file) {
  let raw = null;
  try {
    raw = JSON.parse(fs.readFileSync(new URL(`./director-runs/${file}`, import.meta.url), 'utf8'));
  } catch {
    // The evidence reader below supplies the stable refusal classification.
  }

  const read = readDirectorEvidence(file, { dir: RUNS_DIR });
  if (read?.evidenceReadStatus === 'ready' && read.result) {
    return {
      raw,
      result: read.result,
      evidenceStatus: raw?.schemaVersion === 1 ? 'ready/migrated-v1' : 'ready/current',
      cohort: raw?.schemaVersion === 1 ? 'legacy-migrated' : 'current-policy',
      readerStatus: 'ready',
      refusal: null,
    };
  }

  // Policy 2 is intentionally refused by the current reader. Its immutable
  // calibration result remains useful for measuring the failure that caused
  // policy 3, provided it is labelled and never upgraded or replayed.
  if (raw?.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION && raw?.result) {
    return {
      raw,
      result: raw.result,
      evidenceStatus: 'refused-current/raw-previous-policy',
      cohort: 'previous-policy-calibration',
      readerStatus: read?.evidenceReadStatus || 'refused',
      refusal: read?.refusal?.code || 'superseded-policy',
    };
  }

  return {
    raw,
    result: null,
    evidenceStatus: read?.evidenceReadStatus || 'unreadable',
    cohort: 'unauditable',
    readerStatus: read?.evidenceReadStatus || 'unreadable',
    refusal: read?.refusal?.code || 'no-auditable-result',
  };
}

function auditRecord(file) {
  const stored = readAuditableRecord(file);
  if (!stored.result) {
    return {
      file,
      run: shortRunId(file),
      auditable: false,
      cohort: stored.cohort,
      evidenceStatus: stored.evidenceStatus,
      refusal: stored.refusal,
    };
  }

  const result = stored.result;
  const durationSec = Number(result.clip?.durationSec
    ?? (Number(result.clip?.toSec) - Number(result.clip?.fromSec)));
  if (!Number.isFinite(durationSec) || durationSec <= 0
    || !Array.isArray(result.scenes) || !Array.isArray(result.beats)) {
    return {
      file,
      run: shortRunId(file),
      auditable: false,
      cohort: stored.cohort,
      evidenceStatus: stored.evidenceStatus,
      refusal: 'incomplete-result',
    };
  }

  const projection = summarizeVisualProjection(result, durationSec);
  const visibleIds = new Set(projection.projectedVisible.map((entry) => entry.beatId));
  const visibleBeats = result.beats
    .filter((beat) => visibleIds.has(beat.id))
    .sort((left, right) => Number(left.at) - Number(right.at)
      || String(left.id).localeCompare(String(right.id)));
  const cadence = measureVisualCadence(visibleBeats, durationSec);
  const timeline = buildVisualTimeline(result, durationSec);
  const activeIntervals = unionIntervals(
    timeline
      .filter((event) => event.beatId && event.kind !== 'word' && visibleIds.has(event.beatId))
      .map((event) => [Number(event.at), Number(event.exitAtWide)]),
  );

  let maxInternalBlankSec = 0;
  for (let index = 1; index < activeIntervals.length; index += 1) {
    maxInternalBlankSec = Math.max(
      maxInternalBlankSec,
      activeIntervals[index][0] - activeIntervals[index - 1][1],
    );
  }
  const activeSec = activeIntervals.reduce((sum, [start, end]) => sum + end - start, 0);
  const firstInterval = activeIntervals[0] || null;
  const lastInterval = activeIntervals.at(-1) || null;

  const outcomes = result.metrics?.outcomes || {};
  const proposed = Array.isArray(outcomes.proposed) ? outcomes.proposed : null;
  const rejected = Array.isArray(outcomes.rejected) ? outcomes.rejected : null;
  const accepted = Array.isArray(outcomes.accepted) ? outcomes.accepted : [];
  const acceptedIds = new Set(accepted.map((entry) => entry.proposalId));
  const fillProposals = proposed?.filter((entry) => entry.pass === 'fill') || [];
  const fillRejected = rejected?.filter((entry) => entry.pass === 'fill') || [];
  const fillAccepted = fillProposals.filter((entry) => acceptedIds.has(entry.proposalId));
  const fillQualifiedIntervals = (Array.isArray(result.metrics?.calls) ? result.metrics.calls : [])
    .filter((call) => call?.role === 'fill')
    .reduce((sum, call) => {
      const match = /(?:^|;)semantic-intervals:(\d+)(?:;|$)/.exec(String(call.validation || ''));
      return sum + (match ? Number(match[1]) : 0);
    }, 0);

  const sceneIdsWithComponents = new Set(visibleBeats.map((beat) => beat.sceneId).filter(Boolean));
  const highlighted = visibleBeats.filter((beat) => beat.kind === 'highlight').length;
  const firstBeat = visibleBeats[0] || null;
  const lastBeat = visibleBeats.at(-1) || null;
  const editorial = stored.cohort === 'current-policy'
    ? auditEditorialDirection(result, { durationSec, stepIndex: 0, stepCount: 1 })
    : null;

  return {
    file,
    run: shortRunId(file),
    auditable: true,
    cohort: stored.cohort,
    evidenceStatus: stored.evidenceStatus,
    refusal: stored.refusal,
    schemaVersion: stored.raw?.schemaVersion ?? result.schemaVersion ?? null,
    policyVersion: stored.raw?.policyVersion ?? result.policyVersion ?? null,
    effectivePolicyVersion: result.policyVersion ?? null,
    recordId: stored.raw?.request?.recordId ?? null,
    durationSec: round(durationSec),
    scenes: result.scenes.length,
    sceneComponents: sceneIdsWithComponents.size,
    rawBeats: result.beats.length,
    visibleBeats: visibleBeats.length,
    beatsPerScene: round(visibleBeats.length / Math.max(1, result.scenes.length), 2),
    retainedKinds: countsByKind(visibleBeats),
    proposedKinds: proposed ? countsByKind(proposed) : null,
    rejectedKinds: rejected ? countsByKind(rejected) : null,
    firstVisual: firstBeat ? { kind: firstBeat.kind, at: round(firstBeat.at) } : null,
    lastVisual: lastBeat ? { kind: lastBeat.kind, at: round(lastBeat.at) } : null,
    openingBlankSec: round(firstInterval?.[0] ?? durationSec),
    maxEntranceGapSec: round(cadence.maxGapSec),
    maxInternalBlankSec: round(maxInternalBlankSec),
    closingBlankSec: round(durationSec - (lastInterval?.[1] ?? 0)),
    activeSec: round(activeSec),
    activeCoveragePct: round((activeSec / durationSec) * 100),
    maxSameKindRun: maximumRun(visibleBeats, (beat) => beat.kind),
    maxSameFamilyRun: maximumRun(visibleBeats, (beat) => VISUAL_FAMILY[beat.kind] || beat.kind),
    variety: new Set(visibleBeats.map((beat) => beat.kind)).size,
    highlights: highlighted,
    focusSharePct: round((highlighted / Math.max(1, visibleBeats.length)) * 100),
    fillQualifiedIntervals,
    fillProposed: fillProposals.length,
    fillAccepted: fillAccepted.length,
    fillRejected: fillRejected.length,
    rejectionReasons: rejected
      ? Object.fromEntries([...rejected.reduce((counts, entry) => {
        const reason = entry.reason || 'unknown';
        counts.set(reason, (counts.get(reason) || 0) + 1);
        return counts;
      }, new Map())].sort(([left], [right]) => left.localeCompare(right)))
      : null,
    projectedVisible: projection.projectedVisible.length,
    focusMasked: projection.focusMasked.length,
    superseded: projection.superseded.length,
    editorial,
  };
}

function aggregate(label, rows) {
  const visibleBeats = rows.reduce((sum, row) => sum + row.visibleBeats, 0);
  const highlights = rows.reduce((sum, row) => sum + row.highlights, 0);
  return {
    label,
    records: rows.length,
    avgDurationSec: round(mean(rows, 'durationSec')),
    avgScenes: round(mean(rows, 'scenes')),
    avgVisibleBeats: round(mean(rows, 'visibleBeats')),
    avgBeatsPerScene: round(mean(rows, 'beatsPerScene'), 2),
    avgOpeningBlankSec: round(mean(rows, 'openingBlankSec')),
    avgMaxEntranceGapSec: round(mean(rows, 'maxEntranceGapSec')),
    avgMaxInternalBlankSec: round(mean(rows, 'maxInternalBlankSec')),
    avgClosingBlankSec: round(mean(rows, 'closingBlankSec')),
    avgActiveCoveragePct: round(mean(rows, 'activeCoveragePct')),
    avgVariety: round(mean(rows, 'variety')),
    focusSharePct: round((highlights / Math.max(1, visibleBeats)) * 100),
    sceneCoveragePct: round((rows.reduce((sum, row) => sum + row.sceneComponents, 0)
      / Math.max(1, rows.reduce((sum, row) => sum + row.scenes, 0))) * 100),
    fillQualifiedIntervals: rows.reduce((sum, row) => sum + row.fillQualifiedIntervals, 0),
    fillAccepted: rows.reduce((sum, row) => sum + row.fillAccepted, 0),
  };
}

function summarizeEditorial(label, compiledRows) {
  const ready = compiledRows.filter(({ editorial }) => editorial?.status === 'ready');
  const totalDurationSec = ready.reduce((sum, { row }) => sum + row.durationSec, 0);
  const totalSemanticSec = ready.reduce((sum, { editorial }) => sum + editorial.semanticSec, 0);
  const totalFocusSec = ready.reduce((sum, { editorial }) => sum + editorial.focusSec, 0);
  const totalCoveredSec = ready.reduce((sum, { editorial }) => sum + editorial.coveredSec, 0);
  const totalScenes = ready.reduce((sum, { row }) => sum + row.scenes, 0);
  const representedScenes = ready.reduce((sum, { editorial }) => sum + editorial.representedScenes, 0);
  const semanticOccupancy = totalSemanticSec / Math.max(1, totalDurationSec);
  const focusShare = totalFocusSec / Math.max(1, totalDurationSec);
  const sceneCoverage = representedScenes / Math.max(1, totalScenes);
  const maxExplicitRestSec = ready.reduce(
    (maximum, { editorial }) => Math.max(maximum, editorial.maxExplicitRestSec), 0,
  );
  const maxAccidentalGapSec = ready.reduce(
    (maximum, { editorial }) => Math.max(maximum, editorial.maxAccidentalGapSec), 0,
  );
  const maxSameFamilyRun = ready.reduce(
    (maximum, { editorial }) => Math.max(maximum, editorial.maxSameFamilyRun), 0,
  );
  const aggregateGates = {
    semanticOccupancyTarget: semanticOccupancy >= EDITORIAL_LIMITS.targetSemanticOccupancyMin
      && semanticOccupancy <= EDITORIAL_LIMITS.targetSemanticOccupancyMax,
    semanticOccupancyTargetOrExhausted: ready.every(({ editorial }) => (
      editorial.gates.semanticOccupancyTargetOrExhausted
    )),
    semanticOccupancyHard: semanticOccupancy <= EDITORIAL_LIMITS.hardSemanticOccupancyMax,
    accidentalGap: maxAccidentalGapSec <= EDITORIAL_LIMITS.maxAccidentalGapSec,
    explicitRest: maxExplicitRestSec <= EDITORIAL_LIMITS.maxExplicitRestSec,
    sameFamilyRun: maxSameFamilyRun <= EDITORIAL_LIMITS.maxSameFamilyRun,
    focusShare: focusShare <= EDITORIAL_LIMITS.maxFocusShare,
    sceneCoverage: sceneCoverage >= EDITORIAL_LIMITS.minSceneCoverage,
  };
  const gateNames = Object.keys(aggregateGates).sort();
  return {
    label,
    requestedDirections: compiledRows.length,
    compiledDirections: ready.length,
    policyVersion: MAGIC_EDITORIAL_POLICY_VERSION,
    totalDurationSec: round(totalDurationSec),
    shotCount: ready.reduce((sum, { editorial }) => sum + editorial.shotCount, 0),
    semanticShotCount: ready.reduce((sum, { editorial }) => sum + editorial.semanticShotCount, 0),
    semanticBeatCount: ready.reduce((sum, { editorial }) => sum + editorial.semanticBeatCount, 0),
    semanticSec: round(totalSemanticSec),
    semanticOccupancyPct: round(semanticOccupancy * 100),
    callbackShotCount: ready.reduce((sum, { editorial }) => sum + editorial.callbackShotCount, 0),
    punctuationShotCount: ready.reduce((sum, { editorial }) => sum + editorial.punctuationShotCount, 0),
    exhaustedDirectionCount: ready.filter(({ editorial }) => editorial.semanticTargetExhausted).length,
    explicitRestSec: round(ready.reduce((sum, { editorial }) => sum + editorial.explicitRestSec, 0)),
    maxExplicitRestSec: round(maxExplicitRestSec),
    coveredSec: round(totalCoveredSec),
    uncoveredSec: round(Math.max(0, totalDurationSec - totalCoveredSec)),
    maxAccidentalGapSec: round(maxAccidentalGapSec),
    maxSameFamilyRun,
    focusSec: round(totalFocusSec),
    focusSharePct: round(focusShare * 100),
    sceneCoveragePct: round(sceneCoverage * 100),
    aggregateGates,
    passedAggregateGates: gateNames.filter((name) => aggregateGates[name]).length,
    aggregateGateCount: gateNames.length,
    failedAggregateGates: gateNames.filter((name) => !aggregateGates[name]),
    directionGatePasses: Object.fromEntries(gateNames.map((name) => [
      name,
      `${ready.filter(({ editorial }) => editorial.gates[name]).length}/${ready.length}`,
    ])),
    allPlansValid: ready.length === compiledRows.length && ready.every(({ editorial }) => editorial.valid),
    traceableShot: ready.find(({ editorial }) => editorial.traceableShot)?.editorial.traceableShot || null,
    traceableRun: ready.find(({ editorial }) => editorial.traceableShot)?.row.run || null,
  };
}

function compileSequence(label, rows) {
  const ordered = [...rows].sort((left, right) => left.file.localeCompare(right.file));
  const compiled = ordered.map((row, stepIndex) => {
    const stored = readAuditableRecord(row.file);
    const editorial = stored.result
      ? auditEditorialDirection(stored.result, {
        durationSec: row.durationSec,
        stepIndex,
        stepCount: ordered.length,
      })
      : { status: 'refused', valid: false, gates: {}, traceableShot: null };
    return { row, editorial };
  });
  return summarizeEditorial(label, compiled);
}

function compileReplaySequence(label, replayUrl) {
  const fixture = JSON.parse(fs.readFileSync(replayUrl, 'utf8'));
  const check = validateReplayFixture(fixture);
  if (!check.ok) throw new Error(`replay fixture refused: ${check.errors.join('; ')}`);
  const stepCount = fixture.tour.steps.length;
  const compiled = fixture.tour.steps.map((step, stepIndex) => {
    const direction = fixture.directions[step.id];
    const row = {
      file: direction.evidenceFile || `${fixture.id}:${step.id}`,
      run: direction.evidenceFile ? shortRunId(direction.evidenceFile) : `${fixture.id}:${step.id}`,
      durationSec: Number(step.endSec) - Number(step.startSec),
      scenes: direction.scenes.length,
    };
    return {
      row,
      editorial: auditEditorialDirection(direction, { durationSec: row.durationSec, stepIndex, stepCount }),
    };
  });
  return summarizeEditorial(label, compiled);
}

function markdownReport(report) {
  const lines = [];
  lines.push('# Director evidence audit');
  lines.push('');
  lines.push(`Audit v${report.auditVersion}; policy ${report.currentPolicyVersion}; ${report.auditableRecords}/${report.savedRecords} saved records auditable.`);
  if (report.unauditable.length) {
    lines.push(`Unauditable: ${report.unauditable.map((row) => `${row.file} (${row.refusal})`).join(', ')}.`);
  }
  lines.push('');
  lines.push('## Cohorts');
  lines.push('');
  lines.push('| Cohort | N | Dur | Scenes | Visible beats | B/S | Open | Max entrance | Max internal blank | Close | Active | Variety | Focus | Scene use | Fill |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of report.aggregates) {
    lines.push(`| ${row.label} | ${row.records} | ${row.avgDurationSec}s | ${row.avgScenes} | ${row.avgVisibleBeats} | ${row.avgBeatsPerScene} | ${row.avgOpeningBlankSec}s | ${row.avgMaxEntranceGapSec}s | ${row.avgMaxInternalBlankSec}s | ${row.avgClosingBlankSec}s | ${row.avgActiveCoveragePct}% | ${row.avgVariety} | ${row.focusSharePct}% | ${row.sceneCoveragePct}% | ${row.fillAccepted}/${row.fillQualifiedIntervals} |`);
  }
  lines.push('');
  lines.push('## Runs');
  lines.push('');
  lines.push('`O/E/I/C` is opening blank / maximum entrance gap / maximum dwell-adjusted internal blank / closing blank. `K/F` is maximum same-kind / same-family run. Fill is accepted / qualified intervals.');
  lines.push('');
  lines.push('| Run | Cohort | Dur | S/B (B:S) | Retained | Proposed / rejected | First→last | O/E/I/C | Active | K/F | H | Fill | Evidence |');
  lines.push('|---|---|---:|---:|---|---|---|---|---:|---:|---:|---:|---|');
  for (const row of report.records) {
    const firstLast = row.firstVisual
      ? `${KIND_ABBREVIATIONS[row.firstVisual.kind]}@${row.firstVisual.at}→${KIND_ABBREVIATIONS[row.lastVisual.kind]}@${row.lastVisual.at}`
      : 'none';
    const proposed = compactKinds(row.proposedKinds, row.proposedKinds == null);
    const rejected = compactKinds(row.rejectedKinds, row.rejectedKinds == null);
    lines.push(`| ${row.run} | ${row.cohort} | ${row.durationSec} | ${row.scenes}/${row.visibleBeats} (${row.beatsPerScene}) | ${compactKinds(row.retainedKinds)} | ${proposed} / ${rejected} | ${firstLast} | ${row.openingBlankSec}/${row.maxEntranceGapSec}/${row.maxInternalBlankSec}/${row.closingBlankSec} | ${row.activeCoveragePct}% | ${row.maxSameKindRun}/${row.maxSameFamilyRun} | ${row.highlights} (${row.focusSharePct}%) | ${row.fillAccepted}/${row.fillQualifiedIntervals} | ${row.evidenceStatus} |`);
  }
  lines.push('');
  lines.push('Kind legend: G group, Fn footnote, T term, Al allusion, Co compare, Ch chain, Cv caveat, As aside, H highlight.');
  lines.push('');
  lines.push('## House compiler comparison');
  lines.push('');
  lines.push('Each current direction is independently compiled with `stepIndex: 0` and `stepCount: 1`. Rest shots are deterministic house framing, not newly inferred semantics. Compiler validity and continuity gates do not establish browser rendering acceptance.');
  lines.push('');
  lines.push('| Run | Shots | Semantic shots/beats | Semantic occupancy | Max rest | Accidental gap | Family run | Focus | Scene coverage | Gates | Valid |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|');
  for (const row of report.records.filter((record) => record.editorial)) {
    const editorial = row.editorial;
    const gates = editorial.status === 'ready'
      ? `${editorial.passedGates}/${editorial.gateCount}${editorial.failedGates.length ? ` fail: ${editorial.failedGates.join(', ')}` : ''}`
      : `refused: ${editorial.error}`;
    lines.push(`| ${row.run} | ${editorial.shotCount ?? '—'} | ${editorial.semanticShotCount ?? '—'}/${editorial.semanticBeatCount ?? '—'} | ${editorial.semanticOccupancyPct ?? '—'}% | ${editorial.maxExplicitRestSec ?? '—'}s | ${editorial.maxAccidentalGapSec ?? '—'}s | ${editorial.maxSameFamilyRun ?? '—'} | ${editorial.focusSharePct ?? '—'}% | ${editorial.sceneCoveragePct ?? '—'}% | ${gates} | ${editorial.valid ? 'yes' : 'no'} |`);
  }
  lines.push('');
  const comparison = report.editorialComparison;
  lines.push('### Romans five-step aggregate');
  lines.push('');
  lines.push(`The five saved long windows move from ${comparison.fixedDwellForegroundPct}% average fixed-dwell foreground coverage to ${comparison.sequence.semanticOccupancyPct}% compiled semantic occupancy. The sequence contains ${comparison.sequence.shotCount} editorial shots (${comparison.sequence.semanticShotCount} semantic phases from ${comparison.sequence.semanticBeatCount} beats), has a maximum explicit rest of ${comparison.sequence.maxExplicitRestSec}s, ${comparison.sequence.uncoveredSec}s uncovered time, a ${comparison.sequence.maxAccidentalGapSec}s accidental gap, maximum same-family run ${comparison.sequence.maxSameFamilyRun}, ${comparison.sequence.focusSharePct}% focus share, and ${comparison.sequence.sceneCoveragePct}% scene coverage.`);
  lines.push('');
  lines.push(`Aggregate gates: ${comparison.sequence.passedAggregateGates}/${comparison.sequence.aggregateGateCount}${comparison.sequence.failedAggregateGates.length ? `; failed ${comparison.sequence.failedAggregateGates.join(', ')}` : ''}. Per-direction gate passes: ${Object.entries(comparison.sequence.directionGatePasses).map(([name, value]) => `${name} ${value}`).join('; ')}.`);
  if (comparison.sequence.traceableShot) {
    const shot = comparison.sequence.traceableShot;
    lines.push('');
    lines.push(`Traceable example: ${comparison.sequence.traceableRun} / ${shot.id}, ${shot.fromSec}–${shot.toSec}s, ${shot.component}.${shot.variant}.${shot.phase}, rule ${shot.ruleId}, from beat ${shot.sourceBeatIds.join(', ')} and scene ${shot.sourceSceneIds.join(', ')}.`);
  }
  lines.push('');
  lines.push('The rest grid guarantees continuous house framing; it does not claim continuous semantic novelty. Browser mounting, layout, transition, and screenshot acceptance remain a separate gate.');
  if (comparison.exodusSequence) {
    const exodus = comparison.exodusSequence;
    lines.push('');
    lines.push('### Current checked-in Exodus replay');
    lines.push('');
    lines.push(`The checked-in 28:55 Luna replay compiles to ${exodus.shotCount} shots and ${exodus.semanticOccupancyPct}% semantic occupancy. It uses ${exodus.callbackShotCount} bounded callbacks and ${exodus.punctuationShotCount} grounded family breaks; ${exodus.exhaustedDirectionCount}/${exodus.requestedDirections} directions stop below the preferred 40% target because no legal callback remains. All ${exodus.compiledDirections}/${exodus.requestedDirections} plans validate, maximum rest is ${exodus.maxExplicitRestSec}s, maximum same-family run is ${exodus.maxSameFamilyRun}, and scene coverage is ${exodus.sceneCoveragePct}%.`);
    lines.push('');
    lines.push(`Aggregate gates: ${exodus.passedAggregateGates}/${exodus.aggregateGateCount}${exodus.failedAggregateGates.length ? `; failed ${exodus.failedAggregateGates.join(', ')}` : ''}. Per-direction gate passes: ${Object.entries(exodus.directionGatePasses).map(([name, value]) => `${name} ${value}`).join('; ')}.`);
  }
  return `${lines.join('\n')}\n`;
}

const files = fs.existsSync(RUNS_DIR)
  ? fs.readdirSync(RUNS_DIR).filter((file) => file.endsWith('.json')).sort()
  : [];
const inspected = files.map(auditRecord);
const records = inspected.filter((row) => row.auditable);
const unauditable = inspected.filter((row) => !row.auditable);
const romansFiveRows = records
  .filter((row) => row.cohort === 'current-policy' && row.file.startsWith(ROMANS_FIVE_STEP_PREFIX))
  .sort((left, right) => left.file.localeCompare(right.file));
const exodusSixRows = records
  .filter((row) => row.cohort === 'current-policy' && row.file.startsWith(EXODUS_SIX_STEP_PREFIX))
  .sort((left, right) => left.file.localeCompare(right.file));
const editorialComparison = {
  fixedDwellForegroundPct: round(mean(romansFiveRows, 'activeCoveragePct')),
  sequence: compileSequence('Romans five-step sequence', romansFiveRows),
  exodusHistoricalSequence: compileSequence('Exodus initial six-step sequence', exodusSixRows),
  exodusSequence: compileReplaySequence('Current checked-in Exodus replay', EXODUS_REPLAY_URL),
};
const groups = [
  ['legacy-migrated', records.filter((row) => row.cohort === 'legacy-migrated')],
  ['previous-policy calibration', records.filter((row) => row.cohort === 'previous-policy-calibration')],
  ['current policy', records.filter((row) => row.cohort === 'current-policy')],
  ['current long windows (>=200s)', records.filter((row) => (
    row.cohort === 'current-policy' && row.durationSec >= 200
  ))],
  ['all auditable', records],
];
const report = {
  auditVersion: AUDIT_VERSION,
  currentPolicyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
  minimumAuditableRecords: MINIMUM_AUDITABLE_RECORDS,
  savedRecords: files.length,
  auditableRecords: records.length,
  aggregates: groups.map(([label, rows]) => aggregate(label, rows)),
  records,
  unauditable,
  editorialComparison,
};

if (process.argv.includes('--json')) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
else process.stdout.write(markdownReport(report));

if (records.length < MINIMUM_AUDITABLE_RECORDS) {
  process.stderr.write(`director evidence audit requires at least ${MINIMUM_AUDITABLE_RECORDS} auditable records; found ${records.length}\n`);
  process.exitCode = 1;
}
