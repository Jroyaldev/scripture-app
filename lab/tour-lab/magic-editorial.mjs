// Pure editorial compiler for the isolated /magic theater.
//
// Luna supplies grounded scenes and semantic beats. This module never authors
// display copy: it turns those durable inputs into a deterministic, complete
// edit-decision list whose timing, component choice, variants, rests, and
// bookends are owned by the house and can be recompiled without another call.

import {
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
} from './magic-contract.mjs';

export const MAGIC_EDITORIAL_SCHEMA_VERSION = 1;
export const MAGIC_EDITORIAL_POLICY_VERSION = 'magic-editorial-1';

export const EDITORIAL_COMPONENTS = Object.freeze({
  BookendSlate: Object.freeze({ family: 'bookend', kinds: Object.freeze([]) }),
  ListeningFrame: Object.freeze({ family: 'listening', kinds: Object.freeze([]) }),
  PassageFrame: Object.freeze({ family: 'passage', kinds: Object.freeze([]) }),
  AnchorFrame: Object.freeze({ family: 'anchor', kinds: Object.freeze(['group', 'term', 'footnote']) }),
  EvidenceSpread: Object.freeze({ family: 'evidence', kinds: Object.freeze(['allusion', 'compare', 'chain']) }),
  MarginFrame: Object.freeze({ family: 'margin', kinds: Object.freeze(['caveat', 'aside']) }),
  FocusFrame: Object.freeze({ family: 'focus', kinds: Object.freeze(['highlight']) }),
});

export const EDITORIAL_LIMITS = Object.freeze({
  openingSec: 6,
  closingSec: 6,
  sceneArrivalSec: 5,
  minSceneArrivalSec: 3,
  passageResolveSec: 3.5,
  callbackMinSec: 3,
  callbackMaxSec: 10,
  callbackBreathSec: 3,
  maxCallbacksPerBeat: 2,
  maxExplicitRestSec: 18,
  targetSemanticOccupancyMin: 0.40,
  targetSemanticOccupancyMax: 0.55,
  hardSemanticOccupancyMax: 0.60,
  maxAccidentalGapSec: 18,
  maxSameFamilyRun: 2,
  maxFocusShare: 0.125,
  minSceneCoverage: 0.85,
});

const BEAT_RECIPES = Object.freeze({
  group: Object.freeze({ component: 'AnchorFrame', variant: 'weave', phases: Object.freeze(['anchors', 'weave']), maxSec: 24 }),
  footnote: Object.freeze({ component: 'AnchorFrame', variant: 'tethered-note', phases: Object.freeze(['anchor', 'note']), maxSec: 22 }),
  term: Object.freeze({ component: 'AnchorFrame', variant: 'lexicon', phases: Object.freeze(['term', 'gloss']), maxSec: 22 }),
  allusion: Object.freeze({ component: 'EvidenceSpread', variant: 'echo', phases: Object.freeze(['source', 'connection']), maxSec: 24 }),
  compare: Object.freeze({ component: 'EvidenceSpread', variant: 'split-reading', phases: Object.freeze(['sources', 'axis']), maxSec: 26 }),
  chain: Object.freeze({ component: 'EvidenceSpread', variant: 'reference-route', phases: Object.freeze(['route', 'claim']), maxSec: 26 }),
  caveat: Object.freeze({ component: 'MarginFrame', variant: 'boundary', phases: Object.freeze(['boundary', 'claim']), maxSec: 20 }),
  aside: Object.freeze({ component: 'MarginFrame', variant: 'margin', phases: Object.freeze(['margin']), maxSec: 18 }),
  highlight: Object.freeze({ component: 'FocusFrame', variant: 'thesis', phases: Object.freeze(['focus']), maxSec: 11 }),
});

const COMPONENT_NAMES = new Set(Object.keys(EDITORIAL_COMPONENTS));
const FAMILY_NAMES = new Set(Object.values(EDITORIAL_COMPONENTS).map((entry) => entry.family));
const SHOT_KEYS = new Set([
  'id', 'fromSec', 'toSec', 'role', 'component', 'family', 'variant',
  'phase', 'transition', 'ruleId', 'sceneId', 'sourceBeatIds',
  'sourceSceneIds', 'semanticKind',
]);
const tenth = (value) => Math.round(Number(value) * 10) / 10;
const floorTenth = (value) => Math.floor((Number(value) + 0.000001) * 10) / 10;
const finite = (value) => Number.isFinite(Number(value));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const copy = (value) => JSON.parse(JSON.stringify(value));

function sortScenes(scenes) {
  return (Array.isArray(scenes) ? scenes : [])
    .filter((scene) => scene && typeof scene === 'object' && finite(scene.at) && typeof scene.id === 'string')
    .map(copy)
    .sort((a, b) => Number(a.at) - Number(b.at) || a.id.localeCompare(b.id));
}

function sortBeats(beats) {
  return (Array.isArray(beats) ? beats : [])
    .filter((beat) => beat && typeof beat === 'object' && finite(beat.at)
      && typeof beat.id === 'string' && BEAT_RECIPES[beat.kind])
    .map(copy)
    .sort((a, b) => Number(a.at) - Number(b.at) || a.id.localeCompare(b.id));
}

function sceneAt(scenes, at) {
  let found = null;
  for (const scene of scenes) {
    if (Number(scene.at) <= at) found = scene;
    else break;
  }
  return found;
}

function nextAfter(values, at, fallback) {
  return values.find((value) => value > at + 0.0001) ?? fallback;
}

function phaseDurations(total, count) {
  if (count <= 1 || total < 5) return [total];
  const first = clamp(tenth(total * 0.34), 2.5, 5);
  return [first, tenth(total - first)];
}

function compareVariant(beat, recipe) {
  if (beat.kind === 'compare') return beat.data?.axis === 'difference' ? 'split-difference' : 'split-likeness';
  if (beat.kind === 'chain') return `route-${clamp(Number(beat.data?.links?.length) || 2, 2, 4)}`;
  if (beat.kind === 'group') return Number(beat.data?.words?.length) >= 4 ? 'weave-four' : recipe.variant;
  return recipe.variant;
}

