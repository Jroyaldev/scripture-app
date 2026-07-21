/** Read-only host adapter for versioned trusted-resource manifests. */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateTrustedResourceManifest,
  type TrustedResourceManifestV1,
  type TrustedResourceRefusal,
} from "../core/resources/trusted-resources.js";
import type { BackboneData } from "../core/reference/types.js";

export const TRUSTED_RESOURCE_SOURCE_IDS = [
  "working-preacher",
  "bibleproject",
  "the-gospel-coalition",
] as const;

export type TrustedResourceManifestOrigin = "installed" | "bundled";
export type LoadedTrustedResourceManifest = {
  manifest: TrustedResourceManifestV1;
  origin: TrustedResourceManifestOrigin;
};
export type TrustedResourceLoadResult =
  | { ok: true; manifests: LoadedTrustedResourceManifest[] }
  | { ok: false; refusal: TrustedResourceRefusal };

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
    let input: unknown;
    try {
      input = JSON.parse(readFileSync(path, "utf8")) as unknown;
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
      return {
        ok: false,
        refusal: {
          code: installedPresent ? "invalid-installed-manifest" : "read-failed",
          sourceId,
          message: validated.ok ? "Manifest source id does not match its directory" : validated.error,
        },
      };
    }
    manifests.push({ manifest: validated.value, origin: installedPresent ? "installed" : "bundled" });
  }
  return { ok: true, manifests };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
