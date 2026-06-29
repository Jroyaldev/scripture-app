/**
 * Living Margin — deterministic resurfacing panel.
 * Shows notes, highlights, backlinks, and cross-references for the active passage.
 * Each item tagged by provenance (user/source).
 */

// Living Margin component
import type { MarginResult } from "../../core/margin/types.js";

type Props = {
  result: MarginResult | null;
  onCrossRefClick: (bref: string) => void;
};

export function LivingMargin({ result, onCrossRefClick }: Props) {
  if (!result) {
    return (
      <aside className="living-margin">
        <div className="empty-state" style={{ padding: "2rem 1rem" }}>
          <p style={{ fontSize: "0.875rem" }}>Select a passage to see related material.</p>
        </div>
      </aside>
    );
  }

  const hasContent =
    result.notes.length > 0 ||
    result.highlights.length > 0 ||
    result.crossRefs.length > 0 ||
    result.backlinks.length > 0;

  return (
    <aside className="living-margin">
      {!hasContent && (
        <div className="empty-state" style={{ padding: "2rem 1rem" }}>
          <p style={{ fontSize: "0.875rem" }}>No related material yet. Create notes or highlights to populate the margin.</p>
        </div>
      )}

      {result.notes.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-title">Your Notes</div>
          {result.notes.map((note) => (
            <div key={note.noteId} className="margin-item">
              <div className="title">{note.title}</div>
              <div className="snippet">{note.snippet}</div>
              <span className="provenance-tag user">user</span>
            </div>
          ))}
        </div>
      )}

      {result.highlights.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-title">Highlights</div>
          {result.highlights.map((hl) => (
            <div key={hl.highlightId} className="margin-item">
              <div className="title" style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: "50%",
                    background: hl.color === "yellow" ? "#f0c040" : hl.color === "green" ? "#5cb85c" : hl.color === "blue" ? "#5bc0de" : "#d9534f",
                    display: "inline-block",
                  }}
                />
                Verses {hl.verseStart}–{hl.verseEnd}
              </div>
              <span className="provenance-tag user">user</span>
            </div>
          ))}
        </div>
      )}

      {result.backlinks.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-title">Backlinks</div>
          {result.backlinks.map((bl) => (
            <div key={bl.noteId} className="margin-item">
              <div className="title">{bl.title}</div>
              <div className="snippet">{bl.snippet}</div>
              <span className="provenance-tag user">user</span>
            </div>
          ))}
        </div>
      )}

      {result.crossRefs.length > 0 && (
        <div className="margin-section">
          <div className="margin-section-title">Cross-References</div>
          {result.crossRefs.map((xref, i) => (
            <div
              key={i}
              className="margin-crossref"
              onClick={() => onCrossRefClick(xref.targetBref)}
            >
              {xref.targetDisplay}
              <span className="provenance-tag source" style={{ marginLeft: 6 }}>
                {xref.sourceName}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}
