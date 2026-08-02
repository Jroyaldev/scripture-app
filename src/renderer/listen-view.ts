/**
 * WHERE THE READER WAS IN THE LISTEN ROOM, and which way each show runs.
 *
 * ── Why any of this is outside the component ────────────────────────────────
 *
 * `<ListenPage />` is mounted conditionally — `{view === "listen" && …}` — so
 * the whole room unmounts the moment a reader looks at scripture. With the open
 * record in `useState`, that meant: four hundred rows into BEMA, glance at the
 * passage being discussed, come back to the top of the shelf with the skeleton
 * flashing and both catalogue IPCs running again. The room was rebuilt from
 * nothing every time, and the reader's place in it was not a thing the app
 * believed in.
 *
 * WHERE YOU WERE is a fact about the app, not about a mount. So it lives here,
 * in the same shape `shelf-face` and `resource-view` already use: a module
 * store, subscribed through `useSyncExternalStore`.
 *
 * ── Two kinds of memory, deliberately different ─────────────────────────────
 *
 * WHAT IS OPEN and WHERE THE SHELF WAS SCROLLED are session facts. They are
 * held here and never written to disk: a reader who quits and comes back should
 * arrive at the room, not four hundred rows into wherever they last were. The
 * app already has a resume for that, and it is a card they press.
 *
 * WHICH WAY A SHOW RUNS is a preference, and it persists. See
 * `listenSeriesOrder` in the settings schema for why a curriculum is not a feed.
 *
 * ── The first read races the first press, and the press wins ────────────────
 *
 * Same rule as the two stores beside this, for the same hazard: `settings.get()`
 * is an async round trip and the toggle is one press on a page the reader is
 * already looking at. A choice made by hand latches and the settled read is
 * dropped rather than applied on top of it.
 */
import { safeCall } from "./utils/safeCall.js";

export type SeriesOrder = "newest" | "oldest";

interface RoomState {
  /** Exactly one of these is set, or none of them — the shelf. */
  openAlbum: string | null;
  openSeries: string | null;
  openPlaylist: string | null;
  /** Where the SHELF was left, so going back does not lose it. */
  shelfScroll: number;
  /** What is typed into the filter on the open record. Cleared on leaving it. */
  query: string;
  /**
   * WHY A COUNTER IS IN THE SNAPSHOT.
   *
   * The order map is read by id — `readSeriesOrder(sourceId)` — rather than
   * being handed to the page whole, because a page only ever cares about the
   * one show it is drawing. But `useSyncExternalStore` decides whether to
   * re-render by comparing snapshot IDENTITY, so announcing an order change
   * while returning the same `room` object made React correctly conclude that
   * nothing had happened: the toggle wrote to settings, the map updated, and
   * the page kept drawing the old direction.
   *
   * So the room carries a number that moves whenever the order does. It is
   * never read for its value.
   */
  orderNonce: number;
}

let room: RoomState = {
  openAlbum: null, openSeries: null, openPlaylist: null,
  shelfScroll: 0, query: "", orderNonce: 0,
};
let order: Record<string, "oldest"> = {};
let asked = false;
const chosen = new Set<string>();
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of [...watchers]) watcher();
}

function load(): void {
  if (asked) return;
  asked = true;
  void safeCall(() => window.api.settings.get()).then((result) => {
    if (!result.ok) return;
    const stored = result.value.listenSeriesOrder ?? {};
    let changed = false;
    for (const [id, value] of Object.entries(stored)) {
      /* A show the reader has already turned by hand this session keeps their
         choice; the rest adopt what was on disk. */
      if (value !== "oldest" || chosen.has(id) || order[id] === "oldest") continue;
      order[id] = "oldest";
      changed = true;
    }
    if (!changed) return;
    room = { ...room, orderNonce: room.orderNonce + 1 };
    announce();
  });
}

export function readListenRoom(): RoomState {
  return room;
}

export function subscribeListenRoom(watcher: () => void): () => void {
  watchers.add(watcher);
  load();
  return () => { watchers.delete(watcher); };
}

/** Open a record, or pass nothing to return to the shelf. */
export function openListenRecord(next: {
  album?: string | null; series?: string | null; playlist?: string | null;
}): void {
  const openAlbum = next.album ?? null;
  const openSeries = next.series ?? null;
  const openPlaylist = next.playlist ?? null;
  if (room.openAlbum === openAlbum
    && room.openSeries === openSeries
    && room.openPlaylist === openPlaylist) return;
  /* The filter belongs to the record it was typed on. Carrying "psalm 40" into
     the next record would hide almost all of it, with the reason four hundred
     pixels above the fold. */
  room = { ...room, openAlbum, openSeries, openPlaylist, query: "" };
  announce();
}

/** Open one of the reader's own lists. */
export function openListenPlaylist(id: string | null): void {
  openListenRecord({ playlist: id });
}

/** Remember where the shelf was, so returning to it is returning. */
export function keepShelfScroll(top: number): void {
  room = { ...room, shelfScroll: Math.max(0, Math.round(top)) };
}

export function setListenQuery(query: string): void {
  if (room.query === query) return;
  room = { ...room, query };
  announce();
}

export function readSeriesOrder(sourceId: string): SeriesOrder {
  return order[sourceId] === "oldest" ? "oldest" : "newest";
}

export function setSeriesOrder(sourceId: string, next: SeriesOrder): void {
  chosen.add(sourceId);
  asked = true;
  if (readSeriesOrder(sourceId) === next) return;
  /* Rebuilt rather than mutated so the write below carries the whole map — the
     settings key is replaced per write, not merged. */
  order = next === "oldest"
    ? { ...order, [sourceId]: "oldest" }
    : Object.fromEntries(Object.entries(order).filter(([id]) => id !== sourceId));
  room = { ...room, orderNonce: room.orderNonce + 1 };
  announce();
  void safeCall(() => window.api.settings.set({ listenSeriesOrder: order }));
}
