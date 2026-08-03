import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTopLayer, useLayer } from "../layerStack.js";

export interface PopoverBoundaryRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Props {
  id?: string;
  anchorRect: DOMRect | null;
  onClose: () => void;
  width?: number;
  maxHeight?: number;
  boundaryRect?: PopoverBoundaryRect;
  className?: string;
  ariaLabel: string;
  modal?: boolean;
  initialFocus?: boolean;
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  children: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

interface PanelPosition {
  top: number;
  left: number;
  width: number;
  maxHeight?: number;
  placement: "top" | "bottom";
}

interface ResolvedBoundary {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function resolveBoundary(boundaryRect?: PopoverBoundaryRect): ResolvedBoundary {
  if (!boundaryRect) {
    return { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
  }
  // The stage should already be on-screen, but intersecting it with the
  // viewport keeps a transient layout shift from producing unreachable UI.
  return {
    left: Math.max(0, boundaryRect.left),
    top: Math.max(0, boundaryRect.top),
    right: Math.min(window.innerWidth, boundaryRect.left + boundaryRect.width),
    bottom: Math.min(window.innerHeight, boundaryRect.top + boundaryRect.height),
  };
}

function computePosition(
  anchorRect: DOMRect,
  requestedWidth: number,
  requestedMaxHeight: number | undefined,
  boundaryRect?: PopoverBoundaryRect,
): PanelPosition {
  const boundary = resolveBoundary(boundaryRect);
  const minLeft = boundary.left + VIEWPORT_MARGIN;
  const maxRight = boundary.right - VIEWPORT_MARGIN;
  const minTop = boundary.top + VIEWPORT_MARGIN;
  const maxBottom = boundary.bottom - VIEWPORT_MARGIN;
  const availableWidth = Math.max(1, maxRight - minLeft);
  const availableHeight = Math.max(1, maxBottom - minTop);
  const width = Math.min(requestedWidth, availableWidth);
  // Existing popover classes own their own height caps. Add an inline cap
  // only when this caller explicitly requests one or supplies a tighter
  // physical boundary.
  const maxHeight = requestedMaxHeight != null || boundaryRect != null
    ? Math.min(requestedMaxHeight ?? availableHeight, availableHeight)
    : undefined;

  let left = anchorRect.left;
  let top = anchorRect.bottom + ANCHOR_GAP;

  // Clamp horizontally against the owning surface, which may be only the
  // reading stage rather than the whole browser viewport.
  const maxLeft = Math.max(minLeft, maxRight - width);
  left = Math.min(Math.max(left, minLeft), maxLeft);

  // The real panel height is measured in a second layout pass. This first
  // pass only ensures its origin is legal and caps its eventual height.
  top = Math.min(Math.max(top, minTop), maxBottom);

  return { top, left, width, maxHeight, placement: "bottom" };
}

/**
 * Generic floating panel primitive: a full-viewport scrim (click to close)
 * plus a positioned panel anchored below `anchorRect`. Used by later phases
 * for the library popover, passage picker, and version picker.
 */
export function Popover({
  id,
  anchorRect,
  onClose,
  width = 280,
  maxHeight,
  boundaryRect,
  className,
  ariaLabel,
  modal = false,
  initialFocus = true,
  initialFocusRef,
  children,
}: Props): React.JSX.Element | null {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<PanelPosition | null>(null);
  const layerRef = useLayer(anchorRect ? "popover" : null);

  useLayoutEffect(() => {
    if (!anchorRect) {
      setPosition(null);
      return;
    }
    setPosition(computePosition(anchorRect, width, maxHeight, boundaryRect));
  }, [anchorRect, boundaryRect, maxHeight, width]);

  // Second pass: the panel's real height is only known once it has actually
  // rendered, so re-clamp (or flip above the anchor) if it overflows the
  // bottom of its owning boundary. Converges after one extra layout — once the
  // panel fits, the computed top no longer changes and this becomes a no-op.
  useLayoutEffect(() => {
    if (!anchorRect || !position || !panelRef.current) return;
    const boundary = resolveBoundary(boundaryRect);
    const minTop = boundary.top + VIEWPORT_MARGIN;
    const maxBottom = boundary.bottom - VIEWPORT_MARGIN;
    const panelHeight = panelRef.current.getBoundingClientRect().height;
    if (position.top >= minTop && position.top + panelHeight <= maxBottom) return;
    const aboveTop = anchorRect.top - ANCHOR_GAP - panelHeight;
    const fitsAbove = aboveTop >= minTop && aboveTop + panelHeight <= maxBottom;
    const nextTop = fitsAbove ? aboveTop : Math.max(minTop, maxBottom - panelHeight);
    if (nextTop !== position.top) {
      setPosition((prev) => (prev ? {
        ...prev,
        top: nextTop,
        placement: fitsAbove ? "top" : prev.placement,
      } : prev));
    }
  }, [anchorRect, boundaryRect, position]);

  /* A FOCUS THE READER DID NOT ASK FOR IS NOT A FOCUS THEY SHOULD SEE RINGED.
   *
   * Opening a popover puts the caret somewhere useful — a search field, a name
   * to replace — and that is a courtesy, not a keyboard gesture. But the browser
   * cannot tell the two apart: per Selectors 4 an element that takes keyboard
   * input matches `:focus-visible` WHENEVER it is focused, programmatically
   * included. So a text field focused on the reader's behalf paints a ring, on
   * every open, mouse or keyboard alike — which is the app announcing a keyboard
   * mode nobody entered.
   *
   * `data-focus-arrival` is that distinction, written down. It is on the panel
   * for exactly as long as focus is still where WE put it; the sheet suppresses
   * rings inside it, and the first move the reader makes themselves takes it off
   * and hands the rings back. Nothing needs to put it back: the next arrival is
   * a new panel.
   *
   * The clearing listeners are deliberately broad and deliberately capture-phase
   * — every key, every pointer press, anywhere in the panel. A reader who has
   * pressed anything at all has arrived under their own power, and a narrow list
   * of "navigation keys" is a list that goes stale the first time a surface
   * invents a gesture. */
  useEffect(() => {
    if (!anchorRect || !position || !initialFocus) return;
    const timer = window.setTimeout(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const first = panel.querySelector<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const preferred = initialFocusRef?.current;
      const target = preferred && panel.contains(preferred) ? preferred : first ?? panel;
      panel.setAttribute("data-focus-arrival", "");
      target.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [anchorRect, initialFocus, initialFocusRef, position]);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel || !anchorRect || !initialFocus) return;
    const depart = (): void => panel.removeAttribute("data-focus-arrival");
    panel.addEventListener("keydown", depart, true);
    panel.addEventListener("pointerdown", depart, true);
    return () => {
      panel.removeEventListener("keydown", depart, true);
      panel.removeEventListener("pointerdown", depart, true);
    };
  }, [anchorRect, initialFocus, position]);

