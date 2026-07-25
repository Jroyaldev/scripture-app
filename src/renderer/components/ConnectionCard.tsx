import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { isBinaryConnectionKind } from "../../core/annotations/index.js";
import type {
  ConnectionAnchor,
  ConnectionRecord,
  ConnectionRecordV2,
} from "../../core/annotations/types.js";
import { BOOK_CODES } from "../../core/reference/types.js";
import type { BookNameData } from "../api.js";
import { isTopLayer, useLayer } from "../layerStack.js";
import {
  connectionRecordFingerprint,
  type ConnectionMutationUiOutcome,
} from "../utils/connectionMutationReconciliation.js";
import type { ConnectionPaintAnchor } from "../utils/connectionPaint.js";
import { phraseCount, RELATIONSHIP_LABELS, RELATIONSHIPS } from "../utils/relationshipVocabulary.js";
import type {
  WorkspaceExitController,
  WorkspaceTransitionReason,
} from "../utils/workspaceTransition.js";

interface Props {
  connection: ConnectionRecord;
  paintAnchors: readonly ConnectionPaintAnchor[];
  bookNames: BookNameData;
  book: string;
  chapter: number;
  packageId: string;
  otherHeldCount: number;
  onDismiss: (restoreFocus?: boolean) => void;
  onClose: (restoreFocus?: boolean) => void;
  onJump: (anchor: ConnectionAnchor) => void;
  onNote: (connection: ConnectionRecord) => void;
  onExtend: (connection: ConnectionRecordV2) => void;
  onUpdate: (
    connection: ConnectionRecordV2,
    commandId: string,
    expectedBaseEventId: string,
  ) => Promise<ConnectionMutationUiOutcome>;
  onDelete: (
    connection: ConnectionRecord,
    commandId: string,
    expectedBaseEventId: string,
  ) => Promise<ConnectionMutationUiOutcome>;
  onRefresh: () => void;
  recovery?: ConnectionCardRecovery | null;
  onRecoveryChange: (recovery: ConnectionCardRecovery | null) => void;
  onMutationStateChange?: (state: "idle" | "in-flight" | "recovery") => void;
  onExitControllerChange?: (controller: WorkspaceExitController | null) => void;
}

type MomentPosition = "above" | "here" | "below";

interface MomentView {
  position: MomentPosition;
  current: boolean;
}

const KIND_LABELS: Record<ConnectionRecord["kind"], string> = RELATIONSHIP_LABELS;

const CANONICAL_BOOK_RANK = new Map<string, number>(
  BOOK_CODES.map((bookCode, index) => [bookCode, index]),
);

function anchorReference(anchor: ConnectionAnchor, bookNames: BookNameData): string {
  const bookName = bookNames[anchor.book]?.[0] ?? anchor.book;
  const verses = anchor.verse_start === anchor.verse_end
    ? `${anchor.verse_start}`
    : `${anchor.verse_start}–${anchor.verse_end}`;
  return `${bookName} ${anchor.chapter}:${verses}`;
}

function compactAnchorReference(anchor: ConnectionAnchor, currentBook: string): string {
  const verses = anchor.verse_start === anchor.verse_end
    ? `${anchor.verse_start}`
    : `${anchor.verse_start}–${anchor.verse_end}`;
  return `${anchor.book === currentBook ? "" : `${anchor.book} `}${anchor.chapter}:${verses}`;
}

function displayTitle(connection: ConnectionRecord): string {
  const prefix = `${KIND_LABELS[connection.kind]} · `;
  const title = connection.label.startsWith(prefix)
    ? connection.label.slice(prefix.length)
    : connection.label;
  return title.trim() || KIND_LABELS[connection.kind];
}

function formatConnectionTimestamp(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "time unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function connectionMutationFingerprint(connection: ConnectionRecord): string {
  return connectionRecordFingerprint(connection);
}

function momentPhrase(
  anchor: ConnectionAnchor,
  packageId: string,
  paintAnchor: ConnectionPaintAnchor | undefined,
): string {
  const projected = paintAnchor?.fragments.map((fragment) => fragment.quote).join(" ").trim();
  if (projected) return projected;
  const locator = anchor.render_locator;
  return locator?.package === packageId && locator.quote.trim().length > 0
    ? locator.quote
    : "Exact wording unavailable in this translation";
}

/* @quire trigger · taxonomy · Rev 04 §8 withdraws the departure row and states
   that "members never leave the unit" — but the durable store already holds
   connections whose anchors do, and this function is how the inspector shows
   them. Nothing renders beneath the passage for them (that row was never
   built, and is not being built), and no canvas ink is spent on them: the
   underlay filters anchors to the current book and chapter before it measures.
   What is left is this list marking such a member "above"/"below" and dimming
   its row, which is the only place a reader can see that the member exists at
   all.

   Deleting it would widen the nearest slot in the wrong direction — it would
   make out-of-unit members invisible rather than impossible, and §9 is
   explicit that widening a slot is how a taxonomy quietly acquires the thing
   it was written to exclude. Retained pending one answer: are out-of-unit
   anchors now invalid (in which case they need a migration, not a hidden
   list), or merely undrawn? */
function relativePosition(anchor: ConnectionAnchor, book: string, chapter: number): MomentPosition {
  if (anchor.book === book) return anchor.chapter < chapter ? "above" : "below";
  const anchorRank = CANONICAL_BOOK_RANK.get(anchor.book) ?? Number.MAX_SAFE_INTEGER;
  const currentRank = CANONICAL_BOOK_RANK.get(book) ?? Number.MAX_SAFE_INTEGER;
  return anchorRank < currentRank ? "above" : "below";
}

function sameMomentViews(left: readonly MomentView[], right: readonly MomentView[]): boolean {
  return left.length === right.length && left.every((view, index) =>
    view.position === right[index]?.position && view.current === right[index]?.current);
}

