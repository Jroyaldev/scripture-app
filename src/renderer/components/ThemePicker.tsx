import type React from "react";
import { useEffect, useRef, useState } from "react";
import { Popover } from "./Popover.js";
import { Tooltip } from "./Tooltip.js";
import { THEME_OPTIONS, themeLabel, type AppMaterial, type AppTheme } from "../theme.js";

interface ThemeChoiceGridProps {
  theme: AppTheme;
  onChange: (theme: AppTheme) => void;
  material?: AppMaterial;
  onMaterialChange?: (material: AppMaterial) => void;
  compact?: boolean;
}

export function ThemeChoiceGrid({
  theme,
  onChange,
  material,
  onMaterialChange,
  compact = false,
}: ThemeChoiceGridProps): React.JSX.Element {
  return (
    <>
    <div className={`theme-choice-grid${compact ? " compact" : ""}`} role="radiogroup" aria-label="Reading atmosphere">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          data-theme-id={option.id}
          className={`theme-choice${theme === option.id ? " active" : ""}`}
          onClick={() => onChange(option.id)}
          role="radio"
          aria-checked={theme === option.id}
        >
          {/* Two drawings for two surfaces, because they stand on different
              ground. The popover hangs over the running app, so a miniature of
              that app is a picture of what is already behind it: one swatch of
              the atmosphere's paper says the whole of what it can say. The
              settings page has been navigated to in order to compare, so the
              rail, the page and the two lines are worth their room there. */}
          {compact ? (
            <span className={`theme-swatch theme-swatch-${option.id}`} aria-hidden="true" />
          ) : (
            <span className={`theme-preview theme-preview-${option.id}`} aria-hidden="true">
              <i className="theme-preview-rail" />
              <i className="theme-preview-page" />
              <i className="theme-preview-line line-one" />
              <i className="theme-preview-line line-two" />
            </span>
          )}
          {/* The popover names; the settings page explains. Four sentences in a
              list of four options is a paragraph to read before a choice that
              is visible the instant it is made — and undone as quickly. */}
          <span className="theme-choice-copy">
            <strong>{option.label}</strong>
            {!compact && <small>{option.description}</small>}
          </span>
          <span className="theme-choice-check" aria-hidden="true">✓</span>
        </button>
      ))}
    </div>
    {onMaterialChange && (
      /* The only genuinely binary preference in the app, and therefore the
         only thing drawn as a switch. Four appearances and one switch — not
         six atmospheres, two of which were secretly the other four. */
      <label className="material-switch">
        <span className="material-switch-copy">
          <strong>Translucent</strong>
          {!compact && <small>The ground softens and the page lifts off it.</small>}
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={material === "translucent"}
          onChange={(event) => onMaterialChange(event.target.checked ? "translucent" : "solid")}
        />
        <span className="material-switch-track" aria-hidden="true" />
      </label>
    )}
    </>
  );
}

interface ThemePickerProps {
  theme: AppTheme;
  onChange: (theme: AppTheme) => void;
  material?: AppMaterial;
  onMaterialChange?: (material: AppMaterial) => void;
}

export function ThemePicker({ theme, onChange, material, onMaterialChange }: ThemePickerProps): React.JSX.Element {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const shouldReturnFocus = useRef(false);
  const [open, setOpen] = useState(false);
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null);

  const toggle = () => {
    if (!open && buttonRef.current) setAnchorRect(buttonRef.current.getBoundingClientRect());
    setOpen((current) => !current);
  };

  const close = () => {
    shouldReturnFocus.current = true;
    setOpen(false);
  };

  useEffect(() => {
    if (open || !shouldReturnFocus.current) return;
    shouldReturnFocus.current = false;
    buttonRef.current?.focus();
  }, [open]);

  return (
    <>
      {/* The fifth instrument, and the only one that is not a word: §E draws a
          16px squircle rather than a name. It carries no theme class any more,
          because there is no atmosphere it could paint — this band is paper, so
          a chip of the current paper is 1.00:1 against the surface it lies on,
          and the sheet's own comment does that arithmetic in full. It is the
          instrument's ink instead, which is why it needs nothing from here.
          It keeps its tooltip for the same reason the four words lost theirs —
          a mark has no text to read, so the hint is the only place the
          atmosphere's name appears. */}
      <Tooltip label={`Reading atmosphere · ${themeLabel(theme)}`}>
        <button
          ref={buttonRef}
          type="button"
          className="topbar-instrument"
          data-instrument="theme"
          onClick={toggle}
          aria-label={`Reading atmosphere: ${themeLabel(theme)}`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className="theme-orb" aria-hidden="true" />
        </button>
      </Tooltip>
      {/* 328 was the width four descriptions needed. What is left is four names,
          so the panel is the width of its own content again. */}
      {open && (
        <Popover
          anchorRect={anchorRect}
          onClose={close}
          width={256}
          className="theme-picker-popover"
          ariaLabel="Reading atmosphere"
        >
          {/* The translation menu's heading, not a second one of this popover's
             own. Two pickers in the same band drawing their titles in two
             voices — serif there, mono uppercase here — was the header saying
             "these are different kinds of thing" about two lists of options. */}
          <div className="picker-menu-heading">
            <span>Reading atmosphere</span>
            <small>Material changes. Meaning does not.</small>
          </div>
          <ThemeChoiceGrid
            theme={theme}
            compact
            material={material}
            {...(onMaterialChange ? { onMaterialChange } : {})}
            onChange={(next) => {
              onChange(next);
              close();
            }}
          />
        </Popover>
      )}
    </>
  );
}
