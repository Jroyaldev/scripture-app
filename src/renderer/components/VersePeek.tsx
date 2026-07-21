import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isTopLayer, useLayer } from "../layerStack.js";
import { safeCall } from "../utils/safeCall.js";

export interface PeekTarget {
  book: string;
  chapter: number;
  verse: number;
  endVerse?: number;
  label: string;
}

const OPEN_DELAY_MS = 420;
const CLOSE_DELAY_MS = 240;
const MAX_PEEK_VERSES = 8;
const PEEK_WIDTH = 320;
const VIEWPORT_MARGIN = 8;
const ANCHOR_GAP = 8;

/** Parse a canonical bref or bare backbone coordinate for an in-place preview. */
export function parsePeekRef(input: string, label: string): PeekTarget | null {
  const body = input.startsWith("bref:v1/") ? input.slice("bref:v1/".length) : input;
  const match = /^([A-Z0-9]{3})\.(\d+)\.(\d+)(?:-([A-Z0-9]{3})\.(\d+)\.(\d+))?/.exec(body);
  if (!match) return null;
  const startBook = match[1]!;
  const endBook = match[4];
  const sameScope = !endBook || endBook === startBook;
  return {
    book: startBook,
    chapter: Number(match[2]),
    verse: Number(match[3]),
    endVerse: sameScope && match[5] && Number(match[5]) === Number(match[2])
      ? Number(match[6])
      : undefined,
    label,
  };
}

interface PeekState {
  target: PeekTarget;
  anchorRect: DOMRect;
  status: "loading" | "ready" | "error";
  text: string;
  origin: "pointer" | "keyboard";
  trigger: HTMLElement;
}

interface PeekChapterText {
  verses: Array<{ verse: number; text: string }>;
}

/** Session cache: hovering across a dense reference list must not spawn one
 *  IPC round-trip per row for chapters the reader already previewed. */
const chapterTextCache = new Map<string, PeekChapterText>();
const CHAPTER_TEXT_CACHE_LIMIT = 12;

function cacheChapterText(key: string, value: PeekChapterText): void {
  if (chapterTextCache.has(key)) chapterTextCache.delete(key);
  chapterTextCache.set(key, value);
  if (chapterTextCache.size > CHAPTER_TEXT_CACHE_LIMIT) {
    const oldest = chapterTextCache.keys().next().value;
    if (oldest != null) chapterTextCache.delete(oldest);
  }
}

function samePeekTarget(left: PeekTarget, right: PeekTarget): boolean {
  return left.book === right.book
    && left.chapter === right.chapter
    && left.verse === right.verse
    && left.endVerse === right.endVerse;
}

export interface VersePeekTriggerProps {
  onMouseEnter: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseLeave: () => void;
  onFocus: (event: React.FocusEvent<HTMLElement>) => void;
  onBlur: () => void;
  "aria-haspopup"?: "dialog";
  "aria-expanded"?: boolean;
}

