/**
 * Versioned Scripture -> Shepherdly project-resource handoff.
 *
 * The packet is deliberately a cited research pointer with a small preview.
 * It is not sermon body content, and its fixed delivery contract requires a
 * separate, explicit editor insertion after attachment to a project.
 */

import type { TipnrEntity } from "../language/tipnr.js";
import { parseBref, type ParseResult } from "../reference/parser.js";
import type { RankedTrustedResource } from "../resources/trusted-resources.js";

export const SHEPHERDLY_RESOURCE_NODE_SCHEMA = "shepherdly.resource-node" as const;
export const SHEPHERDLY_RESOURCE_NODE_VERSION = 1 as const;
export const SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION = 2 as const;

export type ShepherdlyProjectKind = "sermon" | "class" | "project";
export type EntityOpeningRelationship = "direct-mention" | "research-context";

export type EntityOpeningOrigin = {
  book: string;
  chapter: number;
  chapterEndVerse: number;
  verseStart?: number;
  verseEnd?: number;
  packageId: string;
};

export type EntityOpeningContext = {
  originBref: string;
  scope: "selection" | "chapter";
  relationship: EntityOpeningRelationship;
  mentionRefs: string[];
  mentionBrefs: string[];
};

export type ShepherdlyResourceProvenance = {
  sourceId: string;
  name: string;
  license: string;
  sourceUrl?: string;
  attribution: string;
};

export type ShepherdlyResourceNodeV1 = {
  schema: typeof SHEPHERDLY_RESOURCE_NODE_SCHEMA;
  version: typeof SHEPHERDLY_RESOURCE_NODE_VERSION;
  intent: "attach-resource";
  delivery: {
    surface: "project-resources";
    projectKinds: ShepherdlyProjectKind[];
    editorInsertion: "explicit-only";
  };
  resource: {
    kind: "scripture.entity";
    sourceId: string;
    title: string;
    summary: string;
    entityKind: "person" | "place" | "other";
    canonicalAnchor: string;
  };
  context: {
    originBref: string;
    scope: "selection" | "chapter";
    relationship: EntityOpeningRelationship;
    mentionBrefs: string[];
    renderedExcerpt?: {
      packageId: string;
      bref: string;
      text: string;
    };
  };
  locator: {
    app: "scripture-library";
    view: "entity-research";
    entityId: string;
    originBref: string;
  };
  provenance: ShepherdlyResourceProvenance[];
};

/** Prepared contract only. No sender is exposed until Shepherdly has receipts and target selection. */
export type ShepherdlyExternalResourceNodeV2 = {
  schema: typeof SHEPHERDLY_RESOURCE_NODE_SCHEMA;
  version: typeof SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION;
  intent: "attach-resource";
  delivery: {
    surface: "project-resources";
    projectKinds: ShepherdlyProjectKind[];
    editorInsertion: "explicit-only";
  };
  resource: {
    kind: "external.trusted-resource";
    sourceId: string;
    resourceId: string;
    title: string;
    resourceKind: "article" | "commentary" | "guide" | "podcast" | "video";
    officialUrl: string;
    canonicalAnchors: string[];
  };
  context: {
    originBref: string;
    matchedBref: string;
    match: "exact-passage" | "overlap" | "same-chapter";
  };
  locator: {
    app: "scripture-library";
    view: "trusted-resource";
    sourceId: string;
    resourceId: string;
    officialUrl: string;
  };
  provenance: {
    sourceName: string;
    manifestSchema: "pericope.trusted-resource-manifest";
    manifestVersion: 1;
    matchBasis: "publisher-catalog" | "publisher-scripture-tag" | "publisher-title";
    reviewedAt: string;
  };
};

export type ShepherdlyResourceNode = ShepherdlyResourceNodeV1 | ShepherdlyExternalResourceNodeV2;

export type BuildEntityResourceNodeInput = {
  entity: Pick<TipnrEntity, "id" | "kind" | "displayName" | "brief" | "firstRef" | "refs">;
  origin: EntityOpeningOrigin;
  verseText?: Array<{ verse: number; text: string }>;
};

