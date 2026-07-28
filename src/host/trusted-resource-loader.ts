/**
 * Read-only host adapter for versioned trusted-resource manifests.
 *
 * The query IPC loads on every call, which is what lets an installed manifest
 * take effect without a restart. That is free at a few hundred records and
 * ruinous at twenty thousand: every pin, hover and chapter change would reread
 * the file, reparse the JSON, and revalidate every record and bref against the
 * backbone. So a validated manifest is kept until its file changes, keyed on
 * the identity the filesystem already gives us — path, mtime, size. A rebuilt
 * or hand-edited manifest still lands on the next query; only the redundant
 * work goes away.
 */

import { existsSync, statSync } from "node:fs";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { join } from "node:path";
import {
  validateTrustedResourceManifest,
  type TrustedResourceManifestV1,
  type TrustedResourceRefusal,
} from "../core/resources/trusted-resources.js";
import type { BackboneData } from "../core/reference/types.js";

/**
 * The registry: which sources exist, and which hosts each may send a reader to.
 *
 * The hosts are stated here rather than trusted from the manifest, because a
 * manifest in `.artifacts` is a file on disk that anything can write. Opening a
 * link therefore has to satisfy two independent gates — the manifest's own
 * `officialHosts`, and this list — and only this one ships in the binary.
 *
 * It lives beside the ids because the two were previously apart, one here and
 * one in the main process, and a source registered in only one place looked
 * perfectly healthy until a reader clicked its card and was told the link could
 * not be opened.
 */
export const TRUSTED_RESOURCE_SOURCES = [
  { id: "working-preacher", officialHosts: ["www.workingpreacher.org"] },
  { id: "bibleproject", officialHosts: ["bibleproject.com"] },
  { id: "the-gospel-coalition", officialHosts: ["www.thegospelcoalition.org"] },
  { id: "enter-the-bible", officialHosts: ["enterthebible.org"] },
  { id: "naked-bible", officialHosts: ["nakedbiblepodcast.com"] },
] as const;

export const TRUSTED_RESOURCE_SOURCE_IDS = TRUSTED_RESOURCE_SOURCES.map((source) => source.id);

/** Every host any registered source is allowed to open. */
export function allowedTrustedResourceHosts(): Set<string> {
  return new Set(TRUSTED_RESOURCE_SOURCES.flatMap((source) => [...source.officialHosts]));
}

export type TrustedResourceManifestOrigin = "installed" | "bundled";
export type LoadedTrustedResourceManifest = {
  manifest: TrustedResourceManifestV1;
  origin: TrustedResourceManifestOrigin;
};
export type TrustedResourceLoadResult =
  | { ok: true; manifests: LoadedTrustedResourceManifest[] }
  | { ok: false; refusal: TrustedResourceRefusal };

type CacheEntry = {
  mtimeMs: number;
  size: number;
  manifest: TrustedResourceManifestV1;
};

const validatedManifests = new Map<string, CacheEntry>();

/** Only for tests: forget every cached manifest. */
export function clearTrustedResourceManifestCache(): void {
  validatedManifests.clear();
}

export function loadTrustedResourceManifests(options: {
  installedRoot?: string;
  bundledRoot: string;
  backbone: BackboneData;
  sourceIds?: readonly string[];
}): TrustedResourceLoadResult {
  const manifests: LoadedTrustedResourceManifest[] = [];
  for (const sourceId of options.sourceIds ?? TRUSTED_RESOURCE_SOURCE_IDS) {
    const installedPath = options.installedRoot
      ? join(options.installedRoot, sourceId, "manifest.json")
      : undefined;
    const installedPresent = installedPath != null && existsSync(installedPath);
    const path = installedPresent
      ? installedPath
      : join(options.bundledRoot, sourceId, "manifest.json");
    if (!existsSync(path)) continue;

    let stamp: { mtimeMs: number; size: number } | null = null;
    try {
      const stats = statSync(path);
      stamp = { mtimeMs: stats.mtimeMs, size: stats.size };
    } catch {
      // An unstattable file still gets read below, and fails there if it must.
      stamp = null;
    }
    const cached = stamp ? validatedManifests.get(path) : undefined;
    if (cached && stamp && cached.mtimeMs === stamp.mtimeMs && cached.size === stamp.size) {
      manifests.push({ manifest: cached.manifest, origin: installedPresent ? "installed" : "bundled" });
      continue;
    }

    let input: unknown;
    try {
      input = JSON.parse(readFileSyncInterruptible(path, "utf8")) as unknown;
    } catch (error) {
      return {
        ok: false,
        refusal: {
          code: installedPresent ? "invalid-installed-manifest" : "read-failed",
          sourceId,
          message: `Could not read ${installedPresent ? "installed" : "bundled"} manifest: ${errorMessage(error)}`,
        },
      };
    }
    const validated = validateTrustedResourceManifest(input, options.backbone);
    if (!validated.ok || validated.value.source.id !== sourceId) {
      // A manifest that refuses is not cached: the next query must see the fix.
      validatedManifests.delete(path);
      return {
        ok: false,
        refusal: {
          code: installedPresent ? "invalid-installed-manifest" : "read-failed",
          sourceId,
          message: validated.ok ? "Manifest source id does not match its directory" : validated.error,
        },
      };
    }
    if (stamp) validatedManifests.set(path, { ...stamp, manifest: validated.value });
    manifests.push({ manifest: validated.value, origin: installedPresent ? "installed" : "bundled" });
  }
  return { ok: true, manifests };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
