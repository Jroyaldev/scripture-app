/**
 * Background Job Queue — Node host layer.
 * Clamped to the Budget Envelope (§4.10, INV-16).
 * Processes AI jobs asynchronously, recording spend.
 */

import { ulid } from "ulid";
import type { BudgetManager } from "./budget-manager.js";
import type { EmbeddingsStore } from "./embeddings-store.js";

export type JobKind = "embed-notes" | "semantic-resurface" | "extract-claims" | "suggest-xrefs" | "generate-thread";

export type JobFn = () => Promise<{ tokensUsed: number; error: string | null }>;

export class JobQueue {
  private budget: BudgetManager;
  private store: EmbeddingsStore;
  private queue: Array<{ id: string; kind: string; fn: JobFn }> = [];
  private running = false;

  constructor(budget: BudgetManager, store: EmbeddingsStore) {
    this.budget = budget;
    this.store = store;
  }

  enqueue(kind: JobKind, fn: JobFn): string {
    const id = ulid();
    this.queue.push({ id, kind, fn });
    this.store.insertJob({
      id,
      kind,
      status: "pending",
      created: new Date().toISOString(),
      finished: null,
      tokensUsed: 0,
      error: null,
    });
    void this.process();
    return id;
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;

    while (this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.store.insertJob({
        id: job.id,
        kind: job.kind,
        status: "running",
        created: new Date().toISOString(),
        finished: null,
        tokensUsed: 0,
        error: null,
      });

      try {
        const result = await job.fn();
        this.budget.recordSpend(result.tokensUsed);
        this.store.insertJob({
          id: job.id,
          kind: job.kind,
          status: result.error ? "failed" : "done",
          created: new Date().toISOString(),
          finished: new Date().toISOString(),
          tokensUsed: result.tokensUsed,
          error: result.error,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.store.insertJob({
          id: job.id,
          kind: job.kind,
          status: "failed",
          created: new Date().toISOString(),
          finished: new Date().toISOString(),
          tokensUsed: 0,
          error: errorMsg,
        });
      }
    }

    this.running = false;
  }
}
