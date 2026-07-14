/**
 * Codex subscription AI provider — Node host layer (B3.6 Gate E2).
 * Drives the locally-installed Codex CLI (`codex exec`) so model calls bill
 * the USER'S own ChatGPT plan instead of an API key (HUMAN DECISION
 * 2026-07-02; revisit if OpenAI signals third-party use is unwelcome).
 *
 * Transport notes (verified live, codex-cli 0.142.5):
 *  - `codex exec --output-schema <file>` enforces strict structured output;
 *    OpenAI strict mode requires EVERY property in `required` (optionals must
 *    be nullable) — callers' schemas must follow that rule.
 *  - Runs `--ephemeral -s read-only --skip-git-repo-check -C <tmpdir>` so the
 *    agent never touches user files and leaves no session residue.
 *  - Per-call overhead is large (~15s, ~15-19k tokens incl. harness prompt):
 *    right for DEEP-tier background jobs (enrichment), wrong for bulk/FAST work.
 */

import { spawn, execSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import type { AIProvider, AIRequest, AIResponse } from "../core/interfaces.js";

export type CodexProviderOptions = {
  /** Codex binary. Default "codex" (resolved via PATH). */
  binary?: string;
  /** Model override (`-m`). Default: the user's Codex default. */
  model?: string;
  /** Call timeout in ms. Default 180s (harness startup + reasoning can be slow). */
  timeoutMs?: number;
};

export class CodexExecAIProvider implements AIProvider {
  readonly model: string;
  private binary: string;
  private timeoutMs: number;

  constructor(opts: CodexProviderOptions = {}) {
    this.binary = opts.binary ?? "codex";
    this.model = opts.model ?? "codex-default";
    this.timeoutMs = opts.timeoutMs ?? 180_000;
  }

  async invoke(req: AIRequest): Promise<AIResponse> {
    const workDir = mkdtempSync(join(tmpdir(), "codex-ai-"));
    try {
      const outFile = join(workDir, "last-message.txt");
      const args = [
        "exec",
        "-C", workDir,
        "--skip-git-repo-check",
        "--ephemeral",
        "-s", "read-only",
        "--color", "never",
        "-o", outFile,
      ];
      if (this.model !== "codex-default") args.push("-m", this.model);
      if (req.responseFormat === "json" && req.jsonSchema) {
        const schemaFile = join(workDir, "schema.json");
        writeFileSync(schemaFile, JSON.stringify(req.jsonSchema));
        args.push("--output-schema", schemaFile);
      }
      const prompt = req.context ? `${req.context}\n\n${req.prompt}` : req.prompt;
      args.push(prompt);

      const stdout = await this.run(args);
      const text = existsSync(outFile) ? readFileSync(outFile, "utf-8").trim() : "";
      if (text.length === 0) {
        throw new Error(`codex exec produced no output message (stdout tail: ${stdout.slice(-200)})`);
      }
      return { text, tokensUsed: parseTokensUsed(stdout) };
    } finally {
      rmSync(workDir, { recursive: true, force: true });
    }
  }

  private run(args: string[]): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(this.binary, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`codex exec timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      child.on("error", (err) => {
        clearTimeout(timer);
        reject(err);
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolvePromise(stdout);
        else reject(new Error(`codex exec exited ${code}: ${(stderr || stdout).slice(-400)}`));
      });
    });
  }
}

/** Best-effort token accounting from codex exec's human output ("tokens used\n18,694"). */
export function parseTokensUsed(stdout: string): number {
  const m = /tokens used\s*\n?\s*([\d,]+)/i.exec(stdout);
  return m ? parseInt(m[1]!.replace(/,/g, ""), 10) : 0;
}

/** True when the codex binary exists AND the user is signed in. */
export function isCodexAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const authPath = join(env["CODEX_HOME"] ?? join(homedir(), ".codex"), "auth.json");
  if (!existsSync(authPath)) return false;
  try {
    execSync("codex --version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Factory: Codex subscription provider when available, else null. */
export function createCodexProvider(env: NodeJS.ProcessEnv = process.env): CodexExecAIProvider | null {
  if (env["CODEX_DISABLE"] === "1") return null;
  if (!isCodexAvailable(env)) return null;
  return new CodexExecAIProvider({ model: env["CODEX_MODEL"] });
}
