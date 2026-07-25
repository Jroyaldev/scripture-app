import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  ConnectionAnchorV2,
  ConnectionKind,
  ConnectionRecordV2,
} from "../../core/annotations/types.js";
import type { MarkingSurface as MarkingSurfaceId } from "../api.js";
import { isTopLayer, useLayer, type LayerKind } from "../layerStack.js";
import { isDarkTheme, type AppTheme } from "../theme.js";
import type { ConnectionMutationUiOutcome } from "../utils/connectionMutationReconciliation.js";
import type { ConnectionPaintAnchor } from "../utils/connectionPaint.js";
import { lastInputModality } from "../utils/inputModality.js";
import { RELATIONSHIPS, relationshipLabel } from "../utils/relationshipVocabulary.js";
import {
  connectionDraftExitActions,
  connectionDraftExitTitle,
  type ConnectionDraftExitController,
  type ConnectionDraftExitReason,
} from "../utils/connectionDraftLifecycle.js";

type ConnectionPassageAnchor = Pick<
  ConnectionAnchorV2,
  "book" | "chapter" | "verse_start" | "verse_end"
>;

export type MarkingSelectionCapture =
  | { status: "pending" }
  | { status: "exact"; anchor: ConnectionAnchorV2 }
  | { status: "refused"; message: string };

export interface MarkingSelectionModel {
  nonce: number;
  rangeLabel: string;
  quote: string;
  activeColor: string | null;
  mixedColors: boolean;
  hasExistingHighlight: boolean;
  phraseMode: boolean;
  position: {
    x: number;
    y: number;
    flipped: boolean;
    anchorBox: { top: number; bottom: number; left: number; right: number };
  };
  capture: MarkingSelectionCapture;
  /** Package-local exact fragments used only while the gesture is in flight. */
  paintAnchors: readonly ConnectionPaintAnchor[];
}

export interface ConnectionExtensionRequest {
  nonce: number;
  contextKey: string;
  connection: ConnectionRecordV2;
  paintAnchors: readonly ConnectionPaintAnchor[];
}

/**
 * View-only connection authoring state. It deliberately carries no id or
 * format version: ScripturePage may project it into the underlay, but it can
 * never be mistaken for a durable authored record or cross the broker.
 */
export interface ConnectionDraftModel {
  /** Renderer context that owns these package-local paint fragments. */
  contextKey: string;
  kind: ConnectionKind;
  anchors: readonly ConnectionPaintAnchor[];
  label: string;
}

/**
 * The deferred and modal half of the action set (G·2). None of these write a
 * mark: each opens work somewhere else, so each is a callback the shell owns.
 * They are optional on purpose — an action whose host is not wired cannot act,
 * and More states that in the list rather than dropping the row.
 */
export interface MarkingDeferredActions {
  onCapture?: (() => void) | undefined;
  onStudyVerse?: (() => void) | undefined;
  onKeepAsComparison?: (() => void) | undefined;
  onOpenInTab?: (() => void) | undefined;
  onPericope?: (() => void) | undefined;
}

interface Props extends MarkingDeferredActions {
  surface: MarkingSurfaceId;
  theme: AppTheme;
  focusMode: boolean;
  contextKey: string;
  stageBounds: { left: number; top: number; width: number; height: number; bottom: number };
  selection: MarkingSelectionModel | null;
  extensionRequest: ConnectionExtensionRequest | null;
  /** Read-only libraries are stated before you act; the bar states it too. */
  readOnly?: boolean | undefined;
  /** Whether the last write attempt could reach the library at all. */
  offline?: boolean | undefined;
  onSetColor: (color: string) => Promise<boolean>;
  onNote: () => void;
  onRemove: () => Promise<boolean>;
  onDismissSelection: () => void;
  onClearSelection: (expectedNonce?: number) => void;
  onRequestReadingFocus: (anchors?: readonly ConnectionPassageAnchor[], expectedNonce?: number) => void;
  onConnectionDraftChange: (draft: ConnectionDraftModel | null) => void;
  onDraftExitControllerChange?: (controller: ConnectionDraftExitController | null) => void;
  onMutationStateChange?: (state: "idle" | "in-flight" | "recovery") => void;
  onCreateConnection: (
    kind: ConnectionKind,
    anchors: ConnectionAnchorV2[],
    label: string,
    observation: string,
    commandId: string,
    isRecovery?: boolean,
  ) => Promise<ConnectionMutationUiOutcome>;
  onUpdateConnection: (
    connectionId: string,
    kind: ConnectionKind,
    anchors: ConnectionAnchorV2[],
    label: string,
    observation: string,
    commandId: string,
    expectedBaseEventId: string,
  ) => Promise<ConnectionMutationUiOutcome>;
}

type PigmentId = "yellow" | "green" | "blue" | "pink" | "purple";
type ToolMode =
  | { type: "wash"; color: PigmentId }
  | { type: "connect"; kind: ConnectionKind }
  | { type: "note" }
  | { type: "erase" };

type SelectionRetryTool = Extract<ToolMode, { type: "wash" | "erase" }>;

interface SelectionFailure {
  nonce: number;
  tool: SelectionRetryTool;
  message: string;
  oneShot: boolean;
}

interface ConnectionSession {
  contextKey: string;
  /** Stable across explicit Retry so the broker cannot duplicate a command. */
  commandId: string;
  connectionId?: string;
  /** Exact visible version this extension command was authored against. */
  expectedBaseEventId?: string;
  kind: ConnectionKind;
  /**
   * Whether the reader has named the relation. Until a second phrase exists
   * there is nothing to name, so the draft carries a provisional kind that the
   * kind row does not yet offer and no write may act on.
   */
  kindChosen: boolean;
  anchors: ConnectionAnchorV2[];
  paintAnchors: ConnectionPaintAnchor[];
  labels: string[];
  label?: string;
  observation: string;
  feedback?: string;
  notice?: string;
  /** A durable command whose exact Retry must survive navigation and Escape. */
  recoveryState?: "committed-pending" | "unconfirmed";
}

interface PigmentOption {
  id: PigmentId;
  label: string;
  description: string;
}

const PIGMENTS: readonly PigmentOption[] = [
  { id: "yellow", label: "Amber", description: "A warm amber wash." },
  { id: "green", label: "Sage", description: "A quiet sage wash." },
  { id: "blue", label: "Sky", description: "A clear sky wash." },
  { id: "pink", label: "Rose", description: "A restrained rose wash." },
  { id: "purple", label: "Violet", description: "A soft violet wash." },
] as const;

const BINARY_KINDS = new Set<ConnectionKind>(["link:contrast", "mirror", "hinge"]);

/** The narrow shell's breakpoint, matching styles.css's @media (max-width: 979px). */
const NARROW_SHELL = "(max-width: 979px)";

/**
 * G·2 — eleven actions in three kinds.
 *
 * IMMEDIATE acts and finishes; DEFERRED opens the work elsewhere; MODAL turns
 * the surface into a workbench. Only immediate belongs on the bar. Note earns
 * its slot through use and Connect earns one as an entry point; everything
 * else lives behind More. The table is the single place that decides which is
 * which, so a new action cannot quietly award itself a permanent slot.
 */
type MarkingActionId =
  | "highlight"
  | "remove"
  | "note"
  | "capture"
  | "study-verse"
  | "keep-comparison"
  | "open-in-tab"
  | "copy-reference"
  | "connect"
  | "pericope";

type MarkingActionKind = "immediate" | "deferred" | "modal";

interface MarkingActionSpec {
  id: MarkingActionId;
  kind: MarkingActionKind;
  label: string;
  /** "bar" earns a permanent slot; "more" lives in the overflow list. */
  home: "bar" | "more";
}

const MARKING_ACTIONS: readonly MarkingActionSpec[] = [
  { id: "highlight", kind: "immediate", label: "Highlight", home: "bar" },
  { id: "remove", kind: "immediate", label: "Remove", home: "bar" },
  { id: "note", kind: "deferred", label: "Note", home: "bar" },
  { id: "connect", kind: "modal", label: "Connect", home: "bar" },
  { id: "capture", kind: "deferred", label: "Capture to sheet", home: "more" },
  { id: "study-verse", kind: "deferred", label: "Study this verse", home: "more" },
  { id: "keep-comparison", kind: "deferred", label: "Keep as comparison", home: "more" },
  { id: "open-in-tab", kind: "deferred", label: "Open in a tab", home: "more" },
  { id: "copy-reference", kind: "deferred", label: "Copy with reference", home: "more" },
  { id: "pericope", kind: "modal", label: "Mark a pericope", home: "more" },
] as const;

/** The overflow list, in the fixed order the table declares. */
const MORE_ACTIONS = MARKING_ACTIONS.filter((action) => action.home === "more");

const REST_GUIDANCE = "Select words, or choose a tool to keep in hand.";

const REST_HINT_SEEN_KEY = "pericope.marking-rest-hint-seen";

/**
 * First-run discoverability for the quietest surface: the palette summons
 * itself on selection, but a brand-new reader cannot know that. One calm
 * hint, shown until the first marking is made, then never again.
 */
function MarkingRestHint({
  stageBounds,
  theme,
}: {
  stageBounds: { left: number; bottom: number; width: number };
  theme: AppTheme;
}): React.JSX.Element | null {
  const [seen, setSeen] = useState(() => {
    try {
      return window.localStorage.getItem(REST_HINT_SEEN_KEY) === "1";
    } catch {
      return true;
    }
  });
  useEffect(() => {
    if (seen) return undefined;
    const timer = window.setTimeout(() => setSeen(true), 12_000);
    return () => window.clearTimeout(timer);
  }, [seen]);
  if (seen) return null;
  const materialClass = `${isDarkTheme(theme) ? "dark " : ""}theme-${theme}`;
  return createPortal(
    <p
      className={`marking-rest-hint ${materialClass}`}
      style={{
        left: stageBounds.left + stageBounds.width / 2,
        bottom: Math.max(window.innerHeight - stageBounds.bottom + 14, 14),
      }}
    >
      Drag across words to mark them — washes and relationships.
    </p>,
    document.body,
  );
}

