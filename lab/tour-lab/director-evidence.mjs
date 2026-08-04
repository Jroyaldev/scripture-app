// Append-only evidence and replay storage for /magic director runs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAGIC_DIRECTOR_POLICY_VERSION,
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION,
  computeDirectorMovementBudget,
  redactEvidence,
  stableTextHash,
  upgradeDirectorPayload,
  upgradeReplayFixture,
  validateDirectorPayload,
  validateMagicRoleEvidence,
  validateReplayFixture,
} from './magic-contract.mjs';
import { resolveDirectorPassageReference } from './scripture.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DIRECTOR_RUNS_DIR = path.join(LAB_DIR, 'director-runs');
export const ROLE_RUNS_DIR = path.join(LAB_DIR, 'role-runs');
export const REPLAYS_DIR = path.join(LAB_DIR, 'replays');

const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

function safeJsonFile(dir, name) {
  const clean = String(name || '');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.json$/.test(clean) || clean === '..' || clean.includes('..\/')) return null;
  const root = path.resolve(dir);
  const file = path.resolve(root, clean);
  if (path.dirname(file) !== root || !fs.existsSync(file)) return null;
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) return null;
  } catch {
    return null;
  }
  return file;
}

class EvidenceReadError extends Error {
  constructor(code, message, errors = [message]) {
    super(message);
    this.code = code;
    this.errors = errors;
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const finite = (value) => (
  (typeof value === 'number' || (typeof value === 'string' && value.trim() !== ''))
  && Number.isFinite(Number(value))
);
const tenth = (value) => Math.round(Number(value) * 10) / 10;

function sameJsonValue(left, right) {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => sameJsonValue(value, right[index]));
  }
  if (!isObject(left) || !isObject(right)) return false;
  const leftKeys = Object.keys(left).sort();
  const rightKeys = Object.keys(right).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index]
      && sameJsonValue(left[key], right[key]));
}

function throwEvidence(code, message, errors = [message]) {
  throw new EvidenceReadError(code, message, errors);
}

function assertSupportedEvidenceSchema(schemaVersion, label) {
  if (Number(schemaVersion) > MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throwEvidence(
      'future-schema',
      `${label} schema ${String(schemaVersion)} is newer than supported ${MAGIC_DIRECTOR_SCHEMA_VERSION}`,
    );
  }
  if (schemaVersion !== 1 && schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throwEvidence('unsupported-schema', `${label} schema ${String(schemaVersion)} is not supported`);
  }
}

function canonicalPassageErrors(payload) {
  const errors = [];
  const verify = (snapshot, path, shape) => {
    const ref = snapshot?.ref;
    const resolved = resolveDirectorPassageReference(ref);
    if (!resolved.ok) {
      errors.push(`${path}.ref is not an exact canonical passage: ${resolved.message}`);
      return;
    }
    if (ref !== resolved.value.ref) errors.push(`${path}.ref is not the canonical display reference`);
    if (shape === 'text' && snapshot.text !== resolved.value.text) {
      errors.push(`${path}.text does not match the canonical WEB passage`);
    }
    if (shape === 'verses') {
      const expected = resolved.value.verses.map(({ verse, text }) => ({ verse, text }));
      const observed = Array.isArray(snapshot.verses)
        ? snapshot.verses.map(({ verse, text }) => ({ verse: Number(verse), text }))
        : null;
      if (JSON.stringify(observed) !== JSON.stringify(expected)) {
        errors.push(`${path}.verses do not match the canonical WEB passage`);
      }
    }
  };

  for (const [index, scene] of (Array.isArray(payload?.scenes) ? payload.scenes : []).entries()) {
    const hasRef = typeof scene?.ref === 'string' && Boolean(scene.ref.trim());
    const hasVerses = Array.isArray(scene?.verses) && scene.verses.length > 0;
    if (!hasRef && !hasVerses) continue;
    if (!hasRef || !hasVerses) {
      errors.push(`scenes[${index}] must carry both a canonical ref and its verses`);
      continue;
    }
    verify(scene, `scenes[${index}]`, 'verses');
  }

  for (const [index, beat] of (Array.isArray(payload?.beats) ? payload.beats : []).entries()) {
    const path = `beats[${index}].data`;
    if (beat?.kind === 'allusion') verify(beat.data, path, 'text');
    if (beat?.kind === 'compare') {
      verify(beat.data?.a, `${path}.a`, 'text');
      verify(beat.data?.b, `${path}.b`, 'text');
    }
    if (beat?.kind === 'chain') {
      (Array.isArray(beat.data?.links) ? beat.data.links : []).forEach((link, linkIndex) => {
        verify(link, `${path}.links[${linkIndex}]`, 'text');
      });
    }
  }
  return errors;
}

