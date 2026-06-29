import React, { useState, useCallback, useEffect, useRef } from "react";
import type { ParsedNoteData } from "../api.js";

interface Props {
  editingNoteId: string | null;
  onNavigateRef: (book: string, chapter: number) => void;
}

export function WritingSheet({ editingNoteId, onNavigateRef: _onNavigateRef }: Props): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState("");
  const [tags, setTags] = useState("");
  const [saved, setSaved] = useState(false);
  const [noteId, setNoteId] = useState<string | null>(null);
  const [showFrontmatter, setShowFrontmatter] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  // Load existing note if editing
  useEffect(() => {
    if (editingNoteId) {
      window.api.library.readAllNotes().then((notes) => {
        const note = notes.find((n: ParsedNoteData) => n.frontmatter.id === editingNoteId);
        if (note) {
          setTitle(note.frontmatter.title);
          setBody(note.body);
          setType(note.frontmatter.type ?? "");
          setTags(note.frontmatter.tags?.join(", ") ?? "");
          setNoteId(note.frontmatter.id);
        }
      });
    } else {
      setTitle("");
      setBody("");
      setType("");
      setTags("");
      setNoteId(null);
      setSaved(false);
    }
  }, [editingNoteId]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    const opts: { type?: string; tags?: string[] } = {};
    if (type.trim()) opts.type = type.trim();
    if (tags.trim()) opts.tags = tags.split(",").map((t) => t.trim()).filter(Boolean);

    const result = await window.api.library.createNote(title, body, opts);
    if (result.ok) {
      setSaved(true);
      setNoteId(result.id ?? null);
      setTimeout(() => setSaved(false), 2000);
    }
  }, [title, body, type, tags]);

  // Autocomplete for inline note links [[
  const handleBodyKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "s" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSave();
    }
  }, [handleSave]);

  return (
    <div className="writing-sheet">
      <div className="toolbar">
        <button onClick={handleSave}>
          {saved ? "Saved" : "Save"}
        </button>
        <button onClick={() => setShowFrontmatter(!showFrontmatter)}>
          {showFrontmatter ? "Hide metadata" : "Show metadata"}
        </button>
        {noteId && (
          <span style={{ fontSize: "var(--fs-xs)", color: "var(--text-tertiary)" }}>
            ID: {noteId}
          </span>
        )}
      </div>

      <div className="writing-inner" style={{ paddingTop: "var(--sp-xl)" }}>
        {showFrontmatter && (
          <div style={{
            padding: "var(--sp-md)", marginBottom: "var(--sp-lg)",
            background: "var(--bg-secondary)", borderRadius: "var(--radius-md)",
            fontSize: "var(--fs-sm)",
          }}>
            <div style={{ display: "flex", gap: "var(--sp-lg)", marginBottom: "var(--sp-sm)" }}>
              <label style={{ color: "var(--text-secondary)" }}>
                Type: <input
                  value={type}
                  onChange={(e) => setType(e.target.value)}
                  placeholder="exegetical, devotional, etc."
                  style={{
                    border: "1px solid var(--border-medium)", borderRadius: "var(--radius-sm)",
                    padding: "2px 8px", fontSize: "var(--fs-xs)", background: "var(--bg-surface)",
                  }}
                />
              </label>
              <label style={{ color: "var(--text-secondary)" }}>
                Tags: <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder="baptism, pneumatology"
                  style={{
                    border: "1px solid var(--border-medium)", borderRadius: "var(--radius-sm)",
                    padding: "2px 8px", fontSize: "var(--fs-xs)", background: "var(--bg-surface)",
                  }}
                />
              </label>
            </div>
          </div>
        )}

        <input
          className="note-title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
        />

        <textarea
          ref={bodyRef}
          className="note-body-editor"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={handleBodyKeyDown}
          placeholder={"Start writing...\n\nInline Scripture references like Acts 19:1-7 will be parsed automatically.\nLink to other notes with [[note:ULID|label]] syntax."}
        />

        <div className="note-meta">
          <span>Markdown</span>
          <span>{body.length} characters</span>
          <span>Cmd+S to save</span>
        </div>
      </div>
    </div>
  );
}
