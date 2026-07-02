import assert from "node:assert/strict";
import { test, afterEach } from "node:test";
import {
  OpenAICompatibleAIProvider,
  createDeepSeekProvider,
} from "../src/host/ai-provider.js";
import { loadEnvFile } from "../src/host/env.js";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

type CapturedRequest = { url: string; body: Record<string, unknown>; auth: string | undefined };

function stubFetch(
  responseBody: unknown,
  status = 200,
): { captured: CapturedRequest[] } {
  const captured: CapturedRequest[] = [];
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
      auth: (init?.headers as Record<string, string> | undefined)?.["Authorization"],
    });
    return new Response(JSON.stringify(responseBody), { status });
  }) as typeof fetch;
  return { captured };
}

const okCompletion = {
  choices: [{ message: { content: '{"claims":[]}' } }],
  usage: { total_tokens: 42 },
};

test("interactive request disables thinking and sets json response_format", async () => {
  const { captured } = stubFetch(okCompletion);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    supportsThinkingControl: true,
  });

  const resp = await provider.invoke({
    prompt: "extract claims",
    context: "system contract",
    responseFormat: "json",
    latency: "interactive",
  });

  assert.equal(resp.text, '{"claims":[]}');
  assert.equal(resp.tokensUsed, 42);

  const req = captured[0]!;
  assert.equal(req.url, "https://api.deepseek.com/chat/completions");
  assert.equal(req.auth, "Bearer sk-test");
  assert.equal(req.body["model"], "deepseek-v4-flash");
  assert.deepEqual(req.body["thinking"], { type: "disabled" });
  assert.deepEqual(req.body["response_format"], { type: "json_object" });
  assert.deepEqual(req.body["messages"], [
    { role: "system", content: "system contract" },
    { role: "user", content: "extract claims" },
  ]);
});

test("background latency enables thinking", async () => {
  const { captured } = stubFetch(okCompletion);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    supportsThinkingControl: true,
  });

  await provider.invoke({ prompt: "p", latency: "background" });
  assert.deepEqual(captured[0]!.body["thinking"], { type: "enabled" });
});

test("latency defaults to interactive (thinking disabled)", async () => {
  const { captured } = stubFetch(okCompletion);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    supportsThinkingControl: true,
  });

  await provider.invoke({ prompt: "p" });
  assert.deepEqual(captured[0]!.body["thinking"], { type: "disabled" });
});

test("no thinking field when provider does not support thinking control", async () => {
  const { captured } = stubFetch(okCompletion);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  });

  await provider.invoke({ prompt: "p", latency: "background" });
  assert.equal("thinking" in captured[0]!.body, false);
});

test("text responseFormat (default) sends no response_format", async () => {
  const { captured } = stubFetch(okCompletion);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-test",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    supportsThinkingControl: true,
  });

  await provider.invoke({ prompt: "p" });
  assert.equal("response_format" in captured[0]!.body, false);
});

test("non-ok response throws a typed error with status", async () => {
  stubFetch({ error: "invalid key" }, 401);
  const provider = new OpenAICompatibleAIProvider({
    apiKey: "sk-bad",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
  });

  await assert.rejects(
    () => provider.invoke({ prompt: "p" }),
    (err: Error) => err.message.includes("AI provider error 401"),
  );
});

test("createDeepSeekProvider returns null without a key", () => {
  assert.equal(createDeepSeekProvider({}), null);
  assert.equal(createDeepSeekProvider({ DEEPSEEK_API_KEY: undefined }), null);
});

test("createDeepSeekProvider defaults base URL and model, honors overrides", () => {
  const dflt = createDeepSeekProvider({ DEEPSEEK_API_KEY: "sk-x" });
  assert.ok(dflt);
  assert.equal(dflt.model, "deepseek-v4-flash");

  const overridden = createDeepSeekProvider({
    DEEPSEEK_API_KEY: "sk-x",
    DEEPSEEK_MODEL: "deepseek-v4-pro",
  });
  assert.ok(overridden);
  assert.equal(overridden.model, "deepseek-v4-pro");
});

test("loadEnvFile parses KEY=VALUE, skips comments, never overrides process.env", () => {
  const dir = mkdtempSync(join(tmpdir(), "env-test-"));
  try {
    const envPath = join(dir, ".env");
    process.env["ENV_TEST_EXISTING"] = "original";
    writeFileSync(
      envPath,
      "# comment\n\nENV_TEST_NEW=hello\nENV_TEST_EXISTING=overridden\nENV_TEST_QUOTED=\"quoted value\"\nnot-a-pair\n",
    );

    const loaded = loadEnvFile(envPath);
    assert.equal(loaded["ENV_TEST_NEW"], "hello");
    assert.equal(process.env["ENV_TEST_NEW"], "hello");
    assert.equal(process.env["ENV_TEST_EXISTING"], "original");
    assert.equal(loaded["ENV_TEST_QUOTED"], "quoted value");
    assert.equal("not-a-pair" in loaded, false);
  } finally {
    delete process.env["ENV_TEST_NEW"];
    delete process.env["ENV_TEST_EXISTING"];
    delete process.env["ENV_TEST_QUOTED"];
    rmSync(dir, { recursive: true, force: true });
  }
});

test("loadEnvFile on a missing file returns empty and does not throw", () => {
  const loaded = loadEnvFile("/nonexistent/path/.env");
  assert.deepEqual(loaded, {});
});
