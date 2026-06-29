import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";

const repoRoot = resolve(import.meta.dirname, "..");

function runNpmScript(script: string, timeoutMs: number): Promise<{
  status: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}> {
  return new Promise((resolvePromise) => {
    const child = spawn("npm", ["run", script], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill("SIGTERM");
      } catch {
        // Process may already have exited.
      }
      killTimer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          // Process may already have exited.
        }
      }, 2_000);
    }, timeoutMs);

    child.on("close", (status, signal) => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolvePromise({ status, signal, timedOut, stdout, stderr });
    });
  });
}

test("electron build exits and emits a CommonJS preload bridge", async () => {
  const result = await runNpmScript("build", 20_000);

  assert.equal(
    result.timedOut,
    false,
    `npm run build timed out\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.status, 0, `npm run build failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const preloadPath = join(repoRoot, "dist/electron/preload.cjs");
  assert.equal(existsSync(preloadPath), true, "preload.cjs should be emitted for Electron preload loading");

  const preloadCode = readFileSync(preloadPath, "utf-8");
  assert.match(preloadCode, /exposeInMainWorld\(\s*["']api["']/, "preload should expose window.api");
  assert.doesNotMatch(preloadCode, /^\s*import\s/m, "preload should be CommonJS, not ESM");
});

test("renderer build exits and emits index assets", async () => {
  const result = await runNpmScript("build:renderer", 60_000);

  assert.equal(
    result.timedOut,
    false,
    `npm run build:renderer timed out\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.equal(result.status, 0, `npm run build:renderer failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);

  const indexPath = join(repoRoot, "dist/renderer/index.html");
  assert.equal(existsSync(indexPath), true, "renderer index.html should be emitted");

  const indexHtml = readFileSync(indexPath, "utf-8");
  assert.match(indexHtml, /<script type="module" src="\.\/assets\/.+\.js"><\/script>/);
});
