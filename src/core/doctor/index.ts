/**
 * Library Doctor — integrity checker/reporter.
 * Reports clearly with safe suggested repairs; never silently fixes (§6 M1).
 * Pure, platform-agnostic (INV-18).
 */

import type { BackboneData } from "../reference/types.js";
import type { LibraryEvent } from "../events/types.js";
import type { ParsedNote } from "../notes/types.js";
import type { LibraryManifest } from "../interfaces.js";
import { parseBref, validateRef } from "../reference/parser.js";
import { CURRENT_APP_SCHEMA_VERSION, CURRENT_EVENT_SCHEMA_VERSION } from "../migration/index.js";

export type DiagnosticSeverity = "error" | "warning" | "info";

export type Diagnostic = {
  severity: DiagnosticSeverity;
  category: string;
  message: string;
  suggestion?: string;
};

export type DoctorReport = {
  diagnostics: Diagnostic[];
  summary: {
    errors: number;
    warnings: number;
    infos: number;
    healthy: boolean;
  };
};

export type DoctorInput = {
  notes: ParsedNote[];
  events: {
    highlights: LibraryEvent[];
    pinnedFacts: LibraryEvent[];
    threads: LibraryEvent[];
    noteChangeLogs: LibraryEvent[];
  };
  manifest: LibraryManifest | null;
  backbone: BackboneData;
  rebuildHash: string | null;
  expectedRebuildHash: string | null;
  packageManifests: Array<{ id: string; license?: { spdx?: string; name?: string; attributionText?: string; permissions?: Record<string, boolean> } }>;
  sourceDirs: string[];
  installedArtifactPaths: string[];
};

export function runDoctor(input: DoctorInput): DoctorReport {
  const diagnostics: Diagnostic[] = [];

  checkNoteIds(input.notes, diagnostics);
  checkNoteFrontmatter(input.notes, diagnostics);
  checkNoteLinks(input.notes, diagnostics);
  checkBrefStrings(input.notes, input.backbone, diagnostics);
  checkEvents(input.events, diagnostics);
  checkManifest(input.manifest, diagnostics);
  checkPackageLicenses(input.packageManifests, diagnostics);
  checkRebuildHash(input.rebuildHash, input.expectedRebuildHash, diagnostics);

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;
  const infos = diagnostics.filter((d) => d.severity === "info").length;

  return {
    diagnostics,
    summary: {
      errors,
      warnings,
      infos,
      healthy: errors === 0,
    },
  };
}

function checkNoteIds(notes: ParsedNote[], diagnostics: Diagnostic[]): void {
  const ids = new Map<string, string[]>();

  for (const note of notes) {
    const id = note.frontmatter.id;

    if (!id) {
      diagnostics.push({
        severity: "error",
        category: "missing-note-id",
        message: `Note "${note.frontmatter.title || "(untitled)"}" has no frontmatter id.`,
        suggestion: "Add an 'id' field with a ULID to the note's frontmatter.",
      });
      continue;
    }

    const existing = ids.get(id);
    if (existing) {
      existing.push(note.frontmatter.title);
    } else {
      ids.set(id, [note.frontmatter.title]);
    }
  }

  for (const [id, titles] of ids) {
    if (titles.length > 1) {
      diagnostics.push({
        severity: "error",
        category: "duplicate-note-id",
        message: `Duplicate note ID "${id}" found in notes: ${titles.join(", ")}.`,
        suggestion:
          "Assign a unique ULID to each note. Regenerate one of the duplicates.",
      });
    }
  }
}

function checkNoteFrontmatter(
  notes: ParsedNote[],
  diagnostics: Diagnostic[],
): void {
  for (const note of notes) {
    const fm = note.frontmatter;
    if (!fm.title) {
      diagnostics.push({
        severity: "warning",
        category: "invalid-frontmatter",
        message: `Note "${fm.id}" has no title in frontmatter.`,
        suggestion: "Add a 'title' field to the note's frontmatter.",
      });
    }
    if (!fm.created) {
      diagnostics.push({
        severity: "warning",
        category: "invalid-frontmatter",
        message: `Note "${fm.id}" has no 'created' timestamp.`,
        suggestion: "Add a 'created' field with an RFC3339 UTC timestamp.",
      });
    }
    if (!fm.modified) {
      diagnostics.push({
        severity: "warning",
        category: "invalid-frontmatter",
        message: `Note "${fm.id}" has no 'modified' timestamp.`,
        suggestion: "Add a 'modified' field with an RFC3339 UTC timestamp.",
      });
    }
  }
}

