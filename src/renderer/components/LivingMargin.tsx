import type React from "react";
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  AnchorRecord,
  BookNameData,
  CrossReferenceResultData,
  ConnectionAnchor,
  ConnectionRecord,
  EntityResearchData,
  LanguageEntityRangeResult,
  LanguageNameEntity,
  NoteRecord,
  ParsedNoteData,
  QueryResult,
  RankedTrustedResource,
  SemanticMarginResult,
} from "../api.js";
import {
  deriveEntityOpeningContext,
  type EntityOpeningOrigin,
} from "../../core/integrations/shepherdly-resource-node.js";
import {
  canonicalConnectionAnchors,
  compareConnectionsCanonical,
} from "../../core/annotations/connection-order.js";
import type { PassageMoment } from "../../core/passage-index.js";
import { CONNECTION_ROUTE_SELECTED_STROKE } from "../utils/connectionGeometry.js";
import type {
  ConnectionPaintAnchor,
  ConnectionPaintProjection,
} from "../utils/connectionPaint.js";
import { safeCall } from "../utils/safeCall.js";
import {
  ResourceKindIcon,
  ResourceLibraryMatrix,
  type ResourceLibraryCatalogue,
} from "./ResourceLibraryMatrix.js";
import {
  laurelInk,
  laurelMarkLabel,
  laurelSiglumRole,
  type LaurelCandidate,
  type LaurelSource,
} from "../utils/laurel.js";
import { isTopLayer, layerStackIsEmpty, useLayer } from "../layerStack.js";
import { RELATIONSHIP_LABELS } from "../utils/relationshipVocabulary.js";
import { passageTabOpenIntent } from "../utils/passageTabIntent.js";
import { formatCanonicalRef } from "../utils/formatRef.js";
import { LanguageWordsSection } from "./LanguageWordsSection.js";
import { SurfaceState } from "./MarkingSurface.js";
import { playPodcastEpisode, usePodcastNowPlaying } from "./PodcastPlayer.js";
import { SourcesDisclosure, formatSourceCitation, type CitationSource } from "./SourcesDisclosure.js";
import { useToast } from "./Toast.js";
import { parsePeekRef, useVersePeek, type PeekTarget, type VersePeekTriggerProps } from "./VersePeek.js";
import type { MarginWorkspace } from "../utils/marginWorkspace.js";
import {
  appendEntityResearchTrail,
  type EntityResearchTrailEntry,
  type PassageViewState,
} from "../utils/studyWorkspace.js";

export {
  appendEntityResearchTrail,
  ENTITY_RESEARCH_TRAIL_LIMIT,
  truncateEntityResearchTrail,
} from "../utils/studyWorkspace.js";
export type { EntityResearchTrailEntry } from "../utils/studyWorkspace.js";

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

export type MarginCitationSource = CitationSource;

export function formatMarginSourceCitation(source: MarginCitationSource): string {
  return formatSourceCitation(source);
}

const MarginSourcesDisclosure = SourcesDisclosure;

type MarginTab = "overview" | "connections" | "passage" | "notes";

export interface EntityResearchOpenOptions {
  /** Truncate the active entity tab's existing trail through this target. */
  trailIndex?: number;
}

/** A stable, human-readable identity is carried with every workspace action so
 * an unavailable catalog record never degrades into an opaque internal id. */
export interface EntityResearchTarget {
  id: string;
  displayName: string;
  kind: "person" | "place" | "other";
}

interface EntityBranchGesture {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}

/** Mirrors familiar desktop link gestures without making an ordinary click
 * proliferate tabs. The adjacent named action remains the discoverable path. */
export function isExplicitEntityBranchGesture(event: EntityBranchGesture): boolean {
  return event.button === 1 || event.metaKey || event.ctrlKey || event.shiftKey;
}

function entityResearchTarget(entity: EntityResearchTarget): EntityResearchTarget {
  return {
    id: entity.id,
    displayName: entity.displayName,
    kind: entity.kind,
  };
}

const MARGIN_SCROLL_PUBLISH_DELAY_MS = 220;

export type MarginScrollScope =
  | { kind: "research"; entityId: string }
  | { kind: "connection"; connectionId: string }
  | { kind: "selection"; start: number; end: number }
  | { kind: "kept"; verse: number }
  | { kind: "following"; verse: number }
  | { kind: "chapter" };

export interface MarginScrollRestoreContext {
  ownerTabId: string;
  sessionRestoreNonce: number;
  workspace: MarginWorkspace;
  activeTab: MarginTab;
  book: string;
  chapter: number;
  scope: MarginScrollScope;
}

/**
 * Identity for deliberate margin restores. The ambient verse is intentionally
 * absent while following: eye-line drift within one chapter must not yank a
 * reader back to a persisted offset.
 */
function marginScrollSubjectKey(context: MarginScrollRestoreContext): string {
  return context.scope.kind === "research"
    ? `research:${context.scope.entityId}`
    : context.scope.kind === "connection"
      ? `connection:${context.scope.connectionId}`
      : context.scope.kind === "selection"
        ? `selection:${context.scope.start}-${context.scope.end}`
        : context.scope.kind === "kept"
          ? `kept:${context.scope.verse}`
          : context.scope.kind;
}

export function marginScrollRestoreKey(context: MarginScrollRestoreContext): string {
  return [
    context.ownerTabId,
    context.sessionRestoreNonce,
    context.workspace,
    context.activeTab,
    context.book,
    context.chapter,
    marginScrollSubjectKey(context),
  ].join(":");
}

export interface MarginScrollRestoration {
  top: number;
  /** Reset publications keep the controlled snapshot aligned with the DOM. */
  publish: boolean;
}

/** Synchronous handoff used before a workspace owner can be replaced. */
export interface LivingMarginScrollController {
  ownerTabId: string;
  flushPendingScroll(): void;
}

export function resolveMarginScrollRestoration(
  previous: MarginScrollRestoreContext | null,
  current: MarginScrollRestoreContext,
  controlledScrollTop: number,
): MarginScrollRestoration | null {
  if (!previous
    || previous.ownerTabId !== current.ownerTabId
    || previous.sessionRestoreNonce !== current.sessionRestoreNonce
    || previous.workspace !== current.workspace
    || previous.activeTab !== current.activeTab) {
    return { top: controlledScrollTop, publish: false };
  }
  // The connection inspector is transient UI over the active Study lens. It
  // may use its own top while open, but must never replace the lens snapshot.
  if (current.scope.kind === "connection") {
    return previous.scope.kind === "connection"
      && previous.scope.connectionId === current.scope.connectionId
      ? null
      : { top: 0, publish: false };
  }
  if (previous.scope.kind === "connection") {
    return { top: controlledScrollTop, publish: false };
  }
  if (previous.book !== current.book
    || previous.chapter !== current.chapter
    || marginScrollSubjectKey(previous) !== marginScrollSubjectKey(current)) {
    return { top: 0, publish: true };
  }
  return null;
}