function makeShot({ id, fromSec, toSec, role, component, family, variant, phase, transition,
  ruleId, sceneId = null, sourceBeatIds = [], sourceSceneIds = [], semanticKind = null }) {
  return {
    id,
    fromSec: tenth(fromSec),
    toSec: tenth(toSec),
    role,
    component,
    family,
    variant,
    phase,
    transition,
    ruleId,
    sceneId,
    sourceBeatIds: [...sourceBeatIds],
    sourceSceneIds: [...sourceSceneIds],
    semanticKind,
  };
}

function intervalIsFree(shots, fromSec, toSec) {
  return !shots.some((shot) => fromSec < shot.toSec - 0.0001 && toSec > shot.fromSec + 0.0001);
}

function occupiedEndAt(shots, at) {
  return shots
    .filter((shot) => shot.fromSec <= at + 0.0001 && shot.toSec > at + 0.0001)
    .reduce((end, shot) => Math.max(end, shot.toSec), at);
}

function enforceSemanticCeiling(shots, durationSec) {
  const semantic = shots.filter((shot) => shot.role === 'semantic');
  const ceilingTicks = Math.floor((durationSec * EDITORIAL_LIMITS.hardSemanticOccupancyMax + 0.000001) * 10);
  let currentTicks = semantic.reduce(
    (sum, shot) => sum + Math.round((shot.toSec - shot.fromSec) * 10),
    0,
  );
  if (currentTicks <= ceilingTicks) return;

  const byBeat = new Map();
  for (const shot of semantic) {
    const beatId = shot.sourceBeatIds[0];
    if (!byBeat.has(beatId)) byBeat.set(beatId, []);
    byBeat.get(beatId).push(shot);
  }
  for (const phases of byBeat.values()) {
    phases.sort((a, b) => a.fromSec - b.fromSec || a.id.localeCompare(b.id));
  }

  // Reduce the longest phase first, one exact tenth at a time. Each phase
  // retains at least one tick, so dense evidence is shortened rather than
  // silently discarded. Rebuilding each beat from its original start avoids
  // rounding holes between phases.
  while (currentTicks > ceilingTicks) {
    const reducible = semantic
      .map((shot) => ({ shot, ticks: Math.round((shot.toSec - shot.fromSec) * 10) }))
      .filter((entry) => entry.ticks > 1)
      .sort((a, b) => b.ticks - a.ticks || a.shot.id.localeCompare(b.shot.id))[0];
    if (!reducible) break;
    reducible.shot.toSec = tenth(reducible.shot.toSec - 0.1);
    const phases = byBeat.get(reducible.shot.sourceBeatIds[0]);
    let cursor = phases[0].fromSec;
    for (const phase of phases) {
      const ticks = Math.max(1, Math.round((phase.toSec - phase.fromSec) * 10));
      phase.fromSec = tenth(cursor);
      phase.toSec = tenth(cursor + ticks / 10);
      cursor = phase.toSec;
    }
    currentTicks -= 1;
  }
}

function semanticSeconds(shots) {
  return tenth(shots
    .filter((shot) => shot.role === 'semantic')
    .reduce((sum, shot) => sum + shot.toSec - shot.fromSec, 0));
}

function freeIntervals(shots, scenes, closingStart) {
  const boundaries = new Set([0, closingStart]);
  for (const shot of shots) {
    boundaries.add(clamp(Number(shot.fromSec), 0, closingStart));
    boundaries.add(clamp(Number(shot.toSec), 0, closingStart));
  }
  for (const scene of scenes) boundaries.add(clamp(Number(scene.at), 0, closingStart));
  const ordered = [...boundaries].sort((a, b) => a - b);
  const intervals = [];
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const fromSec = ordered[index];
    const toSec = ordered[index + 1];
    if (toSec - fromSec < EDITORIAL_LIMITS.callbackMinSec + 0.0001) continue;
    if (intervalIsFree(shots, fromSec, toSec)) intervals.push({ fromSec, toSec });
  }
  return intervals;
}

function callbackCountsFor(shots) {
  const counts = new Map();
  for (const shot of shots) {
    if (shot.ruleId !== 'house-semantic-callback') continue;
    const beatId = shot.sourceBeatIds?.[0];
    if (beatId) counts.set(beatId, (counts.get(beatId) || 0) + 1);
  }
  return counts;
}

function nextCallbackPlacement(
  shots,
  scenes,
  beats,
  closingStart,
  callbackCounts,
  neededTicks,
  maximumAdditionalTicks = Number.POSITIVE_INFINITY,
) {
  const minimumTicks = Math.ceil(EDITORIAL_LIMITS.callbackMinSec * 10);
  const maximumTicks = Math.floor(EDITORIAL_LIMITS.callbackMaxSec * 10);
  for (const interval of freeIntervals(shots, scenes, closingStart)) {
    const roomTicks = Math.floor((interval.toSec - interval.fromSec) * 10 + 0.000001);
    // A callback is a meaningful return, not a flash. When the lower target is
    // less than one callback away, the legal minimum may cross it slightly;
    // the preferred 55% and hard 60% ceilings remain independently enforced.
    const desiredTicks = Math.min(
      maximumTicks,
      roomTicks,
      maximumAdditionalTicks,
      Math.max(minimumTicks, neededTicks),
    );
    if (desiredTicks < minimumTicks) continue;
    const spareTicks = roomTicks - desiredTicks;
    const breathTicks = Math.min(
      Math.floor(EDITORIAL_LIMITS.callbackBreathSec * 10),
      Math.floor(spareTicks / 2),
    );
    const start = tenth(interval.fromSec + breathTicks / 10);
    const activeScene = sceneAt(scenes, start);
    const eligible = beats
      .filter((beat) => Number(beat.at) <= start + 0.0001
        && beat.kind !== 'highlight'
        && (!activeScene || beat.sceneId === activeScene.id)
        && (callbackCounts.get(beat.id) || 0) < EDITORIAL_LIMITS.maxCallbacksPerBeat)
      .sort((a, b) => {
        const count = (callbackCounts.get(a.id) || 0) - (callbackCounts.get(b.id) || 0);
        return count || Number(b.at) - Number(a.at) || a.id.localeCompare(b.id);
      });
    if (!eligible.length) continue;
    return {
      interval,
      start,
      to: tenth(start + desiredTicks / 10),
      desiredTicks,
      activeScene,
      beat: eligible[0],
    };
  }
  return null;
}

