/** Node host adapter for the read-only place research artifact. */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  PlaceResearchIndex,
  type EntityResearchData,
} from "../core/entities/place-research.js";
import type { TipnrEntity } from "../core/language/tipnr.js";

export class PlaceResearchLoader {
  private readonly index = new PlaceResearchIndex();
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
    if (!existsSync(artifactPath) || !existsSync(naturalEarthPath)) return 0;
    const count = this.index.loadArtifact(readFileSync(artifactPath, "utf8"));
    this.index.loadNaturalEarth(readFileSync(naturalEarthPath, "utf8"));
    this.mediaDir = join(directory, "media");
    return count;
  }

  research(entity: TipnrEntity): EntityResearchData {
    const place = entity.kind === "place" ? this.index.get(entity.id) : null;
    const minimap = place ? this.index.minimap(entity.id) : null;
    let imageDataUrl: string | null = null;
    if (place?.image) {
      const path = join(this.mediaDir, place.image.file);
      if (existsSync(path)) {
        imageDataUrl = `data:${place.image.mimeType};base64,${readFileSync(path).toString("base64")}`;
      }
    }
    return { entity, place, minimap, imageDataUrl };
  }
}
