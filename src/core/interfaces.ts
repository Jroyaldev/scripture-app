/**
 * Injected interfaces — defined and STUBBED in M1 (§4.10, §4.11).
 * All I/O is injected behind interfaces (INV-18).
 */

// --- AI Provider (§4.10) — stub; implemented in M3 ---

export type AIRequest = {
  prompt: string;
  context?: string;
  maxTokens?: number;
};

export type AIResponse = {
  text: string;
  tokensUsed: number;
};

export interface AIProvider {
  invoke(req: AIRequest): Promise<AIResponse>;
}

// --- Embedding Provider (§4.10) — stub; implemented in M3 ---

export interface EmbeddingProvider {
  embed(texts: string[]): Promise<Float32Array[]>;
  readonly dim: number;
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
