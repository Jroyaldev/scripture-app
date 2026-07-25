import type React from "react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type {
  BackboneData,
  BookNameData,
  LanguageNameEntity,
  NoteSearchResult,
  ScriptureSearchHitData,
} from "../api.js";
import { isDarkTheme, type AppTheme } from "../theme.js";
import { isTopLayer, useLayer } from "../layerStack.js";
import { parsePassage } from "../utils/parsePassage.js";
import { formatRecentLabel, normalizeRecents, type RecentPassage } from "../utils/recentPassages.js";
import { safeCall } from "../utils/safeCall.js";

export type CommandPaletteTab = "intelligence" | "scripture" | "notes" | "names";
export type CommandPaletteMode = "search" | "open-study-tab";

export interface CommandReadingContext {
  book: string;
  chapter: number;
  chapterEndVerse?: number;
  packageId: string;
  verseStart?: number;
  verseEnd?: number;
}

export interface CommandEntityTarget {
  id: string;
  displayName: string;
  kind: "person" | "place" | "other";
}

export interface CommandPaletteAction {
  id: string;
  title: string;
  detail: string;
  keywords: string[];
}

export interface StudyTabOpenChoice {
  id: "open-passage" | "research-entity" | "duplicate-passage" | "start-study";
  title: string;
  detail: string;
}

export function studyTabOpenChoices(studyLabel: string): StudyTabOpenChoice[] {
  return [
    {
      id: "open-passage",
      title: "Open passage in this study",
      detail: `Add another chapter or passage to ${studyLabel}.`,
    },
    {
      id: "research-entity",
      title: "Research a person or place",
      detail: `Keep the research beside ${studyLabel}.`,
    },
    {
      id: "duplicate-passage",
      title: "Duplicate current passage",
      detail: "Keep this reading state and continue in an independent tab.",
    },
    {
      id: "start-study",
      title: "Start and name a new study",
      detail: "Create a separate sermon, question, or class study from this canvas.",
    },
  ];
}

interface Props {
  open: boolean;
  initialTab?: CommandPaletteTab;
  mode?: "search" | "open-study-tab";
  studyLabel?: string;
  onClose: () => void;
  theme: AppTheme;
  backbone: BackboneData;
  bookNames: BookNameData;
  context: CommandReadingContext;
  actions: CommandPaletteAction[];
  onNavigate: (book: string, chapter: number, verse?: number, endVerse?: number) => Promise<boolean>;
  onOpenPassage: (book: string, chapter: number, verse?: number, endVerse?: number) => Promise<boolean>;
  onDuplicatePassage: () => Promise<boolean>;
  onStartStudy: () => Promise<boolean>;
  onOpenNote: (noteId: string) => Promise<boolean>;
  onOpenEntity: (target: CommandEntityTarget) => Promise<boolean>;
  onSearchNotes: (query: string) => Promise<boolean>;
  onRunAction: (id: string) => Promise<boolean>;
}

type PaletteResult = {
  id: string;
  kind:
    | "scripture"
    | "note"
    | "person"
    | "place"
    | "action"
    | "recent"
    | "deep-search"
    | "intelligence"
    | "correction";
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

type CommandPaletteTabDefinition = { id: CommandPaletteTab; label: string };

const TABS: ReadonlyArray<CommandPaletteTabDefinition> = [
  { id: "intelligence", label: "Intelligence" },
  { id: "scripture", label: "Scripture" },
  { id: "notes", label: "My notes" },
  { id: "names", label: "Names" },
];

const STUDY_OPEN_TABS: ReadonlyArray<CommandPaletteTabDefinition> = [
  { id: "intelligence", label: "Add" },
  { id: "scripture", label: "Passages" },
  { id: "names", label: "People & places" },
];

export function commandPaletteTabs(mode: CommandPaletteMode): ReadonlyArray<CommandPaletteTabDefinition> {
  return mode === "open-study-tab" ? STUDY_OPEN_TABS : TABS;
}

/* ==========================================================================
   Reading the query — the shape routes it, and the palette says so
   --------------------------------------------------------------------------
   Picking a scope stopped being a prerequisite. What the reader typed decides
   where it goes: a reference to Scripture, a quotation to a phrase search, a
   capitalised noun to Names, a question to Intelligence, anything else to
   their own notes. Everything below is pure so the rule can be tested without
   a DOM, and so the palette can state its reading instead of implying it.
   ========================================================================== */

export type QueryShape = "reference" | "phrase" | "question" | "name" | "text";

/** A statement segment. `value` marks the part the palette actually decided. */
export interface ReadingSegment {
  text: string;
  value?: boolean;
}

export interface ReadingPassage {
  book: string;
  chapter: number;
  verse?: number;
  endVerse?: number;
}

/** One way the query can be read. The first is pre-selected; the rest are offered. */
export interface QueryReading {
  id: string;
  tab: CommandPaletteTab;
  /** "Read as *Acts* · chapter *19* · verses *13–16*" */
  statement: ReadingSegment[];
  /** Why the palette believes this reading. Ambiguity is never silent. */
  reason: string;
  passage?: ReadingPassage;
}

/**
 * A row the reader presses. Corrections are never applied underneath them —
 * a mis-typed chapter stays exactly as typed until the reader chooses the fix.
 */
export interface QueryCorrection {
  id: string;
  label: string;
  reason: string;
  /** Rewrites the field. Absent when the correction only changes scope. */
  query?: string;
  /** Moves the scope. Absent when the correction only rewrites the field. */
  tab?: CommandPaletteTab;
}

export interface QueryRouting {
  shape: QueryShape;
  /** The text actually searched — a quotation searches without its quotes. */
  term: string;
  readings: QueryReading[];
  corrections: QueryCorrection[];
  /** Set when a reference was attempted and failed; the query fell through. */
  fellThrough: string;
  /** True when the reader typed a chapter, which rules the query out as a name. */
  explicitReference: boolean;
}

const QUOTED_QUERY = /^["“]([^"“”]+)["”]$/;
const INTERROGATIVE = /^(who|whom|whose|what|when|where|why|how|which|did|does|do|is|are|was|were|can|could|should|would|will|has|have|had)\b/i;
const CAPITALISED_NOUN = /^\p{Lu}[\p{L}\p{M}'’.-]*(?:\s+(?:of|the|of the|son of)?\s*\p{Lu}[\p{L}\p{M}'’.-]*)*$/u;
const CHAPTER_VERSE = /^(\d+)(?:\s*:\s*(\d+)(?:\s*[-–—]\s*(\d+))?)?$/;

