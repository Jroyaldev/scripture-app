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
  private runPromise: Promise<void> | null = null;
  private accepting = true;
  private paused = false;
  private stopped = false;

  constructor(budget: BudgetManager, store: EmbeddingsStore) {
    this.budget = budget;
    this.store = store;
  }

  enqueue(kind: JobKind, fn: JobFn): string {
    if (!this.accepting) {
      throw new Error(this.stopped ? "Job queue is shutting down" : "Job queue is paused");
    }
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
    this.ensureProcessing();
    return id;
  }

  /**
   * Reversibly stop accepting new work and wait for the job that already owns
   * the store to finish. Queued jobs remain queued so an aborted library
   * switch can resume the exact same queue without losing work.
   */
  async pauseAndWait(): Promise<void> {
    if (this.stopped) {
      await this.runPromise;
      return;
    }
    this.accepting = false;
    this.paused = true;
    await this.runPromise;
  }

  /** Reopen a queue after a reversible switch pause. */
  resume(): void {
    if (this.stopped) throw new Error("Job queue is shutting down");
    this.paused = false;
    this.accepting = true;
    if (this.queue.length > 0) this.ensureProcessing();
  }

  /**
   * Stop accepting work, mark work that has not started as failed, and wait
   * for the currently running job to finish its final store write. Callers
   * may safely close the EmbeddingsStore only after this promise resolves.
   */
  async shutdown(): Promise<void> {
    let cancellationError: unknown;
    if (!this.stopped) {
      this.stopped = true;
      this.accepting = false;
      this.paused = true;
      const canceled = this.queue.splice(0);
      for (const job of canceled) {
        try {
          this.store.insertJob({
            id: job.id,
            kind: job.kind,
            status: "failed",
            created: new Date().toISOString(),
            finished: new Date().toISOString(),
            tokensUsed: 0,
            error: "Job canceled because the semantic runtime is shutting down",
          });
        } catch (error) {
          cancellationError ??= error;
        }
      }
    }
    await this.runPromise;
    if (cancellationError) throw cancellationError;
  }

  private ensureProcessing(): void {
    if (this.runPromise) return;
    this.runPromise = this.process().finally(() => {
      this.runPromise = null;
      // A job can be enqueued in the narrow interval after process() observes
      // an empty queue and before this finalizer runs.
      if (this.accepting && !this.paused && this.queue.length > 0) this.ensureProcessing();
    });
    // The queue reports job failures in its persistent job record. Keep a
    // rejected runner from becoming a process-level unhandled rejection; a
    // shutdown caller still observes the same promise via runPromise.
    void this.runPromise.catch(() => undefined);
  }

  private async process(): Promise<void> {
    while (!this.paused && this.queue.length > 0) {
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
  }
}
