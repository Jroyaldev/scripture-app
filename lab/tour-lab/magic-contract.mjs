// Shared, versioned contracts for the isolated /magic experiment.
//
// The model names semantic things and transcript cues. This module is the
// house: it owns role routing, durable versions, final caps, and timeline
// normalization. It is browser-safe so the page and server cannot drift.

export const MAGIC_DIRECTOR_SCHEMA_VERSION = 2;
export const MAGIC_REPLAY_SCHEMA_VERSION = 2;
export const MAGIC_DIRECTOR_POLICY_VERSION = 'magic-director-3';
export const MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION = 'magic-director-2';
export const MAGIC_DIRECTOR_WHY_MAX_CHARS = 800;
export const DIRECTOR_HOUSE_PRELUDE_ID = 'house:prelude';

export function createDirectorHousePrelude() {
  return {
    id: DIRECTOR_HOUSE_PRELUDE_ID,
    origin: 'house-prelude',
    ref: null,
    verses: [],
    cue: null,
    at: 0,
    timingSource: 'house',
  };
}

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
  // These are safety ceilings, not generation targets. Organic movement
  // budgets are derived from the actual clip below.
  maxScenes: 12,
  houseSceneReserve: 1,
  maxBeats: 48,
  sceneMinGapSec: 12,
  fieldMinGapSec: 2.5,
  asideCooldownSec: 8,
  fillGapSec: 36,
  preludeMinSec: 18,
  highlightSustainedSec: 180,
  maxByKind: Object.freeze({
    group: 24,
    footnote: 12,
    term: 12,
    allusion: 12,
    compare: 8,
    chain: 8,
    caveat: 8,
    aside: 16,
    highlight: 12,
  }),
});

// Copy is accepted as a complete model-authored unit or refused. These are
// generous safety ceilings, not targets for display truncation. The renderer
// may choose hierarchy and measure, but it must not publish severed claims.
export const DIRECTOR_COPY_LIMITS = Object.freeze({
  groupLabel: 36,
  footnoteNote: 110,
  termGloss: 64,
  relationNote: 96,
  marginText: 110,
});

// Frozen v1 ceilings are retained only so read-time migration can preserve a
// fixture that the former validator admitted. They never expand live v2 work.
const LEGACY_V1_LIMITS = Object.freeze({ maxScenes: 4, maxBeats: 64 });

// Visual frequency and visual density are different budgets. The director may
// supply many grounded entrances across a long clip; the browser derives these
// short active lifetimes so the entrances do not become permanent furniture.
export const VISUAL_DWELL_SEC = Object.freeze({
  group: 9,
  footnote: 9,
  term: 9,
  allusion: 13,
  compare: 15,
  chain: 18,
  caveat: 12,
  aside: 10,
  highlight: 11,
});

export const DIRECTOR_ARTIFACT_KINDS = Object.freeze([
  'group', 'footnote', 'term', 'allusion', 'compare', 'chain', 'caveat', 'aside', 'highlight',
]);

const THOUGHT_KINDS = new Set(DIRECTOR_ARTIFACT_KINDS.filter((kind) => kind !== 'highlight'));

export function visualChannelForKind(kind) {
  if (kind === 'highlight') return 'focus';
  if (THOUGHT_KINDS.has(kind)) return 'thought';
  return null;
}

const anchorTokens = (value) => [...String(value ?? '').matchAll(/[\p{L}\p{N}]+(?:[’'][\p{L}\p{N}]+)*/gu)]
  .map((match) => ({
    value: match[0].replace(/[’]/g, "'").toLocaleLowerCase('en'),
    start: match.index,
    end: match.index + match[0].length,
  }));

// Matching is token-based and offset-preserving. Typography and separator
// punctuation may differ between a verified anchor and the displayed Bible,
// but returned offsets always point into the original Scripture string.
export function findScriptureOccurrence(text, phrase, occurrence = 0) {
  const haystack = anchorTokens(text);
  const needle = anchorTokens(phrase);
  const wanted = Number.isInteger(Number(occurrence)) && Number(occurrence) >= 0
    ? Number(occurrence)
    : 0;
  if (!needle.length || needle.length > haystack.length) return null;
  let seen = 0;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    const matches = needle.every((token, offset) => haystack[index + offset].value === token.value);
    if (!matches) continue;
    if (seen === wanted) {
      return { start: haystack[index].start, end: haystack[index + needle.length - 1].end };
    }
    seen += 1;
  }
  return null;
}

const halfPixel = (value) => Math.round(Number(value) * 2) / 2;

// DOM measurement stays in the renderer; route topology is pure house
// arithmetic so identical word rectangles always produce identical weave.
export function planLoomGeometry({ targets, lineRects = [], boundsWidth = null, safeInset = 8 } = {}) {
  if (!Array.isArray(targets) || targets.length < 2) return null;
  const rects = targets.map((target) => ({
    x1: halfPixel(target?.x1),
    x2: halfPixel(target?.x2),
    top: halfPixel(target?.top),
    bottom: halfPixel(target?.bottom),
  }));
  if (rects.some((rect) => !Object.values(rect).every(Number.isFinite)
    || rect.x2 <= rect.x1 || rect.bottom <= rect.top)) return null;

  rects.sort((a, b) => a.bottom - b.bottom || a.x1 - b.x1);
  const lines = [];
  for (const rect of rects) {
    let line = lines.find((candidate) => Math.abs(candidate.bottom - rect.bottom) <= 3);
    if (!line) {
      line = { bottom: rect.bottom, rects: [] };
      lines.push(line);
    }
    line.rects.push(rect);
    line.bottom = halfPixel(line.rects.reduce((sum, item) => sum + item.bottom, 0) / line.rects.length);
  }
  lines.sort((a, b) => a.bottom - b.bottom);

  const verseLines = [];
  for (const item of Array.isArray(lineRects) ? lineRects : []) {
    const rect = {
      x1: halfPixel(item?.x1),
      x2: halfPixel(item?.x2),
      top: halfPixel(item?.top),
      bottom: halfPixel(item?.bottom),
    };
    if (!Number.isFinite(rect.top) || !Number.isFinite(rect.bottom) || rect.bottom <= rect.top) continue;
    let line = verseLines.find((candidate) => Math.abs(candidate.bottom - rect.bottom) <= 3);
    if (!line) {
      line = { x1: rect.x1, x2: rect.x2, top: rect.top, bottom: rect.bottom, count: 0 };
      verseLines.push(line);
    }
    if (Number.isFinite(rect.x1)) line.x1 = Number.isFinite(line.x1) ? Math.min(line.x1, rect.x1) : rect.x1;
    if (Number.isFinite(rect.x2)) line.x2 = Number.isFinite(line.x2) ? Math.max(line.x2, rect.x2) : rect.x2;
    line.top = Math.min(line.top, rect.top);
    line.bottom = Math.max(line.bottom, rect.bottom);
    line.count += 1;
  }
  verseLines.sort((a, b) => a.top - b.top);

  const contacts = [];
  const wefts = [];
  for (const line of lines) {
    const nextLine = verseLines.find((candidate) => candidate.top > line.bottom + 0.5);
    const lineGap = nextLine ? nextLine.top - line.bottom : null;
    if (nextLine && lineGap < 2) return null;
    const corridorY = halfPixel(nextLine ? line.bottom + lineGap / 2 : line.bottom + 7);
    const contactOffset = nextLine ? Math.min(1.5, Math.max(0.5, lineGap / 4)) : 1.5;
    const lineContacts = line.rects.map((rect) => ({
      x1: rect.x1,
      x2: rect.x2,
      contactY: halfPixel(rect.bottom + contactOffset),
      pinX: halfPixel((rect.x1 + rect.x2) / 2),
      corridorY,
    }));
    contacts.push(...lineContacts);
    const pins = lineContacts.map((contact) => contact.pinX);
    wefts.push({
      // Each typographic row carries only the thread between verified
      // anchors. A gutter route can read as an accidental box around the
      // first word, especially when a phrase wraps; the caption's woven mark
      // supplies the cross-row relationship without drawing over Scripture.
      x1: halfPixel(Math.min(...pins)),
      x2: halfPixel(Math.max(...pins)),
      y: corridorY,
    });
  }
  return {
    route: lines.length === 1 ? 'inline' : 'stacked',
    contacts,
    wefts,
    warp: null,
    knots: contacts.map((contact) => ({ x: contact.pinX, y: contact.corridorY })),
  };
}

export function annotateVisualTimeline(timeline, durationSec) {
  const events = Array.isArray(timeline) ? timeline : [];
  const duration = Math.max(0, Number(durationSec) || 0);
  const sceneStarts = events
    .filter((event) => event?.kind === 'scene' && Number.isFinite(Number(event.at)))
    .map((event) => Number(event.at))
    .sort((a, b) => a - b);
  const sceneEnd = (event) => sceneStarts.find((start) => start > Number(event.at)) ?? duration;

  events.forEach((event, index) => {
    if (!event || event.kind === 'scene') return;
    if (event.kind === 'word') {
      const end = Math.min(sceneEnd(event), Number(event.groupAt ?? event.at + 4));
      event.exitAtWide = end;
      event.exitAtNarrow = end;
      return;
    }
    const dwell = VISUAL_DWELL_SEC[event.kind];
    if (!Number.isFinite(dwell)) return;
    for (const narrow of [false, true]) {
      const channel = visualChannelForKind(event.kind, { narrow });
      const next = events.slice(index + 1).find((candidate) => (
        candidate?.scene === event.scene
        && Number(candidate.at) >= Number(event.at)
        && visualChannelForKind(candidate.kind, { narrow }) === channel
        && !(Number(candidate.at) === Number(event.at)
          && event.kind !== 'group' && candidate.kind === 'group')
      ));
      const exitAt = Math.min(
        sceneEnd(event),
        Number(event.at) + dwell,
        next ? Number(next.at) : Number.POSITIVE_INFINITY,
      );
      event[narrow ? 'exitAtNarrow' : 'exitAtWide'] = exitAt;
    }
  });
  return events;
}

export function visualEventIsActive(event, atSec, { narrow = false } = {}) {
  if (!event || !Number.isFinite(Number(event.at)) || Number(atSec) < Number(event.at)) return false;
  const exitAt = Number(event[narrow ? 'exitAtNarrow' : 'exitAtWide']);
  return Number.isFinite(exitAt) && Number(atSec) < exitAt;
}

// One authoritative media-time projection for the theater. Ordinary artifacts
// share one thought slot. A spotlight wins for its full dwell, and an event
// whose entrance happened underneath that spotlight is never resurrected late.
export function resolveVisualComposition(timeline, atSec, { scene = null, narrow = false } = {}) {
  const at = Number(atSec);
  if (!Number.isFinite(at)) return { focus: null, thought: null, loom: null, wordCues: [] };
  const events = (Array.isArray(timeline) ? timeline : [])
    .map((event, index) => ({ event, index }))
    .filter(({ event }) => event && (scene == null || event.scene === scene));
  const focuses = events.filter(({ event }) => event.kind === 'highlight');
  const activeFocus = focuses
    .filter(({ event }) => visualEventIsActive(event, at, { narrow }))
    .sort((a, b) => Number(b.event.at) - Number(a.event.at) || b.index - a.index)[0]?.event || null;
  if (activeFocus) return { focus: activeFocus, thought: null, loom: null, wordCues: [] };

  const completedFocusCutoff = focuses.reduce((cutoff, { event }) => {
    const exit = Number(event[narrow ? 'exitAtNarrow' : 'exitAtWide']);
    return Number.isFinite(exit) && exit <= at ? Math.max(cutoff, exit) : cutoff;
  }, Number.NEGATIVE_INFINITY);
  const beganInsideFocus = (event) => focuses.some(({ event: focus }) => {
    const exit = Number(focus[narrow ? 'exitAtNarrow' : 'exitAtWide']);
    return Number(event.at) >= Number(focus.at) && Number(event.at) < exit;
  });
  const ordinary = events
    .filter(({ event }) => THOUGHT_KINDS.has(event.kind))
    .filter(({ event }) => Number(event.at) >= completedFocusCutoff)
    .filter(({ event }) => !beganInsideFocus(event))
    .filter(({ event }) => visualEventIsActive(event, at, { narrow }))
    .sort((a, b) => Number(b.event.at) - Number(a.event.at)
      || Number(b.event.kind !== 'group') - Number(a.event.kind !== 'group')
      || b.index - a.index)[0]?.event || null;
  const wordCues = events
    .filter(({ event }) => event.kind === 'word')
    .filter(({ event }) => Number(event.at) >= completedFocusCutoff)
    .filter(({ event }) => !beganInsideFocus(event))
    .filter(({ event }) => visualEventIsActive(event, at, { narrow }))
    .map(({ event }) => event);
  const thought = wordCues.length ? null : ordinary;
  return {
    focus: null,
    thought,
    loom: thought?.kind === 'group' ? thought : null,
    wordCues,
  };
}

const TIMING_SOURCES = new Set(['cue', 'word', 'house']);
const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => (
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value))
);
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const tenth = (value) => Math.round(value * 10) / 10;

export function computeDirectorMovementBudget({ durationSec, sustainedTeachingSec = durationSec } = {}) {
  const duration = Math.max(0, tenth(Number(durationSec) || 0));
  const sustained = clamp(
    Math.max(0, tenth(Number(sustainedTeachingSec) || 0)),
    0,
    duration,
  );
  const targetThoughtEntrances = sustained < 8 ? 0 : Math.max(1, Math.round(sustained / 30));
  const hardBeatCeiling = targetThoughtEntrances === 0
    ? 0
    : Math.min(
      DIRECTOR_LIMITS.maxBeats,
      Math.max(targetThoughtEntrances + 2, Math.ceil(sustained / 12)),
    );
  const highlightCeiling = computeDirectorHighlightCeiling({
    sustainedTeachingSec: sustained,
    hardBeatCeiling,
  });
  const modelSceneCeiling = sustained < 8
    ? 0
    : Math.min(DIRECTOR_LIMITS.maxScenes, Math.max(1, Math.ceil(sustained / 30)));
  return Object.freeze({
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    durationSec: duration,
    sustainedTeachingSec: sustained,
    targetThoughtEntrances,
    hardBeatCeiling,
    highlightCeiling,
    modelSceneCeiling,
    houseSceneReserve: DIRECTOR_LIMITS.houseSceneReserve,
    finalSceneCeiling: modelSceneCeiling + DIRECTOR_LIMITS.houseSceneReserve,
    fillGapSec: DIRECTOR_LIMITS.fillGapSec,
  });
}

// The first live evidence pass showed that a fixed global highlight cap lets a
// short clip become a stack of focus takeovers. A highlight is therefore
// earned by sustained teaching time: at most one per 180 active seconds,
// rounded up so a genuine short-clip thesis remains possible.
export function computeDirectorHighlightCeiling({
  sustainedTeachingSec = 0,
  hardBeatCeiling = DIRECTOR_LIMITS.maxBeats,
} = {}) {
  const sustained = Math.max(0, Number(sustainedTeachingSec) || 0);
  const hard = Math.max(0, Math.floor(Number(hardBeatCeiling) || 0));
  if (sustained < 8 || hard === 0) return 0;
  return Math.min(
    DIRECTOR_LIMITS.maxByKind.highlight,
    DIRECTOR_LIMITS.maxBeats,
    hard,
    Math.max(1, Math.ceil(sustained / DIRECTOR_LIMITS.highlightSustainedSec)),
  );
}

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

function directorIdentityParts({
  modelKey = MAGIC_MODEL_ROLES.director,
  schemaVersion = MAGIC_DIRECTOR_SCHEMA_VERSION,
  policyVersion = MAGIC_DIRECTOR_POLICY_VERSION,
  recordId,
  fromSec,
  toSec,
  why = '',
}) {
  assertMagicModel(modelKey);
  const from = Math.max(0, tenth(Number(fromSec) || 0));
  const to = Math.max(from, tenth(Number(toSec) || from));
  if (schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throw new Error(`director schema ${String(schemaVersion)} is not supported`);
  }
  if (policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    throw new Error(`director policy ${String(policyVersion)} is not supported`);
  }
  return [
    schemaVersion,
    policyVersion,
    modelKey,
    String(recordId || ''),
    from,
    to,
    stableTextHash(normalizeDirectorWhy(why).trim()),
  ];
}

export function normalizeDirectorWhy(value) {
  return String(value || '').slice(0, MAGIC_DIRECTOR_WHY_MAX_CHARS);
}

// The browser can use this only to coalesce identical requests during one
// in-memory tour. It is deliberately not called a cache key: only the server
// can bind a direction to the complete transcript snapshot.
export function directorRequestFingerprint(input) {
  return directorIdentityParts(input).join('|');
}

export function directorCacheKey({ transcriptHash, ...input }) {
  const hash = String(transcriptHash || '').trim().toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(hash)) {
    throw new Error('director cache identity requires a 16-64 character hexadecimal transcriptHash');
  }
  const parts = directorIdentityParts(input);
  return [...parts.slice(0, 6), hash, parts[6]].join('|');
}

