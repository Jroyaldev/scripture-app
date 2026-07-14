/**
 * Injected interfaces — defined and STUBBED in M1 (§4.10, §4.11).
 * All I/O is injected behind interfaces (INV-18).
 */

// --- AI Provider (§4.10) — stub; implemented in M3 ---

export type AIRequest = {
  prompt: string;
  context?: string;
  maxTokens?: number;
  /** Ask the provider for structured JSON output. Default "text". */
  responseFormat?: "text" | "json";
  /** Sampling temperature (0 = maximally deterministic). Provider default when omitted. */
  temperature?: number;
  /**
   * Optional JSON Schema for the response shape. Providers that support
   * schema-constrained output (OpenAI strict mode, Codex --output-schema)
   * enforce it; others ignore it and rely on prompt + validation.
   */
  jsonSchema?: Record<string, unknown>;
  /**
   * Latency class. Hosts map this to provider-specific knobs
   * (e.g. DeepSeek disables thinking for "interactive"). Default "interactive".
   */
  latency?: "interactive" | "background";
};

export type AIResponse = {
  text: string;
  tokensUsed: number;
};

export interface AIProvider {
  invoke(req: AIRequest): Promise<AIResponse>;
}

// --- Embedding Provider (§4.10) — stub; implemented in M3 ---

/**
 * Asymmetric retrieval role. Modern retrieval embedders (e.g. EmbeddingGemma)
 * require different prompt prefixes for search queries vs stored documents;
 * omitting them silently degrades retrieval. Providers that don't
 * distinguish may ignore this. Default is "document".
 */
export type EmbeddingKind = "document" | "query";

export interface EmbeddingProvider {
  embed(texts: string[], kind?: EmbeddingKind): Promise<Float32Array[]>;
  readonly dim: number;
  /** Stable identifier for invalidation (stored beside each vector). */
  readonly modelId: string;
}

// --- Revision Store (§4.11) ---

export type RevisionTxn = {
  id: string;
  label: string;
  files: string[];
};

export type RevisionReceipt = {
  id: string;
  label: string;
  timestamp: string;
  entityId?: string;
};

export interface RevisionStore {
  beginTransaction(label: string): Promise<RevisionTxn>;
  commit(txn: RevisionTxn): Promise<RevisionReceipt>;
  history(entityId?: string): Promise<RevisionReceipt[]>;
  restore(receiptId: string): Promise<void>;
}

// --- File System abstraction (INV-18: core never imports Node fs) ---

export interface FileSystem {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readDir(path: string): Promise<string[]>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  join(...parts: string[]): string;
}

// --- Budget Envelope (§4.10) ---

export type BudgetEnvelope = {
  backgroundAI: "off" | "local-only" | "cloud";
  dailyTokenCeiling?: number;
  dailySpendCeilingUsd?: number;
  networkBackground: boolean;
  perPluginOverrides?: Record<string, Partial<BudgetEnvelope>>;
};

// --- Library Manifest (INV-17) ---

export type LibraryManifest = {
  libraryId: string;
  createdAt: string;
  appSchemaVersion: number;
  eventSchemaVersion: number;
  referenceFormatVersion: "bref:v1";
  pluginApiVersion: "1";
};
