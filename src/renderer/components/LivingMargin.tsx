import type React from "react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  RankedTrustedResource,
  SemanticMarginResult,
  SuggestedCrossRefData,
} from "../api.js";
import {
  deriveEntityOpeningContext,
  type EntityOpeningOrigin,
} from "../../core/integrations/shepherdly-resource-node.js";
import { compareConnectionsCanonical } from "../../core/annotations/connection-order.js";
import { safeCall } from "../utils/safeCall.js";
import { isTopLayer, layerStackIsEmpty, useLayer } from "../layerStack.js";
import { phraseCount } from "../utils/relationshipVocabulary.js";
import { passageTabOpenIntent } from "../utils/passageTabIntent.js";
import { formatCanonicalRef } from "../utils/formatRef.js";
import { LanguageWordsSection } from "./LanguageWordsSection.js";
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

function TrustedResourcesBlock({
  resources,
  loading,
  refusal,
}: {
  resources: readonly RankedTrustedResource[];
  loading: boolean;
  refusal: string | null;
}): React.JSX.Element {
  const { showToast } = useToast();
  const openResource = async (resource: RankedTrustedResource): Promise<void> => {
    const result = await safeCall(() => window.api.trustedResources.openOfficial(
      resource.source.id,
      resource.record.id,
      resource.record.officialUrl,
    ));
    if (!result.ok) showToast("That official resource link could not be opened.", undefined, undefined, { tone: "error" });
  };
  if (!loading && !refusal && resources.length === 0) return <></>;
  return (
    <section className="trusted-resources" aria-labelledby="trusted-resources-title">
      <header className="trusted-resources-masthead">
        <span className="trusted-resources-kicker">Local reviewed index</span>
        <h3 id="trusted-resources-title">Trusted resources</h3>
      </header>
      {loading && <p className="trusted-resources-status" role="status">Checking local resource manifests…</p>}
      {refusal && <p className="trusted-resources-status is-refusal" role="status">Trusted resources unavailable: {refusal}</p>}
      {!loading && !refusal && resources.length > 0 && (
        <div className="trusted-resource-list">
          {resources.slice(0, 3).map((resource, index) => {
            const metadata = resource.record.metadata;
            const details = [
              resource.record.kind,
              metadata?.author,
              metadata?.publishedAt,
              metadata?.durationMinutes ? `${metadata.durationMinutes} min` : undefined,
            ].filter(Boolean).join(" · ");
            return (
              <article
                className={`trusted-resource-card${index === 0 ? " is-featured" : " is-compact"}`}
                data-source={resource.source.id}
                key={`${resource.source.id}:${resource.record.id}`}
              >
                <div className="trusted-resource-source">{resource.source.name}</div>
                <div className="trusted-resource-copy">
                  <h4>{resource.record.title}</h4>
                  {details && <p>{details}</p>}
                  {index === 0 && <small>{resource.match.replaceAll("-", " ")} · reviewed sample</small>}
                </div>
                <button type="button" onClick={() => void openResource(resource)} aria-label={`Open ${resource.record.title} on ${resource.source.name}`}>
                  Open <span aria-hidden="true">↗</span>
                </button>
              </article>
            );
          })}
        </div>
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
 *  wrote it. Unmarked = it is the edition. The mark is persistent, never a
 *  hover reveal — provenance you have to already suspect is not provenance. */
export type MarginEntryProvenance = "app" | "reader" | "edition";

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

function MarginEntryWhy({
  provenance,
  writtenOn,
  children,
}: {
  provenance: MarginEntryProvenance;
  writtenOn?: string;
  children: React.ReactNode;
}): React.JSX.Element {
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
      <div className="margin-entry-why-copy">
        {children}
        {provenance === "reader" && writtenOn && (
          <span className="margin-entry-why-date">{writtenOn}</span>
        )}
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

function formatResearchRef(value: string, bookNames: BookNameData): string {
  return formatCanonicalRef(value, bookNames);
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
  const containedIn = data.pleiades?.place.connections
    .find((connection) => connection.type.startsWith("part_of"))?.title;
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
        {/* 3 · why it is here */}
        <MarginEntryWhy provenance="edition">
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
          {data.entity.short && data.entity.short !== data.entity.brief && (
            <p className="entity-research-expanded">{data.entity.short}</p>
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

function CrossReferenceRow({
  item,
  onNavigate,
  onOpenPassageTab,
  onCapture,
  sourceAttribution,
  frozenOrigin,
  peekProps,
}: {
  item: CrossReferenceMatchData;
  onNavigate?: (ref: string) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
  onCapture?: (capture: LivingMarginCaptureRequest) => void;
  sourceAttribution: string;
  frozenOrigin: string;
  peekProps?: (target: PeekTarget) => Partial<React.HTMLAttributes<HTMLElement>>;
}): React.JSX.Element {
  const target = parsePeekRef(item.targetBref, item.targetDisplay);
  return (
    <div className="crossref-row">
      <button
        type="button"
        className="crossref-row-open"
        {...crossRefBranchHandlers(item.targetBref, target, onNavigate, onOpenPassageTab)}
        aria-label={item.preview ? `Open ${item.targetDisplay}. ${item.preview}` : `Open ${item.targetDisplay}`}
        title={item.preview ? `${item.targetDisplay} — ${item.preview}` : `Open ${item.targetDisplay}`}
        {...(target && peekProps ? peekProps(target) : {})}
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
  onOpenPassageTab,
  peekTriggerProps,
  onCapture,
  frozenOrigin,
}: {
  result: CrossReferenceResultData;
  onNavigate?: (ref: string) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
  peekTriggerProps: (target: PeekTarget) => VersePeekTriggerProps;
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
            onOpenPassageTab={onOpenPassageTab}
            onCapture={onCapture}
            sourceAttribution={sourceAttribution}
            frozenOrigin={frozenOrigin}
            peekProps={peekTriggerProps}
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
  onOpenPassageTab,
  peekTriggerProps,
  onCapture,
  frozenOrigin,
}: {
  items: SuggestedCrossRefData[];
  onNavigate?: (ref: string) => void;
  onOpenPassageTab?: (target: PeekTarget) => Promise<boolean> | boolean;
  peekTriggerProps: (target: PeekTarget) => VersePeekTriggerProps;
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
        {items.map((item) => {
          const target = parsePeekRef(item.targetBref, item.targetDisplay);
          return (
          <div className="note-crossref-row" key={item.targetBref}>
            <button
              type="button"
              className="crossref-row-open"
              {...crossRefBranchHandlers(item.targetBref, target, onNavigate, onOpenPassageTab)}
              aria-label={`Open ${item.targetDisplay} from notes`}
              {...(target ? peekTriggerProps(target) : {})}
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
          );
        })}
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
  const scripture = crossRefs?.items.slice(0, 2) ?? [];
  const relatedNote = semantic?.semanticNotes[0] ?? null;
  const thread = semantic?.threads[0] ?? null;
  const claim = semantic?.claims.find((item) => item.status === "active") ?? null;
  const [showAllEntities, setShowAllEntities] = useState(false);
  const entities = showAllEntities ? entityResult.entities : entityResult.entities.slice(0, 4);
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
            {scripture.map((item) => {
              const target = parsePeekRef(item.targetBref, item.targetDisplay);
              return (
              <div className="intent-ref-row" key={item.targetBref}>
                <button
                  type="button"
                  className="intent-ref-row-open"
                  {...crossRefBranchHandlers(item.targetBref, target, onNavigate, onOpenPassageTab)}
                  aria-label={`Open ${item.targetDisplay}`}
                  {...(target ? peekTriggerProps(target) : {})}
                >
                  <span className="intent-ref-copy">
                    <span className="intent-ref-title">{item.targetDisplay}</span>
                    {item.preview && <span className="intent-ref-preview">{item.preview}</span>}
                  </span>
                  <CrossReferenceArrow />
                </button>
                {target && onOpenPassageTab && (
                  <button
                    type="button"
                    className="intent-ref-open-tab"
                    onClick={() => void onOpenPassageTab(target)}
                    aria-label={`Open ${item.targetDisplay} in a new passage tab`}
                    title="Open in a new passage tab"
                  >
                    <OpenInTabIcon />
                  </button>
                )}
              </div>
              );
            })}
          </div>
        </section>
      )}

      {hasLibraryLead && (
        <section className="intent-section" aria-labelledby="intent-library-title">
          <div className="intent-section-head">
            <h3 id="intent-library-title">Your library</h3>
            <button type="button" onClick={() => onOpenTab("notes")}>All notes</button>
          </div>
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
          </div>
        </section>
      )}

      {entities.length > 0 && (
        <section className="intent-section" aria-labelledby="intent-entities-title">
          <div className="intent-section-head">
            <h3 id="intent-entities-title">People &amp; places</h3>
          </div>
          {/* C·2 · the same skeleton the Research view uses, with parts 4–6
              simply absent — an entry that stops here is finished, not
              broken, which is the discipline a card layout takes away. */}
          <div className="margin-entry-list intent-entity-list">
            {entities.map((entity) => (
              <article className="margin-entry" key={entity.id}>
                <MarginEntryNameLine
                  name={entity.displayName}
                  onOpen={() => onOpenEntity?.(entityResearchTarget(entity))}
                  openLabel={`Open research tab for ${entity.displayName}`}
                />
                <MarginEntryKindLine
                  parts={[
                    entity.kind === "person" ? "Person" : entity.kind === "place" ? "Place" : "Deity or object",
                    entity.refCount === 1 ? "named once" : `named ${entity.refCount.toLocaleString()} times`,
                  ]}
                />
                <MarginEntryWhy provenance="edition">
                  <p className="margin-entry-why-text">{entity.brief}</p>
                </MarginEntryWhy>
              </article>
            ))}
          </div>
          {entityResult.entities.length > 4 && (
            <button
              type="button"
              className="intent-more-toggle"
              aria-expanded={showAllEntities}
              onClick={() => setShowAllEntities((current) => !current)}
            >
              {showAllEntities
                ? "Fewer people & places"
                : `All ${entityResult.entities.length} people & places in this scope`}
            </button>
          )}
        </section>
      )}

      {loading && (
        <div className="intent-loading" role="status">
          <span className="ai-insight-spinner" aria-hidden="true" />
          <span>Reading your library…</span>
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
  onDrillEntity,
  onBranchEntity,
  onReturnEntityOrigin,
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
  const [trustedResources, setTrustedResources] = useState<RankedTrustedResource[]>([]);
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
  const hasDeterministicData = marginData.notes.length > 0 || activeHighlights.length > 0 || (crossRefs?.totalCount ?? 0) > 0;
  const hasSemanticData = semanticData && (
    semanticData.semanticNotes.length > 0 ||
    semanticData.threads.length > 0 ||
    semanticData.claims.length > 0 ||
    semanticData.suggestedCrossRefs.length > 0
  );

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
  const chapterEndVerse = Math.max(1, ...Array.from(chapterVerseText?.keys() ?? []));
  const trustedResourceBref = pinnedRange
    ? `bref:v1/${book}.${chapter}.${pinnedRange.start}${pinnedRange.end === pinnedRange.start ? "" : `-${book}.${chapter}.${pinnedRange.end}`}`
    : nearVerse != null
      ? `bref:v1/${book}.${chapter}.${nearVerse}`
      : `bref:v1/${book}.${chapter}.1-${book}.${chapter}.${chapterEndVerse}`;

  useEffect(() => {
    let cancelled = false;
    setTrustedResourcesLoading(true);
    setTrustedResourcesRefusal(null);
    safeCall(() => window.api.trustedResources.query({ bref: trustedResourceBref, limit: 3 }))
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
      });
    return () => { cancelled = true; };
  }, [trustedResourceBref]);
  const marginMode = connectionInspectorOpen
    ? "connection"
    : isPinned
      ? "selection"
      : isNear && ambientKept
        ? "kept"
        : "following";
  const scopeCopy = connectionInspectorOpen
    ? `Connection · ${contextReference}`
    : isPinned
      ? `Selection · ${contextReference}`
      : isNear && ambientKept
        ? `Kept on ${contextReference}`
      : `Following your reading · ${contextReference}`;
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
  }, [activeTab, isPinned, marginData.notes.length]);

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
    versePeek.close();
    flushWorkspaceScrollPublication(true);
    setActiveTab(tab);
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
                Return
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
          <span id="living-margin-mode" className="margin-frame-mode">{scopeCopy}</span>
          {!connectionInspectorOpen && isNear && onAmbientKeptChange && (
            <>
              <span className="margin-frame-separator" aria-hidden="true">·</span>
              <button
                type="button"
                className="margin-frame-action margin-keep-toggle"
                onClick={() => onAmbientKeptChange(!ambientKept)}
                title={ambientKept ? "Release this passage and follow your reading" : "Keep this passage while you work"}
              >
                {ambientKept ? "Follow reading" : "Keep"}
              </button>
            </>
          )}
          {!connectionInspectorOpen && isPinned && onClearSelection && (
            <button type="button" className="margin-frame-action" onClick={clearSelection}>
              Clear
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

      {!connectionInspectorOpen && subjectConnections.length > 0 && (
        <nav className="margin-authored-connections" aria-label="Your authored connections in this passage">
          <div className="margin-authored-connections-head">
            <span>Your connections</span>
            <small>{subjectConnections.length}</small>
          </div>
          <div className="margin-authored-connections-list">
            {subjectConnections.map((connection) => (
              <button
                key={connection.id}
                type="button"
                aria-current={selectedAuthoredConnectionId === connection.id || undefined}
                onClick={() => onSelectAuthoredConnection?.(connection, true)}
              >
                <span>{connection.label}</span>
                <small>{phraseCount(connection.anchors.length)}</small>
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
          const hasCount = count != null && count > 0;
          return (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              id={`margin-${tab.id}-tab`}
              className={`margin-tab${selected ? " is-active" : ""}`}
              role="tab"
              aria-label={hasCount ? `${tab.accessibleLabel}, ${count}` : tab.accessibleLabel}
              aria-selected={selected}
              aria-controls={`margin-${tab.id}-panel`}
              tabIndex={selected ? 0 : -1}
              onClick={() => activateTab(tab.id)}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              <span>{tab.label}</span>
              {hasCount && (
                <span className="margin-tab-count" aria-hidden="true">{count}</span>
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
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} />
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
                onOpenPassageTab={onOpenPassageTab}
                peekTriggerProps={versePeek.triggerProps}
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
              onOpenPassageTab={onOpenPassageTab}
              peekTriggerProps={versePeek.triggerProps}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} />
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
            {crossRefs && crossRefs.items.length > 0 ? (
              <CrossRefsBlock
                result={crossRefs}
                onNavigate={onNavigateToRef}
                onOpenPassageTab={onOpenPassageTab}
                peekTriggerProps={versePeek.triggerProps}
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
              onOpenPassageTab={onOpenPassageTab}
              peekTriggerProps={versePeek.triggerProps}
              onOpenTab={activateTab}
              onOpenEntity={onOpenEntity}
            />
            <TrustedResourcesBlock resources={trustedResources} loading={trustedResourcesLoading} refusal={trustedResourcesRefusal} />
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
              <span
                className="words-verse-chips"
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
                    className="words-verse-chip"
                    role="radio"
                    aria-label={`Verse ${verse}`}
                    aria-checked={wordsVerse === verse}
                    data-words-verse={verse}
                    tabIndex={wordsVerse === verse ? 0 : -1}
                    onClick={() => setWordsState({ wordsVerse: verse, wordsFollowingReading: false })}
                  >
                    {verse}
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
            {(crossRefs?.items.length ?? 0) > 0 && crossRefs && (
              <CrossRefsBlock
                result={crossRefs}
                onNavigate={onNavigateToRef}
                onOpenPassageTab={onOpenPassageTab}
                peekTriggerProps={versePeek.triggerProps}
                onCapture={onCapture}
                frozenOrigin={contextReference}
              />
            )}
            {pinnedSemantic && pinnedSemantic.suggestedCrossRefs.length > 0 && (
              <NoteCrossRefsBlock
                items={pinnedSemantic.suggestedCrossRefs.slice(0, 6)}
                onNavigate={onNavigateToRef}
                onOpenPassageTab={onOpenPassageTab}
                peekTriggerProps={versePeek.triggerProps}
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
              <span className="ai-insight-label">Reading your library…</span>
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

          {!pinnedAiLoading && deepNotesLoading && pinnedSemantic && pinnedSemantic.semanticNotes.length > 0 && (
            <div className="deep-notes-loading" role="status">
              <span className="ai-insight-spinner" aria-hidden="true" />
              <span>Reading your library…</span>
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
      {versePeek.peekElement}
      </div>
    </aside>
  );
}
