/**
 * Embedding worker entry — runs LocalEmbeddingProvider (EmbeddingGemma ONNX)
 * off the Electron main thread. Bundled to dist/electron/embedding-worker.cjs.
 *
 * Dual-mode:
 *  - Electron utilityProcess (preferred in the app): onnxruntime-node hard-
 *    crashes V8 (SIGTRAP) when loaded in an Electron worker_thread — verified
 *    by bisect 2026-07-02. A utility process is a separate OS process, so a
 *    native crash can never take down the app. Config arrives via argv[2]
 *    (JSON); messages via process.parentPort (MessageEvent-shaped).
 *  - node:worker_threads (plain Node: tests, scripts): config via workerData;
 *    messages via parentPort.
 *
 * Protocol types: see worker-embeddings.ts.
 */

import { parentPort, workerData } from "node:worker_threads";
import { LocalEmbeddingProvider } from "./local-embeddings.js";
import type { EmbedWorkerRequest, EmbedWorkerResponse } from "./worker-embeddings.js";

type WorkerConfig = { modelId?: string; cacheDir?: string };

type UtilityParentPort = {
  on(event: "message", listener: (e: { data: EmbedWorkerRequest }) => void): void;
  postMessage(message: unknown): void;
};

async function handle(
  provider: LocalEmbeddingProvider,
  msg: EmbedWorkerRequest,
  reply: (resp: EmbedWorkerResponse, transfer?: ArrayBuffer[]) => void,
): Promise<void> {
  try {
    const vectors = await provider.embed(msg.texts, msg.kind);
    const buffers = vectors.map((v) => v.buffer as ArrayBuffer);
    reply({ id: msg.id, ok: true, vectors: buffers }, buffers);
  } catch (err) {
    reply({ id: msg.id, ok: false, error: err instanceof Error ? err.message : String(err) });
  }
}

// Native/module failures in this process are otherwise invisible to the app —
// log them to stderr explicitly before dying so the host can surface them.
process.on("uncaughtException", (err) => {
  console.error("[embedding-worker] uncaught:", err?.stack ?? err);
  process.exit(1);
});
process.on("unhandledRejection", (err) => {
  console.error("[embedding-worker] unhandled rejection:", err instanceof Error ? err.stack : err);
});

const utilityPort = (process as unknown as { parentPort?: UtilityParentPort }).parentPort;

if (utilityPort) {
  // Electron utilityProcess mode
  const config = JSON.parse(process.argv[2] ?? "{}") as WorkerConfig;
  const provider = new LocalEmbeddingProvider(config);
  utilityPort.on("message", (e) => {
    // utilityProcess transfers only support MessagePorts; buffers are cloned.
    void handle(provider, e.data, (resp) => utilityPort.postMessage(resp));
  });
} else {
  // worker_threads mode
  if (!parentPort) {
    throw new Error("embedding-worker must run as a utilityProcess or worker_thread");
  }
  const port = parentPort;
  const config = (workerData ?? {}) as WorkerConfig;
  const provider = new LocalEmbeddingProvider(config);
  port.on("message", (msg: EmbedWorkerRequest) => {
    void handle(provider, msg, (resp, transfer) => port.postMessage(resp, transfer));
  });
}
