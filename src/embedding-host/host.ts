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
 * Protocol: main sends an identity envelope plus the embedding payload. The
 * host echoes the envelope so main can reject stale/cross-window responses.
 */

import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { EMBEDDING_PREFIXES } from "../host/local-embeddings.js";

type HostIdentity = {
  protocolVersion: 1;
  providerNonce: string;
  generation: number;
  requestNonce: string;
  id: number;
};
type HostRequest = HostIdentity & {
  texts: string[];
  kind: "document" | "query";
  modelId: string;
};
type HostResponse =
  | (HostIdentity & { ok: true; rows: number; dim: number; vectors: ArrayBuffer[] })
  | (HostIdentity & { ok: false; error: string });

type HostSession = Pick<HostIdentity, "protocolVersion" | "providerNonce" | "generation">;

declare global {
  interface Window {
    embedHost: {
      onInit(cb: (identity: HostSession) => void): void;
      ready(identity: HostSession): void;
      onRequest(cb: (req: unknown) => void): void;
      respond(resp: HostResponse): void;
    };
  }
}

const extractors = new Map<string, Promise<FeatureExtractionPipeline>>();
const MAX_EMBED_BATCH = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hostIdentity(value: unknown): HostIdentity | null {
  if (!isRecord(value)) return null;
  if (value["protocolVersion"] !== 1
    || typeof value["providerNonce"] !== "string"
    || !Number.isSafeInteger(value["generation"])
    || typeof value["requestNonce"] !== "string"
    || !Number.isSafeInteger(value["id"])) return null;
  return {
    protocolVersion: 1,
    providerNonce: value["providerNonce"],
    generation: value["generation"] as number,
    requestNonce: value["requestNonce"],
    id: value["id"] as number,
  };
}

function isHostRequest(value: unknown): value is HostRequest {
  return hostIdentity(value) !== null
    && isRecord(value)
    && Array.isArray(value["texts"])
    && value["texts"].length > 0
    && value["texts"].length <= MAX_EMBED_BATCH
    && value["texts"].every((text) => typeof text === "string")
    && (value["kind"] === "document" || value["kind"] === "query")
    && typeof value["modelId"] === "string";
}

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
  const identity: HostIdentity = {
    protocolVersion: req.protocolVersion,
    providerNonce: req.providerNonce,
    generation: req.generation,
    requestNonce: req.requestNonce,
    id: req.id,
  };
  try {
    const extractor = await getExtractor(req.modelId);
    const prefix = EMBEDDING_PREFIXES[req.kind];
    const output = await extractor(
      req.texts.map((t) => prefix + t),
      { pooling: "mean", normalize: true },
    );
    const data = output.data as Float32Array;
    const [rows, dim] = output.dims.length === 2 ? output.dims : [1, output.dims[0]!];
    if (req.protocolVersion !== 1
      || rows !== req.texts.length
      || dim !== 768
      || data.length !== rows * dim
      || data.some((value) => !Number.isFinite(value))) {
      throw new Error("embedding model returned an invalid vector shape");
    }
    const vectors: ArrayBuffer[] = [];
    for (let i = 0; i < rows; i++) {
      vectors.push(data.slice(i * dim, (i + 1) * dim).buffer as ArrayBuffer);
    }
    return { ...identity, ok: true, rows, dim, vectors };
  } catch (err) {
    return { ...identity, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// WASM inference is intentionally single-flight. Multiple concurrent model
// runs multiply the same large activation buffers and can make the hidden
// renderer look like an application-wide memory leak.
let inferenceTail: Promise<void> = Promise.resolve();
window.embedHost.onRequest((payload) => {
  if (!isHostRequest(payload)) {
    const identity = hostIdentity(payload);
    if (identity) {
      window.embedHost.respond({ ...identity, ok: false, error: "invalid embedding request" });
    }
    return;
  }
  const req = payload;
  inferenceTail = inferenceTail.catch(() => undefined).then(async () => {
    const response = await handle(req);
    window.embedHost.respond(response);
  });
  void inferenceTail.catch(() => undefined);
});

window.embedHost.onInit((identity) => {
  if (identity.protocolVersion === 1) window.embedHost.ready(identity);
});
