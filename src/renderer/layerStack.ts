/**
 * One ordered registry of floating and attention-holding UI layers.
 *
 * Escape and similar dismiss gestures must belong to exactly one owner: the
 * topmost registered layer. Before this registry, every component ran its own
 * DOM-query heuristic, and the heuristics disagreed — an inline margin card
 * was treated as a floating layer, a radial scrim was special-cased in one
 * place only, and nested popovers were ordered by document position instead
 * of stacking order.
 *
 * Layers register on mount/activation and unregister on unmount/deactivation.
 * Ordering is by semantic rank first (a modal dialog always outranks a hover
 * preview) and by registration sequence second (a later open outranks an
 * earlier one within the same rank).
 */

import { useEffect, useRef } from "react";
import type React from "react";

export type LayerKind =
  /** Modal dialogs: shortcuts, structure, note capture, command palette. */
  | "dialog"
  /** Non-modal floating decisions: word choosers, overflow menus. */
  | "popover"
  /** Verse preview panels. */
  | "peek"
  /** Marking floating chrome: selection palette, radial, rail/dock trays. */
  | "toolbar"
  /** Hover preview wash for a connection. */
  | "preview"
  /** Armed marking tool or an in-progress connection session. */
  | "marking-session"
  /** Selected relationship shape and its inspector card. */
  | "connection-focus"
  /** A plain text selection with summoned marking chrome. */
  | "marking-selection"
  /** Entity research overlay inside the margin. */
  | "research";

const RANK: Record<LayerKind, number> = {
  dialog: 100,
  popover: 90,
  peek: 80,
  toolbar: 70,
  "marking-session": 55,
  "connection-focus": 50,
  "marking-selection": 45,
  // A hover preview is pure invitation: it never outranks deliberate work.
  // Its own Escape still clears it before the base reading desk resumes.
  preview: 40,
  research: 30,
};

export interface LayerHandle {
  readonly kind: LayerKind;
  readonly seq: number;
}

const stack: LayerHandle[] = [];
let nextSeq = 1;

export function pushLayer(kind: LayerKind): LayerHandle {
  const entry: LayerHandle = { kind, seq: nextSeq++ };
  stack.push(entry);
  return entry;
}

export function popLayer(handle: LayerHandle): void {
  const index = stack.indexOf(handle);
  if (index >= 0) stack.splice(index, 1);
}

function topEntry(): LayerHandle | null {
  let top: LayerHandle | null = null;
  for (const entry of stack) {
    if (!top) {
      top = entry;
      continue;
    }
    const rankDelta = RANK[entry.kind] - RANK[top.kind];
    if (rankDelta > 0 || (rankDelta === 0 && entry.seq > top.seq)) top = entry;
  }
  return top;
}

/** The kind of the current topmost layer, or null when nothing is registered. */
export function topLayerKind(): LayerKind | null {
  return topEntry()?.kind ?? null;
}

/**
 * True when `handle` is the topmost registered layer. A null handle belongs
 * to non-layer UI (the reading desk itself) and is "topmost" only when no
 * layer is registered at all.
 */
export function isTopLayer(handle: LayerHandle | null): boolean {
  const top = topEntry();
  if (handle == null) return top == null;
  return top === handle;
}

/** True when no layer is registered — dismiss gestures belong to the base UI. */
export function layerStackIsEmpty(): boolean {
  return stack.length === 0;
}

/** Debug/QA introspection: the live stack as "kind#seq" entries, topmost last. */
export function describeLayerStack(): string[] {
  return [...stack]
    .sort((a, b) => (RANK[a.kind] - RANK[b.kind]) || (a.seq - b.seq))
    .map((entry) => `${entry.kind}#${entry.seq}`);
}

if (typeof window !== "undefined") {
  (window as unknown as { __pericopeLayerStack?: () => string[] }).__pericopeLayerStack = describeLayerStack;
}

/**
 * Registers `kind` while it is non-null and exposes the live handle through a
 * stable ref, so event handlers can consult ownership at event time without
 * re-subscribing. Handlers should proceed only when
 * `isTopLayer(layerRef.current)` is true.
 */
export function useLayer(kind: LayerKind | null): React.MutableRefObject<LayerHandle | null> {
  const ref = useRef<LayerHandle | null>(null);
  useEffect(() => {
    if (kind == null) {
      ref.current = null;
      return undefined;
    }
    const entry = pushLayer(kind);
    ref.current = entry;
    return () => {
      popLayer(entry);
      if (ref.current === entry) ref.current = null;
    };
  }, [kind]);
  return ref;
}
