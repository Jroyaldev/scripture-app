export type LegacyTheme = "light" | "dark" | "glass" | "dark-glass";
export type LegacyMarkingSurface = "palette" | "rail" | "radial" | "dock";

export interface AdoptableLegacySettings {
  theme?: LegacyTheme;
  markingSurface?: LegacyMarkingSurface;
  sidebarCollapsed?: boolean;
  marginVisible?: boolean;
  readingSize?: "s" | "m" | "l";
  readingWidth?: "narrow" | "medium" | "wide";
  verseNumbers?: "always" | "faint" | "hover";
  recentPassages?: Array<{
    book: string;
    chapter: number;
    verse?: number;
    packageId: string;
    visitedAt: number;
  }>;
  lastRead?: { book: string; chapter: number; packageId: string } | null;
  windowBounds?: { x?: number; y?: number; width: number; height: number } | null;
  libraryPath?: string | null;
}

const THEMES = new Set<LegacyTheme>(["light", "dark", "glass", "dark-glass"]);
const MARKING_SURFACES = new Set<LegacyMarkingSurface>(["palette", "rail", "radial", "dock"]);
const READING_SIZES = new Set(["s", "m", "l"] as const);
const READING_WIDTHS = new Set(["narrow", "medium", "wide"] as const);
const VERSE_NUMBER_MODES = new Set(["always", "faint", "hover"] as const);

/** Refuse generic Electron profiles and retain only validated app-owned keys. */
export function sanitizeLegacySettings(input: unknown): AdoptableLegacySettings | null {
  if (!isRecord(input)) return null;
  const result: AdoptableLegacySettings = {};
  let recognized = 0;
  let strongSignal = false;

  if (typeof input["theme"] === "string" && THEMES.has(input["theme"] as LegacyTheme)) {
    result.theme = input["theme"] as LegacyTheme;
    recognized += 1;
  }
  if (typeof input["markingSurface"] === "string" && MARKING_SURFACES.has(input["markingSurface"] as LegacyMarkingSurface)) {
    result.markingSurface = input["markingSurface"] as LegacyMarkingSurface;
    recognized += 1;
    strongSignal = true;
  }
  if (typeof input["sidebarCollapsed"] === "boolean") {
    result.sidebarCollapsed = input["sidebarCollapsed"];
    recognized += 1;
  }
  if (typeof input["marginVisible"] === "boolean") {
    result.marginVisible = input["marginVisible"];
    recognized += 1;
  }
  if (typeof input["readingSize"] === "string" && READING_SIZES.has(input["readingSize"] as "s" | "m" | "l")) {
    result.readingSize = input["readingSize"] as "s" | "m" | "l";
    recognized += 1;
    strongSignal = true;
  }
  if (typeof input["readingWidth"] === "string" && READING_WIDTHS.has(input["readingWidth"] as "narrow" | "medium" | "wide")) {
    result.readingWidth = input["readingWidth"] as "narrow" | "medium" | "wide";
    recognized += 1;
    strongSignal = true;
  }
  if (typeof input["verseNumbers"] === "string" && VERSE_NUMBER_MODES.has(input["verseNumbers"] as "always" | "faint" | "hover")) {
    result.verseNumbers = input["verseNumbers"] as "always" | "faint" | "hover";
    recognized += 1;
    strongSignal = true;
  }

  const recentPassages = readRecentPassages(input["recentPassages"]);
  if (recentPassages) {
    result.recentPassages = recentPassages;
    recognized += 1;
    strongSignal = true;
  }
  if (input["lastRead"] === null) {
    result.lastRead = null;
    recognized += 1;
  } else {
    const lastRead = readPassage(input["lastRead"], false);
    if (lastRead) {
      result.lastRead = lastRead;
      recognized += 1;
      strongSignal = true;
    }
  }
  if (input["windowBounds"] === null) {
    result.windowBounds = null;
    recognized += 1;
  } else {
    const bounds = readWindowBounds(input["windowBounds"]);
    if (bounds) {
      result.windowBounds = bounds;
      recognized += 1;
    }
  }
  if (input["libraryPath"] === null) {
    result.libraryPath = null;
    recognized += 1;
  } else if (typeof input["libraryPath"] === "string" && input["libraryPath"].trim()) {
    result.libraryPath = input["libraryPath"];
    recognized += 1;
    strongSignal = true;
  }

  return strongSignal && recognized >= 2 ? result : null;
}

function readRecentPassages(value: unknown): AdoptableLegacySettings["recentPassages"] | null {
  if (!Array.isArray(value)) return null;
  const result: NonNullable<AdoptableLegacySettings["recentPassages"]> = [];
  for (const entry of value.slice(-50)) {
    const parsed = readPassage(entry, true);
    if (!parsed || !isRecord(entry) || !Number.isFinite(entry["visitedAt"])) return null;
    result.push({ ...parsed, visitedAt: Number(entry["visitedAt"]) });
  }
  return result;
}

function readPassage(value: unknown, allowVerse: true): { book: string; chapter: number; verse?: number; packageId: string } | null;
function readPassage(value: unknown, allowVerse: false): { book: string; chapter: number; packageId: string } | null;
function readPassage(value: unknown, allowVerse: boolean): { book: string; chapter: number; verse?: number; packageId: string } | null {
  if (!isRecord(value)) return null;
  if (typeof value["book"] !== "string" || !value["book"].trim()) return null;
  if (!Number.isSafeInteger(value["chapter"]) || Number(value["chapter"]) < 1) return null;
  if (typeof value["packageId"] !== "string" || !value["packageId"].trim()) return null;
  const passage = { book: value["book"], chapter: Number(value["chapter"]), packageId: value["packageId"] };
  if (!allowVerse || value["verse"] == null) return passage;
  if (!Number.isSafeInteger(value["verse"]) || Number(value["verse"]) < 1) return null;
  return { ...passage, verse: Number(value["verse"]) };
}

function readWindowBounds(value: unknown): NonNullable<AdoptableLegacySettings["windowBounds"]> | null {
  if (!isRecord(value)) return null;
  if (!positiveInteger(value["width"]) || !positiveInteger(value["height"])) return null;
  if (value["x"] != null && !Number.isFinite(value["x"])) return null;
  if (value["y"] != null && !Number.isFinite(value["y"])) return null;
  return {
    width: Number(value["width"]),
    height: Number(value["height"]),
    ...(value["x"] == null ? {} : { x: Number(value["x"]) }),
    ...(value["y"] == null ? {} : { y: Number(value["y"]) }),
  };
}

function positiveInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