const TIPNR_PROVENANCE: ShepherdlyResourceProvenance = {
  sourceId: "stepbible-tipnr-v4",
  name: "STEPBible TIPNR",
  license: "CC BY 4.0",
  sourceUrl: "https://github.com/STEPBible/STEPBible-Data",
  attribution: "STEPBible TIPNR, CC BY 4.0, stepbible.org.",
};

const MAX_EXCERPT_LENGTH = 600;

/**
 * Resolve what the opening passage can truthfully say about an entity.
 * A shared current book is not evidence; only an indexed reference inside the
 * exact opening selection/chapter earns `direct-mention`.
 */
export function deriveEntityOpeningContext(
  entityRefs: string[],
  origin: EntityOpeningOrigin,
): ParseResult<EntityOpeningContext> {
  if (!Number.isInteger(origin.chapter) || origin.chapter < 1) {
    return { ok: false, error: "Opening chapter must be a positive integer" };
  }
  if (!Number.isInteger(origin.chapterEndVerse) || origin.chapterEndVerse < 1) {
    return { ok: false, error: "Opening chapter end verse must be a positive integer" };
  }
  if (origin.verseEnd != null && origin.verseStart == null) {
    return { ok: false, error: "Opening verseEnd requires verseStart" };
  }

  const scope = origin.verseStart == null ? "chapter" : "selection";
  const startVerse = origin.verseStart ?? 1;
  const endVerse = origin.verseStart == null
    ? origin.chapterEndVerse
    : origin.verseEnd ?? origin.verseStart;
  if (
    !Number.isInteger(startVerse)
    || !Number.isInteger(endVerse)
    || startVerse < 1
    || endVerse < startVerse
    || endVerse > origin.chapterEndVerse
  ) {
    return { ok: false, error: "Opening verse range is outside the chapter" };
  }

  const originBref = rangeBref(origin.book, origin.chapter, startVerse, endVerse);
  const parsedOrigin = parseBref(originBref);
  if (!parsedOrigin.ok) return parsedOrigin;

  const mentionRefs = entityRefs
    .map(parseEntityRef)
    .filter((ref): ref is ParsedEntityRef => ref != null)
    .filter((ref) => (
      ref.book === origin.book
      && ref.chapter === origin.chapter
      && ref.verse >= startVerse
      && ref.verse <= endVerse
    ))
    .sort((left, right) => left.verse - right.verse)
    .filter((ref, index, all) => index === 0 || ref.key !== all[index - 1]?.key)
    .map((ref) => ref.key);
  const mentionBrefs = mentionRefs.map((ref) => `bref:v1/${ref}`);

  return {
    ok: true,
    value: {
      originBref,
      scope,
      relationship: mentionRefs.length > 0 ? "direct-mention" : "research-context",
      mentionRefs,
      mentionBrefs,
    },
  };
}

/** Build the first concrete resource-node kind: a TIPNR entity research node. */
export function buildShepherdlyEntityResourceNode(
  input: BuildEntityResourceNodeInput,
): ParseResult<ShepherdlyResourceNodeV1> {
  const opening = deriveEntityOpeningContext(input.entity.refs, input.origin);
  if (!opening.ok) return opening;

  const fallbackRef = [input.entity.firstRef, ...input.entity.refs]
    .filter((ref): ref is string => typeof ref === "string")
    .map(parseEntityRef)
    .find((ref): ref is ParsedEntityRef => ref != null);
  const canonicalAnchor = opening.value.mentionBrefs[0]
    ?? (fallbackRef ? `bref:v1/${fallbackRef.key}` : null);
  if (!canonicalAnchor) {
    return { ok: false, error: "Entity resource requires at least one canonical Scripture reference" };
  }

  const firstMention = opening.value.mentionRefs[0];
  const firstMentionVerse = firstMention ? parseEntityRef(firstMention)?.verse : undefined;
  const excerptText = firstMentionVerse == null
    ? undefined
    : input.verseText?.find((entry) => entry.verse === firstMentionVerse)?.text.trim();
  const renderedExcerpt = excerptText && opening.value.mentionBrefs[0]
    ? {
        packageId: input.origin.packageId,
        bref: opening.value.mentionBrefs[0],
        text: truncateExcerpt(excerptText),
      }
    : undefined;

  const node: ShepherdlyResourceNodeV1 = {
    schema: SHEPHERDLY_RESOURCE_NODE_SCHEMA,
    version: SHEPHERDLY_RESOURCE_NODE_VERSION,
    intent: "attach-resource",
    delivery: {
      surface: "project-resources",
      projectKinds: ["sermon", "class", "project"],
      editorInsertion: "explicit-only",
    },
    resource: {
      kind: "scripture.entity",
      sourceId: input.entity.id,
      title: input.entity.displayName.trim(),
      summary: input.entity.brief.trim(),
      entityKind: input.entity.kind,
      canonicalAnchor,
    },
    context: {
      originBref: opening.value.originBref,
      scope: opening.value.scope,
      relationship: opening.value.relationship,
      mentionBrefs: opening.value.mentionBrefs,
      ...(renderedExcerpt ? { renderedExcerpt } : {}),
    },
    locator: {
      app: "scripture-library",
      view: "entity-research",
      entityId: input.entity.id,
      originBref: opening.value.originBref,
    },
    provenance: [{ ...TIPNR_PROVENANCE }],
  };
  return validateShepherdlyResourceNodeV1(node);
}