function assertCanonicalDirectorPayload(payload) {
  const errors = canonicalPassageErrors(payload);
  if (errors.length) throwEvidence('canonical-mismatch', 'director evidence contains a non-canonical passage snapshot', errors);
}

function currentRequestEnvelopeErrors(record, result = null) {
  const errors = [];
  const request = record?.request;
  if (!isObject(request)) return ['request envelope is required'];
  const fingerprint = result?.requestFingerprint || request.requestFingerprint;
  const parts = typeof fingerprint === 'string' ? fingerprint.split('|') : [];
  if (parts.length !== 7 || parts[0] !== String(MAGIC_DIRECTOR_SCHEMA_VERSION)
    || parts[1] !== MAGIC_DIRECTOR_POLICY_VERSION || !parts[2] || !parts[3]
    || !finite(parts[4]) || !finite(parts[5]) || !/^[0-9a-f]{16}$/i.test(String(parts[6] || ''))) {
    return ['request fingerprint is incomplete'];
  }
  if (request.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) errors.push('request schema does not match the evidence envelope');
  if (request.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) errors.push('request policy does not match the evidence envelope');
  if (request.model !== parts[2]) errors.push('request model does not match its fingerprint');
  if (request.recordId !== parts[3]) errors.push('request recordId does not match its fingerprint');
  if (tenth(request.fromSec) !== tenth(parts[4])) errors.push('request start does not match its fingerprint');
  if (tenth(request.toSec) !== tenth(parts[5])) errors.push('request end does not match its fingerprint');
  if (typeof request.why !== 'string'
    || stableTextHash(request.why.slice(0, 800).trim()) !== String(parts[6]).toLowerCase()) {
    errors.push('request why does not match its effective fingerprint input');
  }
  if (!isObject(request.budget)) {
    errors.push('request budget is required');
  } else {
    const expectedBudget = computeDirectorMovementBudget({
      durationSec: Number(request.toSec) - Number(request.fromSec),
      sustainedTeachingSec: request.budget.sustainedTeachingSec,
    });
    if (!sameJsonValue(request.budget, expectedBudget)) {
      errors.push('request budget does not match the current movement policy');
    }
    if (result && !sameJsonValue(request.budget, result.budget)) {
      errors.push('request budget does not match the director result');
    }
  }
  if (request.requestFingerprint !== fingerprint) errors.push('request fingerprint does not match the director result');
  const transcriptHash = String(request.transcriptHash || '').toLowerCase();
  if (!/^[0-9a-f]{16,64}$/.test(transcriptHash)) errors.push('request transcriptHash is invalid');
  const expectedKey = [...parts.slice(0, 6), transcriptHash, parts[6]].join('|');
  if (record.requestKey !== expectedKey) errors.push('outer requestKey does not reconcile the request identity');
  if (result) {
    if (record.requestKey !== result.requestKey) errors.push('outer requestKey does not match the director result');
    if (result.requestFingerprint !== fingerprint) errors.push('result fingerprint does not match the request envelope');
    if (tenth(result.clip?.fromSec) !== tenth(request.fromSec)) errors.push('result clip start does not match the request envelope');
    if (tenth(result.clip?.toSec) !== tenth(request.toSec)) errors.push('result clip end does not match the request envelope');
    if (String(result.clip?.transcriptHash || '').toLowerCase() !== transcriptHash) {
      errors.push('result transcriptHash does not match the request envelope');
    }
  }
  return errors;
}