function addSemanticCallbacks(shots, scenes, beats, durationSec, closingStart) {
  const targetTicks = Math.ceil((durationSec * EDITORIAL_LIMITS.targetSemanticOccupancyMin - 0.000001) * 10);
  const preferredCeilingTicks = Math.floor(
    (durationSec * EDITORIAL_LIMITS.targetSemanticOccupancyMax + 0.000001) * 10,
  );
  let currentTicks = Math.round(semanticSeconds(shots) * 10);
  if (!beats.length || currentTicks >= targetTicks) return;
  const callbackCounts = callbackCountsFor(shots);
  let callbackIndex = 0;

  while (currentTicks < targetTicks) {
    const placement = nextCallbackPlacement(
      shots,
      scenes,
      beats,
      closingStart,
      callbackCounts,
      targetTicks - currentTicks,
      preferredCeilingTicks - currentTicks,
    );
    if (!placement) break;
    const { beat, activeScene, start, to, desiredTicks } = placement;
    const recipe = BEAT_RECIPES[beat.kind];
    shots.push(makeShot({
      id: `shot:callback:${beat.id}:${callbackIndex}`,
      fromSec: start,
      toSec: to,
      role: 'semantic',
      component: recipe.component,
      family: EDITORIAL_COMPONENTS[recipe.component].family,
      variant: `${compareVariant(beat, recipe)}-callback-${callbackIndex % 2 ? 'close' : 'wide'}`,
      phase: 'callback',
      transition: callbackIndex % 2 ? 'ink' : 'dissolve',
      ruleId: 'house-semantic-callback',
      sceneId: activeScene?.id || beat.sceneId || null,
      sourceBeatIds: [beat.id],
      sourceSceneIds: activeScene ? [activeScene.id] : (beat.sceneId ? [beat.sceneId] : []),
      semanticKind: beat.kind,
    }));
    callbackCounts.set(beat.id, (callbackCounts.get(beat.id) || 0) + 1);
    callbackIndex += 1;
    currentTicks += desiredTicks;
  }
}

function trimSemanticBeatTail(entry, maxSec) {
  const minimumPhaseTicks = 1;
  const durations = entry.shots.map((shot) => Math.round((shot.toSec - shot.fromSec) * 10));
  const removableTicks = durations.reduce(
    (sum, ticks) => sum + Math.max(0, ticks - minimumPhaseTicks),
    0,
  );
  let remaining = Math.min(Math.floor(maxSec * 10), removableTicks);
  const removed = remaining;
  for (let index = durations.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const take = Math.min(remaining, Math.max(0, durations[index] - minimumPhaseTicks));
    durations[index] -= take;
    remaining -= take;
  }
  let cursor = entry.fromSec;
  entry.shots.forEach((shot, index) => {
    shot.fromSec = tenth(cursor);
    shot.toSec = tenth(cursor + durations[index] / 10);
    cursor = shot.toSec;
  });
  entry.toSec = tenth(cursor);
  return removed / 10;
}

function addFamilyPunctuation(shots, scenes) {
  const semantic = shots
    .filter((shot) => shot.role === 'semantic')
    .sort((a, b) => a.fromSec - b.fromSec || a.id.localeCompare(b.id));
  const entries = [];
  for (const shot of semantic) {
    const beatId = shot.sourceBeatIds?.[0];
    const previous = entries.at(-1);
    if (previous?.beatId === beatId) {
      previous.shots.push(shot);
      previous.toSec = Math.max(previous.toSec, shot.toSec);
    } else {
      entries.push({
        beatId,
        family: shot.family,
        semanticKind: shot.semanticKind,
        sceneId: shot.sceneId,
        sourceSceneIds: [...shot.sourceSceneIds],
        fromSec: shot.fromSec,
        toSec: shot.toSec,
        shots: [shot],
      });
    }
  }

  let runFamily = null;
  let runLength = 0;
  let previous = null;
  let punctuationIndex = 0;
  for (const entry of entries) {
    const contiguous = previous && Math.abs(previous.toSec - entry.fromSec) <= 0.0001;
    if (!contiguous || entry.family !== runFamily) {
      runFamily = entry.family;
      runLength = 1;
    } else {
      runLength += 1;
    }
    if (runLength > EDITORIAL_LIMITS.maxSameFamilyRun && previous) {
      const removedSec = trimSemanticBeatTail(previous, EDITORIAL_LIMITS.passageResolveSec);
      if (removedSec > 0.0001) {
        const sourceScene = scenes.find((scene) => scene.id === previous.sceneId)
          || sceneAt(scenes, previous.toSec);
        const hasPassage = Boolean(sourceScene?.verses?.length);
        shots.push(makeShot({
          id: `shot:punctuate:${previous.beatId}:${entry.beatId}:${punctuationIndex}`,
          fromSec: previous.toSec,
          toSec: entry.fromSec,
          role: 'passage-resolve',
          component: hasPassage ? 'PassageFrame' : 'ListeningFrame',
          family: hasPassage ? 'passage' : 'listening',
          variant: hasPassage ? 'reading-punctuation' : 'listening-punctuation',
          phase: 'punctuate',
          transition: 'ink',
          ruleId: 'house-family-punctuation',
          sceneId: sourceScene?.id || previous.sceneId || null,
          sourceBeatIds: previous.beatId ? [previous.beatId] : [],
          sourceSceneIds: sourceScene ? [sourceScene.id] : [...previous.sourceSceneIds],
          semanticKind: previous.semanticKind,
        }));
        punctuationIndex += 1;
        // The house frame is a real perceptual break. The incoming beat starts
        // a new family run even when further beats share its component family.
        runLength = 1;
      }
    }
    previous = entry;
  }
}

