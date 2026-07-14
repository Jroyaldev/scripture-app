/**
 * Full-viewport Structure modal — room for a real syntax chart.
 * Margin only holds the trigger; the study UI lives here.
 */

import type React from "react";
import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { LanguageSyntaxHit } from "../api.js";
import { SyntaxArtView } from "./SyntaxArt.js";

type Props = {
  open: boolean;
  onClose: () => void;
  hit: LanguageSyntaxHit | null;
  loading: boolean;
  dir?: "ltr" | "rtl";
};

export function StructureModal({
  open,
  onClose,
  hit,
  loading,
  dir = "ltr",
}: Props): React.JSX.Element | null {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent): void {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="structure-modal-root" role="presentation">
      <div className="structure-modal-scrim" onClick={onClose} aria-hidden="true" />
      <div
        className="structure-modal-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="structure-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="structure-modal-header">
          <div className="structure-modal-heading">
            <h2 id="structure-modal-title" className="structure-modal-title">
              Structure
            </h2>
            {hit ? (
              <p className="structure-modal-sub">
                {hit.sentence.refLabel}
                <span className="structure-modal-dot">·</span>
                clause flow &amp; who does what
              </p>
            ) : (
              <p className="structure-modal-sub">Original-language sentence structure</p>
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
            <div className="structure-modal-loading">Loading structure…</div>
          ) : hit ? (
            <SyntaxArtView hit={hit} dir={dir} fillContainer defaultMode="tree" />
          ) : (
            <div className="structure-modal-empty">
              <p>No structure for this word yet.</p>
              <p className="structure-modal-empty-hint">
                Import MACULA nodes with <code>npm run import:macula-syntax</code>.
              </p>
            </div>
          )}
        </div>

        <footer className="structure-modal-footer">
          <span>MACULA · Clear Bible · CC BY</span>
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
