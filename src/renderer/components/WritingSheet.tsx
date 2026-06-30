import type React from "react";
import { useState, useEffect, useCallback } from "react";

interface Props {
  prefillBody?: string;
  onSaved: () => void;
}

export function WritingSheet({ prefillBody, onSaved }: Props): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [charCount, setCharCount] = useState(0);

  useEffect(() => {
    if (prefillBody) {
      setBody(prefillBody);
    }
  }, [prefillBody]);

  useEffect(() => {
    setCharCount(body.length);
  }, [body]);

  const handleSave = useCallback(async () => {
    if (!title.trim()) return;
    setSaving(true);
    const result = await window.api.library.createNote(title, body, {});
    setSaving(false);
    if (result.ok) {
      setTitle("");
      setBody("");
      onSaved();
    }
  }, [title, body, onSaved]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  return (
    <div className="writing-sheet">
      <div className="writing-inner">
        <input
          className="note-title-input"
          type="text"
          placeholder="Note title..."
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className="note-body-editor"
          placeholder="Start writing... (Markdown supported)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <div className="note-meta">
          <span>{charCount} characters</span>
          <span>Ctrl+S to save</span>
          <button
            onClick={handleSave}
            disabled={saving || !title.trim()}
            style={{
              marginLeft: "auto",
              padding: "var(--sp-xs) var(--sp-md)",
              background: "var(--text-primary)",
              color: "var(--bg-surface)",
              border: "none",
              borderRadius: "var(--radius-sm)",
              cursor: title.trim() ? "pointer" : "not-allowed",
              opacity: title.trim() ? 1 : 0.5,
              fontSize: "var(--fs-xs)",
              fontWeight: "var(--fw-medium)",
            }}
          >
            {saving ? "Saving..." : "Save Note"}
          </button>
        </div>
      </div>
    </div>
  );
}
