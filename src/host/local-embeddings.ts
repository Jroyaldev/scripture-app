/**
 * Local Embedding Provider — Node host layer (Task B3, Gate 2).
 * Runs EmbeddingGemma-300m ONNX on-device via @huggingface/transformers
 * (onnxruntime-node is Node-API based: ABI-stable across Node/Electron,
 * no rebuild:node / rebuild:electron split needed).
 *
 * EmbeddingGemma requires asymmetric prompt prefixes — retrieval quality
 * silently degrades without them (model card, verified 2026-07-01):
 *   query:    "task: search result | query: "
 *   document: "title: none | text: "
 *
 * The model (~300MB q8) is downloaded once from the HF Hub into cacheDir
 * and loaded lazily off the critical launch path.
 */

import type { EmbeddingKind, EmbeddingProvider } from "../core/interfaces.js";

export const EMBEDDING_PREFIXES: Record<EmbeddingKind, string> = {
  query: "task: search result | query: ",
  document: "title: none | text: ",
};

/**
 * Prepend the correct asymmetric-retrieval prefix. Exported for tests.
 *
 * A document may carry a title, which goes in the slot the default leaves as
 * "none". Only documents have one — the query prompt has no such field, so a
 * title passed with a query is ignored rather than silently mangling the
 * prompt into something the model was never trained on.
 */
export function prefixTexts(
  texts: string[],
  kind: EmbeddingKind,
  titles?: readonly string[],
): string[] {
  if (kind === "document" && titles) {
    return texts.map((t, i) => {
      const title = titles[i]?.trim();
      return `title: ${title && title.length > 0 ? title : "none"} | text: ${t}`;
    });
  }
  const prefix = EMBEDDING_PREFIXES[kind];
  return texts.map((t) => prefix + t);
}

export const DEFAULT_MODEL_ID = "onnx-community/embeddinggemma-300m-ONNX";

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: "mean"; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

export type LocalEmbeddingOptions = {
  /** HF Hub model id. Env override: EMBEDDING_MODEL. */
  modelId?: string;
  /** Directory for the downloaded model cache (e.g. userData/models). */
  cacheDir?: string;
};

export class LocalEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 768;
  readonly modelId: string;
  private cacheDir: string | undefined;
  private extractorPromise: Promise<FeatureExtractor> | null = null;

  constructor(opts: LocalEmbeddingOptions = {}) {
    this.modelId = opts.modelId ?? process.env["EMBEDDING_MODEL"] ?? DEFAULT_MODEL_ID;
    this.cacheDir = opts.cacheDir;
  }

  /** True once the pipeline has been requested (not necessarily loaded). */
  get started(): boolean {
    return this.extractorPromise !== null;
  }

  private getExtractor(): Promise<FeatureExtractor> {
    if (!this.extractorPromise) {
      this.extractorPromise = this.load();
      // A failed load must not poison the provider forever (e.g. first-run
      // download interrupted): clear the promise so the next call retries.
      this.extractorPromise.catch(() => {
        this.extractorPromise = null;
      });
    }
    return this.extractorPromise;
  }

  private async load(): Promise<FeatureExtractor> {
    const { pipeline, env } = await import("@huggingface/transformers");
    if (this.cacheDir) {
      env.cacheDir = this.cacheDir;
    }
    const extractor = await pipeline("feature-extraction", this.modelId, {
      dtype: "q8",
    });
    return extractor as unknown as FeatureExtractor;
  }

  async embed(
    texts: string[],
    kind: EmbeddingKind = "document",
    titles?: readonly string[],
  ): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extractor = await this.getExtractor();
    const output = await extractor(prefixTexts(texts, kind, titles), {
      pooling: "mean",
      normalize: true,
    });

    const [rows, dim] = output.dims.length === 2 ? output.dims : [1, output.dims[0] ?? this.dim];
    const results: Float32Array[] = [];
    for (let i = 0; i < (rows ?? texts.length); i++) {
      results.push(output.data.slice(i * (dim ?? this.dim), (i + 1) * (dim ?? this.dim)));
    }
    return results;
  }
}
