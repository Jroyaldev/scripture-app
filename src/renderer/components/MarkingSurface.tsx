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
    /** The final painted fragment, used for close collision placement. */
    focusBox: { top: number; bottom: number; left: number; right: number };
    /** The actual prose sheet, so the Radial can prefer its quiet side air. */
    proseBox: { top: number; bottom: number; left: number; right: number };
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

interface Props {
  surface: MarkingSurfaceId;
  theme: AppTheme;
  focusMode: boolean;
  contextKey: string;
  stageBounds: { left: number; top: number; width: number; height: number; bottom: number };
  selection: MarkingSelectionModel | null;
  extensionRequest: ConnectionExtensionRequest | null;
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

const DOCK_MODES = [
  { id: "read", label: "Read" },
  { id: "wash", label: "Wash" },
  { id: "connect", label: "Connect" },
  { id: "note", label: "Note" },
  { id: "erase", label: "Erase" },
] as const;

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

type DockModeId = typeof DOCK_MODES[number]["id"];

function pigmentLabel(color: PigmentId): string {
  return PIGMENTS.find((option) => option.id === color)?.label ?? color;
}

/** One armed-tool description for every surface: same words, same order. */
function describeArmedTool(armedTool: ToolMode | null): { key: string | null; label: string; guidance: string } {
  const key = armedTool?.type === "wash" ? `wash:${armedTool.color}`
    : armedTool?.type === "connect" ? `connect:${armedTool.kind}`
      : armedTool?.type ?? null;
  const label = armedTool?.type === "wash" ? `${pigmentLabel(armedTool.color)} wash`
    : armedTool?.type === "connect" ? relationshipLabel(armedTool.kind)
      : armedTool?.type === "note" ? "Note"
        : armedTool?.type === "erase" ? "Erase" : "";
  const guidance = armedTool?.type === "connect"
    ? "Select words to add the next relationship phrase."
    : armedTool?.type === "wash"
      ? "Select more words to lay this wash again."
      : "Select words to use this tool again.";
  return { key, label, guidance };
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

function ToolGlyph({ tool }: { tool: "read" | "wash" | "connect" | "note" | "erase" }): React.JSX.Element {
  if (tool === "read") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M3.2 4.4c1.9-.7 3.8-.5 5.8.7v9c-2-1.2-3.9-1.4-5.8-.7zM14.8 4.4c-1.9-.7-3.8-.5-5.8.7v9c2-1.2 3.9-1.4 5.8-.7z" /></svg>;
  if (tool === "wash") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4.1 10.7 5.8-6.1 3.5 3.3-5.9 6.2H4.1zM3.2 14.1h11.6" /></svg>;
  if (tool === "connect") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M7.2 11.7 5.9 13a3 3 0 0 1-4.2-4.2l2-2a3 3 0 0 1 4.2 0M10.8 6.3 12.1 5a3 3 0 0 1 4.2 4.2l-2 2a3 3 0 0 1-4.2 0M6.5 11.5l5-5" /></svg>;
  if (tool === "note") return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="M4 3.2h10v8.1l-3.4 3.5H4zM10.6 14.8v-3.5H14M6.6 6.2h4.8M6.6 8.8h3.6" /></svg>;
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
}: {
  selected: ConnectionKind | null;
  onChoose: (kind: ConnectionKind) => void;
  compact?: boolean;
  initialFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onHelpChange?: (help: PaletteHelp | null) => void;
  helpId?: string;
  activateOnMove?: boolean;
  onMoveChoose?: (kind: ConnectionKind) => void;
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

function PigmentChoices({
  selected,
  onChoose,
  compact = false,
  initialFocusRef,
  onHelpChange,
  helpId,
  activateOnMove = false,
  onMoveChoose,
}: {
  selected: PigmentId | null;
  onChoose: (color: PigmentId) => void;
  compact?: boolean;
  initialFocusRef?: React.RefObject<HTMLButtonElement | null>;
  onHelpChange?: (help: PaletteHelp | null) => void;
  helpId?: string;
  activateOnMove?: boolean;
  onMoveChoose?: (color: PigmentId) => void;
}): React.JSX.Element {
  const selectedIndex = PIGMENTS.findIndex((option) => option.id === selected);
  const roving = useRovingFocus<HTMLButtonElement>(PIGMENTS.length, Math.max(0, selectedIndex));
  useEffect(() => {
    if (selectedIndex >= 0) roving.setActiveIndex(selectedIndex);
  }, [roving.setActiveIndex, selectedIndex]);
  return (
    <div className={`marking-choice-grid marking-pigment-grid${compact ? " compact" : ""}`} role={activateOnMove ? "radiogroup" : "group"} aria-label="Highlight color">
      {PIGMENTS.map((option, index) => (
        <button
          key={option.id}
          ref={(node) => {
            roving.refs.current[index] = node;
            if (index === Math.max(0, selectedIndex) && initialFocusRef) initialFocusRef.current = node;
          }}
          type="button"
          role={activateOnMove ? "radio" : undefined}
          className={`marking-choice marking-wash${selected === option.id ? " active" : ""}`}
          data-pigment={option.id}
          aria-checked={activateOnMove ? selected === option.id : undefined}
          aria-pressed={activateOnMove ? undefined : selected === option.id}
          aria-label={`${option.label} wash. ${option.description}`}
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
            if (activateOnMove && next != null) (onMoveChoose ?? onChoose)(PIGMENTS[next]!.id);
          }}
          onClick={() => (activateOnMove ? (onMoveChoose ?? onChoose) : onChoose)(option.id)}
        >
          <PigmentSwatch color={option.id} />
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

function PaletteHeaderGlyph({ icon }: { icon: "note" | "erase" | "pin" | "close" }): React.JSX.Element {
  if (icon === "note") return <ToolGlyph tool="note" />;
  if (icon === "erase") return <ToolGlyph tool="erase" />;
  if (icon === "pin") {
    return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m6 3h6l-.8 3.6 2.2 2.1H4.6l2.2-2.1zM9 8.7v6.4" /></svg>;
  }
  return <svg viewBox="0 0 18 18" aria-hidden="true"><path d="m4.5 4.5 9 9M13.5 4.5l-9 9" /></svg>;
}

function PaletteVocabulary({
  selectedKind,
  selectedWash,
  onChooseKind,
  onChooseWash,
  onHelpChange,
  initialFocusRef,
  helpId,
}: {
  selectedKind: ConnectionKind | null;
  selectedWash: PigmentId | null;
  onChooseKind: (kind: ConnectionKind) => void;
  onChooseWash: (color: PigmentId) => void;
  onHelpChange: (help: PaletteHelp | null) => void;
  initialFocusRef: React.RefObject<HTMLButtonElement | null>;
  helpId: string;
}): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState(0);
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const count = RELATIONSHIPS.length + PIGMENTS.length;

  const handleKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = index - 1;
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = count - 1;
    if (next == null) return;
    event.preventDefault();
    const normalized = (next + count) % count;
    setActiveIndex(normalized);
    refs.current[normalized]?.focus({ preventScroll: true });
  };

  const explain = (option: PaletteHelp): void => onHelpChange(option);
  const clearExplanationAfterPointer = (event: React.MouseEvent<HTMLButtonElement>): void => {
    if (document.activeElement !== event.currentTarget) onHelpChange(null);
  };
  const clearExplanationAfterFocus = (event: React.FocusEvent<HTMLButtonElement>): void => {
    if (!event.currentTarget.matches(":hover")) onHelpChange(null);
  };

  return (
    <div className="marking-palette-vocabularies">
      <section className="marking-palette-vocabulary" role="group" aria-labelledby="marking-palette-connect-label">
        <div className="marking-palette-section-heading">
          <span id="marking-palette-connect-label">Connect</span>
          <small>How do these words relate?</small>
        </div>
        <div className="marking-choice-grid marking-relationship-grid">
          {RELATIONSHIPS.map((option, index) => (
            <button
              key={option.id}
              ref={(node) => {
                refs.current[index] = node;
                if (index === 0) initialFocusRef.current = node;
              }}
              type="button"
              className={`marking-choice marking-relationship marking-kind-${option.id.replace("link:", "")}${selectedKind === option.id ? " active" : ""}`}
              data-relationship-kind={option.id}
              aria-label={`${index + 1}. ${option.label}. ${option.description}`}
              aria-keyshortcuts={`${index + 1}`}
              aria-pressed={selectedKind === option.id}
              aria-describedby={helpId}
              tabIndex={activeIndex === index ? 0 : -1}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => explain(option)}
              onMouseLeave={clearExplanationAfterPointer}
              onFocus={() => { setActiveIndex(index); explain(option); }}
              onBlur={clearExplanationAfterFocus}
              onKeyDown={(event) => handleKeyDown(event, index)}
              onClick={() => onChooseKind(option.id)}
            >
              <span className="marking-choice-glyph"><RelationshipGlyph kind={option.id} /></span>
              <span className="marking-choice-label">{option.label}</span>
            </button>
          ))}
        </div>
      </section>
      <section className="marking-palette-vocabulary" role="group" aria-labelledby="marking-palette-highlight-label">
        <div className="marking-palette-section-heading">
          <span id="marking-palette-highlight-label">Wash</span>
          <small>Choose a quiet wash.</small>
        </div>
        <div className="marking-choice-grid marking-pigment-grid">
          {PIGMENTS.map((option, pigmentIndex) => {
            const index = RELATIONSHIPS.length + pigmentIndex;
            return (
              <button
                key={option.id}
                ref={(node) => { refs.current[index] = node; }}
                type="button"
                className={`marking-choice marking-wash${selectedWash === option.id ? " active" : ""}`}
                data-pigment={option.id}
                aria-label={`Shift+${pigmentIndex + 1}. ${option.label} wash. ${option.description}`}
                aria-keyshortcuts={`Shift+${pigmentIndex + 1}`}
                aria-pressed={selectedWash === option.id}
                aria-describedby={helpId}
                tabIndex={activeIndex === index ? 0 : -1}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => explain(option)}
                onMouseLeave={clearExplanationAfterPointer}
                onFocus={() => { setActiveIndex(index); explain(option); }}
                onBlur={clearExplanationAfterFocus}
                onKeyDown={(event) => handleKeyDown(event, index)}
                onClick={() => onChooseWash(option.id)}
              >
                <PigmentSwatch color={option.id} />
                <span className="marking-choice-label">{option.label}</span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

function SessionStatus({
  session,
  busy,
  stageBounds,
  onDone,
  onCancel,
}: {
  session: ConnectionSession;
  busy: boolean;
  stageBounds: { left: number; top: number; width: number };
  onDone: () => void;
  onCancel: () => void;
}): React.JSX.Element {
  const binary = BINARY_KINDS.has(session.kind);
  const phraseLabel = `${session.anchors.length} phrase${session.anchors.length === 1 ? "" : "s"}`;
  return (
    <div
      className="marking-session"
      aria-busy={busy}
      data-floating-layer="marking-session"
      style={{
        "--mark-session-left": `${stageBounds.left}px`,
        "--mark-session-top": `${stageBounds.top}px`,
        "--mark-session-width": `${stageBounds.width}px`,
      } as React.CSSProperties}
    >
      <span className="marking-session-kind">
        <RelationshipGlyph kind={session.kind} />
        {relationshipLabel(session.kind)} · {phraseLabel}
      </span>
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
            ?? (binary
              ? "Select the counterpart."
              : session.anchors.length === 1
                ? "Select another phrase to connect."
                : "Select more text to keep adding.")}
      </span>
      {session.anchors.length >= 2 && (!binary || Boolean(session.feedback)) && (
        <button type="button" className="marking-session-action primary" disabled={busy} onClick={onDone}>
          {session.feedback || binary ? "Retry" : "Save connection"}
        </button>
      )}
      {session.recoveryState ? (
        <span className="marking-session-recovery">Recovery required</span>
      ) : (
        <button
          type="button"
          className="marking-session-action"
          disabled={busy}
          onClick={onCancel}
        >Cancel draft</button>
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
}: Props): React.JSX.Element | null {
  const [tool, setTool] = useState<ToolMode | null>(null);
  const [session, setSession] = useState<ConnectionSession | null>(null);
  const [keepActive, setKeepActive] = useState(false);
  const [tray, setTray] = useState<"intent" | "wash" | "connect" | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(REST_GUIDANCE);
  const [selectionFailure, setSelectionFailure] = useState<SelectionFailure | null>(null);
  const [paletteHelp, setPaletteHelp] = useState<PaletteHelp | null>(null);
  const [palettePlacement, setPalettePlacement] = useState<PalettePlacement | null>(null);
  const [consumingSelectionNonce, setConsumingSelectionNonce] = useState<number | null>(null);
  const [dockHelp, setDockHelp] = useState<PaletteHelp | null>(null);
  const [dockEntranceComplete, setDockEntranceComplete] = useState(false);
  const [focusRingMode, setFocusRingMode] = useState<"pointer" | "keyboard">("pointer");
  const [exitGuardReason, setExitGuardReason] = useState<ConnectionDraftExitReason | null>(null);
  const sessionRef = useRef<ConnectionSession | null>(session);
  sessionRef.current = session;
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
  const trayOpenerModeRef = useRef<"wash" | "connect" | null>(null);
  const trayShouldFocusRef = useRef(true);
  const focusRestoreTimerRef = useRef<number | null>(null);
  const lastDockAutofocusedSelectionRef = useRef<number | null>(null);
  const activeSelectionNonceRef = useRef<number | null>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  const dockModesRef = useRef<HTMLDivElement>(null);
  const exitGuardRef = useRef<HTMLDivElement>(null);
  const railRoving = useRovingFocus<HTMLButtonElement>(4);
  const dockModeRoving = useRovingFocus<HTMLButtonElement>(DOCK_MODES.length);
  const dockIntentRoving = useRovingFocus<HTMLButtonElement>(2);

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
   * the stage is only ~756px once the rail, the insets and the margin are
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
  // Escape ownership rank in the shared layer registry. An open tray or an
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
  const dockMode: DockModeId = session
    ? "connect"
    : tray === "wash" || tray === "connect"
      ? tray
      : tool?.type ?? "read";
  const dockModeIndex = Math.max(0, DOCK_MODES.findIndex((item) => item.id === dockMode));
  const dockLayout = effectiveStageBounds.width <= 759 ? "stacked" : "shelf";
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

  useEffect(() => {
    if (surface !== "dock") return;
    dockModeRoving.setActiveIndex(dockModeIndex);
  }, [dockModeIndex, dockModeRoving.setActiveIndex, surface]);

  useLayoutEffect(() => {
    if (surface !== "dock") return;
    const group = dockModesRef.current;
    if (!group) return;
    let frame = 0;
    let cancelled = false;
    const measure = (): void => {
      if (cancelled) return;
      const active = group.querySelector<HTMLButtonElement>(`button[data-dock-tool="${dockMode}"]`);
      if (!active) return;
      const groupRect = group.getBoundingClientRect();
      const activeRect = active.getBoundingClientRect();
      if (groupRect.width <= 0 || activeRect.width <= 0) return;
      group.style.setProperty("--mark-dock-x", `${activeRect.left - groupRect.left}px`);
      group.style.setProperty("--mark-dock-width", `${activeRect.width}px`);
      group.dataset.thumbReady = "true";
    };
    const schedule = (): void => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    measure();
    const observer = new ResizeObserver(schedule);
    observer.observe(group);
    for (const button of group.querySelectorAll("button")) observer.observe(button);
    let fontsCancelled = false;
    void document.fonts?.ready.then(() => {
      if (!fontsCancelled) schedule();
    });
    document.fonts?.addEventListener("loadingdone", schedule);
    return () => {
      cancelled = true;
      fontsCancelled = true;
      observer.disconnect();
      document.fonts?.removeEventListener("loadingdone", schedule);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [dockMode, effectiveStageBounds.height, effectiveStageBounds.width, surface]);

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
      const gap = 10;
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
      const height = Math.min(panelRect.height, Math.max(0, effectiveStageBounds.height - inset * 2));
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



  const openTray = (next: "wash" | "connect", opener: HTMLButtonElement, focusChoices = true): void => {
    clearPendingFocusRestore();
    trayOpenerRef.current = opener;
    trayOpenerModeRef.current = next;
    trayShouldFocusRef.current = focusChoices;
    setSelectionFailure(null);
    setDockHelp(null);
    setTray(next);
  };

  const closeTray = useCallback((restoreFocus: boolean): void => {
    const opener = trayOpenerRef.current;
    const openerMode = trayOpenerModeRef.current;
    setTray(null);
    setDockHelp(null);
    if (tool?.type === "wash") setStatus("Select words to lay this wash.");
    else if (tool?.type === "connect") setStatus("Select words to add the next relationship phrase.");
    else if (activeSelectionNonce != null) setStatus("Selected words remain ready to mark.");
    else setStatus(REST_GUIDANCE);
    clearPendingFocusRestore();
    if (!restoreFocus) return;
    const ownerContextKey = currentContextKey.current;
    focusRestoreTimerRef.current = window.setTimeout(() => {
      focusRestoreTimerRef.current = null;
      if (currentContextKey.current !== ownerContextKey) return;
      if (surface === "dock" && opener?.matches("[data-dock-intent]")) {
        const remountedIntent = dockRef.current?.querySelector<HTMLButtonElement>(`button[data-dock-intent="${openerMode}"]`);
        if (remountedIntent) {
          remountedIntent.focus({ preventScroll: true });
          return;
        }
      }
      if (opener?.isConnected && (surface !== "dock" || opener.getAttribute("aria-checked") === "true")) {
        opener.focus({ preventScroll: true });
        return;
      }
      const toolbar = dockModesRef.current;
      const fallback = surface === "dock"
        ? toolbar?.querySelector<HTMLButtonElement>('button[role="radio"][aria-checked="true"]')
        : [...(toolbar?.querySelectorAll<HTMLButtonElement>("button") ?? [])]
          .find((button) => button.getAttribute("aria-label")?.startsWith(openerMode === "wash" ? "Wash" : "Connect"));
      fallback?.focus({ preventScroll: true });
    }, 0);
  }, [activeSelectionNonce, clearPendingFocusRestore, surface, tool]);

  useEffect(() => () => {
    clearPendingFocusRestore();
  }, [clearPendingFocusRestore, surface]);

  useEffect(() => () => {
    operationSequence.current += 1;
    activeOperation.current = null;
  }, []);

  const finishConnection = useCallback(async (target: ConnectionSession): Promise<boolean> => {
    if (
      target.anchors.length < 2
      || (!target.recoveryState && target.contextKey !== contextKey)
      || busy
    ) return false;
    const operation = beginOperation();
    if (!operation) return false;
    const label = target.label
      ?? `${relationshipLabel(target.kind)} · ${target.labels.slice(0, 2).join(" / ")}${target.labels.length > 2 ? ` +${target.labels.length - 2}` : ""}`;
    let outcome: ConnectionMutationUiOutcome = "failed";
    try {
      outcome = target.connectionId
        ? await onUpdateConnection(
          target.connectionId,
          target.kind,
          target.anchors,
          label,
          target.observation,
          target.commandId,
          target.expectedBaseEventId!,
        )
        : await onCreateConnection(
          target.kind,
          target.anchors,
          label,
          target.observation,
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
    if (!persistentSurface && !keepActive) setTool(null);
    onRequestReadingFocus(target.anchors);
    return true;
  }, [beginOperation, busy, contextKey, keepActive, onCreateConnection, onRequestReadingFocus, onUpdateConnection, persistentSurface, releaseOperation]);

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
    setStatus(BINARY_KINDS.has(kind)
      ? "Select the counterpart."
      : next.anchors.length === 1
        ? `${relationshipLabel(kind)} · 1 phrase · Select another phrase to connect.`
        : `${relationshipLabel(kind)} · ${next.anchors.length} phrases · Select more text to keep adding.`);
    onClearSelection(current.nonce);
    onRequestReadingFocus([current.capture.anchor], current.nonce);
    if (BINARY_KINDS.has(kind) && next.anchors.length === 2) void finishConnection(next);
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
      if (!ok && surface === "dock") {
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
    if (!ok && surface === "dock") {
      setSelectionFailure({ nonce: current.nonce, tool: nextTool, message, oneShot: Boolean(options.oneShot) });
      setTray(null);
    }
    if (ok) onClearSelection(current.nonce);
    if (!ok || !persistentSurface) setTool(null);
    return ok;
  }, [beginOperation, busy, captureConnection, keepActive, onClearSelection, onNote, onRemove, onRequestReadingFocus, onSetColor, persistentSurface, releaseOperation, session?.recoveryState, surface]);

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
    setTray(surface === "dock" ? "wash" : null);
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
    setTray(surface === "dock" ? "connect" : null);
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
    if ((tray === "wash" || tray === "connect") && tool.type !== tray) return;
    const nonce = selection.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(tool, selection).then(
      (consumed) => {
        if (!consumed) setConsumingSelectionNonce((current) => current === nonce ? null : current);
      },
      () => setConsumingSelectionNonce((current) => current === nonce ? null : current),
    );
  }, [applyTool, busy, contextKey, selection, tool, tray]);

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
    setDockHelp(null);
    setStatus(REST_GUIDANCE);
  }, [contextKey]);

  useEffect(() => {
    setPaletteHelp(null);
    railRoving.setActiveIndex(0);
    setDockHelp(null);
    dockIntentRoving.setActiveIndex(0);
  }, [selection?.nonce, surface]);

  useEffect(() => {
    if (!selectionFailure) return;
    if (activeSelectionNonce == null) {
      if (busy) return;
      const timer = window.setTimeout(() => {
        if (activeSelectionNonceRef.current != null || activeOperation.current != null) return;
        setSelectionFailure(null);
        if (tool?.type === "wash") setStatus("Select words to lay this wash.");
        else if (tool?.type === "connect") setStatus("Select words to add the next relationship phrase.");
        else if (tool?.type === "note") setStatus("Select a passage to open a note.");
        else if (tool?.type === "erase") setStatus("Select a passage with a wash to remove its mark.");
        else setStatus(REST_GUIDANCE);
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (selectionFailure.nonce === activeSelectionNonce) return;
    setSelectionFailure(null);
    setStatus("Selected words remain ready to mark.");
  }, [activeSelectionNonce, busy, selectionFailure, tool]);

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
    if (tray !== "connect" && tray !== "wash") return;
    if (!trayShouldFocusRef.current) {
      trayShouldFocusRef.current = true;
      return;
    }
    const timer = window.setTimeout(() => firstChoiceRef.current?.focus({ preventScroll: true }), 0);
    return () => window.clearTimeout(timer);
  }, [tray]);

  useEffect(() => {
    if (!persistentSurface || (tray !== "connect" && tray !== "wash")) return;
    const onMouseDown = (event: MouseEvent): void => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (trayPanelRef.current?.contains(target) || trayOpenerRef.current?.contains(target)) return;
      closeTray(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [closeTray, persistentSurface, tray]);

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
      // session or tray outranks a passive connection card, while a plain
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
      if (persistentSurface && (tray === "connect" || tray === "wash")) {
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
        if (tool?.type === "wash") setStatus("Select words to lay this wash.");
        else if (tool?.type === "connect") setStatus("Select words to add the next relationship phrase.");
        else if (tool?.type === "note") setStatus("Select a passage to open a note.");
        else if (tool?.type === "erase") setStatus("Select a passage with a wash to remove its mark.");
        else setStatus(REST_GUIDANCE);
        if (surface === "palette" && !tool) setKeepActive(false);
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
  }, [activeSelectionNonce, busy, clearPendingFocusRestore, closeTray, focusMode, layerKind, onDismissSelection, onRequestReadingFocus, persistentSurface, requestDraftExit, selection, session, surface, tool, tray]);

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
    if (surface === "palette") setKeepActive(false);
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
    if (surface === "palette") setKeepActive(false);
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

  const applyDockSelectionAction = (type: "note" | "erase"): void => {
    if (!selection || busy || activeOperation.current != null || session?.recoveryState) {
      if (session?.recoveryState) {
        setStatus("Recovery required · Retry the exact connection command before another marking action.");
        return;
      }
      setStatus("Finishing the current change · your selection is still held.");
      return;
    }
    const nonce = selection.nonce;
    const next: ToolMode = type === "note" ? { type: "note" } : { type: "erase" };
    setConsumingSelectionNonce(nonce);
    void applyTool(next, selection, { oneShot: true }).finally(() => {
      setConsumingSelectionNonce((current) => current === nonce ? null : current);
    });
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
    if (!tool) setKeepActive(false);
    setPaletteHelp(null);
    onDismissSelection();
  };

  const handlePaletteKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.repeat || event.nativeEvent.isComposing || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (target instanceof HTMLElement && (
      target.isContentEditable
      || target.matches("input, textarea, select, [role='textbox']")
    )) return;
    const match = /^Digit([1-6])$/.exec(event.code);
    if (!match) return;
    const index = Number(match[1]) - 1;
    if (event.shiftKey) {
      const pigment = PIGMENTS[index];
      if (!pigment) return;
      event.preventDefault();
      event.stopPropagation();
      chooseWash(pigment.id);
      return;
    }
    const relationship = RELATIONSHIPS[index];
    if (!relationship) return;
    event.preventDefault();
    event.stopPropagation();
    chooseConnection(relationship.id);
  };

  const portalThemeClass = `${isDarkTheme(theme) ? "dark " : ""}theme-${theme}`;
  const sessionNode = session ? createPortal(
    <div className={`marking-session-portal ${portalThemeClass}`}>
      <SessionStatus
        session={session}
        busy={busy}
        stageBounds={effectiveStageBounds}
        onDone={() => void finishConnection(session)}
        onCancel={() => { void requestDraftExit("escape"); }}
      />
    </div>,
    document.body,
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

  const choicePanel = tray === "connect" ? (
    <div key="connect" ref={trayPanelRef} className="marking-choice-panel">
      <div className="marking-panel-heading">
        <span>Connect</span>
        <small
          id={surface === "dock" ? "marking-dock-choice-help" : undefined}
          title={surface === "dock" && dockHelp ? dockHelp.description : undefined}
          aria-live={surface === "dock" ? "polite" : undefined}
        >{captureFeedback ?? (surface === "dock" && dockHelp ? dockHelp.description : "How do these words relate?")}</small>
      </div>
      <RelationshipChoices
        selected={currentKind}
        onChoose={chooseConnection}
        compact={surface === "dock"}
        initialFocusRef={firstChoiceRef}
        onHelpChange={surface === "dock" ? setDockHelp : undefined}
        helpId={surface === "dock" ? "marking-dock-choice-help" : undefined}
        activateOnMove={surface === "dock" && !selection}
        onMoveChoose={surface === "dock" ? (kind) => {
          setTool({ type: "connect", kind });
          setStatus("Select words to add the next relationship phrase.");
        } : undefined}
      />
    </div>
  ) : tray === "wash" ? (
    <div key="wash" ref={trayPanelRef} className="marking-choice-panel">
      <div className="marking-panel-heading">
        <span>Wash</span>
        <small
          id={surface === "dock" ? "marking-dock-choice-help" : undefined}
          title={surface === "dock" && dockHelp ? dockHelp.description : undefined}
        >{surface === "dock" && dockHelp ? dockHelp.description : "Choose a quiet wash."}</small>
      </div>
      <PigmentChoices
        selected={currentWash ?? selectedWash}
        onChoose={chooseWash}
        compact={surface === "dock"}
        initialFocusRef={firstChoiceRef}
        onHelpChange={surface === "dock" ? setDockHelp : undefined}
        helpId={surface === "dock" ? "marking-dock-choice-help" : undefined}
        activateOnMove={surface === "dock" && !selection}
        onMoveChoose={surface === "dock" ? (color) => {
          setTool({ type: "wash", color });
          setStatus("Select words to lay this wash.");
        } : undefined}
      />
    </div>
  ) : null;

  if (surface === "palette") {
    const armedTool = keepActive ? tool : null;
    if (!selection && !session && !armedTool) {
      return <MarkingRestHint stageBounds={effectiveStageBounds} theme={theme} />;
    }
    const materialClass = `${isDarkTheme(theme) ? "dark " : ""}theme-${theme}`;
    const placement = selection && palettePlacement?.nonce === selection.nonce ? palettePlacement : null;
    const paletteLayout = placement?.layout ?? paletteLayoutHint;
    const paletteQuote = selection
      ? selection.quote.length > 42 ? `${selection.quote.slice(0, 41)}…` : selection.quote
      : "";
    const { key: armedKey, label: armedLabel, guidance: armedGuidance } = describeArmedTool(armedTool);
    const content = (
      <div
        className={`marking-floating-host ${materialClass}`}
        data-marking-surface="palette"
        data-focus-ring={focusRingMode}
        data-stage-size={stageClass}
        data-palette-layout={paletteLayout}
        data-selection-capture={selection?.capture.status ?? "none"}
        data-tool-armed={armedKey ?? "false"}
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
            onKeyDown={handlePaletteKeyDown}
          >
            <div className="marking-palette-frame">
              <header className="marking-palette-header">
                <div className="marking-palette-title">
                  <span>Mark selection <i aria-hidden="true">·</i> {selection.rangeLabel}</span>
                  <q className="marking-selection-quote" title={selection.quote}>“{paletteQuote || selection.rangeLabel}”</q>
                </div>
                <div className="marking-palette-header-actions">
                  <button type="button" className="marking-palette-action" aria-label="Add note" title="Add note" onMouseDown={(event) => event.preventDefault()} onClick={chooseNote}><PaletteHeaderGlyph icon="note" /></button>
                  {selection.hasExistingHighlight && (
                    <button type="button" className="marking-palette-action" aria-label={selection.phraseMode ? "Remove selected text from wash" : "Remove wash"} title="Remove wash" onMouseDown={(event) => event.preventDefault()} onClick={chooseErase}><PaletteHeaderGlyph icon="erase" /></button>
                  )}
                  <button
                    type="button"
                    className={`marking-palette-action marking-palette-pin${keepActive ? " active" : ""}`}
                    aria-label={keepActive ? "Tool will stay active" : "Keep chosen tool active"}
                    title={keepActive ? "Tool will stay active" : "Keep chosen tool active"}
                    aria-pressed={keepActive}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => { setKeepActive((current) => !current); setPaletteHelp(null); }}
                  ><PaletteHeaderGlyph icon="pin" /></button>
                  <button type="button" className="marking-palette-action" aria-label="Close palette" title="Close palette" onMouseDown={(event) => event.preventDefault()} onClick={dismissPalette}><PaletteHeaderGlyph icon="close" /></button>
                </div>
              </header>
              <PaletteVocabulary
                selectedKind={currentKind}
                selectedWash={currentWash ?? selectedWash}
                onChooseKind={chooseConnection}
                onChooseWash={chooseWash}
                onHelpChange={setPaletteHelp}
                initialFocusRef={firstChoiceRef}
                helpId="marking-palette-help"
              />
              <footer className="marking-palette-footer">
                <span id="marking-palette-help" className="marking-palette-help" aria-live="polite">
                  {keepActive
                    ? "The tool you choose will remain in your hand."
                    : captureFeedback ?? (paletteHelp ? paletteHelp.description
                      : selection.mixedColors ? "Mixed washes selected — choose one to unify them."
                        : "Connect the words — or lay a wash.")}
                </span>
                <span className="marking-palette-shortcuts" aria-hidden="true"><kbd>1–6</kbd> connect <i>·</i> <kbd>⇧1–5</kbd> wash</span>
              </footer>
            </div>
          </div>
        )}
        {sessionNode}
        {exitGuardNode}
        {!selection && !session && armedTool && (
          <div className="marking-armed-status" role="status" aria-live="polite" data-tool-armed={armedKey}>
            <span className="marking-armed-tag">{armedLabel}</span>
            <span className="marking-armed-copy">{armedGuidance}</span>
            <button type="button" onClick={() => putDownTool()}>Put down</button>
          </div>
        )}
      </div>
    );
    return createPortal(content, document.body);
  }

  const chooseMode = (
    id: DockModeId,
    opener?: HTMLButtonElement | null,
    focusChoices = true,
    applyCurrentSelection = true,
  ): void => {
    if (busy || session) return;
    if (id === "read") { putDownTool(applyCurrentSelection); return; }
    if (id === "wash" || id === "connect") {
      if (tool?.type !== id) {
        setTool(null);
        setKeepActive(false);
      }
      setStatus(id === "wash" ? "Choose a quiet wash." : "Choose how the words relate.");
      if (opener) openTray(id, opener, focusChoices);
      return;
    }
    if (!applyCurrentSelection) {
      if (selection) processedSelection.current = selection.nonce;
      setSelectionFailure(null);
      setTool(id === "note" ? { type: "note" } : { type: "erase" });
      setTray(null);
      setStatus(id === "note"
        ? "Note tool ready · select a passage to open a note."
        : "Erase tool ready · select a passage with a wash to remove its mark.");
      return;
    }
    if (id === "note") { chooseNote(); return; }
    chooseErase();
  };

  const dockFailureVisible = Boolean(
    selection
    && !busy
    && selectionFailure?.nonce === selection.nonce,
  );
  const retryDockFailure = (): void => {
    const failure = selectionFailure;
    const current = selection;
    if (!failure || !current || failure.nonce !== current.nonce || busy || activeOperation.current != null) return;
    setTool(failure.tool);
    if (failure.tool.type === "wash") setTray("wash");
    const nonce = current.nonce;
    setConsumingSelectionNonce(nonce);
    void applyTool(failure.tool, current, { oneShot: failure.oneShot }).then((ok) => {
      if (ok) setTray(null);
      if (failure.oneShot || !ok) setTool(null);
    }).finally(() => {
      setConsumingSelectionNonce((value) => value === nonce ? null : value);
    });
  };
  const dockState = busy
    ? "busy"
    : session
      ? "session"
      : dockFailureVisible
        ? "feedback"
        : choicePanel
          ? "choices"
          : selection && !tool
            ? "selection"
            : tool
              ? "armed"
              : "rest";
  const dockContextKind = session
    ? "session"
    : busy
      ? "status"
      : dockFailureVisible
        ? "feedback"
        : tray === "wash" || tray === "connect"
          ? tray
          : selection && !tool
            ? "intent"
            : "status";
  const dockArmedKey = tool?.type === "wash"
    ? `wash:${tool.color}`
    : tool?.type === "connect"
      ? `connect:${tool.kind}`
      : tool?.type ?? "false";
  const dockBusyCopy = session
    ? "Saving connection…"
    : dockMode === "erase"
      ? "Removing wash…"
      : dockMode === "wash"
        ? "Saving wash…"
        : "Finishing change…";
  const dockToolLabel = tool?.type === "wash"
    ? `${pigmentLabel(tool.color)} wash`
    : tool?.type === "connect"
      ? relationshipLabel(tool.kind)
      : tool?.type === "note"
        ? "Note"
        : tool?.type === "erase"
          ? "Erase"
          : "Read";
  const dockContext = sessionNode ?? (busy ? (
    <div key="busy" className="marking-dock-feedback is-busy" role="status" aria-live="polite">
      <span className="marking-dock-spinner" aria-hidden="true" />
      <span>{dockBusyCopy}</span>
    </div>
  ) : dockFailureVisible ? (
    <div key={`feedback:${selection?.nonce ?? 0}`} className="marking-dock-feedback" role="status" aria-live="assertive">
      <span>{selectionFailure?.message}</span>
      <button
        type="button"
        className="marking-dock-retry"
        data-dock-action="retry"
        autoFocus
        onMouseDown={(event) => event.preventDefault()}
        onClick={retryDockFailure}
      >Retry</button>
    </div>
  ) : choicePanel ?? (selection && !tool ? (
    <div key={`selection:${selection.nonce}`} className="marking-dock-selection" data-dock-context="intent">
      <span className="marking-dock-context-label">Mark selection</span>
      <div className="marking-dock-intents" role="group" aria-label="Mark selected words">
        <button
          ref={(node) => {
            firstChoiceRef.current = node;
            dockIntentRoving.refs.current[0] = node;
          }}
          type="button"
          className="marking-dock-intent"
          data-dock-intent="wash"
          tabIndex={dockIntentRoving.activeIndex === 0 ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => dockIntentRoving.setActiveIndex(0)}
          onKeyDown={(event) => { dockIntentRoving.onKeyDown(event, 0); }}
          onClick={(event) => openTray("wash", event.currentTarget)}
        ><ToolGlyph tool="wash" /><span>Wash</span></button>
        <button
          ref={(node) => { dockIntentRoving.refs.current[1] = node; }}
          type="button"
          className="marking-dock-intent"
          data-dock-intent="connect"
          tabIndex={dockIntentRoving.activeIndex === 1 ? 0 : -1}
          onMouseDown={(event) => event.preventDefault()}
          onFocus={() => dockIntentRoving.setActiveIndex(1)}
          onKeyDown={(event) => { dockIntentRoving.onKeyDown(event, 1); }}
          onClick={(event) => openTray("connect", event.currentTarget)}
        ><ToolGlyph tool="connect" /><span>Connect</span></button>
      </div>
      <q className="marking-dock-quote" title={selection.quote}>{selection.quote}</q>
    </div>
  ) : tool ? (
    <div key={`armed:${dockArmedKey}`} className="marking-dock-tool-status" role="status" aria-live="polite">
      <span className="marking-dock-tool-tag">{dockToolLabel}</span>
      <span>{status}</span>
      <button type="button" className="marking-dock-put-down" onMouseDown={(event) => event.preventDefault()} onClick={() => putDownTool()}>Put down</button>
    </div>
  ) : (
    <span key="rest" className="marking-dock-resting"><span aria-hidden="true"><ToolGlyph tool="read" /></span>{status}</span>
  )));

  return (
    <div
      className="marking-dock-host"
      data-marking-surface="dock"
      data-focus-ring={focusRingMode}
      data-dock-layout={dockLayout}
      data-selection-capture={selection?.capture.status ?? "none"}
      data-dock-mode={dockMode}
      data-dock-state={dockState}
      data-tool-armed={dockArmedKey}
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
        <div ref={dockModesRef} className="marking-dock-modes" role="radiogroup" aria-label="Marking mode">
          <span className="marking-dock-thumb" aria-hidden="true" />
          {DOCK_MODES.map((item, index) => {
            const active = item.id === dockMode;
            const subtypeClass = item.id === "connect" && currentKind
              ? ` marking-kind-${currentKind.replace("link:", "")}`
              : item.id === "wash" && currentWash ? ` tone-${currentWash}` : "";
            const modeLabel = item.id === "connect" && currentKind
              ? `${item.label}: ${relationshipLabel(currentKind)}`
              : item.id === "wash" && currentWash
                ? `${item.label}: ${pigmentLabel(currentWash)}`
                : item.label;
            const ownsContext = item.id === "wash" || item.id === "connect";
            return (
              <button
                key={item.id}
                ref={(node) => { dockModeRoving.refs.current[index] = node; }}
                type="button"
                role="radio"
                data-dock-tool={item.id}
                data-tooltip={modeLabel}
                disabled={busy || !!session}
                className={`marking-dock-mode${active ? " active" : ""}${subtypeClass}`}
                aria-checked={active}
                aria-label={modeLabel}
                aria-controls={ownsContext ? "marking-dock-context" : undefined}
                aria-expanded={ownsContext ? tray === item.id : undefined}
                tabIndex={active ? 0 : -1}
                onMouseDown={(event) => event.preventDefault()}
                onFocus={() => dockModeRoving.setActiveIndex(index)}
                onKeyDown={(event) => {
                  if (!["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"].includes(event.key)) return;
                  const nextIndex = dockModeRoving.onKeyDown(event, index);
                  const nextMode = nextIndex == null ? null : DOCK_MODES[nextIndex];
                  if (nextMode) {
                    chooseMode(nextMode.id, dockModeRoving.refs.current[nextIndex ?? index] ?? event.currentTarget, false, false);
                  }
                }}
                onClick={(event) => chooseMode(item.id, event.currentTarget)}
              ><ToolGlyph tool={item.id} /><span className="marking-dock-mode-label">{item.label}</span></button>
            );
          })}
        </div>
        <div id="marking-dock-context" className="marking-dock-context" data-dock-context={dockContextKind}>
          {dockContext}
        </div>
        <div className="marking-dock-actions" aria-label="Selected wash actions">
          {selection?.hasExistingHighlight && (
            <span className="marking-dock-hit" data-highlight-color={selectedWash ?? (selection.mixedColors ? "mixed" : "unknown")}>
              {selectedWash && <PigmentSwatch color={selectedWash} />}
              <span>{selectedWash ? pigmentLabel(selectedWash) : selection.mixedColors ? "Mixed wash" : "Highlight"}</span>
            </span>
          )}
          {selection?.hasExistingHighlight && (
            <button
              type="button"
              data-dock-action="note"
              data-tooltip="Add note"
              aria-label="Add note to selected highlight"
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyDockSelectionAction("note")}
            ><ToolGlyph tool="note" /></button>
          )}
          {selection?.hasExistingHighlight && (
            <button
              type="button"
              data-dock-action="erase"
              data-tooltip={selection.phraseMode ? "Remove selected words" : "Remove wash"}
              aria-label={selection.phraseMode ? "Remove selected text from wash" : "Remove selected highlight"}
              disabled={busy}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyDockSelectionAction("erase")}
            ><ToolGlyph tool="erase" /></button>
          )}
        </div>
        <span className="sr-only" role="status" aria-live="polite">{status}</span>
      </div>
    </div>
  );
}