  useEffect(() => {
    if (!anchorRect) return;
    function handleKeyDown(e: KeyboardEvent): void {
      // Ownership comes from the shared layer registry: the topmost layer
      // consumes Escape, regardless of portal document order.
      const ownsKeyboard = isTopLayer(layerRef.current);
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        if (!ownsKeyboard) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
        return;
      }
      if (!modal || e.key !== "Tab" || !panelRef.current || !ownsKeyboard) return;
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
    // Only a real width change signals a layout the anchor cannot survive.
    // Mobile browser chrome showing/hiding during scroll fires height-only
    // resizes; closing the panel on those strands the user mid-decision.
    let lastWidth = window.innerWidth;
    const handleResize = (): void => {
      if (window.innerWidth === lastWidth) return;
      lastWidth = window.innerWidth;
      onClose();
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
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
        onPointerDown={(event) => {
          // Keep the hit shield mounted through pointerup so the completed
          // gesture cannot retarget the reading surface underneath it.
          event.preventDefault();
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        aria-hidden="true"
      />
      <div
        id={id}
        ref={panelRef}
        className={`popover-panel ${materialClasses}${className ? ` ${className}` : ""}`}
        style={{
          top: position.top,
          left: position.left,
          width: position.width,
          maxHeight: position.maxHeight,
        }}
        role="dialog"
        aria-label={ariaLabel}
        aria-modal={modal || undefined}
        tabIndex={-1}
        data-floating-layer="popover"
        data-placement={position.placement}
        data-position-boundary={boundaryRect ? "custom" : "viewport"}
      >
        {children}
      </div>
    </>,
    document.body,
  );
}
