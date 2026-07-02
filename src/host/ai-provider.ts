/**
 * AI Provider — Node host layer.
 * BYOK implementation supporting OpenAI-compatible APIs.
 * Falls back to a deterministic mock when no API key is configured.
 */

import type { AIProvider, AIRequest, AIResponse } from "../core/interfaces.js";
import { deterministicEmbedding } from "../core/ai/similarity.js";

export type OpenAICompatibleOptions = {
  apiKey: string;
  baseUrl: string;
  model: string;
  /**
   * Provider accepts DeepSeek-style `thinking: {type}` body control.
   * When true, `latency: "interactive"` disables thinking (fast path)
   * and `latency: "background"` enables it. When false, no thinking
   * field is ever sent.
   */
  supportsThinkingControl?: boolean;
};

export class OpenAICompatibleAIProvider implements AIProvider {
  readonly model: string;
  private apiKey: string;
  private baseUrl: string;
  private supportsThinkingControl: boolean;

  constructor(opts: OpenAICompatibleOptions) {
    this.apiKey = opts.apiKey;
    this.baseUrl = opts.baseUrl;
    this.model = opts.model;
    this.supportsThinkingControl = opts.supportsThinkingControl ?? false;
  }

  async invoke(req: AIRequest): Promise<AIResponse> {
    const body: Record<string, unknown> = {
      model: this.model,
      messages: [
        ...(req.context ? [{ role: "system" as const, content: req.context }] : []),
        { role: "user" as const, content: req.prompt },
      ],
      max_tokens: req.maxTokens ?? 1000,
      stream: false,
    };

    if (req.responseFormat === "json") {
      body["response_format"] = { type: "json_object" };
    }

    if (this.supportsThinkingControl) {
      const latency = req.latency ?? "interactive";
      body["thinking"] = { type: latency === "interactive" ? "disabled" : "enabled" };
    }

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`AI provider error ${resp.status}: ${errText}`);
    }

    const data = (await resp.json()) as {
      choices: { message: { content: string } }[];
      usage: { total_tokens: number };
    };

    return {
      text: data.choices[0]?.message?.content ?? "",
      tokensUsed: data.usage?.total_tokens ?? 0,
    };
  }
}

/**
 * Mock AI provider — deterministic, no network.
 * Used for testing and as fallback when no API key is configured.
 */
export class MockAIProvider implements AIProvider {
  async invoke(req: AIRequest): Promise<AIResponse> {
    const prompt = req.prompt.toLowerCase();

    let text = "";
    if (prompt.includes("cross-ref") || prompt.includes("cross reference")) {
      text = JSON.stringify([
        { target: "ACT.2.38", reason: "Repent and be baptized" },
        { target: "ACT.8.36", reason: "Ethiopian eunuch baptism" },
        { target: "JHN.3.5", reason: "Born of water and Spirit" },
      ]);
    } else if (prompt.includes("claim") || prompt.includes("assertion")) {
      text = JSON.stringify([
        {
          assertion: "The Holy Spirit is given through baptism in Jesus' name",
          claimType: "theological",
          confidence: 0.85,
          anchors: [{ book: "ACT", chapter: 19, verse: 2 }],
        },
      ]);
    } else if (prompt.includes("thread") || prompt.includes("cluster")) {
      text = JSON.stringify([
        {
          label: "Spirit and Baptism in Acts",
          noteIds: [],
          summary: "The Spirit/baptism sequence across Acts 2, 8, 10, and 19",
        },
      ]);
    } else {
      text = "Mock AI response for: " + req.prompt.slice(0, 100);
    }

    return {
      text,
      tokensUsed: Math.ceil(req.prompt.length / 4),
    };
  }
}

/**
 * Mock Embedding Provider — deterministic, no network.
 * Uses the deterministicEmbedding function from core/ai/similarity.
 */
export class MockEmbeddingProvider {
  readonly dim = 256;
  readonly modelId = "mock-bow-256";

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => deterministicEmbedding(t, this.dim));
  }
}

/**
 * OpenAI Embedding Provider — uses OpenAI-compatible API.
 */
export class OpenAIEmbeddingProvider {
  readonly dim: number;
  readonly modelId: string;
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(apiKey: string, baseUrl = "https://api.openai.com/v1", model = "text-embedding-3-small", dim = 1536) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
    this.modelId = model;
    this.dim = dim;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const body = { model: this.model, input: texts };
    const resp = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      throw new Error(`Embedding provider error ${resp.status}: ${await resp.text()}`);
    }

    const data = (await resp.json()) as {
      data: { embedding: number[] }[];
    };

    return data.data.map((d) => new Float32Array(d.embedding));
  }
}

/**
 * DeepSeek provider factory (Task B3, Gate 1).
 * Reads DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_MODEL from the given
 * env map (typically process.env). Returns null when no key is configured —
 * callers fall back to MockAIProvider.
 *
 * DeepSeek v4 has thinking ON by default; supportsThinkingControl lets
 * interactive requests disable it (verified ~1.5s round-trip vs multi-second
 * with reasoning). Note: DeepSeek has NO embeddings API (verified 404) —
 * embeddings come from the local provider (Gate 2).
 */
export function createDeepSeekProvider(
  env: Record<string, string | undefined>,
): OpenAICompatibleAIProvider | null {
  const apiKey = env["DEEPSEEK_API_KEY"];
  if (!apiKey) return null;
  return new OpenAICompatibleAIProvider({
    apiKey,
    baseUrl: env["DEEPSEEK_BASE_URL"] ?? "https://api.deepseek.com",
    model: env["DEEPSEEK_MODEL"] ?? "deepseek-v4-flash",
    supportsThinkingControl: true,
  });
}
