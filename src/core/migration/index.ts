/**
 * Migration Registry (INV-17) — pure, platform-agnostic (INV-18).
 *
 * Every durable Substrate format carries a version. A version bump ships a
 * deterministic migration or a refusal mode. Derived data is never migrated — it is rebuilt.
 * A Library whose format is newer than the app MUST trigger refusal.
 */

import type { LibraryManifest } from "../interfaces.js";

/** The current schema version the app understands. */
export const CURRENT_APP_SCHEMA_VERSION = 1;
export const CURRENT_EVENT_SCHEMA_VERSION = 1;

export type MigrationResult =
  | { status: "current"; message: string }
  | { status: "migrated"; message: string; fromVersion: number; toVersion: number }
  | { status: "refused"; message: string }
  | { status: "error"; message: string };

export type Migration = {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (manifest: LibraryManifest) => LibraryManifest;
};

/** The migration registry. Phase 0 ships with a no-op v1 migration. */
const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 1,
    description: "No-op v1 identity migration (proves the registry works)",
    migrate: (manifest) => manifest,
  },
];

/**
 * Check if a library needs migration, and optionally run it.
 * --dry-run mode reports what would happen without changing anything.
 */
export function checkMigration(
  manifest: LibraryManifest,
  dryRun: boolean,
): MigrationResult {
  // Refusal mode: library is newer than the app
  if (manifest.appSchemaVersion > CURRENT_APP_SCHEMA_VERSION) {
    return {
      status: "refused",
      message: `Library schema version ${manifest.appSchemaVersion} is newer than the app understands (${CURRENT_APP_SCHEMA_VERSION}). Please update the app or export/backup your library before proceeding.`,
    };
  }

  if (manifest.eventSchemaVersion > CURRENT_EVENT_SCHEMA_VERSION) {
    return {
      status: "refused",
      message: `Library event schema version ${manifest.eventSchemaVersion} is newer than the app understands (${CURRENT_EVENT_SCHEMA_VERSION}). Please update the app or export/backup your library before proceeding.`,
    };
  }

  // Current version — no migration needed
  if (manifest.appSchemaVersion === CURRENT_APP_SCHEMA_VERSION) {
    return {
      status: "current",
      message: "Library is at the current schema version. No migration required.",
    };
  }

  // Find migration path
  const path = findMigrationPath(
    manifest.appSchemaVersion,
    CURRENT_APP_SCHEMA_VERSION,
  );

  if (path.length === 0) {
    return {
      status: "error",
      message: `No migration path from version ${manifest.appSchemaVersion} to ${CURRENT_APP_SCHEMA_VERSION}.`,
    };
  }

  if (dryRun) {
    const steps = path
      .map((m) => `  v${m.fromVersion} → v${m.toVersion}: ${m.description}`)
      .join("\n");
    return {
      status: "current",
      message: `Dry run: would apply ${path.length} migration(s):\n${steps}`,
    };
  }

  // Apply migrations
  let current = manifest;
  for (const migration of path) {
    current = migration.migrate(current);
  }

  return {
    status: "migrated",
    message: `Migrated from v${manifest.appSchemaVersion} to v${CURRENT_APP_SCHEMA_VERSION}.`,
    fromVersion: manifest.appSchemaVersion,
    toVersion: CURRENT_APP_SCHEMA_VERSION,
  };
}

function findMigrationPath(from: number, to: number): Migration[] {
  if (from === to) return [];

  // Simple linear path for now
  const path: Migration[] = [];
  let current = from;

  while (current < to) {
    const migration = migrations.find((m) => m.fromVersion === current);
    if (!migration) return [];
    path.push(migration);
    current = migration.toVersion;
  }

  return path;
}