function PeekPanel({
  peek,
  packageId,
  onKeepOpen,
  onLeave,
  onKeepReference,
  onClose,
}: {
  peek: PeekState;
  packageId: string;
  onKeepOpen: () => void;
  onLeave: () => void;
  onKeepReference?: (target: PeekTarget) => void;
  onClose: () => void;
}): React.JSX.Element {
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    const { anchorRect } = peek;
    const left = Math.min(
      Math.max(anchorRect.left, VIEWPORT_MARGIN),
      Math.max(window.innerWidth - PEEK_WIDTH - VIEWPORT_MARGIN, VIEWPORT_MARGIN),
    );
    setPosition({ top: anchorRect.bottom + ANCHOR_GAP, left });
    const frame = window.requestAnimationFrame(() => {
      const panel = panelRef.current;
      if (!panel) return;
      const height = panel.getBoundingClientRect().height;
      if (anchorRect.bottom + ANCHOR_GAP + height > window.innerHeight - VIEWPORT_MARGIN) {
        setPosition({
          top: Math.max(anchorRect.top - ANCHOR_GAP - height, VIEWPORT_MARGIN),
          left,
        });
      }
      // A keyboard-opened preview would otherwise be unreachable: focus moves
      // into the panel so its action is a real Tab stop, and Escape returns
      // to the trigger.
      if (peek.origin === "keyboard") {
        const action = panel.querySelector<HTMLElement>(".verse-peek-keep");
        (action ?? panel).focus({ preventScroll: true });
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [peek]);

  const shell = document.querySelector(".app-shell");
  const themeClasses = shell
    ? [...shell.classList].filter((name) => name === "dark" || name.startsWith("theme-")).join(" ")
    : "";

  return createPortal(
    <div
      ref={panelRef}
      className={`verse-peek-panel ${themeClasses}`}
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, width: PEEK_WIDTH }}
      role={onKeepReference ? "dialog" : "tooltip"}
      aria-label={`Preview of ${peek.target.label}`}
      tabIndex={-1}
      onMouseEnter={onKeepOpen}
      onMouseLeave={onLeave}
      onFocus={onKeepOpen}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) onLeave();
      }}
      data-floating-layer="peek"
    >
      <div className="verse-peek-head">
        <span className="verse-peek-label">{peek.target.label}</span>
        <span className="verse-peek-version">{packageId.toUpperCase()}</span>
      </div>
      {peek.status === "loading" && <p className="verse-peek-status">Loading…</p>}
      {peek.status === "error" && (
        <p className="verse-peek-status verse-peek-error">This verse could not be loaded.</p>
      )}
      {peek.status === "ready" && <p className="verse-peek-text">{peek.text}</p>}
      {onKeepReference && (
        <div className="verse-peek-actions">
          <button
            type="button"
            className="verse-peek-keep"
            onClick={() => {
              onKeepReference(peek.target);
              onClose();
            }}
          >
            Keep in Study
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function useVersePeek(
  packageId: string,
  onKeepReference?: (target: PeekTarget) => void,
): {
  triggerProps: (target: PeekTarget) => VersePeekTriggerProps;
  peekElement: React.ReactNode;
  close: () => void;
} {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const peekRef = useRef<PeekState | null>(null);
  peekRef.current = peek;
  const openTimer = useRef(0);
  const closeTimer = useRef(0);
  const requestSeq = useRef(0);
  const layerRef = useLayer(peek ? "peek" : null);

  const cancelClose = useCallback((): void => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = 0;
  }, []);

  const closeNow = useCallback((restoreFocus = false): void => {
    window.clearTimeout(openTimer.current);
    openTimer.current = 0;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = 0;
    requestSeq.current += 1;
    const current = peekRef.current;
    setPeek(null);
    if (restoreFocus && current?.trigger.isConnected) {
      current.trigger.focus({ preventScroll: true });
    }
  }, []);

  const scheduleClose = useCallback((): void => {
    window.clearTimeout(openTimer.current);
    openTimer.current = 0;
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setPeek(null), CLOSE_DELAY_MS);
  }, []);

  const applyChapterText = useCallback((chapterText: PeekChapterText, target: PeekTarget, seq: number): void => {
    if (requestSeq.current !== seq) return;
    const rangeEnd = Math.min(target.endVerse ?? target.verse, target.verse + MAX_PEEK_VERSES - 1);
    const single = rangeEnd === target.verse;
    const lines = chapterText.verses
      .filter((item) => item.verse >= target.verse && item.verse <= rangeEnd)
      .map((item) => single ? item.text : `${item.verse} ${item.text}`);
    setPeek((current) => current ? {
      ...current,
      status: "ready",
      text: lines.join("\n") || "Verse text unavailable.",
    } : current);
  }, []);

  const openFor = useCallback((target: PeekTarget, element: HTMLElement, origin: "pointer" | "keyboard"): void => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => {
      const anchorRect = element.getBoundingClientRect();
      const seq = ++requestSeq.current;
      setPeek({ target, anchorRect, status: "loading", text: "", origin, trigger: element });
      const cacheKey = `${packageId}:${target.book}:${target.chapter}`;
      const cached = chapterTextCache.get(cacheKey);
      if (cached) {
        applyChapterText(cached, target, seq);
        return;
      }
      void safeCall(() => window.api.scripture.getChapterText(packageId, target.book, target.chapter)).then((result) => {
        if (requestSeq.current !== seq) return;
        if (!result.ok || !result.value) {
          setPeek((current) => current ? { ...current, status: "error" } : current);
          return;
        }
        cacheChapterText(cacheKey, result.value);
        applyChapterText(result.value, target, seq);
      });
    }, OPEN_DELAY_MS);
  }, [applyChapterText, packageId]);

  const triggerProps = useCallback((target: PeekTarget): VersePeekTriggerProps => ({
    onMouseEnter: (event) => openFor(target, event.currentTarget, "pointer"),
    onMouseLeave: scheduleClose,
    onFocus: (event) => openFor(target, event.currentTarget, "keyboard"),
    onBlur: scheduleClose,
    "aria-haspopup": onKeepReference ? "dialog" : undefined,
    "aria-expanded": onKeepReference
      ? Boolean(peek && samePeekTarget(peek.target, target))
      : undefined,
  }), [onKeepReference, openFor, peek, scheduleClose]);

  useEffect(() => {
    if (!peek) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The registry decides: a dialog or chooser above the peek owns Escape.
      if (!isTopLayer(layerRef.current)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeNow(peekRef.current?.origin === "keyboard");
    };
    // Scrolling moves the anchor out from under the panel. Close, then let
    // the next pointer move over the same trigger re-open the preview —
    // previously the panel was gone until the pointer fully left and
    // returned, an invisible dead zone.
    const onScroll = (): void => {
      const current = peekRef.current;
      if (!current) return;
      closeNow();
      const { target, trigger } = current;
      if (trigger.isConnected) {
        trigger.addEventListener("pointermove", () => openFor(target, trigger, "pointer"), { once: true });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [closeNow, layerRef, openFor, peek]);

  useEffect(() => () => {
    window.clearTimeout(openTimer.current);
    window.clearTimeout(closeTimer.current);
  }, []);

  return {
    triggerProps,
    close: closeNow,
    peekElement: peek ? (
      <PeekPanel
        peek={peek}
        packageId={packageId}
        onKeepOpen={cancelClose}
        onLeave={scheduleClose}
        onKeepReference={onKeepReference}
        onClose={() => closeNow(peek.origin === "keyboard")}
      />
    ) : null,
  };
}
