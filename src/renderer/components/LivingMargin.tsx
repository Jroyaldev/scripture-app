import type React from "react";
import { useState } from "react";
import type { QueryResult, BookNameData, SemanticMarginResult } from "../api.js";

interface Props {
  book: string;
  chapter: number;
  marginData: QueryResult;
  crossRefs: string[];
  bookNames: BookNameData;
  semanticData?: SemanticMarginResult | null;
  onPinClaim?: (claimId: string, assertion: string) => void;
}

export function LivingMargin({ book, chapter, marginData, crossRefs, bookNames, semanticData, onPinClaim }: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;
  const [pinnedClaims, setPinnedClaims] = useState<Set<string>>(new Set());

  const handlePinClaim = (claimId: string, assertion: string) => {
    if (onPinClaim) {
      onPinClaim(claimId, assertion);
      setPinnedClaims((prev) => new Set(prev).add(claimId));
    }
  };

  return (
    <aside className="living-margin">
      <div style={{ marginBottom: "var(--sp-lg)" }}>
        <div style={{
          fontFamily: "var(--font-reading)", fontSize: "var(--fs-sm)",
          color: "var(--text-tertiary)", fontWeight: "var(--fw-medium)",
        }}>
          Living Margin
        </div>
        <div style={{ fontSize: "var(--fs-xs)", color: "var(--text-tertiary)" }}>
          {displayBook} {chapter}
        </div>
      </div>

      {/* User Notes */}
      {marginData.notes.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-header">Your Notes</div>
          {marginData.notes.map((note) => (
            <div key={note.id} className="margin-card">
              <div className="card-title">{note.title}</div>
              <div className="card-excerpt">{note.body_text.slice(0, 150)}</div>
              <span className="card-provenance provenance-user">user</span>
            </div>
          ))}
        </div>
      )}

      {/* Semantic Notes (AI) */}
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
                <button
                  onClick={() => handlePinClaim(claim.id, claim.assertion)}
                  style={{
                    marginTop: "var(--sp-xs)",
                    padding: "2px 8px",
                    fontSize: "var(--fs-xs)",
                    background: "transparent",
                    border: "1px solid var(--border-medium)",
                    borderRadius: "3px",
                    color: "var(--text-secondary)",
                    cursor: "pointer",
                  }}
                >
                  Pin as FactCard
                </button>
              )}
              <span className="card-provenance provenance-ai" style={{ marginLeft: "var(--sp-xs)" }}>ai</span>
            </div>
          ))}
        </div>
      )}

      {/* Highlights */}
      {marginData.highlights.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-header">Highlights</div>
          {marginData.highlights.filter((h) => h.deleted === 0).map((h) => (
            <div key={h.id} className="margin-card" style={{ padding: "var(--sp-sm) var(--sp-md)" }}>
              <span className="highlight-swatch" style={{ background: getHighlightColor(h.color) }} />
              <span style={{ fontSize: "var(--fs-sm)", color: "var(--text-secondary)" }}>
                {displayBook} {h.chapter}:{h.verse_start}
                {h.verse_end !== h.verse_start ? `\u2013${h.verse_end}` : ""}
              </span>
              <span className="card-provenance provenance-user" style={{ marginLeft: "var(--sp-sm)" }}>user</span>
            </div>
          ))}
        </div>
      )}

      {/* Cross-References (TSK) */}
      {crossRefs.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-header">Cross-References</div>
          {crossRefs.slice(0, 20).map((ref, i) => (
            <span key={`${ref}-${i}`} className="xref-link">
              {ref}
              <span className="card-provenance provenance-xref" style={{ marginLeft: "var(--sp-xs)", fontSize: "0.625rem" }}>
                TSK
              </span>
            </span>
          ))}
        </div>
      )}

      {/* AI Suggested Cross-References */}
      {semanticData && semanticData.suggestedCrossRefs.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-header">Suggested Cross-Refs (AI)</div>
          {semanticData.suggestedCrossRefs.slice(0, 10).map((xref, i) => (
            <span key={`${xref.targetBref}-${i}`} className="xref-link">
              {xref.targetDisplay}
              <span className="card-provenance provenance-ai" style={{ marginLeft: "var(--sp-xs)", fontSize: "0.625rem" }}>
                ai
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Empty state */}
      {marginData.notes.length === 0 && marginData.highlights.length === 0 && crossRefs.length === 0 &&
        (!semanticData || (semanticData.semanticNotes.length === 0 && semanticData.claims.length === 0)) && (
        <div style={{
          textAlign: "center", padding: "var(--sp-2xl)",
          color: "var(--text-tertiary)", fontSize: "var(--fs-sm)",
        }}>
          <p>No notes, highlights, or cross-references for this passage yet.</p>
          <p style={{ marginTop: "var(--sp-sm)", fontSize: "var(--fs-xs)" }}>
            Select a verse to create a highlight or note.
          </p>
        </div>
      )}
    </aside>
  );
}

function getHighlightColor(color: string): string {
  const map: Record<string, string> = {
    yellow: "rgba(245, 213, 115, 0.5)",
    green: "rgba(110, 195, 120, 0.4)",
    blue: "rgba(110, 165, 225, 0.4)",
    pink: "rgba(220, 140, 165, 0.4)",
    purple: "rgba(165, 140, 215, 0.4)",
  };
  return map[color] ?? map["yellow"]!;
}