function fillEditorialRests(shots, scenes, durationSec) {
  const ordered = [...shots].sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec || a.id.localeCompare(b.id));
  const filled = [];
  let cursor = 0;
  let restIndex = 0;
  const addRestRange = (start, end) => {
    let at = start;
    while (at < end - 0.0001) {
      const to = Math.min(end, at + EDITORIAL_LIMITS.maxExplicitRestSec);
      const scene = sceneAt(scenes, at);
      const hasPassage = Boolean(scene?.verses?.length);
      const component = hasPassage ? 'PassageFrame' : 'ListeningFrame';
      const family = hasPassage ? 'passage' : 'listening';
      filled.push(makeShot({
        id: `shot:rest:${restIndex}`,
        fromSec: at,
        toSec: to,
        role: 'intentional-rest',
        component,
        family,
        variant: `${hasPassage ? 'reading' : 'listening'}-${restIndex % 2 ? 'close' : 'wide'}`,
        phase: restIndex % 2 ? 'breathe' : 'hold',
        transition: restIndex % 2 ? 'ink' : 'dissolve',
        ruleId: 'house-rest-grid',
        sceneId: scene?.id || null,
        sourceSceneIds: scene ? [scene.id] : [],
      }));
      restIndex += 1;
      at = to;
    }
  };

  for (const shot of ordered) {
    if (shot.fromSec > cursor + 0.0001) addRestRange(cursor, shot.fromSec);
    if (shot.toSec <= cursor + 0.0001) continue;
    if (shot.fromSec < cursor - 0.0001) {
      // Earlier phases win deterministically. The compiler should have made
      // these disjoint; clipping here keeps a malformed input from creating
      // two current shots while validation still reports the provenance gap.
      filled.push({ ...shot, fromSec: tenth(cursor) });
    } else {
      filled.push(shot);
    }
    cursor = Math.max(cursor, shot.toSec);
  }
  if (cursor < durationSec - 0.0001) addRestRange(cursor, durationSec);
  return filled.sort((a, b) => a.fromSec - b.fromSec || a.toSec - b.toSec || a.id.localeCompare(b.id));
}