/** The hint retires for good once the reader has made their first selection. */
function markRestHintSeen(): void {
  try {
    window.localStorage.setItem(REST_HINT_SEEN_KEY, "1");
  } catch { /* storage may be unavailable; the hint simply stays session-scoped */ }
}

/* ── The ten states ──────────────────────────────────────────────────────────
   Loading · Empty · Failed · Offline · Truncated · In-flight · Conflict ·
   Read-only · Not-installed · No-results, as shared components rather than ten
   local improvisations. Five rules govern them, and each is enforced here
   rather than remembered: ONE loading device, never an illustration, name the
   thing and the reason, never lose the reader's text, say whether it was
   local. */

export type SurfaceStateId =
  | "loading"
  | "empty"
  | "failed"
  | "offline"
  | "truncated"
  | "in-flight"
  | "conflict"
  | "read-only"
  | "not-installed"
  | "no-results";

/**
 * The one loading device in the app: a 1px seal segment travelling a hairline.
 * No spinners, no skeletons, anywhere. Loading and in-flight are the same
 * device because they are the same fact — something is happening and the
 * reader is waiting on it.
 */
export function SealProgress({ label }: { label: string }): React.JSX.Element {
  return (
    <span
      className="seal-progress"
      role="progressbar"
      aria-label={label}
      aria-valuetext={label}
    >
      <span className="seal-progress-hairline" aria-hidden="true">
        <i className="seal-progress-segment" />
      </span>
    </span>
  );
}

/**
 * Clip a QUOTATION, and only a quotation. A reference, a date, a count or an
 * identifier is the part a reader needs whole in order to act, so no caller
 * may route one through here — the parameter is named for what it accepts.
 */
export function clipQuotation(quotation: string, max: number): string {
  if (max <= 1 || quotation.length <= max) return quotation;
  return `${quotation.slice(0, max - 1).trimEnd()}…`;
}

export function SurfaceState({
  state,
  thing,
  reason,
  locality,
  actions,
  children,
}: {
  state: SurfaceStateId;
  /** The thing this is about, named. Never "something". */
  thing: string;
  /** Why it is in this state. Never an apology. */
  reason?: string;
  /** Whether this happened on the reader's own machine. */
  locality?: "local" | "remote";
  actions?: React.ReactNode;
  /** The reader's own text, which a state may never swallow. */
  children?: React.ReactNode;
}): React.JSX.Element {
  const loading = state === "loading" || state === "in-flight";
  return (
    <div
      className="surface-state"
      data-surface-state={state}
      role={state === "failed" || state === "conflict" ? "alert" : "status"}
      aria-live={state === "failed" || state === "conflict" ? "assertive" : "polite"}
    >
      <p className="surface-state-line">
        {loading && <SealProgress label={thing} />}
        <span className="surface-state-thing">{thing}</span>
        {reason && <span className="surface-state-reason">{reason}</span>}
        {locality && (
          <span className="surface-state-locality">
            {locality === "local" ? "On this device." : "From the library."}
          </span>
        )}
      </p>
      {children}
      {actions && <div className="surface-state-actions">{actions}</div>}
    </div>
  );
}

function pigmentLabel(color: PigmentId): string {
  return PIGMENTS.find((option) => option.id === color)?.label ?? color;
}

function anchorKey(anchor: ConnectionAnchorV2): string {
  return JSON.stringify([
    anchor.book,
    anchor.chapter,
    anchor.verse_start,
    anchor.verse_end,
    anchor.exact.format_version,
    anchor.exact.layer,
    anchor.exact.occurrences,
  ]);
}

function RelationshipGlyph({ kind }: { kind: ConnectionKind }): React.JSX.Element {
  if (kind === "link:parallel") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 6h12M3 12h12" /></svg>;
  }
  if (kind === "link:contrast") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m7 4-4 5 4 5M11 4l4 5-4 5" /></svg>;
  }
  if (kind === "link:echo") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M5.3 6.2H12a3.1 3.1 0 0 1 0 6.2H7.5M5.4 3.8 3 6.2l2.4 2.4" /></svg>;
  }
  if (kind === "mirror") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M9 3v12M7 5 3.5 9 7 13M11 5l3.5 4-3.5 4" /></svg>;
  }
  if (kind === "series") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 9h10" /><circle cx="4" cy="9" r="1.5" /><circle cx="9" cy="9" r="1.5" /><circle cx="14" cy="9" r="1.5" /></svg>;
  }
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3 9h4M11 9h4M9 5.5 12.5 9 9 12.5 5.5 9z" /></svg>;
}

function ToolGlyph({ tool }: { tool: "read" | "wash" | "connect" | "note" | "erase" | "more" }): React.JSX.Element {
  if (tool === "read") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.2 4.4c1.9-.7 3.8-.5 5.8.7v9c-2-1.2-3.9-1.4-5.8-.7zM14.8 4.4c-1.9-.7-3.8-.5-5.8.7v9c2-1.2 3.9-1.4 5.8-.7z" /></svg>;
  if (tool === "wash") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4.1 10.7 5.8-6.1 3.5 3.3-5.9 6.2H4.1zM3.2 14.1h11.6" /></svg>;
  if (tool === "connect") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M7.2 11.7 5.9 13a3 3 0 0 1-4.2-4.2l2-2a3 3 0 0 1 4.2 0M10.8 6.3 12.1 5a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2 0M6.5 11.5l5-5" /></svg>;
  if (tool === "note") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 3.2h10v8.1l-3.4 3.5H4zM10.6 14.8v-3.5H14M6.6 6.2h4.8M6.6 8.8h3.6" /></svg>;
  if (tool === "more") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.6 9h.01M9 9h.01M14.4 9h.01" /></svg>;
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m6.6 14.3-3.4-3.4 6.9-7a1.5 1.5 0 0 1 2.2 0l2 2a1.5 1.5 0 0 1 0 2.2l-6.2 6.2zM6.3 7.8l4.4 4.4M6.6 14.3h8.2" /></svg>;
}

function PigmentSwatch({ color }: { color: PigmentId }): React.JSX.Element {
  // Forced-colors mode cannot show the wash, so the swatch names it instead.
  const forcedCodes: Record<PigmentId, string> = { yellow: "Amber", green: "Sage", blue: "Sky", pink: "Rose", purple: "Violet" };
  return <span className={`marking-pigment marking-pigment-${color}`} aria-hidden="true" data-forced-code={forcedCodes[color]} />;
}

function useRovingFocus<T extends HTMLElement>(count: number, initialIndex = 0) {
  const refs = useRef<Array<T | null>>([]);
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const onKeyDown = (event: React.KeyboardEvent<T>, index: number): number | null => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next == null) return null;
    event.preventDefault();
    const normalized = (next + count) % count;
    setActiveIndex(normalized);
    refs.current[normalized]?.focus();
    return normalized;
  };
  return { refs, activeIndex, setActiveIndex, onKeyDown };
}