function validateDirectorIdentity(payload, errors) {
  const fingerprint = typeof payload.requestFingerprint === 'string' ? payload.requestFingerprint : '';
  const parts = fingerprint.split('|');
  if (parts.length !== 7 || parts[0] !== String(MAGIC_DIRECTOR_SCHEMA_VERSION)
    || parts[1] !== MAGIC_DIRECTOR_POLICY_VERSION || parts[2] !== MAGIC_MODEL_KEY
    || !parts[3] || !finite(parts[4]) || !finite(parts[5])
    || !/^[0-9a-f]{16}$/i.test(parts[6])) {
    errors.push('requestFingerprint must carry the complete current director identity');
    return;
  }
  if (tenth(Number(parts[4])) !== tenth(Number(payload.clip?.fromSec))
    || tenth(Number(parts[5])) !== tenth(Number(payload.clip?.toSec))) {
    errors.push('requestFingerprint clip bounds do not match the payload');
  }
  const transcriptHash = String(payload.clip?.transcriptHash || '').toLowerCase();
  const expectedKey = [...parts.slice(0, 6), transcriptHash, parts[6]].join('|');
  if (payload.requestKey !== expectedKey) {
    errors.push('requestKey must exactly reconcile fingerprint, policy, bounds, transcript, record, and why identity');
  }
}

const BEAT_PRIORITY = Object.freeze({
  highlight: 0,
  footnote: 1,
  term: 2,
  allusion: 3,
  compare: 4,
  chain: 5,
  caveat: 6,
  aside: 7,
  group: 8,
});
const LEGACY_SCENE_ARTIFACT_KEYS = Object.freeze([
  'groups', 'footnotes', 'terms', 'allusions', 'asides', 'compare', 'chain', 'caveat', 'highlight',
]);

const clonePlain = (value) => {
  if (Array.isArray(value)) return value.map(clonePlain);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, clonePlain(child)]));
};

const canonicalContractValue = (value) => {
  if (Array.isArray(value)) return value.map(canonicalContractValue);
  if (!isObject(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalContractValue(value[key])]));
};
const contractEqual = (a, b) => (
  JSON.stringify(canonicalContractValue(a)) === JSON.stringify(canonicalContractValue(b))
);

const safeContractId = (value, fallback) => {
  const clean = String(value || '').trim();
  return /^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(clean) ? clean : fallback;
};

const timingSourceOf = (value) => TIMING_SOURCES.has(value?.timingSource) ? value.timingSource : 'house';

function cadenceFromEntrances(entrances, durationSec, extra = {}) {
  const duration = Math.max(0, tenth(Number(durationSec) || 0));
  const valid = entrances
    .filter((entry) => finite(entry?.at))
    .map((entry) => ({ ...entry, at: tenth(Number(entry.at)) }))
    .filter((entry) => entry.at >= 0 && entry.at <= duration)
    .sort((a, b) => a.at - b.at || String(a.id || '').localeCompare(String(b.id || '')));
  const uniqueEntranceCount = new Set(valid.map((entry) => entry.at)).size;
  const times = [...new Set([0, duration, ...valid.map((entry) => entry.at)])].sort((a, b) => a - b);
  const gaps = [];
  for (let index = 1; index < times.length; index += 1) {
    gaps.push({ start: times[index - 1], end: times[index], len: tenth(times[index] - times[index - 1]) });
  }
  gaps.sort((a, b) => b.len - a.len || a.start - b.start);
  return {
    entranceCount: valid.length,
    // Entrances at exactly 0 or at the clip boundary still count as entrances;
    // only the gap calculation treats those timestamps as boundary sentinels.
    uniqueEntranceCount,
    uniqueBeatCount: uniqueEntranceCount,
    firstEntranceSec: valid.length ? valid[0].at : null,
    lastEntranceSec: valid.length ? valid.at(-1).at : null,
    firstBeatSec: valid.length ? valid[0].at : null,
    lastBeatSec: valid.length ? valid.at(-1).at : null,
    maxGapSec: gaps[0]?.len ?? duration,
    largestGap: gaps[0] || { start: 0, end: duration, len: duration },
    gaps,
    ...extra,
  };
}

export function measureSceneCadence(scenes, durationSec) {
  return cadenceFromEntrances(
    (Array.isArray(scenes) ? scenes : []).map((scene) => ({ id: scene?.id, at: scene?.at })),
    durationSec,
  );
}

export function measureThoughtCadence(beats, durationSec, { excludedBeatIds = [] } = {}) {
  const excluded = new Set(excludedBeatIds);
  const acceptedArtifacts = (Array.isArray(beats) ? beats : [])
    .filter((beat) => DIRECTOR_ARTIFACT_KINDS.includes(beat?.kind) && !excluded.has(beat.id));
  const artifactCounts = Object.fromEntries(DIRECTOR_ARTIFACT_KINDS.map((kind) => [
    kind,
    acceptedArtifacts.filter((beat) => beat.kind === kind).length,
  ]));
  return cadenceFromEntrances(
    acceptedArtifacts
      .filter((beat) => THOUGHT_KINDS.has(beat.kind))
      .map((beat) => ({ id: beat.id, kind: beat.kind, at: beat.at })),
    durationSec,
    { artifactCounts },
  );
}

// Gap coverage is about whether the audience saw a new visual entrance, not
// which renderer channel owned it. Focus/highlight entrances therefore count
// here even though they remain excluded from THOUGHT_KINDS channel semantics.
export function measureVisualCadence(beats, durationSec, { excludedBeatIds = [] } = {}) {
  const excluded = new Set(excludedBeatIds);
  const accepted = (Array.isArray(beats) ? beats : [])
    .filter((beat) => DIRECTOR_ARTIFACT_KINDS.includes(beat?.kind) && !excluded.has(beat.id));
  const artifactCounts = Object.fromEntries(DIRECTOR_ARTIFACT_KINDS.map((kind) => [
    kind,
    accepted.filter((beat) => beat.kind === kind).length,
  ]));
  return cadenceFromEntrances(
    accepted.map((beat) => ({ id: beat.id, kind: beat.kind, at: beat.at })),
    durationSec,
    { artifactCounts },
  );
}

function directorKindCeiling(kind, budget) {
  const global = Math.min(
    Number(DIRECTOR_LIMITS.maxByKind[kind]) || 0,
    Math.max(0, Number(budget?.hardBeatCeiling) || 0),
  );
  if (kind !== 'highlight') return global;
  return Math.min(global, Math.max(0, Number(budget?.highlightCeiling) || 0));
}

function chooseHouseSlot(wanted, occupied, start, end, minimumGap) {
  const legal = (at) => at >= start && at <= end && occupied.every((other) => Math.abs(other - at) >= minimumGap);
  if (legal(wanted)) return wanted;
  const marks = [start, ...occupied.filter((at) => at >= start && at <= end).sort((a, b) => a - b), end];
  const candidates = [];
  if (legal(start)) candidates.push(start);
  if (legal(end)) candidates.push(end);
  for (let index = 1; index < marks.length; index += 1) {
    const at = tenth((marks[index - 1] + marks[index]) / 2);
    if (legal(at)) candidates.push(at);
  }
  candidates.sort((a, b) => Math.abs(a - wanted) - Math.abs(b - wanted) || a - b);
  return candidates[0] ?? null;
}

