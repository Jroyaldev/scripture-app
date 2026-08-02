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

export function assertMagicReplyEvidence(reply, runtime) {
  assertMagicRuntime(runtime);
  const rawModel = reply?.raw?.model;
  const provider = reply?.raw?.provider;
  const errors = [];
  if (typeof rawModel !== 'string' || !rawModel.trim()) errors.push('response model is missing');
  else if (rawModel !== runtime.resolvedSlug) errors.push(`provider returned ${rawModel}, expected ${runtime.resolvedSlug}`);
  if (typeof provider !== 'string' || !provider.trim()) errors.push('response provider is missing');
  if (errors.length) {
    const error = new Error(`\/magic Luna/OpenRouter reply refused: ${errors.join('; ')}`);
    error.code = 'MAGIC_RUNTIME_REFUSED';
    error.reasons = errors;
    throw error;
  }
  return { rawModel, provider };
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

  });

  // Scene ownership is structural, but spacing is global. Two house beats on
  // opposite sides of a scene boundary are still one tenth of a second apart
  // to the listener, so allocate them against the whole clip while keeping
  // each candidate inside its owning half-open scene.
  const windows = scenes.map((scene, index) => ({
    scene,
    start: scene.at,
    end: index + 1 < scenes.length ? tenth(scenes[index + 1].at - 0.1) : duration,
  }));
  const records = windows.flatMap(({ scene, start, end }) => (
    descriptorsFor(scene).map(({ kind, artifact }) => ({ kind, artifact, scene, start, end }))
  ));
  const globallyRemoved = new Set();
  const occupied = records
    .filter(({ artifact }) => sourceOf(artifact) !== 'house')
    .map(({ artifact }) => artifact.at)
    .sort((a, b) => a - b);
  const houseRecords = records
    .filter(({ artifact }) => sourceOf(artifact) === 'house')
    .sort((a, b) => Number(a.kind === 'aside') - Number(b.kind === 'aside')
      || a.artifact.at - b.artifact.at || a.start - b.start);
  for (const { kind, artifact, start, end } of houseRecords) {
    const slot = chooseHouseSlot(
      artifact.at,
      occupied,
      start,
      end,
      kind === 'aside' ? DIRECTOR_LIMITS.asideSilenceSec : DIRECTOR_LIMITS.fieldMinGapSec,
    );
    if (slot == null) {
      globallyRemoved.add(artifact);
      report.dropped.push({ reason: 'no-house-slot', kind, at: artifact.at });
      continue;
    }
    if (slot !== artifact.at) report.shifted += 1;
    artifact.at = slot;
    occupied.push(slot);
    occupied.sort((a, b) => a - b);
  }
  for (const scene of scenes) removeArtifacts(scene, globallyRemoved);

  // Aside economy is also global. Keep the earliest transcript-truth aside
  // when two compete, but never move cue/word time to manufacture silence.
  const finalRecords = windows.flatMap(({ scene }) => (
    descriptorsFor(scene).map(({ kind, artifact }) => ({ kind, artifact, scene }))
  ));
  const nonAsideTimes = finalRecords
    .filter(({ kind }) => kind !== 'aside')
    .map(({ artifact }) => artifact.at);
  const acceptedAsideTimes = [];
  const rejectedAsides = new Set();
  for (const { kind, artifact } of finalRecords
    .filter(({ kind }) => kind === 'aside')
    .sort((a, b) => a.artifact.at - b.artifact.at)) {
    const quietFromFields = nonAsideTimes.every((at) => Math.abs(at - artifact.at) >= DIRECTOR_LIMITS.asideSilenceSec);
    const quietFromAsides = acceptedAsideTimes.every((at) => Math.abs(at - artifact.at) >= DIRECTOR_LIMITS.asideSilenceSec);
    if (!quietFromFields || !quietFromAsides) {
      rejectedAsides.add(artifact);
      report.dropped.push({ reason: 'aside-not-silent', kind, at: artifact.at });
    } else {
      acceptedAsideTimes.push(artifact.at);
    }
  }
  for (const scene of scenes) removeArtifacts(scene, rejectedAsides);

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
  if (!Object.hasOwn(call, 'providerCostUsd')
    || (call.providerCostUsd != null && (!finite(call.providerCostUsd) || Number(call.providerCostUsd) < 0))) {
    errors.push(`metrics.calls[${index}].providerCostUsd must be present and null or non-negative and finite`);
  }
  if (!Object.hasOwn(call, 'finishReason')
    || (call.finishReason != null && typeof call.finishReason !== 'string')) {
    errors.push(`metrics.calls[${index}].finishReason must be present and a string or null`);
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
  if (!Object.hasOwn(call, 'rawModel')) {
    errors.push(`metrics.calls[${index}].rawModel must be present`);
  } else if (call.validation !== 'call-error' && call.rawModel !== MAGIC_MODEL_RUNTIME.requestedSlug) {
    errors.push(`metrics.calls[${index}].rawModel must be ${MAGIC_MODEL_RUNTIME.requestedSlug}`);
  } else if (call.validation === 'call-error' && call.rawModel != null
    && call.rawModel !== MAGIC_MODEL_RUNTIME.requestedSlug) {
    errors.push(`metrics.calls[${index}].rawModel cannot contradict the resolved runtime`);
  }
  if (!Object.hasOwn(call, 'provider')
    || (call.validation !== 'call-error' && (typeof call.provider !== 'string' || !call.provider.trim()))
    || (call.validation === 'call-error' && call.provider != null && typeof call.provider !== 'string')) {
    errors.push(`metrics.calls[${index}].provider must record the observed provider or null on call-error`);
  }
}

