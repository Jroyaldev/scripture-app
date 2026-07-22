import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTopLayer, useLayer } from "../layerStack.js";
import { safeCall } from "../utils/safeCall.js";
import type { WorkspaceExitController } from "../utils/workspaceTransition.js";
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
  /** Editable Markdown seeded into the note body for research capture. */
  bodyPrefill?: string;
  /** Quiet description of the surface that opened capture. */
  originLabel?: string;
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
  packageId: string;
}

export interface NoteCaptureProps {
  draft: NoteCaptureDraft;
  onClose: () => void;
  /** Fired after a successful save (noteId for optional follow-up). */
  onSaved: (info: { noteId: string; title: string }) => void;
  /** Registers this authored surface with the workspace-transition gate. */
  onExitControllerChange?: (controller: WorkspaceExitController | null) => void;
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

/** Compose the exact readable Markdown saved by the explicit capture action. */
export function buildNoteCaptureMarkdown(quote: string, body: string): string {
  const quoteBlock = quote.trim()
    ? quote
        .trim()
        .split(/\n+/)
        .map((line) => `> ${line}`)
        .join("\n")
    : "";
  const user = body.trim();
  if (quoteBlock && user) return `${quoteBlock}\n\n${user}\n`;
  if (quoteBlock) return `${quoteBlock}\n`;
  return user ? `${user}\n` : "";
}

export interface NoteCaptureExitControllerInput {
  isDirty(): boolean;
  isSaving(): boolean;
  revealDecision(): void;
  save(): Promise<boolean>;
  discard(): void;
  keepWriting(): void;
}

export interface NoteCaptureExitOwner {
  controller: WorkspaceExitController;
  save(): Promise<boolean>;
  discard(): void;
  keepWriting(): void;
  dispose(): void;
}

/**
 * Owns the pending decision without performing an authored action itself.
 * Approval comes only from the reader's existing Save note or Discard action.
 */
export function createNoteCaptureExitController(
  input: NoteCaptureExitControllerInput,
): NoteCaptureExitOwner {
  let pendingResolution: ((approved: boolean) => void) | null = null;
  let saveInFlight = false;

  const settle = (approved: boolean): void => {
    const resolve = pendingResolution;
    pendingResolution = null;
    resolve?.(approved);
  };

  const controller: WorkspaceExitController = {
    requestExit: async (_reason) => {
      if (pendingResolution || saveInFlight || input.isSaving()) return false;
      if (!input.isDirty()) return true;
      return new Promise<boolean>((resolve) => {
        pendingResolution = resolve;
        try {
          input.revealDecision();
        } catch {
          settle(false);
        }
      });
    },
  };

  return {
    controller,
    async save(): Promise<boolean> {
      if (saveInFlight || input.isSaving()) return false;
      saveInFlight = true;
      let saved = false;
      try {
        saved = await input.save() === true;
      } catch {
        saved = false;
      } finally {
        saveInFlight = false;
      }
      settle(saved);
      return saved;
    },
    discard(): void {
      try {
        input.discard();
        settle(true);
      } catch {
        settle(false);
      }
    },
    keepWriting(): void {
      settle(false);
      try {
        input.keepWriting();
      } catch {
        // The transition already failed closed; focus recovery is best-effort.
      }
    },
    dispose(): void {
      settle(false);
    },
  };
}

/**
 * Slide-over note capture: stays on Read, seeds title + quote from selection,
 * leaves the body free for the user's own words. Save is explicit (⌘S / button).
 * INV-1: AI never writes the note body — only the user does.
 */
export function NoteCapture({
  draft,
  onClose,
  onSaved,
  onExitControllerChange,
}: NoteCaptureProps): React.JSX.Element {
  const [title, setTitle] = useState(draft.title);
  const initialBody = draft.bodyPrefill ?? "";
  const [body, setBody] = useState(initialBody);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardArmed, setDiscardArmed] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const savingRef = useRef(false);
  const isDirty = body !== initialBody || title !== draft.title;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const handleSaveRef = useRef<() => Promise<boolean>>(async () => false);
  const layerRef = useLayer("dialog");

