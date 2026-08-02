/**
 * PUT THIS ON A LIST — from a row, or from the dock.
 *
 * ── Why a context menu and not a button on the row ──────────────────────────
 *
 * Every track and episode row in the Listen room is a single `<button>`, and a
 * button inside a button is invalid HTML — the engine unnests it and the inner
 * control stops being reachable. The alternatives were to restructure every row
 * in the room around an actions column, or to use the gesture a desktop reader
 * already has for "what else can I do with this". The second costs nothing,
 * keeps a list of six hundred rows free of six hundred hover affordances, and
 * is what the app already does for workspace tabs and the study line.
 *
 * Nothing here is only reachable by right-click: a keyboard reader gets the
 * same menu from the same rows through the menu key, which is the event this
 * listens to alongside the pointer.
 *
 * ── It never plays ──────────────────────────────────────────────────────────
 *
 * A playlist is a way to FILL the queue, never a second way to start it. The
 * caller-list contract names three components that may call the play verbs, and
 * this is deliberately not one of them.
 */
import React, { useEffect, useRef, useState, useSyncExternalStore } from "react";

import { Popover } from "./Popover.js";
import {
  addToPlaylist,
  createPlaylist,
  readPlaylists,
  sameEntry,
  subscribePlaylists,
  type PlaylistEntry,
} from "../playlists.js";
import { useToast } from "./Toast.js";

/** Where a menu was asked for, and what it was asked about. */
export interface PlaylistAsk {
  rect: DOMRect;
  entry: PlaylistEntry;
  /** What to call it in the confirmation. The stored title, ordinarily. */
  label: string;
}

/**
 * The gesture, hung on any element. Returns props to spread on the row.
 *
 * `contextmenu` covers the pointer; `ContextMenu` (the menu key, and Shift+F10
 * on the keyboards without one) covers the reader who never uses a mouse.
 */
export function usePlaylistAsk(
  onAsk: (ask: PlaylistAsk) => void,
): (entry: PlaylistEntry, label: string) => {
  onContextMenu: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
} {
  return (entry, label) => ({
    onContextMenu: (event) => {
      event.preventDefault();
      onAsk({ rect: event.currentTarget.getBoundingClientRect(), entry, label });
    },
    onKeyDown: (event) => {
      if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
      event.preventDefault();
      onAsk({ rect: event.currentTarget.getBoundingClientRect(), entry, label });
    },
  });
}

export function AddToPlaylist({ ask, onClose }: {
  ask: PlaylistAsk | null;
  onClose: () => void;
}): React.JSX.Element | null {
  const lists = useSyncExternalStore(subscribePlaylists, readPlaylists);
  const [making, setMaking] = useState(false);
  const [name, setName] = useState("");
  const field = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  /* The menu is reused across asks, so the "new list" form has to be put away
     between them — otherwise the second right-click opens on a half-typed name
     from the first. */
  useEffect(() => {
    if (ask) { setMaking(false); setName(""); }
  }, [ask]);

  useEffect(() => { if (making) field.current?.focus(); }, [making]);

  if (!ask) return null;

  const put = (id: string, listName: string): void => {
    /* "Added" and "already in" are different facts and the reader is entitled
       to both — a menu that says "Added" when nothing happened teaches them to
       distrust it. */
    const added = addToPlaylist(id, ask.entry);
    showToast(added ? `Added to ${listName}` : `Already in ${listName}`);
    onClose();
  };

  const make = (): void => {
    const clean = name.trim();
    if (!clean) return;
    const id = createPlaylist(clean);
    put(id, clean);
  };

  return (
    <Popover
      anchorRect={ask.rect}
      ariaLabel={`Add ${ask.label} to a playlist`}
      className="playlist-menu"
      /* A READER MAY HAVE MORE LISTS THAN FIT. The panel is `overflow: hidden`
         and this list has no scroller of its own, so past roughly fifteen
         playlists the tail was simply cut off and unreachable — the newest
         lists first, since they sort last. A bounded height gives the panel
         something to scroll. */
      maxHeight={360}
      onClose={onClose}
      width={252}
    >
      {/* NOT `role="menu"`, which is what this was. That role promises two
          things this does not do: it declares every child a menu item, which is
          false the moment the "new playlist" field opens (an `input` is not a
          legal child of a menu), and it promises arrow-key roving that was
          never implemented. A wrong role is worse than none — it tells a
          screen-reader reader to expect behaviour that is not there. The
          buttons carry their own semantics, and the panel is already named by
          the popover's own label. */}
      <div className="playlist-menu-body">
        <p className="playlist-menu-head">Add to playlist</p>
        {lists.length === 0 && !making && (
          <p className="playlist-menu-none">No playlists yet.</p>
        )}
        {lists.map((list) => {
          /* Said before the press rather than after it, so the reader can see
             the list they wanted is already holding this. */
          const held = list.entries.some((entry) => sameEntry(entry, ask.entry));
          return (
            <button
              className="playlist-menu-item"
              data-held={held ? "" : undefined}
              key={list.id}
              onClick={() => put(list.id, list.name)}
              type="button"
            >
              <span className="playlist-menu-name">{list.name}</span>
              <span className="playlist-menu-count">{held ? "✓" : list.entries.length}</span>
            </button>
          );
        })}
        {making ? (
          <div className="playlist-menu-new">
            <input
              aria-label="Name for the new playlist"
              className="playlist-menu-input"
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); make(); }
                if (event.key === "Escape") { event.preventDefault(); setMaking(false); }
              }}
              placeholder="Playlist name"
              ref={field}
              value={name}
            />
            <button
              className="playlist-menu-make"
              disabled={name.trim().length === 0}
              onClick={make}
              type="button"
            >Create</button>
          </div>
        ) : (
          <button
            className="playlist-menu-item is-new"
            onClick={() => setMaking(true)}
            type="button"
          >New playlist…</button>
        )}
      </div>
    </Popover>
  );
}
