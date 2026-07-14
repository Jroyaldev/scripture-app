import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import { safeCall } from "../utils/safeCall.js";

interface Props {
  prefillBody?: string;
  onSaved: () => void;
}

function EchoSparkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden>
      <path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5l-1.3-4.2L4.5 8l4.2-1.3z" />
    </svg>
  );
}

type EchoSuggestion = { refKey: string; display: string; bref: string; healed: boolean };
type EchoPhase = "idle" | "listening" | "ready";

/**
 * The capture echo (B3.6 E4): save a quick note, and the sheet quietly says
 * what it sounds like — "Psalm 23 · John 10 — anchor it?" One tap anchors
 * (a real, user-authored ref appended to the note); one tap dismisses
 * (sticky); anchored chips undo symmetrically (A-5). AI never writes the
 * note itself (INV-1) — every change here is an explicit user action.
 */
export function WritingSheet({ prefillBody, onSaved }: Props): React.JSX.Element {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [charCount, setCharCount] = useState(0);

  const [echoNote, setEchoNote] = useState<{ id: string; title: string } | null>(null);
  const [echoPhase, setEchoPhase] = useState<EchoPhase>("idle");
  const [suggestions, setSuggestions] = useState<EchoSuggestion[]>([]);
  const [anchored, setAnchored] = useState<EchoSuggestion[]>([]);
  const echoSeq = useRef(0);

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
      const savedTitle = title;
      setTitle("");
      setBody("");
      onSaved();

      const noteId = result.noteId ?? result.id;
      if (noteId) {
        // Fire the capture echo: background enrichment, then suggestions.
        const seq = ++echoSeq.current;
        setEchoNote({ id: noteId, title: savedTitle });
        setEchoPhase("listening");
        setSuggestions([]);
        setAnchored([]);
        const echo = await safeCall(() => window.api.ai.enrichNote(noteId));
        if (echoSeq.current !== seq) return; // superseded by a newer save
        if (echo.ok && echo.value.enriched && !echo.value.noScriptureIntent) {
          setSuggestions(echo.value.suggestions);
          setEchoPhase("ready");
        } else {
          setEchoPhase("idle");
          setEchoNote(null);
        }
      }
    }
  }, [title, body, onSaved]);

  const handleAnchor = useCallback(
    async (s: EchoSuggestion) => {
      if (!echoNote) return;
      setSuggestions((prev) => prev.filter((x) => x.refKey !== s.refKey));
      setAnchored((prev) => [...prev, s]);
      const result = await safeCall(() =>
        window.api.ai.enrichmentFeedback({
          noteId: echoNote.id,
          refKey: s.refKey,
          action: "confirmed",
          refDisplay: s.display,
        }),
      );
      if (!result.ok) {
        // Roll back optimistic state on failure.
        setAnchored((prev) => prev.filter((x) => x.refKey !== s.refKey));
        setSuggestions((prev) => [...prev, s]);
      }
    },
    [echoNote],
  );

  const handleDismiss = useCallback(
    async (s: EchoSuggestion) => {
      if (!echoNote) return;
      setSuggestions((prev) => prev.filter((x) => x.refKey !== s.refKey));
      await safeCall(() =>
        window.api.ai.enrichmentFeedback({ noteId: echoNote.id, refKey: s.refKey, action: "dismissed" }),
      );
    },
    [echoNote],
  );

  const handleUndo = useCallback(
    async (s: EchoSuggestion) => {
      if (!echoNote) return;
      setAnchored((prev) => prev.filter((x) => x.refKey !== s.refKey));
      setSuggestions((prev) => [...prev, s]);
      await safeCall(() =>
        window.api.ai.unanchorRef({ noteId: echoNote.id, refKey: s.refKey, refDisplay: s.display }),
      );
    },
    [echoNote],
  );

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

  const showEcho = echoPhase !== "idle" && echoNote !== null;
  const echoEmpty = echoPhase === "ready" && suggestions.length === 0 && anchored.length === 0;

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

        {showEcho && !echoEmpty && (
          <div className="capture-echo" role="status">
            <div className="echo-head">
              <EchoSparkIcon />
              <span className="echo-note-title">&ldquo;{echoNote.title}&rdquo; saved</span>
              {echoPhase === "listening" && <span className="echo-listening">listening&hellip;</span>}
              {echoPhase === "ready" && suggestions.length > 0 && (
                <span className="echo-question">sounds like &mdash; anchor it?</span>
              )}
            </div>
            {echoPhase === "ready" && (
              <div className="echo-pills">
                {anchored.map((s) => (
                  <span key={s.refKey} className="echo-pill anchored" title="Anchored to this note">
                    <span className="echo-pill-check">✓</span>
                    {s.display}
                    <button className="echo-pill-undo" onClick={() => handleUndo(s)} title="Remove this anchor">
                      undo
                    </button>
                  </span>
                ))}
                {suggestions.map((s) => (
                  <span key={s.refKey} className={`echo-pill${s.healed ? " healed" : ""}`}>
                    <button
                      className="echo-pill-anchor"
                      onClick={() => handleAnchor(s)}
                      title={s.healed ? "You anchored a similar note here before" : "Anchor this reference to the note"}
                    >
                      {s.display}
                    </button>
                    <button className="echo-pill-dismiss" onClick={() => handleDismiss(s)} title="Not this passage">
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <span className="echo-provenance">AI-inferred &middot; anchoring is always your call</span>
          </div>
        )}
      </div>
    </div>
  );
}
