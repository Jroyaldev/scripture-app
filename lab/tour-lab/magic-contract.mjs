// Shared, versioned contracts for the isolated /magic experiment.
//
// The model names semantic things and transcript cues. This module is the
// house: it owns role routing, durable versions, final caps, and timeline
// normalization. It is browser-safe so the page and server cannot drift.

export const MAGIC_DIRECTOR_SCHEMA_VERSION = 1;
export const MAGIC_REPLAY_SCHEMA_VERSION = 1;

export const MAGIC_MODEL_KEY = 'gpt-5.6-luna-medium';
export const MAGIC_MODEL_RUNTIME = Object.freeze({
  key: MAGIC_MODEL_KEY,
  requestedSlug: 'openai/gpt-5.6-luna',
  endpointHost: 'openrouter.ai',
  endpointStyle: 'aggregator',
  reasoningEffort: 'medium',
});
export const MAGIC_MODEL_ROLES = Object.freeze({
  search: MAGIC_MODEL_KEY,
  whispers: MAGIC_MODEL_KEY,
  form: MAGIC_MODEL_KEY,
  director: MAGIC_MODEL_KEY,
});

export const DIRECTOR_LIMITS = Object.freeze({
  maxScenes: 4,
  sceneMinGapSec: 12,
  fieldMinGapSec: 2.5,
  asideSilenceSec: 25,
  fillGapSec: 45,
  longClipSec: 480,
  maxGroups: 4,
  maxFootnotes: 2,
  maxTerms: 2,
  maxAllusions: 2,
  maxVerseAsides: 1,
  maxBareAsides: 2,
});

const TIMING_SOURCES = new Set(['cue', 'word', 'house']);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => (
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value))
);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const tenth = (value) => Math.round(value * 10) / 10;

export function assertMagicModel(modelKey) {
  if (modelKey !== MAGIC_MODEL_KEY) {
    const error = new Error(`\/magic permits only ${MAGIC_MODEL_KEY}; received ${String(modelKey || 'no model')}`);
    error.code = 'MAGIC_MODEL_REFUSED';
    throw error;
  }
  return modelKey;
}

export function resolveMagicSearchModels(input) {
  if (!isObject(input) || input.surface !== 'magic') return null;
  const supplied = Array.isArray(input.models) && input.models.length
    ? input.models
    : input.model != null
      ? [input.model]
      : [];
  const requested = [...new Set(supplied.map((value) => String(value || '').trim()).filter(Boolean))];
  if (requested.some((modelKey) => modelKey !== MAGIC_MODEL_ROLES.search)) {
    const error = new Error(`\/magic search permits only ${MAGIC_MODEL_ROLES.search}`);
    error.code = 'MAGIC_MODEL_REFUSED';
    throw error;
  }
  return [MAGIC_MODEL_ROLES.search];
}

export function assertMagicRuntime(runtime) {
  const errors = [];
  if (!isObject(runtime)) {
    errors.push('runtime descriptor is required');
  } else {
    if (runtime.key !== MAGIC_MODEL_RUNTIME.key) errors.push(`key must be ${MAGIC_MODEL_RUNTIME.key}`);
    if (runtime.requestedSlug !== MAGIC_MODEL_RUNTIME.requestedSlug) {
      errors.push(`requested slug must be ${MAGIC_MODEL_RUNTIME.requestedSlug}`);
    }
    if (runtime.resolvedSlug !== MAGIC_MODEL_RUNTIME.requestedSlug) {
      errors.push(`resolved slug must be exactly ${MAGIC_MODEL_RUNTIME.requestedSlug}`);
    }
    if (runtime.endpointHost !== MAGIC_MODEL_RUNTIME.endpointHost) {
      errors.push(`endpoint host must be ${MAGIC_MODEL_RUNTIME.endpointHost}`);
    }
    if (runtime.endpointStyle !== MAGIC_MODEL_RUNTIME.endpointStyle) {
      errors.push(`endpoint style must be ${MAGIC_MODEL_RUNTIME.endpointStyle}`);
    }
    if (runtime.reasoning?.effort !== MAGIC_MODEL_RUNTIME.reasoningEffort) {
      errors.push(`reasoning effort must be ${MAGIC_MODEL_RUNTIME.reasoningEffort}`);
    }
    if (runtime.reasoning?.applied !== true) errors.push('reasoning effort must be applied by the endpoint');
  }
  if (errors.length) {
    const error = new Error(`\/magic Luna/OpenRouter runtime refused: ${errors.join('; ')}`);
    error.code = 'MAGIC_RUNTIME_REFUSED';
    error.reasons = errors;
    throw error;
  }
  return runtime;
}

