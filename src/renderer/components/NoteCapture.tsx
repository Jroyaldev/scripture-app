import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { safeCall } from "../utils/safeCall.js";
import { Button, ControlInput, ControlTextarea } from "./Controls.js";
import { Tooltip } from "./Tooltip.js";

/**
 * Draft for a note captured from a scripture selection.
 * Built by ScripturePage; saved here without leaving the Read surface.
 */
export interface NoteCaptureDraft {
  /** Default title — usually the display ref, e.g. "Acts 19:2–4". */
  title: string;
  /** Display reference (same as title usually, kept separate for flexibility). */
  passageRef: string;
  /** Quoted verse text for the blockquote. */
  quote: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  packageId: string;
}

interface Props {
  draft: NoteCaptureDraft;
  onClose: () => void;
  /** Fired after a successful save (noteId for optional follow-up). */
  onSaved: (info: { noteId: string; title: string }) => void;
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden>
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

function QuoteMark(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="currentColor" aria-hidden className="note-capture-quote-mark">
      <path d="M4.5 12.5c0-2.8 1.4-4.8 4-5.6l.6 1.5c-1.5.5-2.2 1.5-2.2 2.7h2.1V16H4.5v-3.5zm7 0c0-2.8 1.4-4.8 4-5.6l.6 1.5c-1.5.5-2.2 1.5-2.2 2.7h2.1V16H11.5v-3.5z" />
    </svg>
  );
}

/**
 * Slide-over note capture: stays on Read, seeds title + quote from selection,
 * leaves the body free for the user's own words. Save is explicit (⌘S / button).
 * INV-1: AI never writes the note body — only the user does.
 */
export function NoteCapture({ draft, onClose, onSaved }: Props): React.JSX.Element {
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return () => {
      const target = returnFocusRef.current;
      window.setTimeout(() => {
        if (target?.isConnected) {
          target.focus();
          return;
        }
        const verse = document.querySelector<HTMLElement>(`.verse-line[data-verse="${draft.verseStart}"]`);
        (verse ?? document.querySelector<HTMLElement>("#reading-chapter-title"))?.focus();
      }, 0);
    };
  }, [draft.verseStart]);

  // Focus the body for immediate typing; title is already good.
  useEffect(() => {
    const t = window.setTimeout(() => bodyRef.current?.focus(), 40);
    return () => window.clearTimeout(t);
  }, []);

  // Esc closes (unless saving).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !saving) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) {
        e.preventDefault();
        panelRef.current.focus();
      } else if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose, saving]);

  const buildMarkdown = useCallback(() => {
    const quoteBlock = draft.quote.trim()
      ? draft.quote
          .trim()
          .split(/\n+/)
          .map((line) => `> ${line}`)
          .join("\n")
      : "";
    const user = body.trim();
    if (quoteBlock && user) return `${quoteBlock}\n\n${user}\n`;
    if (quoteBlock) return `${quoteBlock}\n`;
    return user ? `${user}\n` : "";
  }, [draft.quote, body]);

  const handleSave = useCallback(async () => {
    const t = title.trim() || draft.passageRef;
    if (!t) {
      setError("Add a title to save.");
      return;
    }
    setSaving(true);
    setError(null);
    const md = buildMarkdown();
    const result = await safeCall(() =>
      window.api.library.createNote(t, md, {
        type: "note",
        tags: ["from-selection"],
      }),
    );
    setSaving(false);
    if (!result.ok || !result.value.ok) {
      setError(result.ok ? result.value.error ?? "Could not save note" : result.error);
      return;
    }
    const noteId = result.value.noteId ?? result.value.id ?? "";
    onSaved({ noteId, title: t });
    // Fire-and-forget enrichment so the note can resurface later (B3.6).
    if (noteId) {
      void safeCall(() => window.api.ai.enrichNote(noteId));
    }
  }, [title, draft.passageRef, buildMarkdown, onSaved]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleSave]);

  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <div
      className="note-capture-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="note-capture-title"
      aria-describedby="note-capture-description"
      data-floating-layer="dialog"
    >
      <button
        type="button"
        className="floating-dialog-scrim note-capture-scrim"
        aria-label="Dismiss note capture"
        onClick={() => !saving && onClose()}
      />
      <div className="floating-dialog-surface note-capture-panel" ref={panelRef} tabIndex={-1}>
        <header className="note-capture-header">
          <div className="note-capture-header-text">
            <span className="note-capture-kicker">Passage note</span>
            <h2 id="note-capture-title" className="note-capture-heading">
              {draft.passageRef}
            </h2>
            <p className="note-capture-trust">Plain Markdown · saved locally only when you choose</p>
          </div>
          <Tooltip label="Close" shortcut="Esc">
            <Button
              variant="ghost"
              size="icon"
              className="note-capture-close"
              onClick={() => !saving && onClose()}
              aria-label="Close"
              disabled={saving}
            >
              <CloseIcon />
            </Button>
          </Tooltip>
        </header>

        <div className="note-capture-body">
          <label className="note-capture-field">
            <span className="note-capture-label">Title</span>
            <ControlInput
              className="note-capture-title-input"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={draft.passageRef}
              spellCheck
            />
          </label>

          {draft.quote.trim() && (
            <blockquote className="control-card note-capture-quote">
              <QuoteMark />
              <p className="note-capture-quote-text">{draft.quote.trim()}</p>
              <footer className="note-capture-quote-ref">{draft.passageRef}</footer>
            </blockquote>
          )}

          <label className="note-capture-field note-capture-field-grow">
            <span className="note-capture-label">Your notes</span>
            <ControlTextarea
              ref={bodyRef}
              className="note-capture-textarea"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What stands out? Questions, observations, applications…"
              spellCheck
            />
          </label>
        </div>

        <footer className="note-capture-footer">
          {error && <p className="note-capture-error" role="status">{error}</p>}
          <div className="note-capture-footer-row">
            <span id="note-capture-description" className="note-capture-hint">
              Quote included · {isMac ? "⌘S" : "Ctrl+S"} to save
            </span>
            <div className="note-capture-actions">
              <Button
                variant="secondary"
                size="sm"
                className="note-capture-cancel"
                onClick={() => !saving && onClose()}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="note-capture-save"
                onClick={() => void handleSave()}
                disabled={saving || !title.trim()}
                busy={saving}
              >
                {saving ? "Saving…" : "Save note"}
              </Button>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