  useEffect(() => {
    const active = document.activeElement;
    returnFocusRef.current = active instanceof HTMLElement
      && active !== document.body
      && active !== document.documentElement
      ? active
      : null;
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

  const buildMarkdown = useCallback(
    () => buildNoteCaptureMarkdown(draft.quote, body),
    [draft.quote, body],
  );

  const handleSave = useCallback(async (): Promise<boolean> => {
    if (savingRef.current) return false;
    const t = title.trim();
    if (!t) {
      setError("Add a title to save.");
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    setError(null);
    const md = buildMarkdown();
    const result = await safeCall(() =>
      window.api.library.createNote(t, md, {
        type: "note",
        tags: draft.bodyPrefill ? [] : ["from-selection"],
      }),
    );
    savingRef.current = false;
    setSaving(false);
    if (!result.ok || !result.value.ok) {
      setError(result.ok ? result.value.error ?? "Could not save note" : result.error);
      return false;
    }
    const noteId = result.value.noteId ?? result.value.id ?? "";
    onSaved({ noteId, title: t });
    // Fire-and-forget enrichment so the note can resurface later (B3.6).
    if (noteId) {
      void safeCall(() => window.api.ai.enrichNote(noteId));
    }
    return true;
  }, [title, draft.bodyPrefill, buildMarkdown, onSaved]);
  handleSaveRef.current = handleSave;

  const exitOwnerRef = useRef<NoteCaptureExitOwner | null>(null);
  if (!exitOwnerRef.current) {
    exitOwnerRef.current = createNoteCaptureExitController({
      isDirty: () => isDirtyRef.current,
      isSaving: () => savingRef.current,
      revealDecision: () => setDiscardArmed(true),
      save: () => handleSaveRef.current(),
      discard: () => onCloseRef.current(),
      keepWriting: () => {
        setDiscardArmed(false);
        bodyRef.current?.focus();
      },
    });
  }
  const exitOwner = exitOwnerRef.current;

  useEffect(() => {
    onExitControllerChange?.(exitOwner.controller);
    return () => onExitControllerChange?.(null);
  }, [exitOwner, onExitControllerChange]);

  useEffect(() => () => exitOwner.dispose(), [exitOwner]);

  const requestClose = useCallback(() => {
    if (savingRef.current) return;
    if (isDirty) {
      if (discardArmed) {
        exitOwner.keepWriting();
        return;
      }
      setDiscardArmed(true);
      return;
    }
    onClose();
  }, [discardArmed, exitOwner, isDirty, onClose]);

  // Esc closes (unless saving), and remains owned by the shared layer registry.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !savingRef.current) {
        if (!isTopLayer(layerRef.current)) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        requestClose();
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
  }, [layerRef, requestClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        void exitOwner.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [exitOwner]);

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
      data-dirty={isDirty ? "true" : "false"}
    >
      <button
        type="button"
        className="floating-dialog-scrim note-capture-scrim"
        aria-label="Dismiss note capture"
        onClick={requestClose}
      />
      <div className="floating-dialog-surface note-capture-panel" ref={panelRef} tabIndex={-1}>
        <header className="note-capture-header">
          <div className="note-capture-header-text">
            <span className="note-capture-kicker">{draft.originLabel ?? "Passage note"}</span>
            <h2 id="note-capture-title" className="note-capture-heading">
              New note
            </h2>
            <p className="note-capture-trust">Plain Markdown · saved locally only when you choose</p>
          </div>
          <Tooltip label="Close" shortcut="Esc">
            <Button
              variant="ghost"
              size="icon"
              className="note-capture-close"
              onClick={requestClose}
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
          {discardArmed && (
            <div className="note-capture-discard" role="alert">
              <span>Discard this draft? What you wrote will be lost.</span>
              <span className="note-capture-discard-actions">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={exitOwner.keepWriting}
                >
                  Keep writing
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  className="note-capture-discard-confirm"
                  onClick={exitOwner.discard}
                >
                  Discard
                </Button>
              </span>
            </div>
          )}
          <div className="note-capture-footer-row">
            <span id="note-capture-description" className="note-capture-hint">
              {draft.bodyPrefill ? "Excerpt and source included" : "Quote included"} · {isMac ? "⌘S" : "Ctrl+S"} to save
            </span>
            <div className="note-capture-actions">
              <Button
                variant="secondary"
                size="sm"
                className="note-capture-cancel"
                onClick={requestClose}
                disabled={saving}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                className="note-capture-save"
                onClick={() => void exitOwner.save()}
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
