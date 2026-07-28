/**
 * Minimal .env loader — Node host layer.
 * No dependency; parses KEY=VALUE lines, ignores comments/blanks,
 * and never overrides variables already present in process.env
 * (so real environment always wins over the file).
 */

import { existsSync } from "node:fs";
import { readFileSyncInterruptible } from "./exec-sync.js";

export function loadEnvFile(path: string): Record<string, string> {
  const loaded: Record<string, string> = {};
  if (!existsSync(path)) return loaded;

  const lines = readFileSyncInterruptible(path, "utf-8").split("\n");
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    loaded[key] = value;
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return loaded;
}
