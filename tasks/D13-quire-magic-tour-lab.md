# D13 — Quire `/magic` Tour Lab hardening

## Objective

Promote the isolated Quire `/magic` Tour Lab from a manually proven visual experiment to a replayable, measurable, Luna-only functional system. Keep the work under `lab/tour-lab/`; this task does not authorize a port into the main Scripture app.

## Human decisions

- Both listening-tour search and per-clip visual direction use `openai/gpt-5.6-luna` through OpenRouter.
- Sol is not used for `/magic` development or visual testing.
- Preserve the existing division of responsibility: the model selects semantic directions and transcript cues; house code owns markup, coordinates, layout, collision handling, timing, and animation.
- Model-backed fixtures may be captured with Luna. Once captured, layout, seeking, responsive, motion, and accessibility verification must replay locally without another paid call.

## Scope

- `lab/tour-lab/model-client.mjs`
- `lab/tour-lab/server.mjs`
- `lab/tour-lab/magic.js`, `magic.html`, and `magic.css`
- New Tour Lab-only contract, evidence, replay, and test files
- `STATUS.md` delivery evidence

Out of scope:

- Main renderer, Electron, Substrate, source packages, or app navigation
- Changing the frozen Scripture-Native Knowledge Library specification
- Autonomous writes to authored library data

## Required gates

### Gate 1 — one explicit Luna route

- Search, whispers, form selection, and visual direction name the same Luna/OpenRouter role contract.
- `/api/direct` cannot silently fall back to Sol or accept an accidental Sol test override.
- Returned evidence identifies requested and resolved model, provider, endpoint style, and reasoning effort without exposing credentials.

### Gate 2 — one paid call per logical direction

- Director cache identity includes model, schema version, record id, and clip bounds.
- In-flight requests are cached immediately, so prefetch and Play cannot buy the same direction twice.
- Starting another tour aborts or invalidates all earlier search, whisper, form, and director results.
- Director prefetch uses explicit bounded concurrency.

### Gate 3 — versioned direction and evidence

- Durable director output carries a schema version.
- Every model pass records role, latency, input/output/reasoning/cached tokens, provider cost, finish reason, resolved model, and validation outcome.
- Each completed direction records total wall time, passes, cost, normalized scene counts, and rejection/drop information.
- Evidence is append-only and contains no key or secret.

### Gate 4 — final scene/timeline contract

- One final normalization runs after every repair and gap-fill pass.
- Scene and artifact caps are enforced on the combined output, not only the first model response.
- Aside economy is re-applied after gap filling.
- Every event is finite and clamped to its owning scene and clip.
- House-invented times are deconflicted; cue- and word-anchored times retain transcript truth.
- The replay validator refuses unsupported newer schema versions.

### Gate 5 — cost-free replay

- A versioned fixture format can carry the tour, form, whispers, and per-clip director results.
- `/magic` can load a named local fixture without invoking `/api/tour`, `/api/whispers`, `/api/form`, or model-backed `/api/direct`.
- Contract tests prove fixture refusal, normalization, cache identity, role routing, and evidence redaction.

### Gate 6 — runtime hardening

- Seeking reconstructs the correct scene without replaying spent transient highlights.
- Resize and orientation changes redraw measured loom geometry.
- Repeated displayed words can be anchored deterministically rather than always selecting the first occurrence.
- Reduced motion covers both transitions and keyframe animations.
- The theater slider exposes current/min/max values and keyboard semantics.
- Mobile and desktop layouts avoid clipped labels, fixed-control overlap, and stale routes.

## Acceptance evidence

- Focused Node contract tests pass without network access.
- A saved Luna-generated direction passes the replay validator.
- Replay is visibly checked at mobile and desktop widths, light and dark themes, including seek-back, seek-forward, and resize.
- Browser console contains no errors during the replay matrix.
- No Sol request is made, and no test requires an OpenRouter call after fixture capture.
- `git diff` contains no main-app port and preserves unrelated user changes.

## Status

In progress.

