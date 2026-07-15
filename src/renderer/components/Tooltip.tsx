import type React from "react";
import { cloneElement, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  label: string;
  shortcut?: string;
  children: React.ReactElement<{ "aria-describedby"?: string }>;
}

interface Position {
  top: number;
  left: number;
  side: "top" | "bottom";
}

const TOOLTIP_GAP = 8;
const VIEWPORT_MARGIN = 8;
const HOVER_DELAY_MS = 420;

/** Delayed pointer tooltip that is also available on keyboard focus. */
export function Tooltip({ label, shortcut, children }: Props): React.JSX.Element {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);

  const clearTimer = (): void => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hide = (): void => {
    clearTimer();
    setVisible(false);
    setPosition(null);
  };

  const showAfter = (delay: number): void => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setVisible(true);
    }, delay);
  };

  useLayoutEffect(() => {
    if (!visible || !anchorRef.current || !tooltipRef.current) return;
    const anchor = anchorRef.current.getBoundingClientRect();
    const tooltip = tooltipRef.current.getBoundingClientRect();
    const side = anchor.top - tooltip.height - TOOLTIP_GAP >= VIEWPORT_MARGIN ? "top" : "bottom";
    const top = side === "top"
      ? anchor.top - tooltip.height - TOOLTIP_GAP
      : anchor.bottom + TOOLTIP_GAP;
    const centeredLeft = anchor.left + anchor.width / 2 - tooltip.width / 2;
    const left = Math.min(
      Math.max(centeredLeft, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - tooltip.width - VIEWPORT_MARGIN),
    );
    setPosition({ top, left, side });
  }, [visible, label, shortcut]);

  useEffect(() => {
    if (!visible) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") hide();
    };
    const onViewportChange = (): void => hide();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onViewportChange);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onViewportChange);
    };
  }, [visible]);

  useEffect(() => () => clearTimer(), []);

  const describedBy = [children.props["aria-describedby"], visible ? id : null]
    .filter(Boolean)
    .join(" ") || undefined;
  const trigger = cloneElement(children, { "aria-describedby": describedBy });

  const shell = document.querySelector(".app-shell");
  const materialClasses = shell
    ? [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ")
    : "";

  return (
    <span
      ref={anchorRef}
      className="control-tooltip-anchor"
      onPointerEnter={(event) => {
        if (event.pointerType === "mouse") showAfter(HOVER_DELAY_MS);
      }}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={() => showAfter(120)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) hide();
      }}
    >
      {trigger}
      {visible && createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`control-tooltip ${materialClasses}${position ? " is-positioned" : ""}`}
          data-side={position?.side ?? "top"}
          style={position ? { top: position.top, left: position.left } : undefined}
        >
          <span>{label}</span>
          {shortcut && <kbd>{shortcut}</kbd>}
        </div>,
        document.body,
      )}
    </span>
  );
}
