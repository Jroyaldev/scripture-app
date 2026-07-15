import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  BackboneData,
  BookNameData,
  LanguageNameEntity,
  NoteSearchResult,
  ScriptureSearchHitData,
} from "../api.js";
import { isDarkTheme, type AppTheme } from "../theme.js";
import { parsePassage } from "../utils/parsePassage.js";
import { formatRecentLabel, normalizeRecents, type RecentPassage } from "../utils/recentPassages.js";
import { safeCall } from "../utils/safeCall.js";

export type CommandPaletteTab = "intelligence" | "scripture" | "notes" | "names";

export interface CommandReadingContext {
  book: string;
  chapter: number;
  packageId: string;
  verseStart?: number;
  verseEnd?: number;
}

export interface CommandPaletteAction {
  id: string;
  title: string;
  detail: string;
  keywords: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  theme: AppTheme;
  backbone: BackboneData;
  bookNames: BookNameData;
  context: CommandReadingContext;
  actions: CommandPaletteAction[];
  onNavigate: (book: string, chapter: number, verse?: number, endVerse?: number) => void;
  onOpenNote: (noteId: string) => void;
  onSearchNotes: (query: string) => void;
  onRunAction: (id: string) => void;
}

type PaletteResult = {
  id: string;
  kind: "scripture" | "note" | "person" | "place" | "action" | "recent" | "deep-search";
  title: string;
  detail: string;
  meta: string;
  activate: () => void;
};

type SearchData = {
  scripture: ScriptureSearchHitData[];
  notes: NoteSearchResult[];
  entities: Array<{ entity: LanguageNameEntity; match: "name" | "description"; score: number }>;
  exact: PaletteResult | null;
};

const TABS: Array<{ id: CommandPaletteTab; label: string }> = [
  { id: "intelligence", label: "Intelligence" },
  { id: "scripture", label: "Scripture" },
  { id: "notes", label: "Notes" },
  { id: "names", label: "Names" },
];

function SearchGlyph(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.4 12.4 4.1 4.1" />
    </svg>
  );
}

function ResultGlyph({ kind }: { kind: PaletteResult["kind"] }): React.JSX.Element {
  if (kind === "scripture" || kind === "recent") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M3.2 4.3c2.3-.8 4.5-.6 6.8.6v10.4c-2.3-1.2-4.5-1.4-6.8-.6zM16.8 4.3c-2.3-.8-4.5-.6-6.8.6v10.4c2.3-1.2 4.5-1.4 6.8-.6z" />
      </svg>
    );
  }
  if (kind === "note" || kind === "deep-search") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M4.5 3.5h8.3l2.7 2.8v10.2h-11zM12.5 3.8v3h2.7M7 10h6M7 13h4.5" />
      </svg>
    );
  }
  if (kind === "person") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="6.2" r="2.6" /><path d="M4.8 16c.6-3.1 2.3-4.8 5.2-4.8s4.6 1.7 5.2 4.8" />
      </svg>
    );
  }
  if (kind === "place") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 17s5-5.3 5-9a5 5 0 0 0-10 0c0 3.7 5 9 5 9z" /><circle cx="10" cy="8" r="1.6" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M4 10h11M11 6l4 4-4 4" />
    </svg>
  );
}

function cleanExcerpt(value: string, limit = 128): string {
  const cleaned = value
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s?/gm, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > limit ? `${cleaned.slice(0, limit).trimEnd()}…` : cleaned;
}

function displayEntityName(value: string): string {
  return value.replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\s+/g, " ").trim();
}

function displayBook(bookNames: BookNameData, book: string): string {
  return bookNames[book]?.[0] ?? book;
}

function parseEntityRef(value: string | undefined): { book: string; chapter: number; verse: number } | null {
  const match = /^([1-3A-Z]{3})\.(\d+)\.(\d+)$/.exec(value ?? "");
  if (!match) return null;
  return { book: match[1]!, chapter: Number(match[2]), verse: Number(match[3]) };
}

function bestEntityRef(entity: LanguageNameEntity, context: CommandReadingContext) {
  const refs = entity.refs.map(parseEntityRef).filter((ref): ref is NonNullable<ReturnType<typeof parseEntityRef>> => ref != null);
  return refs.find((ref) => ref.book === context.book && ref.chapter === context.chapter)
    ?? refs.find((ref) => ref.book === context.book)
    ?? parseEntityRef(entity.firstRef)
    ?? refs[0]
    ?? null;
}

