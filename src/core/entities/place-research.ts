/**
 * Read-only biblical-place research data and deterministic minimap geometry.
 *
 * The source corpus is OpenBible Bible Geocoding (CC BY 4.0), joined to the
 * existing TIPNR identities. Natural Earth land geometry is public domain.
 * This module is pure TypeScript (INV-18): callers inject artifact strings.
 */

import type { TipnrEntity } from "../language/tipnr.js";

export type PlaceResearchImage = {
  file: string;
  mimeType: string;
  sha256: string;
  width: number;
  height: number;
  alt: string;
  placeholder?: string;
  credit: string;
  creditUrl?: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
};

export type PlaceLocation = {
  modernId: string;
  name: string;
  type: string;
  longitude: number;
  latitude: number;
  score: number;
  confidence: "high" | "strong" | "probable" | "tentative" | "disputed";
  precision?: string;
  wikidataId?: string;
};

export type PlaceResearchRecord = {
  tipnrId: string;
  ancientId: string;
  ancientName: string;
  type: string;
  openBibleUrl: string;
  refs: string[];
  primary: PlaceLocation;
  alternatives: PlaceLocation[];
  linkedData: {
    wikidataId?: string;
    pleiadesId?: string;
  };
  image?: PlaceResearchImage;
};

export type PlaceResearchMeta = {
  formatVersion: 1;
  id: "openbible-place-research";
  name: "OpenBible Bible Geocoding";
  sourceUrl: string;
  sourceCommit: string;
  license: "CC BY 4.0";
  licenseUrl: string;
  attribution: string;
  naturalEarthVersion: string;
  naturalEarthLicense: "Public domain";
  placeCount: number;
  imageCount: number;
};

export type PlaceResearchArtifact = {
  meta: PlaceResearchMeta;
  places: Record<string, PlaceResearchRecord>;
};

export type MiniMapData = {
  width: 320;
  height: 164;
  landPaths: string[];
  center: { x: number; y: number };
  alternatives: Array<{ x: number; y: number; name: string; score: number }>;
  bounds: { west: number; south: number; east: number; north: number };
};

export type EntityResearchData = {
  entity: TipnrEntity;
  place: PlaceResearchRecord | null;
  minimap: MiniMapData | null;
  imageDataUrl: string | null;
};

type Position = [number, number];
type GeoJsonGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: Position[][] | Position[][][];
};

type NaturalEarthFeatureCollection = {
  type: "FeatureCollection";
  features: Array<{ geometry: GeoJsonGeometry | null }>;
};

export class PlaceResearchIndex {
  private artifact: PlaceResearchArtifact | null = null;
  private land: NaturalEarthFeatureCollection | null = null;

  get loaded(): boolean {
    return this.artifact != null;
  }

  get meta(): PlaceResearchMeta | null {
    return this.artifact?.meta ?? null;
  }

  loadArtifact(jsonText: string): number {
    const parsed = JSON.parse(jsonText) as PlaceResearchArtifact;
    if (parsed.meta.formatVersion !== 1 || parsed.meta.id !== "openbible-place-research") {
      throw new Error(`Unsupported place research artifact: ${parsed.meta.id} v${parsed.meta.formatVersion}`);
    }
    const count = Object.keys(parsed.places).length;
    if (count !== parsed.meta.placeCount) {
      throw new Error(`Place research count mismatch: meta=${parsed.meta.placeCount}, rows=${count}`);
    }
    this.artifact = parsed;
    return count;
  }

  loadNaturalEarth(jsonText: string): number {
    const parsed = JSON.parse(jsonText) as NaturalEarthFeatureCollection;
    if (parsed.type !== "FeatureCollection" || !Array.isArray(parsed.features)) {
      throw new Error("Natural Earth artifact is not a GeoJSON FeatureCollection");
    }
    this.land = parsed;
    return parsed.features.length;
  }

  get(tipnrId: string): PlaceResearchRecord | null {
    return this.artifact?.places[tipnrId] ?? null;
  }

  minimap(tipnrId: string): MiniMapData | null {
    const place = this.get(tipnrId);
    if (!place || !this.land) return null;
    return buildPlaceMiniMap(this.land, place);
  }
}

export function confidenceFromScore(score: number): PlaceLocation["confidence"] {
  if (score >= 900) return "high";
  if (score >= 650) return "strong";
  if (score >= 350) return "probable";
  if (score > 0) return "tentative";
  return "disputed";
}