export function validateMagicRoleEvidence(record) {
  const errors = [];
  if (!isObject(record)) return { ok: false, errors: ['role evidence must be an object'] };
  if (!['whispers', 'form'].includes(record.role)) errors.push('role must be whispers or form');
  if (typeof record.startedAt !== 'string' || !record.startedAt) errors.push('startedAt is required');
  if (!isObject(record.model)) {
    errors.push('model evidence is required');
  } else {
    try { assertMagicRuntime(record.model); } catch (error) { errors.push(...(error.reasons || [error.message])); }
    if (typeof record.model.provider !== 'string' || !record.model.provider.trim()) errors.push('model.provider is required');
  }
  const metrics = record.metrics;
  if (!isObject(metrics) || !finite(metrics.wallMs) || Number(metrics.wallMs) < 0) {
    errors.push('metrics.wallMs must be non-negative and finite');
    return { ok: false, errors };
  }
  if (!Array.isArray(metrics.calls) || !metrics.calls.length) errors.push('metrics.calls must be non-empty');
  const calls = Array.isArray(metrics.calls) ? metrics.calls : [];
  calls.forEach((call, index) => validateCallEvidence(call, index, errors));
  if (Number(metrics.passes) !== calls.length) errors.push('metrics.passes must equal metrics.calls.length');
  const tokenTotals = {
    prompt: calls.reduce((sum, call) => sum + (finite(call?.promptTokens) ? Number(call.promptTokens) : 0), 0),
    completion: calls.reduce((sum, call) => sum + (finite(call?.completionTokens) ? Number(call.completionTokens) : 0), 0),
    reasoning: calls.reduce((sum, call) => sum + (finite(call?.reasoningTokens) ? Number(call.reasoningTokens) : 0), 0),
    cachedPrompt: calls.reduce((sum, call) => sum + (finite(call?.cachedPromptTokens) ? Number(call.cachedPromptTokens) : 0), 0),
  };
  if (!isObject(metrics.tokens)
    || Object.entries(tokenTotals).some(([key, value]) => Number(metrics.tokens[key]) !== value)) {
    errors.push('metrics.tokens must equal the sum of every pass');
  }
  const costs = calls.map((call) => call?.providerCostUsd);
  const expectedTotal = costs.length && costs.every((cost) => finite(cost) && Number(cost) >= 0)
    ? costs.reduce((sum, cost) => sum + Number(cost), 0)
    : null;
  if (metrics.totalUsd !== expectedTotal) errors.push('metrics.totalUsd must reconcile every pass');
  return { ok: errors.length === 0, errors };
}

