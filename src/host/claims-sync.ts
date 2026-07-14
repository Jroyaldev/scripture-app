/**
 * Claim staleness sweep — Node host layer (B3.6 fix B-1).
 * A claim is only as good as the note text it quotes. When a source note is
 * edited or deleted, claims grounded in it must vanish rather than display a
 * now-false "verified" quote. Claims store a content hash of each source note
 * at extraction time; this sweep deletes any claim whose source notes changed
 * or disappeared. Runs cheaply at margin-read time (idempotent).
 */

import { createHash } from "node:crypto";
import type { EmbeddingsStore } from "./embeddings-store.js";

export type NoteLookup = (id: string) => { title: string; body_text: string } | undefined;

/** Hash of the note text a claim was extracted from. */
export function claimSourceHash(title: string, bodyText: string): string {
  return createHash("sha256").update(`${title}\n${bodyText}`).digest("hex");
}

/**
 * Delete claims whose note sources are missing or whose text has changed
 * since extraction. Returns the number of claims removed.
 */
export function sweepStaleClaims(store: EmbeddingsStore, getNote: NoteLookup): number {
  let removed = 0;
  for (const claim of store.getAllClaims()) {
    const noteSources = store.queryClaimSources(claim.id).filter((s) => s.kind === "note");
    const stale = noteSources.some((s) => {
      const note = getNote(s.ref);
      if (!note) return true; // source note deleted
      if (s.source_hash && s.source_hash !== claimSourceHash(note.title, note.body_text)) {
        return true; // source note edited since extraction
      }
      return false;
    });
    if (stale) {
      store.deleteClaim(claim.id);
      removed++;
    }
  }
  return removed;
}
