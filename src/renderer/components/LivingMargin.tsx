import type React from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AnchorRecord,
  BookNameData,
  CrossReferenceMatchData,
  CrossReferenceResultData,
  ConnectionRecord,
  EntityResearchData,
  LanguageEntityRangeResult,
  NoteRecord,
  ParsedNoteData,
  QueryResult,
  SemanticMarginResult,
  SuggestedCrossRefData,
} from "../api.js";
import {
  deriveEntityOpeningContext,
  type EntityOpeningOrigin,
} from "../../core/integrations/shepherdly-resource-node.js";
import { safeCall } from "../utils/safeCall.js";
import { LanguageWordsSection } from "./LanguageWordsSection.js";
import { useToast } from "./Toast.js";

export interface PinnedRange {
  start: number;
  end: number;
}

export interface LivingMarginCaptureRequest {
  excerpt: string;
  sourceAttribution: string;
  reference: string;
  frozenOrigin: string;
  originLabel: "Related verse" | "Passage insight" | "Entity research" | "Word study";
}

export interface MarginCitationSource {
  name: string;
  license: string;
  detail?: string;
  citation?: string;
}

export function formatMarginSourceCitation(source: MarginCitationSource): string {
  return source.citation?.trim()
    || [source.name, source.license, source.detail].filter(Boolean).join(" · ");
}

function MarginSourcesDisclosure({ sources }: { sources: MarginCitationSource[] }): React.JSX.Element | null {
  const { showToast } = useToast();
  if (sources.length === 0) return null;
  const copyCitation = async (source: MarginCitationSource): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatMarginSourceCitation(source));
      showToast("Citation copied.", undefined, undefined, { tone: "success" });
    } catch {
      showToast("The citation could not be copied.", undefined, undefined, { tone: "error" });
    }
  };
  return (
    <details className="margin-sources">
      <summary>Sources</summary>
      <div className="margin-source-list">
        {sources.map((source) => (
          <div className="margin-source-row" key={`${source.name}-${source.license}-${source.detail ?? ""}`}>
            <span className="margin-source-copy">
              <span>{source.name} <span aria-hidden="true">·</span> {source.license}</span>
              {source.detail && <span className="margin-source-detail">{source.detail}</span>}
            </span>
            <button
              type="button"
              className="margin-source-cite"
              aria-label={`Copy citation for ${source.name}`}
              onClick={() => void copyCitation(source)}
            >
              Cite
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}

type MarginTab = "overview" | "connections" | "passage" | "notes";

export interface EntityResearchTrailEntry {
  id: string;
  displayName: string;
}

export const ENTITY_RESEARCH_TRAIL_LIMIT = 12;

export function appendEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  entry: EntityResearchTrailEntry,
): EntityResearchTrailEntry[] {
  const current = trail.at(-1);
  if (current?.id === entry.id) {
    return current.displayName === entry.displayName
      ? [...trail]
      : [...trail.slice(0, -1), entry];
  }
  return [...trail, entry].slice(-ENTITY_RESEARCH_TRAIL_LIMIT);
}

export function truncateEntityResearchTrail(
  trail: readonly EntityResearchTrailEntry[],
  index: number,
): EntityResearchTrailEntry[] {
  if (index < 0 || index >= trail.length) return [...trail];
  return trail.slice(0, index + 1);
}

const MARGIN_TABS: Array<{ id: MarginTab; label: string; accessibleLabel: string }> = [
  { id: "overview", label: "Overview", accessibleLabel: "Overview" },
  { id: "connections", label: "Related", accessibleLabel: "Related verses" },
  { id: "passage", label: "Words", accessibleLabel: "Words & structure" },
  { id: "notes", label: "My notes", accessibleLabel: "My notes" },
];

const PANEL_FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "a[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(", ");

interface Props {
  book: string;
  chapter: number;
  packageId: string;
  marginData: QueryResult;
  crossRefs: CrossReferenceResultData | null;
  bookNames: BookNameData;
  semanticData?: SemanticMarginResult | null;
  semanticLoading?: boolean;
  /** Full verse text for the current chapter, keyed by verse number — used to
   * build the passage-scoped AI insight call. */
  chapterVerseText?: Map<number, string>;
  /** Display-only verse text that may retain the previous package for the
   * brief translation handoff. It must never feed package-scoped analysis. */
  displayChapterVerseText?: Map<number, string>;
  /** True while the active translation text is still resolving. */
  chapterTextLoading?: boolean;
  /** Derived selected/"pinned" range from ScripturePage (min/max of selectedVerses). */
  pinnedRange?: PinnedRange | null;
  /** The verse nearest the reading eye-line, when nothing is pinned. */
  nearVerse?: number | null;
  onPinClaim?: (claimId: string, assertion: string) => Promise<boolean> | boolean;
  /** Remove every complete visual highlight touched by the pinned range. */
  onRemoveHighlights?: (entityIds: string[]) => void;
  /** Create a note from the pinned range (same path as the mini toolbar). */
  onCreateNote?: () => void;
  /** Open explicit-save capture with visible source and study provenance. */
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
  /** Navigate to a cross-reference's target passage (e.g. "Matthew 3:11"). */
  onNavigateToRef?: (ref: string) => void;
  /** Keep original-language study aligned with its explicit verse. */
  onStudyVerse?: (verse: number) => void;
  /** Pointer entered/left the margin (freeze ambient eye-line while true). */
  onMarginActiveChange?: (active: boolean) => void;
  /** Leave the explicit selected-passage state and return to the reading eye-line. */
  onClearSelection?: () => void;
  /** Renderer-session tab state used by reversible canvas travel. */
  activeTab?: MarginTab;
  onActiveTabChange?: (tab: MarginTab) => void;
  entityIntent?: {
    id: string;
    nonce: number;
    origin: { book: string; chapter: number; chapterEndVerse?: number; packageId: string; verseStart?: number; verseEnd?: number };
  } | null;
  onOpenEntity?: (entityId: string) => void;
  onCloseEntity?: () => void;
  entityTrail?: readonly EntityResearchTrailEntry[];
  onEntityTrailChange?: (
    update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
  ) => void;
  /** A selected user-authored connection, composed by ScripturePage. */
  connectionInspector?: React.ReactNode;
  /** Durable authored relationships remain reachable even when this package
   * has no exact word projection and therefore no reading-canvas tick. */
  authoredConnections?: readonly ConnectionRecord[];
  selectedAuthoredConnectionId?: string | null;
  onSelectAuthoredConnection?: (connection: ConnectionRecord, focusInspector?: boolean) => void;
  /** Incremented for explicit inspector-entry requests. Reading-canvas pointer
   * activation deliberately leaves this unchanged so Scripture keeps focus. */
  connectionInspectorFocusRequest?: number;
}

function AiSparkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
      <path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5l-1.3-4.2L4.5 8l4.2-1.3z" />
    </svg>
  );
}

function PassageQuote({
  text,
  contextKey,
}: {
  text: string;
  contextKey: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const canExpand = text.length > 220;

  useEffect(() => {
    setExpanded(false);
  }, [contextKey]);

  return (
    <div className="margin-quote-wrap">
      <blockquote className={`margin-focus-quote${canExpand && !expanded ? " is-collapsed" : ""}`}>
        {text}
      </blockquote>
      {canExpand && (
        <button
          type="button"
          className="margin-quote-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Show less" : "Read full selection"}
          <span aria-hidden="true">{expanded ? "↑" : "↓"}</span>
        </button>
      )}
    </div>
  );
}

function MarginEmptyView({
  title,
  detail,
}: {
  title: string;
  detail: string;
}): React.JSX.Element {
  return (
    <div className="margin-view-empty">
      <h3>{title}</h3>
      <p>{detail}</p>
    </div>
  );
}

function DeepNoteCard({
  title,
  body,
  meta,
  reasons,
  defaultOpen = false,
}: {
  title: string;
  body: string;
  meta?: string;
  reasons?: Array<{ kind: string; label: string }>;
  defaultOpen?: boolean;
}): React.JSX.Element {
  return (
    <details className="deep-note-card" open={defaultOpen || undefined}>
      <summary>
        <span className="deep-note-summary-copy">
          <span className="deep-note-title">{title || "Untitled"}</span>
          {meta && <span className="deep-note-meta">{meta}</span>}
        </span>
        <span className="deep-note-caret" aria-hidden="true">›</span>
      </summary>
      <div className="deep-note-body">{body || "This note has no body text."}</div>
      {reasons && reasons.length > 0 && (
        <div className="card-reasons" aria-label="Why this note surfaced">
          {reasons.map((reason, index) => (
            <span key={`${reason.kind}-${index}`} className={`reason-chip reason-${reason.kind}`}>
              {reason.label}
            </span>
          ))}
        </div>
      )}
    </details>
  );
}

function findNoteForRange(marginData: QueryResult, chapter: number, start: number, end: number): NoteRecord | null {
  const anchor = marginData.anchors.find(
    (a: AnchorRecord) => a.chapter === chapter && a.verse_start <= end && a.verse_end >= start,
  );
  if (!anchor) return null;
  return marginData.notes.find((n) => n.id === anchor.note_id) ?? null;
}

/** Collapsed by default so language stays primary; expand on demand. */
function CrossReferenceArrow(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 12 12 4M6 4h6v6" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function EntityGlyph({ kind }: { kind: "person" | "place" | "other" }): React.JSX.Element {
  if (kind === "place") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 17s4.7-5.1 4.7-8.7a4.7 4.7 0 1 0-9.4 0C5.3 11.9 10 17 10 17Z" />
        <circle cx="10" cy="8.2" r="1.55" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="6.1" r="2.55" />
      <path d="M5 16c.55-3.05 2.2-4.65 5-4.65s4.45 1.6 5 4.65" />
    </svg>
  );
}

function formatResearchRef(value: string, bookNames: BookNameData): string {
  const match = /^([1-3A-Z]{3})\.(\d+)\.(\d+)$/.exec(value);
  if (!match) return value;
  return `${bookNames[match[1]!]?.[0] ?? match[1]} ${Number(match[2])}:${Number(match[3])}`;
}

export function formatEntityResearchOrigin(
  origin: NonNullable<Props["entityIntent"]>["origin"],
  bookNames: BookNameData,
): string {
  const bookLabel = bookNames[origin.book]?.[0] ?? origin.book;
  if (origin.verseStart == null) return `${bookLabel} ${origin.chapter}`;
  const verseRange = origin.verseEnd != null && origin.verseEnd !== origin.verseStart
    ? `${origin.verseStart}–${origin.verseEnd}`
    : `${origin.verseStart}`;
  return `${bookLabel} ${origin.chapter}:${verseRange}`;
}

function entityCaptureSources(data: EntityResearchData): MarginCitationSource[] {
  return [
    { name: "STEPBible TIPNR", license: "CC BY 4.0", detail: "Identity" },
    ...(data.place ? [{
      name: "OpenBible Bible Geocoding",
      license: "CC BY 4.0",
      detail: "Geography",
      citation: `OpenBible Bible Geocoding · CC BY 4.0 · ${data.place.openBibleUrl}`,
    }] : []),
    ...(data.pleiades ? [{
      name: "Pleiades 4.1",
      license: "CC BY 3.0",
      detail: "Ancient gazetteer",
      citation: `Pleiades 4.1 · CC BY 3.0 · ${data.pleiades.place.sourceUrl}`,
    }] : []),
  ];
}

