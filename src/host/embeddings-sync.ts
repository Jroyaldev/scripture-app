/**
 * Incremental note-embedding sync — Node host layer (Task B3, Gate 2).
 * Shared by the Electron `embed-notes` IPC handler and CLI/smoke scripts.
 * Skips notes whose content hash + model already match the stored vector;
 * prunes vectors from other models (model switch invalidates everything).
 */

import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../core/interfaces.js";
import type { EmbeddingsStore } from "./embeddings-store.js";

export type NoteSource = {
  getAllNotes(): { id: string; title: string; body_text: string }[];
};

export type EmbedSyncResult = {
  count: number;
  embedded: number;
  skipped: number;
  pruned: number;
};

export function noteContentHash(title: string, bodyText: string): string {
  return createHash("sha256").update(`${title} ${bodyText}`).digest("hex");
}

export async function embedAllNotes(
  db: NoteSource,
  store: EmbeddingsStore,
  provider: EmbeddingProvider,
): Promise<EmbedSyncResult> {
  const model = provider.modelId;
  const pruned = store.pruneOtherModels(model);

  const notes = db.getAllNotes();
  let embedded = 0;
  let skipped = 0;
  for (const note of notes) {
    const text = `${note.title} ${note.body_text}`;
    const hash = noteContentHash(note.title, note.body_text);
    if (store.isCurrent("note", note.id, model, hash)) {
      skipped++;
      continue;
    }
    const vec = await provider.embed([text], "document");
    store.upsertEmbedding("note", note.id, vec[0]!, model, hash);
    embedded++;
  }
  return { count: notes.length, embedded, skipped, pruned };
}