export function buildVisualTimeline({ scenes: rawScenes = [], beats: rawBeats = [] } = {}, durationSec = 0) {
  const scenes = (Array.isArray(rawScenes) ? rawScenes : []).filter(isObject).map((scene) => ({
    ...clonePlain(scene),
    verses: Array.isArray(scene?.verses) ? scene.verses.map(clonePlain) : [],
  })).sort((a, b) => Number(a.at) - Number(b.at) || String(a.id).localeCompare(String(b.id)));
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const beats = (Array.isArray(rawBeats) ? rawBeats : []).filter(isObject).map(clonePlain).sort((a, b) => Number(a.at) - Number(b.at)
    || (BEAT_PRIORITY[a.kind] ?? 99) - (BEAT_PRIORITY[b.kind] ?? 99)
    || String(a.id).localeCompare(String(b.id)));
  const timeline = [];
  let order = 0;
  const add = (event, priority) => timeline.push({ ...event, priority, order: order++ });
  scenes.forEach((scene, index) => add({ at: scene.at, kind: 'scene', scene, idx: index }, 0));
  for (const beat of beats) {
    const scene = sceneById.get(beat.sceneId);
    if (!scene) continue;
    if (beat.kind === 'group') {
      for (const wordTime of (Array.isArray(beat.data?.wordTimes) ? beat.data.wordTimes : [])) {
        if (finite(wordTime?.at) && Number(wordTime.at) <= Number(beat.at)) {
          add({
            at: Number(wordTime.at),
            kind: 'word',
            scene,
            beatId: beat.id,
            proposalId: beat.proposalId,
            word: wordTime.word,
            occurrence: Number.isInteger(wordTime.occurrence) && wordTime.occurrence >= 0 ? wordTime.occurrence : 0,
            groupAt: beat.at,
          }, 1);
        }
      }
    }
    add({
      at: beat.at,
      kind: beat.kind,
      scene,
      beatId: beat.id,
      proposalId: beat.proposalId,
      beat,
      a: beat.data,
    }, beat.kind === 'group' ? 3 : 2);
  }
  timeline.sort((a, b) => Number(a.at) - Number(b.at) || a.priority - b.priority || a.order - b.order);
  annotateVisualTimeline(timeline, durationSec);
  timeline.scenes = scenes;
  timeline.beats = beats;
  return timeline;
}

export function summarizeVisualProjection(plan, durationSec) {
  const timeline = buildVisualTimeline(plan, durationSec);
  const beatEvents = timeline.filter((event) => event.beatId && event.kind !== 'word');
  const focusEvents = beatEvents.filter((event) => event.kind === 'highlight');
  const focusMasked = [];
  const superseded = [];
  const projectedVisible = [];
  for (const event of beatEvents) {
    const maskingFocus = event.kind === 'highlight' ? null : focusEvents
      .filter((focus) => focus.scene === event.scene
        && Number(event.at) >= Number(focus.at)
        && Number(event.at) < Number(focus.exitAtWide))
      .sort((a, b) => Number(b.at) - Number(a.at) || Number(b.order) - Number(a.order))[0];
    if (maskingFocus) {
      focusMasked.push({ beatId: event.beatId, byBeatId: maskingFocus.beatId, reason: 'entered-during-highlight' });
      continue;
    }
    const sampleAt = Math.min(Number(durationSec) || Number(event.at) + 0.01, Number(event.at) + 0.01);
    const projection = resolveVisualComposition(timeline, sampleAt, { scene: event.scene });
    const selected = projection.focus || projection.thought;
    if (selected?.beatId === event.beatId) {
      projectedVisible.push({ beatId: event.beatId, kind: event.kind });
      continue;
    }
    const wordOwner = projection.wordCues.at(-1);
    const replacement = wordOwner || selected;
    superseded.push({
      beatId: event.beatId,
      byBeatId: replacement?.beatId || null,
      reason: wordOwner
        ? 'word-cue-superseded'
        : replacement
          ? 'same-slot-superseded'
          : 'zero-visible-interval',
    });
  }
  return { focusMasked, superseded, projectedVisible };
}

function normalizeContext(context, rawPlan) {
  const supplied = finite(context) ? { durationSec: Number(context) } : (isObject(context) ? context : {});
  const requestedDuration = tenth(Number(supplied.durationSec ?? rawPlan?.durationSec));
  const durationSec = requestedDuration > 0 ? requestedDuration : 1;
  const sustainedTeachingSec = clamp(
    Number(supplied.sustainedTeachingSec ?? rawPlan?.sustainedTeachingSec ?? durationSec) || 0,
    0,
    durationSec,
  );
  // Callers may echo a budget for observability, but policy authority remains
  // here. Never let an override (especially NaN) disable a safety comparison.
  const budget = computeDirectorMovementBudget({ durationSec, sustainedTeachingSec });
  return { ...supplied, durationSec, sustainedTeachingSec, budget };
}

