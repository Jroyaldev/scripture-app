/**
 * Full-viewport Structure modal — room for a real syntax chart.
 * Margin only holds the trigger; the study UI lives here.
 */

import type React from "react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LanguageSyntaxHit } from "../api.js";
import { isTopLayer, useLayer } from "../layerStack.js";
import { SyntaxArtView } from "./SyntaxArt.js";

type Props = {
  open: boolean;
  onClose: () => void;
  hit: LanguageSyntaxHit | null;
  loading: boolean;
  dir?: "ltr" | "rtl";
};

/** Matches the CSS structure-modal-out duration. */
const EXIT_MS = 140;

export function StructureModal({
  open,
  onClose,
  hit,
  loading,
  dir = "ltr",
}: Props): React.JSX.Element | null {
  // Keep rendering through a short exit animation instead of vanishing in
  // one frame (the enter side already animates).
  const [rendered, setRendered] = useState(open);
  const [materialClasses, setMaterialClasses] = useState(() => {
    if (typeof document === "undefined") return "";
    const shell = document.querySelector(".app-shell");
    return shell
      ? [...shell.classList]
          .filter((name) => name === "dark" || name.startsWith("theme-"))
          .join(" ")
      : "";
  });
  const panelRef = useRef<HTMLDivElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const layerRef = useLayer(rendered ? "dialog" : null);

  useEffect(() => {
    if (open) {
      setRendered(true);
      return;
    }
    if (!rendered) return;
    const t = setTimeout(() => setRendered(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open, rendered]);

  // This dialog is portaled to <body>, outside .app-shell. Mirror the exact
  // reading material so Glass and Candlelight inherit more than light/dark.
  useEffect(() => {
    if (!rendered) return;
    const shell = document.querySelector(".app-shell");
    if (!shell) return;
    const sync = (): void => setMaterialClasses(
      [...shell.classList]
        .filter((name) => name === "dark" || name.startsWith("theme-"))
        .join(" "),
    );
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(shell, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [rendered]);

  useEffect(() => {
    if (!open) return;
    // Move focus into the dialog, remember where it came from.
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    panelRef.current?.querySelector<HTMLElement>("button")?.focus();

    function onKey(e: KeyboardEvent): void {
      if (!isTopLayer(layerRef.current)) return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      // Keep Tab cycling inside the dialog.
      if (e.key === "Tab" && panelRef.current) {
        const focusables = panelRef.current.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        if (focusables.length === 0) return;
        const first = focusables[0]!;
        const last = focusables[focusables.length - 1]!;
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
      restoreFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!rendered) return null;

  return createPortal(
    <div
      className={`structure-modal-root ${materialClasses}${open ? "" : " is-closing"}`.trim()}
      role="presentation"
      data-floating-layer="dialog"
    >
      <div className="structure-modal-scrim" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        className="structure-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="structure-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="structure-modal-header">
          <div className="structure-modal-heading">
            <span className="structure-modal-kicker">Original language</span>
            <h2 id="structure-modal-title" className="structure-modal-title">
              Sentence structure
            </h2>
            {hit ? (
              <p className="structure-modal-sub">
                {hit.sentence.refLabel}
                <span className="structure-modal-dot">·</span>
                phrase and clause map
              </p>
            ) : (
              <p className="structure-modal-sub">Phrase and clause relationships from the source text</p>
            )}
          </div>
          <button
            type="button"
            className="structure-modal-close"
            onClick={onClose}
            aria-label="Close structure"
          >
            <CloseIcon />
          </button>
        </header>

        <div className="structure-modal-body">
          {loading ? (
            <div className="structure-modal-loading" role="status">
              <span className="structure-modal-loading-mark" aria-hidden="true" />
              <strong>Mapping the sentence…</strong>
              <span>Reading the packaged source structure.</span>
            </div>
          ) : hit ? (
            <SyntaxArtView hit={hit} dir={dir} />
          ) : (
            <div className="structure-modal-empty">
              <strong>No packaged structure here</strong>
              <p className="structure-modal-empty-hint">
                This verse does not have a source-backed sentence map in the installed data.
              </p>
            </div>
          )}
        </div>

        <footer className="structure-modal-footer">
          <span className="structure-modal-provenance">
            <span className="structure-modal-provenance-label">Source</span>
            <span>MACULA + Clear Bible</span>
            <span aria-hidden="true">·</span>
            <span>CC BY 4.0</span>
          </span>
          <button type="button" className="structure-modal-done" onClick={onClose}>
            Done
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function CloseIcon(): React.JSX.Element {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path
        d="M4.5 4.5l9 9M13.5 4.5l-9 9"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