function checkNoteLinks(notes: ParsedNote[], diagnostics: Diagnostic[]): void {
  const noteIds = new Set(notes.map((n) => n.frontmatter.id).filter(Boolean));

  for (const note of notes) {
    for (const link of note.noteLinks) {
      if (!noteIds.has(link.targetId)) {
        diagnostics.push({
          severity: "warning",
          category: "unresolved-note-link",
          message: `Note "${note.frontmatter.id}" links to "${link.targetId}" (label: "${link.cachedLabel}") which does not exist.`,
          suggestion:
            "Check if the linked note was deleted or if the ID is incorrect.",
        });
      }

      // Check for stale labels
      const target = notes.find((n) => n.frontmatter.id === link.targetId);
      if (target && target.frontmatter.title !== link.cachedLabel) {
        diagnostics.push({
          severity: "info",
          category: "stale-link-label",
          message: `Note "${note.frontmatter.id}" has a link to "${link.targetId}" with cached label "${link.cachedLabel}" but the target's title is "${target.frontmatter.title}".`,
          suggestion:
            "Run 'refresh labels' to update cached labels. Stale labels do not break links.",
        });
      }
    }
  }
}

function checkBrefStrings(
  notes: ParsedNote[],
  backbone: BackboneData,
  diagnostics: Diagnostic[],
): void {
  for (const note of notes) {
    for (const sr of note.scriptureRefs) {
      const parsed = parseBref(
        `bref:v1/${sr.ref.start.book}.${sr.ref.start.chapter}.${sr.ref.start.verse}-${sr.ref.end.book}.${sr.ref.end.chapter}.${sr.ref.end.verse}`,
      );
      if (!parsed.ok) {
        diagnostics.push({
          severity: "error",
          category: "invalid-bref",
          message: `Note "${note.frontmatter.id}": invalid bref from "${sr.raw}": ${parsed.error}`,
          suggestion: "Check the scripture reference format.",
        });
        continue;
      }
      const validated = validateRef(parsed.value, backbone);
      if (!validated.ok) {
        diagnostics.push({
          severity: "error",
          category: "invalid-bref",
          message: `Note "${note.frontmatter.id}": bref from "${sr.raw}" fails backbone validation: ${validated.error}`,
          suggestion:
            "The reference points to a verse that does not exist in the backbone coordinate system.",
        });
      }
    }
  }
}

function checkEvents(
  events: DoctorInput["events"],
  diagnostics: Diagnostic[],
): void {
  const allEvents: LibraryEvent[] = [
    ...events.highlights,
    ...events.pinnedFacts,
    ...events.threads,
    ...events.noteChangeLogs,
  ];

  // Check for duplicate event IDs
  const eventIds = new Set<string>();
  for (const e of allEvents) {
    if (eventIds.has(e.eventId)) {
      diagnostics.push({
        severity: "error",
        category: "duplicate-event-id",
        message: `Duplicate event ID: ${e.eventId}`,
        suggestion: "Each event must have a globally unique eventId (ULID).",
      });
    }
    eventIds.add(e.eventId);
  }

  // Check for non-monotonic device seq
  const deviceSeqs = new Map<string, number>();
  for (const e of allEvents) {
    const key = e.deviceId;
    const prev = deviceSeqs.get(key);
    if (prev !== undefined && e.seq <= prev) {
      diagnostics.push({
        severity: "warning",
        category: "non-monotonic-seq",
        message: `Device "${e.deviceId}" has non-monotonic seq: ${e.seq} (previous: ${prev}).`,
        suggestion:
          "Device sequence numbers should be monotonically increasing. This may indicate duplicate events or clock issues.",
      });
    }
    deviceSeqs.set(key, e.seq);
  }

  // Check for malformed events
  for (const e of allEvents) {
    if (!e.eventId) {
      diagnostics.push({
        severity: "error",
        category: "malformed-event",
        message: "Event missing eventId.",
        suggestion: "Every event must have a ULID eventId.",
      });
    }
    if (!e.entityId) {
      diagnostics.push({
        severity: "error",
        category: "malformed-event",
        message: `Event ${e.eventId} missing entityId.`,
        suggestion: "Every event must reference an entityId.",
      });
    }
    if (!e.entityType) {
      diagnostics.push({
        severity: "error",
        category: "malformed-event",
        message: `Event ${e.eventId} missing entityType.`,
        suggestion: "Every event must have an entityType.",
      });
    }
  }

  checkOverlappingHighlights(allEvents, diagnostics);
}

