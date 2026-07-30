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

/**
 * The page's top edge, and the floor every tooltip has to stay under.
 *
 * Rev 05 §05·2, third deletion: "The atmosphere tooltip currently lands on the
 * drag region and across the tab strip. Tooltips open BELOW their control,
 * inside the page, or not at all." The band above the page is the window's drag
 * region over the tab strip, and the section's whole argument is that nothing
 * may be drawn in it. A tooltip that opens upward out of the header is the one
 * thing in the app that can put ink there without owning a pixel of layout.
 *
 * The authority for the number is `--frame-top` in styles.css, composed there
 * as `--study-line + --register-strip`. It is mirrored rather than read because
 * a custom property that is not registered with `@property` comes back from
 * getComputedStyle as its unresolved token stream ("calc(24px + 30px)"), and a
 * placement rule may not depend on parsing that.
 *
 * CORRECTED 2026-07-30, twice in one day, which is the whole argument for the
 * way it is now checked. It read 54 while the frame's composition read 40 —
 * commit e8e2ee9 had re-canonned the canvas from 24 to 10 and left the mirror
 * behind — so every tooltip that fell back upward cleared a floor 14px lower
 * than the page it was supposed to stay inside. That was fixed to 40, and then
 * the study line took the band over and the frame's first half went from
 * --page-inset to --study-line: 24 of study line over a 30px strip, and the sum
 * is 54 again.
 *
 * Neither move was caught by reading this file, and neither could have been.
 * tests/quire-frame-top-edge-contract.test.ts pins no literal: it ADDS the two
 * declared halves in styles.css and demands that sum here, by name. Move either
 * token and this line is the one edit the failure asks for.
 */
const PAGE_TOP_EDGE = 54;

interface Placement {
  top: number;
  side: "top" | "bottom";
}

/**
 * Where the tooltip may open, or null for "not at all".
 *
 * Below first, always — that is the rule, not a preference. Above is the single
 * fallback and it is allowed only while the whole tooltip stays inside the
 * page: the moment it would reach into the frame's top band it is not drawn,
 * because the alternative is drawing it over the drag region and across the
 * register.
 */
export function tooltipPlacement(
  anchorTop: number,
  anchorBottom: number,
  tooltipHeight: number,
  viewportHeight: number,
  pageTopEdge: number = PAGE_TOP_EDGE,
): Placement | null {
  const below = anchorBottom + TOOLTIP_GAP;
  if (below + tooltipHeight <= viewportHeight - VIEWPORT_MARGIN) {
    return { top: below, side: "bottom" };
  }
  const above = anchorTop - tooltipHeight - TOOLTIP_GAP;
  if (above >= pageTopEdge) return { top: above, side: "top" };
  return null;
}

/** Delayed pointer tooltip that is also available on keyboard focus. */
export function Tooltip({ label, shortcut, children }: Props): React.JSX.Element {
  const id = useId();
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const timerRef = useRef<number | null>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  // "Or not at all" is a real third outcome, so it needs somewhere to be
  // recorded. The tooltip is measured while it is still transparent — the
  // material only fades in once `.is-positioned` lands — so a hint that turns
  // out to have nowhere legal to go is unmounted before it has ever been seen.
  const [unplaceable, setUnplaceable] = useState(false);

  const clearTimer = (): void => {
    if (timerRef.current == null) return;
    window.clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hide = (): void => {
    clearTimer();
    setVisible(false);
    setPosition(null);
    setUnplaceable(false);
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
    // This used to prefer the TOP side whenever it fitted in the viewport, and
    // the viewport's top is the window's, not the page's — which is how the
    // atmosphere hint came to be drawn across the drag band and the register.
    // The rule is now stated once, here, for every control in the app.
    const placement = tooltipPlacement(anchor.top, anchor.bottom, tooltip.height, window.innerHeight);
    if (!placement) {
      setUnplaceable(true);
      return;
    }
    const centeredLeft = anchor.left + anchor.width / 2 - tooltip.width / 2;
    const left = Math.min(
      Math.max(centeredLeft, VIEWPORT_MARGIN),
      Math.max(VIEWPORT_MARGIN, window.innerWidth - tooltip.width - VIEWPORT_MARGIN),
    );
    setPosition({ top: placement.top, left, side: placement.side });
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

  // A hint with nowhere legal to open is not described to assistive technology
  // either: `aria-describedby` pointing at an element that is not in the tree
  // is a dangling reference, not a quieter tooltip.
  const describedBy = [children.props["aria-describedby"], visible && !unplaceable ? id : null]
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
      {visible && !unplaceable && createPortal(
        <div
          ref={tooltipRef}
          id={id}
          role="tooltip"
          className={`control-tooltip ${materialClasses}${position ? " is-positioned" : ""}`}
          data-side={position?.side ?? "bottom"}
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
