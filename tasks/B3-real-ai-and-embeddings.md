# TASK B3: Real AI and Embeddings — L1 -> L2-L3

PRECONDITION: A0, A1, B1 complete. B2 in progress (read-screen redesign landed; the Living Margin surfaces this task feeds are already built).

READ: spec §4.4 (embeddings excluded from rebuild_hash), §4.9 (broker), §4.10 (Budget Envelope, AI/embedding interfaces); `AGENTS.md` INV-1, INV-2, INV-6, INV-10, INV-14, INV-16, INV-17, INV-18; `STATUS.md` row "M3 AI plumbing".

CURRENT STATE: The governance skeleton is real (broker interfaces, BudgetManager, JobQueue, embeddings.sqlite, claims/overlays/threads tables, pin/promote promotion paths through RevisionStore). The intelligence inside it is mock: `main.ts` hard-codes `MockAIProvider`/`MockEmbeddingProvider`; the `semantic-margin` IPC handler hard-codes the bag-of-words `deterministicEmbedding`; nothing extracts claims/threads in-app; `suggestedCrossRefs` are circular (echo claim anchors of the queried range); the margin "AI Insight" block displays the first retrieved artifact, generating nothing.

## Progress — 2026-07-01 (Gate 2 landed + Gate 3 extraction contract proven live)

**Embedding model decision re-verified before implementing** (user request):
- Qwen3-Embedding-0.6B scores higher on MTEB but is operationally fragile — requires last-token pooling + instruct formatting; a documented real-world integration collapsed to 0.00 recall@5 when mis-wired. 2x params for CPU.
- nomic-embed-text is faster (137M) but weaker quality-per-token in this size class.
- **EmbeddingGemma-300m ONNX q8 confirmed**: mean pooling baked into the ONNX export (no pooling footgun), MRL, official transformers.js support. Asymmetric prefixes are MANDATORY and now contract-tested: query `"task: search result | query: "`, document `"title: none | text: "`.

**Gate 2 landed:**
- `@huggingface/transformers@4.2.0` (pinned; published 2026-04-22). `onnxruntime-node` is Node-API — confirmed no interaction with the better-sqlite3 ABI split. esbuild main bundle already uses `packages: "external"`, so no bundling change needed.
- `EmbeddingProvider` (core) gained `kind?: "document" | "query"` and `modelId`; `LocalEmbeddingProvider` in `src/host/local-embeddings.ts` (lazy load, retry-after-failure, cacheDir injected — `userData/models` in Electron).
- `embeddings.sqlite` gained `model` + `content_hash` columns; pre-Gate-2 table shape is dropped on open (Derived, INV-2/INV-10). Incremental sync factored into `src/host/embeddings-sync.ts` (shared by `embed-notes` IPC and scripts): skips unchanged content hashes, prunes on model switch.
- `semantic-margin` IPC no longer uses `deterministicEmbedding`: real query-role embedding, zero-vector graceful degradation (claims/threads/overlays still surface if the model is unavailable).
- **Live gate (`npm run smoke:embed`)**: 14-note seeded corpus (`npm run seed:notes`, `Library-demo`, fixed IDs, idempotent) — passage query ACT 19:1-7 ranks the Acts note at 80.4% with the Spirit/baptism cluster behind it; a paraphrase query with near-zero keyword overlap correctly surfaces the regeneration cluster (bag-of-words provably could not); admin distractor notes never surface; second sync skips 14/14 in 1ms. Per-query embed latency 83-138ms after load — fine for the interactive margin.

**Gate 3 groundwork (extraction contract, proven live):**
- `src/core/ai/claim-extraction.ts` (pure, INV-18): versioned prompt contract (`claims-v1`), strict field-by-field validation — anchors validated against real backbone verse counts, evidence mandatory (note IDs must exist; scripture refs shape-checked), invalid claims rejected with reasons, never repaired. Anti-injection rule pinned in the system prompt. 11 unit tests.
- `SQLiteMaterializer.deleteClaimsByExtractor` for idempotent job re-runs.
- **Live gate (`npm run smoke:extract`)**: DeepSeek (background latency, thinking on) extracted 5/5 valid claims from the 2 notes anchored to ACT 19:1-7, all grounded in actual note content with note-ID evidence, inserted into Derived and verified through the same `queryClaimsForRange` path the Living Margin renders. 19.5s, 3235 tokens.
- **Lesson learned:** with thinking enabled, reasoning consumes completion tokens BEFORE any JSON is emitted — `maxTokens: 2000` yielded an empty response (all 2000 eaten by reasoning). Background extraction calls must budget generously (8000 used).

**Scope decisions (human, 2026-07-01):**
- Gate 5 BYOK settings UI is descoped for now — `.env`-based configuration is acceptable; budget-envelope semantics + consent remain in scope.
- Gate 4/6 must include "derived artifacts look good in the app" and a real end-user live QA pass (CDP against the running app, seeded library) once the pipeline is complete.

