import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { isTranscriptApprovedSource, readTranscript, transcriptKey } from "../core/transcripts.js";
import type { TranscriptResult } from "../core/transcripts.js";

/**
 * Reads machine transcripts from `<library>/.artifacts/transcripts/`.
 *
 * Only the file handling lives here; whether the bytes are a transcript is
 * decided by `src/core/transcripts.ts`, which the renderer shares. That split
 * is what keeps node's types out of the renderer's program.
 */

export function transcriptDirectory(libraryPath: string): string {
  return join(libraryPath, ".artifacts/transcripts");
}

export function loadTranscript(libraryPath: string, recordId: string): TranscriptResult {
  /* Before the file, not after it. A transcript for a publisher who has not
     granted them must have no path to a reader, and the cheapest way to
     guarantee that is to refuse the id rather than the contents — a file that
     is never opened cannot be displayed by a later mistake. */
  if (!isTranscriptApprovedSource(recordId)) return { ok: false, reason: "ungranted" };

  const path = join(transcriptDirectory(libraryPath), `${transcriptKey(recordId)}.json`);
  /* Absence is the ordinary answer, not a failure: almost every episode has no
     transcript yet, and the caller has to be able to tell that apart from a
     file that exists and is wrong. */
  if (!existsSync(path)) return { ok: false, reason: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSyncInterruptible(path, "utf-8"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return readTranscript(parsed, recordId);
}