export function stableTextHash(value) {
  let hash = 0xcbf29ce484222325n;
  for (const ch of String(value ?? '')) {
    hash ^= BigInt(ch.codePointAt(0));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, '0');
}

export function directorCacheKey({
  modelKey = MAGIC_MODEL_ROLES.director,
  schemaVersion = MAGIC_DIRECTOR_SCHEMA_VERSION,
  recordId,
  fromSec,
  toSec,
  why = '',
}) {
  assertMagicModel(modelKey);
  const from = Math.max(0, tenth(Number(fromSec) || 0));
  const to = Math.max(from, tenth(Number(toSec) || from));
  return [schemaVersion, modelKey, String(recordId || ''), from, to, stableTextHash(String(why).trim())].join('|');
}

function cloneArtifact(value) {
  if (!isObject(value)) return null;
  return {
    ...value,
    ...(Array.isArray(value.words) ? { words: [...value.words] } : {}),
    ...(Array.isArray(value.occurrences) ? { occurrences: [...value.occurrences] } : {}),
    ...(Array.isArray(value.wordTimes) ? { wordTimes: value.wordTimes.filter(isObject).map((x) => ({ ...x })) } : {}),
    ...(Array.isArray(value.links) ? { links: value.links.filter(isObject).map((x) => ({ ...x })) } : {}),
  };
}

function capArtifacts(raw, max, kind, report) {
  const list = (Array.isArray(raw) ? raw : []).map(cloneArtifact).filter(Boolean);
  if (list.length > max) {
    report.dropped.push({ reason: 'cap', kind, count: list.length - max });
  }
  return list.slice(0, max);
}

function sourceOf(artifact) {
  return TIMING_SOURCES.has(artifact?.timingSource) ? artifact.timingSource : 'house';
}

function descriptorsFor(scene) {
  const out = [];
  const addList = (kind, list) => {
    if (Array.isArray(list)) list.filter(isObject).forEach((artifact) => out.push({ kind, artifact }));
  };
  addList('group', scene.groups);
  addList('footnote', scene.footnotes);
  addList('term', scene.terms);
  addList('allusion', scene.allusions);
  addList('aside', scene.asides);
  for (const kind of ['compare', 'chain', 'caveat', 'highlight']) {
    if (scene[kind]) out.push({ kind, artifact: scene[kind] });
  }
  return out;
}

function removeArtifacts(scene, removed) {
  for (const key of ['groups', 'footnotes', 'terms', 'allusions', 'asides']) {
    scene[key] = (Array.isArray(scene[key]) ? scene[key] : []).filter((artifact) => !removed.has(artifact));
  }
  for (const key of ['compare', 'chain', 'caveat', 'highlight']) {
    if (scene[key] && removed.has(scene[key])) scene[key] = null;
  }
}

function chooseHouseSlot(wanted, occupied, start, end, minimumGap) {
  const legal = (at) => at >= start && at <= end && occupied.every((other) => Math.abs(other - at) >= minimumGap);
  if (legal(wanted)) return wanted;

  const marks = [start, ...occupied.filter((at) => at >= start && at <= end).sort((a, b) => a - b), end];
  const candidates = [];
  if (legal(start)) candidates.push(start);
  if (legal(end)) candidates.push(end);
  for (let i = 1; i < marks.length; i += 1) {
    const at = tenth((marks[i - 1] + marks[i]) / 2);
    if (legal(at)) candidates.push(at);
  }
  candidates.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
  return candidates[0] ?? null;
}

