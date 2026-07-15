import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ControlInput, ControlTextarea } from "./Controls.js";
import { useToast } from "./Toast.js";
import { safeCall } from "../utils/safeCall.js";

export interface WritingDraft {
  title: string;
  body: string;
}

interface Props {
  draft: WritingDraft;
  onDraftChange: (draft: WritingDraft) => void;
  onSaved: () => void;
}

function EchoSparkIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="11" height="11" fill="currentColor" aria-hidden="true">
      <path d="M10 2.5l1.3 4.2L15.5 8l-4.2 1.3L10 13.5l-1.3-4.2L4.5 8l4.2-1.3z" />
    </svg>
  );
}

function LockIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect x="3.4" y="7" width="9.2" height="6.2" rx="1.6" />
      <path d="M5.5 7V5.4a2.5 2.5 0 0 1 5 0V7" />
    </svg>
  );
}

type EchoSuggestion = { refKey: string; display: string; bref: string; healed: boolean };
type EchoPhase = "idle" | "listening" | "ready";

/**
 * Explicit local-note authoring. Draft text is owned by App so moving between
 * Read, Notes, and Search cannot silently discard it. Saving remains a user
 * action; background enrichment may suggest anchors but never writes one.
 */
export function WritingSheet({ draft, onDraftChange, onSaved }: Props): React.JSX.Element {
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [echoNote, setEchoNote] = useState<{ id: string; title: string } | null>(null);
  const [echoPhase, setEchoPhase] = useState<EchoPhase>("idle");
  const [suggestions, setSuggestions] = useState<EchoSuggestion[]>([]);
  const [anchored, setAnchored] = useState<EchoSuggestion[]>([]);
  const echoSeq = useRef(0);
  const titleRef = useRef<HTMLInputElement>(null);

  const charCount = draft.body.length;
  const words = useMemo(() => draft.body.trim().match(/\S+/g)?.length ?? 0, [draft.body]);
  const hasDraft = Boolean(draft.title.trim() || draft.body.trim());
  const canSave = Boolean(draft.title.trim()) && !saving;

  const updateTitle = (title: string): void => {
    setSaveError("");
    onDraftChange({ ...draft, title });
  };

  const updateBody = (body: string): void => {
    setSaveError("");
    onDraftChange({ ...draft, body });
  };

  const handleSave = useCallback(async () => {
    const title = draft.title.trim();
    if (!title || saving) {
      if (!title) titleRef.current?.focus();
      return;
    }

    setSaving(true);
    setSaveError("");
    const result = await safeCall(() => window.api.library.createNote(title, draft.body, {}));
    setSaving(false);
    if (!result.ok || !result.value.ok) {
      const error = result.ok ? result.value.error ?? "The note could not be saved." : result.error;
      setSaveError(error);
      showToast("Note not saved. Your draft is still here.", undefined, undefined, { tone: "error" });
      return;
    }

    const savedTitle = title;
    onSaved();
    showToast(`“${savedTitle}” saved to your library.`, undefined, undefined, { tone: "success" });

    const noteId = result.value.noteId ?? result.value.id;
    if (!noteId) return;

    const seq = ++echoSeq.current;
    setEchoNote({ id: noteId, title: savedTitle });
    setEchoPhase("listening");
    setSuggestions([]);
    setAnchored([]);
    const echo = await safeCall(() => window.api.ai.enrichNote(noteId));
    if (echoSeq.current !== seq) return;
    if (echo.ok && echo.value.enriched && !echo.value.noScriptureIntent) {
      setSuggestions(echo.value.suggestions);
      setEchoPhase("ready");
      return;
    }
    setEchoPhase("idle");
    setEchoNote(null);
  }, [draft, onSaved, saving, showToast]);

  const handleAnchor = useCallback(async (suggestion: EchoSuggestion) => {
    if (!echoNote) return;
    setSuggestions((current) => current.filter((item) => item.refKey !== suggestion.refKey));
    setAnchored((current) => [...current, suggestion]);
    const result = await safeCall(() => window.api.ai.enrichmentFeedback({
      noteId: echoNote.id,
      refKey: suggestion.refKey,
      action: "confirmed",
      refDisplay: suggestion.display,
    }));
    if (!result.ok || !result.value.ok) {
      setAnchored((current) => current.filter((item) => item.refKey !== suggestion.refKey));
      setSuggestions((current) => [...current, suggestion]);
      showToast("That passage was not anchored. Try again.", undefined, undefined, { tone: "error" });
    }
  }, [echoNote, showToast]);

  const handleDismiss = useCallback(async (suggestion: EchoSuggestion) => {
    if (!echoNote) return;
    setSuggestions((current) => current.filter((item) => item.refKey !== suggestion.refKey));
    await safeCall(() => window.api.ai.enrichmentFeedback({
      noteId: echoNote.id,
      refKey: suggestion.refKey,
      action: "dismissed",
    }));
  }, [echoNote]);

  const handleUndo = useCallback(async (suggestion: EchoSuggestion) => {
    if (!echoNote) return;
    setAnchored((current) => current.filter((item) => item.refKey !== suggestion.refKey));
    setSuggestions((current) => [...current, suggestion]);
    const result = await safeCall(() => window.api.ai.unanchorRef({
      noteId: echoNote.id,
      refKey: suggestion.refKey,
      refDisplay: suggestion.display,
    }));
    if (!result.ok || !result.value.ok) {
      setSuggestions((current) => current.filter((item) => item.refKey !== suggestion.refKey));
      setAnchored((current) => [...current, suggestion]);
      showToast("The passage anchor could not be restored.", undefined, undefined, { tone: "error" });
    }
  }, [echoNote, showToast]);

  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave]);

  const showEcho = echoPhase !== "idle" && echoNote !== null;
  const echoEmpty = echoPhase === "ready" && suggestions.length === 0 && anchored.length === 0;

  return (
    <section className="writing-workspace" aria-labelledby="writing-workspace-title">
      <header className="writing-hero">
        <div>
          <span className="workspace-kicker">New local note</span>
          <h1 id="writing-workspace-title">Write</h1>
          <p>Capture the thought first. Scripture references become durable anchors when you save.</p>
        </div>
        <div className="writing-trust" aria-label="Writing behavior">
          <span><LockIcon /> Saved only when you choose</span>
          <span>Plain Markdown</span>
        </div>
      </header>

      <div className="writing-sheet">
        <div className="writing-field writing-title-field">
          <label htmlFor="note-title">Title</label>
          <ControlInput
            ref={titleRef}
            id="note-title"
            className="note-title-input"
            type="text"
            placeholder="Give this note a clear name"
            value={draft.title}
            onChange={(event) => updateTitle(event.target.value)}
            aria-describedby="writing-save-status"
            autoFocus
          />
        </div>
        <div className="writing-field writing-body-field">
          <label htmlFor="note-body">Note</label>
          <ControlTextarea
            id="note-body"
            className="note-body-editor"
            placeholder="Start with the observation, question, or connection you do not want to lose…"
            value={draft.body}
            onChange={(event) => updateBody(event.target.value)}
          />
        </div>
        <footer className="writing-footer">
          <div className="writing-measure">
            <span>{words} {words === 1 ? "word" : "words"}</span>
            <span>{charCount} characters</span>
          </div>
          <span
            id="writing-save-status"
            className={`writing-save-status${saveError ? " error" : ""}`}
            role="status"
          >
            {saveError || (saving
              ? "Saving to your library…"
              : hasDraft
                ? "Draft kept while Scripture is open"
                : "Nothing has been saved yet")}
          </span>
          <span className="writing-shortcut" aria-hidden="true">⌘S</span>
          <Button variant="primary" busy={saving} disabled={!canSave} onClick={() => void handleSave()}>
            Save note
          </Button>
        </footer>
      </div>

      {showEcho && !echoEmpty && (
        <div className="capture-echo" role="status">
          <div className="echo-head">
            <EchoSparkIcon />
            <span className="echo-note-title">“{echoNote.title}” saved</span>
            {echoPhase === "listening" && <span className="echo-listening">Looking for Scripture in your note…</span>}
            {echoPhase === "ready" && suggestions.length > 0 && (
              <span className="echo-question">Possible passages — anchor any that belong?</span>
            )}
            <button
              type="button"
              className="echo-close"
              onClick={() => {
                echoSeq.current += 1;
                setEchoPhase("idle");
                setEchoNote(null);
              }}
              aria-label="Dismiss saved note suggestions"
            >
              ×
            </button>
          </div>
          {echoPhase === "ready" && (
            <div className="echo-pills">
              {anchored.map((suggestion) => (
                <span key={suggestion.refKey} className="echo-pill anchored">
                  <span className="echo-pill-check">✓</span>
                  {suggestion.display}
                  <button className="echo-pill-undo" onClick={() => void handleUndo(suggestion)}>undo</button>
                </span>
              ))}
              {suggestions.map((suggestion) => (
                <span key={suggestion.refKey} className={`echo-pill${suggestion.healed ? " healed" : ""}`}>
                  <button
                    className="echo-pill-anchor"
                    onClick={() => void handleAnchor(suggestion)}
                    aria-label={`Anchor ${suggestion.display} to this note`}
                  >
                    {suggestion.display}
                  </button>
                  <button
                    className="echo-pill-dismiss"
                    onClick={() => void handleDismiss(suggestion)}
                    aria-label={`Dismiss ${suggestion.display}`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <span className="echo-provenance">AI-inferred · anchoring is always your call</span>
        </div>
      )}
    </section>
  );
}
