import type React from "react";
import { forwardRef, useRef } from "react";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "icon";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  busy?: boolean;
}

/**
 * Shared action primitive. Visual variants never imply data semantics: gold is
 * reserved for focus/current state, while destructive intent is named here.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "secondary",
    size = "md",
    busy = false,
    className,
    disabled,
    children,
    type = "button",
    ...props
  },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className={[
        "control-button",
        `control-button--${variant}`,
        `control-button--${size}`,
        className,
      ].filter(Boolean).join(" ")}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-control="button"
      data-variant={variant}
    >
      {busy && <span className="control-button-spinner" aria-hidden="true" />}
      <span className="control-button-label">{children}</span>
    </button>
  );
});

export const ControlInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  function ControlInput({ className, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        className={["control-input", className].filter(Boolean).join(" ")}
        data-control="input"
      />
    );
  },
);

export const ControlTextarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function ControlTextarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={["control-input", "control-textarea", className].filter(Boolean).join(" ")}
        data-control="textarea"
      />
    );
  },
);

export interface SegmentedOption<T extends string> {
  value: T;
  content: React.ReactNode;
  accessibleLabel?: string;
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onChange: (value: T) => void;
  className?: string;
}

/** A single-tab-stop radio group with complete arrow/Home/End navigation. */
export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: SegmentedControlProps<T>): React.JSX.Element {
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));

  const moveTo = (index: number): void => {
    const nextIndex = (index + options.length) % options.length;
    const next = options[nextIndex];
    if (!next) return;
    onChange(next.value);
    window.setTimeout(() => itemRefs.current[nextIndex]?.focus(), 0);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = options.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    moveTo(nextIndex);
  };

  return (
    <div
      className={["control-segmented", className].filter(Boolean).join(" ")}
      role="radiogroup"
      aria-label={label}
      aria-orientation="horizontal"
      data-control="segmented"
    >
      {options.map((option, index) => {
        const selected = index === selectedIndex;
        return (
          <button
            key={option.value}
            ref={(node) => { itemRefs.current[index] = node; }}
            type="button"
            className={`control-segment${selected ? " active" : ""}`}
            role="radio"
            aria-checked={selected}
            aria-label={option.accessibleLabel}
            data-value={option.value}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
          >
            {option.content}
          </button>
        );
      })}
    </div>
  );
}
