import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NoteSearchResult, ParsedNoteData, ScriptureSearchHitData } from "../api.js";
import { Button, ControlInput } from "./Controls.js";
import { useToast } from "./Toast.js";
import { safeCall } from "../utils/safeCall.js";

type WorkspaceMode = "notes" | "search";

/**
 * What the search found outside the scope it was told to look in. Zero notes
 * is a dead end; "zero here, twenty-seven in Scripture" is a next step.
 */
interface OutOfScope {
  count: number;
  first: ScriptureSearchHitData | null;
}

interface Props {
  mode: WorkspaceMode;
  onNavigate: (book: string, chapter: number) => void;
  onWrite: () => void;
  initialQuery?: string;
  initialNoteId?: string;
  intentNonce?: number;
}

interface WorkspaceReference {
  raw: string;
  bref: string;
}

interface WorkspaceNote {
  id: string;
  title: string;
  body: string;
  modified: string;
  tags: string[];
  references: WorkspaceReference[];
}

type SearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "ready"; results: NoteSearchResult[] }
  | { status: "error"; error: string };

function SearchIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.4 12.4 4.1 4.1" />
    </svg>
  );
}

function ArrowIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5.5 3.5 4.5 4.5-4.5 4.5M10 8H2.8" />
    </svg>
  );
}

function normalizeNote(note: ParsedNoteData): WorkspaceNote {
  return {
    id: note.frontmatter.id,
    title: note.frontmatter.title || "Untitled note",
    body: note.body,
    modified: note.frontmatter.modified,
    tags: note.frontmatter.tags ?? [],
    references: note.scriptureRefs,
  };
}

