/**
 * Embedding host — runs in a HIDDEN Electron renderer window.
 *
 * Why a renderer: Electron's V8 memory cage (v21+) fatally rejects the
 * external buffers onnxruntime-node creates, in every Node-side context
 * (main thread, worker_threads, utilityProcess, even ELECTRON_RUN_AS_NODE —
 * all verified crashing with SIGTRAP/brk#0 on 2026-07-02). In a renderer,
 * transformers.js resolves its browser build and uses onnxruntime-web
 * (WASM): no native buffers, no cage, and compute stays off the app's
 * main process entirely.
 *
 * Protocol: main sends {id, texts, kind, modelId} on "embed-request";
 * we reply {id, ok, vectors|error} via the preload bridge.
 */

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_PREFIXES } from "../host/local-embeddings.js";

type HostRequest = { id: number; texts: string[]; kind: "document" | "query"; modelId: string };
type HostResponse =
  | { id: number; ok: true; vectors: ArrayBuffer[] }
  | { id: number; ok: false; error: string };

declare global {
  interface Window {
    embedHost: {
      onRequest(cb: (req: HostRequest) => void): void;
      respond(resp: HostResponse): void;
    };
  }
}

const extractors = new Map<string, Promise<FeatureExtractionPipeline>>();

function getExtractor(modelId: string): Promise<FeatureExtractionPipeline> {
  let existing = extractors.get(modelId);
  if (!existing) {
    existing = pipeline("feature-extraction", modelId, {
      dtype: "q8",
      device: "wasm",
    }) as Promise<FeatureExtractionPipeline>;
    // Don't poison the cache on a failed load (e.g. offline first run).
    existing.catch(() => {
      extractors.delete(modelId);
    });
    extractors.set(modelId, existing);
  }
  return existing;
}

async function handle(req: HostRequest): Promise<HostResponse> {
  try {
    const extractor = await getExtractor(req.modelId);
    const prefix = EMBEDDING_PREFIXES[req.kind];
    const output = await extractor(
      req.texts.map((t) => prefix + t),
      { pooling: "mean", normalize: true },
    );
    const data = output.data as Float32Array;
    const [rows, dim] = output.dims.length === 2 ? output.dims : [1, output.dims[0]!];
    const vectors: ArrayBuffer[] = [];
    for (let i = 0; i < rows!; i++) {
      vectors.push(data.slice(i * dim!, (i + 1) * dim!).buffer as ArrayBuffer);
    }
    return { id: req.id, ok: true, vectors };
  } catch (err) {
    return { id: req.id, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

window.embedHost.onRequest((req) => {
  void handle(req).then((resp) => window.embedHost.respond(resp));
});