export function compileEditorialPlan(direction, {
  durationSec = direction?.clip?.durationSec,
  stepIndex = 0,
  stepCount = 1,
} = {}) {
  const duration = Math.max(0, tenth(Number(durationSec) || 0));
  const scenes = sortScenes(direction?.scenes);
  const beats = sortBeats(direction?.beats);
  const safeStepIndex = Math.max(0, Math.floor(Number(stepIndex) || 0));
  const safeStepCount = Math.max(1, Math.floor(Number(stepCount) || 1));
  const shots = [];

  if (duration <= 0) {
    return {
      schemaVersion: MAGIC_EDITORIAL_SCHEMA_VERSION,
      policyVersion: MAGIC_EDITORIAL_POLICY_VERSION,
      durationSec: duration,
      stepIndex: safeStepIndex,
      stepCount: safeStepCount,
      shots: [],
      metrics: measureEditorialContinuity(
        { durationSec: duration, shots: [], scenes, beats },
        { scenes, beats },
      ),
    };
  }

  const earliestBeat = beats.length ? clamp(Number(beats[0].at), 0, duration) : duration;
  const openingEnd = Math.min(duration, EDITORIAL_LIMITS.openingSec, earliestBeat > 0 ? earliestBeat : 0);
  if (openingEnd > 0) {
    shots.push(makeShot({
      id: 'shot:bookend:open',
      fromSec: 0,
      toSec: openingEnd,
      role: safeStepIndex === 0 ? 'opening' : 'transition',
      component: 'BookendSlate',
      family: 'bookend',
      variant: safeStepIndex === 0 ? 'tour-opening' : 'movement-transition',
      phase: 'arrive',
      transition: safeStepIndex === 0 ? 'dissolve' : 'cut',
      ruleId: 'house-bookend-open',
    }));
  }

  const lastBeatAt = beats.length ? clamp(Number(beats.at(-1).at), 0, duration) : 0;
  const desiredClose = Math.max(openingEnd, duration - EDITORIAL_LIMITS.closingSec);
  const closeAfterBeat = beats.length && lastBeatAt >= desiredClose
    ? Math.min(duration, lastBeatAt + Math.min(4, Math.max(0, duration - lastBeatAt)))
    : desiredClose;
  const closingStart = Math.max(openingEnd, closeAfterBeat);

  // Beats sharing one cue divide the time until the next hard boundary. This
  // retains every grounded action without putting two foregrounds on screen.
  const beatGroups = [];
  for (const beat of beats) {
    const at = clamp(tenth(beat.at), 0, closingStart);
    let group = beatGroups.at(-1);
    if (!group || group.at !== at) {
      group = { at, beats: [] };
      beatGroups.push(group);
    }
    group.beats.push(beat);
  }
  const sceneTimes = scenes.map((scene) => clamp(tenth(scene.at), 0, duration)).sort((a, b) => a - b);
  const beatTimes = beatGroups.map((group) => group.at);
  for (const group of beatGroups) {
    if (group.at >= closingStart - 0.0001) continue;
    const boundary = Math.min(
      nextAfter(beatTimes, group.at, closingStart),
      nextAfter(sceneTimes, group.at, closingStart),
      closingStart,
    );
    const available = Math.max(0, boundary - group.at);
    const slot = group.beats.length ? available / group.beats.length : 0;
    let cursor = group.at;
    for (const beat of group.beats) {
      const recipe = BEAT_RECIPES[beat.kind];
      const total = Math.max(0, Math.min(recipe.maxSec, slot));
      if (total <= 0.0001) continue;
      const durations = phaseDurations(total, recipe.phases.length);
      const phases = durations.length === 1 && recipe.phases.length > 1 ? ['full'] : recipe.phases;
      durations.forEach((phaseDuration, phaseIndex) => {
        const to = Math.min(boundary, cursor + phaseDuration);
        if (to <= cursor + 0.0001) return;
        const scene = scenes.find((candidate) => candidate.id === beat.sceneId) || sceneAt(scenes, cursor);
        shots.push(makeShot({
          id: `shot:beat:${beat.id}:${phaseIndex}`,
          fromSec: cursor,
          toSec: to,
          role: 'semantic',
          component: recipe.component,
          family: EDITORIAL_COMPONENTS[recipe.component].family,
          variant: compareVariant(beat, recipe),
          phase: phases[phaseIndex] || phases.at(-1) || 'full',
          transition: beat.kind === 'highlight' ? 'focus' : (phaseIndex ? 'ink' : 'dissolve'),
          ruleId: `semantic-${beat.kind}-${phases[phaseIndex] || 'full'}`,
          sceneId: scene?.id || beat.sceneId || null,
          sourceBeatIds: [beat.id],
          sourceSceneIds: scene ? [scene.id] : (beat.sceneId ? [beat.sceneId] : []),
          semanticKind: beat.kind,
        }));
        cursor = to;
      });
    }
  }

  // A third uninterrupted card from one visual family makes the edit feel
  // like a UI carousel. Carve a short resolve from the already-visible prior
  // beat so the house can return to its source passage/listening stage before
  // the third cue. The incoming beat is never exposed before Luna's cue, and
  // every authored phase remains represented by at least one tenth-second.
  addFamilyPunctuation(shots, scenes);

  // Dense semantic evidence is valuable, but the foreground may not become a
  // wall of cards. Compress recipes proportionally to the hard attention
  // budget; the newly opened intervals become passage/listening punctuation.
  const semanticCandidates = shots.filter((shot) => shot.role === 'semantic');
  const semanticTotal = semanticCandidates.reduce((sum, shot) => sum + shot.toSec - shot.fromSec, 0);
  const semanticCeiling = duration * EDITORIAL_LIMITS.hardSemanticOccupancyMax;
  if (semanticTotal > semanticCeiling && semanticTotal > 0) {
    const scale = semanticCeiling / semanticTotal;
    const byBeat = new Map();
    for (const shot of semanticCandidates) {
      const beatId = shot.sourceBeatIds[0];
      if (!byBeat.has(beatId)) byBeat.set(beatId, []);
      byBeat.get(beatId).push(shot);
    }
    for (const phases of byBeat.values()) {
      phases.sort((a, b) => a.fromSec - b.fromSec || a.id.localeCompare(b.id));
      let cursor = phases[0].fromSec;
      for (const phase of phases) {
        const scaled = Math.max(0.5, tenth((phase.toSec - phase.fromSec) * scale));
        phase.fromSec = tenth(cursor);
        phase.toSec = tenth(cursor + scaled);
        cursor = phase.toSec;
      }
    }
    enforceSemanticCeiling(shots, duration);
  }

  // A structural scene arrival is useful only where it does not mask a beat.
  // The canonical passage remains the base stage even when this foreground is
  // skipped, so semantics always win a collision.
  scenes.forEach((scene, index) => {
    const requested = Math.max(openingEnd, clamp(tenth(scene.at), 0, closingStart));
    let start = occupiedEndAt(shots, requested);
    const nextBeat = nextAfter(beatTimes, requested, closingStart);
    const nextScene = nextAfter(sceneTimes, requested, closingStart);
    const end = Math.min(start + EDITORIAL_LIMITS.sceneArrivalSec, nextBeat, nextScene, closingStart);
    if (end < start + EDITORIAL_LIMITS.minSceneArrivalSec - 0.0001
      || !intervalIsFree(shots, start, end)) return;
    const hasPassage = Boolean(scene.verses?.length);
    shots.push(makeShot({
      id: `shot:scene:${scene.id}:${index}`,
      fromSec: start,
      toSec: end,
      role: 'scene-arrival',
      component: hasPassage ? 'PassageFrame' : 'ListeningFrame',
      family: hasPassage ? 'passage' : 'listening',
      variant: hasPassage ? 'reference-arrival' : 'context-arrival',
      phase: 'establish',
      transition: index ? 'scene-turn' : 'dissolve',
      ruleId: 'house-scene-arrival',
      sceneId: scene.id,
      sourceSceneIds: [scene.id],
    }));
  });

  // Sparse movements reuse already-grounded evidence as explicit editorial
  // callbacks. This is the house equivalent of a video editor returning to a
  // key term or comparison: no new copy or claim is introduced, the source
  // beat remains traceable, and only free time inside that beat's scene is
  // eligible. Callbacks get first claim on otherwise empty time; clean-passage
  // resolves are then added wherever room remains.
  addSemanticCallbacks(shots, scenes, beats, duration, closingStart);
  // Re-run the same deterministic punctuation pass because a callback is also
  // a semantic foreground. It must not create the third uninterrupted family
  // card that the initial beat sequence was designed to prevent.
  addFamilyPunctuation(shots, scenes);

  // A short clean-passage resolve separates semantic families where time
  // permits. It is a visual callback to the source scene, not new copy.
  const semanticEnds = [...shots].filter((shot) => shot.role === 'semantic')
    .sort((a, b) => a.toSec - b.toSec || a.id.localeCompare(b.id));
  semanticEnds.forEach((shot, index) => {
    const start = shot.toSec;
    const nextStart = shots
      .filter((candidate) => candidate.fromSec >= start - 0.0001 && candidate.id !== shot.id)
      .sort((a, b) => a.fromSec - b.fromSec || a.id.localeCompare(b.id))[0]?.fromSec ?? closingStart;
    const end = Math.min(start + EDITORIAL_LIMITS.passageResolveSec, nextStart, closingStart);
    if (end <= start + 1 || !intervalIsFree(shots, start, end)) return;
    const scene = scenes.find((candidate) => candidate.id === shot.sceneId) || sceneAt(scenes, start);
    shots.push(makeShot({
      id: `shot:resolve:${shot.sourceBeatIds[0]}:${index}`,
      fromSec: start,
      toSec: end,
      role: 'passage-resolve',
      component: scene?.verses?.length ? 'PassageFrame' : 'ListeningFrame',
      family: scene?.verses?.length ? 'passage' : 'listening',
      variant: scene?.verses?.length ? 'reading-resolve' : 'listening-resolve',
      phase: 'resolve',
      transition: 'ink',
      ruleId: 'house-beat-resolve',
      sceneId: scene?.id || shot.sceneId,
      sourceBeatIds: [...shot.sourceBeatIds],
      sourceSceneIds: scene ? [scene.id] : [...shot.sourceSceneIds],
      semanticKind: shot.semanticKind,
    }));
  });

  if (closingStart < duration - 0.0001) {
    shots.push(makeShot({
      id: 'shot:bookend:close',
      fromSec: closingStart,
      toSec: duration,
      role: safeStepIndex === safeStepCount - 1 ? 'closing' : 'movement-close',
      component: 'BookendSlate',
      family: 'bookend',
      variant: safeStepIndex === safeStepCount - 1 ? 'tour-closing' : 'movement-close',
      phase: 'resolve',
      transition: 'dissolve',
      ruleId: 'house-bookend-close',
    }));
  }

  const completeShots = fillEditorialRests(shots, scenes, duration);
  const plan = {
    schemaVersion: MAGIC_EDITORIAL_SCHEMA_VERSION,
    policyVersion: MAGIC_EDITORIAL_POLICY_VERSION,
    durationSec: duration,
    stepIndex: safeStepIndex,
    stepCount: safeStepCount,
    shots: completeShots,
  };
  plan.metrics = measureEditorialContinuity({ ...plan, scenes, beats }, { scenes, beats });
  return plan;
}

