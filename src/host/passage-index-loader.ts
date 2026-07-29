import { existsSync } from "node:fs";
import { join } from "node:path";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { momentsFor, readPassageIndex } from "../core/passage-index.js";
import type { PassageIndex, PassageMoment } from "../core/passage-index.js";

/**
 * Holds the passage index and answers "who has taught this chapter".
 *
 * Read once and kept, rather than re-read per query. It is a single file of a
 * few megabytes covering the whole library, and a reader moving through a
 * chapter asks this on every passage change — parsing it each time would put a
 * file read on the reading path for no gain.
 *
 * The cached copy is keyed by the library path, so switching libraries drops it
 * rather than answering the new library's questions from the old one's index.
 */

let cached: { libraryPath: string; index: PassageIndex } | null = null;

export function passageIndexPath(libraryPath: string): string {
  return join(libraryPath, ".artifacts/passage-index.json");
}

/** Forget the held index — call when the library changes underneath. */
export function resetPassageIndex(): void {
  cached = null;
}

function load(libraryPath: string): PassageIndex | null {
  if (cached?.libraryPath === libraryPath) return cached.index;
  const path = passageIndexPath(libraryPath);
  if (!existsSync(path)) return null;
  try {
    const result = readPassageIndex(JSON.parse(readFileSyncInterruptible(path, "utf-8")));
    if (!result.ok) return null;
    cached = { libraryPath, index: result.index };
    return result.index;
  } catch {
    return null;
  }
}

export interface PassageMomentsResult {
  ok: true;
  moments: PassageMoment[];
}

/**
 * Every moment on a chapter, longest first.
 *
 * Absence is an ordinary answer — most chapters have nobody teaching them —
 * so this returns an empty list rather than a refusal. A margin that cannot
 * distinguish "nobody has taught this" from "something went wrong" would show
 * an error where it should show nothing.
 */
export function loadPassageMoments(
  libraryPath: string,
  book: string,
  chapter: number,
  mutes: readonly string[] = [],
  verse: number | null = null,
): PassageMomentsResult {
  const index = load(libraryPath);
  if (!index) return { ok: true, moments: [] };
  return { ok: true, moments: momentsFor(index, book, chapter, mutes, verse) };
}