export function buildShepherdlyExternalResourceNode(
  ranked: RankedTrustedResource,
  originBref: string,
  matchedBref: string,
): ParseResult<ShepherdlyExternalResourceNodeV2> {
  const node: ShepherdlyExternalResourceNodeV2 = {
    schema: SHEPHERDLY_RESOURCE_NODE_SCHEMA,
    version: SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION,
    intent: "attach-resource",
    delivery: { surface: "project-resources", projectKinds: ["sermon", "class", "project"], editorInsertion: "explicit-only" },
    resource: {
      kind: "external.trusted-resource",
      sourceId: ranked.source.id,
      resourceId: ranked.record.id,
      title: ranked.record.title,
      resourceKind: ranked.record.kind,
      officialUrl: ranked.record.officialUrl,
      canonicalAnchors: [...ranked.record.brefs],
    },
    context: { originBref, matchedBref, match: ranked.match },
    locator: {
      app: "scripture-library",
      view: "trusted-resource",
      sourceId: ranked.source.id,
      resourceId: ranked.record.id,
      officialUrl: ranked.record.officialUrl,
    },
    provenance: {
      sourceName: ranked.source.name,
      manifestSchema: "pericope.trusted-resource-manifest",
      manifestVersion: 1,
      matchBasis: ranked.record.matchBasis,
      reviewedAt: ranked.provenance.reviewedAt,
    },
  };
  return validateShepherdlyExternalResourceNodeV2(node);
}

/**
 * Strict trust-boundary validation for a packet received by another app.
 * Unknown keys are refused so prose/body fields cannot quietly become an
 * unofficial editor-insertion channel.
 */
export function validateShepherdlyResourceNode(input: unknown): ParseResult<ShepherdlyResourceNode> {
  if (isRecord(input) && input["schema"] === SHEPHERDLY_RESOURCE_NODE_SCHEMA && input["version"] === SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION) {
    return validateShepherdlyExternalResourceNodeV2(input);
  }
  return validateShepherdlyResourceNodeV1(input);
}