export function resolveEditorialShot(plan, atSec) {
  const at = Number(atSec);
  if (!Number.isFinite(at) || !Array.isArray(plan?.shots)) return null;
  const duration = Math.max(0, Number(plan.durationSec) || 0);
  const wanted = at === duration && duration > 0 ? Math.max(0, duration - 0.0001) : at;
  return plan.shots.find((shot) => wanted >= Number(shot.fromSec) && wanted < Number(shot.toSec)) || null;
}

function unionDuration(intervals) {
  const ordered = intervals
    .filter(([start, end]) => finite(start) && finite(end) && end > start)
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let total = 0;
  let active = null;
  for (const interval of ordered) {
    if (!active || interval[0] > active[1]) {
      if (active) total += active[1] - active[0];
      active = [...interval];
    } else {
      active[1] = Math.max(active[1], interval[1]);
    }
  }
  if (active) total += active[1] - active[0];
  return total;
}

function maximumFamilyRun(shots) {
  let maximum = 0;
  let run = 0;
  let previous = null;
  let previousBeat = null;
  for (const shot of shots) {
    if (shot.role !== 'semantic') {
      // Passage, listening, and bookend frames are deliberate visual
      // punctuation. They break a perceptual run without pretending that the
      // next semantic action is a different kind.
      run = 0;
      previous = null;
      previousBeat = null;
      continue;
    }
    const beat = shot.sourceBeatIds?.[0] || null;
    if (beat && beat === previousBeat) continue;
    if (shot.family === previous) run += 1;
    else run = 1;
    previous = shot.family;
    previousBeat = beat;
    maximum = Math.max(maximum, run);
  }
  return maximum;
}

function remainingLegalCallbackTicks(plan, scenes, beats, semanticTicks) {
  const duration = Math.max(0, Number(plan?.durationSec) || 0);
  const targetTicks = Math.ceil(
    (duration * EDITORIAL_LIMITS.targetSemanticOccupancyMin - 0.000001) * 10,
  );
  if (!beats.length || semanticTicks >= targetTicks) return 0;
  const preferredCeilingTicks = Math.floor(
    (duration * EDITORIAL_LIMITS.targetSemanticOccupancyMax + 0.000001) * 10,
  );
  // Intentional rests and ordinary post-beat resolves are the replaceable
  // house layer. Bookends, scene arrivals, family punctuation, and all
  // semantic shots remain protected exactly as they were during compilation.
  const work = (Array.isArray(plan?.shots) ? plan.shots : [])
    .filter((shot) => shot.role !== 'intentional-rest' && shot.ruleId !== 'house-beat-resolve')
    .map(copy);
  const closingStart = work
    .filter((shot) => shot.role === 'closing' || shot.role === 'movement-close')
    .reduce((start, shot) => Math.min(start, Number(shot.fromSec)), duration);
  const callbackCounts = callbackCountsFor(work);
  let opportunityTicks = 0;
  let syntheticIndex = 0;

  while (semanticTicks + opportunityTicks < targetTicks) {
    const placement = nextCallbackPlacement(
      work,
      scenes,
      beats,
      closingStart,
      callbackCounts,
      targetTicks - semanticTicks - opportunityTicks,
      preferredCeilingTicks - semanticTicks - opportunityTicks,
    );
    if (!placement) break;
    const { beat, activeScene, start, to, desiredTicks } = placement;
    const recipe = BEAT_RECIPES[beat.kind];
    work.push(makeShot({
      id: `shot:measure-callback:${beat.id}:${syntheticIndex}`,
      fromSec: start,
      toSec: to,
      role: 'semantic',
      component: recipe.component,
      family: EDITORIAL_COMPONENTS[recipe.component].family,
      variant: recipe.variant,
      phase: 'callback',
      transition: 'dissolve',
      ruleId: 'house-semantic-callback',
      sceneId: activeScene?.id || beat.sceneId || null,
      sourceBeatIds: [beat.id],
      sourceSceneIds: activeScene ? [activeScene.id] : (beat.sceneId ? [beat.sceneId] : []),
      semanticKind: beat.kind,
    }));
    callbackCounts.set(beat.id, (callbackCounts.get(beat.id) || 0) + 1);
    opportunityTicks += desiredTicks;
    syntheticIndex += 1;
  }
  return opportunityTicks;
}