type BookMatch = { code: string; name: string; length: number };

/**
 * Mirrors parsePassage's book matcher so this module can see *what the reader
 * typed* as well as what parsed. parsePassage silently drops an out-of-range
 * verse; the palette has to state that, so it needs both halves.
 */
function matchLeadingBook(input: string, bookNames: BookNameData): BookMatch | null {
  const lower = input.toLocaleLowerCase();
  let best: BookMatch | null = null;
  for (const [code, names] of Object.entries(bookNames)) {
    for (const name of names ?? []) {
      const nameLower = name.toLocaleLowerCase();
      if (!lower.startsWith(nameLower)) continue;
      const next = input[name.length];
      if (next !== undefined && next !== " " && next !== ":" && !/\d/.test(next)) continue;
      if (!best || name.length > best.length) best = { code, name, length: name.length };
    }
  }
  return best;
}

/** Books whose full name begins with a token the reader stopped short on. */
function nearBooks(token: string, bookNames: BookNameData): Array<{ code: string; name: string }> {
  const lower = token.trim().toLocaleLowerCase();
  if (lower.length < 3) return [];
  const found: Array<{ code: string; name: string }> = [];
  for (const [code, names] of Object.entries(bookNames)) {
    const primary = names?.[0];
    if (!primary) continue;
    if (primary.toLocaleLowerCase().startsWith(lower)) found.push({ code, name: primary });
  }
  return found;
}

function askedAsQuestion(text: string): string {
  if (/\?\s*$/.test(text)) return "it ends with a question mark";
  const lead = INTERROGATIVE.exec(text);
  const words = text.split(/\s+/).filter(Boolean);
  if (lead?.[1] && words.length >= 3) return `it begins with “${lead[1].toLocaleLowerCase()}”`;
  return "";
}

function looksLikeName(text: string): boolean {
  if (/\d/.test(text)) return false;
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 4) return false;
  return CAPITALISED_NOUN.test(text);
}