function validateShepherdlyResourceNodeV1(input: unknown): ParseResult<ShepherdlyResourceNodeV1> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["schema", "version", "intent", "delivery", "resource", "context", "locator", "provenance"])) {
    return { ok: false, error: "Resource node has unknown or missing top-level fields" };
  }
  if (input["schema"] !== SHEPHERDLY_RESOURCE_NODE_SCHEMA || input["version"] !== SHEPHERDLY_RESOURCE_NODE_VERSION) {
    return { ok: false, error: "Unsupported Shepherdly resource-node schema or version" };
  }
  if (input["intent"] !== "attach-resource") {
    return { ok: false, error: "Resource node intent must be attach-resource" };
  }

  const delivery = input["delivery"];
  if (!isRecord(delivery) || !hasOnlyKeys(delivery, ["surface", "projectKinds", "editorInsertion"])) {
    return { ok: false, error: "Invalid resource-node delivery contract" };
  }
  if (delivery["surface"] !== "project-resources" || delivery["editorInsertion"] !== "explicit-only") {
    return { ok: false, error: "Resource nodes may only attach to project resources with explicit editor insertion" };
  }
  const projectKinds = readProjectKinds(delivery["projectKinds"]);
  if (!projectKinds.ok) return projectKinds;

  const resource = input["resource"];
  if (!isRecord(resource) || !hasOnlyKeys(resource, ["kind", "sourceId", "title", "summary", "entityKind", "canonicalAnchor"])) {
    return { ok: false, error: "Invalid entity resource" };
  }
  if (resource["kind"] !== "scripture.entity") return { ok: false, error: "Unsupported resource kind" };
  const sourceId = readNonEmptyString(resource["sourceId"], "resource.sourceId");
  if (!sourceId.ok) return sourceId;
  const title = readNonEmptyString(resource["title"], "resource.title");
  if (!title.ok) return title;
  const summary = readNonEmptyString(resource["summary"], "resource.summary");
  if (!summary.ok) return summary;
  const entityKind = readEntityKind(resource["entityKind"]);
  if (!entityKind.ok) return entityKind;
  const canonicalAnchor = readBref(resource["canonicalAnchor"], "resource.canonicalAnchor");
  if (!canonicalAnchor.ok) return canonicalAnchor;

  const context = input["context"];
  if (!isRecord(context) || !hasOnlyKeys(context, ["originBref", "scope", "relationship", "mentionBrefs", "renderedExcerpt"], ["renderedExcerpt"])) {
    return { ok: false, error: "Invalid resource-node opening context" };
  }
  const originBref = readBref(context["originBref"], "context.originBref");
  if (!originBref.ok) return originBref;
  const scope = context["scope"];
  if (scope !== "selection" && scope !== "chapter") return { ok: false, error: "Invalid opening context scope" };
  const relationship = context["relationship"];
  if (relationship !== "direct-mention" && relationship !== "research-context") {
    return { ok: false, error: "Invalid opening context relationship" };
  }
  const mentionBrefs = readBrefs(context["mentionBrefs"], "context.mentionBrefs");
  if (!mentionBrefs.ok) return mentionBrefs;
  if (relationship === "direct-mention" && mentionBrefs.value.length === 0) {
    return { ok: false, error: "A direct mention requires supporting Scripture coordinates" };
  }
  if (relationship === "research-context" && mentionBrefs.value.length > 0) {
    return { ok: false, error: "Research context cannot carry direct-mention coordinates" };
  }
  for (const mentionBref of mentionBrefs.value) {
    if (!brefContains(originBref.value, mentionBref)) {
      return { ok: false, error: "Mention coordinate falls outside the opening context" };
    }
  }
  const renderedExcerpt = readRenderedExcerpt(context["renderedExcerpt"], mentionBrefs.value);
  if (!renderedExcerpt.ok) return renderedExcerpt;

  const locator = input["locator"];
  if (!isRecord(locator) || !hasOnlyKeys(locator, ["app", "view", "entityId", "originBref"])) {
    return { ok: false, error: "Invalid Scripture resource locator" };
  }
  if (locator["app"] !== "scripture-library" || locator["view"] !== "entity-research") {
    return { ok: false, error: "Unsupported Scripture resource locator" };
  }
  const locatorEntityId = readNonEmptyString(locator["entityId"], "locator.entityId");
  if (!locatorEntityId.ok) return locatorEntityId;
  if (locatorEntityId.value !== sourceId.value) return { ok: false, error: "Resource and locator entity IDs differ" };
  const locatorOrigin = readBref(locator["originBref"], "locator.originBref");
  if (!locatorOrigin.ok) return locatorOrigin;
  if (locatorOrigin.value !== originBref.value) return { ok: false, error: "Context and locator origins differ" };

  const provenance = readProvenance(input["provenance"]);
  if (!provenance.ok) return provenance;

  return {
    ok: true,
    value: {
      schema: SHEPHERDLY_RESOURCE_NODE_SCHEMA,
      version: SHEPHERDLY_RESOURCE_NODE_VERSION,
      intent: "attach-resource",
      delivery: {
        surface: "project-resources",
        projectKinds: projectKinds.value,
        editorInsertion: "explicit-only",
      },
      resource: {
        kind: "scripture.entity",
        sourceId: sourceId.value,
        title: title.value,
        summary: summary.value,
        entityKind: entityKind.value,
        canonicalAnchor: canonicalAnchor.value,
      },
      context: {
        originBref: originBref.value,
        scope,
        relationship,
        mentionBrefs: mentionBrefs.value,
        ...(renderedExcerpt.value ? { renderedExcerpt: renderedExcerpt.value } : {}),
      },
      locator: {
        app: "scripture-library",
        view: "entity-research",
        entityId: locatorEntityId.value,
        originBref: locatorOrigin.value,
      },
      provenance: provenance.value,
    },
  };
}

