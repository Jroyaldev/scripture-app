/**
 * Semantic similarity — pure platform-agnostic (INV-18).
 * Cosine similarity and semantic resurfacing logic.
 */

import type { SemanticNote } from "./types.js";

export type EmbeddingRow = {
  srcKind: string;
  srcId: string;
  vector: Float32Array;
};

export interface EmbeddingDataAccess {
  getAllEmbeddings(): EmbeddingRow[];
  getEmbedding(srcKind: string, srcId: string): EmbeddingRow | undefined;
}

/**
 * Compute cosine similarity between two vectors.
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i]!;
    const bv = b[i]!;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/**
 * Find semantically related notes for a given query embedding.
 * Returns notes sorted by similarity, above a threshold.
 */
export function findRelatedNotes(
  queryVector: Float32Array,
  embeddings: EmbeddingRow[],
  excludeIds: Set<string>,
  threshold = 0.5,
  limit = 5,
): SemanticNote[] {
  const scored: Array<{ srcId: string; similarity: number }> = [];

  for (const emb of embeddings) {
    if (emb.srcKind !== "note") continue;
    if (excludeIds.has(emb.srcId)) continue;
    const sim = cosineSimilarity(queryVector, emb.vector);
    if (sim >= threshold) {
      scored.push({ srcId: emb.srcId, similarity: sim });
    }
  }

  scored.sort((a, b) => b.similarity - a.similarity);

  return scored.slice(0, limit).map((s) => ({
    noteId: s.srcId,
    title: "",
    snippet: "",
    similarity: s.similarity,
  }));
}

/**
 * Compute a simple text-based embedding for testing/fallback.
 * This is a deterministic bag-of-words embedding — NOT for production use.
 * It exists so the verify-m3 gate can run without an API key.
 */
export function deterministicEmbedding(text: string, dim = 256): Float32Array {
  const vec = new Float32Array(dim);
  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ");
  const words = normalized.split(/\s+/).filter((w) => w.length > 0);

  for (const word of words) {
    let hash = 0;
    for (let i = 0; i < word.length; i++) {
      hash = ((hash << 5) - hash + word.charCodeAt(i)) | 0;
    }
    const idx = Math.abs(hash) % dim;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }

  // Normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += (vec[i] ?? 0) * (vec[i] ?? 0);
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) vec[i] = (vec[i] ?? 0) / norm;
  }

  return vec;
}
