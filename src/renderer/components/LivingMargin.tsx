import type React from "react";
import { useEffect, useRef, useState } from "react";
import type {
  AnchorRecord,
  BookNameData,
  CrossReferenceMatchData,
  CrossReferenceResultData,
  NoteRecord,
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
  /** The first annotated verse currently scrolled into view, when nothing is pinned. */
  nearVerse?: number | null;
  onPinClaim?: (claimId: string, assertion: string) => void;
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
}

function AiSparkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="12" height="12" fill="currentColor">
      <path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5l-1.3-4.2L4.5 8l4.2-1.3z" />
    </svg>
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
  const [open, setOpen] = useState(false);
  const preview = 3;
  const shown = open ? result.items : result.items.slice(0, preview);
  const rest = result.items.length - shown.length;

  useEffect(() => {
    setOpen(false);
  }, [result.sourceBref]);

  return (
    <section className="margin-section crossref-section" aria-label="Cross references">
      <div className="crossref-heading">
        <div>
          <div className="margin-section-header crossref-title">See also</div>
          <div className="crossref-context">
            {result.scope === "verse" ? "For this verse" : "Across this passage"}
          </div>
        </div>
        <span
          className="crossref-total"
          title={`${result.items.length} highest-ranked of ${result.totalCount} positive-score connections`}
        >
          <strong>{result.items.length}</strong>
          {result.totalCount > result.items.length && <span> / {result.totalCount}</span>}
        </span>
      </div>

      <div className="crossref-list">
        {shown.map((item) => (
          <CrossReferenceRow key={item.targetBref} item={item} onNavigate={onNavigate} />
        ))}
      </div>

      {rest > 0 && (
        <button type="button" className="crossref-expand" onClick={() => setOpen(true)}>
          Show {rest} more
          <span aria-hidden="true">↓</span>
        </button>
      )}
      {open && result.items.length > preview && (
        <button type="button" className="crossref-expand" onClick={() => setOpen(false)}>
          Show less
          <span aria-hidden="true">↑</span>
        </button>
      )}

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
          <div className="margin-section-header crossref-title">From notes</div>
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
}: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());

  // Session-only cache of AI insight results for the pinned range, keyed by
  // translation + canonical range. Avoids re-triggering the call when
  // re-pinning the same range without reusing WEB prose analysis for KJV.
  const aiCacheRef = useRef<Map<string, SemanticMarginResult | null>>(new Map());
  const [aiCacheVersion, setAiCacheVersion] = useState(0);

  const handlePinClaim = (claimId: string, assertion: string) => {
    if (onPinClaim) {
      onPinClaim(claimId, assertion);
      setPinnedClaims((prev) => new Set(prev).add(claimId));
    }
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

  // Pinned view prefers the passage-scoped AI result over the chapter-wide
  // one — a card shown for verses 1-7 must have been retrieved FOR verses
  // 1-7 (B3.5 truthfulness), falling back to chapter scope while loading.
  const pinnedSemantic = pinnedAiResult ?? semanticData;

  const nearNote = nearVerse != null ? findNoteForRange(marginData, chapter, nearVerse, nearVerse) : null;
  const nearQuote = nearVerse != null ? chapterVerseText?.get(nearVerse) ?? "" : "";
  const nearRef = nearVerse != null ? `${displayBook} ${chapter}:${nearVerse}` : "";

  return (
    <aside
      className="living-margin"
      onPointerEnter={() => onMarginActiveChange?.(true)}
      onPointerLeave={() => onMarginActiveChange?.(false)}
    >
      {/* --- State 1: Chapter overview (default) --- */}
      {!isPinned && !isNear && (
        <div className="margin-panel-anim">
          <div className="margin-header-ref">{displayBook} {chapter}</div>

          {semanticData && semanticData.threads.length > 0 && (
            <div className="margin-tags">
              {semanticData.threads.slice(0, 3).map((t) => (
                <span key={t.id} className="margin-tag">{t.label}</span>
              ))}
            </div>
          )}

          <div className="margin-stats">
            <div className="margin-stat">
              <div className="margin-stat-num">{activeHighlights.length}</div>
              <div className="margin-stat-label">Highlights</div>
            </div>
            <div className="margin-stat">
              <div className="margin-stat-num">{marginData.notes.length}</div>
              <div className="margin-stat-label">Notes</div>
            </div>
            <div className="margin-stat">
              <div className="margin-stat-num">{crossRefs?.totalCount ?? 0}</div>
              <div className="margin-stat-label">Cross-refs</div>
            </div>
          </div>

          <p className="margin-invite">
            Select a verse to study language, highlight, or open related notes.
          </p>
        </div>
      )}

      {/* --- State 2: Ambient "currently reading" --- */}
      {isNear && (
        <div className="margin-panel-anim">
          <div className="margin-header-ref">{nearRef}</div>
          {nearQuote && <div className="margin-focus-quote">{nearQuote}</div>}

          {nearVerse != null && (
            <LanguageWordsSection
              book={book}
              chapter={chapter}
              verse={nearVerse}
              readingPackageId={packageId}
              onStudyEngage={onStudyVerse}
            />
          )}

          {nearNote && (
            <div className="margin-section">
              <div className="margin-section-header">Note</div>
              <div className="card-title">{nearNote.title}</div>
              <div className="card-excerpt">{nearNote.body_text.slice(0, 120)}</div>
            </div>
          )}

          {(crossRefs?.items?.length ?? 0) > 0 && crossRefs && (
            <CrossRefsBlock result={crossRefs} onNavigate={onNavigateToRef} />
          )}
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
        <div className="margin-panel-anim">
          <div className="margin-header-ref">{pinnedRef}</div>
          {pinnedQuote && <div className="margin-focus-quote">{pinnedQuote}</div>}

          {/* Selection tools live on the floating mini toolbar over the text.
              Margin shows pin status + neutral multi-color state when needed. */}
          <div className={`margin-pin-status${pinnedColors.length > 1 ? " is-mixed" : ""}`}>
            <span className="margin-pin-status-label">
              {pinnedColors.length > 1
                ? "Mixed colors in selection"
                : pinnedHighlightColor
                  ? `${pinnedHighlightColor.charAt(0).toUpperCase() + pinnedHighlightColor.slice(1)} highlight`
                  : "No highlight yet"}
            </span>
            {pinnedColors.length > 1 && (
              <span className="hl-toolbar-mixed-badge">Mixed</span>
            )}
            {onCreateNote && (
              <button type="button" className="margin-pin-note-btn" onClick={() => onCreateNote()}>
                Note
              </button>
            )}
            {pinnedHighlights.length > 0 && onRemoveHighlights && (
              <button
                type="button"
                className="margin-hl-remove"
                onClick={() => onRemoveHighlights(pinnedHighlights.map((h) => h.id))}
              >
                Remove
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

          {/* Primary study surface */}
          <LanguageWordsSection
            book={book}
            chapter={chapter}
            verse={pinnedRange.start}
            readingPackageId={packageId}
            onStudyEngage={onStudyVerse}
          />

          {pinnedNote && (
            <div className="margin-section">
              <div className="margin-section-header">Note</div>
              <div className="margin-card">
                <div className="card-title">{pinnedNote.title}</div>
                <div className="card-excerpt">{pinnedNote.body_text.slice(0, 150)}</div>
              </div>
            </div>
          )}

          {/* Secondary — only when there is content */}
          {pinnedSemantic && pinnedSemantic.semanticNotes.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Related</div>
              {pinnedSemantic.semanticNotes.map((sn) => (
                <div key={sn.noteId} className="margin-card">
                  <div className="card-title">{sn.title || "Untitled"}</div>
                  <div className="card-excerpt">{sn.snippet}</div>
                  {sn.reasons && sn.reasons.length > 0 && (
                    <div className="card-reasons">
                      {sn.reasons.map((r, i) => (
                        <span key={`${r.kind}-${i}`} className={`reason-chip reason-${r.kind}`}>{r.label}</span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {pinnedSemantic && pinnedSemantic.threads.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Threads</div>
              {pinnedSemantic.threads.map((thread) => (
                <div key={thread.id} className="margin-card">
                  <div className="card-title">{thread.label}</div>
                  <div className="card-excerpt">{thread.summary}</div>
                </div>
              ))}
            </div>
          )}

          {pinnedSemantic && pinnedSemantic.claims.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Claims</div>
              {pinnedSemantic.claims.map((claim) => {
                const noteEvidence = claim.sources.filter((s) => s.kind === "note");
                const quote = noteEvidence.find((s) => s.quote)?.quote;
                return (
                  <div key={claim.id} className="margin-card">
                    <div className="card-title">{claim.assertion}</div>
                    {quote && <div className="claim-evidence-quote">&ldquo;{quote}&rdquo;</div>}
                    {!pinnedClaims.has(claim.id) && (
                      <button className="btn-pin-claim" onClick={() => handlePinClaim(claim.id, claim.assertion)}>
                        Keep
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {(crossRefs?.items?.length ?? 0) > 0 && crossRefs && (
            <CrossRefsBlock result={crossRefs} onNavigate={onNavigateToRef} />
          )}

          {pinnedSemantic && pinnedSemantic.suggestedCrossRefs.length > 0 && (
            <NoteCrossRefsBlock
              items={pinnedSemantic.suggestedCrossRefs.slice(0, 6)}
              onNavigate={onNavigateToRef}
            />
          )}

          {/* Compact AI: only while loading or when there is a real summary */}
          {pinnedAiLoading && (
            <div className="ai-insight-loading">
              <span className="ai-insight-spinner" />
              <span className="ai-insight-label">Looking at your notes…</span>
            </div>
          )}
          {!pinnedAiLoading && pinnedAiResult && (
            pinnedAiResult.threads.length > 0 ||
            pinnedAiResult.semanticNotes.length > 0 ||
            pinnedAiResult.claims.length > 0
          ) && (
            <div className="ai-insight-block">
              <div className="ai-insight-head">
                <AiSparkIcon />
              </div>
              <div className="ai-insight-text">
                {pinnedAiResult.threads[0]?.summary
                  ?? pinnedAiResult.semanticNotes[0]?.snippet
                  ?? pinnedAiResult.claims[0]?.assertion}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state — only when chapter overview has no marks at all */}
      {!isPinned && !isNear && !hasDeterministicData && !hasSemanticData && !semanticLoading && (
        <div className="margin-empty">
          <p>No notes, highlights, or cross-references for this passage yet.</p>
          <p className="margin-empty-hint">Select a verse to study language or create a highlight.</p>
        </div>
      )}

    </aside>
  );
}