export function measureEditorialContinuity(plan, direction = null) {
  const duration = Math.max(0, Number(plan?.durationSec) || 0);
  const shots = Array.isArray(plan?.shots) ? [...plan.shots].sort((a, b) => a.fromSec - b.fromSec) : [];
  const semantic = shots.filter((shot) => shot.role === 'semantic');
  const focus = shots.filter((shot) => shot.family === 'focus');
  const rests = shots.filter((shot) => shot.role === 'intentional-rest');
  const semanticSec = unionDuration(semantic.map((shot) => [shot.fromSec, shot.toSec]));
  const focusSec = unionDuration(focus.map((shot) => [shot.fromSec, shot.toSec]));
  const coveredSec = unionDuration(shots.map((shot) => [shot.fromSec, shot.toSec]));
  let maxAccidentalGapSec = 0;
  let cursor = 0;
  for (const shot of shots) {
    maxAccidentalGapSec = Math.max(maxAccidentalGapSec, Number(shot.fromSec) - cursor);
    cursor = Math.max(cursor, Number(shot.toSec));
  }
  maxAccidentalGapSec = Math.max(maxAccidentalGapSec, duration - cursor);
  const sourceScenes = Array.isArray(direction?.scenes)
    ? sortScenes(direction.scenes)
    : sortScenes(plan?.scenes);
  const sourceBeats = Array.isArray(direction?.beats)
    ? sortBeats(direction.beats)
    : sortBeats(plan?.beats);
  const sceneIds = new Set(sourceScenes.map((scene) => scene.id));
  const representedScenes = new Set(shots.flatMap((shot) => shot.sourceSceneIds || []).filter((id) => sceneIds.has(id)));
  const semanticOccupancy = duration ? semanticSec / duration : 0;
  const focusShare = duration ? focusSec / duration : 0;
  const sceneCoverage = sceneIds.size ? representedScenes.size / sceneIds.size : 1;
  const maxSameFamilyRun = maximumFamilyRun(shots);
  const maxExplicitRestSec = rests.reduce((maximum, shot) => Math.max(maximum, shot.toSec - shot.fromSec), 0);
  const semanticTicks = Math.round(semanticSec * 10);
  const semanticTargetTicks = Math.ceil(
    (duration * EDITORIAL_LIMITS.targetSemanticOccupancyMin - 0.000001) * 10,
  );
  const semanticTargetGapTicks = Math.max(0, semanticTargetTicks - semanticTicks);
  const legalCallbackOpportunityTicks = remainingLegalCallbackTicks(
    plan,
    sourceScenes,
    sourceBeats,
    semanticTicks,
  );
  const semanticTargetExhausted = semanticTargetGapTicks > 0 && legalCallbackOpportunityTicks === 0;
  const metrics = {
    shotCount: shots.length,
    semanticShotCount: semantic.length,
    semanticBeatCount: new Set(semantic.flatMap((shot) => shot.sourceBeatIds || [])).size,
    semanticSec: tenth(semanticSec),
    semanticOccupancy: Math.round(semanticOccupancy * 10000) / 10000,
    semanticTargetSec: tenth(semanticTargetTicks / 10),
    semanticTargetGapSec: tenth(semanticTargetGapTicks / 10),
    legalCallbackOpportunitySec: tenth(legalCallbackOpportunityTicks / 10),
    semanticTargetExhausted,
    explicitRestSec: tenth(unionDuration(rests.map((shot) => [shot.fromSec, shot.toSec]))),
    maxExplicitRestSec: tenth(maxExplicitRestSec),
    coveredSec: tenth(coveredSec),
    maxAccidentalGapSec: tenth(Math.max(0, maxAccidentalGapSec)),
    maxSameFamilyRun,
    focusSec: tenth(focusSec),
    focusShare: Math.round(focusShare * 10000) / 10000,
    sceneCoverage: Math.round(sceneCoverage * 10000) / 10000,
  };
  metrics.gates = {
    semanticOccupancyTarget: semanticOccupancy + 0.0000001 >= EDITORIAL_LIMITS.targetSemanticOccupancyMin
      && semanticOccupancy <= EDITORIAL_LIMITS.targetSemanticOccupancyMax + 0.0000001,
    semanticOccupancyTargetOrExhausted: semanticOccupancy + 0.0000001
      >= EDITORIAL_LIMITS.targetSemanticOccupancyMin || semanticTargetExhausted,
    semanticOccupancyHard: semanticOccupancy <= EDITORIAL_LIMITS.hardSemanticOccupancyMax + 0.0000001,
    accidentalGap: metrics.maxAccidentalGapSec <= EDITORIAL_LIMITS.maxAccidentalGapSec,
    explicitRest: metrics.maxExplicitRestSec <= EDITORIAL_LIMITS.maxExplicitRestSec,
    sameFamilyRun: maxSameFamilyRun <= EDITORIAL_LIMITS.maxSameFamilyRun,
    focusShare: focusShare <= EDITORIAL_LIMITS.maxFocusShare + 0.0000001,
    sceneCoverage: sceneCoverage >= EDITORIAL_LIMITS.minSceneCoverage,
  };
  return metrics;
}