function legacyEnvelopeAssessment(record) {
  const errors = [];
  let whyIntegrity = 'verified';
  const result = record?.result;
  const request = record?.request;
  const parts = typeof result?.requestKey === 'string' ? result.requestKey.split('|') : [];
  if (record?.schemaVersion !== 1 || result?.schemaVersion !== 1) errors.push('legacy outer and result schemas must both be v1');
  if (record?.requestKey !== result?.requestKey) errors.push('legacy outer requestKey does not match its result');
  if (parts.length !== 6 || parts[0] !== '1' || !parts[1] || !parts[2]
    || !finite(parts[3]) || !finite(parts[4]) || !/^[0-9a-f]{16}$/i.test(String(parts[5] || ''))) {
    errors.push('legacy requestKey is incomplete');
    return { errors, whyIntegrity };
  }
  if (!isObject(request) || request.schemaVersion !== 1) errors.push('legacy request schema must be v1');
  if (!isObject(request) || request.recordId !== parts[2]) errors.push('legacy request recordId does not match its result');
  if (request?.model != null && request.model !== parts[1]) errors.push('legacy request model does not match its result');
  if (request?.fromSec != null && tenth(request.fromSec) !== tenth(parts[3])) errors.push('legacy request start does not match its result');
  if (request?.toSec != null && tenth(request.toSec) !== tenth(parts[4])) errors.push('legacy request end does not match its result');
  if (tenth(result?.clip?.fromSec) !== tenth(parts[3])) errors.push('legacy result clip start does not match its key');
  if (tenth(result?.clip?.toSec) !== tenth(parts[4])) errors.push('legacy result clip end does not match its key');
  const why = request?.why;
  if (typeof why !== 'string' || !why.trim() || why.length > 400) {
    errors.push('legacy request why is invalid');
  } else if (stableTextHash(why.trim()) !== String(parts[5]).toLowerCase()) {
    if (why.length === 400) whyIntegrity = 'unverifiable-truncated-v1';
    else errors.push('legacy request why does not match its requestKey');
  }
  return { errors, whyIntegrity };
}

const shortString = (value, max) => typeof value === 'string'
  && Boolean(value.trim()) && value.trim().length <= max;

