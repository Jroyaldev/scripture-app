/**
 * Incremental note-embedding sync — Node host layer (Task B3 Gate 2, reworked
 * for B3.5 chunk-level retrieval).
 * Shared by the Electron `embed-notes` IPC handler and CLI/smoke scripts.
 *
 * Notes are embedded per paragraph chunk (src_kind "note_chunk", src_id
 * `${noteId}#${index}`) so a multi-topic note can match precisely. Chunks
 * whose content hash + model already match the stored vector are skipped;
 * vectors from other models are pruned (model switch invalidates everything);
 * stale chunks (note edited/shrunk/deleted, or legacy whole-note "note" rows)
 * are swept after each sync.
 */

import { createHash } from "node:crypto";
import type { EmbeddingProvider } from "../core/interfaces.js";
import {
  EXPANSION_CHUNK_INDEX,
  chunkNoteBody,
  chunkSrcId,
  composeChunkEmbedText,
} from "../core/ai/retrieval.js";
import type { EmbeddingsStore } from "./embeddings-store.js";

export type NoteSource = {
  getAllNotes(): { id: string; title: string; body_text: string }[];
};

export type EmbedSyncResult = {
  /** Number of notes in the library. */
  count: number;
  /** Chunks embedded this run. */
  embedded: number;
  /** Chunks skipped (already current). */
  skipped: number;
  /** Rows removed: other-model vectors + stale/legacy rows. */
  pruned: number;
};

export function chunkContentHash(embedText: string): string {
  return createHash("sha256").update(embedText).digest("hex");
}

export async function embedAllNotes(
  db: NoteSource,
  store: EmbeddingsStore,
  provider: EmbeddingProvider,
  /** Theme vocabulary (B3.6 E3): glosses embed once as src_kind "theme". */
  themes: { id: string; label: string; gloss: string }[] = [],
): Promise<EmbedSyncResult> {
  const model = provider.modelId;
  let pruned = store.pruneOtherModels(model);

  // Theme-gloss vectors (tiny, embed once, invalidate on gloss edit).
  const themePending: { srcId: string; text: string; hash: string }[] = [];
  for (const theme of themes) {
    const text = `${theme.label}: ${theme.gloss}`;
    const hash = chunkContentHash(text);
    if (!store.isCurrent("theme", theme.id, model, hash)) {
      themePending.push({ srcId: theme.id, text, hash });
    }
  }
  if (themePending.length > 0) {
    const vecs = await provider.embed(themePending.map((t) => t.text), "document");
    themePending.forEach((t, i) => store.upsertEmbedding("theme", t.srcId, vecs[i]!, model, t.hash));
  }

  const notes = db.getAllNotes();
  const expected = new Set<string>();
  let embedded = 0;
  let skipped = 0;

  for (const note of notes) {
    const chunks = chunkNoteBody(note.body_text);
    const pending: { srcId: string; text: string; hash: string }[] = [];
    for (const chunk of chunks) {
      const srcId = chunkSrcId(note.id, chunk.index);
      expected.add(srcId);
      const embedText = composeChunkEmbedText(note.title, chunk.text);
      const hash = chunkContentHash(embedText);
      if (store.isCurrent("note_chunk", srcId, model, hash)) {
        skipped++;
        continue;
      }
      pending.push({ srcId, text: embedText, hash });
    }

    // B3.6 E3: the enrichment expansion embeds as an extra chunk — it speaks
    // the passage's language, closing the idiom gap for quick notes.
    const enrichment = store.getEnrichment(note.id);
    if (enrichment && !enrichment.noScriptureIntent && enrichment.expansion.length > 0) {
      const srcId = chunkSrcId(note.id, EXPANSION_CHUNK_INDEX);
      expected.add(srcId);
      const embedText = composeChunkEmbedText(note.title, enrichment.expansion);
      const hash = chunkContentHash(embedText);
      if (store.isCurrent("note_chunk", srcId, model, hash)) {
        skipped++;
      } else {
        pending.push({ srcId, text: embedText, hash });
      }
    }

    if (pending.length > 0) {
      const vecs = await provider.embed(pending.map((p) => p.text), "document");
      pending.forEach((p, i) => {
        store.upsertEmbedding("note_chunk", p.srcId, vecs[i]!, model, p.hash);
      });
      embedded += pending.length;
    }
  }

  // Sweep: legacy whole-note rows and chunks that no longer exist.
  for (const row of store.listEmbeddings()) {
    if (row.srcKind === "note" || (row.srcKind === "note_chunk" && !expected.has(row.srcId))) {
      store.deleteEmbedding(row.srcKind, row.srcId);
      pruned++;
    }
  }

  return { count: notes.length, embedded, skipped, pruned };
}
