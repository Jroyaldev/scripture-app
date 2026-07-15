import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface Props {
  anchorRect: DOMRect | null;
  onClose: () => void;
  width?: number;
  className?: string;
  ariaLabel: string;
  modal?: boolean;
  initialFocus?: boolean;
  children: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

interface PanelPosition {
  top: number;
  left: number;
  placement: "top" | "bottom";
}

function computePosition(anchorRect: DOMRect, width: number): PanelPosition {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = anchorRect.left;
  let top = anchorRect.bottom + ANCHOR_GAP;

  // Clamp horizontally so the panel never overflows the viewport.
  const maxLeft = viewportWidth - width - VIEWPORT_MARGIN;
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(maxLeft, VIEWPORT_MARGIN));

  // Clamp vertically — if there isn't room below, keep it on-screen.
  const maxTop = viewportHeight - VIEWPORT_MARGIN;
  top = Math.min(top, maxTop);

  return { top, left, placement: "bottom" };
}

/**
 * Generic floating panel primitive: a full-viewport scrim (click to close)
 * plus a positioned panel anchored below `anchorRect`. Used by later phases
 * for the library popover, passage picker, and version picker.
 */
export function Popover({
  anchorRect,
  onClose,
  width = 280,
  className,
  ariaLabel,
  modal = false,
  initialFocus = true,
  children,
}: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);

  useLayoutEffect(() => {
    if (!anchorRect) {
      setPosition(null);
      return;
    }
    setPosition(computePosition(anchorRect, width));
  }, [anchorRect, width]);

  // Second pass: the panel's real height is only known once it has actually
  // rendered, so re-clamp (or flip above the anchor) if it overflows the
  // bottom of the viewport. Converges after one extra layout — once the
  // panel fits, the computed top no longer changes and this becomes a no-op.
  useLayoutEffect(() => {
    if (!anchorRect || !position || !panelRef.current) return;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    const maxTop = window.innerHeight - VIEWPORT_MARGIN;
    if (position.top + panelHeight <= maxTop) return;
    const aboveTop = anchorRect.top - ANCHOR_GAP - panelHeight;
    const nextTop = aboveTop >= VIEWPORT_MARGIN ? aboveTop : Math.max(VIEWPORT_MARGIN, maxTop - panelHeight);
    if (nextTop !== position.top) {
      setPosition((prev) => (prev ? {
        ...prev,
        top: nextTop,
        placement: aboveTop >= VIEWPORT_MARGIN ? "top" : prev.placement,
      } : prev));
    }
  }, [anchorRect, position]);

  useEffect(() => {
    if (!anchorRect || !position || !initialFocus) return;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      (first ?? panel).focus();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [anchorRect, initialFocus, position]);

  useEffect(() => {
    if (!anchorRect) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (!modal || e.key !== "Tab" || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )];
      if (focusable.length === 0) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [anchorRect, modal, onClose]);

  useEffect(() => {
    if (!anchorRect) return;
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [anchorRect, onClose]);

  if (!anchorRect || !position) return null;

  // Popovers portal to body so fixed layers are not flattened by a glass
  // surface's backdrop-filter. Copy the active material classes so design
  // tokens continue to inherit outside the app-shell subtree.
  const shell = document.querySelector(".app-shell");
  const materialClasses = shell
    ? [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ")
    : "";

  return createPortal(
    <>
      <div
        className={`popover-scrim${modal ? " is-soft" : ""} ${materialClasses}`}
        onPointerDown={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        className={`popover-panel ${materialClasses}${className ? ` ${className}` : ""}`}
        style={{ top: position.top, left: position.left, width }}
        role="dialog"
        aria-label={ariaLabel}
        aria-modal={modal || undefined}
        tabIndex={-1}
        data-floating-layer="popover"
        data-placement={position.placement}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