function roleResultErrors(record) {
  const errors = [];
  const request = record?.request;
  const result = record?.result;
  const stepCount = Number(request?.stepCount);
  if (!isObject(request) || !Number.isInteger(stepCount) || stepCount < 1 || stepCount > 8) {
    errors.push('role request.stepCount must be an integer from 1 through 8');
  }
  if (!/^[0-9a-f]{16}$/i.test(String(request?.stepsHash || ''))) {
    errors.push('role request.stepsHash must be a stable hash');
  }
  if (!isObject(result)) {
    errors.push('role result must be an object');
    return errors;
  }
  const calls = Array.isArray(record?.metrics?.calls) ? record.metrics.calls : [];
  calls.forEach((call, index) => {
    if (call?.role !== record.role) errors.push(`metrics.calls[${index}].role must match the role evidence`);
  });

  if (record.role === 'whispers') {
    if (['form', 'waypoints', 'terms', 'term', 'renderings', 'stage']
      .some((key) => Object.hasOwn(result, key))) {
      errors.push('whisper result cannot also carry form result fields');
    }
    const whispers = result.whispers;
    if (!Array.isArray(whispers) || whispers.length !== stepCount
      || whispers.some((whisper) => !shortString(whisper, 120))) {
      errors.push('whisper result must contain one bounded non-empty string per requested step');
    }
    return errors;
  }

  if (Object.hasOwn(result, 'whispers')) errors.push('form result cannot also carry whispers');
  if (!/^[0-9a-f]{16}$/i.test(String(request?.askHash || ''))) {
    errors.push('form request.askHash must be a stable hash');
  }
  if (!['standard', 'quiet', 'lexicon', 'path'].includes(result.form)) {
    errors.push('form result.form is invalid');
  }
  if (result.model != null && !sameJsonValue(result.model, record.model)) {
    errors.push('form result.model does not reconcile the outer model evidence');
  }
  if (result.metrics != null && !sameJsonValue(result.metrics, record.metrics)) {
    errors.push('form result.metrics does not reconcile the outer metrics evidence');
  }

  const validStep = (value) => Number.isInteger(value) && value >= 0 && value < stepCount;
  if (result.form === 'path') {
    const waypoints = Array.isArray(result.waypoints) ? result.waypoints : [];
    const steps = new Set(waypoints.map((waypoint) => waypoint?.step));
    if (waypoints.length < Math.ceil(stepCount / 2)
      || steps.size !== waypoints.length
      || waypoints.some((waypoint) => !validStep(waypoint?.step) || !shortString(waypoint?.marker, 18))) {
      errors.push('path result waypoints are invalid for the requested steps');
    }
  }
  if (result.form === 'lexicon') {
    const terms = Array.isArray(result.terms) ? result.terms : [];
    if (!terms.length || terms.length > 3 || terms.some((term) => {
      const renderings = Array.isArray(term?.renderings) ? term.renderings : [];
      return !shortString(term?.term, 24) || renderings.length < 2 || renderings.length > 6
        || renderings.some((rendering) => !shortString(rendering?.label, 22)
          || !Array.isArray(rendering.steps) || !rendering.steps.length
          || new Set(rendering.steps).size !== rendering.steps.length
          || rendering.steps.some((step) => !validStep(step)));
    })) errors.push('lexicon result terms are invalid for the requested steps');
  }
  const stage = result.stage;
  if (stage != null && (!Array.isArray(stage) || stage.length > 4
    || new Set(stage.map((entry) => entry?.step)).size !== stage.length
    || stage.some((entry) => !validStep(entry?.step) || !shortString(entry?.verse, 40)
      || !/\d/.test(entry.verse) || !Array.isArray(entry.marks) || entry.marks.length > 2
      || entry.marks.some((mark) => !Array.isArray(mark?.words)
        || mark.words.length < 2 || mark.words.length > 4
        || mark.words.some((word) => !shortString(word, 20) || /\s/.test(word.trim()))
        || (mark.label != null && !shortString(mark.label, 18)))))) {
    errors.push('form result stage directions are invalid for the requested steps');
  }
  return errors;
}

function refusalRecord(name, raw, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    file: name,
    evidenceReadStatus: 'refused',
    schemaVersion: raw?.schemaVersion ?? null,
    policyVersion: raw?.policyVersion ?? null,
    startedAt: raw?.startedAt ?? null,
    requestKey: raw?.requestKey ?? null,
    recordId: raw?.request?.recordId ?? null,
    refusal: {
      code: error?.code || 'invalid-evidence',
      message,
      errors: Array.isArray(error?.errors) ? error.errors : [message],
    },
  };
}