export function buildEntityResearchCapture(
  data: EntityResearchData,
  origin: NonNullable<Props["entityIntent"]>["origin"],
  bookNames: BookNameData,
): LivingMarginCaptureRequest {
  return {
    excerpt: `${data.entity.displayName} — ${data.entity.brief}`,
    sourceAttribution: entityCaptureSources(data)
      .map((source) => `${source.name} (${source.license})`)
      .join("; "),
    reference: data.entity.displayName,
    frozenOrigin: formatEntityResearchOrigin(origin, bookNames),
    originLabel: "Entity research",
  };
}

function entityResearchSources(data: EntityResearchData): MarginCitationSource[] {
  const sources = entityCaptureSources(data);
  if (data.place?.linkedData.wikidataId) {
    sources.push({
      name: `Wikidata ${data.place.linkedData.wikidataId}`,
      license: "CC0",
      detail: "Linked identity",
    });
  }
  if (data.place) sources.push({ name: "Natural Earth", license: "Public domain", detail: "Map" });
  if (data.place?.image) {
    sources.push({
      name: data.place.image.credit,
      license: data.place.image.license,
      detail: "Image",
      citation: `${data.place.image.credit} · ${data.place.image.license} · ${data.place.image.sourceUrl}`,
    });
  }
  return sources;
}

function coordinatesLabel(latitude: number, longitude: number): string {
  const lat = `${Math.abs(latitude).toFixed(3)}°${latitude >= 0 ? "N" : "S"}`;
  const lon = `${Math.abs(longitude).toFixed(3)}°${longitude >= 0 ? "E" : "W"}`;
  return `${lat} · ${lon}`;
}

function confidenceLabel(value: NonNullable<EntityResearchData["place"]>["primary"]["confidence"]): string {
  if (value === "high") return "High confidence";
  if (value === "strong") return "Strong identification";
  if (value === "probable") return "Probable location";
  if (value === "tentative") return "Tentative location";
  return "Location disputed";
}

function placeImageKindLabel(kind: NonNullable<NonNullable<EntityResearchData["place"]>["image"]>["kind"]): string {
  if (kind === "site") return "Proposed site view";
  if (kind === "artifact") return "Associated artifact";
  if (kind === "reception") return "Later reception";
  return "Geographic context";
}

function historicYearLabel(value: number): string {
  if (value < 0) return `${Math.abs(value).toLocaleString()} BC`;
  return `AD ${Math.max(1, value).toLocaleString()}`;
}

function historicPeriodLabel(period: { start: number; end: number } | undefined): string | null {
  if (!period) return null;
  return `${historicYearLabel(period.start)}–${historicYearLabel(period.end)}`;
}

function isBroadPlaceType(value: string): boolean {
  return /region|country|territory|province|district|body of water|sea|river|mountain range|wilderness|island/i.test(value);
}

function pleiadesConnectionLabel(value: string): string {
  if (value === "part_of_physical") return "Within";
  if (value === "part_of_admin") return "Governed within";
  if (value === "member") return "Member of";
  return "Connected to";
}

function coordinateComparisonCopy(
  data: NonNullable<EntityResearchData["pleiades"]>,
  placeType: string,
): string | null {
  const comparison = data.coordinateComparison;
  if (!comparison) return null;
  const distance = comparison.distanceKm < 10
    ? `${comparison.distanceKm.toFixed(1)} km`
    : `${Math.round(comparison.distanceKm).toLocaleString()} km`;
  if (isBroadPlaceType(placeType)) {
    return `For this broad place, OpenBible and Pleiades use representative points ${distance} apart.`;
  }
  if (comparison.relation === "close") return `OpenBible and Pleiades agree within ${distance}.`;
  if (comparison.relation === "regional") return `Pleiades records a nearby point ${distance} away.`;
  return `Sources diverge: the Pleiades point is ${distance} away. Both locations remain distinct.`;
}

type EntityBookFootprint = {
  book: string;
  label: string;
  count: number;
  firstRef: string;
};

function entityBookFootprint(
  refs: string[],
  bookNames: BookNameData,
): EntityBookFootprint[] {
  const canonicalOrder = new Map(Object.keys(bookNames).map((book, index) => [book, index]));
  const byBook = new Map<string, EntityBookFootprint>();
  for (const ref of refs) {
    const match = /^([1-3A-Z]{3})\./.exec(ref);
    if (!match) continue;
    const book = match[1]!;
    const current = byBook.get(book);
    if (current) current.count += 1;
    else byBook.set(book, {
      book,
      label: bookNames[book]?.[0] ?? book,
      count: 1,
      firstRef: ref,
    });
  }
  return [...byBook.values()].sort((left, right) => (
    (canonicalOrder.get(left.book) ?? Number.MAX_SAFE_INTEGER)
    - (canonicalOrder.get(right.book) ?? Number.MAX_SAFE_INTEGER)
  ));
}

function EntityOpeningContextSection({
  data,
  origin,
  currentBook,
  currentChapter,
  chapterVerseText,
  bookNames,
  onNavigate,
}: {
  data: EntityResearchData;
  origin: NonNullable<Props["entityIntent"]>["origin"];
  currentBook: string;
  currentChapter: number;
  chapterVerseText: Map<number, string>;
  bookNames: BookNameData;
  onNavigate?: (ref: string) => void;
}): React.JSX.Element | null {
  const visibleChapterEnd = currentBook === origin.book && currentChapter === origin.chapter
    ? Math.max(1, ...chapterVerseText.keys())
    : 1;
  const openingOrigin: EntityOpeningOrigin = {
    book: origin.book,
    chapter: origin.chapter,
    chapterEndVerse: origin.chapterEndVerse
      ?? Math.max(origin.verseEnd ?? origin.verseStart ?? 1, visibleChapterEnd),
    packageId: origin.packageId,
    ...(origin.verseStart != null ? { verseStart: origin.verseStart } : {}),
    ...(origin.verseEnd != null ? { verseEnd: origin.verseEnd } : {}),
  };
  const result = deriveEntityOpeningContext(data.entity.refs, openingOrigin);
  if (!result.ok) return null;
  const context = result.value;
  const bookLabel = bookNames[origin.book]?.[0] ?? origin.book;
  const rangeLabel = origin.verseStart == null
    ? `${bookLabel} ${origin.chapter}`
    : origin.verseEnd != null && origin.verseEnd !== origin.verseStart
      ? `${bookLabel} ${origin.chapter}:${origin.verseStart}–${origin.verseEnd}`
      : `${bookLabel} ${origin.chapter}:${origin.verseStart}`;
  const scopeLabel = context.scope === "selection" ? "this selection" : "this chapter";
  const firstMention = context.mentionRefs[0];
  const firstMentionVerse = firstMention ? Number(firstMention.split(".")[2]) : null;
  const firstMentionText = firstMentionVerse != null
    && currentBook === origin.book
    && currentChapter === origin.chapter
      ? chapterVerseText.get(firstMentionVerse)?.trim()
      : undefined;

  return (
    <section
      className={`entity-opening-context ${context.relationship === "direct-mention" ? "is-direct" : "is-research"}`}
      aria-labelledby="entity-opening-context-title"
    >
      <div className="entity-opening-context-head">
        <h3 id="entity-opening-context-title">From your reading</h3>
        <span>{rangeLabel}</span>
      </div>
      {context.relationship === "direct-mention" ? (
        <>
          <div className="entity-opening-context-copy">
            <strong>Indexed in {scopeLabel}</strong>
            <span>
              {context.mentionRefs.length.toLocaleString()} {context.mentionRefs.length === 1 ? "direct reference" : "direct references"}
            </span>
          </div>
          {firstMentionText && firstMentionVerse != null && (
            <blockquote>
              <span>{firstMentionVerse}</span>
              <p>{firstMentionText}</p>
            </blockquote>
          )}
          <div className="entity-opening-context-refs" aria-label={`Direct references in ${rangeLabel}`}>
            {context.mentionRefs.slice(0, 4).map((ref) => (
              <button key={ref} type="button" onClick={() => onNavigate?.(`bref:v1/${ref}`)}>
                <span>{formatResearchRef(ref, bookNames)}</span>
                <CrossReferenceArrow />
              </button>
            ))}
            {context.mentionRefs.length > 4 && <span>+{context.mentionRefs.length - 4} more</span>}
          </div>
        </>
      ) : (
        <div className="entity-opening-context-copy">
          <strong>Broader research</strong>
          <span>No TIPNR-indexed mention in {scopeLabel}.</span>
        </div>
      )}
    </section>
  );
}

const RELATIONSHIP_GROUPS = [
  { kind: "parent", label: "Parents" },
  { kind: "sibling", label: "Siblings" },
  { kind: "partner", label: "Partner" },
  { kind: "offspring", label: "Children" },
] as const;