function normalizeEventList(list, kind, start, end, report) {
  if (end < start) {
    const count = Array.isArray(list) ? list.length : 0;
    if (count) report.dropped.push({ reason: 'zero-width-scene', kind, count });
    return [];
  }
  const midpoint = tenth((start + end) / 2);
  const out = [];
  for (const candidate of (Array.isArray(list) ? list : [])) {
    const artifact = cloneArtifact(candidate);
    if (!artifact) {
      report.dropped.push({ reason: 'invalid-artifact', kind, count: 1 });
      continue;
    }
    let source = sourceOf(artifact);
    artifact.timingSource = source;
    if (!finite(artifact.at)) {
      artifact.at = midpoint;
      artifact.timingSource = 'house';
      source = 'house';
      report.invented += 1;
    } else {
      artifact.at = tenth(Number(artifact.at));
    }
    if ((source === 'cue' || source === 'word') && (artifact.at < start || artifact.at > end)) {
      report.dropped.push({ reason: 'anchored-outside-scene', kind, at: artifact.at });
      continue;
    }
    const nextAt = tenth(clamp(artifact.at, start, end));
    if (nextAt !== artifact.at) report.clamped += 1;
    artifact.at = nextAt;
    if (Array.isArray(artifact.wordTimes)) {
      artifact.wordTimes = artifact.wordTimes
        .filter((wordTime) => wordTime.timingSource === 'word'
          && typeof wordTime.word === 'string' && wordTime.word.trim()
          && finite(wordTime.at) && Number(wordTime.at) >= start && Number(wordTime.at) <= end)
        .map((wordTime) => ({
          ...wordTime,
          at: tenth(Number(wordTime.at)),
          timingSource: 'word',
          occurrence: Number.isInteger(Number(wordTime.occurrence)) && Number(wordTime.occurrence) >= 0
            ? Number(wordTime.occurrence)
            : 0,
        }));
    }
    out.push(artifact);
  }
  return out;
}