type HighlightSpan = {
  entityId: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

function checkOverlappingHighlights(events: LibraryEvent[], diagnostics: Diagnostic[]): void {
  const highlights = events
    .map(readHighlightSpan)
    .filter((span): span is HighlightSpan => span !== null);

  for (let i = 0; i < highlights.length; i++) {
    const left = highlights[i]!;
    for (let j = i + 1; j < highlights.length; j++) {
      const right = highlights[j]!;
      if (left.entityId === right.entityId) continue;
      if (
        left.book === right.book &&
        left.chapter === right.chapter &&
        left.verseStart <= right.verseEnd &&
        right.verseStart <= left.verseEnd
      ) {
        diagnostics.push({
          severity: "warning",
          category: "overlapping-highlights",
          message: `Highlights "${left.entityId}" and "${right.entityId}" overlap at ${left.book} ${left.chapter}.`,
          suggestion: "Review both highlights. Sync preserved both authored events.",
        });
      }
    }
  }
}

function readHighlightSpan(event: LibraryEvent): HighlightSpan | null {
  if (event.entityType !== "highlight") return null;
  if (event.op === "delete") return null;
  if (!isRecord(event.payload)) return null;
  const book = event.payload["book"];
  const chapter = event.payload["chapter"];
  const verseStart = event.payload["verse_start"];
  const verseEnd = event.payload["verse_end"];
  if (
    typeof book !== "string" ||
    typeof chapter !== "number" ||
    typeof verseStart !== "number" ||
    typeof verseEnd !== "number"
  ) {
    return null;
  }
  return {
    entityId: event.entityId,
    book,
    chapter,
    verseStart,
    verseEnd,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function checkManifest(
  manifest: LibraryManifest | null,
  diagnostics: Diagnostic[],
): void {
  if (!manifest) {
    diagnostics.push({
      severity: "error",
      category: "missing-manifest",
      message: "No library-manifest.json found.",
      suggestion: "Run 'library init' to create a library with a valid manifest.",
    });
    return;
  }

  if (manifest.appSchemaVersion > CURRENT_APP_SCHEMA_VERSION) {
    diagnostics.push({
      severity: "error",
      category: "schema-version-mismatch",
      message: `Library schema version ${manifest.appSchemaVersion} is newer than the app (${CURRENT_APP_SCHEMA_VERSION}).`,
      suggestion: "Update the app to a version that supports this library format.",
    });
  }

  if (manifest.eventSchemaVersion > CURRENT_EVENT_SCHEMA_VERSION) {
    diagnostics.push({
      severity: "error",
      category: "schema-version-mismatch",
      message: `Event schema version ${manifest.eventSchemaVersion} is newer than the app (${CURRENT_EVENT_SCHEMA_VERSION}).`,
      suggestion: "Update the app to a version that supports this event format.",
    });
  }
}

function checkPackageLicenses(
  packages: DoctorInput["packageManifests"],
  diagnostics: Diagnostic[],
): void {
  for (const pkg of packages) {
    if (!pkg.license) {
      diagnostics.push({
        severity: "error",
        category: "missing-license",
        message: `Package "${pkg.id}" has no license information.`,
        suggestion:
          "Add license metadata with SPDX identifier and permission flags.",
      });
      continue;
    }
    if (!pkg.license.name) {
      diagnostics.push({
        severity: "warning",
        category: "incomplete-license",
        message: `Package "${pkg.id}" has incomplete license metadata (missing name).`,
        suggestion: "Add a license name field.",
      });
    }
    if (!pkg.license.attributionText) {
      diagnostics.push({
        severity: "warning",
        category: "incomplete-license",
        message: `Package "${pkg.id}" has no attribution text.`,
        suggestion: "Add attribution text as required by the license.",
      });
    }
    if (!pkg.license.permissions) {
      diagnostics.push({
        severity: "warning",
        category: "incomplete-license",
        message: `Package "${pkg.id}" has no permission flags.`,
        suggestion: "Add permission flags (bundle, index, display, quoteInNotes, export, syncToOwnDevices).",
      });
    }
  }
}

function checkRebuildHash(
  actual: string | null,
  expected: string | null,
  diagnostics: Diagnostic[],
): void {
  if (actual === null || expected === null) {
    return;
  }
  if (actual !== expected) {
    diagnostics.push({
      severity: "error",
      category: "rebuild-hash-mismatch",
      message: `Substrate/rebuild_hash mismatch. Expected: ${expected}, got: ${actual}.`,
      suggestion:
        "The SQLite materialized view is out of sync with the substrate. Run 'library rebuild' to regenerate.",
    });
  }
}
