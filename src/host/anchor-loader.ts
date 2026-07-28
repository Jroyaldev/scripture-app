import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { readAnchors } from "../core/anchors.js";
import { isTranscriptApprovedSource, transcriptKey } from "../core/transcripts.js";
import type { AnchorResult } from "../core/anchors.js";

/**
 * Reads passage anchors from `<library>/.artifacts/anchors/`.
 *
 * Gated by the transcript grant, not by a grant of its own. Anchors are derived
 * from a publisher's transcript and point into their audio, so a publisher who
 * has not granted transcripts has not granted these either — deriving a second
 * artifact from the first does not launder the permission.
 */

export function anchorDirectory(libraryPath: string): string {
  return join(libraryPath, ".artifacts/anchors");
}

export function loadAnchors(libraryPath: string, recordId: string): AnchorResult {
  if (!isTranscriptApprovedSource(recordId)) return { ok: false, reason: "ungranted" };

  const path = join(anchorDirectory(libraryPath), `${transcriptKey(recordId)}.json`);
  /* Absence is ordinary: an episode may simply have no moment that cleared the
     bar, and that is a result rather than a fault. */
  if (!existsSync(path)) return { ok: false, reason: "absent" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSyncInterruptible(path, "utf-8"));
  } catch {
    return { ok: false, reason: "unreadable" };
  }
  return readAnchors(parsed, recordId);
}