function useMomentViews(
  anchors: readonly ConnectionAnchor[],
  book: string,
  chapter: number,
  packageId: string,
): readonly MomentView[] {
  const [views, setViews] = useState<readonly MomentView[]>(() =>
    anchors.map((anchor) => ({
      position: anchor.book === book && anchor.chapter === chapter
        ? "here"
        : relativePosition(anchor, book, chapter),
      current: false,
    })),
  );

  useEffect(() => {
    const reading = document.querySelector<HTMLElement>(".scripture-content");
    let frame = 0;
    let disposed = false;

    const measure = (): void => {
      frame = 0;
      if (disposed) return;
      const viewport = reading?.getBoundingClientRect();
      const viewportTop = Math.max(viewport?.top ?? 0, 72);
      const viewportBottom = Math.min(viewport?.bottom ?? window.innerHeight, window.innerHeight - 36);
      const eyeLine = (viewport?.top ?? 0) + (viewport?.height ?? window.innerHeight) * 0.42;
      const distances = new Map<number, number>();

      const next = anchors.map((anchor, index): MomentView => {
        if (anchor.book !== book || anchor.chapter !== chapter) {
          return { position: relativePosition(anchor, book, chapter), current: false };
        }
        const start = reading?.querySelector<HTMLElement>(`.verse-line[data-verse="${anchor.verse_start}"]`);
        const end = reading?.querySelector<HTMLElement>(`.verse-line[data-verse="${anchor.verse_end}"]`) ?? start;
        if (!start || !end) return { position: "here", current: false };
        const startRect = start.getBoundingClientRect();
        const endRect = end.getBoundingClientRect();
        const top = Math.min(startRect.top, endRect.top);
        const bottom = Math.max(startRect.bottom, endRect.bottom);
        if (bottom < viewportTop) return { position: "above", current: false };
        if (top > viewportBottom) return { position: "below", current: false };
        distances.set(index, Math.abs((top + bottom) / 2 - eyeLine));
        return { position: "here", current: false };
      });

      let currentIndex = -1;
      let nearest = Number.POSITIVE_INFINITY;
      for (const [index, distance] of distances) {
        if (distance < nearest) {
          nearest = distance;
          currentIndex = index;
        }
      }
      if (currentIndex >= 0 && next[currentIndex]) next[currentIndex] = { ...next[currentIndex], current: true };
      setViews((current) => sameMomentViews(current, next) ? current : next);
    };

    const scheduleMeasure = (): void => {
      if (disposed || frame !== 0) return;
      frame = window.requestAnimationFrame(measure);
    };

    scheduleMeasure();
    reading?.addEventListener("scroll", scheduleMeasure, { passive: true });
    window.addEventListener("resize", scheduleMeasure);
    const layoutObserver = reading ? new ResizeObserver(scheduleMeasure) : null;
    if (reading) layoutObserver?.observe(reading);

    // Translation swaps can replace every verse node without changing the
    // reading viewport's outer size. One subtree observer catches that case
    // (and async text hydration) while the shared rAF queue keeps the work to
    // one measurement per frame.
    const contentObserver = reading ? new MutationObserver(scheduleMeasure) : null;
    if (reading) {
      contentObserver?.observe(reading, {
        childList: true,
        characterData: true,
        subtree: true,
      });
    }

    const fontSet = document.fonts;
    const handleFontsLoaded = (): void => scheduleMeasure();
    fontSet.addEventListener("loadingdone", handleFontsLoaded);
    void fontSet.ready.then(handleFontsLoaded).catch(() => undefined);

    return () => {
      disposed = true;
      if (frame !== 0) window.cancelAnimationFrame(frame);
      reading?.removeEventListener("scroll", scheduleMeasure);
      window.removeEventListener("resize", scheduleMeasure);
      layoutObserver?.disconnect();
      contentObserver?.disconnect();
      fontSet.removeEventListener("loadingdone", handleFontsLoaded);
    };
  }, [anchors, book, chapter, packageId]);

  return views;
}

interface PendingUpdateCommand {
  fingerprint: string;
  commandId: string;
  expectedBaseEventId: string;
  /** Frozen whole-record payload; Retry must never rebuild it from stale props. */
  next: ConnectionRecordV2;
}

interface PendingDeleteCommand {
  commandId: string;
  expectedBaseEventId: string;
  /** Preserve the exact visible record the delete was initiated against. */
  connection: ConnectionRecord;
}

interface QueuedCardEdit {
  /** Drain only after the exact first authored payload becomes visible. */
  afterFingerprint: string;
  patch: Partial<Pick<ConnectionRecordV2, "label" | "observation">>;
}

type RecoveryState = "committed-pending" | "unconfirmed";

export type ConnectionCardRecovery =
  | { kind: "update"; state: RecoveryState; command: PendingUpdateCommand; visibleConnection: ConnectionRecord }
  | { kind: "delete"; state: RecoveryState; command: PendingDeleteCommand; visibleConnection: ConnectionRecord };

type AmbiguousMutation = Pick<ConnectionCardRecovery, "kind" | "state">;