export function normalizeDirectorScenes(rawScenes, durationSec) {
  const duration = Math.max(1, tenth(Number(durationSec) || 1));
  const report = { schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION, dropped: [], shifted: 0, clamped: 0, invented: 0 };
  const scenes = (Array.isArray(rawScenes) ? rawScenes : [])
    .filter(isObject)
    .map((scene, index) => ({
      ...scene,
      at: finite(scene.at) ? tenth(Number(scene.at)) : tenth((duration * index) / Math.max(1, rawScenes.length)),
      timingSource: finite(scene.at) && TIMING_SOURCES.has(scene.timingSource) ? scene.timingSource : 'house',
      verses: Array.isArray(scene.verses) ? scene.verses.filter(isObject).map((x) => ({ ...x })) : [],
      groups: [], footnotes: [], terms: [], allusions: [], asides: [],
      compare: cloneArtifact(scene.compare),
      chain: cloneArtifact(scene.chain),
      caveat: cloneArtifact(scene.caveat),
      highlight: cloneArtifact(scene.highlight),
      _rawArtifacts: scene,
    }))
    .sort((a, b) => a.at - b.at);

  for (let index = scenes.length - 1; index >= 0; index -= 1) {
    const scene = scenes[index];
    if (scene.timingSource !== 'house' && (scene.at < 0 || scene.at > duration)) {
      report.dropped.push({ reason: 'anchored-outside-clip', kind: 'scene', at: scene.at });
      scenes.splice(index, 1);
    }
  }

  const anchoredSceneTimes = scenes
    .filter((scene) => scene.timingSource !== 'house')
    .map((scene) => scene.at)
    .sort((a, b) => a - b);
  const allocatedSceneTimes = [...anchoredSceneTimes];
  const removedScenes = new Set();
  let firstHouse = true;
  for (const scene of scenes.filter((candidate) => candidate.timingSource === 'house').sort((a, b) => a.at - b.at)) {
    const wanted = firstHouse ? 0 : tenth(clamp(scene.at, 0, duration));
    firstHouse = false;
    const slot = chooseHouseSlot(wanted, allocatedSceneTimes, 0, duration, DIRECTOR_LIMITS.sceneMinGapSec);
    if (slot == null) {
      removedScenes.add(scene);
      report.dropped.push({ reason: 'no-house-slot', kind: 'scene', at: scene.at });
      continue;
    }
    if (slot !== scene.at) report.shifted += 1;
    scene.at = slot;
    allocatedSceneTimes.push(slot);
    allocatedSceneTimes.sort((a, b) => a - b);
  }
  for (let index = scenes.length - 1; index >= 0; index -= 1) {
    if (removedScenes.has(scenes[index])) scenes.splice(index, 1);
  }
  scenes.sort((a, b) => a.at - b.at);
  if (scenes.length > DIRECTOR_LIMITS.maxScenes) {
    report.dropped.push({ reason: 'cap', kind: 'scene', count: scenes.length - DIRECTOR_LIMITS.maxScenes });
    scenes.splice(DIRECTOR_LIMITS.maxScenes);
  }

  scenes.forEach((scene, index) => {
    const raw = scene._rawArtifacts;
    delete scene._rawArtifacts;
    const start = scene.at;
    const nextStart = index + 1 < scenes.length ? scenes[index + 1].at : duration;
    // Scene windows are half-open. A beat at exactly the next scene's start
    // belongs to that next scene, never to the verse that is leaving.
    const end = index + 1 < scenes.length
      ? tenth(nextStart - 0.1)
      : Math.max(start, nextStart);
    scene.groups = capArtifacts(normalizeEventList(raw.groups, 'group', start, end, report), DIRECTOR_LIMITS.maxGroups, 'group', report);
    scene.footnotes = capArtifacts(normalizeEventList(raw.footnotes, 'footnote', start, end, report), DIRECTOR_LIMITS.maxFootnotes, 'footnote', report);
    scene.terms = capArtifacts(normalizeEventList(raw.terms, 'term', start, end, report), DIRECTOR_LIMITS.maxTerms, 'term', report);
    scene.allusions = capArtifacts(normalizeEventList(raw.allusions, 'allusion', start, end, report), DIRECTOR_LIMITS.maxAllusions, 'allusion', report);
    scene.asides = capArtifacts(
      normalizeEventList(raw.asides, 'aside', start, end, report),
      scene.verses.length ? DIRECTOR_LIMITS.maxVerseAsides : DIRECTOR_LIMITS.maxBareAsides,
      'aside', report
    );
    for (const key of ['compare', 'chain', 'caveat', 'highlight']) {
      if (!scene[key]) continue;
      scene[key] = normalizeEventList([scene[key]], key, start, end, report)[0] || null;
    }

    const descriptors = descriptorsFor(scene);
    const occupied = descriptors
      .filter(({ artifact }) => sourceOf(artifact) !== 'house')
      .map(({ artifact }) => artifact.at)
      .sort((a, b) => a - b);
    const removed = new Set();
    const house = descriptors
      .filter(({ artifact }) => sourceOf(artifact) === 'house')
      .sort((a, b) => Number(a.kind === 'aside') - Number(b.kind === 'aside') || a.artifact.at - b.artifact.at);
    for (const { kind, artifact } of house) {
      const slot = chooseHouseSlot(
        artifact.at, occupied, start, end,
        kind === 'aside' ? DIRECTOR_LIMITS.asideSilenceSec : DIRECTOR_LIMITS.fieldMinGapSec
      );
      if (slot == null) {
        removed.add(artifact);
        report.dropped.push({ reason: 'no-house-slot', kind, at: artifact.at });
        continue;
      }
      if (slot !== artifact.at) report.shifted += 1;
      artifact.at = slot;
      occupied.push(slot);
      occupied.sort((a, b) => a - b);
    }
    removeArtifacts(scene, removed);

    // Aside economy is a final invariant, after every house move.
    const nonAsideTimes = descriptorsFor(scene)
      .filter(({ kind }) => kind !== 'aside')
      .map(({ artifact }) => artifact.at);
    scene.asides = scene.asides.filter((aside) => {
      const quiet = nonAsideTimes.every((at) => Math.abs(at - aside.at) >= DIRECTOR_LIMITS.asideSilenceSec);
      if (!quiet) report.dropped.push({ reason: 'aside-not-silent', kind: 'aside', at: aside.at });
      return quiet;
    });
  });

  report.sceneCount = scenes.length;
  report.artifactCount = scenes.reduce((count, scene) => count + descriptorsFor(scene).length, 0);
  return { scenes, report };
}