export function normalizeDirectorPlan(rawPlan = {}, context = {}) {
  const { durationSec: duration, budget, addPrelude = true } = normalizeContext(context, rawPlan);
  const latestEntrance = Math.max(0, tenth(duration - 0.1));
  const report = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    dropped: [],
    shifted: 0,
    clamped: 0,
    invented: 0,
    reassigned: 0,
    preludes: 0,
  };

  const seenSceneIds = new Set();
  let modelScenes = [];
  const suppliedHouseScenes = [];
  for (const [index, raw] of (Array.isArray(rawPlan?.scenes) ? rawPlan.scenes : []).entries()) {
    if (!isObject(raw)) {
      report.dropped.push({ id: `scene-${index + 1}`, kind: 'scene', reason: 'invalid-scene', count: 1 });
      continue;
    }
    let id = safeContractId(raw.id, `scene-${index + 1}`);
    if (seenSceneIds.has(id)) id = `scene-${index + 1}`;
    while (seenSceneIds.has(id)) id = `${id}-x`;
    seenSceneIds.add(id);
    const source = timingSourceOf(raw);
    const hasVerifiedAt = finite(raw.at);
    if (source !== 'house' && !hasVerifiedAt) {
      report.dropped.push({ id, kind: 'scene', reason: 'anchored-time-required', count: 1 });
      continue;
    }
    const at = hasVerifiedAt ? tenth(Number(raw.at)) : tenth((duration * index) / Math.max(1, rawPlan.scenes.length));
    if (!hasVerifiedAt) report.invented += 1;
    if (source !== 'house' && (at < 0 || at >= duration)) {
      report.dropped.push({ id, kind: 'scene', reason: 'anchored-outside-clip', at, count: 1 });
      continue;
    }
    const ref = typeof raw.ref === 'string' && raw.ref.trim() ? raw.ref.trim() : null;
    const verses = Array.isArray(raw.verses) ? raw.verses.filter(isObject).map(clonePlain) : [];
    const validPreludeClaim = raw.origin === 'house-prelude' && source === 'house' && at === 0
      && raw.cue == null && ref == null && verses.length === 0;
    const scene = {
      ...clonePlain(raw),
      id,
      origin: validPreludeClaim ? 'house-prelude' : 'model',
      ref,
      verses,
      at: tenth(clamp(at, 0, latestEntrance)),
      timingSource: source,
    };
    for (const key of LEGACY_SCENE_ARTIFACT_KEYS) delete scene[key];
    if (scene.at !== at) report.clamped += 1;
    if (scene.origin === 'house-prelude') suppliedHouseScenes.push(scene);
    else modelScenes.push(scene);
  }

  modelScenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const anchoredSceneTimesSeen = new Set();
  modelScenes = modelScenes.filter((scene) => {
    if (scene.timingSource === 'house') return true;
    if (anchoredSceneTimesSeen.has(scene.at)) {
      report.dropped.push({ id: scene.id, kind: 'scene', reason: 'scene-cue-collision', at: scene.at, count: 1 });
      return false;
    }
    anchoredSceneTimesSeen.add(scene.at);
    return true;
  });
  if (modelScenes.length > budget.modelSceneCeiling) {
    const removed = modelScenes.splice(budget.modelSceneCeiling);
    removed.forEach((scene) => report.dropped.push({
      id: scene.id,
      kind: 'scene',
      reason: 'scene-safety-cap',
      count: 1,
      ceiling: budget.modelSceneCeiling,
    }));
  }

  const scenes = [...modelScenes, ...suppliedHouseScenes.slice(0, budget.houseSceneReserve)];
  if (suppliedHouseScenes.length > budget.houseSceneReserve) {
    suppliedHouseScenes.slice(budget.houseSceneReserve).forEach((scene) => report.dropped.push({
      id: scene.id,
      kind: 'scene',
      reason: 'house-scene-reserve',
      count: 1,
    }));
  }
  scenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const anchoredSceneTimes = scenes.filter((scene) => scene.timingSource !== 'house').map((scene) => scene.at);
  const allocatedSceneTimes = [...anchoredSceneTimes];
  for (const scene of [...scenes].filter((candidate) => candidate.timingSource === 'house').sort((a, b) => a.at - b.at)) {
    const wanted = scene.origin === 'house-prelude' ? 0 : scene.at;
    // A prelude is a reserved entrance, not a movable ordinary scene. If a
    // verified model entrance makes 0 illegal, preserve the model scene and
    // omit the optional prelude instead of manufacturing a later "prelude".
    const slot = scene.origin === 'house-prelude'
      ? (allocatedSceneTimes.every((at) => Math.abs(at) >= DIRECTOR_LIMITS.sceneMinGapSec) ? 0 : null)
      : chooseHouseSlot(wanted, allocatedSceneTimes, 0, latestEntrance, DIRECTOR_LIMITS.sceneMinGapSec);
    if (slot == null) {
      scenes.splice(scenes.indexOf(scene), 1);
      report.dropped.push({ id: scene.id, kind: 'scene', reason: 'no-house-slot', at: scene.at, count: 1 });
      continue;
    }
    if (slot !== scene.at) report.shifted += 1;
    scene.at = slot;
    allocatedSceneTimes.push(slot);
    allocatedSceneTimes.sort((a, b) => a - b);
  }
  scenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const hasPrelude = scenes.some((scene) => scene.origin === 'house-prelude');
  const firstModelScene = scenes.find((scene) => scene.origin === 'model');
  if (addPrelude && !hasPrelude && firstModelScene?.verses?.length
    && firstModelScene.at >= DIRECTOR_LIMITS.preludeMinSec && budget.houseSceneReserve > 0) {
    let id = 'scene-house-prelude';
    let suffix = 1;
    while (seenSceneIds.has(id)) id = `scene-house-prelude-${suffix++}`;
    seenSceneIds.add(id);
    scenes.push({
      id,
      origin: 'house-prelude',
      ref: null,
      verses: [],
      cue: null,
      at: 0,
      timingSource: 'house',
    });
    scenes.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
    report.preludes += 1;
  }

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const windows = scenes.map((scene, index) => ({
    scene,
    start: scene.at,
    end: index + 1 < scenes.length ? tenth(scenes[index + 1].at - 0.1) : duration,
  }));
  const windowForScene = new Map(windows.map((window) => [window.scene.id, window]));
  const windowAt = (at) => windows.find((window, index) => (
    at >= window.start && (index + 1 >= windows.length || at < windows[index + 1].start)
  )) || null;

  let beats = [];
  const seenBeatIds = new Set();
  const seenProposalIds = new Set();
  for (const [index, raw] of (Array.isArray(rawPlan?.beats) ? rawPlan.beats : []).entries()) {
    const fallbackId = `beat-${index + 1}`;
    if (!isObject(raw)) {
      report.dropped.push({ id: fallbackId, reason: 'invalid-beat', count: 1 });
      continue;
    }
    let id = safeContractId(raw.id, fallbackId);
    if (seenBeatIds.has(id)) id = fallbackId;
    while (seenBeatIds.has(id)) id = `${id}-x`;
    seenBeatIds.add(id);
    let proposalId = safeContractId(raw.proposalId, `proposal-${index + 1}`);
    if (seenProposalIds.has(proposalId)) proposalId = `proposal-${index + 1}`;
    while (seenProposalIds.has(proposalId)) proposalId = `${proposalId}-x`;
    seenProposalIds.add(proposalId);
    const kind = String(raw.kind || '');
    if (!DIRECTOR_ARTIFACT_KINDS.includes(kind)) {
      report.dropped.push({ id, proposalId, kind, reason: 'unknown-kind', count: 1 });
      continue;
    }
    if (!isObject(raw.data)) {
      report.dropped.push({ id, proposalId, kind, reason: 'invalid-data', count: 1 });
      continue;
    }
    let source = timingSourceOf(raw);
    let at = finite(raw.at) ? tenth(Number(raw.at)) : null;
    if (at == null) {
      const declared = windowForScene.get(raw.sceneId);
      at = declared ? tenth((declared.start + declared.end) / 2) : tenth(duration / 2);
      source = 'house';
      report.invented += 1;
    }
    if (source !== 'house' && (at < 0 || at >= duration)) {
      report.dropped.push({ id, proposalId, kind, reason: 'anchored-outside-clip', at, count: 1 });
      continue;
    }
    const clampedAt = tenth(clamp(at, 0, latestEntrance));
    if (clampedAt !== at) report.clamped += 1;
    at = clampedAt;
    const declaredScene = sceneById.get(raw.sceneId) || null;
    const timedWindow = windowAt(at);
    const verseBound = kind === 'group' || kind === 'footnote';
    if (verseBound) {
      const declaredWindow = declaredScene ? windowForScene.get(declaredScene.id) : null;
      if (!declaredScene) {
        report.dropped.push({ id, proposalId, kind, reason: 'missing-owner-scene', at, count: 1 });
        continue;
      }
      if (!declaredScene.verses.length) {
        report.dropped.push({ id, proposalId, kind, reason: 'owner-has-no-passage', at, count: 1 });
        continue;
      }
      if (!declaredWindow || at < declaredWindow.start || at > declaredWindow.end) {
        report.dropped.push({ id, proposalId, kind, reason: 'anchored-outside-owner', at, count: 1 });
        continue;
      }
    } else if (!timedWindow) {
      // Portable beats follow verified media time. A declared future scene is
      // not an ownership fallback for time before the first structural scene.
      report.dropped.push({ id, proposalId, kind, reason: 'no-scene-at-time', at, count: 1 });
      continue;
    } else if (raw.sceneId !== timedWindow.scene.id) {
      report.reassigned += 1;
    }
    const sceneId = verseBound ? declaredScene.id : timedWindow.scene.id;
    if (!sceneId) {
      report.dropped.push({ id, proposalId, kind, reason: 'no-scene-at-time', at, count: 1 });
      continue;
    }
    const data = clonePlain(raw.data);
    if (Array.isArray(data.wordTimes) && kind === 'group') {
      const ownerWindow = windowForScene.get(sceneId);
      data.wordTimes = data.wordTimes
        .filter((wordTime) => isObject(wordTime) && wordTime.timingSource === 'word'
          && typeof wordTime.word === 'string' && wordTime.word.trim()
          && finite(wordTime.at) && Number(wordTime.at) >= ownerWindow.start
          && Number(wordTime.at) <= ownerWindow.end && Number(wordTime.at) <= at)
        .map((wordTime) => ({
          ...wordTime,
          at: tenth(Number(wordTime.at)),
          occurrence: Number.isInteger(Number(wordTime.occurrence)) && Number(wordTime.occurrence) >= 0
            ? Number(wordTime.occurrence)
            : 0,
          timingSource: 'word',
        }));
    } else if (Object.hasOwn(data, 'wordTimes')) {
      delete data.wordTimes;
    }
    beats.push({ ...clonePlain(raw), id, proposalId, sceneId, kind, at, timingSource: source, data });
  }

  beats.sort((a, b) => a.at - b.at || (BEAT_PRIORITY[a.kind] ?? 99) - (BEAT_PRIORITY[b.kind] ?? 99)
    || a.id.localeCompare(b.id));
  const occupied = beats.filter((beat) => beat.timingSource !== 'house' && beat.kind !== 'aside').map((beat) => beat.at);
  const asideOccupied = beats.filter((beat) => beat.timingSource !== 'house' && beat.kind === 'aside').map((beat) => beat.at);
  const removed = new Set();
  for (const beat of beats.filter((candidate) => candidate.timingSource === 'house')) {
    const window = windowForScene.get(beat.sceneId);
    const aside = beat.kind === 'aside';
    const slot = chooseHouseSlot(
      beat.at,
      aside ? asideOccupied : occupied,
      window.start,
      Math.min(window.end, latestEntrance),
      aside ? DIRECTOR_LIMITS.asideCooldownSec : DIRECTOR_LIMITS.fieldMinGapSec,
    );
    if (slot == null) {
      removed.add(beat);
      report.dropped.push({ id: beat.id, proposalId: beat.proposalId, kind: beat.kind, reason: 'no-house-slot', at: beat.at, count: 1 });
      continue;
    }
    if (slot !== beat.at) report.shifted += 1;
    beat.at = slot;
    (aside ? asideOccupied : occupied).push(slot);
  }
  beats = beats.filter((beat) => !removed.has(beat));

  // House allocation can move a group earlier than the time used by the
  // first-pass word filter. Reconcile again against the final group entrance
  // so the normalizer never emits a word cue that playback would omit and the
  // strict validator would refuse.
  for (const beat of beats) {
    if (beat.kind !== 'group' || !Array.isArray(beat.data?.wordTimes)) continue;
    const window = windowForScene.get(beat.sceneId);
    beat.data.wordTimes = beat.data.wordTimes.filter((wordTime) => (
      finite(wordTime?.at)
      && Number(wordTime.at) >= window.start
      && Number(wordTime.at) <= window.end
      && Number(wordTime.at) <= Number(beat.at)
    ));
  }

  const acceptedAsideTimes = [];
  beats = beats.filter((beat) => {
    if (beat.kind !== 'aside') return true;
    if (acceptedAsideTimes.some((at) => Math.abs(at - beat.at) < DIRECTOR_LIMITS.asideCooldownSec)) {
      report.dropped.push({ id: beat.id, proposalId: beat.proposalId, kind: beat.kind, reason: 'aside-cooldown', at: beat.at, count: 1 });
      return false;
    }
    acceptedAsideTimes.push(beat.at);
    return true;
  });

  const byKind = new Map();
  beats = beats.filter((beat) => {
    const count = byKind.get(beat.kind) || 0;
    const ceiling = directorKindCeiling(beat.kind, budget);
    if (count >= ceiling) {
      report.dropped.push({ id: beat.id, proposalId: beat.proposalId, kind: beat.kind, reason: 'kind-safety-cap', ceiling, count: 1 });
      return false;
    }
    byKind.set(beat.kind, count + 1);
    return true;
  });
  if (beats.length > budget.hardBeatCeiling) {
    beats.splice(budget.hardBeatCeiling).forEach((beat) => report.dropped.push({
      id: beat.id,
      proposalId: beat.proposalId,
      kind: beat.kind,
      reason: 'beat-safety-cap',
      ceiling: budget.hardBeatCeiling,
      count: 1,
    }));
  }
  beats.sort((a, b) => a.at - b.at || (BEAT_PRIORITY[a.kind] ?? 99) - (BEAT_PRIORITY[b.kind] ?? 99)
    || a.id.localeCompare(b.id));

  const projection = summarizeVisualProjection({ scenes, beats }, duration);
  report.sceneCount = scenes.length;
  report.beatCount = beats.length;
  report.artifactCount = beats.length;
  report.artifactCounts = measureThoughtCadence(beats, duration).artifactCounts;
  report.sceneCadence = measureSceneCadence(scenes, duration);
  const projectedVisibleIds = new Set(projection.projectedVisible.map((entry) => entry.beatId));
  report.thoughtCadence = measureThoughtCadence(
    beats,
    duration,
    { excludedBeatIds: beats.filter((beat) => !projectedVisibleIds.has(beat.id)).map((beat) => beat.id) },
  );
  report.visualCadence = measureVisualCadence(
    beats,
    duration,
    { excludedBeatIds: beats.filter((beat) => !projectedVisibleIds.has(beat.id)).map((beat) => beat.id) },
  );
  report.projection = projection;
  return { scenes, beats, report };
}

function legacyScenesToPlan(rawScenes) {
  const scenes = [];
  const beats = [];
  const plural = { group: 'groups', footnote: 'footnotes', term: 'terms', allusion: 'allusions', aside: 'asides' };
  for (const [sceneIndex, raw] of (Array.isArray(rawScenes) ? rawScenes : []).entries()) {
    if (!isObject(raw)) continue;
    const sceneId = `legacy-scene-${sceneIndex + 1}`;
    const structural = clonePlain(raw);
    for (const key of LEGACY_SCENE_ARTIFACT_KEYS) delete structural[key];
    const legacyPrelude = raw.origin === 'house-prelude'
      && finite(raw.at) && Number(raw.at) === 0
      && timingSourceOf(raw) === 'house'
      && raw.cue == null && raw.ref == null
      && (!Array.isArray(raw.verses) || raw.verses.length === 0);
    scenes.push({
      ...structural,
      id: sceneId,
      // v1 did not enforce prelude semantics. Preserve the visible scene but
      // do not carry a false house-prelude claim into the stricter v2 shape.
      origin: legacyPrelude ? 'house-prelude' : 'model',
    });
    let ordinal = 0;
    const add = (kind, artifact) => {
      if (!isObject(artifact)) return;
      ordinal += 1;
      const { at, timingSource, cue, ...data } = clonePlain(artifact);
      beats.push({
        id: `legacy-beat-${sceneIndex + 1}-${ordinal}`,
        proposalId: `legacy-proposal-${sceneIndex + 1}-${ordinal}`,
        sceneId,
        kind,
        at,
        timingSource,
        ...(cue != null ? { cue } : {}),
        data,
      });
    };
    for (const [kind, key] of Object.entries(plural)) {
      for (const artifact of (Array.isArray(raw[key]) ? raw[key] : [])) add(kind, artifact);
    }
    for (const kind of ['compare', 'chain', 'caveat', 'highlight']) add(kind, raw[kind]);
  }
  return { scenes, beats };
}

function inflateLegacyScenes(plan) {
  const scenes = plan.scenes.map((scene) => ({
    ...scene,
    groups: [], footnotes: [], terms: [], allusions: [], asides: [],
    compare: null, chain: null, caveat: null, highlight: null,
  }));
  const byId = new Map(scenes.map((scene) => [scene.id, scene]));
  const plural = { group: 'groups', footnote: 'footnotes', term: 'terms', allusion: 'allusions', aside: 'asides' };
  for (const beat of plan.beats) {
    const scene = byId.get(beat.sceneId);
    if (!scene) continue;
    const artifact = { ...clonePlain(beat.data), at: beat.at, timingSource: beat.timingSource, ...(beat.cue != null ? { cue: beat.cue } : {}) };
    if (plural[beat.kind]) scene[plural[beat.kind]].push(artifact);
    else scene[beat.kind] = artifact;
  }
  return scenes;
}

// Deprecated v1 adapter for isolated callers while server and fixtures move to
// the strict plan contract. New code must consume `beats` directly.
export function normalizeDirectorScenes(rawScenes, durationSec) {
  const normalized = normalizeDirectorPlan(legacyScenesToPlan(rawScenes), { durationSec });
  return { ...normalized, scenes: inflateLegacyScenes(normalized) };
}

