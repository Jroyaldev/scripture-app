import React, { useState, useCallback } from "react";
import type { NoteData } from "../api.js";

interface Props {
  onEditNote: (noteId: string) => void;
  onNavigateRef: (book: string, chapter: number) => void;
}

export function SearchPage({ onEditNote }: Props): React.JSX.Element {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteData[]>([]);
  const [searched, setSearched] = useState(false);

  const handleSearch = useCallback(async (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) {
      setResults([]);
      setSearched(false);
      return;
    }
    const res = await window.api.library.search(q);
    setResults(res);
    setSearched(true);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="search-bar">
        <input
          className="search-input"
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search notes (FTS5)..."
          autoFocus
        />
      </div>
      <div className="search-results">
        {results.map((note) => (
          <div
            key={note.id}
            className="search-result-item"
            onClick={() => onEditNote(note.id)}
          >
            <div className="result-title">{note.title}</div>
            <div className="result-excerpt">{note.body_text.slice(0, 200)}</div>
          </div>
        ))}
        {searched && results.length === 0 && (
          <div style={{
            textAlign: "center", padding: "var(--sp-2xl)",
            color: "var(--text-tertiary)",
          }}>
            No results for "{query}"
          </div>
        )}
        {!searched && (
          <div style={{
            textAlign: "center", padding: "var(--sp-3xl)",
            color: "var(--text-tertiary)",
          }}>
            Type to search across all notes (full-text search via FTS5).
          </div>
        )}
      </div>
    </div>
  );
}