function validateCallEvidence(call, index, errors) {
  if (!isObject(call)) {
    errors.push(`metrics.calls[${index}] must be an object`);
    return;
  }
  if (typeof call.role !== 'string' || !call.role) errors.push(`metrics.calls[${index}].role is required`);
  for (const key of ['latencyMs', 'promptTokens', 'completionTokens', 'reasoningTokens', 'cachedPromptTokens']) {
    if (!finite(call[key]) || Number(call[key]) < 0) errors.push(`metrics.calls[${index}].${key} must be non-negative and finite`);
  }
  if (call.providerCostUsd != null && (!finite(call.providerCostUsd) || Number(call.providerCostUsd) < 0)) {
    errors.push(`metrics.calls[${index}].providerCostUsd must be null or non-negative and finite`);
  }
  if (typeof call.validation !== 'string' || !call.validation) errors.push(`metrics.calls[${index}].validation is required`);
  if (!isObject(call.model)) {
    errors.push(`metrics.calls[${index}].model is required`);
  } else {
    try { assertMagicRuntime(call.model); } catch (error) {
      errors.push(...(error.reasons || [error.message]).map((reason) => `metrics.calls[${index}]: ${reason}`));
    }
    if (typeof call.model.provider !== 'string' || !call.model.provider.trim()) {
      errors.push(`metrics.calls[${index}].model.provider is required`);
    }
  }
  if (call.rawModel != null && call.rawModel !== MAGIC_MODEL_RUNTIME.requestedSlug) {
    errors.push(`metrics.calls[${index}].rawModel must be ${MAGIC_MODEL_RUNTIME.requestedSlug}`);
  }
}

