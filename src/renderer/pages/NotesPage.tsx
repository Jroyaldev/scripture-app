import React, { useState, useEffect } from "react";
import type { ParsedNoteData } from "../api.js";

interface Props {
  onEditNote: (noteId: string) => void;
  onNavigateRef: (book: string, chapter: number) => void;
}

export function NotesPage({ onEditNote, onNavigateRef: _onNavigateRef }: Props): React.JSX.Element {
  const [notes, setNotes] = useState<ParsedNoteData[]>([]);

  useEffect(() => {
    window.api.library.readAllNotes().then(setNotes);
  }, []);

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
      <div className="toolbar">
        <span style={{ fontWeight: "var(--fw-semibold)", color: "var(--text-primary)" }}>
          Notes ({notes.length})
        </span>
      </div>
      <div className="notes-list">
        {notes.map((note) => (
          <div
            key={note.frontmatter.id}
            className="note-list-item"
            onClick={() => onEditNote(note.frontmatter.id)}
          >
            <div className="note-item-title">{note.frontmatter.title}</div>
            <div className="note-item-meta">
              {note.frontmatter.type && <span>{note.frontmatter.type} &middot; </span>}
              {note.scriptureRefs.length > 0 && (
                <span>{note.scriptureRefs.length} scripture ref{note.scriptureRefs.length !== 1 ? "s" : ""} &middot; </span>
              )}
              {note.noteLinks.length > 0 && (
                <span>{note.noteLinks.length} link{note.noteLinks.length !== 1 ? "s" : ""} &middot; </span>
              )}
              <span>{new Date(note.frontmatter.modified).toLocaleDateString()}</span>
            </div>
            <div style={{
              fontSize: "var(--fs-xs)", color: "var(--text-tertiary)",
              marginTop: "var(--sp-xs)",
              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
            }}>
              {note.body.slice(0, 200)}
            </div>
          </div>
        ))}
        {notes.length === 0 && (
          <div style={{
            textAlign: "center", padding: "var(--sp-3xl)",
            color: "var(--text-tertiary)",
          }}>
            No notes yet. Create one from the Write page or while reading Scripture.
          </div>
        )}
      </div>
    </div>
  );
}
