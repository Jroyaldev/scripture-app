/**
 * Worker-backed embedding provider — Node host layer (Task B3, Gate 2 fix).
 *
 * Model inference MUST NOT run on the Electron main thread: a chapter-sized
 * passage through EmbeddingGemma pegs the CPU for seconds-to-minutes and the
 * main process handles all IPC + window events (verified livelock: spin
 * report showed InferenceSession::Run on the main thread, app beachballed).
 *
 * This client spawns a worker_threads Worker (see embedding-worker.ts) and
 * proxies embed() calls over messages. Worker death rejects all pending
 * requests and the next call respawns it.
 */

import { Worker } from "node:worker_threads";
import type { EmbeddingKind, EmbeddingProvider } from "../core/interfaces.js";
import { DEFAULT_MODEL_ID } from "./local-embeddings.js";

export type EmbedWorkerRequest = {
  id: number;
  texts: string[];
  kind: EmbeddingKind;
};

export type EmbedWorkerResponse =
  | { id: number; ok: true; vectors: ArrayBuffer[] }
  | { id: number; ok: false; error: string };

export type WorkerEmbeddingOptions = {
  /** Absolute path to the compiled worker entry (embedding-worker.cjs). */
  workerPath: string;
  modelId?: string;
  cacheDir?: string;
};

type Pending = {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
};

export class WorkerEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 768;
  readonly modelId: string;
  private opts: WorkerEmbeddingOptions;
  private worker: Worker | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;

  constructor(opts: WorkerEmbeddingOptions) {
    this.opts = opts;
    this.modelId = opts.modelId ?? process.env["EMBEDDING_MODEL"] ?? DEFAULT_MODEL_ID;
  }

  private getWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(this.opts.workerPath, {
      workerData: { modelId: this.modelId, cacheDir: this.opts.cacheDir },
    });
    worker.on("message", (msg: EmbedWorkerResponse) => {
      const entry = this.pending.get(msg.id);
      if (!entry) return;
      this.pending.delete(msg.id);
      if (this.pending.size === 0) worker.unref();
      if (msg.ok) {
        entry.resolve(msg.vectors.map((buf) => new Float32Array(buf)));
      } else {
        entry.reject(new Error(msg.error));
      }
    });
    const fail = (err: Error) => {
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
      worker.unref();
      this.worker = null;
    };
    worker.on("error", (err) => fail(err instanceof Error ? err : new Error(String(err))));
    worker.on("exit", (code) => {
      if (code !== 0) fail(new Error(`embedding worker exited with code ${code}`));
      this.worker = null;
    });
    // Never keep the app alive just for the worker.
    worker.unref();
    this.worker = worker;
    return worker;
  }

  async embed(texts: string[], kind: EmbeddingKind = "document"): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const worker = this.getWorker();
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      // Keep Node alive only while a caller is awaiting an in-flight request.
      // The message/failure paths release the worker again once the lane is idle.
      worker.ref();
      worker.postMessage({ id, texts, kind } satisfies EmbedWorkerRequest);
    });
  }

  async terminate(): Promise<void> {
    if (this.worker) {
      await this.worker.terminate();
      this.worker = null;
    }
  }
}
