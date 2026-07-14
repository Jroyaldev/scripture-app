import type React from "react";
import { useRef, useState } from "react";
import type { ReadingSize, ReadingWidth, VerseNumberMode } from "../api.js";
import { Popover } from "./Popover.js";

export interface ReadingPrefs {
  readingSize: ReadingSize;
  readingWidth: ReadingWidth;
  verseNumbers: VerseNumberMode;
}

interface Props {
  prefs: ReadingPrefs;
  onChange: (partial: Partial<ReadingPrefs>) => void;
  focusMode: boolean;
  onToggleFocus: () => void;
}

function AaIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4.5 14.5L8 5.5h.5L12 14.5" />
      <path d="M5.8 11.2h4.9" />
      <path d="M13.2 14.5V8.8c0-1.1.7-1.8 1.8-1.8" />
    </svg>
  );
}

function FocusIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7V4.5A.5.5 0 0 1 4.5 4H7" />
      <path d="M13 4h2.5a.5.5 0 0 1 .5.5V7" />
      <path d="M16 13v2.5a.5.5 0 0 1-.5.5H13" />
      <path d="M7 16H4.5a.5.5 0 0 1-.5-.5V13" />
      <circle cx="10" cy="10" r="2.2" />
    </svg>
  );
}

const SIZES: { id: ReadingSize; label: string; hint: string }[] = [
  { id: "s", label: "S", hint: "Compact" },
  { id: "m", label: "M", hint: "Default" },
  { id: "l", label: "L", hint: "Large" },
];

const WIDTHS: { id: ReadingWidth; label: string }[] = [
  { id: "narrow", label: "Narrow" },
  { id: "medium", label: "Medium" },
  { id: "wide", label: "Wide" },
];

const VERSE_MODES: { id: VerseNumberMode; label: string; hint: string }[] = [
  { id: "always", label: "Always", hint: "Full contrast" },
  { id: "faint", label: "Faint", hint: "Quiet numbers" },
  { id: "hover", label: "Hover", hint: "Show on row hover" },
];

/**
 * Super-clean reading chrome: one Aa control + focus toggle.
 * Size / width / verse-number density live in a small popover.
 */
export function ReadingComfort({ prefs, onChange, focusMode, onToggleFocus }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const openPopover = () => {
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <div className="reading-comfort">
      <button
        ref={btnRef}
        type="button"
        className={`reading-comfort-btn${open ? " open" : ""}`}
        onClick={() => (open ? setOpen(false) : openPopover())}
        title="Reading size & layout"
        aria-label="Reading size and layout"
        aria-expanded={open}
      >
        <AaIcon />
        <span className="reading-comfort-size-tag">{prefs.readingSize.toUpperCase()}</span>
      </button>

      <button
        type="button"
        className={`reading-comfort-btn focus-btn${focusMode ? " active" : ""}`}
        onClick={onToggleFocus}
        title={focusMode ? "Exit focus mode (F)" : "Focus mode (F) — hide chrome"}
        aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
        aria-pressed={focusMode}
      >
        <FocusIcon />
      </button>

      {open && (
        <Popover
          anchorRect={anchor}
          onClose={() => setOpen(false)}
          width={280}
          className="reading-comfort-popover"
        >
          <div className="rc-section">
            <div className="rc-label">Type size</div>
            <div className="rc-segmented" role="group" aria-label="Type size">
              {SIZES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`rc-seg${prefs.readingSize === s.id ? " active" : ""}`}
                  onClick={() => onChange({ readingSize: s.id })}
                  title={s.hint}
                  aria-pressed={prefs.readingSize === s.id}
                >
                  <span className={`rc-seg-letter size-${s.id}`}>{s.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rc-section">
            <div className="rc-label">Column width</div>
            <div className="rc-segmented" role="group" aria-label="Column width">
              {WIDTHS.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className={`rc-seg${prefs.readingWidth === w.id ? " active" : ""}`}
                  onClick={() => onChange({ readingWidth: w.id })}
                  aria-pressed={prefs.readingWidth === w.id}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>

          <div className="rc-section">
            <div className="rc-label">Verse numbers</div>
            <div className="rc-segmented" role="group" aria-label="Verse numbers">
              {VERSE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`rc-seg${prefs.verseNumbers === m.id ? " active" : ""}`}
                  onClick={() => onChange({ verseNumbers: m.id })}
                  title={m.hint}
                  aria-pressed={prefs.verseNumbers === m.id}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