function validateFiniteTimeline(scenes, clip, errors) {
  if (scenes.length > DIRECTOR_LIMITS.maxScenes) errors.push(`scenes exceeds cap ${DIRECTOR_LIMITS.maxScenes}`);
  const duration = Number(clip?.durationSec);
  let priorAt = -Infinity;
  for (const [sceneIndex, scene] of scenes.entries()) {
    if (!isObject(scene) || !finite(scene.at)) {
      errors.push(`scenes[${sceneIndex}].at must be finite`);
      continue;
    }
    const start = Number(scene.at);
    const nextStart = sceneIndex + 1 < scenes.length && finite(scenes[sceneIndex + 1]?.at)
      ? Number(scenes[sceneIndex + 1].at)
      : duration;
    if (start < 0 || start > duration) errors.push(`scenes[${sceneIndex}].at must be inside the clip`);
    if (start < priorAt) errors.push('scenes must be ordered by at');
    priorAt = start;
    if (!TIMING_SOURCES.has(scene.timingSource)) errors.push(`scenes[${sceneIndex}].timingSource is invalid`);
    for (const [key, max] of [
      ['groups', DIRECTOR_LIMITS.maxGroups],
      ['footnotes', DIRECTOR_LIMITS.maxFootnotes],
      ['terms', DIRECTOR_LIMITS.maxTerms],
      ['allusions', DIRECTOR_LIMITS.maxAllusions],
      ['asides', Array.isArray(scene.verses) && scene.verses.length ? DIRECTOR_LIMITS.maxVerseAsides : DIRECTOR_LIMITS.maxBareAsides],
    ]) {
      if (!Array.isArray(scene[key])) errors.push(`scenes[${sceneIndex}].${key} must be an array`);
      else if (scene[key].length > max) errors.push(`scenes[${sceneIndex}].${key} exceeds cap ${max}`);
    }
    if (!Array.isArray(scene.verses)) errors.push(`scenes[${sceneIndex}].verses must be an array`);
    for (const key of ['compare', 'chain', 'caveat', 'highlight']) {
      if (scene[key] != null && !isObject(scene[key])) errors.push(`scenes[${sceneIndex}].${key} must be an object or null`);
    }
    for (const { kind, artifact } of descriptorsFor(scene)) {
      if (!finite(artifact.at)) {
        errors.push(`scenes[${sceneIndex}].${kind}.at must be finite`);
        continue;
      }
      const at = Number(artifact.at);
      if (at < start || at > duration || (sceneIndex + 1 < scenes.length && at >= nextStart)) {
        errors.push(`scenes[${sceneIndex}].${kind}.at is outside its scene`);
      }
      if (!TIMING_SOURCES.has(artifact.timingSource)) errors.push(`scenes[${sceneIndex}].${kind}.timingSource is invalid`);
      if (kind === 'footnote' && (!Number.isInteger(artifact.occurrence) || artifact.occurrence < 0)) {
        errors.push(`scenes[${sceneIndex}].footnote.occurrence must be zero-based`);
      }
      if (kind === 'group' && Array.isArray(artifact.occurrences)
        && artifact.occurrences.some((occurrence) => !Number.isInteger(occurrence) || occurrence < 0)) {
        errors.push(`scenes[${sceneIndex}].group.occurrences must be zero-based`);
      }
      for (const [wordIndex, wordTime] of (Array.isArray(artifact.wordTimes) ? artifact.wordTimes : []).entries()) {
        if (!finite(wordTime.at)) errors.push(`scenes[${sceneIndex}].${kind}.wordTimes[${wordIndex}].at must be finite`);
        if (wordTime.timingSource !== 'word') errors.push(`scenes[${sceneIndex}].${kind}.wordTimes[${wordIndex}] is not word-verified`);
        if (!Number.isInteger(wordTime.occurrence) || wordTime.occurrence < 0) {
          errors.push(`scenes[${sceneIndex}].${kind}.wordTimes[${wordIndex}].occurrence must be zero-based`);
        }
      }
    }
  }
}

