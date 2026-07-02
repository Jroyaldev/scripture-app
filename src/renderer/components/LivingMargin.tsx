import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { AnchorRecord, BookNameData, NoteRecord, QueryResult, SemanticMarginResult } from "../api.js";
import { safeCall } from "../utils/safeCall.js";

export interface PinnedRange {
  start: number;
  end: number;
}

interface Props {
  book: string;
  chapter: number;
  marginData: QueryResult;
  crossRefs: string[];
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
  /** Remove the highlight covering the pinned range. */
  onRemoveHighlight?: (entityId: string) => void;
  /** Navigate to a cross-reference's target passage (e.g. "Matthew 3:11"). */
  onNavigateToRef?: (ref: string) => void;
}

const HIGHLIGHT_SWATCHES: { color: string; hex: string }[] = [
  { color: "yellow", hex: "#D9A406" },
  { color: "green", hex: "#3E9142" },
  { color: "blue", hex: "#3D6BB5" },
  { color: "pink", hex: "#C2578A" },
  { color: "purple", hex: "#7C5CB0" },
];

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

export function LivingMargin({
  book,
  chapter,
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
  onRemoveHighlight,
  onNavigateToRef,
}: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());

  // Session-only cache of AI insight results for the pinned range, keyed by
  // `${book}:${chapter}:${start}-${end}`. Avoids re-triggering the call when
  // re-pinning the same range.
  const aiCacheRef = useRef<Map<string, SemanticMarginResult | null>>(new Map());
  const [aiCacheVersion, setAiCacheVersion] = useState(0);

  const handlePinClaim = (claimId: string, assertion: string) => {
    if (onPinClaim) {
      onPinClaim(claimId, assertion);
      setPinnedClaims((prev) => new Set(prev).add(claimId));
    }
  };

  const activeHighlights = marginData.highlights.filter((h) => h.deleted === 0);
  const hasDeterministicData = marginData.notes.length > 0 || activeHighlights.length > 0 || crossRefs.length > 0;
  const hasSemanticData = semanticData && (
    semanticData.semanticNotes.length > 0 ||
    semanticData.threads.length > 0 ||
    semanticData.claims.length > 0 ||
    semanticData.suggestedCrossRefs.length > 0
  );

  const isPinned = !!pinnedRange;
  const isNear = !isPinned && nearVerse != null;

  const pinKey = pinnedRange ? `${book}:${chapter}:${pinnedRange.start}-${pinnedRange.end}` : null;

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
  const pinnedHighlight = pinnedRange
    ? activeHighlights.find((h) => h.chapter === chapter && h.verse_start <= pinnedRange.end && h.verse_end >= pinnedRange.start)
    : null;
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

  const nearNote = nearVerse != null ? findNoteForRange(marginData, chapter, nearVerse, nearVerse) : null;
  const nearHighlight = nearVerse != null
    ? activeHighlights.find((h) => h.chapter === chapter && h.verse_start <= nearVerse && h.verse_end >= nearVerse)
    : null;
  const nearXrefs = nearVerse != null ? crossRefs.filter((r) => r.includes(`:${nearVerse}`)) : [];
  const nearQuote = nearVerse != null ? chapterVerseText?.get(nearVerse) ?? "" : "";
  const nearRef = nearVerse != null ? `${displayBook} ${chapter}:${nearVerse}` : "";

  return (
    <aside className="living-margin">
      {/* --- State 1: Chapter overview (default) --- */}
      {!isPinned && !isNear && (
        <div className="margin-panel-anim">
          <div className="margin-header-label">Chapter Overview</div>
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
              <div className="margin-stat-num">{crossRefs.length}</div>
              <div className="margin-stat-label">Cross-refs</div>
            </div>
          </div>

          <div className="margin-hint">
            {activeHighlights.length + marginData.notes.length + crossRefs.length} item
            {activeHighlights.length + marginData.notes.length + crossRefs.length === 1 ? "" : "s"} in this chapter.
            Scroll to preview nearby highlights and notes — click a verse to pin it here.
          </div>
        </div>
      )}

      {/* --- State 2: Ambient "currently reading" --- */}
      {isNear && (
        <div className="margin-panel-anim">
          <div className="margin-header-label margin-near-label">
            <i className="margin-live-dot" />
            Currently Reading
          </div>
          <div className="margin-header-ref">{nearRef}</div>
          {nearQuote && <div className="margin-focus-quote">{nearQuote}</div>}

          {nearHighlight && (
            <div className={`margin-hl-pill hl-${nearHighlight.color}`}>
              {nearHighlight.color.charAt(0).toUpperCase() + nearHighlight.color.slice(1)} highlight
            </div>
          )}

          {nearNote && (
            <div className="margin-section">
              <div className="margin-section-header">Your Note</div>
              <div className="card-title">{nearNote.title}</div>
              <div className="card-excerpt">{nearNote.body_text.slice(0, 150)}</div>
            </div>
          )}

          {nearXrefs.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Cross-References</div>
              {nearXrefs.slice(0, 5).map((ref, i) => (
                <button key={`${ref}-${i}`} className="xref-link" onClick={() => onNavigateToRef?.(ref)}>{ref}</button>
              ))}
              {/* Ambient state stays glanceable — the full list is one click
                  away (pin the verse) rather than growing unbounded here. */}
              {nearXrefs.length > 5 && (
                <div className="xref-more-hint">+{nearXrefs.length - 5} more — click the verse to see all</div>
              )}
            </div>
          )}
        </div>
      )}

      {/* --- State 3: Selected / pinned passage --- */}
      {isPinned && (
        <div className="margin-panel-anim">
          <div className="margin-header-label">Selected Passage</div>
          <div className="margin-header-ref">{pinnedRef}</div>
          {pinnedQuote && <div className="margin-focus-quote">{pinnedQuote}</div>}

          <div className="margin-hl-palette">
            {HIGHLIGHT_SWATCHES.map((s) => (
              <button
                key={s.color}
                className={`margin-hl-swatch${pinnedHighlight?.color === s.color ? " active" : ""}`}
                style={{ background: s.hex }}
                title={s.color}
                onClick={() => onSetHighlightColor?.(s.color)}
              />
            ))}
            {pinnedHighlight && onRemoveHighlight && (
              <button
                className="margin-hl-remove"
                onClick={() => onRemoveHighlight(pinnedHighlight.id)}
              >
                Remove
              </button>
            )}
          </div>

          {pinnedNote && (
            <div className="margin-section">
              <div className="margin-section-header">Your Note</div>
              <div className="margin-card">
                <div className="card-title">{pinnedNote.title}</div>
                <div className="card-excerpt">{pinnedNote.body_text.slice(0, 150)}</div>
                <span className="card-provenance provenance-user">user</span>
              </div>
            </div>
          )}

          {/* Related Notes (Semantic) */}
          {semanticData && semanticData.semanticNotes.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Related Notes (Semantic)</div>
              {semanticData.semanticNotes.map((sn) => (
                <div key={sn.noteId} className="margin-card">
                  <div className="card-title">{sn.title || "Untitled"}</div>
                  <div className="card-excerpt">{sn.snippet}</div>
                  <span className="card-provenance provenance-ai">ai &middot; {(sn.similarity * 100).toFixed(0)}%</span>
                </div>
              ))}
            </div>
          )}

          {/* Threads (AI) */}
          {semanticData && semanticData.threads.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Threads</div>
              {semanticData.threads.map((thread) => (
                <div key={thread.id} className="margin-card">
                  <div className="card-title">{thread.label}</div>
                  <div className="card-excerpt">{thread.summary}</div>
                  <span className="card-provenance provenance-ai">ai &middot; thread</span>
                </div>
              ))}
            </div>
          )}

          {/* Claims (AI) */}
          {semanticData && semanticData.claims.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Claims</div>
              {semanticData.claims.map((claim) => (
                <div key={claim.id} className="margin-card">
                  <div className="card-title">{claim.assertion}</div>
                  <div className="card-excerpt">
                    {claim.claimType} &middot; confidence {(claim.confidence * 100).toFixed(0)}%
                  </div>
                  {pinnedClaims.has(claim.id) ? (
                    <span className="card-provenance provenance-user" style={{ marginTop: "var(--sp-xs)" }}>pinned</span>
                  ) : (
                    <button className="btn-pin-claim" onClick={() => handlePinClaim(claim.id, claim.assertion)}>
                      Pin as FactCard
                    </button>
                  )}
                  <span className="card-provenance provenance-ai" style={{ marginLeft: "var(--sp-xs)" }}>ai</span>
                </div>
              ))}
            </div>
          )}

          {/* Cross-References (TSK) */}
          {crossRefs.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Cross-References</div>
              {crossRefs.slice(0, 20).map((ref, i) => (
                <button key={`${ref}-${i}`} className="xref-link" onClick={() => onNavigateToRef?.(ref)}>
                  {ref}
                  <span className="card-provenance provenance-xref" style={{ marginLeft: "var(--sp-xs)", fontSize: "0.625rem" }}>
                    TSK
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* AI Suggested Cross-References */}
          {semanticData && semanticData.suggestedCrossRefs.length > 0 && (
            <div className="margin-section">
              <div className="margin-section-header">Suggested Cross-Refs (AI)</div>
              {semanticData.suggestedCrossRefs.slice(0, 10).map((xref, i) => (
                <button key={`${xref.targetBref}-${i}`} className="xref-link" onClick={() => onNavigateToRef?.(xref.targetDisplay)}>
                  {xref.targetDisplay}
                  <span className="card-provenance provenance-ai" style={{ marginLeft: "var(--sp-xs)", fontSize: "0.625rem" }}>
                    ai
                  </span>
                </button>
              ))}
            </div>
          )}

          {/* Chapter-wide semantic loading indicator (unrelated to the pinned-range AI insight below) */}
          {semanticLoading && (
            <div className="margin-section">
              <div className="margin-section-header">AI Analysis</div>
              <div className="semantic-loading">
                <div className="loading-spinner-sm" />
                <span>Analyzing passage...</span>
              </div>
            </div>
          )}

          {/* Pinned-range-scoped AI insight (3 states: loading / result / none) */}
          <div className="margin-section">
            <div className="margin-section-header">AI Insight</div>
            {pinnedAiLoading && (
              <div className="ai-insight-loading">
                <span className="ai-insight-spinner" />
                Analyzing passage...
              </div>
            )}
            {!pinnedAiLoading && pinnedAiResult && (
              pinnedAiResult.threads.length > 0 || pinnedAiResult.semanticNotes.length > 0 || pinnedAiResult.claims.length > 0
            ) && (
              <div className="ai-insight-block">
                <div className="ai-insight-head">
                  <AiSparkIcon />
                  Semantic thread
                </div>
                <div className="ai-insight-text">
                  {pinnedAiResult.threads[0]?.summary
                    ?? pinnedAiResult.semanticNotes[0]?.snippet
                    ?? pinnedAiResult.claims[0]?.assertion}
                </div>
              </div>
            )}
            {!pinnedAiLoading && (
              !pinnedAiResult || (
                pinnedAiResult.threads.length === 0 && pinnedAiResult.semanticNotes.length === 0 && pinnedAiResult.claims.length === 0
              )
            ) && (
              <div className="ai-insight-none">No notable connections surfaced for this verse.</div>
            )}
          </div>
        </div>
      )}

      {/* Empty state — only meaningful in the default chapter-overview mode */}
      {!isPinned && !isNear && !hasDeterministicData && !hasSemanticData && !semanticLoading && (
        <div className="margin-empty">
          <p>No notes, highlights, or cross-references for this passage yet.</p>
          <p className="margin-empty-hint">Select a verse to create a highlight or note.</p>
        </div>
      )}

    </aside>
  );
}