function RelationshipChoices({
  selected,
  onChoose,
  compact = false,
  initialFocusRef,
  onHelpChange,
  helpId,
  activateOnMove = false,
  onMoveChoose,
  disabled = false,
}: {
  selected: ConnectionKind | null;
  onChoose: (kind: ConnectionKind) => void;
  compact?: boolean;
  initialFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onHelpChange?: (help: PaletteHelp | null) => void;
  helpId?: string;
  activateOnMove?: boolean;
  onMoveChoose?: (kind: ConnectionKind) => void;
  disabled?: boolean;
}): React.JSX.Element {
  const selectedIndex = RELATIONSHIPS.findIndex((option) => option.id === selected);
  const roving = useRovingFocus<HTMLButtonElement>(RELATIONSHIPS.length, Math.max(0, selectedIndex));
  useEffect(() => {
    if (selectedIndex >= 0) roving.setActiveIndex(selectedIndex);
  }, [roving.setActiveIndex, selectedIndex]);
  return (
    <div className={`marking-choice-grid marking-relationship-grid${compact ? " compact" : ""}`} role={activateOnMove ? "radiogroup" : "group"} aria-label="Connection type">
      {RELATIONSHIPS.map((option, index) => (
        <button
          key={option.id}
          ref={(node) => {
            roving.refs.current[index] = node;
            if (index === Math.max(0, selectedIndex) && initialFocusRef) initialFocusRef.current = node;
          }}
          type="button"
          role={activateOnMove ? "radio" : undefined}
          className={`marking-choice marking-relationship marking-kind-${option.id.replace("link:", "")}${selected === option.id ? " active" : ""}`}
          data-relationship-kind={option.id}
          disabled={disabled}
          aria-checked={activateOnMove ? selected === option.id : undefined}
          aria-pressed={activateOnMove ? undefined : selected === option.id}
          aria-label={`${option.label}. ${option.description}`}
          aria-describedby={helpId}
          title={option.description}
          tabIndex={roving.activeIndex === index ? 0 : -1}
          onMouseDown={(event) => { if (!activateOnMove) event.preventDefault(); }}
          onMouseEnter={() => onHelpChange?.(option)}
          onMouseLeave={(event) => {
            if (document.activeElement !== event.currentTarget) onHelpChange?.(null);
          }}
          onFocus={() => { roving.setActiveIndex(index); onHelpChange?.(option); }}
          onBlur={(event) => {
            if (!event.currentTarget.matches(":hover")) onHelpChange?.(null);
          }}
          onKeyDown={(event) => {
            const next = roving.onKeyDown(event, index);
            if (activateOnMove && next != null) (onMoveChoose ?? onChoose)(RELATIONSHIPS[next]!.id);
          }}
          onClick={() => (activateOnMove ? (onMoveChoose ?? onChoose) : onChoose)(option.id)}
        >
          <span className="marking-choice-glyph"><RelationshipGlyph kind={option.id} /></span>
          <span className="marking-choice-label">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

interface PaletteHelp {
  label: string;
  description: string;
}

interface PalettePlacement {
  nonce: number;
  left: number;
  top: number;
  pointerX: number;
  flipped: boolean;
  layout: "floating" | "sheet";
}

function PaletteHeaderGlyph({ icon }: { icon: "note" | "erase" | "close" }): React.JSX.Element {
  if (icon === "note") return <ToolGlyph tool="note" />;
  if (icon === "erase") return <ToolGlyph tool="erase" />;
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9M13.5 4.5l-9 9" /></svg>;
}

/**
 * The bar. Five swatches, then Note · Connect · More, at every width and in
 * every state — Remove takes Note's slot when the selection already carries a
 * mark, and nothing else moves. That constancy is the whole point: a bar whose
 * contents shuffle cannot be used without looking at it first.
 */
function MarkingBar({
  hasExistingHighlight,
  phraseMode,
  selectedWash,
  disabled,
  moreOpen,
  firstChoiceRef,
  onChooseWash,
  onNote,
  onRemove,
  onConnect,
  onToggleMore,
  onHelpChange,
  helpId,
}: {
  hasExistingHighlight: boolean;
  phraseMode: boolean;
  selectedWash: PigmentId | null;
  disabled: boolean;
  moreOpen: boolean;
  firstChoiceRef: React.RefObject<HTMLButtonElement | null>;
  onChooseWash: (color: PigmentId) => void;
  onNote: () => void;
  onRemove: () => void;
  onConnect: () => void;
  onToggleMore: (opener: HTMLButtonElement) => void;
  onHelpChange: (help: PaletteHelp | null) => void;
  helpId: string;
}): React.JSX.Element {
  const explain = (option: PaletteHelp): void => onHelpChange(option);
  const clearAfterPointer = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (document.activeElement !== event.currentTarget) onHelpChange(null);
  };
  const clearAfterFocus = (event: React.FocusEvent<HTMLButtonElement>): void => {
    if (!event.currentTarget.matches(":hover")) onHelpChange(null);
  };
  return (
    <div className="marking-bar" data-bar-slot-count={MARKING_ACTIONS.filter((a) => a.home === "bar").length}>
      <div className="marking-bar-swatches" role="group" aria-label="Highlight colour">
        {PIGMENTS.map((option, index) => (
          <button
            key={option.id}
            ref={index === 0 ? firstChoiceRef : undefined}
            type="button"
            className={`marking-choice marking-wash marking-bar-swatch${selectedWash === option.id ? " active" : ""}`}
            data-pigment={option.id}
            data-bar-action="highlight"
            disabled={disabled}
            aria-pressed={selectedWash === option.id}
            aria-keyshortcuts={`${index + 1}`}
            aria-label={`${index + 1}. ${option.label} wash. ${option.description}`}
            aria-describedby={helpId}
            title={option.description}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => explain(option)}
            onMouseLeave={clearAfterPointer}
            onFocus={() => explain(option)}
            onBlur={clearAfterFocus}
            onClick={() => onChooseWash(option.id)}
          ><PigmentSwatch color={option.id} /></button>
        ))}
      </div>
      {/* One slot, two occupants. Remove replaces Note when there is already a
          mark to remove — the reader's next act on a marked phrase is almost
          never a second note, and the slot must not grow a sixth control. */}
      {hasExistingHighlight ? (
        <button
          type="button"
          className="marking-bar-action"
          data-bar-action="remove"
          disabled={disabled}
          aria-keyshortcuts="0"
          aria-label={phraseMode ? "Remove selected text from wash" : "Remove wash"}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onRemove}
        ><ToolGlyph tool="erase" /><span>Remove</span></button>
      ) : (
        <button
          type="button"
          className="marking-bar-action"
          data-bar-action="note"
          disabled={disabled}
          aria-keyshortcuts="Meta+Shift+M"
          aria-label="Add note"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onNote}
        ><ToolGlyph tool="note" /><span>Note</span></button>
      )}
      <button
        type="button"
        className="marking-bar-action"
        data-bar-action="connect"
        disabled={disabled}
        aria-label="Connect these words to another phrase"
        onMouseDown={(event) => event.preventDefault()}
        onClick={onConnect}
      ><ToolGlyph tool="connect" /><span>Connect</span></button>
      <button
        type="button"
        className="marking-bar-action"
        data-bar-action="more"
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        aria-controls="marking-more-list"
        aria-label="More actions for this selection"
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => onToggleMore(event.currentTarget)}
      ><ToolGlyph tool="more" /><span>More</span></button>
    </div>
  );
}

interface MoreItem {
  id: MarkingActionId;
  label: string;
  kind: MarkingActionKind;
  /** null when the item can act; otherwise the reason it cannot. */
  blockedReason: string | null;
  run: () => void;
}

/**
 * More is a plain list with the scope stated at the top. An item that cannot
 * act shows an em-dash and the reason rather than vanishing: a disappearing
 * item changes the list's shape, and a list that changes shape costs the
 * reader the place they had learned.
 */
