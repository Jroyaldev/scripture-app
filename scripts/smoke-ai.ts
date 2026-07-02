/**
 * B3 Gate 1 smoke test — live DeepSeek call through the real provider path.
 * Requires DEEPSEEK_API_KEY in .env (repo root) or the environment.
 * Exercises: provider factory, interactive (thinking-disabled) latency class,
 * JSON response format, and claim-shaped output validation.
 *
 * Run: npm run smoke:ai
 */

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnvFile } from "../src/host/env.js";
import { createDeepSeekProvider } from "../src/host/ai-provider.js";
import { isValidBookCode } from "../src/core/reference/backbone.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type SmokeClaim = {
  assertion: string;
  claimType: string;
  confidence: number;
  anchors: { book: string; chapter: number; verse: number }[];
};

function fail(msg: string): never {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

function parseClaims(text: string): SmokeClaim[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`response is not valid JSON: ${text.slice(0, 200)}`);
  }
  const obj = parsed as Record<string, unknown>;
  const claims = Array.isArray(obj["claims"]) ? (obj["claims"] as unknown[]) : null;
  if (!claims || claims.length === 0) fail("no claims array in response");
  return claims.map((c, i) => {
    const rec = c as Record<string, unknown>;
    if (typeof rec["assertion"] !== "string") fail(`claim[${i}].assertion missing`);
    if (typeof rec["confidence"] !== "number") fail(`claim[${i}].confidence missing`);
    if (!Array.isArray(rec["anchors"])) fail(`claim[${i}].anchors missing`);
    return rec as SmokeClaim;
  });
}

async function main(): Promise<void> {
  loadEnvFile(resolve(__dirname, "../.env"));
  const provider = createDeepSeekProvider(process.env);
  if (!provider) fail("no DEEPSEEK_API_KEY configured (.env or environment)");

  console.log(`provider model: ${provider.model}`);

  const started = Date.now();
  const resp = await provider.invoke({
    context:
      'You extract theological claims from scripture passages. Respond ONLY with a JSON object: {"claims":[{"assertion":string,"claimType":"theological"|"historical"|"literary","confidence":number,"anchors":[{"book":string,"chapter":number,"verse":number}]}]}. Book codes are USFM 3-letter uppercase.',
    prompt:
      'Passage: ACT 19:1-7 (WEB). While Apollos was at Corinth, Paul came to Ephesus and found certain disciples. He said to them, "Did you receive the Holy Spirit when you believed?" They said, "No, we have not even heard that there is a Holy Spirit." They were baptized in the name of the Lord Jesus. When Paul had laid his hands on them, the Holy Spirit came on them and they spoke with other languages and prophesied.',
    responseFormat: "json",
    latency: "interactive",
    maxTokens: 800,
  });
  const elapsedMs = Date.now() - started;

  const claims = parseClaims(resp.text);
  for (const [i, claim] of claims.entries()) {
    for (const anchor of claim.anchors) {
      if (!isValidBookCode(anchor.book)) fail(`claim[${i}] anchor has invalid book code: ${anchor.book}`);
    }
  }

  console.log(`claims extracted: ${claims.length}`);
  for (const c of claims) {
    console.log(`  - [${c.claimType}, ${(c.confidence * 100).toFixed(0)}%] ${c.assertion}`);
  }
  console.log(`tokens used: ${resp.tokensUsed}`);
  console.log(`latency: ${elapsedMs}ms (interactive / thinking disabled)`);
  if (elapsedMs > 15000) fail(`interactive latency ${elapsedMs}ms suggests thinking was not disabled`);
  console.log("SMOKE PASS");
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