function validateArtifactShape(kind, artifact, path, errors) {
  const nonEmpty = (value) => typeof value === 'string' && Boolean(value.trim());
  if (kind === 'group') {
    if (!Array.isArray(artifact.words) || artifact.words.length < 2 || artifact.words.length > 4
      || artifact.words.some((word) => !nonEmpty(word))) {
      errors.push(`${path}.words must contain 2-4 non-empty strings`);
    }
    if (!Array.isArray(artifact.occurrences)
      || artifact.occurrences.length !== (Array.isArray(artifact.words) ? artifact.words.length : -1)
      || artifact.occurrences.some((occurrence) => !Number.isInteger(occurrence) || occurrence < 0)) {
      errors.push(`${path}.occurrences must provide one zero-based coordinate per word`);
    }
  } else if (kind === 'footnote') {
    if (!nonEmpty(artifact.word) || !nonEmpty(artifact.note)) errors.push(`${path} requires word and note`);
  } else if (kind === 'term') {
    if (!nonEmpty(artifact.term) || !nonEmpty(artifact.gloss)) errors.push(`${path} requires term and gloss`);
  } else if (kind === 'allusion') {
    if (!nonEmpty(artifact.ref) || !nonEmpty(artifact.text)) errors.push(`${path} requires ref and text`);
  } else if (kind === 'aside' || kind === 'caveat') {
    if (!nonEmpty(artifact.text)) errors.push(`${path}.text is required`);
  } else if (kind === 'highlight') {
    if (!nonEmpty(artifact.quote)) errors.push(`${path}.quote is required`);
  } else if (kind === 'compare') {
    if (!isObject(artifact.a) || !nonEmpty(artifact.a.ref) || !nonEmpty(artifact.a.text)
      || !isObject(artifact.b) || !nonEmpty(artifact.b.ref) || !nonEmpty(artifact.b.text)
      || !['likeness', 'difference'].includes(artifact.axis)) {
      errors.push(`${path} requires complete a/b passages and a valid axis`);
    }
  } else if (kind === 'chain') {
    if (!Array.isArray(artifact.links) || artifact.links.length < 2 || artifact.links.length > 4
      || artifact.links.some((link) => !isObject(link) || !nonEmpty(link.ref) || !nonEmpty(link.text))) {
      errors.push(`${path}.links must contain 2-4 complete passages`);
    }
  }
}

