import { useCallback, useEffect, useRef } from "react";
import type { RefObject } from "react";

interface UnderlayMeasurementLifecycleOptions<ElementType extends HTMLElement> {
  /** Element whose coordinate space and reflow govern the underlay. */
  containerRef: RefObject<ElementType | null>;
  /** Performs one synchronous DOM measurement and state commit. */
  measure: () => void;
  /** Clears geometry derived from an earlier layout before measuring again. */
  invalidateMeasurement?: () => void;
  /** Clears font-derived geometry when the active font set settles. */
  onFontsSettled?: () => void;
  /** Also observe the reading stage when its available margin air matters. */
  observeStage?: boolean;
}

/**
 * Shared scheduling lifecycle for DOM-measured renderer underlays.
 *
 * Every trigger is folded into one animation-frame callback. Callback refs are
 * refreshed during render so long-lived observers never call a stale closure.
 * The returned scheduler uses that same queue for data/theme-driven passes.
 */
export function useUnderlayMeasurementLifecycle<ElementType extends HTMLElement>({
  containerRef,
  measure,
  invalidateMeasurement,
  onFontsSettled,
  observeStage = false,
}: UnderlayMeasurementLifecycleOptions<ElementType>): () => void {
  const measureRef = useRef(measure);
  const invalidateRef = useRef(invalidateMeasurement);
  const fontsSettledRef = useRef(onFontsSettled);
  const frameRef = useRef<number | null>(null);
  const pendingInvalidationRef = useRef(false);
  const pendingFontSettlementRef = useRef(false);

  measureRef.current = measure;
  invalidateRef.current = invalidateMeasurement;
  fontsSettledRef.current = onFontsSettled;

  const scheduleMeasurement = useCallback((): void => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;

      const fontsSettled = pendingFontSettlementRef.current;
      const invalidate = pendingInvalidationRef.current;
      pendingFontSettlementRef.current = false;
      pendingInvalidationRef.current = false;

      if (fontsSettled) fontsSettledRef.current?.();
      if (invalidate) invalidateRef.current?.();
      measureRef.current();
    });
  }, []);

  // This must be a passive effect. The underlays are children of the element
  // supplied through containerRef; during child layout effects that parent
  // host ref can still be unattached, which would silently skip the lifetime
  // observer forever. Passive effects run after the complete ref commit.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let disposed = false;
    const scheduleLayoutMeasurement = (): void => {
      pendingInvalidationRef.current = true;
      scheduleMeasurement();
    };
    const scheduleFontMeasurement = (): void => {
      pendingFontSettlementRef.current = true;
      pendingInvalidationRef.current = true;
      scheduleMeasurement();
    };

    const observer = new ResizeObserver(scheduleLayoutMeasurement);
    observer.observe(container);
    if (observeStage) {
      const stage = container.closest<HTMLElement>(".scripture-reading-stage");
      if (stage && stage !== container) observer.observe(stage);
    }

    window.addEventListener("resize", scheduleLayoutMeasurement);

    const fontSet = document.fonts;
    const handleFontsLoaded = (): void => {
      if (!disposed) scheduleFontMeasurement();
    };
    fontSet.addEventListener("loadingdone", handleFontsLoaded);
    void fontSet.ready.then(handleFontsLoaded).catch(() => undefined);

    scheduleLayoutMeasurement();

    return () => {
      disposed = true;
      observer.disconnect();
      window.removeEventListener("resize", scheduleLayoutMeasurement);
      fontSet.removeEventListener("loadingdone", handleFontsLoaded);
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      pendingInvalidationRef.current = false;
      pendingFontSettlementRef.current = false;
    };
  }, [containerRef, observeStage, scheduleMeasurement]);

  return scheduleMeasurement;
}