function upgradeStoredDirectorEvidence(value) {
  if (!isObject(value)) throwEvidence('invalid-evidence', 'director evidence must be an object');
  assertSupportedEvidenceSchema(value.schemaVersion, 'director evidence');
  if (value.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION
    && value.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION
    && (!value.result || value.result.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION)) {
    throwEvidence(
      'superseded-policy',
      `director policy ${MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION} is preserved historical calibration evidence and is not upgraded to ${MAGIC_DIRECTOR_POLICY_VERSION}`,
    );
  }
  if (value.result) {
    if (value.status != null) {
      throwEvidence('invalid-outcome', 'successful director evidence cannot also carry an outcome status');
    }
    assertSupportedEvidenceSchema(value.result.schemaVersion, 'director result');
    if (value.result.schemaVersion !== value.schemaVersion) {
      throwEvidence('invalid-envelope', 'director outer and result schemas do not match');
    }
    const result = upgradeDirectorPayload(value.result);
    const legacy = value.schemaVersion === 1 ? legacyEnvelopeAssessment(value) : null;
    const envelopeErrors = legacy ? legacy.errors : currentRequestEnvelopeErrors(value, result);
    if (value.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION
      && value.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
      envelopeErrors.push('director outer policy does not match the current contract');
    }
    if (envelopeErrors.length) throwEvidence('invalid-envelope', 'director evidence envelope does not reconcile', envelopeErrors);
    assertCanonicalDirectorPayload(result);
    return {
      ...value,
      evidenceReadStatus: 'ready',
      effectiveSchemaVersion: result.schemaVersion,
      effectivePolicyVersion: result.policyVersion,
      ...(legacy ? { legacyWhyIntegrity: legacy.whyIntegrity } : {}),
      result,
    };
  }
  if (value.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION || value.status !== 'refused') {
    throwEvidence('invalid-evidence', 'director evidence has neither a result nor a current refusal');
  }
  if (Object.hasOwn(value, 'result')) {
    throwEvidence('invalid-outcome', 'director refusal evidence cannot carry a result');
  }
  if (value.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    throwEvidence('invalid-envelope', 'director refusal policy does not match the current contract');
  }
  const envelopeErrors = currentRequestEnvelopeErrors(value);
  if (typeof value.requestKey !== 'string' || !value.requestKey
    || !Array.isArray(value.calls) || !value.calls.length
    || typeof value.error?.message !== 'string') {
    envelopeErrors.push('director refusal evidence is incomplete');
  }
  if (envelopeErrors.length) throwEvidence('invalid-envelope', 'director refusal envelope does not reconcile', envelopeErrors);
  return {
    ...value,
    evidenceReadStatus: 'ready',
    effectiveSchemaVersion: value.schemaVersion,
    effectivePolicyVersion: value.policyVersion,
  };
}

