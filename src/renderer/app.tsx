/**
 * Renderer entry point — React app for the Scripture Library desktop shell.
 */

import { useState, useCallback, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ScripturePage } from "./components/ScripturePage.js";
import { WritingSheet } from "./components/WritingSheet.js";
import { SearchView } from "./components/SearchView.js";
import { LivingMargin } from "./components/LivingMargin.js";
import type { CanonicalRef } from "../core/reference/types.js";
import type { MarginResult } from "../core/margin/types.js";

type View = "scripture" | "write" | "search" | "notes";

declare global {
  interface Window {
    electronAPI: {
      getLibraryInfo(): Promise<{ path: string; hasLibrary: boolean } | null>;
      resolveReference(input: string): Promise<{ ok: boolean; value?: CanonicalRef; error?: string }>;
      formatBref(ref: CanonicalRef): Promise<string>;
      formatDisplay(ref: CanonicalRef): Promise<string>;
      getMargin(query: { book: string; startChapter: number; startVerse: number; endChapter: number; endVerse: number }): Promise<MarginResult>;
      searchNotes(query: string): Promise<Array<{ id: string; title: string; body_text: string }>>;
      createNote(opts: { title: string; body: string; tags?: string[] }): Promise<{ ok: boolean; noteId?: string }>;
      getAllNotes(): Promise<Array<{ id: string; title: string; body_text: string }>>;
      getNote(id: string): Promise<{ id: string; title: string; body_text: string } | null>;
      getBackbone(): Promise<unknown>;
      getBookNames(): Promise<Record<string, string[]>>;
      importObsidianVault(path: string): Promise<{ ok: boolean; stats?: { imported: number; linksResolved: number; linksUnresolved: number } }>;
      readScriptureText(opts: { book: string; chapter: number; package: string }): Promise<{ verses: Array<{ verse: number; text: string }> } | null>;
      createHighlight(opts: { book: string; chapter: number; verseStart: number; verseEnd: number; color: string; package: string }): Promise<{ ok: boolean }>;
      rebuildSqlite(): Promise<string | null>;
    };
  }
}

function App() {
  const [view, setView] = useState<View>("scripture");
  const [activeRef, setActiveRef] = useState<CanonicalRef | null>(null);
  const [marginResult, setMarginResult] = useState<MarginResult | null>(null);
  const [bookNames, setBookNames] = useState<Record<string, string[]>>({});

  useEffect(() => {
    // Load initial data
    void window.electronAPI.getBookNames().then(setBookNames);
    // Default to Acts 19
    void window.electronAPI.resolveReference("Acts 19:1-7").then((result) => {
      if (result.ok && result.value) {
        setActiveRef(result.value);
      }
    });
  }, []);

  useEffect(() => {
    if (!activeRef) return;
    void window.electronAPI.getMargin({
      book: activeRef.start.book,
      startChapter: activeRef.start.chapter,
      startVerse: activeRef.start.verse,
      endChapter: activeRef.end.chapter,
      endVerse: activeRef.end.verse,
    }).then(setMarginResult);
  }, [activeRef]);

  const handleNavigate = useCallback(async (input: string) => {
    const result = await window.electronAPI.resolveReference(input);
    if (result.ok && result.value) {
      setActiveRef(result.value);
      setView("scripture");
    }
  }, []);

  const handleCreateNote = useCallback(async (title: string, body: string) => {
    const result = await window.electronAPI.createNote({ title, body });
    if (result.ok) {
      // Refresh margin after creating note
      if (activeRef) {
        const margin = await window.electronAPI.getMargin({
          book: activeRef.start.book,
          startChapter: activeRef.start.chapter,
          startVerse: activeRef.start.verse,
          endChapter: activeRef.end.chapter,
          endVerse: activeRef.end.verse,
        });
        setMarginResult(margin);
      }
    }
    return result;
  }, [activeRef]);

  return (
    <div className="app-layout">
      <aside className="sidebar">
        <div className="sidebar-header">
          <strong style={{ fontSize: "0.875rem" }}>Scripture Library</strong>
        </div>
        <nav className="sidebar-nav">
          <button className={view === "scripture" ? "active" : ""} onClick={() => setView("scripture")}>
            Scripture
          </button>
          <button className={view === "write" ? "active" : ""} onClick={() => setView("write")}>
            New Note
          </button>
          <button className={view === "notes" ? "active" : ""} onClick={() => setView("notes")}>
            All Notes
          </button>
          <button className={view === "search" ? "active" : ""} onClick={() => setView("search")}>
            Search
          </button>
        </nav>
      </aside>

      <div className="main-content">
        {view === "scripture" && (
          <ScripturePage
            activeRef={activeRef}
            bookNames={bookNames}
            onNavigate={handleNavigate}
          />
        )}
        {view === "write" && (
          <WritingSheet
            activeRef={activeRef}
            onSave={handleCreateNote}
            bookNames={bookNames}
          />
        )}
        {view === "search" && <SearchView onNavigate={handleNavigate} />}
        {view === "notes" && <SearchView onNavigate={handleNavigate} showAll />}

        {view === "scripture" && (
          <LivingMargin
            result={marginResult}
            onCrossRefClick={handleNavigate}
          />
        )}
      </div>
    </div>
  );
}

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