export function validateEditorialPlan(plan, direction = null) {
  const errors = [];
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) {
    return { ok: false, errors: ['editorial plan must be an object'] };
  }
  if (plan.schemaVersion !== MAGIC_EDITORIAL_SCHEMA_VERSION) errors.push('editorial schema is not supported');
  if (plan.policyVersion !== MAGIC_EDITORIAL_POLICY_VERSION) errors.push('editorial policy is not supported');
  if (direction?.schemaVersion != null && direction.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    errors.push('source director schema is not supported');
  }
  if (direction?.policyVersion != null && direction.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    errors.push('source director policy is not supported');
  }
  const duration = Number(plan.durationSec);
  if (!Number.isFinite(duration) || duration <= 0) errors.push('durationSec must be positive');
  if (finite(direction?.clip?.durationSec)
    && Math.abs(Number(direction.clip.durationSec) - duration) > 0.0001) {
    errors.push('durationSec does not match the source direction');
  }
  if (!Array.isArray(plan.shots) || !plan.shots.length) errors.push('shots must be nonempty');
  const beats = new Map((Array.isArray(direction?.beats) ? direction.beats : []).map((beat) => [beat.id, beat]));
  const scenes = new Map((Array.isArray(direction?.scenes) ? direction.scenes : []).map((scene) => [scene.id, scene]));
  const orderedScenes = sortScenes(direction?.scenes);
  const representedBeatIds = new Set();
  const directionBeatIds = new Set();
  for (const beat of (Array.isArray(direction?.beats) ? direction.beats : [])) {
    if (!beat?.id || directionBeatIds.has(beat.id)) {
      errors.push(`source beat ${beat?.id || '<missing>'} is duplicated or invalid`);
      continue;
    }
    directionBeatIds.add(beat.id);
    if (!BEAT_RECIPES[beat.kind]) errors.push(`source beat ${beat.id} has unsupported kind`);
    const ownerIndex = orderedScenes.findIndex((scene) => scene.id === beat.sceneId);
    const owner = orderedScenes[ownerIndex];
    const ownerEnd = orderedScenes[ownerIndex + 1]?.at ?? duration;
    if (!owner || Number(beat.at) < Number(owner.at) - 0.0001
      || Number(beat.at) >= Number(ownerEnd) - 0.0001) {
      errors.push(`source beat ${beat.id} is outside its owning scene`);
    }
  }
  const ids = new Set();
  let cursor = 0;
  for (const [index, shot] of (Array.isArray(plan.shots) ? plan.shots : []).entries()) {
    if (!shot || typeof shot !== 'object' || Array.isArray(shot)) {
      errors.push(`shot ${index} must be an object`);
      continue;
    }
    const unknownKeys = Object.keys(shot).filter((key) => !SHOT_KEYS.has(key));
    if (unknownKeys.length) errors.push(`shot ${shot.id || index} has unknown fields: ${unknownKeys.join(', ')}`);
    if (typeof shot.id !== 'string' || !shot.id) errors.push(`shot ${index} needs id`);
    else if (ids.has(shot.id)) errors.push(`shot ${shot.id} is duplicated`);
    else ids.add(shot.id);
    const from = Number(shot.fromSec);
    const to = Number(shot.toSec);
    if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from || to > duration + 0.0001) {
      errors.push(`shot ${shot.id || index} has invalid bounds`);
    }
    if (Number.isFinite(from) && Math.abs(from - cursor) > 0.0001) {
      errors.push(`shot ${shot.id || index} does not meet the previous half-open boundary`);
    }
    if (Number.isFinite(to)) cursor = to;
    if (!COMPONENT_NAMES.has(shot.component)) errors.push(`shot ${shot.id || index} has unknown component`);
    if (!FAMILY_NAMES.has(shot.family)) errors.push(`shot ${shot.id || index} has unknown family`);
    if (EDITORIAL_COMPONENTS[shot.component]?.family
      && EDITORIAL_COMPONENTS[shot.component].family !== shot.family) {
      errors.push(`shot ${shot.id || index} component and family do not match`);
    }
    if (!Array.isArray(shot.sourceBeatIds) || !Array.isArray(shot.sourceSceneIds)) {
      errors.push(`shot ${shot.id || index} has invalid source references`);
      continue;
    }
    for (const beatId of shot.sourceBeatIds) {
      const beat = beats.get(beatId);
      if (!beat) errors.push(`shot ${shot.id || index} has orphan beat ${beatId}`);
      else {
        representedBeatIds.add(beatId);
        if (from + 0.0001 < Number(beat.at)) errors.push(`shot ${shot.id || index} reveals ${beatId} before its cue`);
        if (shot.semanticKind && shot.semanticKind !== beat.kind) {
          errors.push(`shot ${shot.id || index} changes the semantic kind of ${beatId}`);
        }
        if (shot.role === 'semantic') {
          const recipe = BEAT_RECIPES[beat.kind];
          if (recipe && shot.component !== recipe.component) {
            errors.push(`shot ${shot.id || index} changes the component mapping of ${beatId}`);
          }
          if (shot.sceneId !== beat.sceneId
            || shot.sourceSceneIds.length !== 1
            || shot.sourceSceneIds[0] !== beat.sceneId) {
            errors.push(`shot ${shot.id || index} changes the scene ownership of ${beatId}`);
          }
        }
      }
    }
    for (const sceneId of shot.sourceSceneIds) {
      if (!scenes.has(sceneId)) errors.push(`shot ${shot.id || index} has orphan scene ${sceneId}`);
    }
    if (shot.role === 'semantic' && (!shot.sourceBeatIds.length || !shot.semanticKind)) {
      errors.push(`semantic shot ${shot.id || index} lacks semantic provenance`);
    }
  }
  if (Number.isFinite(duration) && Math.abs(cursor - duration) > 0.0001) errors.push('shots do not cover duration exactly');
  for (const beatId of directionBeatIds) {
    if (!representedBeatIds.has(beatId)) errors.push(`source beat ${beatId} is not represented`);
  }
  const measured = measureEditorialContinuity({
    ...plan,
    scenes: Array.isArray(direction?.scenes) ? direction.scenes : [],
    beats: Array.isArray(direction?.beats) ? direction.beats : [],
  }, direction);
  if (!measured.gates.semanticOccupancyHard) errors.push('semantic occupancy exceeds the hard ceiling');
  if (!measured.gates.accidentalGap) errors.push('plan has an accidental coverage gap');
  if (!measured.gates.explicitRest) errors.push('plan has an overlong explicit rest');
  if (!measured.gates.focusShare) errors.push('focus share exceeds the hard ceiling');
  if (!measured.gates.sameFamilyRun) errors.push('semantic family run exceeds the hard ceiling');
  if (!measured.gates.semanticOccupancyTargetOrExhausted) {
    errors.push('plan leaves a legal grounded callback unused below the semantic target');
  }
  if (plan.metrics && JSON.stringify(plan.metrics) !== JSON.stringify(measured)) {
    errors.push('stored editorial metrics do not match the compiled shots');
  }
  return { ok: errors.length === 0, errors };
}

export function truncateEditorialCopy(value, maxChars, { ellipsis = false } = {}) {
  const text = String(value ?? '').replace(/\s+/gu, ' ').trim();
  const maximum = Math.max(1, Math.floor(Number(maxChars) || 0));
  if (text.length < maximum || (text.length === maximum && !ellipsis)) return text;
  const suffix = ellipsis ? '…' : '';
  const limit = Math.max(1, maximum - suffix.length);
  const window = text.slice(0, limit + 1);
  const sentenceMatches = [...window.matchAll(/[.!?](?=\s|$)/gu)];
  const sentenceEnd = sentenceMatches.at(-1)?.index;
  let result = sentenceEnd != null && sentenceEnd + 1 >= Math.floor(limit * 0.55)
    ? window.slice(0, sentenceEnd + 1)
    : window.slice(0, Math.max(window.lastIndexOf(' '), 0));
  result = result.trim().replace(/[,;:]$/u, '').trim();
  if (!result) {
    const first = text.match(/^\S+/u)?.[0] || '';
    result = first.length <= limit ? first : first.slice(0, limit);
  }
  return `${result}${suffix}`;
}
