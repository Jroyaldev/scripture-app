/**
 * Broker-shaped interfaces (§4.9) — platform-agnostic (INV-18).
 * All AI/network access routes through these interfaces.
 * Default-deny (INV-14). Budget-clamped (INV-16).
 */

import type { AIRequest, AIResponse, EmbeddingProvider, AIProvider } from "../interfaces.js";

export type BrokerCapability =
  | "read:references"
  | "read:notes"
  | "read:sources"
  | "read:derived"
  | "write:derived"
  | "network:fetch"
  | "ai:invoke"
  | "ui:panel"
  | "ui:command"
  | "schedule:background";

export interface BudgetGuard {
  canSpend(tokens: number): boolean;
  recordSpend(tokens: number): void;
  isNetworkAllowed(): boolean;
  isAIAllowed(): boolean;
}

export interface AIBroker {
  invoke(req: AIRequest, callerId: string): Promise<AIResponse>;
  getEmbeddingProvider(): EmbeddingProvider | null;
  getAIProvider(): AIProvider | null;
  getBudgetGuard(): BudgetGuard;
}

export interface NetworkBroker {
  fetch(url: string, opts?: Record<string, unknown>): Promise<{ ok: boolean; status: number; body: string }>;
  isAllowedHost(host: string): boolean;
}
