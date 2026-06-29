import type React from "react";
import type { QueryResult, BookNameData } from "../api.js";

interface Props {
  book: string;
  chapter: number;
  marginData: QueryResult;
  crossRefs: string[];
  bookNames: BookNameData;
}

export function LivingMargin({ book, chapter, marginData, crossRefs, bookNames }: Props): React.JSX.Element {
  const displayBook = bookNames[book]?.[0] ?? book;

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

      {/* Cross-References */}
      {crossRefs.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-header">Cross-References</div>
          {crossRefs.slice(0, 20).map((ref, i) => (
            <span key={i} className="xref-link">
              {ref}
              <span className="card-provenance provenance-xref" style={{ marginLeft: "var(--sp-xs)", fontSize: "0.625rem" }}>
                TSK
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Empty state */}
      {marginData.notes.length === 0 && marginData.highlights.length === 0 && crossRefs.length === 0 && (
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
    yellow: "rgba(250, 214, 100, 0.6)",
    green: "rgba(120, 200, 120, 0.5)",
    blue: "rgba(120, 170, 230, 0.5)",
    pink: "rgba(230, 140, 170, 0.5)",
    purple: "rgba(170, 140, 220, 0.5)",
  };
  return map[color] ?? map["yellow"]!;
}
