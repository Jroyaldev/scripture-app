import type React from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AnchorRecord,
  BookNameData,
  CrossReferenceMatchData,
  CrossReferenceResultData,
  LanguageEntityRangeResult,
  NoteRecord,
  ParsedNoteData,
  QueryResult,
  SemanticMarginResult,
  SuggestedCrossRefData,
} from "../api.js";
import { safeCall } from "../utils/safeCall.js";
import { LanguageWordsSection } from "./LanguageWordsSection.js";

export interface PinnedRange {
  start: number;
  end: number;
}

type MarginTab = "overview" | "connections" | "passage" | "notes";

const MARGIN_TABS: Array<{ id: MarginTab; label: string; accessibleLabel: string }> = [
  { id: "overview", label: "Overview", accessibleLabel: "Overview" },
  { id: "connections", label: "Refs", accessibleLabel: "Cross references" },
  { id: "passage", label: "Passage", accessibleLabel: "Passage study" },
  { id: "notes", label: "Notes", accessibleLabel: "Notes" },
];

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
   * build the passage-scoped AI insight call and the pinned-passage quote. */
  chapterVerseText?: Map<number, string>;
  /** Derived selected/"pinned" range from ScripturePage (min/max of selectedVerses). */
  pinnedRange?: PinnedRange | null;
  /** The verse nearest the reading eye-line, when nothing is pinned. */
  nearVerse?: number | null;
  onPinClaim?: (claimId: string, assertion: string) => Promise<boolean> | boolean;
  /** Assign a highlight color to the pinned range. */
  onSetHighlightColor?: (color: string) => void;
  /** Remove every complete visual highlight touched by the pinned range. */
  onRemoveHighlights?: (entityIds: string[]) => void;
  /** Create a note from the pinned range (same path as the mini toolbar). */
  onCreateNote?: () => void;
  /** Navigate to a cross-reference's target passage (e.g. "Matthew 3:11"). */
  onNavigateToRef?: (ref: string) => void;
  /**
   * Pastor engaged language study for this verse — parent should pin it so
   * ambient scroll cannot steal the panel.
   */
  onStudyVerse?: (verse: number) => void;
  /** Pointer entered/left the margin (freeze ambient eye-line while true). */
  onMarginActiveChange?: (active: boolean) => void;
  /** Leave the explicit selected-passage state and return to the reading eye-line. */
  onClearSelection?: () => void;
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

function CrossReferenceRow({
  item,
  onNavigate,
}: {
  item: CrossReferenceMatchData;
  onNavigate?: (ref: string) => void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="crossref-row"
      onClick={() => onNavigate?.(item.targetBref)}
      aria-label={`Open ${item.targetDisplay}`}
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
  );
}

function CrossRefsBlock({
  result,
  onNavigate,
}: {
  result: CrossReferenceResultData;
  onNavigate?: (ref: string) => void;
}): React.JSX.Element {
  return (
    <section className="margin-section crossref-section" aria-label="OpenBible cross references">
      <div className="crossref-heading">
        <div>
          <h3 className="margin-section-header crossref-title">OpenBible</h3>
          <div className="crossref-context">
            <span>Cross References</span>
            <span aria-hidden="true">·</span>
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
          <CrossReferenceRow key={item.targetBref} item={item} onNavigate={onNavigate} />
        ))}
      </div>

      <div
        className="crossref-attribution"
        title={`${result.attribution.attribution} · ${result.attribution.license} · ${result.attribution.sourceUrl}`}
      >
        <span>{result.attribution.name}</span>
        <span aria-hidden="true">·</span>
        <span>{result.attribution.license}</span>
      </div>
    </section>
  );
}