export function validateDirectorPayload(payload) {
  const errors = [];
  if (!isObject(payload)) return { ok: false, errors: ['director payload must be an object'] };
  if (payload.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    errors.push(
      payload.schemaVersion > MAGIC_DIRECTOR_SCHEMA_VERSION
        ? `director schema ${payload.schemaVersion} is newer than supported ${MAGIC_DIRECTOR_SCHEMA_VERSION}`
        : `director schema ${String(payload.schemaVersion)} is not supported`
    );
  }
  if (!isObject(payload.clip)
    || !finite(payload.clip.fromSec) || !finite(payload.clip.toSec) || !finite(payload.clip.durationSec)
    || Number(payload.clip.fromSec) < 0 || Number(payload.clip.toSec) <= Number(payload.clip.fromSec)
    || Number(payload.clip.durationSec) !== Number(payload.clip.toSec) - Number(payload.clip.fromSec)) {
    errors.push('clip must carry finite, increasing, internally consistent bounds');
  }
  if (!Array.isArray(payload.scenes)) errors.push('scenes must be an array');
  else if (isObject(payload.clip) && finite(payload.clip.durationSec)) validateFiniteTimeline(payload.scenes, payload.clip, errors);
  if (!isObject(payload.model)) {
    errors.push('model evidence is required');
  } else {
    try { assertMagicRuntime(payload.model); } catch (error) { errors.push(...(error.reasons || [error.message])); }
    if (typeof payload.model.provider !== 'string' || !payload.model.provider.trim()) {
      errors.push('model.provider is required');
    }
  }
  if (!isObject(payload.metrics) || !finite(payload.metrics.wallMs) || Number(payload.metrics.wallMs) < 0) {
    errors.push('metrics.wallMs must be non-negative and finite');
  } else {
    if (!Array.isArray(payload.metrics.calls)) errors.push('metrics.calls must be an array');
    else {
      payload.metrics.calls.forEach((call, index) => validateCallEvidence(call, index, errors));
      if (Number(payload.metrics.passes) !== payload.metrics.calls.length) errors.push('metrics.passes must equal metrics.calls.length');
    }
    if (!Number.isInteger(Number(payload.metrics.passes)) || Number(payload.metrics.passes) < 0) errors.push('metrics.passes must be a non-negative integer');
    if (payload.metrics.totalUsd != null && (!finite(payload.metrics.totalUsd) || Number(payload.metrics.totalUsd) < 0)) {
      errors.push('metrics.totalUsd must be null or non-negative and finite');
    }
    if (!isObject(payload.metrics.normalization)
      || !Array.isArray(payload.metrics.normalization.dropped)
      || Number(payload.metrics.normalization.sceneCount) !== (Array.isArray(payload.scenes) ? payload.scenes.length : -1)
      || !finite(payload.metrics.normalization.artifactCount)
      || Number(payload.metrics.normalization.artifactCount) < 0) {
      errors.push('metrics.normalization must report dropped items and final counts');
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateReplayFixture(input) {
  const errors = [];
  if (!isObject(input)) return { ok: false, errors: ['replay fixture must be an object'] };
  if (input.schemaVersion !== MAGIC_REPLAY_SCHEMA_VERSION) {
    errors.push(
      input.schemaVersion > MAGIC_REPLAY_SCHEMA_VERSION
        ? `replay schema ${input.schemaVersion} is newer than supported ${MAGIC_REPLAY_SCHEMA_VERSION}`
        : `replay schema ${String(input.schemaVersion)} is not supported`
    );
  }
  if (typeof input.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(input.id)) errors.push('id must be a lowercase replay id');
  if (typeof input.prompt !== 'string' || !input.prompt.trim()) errors.push('prompt must be non-empty');
  if (!isObject(input.tour) || !Array.isArray(input.tour.steps) || !input.tour.steps.length) {
    errors.push('tour.steps must be non-empty');
  } else {
    input.tour.steps.forEach((step, index) => {
      if (!isObject(step) || typeof step.recordId !== 'string' || !step.recordId) errors.push(`tour.steps[${index}].recordId is required`);
      if (!finite(step?.startSec) || !finite(step?.endSec) || Number(step.endSec) <= Number(step.startSec)) {
        errors.push(`tour.steps[${index}] must have finite increasing clip bounds`);
      }
    });
  }
  if (!Array.isArray(input.whispers)) errors.push('whispers must be an array');
  else if (Array.isArray(input.tour?.steps) && input.whispers.length !== input.tour.steps.length) {
    errors.push('whispers must have exactly one entry per tour step');
  }
  if (!isObject(input.form)) errors.push('form must be an object');
  if (!isObject(input.directions)) errors.push('directions must be an object keyed by director cache key');
  if (isObject(input.directions)) {
    for (const [key, payload] of Object.entries(input.directions)) {
      const check = validateDirectorPayload(payload);
      if (!check.ok) errors.push(...check.errors.map((error) => `directions[${key}]: ${error}`));
      if (payload?.requestKey !== key) errors.push(`directions[${key}].requestKey does not match its cache key`);
    }
    for (const [index, step] of (Array.isArray(input.tour?.steps) ? input.tour.steps : []).entries()) {
      try {
        const key = directorCacheKey({
          recordId: step?.recordId,
          fromSec: step?.startSec,
          toSec: step?.endSec,
          why: step?.why,
        });
        if (!Object.hasOwn(input.directions, key)) {
          errors.push(`directions is missing tour step ${index}`);
        } else {
          const payload = input.directions[key];
          const from = Number(step.startSec);
          const to = Number(step.endSec);
          if (Number(payload?.clip?.fromSec) !== from || Number(payload?.clip?.toSec) !== to) {
            errors.push(`directions for tour step ${index} has different clip bounds`);
          }
        }
      } catch (error) {
        errors.push(`tour step ${index} cannot form a director cache key: ${error.message}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

const SECRET_KEY = /(api[-_]?key|authorization|bearer|secret|token$)/i;
export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redactEvidence(child);
  }
  return out;
}