// Four lenses, named for what they hold rather than for how they relate to the
// passage. "Related" described a relationship; "Connections" names the thing
// the reader actually authored, which is what they will look for.
const MARGIN_TABS: Array<{ id: MarginTab; label: string; accessibleLabel: string }> = [
  { id: "overview", label: "Overview", accessibleLabel: "Overview" },
  { id: "notes", label: "Notes", accessibleLabel: "My notes" },
  { id: "connections", label: "Connections", accessibleLabel: "Connections" },
  { id: "passage", label: "Words", accessibleLabel: "Words & structure" },
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
  /** Deliberately branch a reference into a durable passage tab. */
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
  /** Replace the single kept comparison subject without navigating the canvas. */
  onKeepReference?: (reference: PeekTarget) => void;
  /** Keep original-language study aligned with its explicit verse. */
  onStudyVerse?: (verse: number) => void;
  /** Pointer entered/left the margin (freeze ambient eye-line while true). */
  onMarginActiveChange?: (active: boolean) => void;
  /** Explicit kept state for the ambient verse. */
  ambientKept?: boolean;
  onAmbientKeptChange?: (kept: boolean) => void;
  /** Leave the explicit selected-passage state and return to the reading eye-line. */
  onClearSelection?: () => void;
  /** V2 owner-tagged session state. No local map may outlive this owner. */
  sessionOwnerTabId: string;
  /** Changes only for an intentional owner/history/navigation snapshot restore. */
  sessionRestoreNonce: number;
  marginSession: PassageViewState["margin"];
  onMarginSessionChange: (
    ownerTabId: string,
    update: (current: PassageViewState["margin"]) => PassageViewState["margin"],
  ) => void;
  workspace?: MarginWorkspace;
  researchScrollTop?: number;
  onResearchScrollTopChange?: (ownerTabId: string, scrollTop: number) => void;
  onScrollControllerChange?: (
    ownerTabId: string,
    controller: LivingMarginScrollController | null,
  ) => void;
  /** One-shot request issued only by an explicit content-originated Research
   * open. Ordinary workspace-tab activation deliberately supplies no request. */
  entityResearchFocusRequest?: number | null;
  onEntityResearchFocusRequestHandled?: (ownerTabId: string, requestId: number) => void;
  entityIntent?: {
    id: string;
    displayName: string;
    kind: "person" | "place" | "other";
    nonce: number;
    origin: { book: string; chapter: number; chapterEndVerse?: number; packageId: string; verseStart?: number; verseEnd?: number };
  } | null;
  /** Study content opens a new Research tab. */
  onOpenEntity?: (target: EntityResearchTarget) => Promise<boolean>;
  onOpenResourceSettings?: () => void;
  /** Research content follows a related identity in the active Research tab. */
  onDrillEntity?: (target: EntityResearchTarget, options?: EntityResearchOpenOptions) => Promise<boolean>;
  /** Explicitly branch a related identity into a second Research tab. */
  onBranchEntity?: (target: EntityResearchTarget) => Promise<boolean>;
  /** Activate or restore the immutable passage origin without deleting Research. */
  onReturnEntityOrigin?: () => Promise<boolean>;
  /** The only Research action that removes the active tab. */
  onCloseEntity?: () => Promise<boolean>;
  entityTrail?: readonly EntityResearchTrailEntry[];
  onEntityTrailChange?: (
    ownerTabId: string,
    update: (current: readonly EntityResearchTrailEntry[]) => EntityResearchTrailEntry[],
  ) => void;
  /** A selected user-authored connection, composed by ScripturePage. */
  connectionInspector?: React.ReactNode;
  /** Durable authored relationships remain reachable even when this package
   * has no exact word projection and therefore no reading-canvas tick. */
  authoredConnections?: readonly ConnectionRecord[];
  /** Package-local paint evidence for the authored connections, so a member's
   * own wording can be quoted — and so a connection with no projection in this
   * translation is still listed, with its position markers only. */
  connectionPaintProjections?: ReadonlyMap<string, ConnectionPaintProjection>;
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

// C4·1 deleted `PassageQuote`. It drew a truncated copy of the selected verses
// under the scope bar, with a "Read full selection ↓" disclosure beneath it —
// "a truncated copy of two verses, offered beside the full, untruncated
// originals 300px to the left. It cost 140px and a Read full selection link
// whose answer is 'look left'." The reference alone is enough; the reader has
// not lost the text. Deleting it is what stops the tab row moving.

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

/** One verb per card, chosen by kind. Every verb leaves for the official page. */
function resourceVerb(kind: string): string {
  if (kind === "video") return "Watch";
  if (kind === "podcast") return "Listen";
  return "Read";
}

/** `bref:v1/ROM.8.6-ROM.8.11` reads as `ROM 8:6–11` on a mono chip. */
function resourcePassageLabel(bref: string): string {
  const read = (part: string): { book: string; chapter: string; verse: string } => {
    const [book = "", chapter = "", verse = ""] = part.split(".");
    return { book, chapter, verse };
  };
  const parts = bref.replace("bref:v1/", "").split("-");
  const start = read(parts[0] ?? "");
  const head = `${start.book} ${start.chapter}${start.verse ? `:${start.verse}` : ""}`;
  if (parts.length === 1) return head;
  const end = read(parts[1] ?? "");
  if (end.book !== start.book) return `${head}–${end.book} ${end.chapter}${end.verse ? `:${end.verse}` : ""}`;
  if (end.chapter !== start.chapter) return `${head}–${end.chapter}${end.verse ? `:${end.verse}` : ""}`;
  return end.verse && end.verse !== start.verse ? `${head}–${end.verse}` : head;
}

/**
 * Who has taught this chapter, and where in the episode.
 *
 * The inverse of the dock's own list, and the read a reader arrives with: not
 * "what does this episode cover" but "I am here, who has worked through it".
 *
 * Ordered by how long the discussion runs, and by nothing else. Two publishers
 * with opposite formats were measured, and the two obvious alternatives both
 * described the publisher rather than the passage — share of an episode depends
 * on how long the episode is, and what a show calls its "subject" depends on
 * how it makes episodes. Duration is the quantity that meant the same thing in
 * both: eleven minutes is eleven minutes whoever recorded it.
 *
 * The relation rides along as a label because a reader wants to know whether a
 * passage was worked through or glanced at — but it never decides an order.
 */
function TaughtHereBlock({ moments, onPlay }: {
  moments: readonly PassageMoment[];
  onPlay: (moment: PassageMoment) => void;
}): React.ReactElement {
  /* Nothing at all rather than an empty state. Most chapters have nobody
     teaching them, and a heading over a blank space says something went wrong
     when nothing did. */
  const [expanded, setExpanded] = useState(false);
  if (moments.length === 0) return <></>;

  /* Enough to choose from, not so many that choosing becomes the work — and
     the rest genuinely reachable rather than merely counted. A line saying
     "eleven more" with no way to see them tells a reader what they are not
     being shown, which is worse than not mentioning it. */
  const shown = expanded ? moments : moments.slice(0, 4);
  const clock = (s: number): string =>
    `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`;
  const extent = (s: number): string =>
    (s >= 60 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))}s`);

  return (
    <section className="taught-here" data-expanded={expanded} aria-labelledby="taught-here-title">
      <header className="taught-here-masthead">
        <span className="taught-here-kicker">From the transcripts</span>
        <h3 id="taught-here-title">Taught here</h3>
      </header>
      <ul className="taught-here-list">
        {shown.map((m) => (
          <li key={`${m.id}-${m.at}`}>
            <button className="taught-here-row" onClick={() => onPlay(m)} type="button">
              {/* Extent first, because it is what a reader is choosing on —
                  eleven minutes and forty seconds are different offers. */}
              <span className="taught-here-extent">{extent(m.seconds)}</span>
              <span className="taught-here-body">
                <span className="taught-here-episode">{m.episode}</span>
                <span className="taught-here-meta">
                  {m.sourceName} · {clock(m.at)}
                  {m.relation !== "subject" && ` · ${m.relation === "allusion" ? "alluded" : m.relation}`}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {moments.length > 4 && (
        <button
          aria-expanded={expanded}
          className="taught-here-more"
          onClick={() => setExpanded((open) => !open)}
          type="button"
        >
          {expanded ? "Show fewer" : `${moments.length - 4} more in the library`}
        </button>
      )}
    </section>
  );
}

function TrustedResourcesBlock({
  resources,
  loading,
  refusal,
  total,
  hiddenCount,
  catalogue,
  onOpenSettings,
  onFiltersChanged,
}: {
  resources: readonly RankedTrustedResource[];
  loading: boolean;
  refusal: string | null;
  total: number;
  hiddenCount: number;
  catalogue: ResourceLibraryCatalogue | null;
  onOpenSettings?: (() => void) | undefined;
  onFiltersChanged?: (() => void) | undefined;
}): React.JSX.Element {
  const { showToast } = useToast();
  /* A chip is a publisher, not a record. Three chips used to mean three cards,
     so a publisher with two good answers took two chips and looked like two
     publishers. One chip each, and opening one shows everything that publisher
     has for this passage — in the order the ranking already put them. */
  const [openedSource, setOpenedSource] = useState<string | null>(null);
  /* The lens: what the reader is looking at right now. Deliberately component
     state and nothing more — it dies with the passage, because "just show me
     the commentaries" is a glance, not a preference. */
  const [lensKind, setLensKind] = useState<string | null>(null);

  /* The transport is not here. It used to be — one element for the whole group,
     stopped on unmount — and unmount is every tab switch, every passage, every
     time the panel closes, which made a 44-minute episode last as long as a
     reader stayed on one card. The element lives above the whole app now and
     the card only presses play; see components/PodcastPlayer. What this block
     still owns is which episode is running, because that is what a play button
     has to draw. */
  const nowPlaying = usePodcastNowPlaying();
  const runningId = nowPlaying.status === "idle" || nowPlaying.status === "failed"
    ? null
    : nowPlaying.episode?.id ?? null;

  const sources = useMemo(() => {
    const order: Array<{ id: string; name: string; count: number }> = [];
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const resource of resources) {
      const existing = seen.get(resource.source.id);
      if (existing) { existing.count += 1; continue; }
      const entry = { id: resource.source.id, name: resource.source.name, count: 1 };
      seen.set(resource.source.id, entry);
      order.push(entry);
    }
    return order;
  }, [resources]);

  const ALL = "*";
  const FILTERS = "~filters";

  /* Opening keeps the ranking's order — within a publisher and between them —
     so what a reader sees first is still what the evidence put first. */
  const lensKinds = useMemo(() => {
    const chosen = openedSource === ALL
      ? resources
      : resources.filter((resource) => resource.source.id === openedSource);
    const counts = new Map<string, number>();
    for (const resource of chosen) counts.set(resource.record.kind, (counts.get(resource.record.kind) ?? 0) + 1);
    return [...counts.entries()]
      .map(([kind, count]) => ({ kind, count }))
      .sort((left, right) => right.count - left.count || left.kind.localeCompare(right.kind));
  }, [openedSource, resources]);

  const groups = useMemo(() => {
    const chosen = openedSource === ALL
      ? resources
      : resources.filter((resource) => resource.source.id === openedSource);
    const opened = lensKind ? chosen.filter((resource) => resource.record.kind === lensKind) : chosen;
    const order: Array<{ id: string; name: string; items: RankedTrustedResource[] }> = [];
    const seen = new Map<string, { id: string; name: string; items: RankedTrustedResource[] }>();
    for (const resource of opened) {
      const existing = seen.get(resource.source.id);
      if (existing) { existing.items.push(resource); continue; }
      const entry = { id: resource.source.id, name: resource.source.name, items: [resource] };
      seen.set(resource.source.id, entry);
      order.push(entry);
    }
    return order;
  }, [openedSource, resources, lensKind]);

  const openResource = async (resource: RankedTrustedResource): Promise<void> => {
    const result = await safeCall(() => window.api.trustedResources.openOfficial(
      resource.source.id,
      resource.record.id,
      resource.record.officialUrl,
    ));
    if (!result.ok) showToast("That official resource link could not be opened.", undefined, undefined, { tone: "error" });
  };
  if (!loading && !refusal && resources.length === 0 && hiddenCount === 0) return <></>;
  return (
    <section className="trusted-resources" aria-labelledby="trusted-resources-title">
      <header className="trusted-resources-masthead">
        <span className="trusted-resources-kicker">Local publisher index</span>
        <h3 id="trusted-resources-title">Published resources</h3>
      </header>
      {loading && <p className="trusted-resources-status" role="status">Checking local resource manifests…</p>}
      {refusal && <p className="trusted-resources-status is-refusal" role="status">Published resources unavailable: {refusal}</p>}
      {!loading && !refusal && resources.length > 0 && (
        <div className="trusted-resource-drawer">
          {/* Closed, the group is three imprints on the margin's own paper: the
              colour is held to the size of a mark until a reader asks for one.
              Opened, that source's card takes the full brand surface. */}
          <div className="trusted-resource-imprints">
            {sources.map((source) => (
              <button
                aria-controls="trusted-resource-panel"
                aria-expanded={openedSource === source.id}
                aria-label={`${source.name} — ${source.count} ${source.count === 1 ? "card" : "cards"} for this passage`}
                className="trusted-resource-imprint"
                data-source={source.id}
                key={source.id}
                onClick={() => setOpenedSource(openedSource === source.id ? null : source.id)}
                type="button"
              >
                <span className="trusted-resource-source">{source.name}</span>
                {source.count > 1 && <span className="trusted-resource-imprint-count">{source.count}</span>}
              </button>
            ))}
            {/* All is a chip too, because it is the same kind of choice: it just
                names every publisher at once. */}
            {sources.length > 1 && (
              <button
                aria-controls="trusted-resource-panel"
                aria-expanded={openedSource === ALL}
                aria-label={`All ${total} cards for this passage`}
                className="trusted-resource-imprint is-all"
                key="all"
                onClick={() => setOpenedSource(openedSource === ALL ? null : ALL)}
                type="button"
              >
                <span className="trusted-resource-source">All</span>
                <span className="trusted-resource-imprint-count">{total}</span>
              </button>
            )}
            {/* The row raises the question of who these publishers are, and the
                answer lives in settings — so the way there is a chip in the
                same row rather than a hunt through a menu. */}
            <button
                aria-controls="trusted-resource-panel"
                aria-expanded={openedSource === FILTERS}
                aria-label={(catalogue?.mutes.length ?? 0) > 0
                  ? `Your library — ${catalogue?.mutes.length} muted`
                  : "Choose what your library offers"}
                className="trusted-resource-imprint is-settings"
                data-muted={(catalogue?.mutes.length ?? 0) > 0}
                key="settings"
                onClick={() => setOpenedSource(openedSource === FILTERS ? null : FILTERS)}
                title={(catalogue?.mutes.length ?? 0) > 0
                  ? `Your library — ${catalogue?.mutes.length} muted`
                  : "Choose what your library offers"}
                type="button"
              >
                <span className="trusted-resource-source" aria-hidden="true">
                  {/* Sliders, not a cog: at 13px a cog's teeth close up into a
                      sun. Three rows with a knob each also happens to be what
                      the panel behind it actually is. */}
                  <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
                    <g fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4">
                      <path d="M2.2 4.2h11.6M2.2 8h11.6M2.2 11.8h11.6" />
                      <circle cx="5.6" cy="4.2" r="1.6" fill="var(--bg-reading)" />
                      <circle cx="10.4" cy="8" r="1.6" fill="var(--bg-reading)" />
                      <circle cx="6.6" cy="11.8" r="1.6" fill="var(--bg-reading)" />
                    </g>
                  </svg>
                </span>
              </button>
          </div>

          <div className="trusted-resource-panel" id="trusted-resource-panel">
          {openedSource === FILTERS && (
            <div className="trusted-resource-library">
              <p className="trusted-resource-library-lead">
                Your library, everywhere — not just this passage.
              </p>
              <ResourceLibraryMatrix
                catalogue={catalogue}
                onChanged={() => onFiltersChanged?.()}
                onFailed={(message) => showToast(message, undefined, undefined, { tone: "error" })}
              />
              {onOpenSettings && (
                <button className="trusted-resource-library-more" onClick={onOpenSettings} type="button">
                  Open in settings <span aria-hidden="true">→</span>
                </button>
              )}
            </div>
          )}

          {openedSource !== null && openedSource !== FILTERS && lensKinds.length > 1 && (
            /* Narrowing what is open, not what exists. It resets whenever the
               reader opens something else, because a glance should not outlive
               the glance. */
            <div className="trusted-resource-lens" role="group" aria-label="Narrow what is shown">
              <button
                aria-pressed={lensKind === null}
                className="trusted-resource-lens-chip"
                onClick={() => setLensKind(null)}
                type="button"
              >
                Everything
              </button>
              {lensKinds.map((kind) => (
                <button
                  aria-pressed={lensKind === kind.kind}
                  className="trusted-resource-lens-chip"
                  key={kind.kind}
                  onClick={() => setLensKind(lensKind === kind.kind ? null : kind.kind)}
                  type="button"
                >
                  <ResourceKindIcon kind={kind.kind} />
                  {kind.kind}
                  <span className="trusted-resource-lens-count">{kind.count}</span>
                </button>
              ))}
            </div>
          )}

          {groups.map((group) => (
            <article
              className="trusted-resource-card is-featured"
              data-source={group.id}
              key={group.id}
            >
              {/* The imprint is stated once for the group. Thirteen cards from
                  one publisher repeated its mark thirteen times and turned a
                  margin into a wall of one colour. */}
              <header className="trusted-resource-head">
                <span className="trusted-resource-source">{group.name}</span>
                <span className="trusted-resource-kind">
                  {group.items.length} {group.items.length === 1 ? "card" : "cards"}
                </span>
              </header>
              <ul className="trusted-resource-items">
                {group.items.map((resource) => {
                  const metadata = resource.record.metadata;
                  const byline = [
                    metadata?.author,
                    metadata?.publishedAt,
                    metadata?.durationMinutes ? `${metadata.durationMinutes} min` : undefined,
                    metadata?.series,
                  ].filter(Boolean).join(" · ");
                  const verb = resourceVerb(resource.record.kind);
                  const key = `${resource.source.id}:${resource.record.id}`;
                  const running = runningId === key;
                  return (
                    <li className="trusted-resource-item" key={key}>
                      <p className="trusted-resource-item-kind">{resource.record.kind}</p>
                      <h4 className="trusted-resource-title">{resource.record.title}</h4>
                      {byline && <p className="trusted-resource-meta">{byline}</p>}
                      <ul className="trusted-resource-chips">
                        <li className="trusted-resource-chip is-bref">{resourcePassageLabel(resource.matchedBref)}</li>
                        <li className="trusted-resource-chip is-match">{resource.match.replaceAll("-", " ")}</li>
                      </ul>
                      <div className="trusted-resource-actions">
                        {resource.record.audioUrl && (
                          <button
                            aria-label={`${running ? "Pause" : "Play"} ${resource.record.title}`}
                            aria-pressed={running}
                            className="trusted-resource-play"
                            onClick={() => playPodcastEpisode({
                              id: key,
                              sourceId: resource.source.id,
                              recordId: resource.record.id,
                              sourceName: resource.source.name,
                              title: resource.record.title,
                              officialUrl: resource.record.officialUrl,
                              audioUrl: resource.record.audioUrl as string,
                              bref: resource.matchedBref,
                              kind: resource.record.kind,
                            })}
                            type="button"
                          >
                            {running ? (
                              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                                <path d="M5 3h2.2v10H5zM8.8 3H11v10H8.8z" fill="currentColor" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">
                                <path d="M4.6 2.8 12.6 8l-8 5.2z" fill="currentColor" />
                              </svg>
                            )}
                          </button>
                        )}
                        <button
                          className="trusted-resource-act"
                          type="button"
                          onClick={() => void openResource(resource)}
                          aria-label={`${verb} ${resource.record.title} on ${resource.source.name} — opens the official page`}
                        >
                          {verb} at {resource.source.name} <span aria-hidden="true">↗</span>
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}

          </div>

          {hiddenCount > 0 && (
            <div className="trusted-resource-more">
              <span className="trusted-resource-more-hidden">
                {hiddenCount} hidden by your settings
              </span>
            </div>
          )}
        </div>
      )}
      {!loading && !refusal && resources.length === 0 && hiddenCount > 0 && (
        <p className="trusted-resources-status" role="status">
          Every source that matches this passage is switched off in settings.
        </p>
      )}
    </section>
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

/** Line-icon "open in a new tab" glyph, shared with the VersePeek open action
 *  so the durable-branch gesture reads the same everywhere. */
export function OpenInTabIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M8.5 3H4.5A1.5 1.5 0 0 0 3 4.5v7A1.5 1.5 0 0 0 4.5 13h7A1.5 1.5 0 0 0 13 11.5v-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 8 13 3M9.5 3H13v3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A cross-reference row travels in the current tab on a plain click, but a
 * ⌘/Ctrl-click or middle-click branches it into a durable passage tab — the
 * same convention chapter arrows and the passage picker already honor. When no
 * peekable target parses, the row keeps its ordinary same-tab behavior.
 */
function crossRefBranchHandlers(
  bref: string,
  target: PeekTarget | null,
  onNavigate?: (ref: string) => void,
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean,
): {
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onAuxClick: (event: React.MouseEvent<HTMLElement>) => void;
} {
  return {
    onClick: (event) => {
      if (target && onOpenPassageTab && passageTabOpenIntent(event)) {
        event.preventDefault();
        void onOpenPassageTab(target);
        return;
      }
      onNavigate?.(bref);
    },
    onAuxClick: (event) => {
      if (!target || !onOpenPassageTab || !passageTabOpenIntent(event)) return;
      event.preventDefault();
      void onOpenPassageTab(target);
    },
  };
}

/* ---------------------------------------------------------------------------
   C·2 — the margin entry
   ---------------------------------------------------------------------------
   They are ENTRIES, not cards: a hanging indent and no box, so an entry can
   end early without looking broken. A card with nothing in its lower half
   reads as a loading failure; an entry that simply stops reads as an entry
   that had nothing more to say.

   ONE skeleton, six parts, always in this order:

     1 name line          serif 22, the original beside it
     2 kind & situation   one 11px line — the line that lets a reader skip
     3 why it is here     serif, passage-relative, 1–2 sentences
     4 fact rows          74px label column; absent fields DO NOT render
     5 appears-in         three, then a count
     6 related            2–3 names; Follow / Branch in space reserved at rest

   Parts 1–3 are mandatory. 4–6 appear only when there is something true to
   say. Four kinds — place, person, deity/other, group — share this one
   skeleton; the KIND line absorbs the difference, and the layout never forks.

   Uncertainty is content, not an error state: `proposed` sets italic serif,
   and it means the same thing everywhere — unidentified sites, contested
   titles, manuscript variants, estimates.
   ------------------------------------------------------------------------- */

/** 4px slate dot = the app wrote this sentence. 2px seal spine + a date = you
 *  wrote it. 2px laurel spine + a siglum = a named third party wrote it and we
 *  licensed it. Unmarked = it is the edition, and nothing else may go unmarked.
 *  The mark is persistent, never a hover reveal — provenance you have to
 *  already suspect is not provenance.
 *
 *  @quire derived · kin: margin entry · laurel takes a 2px spine like seal
 *  rather than a dot like slate, because the spine already means "a person
 *  wrote this sentence" and the dot already means "this was computed". Laurel
 *  is authorship by someone else, so it belongs on the spine side of that
 *  distinction; the ink and the kicker carry the difference from seal. */
export type MarginEntryProvenance = "app" | "reader" | "edition" | "licensed";

export interface MarginEntryFact {
  label: string;
  value: React.ReactNode;
  /** Italic serif — proposed, contested, a manuscript variant, an estimate. */
  proposed?: boolean;
  /** Hebrew values carry direction themselves; the label column stays LTR. */
  dir?: "ltr" | "rtl";
}

export interface MarginEntryAppearance {
  key: string;
  label: string;
  preview?: string;
  onOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  onAuxOpen?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  openLabel: string;
}

export interface MarginEntryRelation {
  key: string;
  name: string;
  /** TIPNR marks some identifications as uncertain — say so in the type. */
  proposed?: boolean;
  onFollow?: () => void;
  onBranch?: () => void;
  onAuxActivate?: (event: React.MouseEvent<HTMLButtonElement>) => void;
  followLabel: string;
  branchLabel: string;
}

function MarginEntryNameLine({
  name,
  original,
  originalDir,
  originalLang,
  collision,
  proposed,
  onOpen,
  openLabel,
}: {
  name: string;
  original?: string | null;
  originalDir?: "ltr" | "rtl";
  originalLang?: string;
  collision?: { index: number; total: number } | null;
  proposed?: boolean;
  onOpen?: () => void;
  openLabel?: string;
}): React.JSX.Element {
  // A dictionary head, never a page title. The original sits beside it for the
  // scholar and is ignorable by everyone else.
  const head = (
    <>
      <span className={`margin-entry-name-text${proposed ? " is-proposed" : ""}`}>{name}</span>
      {original && (
        <span className="margin-entry-name-original" dir={originalDir} lang={originalLang}>
          {original}
        </span>
      )}
      {collision && collision.total > 1 && (
        // Name collisions are stated, never silently disambiguated.
        <span className="margin-entry-name-collision">{collision.index} of {collision.total}</span>
      )}
    </>
  );
  return (
    <div className="margin-entry-name">
      {onOpen ? (
        <button type="button" className="margin-entry-name-open" onClick={onOpen} aria-label={openLabel}>
          {head}
        </button>
      ) : (
        head
      )}
    </div>
  );
}

/** One 11px line. It replaces an icon, a badge and a category chip with five
 *  words, and it is what lets a reader skip an entry safely. */
function MarginEntryKindLine({ parts }: { parts: Array<string | null | undefined> }): React.JSX.Element | null {
  const kept = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part));
  if (kept.length === 0) return null;
  return <p className="margin-entry-kind">{kept.join(" · ")}</p>;
}

/* `openLicensedSourceUrl` lived here to open a laurel siglum from the
   overview's entity briefs. Quire C·4 takes those briefs off the overview
   entirely — the entity list is a 16px column of name, kind and count — so the
   surface no longer draws licensed prose and has no siglum to open. TIPNR is
   named in Sources, in the same block the research pane uses. The Research
   view keeps its own opener (`openMediaLink`), which has an error slot. */

/**
 * The siglum: laurel's kicker, and the only clickable provenance mark in the
 * language. Seal and slate marks are inert spans — they have nowhere to go, so
 * making them buttons would promise a destination that does not exist. This
 * one does have somewhere to go, which is the whole reason §4 singles it out.
 *
 * When the source has no permalink the siglum still has to be drawn — the ink
 * may not appear without it — so it degrades to static text rather than to a
 * button that does nothing when pressed.
 */
function MarginEntrySiglum({
  source,
  onOpenSource,
}: {
  source: LaurelSource;
  onOpenSource?: (url: string) => void;
}): React.JSX.Element {
  const href = source.href;
  if (laurelSiglumRole(source, onOpenSource != null) === "static" || !href || !onOpenSource) {
    return <span className="margin-entry-siglum is-static">{source.siglum}</span>;
  }
  return (
    <button
      type="button"
      className="margin-entry-siglum"
      onClick={() => onOpenSource(href)}
      aria-label={`Open the ${source.siglum} record for this entry`}
    >
      {source.siglum}
    </button>
  );
}

function MarginEntryWhy({
  provenance,
  writtenOn,
  licensed,
  onOpenSource,
  children,
}: {
  provenance: MarginEntryProvenance;
  writtenOn?: string;
  /** Required when `provenance` is "licensed", and ignored otherwise. */
  licensed?: LaurelCandidate;
  onOpenSource?: (url: string) => void;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const laurel = provenance === "licensed" ? laurelInk(licensed) : null;

  // Rev 04 §4: "If you cannot name the source you may not use the ink: fall
  // back to unmarked *and do not show the prose*." The fallback is to hide the
  // sentence, not to print it in the edition's unmarked voice — printing it is
  // how a Pleiades brief came to claim it was scripture in the first place. So
  // an unnameable licensed source removes the whole block, and the entry simply
  // continues at its next part, which the C·2 skeleton already allows.
  if (provenance === "licensed" && !laurel) return null;

  return (
    <div className={`margin-entry-why is-${provenance}`}>
      {provenance === "app" && (
        <span className="margin-entry-mark is-app">
          <span className="sr-only">Written by the app</span>
        </span>
      )}
      {provenance === "reader" && (
        <span className="margin-entry-mark is-reader">
          <span className="sr-only">Written by you</span>
        </span>
      )}
      {laurel && (
        <span className="margin-entry-mark is-licensed">
          <span className="sr-only">{laurelMarkLabel(laurel)}</span>
        </span>
      )}
      <div className="margin-entry-why-copy">
        {/* The kicker comes before the sentence it names, because a reader who
            is going to skip licensed prose should be able to skip it without
            reading it first. */}
        {laurel && <MarginEntrySiglum source={laurel} onOpenSource={onOpenSource} />}
        {children}
        {provenance === "reader" && writtenOn && (
          <span className="margin-entry-why-date">{writtenOn}</span>
        )}
      </div>
    </div>
  );
}

/**
 * Licensed prose that is not a margin entry's "why" — the gazetteer's own
 * description inside a Research section, for instance. Same law, same failure
 * mode: no siglum, no prose.
 *
 * @quire derived · kin: margin entry · a laurel paragraph outside the entry
 * skeleton keeps the entry's mark and kicker so the ink means one thing
 * everywhere, and takes its own class only for the surrounding type.
 */
function LaurelProse({
  licensed,
  onOpenSource,
  className,
  children,
}: {
  licensed: LaurelCandidate;
  onOpenSource?: (url: string) => void;
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const laurel = laurelInk(licensed);
  if (!laurel) return null;
  return (
    <div className={`margin-entry-why is-licensed laurel-prose${className ? ` ${className}` : ""}`}>
      <span className="margin-entry-mark is-licensed">
        <span className="sr-only">{laurelMarkLabel(laurel)}</span>
      </span>
      <div className="margin-entry-why-copy">
        <MarginEntrySiglum source={laurel} onOpenSource={onOpenSource} />
        {children}
      </div>
    </div>
  );
}

/** Two to four rows. A fifth means something belongs in Research. */
function MarginEntryFacts({ facts }: { facts: MarginEntryFact[] }): React.JSX.Element | null {
  const rows = facts.slice(0, 4);
  if (rows.length === 0) return null;
  return (
    <dl className="margin-entry-facts">
      {rows.map((fact) => (
        <div className="margin-entry-fact" key={fact.label}>
          <dt>{fact.label}</dt>
          <dd className={fact.proposed ? "is-proposed" : undefined} dir={fact.dir}>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function MarginEntryAppearsIn({
  items,
  remaining,
  emptyNote,
  onMore,
  moreLabel,
}: {
  items: MarginEntryAppearance[];
  remaining: number;
  emptyNote?: string;
  onMore?: () => void;
  moreLabel?: string;
}): React.JSX.Element | null {
  if (items.length === 0 && !emptyNote) return null;
  return (
    <div className="margin-entry-appears">
      <span className="margin-entry-part-label">Appears in</span>
      {items.length === 0 ? (
        <p className="margin-entry-appears-empty">{emptyNote}</p>
      ) : (
        <div className="margin-entry-appears-list">
          {items.map((item) => (
            <button
              key={item.key}
              type="button"
              className="margin-entry-appears-row"
              onClick={item.onOpen}
              onAuxClick={item.onAuxOpen}
              aria-label={item.openLabel}
            >
              <span className="margin-entry-appears-ref">{item.label}</span>
              {item.preview && <span className="margin-entry-appears-preview">{item.preview}</span>}
            </button>
          ))}
          {remaining > 0 && (
            onMore ? (
              <button type="button" className="margin-entry-appears-more" onClick={onMore}>
                {moreLabel ?? `${remaining.toLocaleString()} more`}
              </button>
            ) : (
              <span className="margin-entry-appears-more is-static">{remaining.toLocaleString()} more</span>
            )
          )}
        </div>
      )}
    </div>
  );
}

/** Both verbs are always named, never inferred from a modifier key, and the
 *  row height is reserved so revealing them shifts nothing. */
function MarginEntryRelated({ relations }: { relations: MarginEntryRelation[] }): React.JSX.Element | null {
  if (relations.length === 0) return null;
  return (
    <div className="margin-entry-related">
      <span className="margin-entry-part-label">Related</span>
      <div className="margin-entry-related-list">
        {relations.map((relation) => (
          <span className="margin-entry-relation" key={relation.key}>
            <button
              type="button"
              className={`margin-entry-relation-name${relation.proposed ? " is-proposed" : ""}`}
              onClick={relation.onFollow}
              onAuxClick={relation.onAuxActivate}
              aria-label={relation.followLabel}
            >
              {relation.name}
            </button>
            <span className="margin-entry-verbs">
              <button
                type="button"
                className="margin-entry-verb"
                onClick={relation.onFollow}
                aria-label={relation.followLabel}
              >
                Follow
              </button>
              {relation.onBranch && (
                <button
                  type="button"
                  className="margin-entry-verb"
                  onClick={relation.onBranch}
                  aria-label={relation.branchLabel}
                >
                  Branch
                </button>
              )}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

/** Your own handwriting needs no byline, only a date. */
function formatEntryDate(value: string): string | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "long" });
}

/**
 * "3 days ago" — the date voice for a list the reader is judging by recency,
 * which is what "Elsewhere in this study" is. Past a week the relative form
 * stops carrying a fact anybody holds ("eleven days ago" is arithmetic, not
 * memory), so it hands back to the absolute date the margin already uses
 * rather than inventing a second scale of weeks and months.
 *
 * @quire derived · kin: margin entry · relative for a week, then the date
 */
function formatRelativeDay(value: string, now: Date = new Date()): string | undefined {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  const dayOf = (date: Date): number => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((dayOf(now) - dayOf(parsed)) / 86_400_000);
  if (days < 0) return formatEntryDate(value);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return formatEntryDate(value);
}

/* ---------------------------------------------------------------------------
   Quire C·4 · Notes — the reader's own writing, in scope and elsewhere
   ---------------------------------------------------------------------------
   "Empty is never blank. One sentence naming what is absent, then the nearest
   true thing — notes elsewhere in the study." The nearest true thing this
   panel actually holds is the chapter: `marginData` is queried per chapter, so
   "this study" is scoped to the passage in view. A library-wide study is still
   an open question in C4·6, and drawing a number against a study that does not
   exist yet would be worse than drawing the one that does.

   @quire guessed · "this study" = the chapter in view · pending C4·6's "does a
   connection (and a note) belong to a study or to the library?"
   ------------------------------------------------------------------------ */

interface StudyNoteEntry {
  note: NoteRecord;
  anchor: AnchorRecord;
  /** The anchor's own reference, e.g. "Acts 19:11" or "Acts 19:11–13". */
  reference: string;
}

/** Text order, by anchor — the order the reader met their own notes in. The
 *  same rule §C4·5 sets for entities: nothing on this surface re-ranks. */
function studyNoteEntries(
  marginData: QueryResult,
  chapter: number,
  displayBook: string,
): StudyNoteEntry[] {
  const byId = new Map(marginData.notes.map((note) => [note.id, note]));
  const seen = new Set<string>();
  return marginData.anchors
    .filter((anchor) => anchor.chapter === chapter && byId.has(anchor.note_id))
    .slice()
    .sort((left, right) => left.verse_start - right.verse_start || left.verse_end - right.verse_end)
    .flatMap((anchor) => {
      if (seen.has(anchor.note_id)) return [];
      seen.add(anchor.note_id);
      const note = byId.get(anchor.note_id);
      if (!note) return [];
      const verses = anchor.verse_end !== anchor.verse_start
        ? `${anchor.verse_start}–${anchor.verse_end}`
        : `${anchor.verse_start}`;
      return [{ note, anchor, reference: `${displayBook} ${chapter}:${verses}` }];
    });
}

function anchorTouches(anchor: AnchorRecord, start: number, end: number): boolean {
  return anchor.verse_start <= end && anchor.verse_end >= start;
}

const VERSE_COUNT_WORDS = [
  "", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
] as const;

/** One sentence. The half that explains the interface to itself is deleted —
 *  it used to read "Add a note when this passage gives you something worth
 *  carrying forward", which told the reader what a note is for. */
function notesEmptySentence(
  scope: { start: number; end: number } | null,
  reference: string,
): string {
  if (!scope) return `You have not written anything in ${reference}.`;
  const count = Math.max(1, scope.end - scope.start + 1);
  if (count === 1) return "You have not written anything on this verse.";
  const word = VERSE_COUNT_WORDS[count] ?? count.toLocaleString();
  return `You have not written anything on these ${word} verses.`;
}

/**
 * The reader's notes as C4·2 compact rows, with two things a cross-reference
 * row does not carry: a seal mark, and when it was last written.
 *
 * The mark is a 4px seal dot, as C4·3 draws it. C·2 reserved the dot for the
 * app and the spine for the reader; Rev 04 Law 3 puts provenance in the INK,
 * and ruling 4·2's "later study wins" settles the shape. Seal says you wrote
 * it wherever it appears.
 *
 * Everything else — the clamp, the fade, the reserved verb slot and its hover
 * reveal — is `.study-ref-row*`, which c4-foundation owns. Only the mark, the
 * date and the trailing-edge rule for the two of them live in this file.
 */
function MarginNoteRows({
  entries,
  onNavigate,
}: {
  entries: readonly StudyNoteEntry[];
  onNavigate?: (ref: string) => void;
}): React.JSX.Element {
  const rowIdBase = useId();
  return (
    <div className="study-ref-row-list">
      {entries.map((entry, index) => {
        // Your own words are the reason this row is here, so the verb is
        // described by them rather than named with them: "Go to Acts 19:11",
        // then the note. Naming with them would repeat the note to anyone
        // reading the row through, and a note has no length limit.
        const noteId = `${rowIdBase}-note-${index}`;
        return (
          <div className="study-ref-row study-ref-row--compact margin-note-row" key={entry.note.id}>
            <div className="study-ref-row-head">
              <span className="margin-note-mark" aria-hidden="true" />
              <span className="sr-only">Written by you.</span>
              <span className="study-ref-row-ref">{entry.reference}</span>
              <span className="study-ref-row-verbs">
                <button
                  type="button"
                  className="study-ref-row-verb"
                  onClick={() => onNavigate?.(entry.reference)}
                  aria-label={`Go to ${entry.reference}`}
                  aria-describedby={noteId}
                >
                  Open
                </button>
              </span>
              <span className="margin-note-when">{formatRelativeDay(entry.note.modified)}</span>
            </div>
            <p className="study-ref-row-text" id={noteId}>
              {entry.note.title || entry.note.body_text}
            </p>
          </div>
        );
      })}
    </div>
  );
}

/**
 * C4·6: "Verbs are words in a footer. No bordered buttons, no circular chips,
 * no repeated capture verb floating beside a paragraph." The same row the
 * Connections and Words panels close with, on the tab that had a bordered
 * button at its head instead.
 */
function MarginNoteFooter({
  onCreateNote,
}: {
  onCreateNote?: () => void;
}): React.JSX.Element | null {
  if (!onCreateNote) return null;
  return (
    <div className="margin-note-footer">
      <button type="button" className="margin-note-verb" onClick={() => onCreateNote()}>
        Write a note
      </button>
    </div>
  );
}

/**
 * Law 7's `empty`, drawn. One sentence, then the verbs as words, then the
 * notes the reader wrote elsewhere in this study — "the empty state is not
 * empty; the notes you wrote elsewhere fill the space the absence left."
 *
 * `Add note` has lost its border: it was the only bordered control in the
 * panel, and C4·6 rules that verbs are words.
 */
function MarginNotesEmpty({
  sentence,
  elsewhere,
  onCreateNote,
  onNavigate,
}: {
  sentence: string;
  elsewhere: readonly StudyNoteEntry[];
  onCreateNote?: () => void;
  onNavigate?: (ref: string) => void;
}): React.JSX.Element {
  const [showAllElsewhere, setShowAllElsewhere] = useState(false);
  const shown = showAllElsewhere ? elsewhere : elsewhere.slice(0, 2);
  return (
    <div className="margin-notes-empty">
      <p className="margin-notes-empty-sentence">{sentence}</p>
      <div className="margin-note-verbs">
        {onCreateNote && (
          <button type="button" className="margin-note-verb" onClick={() => onCreateNote()}>
            Write a note
          </button>
        )}
        {/* @quire trigger · taxonomy · "Capture a phrase" has nothing behind it
            The study draws a second verb here. Capture in this app needs an
            excerpt and a `LivingMarginCaptureRequest.originLabel`, whose four
            values — Related verse, Passage insight, Entity research, Word
            study — have no slot for "a phrase of the passage you are reading".
            Rev 04 §9 forbids widening the nearest slot, which is how a
            Pleiades brief came to claim it was scripture. So the verb is
            absent rather than mislabelled, and this needs one sentence back:
            either a fifth origin, or the phrase-capture surface that C4·6's
            own open question ("where does a connection get made?") is already
            waiting on. */}
      </div>
      {elsewhere.length > 0 && (
        <section className="margin-note-elsewhere" aria-labelledby="margin-notes-elsewhere-title">
          <StudySectionHead
            titleId="margin-notes-elsewhere-title"
            title="Elsewhere in this study"
            count={elsewhere.length.toLocaleString()}
            countValue={elsewhere.length}
            countIsYours
          />
          <MarginNoteRows entries={shown} onNavigate={onNavigate} />
          {elsewhere.length > 2 && (
            <button
              type="button"
              className="intent-more-toggle"
              aria-expanded={showAllElsewhere}
              onClick={() => setShowAllElsewhere((current) => !current)}
            >
              {showAllElsewhere ? "Fewer notes" : `All ${elsewhere.length.toLocaleString()}`}
            </button>
          )}
        </section>
      )}
    </div>
  );
}

/** Every place in the Levant and the west that a reader already has a feel
 *  for. A bearing from one of these beats a 340×140 map at 380px. */
const BEARING_ANCHORS: ReadonlyArray<{ name: string; latitude: number; longitude: number }> = [
  { name: "Jerusalem", latitude: 31.7784, longitude: 35.2296 },
  { name: "Rome", latitude: 41.8931, longitude: 12.4832 },
];

const COMPASS_POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/** Great-circle distance, mean Earth radius. */
export function greatCircleKm(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): number {
  const dLat = toRadians(to.latitude - from.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(from.latitude)) * Math.cos(toRadians(to.latitude)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function compassPoint(
  from: { latitude: number; longitude: number },
  to: { latitude: number; longitude: number },
): string {
  const lat1 = toRadians(from.latitude);
  const lat2 = toRadians(to.latitude);
  const dLon = toRadians(to.longitude - from.longitude);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const bearing = (Math.atan2(y, x) * 180) / Math.PI;
  const index = Math.round(((bearing + 360) % 360) / 45) % 8;
  return COMPASS_POINTS[index]!;
}

/**
 * "1,050 km NW of Jerusalem" in 40px says what a decorative 340×140 map
 * cannot. Built from the record's own coordinates — never drawn by hand, and
 * absent entirely when the place is the anchor or carries no coordinates.
 */
export function bearingFromKnownPlace(latitude: number, longitude: number): string | null {
  const here = { latitude, longitude };
  let nearest: { name: string; km: number; point: string } | null = null;
  for (const anchor of BEARING_ANCHORS) {
    const km = greatCircleKm(anchor, here);
    if (!nearest || km < nearest.km) nearest = { name: anchor.name, km, point: compassPoint(anchor, here) };
  }
  // Inside the anchor's own footprint there is no bearing worth stating.
  if (!nearest || nearest.km < 20) return null;
  const distance = nearest.km < 100
    ? `${Math.round(nearest.km)}`
    : `${Math.round(nearest.km / 10) * 10}`;
  return `${Number(distance).toLocaleString()} km ${nearest.point} of ${nearest.name}`;
}

/**
 * A gazetteer title often carries every spelling any source has ever used for
 * a place, slash-joined: "Peloponnesus/Peloponnesos/Peloponnese". The kind
 * line is one 11px line of about five words — the line that lets a reader skip
 * an entry safely — and an alias list is not one situating fact, it is three,
 * which is what pushed the line to two and drove it into the description. Take
 * the first form. Alternate spellings are a fact row in study C·2 ("Also ·
 * Diana, in Latin texts"), never part of the kind line.
 */
function primaryTitleForm(title: string | undefined): string | undefined {
  const first = title?.split("/")[0]?.trim();
  return first ? first : undefined;
}

/**
 * Twelve characters is what the margin's 76px reference column carries at
 * Instrument Sans 11.5 semibold with tabular figures. Every reference in the
 * canon fits inside it once the book name is allowed to shorten.
 */
const REFERENCE_COLUMN_CHARS = 12;

/**
 * A reference is one token and must never break across lines. Given the full
 * book name, "1 Corinthians 1:12" wrapped inside the reference column to
 * "1 Corinthians" over "1:12" — which reads as two references and destroys the
 * column the fixed width exists to form.
 *
 * The edition ships its own list of names for each book, longest first, so
 * "the first name that keeps the whole reference inside the column" is the
 * edition's own preference order rather than an abbreviation table of ours.
 * That rule reproduces every reference the studies draw: Acts 18:19, Matt
 * 12:27, 1 Cor 15:32, Eph 1:1, Rev 2:1. If no name fits — a three-digit psalm
 * with a three-digit verse — the shortest the edition offers is still better
 * than an overflow.
 */
export function formatResearchRef(value: string, bookNames: BookNameData): string {
  const match = /^([1-3A-Z]{3})\.(\d+)\.(\d+)$/.exec(value);
  const names = match ? bookNames[match[1]!] : undefined;
  if (!match || !names || names.length === 0) return formatCanonicalRef(value, bookNames);
  const suffix = ` ${Number(match[2])}:${Number(match[3])}`;
  const fitted = names.find((name) => name.length + suffix.length <= REFERENCE_COLUMN_CHARS);
  const name = fitted ?? names.reduce((shortest, candidate) => (
    candidate.length < shortest.length ? candidate : shortest
  ));
  return `${name}${suffix}`;
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

/**
 * Rev 04 §4: "Laurel prose is never edited in place — editing it makes it yours,
 * and it becomes a seal entry quoting a laurel one."
 *
 * This is that second clause, and it is why capture is legal where an inline
 * edit would not be. Nothing here writes back to the entity; the brief is copied
 * into a new note the reader authors, alongside `sourceAttribution`, and the
 * laurel entry it came from is untouched and still laurel. The margin renders
 * licensed prose as text nodes only — there is no field, no caret, and no path
 * that mutates a TIPNR or Pleiades string on the surface it is drawn on.
 */
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
  // Natural Earth went with the minimap. A source is only listed while
  // something on the surface is actually drawn from it.
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

/** OpenBible's place types arrive lowercase; the kind line opens a sentence. */
function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return trimmed.charAt(0).toLocaleUpperCase() + trimmed.slice(1);
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
  onOpenPassageTab,
}: {
  data: EntityResearchData;
  origin: NonNullable<Props["entityIntent"]>["origin"];
  currentBook: string;
  currentChapter: number;
  chapterVerseText: Map<number, string>;
  bookNames: BookNameData;
  onNavigate?: (ref: string) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
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
            {/* Persistent, not a hover: this sentence is the app's, and the
                reader should not have to already suspect that to find out. */}
            <span className="margin-entry-mark is-app">
              <span className="sr-only">Written by the app</span>
            </span>
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
            {context.mentionRefs.slice(0, 4).map((ref) => {
              const label = formatResearchRef(ref, bookNames);
              const target = parsePeekRef(ref, label);
              return (
                <span className="entity-reference-actions is-opening" key={ref}>
                  <button
                    type="button"
                    {...crossRefBranchHandlers(`bref:v1/${ref}`, target, onNavigate, onOpenPassageTab)}
                    aria-label={`View ${label} in this research tab`}
                    title="Follow in this Research tab"
                  >
                    <span>{label}</span>
                    <CrossReferenceArrow />
                  </button>
                  {target && onOpenPassageTab && (
                    <button
                      type="button"
                      className="entity-reference-open-tab"
                      onClick={() => void onOpenPassageTab(target)}
                      aria-label={`Open ${label} as a passage tab`}
                      title="Open as passage tab"
                    >
                      Passage tab
                    </button>
                  )}
                </span>
              );
            })}
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
  onDrillEntity,
  onBranchEntity,
}: {
  data: EntityResearchData;
  onDrillEntity?: (target: EntityResearchTarget) => void;
  onBranchEntity?: (target: EntityResearchTarget) => void;
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
                <MarginEntryRelated relations={visibleItems.map((relationship) => {
                  const target: EntityResearchTarget = {
                    id: relationship.targetId,
                    displayName: relationship.displayName,
                    kind: "person",
                  };
                  return {
                    key: `${relationship.kind}-${relationship.targetId}`,
                    name: relationship.displayName,
                    // Uncertainty is content: TIPNR's doubt is carried by the
                    // type, not by a "?" glyph with the reason in a tooltip.
                    proposed: relationship.uncertain,
                    onFollow: () => { void onDrillEntity?.(target); },
                    onBranch: onBranchEntity ? () => { void onBranchEntity(target); } : undefined,
                    onAuxActivate: (event: React.MouseEvent<HTMLButtonElement>) => {
                      if (!isExplicitEntityBranchGesture(event) || !onBranchEntity) return;
                      event.preventDefault();
                      void onBranchEntity(target);
                    },
                    followLabel: `View ${relationship.displayName} in this research tab${relationship.uncertain ? ", proposed identification" : ""}`,
                    branchLabel: `Open ${relationship.displayName} in a new research tab${relationship.uncertain ? ", proposed identification" : ""}`,
                  };
                })} />
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

/* The 340×140 map that used to sit here was a decorative smudge — too small
   to place anything, big enough to displace the sentence that would have. It
   is replaced by the bearing fact row, which is built from the same
   coordinates. The map returns in Research at 800px, where it is worth
   looking at. */

function PleiadesResearchSection({
  data,
  licensed,
  openResearchLink,
}: {
  data: NonNullable<EntityResearchData["pleiades"]>;
  /** Names `place.description`. Null hides that paragraph and nothing else —
   *  the names, connections and bibliography below are records, not prose. */
  licensed: LaurelCandidate;
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
      {/* The gazetteer's own sentence about this place. It sat unmarked in
          --text-secondary, which is the edition's voice — so a Pleiades brief
          was claiming to be scripture, which is the defect ruling 4·5 names.
          The siglum here carries the per-place permalink, so it lands on the
          record the reader is reading rather than on a gazetteer front door. */}
      {place.description && (
        <LaurelProse
          licensed={licensed}
          onOpenSource={openResearchLink}
          className="entity-pleiades-prose"
        >
          <p className="entity-pleiades-description">{place.description}</p>
        </LaurelProse>
      )}
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
  peekTriggerProps,
  onDrillEntity,
  onBranchEntity,
  onOpenPassageTab,
  onCapture,
}: {
  data: EntityResearchData;
  origin: NonNullable<Props["entityIntent"]>["origin"];
  currentBook: string;
  currentChapter: number;
  chapterVerseText: Map<number, string>;
  bookNames: BookNameData;
  onNavigate?: (ref: string) => void;
  peekTriggerProps: (target: PeekTarget) => VersePeekTriggerProps;
  onDrillEntity?: (target: EntityResearchTarget) => void;
  onBranchEntity?: (target: EntityResearchTarget) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
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

  /* ---- C·2 · the six parts, derived once ------------------------------- */

  // 2 · kind & situation. One line absorbs the whole difference between a
  // place, a person, a deity and a group.
  const containedIn = primaryTitleForm(data.pleiades?.place.connections
    .find((connection) => connection.type.startsWith("part_of"))?.title);
  const kindLineParts: Array<string | null | undefined> = data.entity.kind === "place"
    ? [sentenceCase(place?.type ?? "Place"), containedIn ? `within ${containedIn}` : null]
    : data.entity.kind === "person"
      ? ["Person", person?.role, person?.era]
      : ["Deity or object", containedIn ? `within ${containedIn}` : null];

  // 4 · facts. Absent fields do not render — no "Unknown", no empty row —
  // and four is the ceiling; a fifth means it belongs in Research.
  const bearing = place ? bearingFromKnownPlace(place.primary.latitude, place.primary.longitude) : null;
  const siteIsProposed = place != null
    && (place.primary.confidence === "tentative" || place.primary.confidence === "disputed");
  const entryFacts: MarginEntryFact[] = [];
  if (data.entity.kind === "place") {
    if (place) {
      entryFacts.push({
        label: "Today",
        value: siteIsProposed ? `${place.primary.name} — ${confidenceLabel(place.primary.confidence).toLocaleLowerCase()}` : place.primary.name,
        proposed: siteIsProposed,
      });
    } else {
      // "We do not know where this is" is genuine information, and a reader
      // who wanted it should not have to go looking for its absence.
      entryFacts.push({ label: "Today", value: "unidentified", proposed: true });
    }
    if (bearing) entryFacts.push({ label: "Bearing", value: bearing });
    if (place && place.alternatives.length > 0) {
      entryFacts.push({
        label: "Proposed",
        value: `${place.alternatives.length + 1} locations, not merged`,
        proposed: true,
      });
    }
  } else {
    if (person?.affiliation) entryFacts.push({ label: "Among", value: person.affiliation });
  }
  if (entryFacts.length < 4 && data.entity.refCount > 0) {
    entryFacts.push({
      label: "Named",
      value: data.entity.refCount === 1
        ? "once"
        : `${data.entity.refCount.toLocaleString()} times`,
    });
  }

  // 5 · appears in — three, then a count, and never the passage the reader is
  // already looking at.
  const elsewhereRefs = orderedRefs.filter((ref) => {
    const parts = ref.split(".");
    return !(parts[0] === origin.book && Number(parts[1]) === origin.chapter);
  });
  const principalAppearances: MarginEntryAppearance[] = elsewhereRefs.slice(0, 3).map((ref) => {
    const label = formatResearchRef(ref, bookNames);
    const target = parsePeekRef(ref, label);
    const handlers = crossRefBranchHandlers(`bref:v1/${ref}`, target, onNavigate, onOpenPassageTab);
    return {
      key: ref,
      label,
      onOpen: handlers.onClick,
      onAuxOpen: handlers.onAuxClick,
      openLabel: `View ${label} in this research tab`,
    };
  });

  // 6 · related — two or three names, then the rest under More.
  const principalRelations: MarginEntryRelation[] = (person?.relationships ?? [])
    .slice(0, 3)
    .map((relationship) => {
      const target: EntityResearchTarget = {
        id: relationship.targetId,
        displayName: relationship.displayName,
        kind: "person",
      };
      return {
        key: `principal-${relationship.kind}-${relationship.targetId}`,
        name: relationship.displayName,
        proposed: relationship.uncertain,
        onFollow: () => { void onDrillEntity?.(target); },
        onBranch: onBranchEntity ? () => { void onBranchEntity(target); } : undefined,
        followLabel: `View ${relationship.displayName} in this research tab${relationship.uncertain ? ", proposed identification" : ""}`,
        branchLabel: `Open ${relationship.displayName} in a new research tab${relationship.uncertain ? ", proposed identification" : ""}`,
      };
    });

  /* @quire guessed · provenance · the image caption is a third party's sentence
     too — OpenBible curated it from the file's own description — but it is left
     off the ink. A caption names its source three lines below itself, in the
     credit and the license, and a laurel spine beside a photograph reads as a
     mark on the picture rather than on the words. The judgement is that a
     figcaption is its own kin, not a margin entry, and that its credit already
     does what a siglum does. If that is wrong, the fix is a laurel block around
     `.entity-photo-caption` and nothing else changes. */
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
    <article className={`entity-research-view margin-entry is-${data.entity.kind}`}>
      <header className="entity-research-identity">
        {/* 1 · name line — a dictionary head, not a page title */}
        <div className="entity-research-title-row">
          <MarginEntryNameLine name={data.entity.displayName} />
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
        {/* 2 · kind & situation — one line, and the difference between the
            four kinds lives here rather than in four layouts */}
        <MarginEntryKindLine parts={kindLineParts} />
        {/* 3 · why it is here. TIPNR wrote this sentence, not the edition, so
            it is laurel with a siglum — ruling 4·5. If the index cannot name
            its corpus the whole block disappears and the entry runs on to its
            facts, because unattributable licensed prose may not be shown. */}
        <MarginEntryWhy
          provenance="licensed"
          licensed={data.licensed?.entity}
          onOpenSource={openMediaLink}
        >
          <p className="margin-entry-why-text">{data.entity.brief}</p>
        </MarginEntryWhy>
        {/* 4 · facts — the bearing is the map's replacement at this width */}
        <MarginEntryFacts facts={entryFacts} />
      </header>

      <EntityOpeningContextSection
        data={data}
        origin={origin}
        currentBook={currentBook}
        currentChapter={currentChapter}
        chapterVerseText={chapterVerseText}
        bookNames={bookNames}
        onNavigate={onNavigate}
        onOpenPassageTab={onOpenPassageTab}
      />

      {/* 5 · appears in — three, then a count. The current passage is never
          listed back at the reader; the full list lives under More. */}
      <MarginEntryAppearsIn
        items={principalAppearances}
        remaining={Math.max(0, elsewhereRefs.length - principalAppearances.length)}
        emptyNote={elsewhereRefs.length === 0 ? "No other mention" : undefined}
        onMore={orderedRefs.length > 12 ? () => setShowAllRefs(true) : undefined}
        moreLabel={`${Math.max(0, elsewhereRefs.length - principalAppearances.length).toLocaleString()} more`}
      />

      {/* 6 · related */}
      <MarginEntryRelated relations={principalRelations} />

      <details className="entity-research-more" key={data.entity.id}>
        <summary>More</summary>
        <div className="entity-research-more-content">
          {photo}
          {/* The expanded sentence is the same corpus's prose as the brief, so
              it carries the same ink. It was set unmarked, which said "the
              edition wrote this" about a sentence TIPNR wrote. */}
          {data.entity.short && data.entity.short !== data.entity.brief && (
            <LaurelProse licensed={data.licensed?.entity} onOpenSource={openMediaLink}>
              {/* Keeps its own inherited face. The laurel block adds a mark and
                  a kicker; it is not licence to restyle the sentence. */}
              <p className="entity-research-expanded">{data.entity.short}</p>
            </LaurelProse>
          )}
          <PersonRelationships
            data={data}
            onDrillEntity={onDrillEntity}
            onBranchEntity={onBranchEntity}
          />
          {place && (
            <section className="entity-research-section entity-location-details" aria-labelledby="entity-location-details-title">
              <div className="entity-research-section-head">
                <h3 id="entity-location-details-title">Location detail</h3>
                <span>{place.alternatives.length > 0 ? `${place.alternatives.length + 1} proposals` : "Source comparison"}</span>
              </div>
              {/* The coordinates the bearing was computed from. They belong
                  here rather than on the entry: a reader checking a bearing is
                  already past the glance. */}
              <MarginEntryFacts facts={[
                { label: "Coordinates", value: coordinatesLabel(place.primary.latitude, place.primary.longitude) },
                { label: "Precision", value: place.primary.precision ?? place.primary.type },
                { label: "Confidence", value: confidenceLabel(place.primary.confidence) },
              ]} />
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

      {data.pleiades && (
        <PleiadesResearchSection
          data={data.pleiades}
          licensed={data.licensed?.pleiades}
          openResearchLink={openMediaLink}
        />
      )}

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
                {group.refs.map((ref) => {
                  const label = formatResearchRef(ref, bookNames);
                  const target = parsePeekRef(ref, label);
                  return (
                    <span className="entity-reference-actions" key={ref}>
                      <button
                        type="button"
                        {...crossRefBranchHandlers(`bref:v1/${ref}`, target, onNavigate, onOpenPassageTab)}
                        aria-label={`View ${label} in this research tab`}
                        title="Follow in this Research tab"
                        {...(target ? peekTriggerProps(target) : {})}
                      >
                        <span>{label}</span>
                        <CrossReferenceArrow />
                      </button>
                      {target && onOpenPassageTab && (
                        <button
                          type="button"
                          className="entity-reference-open-tab"
                          onClick={() => void onOpenPassageTab(target)}
                          aria-label={`Open ${label} as a passage tab`}
                          title="Open as passage tab"
                        >
                          Passage tab
                        </button>
                      )}
                    </span>
                  );
                })}
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

/* `CrossReferenceRow`, `CrossRefsBlock` and `NoteCrossRefsBlock` stood here.

   They were the Connections tab's contents before Quire C·4: the edition's
   OpenBible list under the heading "Related verses", and the app's
   note-derived suggestions under "From notes". Both left that tab with the
   finding — "cross-references are the edition's", and putting them under the
   word Connections made third-party data wear the reader's own hand.

   They are deleted rather than kept for Overview to adopt, because Overview
   re-implemented both rather than re-parenting them, and was right to: the
   heading was mono, which C4·6 strikes, and `.crossref-row` was one of the
   five reference-row treatments C4·2 collapses into two. The live drawings are
   IntentOverview's `Cross-references` section (the edition's, with its count,
   its `All n`, and OpenBible named in Sources) and its `Your library` entries
   in slate (the app's). Restoring either of these functions would ship a
   retired drawing back into a corrected surface. */

/* ---------------------------------------------------------------------------
   Connections · yours  (Quire C·4 §3, §4 · Rev 04 §5)

   The tab shows connections: typed, seal-marked, with their member phrases and
   a live tie to the thread already drawn in the gutter. Nothing the edition
   wrote appears here, and no count in this file may be assembled from a
   cross-reference list again.
--------------------------------------------------------------------------- */

/** How many members a block shows before it says `n more`. */
export const CONNECTION_MEMBERS_SHOWN = 3;

/**
 * @quire guessed · Rev 04 §5 gives the language "two weights" and C·4 §4 asks
 * the thread to thicken under a panel row's pointer, which is a third. 1px over
 * the committed selected stroke is the smallest step that reads at this scale.
 * The route's centre datum is fixed, so the growth is symmetric about it and no
 * geometry moves — the same reserve the panel's inset outline keeps.
 */
const CONNECTION_THREAD_HOVER_STROKE = CONNECTION_ROUTE_SELECTED_STROKE + 1;

/**
 * "Type is a word, never a colour." Every connection is seal; the ink that
 * varies inside a block is only ink vs ink-2, and it varies for exactly the
 * three reasons C·4 §4 gives.
 */
type ConnectionMemberInk = "ink" | "ink-2";

/** The role a member plays in its own type, where the type has roles at all. */
type ConnectionMemberRole = "source" | "pivot" | "span" | "member";

export interface ConnectionMemberView {
  key: string;
  /** Verse position, hanging left, so a same-verse pair reads as one. */
  position: string;
  /**
   * The member's own wording. Empty when this translation has no projection
   * for the phrase: "a connection with no thread drawn is still listed, with
   * its position markers only."
   */
  quote: string;
  ink: ConnectionMemberInk;
  role: ConnectionMemberRole;
}

function connectionMemberPosition(anchor: ConnectionAnchor, currentBook: string): string {
  const verses = anchor.verse_start === anchor.verse_end
    ? `${anchor.verse_start}`
    : `${anchor.verse_start}–${anchor.verse_end}`;
  return `${anchor.book === currentBook ? "" : `${anchor.book} `}${anchor.chapter}:${verses}`;
}

function connectionMemberQuote(
  anchor: ConnectionAnchor,
  packageId: string,
  paintAnchor: ConnectionPaintAnchor | undefined,
): string {
  const projected = paintAnchor?.fragments.map((fragment) => fragment.quote).join(" ").trim();
  if (projected) return projected;
  const locator = anchor.render_locator;
  return locator?.package === packageId ? locator.quote.trim() : "";
}

/**
 * The six kinds' ordering and ink rules, which are the substance of C·4 §4 and
 * the only per-type behaviour a connection has:
 *
 *   Parallelism — "Members are peers — no first, no last, and the panel lists
 *     them in text order."
 *   Echo — "The only type with a direction. The earliest member is the source
 *     and sits first regardless of which one you selected."
 *   Series — text order; the one type that regularly exceeds four members, so
 *     it is the one that reaches `n more`.
 *   Contrast — "Both members carry equal weight; neither is quoted in ink-2."
 *   Mirror — "Order is the content. The panel must never re-sort a mirror's
 *     members" — so this is the one type read straight off the authored array.
 *   Hinge — "a hinge has a pivot and a span. The pivot is the member set in
 *     ink; the span is set in ink-2, whichever comes first in the text." Ink
 *     follows the role, position follows the text.
 *
 * @quire guessed · nothing in the durable record names a hinge's pivot, so the
 * first authored member is read as the pivot: it is the phrase the reader began
 * the hinge from. The list still runs in text order, which is what "whichever
 * comes first in the text" protects.
 *
 * @quire guessed · the default ink — first listed member in ink, the rest in
 * ink-2 — is read off C·4 §3's drawn Echo and Series blocks. Contrast is called
 * out as the type where "neither is quoted in ink-2", which only distinguishes
 * it if the default is not already that; so Parallelism's "peers, no first, no
 * last" is read as a statement about order, not about ink, and it keeps the
 * default. If peers were meant to reach ink too, this is the line to change.
 */
export function connectionMemberViews(
  connection: ConnectionRecord,
  paintAnchors: readonly ConnectionPaintAnchor[],
  currentBook: string,
  packageId: string,
): ConnectionMemberView[] {
  // The two durable anchor shapes are a union, so read them through the shared
  // arm: this function needs only position, and identity for the paint lookup.
  const authored: readonly ConnectionAnchor[] = connection.anchors;
  // Mirror is the one type that is never re-sorted; every other type is listed
  // in text order, which is what canonical anchor order already is.
  const ordered: readonly ConnectionAnchor[] = connection.kind === "mirror"
    ? [...authored]
    : canonicalConnectionAnchors(connection);
  return ordered.map((anchor, index) => {
    const authoredIndex = authored.indexOf(anchor);
    const paintAnchor = authoredIndex >= 0 ? paintAnchors[authoredIndex] : undefined;
    const isPivot = authoredIndex === 0;
    const ink: ConnectionMemberInk = connection.kind === "link:contrast"
      ? "ink"
      : connection.kind === "hinge"
        ? (isPivot ? "ink" : "ink-2")
        : (index === 0 ? "ink" : "ink-2");
    const role: ConnectionMemberRole = connection.kind === "hinge"
      ? (isPivot ? "pivot" : "span")
      : connection.kind === "link:echo" && index === 0
        ? "source"
        : "member";
    return {
      key: `${anchor.book}:${anchor.chapter}:${anchor.verse_start}:${anchor.verse_end}:${authoredIndex}:${index}`,
      position: connectionMemberPosition(anchor, currentBook),
      quote: connectionMemberQuote(anchor, packageId, paintAnchor),
      ink,
      role,
    };
  });
}

function ConnectionBlock({
  connection,
  members,
  selected,
  threadHovered,
  onSelectAuthoredConnection,
  onHoverChange,
}: {
  connection: ConnectionRecord;
  members: readonly ConnectionMemberView[];
  selected: boolean;
  threadHovered: boolean;
  onSelectAuthoredConnection?: (connection: ConnectionRecord, focusInspector?: boolean) => void;
  onHoverChange: (connectionId: string | null) => void;
}): React.JSX.Element {
  const kindLabel = RELATIONSHIP_LABELS[connection.kind];
  const shown = members.slice(0, CONNECTION_MEMBERS_SHOWN);
  const overflow = members.length - shown.length;
  // C·4 §3 draws `2 members` / `4 members` beside the type. The shared
  // vocabulary helper counts a connection's parts as *phrases*, which is the
  // word the inspector card and the canvas use; this panel is drawn with the
  // other one. One binding either way, read by both the visible text and the
  // accessible name, so the two can never come to disagree — the name replaces
  // the children, so a different noun there silently overwrites this one.
  const arity = `${members.length} ${members.length === 1 ? "member" : "members"}`;
  // The role is carried by ink and by nothing else: Echo's source, a hinge's
  // pivot against its span. Law 6 asks 3:1 of a mark that carries meaning
  // without words, but a screen reader gets no ratio at all — so the name says
  // the word the ink is standing in for, and says it only where there is a
  // role to name.
  const memberName = (member: ConnectionMemberView): string => {
    const role = member.role === "member" ? "" : `${member.role}, `;
    return member.quote
      ? `${role}${member.position}. ${member.quote}`
      : `${role}${member.position}`;
  };
  // "A connection with no thread drawn is still listed, with its position
  // markers only — the gutter has finite room, the panel does not, and an
  // unrouted connection is not a missing one."
  const drawn = members.some((member) => member.quote.length > 0);
  return (
    <button
      type="button"
      className="margin-connection-row"
      data-connection-id={connection.id}
      data-connection-kind={connection.kind}
      /* Mirror's order is its content, so the panel states which order it drew. */
      data-member-order={connection.kind === "mirror" ? "authored" : "text"}
      data-thread={drawn ? "drawn" : "undrawn"}
      data-thread-hover={threadHovered ? "" : undefined}
      aria-current={selected || undefined}
      /* The block is one button, so its name REPLACES its contents for a screen
         reader — everything the children would have said has to be in here or
         it is not said at all. That is the type, the arity in the same words the
         row shows, and every member's position and wording, including the ones
         `n more` hides: the cap is a space constraint, and a name has no space
         constraint. Provenance is the one thing deliberately absent, and it is
         absent because it does not vary here — every connection is authored, so
         every connection is seal (Rev 04 §8) — and the region's own name says it
         once for the whole list. A list whose provenance varies has to mark each
         row; this one would only repeat itself. */
      aria-label={`${kindLabel}, ${arity}: ${members.map(memberName).join(", ")}`}
      /* All three ways of attending are one behaviour, and the shared one
         scrolls the reading canvas the least distance that brings every member
         into view. The panel itself never scrolls: the reader's place is never
         taken by a list. The row hands focus to the inspector, which is the
         persistent entry point it is about to be replaced by. */
      onClick={() => onSelectAuthoredConnection?.(connection, true)}
      onPointerEnter={() => onHoverChange(connection.id)}
      onPointerLeave={() => onHoverChange(null)}
      onFocus={() => onHoverChange(connection.id)}
      onBlur={() => onHoverChange(null)}
    >
      <span className="margin-connection-row-head">
        {/* The type is the heading, in seal, because you wrote it. */}
        <span className="margin-connection-type">{kindLabel}</span>
        <span className="margin-connection-arity">{arity}</span>
      </span>
      {shown.map((member) => (
        <span
          key={member.key}
          /* The shared quoted reference row (§C4·2): full text, ink rather than
             ink-2, and no trailing verb at all — quoted rows are read, not
             chosen from. The panel arranges it one way of its own: the verse
             position hangs left instead of sitting on its own line, "so a
             same-verse pair reads as one". */
          className="study-ref-row study-ref-row--quoted margin-connection-member"
          data-member-ink={member.ink}
          data-member-role={member.role}
        >
          <span className="study-ref-row-head margin-connection-position">
            <span className="study-ref-row-ref">{member.position}</span>
          </span>
          <span className={`study-ref-row-text margin-connection-quote${member.quote ? "" : " is-unprojected"}`}>
            {member.quote || "Not in this translation"}
          </span>
        </span>
      ))}
      {overflow > 0 && (
        <span className="margin-connection-more">{overflow} more</span>
      )}
    </button>
  );
}

function ConnectionsPanel({
  connections,
  elsewhere,
  paintProjections,
  book,
  packageId,
  selectedConnectionId,
  onSelectAuthoredConnection,
}: {
  connections: readonly ConnectionRecord[];
  elsewhere: readonly ConnectionRecord[];
  paintProjections: ReadonlyMap<string, ConnectionPaintProjection> | undefined;
  book: string;
  packageId: string;
  selectedConnectionId: string | null | undefined;
  onSelectAuthoredConnection?: (connection: ConnectionRecord, focusInspector?: boolean) => void;
}): React.JSX.Element {
  const [rowHoverId, setRowHoverId] = useState<string | null>(null);
  const [threadHoverId, setThreadHoverId] = useState<string | null>(null);

  /**
   * "Hover a thread, its row takes the same inset seal outline." The canvas
   * marks every connection it draws with `data-connection-id`, and its gutter
   * ticks with `data-connection-tick`, so the panel reads the pointer off those
   * without the thread layer having to know a panel exists.
   */
  useEffect(() => {
    const connectionIdAt = (target: EventTarget | null): string | null => {
      if (!(target instanceof Element)) return null;
      const marked = target.closest("[data-connection-id], [data-connection-tick]");
      if (!marked) return null;
      // A panel row carries the same attribute; its own :hover already answers.
      if (marked.closest(".margin-connection-row")) return null;
      return marked.getAttribute("data-connection-id")
        || marked.getAttribute("data-connection-tick")
        || null;
    };
    const handleOver = (event: PointerEvent): void => {
      setThreadHoverId(connectionIdAt(event.target));
    };
    const handleOut = (event: PointerEvent): void => {
      if (connectionIdAt(event.target) == null) return;
      setThreadHoverId(null);
    };
    document.addEventListener("pointerover", handleOver, true);
    document.addEventListener("pointerout", handleOut, true);
    return () => {
      document.removeEventListener("pointerover", handleOver, true);
      document.removeEventListener("pointerout", handleOut, true);
    };
  }, []);

  /**
   * "Hover a row, its thread thickens." The route reads its width from a custom
   * property the canvas already publishes, so the tie is one value set on the
   * hovered connection's own group and removed again — never a rule of this
   * sheet's, never a coordinate, and never anything the route engine owns.
   * Stroke width grows about the fixed centre datum, so nothing moves.
   */
  useEffect(() => {
    if (!rowHoverId) return;
    const marks = [...document.querySelectorAll<SVGElement | HTMLElement>(
      `[data-connection-overlay] [data-connection-id="${CSS.escape(rowHoverId)}"]`,
    )];
    for (const mark of marks) {
      mark.style.setProperty("--connection-route-selected-width", `${CONNECTION_THREAD_HOVER_STROKE}px`);
    }
    return () => {
      for (const mark of marks) mark.style.removeProperty("--connection-route-selected-width");
    };
  }, [rowHoverId]);

  const renderBlock = (connection: ConnectionRecord): React.JSX.Element => (
    <ConnectionBlock
      key={connection.id}
      connection={connection}
      members={connectionMemberViews(
        connection,
        paintProjections?.get(connection.id)?.anchors ?? [],
        book,
        packageId,
      )}
      selected={selectedConnectionId === connection.id}
      threadHovered={threadHoverId === connection.id}
      onSelectAuthoredConnection={onSelectAuthoredConnection}
      onHoverChange={setRowHoverId}
    />
  );

  return (
    <section className="margin-connections" aria-label="Your connections">
      <div className="margin-connection-head">
        <h3>In this passage</h3>
        <span className="margin-connection-count">
          <span className="margin-connection-seal" aria-hidden="true" />
          <span>{connections.length} · yours</span>
        </span>
      </div>

      {connections.length > 0 ? (
        <div className="margin-connection-list">
          {connections.map(renderBlock)}
        </div>
      ) : (
        // "Empty is never blank. One sentence naming what is absent, then the
        // nearest true thing — … connections in the chapter."
        <p className="margin-connection-absent">You have not connected any phrases here.</p>
      )}

      {connections.length === 0 && elsewhere.length > 0 && (
        <div className="margin-connection-elsewhere">
          <div className="margin-connection-head">
            <h3>Elsewhere in this chapter</h3>
            <span className="margin-connection-count">
              <span className="margin-connection-seal" aria-hidden="true" />
              <span>{elsewhere.length}</span>
            </span>
          </div>
          <div className="margin-connection-list">
            {elsewhere.slice(0, 2).map(renderBlock)}
          </div>
        </div>
      )}

      {/* Verbs are words in a footer: no bordered buttons, no circular chips.

          @quire guessed · `Connect a phrase` is drawn and inert. C·4 §6 asks
          the question itself — "Where does a connection get made? I have drawn
          Connect a phrase in the footer and nothing behind it… Say the word" —
          so the authoring surface is undrawn by the designer's own account,
          not overlooked here. Rendering it as a control would mean inventing
          that surface (select two phrases, choose a type, enforce the arity)
          behind a word in a footer, and a verb that opens nothing is a control
          that lies. It stays a statement until the word comes back. */}
      <div className="margin-connection-footer">
        <span className="margin-connection-verb">Connect a phrase</span>
        <span className="margin-connection-state">Threads shown</span>
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------------------
   Quire C·4 — the study panel's section head
   ---------------------------------------------------------------------------
   One grammar for every section on this surface: the label, and a count that
   states WHOSE the count is. Seal when the reader wrote them, unmarked ink
   when they are the edition's — Law 3 in the one place a whole section can
   carry it, which is why the word travels with the number ("8 · edition",
   "3 · yours") rather than being left to the reader to infer from context.

   The count is deliberately NOT ink-faint. The quire sets #B4AEA5 here, which
   is the pre-Rev-03 `--text-tertiary` the handoff §4 lists as a shipped defect
   at 3.22:1; Law 6 has no large-text exemption and no small-text one either,
   and a number the reader acts on carries meaning. `--text-tertiary` is that
   same role at 4.60:1.
   ------------------------------------------------------------------------ */
function StudySectionHead({
  titleId,
  title,
  count,
  countValue,
  countIsYours = false,
}: {
  titleId?: string;
  title: React.ReactNode;
  /** Already-composed, e.g. "8 · edition", "21 here", "4". */
  count?: string | null;
  /** The number inside `count`. Required wherever `countIsYours` is set. */
  countValue?: number;
  /** Seal: the reader wrote the things being counted. */
  countIsYours?: boolean;
}): React.JSX.Element {
  // A ZERO IS NEVER SEAL. Seal is a mark of authorship, and a count of nothing
  // of yours is not authorship — §C4·1 draws the same Notes tab as `Notes 0`
  // faint at verse scope and `Notes 4` seal at chapter scope, so that "a reader
  // can see at a glance that they have three connections and no notes here".
  // This is c4-foundation's `provenance === "reader" && value > 0` for the tab
  // row, held here so the section heads and the tabs cannot drift apart. Every
  // call site currently renders inside a `length > 0` guard; the rule lives in
  // one place so the first one that does not stays correct.
  const yours = countIsYours && (countValue ?? 0) > 0;
  return (
    <div className="intent-section-head">
      <h3 id={titleId}>{title}</h3>
      {count != null && count !== "" && (
        <span className={`intent-section-count${yours ? " is-yours" : ""}`}>{count}</span>
      )}
    </div>
  );
}

/** §C4·5's people-and-places kind word. One word, never an icon or a chip. */
function entityKindLabel(kind: LanguageNameEntity["kind"]): string {
  if (kind === "person") return "Person";
  if (kind === "place") return "Place";
  return "Deity or object";
}

function IntentOverview({
  crossRefs,
  directNote,
  semantic,
  entityResult,
  loading,
  onNavigate,
  onOpenPassageTab,
  peekTriggerProps,
  onOpenTab,
  onOpenEntity,
}: {
  crossRefs: CrossReferenceResultData | null;
  directNote: NoteRecord | null;
  semantic: SemanticMarginResult | null | undefined;
  entityResult: LanguageEntityRangeResult;
  loading: boolean;
  onNavigate?: (ref: string) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
  peekTriggerProps: (target: PeekTarget) => VersePeekTriggerProps;
  onOpenTab: (tab: MarginTab) => void;
  onOpenEntity?: (target: EntityResearchTarget) => void;
}): React.JSX.Element {
  const [showAllCrossRefs, setShowAllCrossRefs] = useState(false);
  const [showAllEntities, setShowAllEntities] = useState(false);
  /** Per-instance, so two margins on screen cannot mint the same description
   *  id and cross-wire one row's verse onto another row's verb. */
  const rowIdBase = useId();
  const crossRefItems = crossRefs?.items ?? [];
  const crossRefTotal = crossRefs?.totalCount ?? crossRefItems.length;
  // §C4·5: "Same three rows and an All 64. A section never changes its shape
  // because the scope changed size." Three rows at every scope; only the
  // numbers grow.
  const crossRefRows = showAllCrossRefs ? crossRefItems : crossRefItems.slice(0, 3);
  const relatedNote = semantic?.semanticNotes[0] ?? null;
  const thread = semantic?.threads[0] ?? null;
  const claim = semantic?.claims.find((item) => item.status === "active") ?? null;
  const suggested = semantic?.suggestedCrossRefs.slice(0, 6) ?? [];
  // §C4·5: "Text order, always — the order the reader met them in. Ranking by
  // frequency would put Paul first in every chapter of Acts and teach the
  // reader nothing." Nothing sorts here, and the host's `entitiesForRange`
  // walks the range verse by verse for exactly this reason. `refCount` is
  // drawn but never ordered on.
  const entities = showAllEntities ? entityResult.entities : entityResult.entities.slice(0, 4);
  const hasLibraryLead = directNote != null || relatedNote != null || thread != null || claim != null
    || suggested.length > 0;
  const hasContent = crossRefItems.length > 0 || hasLibraryLead || entities.length > 0;
  // The store ranks and caps; the scope's true size lives in `totalCount`. An
  // "All 64" that reveals twelve rows would be a promise the panel cannot keep,
  // so the label states both numbers when they differ.
  // @quire guessed · "All 12 of 64" where the drawing has "All 64" · the
  // cross-reference store returns at most 12 ranked items per scope
  const allCrossRefsLabel = crossRefItems.length >= crossRefTotal
    ? `All ${crossRefTotal.toLocaleString()}`
    : `All ${crossRefItems.length.toLocaleString()} of ${crossRefTotal.toLocaleString()}`;
  // Sources: the research pane's own rows, verbatim, so a reader who learned
  // the block on one surface has learned it on this one. §C4·5.
  const sources: MarginCitationSource[] = [
    ...(crossRefItems.length > 0 && crossRefs ? [{
      name: crossRefs.attribution.name,
      license: crossRefs.attribution.license,
      detail: "Cross-references",
      citation: `${crossRefs.attribution.attribution} · ${crossRefs.attribution.license} · ${crossRefs.attribution.sourceUrl}`,
    }] : []),
    ...(entities.length > 0 ? [{
      name: entityResult.attribution.name,
      license: entityResult.attribution.license,
      detail: "Identity",
    }] : []),
  ];

  return (
    <div className="intent-overview" aria-label="Most relevant study leads">
      {crossRefItems.length > 0 && (
        /* Not "Scripture", and not under the word Connections. A connection is
           a thing the reader made; these are the edition's, and the head says
           so. Putting them under Connections made third-party data wear the
           reader's own hand — the same class of error as unmarked licensed
           prose. §C4·6. */
        <section className="intent-section" aria-labelledby="intent-crossrefs-title">
          <StudySectionHead
            titleId="intent-crossrefs-title"
            title="Cross-references"
            count={`${crossRefTotal.toLocaleString()} · edition`}
          />
          {/* C4·2's compact row. `.study-ref-row*` is c4-foundation's: the
              clamp, the fade, the reserved verb slot and the hover reveal all
              live in its rules, and none of them are restated here. */}
          <div className="study-ref-row-list">
            {crossRefRows.map((item, index) => {
              const target = parsePeekRef(item.targetBref, item.targetDisplay);
              // The wording is the row's, not the verb's. A reader moving by
              // button hears "Open Acts 11:15–17" and then the verse as the
              // control's description; a reader moving through the row hears
              // the verse once, as text. Folding the preview into the name
              // instead would say it twice to anyone reading linearly, and
              // would put an unbounded, fade-cut fragment inside a button's
              // name — the retired one-button row had no way to do better.
              const previewId = item.preview ? `${rowIdBase}-xref-${index}` : undefined;
              return (
                <div className="study-ref-row study-ref-row--compact" key={item.targetBref}>
                  <div className="study-ref-row-head">
                    <span className="study-ref-row-ref">{item.targetDisplay}</span>
                    <span className="study-ref-row-verbs">
                      <button
                        type="button"
                        className="study-ref-row-verb"
                        {...crossRefBranchHandlers(item.targetBref, target, onNavigate, onOpenPassageTab)}
                        {...(target ? peekTriggerProps(target) : {})}
                        // Both spreads first, so the row's own name and
                        // description are authoritative. `VersePeekTriggerProps`
                        // carries no ARIA but `aria-haspopup`/`aria-expanded`
                        // today; if it ever grows a describedby, a spread that
                        // came last would clobber the tie to the verse silently.
                        aria-label={`Open ${item.targetDisplay}`}
                        aria-describedby={previewId}
                      >
                        Open
                      </button>
                      {target && onOpenPassageTab && (
                        <button
                          type="button"
                          className="study-ref-row-verb is-secondary"
                          onClick={() => void onOpenPassageTab(target)}
                          aria-label={`Open ${item.targetDisplay} in a new passage tab`}
                          aria-describedby={previewId}
                        >
                          Tab
                        </button>
                      )}
                    </span>
                  </div>
                  {item.preview && (
                    <p className="study-ref-row-text" id={previewId}>{item.preview}</p>
                  )}
                </div>
              );
            })}
          </div>
          {crossRefItems.length > 3 && (
            <button
              type="button"
              className="intent-more-toggle"
              aria-expanded={showAllCrossRefs}
              onClick={() => setShowAllCrossRefs((current) => !current)}
            >
              {showAllCrossRefs ? "Fewer cross-references" : allCrossRefsLabel}
            </button>
          )}
        </section>
      )}

      {entities.length > 0 && (
        <section className="intent-section" aria-labelledby="intent-entities-title">
          <StudySectionHead
            titleId="intent-entities-title"
            title={<>People &amp; places</>}
            count={`${entityResult.entities.length.toLocaleString()} here`}
          />
          {/* 16px serif in a fixed column, the kind on one side and the count
              on the other: four fit in 130px instead of 400, and the column
              edge does the aligning that size was doing badly. The C·2 entry
              skeleton stays where its lower parts earn their space — the
              research pane and the words panel. Here the brief is what the
              28px name was spending: gone with it.
              @quire derived · kin: margin entry · a list of four names is a
              column, not four entries; TIPNR is named in Sources, which is
              where the research pane names it too. */}
          <ul className="intent-entity-list">
            {entities.map((entity) => (
              <li className="intent-entity-row" key={entity.id}>
                <button
                  type="button"
                  className="intent-entity-name"
                  onClick={() => onOpenEntity?.(entityResearchTarget(entity))}
                  aria-label={`Open research tab for ${entity.displayName}`}
                >
                  {entity.displayName}
                </button>
                <span className="intent-entity-kind">{entityKindLabel(entity.kind)}</span>
                <span className="intent-entity-count">{entity.refCount.toLocaleString()}</span>
              </li>
            ))}
          </ul>
          {entityResult.entities.length > 4 && (
            <button
              type="button"
              className="intent-more-toggle"
              aria-expanded={showAllEntities}
              onClick={() => setShowAllEntities((current) => !current)}
            >
              {showAllEntities
                ? "Fewer people & places"
                : `All ${entityResult.entities.length.toLocaleString()}`}
            </button>
          )}
        </section>
      )}

      {hasLibraryLead && (
        /* @quire guessed · Your library sits after People & places · the
           overview is drawn with two sections and a foot, and this one is not
           in the drawing. It is kept because nothing rules against it and it
           carries threads and claims that live nowhere else, and it is placed
           last so the drawn adjacency (cross-references above people) and the
           drawn foot (Sources) both survive. */
        <section className="intent-section" aria-labelledby="intent-library-title">
          <StudySectionHead titleId="intent-library-title" title="Your library" />
          {/* Provenance, persistently: a 2px seal spine and a date on your own
              writing, a 4px slate dot on the app's. The mono kickers that used
              to label these ("Anchored note", "Theme in your notes") told the
              reader what the mark now tells them, in the margin's own voice. */}
          <div className="intent-library-leads">
            {directNote && (
              <button type="button" className="intent-note-lead" onClick={() => onOpenTab("notes")}>
                <MarginEntryWhy provenance="reader" writtenOn={formatEntryDate(directNote.modified)}>
                  <strong>{directNote.title || "Untitled"}</strong>
                  <span>{directNote.body_text}</span>
                </MarginEntryWhy>
              </button>
            )}
            {!directNote && relatedNote && (
              <button type="button" className="intent-note-lead" onClick={() => onOpenTab("notes")}>
                <MarginEntryWhy provenance="reader">
                  <strong>{relatedNote.title || "Untitled"}</strong>
                  <span>{relatedNote.snippet}</span>
                </MarginEntryWhy>
              </button>
            )}
            {thread && (
              <button type="button" className="intent-note-lead is-secondary" onClick={() => onOpenTab("notes")}>
                <MarginEntryWhy provenance="app">
                  <strong>{thread.label}</strong>
                  <span>{thread.summary}</span>
                </MarginEntryWhy>
              </button>
            )}
            {!thread && claim && (
              <button type="button" className="intent-note-lead is-secondary" onClick={() => onOpenTab("notes")}>
                <MarginEntryWhy provenance="app">
                  <strong>{claim.assertion}</strong>
                </MarginEntryWhy>
              </button>
            )}
            {/* Re-homed from the Connections tab, which c4-connections emptied
                of cross-references of every provenance. These are the app's,
                inferred from the reader's own notes, so they are slate and
                they carry a sentence — which is exactly what a connection may
                not do, and exactly why they were never connections.

                @quire derived · kin: margin entry · the app's inferences about
                the reader's library already have a treatment in this section,
                and this is that treatment rather than a second drawing of the
                reference row (C4·2) under a second heading using the word
                Connections (C4·6). */}
            {suggested.map((item) => {
              const target = parsePeekRef(item.targetBref, item.targetDisplay);
              return (
                <button
                  key={item.targetBref}
                  type="button"
                  className="intent-note-lead is-secondary"
                  {...crossRefBranchHandlers(item.targetBref, target, onNavigate, onOpenPassageTab)}
                  {...(target ? peekTriggerProps(target) : {})}
                  // Spreads first — see the cross-reference row. This row IS one
                  // control, so its name has to carry everything its content
                  // would have said: an aria-label overrides the button's
                  // children, which includes `MarginEntryWhy`'s own sr-only
                  // provenance. A bare "Open {ref}" here dropped both the
                  // sentence and the fact that the app wrote it — Law 3 in the
                  // accessibility tree, where unmarked means the edition.
                  // Action and target first, then the mark before the prose it
                  // marks, so it can be skipped the way the visual mark can.
                  aria-label={`Open ${item.targetDisplay}. Written by the app. ${item.reason}`}
                >
                  <MarginEntryWhy provenance="app">
                    <strong>{item.targetDisplay}</strong>
                    <span>{item.reason}</span>
                  </MarginEntryWhy>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Law 7's loading and empty, in the app's own shipped grammar: one
          loading device, the thing named, never a spinner and never an
          illustration. */}
      {loading && (
        <SurfaceState state="loading" thing="Reading your library" locality="local" />
      )}

      {!hasContent && !loading && (
        <SurfaceState
          state="empty"
          thing="Nothing indexed here"
          reason="The edition lists no cross-references, and no people or places are named."
        />
      )}
      {/* §C4·5: Sources stay last. Same block, same position, same marks as
          the research pane — one treatment, learned once. */}
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
  onOpenPassageTab,
  onKeepReference,
  onStudyVerse,
  onMarginActiveChange,
  ambientKept = false,
  onAmbientKeptChange,
  onClearSelection,
  sessionOwnerTabId,
  sessionRestoreNonce,
  marginSession,
  onMarginSessionChange,
  workspace,
  researchScrollTop = 0,
  onResearchScrollTopChange,
  onScrollControllerChange,
  entityResearchFocusRequest = null,
  onEntityResearchFocusRequestHandled,
  entityIntent,
  onOpenEntity,
  onOpenResourceSettings,
  onDrillEntity,
  onBranchEntity,
  onReturnEntityOrigin,
  onCloseEntity,
  entityTrail = [],
  onEntityTrailChange,
  connectionInspector,
  authoredConnections = [],
  connectionPaintProjections,
  selectedAuthoredConnectionId = null,
  onSelectAuthoredConnection,
  connectionInspectorFocusRequest = 0,
}: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [claimPinError, setClaimPinError] = useState<{ id: string; message: string } | null>(null);
  const activeTab = marginSession.activeTab;
  const setActiveTab = (tab: MarginTab): void => {
    onMarginSessionChange(sessionOwnerTabId, (current) => ({ ...current, activeTab: tab }));
  };
  const requestedWordsVerse = marginSession.wordsVerse ?? pinnedRange?.start ?? nearVerse ?? 1;
  const wordsVerse = pinnedRange
    ? Math.min(pinnedRange.end, Math.max(pinnedRange.start, requestedWordsVerse))
    : requestedWordsVerse;
  const setWordsState = (
    update: Pick<PassageViewState["margin"], "wordsVerse" | "wordsFollowingReading">,
  ): void => {
    onMarginSessionChange(sessionOwnerTabId, (current) => ({ ...current, ...update }));
  };
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
  const [deepNotesFailed, setDeepNotesFailed] = useState(false);
  /** Bumped by "Try again" — a failed state that cannot be retried is a
   *  message, not a state. */
  const [deepNotesAttempt, setDeepNotesAttempt] = useState(0);
  const [trustedResources, setTrustedResources] = useState<RankedTrustedResource[]>([]);
  /* Who has taught this chapter. Keyed on book and chapter rather than on the
     narrower bref the resource query uses: references are recorded against
     chapters, so asking per verse would return nothing for most verses and
     read to a reader as "nobody teaches this". */
  const [taughtHere, setTaughtHere] = useState<PassageMoment[]>([]);
  const [trustedResourceTotal, setTrustedResourceTotal] = useState(0);
  const [trustedResourcesHidden, setTrustedResourcesHidden] = useState(0);
  /* Bumped when the reader changes a filter, so the effect refetches: the
     answer lives in the main process, not in this component. */
  const [trustedResourceFilterVersion, setTrustedResourceFilterVersion] = useState(0);
  const [trustedResourceCatalogue, setTrustedResourceCatalogue] = useState<ResourceLibraryCatalogue | null>(null);

  /* Read once per filter change rather than per passage: what is installed does
     not depend on where the reader is. */
  useEffect(() => {
    let cancelled = false;
    safeCall(() => window.api.trustedResources.catalogue()).then((result) => {
      if (cancelled || !result.ok || !result.value.ok) return;
      setTrustedResourceCatalogue({ sources: result.value.sources, mutes: result.value.mutes });
    });
    return () => { cancelled = true; };
  }, [trustedResourceFilterVersion]);
  const [trustedResourcesLoading, setTrustedResourcesLoading] = useState(false);
  const [trustedResourcesRefusal, setTrustedResourcesRefusal] = useState<string | null>(null);
  const frameTitleRef = useRef<HTMLHeadingElement>(null);
  const researchTitleRef = useRef<HTMLHeadingElement>(null);
  const marginRef = useRef<HTMLElement>(null);
  const activeWorkspace: MarginWorkspace = workspace ?? (entityIntent ? "research" : "study");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isPinned = !!pinnedRange;
  const isNear = !isPinned && nearVerse != null;
  const connectionInspectorOpen = connectionInspector != null;
  const suppressRestoredScrollRef = useRef(false);
  const connectionInspectorOpenRef = useRef(false);
  connectionInspectorOpenRef.current = connectionInspector != null;
  const controlledScrollTop = activeWorkspace === "research"
    ? researchScrollTop
    : marginSession.scrollTopByTab[activeTab] ?? 0;
  const scrollScope: MarginScrollScope = activeWorkspace === "research"
    ? { kind: "research", entityId: entityIntent?.id ?? "unavailable" }
    : connectionInspectorOpen
      ? { kind: "connection", connectionId: selectedAuthoredConnectionId ?? "active" }
      : isPinned
        ? { kind: "selection", start: pinnedRange.start, end: pinnedRange.end }
        : isNear && ambientKept
          ? { kind: "kept", verse: nearVerse }
          : isNear
            ? { kind: "following", verse: nearVerse }
            : { kind: "chapter" };
  const scrollRestoreContext: MarginScrollRestoreContext = {
    ownerTabId: sessionOwnerTabId,
    sessionRestoreNonce,
    workspace: activeWorkspace,
    activeTab,
    book,
    chapter,
    scope: scrollScope,
  };
  const scrollRestoreKey = marginScrollRestoreKey(scrollRestoreContext);
  const controlledScrollTopRef = useRef(controlledScrollTop);
  controlledScrollTopRef.current = controlledScrollTop;
  const scrollPublicationContextRef = useRef(scrollRestoreContext);
  scrollPublicationContextRef.current = scrollRestoreContext;
  const lastRestoredScrollContextRef = useRef<MarginScrollRestoreContext | null>(null);
  const pendingScrollPublicationRef = useRef<{
    context: MarginScrollRestoreContext;
    top: number;
  } | null>(null);
  const scrollPublishTimerRef = useRef<number | null>(null);
  const restoredScrollFrameRef = useRef<number | null>(null);
  const onMarginSessionChangeRef = useRef(onMarginSessionChange);
  onMarginSessionChangeRef.current = onMarginSessionChange;
  const onResearchScrollTopChangeRef = useRef(onResearchScrollTopChange);
  onResearchScrollTopChangeRef.current = onResearchScrollTopChange;

  const clearScrollPublishTimer = (): void => {
    if (scrollPublishTimerRef.current == null) return;
    window.clearTimeout(scrollPublishTimerRef.current);
    scrollPublishTimerRef.current = null;
  };

  const publishScrollSample = (sample: {
    context: MarginScrollRestoreContext;
    top: number;
  }): void => {
    const current = scrollPublicationContextRef.current;
    // Owner/restore generation are the write authority. An old timer may keep
    // running after a workspace switch, but it may never touch the new tab or
    // overwrite a Back/Forward snapshot. A prior lens in the same generation
    // is allowed so its exact exit offset can be flushed before restoration.
    if (sample.context.ownerTabId !== current.ownerTabId
      || sample.context.sessionRestoreNonce !== current.sessionRestoreNonce
      || sample.context.workspace !== current.workspace) return;
    if (sample.context.workspace === "research") {
      onResearchScrollTopChangeRef.current?.(sample.context.ownerTabId, sample.top);
      return;
    }
    onMarginSessionChangeRef.current(sample.context.ownerTabId, (margin) => ({
      ...margin,
      scrollTopByTab: {
        ...margin.scrollTopByTab,
        [sample.context.activeTab]: sample.top,
      },
    }));
  };

  const flushWorkspaceScrollPublication = (captureCurrent = false): void => {
    clearScrollPublishTimer();
    let sample = pendingScrollPublicationRef.current;
    pendingScrollPublicationRef.current = null;
    const margin = marginRef.current;
    if (captureCurrent && margin && !connectionInspectorOpenRef.current) {
      sample = {
        context: scrollPublicationContextRef.current,
        top: margin.scrollTop,
      };
    }
    if (sample) publishScrollSample(sample);
  };
  const flushWorkspaceScrollPublicationRef = useRef(flushWorkspaceScrollPublication);
  flushWorkspaceScrollPublicationRef.current = flushWorkspaceScrollPublication;
  const scrollController = useMemo<LivingMarginScrollController>(() => ({
    ownerTabId: sessionOwnerTabId,
    flushPendingScroll: () => flushWorkspaceScrollPublicationRef.current(true),
  }), [sessionOwnerTabId]);

  useEffect(() => {
    onScrollControllerChange?.(sessionOwnerTabId, scrollController);
    return () => onScrollControllerChange?.(sessionOwnerTabId, null);
  }, [onScrollControllerChange, scrollController, sessionOwnerTabId]);

  const scheduleWorkspaceScrollPublication = (): void => {
    const margin = marginRef.current;
    if (!margin || suppressRestoredScrollRef.current || connectionInspectorOpenRef.current) return;
    pendingScrollPublicationRef.current = {
      context: scrollPublicationContextRef.current,
      top: margin.scrollTop,
    };
    clearScrollPublishTimer();
    scrollPublishTimerRef.current = window.setTimeout(() => {
      scrollPublishTimerRef.current = null;
      const sample = pendingScrollPublicationRef.current;
      pendingScrollPublicationRef.current = null;
      if (sample) publishScrollSample(sample);
    }, MARGIN_SCROLL_PUBLISH_DELAY_MS);
  };

  useLayoutEffect(() => {
    const margin = marginRef.current;
    if (!margin) return;
    const previous = lastRestoredScrollContextRef.current;
    const restoration = resolveMarginScrollRestoration(
      previous,
      scrollRestoreContext,
      controlledScrollTopRef.current,
    );

    // A lens/subject boundary owns the exact DOM offset that existed before
    // the controlled restore. Restore generations deliberately reject this
    // sample so delayed work cannot overwrite a history/owner snapshot.
    if (previous && previous.scope.kind !== "connection") {
      clearScrollPublishTimer();
      pendingScrollPublicationRef.current = null;
      publishScrollSample({ context: previous, top: margin.scrollTop });
    }
    lastRestoredScrollContextRef.current = scrollRestoreContext;
    if (!restoration) return;

    suppressRestoredScrollRef.current = true;
    margin.scrollTop = restoration.top;
    if (restoration.publish) {
      publishScrollSample({ context: scrollRestoreContext, top: restoration.top });
    }
    if (restoredScrollFrameRef.current != null) {
      window.cancelAnimationFrame(restoredScrollFrameRef.current);
    }
    restoredScrollFrameRef.current = window.requestAnimationFrame(() => {
      restoredScrollFrameRef.current = null;
      suppressRestoredScrollRef.current = false;
    });
  // scrollRestoreKey deliberately excludes controlledScrollTop. Native scroll
  // publications update that value without turning into programmatic writes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRestoreKey]);

  useEffect(() => () => {
    // A keyed owner replacement normally reaches this sample through App's
    // synchronous transition preflight. Keep unmount as a final owner-tagged
    // handoff so conditional margin removal cannot silently discard it.
    flushWorkspaceScrollPublicationRef.current();
    if (scrollPublishTimerRef.current != null) {
      window.clearTimeout(scrollPublishTimerRef.current);
      scrollPublishTimerRef.current = null;
    }
    if (restoredScrollFrameRef.current != null) {
      window.cancelAnimationFrame(restoredScrollFrameRef.current);
      restoredScrollFrameRef.current = null;
    }
    pendingScrollPublicationRef.current = null;
  }, []);

  useEffect(() => {
    const flushOnWindowBlur = (): void => {
      flushWorkspaceScrollPublicationRef.current(true);
    };
    window.addEventListener("blur", flushOnWindowBlur);
    return () => window.removeEventListener("blur", flushOnWindowBlur);
  }, []);

  const handleMarginPointerLeave = (): void => {
    flushWorkspaceScrollPublication(true);
    onMarginActiveChange?.(false);
  };
  const handleMarginBlur = (): void => {
    flushWorkspaceScrollPublication(true);
  };

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
  // (`hasDeterministicData` / `hasSemanticData` retired with the chapter-scope
  // Words body they gated. §C4·5 disables that lens rather than filling it with
  // a heading, a subtitle and an invitation, so there is nothing left to gate.)

  const subjectVerseStart = pinnedRange?.start ?? nearVerse ?? 1;
  const subjectVerseEnd = pinnedRange?.end ?? nearVerse ?? Number.MAX_SAFE_INTEGER;
  // The connections strip belongs to the margin's subject: in kept mode the
  // panel studies a different passage than the canvas, and only relationships
  // anchored to that subject belong under its header.
  const subjectConnections = authoredConnections
    .filter((connection) => connection.anchors.some((anchor) => (
      anchor.book === book && anchor.chapter === chapter
    )))
    .sort((left, right) => compareConnectionsCanonical(left, right, {
      book,
      chapter,
      verseStart: subjectVerseStart,
      verseEnd: subjectVerseEnd,
    }));
  // One shared verse-peek controller for the whole panel: a single preview
  // can be open at a time, lens switches dismiss it, and its chapter text is
  // cached for the session.
  const versePeek = useVersePeek(packageId, onKeepReference, onOpenPassageTab);
  // Compact (≤760px) layouts can give the Study pane a second, roomier size.
  const [compactExpanded, setCompactExpanded] = useState(false);

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

  // The AI result cache lives in a ref (it is written from async callbacks);
  // aiCacheVersion is its published revision, so derived values recompute
  // exactly when the cache changes — no bare void-reference hack.
  const pinnedAiResult = useMemo(
    () => (pinKey ? aiCacheRef.current.get(pinKey) : undefined),
    [pinKey, aiCacheVersion],
  );
  // Loading whenever this pinned range has no cached result yet — covers both
  // the brief window before the fetch-triggering effect runs and the time
  // the actual IPC call is in flight.
  const pinnedAiLoading = pinKey != null && pinnedAiResult === undefined && !aiCacheRef.current.has(pinKey);

  const pinnedNote = pinnedRange ? findNoteForRange(marginData, chapter, pinnedRange.start, pinnedRange.end) : null;
  const pinnedHighlights = pinnedRange
    ? activeHighlights.filter((h) => h.chapter === chapter && h.verse_start <= pinnedRange.end && h.verse_end >= pinnedRange.start)
    : [];
  const pinnedColors = [...new Set(pinnedHighlights.map((highlight) => highlight.color))];
  const pinnedHighlightColor = pinnedColors.length === 1 ? pinnedColors[0]! : null;
  // C4·1. `pinnedQuote` / `nearQuote` / `quoteVerseText` went with the quoted
  // selection: nothing in the frame quotes the passage any more, because the
  // passage is on screen 300px to the left, untruncated.
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
  const nearRef = nearVerse != null ? `${displayBook} ${chapter}:${nearVerse}` : "";
  const contextReference = isPinned ? pinnedRef : isNear ? nearRef : `${displayBook} ${chapter}`;
  const chapterEndVerse = Math.max(1, ...Array.from(chapterVerseText?.keys() ?? []));

  /* Chapter-granular, and keyed only on book and chapter — moving between
     verses inside a chapter must not re-ask, because the answer cannot change
     and a reader scrolling would otherwise fire this on every line. */
  useEffect(() => {
    let cancelled = false;
    void safeCall(() => window.api.passages.moments(book, chapter)).then((result) => {
      if (cancelled) return;
      setTaughtHere(result.ok && result.value.ok ? result.value.moments : []);
    });
    return () => { cancelled = true; };
  }, [book, chapter]);
  const trustedResourceBref = pinnedRange
    ? `bref:v1/${book}.${chapter}.${pinnedRange.start}${pinnedRange.end === pinnedRange.start ? "" : `-${book}.${chapter}.${pinnedRange.end}`}`
    : nearVerse != null
      ? `bref:v1/${book}.${chapter}.${nearVerse}`
      : `bref:v1/${book}.${chapter}.1-${book}.${chapter}.${chapterEndVerse}`;

  useEffect(() => {
    let cancelled = false;
    setTrustedResourcesLoading(true);
    setTrustedResourcesRefusal(null);
    safeCall(() => window.api.trustedResources.query({
      bref: trustedResourceBref,
      /* Fetch what "All" would need. The ranking pass is the same either way;
         only how much of it crosses the wire differs. */
      limit: 100,
      // Working Preacher publishes Spanish editions alongside English ones, and
      // without a stated preference a tie hands the reader whichever sorted
      // first. Stated here rather than assumed in core, so that when the app
      // grows a reading-language setting there is one place to read it from.
      preferLanguage: "en",
    }))
      .then((result) => {
        if (cancelled) return;
        setTrustedResourcesLoading(false);
        if (!result.ok) {
          setTrustedResources([]);
          setTrustedResourcesRefusal(result.error);
          return;
        }
        if (!result.value.ok) {
          setTrustedResources([]);
          setTrustedResourcesRefusal(result.value.refusal.message);
          return;
        }
        setTrustedResources(result.value.resources);
        setTrustedResourceTotal(result.value.total);
        setTrustedResourcesHidden(result.value.hiddenCount);
      });
    return () => { cancelled = true; };
  }, [trustedResourceBref, trustedResourceFilterVersion]);
  const marginMode = connectionInspectorOpen
    ? "connection"
    : isPinned
      ? "selection"
      : isNear && ambientKept
        ? "kept"
        : "following";
  // C4·1. The scope reads as a sentence: serif reference, sans state word.
  // "The two modes then differ by one word instead of by three bands and a
  // blockquote." What stood here was a whole clause per mode — `Selection ·
  // Acts 19:1–2`, `Kept on Acts 19:5`, `Following your reading · Acts 19` —
  // set at 11px above a 22px repeat of the same reference. The reference is
  // now said once, in the serif, and this is only the word after it.
  //
  // @quire derived · ruling 4·1 · the prose writes the chapter mode as
  // `Acts 19 · following your reading`; the drawing sets the two spans 10px
  // apart with no separator glyph. A middot is a separator, and the section
  // asks for a sentence, so the gap does it. The state word for the connection
  // view is undrawn and takes the same one-word shape.
  const scopeState = connectionInspectorOpen
    ? "connection"
    : isPinned
      ? "selected"
      : isNear && ambientKept
        ? "kept"
        : "following your reading";
  // Announce scope-kind transitions only. The visible scope line carries the
  // verse reference, which changes on every reading eye-line move; putting it
  // in a live region reads the entire chapter aloud while scrolling.
  const scopeAnnouncement = connectionInspectorOpen
    ? "Connection open in Study"
    : isPinned
      ? "Selection kept in Study"
      : isNear && ambientKept
        ? "Passage kept in Study"
        : "Following your reading";
  const contextStartVerse = pinnedRange?.start ?? nearVerse ?? 1;
  const finalChapterVerse = chapterVerseText && chapterVerseText.size > 0
    ? Math.max(...chapterVerseText.keys())
    : 1;
  const contextEndVerse = pinnedRange?.end ?? nearVerse ?? finalChapterVerse;
  /**
   * Quire C·4, the headline finding: "the Connections tab is showing
   * cross-references." The count read `(crossRefs?.items.length ?? 0) +
   * noteConnectionCount` — the edition's list plus the app's inferences, and no
   * authored connection at all, which made third-party data wear the reader's
   * own hand. It is the same class of error as unmarked licensed prose.
   *
   * A connection is a thing you made, so the count is authored connections in
   * the scope the panel is looking at, and nothing else may be added to it.
   * `crossRefs` is deliberately not in this expression or its dependencies.
   */
  const passageConnectionScope = useMemo(() => ({
    book,
    chapter,
    verseStart: contextStartVerse,
    verseEnd: contextEndVerse,
  }), [book, chapter, contextStartVerse, contextEndVerse]);
  const passageConnections = useMemo(() => authoredConnections
    .filter((connection) => canonicalConnectionAnchors(connection, passageConnectionScope).length > 0)
    .sort((left, right) => compareConnectionsCanonical(left, right, passageConnectionScope)),
  [authoredConnections, passageConnectionScope]);
  // The nearest true thing when the scope holds none: the chapter's own.
  const elsewhereConnections = useMemo(() => {
    const inScope = new Set(passageConnections.map((connection) => connection.id));
    return subjectConnections.filter((connection) => !inScope.has(connection.id));
  }, [passageConnections, subjectConnections]);
  const connectionCount = passageConnections.length;

  /* --- Notes, in scope and elsewhere -------------------------------------
     C4·6: a tab count is seal when the count is YOURS. So the Notes count is
     the reader's own notes anchored in scope and nothing else. It used to add
     `pinnedLibraryItemCount` — the app's threads and claims — which put a seal
     number on material the reader never wrote, and made "Notes 4" unfalsifiable
     against a passage with no notes on it at all. */
  const studyNotes = useMemo(
    () => studyNoteEntries(marginData, chapter, displayBook),
    [marginData, chapter, displayBook],
  );
  const notesScope = isPinned
    ? { start: pinnedRange.start, end: pinnedRange.end }
    : isNear && nearVerse != null
      ? { start: nearVerse, end: nearVerse }
      : null;
  const notesHere = useMemo(
    () => (notesScope
      ? studyNotes.filter((entry) => anchorTouches(entry.anchor, notesScope.start, notesScope.end))
      : studyNotes),
    [studyNotes, notesScope?.start, notesScope?.end],
  );
  const notesElsewhere = useMemo(
    () => (notesScope
      ? studyNotes.filter((entry) => !anchorTouches(entry.anchor, notesScope.start, notesScope.end))
      : []),
    [studyNotes, notesScope?.start, notesScope?.end],
  );
  const notesCount = notesHere.length;
  const notesEmptyCopy = notesEmptySentence(notesScope, contextReference);

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
        onEntityTrailChange?.(sessionOwnerTabId, (current) => appendEntityResearchTrail(current, {
          id: result.value!.entity.id,
          displayName: result.value!.entity.displayName,
          kind: result.value!.entity.kind,
        }));
      } else {
        setEntityResearch(null);
        setEntityResearchError(result.ok ? "This entity is no longer in the installed index." : result.error);
      }
      setEntityResearchLoading(false);
    });
    return () => { cancelled = true; };
  }, [entityIntent, onEntityTrailChange, sessionOwnerTabId]);

  const openRelatedEntity = (target: EntityResearchTarget): void => {
    if (!onDrillEntity || !entityResearch || entityResearch.entity.id === target.id) return;
    void onDrillEntity(target);
  };

  const openTrailEntity = (index: number): void => {
    const target = entityTrail[index];
    if (!target || !onDrillEntity || index === entityTrail.length - 1) return;
    void onDrillEntity({
      id: target.id,
      displayName: target.displayName,
      kind: target.kind ?? "other",
    }, { trailIndex: index });
  };

  const currentResearchIsRecorded = entityTrail.at(-1)?.id === entityIntent?.id;
  const previousEntity = entityTrail.at(currentResearchIsRecorded ? -2 : -1);
  const previousIndex = entityTrail.length - (currentResearchIsRecorded ? 2 : 1);
  const openPreviousEntity = (): void => {
    if (!previousEntity || !onDrillEntity) return;
    const previous: EntityResearchTarget = {
      id: previousEntity.id,
      displayName: previousEntity.displayName,
      kind: previousEntity.kind ?? "other",
    };
    void onDrillEntity(previous, { trailIndex: previousIndex });
  };

  const researchLayerRef = useLayer(
    activeWorkspace === "research" && entityIntent && (onDrillEntity || onReturnEntityOrigin) ? "research" : null,
  );

  useEffect(() => {
    if (entityResearchFocusRequest == null) return;
    if (activeWorkspace !== "research" || !entityIntent) return;
    if (!entityResearchError && entityResearch?.entity.id !== entityIntent.id) return;
    const frame = window.requestAnimationFrame(() => {
      researchTitleRef.current?.focus({ preventScroll: true });
      onEntityResearchFocusRequestHandled?.(sessionOwnerTabId, entityResearchFocusRequest);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [
    activeWorkspace,
    entityIntent,
    entityResearch,
    entityResearchError,
    entityResearchFocusRequest,
    onEntityResearchFocusRequestHandled,
    sessionOwnerTabId,
  ]);

  useEffect(() => {
    if (activeWorkspace !== "research" || !entityIntent || (!onDrillEntity && !onReturnEntityOrigin)) return;
    const closeResearch = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Research is the lowest-ranking layer; every dialog, chooser, card,
      // and marking surface outranks it in the shared registry.
      if (!isTopLayer(researchLayerRef.current)) return;
      event.preventDefault();
      if (previousEntity && onDrillEntity) openPreviousEntity();
      else void onReturnEntityOrigin?.();
    };
    window.addEventListener("keydown", closeResearch, true);
    return () => window.removeEventListener("keydown", closeResearch, true);
  }, [activeWorkspace, entityIntent, onDrillEntity, onReturnEntityOrigin, previousEntity, previousIndex, researchLayerRef]);

  useEffect(() => {
    // Complete-note bodies are only rendered in the pinned deep dive; the
    // ambient and chapter Notes tabs never consume deepNotesById, so do not
    // pay a full-library read for them.
    if (activeTab !== "notes" || !isPinned) return;
    let cancelled = false;
    setDeepNotesLoading(true);
    setDeepNotesFailed(false);
    void safeCall(() => window.api.library.readAllNotes()).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setDeepNotesById(Object.fromEntries(
          result.value.map((note) => [note.frontmatter.id, note]),
        ));
      }
      // Law 7's `failed`. A read that could not happen used to leave the panel
      // showing the snippets it already had and saying nothing, which reads as
      // "these are your notes" when it means "this is all of them we could
      // reach". The state names the thing, the reason, and that it was local.
      setDeepNotesFailed(!result.ok);
      setDeepNotesLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, isPinned, marginData.notes.length, deepNotesAttempt]);

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

  /**
   * §C4·5 — the four tabs are chapter-scoped until a verse is chosen, and
   * "Words has nothing to say about a whole chapter". Chapter scope here is
   * the state where the scope line carries no verse at all: `Acts 19`, not
   * `Acts 19:5`. Following your reading resolves a verse and keeps its words.
   *
   * @quire derived · kin: header instruments · the app has three scopes where
   * the quire draws two, and the line the quire draws disabled is the one with
   * no verse in its reference.
   */
  const wordsScopeDisabled = !isPinned && !isNear;
  const tabIsDisabled = (tab: MarginTab): boolean => tab === "passage" && wordsScopeDisabled;

  const activateTab = (tab: MarginTab, focus = false): void => {
    const focusTab = (): void => {
      const index = MARGIN_TABS.findIndex((item) => item.id === tab);
      window.setTimeout(() => tabRefs.current[index]?.focus(), 0);
    };
    // A disabled instrument still takes focus — it is a tab in a tablist and a
    // keyboard reader has to be able to find out that it is off — but nothing
    // activates it: not the pointer, not an arrow key, not the canvas's lens
    // cycle. Off is nothing; disabled is the label without its count.
    if (tabIsDisabled(tab)) {
      if (focus) focusTab();
      return;
    }
    if (tab === activeTab) return;
    versePeek.close();
    flushWorkspaceScrollPublication(true);
    setActiveTab(tab);
    if (focus) focusTab();
  };

  // Clearing a selection takes Words out of scope underneath a reader who is
  // standing in it. The pane holds its height across all five states (Law 7),
  // but it may not hold a tab that has stopped being true, so the panel falls
  // back to the lens that is always in scope.
  useEffect(() => {
    if (!wordsScopeDisabled || activeTab !== "passage") return;
    onMarginSessionChange(sessionOwnerTabId, (current) => ({ ...current, activeTab: "overview" }));
  }, [wordsScopeDisabled, activeTab, sessionOwnerTabId, onMarginSessionChange]);

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
      // A disabled lens is stepped over rather than stepped onto: this cycle
      // never moves focus, so stopping on it would look like the key failed.
      let nextIndex = (currentIndex + (reverse ? -1 : 1) + MARGIN_TABS.length) % MARGIN_TABS.length;
      for (let hop = 0; hop < MARGIN_TABS.length && tabIsDisabled(MARGIN_TABS[nextIndex]!.id); hop += 1) {
        nextIndex = (nextIndex + (reverse ? -1 : 1) + MARGIN_TABS.length) % MARGIN_TABS.length;
      }
      activateTab(MARGIN_TABS[nextIndex]?.id ?? "overview");
    };

    window.addEventListener("keydown", cycleStudyLens, true);
    return () => window.removeEventListener("keydown", cycleStudyLens, true);
    // wordsScopeDisabled re-binds the listener so the cycle never steps onto a
    // lens that went out of scope after the handler was attached.
  }, [activeTab, entityIntent, wordsScopeDisabled]);

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
      // While the connection inspector is open, Escape belongs to the
      // shape/card dismissal ladder — including when its focus entry point
      // (the frame title) is the event target.
      if (connectionInspectorOpen) return;
      const target = event.target instanceof Element ? event.target : null;
      // Panels and the margin chrome (frame header, Keep/Clear actions) both
      // return focus to the active tab; canvas and topbar keep their own
      // Escape meaning.
      if (!target?.closest(".margin-tab-panel, .margin-frame-header")) return;
      // VersePeek and every other registered layer get the first Escape.
      if (!layerStackIsEmpty()) return;
      event.preventDefault();
      event.stopPropagation();
      const index = MARGIN_TABS.findIndex((tab) => tab.id === activeTab);
      tabRefs.current[index]?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", returnToActiveTab, true);
    return () => window.removeEventListener("keydown", returnToActiveTab, true);
  }, [activeTab, connectionInspectorOpen]);

  /**
   * §C4·1 / §C4·6 · "All four tabs carry counts. Inline, 12.5px. Seal when the
   * count is yours, faint when it is the edition's, absent when the tab is
   * disabled." Shipped, only Connections carried one and it was a superscript.
   *
   * The count carries its own provenance, because ink is what says whose the
   * number is (Law 3). A zero is never seal: a count of nothing of yours is
   * not a mark of your authorship, which is why the drawing sets `Notes 0`
   * faint and `Notes 4` seal on the same tab.
   *
   * @quire derived · ruling 4·1, drawings beat prose · §C4·6 says "all four
   * tabs carry counts", but Overview carries none in any of the five drawings —
   * including the three where it is not the active tab. It should not: it is
   * the sum of the others and counts nothing of its own.
   *
   * @quire guessed · the Words count. C4·1 draws `Words 21` — the
   * original-language words in scope. That number is fetched inside
   * `LanguageWordsSection` (listPackages → pickLanguagePackage → getVerseTokens)
   * and there is no renderer-side source for it in the frame; reproducing the
   * fetch here would be a second package-selection truth and one IPC round trip
   * per verse in the selection. Words therefore carries its label and no count
   * until the panel publishes one. HANDOFF §10.6 is the precedent: draw no
   * index at all rather than a wrong one.
   */
  const tabCount = (tab: MarginTab): { value: number; provenance: "reader" | "edition" } | null => {
    if (tabIsDisabled(tab)) return null;
    if (tab === "connections") return { value: connectionCount, provenance: "reader" };
    if (tab === "notes") return { value: notesCount, provenance: "reader" };
    return null;
  };

  const clearSelection = () => {
    onClearSelection?.();
    // The Done control intentionally disappears when selection ends. Move
    // focus to the persistent frame title so keyboard users are never left
    // focused on a detached node and can orient to the restored mode.
    window.setTimeout(() => frameTitleRef.current?.focus(), 0);
  };

  if (entityIntent && activeWorkspace === "research") {
    const originLabel = formatEntityResearchOrigin(entityIntent.origin, bookNames);
    const currentCanvasLabel = `${displayBook} ${chapter}${
      packageId !== entityIntent.origin.packageId ? ` · ${packageId.toUpperCase()}` : ""
    }`;
    const currentCanvasDiffersFromOrigin = book !== entityIntent.origin.book
      || chapter !== entityIntent.origin.chapter
      || packageId !== entityIntent.origin.packageId;
    return (
      <aside
        ref={marginRef}
        className="living-margin entity-research-margin"
        aria-label="Entity research"
        data-margin-mode="research"
        onScroll={scheduleWorkspaceScrollPublication}
        onPointerEnter={() => onMarginActiveChange?.(true)}
        onPointerLeave={handleMarginPointerLeave}
        onBlur={handleMarginBlur}
      >
        <div
          id="margin-research-workspace"
          className="margin-workspace-panel"
        >
        <header className="entity-research-frame">
          <div className="entity-research-nav">
            {previousEntity && onDrillEntity && (
              <button
                type="button"
                className="entity-research-back"
                onClick={openPreviousEntity}
                aria-label={`Back to ${previousEntity.displayName}`}
              >
                <span aria-hidden="true">←</span>
                <span>{`Back to ${previousEntity.displayName}`}</span>
              </button>
            )}
            {onReturnEntityOrigin && (
              <button
                type="button"
                className="entity-research-return"
                onClick={onReturnEntityOrigin}
                aria-label={`Return to ${originLabel}`}
              >
                {/* The study names the destination in the visible label, not
                    only in the accessible one: a bare "Return" makes the
                    reader guess which of Back, Return and Close keeps their
                    place. "Return to Acts 19:13–16" cannot be misread. */}
                {`Return to ${originLabel}`}
              </button>
            )}
            {onCloseEntity && (
              <button
                type="button"
                className="entity-research-close"
                onClick={onCloseEntity}
                aria-label="Close research tab"
              >
                Close
              </button>
            )}
          </div>
          <div className="entity-research-provenance">
            <span className="entity-research-mode">Research</span>
            <span>Opened from <strong>{originLabel}</strong></span>
            {currentCanvasDiffersFromOrigin && (
              <span>Viewing <strong>{currentCanvasLabel}</strong></span>
            )}
          </div>
        </header>
        <nav className="entity-research-breadcrumbs" aria-label="Research trail">
          <button
            type="button"
            className="entity-research-breadcrumb is-origin"
            onClick={onReturnEntityOrigin}
            aria-label={`Return to ${originLabel}`}
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
        <h1 ref={researchTitleRef} id="entity-research-title" className="sr-only" tabIndex={-1}>
          Research {entityResearch?.entity.displayName ?? entityIntent.displayName}
        </h1>
        {entityResearchError && !entityResearchLoading && (
          <div data-study-entity-unavailable={entityIntent.id}>
            <MarginEmptyView title={`${entityIntent.displayName} unavailable`} detail={entityResearchError} />
          </div>
        )}
        {entityResearch && !entityResearchLoading && (
          <div>
            <EntityResearchView
              data={entityResearch}
              origin={entityIntent.origin}
              currentBook={book}
              currentChapter={chapter}
              chapterVerseText={displayChapterVerseText ?? chapterVerseText ?? new Map<number, string>()}
              bookNames={bookNames}
              onNavigate={onNavigateToRef}
              peekTriggerProps={versePeek.triggerProps}
              onDrillEntity={openRelatedEntity}
              onBranchEntity={onBranchEntity}
              onOpenPassageTab={onOpenPassageTab}
              onCapture={onCapture}
            />
          </div>
        )}
        {versePeek.peekElement}
        </div>
      </aside>
    );
  }

  return (
    <aside
      ref={marginRef}
      className="living-margin"
      aria-labelledby="living-margin-title"
      data-margin-mode={marginMode}
      data-compact-expanded={compactExpanded || undefined}
      onScroll={scheduleWorkspaceScrollPublication}
      onPointerEnter={() => onMarginActiveChange?.(true)}
      onPointerLeave={handleMarginPointerLeave}
      onBlur={handleMarginBlur}
    >
      <div
        id="margin-study-workspace"
        className="margin-workspace-panel"
      >
      <span className="sr-only" aria-live="polite">{scopeAnnouncement}</span>
      {/*
        §C4·1 · the scope bar. Three bands and 118px became one band of 62px,
        fixed: what the panel is looking at, and the verb that changes it.

        Two things were deleted here and neither is coming back.

        The "Study" title — "it is the only panel in the column and it is
        permanently on screen. A title that never changes and never
        distinguishes anything is a 34px band spent on nothing." Its id moved
        onto the scope line, which is the panel's real name and the same
        focus target it always was.

        The quoted selection and its "Read full selection ↓" — see the note
        where `PassageQuote` used to be.

        The verb slot renders in every mode, empty or not. That is the point
        of the section: the tab row beneath it must sit at the same y in
        chapter scope and in selection, and it is measured in
        tests/living-margin-frame-contract.test.ts rather than eyeballed.
      */}
      <header className="margin-frame-header">
        <h2
          ref={frameTitleRef}
          id="living-margin-title"
          className="margin-frame-scope"
          tabIndex={-1}
        >
          <span className="margin-frame-ref">{contextReference}</span>
          <span id="living-margin-mode" className="margin-frame-mode">{scopeState}</span>
        </h2>
        <div className="margin-frame-verb">
          {!connectionInspectorOpen && isPinned && onClearSelection && (
            <button type="button" className="margin-frame-action" onClick={clearSelection}>
              Clear
            </button>
          )}
          {!connectionInspectorOpen && isNear && onAmbientKeptChange && (
            <button
              type="button"
              className="margin-frame-action margin-keep-toggle"
              onClick={() => onAmbientKeptChange(!ambientKept)}
              title={ambientKept ? "Release this passage and follow your reading" : "Keep this passage while you work"}
            >
              {ambientKept ? "Follow reading" : "Keep"}
            </button>
          )}
          <button
            type="button"
            className="margin-frame-action margin-compact-size-toggle"
            aria-expanded={compactExpanded}
            aria-label={compactExpanded ? "Shrink the Study panel" : "Give the Study panel more room"}
            title={compactExpanded ? "Shrink Study" : "Enlarge Study"}
            onClick={() => setCompactExpanded((current) => !current)}
          >
            {compactExpanded ? "Less room" : "More room"}
          </button>
        </div>
      </header>

      {connectionInspectorOpen && (
        <div className="margin-connection-inspector" data-margin-view="connection">
          {connectionInspector}
        </div>
      )}

      {/*
        §C4·1 and the C·4 headline finding, together. A `.margin-authored-connections`
        strip stood here — "Your connections", a count, and a button per
        connection carrying its label — between the scope bar and the tab row.

        It went for two reasons, and the second is the worse one:

        1. It is the same dataset as the Connections tab in a second treatment,
           which is the finding this surface was corrected for. Its scope was
           even a superset (the whole chapter, against the tab's scope overlap),
           so the two disagreed on their own counts.
        2. It rendered on `subjectConnections.length > 0`, so **the tab row
           moved** the moment a reader authored their first connection in a
           chapter — the exact thing §C4·1 exists to stop. "Navigation should
           not move."

        A connection's label does not appear anywhere now, and that is
        deliberate: "the type and the members are the whole claim, and any prose
        about it is a note." Nothing became unreachable — the three ways to
        attend (the member, its gutter tick, its row in the tab) are untouched,
        and the tab carries a seal count so the reader sees from any lens that
        there is something of theirs here.
      */}
      <div className={`margin-study-content${connectionInspectorOpen ? " has-connection-inspector" : ""}`}>
      {/*
        §C4·1. `.margin-context` stood here — the reference again at 22px, and
        under it the quoted selection. Between them they were the ~300px that
        pushed the tab row down the moment a verse was chosen: "selecting a
        verse must not restructure the panel, it must narrow it." Nothing may
        be reintroduced between the scope bar and the tab row that depends on
        the scope.
      */}
      <div className="margin-tabs" role="tablist" aria-label="Study views" aria-orientation="horizontal">
        {MARGIN_TABS.map((tab, index) => {
          const selected = activeTab === tab.id;
          const disabled = tabIsDisabled(tab.id);
          // §C4·6 · "Disabled is the label without its count." The number is
          // withheld rather than zeroed: a count of nothing and a count that
          // does not apply are different facts, and only one of them is true
          // of Words at chapter scope. A count of nothing, where the tab is in
          // scope, is drawn — `Notes 0` is a fact the reader wants.
          const count = disabled ? null : tabCount(tab.id);
          // Seal is authorship, so a zero never wears it. Ink-3 rather than
          // ink-faint: the drawing's #B4AEA5 is the ink-3 Rev 04 §4 corrected
          // as a shipped defect at 3.22:1, and a number carries meaning, so
          // Law 6 puts it on the 4.5:1 token.
          const countIsSeal = count != null && count.provenance === "reader" && count.value > 0;
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              id={`margin-${tab.id}-tab`}
              className={`margin-tab${selected ? " is-active" : ""}${disabled ? " is-disabled-instrument" : ""}`}
              role="tab"
              aria-label={count ? `${tab.accessibleLabel}, ${count.value}` : tab.accessibleLabel}
              aria-selected={selected}
              aria-disabled={disabled || undefined}
              aria-controls={`margin-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              {count && (
                <span
                  className={`margin-tab-count${countIsSeal ? " is-yours" : ""}`}
                  aria-hidden="true"
                >
                  {count.value}
                </span>
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
              onOpenPassageTab={onOpenPassageTab}
              peekTriggerProps={versePeek.triggerProps}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} total={trustedResourceTotal} hiddenCount={trustedResourcesHidden} catalogue={trustedResourceCatalogue} onOpenSettings={onOpenResourceSettings} onFiltersChanged={() => setTrustedResourceFilterVersion((v) => v + 1)} />
            <TaughtHereBlock
              moments={taughtHere}
              onPlay={(m) => playPodcastEpisode({
                id: `${m.sourceId}:${m.id}`,
                sourceId: m.sourceId,
                recordId: m.id,
                sourceName: m.sourceName,
                title: m.episode,
                officialUrl: m.officialUrl,
                audioUrl: m.audioUrl,
                bref: `bref:v1/${book}.${chapter}.1`,
                kind: m.kind,
                startAt: m.at,
              })}
            />
          </section>

          <section
            id="margin-passage-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-passage-tab"
            hidden={activeTab !== "passage"}
          >
            {/* §C4·5 — the lens itself is disabled at chapter scope, so this
                body is only ever seen for the frame between a selection being
                cleared and the panel falling back. §C4·6: empty is never
                blank — one sentence naming what is absent, then the nearest
                true thing, which here is the act that brings the words back.
                The old heading and its subtitle explained the interface to
                itself and were the second and third sentences §9 deletes. */}
            <MarginEmptyView
              title="Words are read one verse at a time"
              detail="Choose a verse and its original-language words open here."
            />
          </section>

          <section
            id="margin-connections-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-connections-tab"
            hidden={activeTab !== "connections"}
          >
            <ConnectionsPanel
              connections={passageConnections}
              elsewhere={elsewhereConnections}
              paintProjections={connectionPaintProjections}
              book={book}
              packageId={packageId}
              selectedConnectionId={selectedAuthoredConnectionId}
              onSelectAuthoredConnection={onSelectAuthoredConnection}
            />
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
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
            {notesHere.length > 0 ? (
              <>
                <StudySectionHead
                  title="In this chapter"
                  count={`${notesHere.length.toLocaleString()} · yours`}
                  countValue={notesHere.length}
                  countIsYours
                />
                <div className="margin-note-list">
                  {notesHere.map((entry, index) => (
                    <DeepNoteCard
                      key={entry.note.id}
                      title={entry.note.title}
                      body={entry.note.body_text}
                      meta={entry.reference}
                      defaultOpen={index === 0}
                    />
                  ))}
                </div>
                <MarginNoteFooter onCreateNote={onCreateNote} />
              </>
            ) : semanticLoading ? (
              <SurfaceState state="loading" thing="Reading your library" locality="local" />
            ) : (
              <MarginNotesEmpty
                sentence={notesEmptyCopy}
                elsewhere={notesElsewhere}
                onCreateNote={onCreateNote}
                onNavigate={onNavigateToRef}
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
              onOpenPassageTab={onOpenPassageTab}
              peekTriggerProps={versePeek.triggerProps}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} total={trustedResourceTotal} hiddenCount={trustedResourcesHidden} catalogue={trustedResourceCatalogue} onOpenSettings={onOpenResourceSettings} onFiltersChanged={() => setTrustedResourceFilterVersion((v) => v + 1)} />
            <TaughtHereBlock
              moments={taughtHere}
              onPlay={(m) => playPodcastEpisode({
                id: `${m.sourceId}:${m.id}`,
                sourceId: m.sourceId,
                recordId: m.id,
                sourceName: m.sourceName,
                title: m.episode,
                officialUrl: m.officialUrl,
                audioUrl: m.audioUrl,
                bref: `bref:v1/${book}.${chapter}.1`,
                kind: m.kind,
                startAt: m.at,
              })}
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
                key={`${sessionOwnerTabId}:${book}:${chapter}:${packageId}:ambient`}
                sessionOwnerTabId={sessionOwnerTabId}
                book={book}
                bookDisplayName={displayBook}
                bookNames={bookNames}
                chapter={chapter}
                verse={nearVerse}
                readingPackageId={packageId}
                freezeOnEngage
                wordsVerse={marginSession.wordsVerse}
                wordsFollowingReading={marginSession.wordsFollowingReading}
                onWordsStateChange={(ownerTabId, next) => {
                  onMarginSessionChange(ownerTabId, (current) => ({ ...current, ...next }));
                }}
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
            <ConnectionsPanel
              connections={passageConnections}
              elsewhere={elsewhereConnections}
              paintProjections={connectionPaintProjections}
              book={book}
              packageId={packageId}
              selectedConnectionId={selectedAuthoredConnectionId}
              onSelectAuthoredConnection={onSelectAuthoredConnection}
            />
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
            {notesHere.length > 0 ? (
              <>
                <StudySectionHead
                  title="At this verse"
                  count={`${notesHere.length.toLocaleString()} · yours`}
                  countValue={notesHere.length}
                  countIsYours
                />
                <div className="margin-note-list">
                  {notesHere.map((entry, index) => (
                    <DeepNoteCard
                      key={entry.note.id}
                      title={entry.note.title}
                      body={entry.note.body_text}
                      meta={entry.reference}
                      defaultOpen={index === 0}
                    />
                  ))}
                </div>
                <MarginNoteFooter onCreateNote={onCreateNote} />
              </>
            ) : (
              <MarginNotesEmpty
                sentence={notesEmptyCopy}
                elsewhere={notesElsewhere}
                onCreateNote={onCreateNote}
                onNavigate={onNavigateToRef}
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
              onOpenPassageTab={onOpenPassageTab}
              peekTriggerProps={versePeek.triggerProps}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} total={trustedResourceTotal} hiddenCount={trustedResourcesHidden} catalogue={trustedResourceCatalogue} onOpenSettings={onOpenResourceSettings} onFiltersChanged={() => setTrustedResourceFilterVersion((v) => v + 1)} />
            <TaughtHereBlock
              moments={taughtHere}
              onPlay={(m) => playPodcastEpisode({
                id: `${m.sourceId}:${m.id}`,
                sourceId: m.sourceId,
                recordId: m.id,
                sourceName: m.sourceName,
                title: m.episode,
                officialUrl: m.officialUrl,
                audioUrl: m.audioUrl,
                bref: `bref:v1/${book}.${chapter}.1`,
                kind: m.kind,
                startAt: m.at,
              })}
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

          {/* Primary study surface.

              C·4 §3·1 — "Verse chips become two words." The pill row is gone:
              the drawing sets the verse whose grid is on screen as the section
              head this block never had, and the other verses beside it as the
              switch. §C4·6 bans the bordered button and the circular chip, and
              a 25px radius-999 pill was both. The label is spelled — "Verse 1",
              not "1" — so the row reads without its old standing label.

              The grid stays capped at one verse, which is what the designer
              asks us to confirm in the closing section: 21 words over two
              verses would run the strip past the lemma. */}
          {pinnedRange.end > pinnedRange.start && (
            <div className="words-verse-switch" role="radiogroup" aria-label="Words for verse">
              <span
                className="words-verse-switch-list"
                onKeyDown={(event) => {
                  // APG radio behavior: arrows move between verses and select.
                  const verseCount = pinnedRange.end - pinnedRange.start + 1;
                  const group = event.currentTarget;
                  let next: number | null = null;
                  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                    next = wordsVerse === pinnedRange.end ? pinnedRange.start : wordsVerse + 1;
                  }
                  if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                    next = wordsVerse === pinnedRange.start ? pinnedRange.end : wordsVerse - 1;
                  }
                  if (event.key === "Home") next = pinnedRange.start;
                  if (event.key === "End") next = pinnedRange.end;
                  if (next == null || next === wordsVerse || verseCount <= 1) return;
                  event.preventDefault();
                  setWordsState({ wordsVerse: next, wordsFollowingReading: false });
                  window.setTimeout(() => {
                    group.querySelector<HTMLButtonElement>(`[data-words-verse="${next}"]`)?.focus();
                  }, 0);
                }}
              >
                {Array.from(
                  { length: pinnedRange.end - pinnedRange.start + 1 },
                  (_, index) => pinnedRange.start + index,
                ).map((verse) => (
                  <button
                    key={verse}
                    type="button"
                    className={`words-verse-word${wordsVerse === verse ? " is-showing" : ""}`}
                    role="radio"
                    aria-checked={wordsVerse === verse}
                    data-words-verse={verse}
                    tabIndex={wordsVerse === verse ? 0 : -1}
                    onClick={() => setWordsState({ wordsVerse: verse, wordsFollowingReading: false })}
                  >
                    Verse {verse}
                  </button>
                ))}
              </span>
            </div>
          )}
          <LanguageWordsSection
            key={`${sessionOwnerTabId}:${book}:${chapter}:${packageId}:selected`}
            sessionOwnerTabId={sessionOwnerTabId}
            book={book}
            bookDisplayName={displayBook}
            bookNames={bookNames}
            chapter={chapter}
            verse={wordsVerse}
            readingPackageId={packageId}
            wordsVerse={wordsVerse}
            wordsFollowingReading={marginSession.wordsFollowingReading}
            onWordsStateChange={(ownerTabId, next) => {
              onMarginSessionChange(ownerTabId, (current) => ({ ...current, ...next }));
            }}
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
            <ConnectionsPanel
              connections={passageConnections}
              elsewhere={elsewhereConnections}
              paintProjections={connectionPaintProjections}
              book={book}
              packageId={packageId}
              selectedConnectionId={selectedAuthoredConnectionId}
              onSelectAuthoredConnection={onSelectAuthoredConnection}
            />
          </section>

          <section
            id="margin-notes-panel"
            className="margin-tab-panel"
            role="tabpanel"
            aria-labelledby="margin-notes-tab"
            hidden={activeTab !== "notes"}
          >
          {/* C4·3 · Notes. The three-sentence heading and the bordered
              "Add note" are both gone: the heading told the reader what the
              tab was for, and the button was the only bordered control in the
              panel. What replaced them is one sentence when there is nothing,
              a section head with a seal count when there is, and the verbs as
              words at the foot.

              @quire derived · kin: the Connections tab · C4·3 draws Notes in
              its EMPTY state only, so the head this tab wears when it does
              have notes is underived from any drawing. Taken from the nearest
              drawn sibling in the same panel — Connections' "In this passage"
              with "3 · yours" — rather than invented, since both are lists of
              the reader's own material at the same scope. If Notes-full is
              ever drawn, this is the line it replaces. */}
          {notesHere.length > 0 && (
            <section className="margin-section margin-note-section">
              <StudySectionHead
                title="On this passage"
                count={`${notesHere.length.toLocaleString()} · yours`}
                countValue={notesHere.length}
                countIsYours
              />
              {notesHere.map((entry, index) => (
                <DeepNoteCard
                  key={entry.note.id}
                  title={entry.note.title}
                  body={deepNotesById?.[entry.note.id]?.body ?? entry.note.body_text}
                  meta={entry.reference}
                  defaultOpen={index === 0}
                />
              ))}
            </section>
          )}

          {/* Law 7's `empty`, and the only one the study draws for this tab.
              "Empty is never blank": one sentence naming the absence, the
              verbs as words, then the nearest true thing the panel holds. */}
          {notesHere.length === 0 && !pinnedAiLoading && !deepNotesLoading && !deepNotesFailed && (
            <MarginNotesEmpty
              sentence={notesEmptyCopy}
              elsewhere={notesElsewhere}
              onCreateNote={onCreateNote}
              onNavigate={onNavigateToRef}
            />
          )}

          {/* Law 7's `loading` and `failed`, in the app's own shipped
              grammar — one loading device, the thing named, the reason given,
              and whether it happened on this machine. No spinner: Rev 03b's
              seal segment is the only loading device in the language. */}
          {(pinnedAiLoading || deepNotesLoading) && (
            <SurfaceState state="loading" thing="Reading your library" locality="local" />
          )}

          {!deepNotesLoading && deepNotesFailed && (
            <SurfaceState
              state="failed"
              thing="Your notes"
              reason="The library could not be read."
              locality="local"
              actions={(
                <button
                  type="button"
                  className="margin-note-verb"
                  onClick={() => setDeepNotesAttempt((attempt) => attempt + 1)}
                >
                  Try again
                </button>
              )}
            />
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

          {/* C4·6 · verbs are words in a footer. It appears only when the tab
              has content — the empty state offers the same verb inline, and a
              panel does not need to say "Write a note" twice. */}
          {notesHere.length > 0 && <MarginNoteFooter onCreateNote={onCreateNote} />}
          </section>
        </div>
      )}
      </div>
      {versePeek.peekElement}
      </div>
    </aside>
  );
}
