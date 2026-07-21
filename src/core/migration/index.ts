/**
 * Migration Registry (INV-17) — pure, platform-agnostic (INV-18).
 *
 * Every durable Substrate format carries a version. A version bump ships a
 * deterministic migration or a refusal mode. Derived data is never migrated — it is rebuilt.
 * A Library whose format is newer than the app MUST trigger refusal.
 */

import type { LibraryManifest } from "../interfaces.js";

/** The current schema version the app understands. */
export const CURRENT_APP_SCHEMA_VERSION = 2;
export const CURRENT_EVENT_SCHEMA_VERSION = 1;

/** The current scripture package format version the app understands (INV-17). */
export const CURRENT_PACKAGE_FORMAT_VERSION = 1;

export type MigrationStep = {
  fromVersion: number;
  toVersion: number;
  description: string;
};

export type MigrationPlan = {
  fromVersion: number;
  toVersion: number;
  steps: MigrationStep[];
  /** The deterministic post-migration value. The input manifest is never mutated. */
  manifest: LibraryManifest;
};

export type MigrationResult =
  | { status: "current"; message: string; manifest: LibraryManifest }
  | {
      status: "planned";
      message: string;
      fromVersion: number;
      toVersion: number;
      manifest: LibraryManifest;
      plan: MigrationPlan;
    }
  | {
      status: "migrated";
      message: string;
      fromVersion: number;
      toVersion: number;
      manifest: LibraryManifest;
      plan: MigrationPlan;
    }
  | { status: "refused"; message: string }
  | { status: "error"; message: string };

export type Migration = {
  fromVersion: number;
  toVersion: number;
  description: string;
  migrate: (manifest: LibraryManifest) => LibraryManifest;
};

/** Manifest-only migrations. Authored event logs are never rewritten here. */
const migrations: Migration[] = [
  {
    fromVersion: 1,
    toVersion: 2,
    description: "Establish the schema-v2 compatibility boundary without rewriting authored v1 data",
    migrate: (manifest) => ({
      ...manifest,
      appSchemaVersion: 2,
    }),
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
      manifest: { ...manifest },
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

  let migratedManifest = { ...manifest };
  for (const migration of path) {
    migratedManifest = migration.migrate(migratedManifest);
  }
  const plan: MigrationPlan = {
    fromVersion: manifest.appSchemaVersion,
    toVersion: CURRENT_APP_SCHEMA_VERSION,
    steps: path.map(({ fromVersion, toVersion, description }) => ({
      fromVersion,
      toVersion,
      description,
    })),
    manifest: migratedManifest,
  };

  if (dryRun) {
    const steps = plan.steps
      .map((step) => `  v${step.fromVersion} → v${step.toVersion}: ${step.description}`)
      .join("\n");
    return {
      status: "planned",
      message: `Dry run: would apply ${path.length} migration(s):\n${steps}`,
      fromVersion: plan.fromVersion,
      toVersion: plan.toVersion,
      manifest: plan.manifest,
      plan,
    };
  }

  return {
    status: "migrated",
    message: `Migrated from v${manifest.appSchemaVersion} to v${CURRENT_APP_SCHEMA_VERSION}.`,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    manifest: plan.manifest,
    plan,
  };
}

function findMigrationPath(from: number, to: number): Migration[] {
  if (from === to) return [];

  // Simple linear path for now
  const path: Migration[] = [];
  let current = from;

  while (current < to) {
    const migration = migrations.find((candidate) => (
      candidate.fromVersion === current
      && candidate.toVersion > current
      && candidate.toVersion <= to
    ));
    if (!migration) return [];
    path.push(migration);
    current = migration.toVersion;
  }

  return current === to ? path : [];
}