function MoreList({
  scope,
  items,
  panelRef,
}: {
  scope: string;
  items: readonly MoreItem[];
  panelRef: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  return (
    <div ref={panelRef} className="marking-more" data-floating-layer="popover">
      <p className="marking-more-scope" id="marking-more-scope">{scope}</p>
      <ul id="marking-more-list" className="marking-more-list" role="menu" aria-describedby="marking-more-scope">
        {items.map((item) => (
          <li key={item.id} className="marking-more-row">
            <button
              type="button"
              role="menuitem"
              className="marking-more-item"
              data-more-action={item.id}
              data-action-kind={item.kind}
              disabled={item.blockedReason != null}
              aria-disabled={item.blockedReason != null}
              onMouseDown={(event) => event.preventDefault()}
              onClick={item.run}
            >
              <span className="marking-more-label">{item.label}</span>
              {item.blockedReason && (
                <span className="marking-more-reason">
                  <i aria-hidden="true">—</i> {item.blockedReason}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ConnectDraftState = "one-anchor" | "two-anchors" | "in-flight" | "recovery";

function connectDraftState(session: ConnectionSession, busy: boolean): ConnectDraftState {
  if (session.recoveryState) return "recovery";
  if (busy) return "in-flight";
  return session.anchors.length >= 2 ? "two-anchors" : "one-anchor";
}

/**
 * Connect replaces the bar rather than floating beside it, and it is never
 * dismissed optimistically: `onMutationStateChange` exists precisely because
 * this write can fail, and a bar that has already vanished has nowhere to put
 * the failure. Four states, and the kind row only exists from the second
 * anchor — asking what the relation IS before a relation exists is a question
 * with no answer.
 */
function ConnectDraft({
  session,
  busy,
  draft,
  copied,
  onDraftChange,
  onChooseKind,
  onSave,
  onCancel,
  onCopyText,
}: {
  session: ConnectionSession;
  busy: boolean;
  draft: string;
  copied: boolean;
  onDraftChange: (value: string) => void;
  onChooseKind: (kind: ConnectionKind) => void;
  onSave: () => void;
  onCancel: () => void;
  onCopyText: () => void;
}): React.JSX.Element {
  const state = connectDraftState(session, busy);
  const readOnly = state === "in-flight" || state === "recovery";
  const phraseLabel = `${session.anchors.length} phrase${session.anchors.length === 1 ? "" : "s"}`;
  const heldQuotes = session.labels.map((label) => clipQuotation(label, 40));
  return (
    <div
      className="marking-session marking-connect-draft"
      data-connect-state={state}
      aria-busy={busy}
      role="group"
      aria-label="Connection draft"
    >
      <span className="marking-session-kind">
        {session.kindChosen && <RelationshipGlyph kind={session.kind} />}
        {session.kindChosen ? `${relationshipLabel(session.kind)} · ${phraseLabel}` : phraseLabel}
      </span>
      <ol className="marking-connect-anchors">
        {heldQuotes.map((quote, index) => (
          <li key={`${quote}:${index}`}><q>{quote}</q></li>
        ))}
      </ol>
      <span
        className="marking-session-copy"
        role={session.recoveryState === "unconfirmed" ? "alert" : "status"}
        aria-live={session.recoveryState === "unconfirmed" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        {busy
          ? "Saving connection…"
          : session.feedback
            ?? session.notice
            ?? (session.anchors.length === 1
              ? "Select another phrase to connect."
              : "Select more text to keep adding.")}
      </span>
      {state === "in-flight" && <SealProgress label="Saving connection" />}
      {/* Two anchors is the moment a relation exists, and therefore the first
          moment the question "what kind?" has an answer. */}
      {session.anchors.length >= 2 && (
        <div className="marking-connect-kinds">
          <RelationshipChoices
            selected={session.kindChosen ? session.kind : null}
            onChoose={onChooseKind}
            compact
            disabled={readOnly}
          />
        </div>
      )}
      {session.anchors.length >= 2 && (
        <label className="marking-connect-field">
          {/* Label and observation are ONE field. The first line names the
              connection; anything after it is the observation. Two boxes asked
              the reader to sort a single thought into two containers before
              they had finished having it. */}
          <span>Name it, and say why</span>
          <textarea
            value={draft}
            readOnly={readOnly}
            rows={2}
            spellCheck
            placeholder="Both answer the same charge — first line names it, the rest is why."
            onChange={(event) => onDraftChange(event.target.value)}
          />
        </label>
      )}
      {session.recoveryState ? (
        <>
          <span className="marking-session-recovery">Recovery required</span>
          <SurfaceState
            state="failed"
            thing={session.recoveryState === "committed-pending"
              ? "This connection was recorded, but its reading index was not rebuilt."
              : "This connection's result was never confirmed."}
            reason={session.recoveryState === "committed-pending"
              ? "Until Retry rebuilds it the connection will not appear on the page."
              : "Retrying sends the same command, so it cannot be saved twice."}
            locality="local"
            actions={
              <>
                <button type="button" className="marking-session-action primary" disabled={busy} onClick={onSave}>Retry</button>
                <button type="button" className="marking-session-action" onClick={onCopyText}>
                  {copied ? "Copied" : "Copy text"}
                </button>
              </>
            }
          >
            {draft.trim() && <q className="marking-connect-kept-text">{draft}</q>}
          </SurfaceState>
        </>
      ) : (
        <div className="marking-connect-actions">
          {session.anchors.length >= 2 && (
            <button
              type="button"
              className="marking-session-action primary"
              disabled={busy || !session.kindChosen}
              onClick={onSave}
            >Save connection</button>
          )}
          <button
            type="button"
            className="marking-session-action"
            disabled={busy}
            onClick={onCancel}
          >Cancel draft</button>
        </div>
      )}
    </div>
  );
}

export function MarkingSurface({
  surface: surfaceSetting,
  theme,
  focusMode,
  contextKey,
  stageBounds,
  selection,
  extensionRequest,
  readOnly = false,
  offline = false,
  onSetColor,
  onNote,
  onRemove,
  onDismissSelection,
  onClearSelection,
  onRequestReadingFocus,
  onConnectionDraftChange,
  onDraftExitControllerChange,
  onMutationStateChange,
  onCreateConnection,
  onUpdateConnection,
  onCapture,
  onStudyVerse,
  onKeepAsComparison,
  onOpenInTab,
  onPericope,
}: Props): React.JSX.Element | null {
  const [tool, setTool] = useState<ToolMode | null>(null);
  const [session, setSession] = useState<ConnectionSession | null>(null);
  const [keepActive, setKeepActive] = useState(false);
  const [tray, setTray] = useState<"more" | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(REST_GUIDANCE);
  const [selectionFailure, setSelectionFailure] = useState<SelectionFailure | null>(null);
  const [paletteHelp, setPaletteHelp] = useState<PaletteHelp | null>(null);
  const [palettePlacement, setPalettePlacement] = useState<PalettePlacement | null>(null);
  const [consumingSelectionNonce, setConsumingSelectionNonce] = useState<number | null>(null);
  const [dockEntranceComplete, setDockEntranceComplete] = useState(false);
  const [focusRingMode, setFocusRingMode] = useState<"pointer" | "keyboard">("pointer");
  const [exitGuardReason, setExitGuardReason] = useState<ConnectionDraftExitReason | null>(null);
  const [connectDraftText, setConnectDraftText] = useState("");
  const [copiedNotice, setCopiedNotice] = useState<"draft" | "reference" | null>(null);
  const sessionRef = useRef<ConnectionSession | null>(session);
  sessionRef.current = session;
  const connectDraftTextRef = useRef(connectDraftText);
  connectDraftTextRef.current = connectDraftText;
  const exitGuardPromiseRef = useRef<Promise<boolean> | null>(null);
  const exitGuardResolveRef = useRef<((proceed: boolean) => void) | null>(null);
  const exitGuardOriginRef = useRef<HTMLElement | null>(null);
  const processedSelection = useRef<number | null>(null);
  const processedExtensionNonce = useRef<number | null>(null);
  const operationSequence = useRef(0);
  const activeOperation = useRef<number | null>(null);
  const mutationStateRef = useRef<"idle" | "in-flight" | "recovery">("idle");
  const currentContextKey = useRef(contextKey);
  const stateContextKey = useRef(contextKey);
  currentContextKey.current = contextKey;
  const firstChoiceRef = useRef<HTMLButtonElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const trayPanelRef = useRef<HTMLDivElement>(null);
  const trayOpenerRef = useRef<HTMLButtonElement>(null);
  const trayShouldFocusRef = useRef(true);
  const focusRestoreTimerRef = useRef<number | null>(null);
  const lastDockAutofocusedSelectionRef = useRef<number | null>(null);
  const activeSelectionNonceRef = useRef<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dockModesRef = useRef<HTMLDivElement>(null);
  const exitGuardRef = useRef<HTMLDivElement>(null);

  const clearPendingFocusRestore = useCallback((): void => {
    if (focusRestoreTimerRef.current == null) return;
    window.clearTimeout(focusRestoreTimerRef.current);
    focusRestoreTimerRef.current = null;
  }, []);

  useEffect(() => {
    const markPointer = (): void => setFocusRingMode("pointer");
    const markKeyboard = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (
        event.key === "Tab"
        || event.key === "Enter"
        || event.key === " "
        || event.key === "Home"
        || event.key === "End"
        || event.key.startsWith("Arrow")
      ) setFocusRingMode("keyboard");
    };
    // Capture before control handlers move focus. This makes gold an explicit
    // keyboard affordance instead of a programmatic-focus accent edge.
    window.addEventListener("pointerdown", markPointer, true);
    window.addEventListener("mousedown", markPointer, true);
    window.addEventListener("keydown", markKeyboard, true);
    return () => {
      window.removeEventListener("pointerdown", markPointer, true);
      window.removeEventListener("mousedown", markPointer, true);
      window.removeEventListener("keydown", markKeyboard, true);
    };
  }, []);

  const effectiveStageBounds = stageBounds;
  /**
   * Below the narrow breakpoint the surface is the dock, whatever the reader
   * chose. A floating palette needs somewhere to float that is not over the
   * words it is about, and at that width there is nowhere — it would either
   * cover the passage or collide with the sheet. The preference is not
   * overwritten, only overridden while there is no room to honour it.
   *
   * The test is the SHELL's width, not the reading stage's. At a 1440px window
   * the stage is only ~756px once the nav, the insets and the margin are
   * subtracted, so measuring the stage would put a desktop into the narrow
   * shell — which is the whole reason this reads a media query instead.
   */
  const [isNarrowShell, setIsNarrowShell] = useState(
    () => typeof window !== "undefined" && window.matchMedia(NARROW_SHELL).matches,
  );
  useEffect(() => {
    const query = window.matchMedia(NARROW_SHELL);
    const sync = (): void => setIsNarrowShell(query.matches);
    sync();
    query.addEventListener("change", sync);
    return () => query.removeEventListener("change", sync);
  }, []);
  const surface: MarkingSurfaceId = isNarrowShell ? "dock" : surfaceSetting;
  const persistentSurface = surface === "dock";
  // Escape ownership rank in the shared layer registry. An open More list or an
  // in-progress session is deliberate work and cancels before a passive
  // connection card; a plain text selection yields to it. Focus mode hides
  // every marking surface, so nothing registers there.
  const layerKind: LayerKind | null = focusMode
    ? null
    : tray != null
      ? "toolbar"
      : session != null || tool != null
        ? "marking-session"
        : selection != null
          ? "marking-selection"
          : null;
  const layerRef = useLayer(layerKind);
  const exitGuardLayerRef = useLayer(exitGuardReason ? "dialog" : null);
  const stageClass = effectiveStageBounds.width < 480 ? "narrow" : effectiveStageBounds.width < 760 || effectiveStageBounds.height < 480 ? "compact" : "wide";
  const paletteLayoutHint = effectiveStageBounds.width < 480 || effectiveStageBounds.height < 360 ? "sheet" : "floating";
  const floatingStageStyle = {
    "--mark-stage-left": `${effectiveStageBounds.left}px`,
    "--mark-stage-top": `${effectiveStageBounds.top}px`,
    "--mark-stage-width": `${effectiveStageBounds.width}px`,
    "--mark-stage-height": `${effectiveStageBounds.height}px`,
    "--mark-stage-bottom": `${effectiveStageBounds.bottom}px`,
  } as React.CSSProperties;
  const currentWash = tool?.type === "wash" ? tool.color : null;
  const selectedWash = PIGMENTS.find((option) => option.id === selection?.activeColor)?.id ?? null;
  const currentKind = tool?.type === "connect" ? tool.kind : session?.kind ?? null;
  const captureFeedback = selection?.capture.status === "refused"
    ? selection.capture.message
    : null;
  const activeSelectionNonce = selection?.nonce ?? null;
  activeSelectionNonceRef.current = activeSelectionNonce;
  const dockLayout = effectiveStageBounds.width <= 759 ? "stacked" : "shelf";
  const moreOpen = tray === "more";
  const connectionDraft = useMemo<ConnectionDraftModel | null>(() => {
    if (!session || session.contextKey !== contextKey) return null;
    // Durable anchors preserve the canonical authored relationship; these
    // package-local fragments exist only to keep every captured word visibly
    // held while that relationship is still in flight.
    const anchors = session.paintAnchors;
    if (anchors.length === 0) return null;
    return {
      contextKey,
      kind: session.kind,
      anchors,
      label: `${relationshipLabel(session.kind)} · connection in progress`,
    };
  }, [contextKey, session]);
  const suppressPaletteForAutoApply = Boolean(selection && selection.capture.status !== "refused" && (
    consumingSelectionNonce === selection.nonce
    || (tool && !busy && processedSelection.current !== selection.nonce)
  ));

  useLayoutEffect(() => {
    onConnectionDraftChange(connectionDraft);
  }, [connectionDraft, onConnectionDraftChange]);

  const reportMutationState = useCallback((state: "idle" | "in-flight" | "recovery"): void => {
    mutationStateRef.current = state;
    onMutationStateChange?.(state);
  }, [onMutationStateChange]);

  useEffect(() => {
    const state = session?.recoveryState
      ? "recovery"
      : busy || activeOperation.current != null
        ? "in-flight"
        : "idle";
    reportMutationState(state);
  }, [busy, reportMutationState, session?.recoveryState]);

  useEffect(() => () => {
    if (mutationStateRef.current === "idle") onMutationStateChange?.("idle");
  }, [onMutationStateChange]);

  const beginOperation = useCallback((): { token: number; contextKey: string } | null => {
    if (activeOperation.current != null) return null;
    const token = ++operationSequence.current;
    activeOperation.current = token;
    reportMutationState("in-flight");
    setBusy(true);
    return { token, contextKey: currentContextKey.current };
  }, [reportMutationState]);

  const ownsOperation = useCallback((operation: { token: number; contextKey: string }): boolean => (
    activeOperation.current === operation.token
    && currentContextKey.current === operation.contextKey
  ), []);

  const releaseOperation = useCallback((operation: { token: number; contextKey: string }): boolean => {
    if (!ownsOperation(operation)) return false;
    activeOperation.current = null;
    setBusy(false);
    return true;
  }, [ownsOperation]);

  useLayoutEffect(() => {
    if (surface !== "palette" || !selection || suppressPaletteForAutoApply) {
      setPalettePlacement(null);
      return;
    }
    const panel = paletteRef.current;
    if (!panel) return;
    let frame = 0;
    let cancelled = false;
    const place = (): void => {
      if (cancelled) return;
      const panelRect = panel.getBoundingClientRect();
      if (panelRect.width <= 0 || panelRect.height <= 0) return;
      const inset = 8;
      // 8px of clear air above the words, and never over them. The palette is
      // about that phrase; covering it to talk about it is self-defeating.
      const gap = 8;
      const stageRight = effectiveStageBounds.left + effectiveStageBounds.width;
      const stageBottom = effectiveStageBounds.bottom;
      const anchor = selection.position.anchorBox;
      const canOpenAbove = anchor.top - gap - panelRect.height >= effectiveStageBounds.top + inset;
      const canOpenBelow = anchor.bottom + gap + panelRect.height <= stageBottom - inset;
      const layout = effectiveStageBounds.width < 480
        || panelRect.height > effectiveStageBounds.height - inset * 2
        || (!canOpenAbove && !canOpenBelow)
        ? "sheet"
        : "floating";
      const width = layout === "sheet"
        ? Math.min(panelRect.width, Math.max(0, effectiveStageBounds.width - inset * 2))
        : panelRect.width;
      // The panel is placed at its own measured height. It never shrinks,
      // scrolls, or re-orders itself to fit a stage; when the stage cannot
      // hold it above, it opens below, and only a stage too small for either
      // turns it into a sheet.
      const height = panelRect.height;
      const anchorCenter = (anchor.left + anchor.right) / 2;
      const left = layout === "sheet"
        ? effectiveStageBounds.left + inset
        : Math.min(
          Math.max(anchorCenter - width / 2, effectiveStageBounds.left + inset),
          stageRight - width - inset,
        );
      const opensAbove = layout === "floating" && (canOpenAbove || !canOpenBelow);
      const unclampedTop = opensAbove ? anchor.top - gap - height : anchor.bottom + gap;
      const top = layout === "sheet"
        ? Math.max(effectiveStageBounds.top + inset, stageBottom - height - inset)
        : Math.min(
          Math.max(unclampedTop, effectiveStageBounds.top + inset),
          stageBottom - height - inset,
        );
      const pointerX = Math.min(Math.max(anchorCenter - left, 16), Math.max(16, width - 16));
      const next: PalettePlacement = {
        nonce: selection.nonce,
        left,
        top,
        pointerX,
        flipped: !opensAbove,
        layout,
      };
      setPalettePlacement((current) => current
        && current.nonce === next.nonce
        && current.layout === next.layout
        && current.flipped === next.flipped
        && Math.abs(current.left - next.left) < 0.1
        && Math.abs(current.top - next.top) < 0.1
        && Math.abs(current.pointerX - next.pointerX) < 0.1
        ? current
        : next);
    };
    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        place();
      });
    };
    place();
    const observer = new ResizeObserver(schedule);
    observer.observe(panel);
    void document.fonts?.ready.then(schedule);
    return () => {
      cancelled = true;
      observer.disconnect();
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [
    effectiveStageBounds.bottom,
    effectiveStageBounds.height,
    effectiveStageBounds.left,
    effectiveStageBounds.top,
    effectiveStageBounds.width,
    selection,
    suppressPaletteForAutoApply,
    surface,
  ]);

  const openTray = (next: "more", opener: HTMLButtonElement, focusChoices = true): void => {
    clearPendingFocusRestore();
    trayOpenerRef.current = opener;
    trayShouldFocusRef.current = focusChoices;
    setSelectionFailure(null);
    setTray(next);
  };

  const closeTray = useCallback((restoreFocus: boolean): void => {
    const opener = trayOpenerRef.current;
    setTray(null);
    if (activeSelectionNonce != null) setStatus("Selected words remain ready to mark.");
    else setStatus(REST_GUIDANCE);
    clearPendingFocusRestore();
    if (!restoreFocus) return;
    const ownerContextKey = currentContextKey.current;
    focusRestoreTimerRef.current = window.setTimeout(() => {
      focusRestoreTimerRef.current = null;
      if (currentContextKey.current !== ownerContextKey) return;
      if (opener?.isConnected) {
        opener.focus({ preventScroll: true });
        return;
      }
      const toolbar = dockModesRef.current;
      const fallback = toolbar?.querySelector<HTMLButtonElement>('button[data-bar-action="more"]');
      fallback?.focus({ preventScroll: true });
    }, 0);
  }, [activeSelectionNonce, clearPendingFocusRestore]);

  useEffect(() => () => {
    clearPendingFocusRestore();
  }, [clearPendingFocusRestore, surface]);

  useEffect(() => () => {
    operationSequence.current += 1;
    activeOperation.current = null;
  }, []);

  /**
   * The single field splits at its first newline: the first line names the
   * connection, the remainder is the observation. One thought, one box.
   */
  const splitDraftText = useCallback((text: string): { label: string; observation: string } => {
    const trimmed = text.trim();
    if (!trimmed) return { label: "", observation: "" };
    const breakAt = trimmed.indexOf("\n");
    if (breakAt < 0) return { label: trimmed, observation: "" };
    return {
      label: trimmed.slice(0, breakAt).trim(),
      observation: trimmed.slice(breakAt + 1).trim(),
    };
  }, []);

  const finishConnection = useCallback(async (target: ConnectionSession): Promise<boolean> => {
    if (
      target.anchors.length < 2
      || !target.kindChosen
      || (!target.recoveryState && target.contextKey !== contextKey)
      || busy
    ) return false;
    const operation = beginOperation();
    if (!operation) return false;
    const written = splitDraftText(connectDraftTextRef.current);
    const label = written.label
      || target.label
      || `${relationshipLabel(target.kind)} · ${target.labels.slice(0, 2).join(" / ")}${target.labels.length > 2 ? ` +${target.labels.length - 2}` : ""}`;
    const observation = written.observation || target.observation;
    let outcome: ConnectionMutationUiOutcome = "failed";
    try {
      outcome = target.connectionId
        ? await onUpdateConnection(
          target.connectionId,
          target.kind,
          target.anchors,
          label,
          observation,
          target.commandId,
          target.expectedBaseEventId!,
        )
        : await onCreateConnection(
          target.kind,
          target.anchors,
          label,
          observation,
          target.commandId,
          Boolean(target.recoveryState),
        );
    } catch {
      outcome = "failed";
    }
    if (!releaseOperation(operation)) return false;
    if (outcome === "conflict") {
      setSession((current) => current === target ? null : current);
      setStatus("Connection changed elsewhere · this extension was not applied. Review the authored connection before adding words again.");
      if (!persistentSurface) setTool(null);
      onRequestReadingFocus(target.anchors);
      return false;
    }
    if (outcome !== "complete") {
      const feedback = outcome === "committed-pending"
        ? "Safely recorded · Retry repairs its reading index. Your selected phrases are still held."
        : "The result is not confirmed. Retry this exact change; your selected phrases are still held.";
      setSession((current) => current === target ? {
        ...current,
        feedback,
        notice: undefined,
        recoveryState: outcome === "committed-pending" ? "committed-pending" : "unconfirmed",
      } : current);
      setStatus(feedback);
      return false;
    }
    setStatus(`${relationshipLabel(target.kind)} ${target.connectionId ? "updated" : "saved"} · ${target.anchors.length} phrases connected.`);
    sessionRef.current = null;
    setSession((current) => current === target ? null : current);
    setConnectDraftText("");
    if (!persistentSurface && !keepActive) setTool(null);
    onRequestReadingFocus(target.anchors);
    return true;
  }, [beginOperation, busy, contextKey, keepActive, onCreateConnection, onRequestReadingFocus, onUpdateConnection, persistentSurface, releaseOperation, splitDraftText]);

  const settleExitGuard = useCallback((proceed: boolean): void => {
    const resolve = exitGuardResolveRef.current;
    const origin = exitGuardOriginRef.current;
    exitGuardResolveRef.current = null;
    exitGuardPromiseRef.current = null;
    exitGuardOriginRef.current = null;
    setExitGuardReason(null);
    resolve?.(proceed);
    if (!proceed) {
      window.setTimeout(() => {
        if (origin?.isConnected) origin.focus({ preventScroll: true });
        else onRequestReadingFocus(sessionRef.current?.anchors);
      }, 0);
    }
  }, [onRequestReadingFocus]);

  const discardConnectionDraft = useCallback((): void => {
    const anchors = sessionRef.current?.anchors ?? [];
    sessionRef.current = null;
    setSession(null);
    setTray(null);
    setConnectDraftText("");
    if (!persistentSurface) setTool(null);
    setStatus("Connection draft discarded.");
    onRequestReadingFocus(anchors);
  }, [onRequestReadingFocus, persistentSurface]);

  const requestDraftExit = useCallback((reason: ConnectionDraftExitReason): Promise<boolean> => {
    const current = sessionRef.current;
    if (!current) return Promise.resolve(true);
    if (busy || activeOperation.current != null || current.recoveryState) {
      setStatus(current.recoveryState
        ? "Recovery required · Retry the exact connection command before leaving it."
        : "Finishing the current change · your selected words remain held.");
      return Promise.resolve(false);
    }
    if (exitGuardPromiseRef.current) return exitGuardPromiseRef.current;
    const active = document.activeElement;
    exitGuardOriginRef.current = active instanceof HTMLElement ? active : null;
    setExitGuardReason(reason);
    const promise = new Promise<boolean>((resolve) => {
      exitGuardResolveRef.current = resolve;
    });
    exitGuardPromiseRef.current = promise;
    return promise;
  }, [busy]);

  const exitController = useMemo<ConnectionDraftExitController | null>(() => (
    session ? { requestExit: requestDraftExit } : null
  ), [requestDraftExit, session]);

  useLayoutEffect(() => {
    onDraftExitControllerChange?.(exitController);
    return () => onDraftExitControllerChange?.(null);
  }, [exitController, onDraftExitControllerChange]);

  useEffect(() => () => {
    exitGuardResolveRef.current?.(false);
    exitGuardResolveRef.current = null;
    exitGuardPromiseRef.current = null;
  }, []);

  const captureConnection = useCallback((kind: ConnectionKind, current: MarkingSelectionModel): boolean => {
    if (busy || session?.recoveryState) return false;
    if (current.capture.status === "pending") {
      setStatus("Resolving the selected words against the canonical text…");
      return false;
    }
    if (current.capture.status === "refused") {
      setStatus(current.capture.message);
      return false;
    }
    const base = session?.contextKey === contextKey && session.kind === kind
      ? session
      : {
          contextKey,
          commandId: crypto.randomUUID(),
          kind,
          kindChosen: false,
          anchors: [],
          paintAnchors: [],
          labels: [],
          observation: "",
        };
    const key = anchorKey(current.capture.anchor);
    if (base.anchors.some((anchor) => anchorKey(anchor) === key)) {
      const feedback = "That phrase is already held. Select a different phrase to continue.";
      setSession((value) => value ? { ...value, feedback: undefined, notice: feedback } : value);
      setTray(null);
      setStatus(feedback);
      onClearSelection(current.nonce);
      return true;
    }
    const next: ConnectionSession = {
      ...base,
      anchors: [...base.anchors, current.capture.anchor],
      paintAnchors: [...base.paintAnchors, ...current.paintAnchors],
      labels: [...base.labels, current.rangeLabel],
      feedback: undefined,
      notice: undefined,
    };
    setSession(next);
    setTray(null);
    setTool({ type: "connect", kind });
    setStatus(next.anchors.length === 1
      ? "1 phrase · Select another phrase to connect."
      : `${next.anchors.length} phrases · Name the relationship, then save.`);
    onClearSelection(current.nonce);
    onRequestReadingFocus([current.capture.anchor], current.nonce);
    // A binary relation completes itself the moment its counterpart lands —
    // but only once the reader has actually named it, which cannot happen
    // before the second anchor exists.
    if (next.kindChosen && BINARY_KINDS.has(kind) && next.anchors.length === 2) void finishConnection(next);
    return true;
  }, [busy, contextKey, finishConnection, onClearSelection, onRequestReadingFocus, session]);

  const applyTool = useCallback(async (
    nextTool: ToolMode,
    current: MarkingSelectionModel,
    options: { oneShot?: boolean } = {},
  ): Promise<boolean> => {
    if (busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before another marking action.");
        return false;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return false;
    }
    if (nextTool.type === "connect") {
      if (!captureConnection(nextTool.kind, current)) return false;
      processedSelection.current = current.nonce;
      return true;
    }
    setSelectionFailure(null);
    processedSelection.current = current.nonce;
    if (nextTool.type === "wash") {
      const operation = beginOperation();
      if (!operation) return false;
      let ok = false;
      onRequestReadingFocus(
        current.capture.status === "exact" ? [current.capture.anchor] : current.paintAnchors,
        current.nonce,
      );
      try {
        ok = await onSetColor(nextTool.color);
      } catch {
        ok = false;
      }
      if (!releaseOperation(operation)) return false;
      const message = ok
        ? `${pigmentLabel(nextTool.color)} wash applied.`
        : "The wash could not be saved. Selection restored for retry.";
      setStatus(message);
      if (!ok) {
        setSelectionFailure({ nonce: current.nonce, tool: nextTool, message, oneShot: Boolean(options.oneShot) });
        setTray(null);
      }
      if (ok) onClearSelection(current.nonce);
      if (!ok || (!persistentSurface && !keepActive)) setTool(null);
      return ok;
    }
    if (nextTool.type === "note") {
      setSelectionFailure(null);
      onNote();
      onClearSelection(current.nonce);
      setStatus("Note opened for this selection.");
      if (!persistentSurface) setTool(null);
      return true;
    }
    const operation = beginOperation();
    if (!operation) return false;
    let ok = false;
    onRequestReadingFocus(
      current.capture.status === "exact" ? [current.capture.anchor] : current.paintAnchors,
      current.nonce,
    );
    try {
      ok = await onRemove();
    } catch {
      ok = false;
    }
    if (!releaseOperation(operation)) return false;
    const message = ok
      ? "Selected wash removed."
      : "The wash could not be removed. Selection restored for retry.";
    setStatus(message);
    if (!ok) {
      setSelectionFailure({ nonce: current.nonce, tool: nextTool, message, oneShot: Boolean(options.oneShot) });
      setTray(null);
    }
    if (ok) onClearSelection(current.nonce);
    if (!ok || !persistentSurface) setTool(null);
    return ok;
  }, [beginOperation, busy, captureConnection, keepActive, onClearSelection, onNote, onRemove, onRequestReadingFocus, onSetColor, persistentSurface, releaseOperation, session?.recoveryState]);

  const chooseWash = (color: PigmentId): void => {
    if (busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before changing tools.");
        return;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return;
    }
    const next: ToolMode = { type: "wash", color };
    setTool(next);
    setTray(null);
    setStatus("Select words to lay this wash.");
    if (!selection) {
      onRequestReadingFocus();
      return;
    }
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(next, selection).finally(() => {
      setConsumingSelectionNonce((current) => current === nonce ? null : current);
    });
  };

  const chooseConnection = (kind: ConnectionKind): void => {
    if (busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before changing tools.");
        return;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return;
    }
    const next: ToolMode = { type: "connect", kind };
    setTool(next);
    setTray(null);
    setStatus("Select words to add the next relationship phrase.");
    if (!selection) {
      onRequestReadingFocus();
      return;
    }
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(next, selection).then((consumed) => {
      if (!consumed) setConsumingSelectionNonce((current) => current === nonce ? null : current);
    });
  };

  useLayoutEffect(() => {
    if (stateContextKey.current !== contextKey) return;
    if (!selection) {
      setConsumingSelectionNonce(null);
      return;
    }
    if (!tool || busy || processedSelection.current === selection.nonce) return;
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(tool, selection).then(
      (consumed) => {
        if (!consumed) setConsumingSelectionNonce((current) => current === nonce ? null : current);
      },
      () => setConsumingSelectionNonce((current) => current === nonce ? null : current),
    );
  }, [applyTool, busy, contextKey, selection, tool]);

  useLayoutEffect(() => {
    stateContextKey.current = contextKey;
    if (focusRestoreTimerRef.current != null) {
      window.clearTimeout(focusRestoreTimerRef.current);
      focusRestoreTimerRef.current = null;
    }
    operationSequence.current += 1;
    activeOperation.current = null;
    setBusy(false);
    setSession((current) => current?.recoveryState ? current : null);
    setSelectionFailure(null);
    setTool(null);
    setTray(null);
    setKeepActive(false);
    setPaletteHelp(null);
    setPalettePlacement(null);
    setConsumingSelectionNonce(null);
    setStatus(REST_GUIDANCE);
  }, [contextKey]);

  useEffect(() => {
    setPaletteHelp(null);
  }, [selection?.nonce, surface]);

  useEffect(() => {
    if (!selectionFailure) return;
    if (activeSelectionNonce == null) {
      if (busy) return;
      const timer = window.setTimeout(() => {
        if (activeSelectionNonceRef.current != null || activeOperation.current != null) return;
        setSelectionFailure(null);
        setStatus(REST_GUIDANCE);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (selectionFailure.nonce === activeSelectionNonce) return;
    setSelectionFailure(null);
    setStatus("Selected words remain ready to mark.");
  }, [activeSelectionNonce, busy, selectionFailure]);

  useEffect(() => {
    setKeepActive(false);
  }, [surface]);

  useEffect(() => {
    if (surface !== "dock") {
      setDockEntranceComplete(false);
      return;
    }
    setDockEntranceComplete(false);
    const timer = window.setTimeout(() => setDockEntranceComplete(true), 260);
    return () => window.clearTimeout(timer);
  }, [surface]);

  useEffect(() => {
    if (!selection && !tool && !session && keepActive) setKeepActive(false);
  }, [keepActive, selection, session, tool]);

  useEffect(() => {
    if (!extensionRequest) return;
    if (processedExtensionNonce.current === extensionRequest.nonce) return;
    if (extensionRequest.contextKey !== contextKey) {
      processedExtensionNonce.current = extensionRequest.nonce;
      return;
    }
    if (busy || activeOperation.current != null) return;
    processedExtensionNonce.current = extensionRequest.nonce;
    const { connection } = extensionRequest;
    setSession({
      contextKey,
      commandId: crypto.randomUUID(),
      connectionId: connection.id,
      expectedBaseEventId: connection.activeEventId,
      kind: connection.kind,
      kindChosen: true,
      anchors: connection.anchors,
      paintAnchors: [...extensionRequest.paintAnchors],
      labels: connection.anchors.map((anchor, index) => {
        const projected = extensionRequest.paintAnchors[index];
        const quote = projected?.fragments.map((fragment) => fragment.quote).join(" ").trim();
        return quote || `${anchor.book} ${anchor.chapter}:${anchor.verse_start}${anchor.verse_end === anchor.verse_start ? "" : `–${anchor.verse_end}`}`;
      }),
      label: connection.label,
      observation: connection.observation,
    });
    setConnectDraftText(connection.observation
      ? `${connection.label}\n${connection.observation}`
      : connection.label);
    setTool({ type: "connect", kind: connection.kind });
    setTray(null);
    setStatus(`${relationshipLabel(connection.kind)} · select words to add, then finish.`);
    processedSelection.current = null;
    onClearSelection();
    onRequestReadingFocus(connection.anchors);
  }, [busy, contextKey, extensionRequest, onClearSelection, onRequestReadingFocus]);

  useEffect(() => {
    if (selection != null) markRestHintSeen();
  }, [selection]);

  useEffect(() => {
    if (activeSelectionNonce == null || persistentSurface || tool) return;
    if (surface === "palette" && palettePlacement?.nonce !== activeSelectionNonce) return;
    const timer = window.setTimeout(() => {
      // Focus transfers into the toolbar only for keyboard users; for pointer
      // and screen-reader users the jump would yank them out of the text.
      if (lastInputModality() === "keyboard") {
        firstChoiceRef.current?.focus({ preventScroll: true });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSelectionNonce, palettePlacement?.nonce, persistentSurface, surface, tool]);

  useEffect(() => {
    if (surface !== "dock" || activeSelectionNonce == null) return;
    if (lastDockAutofocusedSelectionRef.current === activeSelectionNonce) return;
    if (tool || tray != null || session || busy || selectionFailure?.nonce === activeSelectionNonce) return;
    if (lastInputModality() !== "keyboard") return;
    const timer = window.setTimeout(() => {
      const target = firstChoiceRef.current;
      if (!target) return;
      target.focus({ preventScroll: true });
      lastDockAutofocusedSelectionRef.current = activeSelectionNonce;
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeSelectionNonce, busy, selectionFailure?.nonce, session, surface, tool, tray]);

  useEffect(() => {
    if (surface !== "dock" || busy || !session?.feedback) return;
    const timer = window.setTimeout(() => {
      dockRef.current?.querySelector<HTMLButtonElement>(".marking-session-action.primary:not(:disabled)")?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [busy, session?.feedback, surface]);

  useEffect(() => {
    if (tray !== "more") return;
    if (!trayShouldFocusRef.current) {
      trayShouldFocusRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      trayPanelRef.current?.querySelector<HTMLButtonElement>('button[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tray]);

  useEffect(() => {
    if (tray !== "more") return;
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trayPanelRef.current?.contains(target) || trayOpenerRef.current?.contains(target)) return;
      closeTray(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [closeTray, tray]);

  /**
   * The palette closes on scroll, on an outside click and on Escape — and NOT
   * on a selection change, so dragging to extend keeps it open and following
   * the words. An outside click that leaves live words selected is exactly
   * that drag, so it must not be read as a dismissal.
   */
  useEffect(() => {
    if (surface !== "palette" || !selection || session) return;
    const onScroll = (event: Event): void => {
      const target = event.target;
      if (target instanceof Node && paletteRef.current?.contains(target)) return;
      onDismissSelection();
    };
    const onClick = (event: MouseEvent): void => {
      const target = event.target;
      if (target instanceof Node && paletteRef.current?.contains(target)) return;
      if (target instanceof Node && trayPanelRef.current?.contains(target)) return;
      const native = window.getSelection();
      if (native && !native.isCollapsed && native.toString().trim()) return;
      onDismissSelection();
    };
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("click", onClick);
    };
  }, [onDismissSelection, selection, session, surface]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      // Focus mode hides every marking surface. Retained tool or selection
      // state is therefore not a visible Escape owner; App must receive the
      // next Escape so it can restore the full reading desk.
      if (focusMode) return;
      // This listener runs in capture so the active marking layer owns Escape
      // before App's older window listener can interpret it as "exit Focus".
      // Ownership is decided by the shared layer registry: an open marking
      // session or More list outranks a passive connection card, while a plain
      // text selection yields to it — the deliberate work cancels first.
      if (!layerKind) return;
      if (!isTopLayer(layerRef.current)) return;
      if (busy || activeOperation.current != null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus("Finishing the current change · your selected words remain held.");
        return;
      }
      if (session?.recoveryState) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setStatus("Recovery required · Retry the exact connection command before leaving it.");
        return;
      }
      if (session) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearPendingFocusRestore();
        void requestDraftExit("escape");
        return;
      }
      if (tray === "more") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeTray(true);
        return;
      }
      if (activeSelectionNonce != null) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearPendingFocusRestore();
        setSelectionFailure(null);
        setStatus(REST_GUIDANCE);
        setKeepActive(false);
        onDismissSelection();
        onRequestReadingFocus(selection ? selection.paintAnchors : undefined);
        return;
      }
      if (tool) {
        event.preventDefault();
        event.stopImmediatePropagation();
        clearPendingFocusRestore();
        setTool(null);
        setTray(null);
        setKeepActive(false);
        setStatus(REST_GUIDANCE);
        onRequestReadingFocus();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [activeSelectionNonce, busy, clearPendingFocusRestore, closeTray, focusMode, layerKind, onDismissSelection, onRequestReadingFocus, requestDraftExit, selection, session, tool, tray]);

  const chooseNote = (): void => {
    if (busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before changing tools.");
        return;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return;
    }
    const next: ToolMode = { type: "note" };
    setTool(next);
    setTray(null);
    setStatus("Select a passage to open a note.");
    if (!selection) {
      onRequestReadingFocus();
      return;
    }
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(next, selection).finally(() => {
      setConsumingSelectionNonce((current) => current === nonce ? null : current);
    });
  };

  const chooseErase = (): void => {
    if (busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before changing tools.");
        return;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return;
    }
    const next: ToolMode = { type: "erase" };
    setTool(next);
    setTray(null);
    setStatus("Select a passage with a wash to remove its mark.");
    if (!selection) {
      onRequestReadingFocus();
      return;
    }
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(next, selection).then((consumed) => {
      if (!consumed) setConsumingSelectionNonce((current) => current === nonce ? null : current);
    });
  };

  /** Connect is an entry point, not a choice of kind: it holds this phrase. */
  const beginConnect = (): void => {
    const kind = session?.kind ?? currentKind ?? "link:parallel";
    chooseConnection(kind);
  };

  const chooseDraftKind = (kind: ConnectionKind): void => {
    setSession((current) => current ? { ...current, kind, kindChosen: true, notice: undefined } : current);
    setTool({ type: "connect", kind });
    setStatus(`${relationshipLabel(kind)} · ready to save.`);
  };

  const putDownTool = (requestReadingFocus = true): void => {
    if (session?.recoveryState) {
      setStatus("Recovery required · Retry the exact connection command before changing tools.");
      return;
    }
    if (session) {
      void requestDraftExit("escape").then((proceed) => {
        if (!proceed) return;
        clearPendingFocusRestore();
        setTool(null);
        setSelectionFailure(null);
        setTray(null);
        setKeepActive(false);
        setStatus(REST_GUIDANCE);
        if (requestReadingFocus) onRequestReadingFocus(session.anchors);
      });
      return;
    }
    clearPendingFocusRestore();
    setTool(null);
    setSelectionFailure(null);
    setTray(null);
    setKeepActive(false);
    setStatus(REST_GUIDANCE);
    if (requestReadingFocus) onRequestReadingFocus();
  };

  const dismissPalette = (): void => {
    setPaletteHelp(null);
    // Closing the palette is the explicit return to reading, so it puts down
    // whatever was in hand first — unless a draft is open, which owns its own
    // exit decision and must not be resolved by a close button.
    if (!session) putDownTool(false);
    onDismissSelection();
  };

  const copyText = useCallback(async (text: string, kind: "draft" | "reference"): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedNotice(kind);
      setStatus(kind === "reference" ? "Copied with its reference." : "Draft text copied.");
    } catch {
      setStatus("The clipboard is unavailable in this window; the text is still here.");
    }
  }, []);

  useEffect(() => {
    if (!copiedNotice) return;
    const timer = window.setTimeout(() => setCopiedNotice(null), 2400);
    return () => window.clearTimeout(timer);
  }, [copiedNotice]);

  /**
   * Bare digits set a colour, `0` removes, `⌘⇧M` opens a note, and `⇧↑/↓`
   * extends the selection by a whole verse. Unmodified digits are safe here
   * only because the bar is modal on a selection: with no words held, none of
   * these listeners exist at all.
   */
  const extendSelectionByVerse = useCallback((direction: 1 | -1): boolean => {
    const native = window.getSelection();
    if (!native || native.rangeCount === 0) return false;
    const focusNode = native.focusNode;
    if (!focusNode) return false;
    const focusElement = focusNode instanceof Element ? focusNode : focusNode.parentElement;
    const row = focusElement?.closest<HTMLElement>(".verse-line[data-verse]");
    if (!row) return false;
    const rows = [...document.querySelectorAll<HTMLElement>(".verse-line[data-verse]")];
    const index = rows.indexOf(row);
    const nextRow = rows[index + direction];
    if (!nextRow) return false;
    const text = nextRow.querySelector<HTMLElement>(".verse-text-span") ?? nextRow;
    const range = native.getRangeAt(0).cloneRange();
    if (direction === 1) range.setEndAfter(text);
    else range.setStartBefore(text);
    native.removeAllRanges();
    native.addRange(range);
    return true;
  }, []);

  useEffect(() => {
    if (focusMode || !selection || session || busy) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.repeat || event.isComposing || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (
        target.isContentEditable
        || target.matches("input, textarea, select, [role='textbox']")
      )) return;
      if (event.shiftKey && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        if (event.metaKey || event.ctrlKey) return;
        if (!extendSelectionByVerse(event.key === "ArrowDown" ? 1 : -1)) return;
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (event.shiftKey && (event.metaKey || event.ctrlKey) && (event.key === "m" || event.key === "M")) {
        event.preventDefault();
        event.stopPropagation();
        chooseNote();
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      const digit = /^Digit([0-5])$/.exec(event.code);
      if (!digit) return;
      const index = Number(digit[1]);
      event.preventDefault();
      event.stopPropagation();
      if (index === 0) {
        if (selection.hasExistingHighlight) chooseErase();
        else setStatus("These words carry no wash to remove.");
        return;
      }
      const pigment = PIGMENTS[index - 1];
      if (pigment) chooseWash(pigment.id);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
    // chooseWash/chooseErase/chooseNote are re-created each render and close
    // over the live selection; the identity list below is what actually
    // decides whether these bindings should exist at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, extendSelectionByVerse, focusMode, selection, session]);

  const portalThemeClass = `${isDarkTheme(theme) ? "dark " : ""}theme-${theme}`;

  const moreItems = useMemo<MoreItem[]>(() => {
    const quote = selection?.quote ?? "";
    const reference = selection?.rangeLabel ?? "";
    const handlers: Record<string, (() => void) | undefined> = {
      capture: onCapture,
      "study-verse": onStudyVerse,
      "keep-comparison": onKeepAsComparison,
      "open-in-tab": onOpenInTab,
      pericope: onPericope,
    };
    const unavailable: Record<string, string> = {
      capture: "no writing sheet is open in this window",
      "study-verse": "Study is not available for this passage",
      "keep-comparison": "comparison needs a second translation installed",
      "open-in-tab": "this passage is already the open tab",
      pericope: "pericopes are edited from the passage header",
    };
    return MORE_ACTIONS.map((action) => {
      if (action.id === "copy-reference") {
        // Copy always includes the reference: a quotation without one is a
        // sentence the reader cannot put back where they found it. Reading is
        // never blocked by a read-only library.
        const blocked = navigator.clipboard ? null : "the clipboard is unavailable in this window";
        return {
          id: action.id,
          label: action.label,
          kind: action.kind,
          blockedReason: blocked,
          run: () => { void copyText(`“${quote}”\n— ${reference}`, "reference"); closeTray(true); },
        } satisfies MoreItem;
      }
      const handler = handlers[action.id];
      const blocked = readOnly && action.kind !== "deferred"
        ? "this library is read-only"
        : handler
          ? null
          : unavailable[action.id] ?? "this is not available here";
      return {
        id: action.id,
        label: action.label,
        kind: action.kind,
        blockedReason: blocked,
        run: () => { handler?.(); closeTray(true); },
      } satisfies MoreItem;
    });
  }, [closeTray, copyText, onCapture, onKeepAsComparison, onOpenInTab, onPericope, onStudyVerse, readOnly, selection?.quote, selection?.rangeLabel]);

  const moreScope = selection
    ? `${selection.rangeLabel} · ${selection.phraseMode ? "selected words" : "whole verses"}`
    : "No words selected";

  const moreNode = moreOpen && selection ? (
    <MoreList scope={moreScope} items={moreItems} panelRef={trayPanelRef} />
  ) : null;

  // An unresolved exact capture blocks Connect and nothing else: a wash does
  // not need canonical anchors, so making the reader wait for them would be a
  // delay bought for no one.
  const barDisabled = busy || readOnly;

  const barNode = selection ? (
    <MarkingBar
      hasExistingHighlight={selection.hasExistingHighlight}
      phraseMode={selection.phraseMode}
      selectedWash={currentWash ?? selectedWash}
      disabled={barDisabled}
      moreOpen={moreOpen}
      firstChoiceRef={firstChoiceRef}
      onChooseWash={chooseWash}
      onNote={chooseNote}
      onRemove={chooseErase}
      onConnect={beginConnect}
      onToggleMore={(opener) => { if (moreOpen) closeTray(true); else openTray("more", opener); }}
      onHelpChange={setPaletteHelp}
      helpId="marking-palette-help"
    />
  ) : null;

  const connectNode = session ? (
    <ConnectDraft
      session={session}
      busy={busy}
      draft={connectDraftText}
      copied={copiedNotice === "draft"}
      onDraftChange={setConnectDraftText}
      onChooseKind={chooseDraftKind}
      onSave={() => void finishConnection(session)}
      onCancel={() => { void requestDraftExit("escape"); }}
      onCopyText={() => { void copyText(connectDraftTextRef.current, "draft"); }}
    />
  ) : null;

  const retryFailure = (): void => {
    const failure = selectionFailure;
    const current = selection;
    if (!failure || !current || failure.nonce !== current.nonce || busy || activeOperation.current != null) return;
    setTool(failure.tool);
    const nonce = current.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(failure.tool, current, { oneShot: failure.oneShot }).then((ok) => {
      if (failure.oneShot || !ok) setTool(null);
    }).finally(() => {
      setConsumingSelectionNonce((value) => value === nonce ? null : value);
    });
  };

  const failureNode = selection && !busy && selectionFailure?.nonce === selection.nonce ? (
    <SurfaceState
      key={`failure:${selection.nonce}`}
      state={offline ? "offline" : "failed"}
      thing={selectionFailure.message}
      reason={offline
        ? "The library could not be reached, so nothing was written."
        : "Nothing was written, and your words are still selected."}
      locality={offline ? "remote" : "local"}
      actions={
        <button
          type="button"
          className="marking-session-action primary"
          data-dock-action="retry"
          onMouseDown={(event) => event.preventDefault()}
          onClick={retryFailure}
        >Retry</button>
      }
    />
  ) : null;

  const exitGuardNode = exitGuardReason && session ? createPortal(
    <div
      className={`connection-draft-exit-scrim ${portalThemeClass}`}
      data-floating-layer="dialog"
      onKeyDown={(event) => {
        if (!isTopLayer(exitGuardLayerRef.current)) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          settleExitGuard(false);
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
        aria-labelledby="connection-draft-exit-title"
        aria-describedby="connection-draft-exit-copy"
      >
        <span className="connection-draft-exit-eyebrow">Connection draft</span>
        <h2 id="connection-draft-exit-title">{connectionDraftExitTitle(exitGuardReason)}</h2>
        <p id="connection-draft-exit-copy">
          {session.anchors.length >= 2
            ? `${session.anchors.length} phrases are ready to save.`
            : "A connection needs at least two phrases."}
        </p>
        <div className="connection-draft-exit-actions">
          {connectionDraftExitActions(session.anchors.length).includes("save") && (
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => {
                const target = sessionRef.current;
                if (!target) { settleExitGuard(true); return; }
                void finishConnection(target).then((saved) => settleExitGuard(saved));
              }}
            >Save connection</button>
          )}
          <button
            type="button"
            className="danger"
            disabled={busy}
            onClick={() => {
              discardConnectionDraft();
              settleExitGuard(true);
            }}
          >Discard draft</button>
          <button type="button" autoFocus onClick={() => settleExitGuard(false)}>Keep editing</button>
        </div>
      </div>
    </div>,
    document.body,
  ) : null;

  const toolKey = tool?.type === "wash"
    ? `wash:${tool.color}`
    : tool?.type === "connect"
      ? `connect:${tool.kind}`
      : tool?.type ?? "false";

  if (surface === "palette") {
    if (!selection && !session) {
      return <MarkingRestHint stageBounds={effectiveStageBounds} theme={theme} />;
    }
    const materialClass = `${isDarkTheme(theme) ? "dark " : ""}theme-${theme}`;
    const placement = selection && palettePlacement?.nonce === selection.nonce ? palettePlacement : null;
    const paletteLayout = placement?.layout ?? paletteLayoutHint;
    const paletteQuote = selection ? clipQuotation(selection.quote, 42) : "";
    const content = (
      <div
        className={`marking-floating-host ${materialClass}`}
        data-marking-surface="palette"
        data-focus-ring={focusRingMode}
        data-stage-size={stageClass}
        data-palette-layout={paletteLayout}
        data-selection-capture={selection?.capture.status ?? "none"}
        data-tool-armed={toolKey}
        data-floating-layer="toolbar"
        style={floatingStageStyle}
      >
        {selection && !suppressPaletteForAutoApply && (
          <div
            key={selection.nonce}
            ref={paletteRef}
            className={`marking-palette${placement?.flipped ? " flipped" : ""}${placement ? " is-placed" : " is-measuring"}`}
            style={{
              top: placement?.top ?? effectiveStageBounds.top + 8,
              left: placement?.left ?? effectiveStageBounds.left + 8,
              visibility: placement ? "visible" : "hidden",
              "--mark-pointer-x": `${placement?.pointerX ?? 24}px`,
              "--mark-palette-max-height": `${Math.max(0, effectiveStageBounds.height - 16)}px`,
            } as React.CSSProperties}
            role="toolbar"
            aria-label="Mark selected text"
          >
            <div className="marking-palette-frame">
              <header className="marking-palette-header">
                <div className="marking-palette-title">
                  <span>Mark selection <i aria-hidden="true">·</i> {selection.rangeLabel}</span>
                  <q className="marking-selection-quote" title={selection.quote}>“{paletteQuote || selection.rangeLabel}”</q>
                </div>
                <div className="marking-palette-header-actions">
                  <button type="button" className="marking-palette-action" aria-label="Close palette" title="Close palette" onMouseDown={(event) => event.preventDefault()} onClick={dismissPalette}><PaletteHeaderGlyph icon="close" /></button>
                </div>
              </header>
              {readOnly && (
                <SurfaceState
                  state="read-only"
                  thing="This library is read-only."
                  reason="Marks are stated at the library, before you act on a verse."
                  locality="local"
                />
              )}
              {/* Connect replaces the bar. There is one working area, and only
                  one thing is ever in it. */}
              {connectNode ?? failureNode ?? barNode}
              {moreNode}
              <footer className="marking-palette-footer">
                <span id="marking-palette-help" className="marking-palette-help" aria-live="polite">
                  {captureFeedback ?? (paletteHelp ? paletteHelp.description
                    : selection.mixedColors ? "Mixed washes selected — choose one to unify them."
                      : "Highlight, note, or connect these words.")}
                </span>
                <span className="marking-palette-shortcuts" aria-hidden="true"><kbd>1–5</kbd> colour <i>·</i> <kbd>0</kbd> remove <i>·</i> <kbd>⌘⇧M</kbd> note</span>
              </footer>
            </div>
          </div>
        )}
        {!selection && session && (
          <div className="marking-palette marking-palette-session is-placed" role="group" aria-label="Connection draft">
            <div className="marking-palette-frame">{connectNode}</div>
          </div>
        )}
        {exitGuardNode}
      </div>
    );
    return createPortal(content, document.body);
  }

  const dockState = busy
    ? "busy"
    : session
      ? "session"
      : failureNode
        ? "feedback"
        : moreOpen
          ? "choices"
          : selection
            ? "selection"
            : "rest";

  return (
    <div
      className="marking-dock-host"
      data-marking-surface="dock"
      data-focus-ring={focusRingMode}
      data-dock-layout={dockLayout}
      data-selection-capture={selection?.capture.status ?? "none"}
      data-dock-state={dockState}
      data-tool-armed={toolKey}
    >
      {exitGuardNode}
      <div
        ref={dockRef}
        className={`marking-dock${dockEntranceComplete ? " is-entered" : ""}`}
        role="toolbar"
        aria-label="Marking Dock"
        aria-busy={busy}
        onAnimationEnd={(event) => {
          if (event.currentTarget === event.target && event.animationName === "marking-dock-in") {
            setDockEntranceComplete(true);
          }
        }}
      >
        <div ref={dockModesRef} className="marking-dock-context" id="marking-dock-context">
          {readOnly && (
            <SurfaceState
              state="read-only"
              thing="This library is read-only."
              reason="Marks are stated at the library, before you act on a verse."
              locality="local"
            />
          )}
          {connectNode ?? failureNode ?? barNode ?? (
            <span key="rest" className="marking-dock-resting"><span aria-hidden="true"><ToolGlyph tool="read" /></span>{status}</span>
          )}
          {moreNode}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{status}</span>
      </div>
    </div>
  );
}