**Verification:** `npm run lint` clean; `npm test` 112/112 (18 new; sqlite-backed tests skip gracefully under the Electron ABI to preserve A1's ABI-independence contract); `smoke:embed` + `smoke:extract` pass live.

## Progress — 2026-07-01 (Gate 1 landed)

- `AIRequest` (core) gained `responseFormat?: "text" | "json"` and `latency?: "interactive" | "background"` — transport-free, hosts map them.
- `OpenAIAIProvider` refactored to options-bag `OpenAICompatibleAIProvider` (was never constructed anywhere) with `supportsThinkingControl`; `createDeepSeekProvider(env)` factory added.
- New `src/host/env.ts`: dependency-free `.env` loader, real environment always wins.
- `main.ts` M3 init now selects real provider when `DEEPSEEK_API_KEY` is present, `MockAIProvider` otherwise; `get-ai-status` reports `provider` (`"deepseek" | "mock"`) and `model`.
- `.env` added to `.gitignore` before the key was written; key is temporary and must be rotated.
- Verification: `npm run lint` clean; `npm test` 94/94 (10 new tests: request shape incl. thinking/json knobs, error path, factory defaults/overrides, env loader semantics); `npm run smoke:ai` live against DeepSeek — 5 valid claims, all anchors backbone-validated, 553 tokens, 3.2s interactive latency (thinking confirmed disabled).

## Verified Engineering Facts (live-tested 2026-07-01)

- **DeepSeek API** (`https://api.deepseek.com`, OpenAI-compatible):
  - `/models` returns exactly `deepseek-v4-flash` and `deepseek-v4-pro`. `deepseek-chat`/`deepseek-reasoner` are deprecated 2026-07-24 — do not target them.
  - Chat completions work with `response_format: {"type":"json_object"}`; a claim-extraction-shaped prompt returned well-formed JSON with correct USFM codes and per-claim verse anchors.
  - **Thinking is ON by default** for `deepseek-v4-flash` (568 reasoning tokens on a small extraction; multi-second latency). `"thinking": {"type":"disabled"}` works and produced a 1.5s round-trip. Rule: interactive margin calls disable thinking; background extraction jobs may enable it.
  - **No embeddings API**: `/embeddings` and `/v1/embeddings` both 404, and no embedding model is listed. Embeddings MUST come from elsewhere.
- **Decision (human, 2026-07-01): local embeddings.** `@huggingface/transformers` + `onnxruntime-node` in the Electron main process. `onnxruntime-node` is Node-API (`napi-v3`) — ABI-stable across Node/Electron, so it does NOT join the better-sqlite3 `rebuild:node`/`rebuild:electron` split. Known gotchas: esbuild main-process bundle must externalize it; future packaged builds need asar-unpack for `.node`/`.dylib` binaries.
  - Default model: EmbeddingGemma-300m ONNX (768-dim, multilingual, Matryoshka-truncatable to 256/128). Fallback/low-resource option: all-MiniLM-L6-v2 (384-dim, ~23MB, 256-token truncation).
- **Key handling:** `DEEPSEEK_API_KEY` lives in `.env` (now gitignored). It was shared over chat and is treated as temporary — **rotate it** before anything ships. `safeStorage`-backed key entry is Gate 5.

## Design Decisions

- Provider config is app-level, not library-level: env (`DEEPSEEK_API_KEY`, `DEEPSEEK_BASE_URL`, `DEEPSEEK_MODEL`) first, settings UI + `safeStorage` at Gate 5. The Substrate never stores keys.
- `AIRequest` (core, INV-18) gains optional `responseFormat?: "text" | "json"` and `latency?: "interactive" | "background"`. Hosts map these to provider-specific knobs (DeepSeek: `response_format`, `thinking`). Core stays transport-free.
- Budget semantics (INV-16): `backgroundAI: "off" | "local-only" | "cloud"` maps to — local embedding work allowed under `local-only`+; any DeepSeek call requires `cloud`; user-initiated (interactive) calls still record spend and respect the daily token ceiling. Today `ai-invoke` blocks even interactive calls when the envelope is `off`; the interactive/background distinction gets wired properly at Gate 5.
- Embeddings store gains `model`, and content-hash columns; changing model/dim invalidates (drop and re-embed — Derived, INV-2/INV-10, always safe).
- Every AI-written artifact records `extractor` as `<model>@<prompt-version>` (e.g. `deepseek-v4-flash@claims-v1`) so Derived rebuilds are explainable (INV-17 spirit).
- All extraction output is validated before insert: JSON shape checked field-by-field (no `any`), anchors validated against `backbone.json` (INV-6); invalid items dropped and logged to the job record, never "best-effort fixed".
- Prompt-injection posture: note/source text entering prompts is data, never instructions; extraction calls have no tool use; system prompts pin the output contract.

## Gates (one per session, in order)

### Gate 1 — Real LLM provider path (THIS SESSION)
- `.env` loader in host (no new dep), non-overriding of existing `process.env`.
- Refactor `OpenAIAIProvider` → options-bag `OpenAICompatibleAIProvider` honoring `responseFormat`/`latency`; `createDeepSeekProvider(env)` factory (thinking disabled for interactive, enabled for background).
- `main.ts` M3 init: real provider when key present, mock otherwise; `get-ai-status` reports which.
- Unit tests with stubbed `fetch` (request shape: model, thinking, response_format; response parsing; error path; factory without key → null).
- `npm run smoke:ai`: live DeepSeek claim-extraction call, JSON validated, tokens + latency printed.
- Exit: `npm test` green, `npm run lint` clean, smoke script passes live, mock fallback intact with no key.

### Gate 2 — Local embedding provider
- Add `@huggingface/transformers`; `LocalEmbeddingProvider implements EmbeddingProvider` (EmbeddingGemma-300m ONNX q8), model cached under `app.getPath("userData")/models/`, lazy-loaded off the critical launch path.
- Externalize `onnxruntime-node`/`@huggingface/transformers` in `scripts/build-electron.mjs`.
- Embeddings table: add `model` + `content_hash`; `embed-notes` becomes incremental (skip unchanged hashes); model change clears the store.
- Replace hard-coded `deterministicEmbedding` in the `semantic-margin` handler with the injected provider; keep deterministic as explicit test fallback only.
- Exit: Related Notes for a test passage differ meaningfully from bag-of-words results; re-running embed-notes skips unchanged notes; first-run model download has visible progress + failure state.

### Gate 3 — Real extraction jobs
- Implement `extract-claims`, `generate-thread`, `suggest-xrefs` JobQueue jobs against the real provider (background latency class, budget-clamped, spend recorded per job).
- Claims: batch notes+passage context → validated claims with anchors AND populated `ClaimSource` evidence spans (currently always `[]` — unacceptable for this domain).
- Fix circular `suggestedCrossRefs`: scripture↔scripture embedding similarity over chapter/pericope vectors (canon is static — embed once at package install) + LLM rerank; never echo the queried range.
- Threads: cluster by embedding + LLM label/summary; `semantic-margin` filters threads by passage relevance instead of `getAllThreads()`.
- Exit: from a seeded library, one budget-bounded background run produces claims/threads/xrefs that are valid (Doctor-clean), Derived-only, and visibly attributed in the margin.

### Gate 4 — Reading-layer truthfulness
- "AI Insight" becomes a real passage-scoped synthesis call (interactive, thinking-disabled), grounded in verse text + surfaced notes, with citations; persisted per-passage in Derived so it survives sessions and rebuilds regenerate it.
- Claims cards show evidence ("why am I seeing this") instead of raw confidence %; similarity % badges removed in favor of provenance affordances.
- Margin AI states: queued / running / failed-with-retry / budget-exhausted, all visible and non-blocking.
- Exit: pinning a passage with notes yields a grounded, cited insight; killing the network mid-call degrades visibly and recoverably.

### Gate 5 — Budget semantics + consent (BYOK settings UI descoped 2026-07-01)
- DESCOPED for now (human decision): key entry UI / `safeStorage` / model picker. `.env`-based configuration remains the supported path until a future session revisits it.
- Still in scope: wire `off`/`local-only`/`cloud` end-to-end (`local-only` permits local embeddings but blocks DeepSeek; interactive vs background enforced at the broker), first-cloud-call consent copy, usage meter + job log surfacing errors.
- Exit: envelope settings provably gate the right calls; a user with `.env` configured sees usage and failures honestly in Settings.

### Gate 6 — Rebuild seam + end-user acceptance (hands off to B4)
- Delete `.system/embeddings.sqlite` + all Derived AI artifacts → background jobs regenerate them; `rebuild_hash` unaffected (INV-10); extractor versions recorded throughout.
- Derived artifacts must LOOK GOOD in the app: claims/threads/related-notes cards reviewed in the real Living Margin (typography, density, provenance affordances), not just present in SQLite.
- Full end-user live QA pass: launch the app against the seeded `Library-demo` (`LIBRARY_PATH` env), drive it via CDP + manual reading flow, and verify what a reader actually sees — margin content quality, latency feel, loading/failure states, no placeholder text anywhere.

## Out Of Scope

- sqlite-vec / ANN indexing (revisit when brute-force cosine over real note counts measurably hurts; the store swap is isolated behind `EmbeddingsStore`).
- Streaming token UI (worthwhile, but after Gate 4's persistence shape exists).
- Plugin-facing `ai:invoke` capability hardening (C3 territory).
- Original-language / morphology data.
- Mobile/iOS provider story.

## Done When (task-level)

- No mock provider on any user-reachable path when a key + local model are present; mock remains only as keyless fallback and test double.
- Semantic resurfacing runs on real local embeddings with incremental invalidation.
- Claims/threads/cross-refs are real, validated, evidence-bearing, budget-clamped, Derived-only, and user-promotable (INV-1 paths unchanged).
- The margin's AI content is grounded and cited; nothing in the UI implies intelligence that is actually a placeholder.
- `STATUS.md` "M3 AI plumbing" promoted L1 → L2 (L3 after Gates 5-6 harden).
