/** Node host adapter for the read-only place research artifact. */

import { existsSync } from "node:fs";
import { readFileSyncInterruptible } from "./exec-sync.js";
import { join } from "node:path";
import {
  PlaceResearchIndex,
  type EntityResearchData,
} from "../core/entities/place-research.js";
import {
  comparePleiadesCoordinates,
  PleiadesResearchIndex,
} from "../core/entities/pleiades-research.js";
import { namedLicensedSource } from "../core/entities/licensed-source.js";
import type { TipnrEntity } from "../core/language/tipnr.js";

/**
 * What the TIPNR index declares about itself. The caller passes it because the
 * index and this loader are separate singletons; the point is that the siglum
 * is resolved from the artifact's own declaration rather than from the fact
 * that the parameter happens to be typed `TipnrEntity`.
 */
export type DeclaredCorpus = { name: string; license: string };

export class PlaceResearchLoader {
  private readonly index = new PlaceResearchIndex();
  private readonly pleiades = new PleiadesResearchIndex();
  private mediaDir = "";

  get loaded(): boolean {
    return this.index.loaded;
  }

  get placeCount(): number {
    return this.index.meta?.placeCount ?? 0;
  }

  load(directory: string): number {
    const artifactPath = join(directory, "openbible-places.json");
    const naturalEarthPath = join(directory, "natural-earth-50m-land.geojson");
    const pleiadesPath = join(directory, "pleiades-4.1.json");
    if (!existsSync(artifactPath) || !existsSync(naturalEarthPath)) return 0;
    const count = this.index.loadArtifact(readFileSyncInterruptible(artifactPath, "utf8"));
    this.index.loadNaturalEarth(readFileSyncInterruptible(naturalEarthPath, "utf8"));
    if (existsSync(pleiadesPath)) this.pleiades.loadArtifact(readFileSyncInterruptible(pleiadesPath, "utf8"));
    this.mediaDir = join(directory, "media");
    return count;
  }

  research(entity: TipnrEntity, entityCorpus?: DeclaredCorpus | null): EntityResearchData {
    const place = entity.kind === "place" ? this.index.get(entity.id) : null;
    const pleiadesPlace = place?.linkedData.pleiadesId
      ? this.pleiades.get(place.linkedData.pleiadesId)
      : null;
    const pleiades = pleiadesPlace && place
      ? {
          place: pleiadesPlace,
          coordinateComparison: comparePleiadesCoordinates(
            pleiadesPlace,
            place.primary.longitude,
            place.primary.latitude,
          ),
        }
      : null;
    let imageDataUrl: string | null = null;
    if (place?.image) {
      const path = join(this.mediaDir, place.image.file);
      if (existsSync(path)) {
        imageDataUrl = `data:${place.image.mimeType};base64,${readFileSyncInterruptible(path).toString("base64")}`;
      }
    }
    // Resolve the sigla here, once, from what each artifact declares about
    // itself. If the Pleiades artifact is not loaded there is no meta to read,
    // so `pleiades` names nothing — and a `pleiades` block without a name is
    // exactly the case §4 sends to "do not show the prose".
    const pleiadesMeta = this.pleiades.meta;
    return {
      entity,
      place,
      pleiades,
      imageDataUrl,
      licensed: {
        entity: namedLicensedSource(entityCorpus?.name, entityCorpus?.license),
        pleiades: pleiadesPlace
          ? namedLicensedSource(
              pleiadesMeta?.name,
              pleiadesMeta?.license,
              pleiadesPlace.sourceUrl,
            )
          : null,
      },
    };
  }
}
