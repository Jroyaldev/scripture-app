import type React from "react";
import { useState, useEffect, useCallback } from "react";
import type { NoteSearchResult, ParsedNoteData } from "../api.js";

interface Props {
  onNavigate: (book: string, chapter: number) => void;
  showAll?: boolean;
}

export function SearchView({ onNavigate, showAll }: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteSearchResult[]>([]);
  const [allNotes, setAllNotes] = useState<ParsedNoteData[]>([]);

  useEffect(() => {
    if (showAll) {
      window.api.library.readAllNotes().then(setAllNotes);
    }
  }, [showAll]);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      return;
    }
    const searchResults = await window.api.library.search(q);
    setResults(searchResults);
  }, []);

  if (showAll) {
    return (
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="toolbar">
          <span style={{ fontSize: "var(--fs-sm)", fontWeight: "var(--fw-medium)" }}>
            All Notes ({allNotes.length})
          </span>
        </div>
        <div className="notes-list">
          {allNotes.map((note) => {
            const firstRef = note.scriptureRefs[0];
            return (
              <div
                key={note.frontmatter.id}
                className="note-list-item"
                onClick={() => {
                  if (firstRef) {
                    window.api.ref.parseBref(firstRef.bref).then((res) => {
                      if (res.ok && res.bref) {
                        const parts = res.bref.replace("bref:v1/", "").split(".");
                        const b = parts[0] ?? "";
                        const ch = Number(parts[1] ?? 1);
                        if (b) onNavigate(b, ch);
                      }
                    });
                  }
                }}
              >
                <div className="note-item-title">{note.frontmatter.title}</div>
                <div className="note-item-meta">
                  {note.frontmatter.modified} &middot; {note.frontmatter.tags?.join(", ") || "no tags"}
                </div>
              </div>
            );
          })}
          {allNotes.length === 0 && (
            <p style={{ padding: "var(--sp-xl)", color: "var(--text-tertiary)", textAlign: "center" }}>
              No notes yet. Create one from the Write tab or by selecting a passage.
            </p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="search-bar">
        <input
          className="search-input"
          type="text"
          placeholder="Search notes... (FTS5)"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="search-results">
        {results.map((note) => (
          <div key={note.id} className="search-result-item">
            <div className="result-title">{note.title}</div>
            <div className="result-excerpt">{note.body_text.slice(0, 200)}</div>
          </div>
        ))}
        {query.trim().length >= 2 && results.length === 0 && (
          <p style={{ padding: "var(--sp-xl)", color: "var(--text-tertiary)", textAlign: "center" }}>
            No results for &ldquo;{query}&rdquo;
          </p>
        )}
        {query.trim().length < 2 && (
          <p style={{ padding: "var(--sp-xl)", color: "var(--text-tertiary)", textAlign: "center" }}>
            Type at least 2 characters to search.
          </p>
        )}
      </div>
    </div>
  );
}
