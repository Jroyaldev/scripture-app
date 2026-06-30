/**
 * AI module — public interface (INV-18: pure, platform-agnostic).
 */

export type { Claim, ClaimAnchor, ClaimSource, Overlay, Thread, SemanticNote, SuggestedCrossRef, AIJob } from "./types.js";
export type { BrokerCapability, BudgetGuard, AIBroker, NetworkBroker } from "./broker.js";
export type { EmbeddingRow, EmbeddingDataAccess } from "./similarity.js";
export { cosineSimilarity, findRelatedNotes, deterministicEmbedding } from "./similarity.js";
export { assembleSemanticMargin } from "./semantic-margin.js";