function NoteCrossRefsBlock({
  items,
  onNavigate,
}: {
  items: SuggestedCrossRefData[];
  onNavigate?: (ref: string) => void;
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
          <button
            key={item.targetBref}
            type="button"
            className="note-crossref-row"
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
}: {
  crossRefs: CrossReferenceResultData | null;
  directNote: NoteRecord | null;
  semantic: SemanticMarginResult | null | undefined;
  entityResult: LanguageEntityRangeResult;
  loading: boolean;
  onNavigate?: (ref: string) => void;
  onOpenTab: (tab: MarginTab) => void;
}): React.JSX.Element {
  const scripture = crossRefs?.items.slice(0, 2) ?? [];
  const relatedNote = semantic?.semanticNotes[0] ?? null;
  const thread = semantic?.threads[0] ?? null;
  const claim = semantic?.claims.find((item) => item.status === "active") ?? null;
  const entities = entityResult.entities.slice(0, 4);
  const hasLibraryLead = directNote != null || relatedNote != null || thread != null || claim != null;
  const hasContent = scripture.length > 0 || hasLibraryLead || entities.length > 0;

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
          {crossRefs && (
            <div className="intent-attribution">
              {crossRefs.attribution.name} <span aria-hidden="true">·</span> {crossRefs.attribution.license}
            </div>
          )}
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
              <details key={entity.id} className="intent-entity-card">
                <summary>
                  <span className="intent-entity-copy">
                    <span className="intent-entity-line">
                      <strong>{entity.displayName}</strong>
                      <span>{entity.kind}</span>
                    </span>
                    <span className="intent-entity-brief">{entity.brief}</span>
                  </span>
                  <span className="intent-entity-caret" aria-hidden="true">›</span>
                </summary>
                <div className="intent-entity-detail">
                  {entity.short && entity.short !== entity.brief && <p>{entity.short}</p>}
                  <span>Indexed in {entity.refCount.toLocaleString()} verse{entity.refCount === 1 ? "" : "s"}</span>
                </div>
              </details>
            ))}
          </div>
          {entityResult.entities.length > entities.length && (
            <p className="intent-more-count">
              {entityResult.entities.length - entities.length} more appear in this scope as you continue reading.
            </p>
          )}
          <div className="intent-attribution">
            {entityResult.attribution.name} <span aria-hidden="true">·</span> {entityResult.attribution.license}
          </div>
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
  pinnedRange,
  nearVerse,
  onPinClaim,
  onSetHighlightColor,
  onRemoveHighlights,
  onCreateNote,
  onNavigateToRef,
  onStudyVerse,
  onMarginActiveChange,
  onClearSelection,
}: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());
  const [pendingClaimId, setPendingClaimId] = useState<string | null>(null);
  const [claimPinError, setClaimPinError] = useState<{ id: string; message: string } | null>(null);
  const [activeTab, setActiveTab] = useState<MarginTab>("overview");
  const [entityResult, setEntityResult] = useState<LanguageEntityRangeResult>({
    entities: [],
    attribution: { name: "STEPBible TIPNR", license: "CC BY 4.0" },
  });
  const [entityLoading, setEntityLoading] = useState(false);
  const [deepNotesById, setDeepNotesById] = useState<Record<string, ParsedNoteData> | null>(null);
  const [deepNotesLoading, setDeepNotesLoading] = useState(false);
  const frameTitleRef = useRef<HTMLHeadingElement>(null);
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
  }, [pinKey, pinnedRange, chapterVerseText, book, chapter]);

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
  const pinnedQuote = pinnedRange && chapterVerseText
    ? [...chapterVerseText.entries()]
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
  const nearQuote = nearVerse != null ? chapterVerseText?.get(nearVerse) ?? "" : "";
  const nearRef = nearVerse != null ? `${displayBook} ${chapter}:${nearVerse}` : "";
  const marginMode = isPinned ? "Selected" : isNear ? "In view" : "Chapter";
  const contextReference = isPinned ? pinnedRef : isNear ? nearRef : `${displayBook} ${chapter}`;
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

  // While the reading canvas (or the tab row itself) owns focus, these keys
  // act as study-lens switches rather than moving focus around the chrome.
  // Up/Down remain exclusively available to the verse/result navigation
  // paths. Floating dialogs and controls keep their normal keyboard contract.
  useEffect(() => {
    const cycleStudyLens = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const isLensKey = event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isLensKey) return;
      if (document.querySelector('[data-floating-layer="dialog"], [data-floating-layer="popover"]')) return;

      const target = event.target instanceof Element ? event.target : null;
      const readingTarget = target === document.body
        || target === document.documentElement
        || Boolean(target?.closest(".verse-line, .margin-tab"));
      if (!readingTarget) return;

      event.preventDefault();
      event.stopPropagation();
      const currentIndex = Math.max(0, MARGIN_TABS.findIndex((tab) => tab.id === activeTab));
      const reverse = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey);
      const nextIndex = (currentIndex + (reverse ? -1 : 1) + MARGIN_TABS.length) % MARGIN_TABS.length;
      const focusTab = Boolean(target?.closest(".margin-tab"));
      activateTab(MARGIN_TABS[nextIndex]?.id ?? "overview", focusTab);
    };

    window.addEventListener("keydown", cycleStudyLens, true);
    return () => window.removeEventListener("keydown", cycleStudyLens, true);
  }, [activeTab]);

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % MARGIN_TABS.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
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
          tabIndex={-1}
        >
          Study
        </h2>
        <div className="margin-frame-state">
          <span className="margin-frame-mode" aria-live="polite">{marginMode}</span>
          {isPinned && onClearSelection && (
            <button type="button" className="margin-frame-action" onClick={clearSelection}>
              Done
            </button>
          )}
        </div>
      </header>

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
                  <h3>Chapter overview</h3>
                  <p>Your marks and study activity remain secondary to the text.</p>
                </div>
                <div className="margin-stats" aria-label="Chapter study activity">
                  <div className="margin-stat">
                    <span className="margin-stat-num">{activeHighlights.length}</span>
                    <span className="margin-stat-label">Highlights</span>
                  </div>
                  <div className="margin-stat">
                    <span className="margin-stat-num">{marginData.notes.length}</span>
                    <span className="margin-stat-label">Notes</span>
                  </div>
                  <div className="margin-stat">
                    <span className="margin-stat-num">{crossRefs?.totalCount ?? 0}</span>
                    <span className="margin-stat-label">Cross refs</span>
                  </div>
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
              <CrossRefsBlock result={crossRefs} onNavigate={onNavigateToRef} />
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
              <p>Material from your local library for this chapter.</p>
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
                chapter={chapter}
                verse={nearVerse}
                readingPackageId={packageId}
                onStudyEngage={onStudyVerse}
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
              <CrossRefsBlock result={crossRefs} onNavigate={onNavigateToRef} />
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
              <p>Your local library at this verse.</p>
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

            {/* Quick color row — same swatch chrome as the mini toolbar */}
            {onSetHighlightColor && (
              <div className="margin-hl-palette" role="group" aria-label="Highlight color">
                {(["yellow", "green", "blue", "pink", "purple"] as const).map((color) => (
                  <button
                    key={color}
                    type="button"
                    className={`margin-hl-swatch ${color}${pinnedHighlightColor === color ? " active" : ""}${pinnedColors.length > 1 ? " mixed-context" : ""}`}
                    title={`${color.charAt(0).toUpperCase() + color.slice(1)} highlight`}
                    aria-label={`Apply ${color} highlight`}
                    aria-pressed={pinnedHighlightColor === color}
                    onClick={() => onSetHighlightColor(color)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Primary study surface */}
          <LanguageWordsSection
            book={book}
            chapter={chapter}
            verse={pinnedRange.start}
            readingPackageId={packageId}
            onStudyEngage={onStudyVerse}
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
              <CrossRefsBlock result={crossRefs} onNavigate={onNavigateToRef} />
            )}
            {pinnedSemantic && pinnedSemantic.suggestedCrossRefs.length > 0 && (
              <NoteCrossRefsBlock
                items={pinnedSemantic.suggestedCrossRefs.slice(0, 6)}
                onNavigate={onNavigateToRef}
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
                <span className="ai-insight-source">From your notes</span>
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
    </aside>
  );
}
