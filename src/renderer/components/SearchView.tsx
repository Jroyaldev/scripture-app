/**
 * Search view — full-text search over notes (FTS5).
 * Also doubles as "All Notes" view when showAll is true.
 */

import { useState, useCallback, useEffect } from "react";

type NoteResult = {
  id: string;
  title: string;
  body_text: string;
};

type Props = {
  onNavigate: (input: string) => void;
  showAll?: boolean;
};

export function SearchView({ onNavigate: _onNavigate, showAll }: Props) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<NoteResult[]>([]);
  const [allNotes, setAllNotes] = useState<NoteResult[]>([]);

  useEffect(() => {
    if (showAll) {
      void window.electronAPI.getAllNotes().then(setAllNotes);
    }
  }, [showAll]);

  const handleSearch = useCallback(
    async (q: string) => {
      setQuery(q);
      if (!q.trim()) {
        setResults([]);
        return;
      }
      const searchResults = await window.electronAPI.searchNotes(q);
      setResults(searchResults);
    },
    [],
  );

  const displayResults = showAll && !query.trim() ? allNotes : results;

  return (
    <div className="search-view">
      <input
        className="search-input"
        value={query}
        onChange={(e) => handleSearch(e.target.value)}
        placeholder={showAll ? "Filter notes..." : "Search notes (FTS5)..."}
        autoFocus
      />

      {displayResults.length === 0 && query.trim() && (
        <div className="empty-state">
          <p>No results found.</p>
        </div>
      )}

      {displayResults.length === 0 && !query.trim() && !showAll && (
        <div className="empty-state">
          <h2>Full-Text Search</h2>
          <p>Search across all your notes by content.</p>
        </div>
      )}

      {displayResults.map((note) => (
        <div key={note.id} className="search-result">
          <div className="result-title">{note.title}</div>
          <div className="result-snippet">
            {truncate(note.body_text, 200)}
          </div>
        </div>
      ))}
    </div>
  );
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + "...";
}