function matchesAction(action: CommandPaletteAction, query: string): boolean {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${action.title} ${action.detail} ${action.keywords.join(" ")}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

export function CommandPalette({
  open,
  onClose,
  theme,
  backbone,
  bookNames,
  context,
  actions,
  onNavigate,
  onOpenNote,
  onSearchNotes,
  onRunAction,
}: Props): React.JSX.Element | null {
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<CommandPaletteTab>("intelligence");
  const [status, setStatus] = useState<"idle" | "searching" | "ready" | "error">("idle");
  const [data, setData] = useState<SearchData>({ scripture: [], notes: [], entities: [], exact: null });
  const [recents, setRecents] = useState<RecentPassage[]>([]);
  const [focusedResult, setFocusedResult] = useState(-1);
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const closeAnd = useCallback((work: () => void) => {
    onClose();
    work();
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    setActiveTab("intelligence");
    setStatus("idle");
    setFocusedResult(-1);
    void safeCall(() => window.api.settings.get()).then((result) => {
      if (result.ok) setRecents(normalizeRecents(result.value.recentPassages));
    });
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      const target = returnFocusRef.current;
      window.setTimeout(() => target?.isConnected && target.focus(), 0);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k")) {
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      }
      const isLensKey = event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isLensKey) return;
      if (event.key !== "Tab" && (event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setActiveTab((current) => {
        const currentIndex = Math.max(0, TABS.findIndex((tab) => tab.id === current));
        const reverse = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey);
        const nextIndex = (currentIndex + (reverse ? -1 : 1) + TABS.length) % TABS.length;
        return TABS[nextIndex]?.id ?? "intelligence";
      });
      setFocusedResult(-1);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [onClose, open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    setFocusedResult(-1);
    if (trimmed.length < 2) {
      requestSeq.current += 1;
      setStatus("idle");
      setData({ scripture: [], notes: [], entities: [], exact: null });
      return;
    }

    const seq = ++requestSeq.current;
    setStatus("searching");
    const parsed = parsePassage(trimmed, bookNames, backbone);
    const timer = window.setTimeout(() => {
      const exactPreview = parsed.ok
        ? safeCall(() => window.api.scripture.getChapterText(context.packageId, parsed.value.book, parsed.value.chapter))
        : Promise.resolve({ ok: true as const, value: null });
      void Promise.all([
        safeCall(() => window.api.scripture.search(context.packageId, trimmed, 24, {
          book: context.book,
          chapter: context.chapter,
        })),
        safeCall(() => window.api.library.search(trimmed)),
        safeCall(() => window.api.language.searchEntities(trimmed, 24)),
        exactPreview,
      ]).then(([scriptureResult, notesResult, entitiesResult, previewResult]) => {
        if (requestSeq.current !== seq) return;
        if (!scriptureResult.ok && !notesResult.ok && !entitiesResult.ok && !previewResult.ok) {
          setStatus("error");
          return;
        }

        let exact: PaletteResult | null = null;
        if (parsed.ok) {
          const { book, chapter, verse, endVerse } = parsed.value;
          const refTitle = `${displayBook(bookNames, book)} ${chapter}${verse ? `:${verse}${endVerse ? `–${endVerse}` : ""}` : ""}`;
          const previewData = previewResult.ok ? previewResult.value : null;
          const preview = verse
            ? previewData?.verses
                .filter((item) => item.verse >= verse && item.verse <= (endVerse ?? verse))
                .map((item) => item.text)
                .join(" ")
            : `Open ${displayBook(bookNames, book)} chapter ${chapter}`;
          exact = {
            id: `exact:${book}:${chapter}:${verse ?? 0}:${endVerse ?? 0}`,
            kind: "scripture",
            title: refTitle,
            detail: cleanExcerpt(preview ?? ""),
            meta: "Exact reference",
            activate: () => closeAnd(() => onNavigate(book, chapter, verse, endVerse)),
          };
        }

        setData({
          scripture: scriptureResult.ok ? scriptureResult.value : [],
          notes: notesResult.ok ? notesResult.value : [],
          // A parsed reference is already unambiguous. Do not let the book
          // name also masquerade as a person query (John 3:16 → two Johns).
          entities: !parsed.ok && entitiesResult.ok ? entitiesResult.value.entities : [],
          exact,
        });
        setStatus("ready");
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [backbone, bookNames, closeAnd, context.book, context.chapter, context.packageId, onNavigate, open, query]);

  const scriptureResults = useMemo<PaletteResult[]>(() => data.scripture
    .filter((hit) => data.exact?.id !== `exact:${hit.book}:${hit.chapter}:${hit.verse}:0`)
    .map((hit) => ({
      id: `scripture:${hit.book}:${hit.chapter}:${hit.verse}`,
      kind: "scripture",
      title: `${displayBook(bookNames, hit.book)} ${hit.chapter}:${hit.verse}`,
      detail: cleanExcerpt(hit.text),
      meta: hit.matchKind === "phrase" ? "Phrase" : context.packageId.toUpperCase(),
      activate: () => closeAnd(() => onNavigate(hit.book, hit.chapter, hit.verse)),
    })), [bookNames, closeAnd, context.packageId, data.exact?.id, data.scripture, onNavigate]);

  const noteResults = useMemo<PaletteResult[]>(() => data.notes.map((note) => ({
    id: `note:${note.id}`,
    kind: "note",
    title: note.title || "Untitled note",
    detail: cleanExcerpt(note.body_text) || "No note text yet.",
    meta: "Your library",
    activate: () => closeAnd(() => onOpenNote(note.id)),
  })), [closeAnd, data.notes, onOpenNote]);

  const entityResults = useMemo<PaletteResult[]>(() => data.entities.map(({ entity }) => {
    const destination = bestEntityRef(entity, context);
    return {
      id: `entity:${entity.id}`,
      kind: entity.kind === "place" ? "place" : "person",
      title: displayEntityName(entity.displayName),
      detail: cleanExcerpt(entity.brief || entity.short || "Indexed biblical name"),
      meta: `${entity.refCount} ${entity.refCount === 1 ? "passage" : "passages"}`,
      activate: () => {
        if (!destination) return;
        closeAnd(() => onNavigate(destination.book, destination.chapter, destination.verse));
      },
    } satisfies PaletteResult;
  }), [closeAnd, context, data.entities, onNavigate]);

  const actionResults = useMemo<PaletteResult[]>(() => actions
    .filter((action) => !query.trim() || matchesAction(action, query))
    .map((action) => ({
      id: `action:${action.id}`,
      kind: "action",
      title: action.title,
      detail: action.detail,
      meta: "Action",
      activate: () => closeAnd(() => onRunAction(action.id)),
    })), [actions, closeAnd, onRunAction, query]);

  const preferredActionResults = useMemo<PaletteResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle) return [];
    const preferredIds = new Set(actions
      .filter((action) => {
        const titleWords = action.title.toLocaleLowerCase().split(/\s+/);
        return titleWords.includes(needle)
          || action.title.toLocaleLowerCase() === needle
          || action.keywords.some((keyword) => keyword.toLocaleLowerCase() === needle);
      })
      .map((action) => `action:${action.id}`));
    return actionResults.filter((result) => preferredIds.has(result.id));
  }, [actionResults, actions, query]);

  const recentResults = useMemo<PaletteResult[]>(() => recents.slice(0, 4).map((recent) => ({
    id: `recent:${recent.book}:${recent.chapter}`,
    kind: "recent",
    title: formatRecentLabel(recent, bookNames),
    detail: `Recently opened in ${recent.packageId.toUpperCase()}`,
    meta: "Recent",
    activate: () => closeAnd(() => onNavigate(recent.book, recent.chapter, recent.verse)),
  })), [bookNames, closeAnd, onNavigate, recents]);

  const results = useMemo<PaletteResult[]>(() => {
    const hasQuery = query.trim().length >= 2;
    if (!hasQuery) {
      if (activeTab === "intelligence") return [...recentResults, ...actionResults].slice(0, 7);
      return [];
    }
    if (activeTab === "scripture") return [data.exact, ...scriptureResults].filter((item): item is PaletteResult => item != null).slice(0, 24);
    if (activeTab === "notes") {
      const deep: PaletteResult = {
        id: "deep-search:notes",
        kind: "deep-search",
        title: `Search all notes for “${query.trim()}”`,
        detail: "Open the full note search workspace",
        meta: "Deep search",
        activate: () => closeAnd(() => onSearchNotes(query.trim())),
      };
      return [...noteResults, deep].slice(0, 24);
    }
    if (activeTab === "names") return entityResults.slice(0, 24);
    const remainingActions = actionResults.filter(
      (action) => !preferredActionResults.some((preferred) => preferred.id === action.id),
    );
    return [
      ...preferredActionResults,
      ...(data.exact ? [data.exact] : []),
      ...scriptureResults.slice(0, 2),
      ...noteResults.slice(0, 1),
      ...entityResults.slice(0, 2),
      ...remainingActions.slice(0, 1),
    ].slice(0, 7);
  }, [activeTab, actionResults, closeAnd, data.exact, entityResults, noteResults, onSearchNotes, preferredActionResults, query, recentResults, scriptureResults]);

  const emptyCopy = activeTab === "scripture"
    ? "Enter a reference, phrase, or natural-language question."
    : activeTab === "notes"
      ? "Search the titles and complete text of your local notes."
      : activeTab === "names"
        ? "Find a person, place, or role such as apostle."
        : "Search Scripture, your notes, names, places, and the actions that fit.";

  const moveResultFocus = (index: number): void => {
    const bounded = Math.max(0, Math.min(results.length - 1, index));
    setFocusedResult(bounded);
    resultRefs.current[bounded]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % TABS.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + TABS.length) % TABS.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = TABS.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = TABS[nextIndex];
    if (!next) return;
    setActiveTab(next.id);
    setFocusedResult(-1);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleResultKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveResultFocus(index + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index === 0) inputRef.current?.focus(); else moveResultFocus(index - 1);
    } else if (event.key === "Home") {
      event.preventDefault();
      moveResultFocus(0);
    } else if (event.key === "End") {
      event.preventDefault();
      moveResultFocus(results.length - 1);
    }
  };

  if (!open) return null;
  const materialClass = [`theme-${theme}`, isDarkTheme(theme) ? "dark" : ""].filter(Boolean).join(" ");

  return createPortal(
    <div className={`command-palette-root ${materialClass}`} data-floating-layer="dialog">
      <button type="button" className="command-palette-scrim" aria-label="Close search" onClick={onClose} />
      <div
        className="command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Search and commands"
      >
        <div className="command-palette-input-row">
          <span className="command-palette-search-icon"><SearchGlyph /></span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" && results.length > 0) {
                event.preventDefault();
                moveResultFocus(0);
              }
            }}
            type="search"
            placeholder="Search Scripture, notes, people, or actions"
            aria-label="Search Scripture, notes, people, places, and actions"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd aria-label="Escape closes">esc</kbd>
        </div>

        <div className="command-palette-tabs" role="tablist" aria-label="Search lens">
          {TABS.map((tab, index) => (
            <button
              key={tab.id}
              ref={(node) => { tabRefs.current[index] = node; }}
              type="button"
              role="tab"
              id={`command-tab-${tab.id}`}
              aria-selected={activeTab === tab.id}
              aria-controls="command-results"
              tabIndex={activeTab === tab.id ? 0 : -1}
              onClick={() => { setActiveTab(tab.id); setFocusedResult(-1); }}
              onKeyDown={(event) => handleTabKeyDown(event, index)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div
          id="command-results"
          className="command-palette-results"
          role="tabpanel"
          aria-labelledby={`command-tab-${activeTab}`}
          aria-live="polite"
        >
          {status === "searching" && query.trim().length >= 2 ? (
            <div className="command-palette-state" role="status"><span />Searching local indexes…</div>
          ) : status === "error" ? (
            <div className="command-palette-state is-error">Search is temporarily unavailable.</div>
          ) : results.length > 0 ? (
            <div className="command-palette-result-list">
              {results.map((result, index) => (
                <button
                  key={result.id}
                  ref={(node) => { resultRefs.current[index] = node; }}
                  type="button"
                  className={`command-palette-result${focusedResult === index ? " is-focused" : ""}`}
                  onFocus={() => setFocusedResult(index)}
                  onMouseMove={() => setFocusedResult(index)}
                  onClick={result.activate}
                  onKeyDown={(event) => handleResultKeyDown(event, index)}
                >
                  <span className={`command-result-glyph is-${result.kind}`}><ResultGlyph kind={result.kind} /></span>
                  <span className="command-result-copy">
                    <strong>{result.title}</strong>
                    <span>{result.detail}</span>
                  </span>
                  <span className="command-result-meta">{result.meta}</span>
                  <span className="command-result-open" aria-hidden="true">Open&nbsp;↵</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="command-palette-empty">
              <p>{emptyCopy}</p>
              {activeTab === "scripture" && <span>Try “John 3:16” or “love is patient”.</span>}
              {activeTab === "names" && <span>Name matches rank before definition matches.</span>}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
