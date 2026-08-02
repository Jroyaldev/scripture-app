// Append-only evidence and replay storage for /magic director runs.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAGIC_DIRECTOR_SCHEMA_VERSION,
  MAGIC_REPLAY_SCHEMA_VERSION,
  redactEvidence,
  stableTextHash,
  validateDirectorPayload,
  validateReplayFixture,
} from './magic-contract.mjs';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
export const DIRECTOR_RUNS_DIR = path.join(LAB_DIR, 'director-runs');
export const REPLAYS_DIR = path.join(LAB_DIR, 'replays');

const safeId = (value) => String(value || '').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');

export function writeDirectorEvidence(record, { dir = DIRECTOR_RUNS_DIR } = {}) {
  const payload = redactEvidence({ ...record, schemaVersion: MAGIC_DIRECTOR_SCHEMA_VERSION });
  const check = validateDirectorPayload(payload.result);
  if (!check.ok) throw new Error(`refusing invalid director evidence: ${check.errors.join('; ')}`);
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
      try {
        const value = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
        return {
          file: name,
          startedAt: value.startedAt,
          requestKey: value.requestKey,
          recordId: value.request?.recordId,
          model: value.result?.model?.resolvedSlug || value.result?.model?.key,
          wallMs: value.result?.metrics?.wallMs,
          passes: value.result?.metrics?.passes,
          totalUsd: value.result?.metrics?.totalUsd,
          scenes: value.result?.scenes?.length || 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

export function readDirectorEvidence(name, { dir = DIRECTOR_RUNS_DIR } = {}) {
  const file = path.join(dir, path.basename(String(name || '')));
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function readReplayFixture(id, { dir = REPLAYS_DIR } = {}) {
  const clean = safeId(id);
  if (!clean || clean !== id) return { fixture: null, errors: ['invalid replay id'] };
  const file = path.join(dir, `${clean}.json`);
  if (!fs.existsSync(file)) return { fixture: null, errors: ['no such replay fixture'] };
  let fixture;
  try {
    fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return { fixture: null, errors: ['replay fixture is not valid JSON'] };
  }
  const check = validateReplayFixture(fixture);
  return check.ok ? { fixture, errors: [] } : { fixture: null, errors: check.errors };
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
  const payload = redactEvidence({ ...fixture, schemaVersion: MAGIC_REPLAY_SCHEMA_VERSION });
  const check = validateReplayFixture(payload);
  if (!check.ok) throw new Error(`refusing invalid replay fixture: ${check.errors.join('; ')}`);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${payload.id}.json`);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, { flag: 'wx' });
  return file;
}