function validateShepherdlyExternalResourceNodeV2(input: unknown): ParseResult<ShepherdlyExternalResourceNodeV2> {
  if (!isRecord(input) || !hasOnlyKeys(input, ["schema", "version", "intent", "delivery", "resource", "context", "locator", "provenance"])) return { ok: false, error: "Resource node has unknown or missing top-level fields" };
  if (input["schema"] !== SHEPHERDLY_RESOURCE_NODE_SCHEMA || input["version"] !== SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION) return { ok: false, error: "Unsupported Shepherdly resource-node schema or version" };
  if (input["intent"] !== "attach-resource") return { ok: false, error: "Resource node intent must be attach-resource" };
  const delivery = input["delivery"];
  if (!isRecord(delivery) || !hasOnlyKeys(delivery, ["surface", "projectKinds", "editorInsertion"]) || delivery["surface"] !== "project-resources" || delivery["editorInsertion"] !== "explicit-only") return { ok: false, error: "Resource nodes may only attach to project resources with explicit editor insertion" };
  const projectKinds = readProjectKinds(delivery["projectKinds"]); if (!projectKinds.ok) return projectKinds;
  const resource = input["resource"];
  if (!isRecord(resource) || !hasOnlyKeys(resource, ["kind", "sourceId", "resourceId", "title", "resourceKind", "officialUrl", "canonicalAnchors"]) || resource["kind"] !== "external.trusted-resource") return { ok: false, error: "Invalid external resource" };
  const sourceId = readNonEmptyString(resource["sourceId"], "resource.sourceId"); if (!sourceId.ok) return sourceId;
  const resourceId = readNonEmptyString(resource["resourceId"], "resource.resourceId"); if (!resourceId.ok) return resourceId;
  const title = readNonEmptyString(resource["title"], "resource.title"); if (!title.ok) return title;
  const resourceKind = resource["resourceKind"];
  if (!["article", "commentary", "guide", "podcast", "video"].includes(String(resourceKind))) return { ok: false, error: "Unsupported external resource kind" };
  const officialUrl = readHttpsUrl(resource["officialUrl"], "resource.officialUrl"); if (!officialUrl.ok) return officialUrl;
  const canonicalAnchors = readBrefs(resource["canonicalAnchors"], "resource.canonicalAnchors"); if (!canonicalAnchors.ok || canonicalAnchors.value.length === 0) return canonicalAnchors.ok ? { ok: false, error: "External resource requires canonical anchors" } : canonicalAnchors;
  const context = input["context"];
  if (!isRecord(context) || !hasOnlyKeys(context, ["originBref", "matchedBref", "match"])) return { ok: false, error: "Invalid external resource context" };
  const originBref = readBref(context["originBref"], "context.originBref"); if (!originBref.ok) return originBref;
  const matchedBref = readBref(context["matchedBref"], "context.matchedBref"); if (!matchedBref.ok) return matchedBref;
  if (!canonicalAnchors.value.includes(matchedBref.value)) return { ok: false, error: "Matched bref must be one of the resource anchors" };
  const match = context["match"];
  if (match !== "exact-passage" && match !== "overlap" && match !== "same-chapter") return { ok: false, error: "Invalid external resource match" };
  const locator = input["locator"];
  if (!isRecord(locator) || !hasOnlyKeys(locator, ["app", "view", "sourceId", "resourceId", "officialUrl"]) || locator["app"] !== "scripture-library" || locator["view"] !== "trusted-resource" || locator["sourceId"] !== sourceId.value || locator["resourceId"] !== resourceId.value || locator["officialUrl"] !== officialUrl.value) return { ok: false, error: "Invalid external resource locator" };
  const provenance = input["provenance"];
  if (!isRecord(provenance) || !hasOnlyKeys(provenance, ["sourceName", "manifestSchema", "manifestVersion", "matchBasis", "reviewedAt"])) return { ok: false, error: "Invalid external resource provenance" };
  const sourceName = readNonEmptyString(provenance["sourceName"], "provenance.sourceName"); if (!sourceName.ok) return sourceName;
  const reviewedAt = readNonEmptyString(provenance["reviewedAt"], "provenance.reviewedAt"); if (!reviewedAt.ok) return reviewedAt;
  const matchBasis = provenance["matchBasis"];
  if (provenance["manifestSchema"] !== "pericope.trusted-resource-manifest" || provenance["manifestVersion"] !== 1 || !["publisher-catalog", "publisher-scripture-tag", "publisher-title"].includes(String(matchBasis))) return { ok: false, error: "Invalid trusted manifest provenance" };
  return { ok: true, value: {
    schema: SHEPHERDLY_RESOURCE_NODE_SCHEMA, version: SHEPHERDLY_EXTERNAL_RESOURCE_NODE_VERSION, intent: "attach-resource",
    delivery: { surface: "project-resources", projectKinds: projectKinds.value, editorInsertion: "explicit-only" },
    resource: { kind: "external.trusted-resource", sourceId: sourceId.value, resourceId: resourceId.value, title: title.value, resourceKind: resourceKind as ShepherdlyExternalResourceNodeV2["resource"]["resourceKind"], officialUrl: officialUrl.value, canonicalAnchors: canonicalAnchors.value },
    context: { originBref: originBref.value, matchedBref: matchedBref.value, match },
    locator: { app: "scripture-library", view: "trusted-resource", sourceId: sourceId.value, resourceId: resourceId.value, officialUrl: officialUrl.value },
    provenance: { sourceName: sourceName.value, manifestSchema: "pericope.trusted-resource-manifest", manifestVersion: 1, matchBasis: matchBasis as ShepherdlyExternalResourceNodeV2["provenance"]["matchBasis"], reviewedAt: reviewedAt.value },
  } };
}

