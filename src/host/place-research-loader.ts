/** Node host adapter for the read-only place research artifact. */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  PlaceResearchIndex,
  type EntityResearchData,
} from "../core/entities/place-research.js";
import {
  comparePleiadesCoordinates,
  PleiadesResearchIndex,
} from "../core/entities/pleiades-research.js";
import type { TipnrEntity } from "../core/language/tipnr.js";

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
    const count = this.index.loadArtifact(readFileSync(artifactPath, "utf8"));
    this.index.loadNaturalEarth(readFileSync(naturalEarthPath, "utf8"));
    if (existsSync(pleiadesPath)) this.pleiades.loadArtifact(readFileSync(pleiadesPath, "utf8"));
    this.mediaDir = join(directory, "media");
    return count;
  }

  research(entity: TipnrEntity): EntityResearchData {
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
        imageDataUrl = `data:${place.image.mimeType};base64,${readFileSync(path).toString("base64")}`;
      }
    }
    return { entity, place, pleiades, imageDataUrl };
  }
}
