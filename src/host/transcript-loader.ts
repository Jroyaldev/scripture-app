import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { readTranscript, transcriptKey } from "../core/transcripts.js";
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
