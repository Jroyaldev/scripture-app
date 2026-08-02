/**
 * THE READER'S OWN LISTS.
 *
 * Every other shelf in the Listen room is somebody else's arrangement: a
 * publisher's album, a feed's chronology. This is the one shelf the reader
 * builds — a psalm, a sermon and a hymn on the same list because they are about
 * the same thing, which is exactly the arrangement a scripture library wants
 * and the one no publisher can supply.
 *
 * ── A playlist is not a fourth machine ──────────────────────────────────────
 *
 * There is one advancing machine for records (the queue) and one for passages
 * (the walk), and the note beside them says why they must not merge: both
 * answer "what plays next", and two answers is how a listener lands somewhere
 * neither of them chose. A playlist adds a third ANSWER only if it advances
 * itself. It does not. It resolves to episodes and hands them to the queue,
 * which is why nothing in this file plays anything.
 *
 * ── Why a module and not component state ────────────────────────────────────
 *
 * The same reason `listen-view` gives beside it: the room unmounts whenever a
 * reader looks at scripture, and lists are not a fact about a mount. They are
 * also written from two surfaces — the room's rows and the dock's mast — and a
 * dock that could not see a list made from the room would offer to add a track
 * to a playlist that no longer existed.
 *
 * ── Writes are whole ────────────────────────────────────────────────────────
 *
 * `settings:set` replaces a key rather than merging into it, so every mutation
 * here sends the entire array. That is the shape the store wants and it costs
 * nothing: two hundred lists of identities is a few kilobytes.
 */
import { safeCall } from "./utils/safeCall.js";
import type { AppSettings } from "./api.js";

export type Playlist = AppSettings["playlists"][number];
export type PlaylistEntry = Playlist["entries"][number];

let lists: Playlist[] = [];
let asked = false;
/** Set by the reader's first edit, so a settled read cannot undo it. */
let touched = false;
const watchers = new Set<() => void>();

function announce(): void {
  for (const watcher of [...watchers]) watcher();
}

function load(): void {
  if (asked) return;
  asked = true;
  void safeCall(() => window.api.settings.get()).then((result) => {
    if (!result.ok || touched) return;
    const stored = result.value.playlists;
    if (!Array.isArray(stored) || stored.length === 0) return;
    lists = stored;
    announce();
  });
}

function keep(next: Playlist[]): void {
  touched = true;
  asked = true;
  lists = next;
  announce();
  void safeCall(() => window.api.settings.set({ playlists: next }));
}

export function readPlaylists(): Playlist[] {
  return lists;
}

export function subscribePlaylists(watcher: () => void): () => void {
  watchers.add(watcher);
  load();
  return () => { watchers.delete(watcher); };
}

/**
 * A new list. Returns its id so the caller can open it, or add to it in the
 * same gesture that made it.
 *
 * `crypto.randomUUID` rather than the name, because a list can be renamed and
 * every reference to it would have to be rewritten — and two lists called
 * "Advent" is a thing a reader is entitled to.
 */
export function createPlaylist(name: string, seed?: Playlist["seed"]): string {
  const id = crypto.randomUUID();
  keep([...lists, {
    id,
    name: name.trim() || "Untitled",
    createdAt: Date.now(),
    ...(seed ? { seed } : {}),
    entries: [],
  }]);
  return id;
}

export function renamePlaylist(id: string, name: string): void {
  const clean = name.trim();
  if (!clean) return;
  keep(lists.map((one) => (one.id === id ? { ...one, name: clean } : one)));
}

export function deletePlaylist(id: string): Playlist | null {
  const going = lists.find((one) => one.id === id) ?? null;
  if (going) keep(lists.filter((one) => one.id !== id));
  return going;
}

/** Put a deleted list back, in its place. Undo, from the toast. */
export function restorePlaylist(list: Playlist, at: number): void {
  const next = lists.filter((one) => one.id !== list.id);
  next.splice(Math.min(Math.max(at, 0), next.length), 0, list);
  keep(next);
}

export function playlistIndex(id: string): number {
  return lists.findIndex((one) => one.id === id);
}

/** True when the two name the same recording. Music has no id of its own. */
export function sameEntry(a: PlaylistEntry, b: PlaylistEntry): boolean {
  if (a.kind !== b.kind || a.sourceId !== b.sourceId) return false;
  return a.kind === "music" && b.kind === "music"
    ? a.album === b.album && a.title === b.title
    : (a as { recordId: string }).recordId === (b as { recordId: string }).recordId;
}

/**
 * Add, unless it is already there.
 *
 * A playlist that quietly accepts the same track twice is a playlist a reader
 * has to audit. Returns whether anything changed, so the surface can say "added"
 * or "already in" rather than claiming both.
 */
export function addToPlaylist(id: string, entry: PlaylistEntry): boolean {
  const list = lists.find((one) => one.id === id);
  if (!list) return false;
  if (list.entries.some((held) => sameEntry(held, entry))) return false;
  keep(lists.map((one) => (
    one.id === id ? { ...one, entries: [...one.entries, entry] } : one
  )));
  return true;
}

/**
 * Take one entry off, and hand it back.
 *
 * IT RETURNS THE ROW BECAUSE REMOVING HAD NO UNDO while deleting a whole list
 * did. The gesture that costs least — one `×` on one row, in a column where the
 * two buttons beside it only reorder — was the one gesture in the room that
 * could not be taken back, while the gesture that costs a reader an evening's
 * work offered a toast. That is the wrong way round.
 *
 * An index alone cannot restore anything: by the time the reader reaches for
 * Undo the array has closed over the gap, and the caller would be guessing at
 * what used to sit there. So the store hands the entry back.
 */
export function removeFromPlaylist(id: string, at: number): PlaylistEntry | null {
  const list = lists.find((one) => one.id === id);
  const going = list?.entries[at] ?? null;
  if (!going) return null;
  keep(lists.map((one) => (
    one.id === id ? { ...one, entries: one.entries.filter((_, index) => index !== at) } : one
  )));
  return going;
}

/**
 * Put a removed entry back, in its place. Undo, from the toast.
 *
 * Deliberately the same shape as `restorePlaylist` above — clamp, splice, write
 * whole — because it is the row-level twin of that function, and two undos that
 * behave differently are two undos a reader has to learn.
 *
 * The dedupe check is not decoration. An Undo is live for five seconds, which is
 * long enough for a reader to remove a track, think better of it, and add it
 * back from the album page by hand; pressing Undo afterwards would leave two of
 * it on a list whose whole promise is that it never quietly doubles a track. If
 * the entry is already home, the undo is a no-op.
 */
export function insertPlaylistEntry(id: string, entry: PlaylistEntry, at: number): void {
  keep(lists.map((one) => {
    if (one.id !== id) return one;
    if (one.entries.some((held) => sameEntry(held, entry))) return one;
    const entries = [...one.entries];
    entries.splice(Math.min(Math.max(at, 0), entries.length), 0, entry);
    return { ...one, entries };
  }));
}

/** Move one entry by one place. The whole of reordering, deliberately — see
 *  the room for why there is no drag here. */
export function movePlaylistEntry(id: string, at: number, by: 1 | -1): void {
  keep(lists.map((one) => {
    if (one.id !== id) return one;
    const to = at + by;
    if (to < 0 || to >= one.entries.length) return one;
    const entries = [...one.entries];
    [entries[at], entries[to]] = [entries[to]!, entries[at]!];
    return { ...one, entries };
  }));
}