export function readQuery(raw: string, bookNames: BookNameData, backbone: BackboneData): QueryRouting {
  const trimmed = raw.trim();
  const nothing: QueryRouting = {
    shape: "text",
    term: trimmed,
    readings: [],
    corrections: [],
    fellThrough: "",
    explicitReference: false,
  };
  if (trimmed.length < 2) return nothing;

  // 1 — Quotation marks are the reader saying "these exact words".
  const quoted = QUOTED_QUERY.exec(trimmed);
  const quotedTerm = quoted?.[1]?.trim();
  if (quotedTerm) {
    return {
      shape: "phrase",
      term: quotedTerm,
      readings: [{
        id: "read:phrase",
        tab: "scripture",
        statement: [{ text: "Read as a phrase · " }, { text: `“${quotedTerm}”`, value: true }],
        reason: "you put it in quotation marks",
      }],
      corrections: [{
        id: "fix:phrase-notes",
        label: "Find that phrase in your notes",
        reason: "a quoted phrase is often your own wording",
        tab: "notes",
      }],
      fellThrough: "",
      explicitReference: false,
    };
  }

  // 2 — A reference. parsePassage owns the happy path; the range work here
  // exists only so a dropped chapter or verse is stated rather than applied.
  const parsed = parsePassage(trimmed, bookNames, backbone);
  const readings: QueryReading[] = [];
  const corrections: QueryCorrection[] = [];
  let fellThrough = "";
  let explicitReference = false;

  const book = matchLeadingBook(trimmed, bookNames);
  if (book) {
    const label = bookNames[book.code]?.[0] ?? book.code;
    const chapters = backbone.books[book.code]?.chapters ?? [];
    const remainder = trimmed.slice(book.length).trim();
    const typed = remainder === "" ? null : CHAPTER_VERSE.exec(remainder);

    explicitReference = typed != null;
    if (!parsed.ok) {
      // The parser refuses it, so the palette does too — and says why, then
      // falls through to the next scope instead of dead-ending on the error.
      fellThrough = parsed.error;
      const typedChapter = typed?.[1] ? Number.parseInt(typed[1], 10) : null;
      if (typedChapter != null && chapters.length > 0 && typedChapter > chapters.length) {
        corrections.push({
          id: "fix:chapter",
          label: `Read ${label} ${chapters.length}`,
          reason: `${label} ends at chapter ${chapters.length}, and you typed ${typedChapter}`,
          query: `${label} ${chapters.length}`,
        });
      }
    } else {
      const { chapter, verse, endVerse } = parsed.value;
      const verseCount = chapters[chapter - 1] ?? 0;
      const typedVerse = typed?.[2] ? Number.parseInt(typed[2], 10) : undefined;
      const typedEnd = typed?.[3] ? Number.parseInt(typed[3], 10) : undefined;

      const statement: ReadingSegment[] = [
        { text: "Read as " },
        { text: label, value: true },
        { text: " · chapter " },
        { text: String(chapter), value: true },
      ];
      if (verse != null) {
        statement.push({ text: endVerse != null ? " · verses " : " · verse " });
        statement.push({ text: endVerse != null ? `${verse}–${endVerse}` : String(verse), value: true });
      }

      let reason = typed
        ? `${label} ${chapter} is a passage in this edition`
        : "no chapter was given, so the book opens at its first";
      // parsePassage drops an out-of-range verse silently. State the drop and
      // offer the fix as a row; never rewrite the reader's reference for them.
      if (typedVerse != null && verse == null) {
        reason = `${label} ${chapter} has ${verseCount} verses, so verse ${typedVerse} was not read`;
        corrections.push({
          id: "fix:verse",
          label: `Read ${label} ${chapter}:${verseCount}`,
          reason: `${label} ${chapter} ends at verse ${verseCount}`,
          query: `${label} ${chapter}:${verseCount}`,
        });
      } else if (typedEnd != null && endVerse == null && verse != null) {
        reason = `${label} ${chapter} has ${verseCount} verses, so the range end was not read`;
        corrections.push({
          id: "fix:end-verse",
          label: `Read ${label} ${chapter}:${verse}–${verseCount}`,
          reason: `${label} ${chapter} ends at verse ${verseCount}`,
          query: `${label} ${chapter}:${verse}-${verseCount}`,
        });
      }

      const passage: ReadingPassage = { book: parsed.value.book, chapter };
      if (verse != null) passage.verse = verse;
      if (endVerse != null) passage.endVerse = endVerse;
      readings.push({ id: "read:reference", tab: "scripture", statement, reason, passage });

      // A bare book name that is also a capitalised noun is genuinely
      // ambiguous. List both readings with their reasons rather than
      // pretending the likeliest one is the only one.
      if (!typed && looksLikeName(trimmed)) {
        readings.push({
          id: "read:reference-name",
          tab: "names",
          statement: [{ text: "Read as a name · " }, { text: trimmed, value: true }],
          reason: "it is capitalised and you typed no chapter, so it may be a person or place",
        });
      }
    }
  } else {
    // No book matched. If the reader stopped short of a book name, offer the
    // completions as rows — never guess one on their behalf.
    const nearMiss = /^([\p{L}\p{M}\s]{2,})\s+(\d+)(?:\s*:\s*\d+)?$/u.exec(trimmed);
    const token = nearMiss?.[1];
    if (token) {
      const candidates = nearBooks(token, bookNames);
      if (candidates.length > 0 && candidates.length <= 3) {
        fellThrough = `no book is named “${token.trim()}”`;
        for (const candidate of candidates) {
          const rest = trimmed.slice(token.length).trim();
          corrections.push({
            id: `fix:book:${candidate.code}`,
            label: `Read ${candidate.name} ${rest}`,
            reason: `“${token.trim()}” is the start of ${candidate.name}`,
            query: `${candidate.name} ${rest}`,
          });
        }
      }
    }
  }

  if (readings.length > 0) {
    return { shape: "reference", term: trimmed, readings, corrections, fellThrough, explicitReference };
  }

  // 3 — A question. Intelligence is the only scope that leaves the device, so
  // the palette names it and stops. Nothing is sent until the reader presses.
  const question = askedAsQuestion(trimmed);
  if (question) {
    readings.push({
      id: "read:question",
      tab: "intelligence",
      statement: [
        { text: "Read as a question for " },
        { text: "Intelligence", value: true },
        { text: " — the only scope that leaves this device" },
      ],
      reason: question,
    });
    corrections.push(
      {
        id: "fix:question-scripture",
        label: "Search Scripture for these words",
        reason: "the answer may already be in the text, on this device",
        tab: "scripture",
      },
      {
        id: "fix:question-notes",
        label: "Search your notes for these words",
        reason: "you may have written about it already",
        tab: "notes",
      },
    );
    return { shape: "question", term: trimmed, readings, corrections, fellThrough, explicitReference };
  }

  // 4 — A capitalised noun carrying no numbers is a name.
  if (looksLikeName(trimmed)) {
    readings.push({
      id: "read:name",
      tab: "names",
      statement: [{ text: "Read as a name · " }, { text: trimmed, value: true }],
      reason: "it is capitalised and carries no chapter or verse",
    });
    corrections.push({
      id: "fix:name-notes",
      label: "Search your notes for it instead",
      reason: "you may have written about this name",
      tab: "notes",
    });
    return { shape: "name", term: trimmed, readings, corrections, fellThrough, explicitReference };
  }

  // 5 — Anything else is the reader's own writing.
  readings.push({
    id: "read:text",
    tab: "notes",
    statement: [
      { text: "Searching " },
      { text: "your notes", value: true },
      { text: " for " },
      { text: `“${trimmed}”`, value: true },
    ],
    reason: fellThrough || "no reference, quotation, question, or capitalised name in it",
  });
  corrections.push({
    id: "fix:text-scripture",
    label: "Search Scripture for these words",
    reason: "the same words may be in the edition",
    tab: "scripture",
  });
  return { shape: "text", term: trimmed, readings, corrections, fellThrough, explicitReference };
}

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
  // Intelligence has no drawing. It carries the slate provenance dot, painted
  // by .command-result-glyph.is-intelligence, because the mark is the message.
  if (kind === "intelligence") return <svg viewBox="0 0 20 20" aria-hidden="true" />;
  if (kind === "correction") {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M15.5 8H7.2l2.6-2.6M4.5 12h8.3l-2.6 2.6" />
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

function matchesAction(action: CommandPaletteAction, query: string): boolean {
  const terms = query.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack = `${action.title} ${action.detail} ${action.keywords.join(" ")}`.toLocaleLowerCase();
  return terms.every((term) => haystack.includes(term));
}

/**
 * Why Intelligence cannot act yet, in the reader's terms. Every branch names
 * the thing and the reason and points at the one surface that can change it —
 * "something went wrong" would be an apology, not a state.
 */
export function intelligenceReadiness(
  envelope: { backgroundAI: string; networkBackground: boolean } | null,
): string {
  if (!envelope) return "Intelligence limits could not be read · Settings › Intelligence";
  if (envelope.backgroundAI === "off") return "Assistance is off · Settings › Intelligence";
  if (!envelope.networkBackground) return "Background network is blocked · Settings › Intelligence";
  if (envelope.backgroundAI === "local-only") return "Assistance is local-only · Settings › Intelligence";
  return "No intelligence provider is connected · Settings › Intelligence";
}

export async function runApprovedPaletteActivation(
  inFlight: { current: boolean },
  request: () => Promise<boolean>,
  commit: () => void,
  ownerIsCurrent: () => boolean = () => true,
): Promise<boolean> {
  if (inFlight.current) return false;
  inFlight.current = true;
  try {
    const approved = await request();
    if (!approved || !ownerIsCurrent()) return false;
    commit();
    return true;
  } catch {
    return false;
  } finally {
    inFlight.current = false;
  }
}

export function CommandPalette({
  open,
  initialTab,
  mode = "search",
  studyLabel = "this study",
  onClose,
  theme,
  backbone,
  bookNames,
  context,
  actions,
  onNavigate,
  onOpenPassage,
  onDuplicatePassage,
  onStartStudy,
  onOpenNote,
  onOpenEntity,
  onSearchNotes,
  onRunAction,
}: Props): React.JSX.Element | null {
  const visibleTabs = commandPaletteTabs(mode);
  const [query, setQuery] = useState("");
  const [activeTab, setActiveTab] = useState<CommandPaletteTab>("intelligence");
  // The scope stops being a prerequisite: it follows the query's shape until
  // the reader (or the caller) chooses one, and the choice is always undoable.
  const [scopeChosen, setScopeChosen] = useState(false);
  const [status, setStatus] = useState<"idle" | "searching" | "ready" | "error">("idle");
  const [failed, setFailed] = useState<string[]>([]);
  const [data, setData] = useState<SearchData>({ scripture: [], notes: [], entities: [], exact: null });
  const [recents, setRecents] = useState<RecentPassage[]>([]);
  const [envelope, setEnvelope] = useState<{ backgroundAI: string; networkBackground: boolean } | null>(null);
  const [focusedResult, setFocusedResult] = useState(-1);
  const requestSeq = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const resultRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const resultActivationInFlightRef = useRef(false);
  const paletteOwnerRef = useRef(0);
  const openRef = useRef(open);
  openRef.current = open;
  const layerRef = useLayer(open ? "dialog" : null);

  const routing = useMemo(
    () => readQuery(query, bookNames, backbone),
    [backbone, bookNames, query],
  );
  const hasQuery = query.trim().length >= 2;
  const routedTab = useMemo<CommandPaletteTab>(() => {
    const wanted = routing.readings[0]?.tab ?? "notes";
    if (visibleTabs.some((tab) => tab.id === wanted)) return wanted;
    // open-study-tab has no notes destination, and asking Intelligence is not
    // a thing you can add to a study. Passages is the honest fallback.
    return "scripture";
  }, [routing.readings, visibleTabs]);

  const dismissPalette = useCallback((): void => {
    paletteOwnerRef.current += 1;
    onClose();
  }, [onClose]);

  const closeForDestination = useCallback((): void => {
    // Activating a result transfers focus ownership to its destination
    // (Scripture selection, note workspace, or entity research). Only a
    // dismissed palette should restore the invoking control.
    paletteOwnerRef.current += 1;
    returnFocusRef.current = null;
    onClose();
  }, [onClose]);

  const activateResult = useCallback((request: () => Promise<boolean>): void => {
    const owner = paletteOwnerRef.current;
    void runApprovedPaletteActivation(
      resultActivationInFlightRef,
      request,
      closeForDestination,
      () => openRef.current && paletteOwnerRef.current === owner,
    );
  }, [closeForDestination]);

  const chooseScope = useCallback((tab: CommandPaletteTab): void => {
    setScopeChosen(true);
    setActiveTab(tab);
    setFocusedResult(-1);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  const chooseStudyLens = useCallback((tab: "scripture" | "names"): void => {
    setScopeChosen(true);
    setActiveTab(tab);
    setFocusedResult(-1);
    window.requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const owner = paletteOwnerRef.current + 1;
    paletteOwnerRef.current = owner;
    return () => {
      if (paletteOwnerRef.current === owner) paletteOwnerRef.current += 1;
    };
  }, [initialTab, open]);

  useEffect(() => {
    if (!open) return;
    returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setQuery("");
    // initialTab remains a caller override. "intelligence" is the neutral
    // value every ordinary opener passes, and Intelligence is the one scope
    // that must be asked for — so it is read as "no preference", not a forced
    // off-device scope.
    const override = initialTab && initialTab !== "intelligence" && visibleTabs.some((tab) => tab.id === initialTab)
      ? initialTab
      : null;
    setScopeChosen(override != null);
    setActiveTab(override ?? "intelligence");
    setStatus("idle");
    setFailed([]);
    setFocusedResult(-1);
    void safeCall(() => window.api.settings.get()).then((result) => {
      if (result.ok) setRecents(normalizeRecents(result.value.recentPassages));
    });
    void safeCall(() => window.api.ai.getBudgetEnvelope()).then((result) => {
      setEnvelope(result.ok && result.value ? {
        backgroundAI: result.value.envelope.backgroundAI,
        networkBackground: result.value.envelope.networkBackground,
      } : null);
    });
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(timer);
      const target = returnFocusRef.current;
      const restoreOwner = paletteOwnerRef.current;
      window.setTimeout(() => {
        if (openRef.current || paletteOwnerRef.current !== restoreOwner) return;
        if (target?.isConnected) target.focus();
      }, 0);
    };
  }, [initialTab, mode, open]);

  // The shape drives the scope until the reader takes it over.
  useEffect(() => {
    if (!open || scopeChosen) return;
    setActiveTab(hasQuery ? routedTab : "intelligence");
  }, [hasQuery, open, routedTab, scopeChosen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape" || ((event.metaKey || event.ctrlKey) && event.key.toLocaleLowerCase() === "k")) {
        if (!isTopLayer(layerRef.current)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissPalette();
        return;
      }
      const isLensKey = event.key === "Tab" || event.key === "ArrowLeft" || event.key === "ArrowRight";
      if (!isLensKey) return;
      if (event.key !== "Tab" && (event.metaKey || event.ctrlKey || event.altKey)) return;
      event.preventDefault();
      event.stopPropagation();
      setScopeChosen(true);
      setActiveTab((current) => {
        const currentIndex = Math.max(0, visibleTabs.findIndex((tab) => tab.id === current));
        const reverse = event.key === "ArrowLeft" || (event.key === "Tab" && event.shiftKey);
        const nextIndex = (currentIndex + (reverse ? -1 : 1) + visibleTabs.length) % visibleTabs.length;
        return visibleTabs[nextIndex]?.id ?? "intelligence";
      });
      setFocusedResult(-1);
      inputRef.current?.focus();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [dismissPalette, mode, open]);

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    setFocusedResult(-1);
    if (trimmed.length < 2) {
      requestSeq.current += 1;
      setStatus("idle");
      setFailed([]);
      setData({ scripture: [], notes: [], entities: [], exact: null });
      return;
    }

    const seq = ++requestSeq.current;
    setStatus("searching");
    const term = routing.term;
    const reference = routing.readings.find((reading) => reading.passage)?.passage ?? null;
    const timer = window.setTimeout(() => {
      const exactPreview = reference
        ? safeCall(() => window.api.scripture.getChapterText(context.packageId, reference.book, reference.chapter))
        : Promise.resolve({ ok: true as const, value: null });
      void Promise.all([
        safeCall(() => window.api.scripture.search(context.packageId, term, 24, {
          book: context.book,
          chapter: context.chapter,
        })),
        safeCall(() => window.api.library.search(term)),
        safeCall(() => window.api.language.searchEntities(term, 24)),
        exactPreview,
      ]).then(([scriptureResult, notesResult, entitiesResult, previewResult]) => {
        if (requestSeq.current !== seq) return;
        if (!scriptureResult.ok && !notesResult.ok && !entitiesResult.ok && !previewResult.ok) {
          setFailed(["Scripture", "your notes", "names"]);
          setStatus("error");
          return;
        }
        // Name the index that failed. A partial answer that pretends to be
        // complete is worse than a smaller answer that says what is missing.
        setFailed([
          !scriptureResult.ok || !previewResult.ok ? "Scripture" : "",
          notesResult.ok ? "" : "your notes",
          entitiesResult.ok ? "" : "names",
        ].filter(Boolean));

        let exact: PaletteResult | null = null;
        if (reference) {
          const { book, chapter, verse, endVerse } = reference;
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
            activate: () => activateResult(() => (
              mode === "open-study-tab"
                ? onOpenPassage(book, chapter, verse, endVerse)
                : onNavigate(book, chapter, verse, endVerse)
            )),
          };
        }

        setData({
          scripture: scriptureResult.ok ? scriptureResult.value : [],
          notes: notesResult.ok ? notesResult.value : [],
          // A reference the reader spelled out with a chapter is already
          // unambiguous. Do not let the book name also masquerade as a person
          // query (John 3:16 → two Johns).
          entities: !routing.explicitReference && entitiesResult.ok ? entitiesResult.value.entities : [],
          exact,
        });
        setStatus("ready");
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activateResult, bookNames, context.book, context.chapter, context.packageId, mode, onNavigate, onOpenPassage, open, query, routing]);

  const scriptureResults = useMemo<PaletteResult[]>(() => data.scripture
    .filter((hit) => data.exact?.id !== `exact:${hit.book}:${hit.chapter}:${hit.verse}:0`)
    .map((hit) => ({
      id: `scripture:${hit.book}:${hit.chapter}:${hit.verse}`,
      kind: "scripture",
      title: `${displayBook(bookNames, hit.book)} ${hit.chapter}:${hit.verse}`,
      detail: cleanExcerpt(hit.text),
      meta: hit.matchKind === "phrase" ? "Phrase" : context.packageId.toUpperCase(),
      activate: () => activateResult(() => (
        mode === "open-study-tab"
          ? onOpenPassage(hit.book, hit.chapter, hit.verse)
          : onNavigate(hit.book, hit.chapter, hit.verse)
      )),
    })), [activateResult, bookNames, context.packageId, data.exact?.id, data.scripture, mode, onNavigate, onOpenPassage]);

  const noteResults = useMemo<PaletteResult[]>(() => data.notes.map((note) => ({
    id: `note:${note.id}`,
    kind: "note",
    title: note.title || "Untitled note",
    detail: cleanExcerpt(note.body_text) || "No note text yet.",
    meta: "My notes",
    activate: () => activateResult(() => onOpenNote(note.id)),
  })), [activateResult, data.notes, onOpenNote]);

  const entityResults = useMemo<PaletteResult[]>(() => data.entities.map(({ entity }) => {
    return {
      id: `entity:${entity.id}`,
      kind: entity.kind === "place" ? "place" : "person",
      title: displayEntityName(entity.displayName),
      detail: cleanExcerpt(entity.brief || entity.short || "Indexed biblical name"),
      meta: `${entity.kind === "place" ? "Place" : "Person"} · ${entity.refCount}`,
      activate: () => activateResult(() => onOpenEntity({
        id: entity.id,
        displayName: displayEntityName(entity.displayName),
        kind: entity.kind,
      })),
    } satisfies PaletteResult;
  }), [activateResult, data.entities, onOpenEntity]);

  const actionResults = useMemo<PaletteResult[]>(() => actions
    .filter((action) => !query.trim() || matchesAction(action, query))
    .map((action) => ({
      id: `action:${action.id}`,
      kind: "action",
      title: action.title,
      detail: action.detail,
      meta: "Action",
      activate: () => activateResult(() => onRunAction(action.id)),
    })), [actions, activateResult, onRunAction, query]);

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
    activate: () => activateResult(() => (
      mode === "open-study-tab"
        ? onOpenPassage(recent.book, recent.chapter, recent.verse)
        : onNavigate(recent.book, recent.chapter, recent.verse)
    )),
  })), [activateResult, bookNames, mode, onNavigate, onOpenPassage, recents]);

  const studyOpenResults = useMemo<PaletteResult[]>(() => studyTabOpenChoices(studyLabel).map((choice) => ({
    id: `study-open:${choice.id}`,
    kind: "action",
    title: choice.title,
    detail: choice.detail,
    meta: choice.id === "start-study" ? "New study" : "Current study",
    activate: choice.id === "open-passage"
      ? () => chooseStudyLens("scripture")
      : choice.id === "research-entity"
        ? () => chooseStudyLens("names")
        : choice.id === "duplicate-passage"
          ? () => activateResult(onDuplicatePassage)
          : () => activateResult(onStartStudy),
  })), [activateResult, chooseStudyLens, onDuplicatePassage, onStartStudy, studyLabel]);

  // Corrections and alternative readings are rows in the list, so the reader
  // reaches them with the same arrow keys as everything else — and so a
  // correction is only ever applied because they pressed it.
  const correctionResults = useMemo<PaletteResult[]>(() => {
    if (!hasQuery) return [];
    const rows: PaletteResult[] = [];
    for (const reading of routing.readings.slice(1)) {
      rows.push({
        id: `reading:${reading.id}`,
        kind: "correction",
        title: reading.statement.map((segment) => segment.text).join(""),
        detail: reading.reason,
        meta: "Other reading",
        activate: () => chooseScope(reading.tab),
      });
    }
    for (const correction of routing.corrections) {
      if (correction.tab && correction.tab === activeTab) continue;
      if (correction.tab && !visibleTabs.some((tab) => tab.id === correction.tab)) continue;
      rows.push({
        id: `correction:${correction.id}`,
        kind: "correction",
        title: correction.label,
        detail: correction.reason,
        meta: correction.query ? "Correction" : "Other scope",
        activate: () => {
          if (correction.query) {
            setQuery(correction.query);
            setScopeChosen(false);
            setFocusedResult(-1);
            window.requestAnimationFrame(() => inputRef.current?.focus());
            return;
          }
          if (correction.tab) chooseScope(correction.tab);
        },
      });
    }
    if (scopeChosen) {
      rows.push({
        id: "correction:release-scope",
        kind: "correction",
        title: "Let the words choose the scope",
        detail: "You picked this scope; hand it back to what you type",
        meta: "Undo",
        activate: () => {
          setScopeChosen(false);
          setFocusedResult(-1);
          window.requestAnimationFrame(() => inputRef.current?.focus());
        },
      });
    }
    return rows;
  }, [activeTab, chooseScope, hasQuery, routing.corrections, routing.readings, scopeChosen, visibleTabs]);

  const intelligenceAsk = useMemo<PaletteResult>(() => ({
    id: "intelligence:ask",
    kind: "intelligence",
    title: `Ask Intelligence about “${routing.term}”`,
    detail: intelligenceReadiness(envelope),
    meta: "—",
    activate: () => activateResult(() => onRunAction("open-settings")),
  }), [activateResult, envelope, onRunAction, routing.term]);

  // The out-of-scope count. Intelligence is never counted here: it is the one
  // scope that leaves the device, so it may not appear as a group inside a
  // local result set — it has to be asked for.
  const elsewhereResults = useMemo<PaletteResult[]>(() => {
    if (!hasQuery || status !== "ready") return [];
    const counts: Array<{ tab: CommandPaletteTab; label: string; count: number }> = [
      { tab: "scripture", label: "Scripture", count: (data.exact ? 1 : 0) + data.scripture.length },
      { tab: "notes", label: "your notes", count: data.notes.length },
      { tab: "names", label: "names", count: data.entities.length },
    ];
    return counts
      .filter((entry) => entry.tab !== activeTab && entry.count > 0)
      .filter((entry) => visibleTabs.some((tab) => tab.id === entry.tab))
      .map((entry) => ({
        id: `elsewhere:${entry.tab}`,
        kind: "correction" as const,
        title: `${entry.count} in ${entry.label}`,
        detail: `Searched on this device, outside the scope you are looking at`,
        meta: "Elsewhere",
        activate: () => chooseScope(entry.tab),
      }));
  }, [activeTab, chooseScope, data.entities.length, data.exact, data.notes.length, data.scripture.length, hasQuery, status, visibleTabs]);

  const results = useMemo<PaletteResult[]>(() => {
    if (!hasQuery) {
      if (mode === "open-study-tab" && activeTab === "intelligence") return studyOpenResults;
      return [...recentResults, ...actionResults].slice(0, 7);
    }
    const head = preferredActionResults;
    if (activeTab === "intelligence") {
      return [...correctionResults, ...head, intelligenceAsk];
    }
    if (activeTab === "scripture") {
      const found = [data.exact, ...scriptureResults].filter((item): item is PaletteResult => item != null);
      return [...correctionResults, ...head, ...found.slice(0, 24), ...elsewhereResults];
    }
    if (activeTab === "notes") {
      const deep: PaletteResult = {
        id: "deep-search:notes",
        kind: "deep-search",
        title: `Search all notes for “${routing.term}”`,
        detail: "Open the full note search workspace",
        meta: "Deep search",
        activate: () => activateResult(() => onSearchNotes(routing.term)),
      };
      return [...correctionResults, ...head, ...noteResults.slice(0, 24), deep, ...elsewhereResults];
    }
    return [...correctionResults, ...head, ...entityResults.slice(0, 24), ...elsewhereResults];
  }, [
    actionResults,
    activateResult,
    activeTab,
    correctionResults,
    data.exact,
    elsewhereResults,
    entityResults,
    hasQuery,
    intelligenceAsk,
    mode,
    noteResults,
    onSearchNotes,
    preferredActionResults,
    recentResults,
    routing.term,
    scriptureResults,
    studyOpenResults,
  ]);

  const scopeStatement = useMemo<ReadingSegment[]>(() => {
    if (!hasQuery) {
      return [
        { text: "Type to search · " },
        { text: "the shape of what you type", value: true },
        { text: " picks the scope" },
      ];
    }
    const chosenLabel = visibleTabs.find((tab) => tab.id === activeTab)?.label ?? "";
    if (scopeChosen) {
      return [{ text: "Searching " }, { text: chosenLabel, value: true }, { text: " · you chose this scope" }];
    }
    return routing.readings[0]?.statement ?? [{ text: "Searching " }, { text: chosenLabel, value: true }];
  }, [activeTab, hasQuery, routing.readings, scopeChosen, visibleTabs]);

  const scopeReason = !hasQuery
    ? "recent passages and the actions that fit — nothing has left this device"
    : scopeChosen
      ? routing.readings[0]?.reason ?? ""
      : routing.readings[0]?.reason ?? "";

  const emptyCopy = activeTab === "scripture"
    ? `Nothing in Scripture matches “${routing.term}”.`
    : activeTab === "notes"
      ? `Nothing in your notes matches “${routing.term}”.`
      : activeTab === "names"
        ? `No indexed name matches “${routing.term}”.`
        : "Ask a question and Intelligence will state what it would send.";

  const moveResultFocus = (index: number): void => {
    const bounded = Math.max(0, Math.min(results.length - 1, index));
    setFocusedResult(bounded);
    resultRefs.current[bounded]?.focus();
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % visibleTabs.length;
    else if (event.key === "ArrowLeft") nextIndex = (index - 1 + visibleTabs.length) % visibleTabs.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = visibleTabs.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    const next = visibleTabs[nextIndex];
    if (!next) return;
    setScopeChosen(true);
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
      <button type="button" className="command-palette-scrim" aria-label="Close search" onClick={dismissPalette} />
      <div
        className="command-palette-panel"
        role="dialog"
        aria-modal="true"
        aria-label={mode === "open-study-tab" ? "Open study tab" : "Search and commands"}
      >
        {mode === "open-study-tab" && (
          <div className="command-palette-destination" aria-live="polite">Add to {studyLabel}</div>
        )}
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
            placeholder={mode === "open-study-tab" ? "Find a passage, person, or place" : "A reference, a phrase, a name, a question, or your own words"}
            aria-label={mode === "open-study-tab" ? "Find a passage, person, or place to add" : "Search Scripture, notes, people, places, and actions"}
            autoComplete="off"
            spellCheck={false}
          />
          <kbd aria-label="Escape closes">esc</kbd>
        </div>

        {/* One scope line. It states what happened; the tabs are its *change*
            affordance and occupy their space at rest, so nothing moves. */}
        <div className="palette-scope" data-shape={hasQuery ? routing.shape : "resting"}>
          <p className="palette-scope-statement" aria-live="polite">
            {scopeStatement.map((segment, index) => (
              segment.value
                ? <em key={index}>{segment.text}</em>
                : <span key={index}>{segment.text}</span>
            ))}
            {scopeReason && <span className="palette-scope-reason">{scopeReason}</span>}
          </p>
          <span className="palette-scope-change">
            <span className="palette-scope-rest" aria-hidden="true">change<kbd>⇥</kbd></span>
            <span
              className="command-palette-tabs palette-scope-tabs"
              role="tablist"
              aria-label={mode === "open-study-tab" ? "Study tab destination" : "Search scope"}
            >
              {visibleTabs.map((tab, index) => (
                <button
                  key={tab.id}
                  ref={(node) => { tabRefs.current[index] = node; }}
                  type="button"
                  role="tab"
                  id={`command-tab-${tab.id}`}
                  aria-selected={activeTab === tab.id}
                  aria-controls="command-results"
                  tabIndex={activeTab === tab.id ? 0 : -1}
                  onClick={() => chooseScope(tab.id)}
                  onKeyDown={(event) => handleTabKeyDown(event, index)}
                >
                  {tab.label}
                </button>
              ))}
            </span>
          </span>
        </div>

        <div
          id="command-results"
          className="command-palette-results"
          role="tabpanel"
          aria-labelledby={`command-tab-${activeTab}`}
          aria-live="polite"
        >
          {status === "searching" && hasQuery ? (
            <div className="palette-progress" role="status">
              <i className="search-progress-hairline" aria-hidden="true" />
              <span>Reading the indexes on this device</span>
            </div>
          ) : status === "error" ? (
            <div className="command-palette-state is-error">
              {`${failed.join(", ")} could not be read on this device.`}
            </div>
          ) : results.length > 0 ? (
            <div className="command-palette-result-list">
              {failed.length > 0 && (
                <p className="palette-partial" role="status">
                  {`${failed.join(" and ")} could not be read, so these results are incomplete.`}
                </p>
              )}
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
