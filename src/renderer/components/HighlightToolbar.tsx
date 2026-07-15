import type React from "react";

const COLORS = ["yellow", "green", "blue", "pink", "purple"] as const;

export interface HighlightToolbarProps {
  /** Short label for the selection, e.g. "Acts 19:4–6" or a phrase. */
  rangeLabel: string;
  /** Single active color when selection has one color; null = none or mixed. */
  activeColor: string | null;
  /** True when the selection spans more than one highlight color. */
  mixedColors: boolean;
  hasExistingHighlight: boolean;
  phraseMode: boolean;
  onSetColor: (color: string) => void;
  onNote: () => void;
  onRemove: () => void;
  /** floating | docked (margin). Same chrome, different host. */
  variant?: "floating" | "docked";
  flipped?: boolean;
  paletteRef?: React.RefObject<HTMLDivElement | null>;
  style?: React.CSSProperties;
}

/**
 * Unified selection chrome for highlights — one mini toolbar whether it
 * floats over the text or docks in the Living Margin.
 */
export function HighlightToolbar({
  rangeLabel,
  activeColor,
  mixedColors,
  hasExistingHighlight,
  phraseMode,
  onSetColor,
  onNote,
  onRemove,
  variant = "floating",
  flipped = false,
  paletteRef,
  style,
}: HighlightToolbarProps): React.JSX.Element {
  const rootClass = [
    "hl-toolbar",
    variant === "floating" ? "hl-toolbar-floating" : "hl-toolbar-docked",
    flipped ? "flipped" : "",
    mixedColors ? "is-mixed" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={paletteRef}
      className={rootClass}
      style={style}
      role="toolbar"
      aria-label="Highlight selection"
    >
      <div className="hl-toolbar-range" title={rangeLabel}>
        {rangeLabel}
        {mixedColors && <span className="hl-toolbar-mixed-badge">Mixed</span>}
      </div>
      <div className="hl-toolbar-divider" aria-hidden="true" />
      <div className="hl-swatch-group" role="group" aria-label="Highlight color">
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={`hl-btn-${color}${activeColor === color ? " active" : ""}`}
            onClick={() => onSetColor(color)}
            title={`${color.charAt(0).toUpperCase() + color.slice(1)} highlight`}
            aria-label={`Apply ${color} highlight`}
            aria-pressed={activeColor === color}
          />
        ))}
      </div>
      <div className="hl-toolbar-divider" aria-hidden="true" />
      <div className="hl-action-group">
        <button type="button" className="hl-btn-note" onClick={onNote}>
          Add note
        </button>
        {hasExistingHighlight && (
          <button
            type="button"
            className="hl-btn-delete"
            onClick={onRemove}
            title={phraseMode ? "Remove only this selection" : "Remove the complete highlight"}
            aria-label={phraseMode ? "Remove selected text from highlight" : "Remove complete highlight"}
          >
            <span aria-hidden="true">−</span>
            <span>{phraseMode ? "Selection" : "Highlight"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
