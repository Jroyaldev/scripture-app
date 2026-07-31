/**
 * CARDS OR LIST — one setting, one module, every Resources room in the window.
 *
 * ── Why this is not state inside the component · 2026-07-31 ─────────────────
 *
 * The margin draws THREE mutually exclusive panels (chapter, reading,
 * selected), and each of them mounts its own `Resources`. A `useState` in the
 * component would give a reader who chose the list one list and two card rooms
 * — and would give it back as cards the moment they changed passage. What the
 * reader chose is a fact about the app, not about a mount, so it lives on the
 * module and every mount subscribes to it.
 *
 * ── Why SETTINGS and not the study workspace ────────────────────────────────
 *
 * The study workspace is a revisioned document about the reader's WORK — what
 * they have open, in which tab, against which passage — and it is guarded by a
 * validator that this build does not touch. This is a comfort preference of
 * exactly the kind `readingSize` and `verseNumbers` already are: a reader who
 * wants more per screen wants it on every chapter and on every launch. So it
 * takes `settings`, the same round trip those two take, and the main process
 * normalises it (see `normalizeResourceView` in electron/main).
 *
 * ── The first read races the first press, and the press wins ────────────────
 *
 * `settings.get()` is an async IPC round trip. A reader can reach the toggle
 * before it lands — the room is drawn from local manifests and the toggle is
 * one press away from the tab. So a choice made by hand latches `chosen`, and
 * the settled read is dropped rather than applied on top of it. This is the
 * same rule `userDirtySettings` states in app.tsx, kept here because the
 * hazard is the same and a second copy of the rule would be a second answer.
 */
import type { ResourceView } from "./api.js";
import { safeCall } from "./utils/safeCall.js";

/** What ships, and what an unreadable or unknown stored value becomes. */
const DEFAULT_VIEW: ResourceView = "cards";

let view: ResourceView = DEFAULT_VIEW;
/** Whether the settled read has been asked for. One round trip per window. */
let asked = false;
/** Whether the reader has chosen by hand. Their choice outranks a late read. */
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
    const stored = result.value.resourceView;
    if (stored !== "cards" && stored !== "list") return;
    if (stored === view) return;
    view = stored;
    announce();
  });
}

export function readResourceView(): ResourceView {
  return view;
}

export function subscribeResourceView(watcher: () => void): () => void {
  watchers.add(watcher);
  load();
  return () => { watchers.delete(watcher); };
}

/** The reader's own press. Latches over any read still in flight, and is kept. */
export function setResourceView(next: ResourceView): void {
  chosen = true;
  asked = true;
  if (next === view) return;
  view = next;
  announce();
  void safeCall(() => window.api.settings.set({ resourceView: next }));
}
