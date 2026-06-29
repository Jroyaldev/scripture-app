/**
 * Writing Sheet — Markdown editor with frontmatter hidden.
 * Supports create-note-from-passage and inline link autocomplete.
 */

import { useState, useCallback } from "react";
import type { CanonicalRef } from "../../core/reference/types.js";

type Props = {
  activeRef: CanonicalRef | null;
  onSave: (title: string, body: string) => Promise<{ ok: boolean; noteId?: string }>;
  bookNames: Record<string, string[]>;
};

export function WritingSheet({ activeRef, onSave, bookNames: _bookNames }: Props) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    const result = await onSave(title.trim(), body);
    setSaving(false);
    if (result.ok) {
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        setTitle("");
        setBody("");
      }, 2000);
    }
  }, [title, body, onSave]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    },
    [handleSave],
  );

  // Pre-fill body with active passage reference
  const insertPassageRef = useCallback(async () => {
    if (!activeRef) return;
    const display = await window.electronAPI.formatDisplay(activeRef);
    const bref = await window.electronAPI.formatBref(activeRef);
    setBody((prev) => prev + (prev ? "\n\n" : "") + `${display} (${bref})\n\n`);
  }, [activeRef]);

  return (
    <div className="writing-sheet" onKeyDown={handleKeyDown}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "1rem" }}>
        <input
          className="title-input"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Note title..."
        />
      </div>

      {activeRef && (
        <button
          onClick={insertPassageRef}
          style={{
            marginBottom: "1rem",
            padding: "4px 12px",
            border: "1px solid var(--border-medium)",
            borderRadius: "6px",
            background: "transparent",
            cursor: "pointer",
            fontSize: "0.8125rem",
          }}
        >
          Insert passage reference
        </button>
      )}

      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your note in Markdown..."
      />

      <div style={{ marginTop: "1rem", display: "flex", gap: "8px", alignItems: "center" }}>
        <button
          onClick={handleSave}
          disabled={saving || !title.trim()}
          style={{
            padding: "8px 20px",
            background: "var(--accent-primary)",
            color: "white",
            border: "none",
            borderRadius: "6px",
            cursor: title.trim() ? "pointer" : "not-allowed",
            opacity: title.trim() ? 1 : 0.5,
            fontSize: "0.875rem",
          }}
        >
          {saving ? "Saving..." : "Save Note"}
        </button>
        {saved && (
          <span style={{ fontSize: "0.875rem", color: "var(--provenance-source)" }}>
            Note saved
          </span>
        )}
        <span style={{ fontSize: "0.75rem", color: "var(--text-tertiary)", marginLeft: "auto" }}>
          Ctrl+S to save
        </span>
      </div>
    </div>
  );
}