function PersonRelationships({
  data,
  onOpenEntity,
}: {
  data: EntityResearchData;
  onOpenEntity?: (entityId: string) => void;
}): React.JSX.Element | null {
  const relationships = data.entity.person?.relationships ?? [];
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => setExpandedGroups(new Set()), [data.entity.id]);

  if (relationships.length === 0) return null;
  return (
    <section className="entity-research-section entity-person-relationships" aria-labelledby="entity-relationships-title">
      <div className="entity-research-section-head">
        <h3 id="entity-relationships-title">Family in the text</h3>
        <span>{relationships.length} named</span>
      </div>
      <div className="entity-relationship-rows">
        {RELATIONSHIP_GROUPS.map((group) => {
          const items = relationships.filter((relationship) => relationship.kind === group.kind);
          if (items.length === 0) return null;
          const expanded = expandedGroups.has(group.kind);
          const visibleItems = expanded ? items : items.slice(0, 6);
          return (
            <div key={group.kind} className="entity-relationship-row">
              <span className="entity-relationship-label">{group.label}</span>
              <div className="entity-relationship-links">
                {visibleItems.map((relationship) => (
                  <button
                    key={`${relationship.kind}-${relationship.targetId}`}
                    type="button"
                    onClick={() => onOpenEntity?.(relationship.targetId)}
                    aria-label={`Research ${relationship.displayName}${relationship.uncertain ? ", uncertain identification" : ""}`}
                    title={relationship.uncertain ? "TIPNR marks this identification as uncertain" : undefined}
                  >
                    <span>{relationship.displayName}</span>
                    {relationship.uncertain && <span className="entity-relationship-uncertain" aria-hidden="true">?</span>}
                    <CrossReferenceArrow />
                  </button>
                ))}
                {items.length > visibleItems.length && (
                  <button
                    type="button"
                    className="entity-relationship-more"
                    aria-expanded={expanded}
                    onClick={() => setExpandedGroups((current) => {
                      const next = new Set(current);
                      if (next.has(group.kind)) next.delete(group.kind);
                      else next.add(group.kind);
                      return next;
                    })}
                  >
                    +{items.length - visibleItems.length} more
                  </button>
                )}
                {expanded && items.length > 6 && (
                  <button
                    type="button"
                    className="entity-relationship-more"
                    aria-expanded="true"
                    onClick={() => setExpandedGroups((current) => {
                      const next = new Set(current);
                      next.delete(group.kind);
                      return next;
                    })}
                  >
                    Show fewer
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function EntityMiniMap({ data }: { data: EntityResearchData }): React.JSX.Element | null {
  if (!data.place || !data.minimap) return null;
  const { minimap, place } = data;
  const pleiadesPoint = data.pleiades?.place.reprPoint;
  const pleiadesMarker = pleiadesPoint
    ? {
        x: ((pleiadesPoint[0] - minimap.bounds.west) / (minimap.bounds.east - minimap.bounds.west)) * minimap.width,
        y: ((minimap.bounds.north - pleiadesPoint[1]) / (minimap.bounds.north - minimap.bounds.south)) * minimap.height,
      }
    : null;
  const showPleiadesMarker = pleiadesMarker
    && pleiadesMarker.x >= 0 && pleiadesMarker.x <= minimap.width
    && pleiadesMarker.y >= 0 && pleiadesMarker.y <= minimap.height
    && (data.pleiades?.coordinateComparison?.distanceKm ?? 0) > 2;
  return (
    <figure className="entity-minimap">
      <svg
        viewBox={`0 0 ${minimap.width} ${minimap.height}`}
        role="img"
        aria-label={`Regional map locating ${data.entity.displayName}`}
      >
        <rect className="entity-map-water" width={minimap.width} height={minimap.height} rx="10" />
        <g className="entity-map-grid" aria-hidden="true">
          <path d={`M0 ${minimap.height / 2}H${minimap.width}`} />
          <path d={`M${minimap.width / 2} 0V${minimap.height}`} />
        </g>
        <g className="entity-map-land" aria-hidden="true">
          {minimap.landPaths.map((path, index) => <path key={`${path.slice(0, 24)}-${index}`} d={path} />)}
        </g>
        <g className="entity-map-alternatives" aria-hidden="true">
          {minimap.alternatives.map((point, index) => (
            <g key={`${point.name}-${point.x}-${point.y}`} transform={`translate(${point.x} ${point.y})`}>
              <circle r="4.6" />
              <text textAnchor="middle" dominantBaseline="central">{index + 1}</text>
            </g>
          ))}
        </g>
        {showPleiadesMarker && (
          <g
            className="entity-map-pleiades"
            transform={`translate(${pleiadesMarker.x} ${pleiadesMarker.y})`}
            aria-hidden="true"
          >
            <circle r="4.2" />
            <circle r="1.2" />
          </g>
        )}
        <g className="entity-map-pin" transform={`translate(${minimap.center.x} ${minimap.center.y})`} aria-hidden="true">
          <circle className="entity-map-pulse" r="12" />
          <circle className="entity-map-halo" r="6" />
          <circle className="entity-map-dot" r="2.6" />
        </g>
      </svg>
      <figcaption>
        <span>{place.primary.name} · OpenBible location</span>
        <span>{coordinatesLabel(place.primary.latitude, place.primary.longitude)}</span>
      </figcaption>
      <div className="entity-map-legend" aria-label="Map key">
        <span><i className="is-primary" aria-hidden="true" />OpenBible</span>
        {showPleiadesMarker && <span><i className="is-pleiades" aria-hidden="true" />Pleiades</span>}
        {minimap.alternatives.length > 0 && <span><i className="is-alternative" aria-hidden="true" />Numbered proposals</span>}
      </div>
    </figure>
  );
}

function PleiadesResearchSection({
  data,
  openResearchLink,
}: {
  data: NonNullable<EntityResearchData["pleiades"]>;
  openResearchLink: (url: string) => void;
}): React.JSX.Element {
  const { place } = data;
  const period = historicPeriodLabel(place.period);
  const names = [...new Set(place.names
    .filter((name) => (name.start ?? 0) < 1500)
    .flatMap((name) => [name.attested, ...name.romanized])
    .filter((name): name is string => Boolean(name?.trim())))]
    .slice(0, 8);
  const references = place.references
    .filter((reference, index, all) => all.findIndex((candidate) => (
      candidate.shortTitle === reference.shortTitle
      && candidate.citationDetail === reference.citationDetail
      && candidate.citation === reference.citation
    )) === index);

  return (
    <section className="entity-research-section entity-pleiades" aria-labelledby="entity-ancient-record-title">
      <div className="entity-research-section-head">
        <h3 id="entity-ancient-record-title">Ancient record</h3>
        <span>Pleiades 4.1</span>
      </div>
      <div className="entity-pleiades-lead">
        <div>
          <strong>{place.title}</strong>
          {period && <span>{period}</span>}
        </div>
        <button type="button" onClick={() => openResearchLink(place.sourceUrl)}>
          Open record <CrossReferenceArrow />
        </button>
      </div>
      {place.description && <p className="entity-pleiades-description">{place.description}</p>}
      {names.length > 0 && (
        <div className="entity-pleiades-names" aria-label="Attested and historical names">
          <span>Names</span>
          <div>{names.map((name) => <span key={name}>{name}</span>)}</div>
        </div>
      )}
      {place.connections.length > 0 && (
        <div className="entity-pleiades-connections">
          <span>Ancient context</span>
          {place.connections.slice(0, 6).map((connection) => (
            <button
              key={connection.id}
              type="button"
              disabled={!connection.targetUrl}
              onClick={() => connection.targetUrl && openResearchLink(connection.targetUrl)}
            >
              <span>{pleiadesConnectionLabel(connection.type)}</span>
              <strong>{connection.title}</strong>
              {connection.targetUrl && <CrossReferenceArrow />}
            </button>
          ))}
        </div>
      )}
      {references.length > 0 && (
        <details className="entity-pleiades-bibliography">
          <summary>
            <span>Ancient sources & bibliography</span>
            <span>{references.length.toLocaleString()} records</span>
          </summary>
          <div>
            {references.slice(0, 12).map((reference, index) => (
              <p key={`${reference.shortTitle ?? reference.citation}-${reference.citationDetail ?? ""}-${index}`}>
                <strong>{reference.shortTitle ?? reference.citation}</strong>
                {reference.citationDetail && <span>{reference.citationDetail}</span>}
              </p>
            ))}
            {references.length > 12 && <p className="entity-pleiades-more">+{references.length - 12} more in Pleiades</p>}
          </div>
        </details>
      )}
    </section>
  );
}

function EntityResearchView({
  data,
  origin,
  currentBook,
  currentChapter,
  chapterVerseText,
  bookNames,
  onNavigate,
  onOpenEntity,
  onCapture,
}: {
  data: EntityResearchData;
  origin: NonNullable<Props["entityIntent"]>["origin"];
  currentBook: string;
  currentChapter: number;
  chapterVerseText: Map<number, string>;
  bookNames: BookNameData;
  onNavigate?: (ref: string) => void;
  onOpenEntity?: (entityId: string) => void;
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
}): React.JSX.Element {
  const [showAllRefs, setShowAllRefs] = useState(false);
  const [mediaLinkError, setMediaLinkError] = useState<string | null>(null);
  const orderedRefs = [...data.entity.refs].sort((left, right) => {
    const leftCurrent = left.startsWith(`${currentBook}.`) ? 0 : 1;
    const rightCurrent = right.startsWith(`${currentBook}.`) ? 0 : 1;
    return leftCurrent - rightCurrent;
  });
  const visibleRefs = showAllRefs ? orderedRefs : orderedRefs.slice(0, 12);
  const referenceTotals = new Map(entityBookFootprint(data.entity.refs, bookNames)
    .map((group) => [group.book, group.count]));
  const visibleReferenceGroups = [...visibleRefs.reduce((groups, ref) => {
    const bookCode = /^([1-3A-Z]{3})\./.exec(ref)?.[1] ?? "OTHER";
    const current = groups.get(bookCode) ?? [];
    current.push(ref);
    groups.set(bookCode, current);
    return groups;
  }, new Map<string, string[]>())].map(([bookCode, refs]) => ({
    bookCode,
    label: bookNames[bookCode]?.[0] ?? bookCode,
    refs,
    total: referenceTotals.get(bookCode) ?? refs.length,
  }));
  const place = data.place;
  const person = data.entity.person;
  const footprint = entityBookFootprint(data.entity.refs, bookNames);
  const footprintHighlights = [...footprint].sort((left, right) => {
    const leftCurrent = left.book === currentBook ? 0 : 1;
    const rightCurrent = right.book === currentBook ? 0 : 1;
    return leftCurrent - rightCurrent || right.count - left.count;
  }).slice(0, 6);

  useEffect(() => {
    setShowAllRefs(false);
    setMediaLinkError(null);
  }, [data.entity.id]);

  const openMediaLink = (url: string): void => {
    setMediaLinkError(null);
    void safeCall(() => window.api.system.openExternalResearchUrl(url)).then((result) => {
      if (!result.ok) setMediaLinkError(result.error);
    });
  };

  const photo = data.imageDataUrl && place?.image ? (
    <figure className="entity-photo">
      <img src={data.imageDataUrl} alt={place.image.alt} />
      <figcaption>
        <div className="entity-photo-caption">
          <span>{placeImageKindLabel(place.image.kind)}</span>
          <strong>{place.image.alt}</strong>
        </div>
        <div className="entity-photo-provenance">
          <div className="entity-photo-provenance-head">
            <span>Image details</span>
            <span>{place.image.credit} · {place.image.license}</span>
          </div>
          <dl>
            <dt>Depicts</dt>
            <dd>{place.image.depictedLocation}</dd>
            <dt>Credit</dt>
            <dd>{place.image.credit}</dd>
            <dt>Source</dt>
            <dd><button type="button" onClick={() => openMediaLink(place.image!.sourceUrl)}>Wikimedia Commons <span aria-hidden="true">↗</span></button></dd>
            <dt>License</dt>
            <dd><button type="button" onClick={() => openMediaLink(place.image!.licenseUrl)}>{place.image.license} <span aria-hidden="true">↗</span></button></dd>
          </dl>
          {mediaLinkError && <p className="entity-photo-link-error" role="alert">{mediaLinkError}</p>}
        </div>
      </figcaption>
    </figure>
  ) : null;

  return (
    <article className={`entity-research-view is-${data.entity.kind}`}>
      <header className="entity-research-identity">
        <div className="entity-research-kicker">
          <span>{data.entity.kind}</span>
          {place && <><span aria-hidden="true">·</span><span>{place.type}</span></>}
        </div>
        <div className="entity-research-title-row">
          <h2>{data.entity.displayName}</h2>
          {onCapture && (
            <button
              type="button"
              className="margin-capture-action entity-research-capture"
              aria-label={`Add ${data.entity.displayName} research to a note`}
              onClick={() => onCapture(buildEntityResearchCapture(data, origin, bookNames))}
            >
              Add to note…
            </button>
          )}
        </div>
        {person && (
          <div className="entity-person-facts" aria-label="Person identity">
            <strong>{person.role}</strong>
            {person.era && <span>{person.era}</span>}
            {person.affiliation && <span>{person.affiliation}</span>}
          </div>
        )}
        <p>{data.entity.brief}</p>
      </header>

      <EntityOpeningContextSection
        data={data}
        origin={origin}
        currentBook={currentBook}
        currentChapter={currentChapter}
        chapterVerseText={chapterVerseText}
        bookNames={bookNames}
        onNavigate={onNavigate}
      />

      {place && (
        <section className="entity-research-section" aria-labelledby="entity-location-title">
          <div className="entity-research-section-head">
            <h3 id="entity-location-title">Location</h3>
            <span>{confidenceLabel(place.primary.confidence)}</span>
          </div>
          <EntityMiniMap data={data} />
          <div className="entity-location-note">
            <span>{place.primary.precision ?? place.primary.type}</span>
            {place.alternatives.length > 0 && (
              <span>{place.alternatives.length + 1} proposed locations</span>
            )}
          </div>
        </section>
      )}

      {data.entity.kind === "place" && !place && (
        <section className="entity-research-section entity-location-unmapped" aria-labelledby="entity-location-unmapped-title">
          <div className="entity-research-section-head">
            <h3 id="entity-location-unmapped-title">Location</h3>
            <span>Not mapped</span>
          </div>
          <p>
            No geographic record is joined to this identity. The app keeps it unmapped rather than inventing a location;
            its Scripture references remain available below.
          </p>
        </section>
      )}

      <details className="entity-research-more" key={data.entity.id}>
        <summary>More</summary>
        <div className="entity-research-more-content">
          {photo}
          {data.entity.short && data.entity.short !== data.entity.brief && (
            <p className="entity-research-expanded">{data.entity.short}</p>
          )}
          <PersonRelationships data={data} onOpenEntity={onOpenEntity} />
          {place && (data.pleiades?.coordinateComparison || place.alternatives.length > 0) && (
            <section className="entity-research-section entity-location-details" aria-labelledby="entity-location-details-title">
              <div className="entity-research-section-head">
                <h3 id="entity-location-details-title">Location detail</h3>
                <span>{place.alternatives.length > 0 ? `${place.alternatives.length + 1} proposals` : "Source comparison"}</span>
              </div>
              {data.pleiades?.coordinateComparison && (
                <p className={`entity-coordinate-comparison ${isBroadPlaceType(place.type) ? "is-broad" : `is-${data.pleiades.coordinateComparison.relation}`}`}>
                  {coordinateComparisonCopy(data.pleiades, place.type)}
                </p>
              )}
              {place.alternatives.length > 0 && (
                <div className="entity-location-alternatives" aria-label="Alternative proposed locations">
                  {place.alternatives.map((location, index) => (
                    <div key={location.modernId}>
                      <span><i aria-hidden="true">{index + 1}</i>{location.name}</span>
                      <span>{confidenceLabel(location.confidence)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

      {data.pleiades && <PleiadesResearchSection data={data.pleiades} openResearchLink={openMediaLink} />}

      <section className="entity-research-section" aria-labelledby="entity-scripture-title">
        <div className="entity-research-section-head">
          <h3 id="entity-scripture-title">In Scripture</h3>
          <span>{data.entity.refCount.toLocaleString()} {data.entity.refCount === 1 ? "passage" : "passages"}</span>
        </div>
        {footprint.length > 0 && (
          <div className="entity-scripture-footprint" aria-label={`Scripture footprint across ${footprint.length} books`}>
            <div className="entity-footprint-track" aria-hidden="true">
              {footprint.map((group) => (
                <span
                  key={group.book}
                  className={group.book === currentBook ? "is-current" : undefined}
                  style={{ flexGrow: group.count }}
                  title={`${group.label}: ${group.count}`}
                />
              ))}
            </div>
            <div className="entity-footprint-books">
              {footprintHighlights.map((group) => (
                <button
                  key={group.book}
                  type="button"
                  className={group.book === currentBook ? "is-current" : undefined}
                  onClick={() => onNavigate?.(`bref:v1/${group.firstRef}`)}
                  aria-label={`Open first ${group.label} reference, ${group.count} ${group.count === 1 ? "passage" : "passages"}`}
                >
                  <span>{group.label}</span>
                  <strong>{group.count}</strong>
                </button>
              ))}
              {footprint.length > footprintHighlights.length && (
                <span className="entity-footprint-more">+{footprint.length - footprintHighlights.length} books</span>
              )}
            </div>
          </div>
        )}
        <div className="entity-reference-list">
          {visibleReferenceGroups.map((group) => (
            <section key={group.bookCode} className="entity-reference-group" aria-label={`${group.label} references`}>
              <div className="entity-reference-group-head">
                <span>{group.label}</span>
                <span>{group.refs.length < group.total ? `${group.refs.length} of ${group.total}` : group.total}</span>
              </div>
              <div className="entity-reference-grid">
                {group.refs.map((ref) => (
                  <button
                    key={ref}
                    type="button"
                    onClick={() => onNavigate?.(`bref:v1/${ref}`)}
                    aria-label={`Open ${formatResearchRef(ref, bookNames)}`}
                  >
                    <span>{formatResearchRef(ref, bookNames)}</span>
                    <CrossReferenceArrow />
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
        {orderedRefs.length > 12 && (
          <button
            type="button"
            className="entity-reference-more"
            onClick={() => setShowAllRefs((current) => !current)}
            aria-expanded={showAllRefs}
          >
            {showAllRefs ? "Show fewer passages" : `Show all ${orderedRefs.length.toLocaleString()} passages`}
          </button>
        )}
      </section>

      {(data.entity.paratextRefs?.length ?? 0) > 0 && (
        <details className="entity-edition-notes">
          <summary>
            <span>KJV edition notes</span>
            <span>
              {data.entity.paratextRefs!.length.toLocaleString()} {data.entity.paratextRefs!.length === 1 ? "subscription" : "subscriptions"}
            </span>
          </summary>
          <p>
            Historical epistle subscriptions retained as edition metadata. They are not canonical verse text.
          </p>
          <div className="entity-edition-note-list">
            {data.entity.paratextRefs!.map((entry) => (
              <div key={entry.ref}>
                <span>{formatResearchRef(entry.ref, bookNames)}</span>
                <span>{entry.forms[0] || "KJV subscription"}</span>
              </div>
            ))}
          </div>
        </details>
      )}
        </div>
      </details>

      <MarginSourcesDisclosure sources={entityResearchSources(data)} />
    </article>
  );
}

function CrossReferenceRow({
  item,
  onNavigate,
  onCapture,
  sourceAttribution,
  frozenOrigin,
}: {
  item: CrossReferenceMatchData;
  onNavigate?: (ref: string) => void;
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
  sourceAttribution: string;
  frozenOrigin: string;
}): React.JSX.Element {
  const openReference = (): void => onNavigate?.(item.targetBref);
  return (
    <div
      className="crossref-row"
      onClick={(event) => {
        if (event.target === event.currentTarget) openReference();
      }}
    >
      <button
        type="button"
        className="crossref-row-open"
        onClick={openReference}
        aria-label={item.preview ? `Open ${item.targetDisplay}. ${item.preview}` : `Open ${item.targetDisplay}`}
        title={item.preview ? `${item.targetDisplay} — ${item.preview}` : `Open ${item.targetDisplay}`}
      >
        <span className="crossref-row-copy">
          <span className="crossref-reference">{item.targetDisplay}</span>
          {item.preview && <span className="crossref-preview">{item.preview}</span>}
          {item.supportingSourceCount > 1 && (
            <span className="crossref-support">
              Linked from {item.supportingSourceCount} verses in this passage
            </span>
          )}
          {item.relationshipKinds.length > 0 && (
            <span className="crossref-kinds">
              {item.relationshipKinds.map((kind) => <span key={kind}>{kind}</span>)}
            </span>
          )}
        </span>
        <span className="crossref-open-affordance">
          <span>Open</span>
          <CrossReferenceArrow />
        </span>
      </button>
      {onCapture && (
        <button
          type="button"
          className="margin-capture-action"
          aria-label={`Add ${item.targetDisplay} to a note`}
          onClick={() => onCapture({
            excerpt: item.preview?.trim() || item.targetDisplay,
            sourceAttribution,
            reference: item.targetDisplay,
            frozenOrigin,
            originLabel: "Related verse",
          })}
        >
          Add to note…
        </button>
      )}
    </div>
  );
}

function CrossRefsBlock({
  result,
  onNavigate,
  onCapture,
  frozenOrigin,
}: {
  result: CrossReferenceResultData;
  onNavigate?: (ref: string) => void;
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
  frozenOrigin: string;
}): React.JSX.Element {
  const sourceAttribution = `${result.attribution.name} (${result.attribution.license})`;
  return (
    <section className="margin-section crossref-section" aria-label="Related verses">
      <div className="crossref-heading">
        <div>
          <h3 className="margin-section-header crossref-title">Related verses</h3>
          <div className="crossref-context">
            <span>{result.scope === "verse" ? "For this verse" : "Across this passage"}</span>
          </div>
        </div>
        <span
          className="crossref-total"
          title={`${result.items.length} highest-ranked of ${result.totalCount} positive-score connections`}
        >
          <strong>{result.items.length}</strong>
        </span>
      </div>

      <div className="crossref-list">
        {result.items.map((item) => (
          <CrossReferenceRow
            key={item.targetBref}
            item={item}
            onNavigate={onNavigate}
            onCapture={onCapture}
            sourceAttribution={sourceAttribution}
            frozenOrigin={frozenOrigin}
          />
        ))}
      </div>
      <MarginSourcesDisclosure sources={[{
        name: result.attribution.name,
        license: result.attribution.license,
        citation: `${result.attribution.attribution} · ${result.attribution.license} · ${result.attribution.sourceUrl}`,
      }]} />
    </section>
  );
}

function NoteCrossRefsBlock({
  items,
  onNavigate,
  onCapture,
  frozenOrigin,
}: {
  items: SuggestedCrossRefData[];
  onNavigate?: (ref: string) => void;
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
  frozenOrigin: string;
}): React.JSX.Element {
  return (
    <section className="margin-section note-crossref-section" aria-label="Cross references from notes">
      <div className="crossref-heading">
        <div>
          <h3 className="margin-section-header crossref-title">From notes</h3>
          <div className="crossref-context">Connections in your library</div>
        </div>
        <span className="crossref-total"><strong>{items.length}</strong></span>
      </div>
      <div className="crossref-list">
        {items.map((item) => (
          <div className="note-crossref-row" key={item.targetBref}>
            <button
              type="button"
              className="crossref-row-open"
              onClick={() => onNavigate?.(item.targetBref)}
              aria-label={`Open ${item.targetDisplay} from notes`}
            >
              <span className="crossref-row-copy">
                <span className="crossref-reference">{item.targetDisplay}</span>
                <span className="note-crossref-reason">{item.reason}</span>
              </span>
              <span className="crossref-open-affordance">
                <span>Open</span>
                <CrossReferenceArrow />
              </span>
            </button>
            {onCapture && (
              <button
                type="button"
                className="margin-capture-action"
                aria-label={`Add ${item.targetDisplay} to a note`}
                onClick={() => onCapture({
                  excerpt: item.reason,
                  sourceAttribution: "From your notes",
                  reference: item.targetDisplay,
                  frozenOrigin,
                  originLabel: "Related verse",
                })}
              >
                Add to note…
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function IntentOverview({
  crossRefs,
  directNote,
  semantic,
  entityResult,
  loading,
  onNavigate,
  onOpenTab,
  onOpenEntity,
}: {
  crossRefs: CrossReferenceResultData | null;
  directNote: NoteRecord | null;
  semantic: SemanticMarginResult | null | undefined;
  entityResult: LanguageEntityRangeResult;
  loading: boolean;
  onNavigate?: (ref: string) => void;
  onOpenTab: (tab: MarginTab) => void;
  onOpenEntity?: (entityId: string) => void;
}): React.JSX.Element {
  const scripture = crossRefs?.items.slice(0, 2) ?? [];
  const relatedNote = semantic?.semanticNotes[0] ?? null;
  const thread = semantic?.threads[0] ?? null;
  const claim = semantic?.claims.find((item) => item.status === "active") ?? null;
  const entities = entityResult.entities.slice(0, 4);
  const hasLibraryLead = directNote != null || relatedNote != null || thread != null || claim != null;
  const hasContent = scripture.length > 0 || hasLibraryLead || entities.length > 0;
  const sources: MarginCitationSource[] = [
    ...(scripture.length > 0 && crossRefs ? [{
      name: crossRefs.attribution.name,
      license: crossRefs.attribution.license,
      citation: `${crossRefs.attribution.attribution} · ${crossRefs.attribution.license} · ${crossRefs.attribution.sourceUrl}`,
    }] : []),
    ...(entities.length > 0 ? [{
      name: entityResult.attribution.name,
      license: entityResult.attribution.license,
    }] : []),
  ];

  return (
    <div className="intent-overview" aria-label="Most relevant study leads">
      {scripture.length > 0 && (
        <section className="intent-section" aria-labelledby="intent-scripture-title">
          <div className="intent-section-head">
            <h3 id="intent-scripture-title">Scripture</h3>
            <button type="button" onClick={() => onOpenTab("connections")}>All refs</button>
          </div>
          <div className="intent-ref-list">
            {scripture.map((item) => (
              <button
                key={item.targetBref}
                type="button"
                className="intent-ref-row"
                onClick={() => onNavigate?.(item.targetBref)}
                aria-label={`Open ${item.targetDisplay}`}
              >
                <span className="intent-ref-copy">
                  <span className="intent-ref-title">{item.targetDisplay}</span>
                  {item.preview && <span className="intent-ref-preview">{item.preview}</span>}
                </span>
                <CrossReferenceArrow />
              </button>
            ))}
          </div>
        </section>
      )}

      {hasLibraryLead && (
        <section className="intent-section" aria-labelledby="intent-library-title">
          <div className="intent-section-head">
            <h3 id="intent-library-title">Your library</h3>
            <button type="button" onClick={() => onOpenTab("notes")}>All notes</button>
          </div>
          <div className="intent-library-leads">
            {directNote && (
              <button type="button" className="intent-note-lead" onClick={() => onOpenTab("notes")}>
                <span className="intent-lead-kind">Anchored note</span>
                <strong>{directNote.title || "Untitled"}</strong>
                <span>{directNote.body_text}</span>
              </button>
            )}
            {!directNote && relatedNote && (
              <button type="button" className="intent-note-lead" onClick={() => onOpenTab("notes")}>
                <span className="intent-lead-kind">Related note</span>
                <strong>{relatedNote.title || "Untitled"}</strong>
                <span>{relatedNote.snippet}</span>
              </button>
            )}
            {thread && (
              <button type="button" className="intent-note-lead is-secondary" onClick={() => onOpenTab("notes")}>
                <span className="intent-lead-kind">Theme in your notes</span>
                <strong>{thread.label}</strong>
                <span>{thread.summary}</span>
              </button>
            )}
            {!thread && claim && (
              <button type="button" className="intent-note-lead is-secondary" onClick={() => onOpenTab("notes")}>
                <span className="intent-lead-kind">Grounded in your notes</span>
                <strong>{claim.assertion}</strong>
              </button>
            )}
          </div>
        </section>
      )}

      {entities.length > 0 && (
        <section className="intent-section" aria-labelledby="intent-entities-title">
          <div className="intent-section-head">
            <h3 id="intent-entities-title">People &amp; places</h3>
          </div>
          <div className="intent-entity-list">
            {entities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                className="intent-entity-card"
                onClick={() => onOpenEntity?.(entity.id)}
                aria-label={`Research ${entity.displayName}`}
              >
                <span className={`intent-entity-glyph is-${entity.kind}`}><EntityGlyph kind={entity.kind} /></span>
                  <span className="intent-entity-copy">
                    <span className="intent-entity-line">
                      <strong>{entity.displayName}</strong>
                      <span>{entity.kind}</span>
                    </span>
                    <span className="intent-entity-brief">{entity.brief}</span>
                  </span>
                <span className="intent-entity-open" aria-hidden="true">open&nbsp;→</span>
              </button>
            ))}
          </div>
          {entityResult.entities.length > entities.length && (
            <p className="intent-more-count">
              {entityResult.entities.length - entities.length} more appear in this scope as you continue reading.
            </p>
          )}
        </section>
      )}

      {loading && (
        <div className="intent-loading" role="status">
          <span className="ai-insight-spinner" aria-hidden="true" />
          <span>Checking this passage against your library…</span>
        </div>
      )}

      {!hasContent && !loading && (
        <MarginEmptyView
          title="Nothing strong enough to surface"
          detail="The deeper passage, reference, and note views remain available without filling this overview with weak guesses."
        />
      )}
      <MarginSourcesDisclosure sources={sources} />
    </div>
  );
}

export function LivingMargin({
  book,
  chapter,
  packageId,
  marginData,
  crossRefs,
  bookNames,
  semanticData,
  semanticLoading,
  chapterVerseText,
  displayChapterVerseText,
  chapterTextLoading,
  pinnedRange,
  nearVerse,
  onPinClaim,
  onRemoveHighlights,
  onCreateNote,
  onCapture,
  onNavigateToRef,
  onStudyVerse,
  onMarginActiveChange,
  onClearSelection,
  activeTab: controlledActiveTab,
  onActiveTabChange,
  entityIntent,
  onOpenEntity,
  onCloseEntity,
  entityTrail = [],
  onEntityTrailChange,
  connectionInspector,
  authoredConnections = [],
  selectedAuthoredConnectionId = null,
  onSelectAuthoredConnection,
  connectionInspectorFocusRequest = 0,
}: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [claimPinError, setClaimPinError] = useState<{ id: string; message: string } | null>(null);
  const [internalActiveTab, setInternalActiveTab] = useState<MarginTab>(controlledActiveTab ?? "overview");
  const activeTab = controlledActiveTab ?? internalActiveTab;
  const setActiveTab = (tab: MarginTab): void => {
    setInternalActiveTab(tab);
    onActiveTabChange?.(tab);
  };
  const [wordsVerse, setWordsVerse] = useState(pinnedRange?.start ?? 1);
  const [entityResult, setEntityResult] = useState<LanguageEntityRangeResult>({
    entities: [],
    attribution: { name: "STEPBible TIPNR", license: "CC BY 4.0" },
  });
  const [entityLoading, setEntityLoading] = useState(false);
  const [entityResearch, setEntityResearch] = useState<EntityResearchData | null>(null);
  const [entityResearchLoading, setEntityResearchLoading] = useState(false);
  const [entityResearchError, setEntityResearchError] = useState<string | null>(null);
  const [deepNotesById, setDeepNotesById] = useState<Record<string, ParsedNoteData> | null>(null);
  const [deepNotesLoading, setDeepNotesLoading] = useState(false);
  const frameTitleRef = useRef<HTMLHeadingElement>(null);
  const researchTitleRef = useRef<HTMLHeadingElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabScrollPositionsRef = useRef<Record<MarginTab, number>>({
    overview: 0,
    passage: 0,
    connections: 0,
    notes: 0,
  });

  // Session-only cache of AI insight results for the pinned range, keyed by
  // translation + canonical range. Avoids re-triggering the call when
  // re-pinning the same range without reusing WEB prose analysis for KJV.
  const aiCacheRef = useRef<Map<string, SemanticMarginResult | null>>(new Map());
  const [aiCacheVersion, setAiCacheVersion] = useState(0);

  const handlePinClaim = async (claimId: string, assertion: string): Promise<void> => {
    if (!onPinClaim) return;
    setPendingClaimId(claimId);
    setClaimPinError(null);
    const saved = await onPinClaim(claimId, assertion);
    setPendingClaimId(null);
    if (!saved) {
      setClaimPinError({
        id: claimId,
        message: "Could not keep this claim. Your library was not changed.",
      });
      return;
    }
    setPinnedClaims((prev) => new Set(prev).add(claimId));
  };

  const activeHighlights = marginData.highlights.filter((h) => h.deleted === 0);
  const hasDeterministicData = marginData.notes.length > 0 || activeHighlights.length > 0 || (crossRefs?.totalCount ?? 0) > 0;
  const hasSemanticData = semanticData && (
    semanticData.semanticNotes.length > 0 ||
    semanticData.threads.length > 0 ||
    semanticData.claims.length > 0 ||
    semanticData.suggestedCrossRefs.length > 0
  );

  const isPinned = !!pinnedRange;
  const isNear = !isPinned && nearVerse != null;
  const connectionInspectorOpen = connectionInspector != null;

  useEffect(() => {
    if (!pinnedRange) return;
    setWordsVerse((current) => (
      current >= pinnedRange.start && current <= pinnedRange.end ? current : pinnedRange.start
    ));
  }, [pinnedRange?.start, pinnedRange?.end]);

  // The same canonical passage can contain materially different wording in
  // WEB and KJV. Cache passage-text analysis independently so switching
  // versions never reuses an insight generated from the other translation.
  const pinKey = pinnedRange ? `${packageId}:${book}:${chapter}:${pinnedRange.start}-${pinnedRange.end}` : null;

  // Fire the pinned-range-scoped AI insight call whenever the pinned range
  // changes and there is no cached result for it yet.
  useEffect(() => {
    if (!pinnedRange || !pinKey) return;
    if (aiCacheRef.current.has(pinKey)) return;

    let cancelled = false;
    const text = chapterVerseText
      ? [...chapterVerseText.entries()]
          .filter(([v]) => v >= pinnedRange.start && v <= pinnedRange.end)
          .sort((a, b) => a[0] - b[0])
          .map(([, t]) => t)
          .join(" ")
      : "";

    if (!text) {
      // A package switch deliberately clears the reading DOM before the next
      // translation arrives. Do not turn that transient empty frame into a
      // permanent cached "no insight" result for the new package.
      if (chapterTextLoading) return;
      // No real text available to analyze — record a null result rather than
      // spinning forever or fabricating a response.
      aiCacheRef.current.set(pinKey, null);
      setAiCacheVersion((v) => v + 1);
      return;
    }

    safeCall(() => window.api.ai.semanticMargin({
      book,
      startChapter: chapter,
      startVerse: pinnedRange.start,
      endChapter: chapter,
      endVerse: pinnedRange.end,
      passageText: text,
    })).then((res) => {
      if (cancelled) return;
      aiCacheRef.current.set(pinKey, res.ok ? res.value : null);
      setAiCacheVersion((v) => v + 1);
    });

    return () => {
      cancelled = true;
    };
  }, [pinKey, pinnedRange, chapterVerseText, chapterTextLoading, book, chapter]);

  const pinnedAiResult = pinKey ? aiCacheRef.current.get(pinKey) : undefined;
  // Loading whenever this pinned range has no cached result yet — covers both
  // the brief window before the fetch-triggering effect runs and the time
  // the actual IPC call is in flight.
  const pinnedAiLoading = pinKey != null && !aiCacheRef.current.has(pinKey);
  void aiCacheVersion; // referenced only to force re-render on cache updates

  const pinnedNote = pinnedRange ? findNoteForRange(marginData, chapter, pinnedRange.start, pinnedRange.end) : null;
  const pinnedHighlights = pinnedRange
    ? activeHighlights.filter((h) => h.chapter === chapter && h.verse_start <= pinnedRange.end && h.verse_end >= pinnedRange.start)
    : [];
  const pinnedColors = [...new Set(pinnedHighlights.map((highlight) => highlight.color))];
  const pinnedHighlightColor = pinnedColors.length === 1 ? pinnedColors[0]! : null;
  const quoteVerseText = displayChapterVerseText ?? chapterVerseText;
  const pinnedQuote = pinnedRange && quoteVerseText
    ? [...quoteVerseText.entries()]
        .filter(([v]) => v >= pinnedRange.start && v <= pinnedRange.end)
        .sort((a, b) => a[0] - b[0])
        .map(([, t]) => t)
        .join(" ")
    : "";
  const pinnedRef = pinnedRange
    ? `${displayBook} ${chapter}:${pinnedRange.start}${pinnedRange.end !== pinnedRange.start ? `–${pinnedRange.end}` : ""}`
    : "";

  // A selected-passage card must have been retrieved for that exact range.
  // Chapter-wide results remain useful in the chapter overview, but never
  // masquerade as selected-passage evidence while the scoped call is loading.
  const pinnedSemantic = pinnedAiResult ?? null;
  const pinnedInsight = pinnedAiResult
    ? pinnedAiResult.threads[0]?.summary
      ?? pinnedAiResult.semanticNotes[0]?.snippet
      ?? pinnedAiResult.claims[0]?.assertion
      ?? null
    : null;
  const pinnedLibraryItemCount = pinnedSemantic
    ? pinnedSemantic.semanticNotes.length + pinnedSemantic.threads.length + pinnedSemantic.claims.length
    : 0;

  const nearNote = nearVerse != null ? findNoteForRange(marginData, chapter, nearVerse, nearVerse) : null;
  const nearQuote = nearVerse != null ? quoteVerseText?.get(nearVerse) ?? "" : "";
  const nearRef = nearVerse != null ? `${displayBook} ${chapter}:${nearVerse}` : "";
  const contextReference = isPinned ? pinnedRef : isNear ? nearRef : `${displayBook} ${chapter}`;
  const marginMode = connectionInspectorOpen ? "Connection" : isPinned ? "selection" : "following";
  const scopeCopy = connectionInspectorOpen
    ? `Connection · ${contextReference}`
    : isPinned
      ? `Selection · ${contextReference}`
      : `Following your reading · ${contextReference}`;
  const contextQuote = isPinned ? pinnedQuote : isNear ? nearQuote : "";
  const contextKey = isPinned
    ? `selected:${book}:${chapter}:${pinnedRange.start}-${pinnedRange.end}`
    : isNear
      ? `reading:${book}:${chapter}:${nearVerse}`
      : `chapter:${book}:${chapter}`;
  const contextStartVerse = pinnedRange?.start ?? nearVerse ?? 1;
  const finalChapterVerse = chapterVerseText && chapterVerseText.size > 0
    ? Math.max(...chapterVerseText.keys())
    : 1;
  const contextEndVerse = pinnedRange?.end ?? nearVerse ?? finalChapterVerse;
  const noteConnectionCount = isPinned ? pinnedSemantic?.suggestedCrossRefs.length ?? 0 : 0;
  const connectionCount = (crossRefs?.items.length ?? 0) + noteConnectionCount;
  const notesCount = isPinned
    ? (pinnedNote ? 1 : 0) + pinnedLibraryItemCount
    : isNear
      ? (nearNote ? 1 : 0)
      : marginData.notes.length;

  useEffect(() => {
    let cancelled = false;
    setEntityLoading(true);
    void safeCall(() => window.api.language.getEntitiesForRange(
      book,
      chapter,
      contextStartVerse,
      contextEndVerse,
    )).then((result) => {
      if (cancelled) return;
      if (result.ok) setEntityResult(result.value);
      else setEntityResult({
        entities: [],
        attribution: { name: "STEPBible TIPNR", license: "CC BY 4.0" },
      });
      setEntityLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [book, chapter, contextStartVerse, contextEndVerse]);

  useEffect(() => {
    if (!entityIntent) {
      setEntityResearch(null);
      setEntityResearchError(null);
      return;
    }
    let cancelled = false;
    setEntityResearchLoading(true);
    setEntityResearchError(null);
    void safeCall(() => window.api.language.getEntityResearch(entityIntent.id)).then((result) => {
      if (cancelled) return;
      if (result.ok && result.value) {
        setEntityResearch(result.value);
        onEntityTrailChange?.((current) => appendEntityResearchTrail(current, {
          id: result.value!.entity.id,
          displayName: result.value!.entity.displayName,
        }));
      } else {
        setEntityResearch(null);
        setEntityResearchError(result.ok ? "This entity is no longer in the installed index." : result.error);
      }
      setEntityResearchLoading(false);
    });
    return () => { cancelled = true; };
  }, [entityIntent, onEntityTrailChange]);

  const openRelatedEntity = (entityId: string): void => {
    if (!onOpenEntity || !entityResearch || entityResearch.entity.id === entityId) return;
    onOpenEntity(entityId);
  };

  const openTrailEntity = (index: number): void => {
    const target = entityTrail[index];
    if (!target || !onOpenEntity || index === entityTrail.length - 1) return;
    onEntityTrailChange?.((current) => truncateEntityResearchTrail(current, index));
    onOpenEntity(target.id);
  };

  const openPreviousEntity = (): void => {
    const currentIsRecorded = entityTrail.at(-1)?.id === entityIntent?.id;
    const previousIndex = entityTrail.length - (currentIsRecorded ? 2 : 1);
    const previous = entityTrail[previousIndex];
    if (!previous || !onOpenEntity) {
      onCloseEntity?.();
      return;
    }
    onEntityTrailChange?.((current) => truncateEntityResearchTrail(current, previousIndex));
    onOpenEntity(previous.id);
  };

  const currentResearchIsRecorded = entityTrail.at(-1)?.id === entityIntent?.id;
  const researchBackDestination = entityTrail.at(currentResearchIsRecorded ? -2 : -1)?.displayName
    ?? (entityIntent ? formatEntityResearchOrigin(entityIntent.origin, bookNames) : "Study");

  useEffect(() => {
    if (!entityIntent || entityResearch?.entity.id !== entityIntent.id) return;
    const frame = window.requestAnimationFrame(() => researchTitleRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [entityIntent, entityResearch]);

  useEffect(() => {
    if (!entityIntent || !onCloseEntity) return;
    const closeResearch = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"], .command-palette-panel')) return;
      event.preventDefault();
      openPreviousEntity();
    };
    window.addEventListener("keydown", closeResearch, true);
    return () => window.removeEventListener("keydown", closeResearch, true);
  }, [entityIntent, entityTrail, entityResearch, onCloseEntity, onOpenEntity]);

  useEffect(() => {
    if (activeTab !== "notes") return;
    let cancelled = false;
    setDeepNotesLoading(true);
    void safeCall(() => window.api.library.readAllNotes()).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDeepNotesById(Object.fromEntries(
          result.value.map((note) => [note.frontmatter.id, note]),
        ));
      }
      setDeepNotesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, marginData.notes.length]);

  useEffect(() => {
    tabScrollPositionsRef.current = { overview: 0, passage: 0, connections: 0, notes: 0 };
    marginRef.current?.scrollTo({ top: 0 });
  }, [contextKey]);

  const connectionInspectorWasOpenRef = useRef(false);
  const connectionInspectorReturnScrollRef = useRef(0);
  useEffect(() => {
    const margin = marginRef.current;
    if (!margin || connectionInspectorWasOpenRef.current === connectionInspectorOpen) return;
    if (connectionInspectorOpen) {
      connectionInspectorReturnScrollRef.current = margin.scrollTop;
      margin.scrollTo({ top: 0 });
    } else {
      margin.scrollTo({ top: connectionInspectorReturnScrollRef.current });
    }
    connectionInspectorWasOpenRef.current = connectionInspectorOpen;
  }, [connectionInspectorOpen]);

  const lastConnectionInspectorFocusRequestRef = useRef(connectionInspectorFocusRequest);
  useEffect(() => {
    if (lastConnectionInspectorFocusRequestRef.current === connectionInspectorFocusRequest) return;
    lastConnectionInspectorFocusRequestRef.current = connectionInspectorFocusRequest;
    if (!connectionInspectorOpen) return;
    // An authored row is replaced by the inspector as soon as it is activated,
    // so both pointer and keyboard activation from that list need this stable
    // entry point. Reading-canvas pointer activation does not issue a request
    // and therefore keeps focus on Scripture.
    frameTitleRef.current?.focus({ preventScroll: true });
  }, [connectionInspectorFocusRequest, connectionInspectorOpen]);

  const activateTab = (tab: MarginTab, focus = false): void => {
    if (tab === activeTab) return;
    if (marginRef.current) tabScrollPositionsRef.current[activeTab] = marginRef.current.scrollTop;
    setActiveTab(tab);
    window.requestAnimationFrame(() => {
      marginRef.current?.scrollTo({ top: tabScrollPositionsRef.current[tab] });
    });
    if (focus) {
      const index = MARGIN_TABS.findIndex((item) => item.id === tab);
      window.setTimeout(() => tabRefs.current[index]?.focus(), 0);
    }
  };

  // While the reading canvas owns focus, Tab and Shift-Tab cycle study lenses
  // without moving focus. The tab row remains its own keyboard domain.
  // Arrow keys remain available to reading-canvas chapter navigation; the
  // local tablist handler below keeps its conventional arrow-key contract.
  // Floating dialogs and controls keep their normal keyboard contract.
  useEffect(() => {
    if (entityIntent) return;
    const cycleStudyLens = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key !== "Tab") return;
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"]')) return;

      const target = event.target instanceof Element ? event.target : null;
      const readingTarget = target === document.body
        || target === document.documentElement
        || Boolean(target?.closest(".verse-line"));
      if (!readingTarget) return;

      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, MARGIN_TABS.findIndex((tab) => tab.id === activeTab));
      const reverse = event.shiftKey;
      const nextIndex = (currentIndex + (reverse ? -1 : 1) + MARGIN_TABS.length) % MARGIN_TABS.length;
      activateTab(MARGIN_TABS[nextIndex]?.id ?? "overview");
    };

    window.addEventListener("keydown", cycleStudyLens, true);
    return () => window.removeEventListener("keydown", cycleStudyLens, true);
  }, [activeTab, entityIntent]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if ((event.key === "Enter" || event.key === "ArrowDown") && activeTab === MARGIN_TABS[index]?.id) {
      event.preventDefault();
      const panelId = event.currentTarget.getAttribute("aria-controls");
      const panel = panelId ? document.getElementById(panelId) : null;
      const target = panel?.querySelector<HTMLElement>(PANEL_FOCUSABLE_SELECTOR) ?? panel;
      if (target instanceof HTMLElement) {
        if (target === panel) target.tabIndex = -1;
        target.focus({ preventScroll: true });
      }
      return;
    }
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % MARGIN_TABS.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + MARGIN_TABS.length) % MARGIN_TABS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = MARGIN_TABS.length - 1;
    }
    if (nextIndex == null) return;
    event.preventDefault();
    activateTab(MARGIN_TABS[nextIndex]!.id, true);
  };

  useEffect(() => {
    const returnToActiveTab = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (!target?.closest(".margin-tab-panel")) return;
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"]')) return;
      event.preventDefault();
      event.stopPropagation();
      const index = MARGIN_TABS.findIndex((tab) => tab.id === activeTab);
      tabRefs.current[index]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", returnToActiveTab, true);
    return () => window.removeEventListener("keydown", returnToActiveTab, true);
  }, [activeTab]);

  const tabCount = (tab: MarginTab): number | null => {
    if (tab === "connections") return connectionCount;
    if (tab === "notes") return notesCount;
    return null;
  };

  const clearSelection = () => {
    onClearSelection?.();
    // The Done control intentionally disappears when selection ends. Move
    // focus to the persistent frame title so keyboard users are never left
    // focused on a detached node and can orient to the restored mode.
    window.setTimeout(() => frameTitleRef.current?.focus(), 0);
  };

  if (entityIntent) {
    const originLabel = formatEntityResearchOrigin(entityIntent.origin, bookNames);
    return (
      <aside
        ref={marginRef}
        className="living-margin entity-research-margin"
        aria-label="Entity research"
        data-margin-mode="research"
        onPointerEnter={() => onMarginActiveChange?.(true)}
        onPointerLeave={() => onMarginActiveChange?.(false)}
      >
        <header className="entity-research-frame">
          <div className="entity-research-nav">
            <button
              type="button"
              className="entity-research-back"
              onClick={openPreviousEntity}
              aria-label={`Back to ${researchBackDestination}`}
            >
              <span aria-hidden="true">←</span>
              <span>{`Back to ${researchBackDestination}`}</span>
            </button>
            <button
              type="button"
              className="entity-research-close"
              onClick={onCloseEntity}
              aria-label="Close research and return to Study"
            >
              Close
            </button>
          </div>
          <span className="entity-research-mode">Research</span>
        </header>
        <nav className="entity-research-breadcrumbs" aria-label="Research trail">
          <button
            type="button"
            className="entity-research-breadcrumb is-origin"
            onClick={onCloseEntity}
            aria-label={`Return to Study at ${originLabel}`}
          >
            {originLabel}
          </button>
          {entityTrail.length > 0 && (
            <div className="entity-research-breadcrumb-tail">
              {entityTrail.map((entry, index) => {
                const isCurrent = index === entityTrail.length - 1 && entry.id === entityIntent.id;
                return (
                  <span className="entity-research-breadcrumb-step" key={`${entry.id}-${index}`}>
                    <span className="entity-research-breadcrumb-separator" aria-hidden="true">›</span>
                    {isCurrent ? (
                      <span className="entity-research-breadcrumb is-current" aria-current="page">
                        {entry.displayName}
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="entity-research-breadcrumb"
                        onClick={() => openTrailEntity(index)}
                        aria-label={`Return to ${entry.displayName} research`}
                      >
                        {entry.displayName}
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}
        </nav>
        {entityResearchLoading && (
          <div className="entity-research-loading" role="status">
            <span className="ai-insight-spinner" aria-hidden="true" />
            <span>Opening entity…</span>
          </div>
        )}
        {entityResearchError && !entityResearchLoading && (
          <MarginEmptyView title="Entity unavailable" detail={entityResearchError} />
        )}
        {entityResearch && !entityResearchLoading && (
          <div>
            <h1 ref={researchTitleRef} id="entity-research-title" className="sr-only" tabIndex={-1}>
              Research {entityResearch.entity.displayName}
            </h1>
            <EntityResearchView
              data={entityResearch}
              origin={entityIntent.origin}
              currentBook={book}
              currentChapter={chapter}
              chapterVerseText={displayChapterVerseText ?? chapterVerseText ?? new Map<number, string>()}
              bookNames={bookNames}
              onNavigate={onNavigateToRef}
              onOpenEntity={openRelatedEntity}
              onCapture={onCapture}
            />
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside
      ref={marginRef}
      className="living-margin"
      aria-labelledby="living-margin-title"
      data-margin-mode={marginMode.toLowerCase().replace(" ", "-")}
      onPointerEnter={() => onMarginActiveChange?.(true)}
      onPointerLeave={() => onMarginActiveChange?.(false)}
    >
      <header className="margin-frame-header">
        <h2
          ref={frameTitleRef}
          id="living-margin-title"
          className="margin-frame-title"
          aria-describedby="living-margin-mode"
          tabIndex={-1}
        >
          Study
        </h2>
        <div className="margin-frame-state">
          <span id="living-margin-mode" className="margin-frame-mode" aria-live="polite">{scopeCopy}</span>
          {!connectionInspectorOpen && isPinned && onClearSelection && (
            <button type="button" className="margin-frame-action" onClick={clearSelection}>
              Clear
            </button>
          )}
        </div>
      </header>

      {connectionInspectorOpen && (
        <div className="margin-connection-inspector" data-margin-view="connection">
          {connectionInspector}
        </div>
      )}

      {!connectionInspectorOpen && authoredConnections.length > 0 && (
        <nav className="margin-authored-connections" aria-label="Your authored connections in this passage">
          <div className="margin-authored-connections-head">
            <span>Your connections</span>
            <small>{authoredConnections.length}</small>
          </div>
          <div className="margin-authored-connections-list">
            {authoredConnections.map((connection) => (
              <button
                key={connection.id}
                type="button"
                aria-pressed={selectedAuthoredConnectionId === connection.id}
                onClick={() => onSelectAuthoredConnection?.(connection, true)}
              >
                <span>{connection.label}</span>
                <small>{connection.anchors.length} {connection.anchors.length === 1 ? "moment" : "moments"}</small>
              </button>
            ))}
          </div>
        </nav>
      )}

      <div className={`margin-study-content${connectionInspectorOpen ? " has-connection-inspector" : ""}`}>
      <div className="margin-context" aria-label={`Study scope: ${contextReference}`}>
        <h3 className="margin-header-ref">{contextReference}</h3>
        {contextQuote && <PassageQuote text={contextQuote} contextKey={contextKey} />}
      </div>

      <div className="margin-tabs" role="tablist" aria-label="Study views" aria-orientation="horizontal">
        {MARGIN_TABS.map((tab, index) => {
          const selected = activeTab === tab.id;
          const count = tabCount(tab.id);
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              id={`margin-${tab.id}-tab`}
              className={`margin-tab${selected ? " is-active" : ""}`}
              role="tab"
              aria-label={tab.accessibleLabel}
              aria-selected={selected}
              aria-controls={`margin-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              {count != null && count > 0 && (
                <span className="margin-tab-count" aria-label={`${count} items`}>{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* --- State 1: Chapter overview (default) --- */}
      {!isPinned && !isNear && (
        <div className="margin-panel-anim" data-margin-view="chapter">
          <section
            id="margin-overview-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-overview-tab"
            hidden={activeTab !== "overview"}
          >
            <IntentOverview
              crossRefs={crossRefs}
              directNote={marginData.notes[0] ?? null}
              semantic={semanticData}
              entityResult={entityResult}
              loading={entityLoading || Boolean(semanticLoading)}
              onNavigate={onNavigateToRef}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
          </section>

          <section
            id="margin-passage-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-passage-tab"
            hidden={activeTab !== "passage"}
          >
            {(hasDeterministicData || hasSemanticData) && (
              <>
                <div className="margin-view-heading">
                  <h3>Words &amp; structure</h3>
                  <p>Your marks and study activity remain secondary to the text.</p>
                </div>
                <p className="margin-invite">
                  Select a verse to study its language, add a highlight, or narrow each view to that passage.
                </p>
              </>
            )}

            {!hasDeterministicData && !hasSemanticData && semanticLoading && (
              <div className="margin-overview-loading" role="status">
                <span className="ai-insight-spinner" aria-hidden="true" />
                <span>Reading your library…</span>
              </div>
            )}

            {!hasDeterministicData && !hasSemanticData && !semanticLoading && (
              <MarginEmptyView
                title="A quiet chapter"
                detail="Select a verse to begin studying or leave your first mark."
              />
            )}
          </section>

          <section
            id="margin-connections-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-connections-tab"
            hidden={activeTab !== "connections"}
          >
            {crossRefs && crossRefs.items.length > 0 ? (
              <CrossRefsBlock
                result={crossRefs}
                onNavigate={onNavigateToRef}
                onCapture={onCapture}
                frozenOrigin={contextReference}
              />
            ) : (
              <MarginEmptyView
                title="No chapter connections"
                detail="Select a verse to look for a more focused relationship."
              />
            )}
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
            <div className="margin-view-heading">
              <h3>In this chapter</h3>
              <p>Material from My notes for this chapter.</p>
            </div>
            {semanticData && semanticData.threads.length > 0 && (
              <div className="margin-overview-themes">
                <span className="margin-overview-label">Themes in your notes</span>
                <div className="margin-tags">
                  {semanticData.threads.slice(0, 3).map((thread) => (
                    <span key={thread.id} className="margin-tag">{thread.label}</span>
                  ))}
                </div>
              </div>
            )}
            {marginData.notes.length > 0 ? (
              <div className="margin-note-list">
                {marginData.notes.map((note, index) => (
                  <DeepNoteCard
                    key={note.id}
                    title={note.title}
                    body={note.body_text}
                    meta="Anchored in this chapter"
                    defaultOpen={index === 0}
                  />
                ))}
              </div>
            ) : semanticLoading ? (
              <div className="margin-overview-loading" role="status">
                <span className="ai-insight-spinner" aria-hidden="true" />
                <span>Reading your library…</span>
              </div>
            ) : (
              <MarginEmptyView
                title="No chapter notes yet"
                detail="Select a verse, then add a note when you have something worth keeping."
              />
            )}
          </section>
        </div>
      )}

      {/* --- State 2: Ambient "currently reading" --- */}
      {isNear && (
        <div className="margin-panel-anim" data-margin-view="reading">
          <section
            id="margin-overview-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-overview-tab"
            hidden={activeTab !== "overview"}
          >
            <IntentOverview
              crossRefs={crossRefs}
              directNote={nearNote}
              semantic={semanticData}
              entityResult={entityResult}
              loading={entityLoading || Boolean(semanticLoading)}
              onNavigate={onNavigateToRef}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
          </section>

          <section
            id="margin-passage-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-passage-tab"
            hidden={activeTab !== "passage"}
          >
            {nearVerse != null && (
              <LanguageWordsSection
                book={book}
                bookDisplayName={displayBook}
                chapter={chapter}
                verse={nearVerse}
                readingPackageId={packageId}
                onStudyEngage={onStudyVerse}
                onCapture={onCapture}
              />
            )}
          </section>

          <section
            id="margin-connections-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-connections-tab"
            hidden={activeTab !== "connections"}
          >
            {crossRefs && crossRefs.items.length > 0 ? (
              <CrossRefsBlock
                result={crossRefs}
                onNavigate={onNavigateToRef}
                onCapture={onCapture}
                frozenOrigin={contextReference}
              />
            ) : (
              <MarginEmptyView
                title="No connections here"
                detail="Continue reading or select a passage to widen the scope."
              />
            )}
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
            <div className="margin-view-heading">
              <h3>At this verse</h3>
              <p>Material from My notes at this verse.</p>
            </div>
            {nearNote ? (
              <DeepNoteCard
                title={nearNote.title}
                body={nearNote.body_text}
                meta="Anchored at this verse"
                defaultOpen
              />
            ) : (
              <MarginEmptyView
                title="No note on this verse"
                detail="Select the verse when you want to highlight it or add a note."
              />
            )}
          </section>
        </div>
      )}

      {/* --- State 3: Selected / pinned passage ---
          Hierarchy (daily-use minimal):
          1. Where you are + highlight tools
          2. Language (primary study surface)
          3. Your note (if any)
          4. Secondary: related notes / claims / xrefs — only when non-empty
          Never show permanent empty AI shells. */}
      {isPinned && (
        <div className="margin-panel-anim" data-margin-view="selected">
          <section
            id="margin-overview-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-overview-tab"
            hidden={activeTab !== "overview"}
          >
            <IntentOverview
              crossRefs={crossRefs}
              directNote={pinnedNote}
              semantic={pinnedSemantic}
              entityResult={entityResult}
              loading={entityLoading || pinnedAiLoading}
              onNavigate={onNavigateToRef}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
          </section>

          <section
            id="margin-passage-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-passage-tab"
            hidden={activeTab !== "passage"}
          >
          {/* Selection tools live on the floating mini toolbar over the text.
              Margin shows pin status + neutral multi-color state when needed. */}
          <div className="margin-selection-tools">
            <div className={`margin-pin-status${pinnedColors.length > 1 ? " is-mixed" : ""}`}>
              <span className="margin-pin-action-label">Highlight</span>
              <span className="margin-pin-status-label" aria-live="polite">
                {pinnedColors.length > 1
                  ? "Mixed"
                  : pinnedHighlightColor
                    ? pinnedHighlightColor.charAt(0).toUpperCase() + pinnedHighlightColor.slice(1)
                    : "None"}
              </span>
              {pinnedHighlights.length > 0 && onRemoveHighlights && (
                <button
                  type="button"
                  className="margin-hl-remove"
                  onClick={() => onRemoveHighlights(pinnedHighlights.map((h) => h.id))}
                >
                  Remove highlight{pinnedHighlights.length === 1 ? "" : "s"}
                </button>
              )}
            </div>

          </div>

          {/* Primary study surface */}
          {pinnedRange.end > pinnedRange.start && (
            <div className="words-verse-chooser" role="radiogroup" aria-label="Words for verse">
              <span className="words-verse-chooser-label">Words for verse</span>
              <span className="words-verse-chips">
                {Array.from(
                  { length: pinnedRange.end - pinnedRange.start + 1 },
                  (_, index) => pinnedRange.start + index,
                ).map((verse) => (
                  <button
                    key={verse}
                    type="button"
                    className="words-verse-chip"
                    role="radio"
                    aria-label={`Verse ${verse}`}
                    aria-checked={wordsVerse === verse}
                    tabIndex={wordsVerse === verse ? 0 : -1}
                    onClick={() => setWordsVerse(verse)}
                  >
                    {verse}
                  </button>
                ))}
              </span>
            </div>
          )}
          <LanguageWordsSection
            book={book}
            bookDisplayName={displayBook}
            chapter={chapter}
            verse={wordsVerse}
            readingPackageId={packageId}
            onStudyEngage={onStudyVerse}
            onCapture={onCapture}
          />

          </section>

          <section
            id="margin-connections-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-connections-tab"
            hidden={activeTab !== "connections"}
          >
            {(crossRefs?.items.length ?? 0) > 0 && crossRefs && (
              <CrossRefsBlock
                result={crossRefs}
                onNavigate={onNavigateToRef}
                onCapture={onCapture}
                frozenOrigin={contextReference}
              />
            )}
            {pinnedSemantic && pinnedSemantic.suggestedCrossRefs.length > 0 && (
              <NoteCrossRefsBlock
                items={pinnedSemantic.suggestedCrossRefs.slice(0, 6)}
                onNavigate={onNavigateToRef}
                onCapture={onCapture}
                frozenOrigin={contextReference}
              />
            )}
            {connectionCount === 0 && (
              <MarginEmptyView
                title="No connections for this passage"
                detail="Try a single verse for a narrower OpenBible match."
              />
            )}
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
            <div className="margin-view-heading margin-view-heading--action">
              <div>
                <h3>For this passage</h3>
                <p>Your anchored note and grounded library context.</p>
              </div>
              {onCreateNote && (
                <button type="button" className="margin-view-action" onClick={() => onCreateNote()}>
                  Add note
                </button>
              )}
            </div>

          {pinnedNote && (
            <section className="margin-section margin-note-section">
              <h3 className="margin-section-header">Your note</h3>
              <DeepNoteCard
                title={pinnedNote.title}
                body={pinnedNote.body_text}
                meta="Anchored to this passage"
                defaultOpen
              />
            </section>
          )}

          {pinnedAiLoading && (
            <div className="ai-insight-loading" role="status">
              <span className="ai-insight-spinner" aria-hidden="true" />
              <span className="ai-insight-label">Looking through your notes…</span>
            </div>
          )}

          {!pinnedAiLoading && pinnedInsight && (
            <section className="margin-section ai-insight-block" aria-label="Passage insight from your notes">
              <div className="ai-insight-head">
                <span className="ai-insight-title"><AiSparkIcon /> Passage insight</span>
                <span className="ai-insight-actions">
                  <span className="ai-insight-source">From your notes</span>
                  {onCapture && (
                    <button
                      type="button"
                      className="margin-capture-action"
                      aria-label={`Add ${pinnedRef} passage insight to a note`}
                      onClick={() => onCapture({
                        excerpt: pinnedInsight,
                        sourceAttribution: `Grounded in your notes (${pinnedLibraryItemCount})`,
                        reference: pinnedRef,
                        frozenOrigin: contextReference,
                        originLabel: "Passage insight",
                      })}
                    >
                      Add to note…
                    </button>
                  )}
                </span>
              </div>
              <p className="ai-insight-text">{pinnedInsight}</p>
            </section>
          )}

          {deepNotesLoading && pinnedSemantic && pinnedSemantic.semanticNotes.length > 0 && (
            <div className="deep-notes-loading" role="status">
              <span className="ai-insight-spinner" aria-hidden="true" />
              <span>Opening complete notes…</span>
            </div>
          )}

          {/* Notes is the deliberate deep-dive view. All retrieved material is
              present here; individual complete notes expand in place. */}
          {pinnedSemantic && pinnedLibraryItemCount > 0 && (
            <section className="margin-section notes-deep-dive" aria-label="Complete related material from your notes">
              {pinnedSemantic.semanticNotes.length > 0 && (
                <div className="margin-subsection">
                  <h4 className="margin-subsection-title">Related notes</h4>
                  {pinnedSemantic.semanticNotes.map((sn) => (
                    <DeepNoteCard
                      key={sn.noteId}
                      title={deepNotesById?.[sn.noteId]?.frontmatter.title || sn.title}
                      body={deepNotesById?.[sn.noteId]?.body ?? sn.snippet}
                      meta="Related note"
                      reasons={sn.reasons}
                    />
                  ))}
                </div>
              )}

              {pinnedSemantic.threads.length > 0 && (
                <div className="margin-subsection">
                  <h4 className="margin-subsection-title">Themes</h4>
                  {pinnedSemantic.threads.map((thread) => (
                    <article key={thread.id} className="margin-card">
                      <div className="card-title">{thread.label}</div>
                      <div className="card-excerpt">{thread.summary}</div>
                    </article>
                  ))}
                </div>
              )}

              {pinnedSemantic.claims.length > 0 && (
                <div className="margin-subsection">
                  <h4 className="margin-subsection-title">Grounded claims</h4>
                  {pinnedSemantic.claims.map((claim) => {
                    const noteEvidence = claim.sources.filter((source) => source.kind === "note");
                    const quote = noteEvidence.find((source) => source.quote)?.quote;
                    return (
                      <article key={claim.id} className="margin-card">
                        <div className="card-title">{claim.assertion}</div>
                        {quote && <div className="claim-evidence-quote">&ldquo;{quote}&rdquo;</div>}
                        {!pinnedClaims.has(claim.id) && (
                          <button
                            className="btn-pin-claim"
                            onClick={() => void handlePinClaim(claim.id, claim.assertion)}
                            disabled={pendingClaimId !== null}
                            aria-busy={pendingClaimId === claim.id}
                          >
                            {pendingClaimId === claim.id ? "Keeping…" : "Keep"}
                          </button>
                        )}
                        {claimPinError?.id === claim.id && pendingClaimId === null ? (
                          <p className="margin-inline-error" role="alert">{claimPinError.message}</p>
                        ) : null}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {!pinnedAiLoading && !pinnedNote && !pinnedInsight && pinnedLibraryItemCount === 0 && (
            <MarginEmptyView
              title="Nothing from your notes yet"
              detail="Add a note when this passage gives you something worth carrying forward."
            />
          )}
          </section>
        </div>
      )}
      </div>
    </aside>
  );
}
