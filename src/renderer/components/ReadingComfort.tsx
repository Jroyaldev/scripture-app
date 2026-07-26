import type React from "react";
import { useEffect, useRef, useState } from "react";
import type { ReadingSize, VerseNumberMode } from "../api.js";
import { SegmentedControl, type SegmentedOption } from "./Controls.js";
import { Popover } from "./Popover.js";

export interface ReadingPrefs {
  readingSize: ReadingSize;
  verseNumbers: VerseNumberMode;
}

interface Props {
  prefs: ReadingPrefs;
  onChange: (partial: Partial<ReadingPrefs>) => void;
}

const SIZES: SegmentedOption<ReadingSize>[] = [
  { value: "s", content: <span className="rc-seg-letter size-s">S</span>, accessibleLabel: "Compact type" },
  { value: "m", content: <span className="rc-seg-letter size-m">M</span>, accessibleLabel: "Default type" },
  { value: "l", content: <span className="rc-seg-letter size-l">L</span>, accessibleLabel: "Large type" },
];

const VERSE_MODES: SegmentedOption<VerseNumberMode>[] = [
  { value: "always", content: "Always", accessibleLabel: "Always show verse numbers" },
  { value: "faint", content: "Faint", accessibleLabel: "Show quiet verse numbers" },
  { value: "hover", content: "Hover", accessibleLabel: "Show verse numbers on row hover" },
];

/**
 * The header's second instrument: the word "Comfort", and the popover behind
 * it holding type size and verse-number density.
 *
 * There is no separate measure control, and that is deliberate rather than an
 * omission: size and measure couple in the stylesheet, so the size segment is
 * already the control that widens the column. A Narrow/Medium/Wide switch sat
 * here until the coupling landed, and for one commit it survived its own CSS —
 * it wrote `reading-width-*` onto the shell and no rule anywhere read it.
 *
 * Focus used to live here as a sibling button, and it does not any more —
 * §E fixes the instrument order as translation, comfort, margin, focus, theme,
 * which puts Margin between these two. A component that owned both could not
 * produce that row, so Focus is now rendered by the header itself.
 */
export function ReadingComfort({ prefs, onChange }: Props): React.JSX.Element {
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
    <>
      {/* No tooltip: the control is the word for the thing it opens, so a hint
          repeating that word 420ms later is the header saying it twice. The
          aria-label contains the visible word so speech input still reaches
          it by what is written on it. */}
      <button
        ref={btnRef}
        type="button"
        className="topbar-instrument"
        data-instrument="comfort"
        onClick={() => (open ? setOpen(false) : openPopover())}
        aria-label="Comfort — reading size and layout"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        Comfort
      </button>

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
    </>
  );
}
