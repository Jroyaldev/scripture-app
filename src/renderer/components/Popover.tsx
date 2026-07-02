import type React from "react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

interface Props {
  anchorRect: DOMRect | null;
  onClose: () => void;
  width?: number;
  className?: string;
  children: React.ReactNode;
}

const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

interface PanelPosition {
  top: number;
  left: number;
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

  return { top, left };
}

/**
 * Generic floating panel primitive: a full-viewport scrim (click to close)
 * plus a positioned panel anchored below `anchorRect`. Used by later phases
 * for the library popover, passage picker, and version picker.
 */
export function Popover({ anchorRect, onClose, width = 280, className, children }: Props): React.JSX.Element | null {
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
      setPosition((prev) => (prev ? { ...prev, top: nextTop } : prev));
    }
  }, [anchorRect, position]);

  useEffect(() => {
    if (!anchorRect) return;
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [anchorRect, onClose]);

  if (!anchorRect || !position) return null;

  return (
    <>
      <div className="popover-scrim" onClick={onClose} />
      <div
        ref={panelRef}
        className={`popover-panel${className ? ` ${className}` : ""}`}
        style={{ top: position.top, left: position.left, width }}
      >
        {children}
      </div>
    </>
  );
}