type ParsedEntityRef = { key: string; book: string; chapter: number; verse: number };

function parseEntityRef(value: string): ParsedEntityRef | null {
  const match = /^([1-3A-Z]{3})\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return null;
  const chapter = Number(match[2]);
  const verse = Number(match[3]);
  if (!Number.isInteger(chapter) || !Number.isInteger(verse) || chapter < 1 || verse < 1) return null;
  return { key: value, book: match[1]!, chapter, verse };
}

function rangeBref(book: string, chapter: number, startVerse: number, endVerse: number): string {
  const start = `${book}.${chapter}.${startVerse}`;
  return startVerse === endVerse ? `bref:v1/${start}` : `bref:v1/${start}-${book}.${chapter}.${endVerse}`;
}

function truncateExcerpt(value: string): string {
  if (value.length <= MAX_EXCERPT_LENGTH) return value;
  return `${value.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value != null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: string[], optional: string[] = []): boolean {
  return Object.keys(value).every((key) => allowed.includes(key))
    && allowed.filter((key) => !optional.includes(key)).every((key) => key in value);
}

function readProjectKinds(value: unknown): ParseResult<ShepherdlyProjectKind[]> {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "delivery.projectKinds must be non-empty" };
  const result: ShepherdlyProjectKind[] = [];
  for (const item of value) {
    if (item !== "sermon" && item !== "class" && item !== "project") {
      return { ok: false, error: "Unsupported Shepherdly project kind" };
    }
    if (!result.includes(item)) result.push(item);
  }
  return { ok: true, value: result };
}

function readEntityKind(value: unknown): ParseResult<"person" | "place" | "other"> {
  if (value !== "person" && value !== "place" && value !== "other") {
    return { ok: false, error: "Invalid entity kind" };
  }
  return { ok: true, value };
}

function readNonEmptyString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== "string" || value.trim() === "") return { ok: false, error: `${field} must be a non-empty string` };
  return { ok: true, value: value.trim() };
}

function readHttpsUrl(value: unknown, field: string): ParseResult<string> {
  const text = readNonEmptyString(value, field);
  if (!text.ok) return text;
  try {
    const url = new URL(text.value);
    if (url.protocol !== "https:") return { ok: false, error: `${field} must use HTTPS` };
    return text;
  } catch {
    return { ok: false, error: `${field} must be a valid URL` };
  }
}

function readBref(value: unknown, field: string): ParseResult<string> {
  const text = readNonEmptyString(value, field);
  if (!text.ok) return text;
  const parsed = parseBref(text.value);
  if (!parsed.ok) return { ok: false, error: `${field}: ${parsed.error}` };
  if (parsed.value.tokenNarrowing) {
    return { ok: false, error: `${field} must use a translation-free verse coordinate` };
  }
  return text;
}

function readBrefs(value: unknown, field: string): ParseResult<string[]> {
  if (!Array.isArray(value)) return { ok: false, error: `${field} must be an array` };
  const result: string[] = [];
  for (const item of value) {
    const bref = readBref(item, field);
    if (!bref.ok) return bref;
    if (!result.includes(bref.value)) result.push(bref.value);
  }
  return { ok: true, value: result };
}

function readRenderedExcerpt(
  value: unknown,
  mentionBrefs: string[],
): ParseResult<ShepherdlyResourceNodeV1["context"]["renderedExcerpt"]> {
  if (value === undefined) return { ok: true, value: undefined };
  if (!isRecord(value) || !hasOnlyKeys(value, ["packageId", "bref", "text"])) {
    return { ok: false, error: "Invalid rendered excerpt" };
  }
  const packageId = readNonEmptyString(value["packageId"], "context.renderedExcerpt.packageId");
  if (!packageId.ok) return packageId;
  const bref = readBref(value["bref"], "context.renderedExcerpt.bref");
  if (!bref.ok) return bref;
  if (!mentionBrefs.includes(bref.value)) return { ok: false, error: "Rendered excerpt must cite a direct mention" };
  const text = readNonEmptyString(value["text"], "context.renderedExcerpt.text");
  if (!text.ok) return text;
  if (text.value.length > MAX_EXCERPT_LENGTH) return { ok: false, error: "Rendered excerpt is too long" };
  return { ok: true, value: { packageId: packageId.value, bref: bref.value, text: text.value } };
}

function readProvenance(value: unknown): ParseResult<ShepherdlyResourceProvenance[]> {
  if (!Array.isArray(value) || value.length === 0) return { ok: false, error: "Resource provenance must be non-empty" };
  const result: ShepherdlyResourceProvenance[] = [];
  for (const item of value) {
    if (!isRecord(item) || !hasOnlyKeys(item, ["sourceId", "name", "license", "sourceUrl", "attribution"], ["sourceUrl"])) {
      return { ok: false, error: "Invalid resource provenance" };
    }
    const sourceId = readNonEmptyString(item["sourceId"], "provenance.sourceId");
    if (!sourceId.ok) return sourceId;
    const name = readNonEmptyString(item["name"], "provenance.name");
    if (!name.ok) return name;
    const license = readNonEmptyString(item["license"], "provenance.license");
    if (!license.ok) return license;
    const attribution = readNonEmptyString(item["attribution"], "provenance.attribution");
    if (!attribution.ok) return attribution;
    const sourceUrlValue = item["sourceUrl"];
    if (sourceUrlValue !== undefined && (typeof sourceUrlValue !== "string" || !/^https:\/\//.test(sourceUrlValue))) {
      return { ok: false, error: "provenance.sourceUrl must be HTTPS" };
    }
    result.push({
      sourceId: sourceId.value,
      name: name.value,
      license: license.value,
      ...(typeof sourceUrlValue === "string" ? { sourceUrl: sourceUrlValue } : {}),
      attribution: attribution.value,
    });
  }
  return { ok: true, value: result };
}

function brefContains(outerBref: string, innerBref: string): boolean {
  const outer = parseBref(outerBref);
  const inner = parseBref(innerBref);
  if (!outer.ok || !inner.ok) return false;
  const compare = (left: typeof outer.value.start, right: typeof outer.value.start): number => {
    if (left.book !== right.book) return left.book.localeCompare(right.book);
    return left.chapter - right.chapter || left.verse - right.verse;
  };
  return compare(inner.value.start, outer.value.start) >= 0
    && compare(inner.value.end, outer.value.end) <= 0;
}
