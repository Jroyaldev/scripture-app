/**
 * Read-only Pleiades 4.1 research data.
 *
 * This artifact deliberately remains separate from OpenBible geography:
 * Pleiades contributes ancient names, dated assertions, scholarly
 * connections, bibliography, and geometry under CC BY 3.0.
 */

export type PleiadesGeometry = {
  type: string;
  coordinates: unknown;
};

export type PleiadesName = {
  id: string;
  attested?: string;
  romanized: string[];
  language?: string;
  nameType?: string;
  certainty?: string;
  start?: number;
  end?: number;
};

export type PleiadesLocation = {
  id: string;
  title: string;
  description?: string;
  featureTypes: string[];
  locationTypes: string[];
  certainty?: string;
  start?: number;
  end?: number;
  accuracyMeters?: number;
  accuracyUri?: string;
  provenance?: string;
  geometry?: PleiadesGeometry;
};

export type PleiadesConnection = {
  id: string;
  targetId?: string;
  targetUrl?: string;
  title: string;
  type: string;
  description?: string;
  certainty?: string;
  start?: number;
  end?: number;
};

export type PleiadesReference = {
  shortTitle?: string;
  citationDetail?: string;
  citation: string;
  type: string;
  accessUrl?: string;
  bibliographyUrl?: string;
};

export type PleiadesPlace = {
  id: string;
  title: string;
  description: string;
  sourceUrl: string;
  placeTypes: string[];
  names: PleiadesName[];
  locations: PleiadesLocation[];
  connections: PleiadesConnection[];
  references: PleiadesReference[];
  reprPoint?: [number, number];
  bbox?: [number, number, number, number];
  period?: { start: number; end: number };
  provenance?: string;
  rights: string;
  creators: string[];
  contributors: string[];
  created?: string;
};

export type PleiadesResearchMeta = {
  formatVersion: 1;
  id: "pleiades-place-research";
  name: "Pleiades Gazetteer";
  release: "4.1";
  releaseDate: "2025-05-28";
  sourceCommit: "b6a6790f71c45e4a4ef60fce296c506f28f458bf";
  sourceUrl: string;
  doi: "10.5281/zenodo.1193921";
  license: "CC BY 3.0";
  licenseUrl: "https://creativecommons.org/licenses/by/3.0/";
  attribution: string;
  sourceManifestSha256: string;
  placeCount: number;
  nameCount: number;
  locationCount: number;
  connectionCount: number;
  referenceCount: number;
  geometryCount: number;
};

export type PleiadesResearchArtifact = {
  meta: PleiadesResearchMeta;
  places: Record<string, PleiadesPlace>;
};

export type PleiadesCoordinateComparison = {
  distanceKm: number;
  relation: "close" | "regional" | "divergent";
};

export type PleiadesEntityResearch = {
  place: PleiadesPlace;
  coordinateComparison: PleiadesCoordinateComparison | null;
};

export class PleiadesResearchIndex {
  private artifact: PleiadesResearchArtifact | null = null;

  get loaded(): boolean {
    return this.artifact != null;
  }

  get meta(): PleiadesResearchMeta | null {
    return this.artifact?.meta ?? null;
  }

  loadArtifact(jsonText: string): number {
    const parsed = JSON.parse(jsonText) as PleiadesResearchArtifact;
    if (parsed.meta.formatVersion !== 1 || parsed.meta.id !== "pleiades-place-research") {
      throw new Error(`Unsupported Pleiades artifact: ${parsed.meta.id} v${parsed.meta.formatVersion}`);
    }
    const count = Object.keys(parsed.places).length;
    if (count !== parsed.meta.placeCount) {
      throw new Error(`Pleiades count mismatch: meta=${parsed.meta.placeCount}, rows=${count}`);
    }
    this.artifact = parsed;
    return count;
  }

  get(id: string): PleiadesPlace | null {
    return this.artifact?.places[id] ?? null;
  }
}

export function comparePleiadesCoordinates(
  place: PleiadesPlace,
  longitude: number,
  latitude: number,
): PleiadesCoordinateComparison | null {
  if (!place.reprPoint) return null;
  const [pleiadesLongitude, pleiadesLatitude] = place.reprPoint;
  if (![pleiadesLongitude, pleiadesLatitude, longitude, latitude].every(Number.isFinite)) return null;
  const distanceKm = haversineKm(latitude, longitude, pleiadesLatitude, pleiadesLongitude);
  return {
    distanceKm: Math.round(distanceKm * 10) / 10,
    relation: distanceKm <= 25 ? "close" : distanceKm <= 100 ? "regional" : "divergent",
  };
}

function haversineKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number): number {
  const radians = (degrees: number): number => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB))
    * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