export function writeDirectorEvidence(record, { dir = DIRECTOR_RUNS_DIR } = {}) {
  if (record?.schemaVersion != null && record.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throw new Error(`director evidence schema ${String(record.schemaVersion)} is not supported for writes`);
  }
  if (record?.policyVersion != null && record.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    throw new Error(`director evidence policy ${String(record.policyVersion)} is not supported for writes`);
  }
  const payload = redactEvidence({
    ...record,
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
  });
  if (payload.status === 'refused') {
    if (Object.hasOwn(payload, 'result')) {
      throw new Error('refusing invalid director outcome: refusal evidence cannot carry a result');
    }
    const envelopeErrors = currentRequestEnvelopeErrors(payload);
    if (typeof payload.requestKey !== 'string' || !payload.requestKey
      || !Array.isArray(payload.calls) || !payload.calls.length
      || typeof payload.error?.message !== 'string') {
      envelopeErrors.push('director refusal evidence is incomplete');
    }
    if (envelopeErrors.length) throw new Error(`refusing invalid director refusal evidence: ${envelopeErrors.join('; ')}`);
  } else {
    if (payload.status != null) {
      throw new Error('refusing invalid director outcome: successful evidence cannot carry a status');
    }
    const check = validateDirectorPayload(payload.result);
    if (!check.ok) throw new Error(`refusing invalid director evidence: ${check.errors.join('; ')}`);
    const envelopeErrors = currentRequestEnvelopeErrors(payload, payload.result);
    if (envelopeErrors.length) throw new Error(`refusing contradictory director evidence envelope: ${envelopeErrors.join('; ')}`);
    const canonicalErrors = canonicalPassageErrors(payload.result);
    if (canonicalErrors.length) throw new Error(`refusing non-canonical director evidence: ${canonicalErrors.join('; ')}`);
  }
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(payload.startedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  const stem = `${stamp}-${stableTextHash(payload.requestKey || JSON.stringify(payload.request || {}))}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt ? `-${attempt}` : '';
    const file = path.join(dir, `${stem}${suffix}.json`);
    try {
      fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
      return file;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('could not allocate an append-only director evidence filename');
}

export function listDirectorEvidence({ dir = DIRECTOR_RUNS_DIR, limit = 80 } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && name !== 'ledger.json')
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const value = readDirectorEvidence(name, { dir });
      if (!value) return refusalRecord(name, null, new EvidenceReadError('unsafe-file', 'evidence file is not a safe regular file'));
      if (value.evidenceReadStatus === 'refused') return value;
      return {
        file: name,
        evidenceReadStatus: 'ready',
        startedAt: value.startedAt,
        requestKey: value.requestKey,
        recordId: value.request?.recordId,
        schemaVersion: value.schemaVersion ?? value.result?.schemaVersion ?? null,
        policyVersion: value.policyVersion ?? null,
        effectiveSchemaVersion: value.effectiveSchemaVersion,
        effectivePolicyVersion: value.effectivePolicyVersion,
        model: value.result?.model?.resolvedSlug || value.result?.model?.key,
        wallMs: value.result?.metrics?.wallMs,
        passes: value.result?.metrics?.passes,
        totalUsd: value.result?.metrics?.totalUsd,
        scenes: value.result?.scenes?.length || 0,
        beats: value.result?.beats?.length || 0,
      };
    });
}

function upgradeStoredRoleEvidence(value) {
  if (!isObject(value)) throwEvidence('invalid-role-evidence', 'role evidence must be an object');
  assertSupportedEvidenceSchema(value.schemaVersion, 'role evidence');
  if (value.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION
    && value.policyVersion === MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION) {
    throwEvidence(
      'superseded-policy',
      `role policy ${MAGIC_PREVIOUS_DIRECTOR_POLICY_VERSION} is preserved historical calibration evidence and is not upgraded to ${MAGIC_DIRECTOR_POLICY_VERSION}`,
    );
  }
  if (value.schemaVersion === MAGIC_DIRECTOR_SCHEMA_VERSION
    && value.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    throwEvidence('invalid-role-evidence', 'current role evidence policy is invalid');
  }
  const check = validateMagicRoleEvidence(value);
  if (!check.ok) throwEvidence('invalid-role-evidence', 'role evidence failed validation', check.errors);
  const resultErrors = roleResultErrors(value);
  if (resultErrors.length) {
    throwEvidence('invalid-role-evidence', 'role result failed validation', resultErrors);
  }
  return {
    ...value,
    evidenceReadStatus: 'ready',
    effectiveSchemaVersion: value.schemaVersion,
    effectivePolicyVersion: value.policyVersion ?? null,
  };
}

export function writeMagicRoleEvidence(record, { dir = ROLE_RUNS_DIR } = {}) {
  if (record?.schemaVersion != null && record.schemaVersion !== MAGIC_DIRECTOR_SCHEMA_VERSION) {
    throw new Error(`role evidence schema ${String(record.schemaVersion)} is not supported for writes`);
  }
  if (record?.policyVersion != null && record.policyVersion !== MAGIC_DIRECTOR_POLICY_VERSION) {
    throw new Error(`role evidence policy ${String(record.policyVersion)} is not supported for writes`);
  }
  const payload = redactEvidence({
    ...record,
    schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION,
    policyVersion: MAGIC_DIRECTOR_POLICY_VERSION,
  });
  const check = validateMagicRoleEvidence(payload);
  if (!check.ok) throw new Error(`refusing invalid role evidence: ${check.errors.join('; ')}`);
  const resultErrors = roleResultErrors(payload);
  if (resultErrors.length) throw new Error(`refusing invalid role result: ${resultErrors.join('; ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date(payload.startedAt || Date.now()).toISOString().replace(/[:.]/g, '-');
  const stem = `${stamp}-${payload.role}-${stableTextHash(JSON.stringify(payload.request || {}))}`;
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const suffix = attempt ? `-${attempt}` : '';
    const file = path.join(dir, `${stem}${suffix}.json`);
    try {
      fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
      return file;
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
    }
  }
  throw new Error('could not allocate an append-only role evidence filename');
}

export function listMagicRoleEvidence({ dir = ROLE_RUNS_DIR, limit = 80 } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .reverse()
    .slice(0, limit)
    .map((name) => {
      const value = readMagicRoleEvidence(name, { dir });
      if (!value) return refusalRecord(name, null, new EvidenceReadError('unsafe-file', 'role evidence file is not a safe regular file'));
      if (value.evidenceReadStatus === 'refused') return value;
      return {
        file: name,
        evidenceReadStatus: 'ready',
        schemaVersion: value.schemaVersion,
        policyVersion: value.policyVersion ?? null,
        effectiveSchemaVersion: value.effectiveSchemaVersion,
        effectivePolicyVersion: value.effectivePolicyVersion,
        startedAt: value.startedAt,
        role: value.role,
        model: value.model?.resolvedSlug,
        wallMs: value.metrics?.wallMs,
        totalUsd: value.metrics?.totalUsd,
      };
    });
}

export function readDirectorEvidence(name, { dir = DIRECTOR_RUNS_DIR } = {}) {
  const file = safeJsonFile(dir, name);
  if (!file) return null;
  let value;
  try {
    value = redactEvidence(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return refusalRecord(name, null, new EvidenceReadError('corrupt-json', 'director evidence is not valid JSON'));
  }
  try {
    return upgradeStoredDirectorEvidence(value);
  } catch (error) {
    return refusalRecord(name, value, error);
  }
}

export function readMagicRoleEvidence(name, { dir = ROLE_RUNS_DIR } = {}) {
  const file = safeJsonFile(dir, name);
  if (!file) return null;
  let value;
  try {
    value = redactEvidence(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return refusalRecord(name, null, new EvidenceReadError('corrupt-json', 'role evidence is not valid JSON'));
  }
  try {
    return upgradeStoredRoleEvidence(value);
  } catch (error) {
    return refusalRecord(name, value, error);
  }
}

export function readReplayFixture(id, { dir = REPLAYS_DIR } = {}) {
  const clean = safeId(id);
  if (!clean || clean !== id || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(clean)) {
    return { fixture: null, errors: ['invalid replay id'] };
  }
  const file = safeJsonFile(dir, `${clean}.json`);
  if (!file) return { fixture: null, errors: ['no such replay fixture'] };
  let fixture;
  try {
    fixture = redactEvidence(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch {
    return { fixture: null, errors: ['replay fixture is not valid JSON'] };
  }
  if (fixture?.id !== clean) return { fixture: null, errors: ['replay filename and fixture id do not match'] };
  try {
    const upgraded = upgradeReplayFixture(fixture);
    const canonicalErrors = Object.entries(upgraded.directions || {}).flatMap(([stepId, direction]) => (
      canonicalPassageErrors(direction).map((error) => `directions[${stepId}]: ${error}`)
    ));
    if (canonicalErrors.length) return { fixture: null, errors: canonicalErrors };
    return { fixture: upgraded, errors: [] };
  } catch (error) {
    return { fixture: null, errors: [error?.message || String(error)] };
  }
}

export function listReplayFixtures({ dir = REPLAYS_DIR } = {}) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => {
      const id = name.slice(0, -5);
      const { fixture } = readReplayFixture(id, { dir });
      if (!fixture) return null;
      return {
        id: fixture.id,
        prompt: fixture.prompt,
        title: fixture.tour?.title || null,
        steps: fixture.tour?.steps?.length || 0,
      };
    })
    .filter(Boolean);
}

export function writeReplayFixture(fixture, { dir = REPLAYS_DIR } = {}) {
  const payload = redactEvidence({ ...fixture });
  const check = validateReplayFixture(payload);
  if (!check.ok) throw new Error(`refusing invalid replay fixture: ${check.errors.join('; ')}`);
  const canonicalErrors = Object.entries(payload.directions || {}).flatMap(([stepId, direction]) => (
    canonicalPassageErrors(direction).map((error) => `directions[${stepId}]: ${error}`)
  ));
  if (canonicalErrors.length) throw new Error(`refusing non-canonical replay fixture: ${canonicalErrors.join('; ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${payload.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
  return file;
}
