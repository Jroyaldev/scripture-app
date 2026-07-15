import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ReadingSize, ReadingWidth, VerseNumberMode } from "../api.js";
import { SegmentedControl, type SegmentedOption } from "./Controls.js";
import { Popover } from "./Popover.js";
import { Tooltip } from "./Tooltip.js";

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

const SIZES: SegmentedOption<ReadingSize>[] = [
  { value: "s", content: <span className="rc-seg-letter size-s">S</span>, accessibleLabel: "Compact type" },
  { value: "m", content: <span className="rc-seg-letter size-m">M</span>, accessibleLabel: "Default type" },
  { value: "l", content: <span className="rc-seg-letter size-l">L</span>, accessibleLabel: "Large type" },
];

const WIDTHS: SegmentedOption<ReadingWidth>[] = [
  { value: "narrow", content: "Narrow" },
  { value: "medium", content: "Medium" },
  { value: "wide", content: "Wide" },
];

const VERSE_MODES: SegmentedOption<VerseNumberMode>[] = [
  { value: "always", content: "Always", accessibleLabel: "Always show verse numbers" },
  { value: "faint", content: "Faint", accessibleLabel: "Show quiet verse numbers" },
  { value: "hover", content: "Hover", accessibleLabel: "Show verse numbers on row hover" },
];

/**
 * Super-clean reading chrome: one Aa control + focus toggle.
 * Size / width / verse-number density live in a small popover.
 */
export function ReadingComfort({ prefs, onChange, focusMode, onToggleFocus }: Props): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const shouldReturnFocus = useRef(false);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);

  const closePopover = () => {
    shouldReturnFocus.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !shouldReturnFocus.current) return;
    shouldReturnFocus.current = false;
    btnRef.current?.focus();
  }, [open]);

  const openPopover = () => {
    if (btnRef.current) setAnchor(btnRef.current.getBoundingClientRect());
    setOpen(true);
  };

  return (
    <div className="reading-comfort">
      <Tooltip label="Reading layout">
        <button
          ref={btnRef}
          type="button"
          className={`reading-comfort-btn${open ? " open" : ""}`}
          onClick={() => (open ? setOpen(false) : openPopover())}
          aria-label="Reading size and layout"
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <AaIcon />
          <span className="reading-comfort-size-tag">{prefs.readingSize.toUpperCase()}</span>
        </button>
      </Tooltip>

      <Tooltip label={focusMode ? "Exit focus" : "Focus reading"} shortcut="F">
        <button
          type="button"
          className={`reading-comfort-btn focus-btn${focusMode ? " active" : ""}`}
          onClick={onToggleFocus}
          aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"}
          aria-pressed={focusMode}
        >
          <FocusIcon />
        </button>
      </Tooltip>

      {open && (
        <Popover
          anchorRect={anchor}
          onClose={closePopover}
          width={280}
          className="reading-comfort-popover"
          ariaLabel="Reading layout"
        >
          <div className="rc-heading">
            <span>Reading layout</span>
            <small>Presentation changes. The text does not.</small>
          </div>
          <div className="rc-section">
            <div className="rc-label">Type size</div>
            <SegmentedControl
              label="Type size"
              value={prefs.readingSize}
              options={SIZES}
              onChange={(readingSize) => onChange({ readingSize })}
            />
          </div>

          <div className="rc-section">
            <div className="rc-label">Column width</div>
            <SegmentedControl
              label="Column width"
              value={prefs.readingWidth}
              options={WIDTHS}
              onChange={(readingWidth) => onChange({ readingWidth })}
            />
          </div>

          <div className="rc-section">
            <div className="rc-label">Verse numbers</div>
            <SegmentedControl
              label="Verse numbers"
              value={prefs.verseNumbers}
              options={VERSE_MODES}
              onChange={(verseNumbers) => onChange({ verseNumbers })}
            />
          </div>
        </Popover>
      )}
    </div>
  );
}