// Deprecated combined cadence. It intentionally preserves the old semantics
// for saved diagnostics; live fill policy must call measureThoughtCadence.
export function measureDirectorCadence(scenes, durationSec) {
  const plan = legacyScenesToPlan(scenes);
  const entrances = [
    ...plan.scenes.map((scene) => ({ id: scene.id, at: scene.at, kind: 'scene' })),
    ...plan.beats.map((beat) => ({ id: beat.id, at: beat.at, kind: beat.kind })),
  ];
  const artifactCounts = Object.fromEntries(DIRECTOR_ARTIFACT_KINDS.map((kind) => [
    kind,
    plan.beats.filter((beat) => beat.kind === kind).length,
  ]));
  return cadenceFromEntrances(entrances, durationSec, { artifactCounts });
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

const MAX_CANONICAL_VERSE_CHARS = 2000;
const MAX_CANONICAL_PASSAGE_CHARS = MAX_CANONICAL_VERSE_CHARS * 3;
const SCENE_CUE_MIN_CHARS = 8;
const SCENE_CUE_MAX_CHARS = 100;
const BEAT_CUE_MIN_CHARS = 8;
const BEAT_CUE_MAX_CHARS = 140;

function parsePassageRef(value) {
  const match = String(value || '').match(/^([1-3]\s+)?[A-Za-z][A-Za-z .'-]{0,47}\s+([1-9]\d{0,2}):([1-9]\d{0,2})(?:[–-]([1-9]\d{0,2}))?$/);
  if (!match) return null;
  const startVerse = Number(match[3]);
  const endVerse = Number(match[4] || match[3]);
  if (endVerse < startVerse || endVerse - startVerse > 2) return null;
  return { startVerse, endVerse, verseCount: endVerse - startVerse + 1 };
}

function resolvedPassageIsBounded(value) {
  return isObject(value) && Boolean(parsePassageRef(value.ref))
    && typeof value.text === 'string' && Boolean(value.text.trim())
    && value.text.length <= MAX_CANONICAL_PASSAGE_CHARS;
}

function validateBeatData(kind, data, path, errors) {
  const nonEmpty = (value) => typeof value === 'string' && Boolean(value.trim());
  if (kind === 'group') {
    if (!Array.isArray(data.words) || data.words.length < 2 || data.words.length > 4
      || data.words.some((word) => !nonEmpty(word) || word.length > 28 || word.trim().split(/\s+/).length > 3)) {
      errors.push(`${path}.words must contain 2-4 non-empty strings`);
    }
    if (!Array.isArray(data.occurrences)
      || data.occurrences.length !== (Array.isArray(data.words) ? data.words.length : -1)
      || data.occurrences.some((occurrence) => !Number.isInteger(occurrence) || occurrence < 0)) {
      errors.push(`${path}.occurrences must provide one zero-based coordinate per word`);
    }
    if (data.label != null && (typeof data.label !== 'string' || data.label.length > DIRECTOR_COPY_LIMITS.groupLabel)) {
      errors.push(`${path}.label is too long`);
    }
  } else if (kind === 'footnote') {
    if (!nonEmpty(data.word) || data.word.length > 28 || data.word.trim().split(/\s+/).length > 3
      || !nonEmpty(data.note) || data.note.length > DIRECTOR_COPY_LIMITS.footnoteNote) errors.push(`${path} requires bounded word and note text`);
    if (!Number.isInteger(data.occurrence) || data.occurrence < 0) errors.push(`${path}.occurrence must be zero-based`);
  } else if (kind === 'term') {
    if (!nonEmpty(data.term) || data.term.length > 24 || !nonEmpty(data.gloss) || data.gloss.length > DIRECTOR_COPY_LIMITS.termGloss) {
      errors.push(`${path} requires bounded term and gloss text`);
    }
  } else if (kind === 'allusion') {
    if (!resolvedPassageIsBounded(data)) errors.push(`${path} requires a bounded 1-3 verse passage`);
    if (data.note != null && (typeof data.note !== 'string' || data.note.length > DIRECTOR_COPY_LIMITS.relationNote)) errors.push(`${path}.note is too long`);
  } else if (kind === 'aside' || kind === 'caveat') {
    if (!nonEmpty(data.text) || data.text.length > DIRECTOR_COPY_LIMITS.marginText) errors.push(`${path}.text is required and bounded`);
  } else if (kind === 'highlight') {
    if (!nonEmpty(data.quote) || data.quote.length < 12 || data.quote.length > 140) {
      errors.push(`${path}.quote must be 12-140 characters`);
    }
  } else if (kind === 'compare') {
    if (!resolvedPassageIsBounded(data.a) || !resolvedPassageIsBounded(data.b)
      || !['likeness', 'difference'].includes(data.axis)) {
      errors.push(`${path} requires complete a/b passages and a valid axis`);
    }
    if (data.note != null && (typeof data.note !== 'string' || data.note.length > DIRECTOR_COPY_LIMITS.relationNote)) errors.push(`${path}.note is too long`);
  } else if (kind === 'chain') {
    if (!Array.isArray(data.links) || data.links.length < 2 || data.links.length > 4
      || data.links.some((link) => !resolvedPassageIsBounded(link))) {
      errors.push(`${path}.links must contain 2-4 complete passages`);
    }
    if (data.note != null && (typeof data.note !== 'string' || data.note.length > DIRECTOR_COPY_LIMITS.relationNote)) errors.push(`${path}.note is too long`);
  }
}

function validateStructuralScenes(
  scenes,
  clip,
  budget,
  errors,
  { allowEndBoundary = false, enforceHouseSpacing = true, legacyMigration = false } = {},
) {
  const duration = Number(clip?.durationSec);
  if (scenes.length > Number(budget?.finalSceneCeiling)) {
    errors.push(`scenes exceeds final ceiling ${String(budget?.finalSceneCeiling)}`);
  }
  const ids = new Set();
  let priorAt = -Infinity;
  for (const [sceneIndex, scene] of scenes.entries()) {
    const path = `scenes[${sceneIndex}]`;
    if (!isObject(scene)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (typeof scene.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(scene.id)) errors.push(`${path}.id is invalid`);
    else if (ids.has(scene.id)) errors.push(`${path}.id must be unique`);
    else ids.add(scene.id);
    if (!['model', 'house-prelude'].includes(scene.origin)) errors.push(`${path}.origin is invalid`);
    for (const key of LEGACY_SCENE_ARTIFACT_KEYS) {
      if (Object.hasOwn(scene, key)) errors.push(`${path}.${key} is a v1 nested artifact field; use beats[]`);
    }
    if (!finite(scene.at)) {
      errors.push(`${path}.at must be finite`);
      continue;
    }
    const start = Number(scene.at);
    if (start < 0 || start > duration || (!allowEndBoundary && start >= duration)) {
      errors.push(`${path}.at must leave a non-zero interval inside the clip`);
    }
    if (start <= priorAt) errors.push('scenes must be strictly ordered by at with unique entrances');
    priorAt = start;
    if (!['cue', 'house'].includes(scene.timingSource)) errors.push(`${path}.timingSource is invalid`);
    if (scene.timingSource === 'cue' && (typeof scene.cue !== 'string' || !scene.cue.trim())) {
      errors.push(`${path}.cue is required for cue timing`);
    } else if (!legacyMigration && scene.timingSource === 'cue'
      && (scene.cue.trim().length < SCENE_CUE_MIN_CHARS || scene.cue.trim().length > SCENE_CUE_MAX_CHARS)) {
      errors.push(`${path}.cue must be ${SCENE_CUE_MIN_CHARS}-${SCENE_CUE_MAX_CHARS} characters`);
    } else if (scene.cue != null && (typeof scene.cue !== 'string' || !scene.cue.trim())) {
      errors.push(`${path}.cue must be non-empty or null`);
    }
    if (!legacyMigration && scene.origin === 'model' && scene.timingSource !== 'cue') {
      errors.push(`${path} live model scenes must preserve verified cue timing`);
    }
    if (!Array.isArray(scene.verses) || scene.verses.length > 3) errors.push(`${path}.verses must contain at most three verses`);
    else if (scene.verses.some((verse) => !isObject(verse) || !Number.isInteger(Number(verse.verse))
      || Number(verse.verse) < 1 || typeof verse.text !== 'string' || !verse.text.trim()
      || verse.text.length > MAX_CANONICAL_VERSE_CHARS)) {
      errors.push(`${path}.verses must contain canonical verse numbers and text`);
    }
    const parsedRef = scene.ref == null ? null : parsePassageRef(scene.ref);
    if (scene.ref != null && !parsedRef) errors.push(`${path}.ref must be a bounded 1-3 verse reference`);
    if (Array.isArray(scene.verses) && Boolean(scene.verses.length) !== Boolean(scene.ref != null)) {
      errors.push(`${path}.ref and verses must describe the same passage`);
    }
    if (parsedRef && Array.isArray(scene.verses)
      && (scene.verses.length !== parsedRef.verseCount
        || scene.verses.some((verse, index) => Number(verse?.verse) !== parsedRef.startVerse + index))) {
      errors.push(`${path}.verses must exactly match the reference bounds`);
    }
    if (scene.origin === 'house-prelude') {
      if (scene.ref != null || scene.verses?.length) errors.push(`${path} house prelude must be verse-less`);
      if (start !== 0 || scene.timingSource !== 'house' || scene.cue != null) {
        errors.push(`${path} house prelude must be an untimed house entrance at 0`);
      }
    }
  }
  const validScenes = scenes.filter(isObject).filter((scene) => finite(scene.at));
  for (let index = 0; index < validScenes.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < validScenes.length; otherIndex += 1) {
      const a = validScenes[index];
      const b = validScenes[otherIndex];
      if (enforceHouseSpacing && (a.timingSource === 'house' || b.timingSource === 'house')
        && Math.abs(Number(a.at) - Number(b.at)) < DIRECTOR_LIMITS.sceneMinGapSec) {
        errors.push('house scene entrances must respect the scene spacing floor');
      }
    }
  }
  const preludeCount = scenes.filter((scene) => scene?.origin === 'house-prelude').length;
  const modelSceneCount = scenes.filter((scene) => scene?.origin === 'model').length;
  if (modelSceneCount > Number(budget?.modelSceneCeiling)) errors.push('model scenes exceed their duration-aware ceiling');
  if (preludeCount > Number(budget?.houseSceneReserve)) errors.push('house preludes exceed their reserved capacity');
  return ids;
}

function validateBeatTimeline(
  beats,
  scenes,
  clip,
  budget,
  errors,
  { allowEndBoundary = false, legacyMigration = false, enforceHouseSpacing = true } = {},
) {
  const duration = Number(clip?.durationSec);
  if (beats.length > Number(budget?.hardBeatCeiling)) errors.push(`beats exceeds ceiling ${String(budget?.hardBeatCeiling)}`);
  const validScenes = scenes.filter(isObject);
  const sceneById = new Map(validScenes.map((scene) => [scene.id, scene]));
  const sceneWindows = new Map(validScenes.map((scene, index) => [scene.id, {
    start: Number(scene.at),
    end: index + 1 < validScenes.length ? Number(validScenes[index + 1].at) : duration,
    halfOpen: index + 1 < validScenes.length,
  }]));
  const ids = new Set();
  const proposalIds = new Set();
  const counts = Object.fromEntries(DIRECTOR_ARTIFACT_KINDS.map((kind) => [kind, 0]));
  const asideTimes = [];
  let priorAt = -Infinity;
  for (const [index, beat] of beats.entries()) {
    const path = `beats[${index}]`;
    if (!isObject(beat)) {
      errors.push(`${path} must be an object`);
      continue;
    }
    if (typeof beat.id !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(beat.id)) errors.push(`${path}.id is invalid`);
    else if (ids.has(beat.id)) errors.push(`${path}.id must be unique`);
    else ids.add(beat.id);
    if (typeof beat.proposalId !== 'string' || !/^[a-z0-9][a-z0-9._:-]{0,95}$/i.test(beat.proposalId)) {
      errors.push(`${path}.proposalId is invalid`);
    } else if (proposalIds.has(beat.proposalId)) errors.push(`${path}.proposalId must be unique`);
    else proposalIds.add(beat.proposalId);
    if (!DIRECTOR_ARTIFACT_KINDS.includes(beat.kind)) {
      errors.push(`${path}.kind is invalid`);
      continue;
    }
    for (const key of ['duration', 'durationSec', 'dwell', 'dwellSec', 'channel', 'exitAtWide', 'exitAtNarrow']) {
      if (Object.hasOwn(beat, key) || (isObject(beat.data) && Object.hasOwn(beat.data, key))) {
        errors.push(`${path}.${key} is house-owned and must not be model-authored`);
      }
    }
    counts[beat.kind] += 1;
    if (counts[beat.kind] > directorKindCeiling(beat.kind, budget)) {
      errors.push(`${path} exceeds ${beat.kind} safety ceiling`);
    }
    if (!finite(beat.at)) {
      errors.push(`${path}.at must be finite`);
      continue;
    }
    const at = Number(beat.at);
    if (at < priorAt) errors.push('beats must be ordered by at');
    priorAt = at;
    if (at < 0 || at > duration || (!allowEndBoundary && at >= duration)) {
      errors.push(`${path}.at must leave a non-zero visible interval inside the clip`);
    }
    if (!TIMING_SOURCES.has(beat.timingSource)) errors.push(`${path}.timingSource is invalid`);
    if (beat.timingSource === 'cue' && (typeof beat.cue !== 'string' || !beat.cue.trim())) {
      errors.push(`${path}.cue is required for cue timing`);
    } else if (!legacyMigration && beat.timingSource === 'cue'
      && (beat.cue.trim().length < BEAT_CUE_MIN_CHARS || beat.cue.trim().length > BEAT_CUE_MAX_CHARS)) {
      errors.push(`${path}.cue must be ${BEAT_CUE_MIN_CHARS}-${BEAT_CUE_MAX_CHARS} characters`);
    } else if (beat.cue != null && (typeof beat.cue !== 'string' || !beat.cue.trim())) {
      errors.push(`${path}.cue must be non-empty or null`);
    }
    if (!legacyMigration && beat.timingSource !== 'cue') {
      errors.push(`${path} live beats must preserve verified cue timing`);
    }
    const scene = sceneById.get(beat.sceneId);
    const window = sceneWindows.get(beat.sceneId);
    if (!scene) errors.push(`${path}.sceneId does not name a structural scene`);
    else if (at < window.start || at > window.end || (window.halfOpen && at >= window.end)) errors.push(`${path}.at is outside its scene`);
    if ((beat.kind === 'group' || beat.kind === 'footnote') && !scene?.verses?.length) {
      errors.push(`${path} requires a passage scene owner`);
    }
    if (!isObject(beat.data)) errors.push(`${path}.data must be an object`);
    else validateBeatData(beat.kind, beat.data, `${path}.data`, errors);
    const displayedPassage = Array.isArray(scene?.verses)
      ? scene.verses.map((verse) => String(verse?.text || '')).join(' ')
      : '';
    if (beat.kind === 'group' && Array.isArray(beat.data?.words) && Array.isArray(beat.data?.occurrences)) {
      beat.data.words.forEach((word, wordIndex) => {
        const occurrence = beat.data.occurrences[wordIndex];
        if (typeof word === 'string' && Number.isInteger(occurrence)
          && !findScriptureOccurrence(displayedPassage, word, occurrence)) {
          errors.push(`${path}.data.words[${wordIndex}] does not exist at its displayed Scripture coordinate`);
        }
      });
    }
    if (beat.kind === 'footnote' && typeof beat.data?.word === 'string'
      && Number.isInteger(beat.data?.occurrence)
      && !findScriptureOccurrence(displayedPassage, beat.data.word, beat.data.occurrence)) {
      errors.push(`${path}.data.word does not exist at its displayed Scripture coordinate`);
    }
    if (beat.kind !== 'group' && Object.hasOwn(beat.data || {}, 'wordTimes')) {
      errors.push(`${path}.data.wordTimes is allowed only for a group`);
    }
    for (const [wordIndex, wordTime] of (Array.isArray(beat.data?.wordTimes) ? beat.data.wordTimes : []).entries()) {
      const wordPath = `${path}.data.wordTimes[${wordIndex}]`;
      if (!isObject(wordTime) || typeof wordTime.word !== 'string' || !wordTime.word.trim()) errors.push(`${wordPath}.word is required`);
      if (!finite(wordTime?.at)) errors.push(`${wordPath}.at must be finite`);
      else if (window && (Number(wordTime.at) < window.start || Number(wordTime.at) > window.end
        || (window.halfOpen && Number(wordTime.at) >= window.end))) errors.push(`${wordPath}.at is outside its scene`);
      else if (beat.kind === 'group' && Number(wordTime.at) > at) {
        errors.push(`${wordPath}.at must not follow its group entrance`);
      }
      if (wordTime?.timingSource !== 'word') errors.push(`${wordPath} is not word-verified`);
      if (!Number.isInteger(wordTime?.occurrence) || wordTime.occurrence < 0) errors.push(`${wordPath}.occurrence must be zero-based`);
      if (beat.kind === 'group' && Array.isArray(beat.data.words)) {
        const groupWordIndex = beat.data.words.findIndex((word) => String(word).toLowerCase() === String(wordTime?.word).toLowerCase());
        if (groupWordIndex < 0) errors.push(`${wordPath}.word must belong to its group`);
        else if (Array.isArray(beat.data.occurrences) && beat.data.occurrences[groupWordIndex] !== wordTime.occurrence) {
          errors.push(`${wordPath}.occurrence must match the displayed-word coordinate`);
        }
      }
    }
    if (beat.kind === 'aside') {
      if (asideTimes.some((other) => Math.abs(other - at) < DIRECTOR_LIMITS.asideCooldownSec)) {
        errors.push('asides must respect the aside-to-aside cooldown');
      }
      asideTimes.push(at);
    }
  }
  const validBeats = beats.filter(isObject).filter((beat) => finite(beat.at));
  for (let index = 0; index < validBeats.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < validBeats.length; otherIndex += 1) {
      const a = validBeats[index];
      const b = validBeats[otherIndex];
      if (a.kind === 'aside' || b.kind === 'aside') continue;
      if (enforceHouseSpacing && (a.timingSource === 'house' || b.timingSource === 'house')
        && Math.abs(Number(a.at) - Number(b.at)) < DIRECTOR_LIMITS.fieldMinGapSec) {
        errors.push('house thought entrances must respect the field spacing floor');
      }
    }
  }
  return beats.length;
}

function validateBudget(budget, clip, errors, { legacyMigration = false } = {}) {
  if (!isObject(budget)) {
    errors.push('budget is required');
    return;
  }
  const expected = computeDirectorMovementBudget({
    durationSec: clip?.durationSec,
    sustainedTeachingSec: clip?.sustainedTeachingSec,
  });
  for (const key of ['durationSec', 'sustainedTeachingSec', 'targetThoughtEntrances', 'fillGapSec']) {
    if (Number(budget[key]) !== Number(expected[key])) errors.push(`budget.${key} does not match policy`);
  }
  if (legacyMigration) {
    if (budget.basis !== 'legacy-survivor-preservation') errors.push('migrated budget basis is invalid');
    for (const [key, ceiling] of [
      ['hardBeatCeiling', LEGACY_V1_LIMITS.maxBeats],
      ['modelSceneCeiling', DIRECTOR_LIMITS.maxScenes],
    ]) {
      if (!Number.isInteger(Number(budget[key])) || Number(budget[key]) < Number(expected[key])
        || Number(budget[key]) > ceiling) {
        errors.push(`budget.${key} is outside the legacy preservation envelope`);
      }
    }
    if (!Number.isInteger(Number(budget.houseSceneReserve)) || Number(budget.houseSceneReserve) < 0
      || Number(budget.houseSceneReserve) > LEGACY_V1_LIMITS.maxScenes) {
      errors.push('budget.houseSceneReserve is outside the legacy preservation envelope');
    }
    if (!Number.isInteger(Number(budget.finalSceneCeiling))
      || Number(budget.finalSceneCeiling) !== Number(budget.modelSceneCeiling) + Number(budget.houseSceneReserve)
      || Number(budget.finalSceneCeiling) > DIRECTOR_LIMITS.maxScenes + LEGACY_V1_LIMITS.maxScenes) {
      errors.push('budget.finalSceneCeiling is outside the legacy preservation envelope');
    }
    if (!Number.isInteger(Number(budget.highlightCeiling))
      || Number(budget.highlightCeiling) < Number(expected.highlightCeiling)
      || Number(budget.highlightCeiling) > Math.min(DIRECTOR_LIMITS.maxByKind.highlight, Number(budget.hardBeatCeiling))) {
      errors.push('budget.highlightCeiling is outside the legacy preservation envelope');
    }
  } else {
    for (const key of ['hardBeatCeiling', 'highlightCeiling', 'modelSceneCeiling', 'houseSceneReserve', 'finalSceneCeiling']) {
      if (Number(budget[key]) !== Number(expected[key])) errors.push(`budget.${key} does not match policy`);
    }
  }
  if (budget.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) errors.push('budget.policyVersion is invalid');
}

function validateOutcomeLedger(outcomes, scenes, beats, durationSec, errors) {
  if (!isObject(outcomes)) {
    errors.push('metrics.outcomes is required');
    return;
  }
  if (!['complete', 'legacy-survivors-only'].includes(outcomes.completeness)) {
    errors.push('metrics.outcomes.completeness is invalid');
  }
  const legacy = outcomes.completeness === 'legacy-survivors-only';
  for (const key of ['proposed', 'rejected', 'accepted', 'focusMasked', 'superseded', 'projectedVisible']) {
    if (legacy && ['proposed', 'rejected'].includes(key) && outcomes[key] == null) continue;
    if (!Array.isArray(outcomes[key])) errors.push(`metrics.outcomes.${key} must be an array`);
  }
  if (Array.isArray(outcomes.accepted) && outcomes.accepted.length !== beats.length) {
    errors.push('metrics.outcomes.accepted must contain every final beat');
  }
  const beatById = new Map(beats.filter(isObject).map((beat) => [beat.id, beat]));
  const beatIds = new Set(beatById.keys());
  const acceptedProposalIds = new Set();
  const acceptedBeatByProposal = new Map();
  if (Array.isArray(outcomes.accepted)) {
    const acceptedIds = new Set();
    for (const entry of outcomes.accepted) {
      if (!isObject(entry) || typeof entry.beatId !== 'string' || !beatIds.has(entry.beatId)
        || typeof entry.proposalId !== 'string' || !DIRECTOR_ARTIFACT_KINDS.includes(entry.kind)
        || typeof entry.sceneId !== 'string') {
        errors.push('metrics.outcomes.accepted entries must identify their final beat, proposal, kind, and scene');
        continue;
      }
      const beat = beatById.get(entry.beatId);
      if (entry.proposalId !== beat.proposalId || entry.kind !== beat.kind || entry.sceneId !== beat.sceneId) {
        errors.push(`metrics.outcomes.accepted entry ${entry.beatId} does not reconcile its final beat`);
      }
      acceptedIds.add(entry.beatId);
      acceptedProposalIds.add(entry.proposalId);
      acceptedBeatByProposal.set(entry.proposalId, beat);
    }
    if (acceptedIds.size !== beats.length) errors.push('metrics.outcomes.accepted must identify each final beat exactly once');
  }
  const proposedIds = new Set();
  const proposedById = new Map();
  for (const entry of (Array.isArray(outcomes.proposed) ? outcomes.proposed : [])) {
    if (!isObject(entry) || typeof entry.proposalId !== 'string'
      || !['initial', 'fill'].includes(entry.pass)
      || ![...DIRECTOR_ARTIFACT_KINDS, 'unknown'].includes(entry.kind)) {
      errors.push('metrics.outcomes.proposed entries require proposalId, pass, and kind');
    } else if (proposedIds.has(entry.proposalId)) {
      errors.push('metrics.outcomes.proposed proposalId values must be unique');
    } else {
      proposedIds.add(entry.proposalId);
      proposedById.set(entry.proposalId, entry);
    }
  }
  const rejectedProposalIds = new Set();
  for (const entry of (Array.isArray(outcomes.rejected) ? outcomes.rejected : [])) {
    if (!isObject(entry) || typeof entry.proposalId !== 'string'
      || !['initial', 'fill'].includes(entry.pass)
      || ![...DIRECTOR_ARTIFACT_KINDS, 'unknown'].includes(entry.kind)
      || typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push('metrics.outcomes.rejected entries require proposalId, pass, kind, and precise reason');
    } else if (rejectedProposalIds.has(entry.proposalId)) {
      errors.push('metrics.outcomes.rejected proposalId values must be unique');
    } else {
      rejectedProposalIds.add(entry.proposalId);
      const proposal = proposedById.get(entry.proposalId);
      if (!legacy && proposal && (proposal.pass !== entry.pass || proposal.kind !== entry.kind)) {
        errors.push(`metrics.outcomes.rejected entry ${entry.proposalId} contradicts its proposed record`);
      }
    }
  }
  if (!legacy) {
    for (const proposalId of proposedIds) {
      const dispositions = Number(acceptedProposalIds.has(proposalId)) + Number(rejectedProposalIds.has(proposalId));
      if (dispositions !== 1) errors.push(`proposal ${proposalId} must end exactly once as accepted or rejected`);
      const proposedEntry = proposedById.get(proposalId);
      const acceptedBeat = acceptedBeatByProposal.get(proposalId);
      if (acceptedBeat && proposedEntry?.kind !== acceptedBeat.kind) {
        errors.push(`accepted proposal ${proposalId} contradicts its proposed kind`);
      }
    }
    for (const proposalId of [...acceptedProposalIds, ...rejectedProposalIds]) {
      if (!proposedIds.has(proposalId)) errors.push(`disposition ${proposalId} has no proposed record`);
    }
  }
  const expectedProjection = summarizeVisualProjection({ scenes, beats }, durationSec);
  for (const [key, expected] of Object.entries(expectedProjection)) {
    const observed = Array.isArray(outcomes[key]) ? outcomes[key] : [];
    if (!contractEqual(observed, expected)) {
      errors.push(`metrics.outcomes.${key} must exactly match the house projection`);
    }
  }
}

export function validateDirectorPayload(payload) {
  const errors = [];
  if (!isObject(payload)) return { ok: false, errors: ['director payload must be an object'] };
  const legacyMigration = isObject(payload.migration) && payload.migration.fromSchemaVersion === 1;
  if (payload.migration != null && !legacyMigration) errors.push('migration metadata is invalid');
  if (payload.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    errors.push(
      payload.schemaVersion > MAGIC_DIRECTOR_SCHEMA_VERSION
        ? `director schema ${payload.schemaVersion} is newer than supported ${MAGIC_DIRECTOR_SCHEMA_VERSION}`
        : `director schema ${String(payload.schemaVersion)} is not supported`
    );
  }
  if (payload.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    errors.push(`director policy ${String(payload.policyVersion)} is not supported`);
  }
  if (typeof payload.requestKey !== 'string' || !payload.requestKey.trim()) errors.push('requestKey is required');
  if (!isObject(payload.clip)
    || !finite(payload.clip.fromSec) || !finite(payload.clip.toSec) || !finite(payload.clip.durationSec)
    || !finite(payload.clip.sustainedTeachingSec)
    || Number(payload.clip.fromSec) < 0 || Number(payload.clip.toSec) <= Number(payload.clip.fromSec)
    || tenth(Number(payload.clip.durationSec)) !== tenth(Number(payload.clip.toSec) - Number(payload.clip.fromSec))
    || Number(payload.clip.sustainedTeachingSec) < 0
    || Number(payload.clip.sustainedTeachingSec) > Number(payload.clip.durationSec)
    || !/^[0-9a-f]{16,64}$/i.test(String(payload.clip.transcriptHash || ''))) {
    errors.push('clip must carry finite, increasing, internally consistent bounds');
  }
  if (legacyMigration) {
    const original = parseLegacyDirectorCacheKey(payload.migration.originalRequestKey);
    const fingerprintParts = String(payload.requestFingerprint || '').split('|');
    const originalIdentityMatches = Boolean(original) && fingerprintParts.length === 7
      && original.recordId === fingerprintParts[3]
      && original.fromSec === tenth(Number(fingerprintParts[4]))
      && original.toSec === tenth(Number(fingerprintParts[5]))
      && original.whyHash === fingerprintParts[6]?.toLowerCase();
    if (payload.clip?.transcriptHashSource !== 'legacy-direction-snapshot'
      || payload.metrics?.outcomes?.completeness !== 'legacy-survivors-only'
      || payload.migration.limitation !== 'proposal and rejection outcomes were not recorded by v1'
      || !originalIdentityMatches) {
      errors.push('legacy migration must disclose its synthetic transcript identity and incomplete outcomes');
    }
  }
  validateDirectorIdentity(payload, errors);
  validateBudget(payload.budget, payload.clip, errors, { legacyMigration });
  let beatCount = null;
  if (!Array.isArray(payload.scenes)) errors.push('scenes must be an array');
  else if (isObject(payload.clip) && finite(payload.clip.durationSec)) {
    validateStructuralScenes(payload.scenes, payload.clip, payload.budget, errors, {
      allowEndBoundary: legacyMigration,
      enforceHouseSpacing: !legacyMigration,
      legacyMigration,
    });
  }
  if (!Array.isArray(payload.beats)) errors.push('beats must be an array');
  else if (Array.isArray(payload.scenes) && isObject(payload.clip) && finite(payload.clip.durationSec)) {
    beatCount = validateBeatTimeline(payload.beats, payload.scenes, payload.clip, payload.budget, errors, {
      allowEndBoundary: legacyMigration,
      legacyMigration,
      enforceHouseSpacing: !legacyMigration,
    });
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
    const normalization = payload.metrics.normalization;
    if (!isObject(normalization)
      || normalization.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION
      || normalization.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION
      || !Array.isArray(normalization.dropped)
      || Number(normalization.sceneCount) !== (Array.isArray(payload.scenes) ? payload.scenes.length : -1)
      || Number(normalization.beatCount) !== beatCount
      || Number(normalization.artifactCount) !== beatCount
      || !['shifted', 'clamped', 'invented', 'reassigned', 'preludes'].every((key) => (
        finite(normalization[key]) && Number(normalization[key]) >= 0
      ))) {
      errors.push('metrics.normalization must report dropped items and final counts');
    }
    if (isObject(normalization) && Array.isArray(payload.scenes) && Array.isArray(payload.beats)
      && isObject(payload.clip) && finite(payload.clip.durationSec)) {
      const duration = Number(payload.clip.durationSec);
      const expectedProjection = summarizeVisualProjection({ scenes: payload.scenes, beats: payload.beats }, duration);
      const projectedVisibleIds = new Set(expectedProjection.projectedVisible.map((entry) => entry.beatId));
      const expectedThoughtCadence = measureThoughtCadence(payload.beats, duration, {
        excludedBeatIds: payload.beats.filter(isObject)
          .filter((beat) => !projectedVisibleIds.has(beat.id)).map((beat) => beat.id),
      });
      const expectedVisualCadence = measureVisualCadence(payload.beats, duration, {
        excludedBeatIds: payload.beats.filter(isObject)
          .filter((beat) => !projectedVisibleIds.has(beat.id)).map((beat) => beat.id),
      });
      const expectedArtifactCounts = measureThoughtCadence(payload.beats, duration).artifactCounts;
      if (!contractEqual(normalization.artifactCounts, expectedArtifactCounts)) {
        errors.push('metrics.normalization.artifactCounts must exactly reconcile final beats');
      }
      if (!contractEqual(normalization.sceneCadence, measureSceneCadence(payload.scenes, duration))) {
        errors.push('metrics.normalization.sceneCadence must exactly reconcile final scenes');
      }
      if (!contractEqual(normalization.thoughtCadence, expectedThoughtCadence)) {
        errors.push('metrics.normalization.thoughtCadence must exactly reconcile projected visible beats');
      }
      if (!contractEqual(normalization.visualCadence, expectedVisualCadence)) {
        errors.push('metrics.normalization.visualCadence must exactly reconcile every projected visual entrance');
      }
      if (!contractEqual(normalization.projection, expectedProjection)) {
        errors.push('metrics.normalization.projection must exactly reconcile the house projection');
      }
    }
    validateOutcomeLedger(
      payload.metrics.outcomes,
      Array.isArray(payload.scenes) ? payload.scenes : [],
      Array.isArray(payload.beats) ? payload.beats : [],
      Number(payload.clip?.durationSec) || 0,
      errors,
    );
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

function legacyDirectorCacheKey({
  modelKey = MAGIC_MODEL_ROLES.director,
  recordId,
  fromSec,
  toSec,
  why = '',
}) {
  const from = Math.max(0, tenth(Number(fromSec) || 0));
  const to = Math.max(from, tenth(Number(toSec) || from));
  return [1, modelKey, String(recordId || ''), from, to, stableTextHash(String(why).trim())].join('|');
}

function parseLegacyDirectorCacheKey(value) {
  const parts = String(value || '').split('|');
  if (parts.length < 6 || parts[0] !== '1' || parts[1] !== MAGIC_MODEL_KEY) return null;
  const whyHash = parts.at(-1);
  const toSec = parts.at(-2);
  const fromSec = parts.at(-3);
  const recordId = parts.slice(2, -3).join('|');
  if (!recordId || !finite(fromSec) || !finite(toSec)
    || Number(toSec) < Number(fromSec) || !/^[0-9a-f]{16}$/i.test(whyHash || '')) return null;
  return {
    recordId,
    fromSec: tenth(Number(fromSec)),
    toSec: tenth(Number(toSec)),
    whyHash: whyHash.toLowerCase(),
  };
}

function migratedLegacyIdentity(payload, transcriptHash) {
  const parsed = parseLegacyDirectorCacheKey(payload?.requestKey);
  if (!parsed) throw new Error('legacy director requestKey cannot be deterministically migrated');
  const { recordId, whyHash } = parsed;
  if (recordId.includes('|')) {
    throw new Error('legacy director recordId contains an unsupported identity delimiter');
  }
  const from = tenth(Number(payload?.clip?.fromSec) || 0);
  const to = tenth(Number(payload?.clip?.toSec) || from);
  if (parsed.fromSec !== from || parsed.toSec !== to) {
    throw new Error('legacy director requestKey contradicts clip bounds');
  }
  const fingerprintParts = [
    MAGIC_DIRECTOR_SCHEMA_VERSION,
    MAGIC_DIRECTOR_POLICY_VERSION,
    MAGIC_MODEL_KEY,
    recordId,
    from,
    to,
    whyHash,
  ];
  return {
    requestFingerprint: fingerprintParts.join('|'),
    requestKey: [...fingerprintParts.slice(0, 6), transcriptHash, fingerprintParts[6]].join('|'),
  };
}

function acceptedOutcomes(beats) {
  return beats.map((beat) => ({
    proposalId: beat.proposalId,
    beatId: beat.id,
    kind: beat.kind,
    sceneId: beat.sceneId,
  }));
}

export function upgradeDirectorPayload(payload) {
  if (!isObject(payload)) throw new Error('director payload must be an object');
  if (payload.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION) {
    if (payload.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION) {
      throw new Error(
        `director policy ${MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION} is preserved historical calibration evidence and is not upgraded to ${MAGIC_DIRECTOR_POLICY_VERSION}`,
      );
    }
    const check = validateDirectorPayload(payload);
    if (!check.ok) throw new Error(`invalid director payload: ${check.errors.join('; ')}`);
    return clonePlain(payload);
  }
  if (Number(payload.schemaVersion) > MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throw new Error(`director schema ${payload.schemaVersion} is newer than supported ${MAGIC_DIRECTOR_SCHEMA_VERSION}`);
  }
  if (payload.schemaVersion !== 1) throw new Error(`director schema ${String(payload.schemaVersion)} is not supported`);
  if (!isObject(payload.clip) || !finite(payload.clip.durationSec) || !Array.isArray(payload.scenes)) {
    throw new Error('legacy director payload is incomplete');
  }

  // V1 readers tolerated malformed collection members by omission. A durable
  // migration may not silently turn missing evidence into a smaller valid
  // result, so refuse those shapes with a stable, index-bearing explanation.
  for (const [sceneIndex, scene] of payload.scenes.entries()) {
    if (!isObject(scene)) throw new Error(`legacy director scene ${sceneIndex} cannot be migrated without loss`);
    for (const key of ['groups', 'footnotes', 'terms', 'allusions', 'asides']) {
      if (scene[key] != null && !Array.isArray(scene[key])) {
        throw new Error(`legacy director scene ${sceneIndex}.${key} is not an array`);
      }
      for (const [artifactIndex, artifact] of (Array.isArray(scene[key]) ? scene[key] : []).entries()) {
        if (!isObject(artifact)) {
          throw new Error(`legacy director scene ${sceneIndex}.${key}[${artifactIndex}] cannot be migrated without loss`);
        }
      }
    }
    for (const key of ['compare', 'chain', 'caveat', 'highlight']) {
      if (scene[key] != null && !isObject(scene[key])) {
        throw new Error(`legacy director scene ${sceneIndex}.${key} cannot be migrated without loss`);
      }
    }
  }

  const durationSec = Number(payload.clip.durationSec);
  const policyBudget = computeDirectorMovementBudget({ durationSec, sustainedTeachingSec: durationSec });
  const legacyPlan = legacyScenesToPlan(payload.scenes);
  const scenes = legacyPlan.scenes
    .map((scene) => {
      const source = timingSourceOf(scene);
      const anchoredSource = source === 'word' ? 'cue' : source;
      const timingSource = anchoredSource === 'cue' && (typeof scene.cue !== 'string' || !scene.cue.trim())
        ? 'house'
        : anchoredSource;
      return { ...scene, at: Number(scene.at), timingSource };
    })
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const beats = legacyPlan.beats
    .map((beat) => {
      const at = Number(beat.at);
      const data = clonePlain(beat.data);
      if (beat.kind === 'group' && Array.isArray(data.wordTimes)) {
        // v1 stored some verified word timestamps after the group entrance,
        // but its renderer never scheduled them. Removing those inert records
        // preserves the actual replay while satisfying the explicit v2 rule.
        data.wordTimes = data.wordTimes.filter((wordTime) => finite(wordTime?.at) && Number(wordTime.at) <= at);
      } else if (Object.hasOwn(data, 'wordTimes')) {
        delete data.wordTimes;
      }
      const source = timingSourceOf(beat);
      const timingSource = source === 'cue' && (typeof beat.cue !== 'string' || !beat.cue.trim())
        ? 'house'
        : source;
      return { ...beat, data, at, timingSource };
    })
    .sort((a, b) => a.at - b.at || (BEAT_PRIORITY[a.kind] ?? 99) - (BEAT_PRIORITY[b.kind] ?? 99)
      || a.id.localeCompare(b.id));
  const modelSceneCount = scenes.filter((scene) => scene.origin === 'model').length;
  const houseSceneCount = scenes.filter((scene) => scene.origin === 'house-prelude').length;
  const highlightCount = beats.filter((beat) => beat.kind === 'highlight').length;
  const budget = {
    ...policyBudget,
    basis: 'legacy-survivor-preservation',
    hardBeatCeiling: Math.max(policyBudget.hardBeatCeiling, beats.length),
    highlightCeiling: Math.max(policyBudget.highlightCeiling, highlightCount),
    modelSceneCeiling: Math.max(policyBudget.modelSceneCeiling, modelSceneCount),
    houseSceneReserve: houseSceneCount,
    finalSceneCeiling: Math.max(policyBudget.modelSceneCeiling, modelSceneCount) + houseSceneCount,
  };
  const projection = summarizeVisualProjection({ scenes, beats }, durationSec);
  const priorNormalization = isObject(payload.metrics?.normalization) ? payload.metrics.normalization : {};
  const priorCounter = (key) => finite(priorNormalization[key]) && Number(priorNormalization[key]) >= 0
    ? Number(priorNormalization[key])
    : 0;
  const legacyReport = {
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    dropped: [],
    shifted: priorCounter('shifted'),
    clamped: priorCounter('clamped'),
    invented: priorCounter('invented'),
    reassigned: 0,
    preludes: scenes.filter((scene) => scene.origin === 'house-prelude').length,
    sceneCount: scenes.length,
    beatCount: beats.length,
    artifactCount: beats.length,
    artifactCounts: measureThoughtCadence(beats, durationSec).artifactCounts,
    sceneCadence: measureSceneCadence(scenes, durationSec),
    thoughtCadence: measureThoughtCadence(beats, durationSec, {
      excludedBeatIds: beats
        .filter((beat) => !projection.projectedVisible.some((entry) => entry.beatId === beat.id))
        .map((beat) => beat.id),
    }),
    visualCadence: measureVisualCadence(beats, durationSec, {
      excludedBeatIds: beats
        .filter((beat) => !projection.projectedVisible.some((entry) => entry.beatId === beat.id))
        .map((beat) => beat.id),
    }),
    projection,
  };
  const transcriptHash = stableTextHash(
    `legacy-direction|${payload.requestKey || ''}|${JSON.stringify(canonicalContractValue(payload.scenes))}`,
  );
  const migratedIdentity = migratedLegacyIdentity(payload, transcriptHash);
  const metrics = isObject(payload.metrics) ? clonePlain(payload.metrics) : {};
  const calls = Array.isArray(metrics.calls) ? metrics.calls : [];
  const legacyDropped = Array.isArray(metrics.normalization?.dropped) ? metrics.normalization.dropped : [];
  const upgraded = {
    ...clonePlain(payload),
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    ...migratedIdentity,
    clip: {
      ...clonePlain(payload.clip),
      transcriptHash,
      transcriptHashSource: 'legacy-direction-snapshot',
      sustainedTeachingSec: durationSec,
    },
    budget,
    scenes,
    beats,
    metrics: {
      ...metrics,
      passes: Number.isInteger(Number(metrics.passes)) ? Number(metrics.passes) : calls.length,
      calls,
      normalization: {
        ...legacyReport,
        // Preserve order and multiplicity: duplicate historical drops are
        // separate observations, not redundant data.
        dropped: clonePlain(legacyDropped),
      },
      outcomes: {
        completeness: 'legacy-survivors-only',
        proposed: null,
        rejected: null,
        accepted: acceptedOutcomes(beats),
        focusMasked: projection.focusMasked,
        superseded: projection.superseded,
        projectedVisible: projection.projectedVisible,
      },
    },
    migration: {
      fromSchemaVersion: 1,
      originalRequestKey: payload.requestKey || null,
      limitation: 'proposal and rejection outcomes were not recorded by v1',
      normalizationEvidencePreserved: true,
    },
  };
  const check = validateDirectorPayload(upgraded);
  if (!check.ok) throw new Error(`legacy director upgrade failed: ${check.errors.join('; ')}`);
  return upgraded;
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
  if (input.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    errors.push(`replay policy ${String(input.policyVersion)} is not supported`);
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
    const stepIds = new Set();
    input.tour.steps.forEach((step, index) => {
      if (!isObject(step) || typeof step.recordId !== 'string' || !step.recordId) errors.push(`tour.steps[${index}].recordId is required`);
      if (typeof step?.id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(step.id)) errors.push(`tour.steps[${index}].id is invalid`);
      else if (stepIds.has(step.id)) errors.push(`tour.steps[${index}].id must be unique`);
      else stepIds.add(step.id);
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
  if (!isObject(input.directions)) errors.push('directions must be an object keyed by tour step id');
  if (isObject(input.directions)) {
    if (Array.isArray(input.tour?.steps) && Object.keys(input.directions).length !== input.tour.steps.length) {
      errors.push('directions must contain exactly one entry per tour step');
    }
    const directionByFingerprint = new Map();
    for (const [key, payload] of Object.entries(input.directions)) {
      const check = validateDirectorPayload(payload);
      if (!check.ok) errors.push(...check.errors.map((error) => `directions[${key}]: ${error}`));
      const fingerprint = payload?.requestFingerprint;
      if (typeof fingerprint === 'string' && fingerprint) {
        const prior = directionByFingerprint.get(fingerprint);
        if (prior && !contractEqual(prior.payload, payload)) {
          errors.push(
            `directions[${key}] conflicts with directions[${prior.key}] for the same requestFingerprint`,
          );
        } else if (!prior) {
          directionByFingerprint.set(fingerprint, { key, payload });
        }
      }
    }
    for (const [index, step] of (Array.isArray(input.tour?.steps) ? input.tour.steps : []).entries()) {
      const key = step?.id;
      if (!Object.hasOwn(input.directions, key)) {
        errors.push(`directions is missing tour step ${index}`);
      } else {
        const payload = input.directions[key];
        const from = Number(step.startSec);
        const to = Number(step.endSec);
        if (Number(payload?.clip?.fromSec) !== from || Number(payload?.clip?.toSec) !== to) {
          errors.push(`directions for tour step ${index} has different clip bounds`);
        }
        try {
          const expectedFingerprint = directorRequestFingerprint({
            schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
            policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
            modelKey: MAGIC_MODEL_KEY,
            recordId: step.recordId,
            fromSec: from,
            toSec: to,
            why: step.why,
          });
          if (payload?.requestFingerprint !== expectedFingerprint) {
            errors.push(`directions for tour step ${index} has different record or why identity`);
          }
        } catch {
          errors.push(`directions for tour step ${index} has invalid request identity`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function upgradeReplayFixture(input) {
  if (!isObject(input)) throw new Error('replay fixture must be an object');
  if (input.schemaVersion === MAGIC_REPLAY_SCHEMA_VERSION) {
    if (input.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION) {
      throw new Error(
        `replay policy ${MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION} is superseded by ${MAGIC_DIRECTOR_POLICY_VERSION}; regenerate the local fixture without rewriting evidence`,
      );
    }
    const check = validateReplayFixture(input);
    if (!check.ok) throw new Error(`invalid replay fixture: ${check.errors.join('; ')}`);
    return clonePlain(input);
  }
  if (Number(input.schemaVersion) > MAGIC_REPLAY_SCHEMA_VERSION) {
    throw new Error(`replay schema ${input.schemaVersion} is newer than supported ${MAGIC_REPLAY_SCHEMA_VERSION}`);
  }
  if (input.schemaVersion !== 1) throw new Error(`replay schema ${String(input.schemaVersion)} is not supported`);
  if (!isObject(input.tour) || !Array.isArray(input.tour.steps) || !isObject(input.directions)) {
    throw new Error('legacy replay fixture is incomplete');
  }
  if (Object.keys(input.directions).length !== input.tour.steps.length) {
    throw new Error('legacy replay directions must map one-to-one to tour steps');
  }
  const directions = {};
  const usedStepIds = new Set();
  const usedDirectionKeys = new Set();
  const steps = input.tour.steps.map((rawStep, index) => {
    const step = clonePlain(rawStep);
    let id = /^[a-z0-9][a-z0-9-]{1,63}$/.test(String(step.id || '')) ? step.id : `step-${index + 1}`;
    if (usedStepIds.has(id)) id = `step-${index + 1}`;
    while (usedStepIds.has(id)) id = `${id}-x`;
    usedStepIds.add(id);
    const oldKey = legacyDirectorCacheKey({
      modelKey: MAGIC_MODEL_ROLES.director,
      recordId: step.recordId,
      fromSec: step.startSec,
      toSec: step.endSec,
      why: step.why,
    });
    const matchingEntries = Object.entries(input.directions).filter(([key, direction]) => (
      !usedDirectionKeys.has(key)
      && (key === oldKey || direction?.requestKey === oldKey)
    ));
    if (matchingEntries.length !== 1) {
      throw new Error(`legacy replay direction ${index} does not have one deterministic identity match`);
    }
    const [directionKey, legacyDirection] = matchingEntries[0];
    usedDirectionKeys.add(directionKey);
    const direction = upgradeDirectorPayload(legacyDirection);
    const requestIdentity = {
      schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
      policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
      modelKey: MAGIC_MODEL_KEY,
      recordId: step.recordId,
      fromSec: step.startSec,
      toSec: step.endSec,
      why: step.why,
    };
    directions[id] = {
      ...direction,
      requestFingerprint: directorRequestFingerprint(requestIdentity),
      requestKey: directorCacheKey({ ...requestIdentity, transcriptHash: direction.clip.transcriptHash }),
    };
    return { ...step, id };
  });
  if (usedDirectionKeys.size !== Object.keys(input.directions).length) {
    throw new Error('legacy replay contains an unmatched direction');
  }
  const upgraded = {
    ...clonePlain(input),
    schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
    tour: { ...clonePlain(input.tour), steps },
    directions,
    migration: { fromSchemaVersion: 1, directionKeying: 'tour-step-id' },
  };
  const check = validateReplayFixture(upgraded);
  if (!check.ok) throw new Error(`legacy replay upgrade failed: ${check.errors.join('; ')}`);
  return upgraded;
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
