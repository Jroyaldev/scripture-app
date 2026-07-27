/**
 * Where an imported manifest has to land to be seen.
 *
 * The app reads installed manifests from `<library>/.artifacts/resources`, and
 * the library is whatever the user chose — not a default anyone can assume. An
 * importer that guesses writes a file nothing reads, which looks exactly like a
 * successful import right up until the margin is empty. So resolve it the same
 * way the main process does, in the same order: the stored setting first, then
 * the environment, then the documented default.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const STORE = join(
  process.env["HOME"] ?? "",
  "Library/Application Support/Pericope/config.json",
);

export function resolveLibraryRoot(): { path: string; from: string } {
  try {
    if (existsSync(STORE)) {
      const stored = (JSON.parse(readFileSync(STORE, "utf8")) as { libraryPath?: unknown }).libraryPath;
      if (typeof stored === "string" && stored.trim()) return { path: stored, from: "app setting" };
    }
  } catch {
    // A settings file we cannot read is not a reason to fail the import.
  }
  const fromEnv = process.env["LIBRARY_PATH"];
  if (fromEnv?.trim()) return { path: fromEnv, from: "LIBRARY_PATH" };
  return { path: join(process.env["HOME"] ?? "", "Documents/ScriptureLibrary"), from: "default" };
}

export function resolveManifestPath(sourceId: string): { path: string; from: string } {
  const library = resolveLibraryRoot();
  return {
    path: join(library.path, ".artifacts/resources", sourceId, "manifest.json"),
    from: library.from,
  };
}
