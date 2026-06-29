import React, { useState, useEffect, useCallback } from "react";
import { ScripturePage } from "./pages/ScripturePage.js";
import { NotesPage } from "./pages/NotesPage.js";
import { WritingSheet } from "./pages/WritingSheet.js";
import { SearchPage } from "./pages/SearchPage.js";
import { ImportPage } from "./pages/ImportPage.js";
import type { BackboneData, BookNameData } from "./api.js";

type Page = "scripture" | "notes" | "write" | "search" | "import";

export function App(): React.JSX.Element {
  const [page, setPage] = useState<Page>("scripture");
  const [backbone, setBackbone] = useState<BackboneData | null>(null);
  const [bookNames, setBookNames] = useState<BookNameData | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [navigateRef, setNavigateRef] = useState<{ book: string; chapter: number } | null>(null);

  useEffect(() => {
    window.api.scripture.getBackbone().then(setBackbone);
    window.api.scripture.getBookNames().then(setBookNames);
  }, []);

  const handleNavigateToRef = useCallback((book: string, chapter: number) => {
    setNavigateRef({ book, chapter });
    setPage("scripture");
  }, []);

  const handleEditNote = useCallback((noteId: string) => {
    setEditingNoteId(noteId);
    setPage("write");
  }, []);

  const handleCreateNote = useCallback((_prefillBody?: string) => {
    setEditingNoteId(null);
    setPage("write");
  }, []);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-header">
          <h1>Scripture</h1>
        </div>
        <nav className="sidebar-nav">
          <button
            className={page === "scripture" ? "active" : ""}
            onClick={() => setPage("scripture")}
          >
            Read
          </button>
          <button
            className={page === "notes" ? "active" : ""}
            onClick={() => setPage("notes")}
          >
            Notes
          </button>
          <button
            className={page === "write" ? "active" : ""}
            onClick={() => { setEditingNoteId(null); setPage("write"); }}
          >
            Write
          </button>
          <button
            className={page === "search" ? "active" : ""}
            onClick={() => setPage("search")}
          >
            Search
          </button>
          <button
            className={page === "import" ? "active" : ""}
            onClick={() => setPage("import")}
          >
            Import
          </button>
        </nav>
      </aside>

      <div className="main-content">
        {page === "scripture" && backbone && bookNames && (
          <ScripturePage
            backbone={backbone}
            bookNames={bookNames}
            navigateRef={navigateRef}
            onCreateNote={handleCreateNote}
          />
        )}
        {page === "notes" && (
          <NotesPage
            onEditNote={handleEditNote}
            onNavigateRef={handleNavigateToRef}
          />
        )}
        {page === "write" && (
          <WritingSheet
            editingNoteId={editingNoteId}
            onNavigateRef={handleNavigateToRef}
          />
        )}
        {page === "search" && (
          <SearchPage
            onEditNote={handleEditNote}
            onNavigateRef={handleNavigateToRef}
          />
        )}
        {page === "import" && (
          <ImportPage />
        )}
      </div>
    </div>
  );
}
