/**
 * MARKS OR COVERS — what face the publisher shelf wears.
 *
 * ── The question this settles ───────────────────────────────────────────────
 *
 * The shelf is a register of publishers: one uniform cell each, the publisher's
 * own approved mark, a tally under it, in rank order. That is the right face
 * for what the shelf IS — a ranking of who has something to say about this
 * passage — and it stays the default for exactly that reason. A mark is a
 * publisher; a cover is a record.
 *
 * But the maintainer asked to see the artwork here too, and the ask is a fair
 * one: a reader who knows these shows knows them by their sleeves long before
 * they know a wordmark, and the Listen room proved how much faster a shelf is
 * to read when the art is on it. So it is a choice rather than a replacement,
 * and the shelf keeps its geometry either way — same cell, same rank, same
 * tally, different face.
 *
 * ── Why a module and not component state ────────────────────────────────────
 *
 * The same reason `resource-view` gives: the margin draws THREE mutually
 * exclusive Resources panels and each mounts its own room. A `useState` here
 * would give a reader who chose covers one shelf of covers and two of marks,
 * and would forget the choice on the next chapter turn. What a reader chose is
 * a fact about the app, not about a mount.
 *
 * ── The first read races the first press, and the press wins ────────────────
 *
 * `settings.get()` is an async round trip and the toggle is one press inside a
 * panel the reader can already see. So a choice made by hand latches `chosen`
 * and the settled read is dropped rather than applied on top of it — the same
 * rule, for the same hazard, as the view store beside this one.
 */
import type { ShelfFace } from "./api.js";
import { safeCall } from "./utils/safeCall.js";

/** What ships. The register's own face: the publisher, not their catalogue. */
const DEFAULT_FACE: ShelfFace = "mark";

let face: ShelfFace = DEFAULT_FACE;
let asked = false;
let chosen = false;
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of [...watchers]) watcher();
}

function load(): void {
  if (asked) return;
  asked = true;
  void safeCall(() => window.api.settings.get()).then((result) => {
    if (!result.ok || chosen) return;
    const stored = result.value.shelfFace;
    if (stored !== "mark" && stored !== "cover") return;
    if (stored === face) return;
    face = stored;
    announce();
  });
}

export function readShelfFace(): ShelfFace {
  return face;
}

export function subscribeShelfFace(watcher: () => void): () => void {
  watchers.add(watcher);
  load();
  return () => { watchers.delete(watcher); };
}

/** The reader's own press. Latches over any read still in flight, and is kept. */
export function setShelfFace(next: ShelfFace): void {
  chosen = true;
  asked = true;
  if (next === face) return;
  face = next;
  announce();
  void safeCall(() => window.api.settings.set({ shelfFace: next }));
}
