import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { readReferences } from "../core/references.js";
import { isTranscriptApprovedSource, transcriptKey } from "../core/transcripts.js";
import type { ReferenceResult } from "../core/references.js";

/**
 * Reads passage references from `<library>/.artifacts/references/`.
 *
 * Gated by the transcript grant rather than one of its own. Most of a reference
 * is our own measurement — a book, a chapter, a timestamp, a relation — and
 * would raise no question on its own. But it is derived from a publisher's
 * transcript, it points into their audio, and it carries a short verbatim
 * fragment of what was said. Deriving a second artifact from the first does not
 * launder the permission, and a publisher who has not granted transcripts has
 * not granted these.
 */

export function referenceDirectory(libraryPath: string): string {
  return join(libraryPath, ".artifacts/references");
}

export function loadReferences(libraryPath: string, recordId: string): ReferenceResult {
  if (!isTranscriptApprovedSource(recordId)) return { ok: false, reason: "ungranted" };

  const path = join(referenceDirectory(libraryPath), `${transcriptKey(recordId)}.json`);
  /* Absence is ordinary — an episode may simply discuss no passage the reader
     would want pointed at, and that is an answer rather than a fault. */
  if (!existsSync(path)) return { ok: false, reason: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSyncInterruptible(path, "utf-8"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return readReferences(parsed, recordId);
}
