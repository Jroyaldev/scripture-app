import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (path: string): string => readFileSync(resolve(repoRoot, path), "utf8");

test("Electron records renderer and child-process failures outside Library substrate", () => {
  const main = read("src/electron/main.ts");

  assert.match(main, /app\.getPath\("logs"\)/);
  assert.doesNotMatch(main, /APP_LOG_PATH[\s\S]{0,240}getLibraryPath/);
  assert.match(main, /crashReporter\.start\(\{[\s\S]*uploadToServer:\s*false/);
  assert.match(main, /process\.on\("uncaughtExceptionMonitor"/);
  assert.match(main, /app\.on\("child-process-gone"/);
  assert.match(main, /webContents\.on\("render-process-gone"/);
  assert.match(main, /reason:\s*details\.reason/);
  assert.match(main, /exitCode:\s*details\.exitCode/);
  assert.match(main, /webContents\.on\("did-fail-load"/);
  assert.match(main, /webContents\.on\("preload-error"/);
  assert.match(main, /win\.on\("unresponsive"/);
  assert.match(main, /buttons:\s*\["Reload Window",\s*"Quit"\]/);
  assert.doesNotMatch(main, /render-process-gone[\s\S]{0,500}\bwin\.reload\(\)/,
    "renderer failure must not immediately trigger an automatic reload");
});

test("library cutover is reversible before commit and retires only after publish", () => {
  const main = read("src/electron/main.ts");

  const switchStart = main.indexOf("function initializeEngine(");
  const switchEnd = main.indexOf("async function shutdownRuntimeForQuit", switchStart);
  assert.notEqual(switchStart, -1);
  assert.notEqual(switchEnd, -1);
  const cutover = main.slice(switchStart, switchEnd);
  assert.match(cutover, /const candidate = buildEngineRuntime/);
  assert.match(cutover, /freezeRuntimeOperations\(\)/);
  assert.match(cutover, /previous\.jobQueue\.pauseAndWait\(\)/);
  assert.match(cutover, /previous\.revisionStore\.flush\("Switch library",/);
  assert.match(cutover, /previous\.jobQueue\?\.resume\(\)/,
    "failed cutover must reopen the exact old queue");
  assert.doesNotMatch(cutover, /new JobQueue\(/,
    "rollback must not construct a second queue over the old store");
  assert.ok(cutover.indexOf("publishRuntime(candidate)") < cutover.indexOf("retireRuntime(previous"),
    "irreversible retirement happens only after candidate publication");
  assert.ok(cutover.indexOf("revisionStore.flush") < cutover.lastIndexOf("publishRuntime(candidate)"),
    "old authored revisions flush before publication");

  const candidateStart = main.indexOf("function buildEngineRuntime(");
  const candidateEnd = main.indexOf("function initializeEngine(", candidateStart);
  const candidate = main.slice(candidateStart, candidateEnd);
  assert.ok(candidate.indexOf("checkMigration(manifest, true)") < candidate.indexOf("nextEngine.initLibrary(false)"),
    "newer-format refusal is checked before any candidate mutation");
  assert.ok(candidate.indexOf("nextJobQueue = new JobQueue") < candidate.indexOf("nextEngine.commitLibraryManifest()"),
    "manifest is the final successful candidate commit marker");

  assert.match(main, /function registerRuntimeIpc/);
  assert.match(main, /isTrustedMainRenderer\(event\)/,
    "runtime IPC must authenticate the visible first-party main frame");
  assert.match(main, /event\.sender\.id !== win\.webContents\.id/);
  assert.match(main, /isTrustedRendererUrl\(frame\.url\)/);
  assert.match(main, /webContents\.on\("will-frame-navigate"/);
  assert.match(main, /webContents\.on\("will-redirect"/);
  assert.match(main, /setWindowOpenHandler/);
  assert.match(main, /app\.requestSingleInstanceLock\(\)/,
    "desktop authored writes require a single app instance in addition to the library lease");
  assert.match(main, /registerRuntimeIpc\("create-note"/);
  assert.match(main, /registerRuntimeIpc\("create-highlight"/);
  assert.match(main, /registerRuntimeIpc\("create-connection"/);
  assert.match(main, /registerRuntimeIpc\("update-connection"/);
  assert.match(main, /registerRuntimeIpc\("delete-connection"/);
  assert.match(main, /ipcMain\.handle\("init-library", async \(event,[\s\S]{0,220}isTrustedMainRenderer\(event\)/,
    "library cutover must reject a foreign renderer before touching the runtime");
  assert.match(main, /function trustedDevelopmentRendererUrl/);
  assert.match(main, /if \(!configured \|\| app\.isPackaged\) return null/);
  assert.match(main, /candidate\.hostname === "localhost"[\s\S]{0,180}candidate\.hostname === "127\.0\.0\.1"/);
  assert.match(main, /candidate\.protocol !== "http:" && candidate\.protocol !== "https:"/);
  assert.match(main, /!existsSync\(dbPath\) \|\| !nextEngine\.isConnectionProjectionCurrent\(\)/,
    "startup must rebuild Derived state after an event-only crash window");
  assert.match(
    candidate,
    /nextEngine\.buildSqlite\(\);[\s\S]{0,320}if \(!nextEngine\.isConnectionProjectionCurrent\(\)\)[\s\S]{0,240}refusing to publish a stale runtime/,
    "startup must postcheck its one bounded rebuild before publishing a candidate runtime",
  );
  assert.match(main, /function maybeDropQaConnectionResponse[\s\S]{0,220}app\.isPackaged/,
    "post-commit response-loss injection must be unavailable in packaged builds");
  assert.match(main, /app\.on\("before-quit"/);
  assert.match(main, /shutdownForQuitDeadline\(\)/);
  assert.match(main, /runtime\.revisionStore\.flush\("Session close",/);
  assert.match(main, /logLifecycle\("session-end"\);[\s\S]{0,240}app\.exit\(0\)/,
    "macOS quit must exit only after asynchronous teardown finishes");
  assert.doesNotMatch(main, /win\.on\("close"[\s\S]{0,160}revisionStore\.flush/,
    "visible-window close must not race coordinated quit flush");
  assert.match(main, /if \(mainWindow && !mainWindow\.isDestroyed\(\)\)/);
  assert.match(main, /process\.platform !== "darwin" && !isAppQuitting\) app\.quit\(\)/);
  assert.match(main, /main-window-construction-failed[\s\S]{0,500}process\.platform !== "darwin"\) app\.quit\(\)/,
    "a synchronous window failure must not leave a headless non-mac process");
});

test("embedding host is sender-bound, validated, ready-bounded, and single-flight", () => {
  const embeddings = read("src/electron/renderer-embeddings.ts");
  const host = read("src/embedding-host/host.ts");
  const preload = read("src/embedding-host/preload.ts");

  assert.match(embeddings, /ipcMain\.removeListener\("embed-response"/);
  assert.match(embeddings, /response: unknown|payload\) =>/);
  assert.match(embeddings, /event\.sender !== win\.webContents/);
  assert.match(embeddings, /providerNonce/);
  assert.match(embeddings, /requestNonce/);
  assert.match(embeddings, /windowGeneration/);
  assert.match(embeddings, /isHostResponse\(payload\)/);
  assert.match(embeddings, /buffer\.byteLength !== this\.dim \* Float32Array\.BYTES_PER_ELEMENT/);
  assert.match(embeddings, /embedding-response-malformed[\s\S]{0,180}failGeneration/);
  assert.match(embeddings, /embed-host-ready/);
  assert.match(embeddings, /preload-error/);
  assert.match(embeddings, /DEFAULT_STARTUP_TIMEOUT_MS = 15_000/);
  assert.match(embeddings, /private startupCancel:/);
  assert.match(embeddings, /cancelStartup\?\.\(error\)/,
    "startup recycle must reject getWindow instead of only removing listeners");
  assert.match(embeddings, /embedding renderer request timed out/);
  assert.match(embeddings, /embedding-window-construction-failed/);
  assert.match(embeddings, /offset < texts\.length; offset \+= MAX_EMBED_BATCH/,
    "large notes must be sent as bounded sequential host requests");
  assert.match(embeddings, /MAX_QUEUED_BATCHES = 8/);
  assert.match(embeddings, /this\.dispatchTail\.then/,
    "main dispatch must serialize requests before they can accumulate in the host");
  assert.match(embeddings, /epoch !== this\.requestEpoch/,
    "queued work from a recycled host must be canceled before dispatch");
  assert.match(embeddings, /embedding renderer response session mismatch[\s\S]{0,180}failGeneration/,
    "an active sender cannot legitimately answer for another session");

  assert.match(preload, /embed-host-init/);
  assert.match(preload, /embed-host-ready/);
  assert.match(host, /protocolVersion: 1/);
  assert.match(host, /rows !== req\.texts\.length/);
  assert.match(host, /dim !== 768/);
  assert.match(host, /data\.some\(\(value\) => !Number\.isFinite\(value\)\)/);
  assert.match(host, /function isHostRequest\(value: unknown\)/);
  assert.match(host, /MAX_EMBED_BATCH = 64/);
  assert.match(host, /error: "invalid embedding request"/,
    "valid request identities must receive an error instead of timing out silently");
  assert.match(host, /let inferenceTail: Promise<void> = Promise\.resolve\(\)/);
  assert.match(host, /inferenceTail = inferenceTail\.catch\(\(\) => undefined\)\.then/,
    "one failed response must not poison the serialized inference chain");
});

test("revision flush is bounded, retry-safe, and samples files without full reads", () => {
  const revisions = read("src/host/git-revision-store.ts");
  const main = read("src/electron/main.ts");

  assert.match(revisions, /execFileSync\("git", args/);
  assert.match(revisions, /timeout: Math\.max\(10, Math\.min\(GIT_COMMAND_TIMEOUT_MS, timeoutMs\)\)/);
  assert.match(revisions, /void this\.flush\(label\)\.catch\(\(\) => undefined\)/,
    "timer flush failures must not become process-level unhandled rejections");
  assert.match(revisions, /openSync\(filePath, "r"\)/);
  assert.match(revisions, /Buffer\.allocUnsafe\(8192\)/);
  assert.match(revisions, /readSync\(fd, buffer/);
  assert.doesNotMatch(revisions, /readFileSync\(filePath\)/,
    "binary detection must not allocate the full imported note/source");

  assert.match(main, /waitForAuthoredIdle\(\)/);
  assert.ok(
    main.indexOf('runtime.revisionStore.flush("Session close"')
      < main.indexOf("const drain = await settleWithin(runtimeWaits"),
    "semantic timeout must not suppress the authored revision flush",
  );
});