export function buildPlaceMiniMap(
  land: NaturalEarthFeatureCollection,
  place: PlaceResearchRecord,
): MiniMapData {
  const width = 320 as const;
  const height = 164 as const;
  const centerLon = place.primary.longitude;
  const centerLat = place.primary.latitude;
  const regional = /region|country|territory|sea|river|mountain range|wilderness/i.test(place.type);
  const latSpan = regional ? 13 : 8;
  const lonSpan = latSpan / Math.max(0.42, Math.cos(centerLat * Math.PI / 180));
  const bounds = {
    west: centerLon - lonSpan / 2,
    east: centerLon + lonSpan / 2,
    south: Math.max(-84, centerLat - latSpan / 2),
    north: Math.min(84, centerLat + latSpan / 2),
  };

  const project = ([lon, lat]: Position): { x: number; y: number } => ({
    x: ((lon - bounds.west) / (bounds.east - bounds.west)) * width,
    y: ((bounds.north - lat) / (bounds.north - bounds.south)) * height,
  });

  const landPaths: string[] = [];
  for (const feature of land.features) {
    const geometry = feature.geometry;
    if (!geometry) continue;
    const polygons = geometry.type === "Polygon"
      ? [geometry.coordinates as Position[][]]
      : geometry.coordinates as Position[][][];
    for (const polygon of polygons) {
      for (const ring of polygon) {
        if (!ringIntersectsBounds(ring, bounds)) continue;
        const clipped = clipRingToBounds(ring, bounds);
        if (clipped.length < 3) continue;
        const points = clipped.map(project);
        const d = points
          .map((point, index) => `${index === 0 ? "M" : "L"}${round(point.x)} ${round(point.y)}`)
          .join(" ");
        landPaths.push(`${d} Z`);
      }
    }
  }

  const alternatives = place.alternatives
    .map((item) => ({ ...project([item.longitude, item.latitude]), name: item.name, score: item.score }))
    .filter((item) => item.x >= 0 && item.x <= width && item.y >= 0 && item.y <= height)
    .slice(0, 3);

  return {
    width,
    height,
    landPaths,
    center: project([centerLon, centerLat]),
    alternatives,
    bounds,
  };
}

function ringIntersectsBounds(
  ring: Position[],
  bounds: MiniMapData["bounds"],
): boolean {
  let west = Number.POSITIVE_INFINITY;
  let east = Number.NEGATIVE_INFINITY;
  let south = Number.POSITIVE_INFINITY;
  let north = Number.NEGATIVE_INFINITY;
  for (const [lon, lat] of ring) {
    west = Math.min(west, lon);
    east = Math.max(east, lon);
    south = Math.min(south, lat);
    north = Math.max(north, lat);
  }
  return east >= bounds.west && west <= bounds.east && north >= bounds.south && south <= bounds.north;
}

function clipRingToBounds(
  ring: Position[],
  bounds: MiniMapData["bounds"],
): Position[] {
  const unclosed = ring.length > 1 && samePoint(ring[0]!, ring.at(-1)!) ? ring.slice(0, -1) : [...ring];
  let output = clipEdge(unclosed, (point) => point[0] >= bounds.west, (a, b) => intersectVertical(a, b, bounds.west));
  output = clipEdge(output, (point) => point[0] <= bounds.east, (a, b) => intersectVertical(a, b, bounds.east));
  output = clipEdge(output, (point) => point[1] >= bounds.south, (a, b) => intersectHorizontal(a, b, bounds.south));
  output = clipEdge(output, (point) => point[1] <= bounds.north, (a, b) => intersectHorizontal(a, b, bounds.north));
  return output;
}

function clipEdge(
  input: Position[],
  inside: (point: Position) => boolean,
  intersect: (a: Position, b: Position) => Position,
): Position[] {
  if (input.length === 0) return [];
  const output: Position[] = [];
  let previous = input.at(-1)!;
  let previousInside = inside(previous);
  for (const current of input) {
    const currentInside = inside(current);
    if (currentInside !== previousInside) output.push(intersect(previous, current));
    if (currentInside) output.push(current);
    previous = current;
    previousInside = currentInside;
  }
  return output;
}

function intersectVertical(a: Position, b: Position, longitude: number): Position {
  const denominator = b[0] - a[0];
  const t = denominator === 0 ? 0 : (longitude - a[0]) / denominator;
  return [longitude, a[1] + (b[1] - a[1]) * t];
}

function intersectHorizontal(a: Position, b: Position, latitude: number): Position {
  const denominator = b[1] - a[1];
  const t = denominator === 0 ? 0 : (latitude - a[1]) / denominator;
  return [a[0] + (b[0] - a[0]) * t, latitude];
}

function samePoint(a: Position, b: Position): boolean {
  return a[0] === b[0] && a[1] === b[1];
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
