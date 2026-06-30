import type React from "react";
import { useState, useEffect } from "react";
import type { BackboneData, BookNameData } from "./api.js";
import { ScripturePage } from "./components/ScripturePage.js";
import { WritingSheet } from "./components/WritingSheet.js";
import { SearchView } from "./components/SearchView.js";
import { ImportPage } from "./components/ImportPage.js";
import { BudgetSettings } from "./components/BudgetSettings.js";
import "./styles.css";

type View = "scripture" | "write" | "search" | "notes" | "import" | "settings";

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("scripture");
  const [backbone, setBackbone] = useState<BackboneData | null>(null);
  const [bookNames, setBookNames] = useState<BookNameData | null>(null);
  const [navigateRef, setNavigateRef] = useState<{ book: string; chapter: number } | null>(null);
  const [editNoteBody, setEditNoteBody] = useState<string>("");

  useEffect(() => {
    window.api.scripture.getBackbone().then(setBackbone);
    window.api.scripture.getBookNames().then(setBookNames);
  }, []);

  const handleCreateNoteFromPassage = (prefillBody?: string) => {
    setEditNoteBody(prefillBody ?? "");
    setView("write");
  };

  const handleNavigateToRef = (book: string, chapter: number) => {
    setNavigateRef({ book, chapter });
    setView("scripture");
  };

  if (!backbone || !bookNames) {
    return (
      <div className="app-shell" style={{ alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: "var(--text-tertiary)" }}>Loading library...</p>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-header">
          <h1>Scripture</h1>
        </div>
        <div className="sidebar-nav">
          <button className={view === "scripture" ? "active" : ""} onClick={() => setView("scripture")}>
            Read
          </button>
          <button className={view === "write" ? "active" : ""} onClick={() => setView("write")}>
            Write
          </button>
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
            Search
          </button>
          <button className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}>
            Notes
          </button>
          <button className={view === "import" ? "active" : ""} onClick={() => setView("import")}>
            Import
          </button>
          <button className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
            Settings
          </button>
        </div>
      </nav>
      <div className="main-content">
        {view === "scripture" && (
          <ScripturePage
            backbone={backbone}
            bookNames={bookNames}
            navigateRef={navigateRef}
            onCreateNote={handleCreateNoteFromPassage}
          />
        )}
        {view === "write" && (
          <WritingSheet
            prefillBody={editNoteBody}
            onSaved={() => setEditNoteBody("")}
          />
        )}
        {view === "search" && (
          <SearchView onNavigate={handleNavigateToRef} />
        )}
        {view === "notes" && (
          <SearchView onNavigate={handleNavigateToRef} showAll />
        )}
        {view === "import" && (
          <ImportPage />
        )}
        {view === "settings" && (
          <BudgetSettings />
        )}
      </div>
    </div>
  );
}
