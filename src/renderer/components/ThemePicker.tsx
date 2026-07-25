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
          <span className={`theme-preview theme-preview-${option.id}`} aria-hidden="true">
            <i className="theme-preview-rail" />
            <i className="theme-preview-page" />
            <i className="theme-preview-line line-one" />
            <i className="theme-preview-line line-two" />
          </span>
          <span className="theme-choice-copy">
            <strong>{option.label}</strong>
            <small>{option.description}</small>
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
          <small>The ground softens and the page lifts off it.</small>
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
      <Tooltip label={`Reading atmosphere · ${themeLabel(theme)}`}>
        <button
          ref={buttonRef}
          type="button"
          className={`theme-toggle-btn theme-toggle-${theme}${open ? " open" : ""}`}
          onClick={toggle}
          aria-label={`Reading atmosphere: ${themeLabel(theme)}`}
          aria-haspopup="dialog"
          aria-expanded={open}
        >
          <span className={`theme-orb theme-orb-${theme}`} aria-hidden="true" />
        </button>
      </Tooltip>
      {open && (
        <Popover
          anchorRect={anchorRect}
          onClose={close}
          width={328}
          className="theme-picker-popover"
          ariaLabel="Reading atmosphere"
        >
          <div className="theme-picker-heading">
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
