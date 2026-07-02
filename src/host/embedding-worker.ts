/**
 * Embedding worker entry — runs LocalEmbeddingProvider (EmbeddingGemma ONNX)
 * inside a worker_thread so model load + inference never block the Electron
 * main thread. Bundled separately to dist/electron/embedding-worker.cjs.
 * Protocol types: see worker-embeddings.ts.
 */

import { parentPort, workerData } from "node:worker_threads";
import { LocalEmbeddingProvider } from "./local-embeddings.js";
import type { EmbedWorkerRequest, EmbedWorkerResponse } from "./worker-embeddings.js";

if (!parentPort) {
  throw new Error("embedding-worker must be run as a worker_thread");
}
const port = parentPort;

const data = (workerData ?? {}) as { modelId?: string; cacheDir?: string };
const provider = new LocalEmbeddingProvider({ modelId: data.modelId, cacheDir: data.cacheDir });

port.on("message", (msg: EmbedWorkerRequest) => {
  provider.embed(msg.texts, msg.kind).then(
    (vectors) => {
      const buffers = vectors.map((v) => v.buffer as ArrayBuffer);
      const response: EmbedWorkerResponse = { id: msg.id, ok: true, vectors: buffers };
      port.postMessage(response, buffers);
    },
    (err: unknown) => {
      const response: EmbedWorkerResponse = {
        id: msg.id,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
      port.postMessage(response);
    },
  );
});