export function ConnectionCard({
  connection,
  paintAnchors,
  bookNames,
  book,
  chapter,
  packageId,
  otherHeldCount,
  onDismiss,
  onClose,
  onJump,
  onNote,
  onExtend,
  onUpdate,
  onDelete,
  onRefresh,
  recovery = null,
  onRecoveryChange,
  onMutationStateChange,
  onExitControllerChange,
}: Props): React.JSX.Element {
  const kindLabel = KIND_LABELS[connection.kind];
  const titlePrefix = `${kindLabel} · `;
  const originalTitle = displayTitle(connection);
  const currentObservation = connection.format_version === 2 ? connection.observation : "";
  const [draftLabel, setDraftLabel] = useState(originalTitle);
  const [draftObservation, setDraftObservation] = useState(currentObservation);
  const draftLabelRef = useRef(draftLabel);
  const draftObservationRef = useRef(draftObservation);
  draftLabelRef.current = draftLabel;
  draftObservationRef.current = draftObservation;
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ambiguousMutation, setAmbiguousMutation] = useState<AmbiguousMutation | null>(
    recovery ? { kind: recovery.kind, state: recovery.state } : null,
  );
  const [queuedEditPending, setQueuedEditPending] = useState(false);
  const [conflictReview, setConflictReview] = useState<"update" | "delete" | null>(null);
  const [exitGuardReason, setExitGuardReason] = useState<WorkspaceTransitionReason | null>(null);
  const requestInFlightRef = useRef(false);
  // The card is the visible face of the selected relationship shape. It
  // registers as that shape's Escape owner; an active marking session or an
  // open chooser outranks it in the shared layer registry.
  const layerRef = useLayer("connection-focus");
  const exitGuardLayerRef = useLayer(exitGuardReason ? "dialog" : null);
  const mutationStateRef = useRef<"idle" | "in-flight" | "recovery">(
    recovery ? "recovery" : "idle",
  );
  const conflictReviewRef = useRef<"update" | "delete" | null>(null);
  const latestConnectionRef = useRef(connection);
  latestConnectionRef.current = connection;
  const onRecoveryChangeRef = useRef(onRecoveryChange);
  onRecoveryChangeRef.current = onRecoveryChange;
  // Track the last authoritative values adopted into each field separately.
  // A fresh query object may contain a newer value for one field while the
  // reader still owns an unsaved draft in the other; record identity alone is
  // never permission to overwrite that local edit.
  const adoptedTitleRef = useRef(originalTitle);
  const adoptedObservationRef = useRef(currentObservation);
  const updateCommandRef = useRef<PendingUpdateCommand | null>(
    recovery?.kind === "update" ? recovery.command : null,
  );
  const deleteCommandRef = useRef<PendingDeleteCommand | null>(
    recovery?.kind === "delete" ? recovery.command : null,
  );
  // Delete pressed over a dirty card first saves one combined draft. Arm the
  // destructive confirmation only after that exact authored version is
  // visible, never against the stale base event the editor started from.
  const armDeleteAfterFingerprintRef = useRef<string | null>(null);
  const queuedCardEditRef = useRef<QueuedCardEdit | null>(null);
  const exitGuardRef = useRef<HTMLDivElement | null>(null);
  const exitGuardKeepRef = useRef<HTMLButtonElement | null>(null);
  const exitGuardPromiseRef = useRef<Promise<boolean> | null>(null);
  const exitGuardResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const exitGuardOriginRef = useRef<HTMLElement | null>(null);
  const exitSavePromiseRef = useRef<Promise<boolean> | null>(null);
  const connectionVersion = connectionMutationFingerprint(connection);
  const views = useMomentViews(connection.anchors, book, chapter, packageId);
  const mutationLocked = busy || queuedEditPending || conflictReview != null || ambiguousMutation != null;
  const labelChanged = draftLabel !== originalTitle;
  const observationChanged = draftObservation !== currentObservation;

  const reportMutationState = useCallback((state: "idle" | "in-flight" | "recovery"): void => {
    mutationStateRef.current = state;
    onMutationStateChange?.(state);
  }, [onMutationStateChange]);

  useEffect(() => {
    reportMutationState(
      ambiguousMutation != null || conflictReview != null
        ? "recovery"
        : busy || queuedEditPending ? "in-flight" : "idle",
    );
  }, [ambiguousMutation, busy, conflictReview, queuedEditPending, reportMutationState]);

  useEffect(() => () => {
    // A keyed-card replacement must never unlock a command that still owns an
    // IPC request, queued follow-up, or recovery decision. Normal idle release
    // still clears the parent lock.
    if (mutationStateRef.current === "idle") onMutationStateChange?.("idle");
  }, [onMutationStateChange]);

  useEffect(() => {
    if (!recovery) return;
    conflictReviewRef.current = null;
    setConflictReview(null);
    if (recovery.kind === "update") {
      updateCommandRef.current = recovery.command;
      deleteCommandRef.current = null;
    } else {
      deleteCommandRef.current = recovery.command;
      updateCommandRef.current = null;
    }
    setAmbiguousMutation({ kind: recovery.kind, state: recovery.state });
  }, [recovery]);

  useEffect(() => {
    const updateOwnsCurrentVersion = updateCommandRef.current != null && (
      updateCommandRef.current.expectedBaseEventId === connection.activeEventId
      || updateCommandRef.current.fingerprint === connectionVersion
    );
    const deleteOwnsCurrentVersion = deleteCommandRef.current?.expectedBaseEventId === connection.activeEventId;
    const commandMustRemainReachable = requestInFlightRef.current
      || ambiguousMutation != null
      || conflictReview != null
      || queuedCardEditRef.current != null
      || recovery != null;
    const armDeleteForCurrentVersion = armDeleteAfterFingerprintRef.current === connectionVersion;
    if (!updateOwnsCurrentVersion && !deleteOwnsCurrentVersion && !commandMustRemainReachable) {
      const nextTitle = displayTitle(connection);
      const nextObservation = connection.format_version === 2 ? connection.observation : "";
      const titleIsDirty = draftLabelRef.current !== adoptedTitleRef.current
        && draftLabelRef.current !== nextTitle;
      const observationIsDirty = draftObservationRef.current !== adoptedObservationRef.current
        && draftObservationRef.current !== nextObservation;
      if (!titleIsDirty) setDraftLabel(nextTitle);
      if (!observationIsDirty) setDraftObservation(nextObservation);
      adoptedTitleRef.current = nextTitle;
      adoptedObservationRef.current = nextObservation;
      setDeleteArmed(armDeleteForCurrentVersion);
      if (armDeleteForCurrentVersion) armDeleteAfterFingerprintRef.current = null;
      setError(null);
      setAmbiguousMutation(null);
      onRecoveryChangeRef.current(null);
    }
    if (!updateOwnsCurrentVersion && !commandMustRemainReachable) updateCommandRef.current = null;
    if (!deleteOwnsCurrentVersion && !commandMustRemainReachable) deleteCommandRef.current = null;
  }, [ambiguousMutation, conflictReview, connection, connection.activeEventId, connectionVersion, recovery]);

  const resetDraftTitle = useCallback((): void => {
    setDraftLabel(originalTitle);
    setError(null);
  }, [originalTitle]);

  const resetDraftObservation = useCallback((): void => {
    setDraftObservation(currentObservation);
    setError(null);
  }, [currentObservation]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // The shared layer registry decides ownership: an open chooser, dialog,
      // or active marking session outranks the card and consumes Escape first.
      if (!isTopLayer(layerRef.current)) return;
      if (
        requestInFlightRef.current
        || queuedCardEditRef.current != null
        || conflictReviewRef.current != null
        || ambiguousMutation != null
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      if (draftObservation !== currentObservation) {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetDraftObservation();
        return;
      }
      if (draftLabel !== originalTitle) {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetDraftTitle();
        return;
      }
      if (deleteArmed) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setDeleteArmed(false);
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onDismiss(true);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [ambiguousMutation, currentObservation, deleteArmed, draftLabel, draftObservation, onDismiss, originalTitle, resetDraftObservation, resetDraftTitle]);

  const runUpdate = async (pendingCommand: PendingUpdateCommand): Promise<boolean> => {
    if (requestInFlightRef.current || deleteCommandRef.current) return false;
    requestInFlightRef.current = true;
    reportMutationState("in-flight");
    setBusy(true);
    setError(null);
    let terminalState: "idle" | "in-flight" | "recovery" = "idle";
    try {
      const outcome = await onUpdate(
        pendingCommand.next,
        pendingCommand.commandId,
        pendingCommand.expectedBaseEventId,
      );
      if (outcome === "conflict") {
        if (updateCommandRef.current === pendingCommand) updateCommandRef.current = null;
        setAmbiguousMutation(null);
        onRecoveryChange(null);
        conflictReviewRef.current = "update";
        setConflictReview("update");
        terminalState = "recovery";
        setError("This connection changed elsewhere. Your local wording is preserved; review the current authored version, then reapply or discard this draft.");
        return false;
      }
      if (outcome === "complete") {
        if (updateCommandRef.current === pendingCommand) updateCommandRef.current = null;
        setAmbiguousMutation(null);
        onRecoveryChange(null);
        terminalState = queuedCardEditRef.current ? "in-flight" : "idle";
        return true;
      }
      const state = outcome === "committed-pending" ? "committed-pending" : "unconfirmed";
      setAmbiguousMutation({ kind: "update", state });
      terminalState = "recovery";
      onRecoveryChange({
        kind: "update",
        state,
        command: pendingCommand,
        visibleConnection: latestConnectionRef.current,
      });
      setError(outcome === "committed-pending"
        ? "Safely recorded. Retry this exact change to repair its reading index."
        : "The result is not confirmed. Retry this exact change; your draft is still here.");
      return false;
    } catch {
      setAmbiguousMutation({ kind: "update", state: "unconfirmed" });
      terminalState = "recovery";
      onRecoveryChange({
        kind: "update",
        state: "unconfirmed",
        command: pendingCommand,
        visibleConnection: latestConnectionRef.current,
      });
      setError("The result is not confirmed. Retry this exact change; your draft is still here.");
      return false;
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
      reportMutationState(terminalState);
    }
  };

  const settleCardExit = useCallback((
    proceed: boolean,
    options: { restoreFocus?: boolean } = {},
  ): void => {
    const resolve = exitGuardResolveRef.current;
    const origin = exitGuardOriginRef.current;
    exitGuardResolveRef.current = null;
    exitGuardPromiseRef.current = null;
    exitGuardOriginRef.current = null;
    setExitGuardReason(null);
    resolve?.(proceed);
    if (!options.restoreFocus) return;
    window.setTimeout(() => {
      const visible = latestConnectionRef.current;
      const visibleObservation = visible.format_version === 2 ? visible.observation : "";
      const fallbackSelector = draftObservationRef.current !== visibleObservation
        ? ".connection-card-observation textarea"
        : ".connection-card-title";
      const fallback = document.querySelector<HTMLElement>(
        "#connection-card-inspector " + fallbackSelector,
      );
      const target = origin?.isConnected ? origin : fallback;
      target?.focus({ preventScroll: true });
    }, 0);
  }, []);

  const saveCardForExit = async (): Promise<boolean> => {
    if (exitSavePromiseRef.current) return exitSavePromiseRef.current;
    const operation = (async (): Promise<boolean> => {
      const visible = latestConnectionRef.current;
      if (
        visible.format_version !== 2
        || requestInFlightRef.current
        || queuedCardEditRef.current != null
        || updateCommandRef.current != null
        || deleteCommandRef.current != null
        || conflictReviewRef.current != null
        || ambiguousMutation != null
        || recovery != null
      ) return false;
      const visiblePrefix = KIND_LABELS[visible.kind] + " · ";
      const titleText = draftLabelRef.current.trim();
      const label = titleText
        ? visible.label.startsWith(visiblePrefix)
          ? visiblePrefix + titleText
          : titleText
        : visible.label;
      if (!titleText) {
        const authoritativeTitle = displayTitle(visible);
        draftLabelRef.current = authoritativeTitle;
        setDraftLabel(authoritativeTitle);
      }
      const next: ConnectionRecordV2 = {
        ...visible,
        label,
        observation: draftObservationRef.current,
      };
      const fingerprint = connectionMutationFingerprint(next);
      if (fingerprint === connectionMutationFingerprint(visible)) return true;
      const pendingCommand: PendingUpdateCommand = {
        fingerprint,
        commandId: crypto.randomUUID(),
        expectedBaseEventId: visible.activeEventId,
        next: {
          ...next,
          anchors: next.anchors.map((anchor) => ({
            ...anchor,
            exact: {
              ...anchor.exact,
              occurrences: anchor.exact.occurrences.map((occurrence) => ({ ...occurrence })),
            },
          })),
        },
      };
      updateCommandRef.current = pendingCommand;
      const complete = await runUpdate(pendingCommand);
      return complete;
    })();
    exitSavePromiseRef.current = operation;
    try {
      return await operation;
    } finally {
      if (exitSavePromiseRef.current === operation) exitSavePromiseRef.current = null;
    }
  };

  const requestCardExit = useCallback((reason: WorkspaceTransitionReason): Promise<boolean> => {
    if (exitGuardPromiseRef.current) return exitGuardPromiseRef.current;
    if (
      requestInFlightRef.current
      || queuedCardEditRef.current != null
      || updateCommandRef.current != null
      || deleteCommandRef.current != null
      || conflictReviewRef.current != null
      || ambiguousMutation != null
      || recovery != null
      || busy
      || queuedEditPending
    ) return Promise.resolve(false);
    if (!labelChanged && !observationChanged) return Promise.resolve(true);
    if (connection.format_version !== 2) return Promise.resolve(false);
    const active = document.activeElement;
    exitGuardOriginRef.current = active instanceof HTMLElement ? active : null;
    const decision = new Promise<boolean>((resolve) => {
      exitGuardResolveRef.current = resolve;
    });
    exitGuardPromiseRef.current = decision;
    setExitGuardReason(reason);
    return decision;
  }, [
    ambiguousMutation,
    busy,
    connection.format_version,
    labelChanged,
    observationChanged,
    queuedEditPending,
    recovery,
  ]);

  const exitController = useMemo<WorkspaceExitController>(() => ({
    requestExit: requestCardExit,
  }), [requestCardExit]);

  useLayoutEffect(() => {
    onExitControllerChange?.(exitController);
    return () => onExitControllerChange?.(null);
  }, [exitController, onExitControllerChange]);

  useEffect(() => {
    if (!exitGuardReason) return;
    const frame = window.requestAnimationFrame(() => {
      exitGuardKeepRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [exitGuardReason]);

  useEffect(() => () => {
    exitGuardResolveRef.current?.(false);
    exitGuardResolveRef.current = null;
    exitGuardPromiseRef.current = null;
    exitGuardOriginRef.current = null;
  }, []);

  const commit = async (next: ConnectionRecordV2, allowConflictReview = false): Promise<boolean> => {
    if (
      requestInFlightRef.current
      || deleteCommandRef.current
      || ambiguousMutation != null
      || (conflictReviewRef.current != null && !allowConflictReview)
    ) return false;
    const fingerprint = connectionMutationFingerprint(next);
    const existing = updateCommandRef.current;
    if (existing && existing.fingerprint !== fingerprint) return false;
    if (!existing) {
      updateCommandRef.current = {
        fingerprint,
        commandId: crypto.randomUUID(),
        expectedBaseEventId: next.activeEventId,
        next: {
          ...next,
          anchors: next.anchors.map((anchor) => ({
            ...anchor,
            exact: {
              ...anchor.exact,
              occurrences: anchor.exact.occurrences.map((occurrence) => ({ ...occurrence })),
            },
          })),
        },
      };
    }
    await runUpdate(updateCommandRef.current!);
    // Ownership is the important hand-off for a queued draft. An ambiguous
    // outcome remains recoverable through updateCommandRef/onRecoveryChange.
    return true;
  };

  const saveLabel = async (): Promise<void> => {
    if (
      exitGuardPromiseRef.current
      || ambiguousMutation != null
      || conflictReviewRef.current != null
      || connection.format_version !== 2
    ) return;
    const visibleLabel = draftLabel.trim();
    if (!visibleLabel) {
      resetDraftTitle();
      return;
    }
    const label = connection.label.startsWith(titlePrefix)
      ? `${titlePrefix}${visibleLabel}`
      : visibleLabel;
    if (label === connection.label) {
      setDraftLabel(originalTitle);
      return;
    }
    if (requestInFlightRef.current) {
      const queued = queuedCardEditRef.current;
      queuedCardEditRef.current = {
        afterFingerprint: queued?.afterFingerprint
          ?? updateCommandRef.current?.fingerprint
          ?? connectionVersion,
        patch: { ...queued?.patch, label },
      };
      setQueuedEditPending(true);
      reportMutationState("in-flight");
      return;
    }
    await commit({ ...connection, label });
  };

  const saveObservation = async (): Promise<void> => {
    if (
      exitGuardPromiseRef.current
      || ambiguousMutation != null
      || conflictReviewRef.current != null
      || connection.format_version !== 2
    ) return;
    if (draftObservation === connection.observation) return;
    if (requestInFlightRef.current) {
      const queued = queuedCardEditRef.current;
      queuedCardEditRef.current = {
        afterFingerprint: queued?.afterFingerprint
          ?? updateCommandRef.current?.fingerprint
          ?? connectionVersion,
        patch: { ...queued?.patch, observation: draftObservation },
      };
      setQueuedEditPending(true);
      reportMutationState("in-flight");
      return;
    }
    await commit({ ...connection, observation: draftObservation });
  };

  useEffect(() => {
    const queued = queuedCardEditRef.current;
    const visible = latestConnectionRef.current;
    if (
      !queued
      || busy
      || ambiguousMutation != null
      || conflictReview != null
      || requestInFlightRef.current
      || visible.format_version !== 2
      || connectionMutationFingerprint(visible) !== queued.afterFingerprint
    ) return;
    void commit({ ...visible, ...queued.patch }).then((owned) => {
      if (!owned || queuedCardEditRef.current !== queued) return;
      queuedCardEditRef.current = null;
      setQueuedEditPending(false);
    });
  }, [ambiguousMutation, busy, conflictReview, connection.activeEventId, connectionVersion]);

  /**
   * Rev 04 §5: "Arity is not decoration: it decides whether *Add a phrase* is
   * offered at all. The inspector reads it off the kind and greys the exact-2
   * kinds while a 3-member connection is attended."
   *
   * Both halves are the same fact read twice. Contrast, Mirror and Hinge take
   * exactly two phrases, so a connection already holding three cannot become
   * one — the durable validator rejects it at the boundary, and a control that
   * offers a move the store will refuse is a control that lies. Greying is the
   * honest form of that refusal, and it is the only reason this list is here.
   */
  const changeKind = async (kind: ConnectionRecord["kind"]): Promise<void> => {
    if (
      requestInFlightRef.current
      || ambiguousMutation != null
      || connection.format_version !== 2
      || kind === connection.kind
    ) return;
    if (isBinaryConnectionKind(kind) && connection.anchors.length !== 2) return;
    const label = connection.label.startsWith(titlePrefix)
      ? `${KIND_LABELS[kind]} · ${connection.label.slice(titlePrefix.length)}`
      : connection.label;
    await commit({ ...connection, kind, label });
  };

  const removeAnchor = async (index: number): Promise<void> => {
    if (
      requestInFlightRef.current
      || ambiguousMutation != null
      || connection.format_version !== 2
    ) return;
    if (connection.anchors.length <= 2 || isBinaryConnectionKind(connection.kind)) return;
    await commit({
      ...connection,
      anchors: connection.anchors.filter((_, anchorIndex) => anchorIndex !== index),
    });
  };

  const runDelete = async (pendingCommand: PendingDeleteCommand): Promise<boolean> => {
    if (requestInFlightRef.current || updateCommandRef.current || queuedCardEditRef.current) return false;
    requestInFlightRef.current = true;
    reportMutationState("in-flight");
    setBusy(true);
    setError(null);
    let terminalState: "idle" | "recovery" = "idle";
    try {
      const outcome = await onDelete(
        pendingCommand.connection,
        pendingCommand.commandId,
        pendingCommand.expectedBaseEventId,
      );
      if (outcome === "conflict") {
        if (deleteCommandRef.current === pendingCommand) deleteCommandRef.current = null;
        setAmbiguousMutation(null);
        onRecoveryChange(null);
        setDeleteArmed(false);
        terminalState = "recovery";
        conflictReviewRef.current = "delete";
        setConflictReview("delete");
        setError("This connection changed elsewhere, so nothing was deleted. Review the authored connection before trying again.");
        return false;
      }
      if (outcome === "complete") {
        if (deleteCommandRef.current === pendingCommand) deleteCommandRef.current = null;
        setAmbiguousMutation(null);
        onRecoveryChange(null);
        return true;
      }
      const state = outcome === "committed-pending" ? "committed-pending" : "unconfirmed";
      setAmbiguousMutation({ kind: "delete", state });
      terminalState = "recovery";
      onRecoveryChange({
        kind: "delete",
        state,
        command: pendingCommand,
        visibleConnection: latestConnectionRef.current,
      });
      setDeleteArmed(true);
      setError(outcome === "committed-pending"
        ? "Deletion is safely recorded. Retry this exact command to repair its reading index."
        : "The deletion result is not confirmed. Retry the exact command; this card remains held.");
      return false;
    } catch {
      setAmbiguousMutation({ kind: "delete", state: "unconfirmed" });
      terminalState = "recovery";
      onRecoveryChange({
        kind: "delete",
        state: "unconfirmed",
        command: pendingCommand,
        visibleConnection: latestConnectionRef.current,
      });
      setDeleteArmed(true);
      setError("The deletion result is not confirmed. Retry the exact command; this card remains held.");
      return false;
    } finally {
      requestInFlightRef.current = false;
      setBusy(false);
      reportMutationState(terminalState);
    }
  };

  const confirmDelete = async (): Promise<void> => {
    const hasDirtyDraft = connection.format_version === 2 && (
      draftLabel !== originalTitle || draftObservation !== connection.observation
    );
    if (
      requestInFlightRef.current
      || ambiguousMutation != null
      || conflictReviewRef.current != null
      || queuedCardEditRef.current != null
      || updateCommandRef.current
    ) return;
    if (hasDirtyDraft && connection.format_version === 2) {
      // Save label and observation together. Two sequential saves would both
      // spread the same stale connection closure, allowing the second write
      // to silently revert the first.
      const visibleLabel = draftLabel.trim();
      if (!visibleLabel) setDraftLabel(originalTitle);
      const label = visibleLabel
        ? connection.label.startsWith(titlePrefix)
          ? `${titlePrefix}${visibleLabel}`
          : visibleLabel
        : connection.label;
      const next = { ...connection, label, observation: draftObservation };
      const fingerprint = connectionMutationFingerprint(next);
      if (fingerprint !== connectionVersion) {
        const pendingCommand: PendingUpdateCommand = {
          fingerprint,
          commandId: crypto.randomUUID(),
          expectedBaseEventId: next.activeEventId,
          next: {
            ...next,
            anchors: next.anchors.map((anchor) => ({
              ...anchor,
              exact: {
                ...anchor.exact,
                occurrences: anchor.exact.occurrences.map((occurrence) => ({ ...occurrence })),
              },
            })),
          },
        };
        updateCommandRef.current = pendingCommand;
        armDeleteAfterFingerprintRef.current = fingerprint;
        const complete = await runUpdate(pendingCommand);
        if (!complete) {
          armDeleteAfterFingerprintRef.current = null;
        } else if (connectionMutationFingerprint(latestConnectionRef.current) === fingerprint) {
          // The parent may have published the authoritative row before the
          // update promise resumed; do not wait for another prop change.
          armDeleteAfterFingerprintRef.current = null;
          setDeleteArmed(true);
        }
        return;
      }
    }
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    deleteCommandRef.current ??= {
      commandId: crypto.randomUUID(),
      expectedBaseEventId: connection.activeEventId,
      connection,
    };
    await runDelete(deleteCommandRef.current);
  };

  const retryPendingMutation = async (): Promise<void> => {
    if (requestInFlightRef.current || !ambiguousMutation) return;
    if (ambiguousMutation.kind === "update" && updateCommandRef.current) {
      await runUpdate(updateCommandRef.current);
      return;
    }
    if (ambiguousMutation.kind === "delete" && deleteCommandRef.current) {
      await runDelete(deleteCommandRef.current);
    }
  };

  const discardConflictDraft = (): void => {
    const visible = latestConnectionRef.current;
    queuedCardEditRef.current = null;
    setQueuedEditPending(false);
    conflictReviewRef.current = null;
    setConflictReview(null);
    setDraftLabel(displayTitle(visible));
    setDraftObservation(visible.format_version === 2 ? visible.observation : "");
    setDeleteArmed(false);
    setError(null);
    reportMutationState("idle");
    onRefresh();
  };

  const applyConflictDraft = async (): Promise<void> => {
    const visible = latestConnectionRef.current;
    if (conflictReviewRef.current !== "update" || visible.format_version !== 2) return;
    const visiblePrefix = `${KIND_LABELS[visible.kind]} · `;
    const labelText = draftLabel.trim();
    if (!labelText) return;
    const label = visible.label.startsWith(visiblePrefix)
      ? `${visiblePrefix}${labelText}`
      : labelText;
    queuedCardEditRef.current = null;
    setQueuedEditPending(false);
    conflictReviewRef.current = null;
    setConflictReview(null);
    setError(null);
    const owned = await commit({
      ...visible,
      label,
      observation: draftObservation,
    }, true);
    if (!owned) {
      conflictReviewRef.current = "update";
      setConflictReview("update");
      setError("The preserved draft could not take ownership yet. Review it and try again.");
    }
  };

  const discardCardExitChanges = (): void => {
    const authoritativeTitle = displayTitle(latestConnectionRef.current);
    const authoritativeObservation = latestConnectionRef.current.format_version === 2
      ? latestConnectionRef.current.observation
      : "";
    draftLabelRef.current = authoritativeTitle;
    draftObservationRef.current = authoritativeObservation;
    setDraftLabel(displayTitle(latestConnectionRef.current));
    setDraftObservation(
      latestConnectionRef.current.format_version === 2
        ? latestConnectionRef.current.observation
        : "",
    );
    setDeleteArmed(false);
    setError(null);
    settleCardExit(true);
  };

  const exitGuardNode = exitGuardReason ? createPortal(
    <div
      className="connection-draft-exit-scrim"
      data-floating-layer="dialog"
      data-transition-reason={exitGuardReason}
      onKeyDown={(event) => {
        if (!isTopLayer(exitGuardLayerRef.current)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settleCardExit(false, { restoreFocus: true });
          return;
        }
        if (event.key !== "Tab") return;
        const controls = [...(exitGuardRef.current?.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        ) ?? [])];
        if (controls.length === 0) return;
        const activeIndex = controls.indexOf(document.activeElement as HTMLButtonElement);
        const nextIndex = event.shiftKey
          ? (activeIndex <= 0 ? controls.length - 1 : activeIndex - 1)
          : (activeIndex < 0 || activeIndex === controls.length - 1 ? 0 : activeIndex + 1);
        event.preventDefault();
        controls[nextIndex]?.focus();
      }}
    >
      <div
        ref={exitGuardRef}
        className="connection-draft-exit-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-busy={busy}
        aria-labelledby="connection-card-exit-title"
        aria-describedby="connection-card-exit-copy"
      >
        <span className="connection-draft-exit-eyebrow">Connection changes</span>
        <h2 id="connection-card-exit-title">Save changes before leaving?</h2>
        <p id="connection-card-exit-copy">
          The connection name and observation have unsaved changes.
        </p>
        <div className="connection-draft-exit-actions">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() => {
              void saveCardForExit().then((complete) => {
                settleCardExit(complete, { restoreFocus: !complete });
              });
            }}
          >Save changes</button>
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={discardCardExitChanges}
          >Discard</button>
          <button
            ref={exitGuardKeepRef}
            type="button"
            disabled={busy}
            onClick={() => settleCardExit(false, { restoreFocus: true })}
          >Keep editing</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  const phrases = phraseCount(connection.anchors.length);
  return (
    <>
    <section
      id="connection-card-inspector"
      className={`connection-card connection-kind-${connection.kind.replace("link:", "")}`}
      aria-label={`${kindLabel} connection: ${draftLabel.trim() || originalTitle}`}
      aria-busy={busy}
      data-dirty={labelChanged || observationChanged}
      data-pending-mutation={ambiguousMutation?.kind}
      data-pending-state={ambiguousMutation?.state}
      tabIndex={-1}
    >
      <header className="connection-card-head">
        <span className="connection-card-kind-mark" aria-hidden="true" />
        <input
          className="connection-card-title"
          value={draftLabel}
          aria-label="Connection name"
          title="Click to rename"
          autoComplete="off"
          spellCheck={false}
          disabled={mutationLocked || connection.format_version !== 2}
          onChange={(event) => { if (!mutationLocked) setDraftLabel(event.currentTarget.value); }}
          onBlur={() => { if (labelChanged) void saveLabel(); }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
        />
      </header>

      <p className="connection-card-kind">
        {kindLabel} · {phrases}{otherHeldCount > 0 ? ` · ${otherHeldCount}\u00a0more\u00a0held` : ""}
      </p>

      {connection.format_version === 2 && (
        <div
          className="connection-card-kinds"
          role="radiogroup"
          aria-label="Connection kind"
        >
          {RELATIONSHIPS.map((option) => {
            // Read off the kind, exactly as §5 says: a kind that takes exactly
            // two phrases is unavailable to a connection that holds more.
            const arityBlocked = isBinaryConnectionKind(option.id)
              && connection.anchors.length !== 2;
            const current = option.id === connection.kind;
            return (
              <button
                key={option.id}
                type="button"
                role="radio"
                className="connection-card-kind-option"
                data-connection-kind={option.id}
                data-arity-blocked={arityBlocked ? "" : undefined}
                aria-checked={current}
                aria-label={arityBlocked
                  ? `${option.label}. Joins exactly two phrases, so it is unavailable to a connection of ${connection.anchors.length}.`
                  : `${option.label}. ${option.description}`}
                disabled={mutationLocked || arityBlocked}
                onClick={() => { if (!mutationLocked && !arityBlocked) void changeKind(option.id); }}
              >{option.label}</button>
            );
          })}
        </div>
      )}

      {connection.format_version === 2 ? (
        <label className="connection-card-observation" data-dirty={observationChanged}>
          <span className="sr-only">Observation</span>
          <textarea
            value={draftObservation}
            placeholder="Why do these words belong together?"
            aria-label="Connection observation"
            maxLength={32 * 1_024}
            rows={1}
            disabled={mutationLocked}
            onChange={(event) => { if (!mutationLocked) setDraftObservation(event.currentTarget.value); }}
            onBlur={() => {
              if (observationChanged) void saveObservation();
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
          />
          <small>{observationChanged
            ? "Unsaved · blur or ⌘↵ to save"
            : draftObservation.length > 0
              ? "Saved"
              : "Optional · saves on blur or ⌘↵"}</small>
        </label>
      ) : (
        <p className="connection-card-observation is-legacy">
          This legacy connection remains readable, but needs a deliberate exact-anchor replacement before editing.
        </p>
      )}

      <ol className="connection-card-anchors" aria-label={`${displayTitle(connection)} source phrases`}>
        {connection.anchors.map((anchor, index) => {
          const reference = anchorReference(anchor, bookNames);
          const compactReference = compactAnchorReference(anchor, book);
          const phrase = momentPhrase(anchor, packageId, paintAnchors[index]);
          const view = views[index] ?? { position: "here", current: false };
          return (
            <li
              key={`${anchor.book}:${anchor.chapter}:${anchor.verse_start}:${anchor.verse_end}:${index}`}
              className={`${view.current ? "is-current" : ""}${view.position === "here" ? "" : " is-away"}`.trim()}
            >
              <button
                type="button"
                className="connection-card-jump"
                aria-label={`${reference}, ${phrase}, ${view.position}`}
                disabled={mutationLocked}
                onClick={() => { if (!mutationLocked) onJump(anchor); }}
              >
                <span className="connection-card-ref" title={reference}>{compactReference}</span>
                <span className="connection-card-quote">{phrase}</span>
                <span className="connection-card-anchor-state" aria-hidden="true">{view.position}</span>
              </button>
              {connection.format_version === 2 && connection.anchors.length > 2 && !isBinaryConnectionKind(connection.kind) && (
                <button
                  type="button"
                  className="connection-card-remove"
                  aria-label={`Remove ${reference} from this connection`}
                  disabled={mutationLocked}
                  onClick={() => void removeAnchor(index)}
                >Remove</button>
              )}
            </li>
          );
        })}
      </ol>

      {error && (
        <p
          className="connection-card-error"
          role={ambiguousMutation?.state === "committed-pending" ? "status" : "alert"}
          aria-live={ambiguousMutation?.state === "committed-pending" ? "polite" : "assertive"}
          aria-atomic="true"
        >{error}</p>
      )}

      <footer className="connection-card-actions">
        {(conflictReview != null || ambiguousMutation) && (
          <div className="connection-card-actions-recovery">
            {conflictReview === "update" && (
              <>
                <button
                  type="button"
                  className="connection-card-retry"
                  disabled={busy}
                  onClick={() => void applyConflictDraft()}
                >Reapply preserved draft</button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={discardConflictDraft}
                >Discard draft</button>
              </>
            )}
            {conflictReview === "delete" && (
              <button
                type="button"
                className="connection-card-retry"
                disabled={busy}
                onClick={discardConflictDraft}
              >Continue with current version</button>
            )}
            {ambiguousMutation && (
              <button
                type="button"
                className="connection-card-retry"
                disabled={busy}
                onClick={() => void retryPendingMutation()}
              >{busy
                  ? "Retrying…"
                  : ambiguousMutation.kind === "delete" ? "Retry deletion" : "Retry exact change"}</button>
            )}
          </div>
        )}
        <div className="connection-card-actions-main">
          <button
            type="button"
            className="connection-card-primary"
            disabled={mutationLocked}
            onClick={() => { if (!mutationLocked) onClose(true); }}
          >Release</button>
          <button
            type="button"
            disabled={mutationLocked}
            onClick={() => { if (!mutationLocked) onNote(connection); }}
          >Add note</button>
          {connection.format_version === 2 && !isBinaryConnectionKind(connection.kind) && (
            <button
              type="button"
              disabled={mutationLocked}
              onClick={() => { if (!mutationLocked) onExtend(connection); }}
            >Add phrase</button>
          )}
          <span className="connection-card-actions-gap" aria-hidden="true" />
          {deleteArmed && (
            <button
              type="button"
              disabled={mutationLocked}
              onClick={() => { if (!mutationLocked) setDeleteArmed(false); }}
            >Keep</button>
          )}
          <button
            type="button"
            className={`connection-card-delete${deleteArmed ? " is-armed" : ""}`}
            disabled={mutationLocked}
            onClick={() => void confirmDelete()}
          >{busy && deleteArmed ? "Deleting…" : deleteArmed ? "Confirm delete" : "Delete"}</button>
        </div>
      </footer>
      <p className="connection-card-timestamp">
        <time dateTime={connection.updatedAt}>Updated {formatConnectionTimestamp(connection.updatedAt)}</time>
      </p>
    </section>
    {exitGuardNode}
    </>
  );
}
