import type React from "react";
import { useEffect, useRef } from "react";
import { isTopLayer, useLayer } from "../layerStack.js";

interface Props {
  onClose: () => void;
}

const SHORTCUTS: Array<{ keys: string[]; description: string }> = [
  { keys: ["1–5"], description: "Switch views: Read, Write, My notes, Search, Settings" },
  { keys: ["F"], description: "Toggle focus mode" },
  { keys: ["←", "→"], description: "Move the current tab to the previous or next chapter" },
  { keys: ["⌘ click", "Ctrl click"], description: "Open a chapter, passage, or cross-reference in another tab" },
  { keys: ["⇧ / ⌘ / Ctrl click", "Middle click"], description: "Branch a related person or place into a new Research tab" },
  { keys: ["↑", "↓"], description: "Move to the previous or next verse" },
  { keys: ["Enter"], description: "Select the focused verse for Study" },
  { keys: ["⇧ Enter"], description: "Extend the verse selection" },
  { keys: ["M"], description: "Mark the focused verse with the active marking surface" },
  { keys: ["1–6"], description: "With the marking palette open: choose a relationship" },
  { keys: ["⇧ 1–5"], description: "With the marking palette open: choose a wash" },
  { keys: ["Tab", "⇧ Tab"], description: "Cycle Study lenses while the verse keeps focus" },
  { keys: ["Enter", "↓"], description: "From the active Study tab, enter its panel" },
  { keys: ["Esc"], description: "From a Study panel, return to its active tab" },
  { keys: ["Ctrl Tab"], description: "Move to the next Study tab" },
  { keys: ["⇧ Ctrl Tab"], description: "Move to the previous Study tab" },
  { keys: ["Ctrl W", "⌘ W"], description: "Close the current Study tab" },
  { keys: ["Middle click"], description: "Close a Study tab from its tab strip" },
  { keys: ["Delete", "Backspace"], description: "Close the focused Study tab" },
  { keys: ["⇧ Ctrl T", "⇧ ⌘ T"], description: "Reopen the last closed Study tab or group" },
  { keys: ["F6", "⇧ F6"], description: "Move among sidebar, topbar, canvas, and Study" },
  { keys: ["⌘K"], description: "Open the command palette" },
  { keys: ["?"], description: "Open or close keyboard shortcuts" },
];

export function ShortcutsOverlay({ onClose }: Props): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const layerRef = useLayer("dialog");

  useEffect(() => {
    returnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent): void => {
      const shortcutKey = event.key === "?" || (event.key === "/" && event.shiftKey);
      if (event.key === "Escape" || shortcutKey) {
        if (!isTopLayer(layerRef.current)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;

      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) {
        event.preventDefault();
        panelRef.current.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener("keydown", onKeyDown, true);
      const target = returnFocusRef.current;
      window.setTimeout(() => {
        if (target?.isConnected) target.focus();
      }, 0);
    };
  }, [onClose]);

  return (
    <div
      className="shortcuts-overlay-root"
      role="dialog"
      aria-modal="true"
      aria-labelledby="shortcuts-overlay-title"
      aria-describedby="shortcuts-overlay-description"
      data-floating-layer="dialog"
    >
      <button
        type="button"
        className="floating-dialog-scrim shortcuts-overlay-scrim"
        aria-label="Close keyboard shortcuts"
        onClick={onClose}
      />
      <div ref={panelRef} className="floating-dialog-surface shortcuts-overlay-panel" tabIndex={-1}>
        <header className="shortcuts-overlay-header">
          <div>
            <span className="shortcuts-overlay-kicker">Keyboard model</span>
            <h2 id="shortcuts-overlay-title">Keyboard shortcuts</h2>
            <p id="shortcuts-overlay-description">
              Read, study, and move between panes without leaving the text behind.
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="shortcuts-overlay-close"
            aria-label="Close keyboard shortcuts"
            onClick={onClose}
          >
            <span aria-hidden="true">×</span>
          </button>
        </header>

        <div className="shortcuts-overlay-list">
          {SHORTCUTS.map((shortcut, index) => (
            <div className="shortcuts-overlay-row" key={`${shortcut.description}-${index}`}>
              <span className="shortcuts-overlay-keys">
                {shortcut.keys.map((key) => <kbd key={key}>{key}</kbd>)}
              </span>
              <span>{shortcut.description}</span>
            </div>
          ))}
        </div>

        <p className="shortcuts-overlay-escape">
          <kbd>Esc</kbd>
          <span>
            Escape ladder: close the current layer, return from a Study panel or research step,
            then leave focus mode.
          </span>
        </p>
      </div>
    </div>
  );
}