function validateFiniteTimeline(scenes, clip, errors) {
  if (scenes.length > DIRECTOR_LIMITS.maxScenes) errors.push(`scenes exceeds cap ${DIRECTOR_LIMITS.maxScenes}`);
  const duration = Number(clip?.durationSec);
  let priorAt = -Infinity;
  const timeline = [];
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
      const artifactPath = `scenes[${sceneIndex}].${kind}`;
      validateArtifactShape(kind, artifact, artifactPath, errors);
      if (!finite(artifact.at)) {
        errors.push(`${artifactPath}.at must be finite`);
        continue;
      }
      const at = Number(artifact.at);
      if (at < start || at > duration || (sceneIndex + 1 < scenes.length && at >= nextStart)) {
        errors.push(`${artifactPath}.at is outside its scene`);
      }
      if (!TIMING_SOURCES.has(artifact.timingSource)) errors.push(`${artifactPath}.timingSource is invalid`);
      if (kind === 'footnote' && (!Number.isInteger(artifact.occurrence) || artifact.occurrence < 0)) {
        errors.push(`scenes[${sceneIndex}].footnote.occurrence must be zero-based`);
      }
      if (kind === 'group' && Array.isArray(artifact.occurrences)
        && artifact.occurrences.some((occurrence) => !Number.isInteger(occurrence) || occurrence < 0)) {
        errors.push(`scenes[${sceneIndex}].group.occurrences must be zero-based`);
      }
      for (const [wordIndex, wordTime] of (Array.isArray(artifact.wordTimes) ? artifact.wordTimes : []).entries()) {
        const wordPath = `${artifactPath}.wordTimes[${wordIndex}]`;
        if (!isObject(wordTime) || typeof wordTime.word !== 'string' || !wordTime.word.trim()) {
          errors.push(`${wordPath}.word is required`);
        }
        if (!finite(wordTime.at)) errors.push(`${wordPath}.at must be finite`);
        else if (Number(wordTime.at) < start || Number(wordTime.at) > duration
          || (sceneIndex + 1 < scenes.length && Number(wordTime.at) >= nextStart)) {
          errors.push(`${wordPath}.at is outside its scene`);
        }
        if (wordTime.timingSource !== 'word') errors.push(`scenes[${sceneIndex}].${kind}.wordTimes[${wordIndex}] is not word-verified`);
        if (!Number.isInteger(wordTime.occurrence) || wordTime.occurrence < 0) {
          errors.push(`scenes[${sceneIndex}].${kind}.wordTimes[${wordIndex}].occurrence must be zero-based`);
        }
        if (kind === 'group' && Array.isArray(artifact.words)) {
          const groupWordIndex = artifact.words.findIndex((word) => String(word).toLowerCase() === String(wordTime.word).toLowerCase());
          if (groupWordIndex < 0) errors.push(`${wordPath}.word must belong to its group`);
          else if (Array.isArray(artifact.occurrences)
            && artifact.occurrences[groupWordIndex] !== wordTime.occurrence) {
            errors.push(`${wordPath}.occurrence must match the displayed-word coordinate`);
          }
        }
      }
      timeline.push({ kind, artifact, at });
    }
  }

  for (let index = 0; index < timeline.length; index += 1) {
    const current = timeline[index];
    for (let otherIndex = index + 1; otherIndex < timeline.length; otherIndex += 1) {
      const other = timeline[otherIndex];
      const distance = Math.abs(current.at - other.at);
      if ((current.kind === 'aside' || other.kind === 'aside') && distance < DIRECTOR_LIMITS.asideSilenceSec) {
        errors.push('asides must remain globally silent across scene boundaries');
      } else if ((sourceOf(current.artifact) === 'house' || sourceOf(other.artifact) === 'house')
        && distance < DIRECTOR_LIMITS.fieldMinGapSec) {
        errors.push('house artifacts must be globally deconflicted across scene boundaries');
      }
    }
  }
  return timeline.length;
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
  if (typeof payload.requestKey !== 'string' || !payload.requestKey.trim()) errors.push('requestKey is required');
  if (!isObject(payload.clip)
    || !finite(payload.clip.fromSec) || !finite(payload.clip.toSec) || !finite(payload.clip.durationSec)
    || Number(payload.clip.fromSec) < 0 || Number(payload.clip.toSec) <= Number(payload.clip.fromSec)
    || Number(payload.clip.durationSec) !== Number(payload.clip.toSec) - Number(payload.clip.fromSec)) {
    errors.push('clip must carry finite, increasing, internally consistent bounds');
  }
  let artifactCount = null;
  if (!Array.isArray(payload.scenes)) errors.push('scenes must be an array');
  else if (isObject(payload.clip) && finite(payload.clip.durationSec)) {
    artifactCount = validateFiniteTimeline(payload.scenes, payload.clip, errors);
  }
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
      || Number(payload.metrics.normalization.artifactCount) !== artifactCount
      || !['shifted', 'clamped', 'invented'].every((key) => (
        finite(payload.metrics.normalization[key]) && Number(payload.metrics.normalization[key]) >= 0
      ))) {
      errors.push('metrics.normalization must report dropped items and final counts');
    }
    const calls = Array.isArray(payload.metrics.calls) ? payload.metrics.calls : [];
    const tokenTotals = {
      prompt: calls.reduce((sum, call) => sum + (finite(call?.promptTokens) ? Number(call.promptTokens) : 0), 0),
      completion: calls.reduce((sum, call) => sum + (finite(call?.completionTokens) ? Number(call.completionTokens) : 0), 0),
      reasoning: calls.reduce((sum, call) => sum + (finite(call?.reasoningTokens) ? Number(call.reasoningTokens) : 0), 0),
      cachedPrompt: calls.reduce((sum, call) => sum + (finite(call?.cachedPromptTokens) ? Number(call.cachedPromptTokens) : 0), 0),
    };
    if (!isObject(payload.metrics.tokens)
      || Object.entries(tokenTotals).some(([key, value]) => Number(payload.metrics.tokens[key]) !== value)) {
      errors.push('metrics.tokens must equal the sum of every pass');
    }
    const costs = calls.map((call) => call?.providerCostUsd);
    const expectedTotal = costs.length && costs.every((cost) => finite(cost) && Number(cost) >= 0)
      ? costs.reduce((sum, cost) => sum + Number(cost), 0)
      : null;
    if (payload.metrics.totalUsd !== expectedTotal) errors.push('metrics.totalUsd must reconcile every pass');
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
    for (const key of ['title', 'intro', 'closing']) {
      if (typeof input.tour[key] !== 'string' || !input.tour[key].trim()) errors.push(`tour.${key} must be non-empty`);
    }
    let totalSeconds = 0;
    input.tour.steps.forEach((step, index) => {
      if (!isObject(step) || typeof step.recordId !== 'string' || !step.recordId) errors.push(`tour.steps[${index}].recordId is required`);
      if (!finite(step?.startSec) || !finite(step?.endSec) || Number(step.endSec) <= Number(step.startSec)) {
        errors.push(`tour.steps[${index}] must have finite increasing clip bounds`);
      } else {
        totalSeconds += Number(step.endSec) - Number(step.startSec);
      }
      if (typeof step?.why !== 'string' || !step.why.trim()) errors.push(`tour.steps[${index}].why is required`);
      if (typeof step?.episodeTitle !== 'string' || !step.episodeTitle.trim()) errors.push(`tour.steps[${index}].episodeTitle is required`);
      if (typeof step?.source !== 'string' || !step.source.trim()) errors.push(`tour.steps[${index}].source is required`);
      if (typeof step?.audioUrl !== 'string' || !/^https?:\/\//.test(step.audioUrl)) errors.push(`tour.steps[${index}].audioUrl must be playable`);
    });
    if (!finite(input.tour.totalSeconds) || Number(input.tour.totalSeconds) !== totalSeconds) {
      errors.push('tour.totalSeconds must equal the sum of clip bounds');
    }
  }
  if (!Array.isArray(input.whispers)) errors.push('whispers must be an array');
  else if (Array.isArray(input.tour?.steps) && input.whispers.length !== input.tour.steps.length) {
    errors.push('whispers must have exactly one entry per tour step');
  } else if (input.whispers.some((whisper) => typeof whisper !== 'string' || !whisper.trim() || whisper.length > 120)) {
    errors.push('whispers must be non-empty strings no longer than 120 characters');
  }
  if (!isObject(input.form)) {
    errors.push('form must be an object');
  } else {
    const stepCount = Array.isArray(input.tour?.steps) ? input.tour.steps.length : 0;
    if (!['standard', 'quiet', 'lexicon', 'path'].includes(input.form.form)) errors.push('form.form is invalid');
    if (input.form.stage != null && !Array.isArray(input.form.stage)) errors.push('form.stage must be an array');
    for (const [index, direction] of (Array.isArray(input.form.stage) ? input.form.stage : []).entries()) {
      if (!isObject(direction) || !Number.isInteger(direction.step) || direction.step < 0 || direction.step >= stepCount
        || typeof direction.verse !== 'string' || !direction.verse.trim()
        || !Array.isArray(direction.marks)
        || direction.marks.some((mark) => !isObject(mark) || !Array.isArray(mark.words)
          || mark.words.length < 2 || mark.words.length > 4
          || mark.words.some((word) => typeof word !== 'string' || !word.trim()))) {
        errors.push(`form.stage[${index}] is invalid`);
      }
    }
    if (input.form.form === 'lexicon') {
      if (!Array.isArray(input.form.terms) || !input.form.terms.length) errors.push('lexicon form requires terms');
      for (const [index, term] of (Array.isArray(input.form.terms) ? input.form.terms : []).entries()) {
        if (!isObject(term) || typeof term.term !== 'string' || !term.term.trim()
          || !Array.isArray(term.renderings) || !term.renderings.length
          || term.renderings.some((rendering) => !isObject(rendering)
            || typeof rendering.label !== 'string' || !rendering.label.trim()
            || !Array.isArray(rendering.steps)
            || rendering.steps.some((step) => !Number.isInteger(step) || step < 0 || step >= stepCount))) {
          errors.push(`form.terms[${index}] is invalid`);
        }
      }
    }
    if (input.form.form === 'path') {
      if (!Array.isArray(input.form.waypoints) || !input.form.waypoints.length) errors.push('path form requires waypoints');
      for (const [index, waypoint] of (Array.isArray(input.form.waypoints) ? input.form.waypoints : []).entries()) {
        if (!isObject(waypoint) || !Number.isInteger(waypoint.step) || waypoint.step < 0 || waypoint.step >= stepCount
          || typeof waypoint.marker !== 'string' || !waypoint.marker.trim()) {
          errors.push(`form.waypoints[${index}] is invalid`);
        }
      }
    }
  }
  if (!isObject(input.directions)) errors.push('directions must be an object keyed by director cache key');
  if (isObject(input.directions)) {
    if (Array.isArray(input.tour?.steps) && Object.keys(input.directions).length !== input.tour.steps.length) {
      errors.push('directions must contain exactly one entry per tour step');
    }
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
const SECRET_VALUE = /(Bearer\s+)[A-Za-z0-9._~+\/-]{8,}|\b(?:sk|or-v1)-[A-Za-z0-9_-]{8,}\b/gi;
export function redactEvidence(value) {
  if (Array.isArray(value)) return value.map(redactEvidence);
  if (typeof value === 'string') return value.replace(SECRET_VALUE, '[redacted]');
  if (!isObject(value)) return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    out[key] = SECRET_KEY.test(key) ? '[redacted]' : redactEvidence(child);
  }
  return out;
}