function cleanExcerpt(body: string, limit = 150): string {
  const cleaned = body
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "No note text yet.";
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trimEnd()}…` : cleaned;
}

function wordCount(body: string): number {
  const words = body.trim().match(/\S+/g);
  return words?.length ?? 0;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: parsed.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  }).format(parsed);
}

function HighlightText({ text, query }: { text: string; query: string }): React.JSX.Element {
  const needle = query.trim();
  if (needle.length < 2) return <>{text}</>;
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pieces = text.split(new RegExp(`(${escaped})`, "ig"));
  return (
    <>
      {pieces.map((piece, index) => (
        piece.toLocaleLowerCase() === needle.toLocaleLowerCase()
          ? <mark key={`${piece}-${index}`}>{piece}</mark>
          : <span key={`${piece}-${index}`}>{piece}</span>
      ))}
    </>
  );
}

function NoteBody({ body, query }: { body: string; query: string }): React.JSX.Element {
  const blocks = body.trim().split(/\n{2,}/).filter(Boolean);
  if (blocks.length === 0) {
    return <p className="note-detail-empty-body">This note does not have any body text yet.</p>;
  }

  return (
    <div className="note-detail-body">
      {blocks.map((block, blockIndex) => {
        const lines = block.split("\n");
        const heading = lines.length === 1 ? /^(#{1,3})\s+(.+)$/.exec(lines[0] ?? "") : null;
        if (heading) {
          const Heading = heading[1]?.length === 1 ? "h2" : "h3";
          return <Heading key={blockIndex}><HighlightText text={heading[2] ?? ""} query={query} /></Heading>;
        }
        if (lines.every((line) => /^\s*>/.test(line))) {
          const quote = lines.map((line) => line.replace(/^\s*>\s?/, "")).join(" ");
          return <blockquote key={blockIndex}><HighlightText text={quote} query={query} /></blockquote>;
        }
        if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
          return (
            <ul key={blockIndex}>
              {lines.map((line, lineIndex) => (
                <li key={lineIndex}>
                  <HighlightText text={line.replace(/^\s*[-*]\s+/, "")} query={query} />
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={blockIndex}>
            {lines.map((line, lineIndex) => (
              <span key={lineIndex}>
                {lineIndex > 0 && <br />}
                <HighlightText text={line} query={query} />
              </span>
            ))}
          </p>
        );
      })}
    </div>
  );
}

/**
 * No illustration. The system never draws a picture of an absence — it names
 * the thing and the reason, and offers the next step as a control.
 */
function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="note-workspace-empty">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </div>
  );
}

/** The one loading device: a 1px seal segment travelling a hairline. */
function Progress({ label }: { label: string }): React.JSX.Element {
  return (
    <div className="note-list-progress" role="status">
      <i className="search-progress-hairline" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function SearchView({
  mode,
  onNavigate,
  onWrite,
  initialQuery = "",
  initialNoteId,
  intentNonce = 0,
}: Props): React.JSX.Element {
  const { showToast } = useToast();
  const [notes, setNotes] = useState<WorkspaceNote[]>([]);
  const [loadStatus, setLoadStatus] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [loadNonce, setLoadNonce] = useState(0);
  const [query, setQuery] = useState(initialQuery);
  const [searchState, setSearchState] = useState<SearchState>({ status: "idle" });
  const [searchNonce, setSearchNonce] = useState(0);
  const [readingPackageId, setReadingPackageId] = useState<string | null>(null);
  const [bookNames, setBookNames] = useState<Record<string, string[]>>({});
  const [outOfScope, setOutOfScope] = useState<OutOfScope | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editDiscard, setEditDiscard] = useState<null | { kind: "close" } | { kind: "select"; id: string }>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const requestSeq = useRef(0);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === "search") setQuery(initialQuery);
    if (initialNoteId) setSelectedId(initialNoteId);
  }, [initialNoteId, initialQuery, intentNonce, mode]);

  // The edition the reader was last in. It is what makes the out-of-scope
  // count answerable without a prop the caller would have to remember.
  useEffect(() => {
    if (mode !== "search") return;
    void safeCall(() => window.api.settings.get()).then((result) => {
      if (result.ok) setReadingPackageId(result.value.lastRead?.packageId ?? null);
    });
    void safeCall(() => window.api.scripture.getBookNames()).then((result) => {
      if (result.ok) setBookNames(result.value);
    });
  }, [mode]);

  useEffect(() => {
    let cancelled = false;
    setLoadStatus("loading");
    setLoadError("");
    void safeCall(() => window.api.library.readAllNotes()).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setLoadStatus("error");
        setLoadError(result.error);
        return;
      }
      const ordered = result.value
        .map(normalizeNote)
        .sort((left, right) => right.modified.localeCompare(left.modified));
      setNotes(ordered);
      setLoadStatus("ready");
      setSelectedId((current) => {
        if (initialNoteId && ordered.some((note) => note.id === initialNoteId)) return initialNoteId;
        return current && ordered.some((note) => note.id === current)
          ? current
          : ordered[0]?.id ?? null;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [initialNoteId, loadNonce]);

  useEffect(() => {
    if (mode !== "search") return;
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      requestSeq.current += 1;
      setSearchState({ status: "idle" });
      setOutOfScope(null);
      setSelectedId(notes[0]?.id ?? null);
      return;
    }

    const seq = ++requestSeq.current;
    setSearchState({ status: "searching" });
    const timer = window.setTimeout(() => {
      const beyond = readingPackageId
        ? safeCall(() => window.api.scripture.search(readingPackageId, trimmed, 24))
        : Promise.resolve({ ok: false as const, error: "no edition" });
      void Promise.all([
        safeCall(() => window.api.library.search(trimmed)),
        beyond,
      ]).then(([result, scripture]) => {
        if (requestSeq.current !== seq) return;
        setOutOfScope(scripture.ok
          ? { count: scripture.value.length, first: scripture.value[0] ?? null }
          : null);
        if (!result.ok) {
          setSearchState({ status: "error", error: result.error });
          setSelectedId(null);
          return;
        }
        setSearchState({ status: "ready", results: result.value });
        setSelectedId((current) => result.value.some((item) => item.id === current)
          ? current
          : result.value[0]?.id ?? null);
      });
    }, 180);

    return () => window.clearTimeout(timer);
  }, [mode, notes, query, readingPackageId, searchNonce]);

  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const noteRows = useMemo(() => {
    if (!normalizedQuery) return notes;
    return notes.filter((note) => [note.title, note.body, ...note.tags]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedQuery));
  }, [normalizedQuery, notes]);

  const searchRows = useMemo(() => {
    if (searchState.status === "idle") return notes.slice(0, 8);
    if (searchState.status !== "ready") return [];
    return searchState.results.map((result) => noteById.get(result.id) ?? {
      id: result.id,
      title: result.title,
      body: result.body_text,
      modified: "",
      tags: [],
      references: [],
    });
  }, [noteById, notes, searchState]);

  const rows = mode === "notes" ? noteRows : searchRows;
  const selectedNote = selectedId ? rows.find((note) => note.id === selectedId) : undefined;
  const editDirty = editing && selectedNote != null
    && (editTitle !== selectedNote.title || editBody !== selectedNote.body);

  useEffect(() => {
    setEditing(false);
    setEditError(null);
    setDeleteArmed(false);
    setEditDiscard(null);
  }, [selectedId]);

  const requestSelect = (id: string): void => {
    if (id !== selectedId && editDirty) {
      setEditDiscard({ kind: "select", id });
      return;
    }
    setSelectedId(id);
  };

  const startEdit = useCallback(() => {
    if (!selectedNote) return;
    setEditTitle(selectedNote.title);
    setEditBody(selectedNote.body);
    setEditError(null);
    setDeleteArmed(false);
    setEditing(true);
  }, [selectedNote]);

  const cancelEdit = useCallback(() => {
    if (editBusy) return;
    if (editDirty) {
      if (editDiscard) {
        setEditDiscard(null);
        return;
      }
      setEditDiscard({ kind: "close" });
      return;
    }
    setEditing(false);
    setEditError(null);
  }, [editBusy, editDirty, editDiscard]);

  const confirmDiscardEdit = useCallback(() => {
    const target = editDiscard;
    setEditDiscard(null);
    setEditing(false);
    setEditError(null);
    if (target?.kind === "select") setSelectedId(target.id);
  }, [editDiscard]);

  const saveEdit = useCallback(async () => {
    if (!selectedNote || editBusy) return;
    const title = editTitle.trim();
    if (!title) {
      setEditError("Give the note a title before saving.");
      return;
    }
    setEditBusy(true);
    setEditError(null);
    const result = await safeCall(() => window.api.library.updateNote(selectedNote.id, title, editBody));
    setEditBusy(false);
    if (!result.ok || !result.value.ok) {
      setEditError(result.ok ? (result.value.error ?? "The note could not be saved.") : result.error);
      return;
    }
    setEditing(false);
    setEditDiscard(null);
    setLoadNonce((value) => value + 1);
    showToast("Note saved.");
  }, [editBody, editBusy, editTitle, selectedNote, showToast]);

  const deleteNote = useCallback(async () => {
    if (!selectedNote || deleteBusy) return;
    setDeleteBusy(true);
    const result = await safeCall(() => window.api.library.deleteNote(selectedNote.id));
    setDeleteBusy(false);
    setDeleteArmed(false);
    if (!result.ok || !result.value.ok) {
      showToast(
        result.ok ? (result.value.error ?? "The note could not be deleted.") : result.error,
        undefined,
        undefined,
        { tone: "error" },
      );
      return;
    }
    const { filename, content } = result.value;
    setLoadNonce((value) => value + 1);
    if (filename && content != null) {
      showToast("Note deleted.", "Undo", () => {
        void safeCall(() => window.api.library.restoreNote(filename, content)).then((restore) => {
          if (restore.ok && restore.value.ok) {
            setLoadNonce((value) => value + 1);
          } else {
            showToast("The note could not be restored.", undefined, undefined, { tone: "error" });
          }
        });
      });
    }
  }, [deleteBusy, selectedNote, showToast]);

  useEffect(() => {
    if (mode !== "notes" || loadStatus !== "ready") return;
    setSelectedId((current) => current && rows.some((note) => note.id === current)
      ? current
      : rows[0]?.id ?? null);
  }, [loadStatus, mode, rows]);

  // A ratio, beside the field rather than inside it. A bare number sitting in
  // the input with pointer events off looked like something you could edit.
  const resultCount = mode === "notes"
    ? normalizedQuery
      ? `${rows.length} of ${notes.length} notes`
      : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`
    : searchState.status === "ready"
      ? `${searchState.results.length} of ${notes.length} notes`
      : searchState.status === "searching"
        ? "Searching your notes"
        : `${notes.length} ${notes.length === 1 ? "note" : "notes"}`;

  const scriptureHit = outOfScope?.first ?? null;
  const outOfScopeLabel = mode === "search" && outOfScope && outOfScope.count > 0
    ? `${outOfScope.count} in Scripture`
    : "";

  const handleReference = useCallback(async (reference: WorkspaceReference) => {
    const result = await safeCall(() => window.api.ref.parseBref(reference.bref));
    if (!result.ok || !result.value.ok || !result.value.bref) {
      showToast("This Scripture reference could not be opened.", undefined, undefined, { tone: "error" });
      return;
    }
    const [book = "", chapterText = ""] = result.value.bref.replace("bref:v1/", "").split(".");
    const chapter = Number(chapterText);
    if (!book || !Number.isFinite(chapter)) {
      showToast("This Scripture reference could not be opened.", undefined, undefined, { tone: "error" });
      return;
    }
    onNavigate(book, chapter);
  }, [onNavigate, showToast]);

  const moveRowFocus = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let target: number | null = null;
    if (event.key === "ArrowDown") target = Math.min(rows.length - 1, index + 1);
    if (event.key === "ArrowUp") target = Math.max(0, index - 1);
    if (event.key === "Home") target = 0;
    if (event.key === "End") target = rows.length - 1;
    if (target == null || target === index) return;
    event.preventDefault();
    const next = rows[target];
    if (!next) return;
    requestSelect(next.id);
    if (editDirty) return;
    rowRefs.current[target]?.focus();
  };

  const clearQuery = (): void => {
    setQuery("");
    searchInputRef.current?.focus();
  };

  const showListError = loadStatus === "error";
  const showSearchError = mode === "search" && searchState.status === "error";
  const showSearchEmpty = mode === "search"
    && searchState.status === "ready"
    && searchState.results.length === 0;
  const showNotesEmpty = mode === "notes" && loadStatus === "ready" && rows.length === 0;

  return (
    <section className={`note-workspace note-workspace--${mode}`} aria-labelledby={`${mode}-workspace-title`}>
      <header className="note-workspace-hero">
        <div>
          <span className="workspace-kicker">{mode === "notes" ? "Your own work" : "Search your notes"}</span>
          <h1 id={`${mode}-workspace-title`}>{mode === "notes" ? "My notes" : "Search"}</h1>
          <p>
            {mode === "notes"
              ? "Read the thinking you have already done, then return to its Scripture context."
              : "Find a phrase, question, or theme across your notes."}
          </p>
        </div>
        <Button variant="secondary" onClick={onWrite} disabled={editing}>New note</Button>
      </header>

      <div className="note-workspace-query">
        <div className="note-workspace-field">
          <span className="note-workspace-field-icon"><SearchIcon /></span>
          <ControlInput
            ref={searchInputRef}
            type="search"
            aria-label={mode === "notes" ? "Filter notes" : "Search note content"}
            placeholder={mode === "notes" ? "Filter titles, text, or tags" : "Search every note"}
            value={query}
            disabled={editing}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && query) {
                event.preventDefault();
                clearQuery();
              }
            }}
            autoFocus={mode === "search"}
          />
          {/* Space for the clear control exists at rest, so revealing it
              never moves the field's text. */}
          <button
            type="button"
            className="note-workspace-field-clear"
            onClick={clearQuery}
            aria-label="Clear search"
            aria-hidden={query ? undefined : true}
            tabIndex={query ? 0 : -1}
            data-shown={query ? "true" : "false"}
          >
            ×
          </button>
        </div>
        <p className="note-workspace-count" role="status">
          <span>{resultCount}</span>
          {outOfScopeLabel && <span className="note-workspace-count-beyond">{outOfScopeLabel}</span>}
        </p>
      </div>

      <div className="note-workspace-grid">
        <aside className="note-workspace-list" aria-label={mode === "notes" ? "My notes list" : "Search results"}>
          <div className="note-list-heading">
            <span>{mode === "search" && searchState.status === "idle" ? "Recently modified" : mode === "search" ? "Matches" : "My notes"}</span>
            <span>{rows.length}</span>
          </div>

          {loadStatus === "loading" && <Progress label="Opening your notebook" />}
          {showListError && (
            <EmptyState
              title="Notes could not be opened"
              body={loadError}
              action={<Button size="sm" onClick={() => setLoadNonce((value) => value + 1)}>Try again</Button>}
            />
          )}
          {searchState.status === "searching" && mode === "search" && (
            <Progress label="Searching note text on this device" />
          )}
          {showSearchError && (
            <EmptyState
              title="Search is unavailable"
              body={searchState.error}
              action={<Button size="sm" onClick={() => setSearchNonce((value) => value + 1)}>Try again</Button>}
            />
          )}
          {showSearchEmpty && (
            <EmptyState
              title="No matching notes"
              body={outOfScope && outOfScope.count > 0
                ? `Nothing in your ${notes.length} notes matches “${query.trim()}”, but Scripture has ${outOfScope.count}.`
                : `Nothing in your ${notes.length} notes matches “${query.trim()}”.`}
              action={scriptureHit ? (
                <Button size="sm" onClick={() => onNavigate(scriptureHit.book, scriptureHit.chapter)}>
                  {`Open ${bookNames[scriptureHit.book]?.[0] ?? scriptureHit.book} ${scriptureHit.chapter}:${scriptureHit.verse}`}
                </Button>
              ) : <Button size="sm" variant="ghost" onClick={clearQuery}>Clear search</Button>}
            />
          )}
          {showNotesEmpty && (
            <EmptyState
              title={notes.length === 0 ? "Ready for your first note" : "No notes match this filter"}
              body={notes.length === 0
                ? "Begin with an observation, question, or passage you want to remember."
                : "Try a different title, phrase, or tag."}
              action={notes.length === 0
                ? <Button size="sm" onClick={onWrite}>Write your first note</Button>
                : <Button size="sm" variant="ghost" onClick={clearQuery}>Clear filter</Button>}
            />
          )}

          {loadStatus === "ready" && !showSearchError && !showSearchEmpty && !showNotesEmpty && searchState.status !== "searching" && (
            <div className="note-list-rows">
              {rows.map((note, index) => {
                const selected = note.id === selectedId;
                return (
                  <button
                    key={note.id}
                    ref={(node) => { rowRefs.current[index] = node; }}
                    type="button"
                    className={`note-row${selected ? " selected" : ""}`}
                    data-note-id={note.id}
                    aria-current={selected ? "true" : undefined}
                    onClick={() => requestSelect(note.id)}
                    onKeyDown={(event) => moveRowFocus(event, index)}
                  >
                    <span className="note-row-topline">
                      <strong><HighlightText text={note.title} query={query} /></strong>
                      <time dateTime={note.modified}>{formatDate(note.modified)}</time>
                    </span>
                    <span className="note-row-excerpt"><HighlightText text={cleanExcerpt(note.body)} query={query} /></span>
                    <span className="note-row-meta">
                      {note.tags.slice(0, 2).map((tag) => <span key={tag}>#{tag}</span>)}
                      {note.references.length > 0 && <span>{note.references.length} {note.references.length === 1 ? "passage" : "passages"}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <article className="note-detail" aria-live="polite">
          {selectedNote ? (
            editing ? (
              <div
                className="note-edit"
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "s") {
                    event.preventDefault();
                    void saveEdit();
                  } else if (event.key === "Escape" && !editBusy) {
                    event.preventDefault();
                    cancelEdit();
                  }
                }}
              >
                <header className="note-detail-header">
                  <div className="note-detail-eyebrow">
                    <span>Editing note</span>
                    <time dateTime={selectedNote.modified}>Updated {formatDate(selectedNote.modified)}</time>
                  </div>
                  <label className="note-edit-field">
                    <span className="note-edit-label">Title</span>
                    <input
                      className="note-title-input control-input"
                      value={editTitle}
                      onChange={(event) => setEditTitle(event.target.value)}
                      disabled={editBusy}
                      autoFocus
                      spellCheck
                    />
                  </label>
                  <label className="note-edit-field note-edit-field--body">
                    <span className="note-edit-label">Note</span>
                    <textarea
                      className="note-body-editor control-input"
                      value={editBody}
                      onChange={(event) => setEditBody(event.target.value)}
                      disabled={editBusy}
                      rows={14}
                      spellCheck
                    />
                  </label>
                </header>
                {editError && <p className="note-edit-error" role="alert">{editError}</p>}
                {editDiscard && (
                  <div className="note-edit-discard" role="alert">
                    <span>Discard your changes to this note? What you edited will be lost.</span>
                    <span className="note-edit-buttons">
                      <Button variant="ghost" size="sm" onClick={() => setEditDiscard(null)}>Keep editing</Button>
                      <Button size="sm" onClick={confirmDiscardEdit}>Discard changes</Button>
                    </span>
                  </div>
                )}
                <footer className="note-detail-footer note-edit-actions">
                  <span className="note-edit-hint">Plain Markdown · saved to this library</span>
                  <span className="note-edit-buttons">
                    <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={editBusy}>Cancel</Button>
                    <Button size="sm" busy={editBusy} onClick={() => void saveEdit()}>Save changes</Button>
                  </span>
                </footer>
              </div>
            ) : (
            <>
              <header className="note-detail-header">
                <div className="note-detail-eyebrow">
                  <span>Note</span>
                  <time dateTime={selectedNote.modified}>Updated {formatDate(selectedNote.modified)}</time>
                  <span className="note-detail-actions">
                    <button type="button" className="note-detail-action" onClick={startEdit}>Edit</button>
                    {deleteArmed ? (
                      <>
                        <button
                          type="button"
                          className="note-detail-action note-detail-action--danger"
                          onClick={() => void deleteNote()}
                          disabled={deleteBusy}
                        >
                          {deleteBusy ? "Deleting…" : "Delete permanently"}
                        </button>
                        <button
                          type="button"
                          className="note-detail-action"
                          onClick={() => setDeleteArmed(false)}
                          disabled={deleteBusy}
                        >
                          Keep note
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="note-detail-action note-detail-action--danger"
                        onClick={() => setDeleteArmed(true)}
                      >
                        Delete…
                      </button>
                    )}
                  </span>
                </div>
                <h2><HighlightText text={selectedNote.title} query={query} /></h2>
                {selectedNote.tags.length > 0 && (
                  <div className="note-detail-tags" aria-label="Tags">
                    {selectedNote.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                )}
              </header>

              {selectedNote.references.length > 0 && (
                <section className="note-detail-references" aria-labelledby="note-passages-title">
                  <h3 id="note-passages-title">Scripture in this note</h3>
                  <div>
                    {selectedNote.references.map((reference, index) => (
                      <button
                        key={`${reference.bref}-${index}`}
                        type="button"
                        className="note-reference"
                        onClick={() => void handleReference(reference)}
                      >
                        <span>{reference.raw}</span>
                        <ArrowIcon />
                      </button>
                    ))}
                  </div>
                </section>
              )}

              <NoteBody body={selectedNote.body} query={query} />
              <footer className="note-detail-footer">
                <span>Plain Markdown</span>
                <span>{wordCount(selectedNote.body)} words</span>
                <span>Stored in this library</span>
              </footer>
            </>
            )
          ) : (
            <EmptyState
              title={mode === "search" && query.trim().length < 2 ? "Search your own thinking" : "Choose a note"}
              body={mode === "search" && query.trim().length < 2
                ? "Enter a phrase above, or open one of your recently modified notes."
                : "Select a note from the list to read it here."}
            />
          )}
        </article>
      </div>
    </section>
  );
}
