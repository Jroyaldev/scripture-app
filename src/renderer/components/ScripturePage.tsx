import type React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type {
  BackboneData,
  BookNameData,
  ChapterData,
  CrossReferenceResultData,
  HighlightRecord,
  QueryResult,
  ReadingSize,
  ReadingWidth,
  SemanticMarginResult,
  VerseNumberMode,
} from "../api.js";
import { LivingMargin } from "./LivingMargin.js";
import { useToast } from "./Toast.js";
import { safeCall } from "../utils/safeCall.js";
import { parsePassage } from "../utils/parsePassage.js";
import { rangeToVerseCharOffsets } from "../utils/rangeToCharOffsets.js";
import { nextVerseSelection } from "../utils/verseSelection.js";
import { scopeHighlightsToPackage } from "../utils/highlightPackageScope.js";
import { Popover } from "./Popover.js";
import { HighlightUnderlay, FADE_MS, SWEEP_MS } from "./HighlightUnderlay.js";
import { HighlightToolbar } from "./HighlightToolbar.js";
import { ReadingComfort, type ReadingPrefs } from "./ReadingComfort.js";
import { ThemePicker } from "./ThemePicker.js";
import type { AppTheme } from "../theme.js";
import { NoteCapture, type NoteCaptureDraft } from "./NoteCapture.js";
import {
  formatRecentLabel,
  normalizeRecents,
  pushRecent,
  removeRecent,
  type RecentPassage,
} from "../utils/recentPassages.js";
import { isHighlightOverlap, type HighlightRange } from "../../core/events/highlightOverlap.js";
import { resolveBlobExtent, buildSegments, isAdjacent } from "../../core/events/highlightAdjacency.js";

export interface PinnedRange {
  start: number;
  end: number;
}

interface Props {
  backbone: BackboneData;
  bookNames: BookNameData;
  navigateRef: { book: string; chapter: number } | null;
  onCreateNote: (prefillBody?: string) => void;
  marginVisible: boolean;
  onAiBusyChange?: (busy: boolean) => void;
  /** Lifted to App, consistent with marginVisible; ScripturePage never owns theme state itself. */
  theme?: AppTheme;
  onThemeChange?: (theme: AppTheme) => void;
  /** Lifted to App, same pattern as onThemeChange; ScripturePage never owns marginVisible itself. */
  onToggleMargin?: () => void;
  /** Fired whenever the pinned (selected) verse range changes; null when nothing is selected. */
  onPinnedRangeChange?: (range: PinnedRange | null) => void;
  readingSize?: ReadingSize;
  readingWidth?: ReadingWidth;
  verseNumbers?: VerseNumberMode;
  onReadingPrefsChange?: (partial: Partial<ReadingPrefs>) => void;
  focusMode?: boolean;
  onToggleFocus?: () => void;
}

const OT_BOOKS = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
  "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAH","HAB","ZEP",
  "HAG","ZEC","MAL",
];
const NT_BOOKS = [
  "MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
  "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
  "2PE","1JN","2JN","3JN","JUD","REV",
];

const TRANSLATIONS = [
  { code: "bsb", name: "Berean Standard Bible" },
  { code: "web", name: "World English Bible" },
  { code: "kjv", name: "King James Version" },
  { code: "ylt", name: "Young's Literal Translation (1898)" },
  { code: "akjv-strongs", name: "AKJV + Strong's" },
];

function MarginToggleIcon(): React.JSX.Element {
  // Mirror of the sidebar's PanelToggleIcon: divider sits on the RIGHT
  // third of the rect (x=12.5, vs the sidebar icon's x=7.5) so the glyph
  // itself hints "this collapses the right-hand panel," not a duplicate
  // of the sidebar's own "collapses the left-hand panel" icon.
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="14" height="12" rx="2.5" />
      <path d="M12.5 4v12" />
    </svg>
  );
}

function ChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function CheckIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 10.5l4 4 8-9" />
    </svg>
  );
}

function BackChevronIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12.5 5l-5 5 5 5" />
    </svg>
  );
}

function ChapterArrowIcon({ direction }: { direction: "previous" | "next" }): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "previous" ? "M12.5 5.5 8 10l4.5 4.5" : "M7.5 5.5 12 10l-4.5 4.5"} />
    </svg>
  );
}

function JumpIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 10h12" />
      <path d="m11.5 6 4 4-4 4" />
    </svg>
  );
}

function ReadingCanvasLoading({ passage }: { passage: string }): React.JSX.Element {
  return (
    <div className="reading-state reading-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading {passage}</span>
      <div className="reading-skeleton" aria-hidden="true">
        {Array.from({ length: 7 }, (_, index) => (
          <span key={index} className="reading-skeleton-line" />
        ))}
      </div>
    </div>
  );
}

function ReadingCanvasError({
  passage,
  error,
  onRetry,
}: {
  passage: string;
  error: string;
  onRetry: () => void;
}): React.JSX.Element {
  return (
    <section className="reading-state reading-state-message" role="alert" aria-labelledby="chapter-error-title">
      <span className="reading-state-kicker">Text unavailable</span>
      <h2 id="chapter-error-title">We couldn&apos;t open {passage}.</h2>
      <p>Try again, or choose another installed Bible text from the toolbar.</p>
      <button type="button" className="reading-state-action" onClick={onRetry}>Try again</button>
      <details className="reading-state-details">
        <summary>Technical details</summary>
        <code>{error}</code>
      </details>
    </section>
  );
}

function ReadingCanvasEmpty({ passage, onRetry }: { passage: string; onRetry: () => void }): React.JSX.Element {
  return (
    <section className="reading-state reading-state-message" role="status" aria-labelledby="chapter-empty-title">
      <span className="reading-state-kicker">No verses in this text</span>
      <h2 id="chapter-empty-title">{passage} is empty here.</h2>
      <p>Choose another installed Bible text from the toolbar, or check this text again.</p>
      <button type="button" className="reading-state-action" onClick={onRetry}>Check again</button>
    </section>
  );
}

function SearchIconSmall(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5l-4-4" />
    </svg>
  );
}

/**
 * Keeps its children mounted ~120ms after `show` flips false so the floating
 * highlight toolbar can play a short exit fade instead of vanishing in one
 * frame (the enter side already animates via hlPaletteIn). While leaving it
 * renders a snapshot of the last shown children — the live selection state is
 * usually already cleared by then — and disables pointer events via CSS.
 */
function PaletteExit({
  show,
  children,
}: {
  show: boolean;
  children: React.ReactNode;
}): React.JSX.Element | null {
  const [render, setRender] = useState(show);
  const lastChildren = useRef<React.ReactNode>(null);
  if (show) lastChildren.current = children;
  useEffect(() => {
    if (show) {
      setRender(true);
      return;
    }
    const t = setTimeout(() => setRender(false), 120);
    return () => clearTimeout(t);
  }, [show]);
  if (!render) return null;
  return (
    <div style={{ display: "contents" }} className={show ? undefined : "hl-palette-leaving"}>
      {show ? children : lastChildren.current}
    </div>
  );
}

export function ScripturePage({
  backbone,
  bookNames,
  navigateRef,
  onCreateNote: _onCreateNote,
  marginVisible,
  onAiBusyChange,
  theme = "light",
  onThemeChange,
  onToggleMargin,
  onPinnedRangeChange,
  readingSize = "m",
  readingWidth = "medium",
  verseNumbers = "always",
  onReadingPrefsChange,
  focusMode = false,
  onToggleFocus,
}: Props): React.JSX.Element {
  // Selection notes use the in-place NoteCapture slide-over (stay on Read).
  // Parent still supplies onCreateNote for a future “open full Write” path.
  void _onCreateNote;
  const [book, setBook] = useState("ACT");
  const [chapter, setChapter] = useState(19);
  const [packageId, setPackageId] = useState("bsb");
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<number>>(new Set());
  const [marginData, setMarginData] = useState<QueryResult>({ anchors: [], highlights: [], notes: [] });
  const [crossRefs, setCrossRefs] = useState<CrossReferenceResultData | null>(null);
  const [semanticData, setSemanticData] = useState<SemanticMarginResult | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  // x is the palette's horizontal CENTER (it's centered over the selection
  // via a CSS transform, not left-aligned); y is the anchor edge — the
  // selection's top when opening above (the common case) or its bottom when
  // flipped below for lack of room.
  const [palettePos, setPalettePos] = useState({ x: 0, y: 0, flipped: false });
  // Record ids of a just-created highlight — drives the left-to-right sweep-in
  // animation on the new blob. Keyed by highlight id (not verse number) so a
  // sweep can never leak onto a neighboring untouched highlight that happens
  // to share a verse. Cleared by handleHighlight's timer after the animation,
  // and on chapter change (below).
  const [animateIds, setAnimateIds] = useState<Set<string>>(new Set());
  // Record ids of a highlight mid-deletion — drives the fade-out on the blob.
  // Populated by handleDeleteHighlight, which deliberately keeps the highlight
  // in marginData for FADE_MS after issuing the delete so the blob has
  // something to fade from instead of just vanishing. Cleared once that timer
  // fires (and on chapter change, below).
  const [fadingIds, setFadingIds] = useState<Set<string>>(new Set());
  // A sub-verse (word/phrase) selection produced by dragging across text —
  // mutually exclusive with selectedVerses (setting one clears the other).
  // charStart/charEnd are half-open string offsets into the verse's text, or
  // null when the selection reaches that side of the verse's true boundary
  // (see rangeToVerseCharOffsets — this null-normalization is what lets the
  // selection bridge into an adjacent same-color verse like a whole-verse
  // highlight would).
  const [phraseSelection, setPhraseSelection] = useState<HighlightRange | null>(null);
  // Set on a mouseup that completed a real drag-selection, consumed by the
  // click handler that fires immediately after, so drag-residue clicks don't
  // collapse the phrase selection back to a whole-verse one.
  const suppressNextClickRef = useRef(false);
  // Whole-verse range selections are always contiguous. Shift extends from
  // this stable anchor; Command/Control-click intentionally behaves like a
  // normal click until discontiguous groups have an honest persistence model.
  const verseSelectionAnchorRef = useRef<number | null>(null);
  const [jumpText, setJumpText] = useState("");
  const [jumpError, setJumpError] = useState(false);
  const jumpInputRef = useRef<HTMLInputElement>(null);
  const [retryToken, setRetryToken] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // Passage picker popover state
  const [passageOpen, setPassageOpen] = useState(false);
  const [passageView, setPassageView] = useState<"chapters" | "books">("chapters");
  const [bookQuery, setBookQuery] = useState("");
  const [browseBook, setBrowseBook] = useState(book);
  const passageBtnRef = useRef<HTMLButtonElement>(null);
  const passageShouldReturnFocus = useRef(false);
  const [passageAnchor, setPassageAnchor] = useState<DOMRect | null>(null);
  const bookSearchRef = useRef<HTMLInputElement>(null);
  const [recents, setRecents] = useState<RecentPassage[]>([]);
  const recentsLoaded = useRef(false);
  // Gate for persisting/restoring the last-read passage: restore happens once
  // settings resolve; persistence only starts after that so the boot default
  // can never clobber the stored position. userNavigatedRef records that the
  // reader moved on their own before settings resolved (their choice wins).
  const lastReadLoaded = useRef(false);
  const userNavigatedRef = useRef(false);

  // Note capture slide-over (stays on Read — does not switch to Write tab)
  const [noteDraft, setNoteDraft] = useState<NoteCaptureDraft | null>(null);

  // Version picker popover state
  const [versionOpen, setVersionOpen] = useState(false);
  const versionBtnRef = useRef<HTMLButtonElement>(null);
  const versionShouldReturnFocus = useRef(false);
  const [versionAnchor, setVersionAnchor] = useState<DOMRect | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const chapterHeadingRef = useRef<HTMLHeadingElement>(null);
  const shouldFocusChapterHeading = useRef(false);
  const paletteRef = useRef<HTMLDivElement>(null);
  // The .verse-text container — the SVG highlight underlay is positioned
  // absolutely inside it (behind the verse rows). Measured each pass so the
  // blobs track reflow on resize, font load, and margin toggle.
  const verseTextRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // Verse nearest the reading eye-line — ambient Living Margin only.
  // Frozen while the pointer is over the margin or language study has locked
  // a verse (so side-panel clicks never "click out" to a different scroll position).
  const [nearVerse, setNearVerse] = useState<number | null>(null);
  const verseRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const marginActiveRef = useRef(false);
  const studyLockVerseRef = useRef<number | null>(null);

  // Full verse text for the current chapter, keyed by verse number — passed
  // down to the Living Margin for pinned-passage quotes and the passage-
  // scoped AI insight call, and used below to normalize highlight char
  // bounds against each verse's true length.
  const chapterVerseText = useMemo<Map<number, string>>(() => {
    const m = new Map<number, string>();
    for (const v of chapterData?.verses ?? []) m.set(v.verse, v.text);
    return m;
  }, [chapterData]);

  // Highlight character offsets are translation-specific. queryRange returns
  // every package for the canonical verse range, but all rendering, selection,
  // recolor, removal, and ambient-annotation logic must operate on only the
  // active text package. Whole-verse records stay package-scoped too so a
  // later phrase edit cannot accidentally merge cross-translation entities.
  const packageHighlights = useMemo(
    () => scopeHighlightsToPackage(marginData.highlights, packageId),
    [marginData.highlights, packageId],
  );

  // Highlight records, with char_start/char_end normalized to `null` (the
  // "unbounded" sentinel whole-verse highlights already use) whenever a
  // char-scoped record actually reaches its verse's true start (0) or end
  // (the verse's full text length). This isn't cosmetic: the blob-adjacency
  // logic (highlightAdjacency.ts) looks for that null sentinel specifically
  // to decide whether a highlight bridges into an adjacent same-color verse.
  // New phrase selections are already normalized at creation time
  // (rangeToVerseCharOffsets), but highlights created before that fix shipped
  // — or restored from an older snapshot — still have a literal number
  // (e.g. char_end: 78 where the verse is exactly 78 characters) instead of
  // null, which would otherwise silently fail to bridge even though there's
  // no actual gap of unhighlighted text. Normalizing here, at the one shared
  // read point every adjacency-sensitive consumer (the renderer, and the
  // recolor/remove blob-extent walk) draws from, fixes old data too, with no
  // migration step.
  const normalizedHighlights = useMemo<HighlightRecord[]>(() => {
    if (chapterVerseText.size === 0) return packageHighlights;
    return packageHighlights.map((h) => {
      if (h.char_start == null && h.char_end == null) return h;
      const endText = chapterVerseText.get(h.verse_end);
      const charStart = h.char_start === 0 ? null : h.char_start;
      const charEnd = h.char_end != null && endText != null && h.char_end >= endText.length ? null : h.char_end;
      if (charStart === h.char_start && charEnd === h.char_end) return h;
      return { ...h, char_start: charStart, char_end: charEnd };
    });
  }, [packageHighlights, chapterVerseText]);

  // Notes and anchors use canonical scripture coordinates and remain shared
  // across translations. Only the highlight collection is package-specific.
  // Passing this scoped view to Living Margin keeps its counts, swatches, and
  // remove/recolor actions aligned with the layer visible on the page.
  const packageMarginData = useMemo<QueryResult>(() => ({
    ...marginData,
    highlights: normalizedHighlights,
  }), [marginData, normalizedHighlights]);

  // Verse numbers whose highlight coverage reaches both sides of a verse
  // boundary — backs the "cont-below"/"cont-above" row classes
  // below, which collapse the visual gap between two consecutive verse rows.
  // This MUST use the same char-aware isAdjacent predicate the SVG underlay
  // uses, not a plain "do these two verses happen to show the same color"
  // check: two same-color highlights can be genuinely separate blobs (e.g. a
  // whole verse followed by a next-verse phrase that doesn't start at char
  // 0), and collapsing the row gap between them would visually press two
  // distinct, separately-rounded shapes together — the same class of bug the
  // isAdjacent fix above was for, one layer up in the CSS.
  const verseBridges = useMemo<Set<number>>(() => {
    const bridges = new Set<number>();
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    const segments = buildSegments(activeHere);
    for (const a of segments) {
      for (const b of segments) {
        if (b.verse === a.verse + 1 && isAdjacent(a, b)) {
          bridges.add(a.verse);
        }
      }
    }
    return bridges;
  }, [normalizedHighlights, book, chapter]);

  // The book+chapter actually on screen right now, kept in sync every
  // render. reloadMarginHighlights (fired from highlight create/delete/undo)
  // reads this to detect when its own fetch has become stale — e.g. the user
  // navigated to a different chapter while a highlight action's confirmation
  // fetch, or the delete fade-out's 320ms delay, was still in flight. Without
  // this check, that late response would silently overwrite the correctly-
  // loaded data for whatever chapter is actually showing with old data for
  // wherever the user used to be.
  const currentChapterKeyRef = useRef(`${book}:${chapter}`);
  useEffect(() => {
    currentChapterKeyRef.current = `${book}:${chapter}`;
  }, [book, chapter]);

  useEffect(() => {
    if (navigateRef) {
      setBook(navigateRef.book);
      setChapter(navigateRef.chapter);
    }
  }, [navigateRef]);

  // Load chapter text
  useEffect(() => {
    let cancelled = false;
    setChapterData(null);
    setChapterError(null);
    safeCall(() => window.api.scripture.getChapterText(packageId, book, chapter)).then((res) => {
      if (cancelled) return;
      if (res.ok) setChapterData(res.value); else setChapterError(res.error);
    });
    return () => { cancelled = true; };
  }, [book, chapter, packageId, retryToken]);

  // Phase 1: Load deterministic margin data (fast)
  useEffect(() => {
    let cancelled = false;
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) {
      setMarginData({ anchors: [], highlights: [], notes: [] });
      setCrossRefs(null);
      return () => {
        cancelled = true;
      };
    }

    // Keep verse highlight classes current even when the Living Margin is hidden.
    safeCall(() => window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount)).then((res) => {
      if (!cancelled && res.ok) setMarginData(res.value);
    });

    if (!marginVisible) {
      setCrossRefs(null);
      return () => {
        cancelled = true;
      };
    }

    return () => {
      cancelled = true;
    };
  }, [book, chapter, backbone, marginVisible]);

  // Phase 2: Load semantic margin (slow, non-blocking)
  useEffect(() => {
    let cancelled = false;
    if (!marginVisible) {
      setSemanticLoading(false);
      setSemanticData(null);
      return () => {
        cancelled = true;
      };
    }

    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0 || !chapterData) return () => { cancelled = true; };

    setSemanticData(null);
    const passageText = chapterData.verses.map((v) => v.text).join(" ");
    if (!passageText) {
      setSemanticLoading(false);
      return;
    }

    const timer = window.setTimeout(() => {
      if (cancelled) return;
      setSemanticLoading(true);
      safeCall(() => window.api.ai.semanticMargin({
        book,
        startChapter: chapter,
        startVerse: 1,
        endChapter: chapter,
        endVerse: verseCount,
        passageText,
      })).then((res) => {
        if (cancelled) return;
        setSemanticData(res.ok ? res.value : null);
        setSemanticLoading(false);
      });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [book, chapter, backbone, chapterData, marginVisible]);

  // Notify the host shell whenever the AI-busy state changes (drives the
  // sidebar footer's "Analyzing passage..." indicator).
  useEffect(() => {
    onAiBusyChange?.(semanticLoading);
  }, [semanticLoading, onAiBusyChange]);

  const bookData = backbone.books[book];
  const chapterCount = bookData?.chapters.length ?? 0;
  const displayBookName = bookNames[book]?.[0] ?? book;

  // Load recents once from persisted settings — and restore the last-read
  // passage, so launch resumes where the reader left off instead of always
  // opening the hardcoded boot default. Only applies while the reader is
  // still at that default (a fast user jump before settings resolve wins).
  useEffect(() => {
    let cancelled = false;
    safeCall(() => window.api.settings.get()).then((res) => {
      if (cancelled || !res.ok) return;
      setRecents(normalizeRecents(res.value.recentPassages));
      recentsLoaded.current = true;

      const last = res.value.lastRead;
      if (
        last &&
        !userNavigatedRef.current &&
        backbone.books[last.book] &&
        last.chapter >= 1 &&
        last.chapter <= (backbone.books[last.book]?.chapters.length ?? 0)
      ) {
        setBook(last.book);
        setChapter(last.chapter);
        if (last.packageId) setPackageId(last.packageId);
      }
      lastReadLoaded.current = true;
    });
    return () => {
      cancelled = true;
    };
  }, [backbone]);

  // Persist last-read on every passage change (after the initial restore, so
  // the boot default never overwrites a stored position).
  useEffect(() => {
    if (!lastReadLoaded.current) return;
    void safeCall(() =>
      window.api.settings.set({ lastRead: { book, chapter, packageId } }),
    );
  }, [book, chapter, packageId]);

  // Persist recents after the initial load (never write empty defaults over disk).
  useEffect(() => {
    if (!recentsLoaded.current) return;
    void safeCall(() => window.api.settings.set({ recentPassages: recents }));
  }, [recents]);

  const recordRecent = useCallback(
    (b: string, c: number, verse?: number, pkg: string = packageId) => {
      setRecents((prev) =>
        pushRecent(prev, {
          book: b,
          chapter: c,
          verse,
          packageId: pkg,
          visitedAt: Date.now(),
        }),
      );
    },
    [packageId],
  );

  // Atomic navigation: set book+chapter together in one render so only a
  // single getChapterText fetch happens (avoids the intermediate chapter-1 load).
  // An optional verse is remembered in a ref (not state) so the chapter-change
  // reset effect below can tell "this navigation deliberately wants verse N
  // selected" apart from "this is a plain chapter change, clear any stale
  // selection" — otherwise that effect (which must keep running for prev/next
  // arrows and keyboard nav) would wipe the selection right back out in the
  // same commit.
  //
  // `recordRecent` defaults true for jumps/picker/xrefs; prev/next arrows call
  // setChapter directly so sequential reading does not flood the recents list.
  const pendingVerseSelectRef = useRef<number | null>(null);
  const pendingVerseEndRef = useRef<number | null>(null);
  const goTo = useCallback(
    (b: string, c: number, verse?: number, opts?: { recordRecent?: boolean; rangeEnd?: number }) => {
      userNavigatedRef.current = true;
      pendingVerseSelectRef.current = verse ?? null;
      pendingVerseEndRef.current = opts?.rangeEnd ?? null;
      setBook(b);
      setChapter(c);
      if (b === book && c === chapter) {
        pendingVerseSelectRef.current = null;
        pendingVerseEndRef.current = null;
        verseSelectionAnchorRef.current = verse ?? null;
        setSelectedVerses(verse
          ? new Set(Array.from(
              { length: Math.max(1, (opts?.rangeEnd ?? verse) - verse + 1) },
              (_, index) => verse + index,
            ))
          : new Set());
        setPhraseSelection(null);
        setShowHighlightPalette(false);
      }
      if (opts?.recordRecent !== false) {
        recordRecent(b, c, verse);
      }
    },
    [book, chapter, recordRecent],
  );

  // Cross-reference click-through. Canonical bref targets preserve same-
  // chapter destination ranges as a pinned selection; note-derived display
  // strings retain the existing passage-parser fallback.
  const handleNavigateToRef = useCallback((ref: string) => {
    const canonical = /^bref:v1\/([1-3A-Z]{3})\.(\d+)\.(\d+)(?:-([1-3A-Z]{3})\.(\d+)\.(\d+))?$/.exec(ref);
    if (canonical) {
      const [, startBook, startChapterText, startVerseText, endBook, endChapterText, endVerseText] = canonical;
      const startChapter = Number(startChapterText);
      const startVerse = Number(startVerseText);
      const sameChapterRangeEnd = endBook === startBook && Number(endChapterText) === startChapter
        ? Number(endVerseText)
        : undefined;
      goTo(startBook!, startChapter, startVerse, { rangeEnd: sameChapterRangeEnd });
      return;
    }
    let result = parsePassage(ref, bookNames, backbone);
    if (!result.ok) {
      const stripped = ref.replace(/[-–]\s*\d+\s*$/, "");
      if (stripped !== ref) result = parsePassage(stripped, bookNames, backbone);
    }
    if (!result.ok) return;
    goTo(result.value.book, result.value.chapter, result.value.verse);
  }, [bookNames, backbone, goTo]);

  // Scroll shadow: add a class to the topbar once the reading column has
  // scrolled past its top, removing it once scrolled back to the top.
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const handler = () => setScrolled(el.scrollTop > 0);
    handler();
    el.addEventListener("scroll", handler);
    return () => el.removeEventListener("scroll", handler);
  }, []);

  // A chapter is a new reading surface, not the continuation of the previous
  // scroll position. Keep every navigation path deterministic; the explicit
  // chapter-end continuation additionally moves focus to the new landmark.
  useEffect(() => {
    if (contentRef.current) contentRef.current.scrollTop = 0;
    setScrolled(false);
    if (!shouldFocusChapterHeading.current) return;
    shouldFocusChapterHeading.current = false;
    chapterHeadingRef.current?.focus();
  }, [book, chapter, packageId]);

  // Keep the passage-picker's book-browsing view in sync with the current book.
  useEffect(() => {
    setBrowseBook(book);
  }, [book]);

  const closePassagePopover = useCallback(() => {
    passageShouldReturnFocus.current = true;
    setPassageOpen(false);
    setPassageView("chapters");
    setBookQuery("");
  }, []);

  useEffect(() => {
    if (passageOpen || !passageShouldReturnFocus.current) return;
    passageShouldReturnFocus.current = false;
    passageBtnRef.current?.focus();
  }, [passageOpen]);

  const openPassagePopover = () => {
    if (passageBtnRef.current) setPassageAnchor(passageBtnRef.current.getBoundingClientRect());
    setPassageView("chapters");
    setBrowseBook(book);
    setPassageOpen(true);
  };

  const openBooksView = () => {
    setPassageView("books");
    setBookQuery("");
  };

  // Autofocus the book search input whenever the books view opens.
  useEffect(() => {
    if (passageOpen && passageView === "books") {
      bookSearchRef.current?.focus();
    }
  }, [passageOpen, passageView]);

  const handleBookPick = (b: string) => {
    // Chosen behavior (Part A): a book click switches back to the chapter
    // grid for that book rather than navigating immediately — see openIssues.
    setBrowseBook(b);
    setPassageView("chapters");
  };

  const closeVersionPopover = useCallback(() => {
    versionShouldReturnFocus.current = true;
    setVersionOpen(false);
  }, []);

  useEffect(() => {
    if (versionOpen || !versionShouldReturnFocus.current) return;
    versionShouldReturnFocus.current = false;
    versionBtnRef.current?.focus();
  }, [versionOpen]);

  const openVersionPopover = () => {
    if (versionBtnRef.current) setVersionAnchor(versionBtnRef.current.getBoundingClientRect());
    setVersionOpen(true);
  };

  // Book search: full names, aliases, codes (ACT), compact abbreviations (1co, rev).
  const matchesQuery = (code: string) => {
    const q = bookQuery.trim().toLowerCase().replace(/\s+/g, "");
    if (!q) return true;
    if (code.toLowerCase().includes(q)) return true;
    const names = bookNames[code] ?? [];
    for (const name of names) {
      const n = name.toLowerCase();
      if (n.includes(bookQuery.trim().toLowerCase())) return true;
      const compact = n.replace(/[\s.]+/g, "");
      if (compact.includes(q) || compact.startsWith(q)) return true;
      // Leading initials: "1 Corinthians" → "1c", "song of songs" → "sos"
      const initials = n
        .split(/[\s.]+/)
        .filter(Boolean)
        .map((w, i) => (i === 0 && /^\d/.test(w) ? w : w[0] ?? ""))
        .join("");
      if (initials.startsWith(q) || initials === q) return true;
    }
    return false;
  };
  const filteredOt = OT_BOOKS.filter(matchesQuery);
  const filteredNt = NT_BOOKS.filter(matchesQuery);
  const browseBookName = bookNames[browseBook]?.[0] ?? browseBook;

  // Derived pinned whole-verse envelope. Precise phrase selections keep their
  // nearby floating toolbar even when the margin is open, so the margin does
  // not duplicate controls for a character range it cannot display exactly.
  const pinnedRange = useMemo<PinnedRange | null>(() => {
    if (selectedVerses.size === 0) return null;
    const vals = [...selectedVerses];
    return { start: Math.min(...vals), end: Math.max(...vals) };
  }, [selectedVerses]);

  useEffect(() => {
    onPinnedRangeChange?.(pinnedRange);
  }, [pinnedRange, onPinnedRangeChange]);

  // Cross-references follow the actual reading scope: exact verse when the
  // eye-line is ambient, selected range when pinned, full chapter only for the
  // overview. Passage aggregation and top-N ranking happen in pure core code.
  useEffect(() => {
    if (!marginVisible) {
      setCrossRefs(null);
      return;
    }
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) {
      setCrossRefs(null);
      return;
    }
    const startVerse = pinnedRange?.start ?? nearVerse ?? 1;
    const endVerse = pinnedRange?.end ?? nearVerse ?? verseCount;
    let cancelled = false;
    setCrossRefs(null);
    safeCall(() => window.api.scripture.getCrossRefsForPassage(
      book,
      chapter,
      startVerse,
      endVerse,
      packageId,
    )).then((result) => {
      if (!cancelled && result.ok) setCrossRefs(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [backbone, book, chapter, marginVisible, nearVerse, packageId, pinnedRange]);

  // Reload margin data after highlight changes
  const reloadMarginHighlights = useCallback(async () => {
    const requestBook = book;
    const requestChapter = chapter;
    const verseCount = backbone.books[requestBook]?.chapters[requestChapter - 1] ?? 0;
    if (verseCount === 0) return;
    const res = await safeCall(() =>
      window.api.library.queryRange(requestBook, requestChapter, 1, requestBook, requestChapter, verseCount),
    );
    if (!res.ok) return;
    // The user may have navigated to a different chapter while this fetch
    // was in flight (this function is called from highlight create/delete/
    // undo handlers, including from a 320ms-delayed timeout for the delete
    // fade-out and from undo toasts that can be clicked long after
    // navigating away) — bail rather than clobber the current chapter's
    // already-correct data with a stale response for the one we left.
    if (currentChapterKeyRef.current !== `${requestBook}:${requestChapter}`) return;
    setMarginData((prev) => {
      // Skip the update — and the fresh-object identity churn it would
      // otherwise cause on every consumer keyed on marginData.highlights,
      // notably the highlight underlay's re-measure — when the refetched
      // data is identical to what's already showing. This fires on every
      // highlight create/delete/undo, often when nothing about this
      // chapter's OTHER highlights actually changed.
      if (JSON.stringify(prev) === JSON.stringify(res.value)) return prev;
      return res.value;
    });
  }, [book, chapter, backbone]);

  // Click-outside to dismiss palette.
  // CRITICAL: clicks inside the Living Margin are language-study interactions
  // (lemma chips, form/STEP expand). Treating them as "outside" used to clear
  // the verse pin → ambient eye-line retook the margin (often Acts 19:10) and
  // felt like a click-off. Margin clicks only hide the floating toolbar.
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (paletteRef.current?.contains(target)) return;

      const el = target instanceof Element ? target : target.parentElement;
      if (el?.closest(".living-margin")) {
        setShowHighlightPalette(false);
        return;
      }

      setShowHighlightPalette(false);
      setSelectedVerses(new Set());
      setPhraseSelection(null);
      verseSelectionAnchorRef.current = null;
      studyLockVerseRef.current = null;
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHighlightPalette]);

  // Escape dismisses palette chrome; keeps verse pin so study can continue.
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowHighlightPalette(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [showHighlightPalette]);

  // Keyboard navigation: prev/next chapter
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
      if ((e.metaKey || e.ctrlKey) && e.key === "ArrowLeft") {
        e.preventDefault();
        if (chapter > 1) {
          userNavigatedRef.current = true;
          setChapter(chapter - 1);
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight") {
        e.preventDefault();
        if (chapter < chapterCount) {
          userNavigatedRef.current = true;
          setChapter(chapter + 1);
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chapter, chapterCount]);

  // Command/Ctrl+K is the stable "go somewhere" shortcut inside Read. It
  // focuses the passage field without competing with the unmodified 1–5 app
  // navigation or Command+Arrow chapter movement.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "k") return;
      e.preventDefault();
      jumpInputRef.current?.focus();
      jumpInputRef.current?.select();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Positions the floating highlight palette over the actual selection —
  // not a single clicked row's far edge, which is what this used to key off
  // (a verse row spans nearly the full reading column, so anchoring to its
  // *right* edge routinely put the palette way off to the right of where the
  // user actually clicked, and off-screen entirely on a wide window with the
  // margin closed). This centers over the full selected range and clamps to
  // the viewport, flipping below the selection when there isn't room above.
  // Shared positioner: given a viewport-relative bounding box of whatever the
  // palette should point at (a set of verse rows, or a phrase selection's
  // rects), center over it, clamp to the viewport, and flip below when there
  // isn't room above.
  const positionPaletteForBox = useCallback((box: { top: number; bottom: number; left: number; right: number }) => {
    const centerX = (box.left + box.right) / 2;
    // The palette's actual width varies slightly (the remove button only
    // shows when the selection already has a highlight), but not enough to
    // warrant a measure-then-reposition pass — clamping against a generous
    // estimate keeps it clear of the window edges either way.
    const HALF_WIDTH_ESTIMATE = 155;
    const EDGE_GAP = 12;
    const x = Math.min(
      Math.max(centerX, HALF_WIDTH_ESTIMATE + EDGE_GAP),
      window.innerWidth - HALF_WIDTH_ESTIMATE - EDGE_GAP,
    );
    const GAP = 10;
    const PALETTE_HEIGHT_ESTIMATE = 44;
    const flipped = box.top - PALETTE_HEIGHT_ESTIMATE - GAP < 0;
    setPalettePos({ x, y: flipped ? box.bottom + GAP : box.top - GAP, flipped });
  }, []);

  // Positions the floating highlight palette over the actual selection —
  // not a single clicked row's far edge, which is what this used to key off
  // (a verse row spans nearly the full reading column, so anchoring to its
  // *right* edge routinely put the palette way off to the right of where the
  // user actually clicked, and off-screen entirely on a wide window with the
  // margin closed).
  const positionPalette = useCallback((selection: Set<number>) => {
    const rects = [...selection]
      .map((v) => verseRowRefs.current.get(v))
      .filter((el): el is HTMLDivElement => !!el)
      .map((el) => el.getBoundingClientRect());
    if (rects.length === 0) return;
    positionPaletteForBox({
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
    });
  }, [positionPaletteForBox]);

  // Locate the DOM node + offset for a character offset into a verse span,
  // walking all text nodes (robust to future markup splitting the span).
  const locateCharOffset = useCallback((span: HTMLElement, charOffset: number): { node: Node; offset: number } | null => {
    const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent?.length ?? 0;
      if (acc + len >= charOffset) return { node, offset: charOffset - acc };
      acc += len;
      node = walker.nextNode();
    }
    return null;
  }, []);

  // Rebuild a DOM Range for a stored phrase selection (used to reposition its
  // palette on resize, where the original native Range is long gone).
  const buildPhraseRange = useCallback((sel: HighlightRange): Range | null => {
    const startSpan = verseRowRefs.current.get(sel.verseStart)?.querySelector<HTMLElement>(".verse-text-span");
    const endSpan = verseRowRefs.current.get(sel.verseEnd)?.querySelector<HTMLElement>(".verse-text-span");
    if (!startSpan || !endSpan) return null;
    const endTotal = endSpan.textContent?.length ?? 0;
    const s = locateCharOffset(startSpan, sel.charStart ?? 0);
    const e = locateCharOffset(endSpan, sel.charEnd ?? endTotal);
    if (!s || !e) return null;
    const range = document.createRange();
    range.setStart(s.node, s.offset);
    range.setEnd(e.node, e.offset);
    return range;
  }, [locateCharOffset]);

  const positionPaletteForRange = useCallback((range: Range) => {
    const rects = Array.from(range.getClientRects());
    if (rects.length === 0) return;
    positionPaletteForBox({
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
    });
  }, [positionPaletteForBox]);

  const verseSpanForNode = useCallback((node: Node, container: HTMLElement): HTMLElement | null => {
    let current: Node | null = node;
    while (current && current !== container) {
      if (current instanceof HTMLElement && current.classList.contains("verse-text-span")) return current;
      current = current.parentNode;
    }
    return null;
  }, []);

  const verseNumberForSpan = useCallback((span: HTMLElement): number | null => {
    const value = Number(span.closest<HTMLElement>(".verse-line[data-verse]")?.dataset.verse);
    return Number.isFinite(value) ? value : null;
  }, []);

  // A completed native drag becomes one exact continuous highlight range. The
  // first and last verse retain character offsets; every verse between them is
  // implicitly covered in full by the shared range model.
  const handleTextMouseUp = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    const container = verseTextRef.current;
    if (!container || !container.contains(range.commonAncestorContainer)) return;

    const startSpan = verseSpanForNode(range.startContainer, container);
    const endSpan = verseSpanForNode(range.endContainer, container);
    if (!startSpan || !endSpan) return;
    const verseStart = verseNumberForSpan(startSpan);
    const verseEnd = verseNumberForSpan(endSpan);
    if (verseStart == null || verseEnd == null || verseEnd < verseStart) return;

    let charStart: number | null;
    let charEnd: number | null;
    if (startSpan === endSpan) {
      const offsets = rangeToVerseCharOffsets(range, startSpan);
      if (!offsets) return;
      charStart = offsets.start;
      charEnd = offsets.end;
    } else {
      const first = document.createRange();
      first.selectNodeContents(startSpan);
      first.setStart(range.startContainer, range.startOffset);
      const firstOffsets = rangeToVerseCharOffsets(first, startSpan);

      const last = document.createRange();
      last.selectNodeContents(endSpan);
      last.setEnd(range.endContainer, range.endOffset);
      const lastOffsets = rangeToVerseCharOffsets(last, endSpan);
      if (!firstOffsets || !lastOffsets) return;
      charStart = firstOffsets.start;
      charEnd = lastOffsets.end;
    }

    suppressNextClickRef.current = true;
    verseSelectionAnchorRef.current = null;
    setSelectedVerses(new Set());
    setPhraseSelection({ verseStart, verseEnd, charStart, charEnd });
    positionPaletteForRange(range);
    setShowHighlightPalette(true);
  }, [positionPaletteForRange, verseNumberForSpan, verseSpanForNode]);

  // NOTE on why these compute `next` from `selectedVerses` directly instead
  // of via a setSelectedVerses(prev => ...) functional updater: this used to
  // be a functional updater, with the computed set captured into a local
  // variable read immediately after for palette positioning. That's unsound
  // — React does not guarantee an updater callback runs synchronously before
  // the next line of the handler executes (it sometimes computes state
  // eagerly at the call site as an optimization, sometimes defers it to the
  // render phase depending on what else is pending), so the "immediately
  // after" read was sometimes stale (still the pre-click empty set),
  // silently skipping the palette. Reading `selectedVerses` from the render
  // closure and listing it as a dependency is both synchronously readable
  // and correct, since the callback is recreated whenever it changes.
  const handleVerseClick = useCallback((verse: number, event: React.MouseEvent) => {
    // A drag-selection's trailing click is residue — the mouseup handler
    // already turned it into a phrase selection. Consume the flag and no-op.
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    // Explicit verse pick takes over from ambient study-lock.
    studyLockVerseRef.current = null;
    // A whole-verse click always supersedes any active phrase selection.
    setPhraseSelection(null);
    const result = nextVerseSelection(selectedVerses, verseSelectionAnchorRef.current, verse, event.shiftKey);
    const next = result.selection;
    verseSelectionAnchorRef.current = result.anchor;
    setSelectedVerses(next);

    if (next.size > 0) {
      positionPalette(next);
      setShowHighlightPalette(true);
    } else {
      setShowHighlightPalette(false);
    }
  }, [selectedVerses, positionPalette]);

  // Keyboard equivalent of handleVerseClick for keyboard users: Enter/Space
  // toggles selection and opens the highlight palette on the focused verse.
  // Shift+Enter extends the range (matching shift-click), matching the
  // existing pointer interaction model. Reuses the same positioning logic so
  // the palette appears in the same spot a click would put it.
  const handleVerseKeyDown = useCallback((verse: number, event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey && !event.altKey) {
      const verses = chapterData?.verses ?? [];
      const index = verses.findIndex((item) => item.verse === verse);
      let targetVerse: number | null = null;
      if (event.key === "ArrowUp" && index > 0) targetVerse = verses[index - 1]!.verse;
      if (event.key === "ArrowDown" && index >= 0 && index < verses.length - 1) targetVerse = verses[index + 1]!.verse;
      if (event.key === "Home" && verses.length > 0) targetVerse = verses[0]!.verse;
      if (event.key === "End" && verses.length > 0) targetVerse = verses[verses.length - 1]!.verse;
      if (targetVerse != null) {
        event.preventDefault();
        verseRowRefs.current.get(targetVerse)?.focus();
        return;
      }
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    studyLockVerseRef.current = null;
    setPhraseSelection(null);
    const result = nextVerseSelection(selectedVerses, verseSelectionAnchorRef.current, verse, event.shiftKey);
    const next = result.selection;
    verseSelectionAnchorRef.current = result.anchor;
    setSelectedVerses(next);

    if (next.size > 0) {
      positionPalette(next);
      setShowHighlightPalette(true);
    } else {
      setShowHighlightPalette(false);
    }
  }, [chapterData, selectedVerses, positionPalette]);

  // Re-anchor the palette on window resize AND on scroll — its position is
  // computed from viewport-relative rects at the moment it opens, which go
  // stale the instant the window (or the margin toggling) changes the layout,
  // and the toolbar is position:fixed, so scrolling the reading column used
  // to leave it hanging in mid-air over unrelated text. The scroll listener
  // is capture-phase so it hears the inner .scripture-content scroller.
  // Handles both a whole-verse selection and a phrase selection (rebuilding
  // the phrase's range from its stored offsets).
  useEffect(() => {
    if (!showHighlightPalette) return;
    if (selectedVerses.size === 0 && !phraseSelection) return;
    const handler = () => {
      if (phraseSelection) {
        const range = buildPhraseRange(phraseSelection);
        if (range) positionPaletteForRange(range);
      } else {
        positionPalette(selectedVerses);
      }
    };
    window.addEventListener("resize", handler);
    window.addEventListener("scroll", handler, true);
    return () => {
      window.removeEventListener("resize", handler);
      window.removeEventListener("scroll", handler, true);
    };
  }, [showHighlightPalette, selectedVerses, phraseSelection, positionPalette, positionPaletteForRange, buildPhraseRange]);

  const undoHighlightChange = (changeId: string) => {
    void safeCall(() => window.api.library.undoHighlightChange(changeId)).then(async (result) => {
      if (!result.ok || !result.value.ok) {
        showToast(result.ok ? result.value.error ?? "Undo failed" : result.error);
      }
      await reloadMarginHighlights();
    });
  };

  const handleHighlight = async (color: string) => {
    // A phrase drag is a PRECISE gesture — it applies the color to exactly its
    // character range and trims whatever it overlaps (standard highlighter
    // behavior). A whole-verse click is a COARSE gesture — it operates on the
    // whole visual blob (recolor/remove the passage as one unit). This is the
    // clean split: honor the granularity the user selected at.
    const isPhrase = phraseSelection != null;
    const target: HighlightRange | null = phraseSelection
      ? phraseSelection
      : (() => {
          const sorted = [...selectedVerses].sort((a, b) => a - b);
          if (sorted.length === 0) return null;
          return { verseStart: sorted[0]!, verseEnd: sorted[sorted.length - 1]!, charStart: null as number | null, charEnd: null as number | null };
        })();
    if (!target) return;

    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    const touched = activeHere.filter((h) => isHighlightOverlap(h, target));

    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;

    // Whole-blob recolor only applies to a SINGLE-verse click landing on an
    // existing highlight ("I clicked into this blob to manage it"). A genuine
    // multi-verse range selection (shift-click spanning several verses) means
    // "highlight exactly this range" — it must always create over the FULL
    // selected range below, even if verse one of the range already happened to
    // carry some other highlight. Treating any touched record as "recolor
    // that blob using ITS OWN extent" (as this used to, unconditionally) threw
    // away the rest of a multi-verse selection whenever its first verse
    // collided with something pre-existing — only that one verse ever got the
    // new color; the verses after it were silently skipped.
    const isSingleVerseClick = !isPhrase && selectedVerses.size === 1;

    if (isSingleVerseClick && touched.length > 0) {
      // Single-verse click landing on an existing highlight: recolor the full
      // connected visual blob(s) in place. One grouped IPC gives the edit one
      // exact before/after snapshot and therefore one safe Undo token.
      const blobIds = new Set<string>();
      for (const t of touched) for (const id of resolveBlobExtent(activeHere, t.id)) blobIds.add(id);
      const blobRecords = activeHere.filter((h) => blobIds.has(h.id));
      if (blobRecords.every((h) => h.color === color)) return; // already this color

      const recolor = await safeCall(() => window.api.library.recolorHighlights(
        book, chapter, packageId, [...blobIds], color,
      ));
      if (recolor.ok && recolor.value.ok) {
        if (recolor.value.changeId) showToast("Highlight color changed", "Undo", () => undoHighlightChange(recolor.value.changeId!));
      } else {
        showToast(recolor.ok ? recolor.value.error ?? "Failed to recolor highlight" : recolor.error);
      }
      await reloadMarginHighlights();
      return;
    }

    // CREATE path: a fresh highlight, a phrase applied over existing text, or
    // a genuine multi-verse range selection. Always creates over the user's
    // FULL selected range (target.verseStart..verseEnd) — never just whatever
    // happened to already be highlighted within it. The backend supersedes
    // anything underneath by subtracting this exact endpoint-aware range;
    // unaffected characters and outer verses survive as remainders. Optimistic
    // render + sweep only when
    // there's no overlap at all (a clean fresh highlight) — otherwise the
    // optimistic add would flash both the new and the not-yet-resolved old
    // highlight until the reload corrects it.
    const optimistic = touched.length === 0;
    if (optimistic) {
      setMarginData((prev) => ({
        ...prev,
        highlights: [
          ...prev.highlights,
          {
            id: "temp", book, chapter,
            verse_start: target.verseStart, verse_end: target.verseEnd,
            package: packageId, char_start: target.charStart, char_end: target.charEnd,
            color, kind: "highlight", note_id: null, deleted: 0,
          },
        ],
      }));
      setAnimateIds(new Set(["temp"]));
    }

    const res = await safeCall(() => window.api.library.createHighlight(
      book, chapter, target.verseStart, target.verseEnd, color, packageId, target.charStart, target.charEnd,
    ));

    if (res.ok && res.value.ok) {
      const hlId = res.value.highlightId ?? "";
      // Transfer the sweep token from the optimistic temp id to the real id so
      // the sweep survives the reload's id swap instead of being cut off.
      setAnimateIds(new Set([hlId]));
      if (res.value.changeId) showToast("Highlight created", "Undo", () => undoHighlightChange(res.value.changeId!));
      await reloadMarginHighlights();
      // Clear this id after the sweep would have finished so a later unrelated
      // re-measure (resize, other edits) doesn't replay it.
      window.setTimeout(() => {
        setAnimateIds((prev) => {
          if (!prev.has(hlId)) return prev;
          const next = new Set(prev);
          next.delete(hlId);
          return next;
        });
      }, SWEEP_MS);
    } else {
      showToast("Failed to create highlight");
      setAnimateIds(new Set());
      await reloadMarginHighlights(); // Revert optimistic update
    }
  };

  const handleDeleteHighlights = async (entityIds: string[]) => {
    const requestKey = `${book}:${chapter}`;
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    // Whole-verse/pinned removal is deliberately coarse: every explicitly
    // touched connected blob is one perceived highlight unit.
    const blobIdSet = new Set<string>();
    for (const entityId of entityIds) {
      for (const id of resolveBlobExtent(activeHere, entityId)) blobIdSet.add(id);
    }
    const blobIds = [...blobIdSet];
    const targets = activeHere.filter((h) => blobIds.includes(h.id));
    if (targets.length === 0) return;

    // Fade every record in the blob at once. marginData still holds them, so
    // the underlay keeps rendering their blob (now fading) instead of it
    // vanishing instantly.
    setFadingIds((prev) => new Set([...prev, ...blobIds]));
    const clearFading = () => {
      setFadingIds((prev) => {
        const next = new Set(prev);
        for (const id of blobIds) next.delete(id);
        return next;
      });
    };

    const result = await safeCall(() => window.api.library.deleteHighlights(
      book, chapter, packageId, blobIds,
    ));
    if (result.ok && result.value.ok) {
      if (result.value.changeId) {
        showToast(targets.length === 1 ? "Highlight removed" : `${targets.length} highlights removed`, "Undo", () => {
          undoHighlightChange(result.value.changeId!);
        });
      }
      // Let the fade-out play (styles.css .hl-fade-out, FADE_MS) before the
      // records leave local data. Critically, AWAIT the reload before clearing
      // the fade flags: if the flags cleared while marginData still held the
      // records, the underlay would recompute them as fully-opaque live
      // highlights and the blob would snap back from faded to solid — the
      // "still showing after delete" bug. Reload-first guarantees the records
      // are already gone (no blob built for them) before we touch the flags.
      window.setTimeout(() => {
        void (async () => {
          await reloadMarginHighlights();
          if (currentChapterKeyRef.current === requestKey) clearFading();
        })();
      }, FADE_MS);
    } else {
      showToast(result.ok ? result.value.error ?? "Failed to remove highlight" : result.error);
      clearFading();
    }
  };

  const handleRemoveSelection = async () => {
    const phrase = phraseSelection;
    const touched = touchedHighlights();
    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;

    if (phrase) {
      const result = await safeCall(() => window.api.library.eraseHighlightRange(
        book,
        chapter,
        phrase.verseStart,
        phrase.verseEnd,
        packageId,
        phrase.charStart,
        phrase.charEnd,
      ));
      if (result.ok && result.value.ok) {
        if (result.value.changeId) showToast("Removed from highlight", "Undo", () => undoHighlightChange(result.value.changeId!));
      } else {
        showToast(result.ok ? result.value.error ?? "Failed to remove selection" : result.error);
      }
      await reloadMarginHighlights();
      return;
    }

    await handleDeleteHighlights(touched.map((highlight) => highlight.id));
  };

  const handleNoteFromSelection = () => {
    let verseStart: number;
    let verseEnd: number;
    let phraseQuote: string | null = null;

    if (phraseSelection) {
      verseStart = phraseSelection.verseStart;
      verseEnd = phraseSelection.verseEnd;
      // Prefer the actual selected span when it lives in a single verse.
      if (
        phraseSelection.verseStart === phraseSelection.verseEnd &&
        phraseSelection.charStart != null &&
        phraseSelection.charEnd != null
      ) {
        const full = chapterVerseText.get(phraseSelection.verseStart) ?? "";
        phraseQuote = full.slice(phraseSelection.charStart, phraseSelection.charEnd);
      }
    } else if (selectedVerses.size > 0) {
      const sorted = [...selectedVerses].sort((a, b) => a - b);
      verseStart = sorted[0]!;
      verseEnd = sorted[sorted.length - 1]!;
    } else {
      return;
    }

    const rangeStr =
      verseStart === verseEnd
        ? `${displayBookName} ${chapter}:${verseStart}`
        : `${displayBookName} ${chapter}:${verseStart}–${verseEnd}`;

    const quote =
      phraseQuote ??
      [...chapterVerseText.entries()]
        .filter(([v]) => v >= verseStart && v <= verseEnd)
        .sort((a, b) => a[0] - b[0])
        .map(([v, t]) => (verseStart === verseEnd ? t : `${v} ${t}`))
        .join("\n");

    setNoteDraft({
      title: rangeStr,
      passageRef: rangeStr,
      quote,
      book,
      chapter,
      verseStart,
      verseEnd,
      packageId,
    });
    setSelectedVerses(new Set());
    setPhraseSelection(null);
    verseSelectionAnchorRef.current = null;
    setShowHighlightPalette(false);
  };

  const handleNoteCaptureSaved = useCallback(
    ({ title }: { noteId: string; title: string }) => {
      setNoteDraft(null);
      showToast(`Saved “${title}”`);
      // Refresh margin so the new note can appear if it anchors to this chapter.
      void reloadMarginHighlights();
    },
    [showToast, reloadMarginHighlights],
  );

  // Every highlight lookup below uses the already package-scoped normalized
  // records and filters by book+chapter, not just verse
  // number. Without it, if marginData ever briefly holds a stale response
  // from a different chapter (a race — see reloadMarginHighlights and the
  // currentChapterKeyRef guard), a highlight from that other chapter would
  // render as if it belonged to whatever verse number it happens to share
  // with the chapter actually on screen. Chapters routinely share verse
  // numbers (most start at 1), so this isn't a hypothetical edge case.
  const getHighlightClass = (verse: number): string => {
    const colors = new Set(normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter && verse >= h.verse_start && verse <= h.verse_end,
    ).map((highlight) => highlight.color));
    if (colors.size === 0) return "";
    if (colors.size === 1) return `hl-${[...colors][0]}`;
    return "hl-mixed";
  };

  // Records the current selection (phrase or whole-verse) actually overlaps —
  // char-aware for a phrase selection. Backs both the palette's "remove" state
  // and the whole-blob remove action.
  const touchedHighlights = useCallback((): HighlightRecord[] => {
    const activeHere = normalizedHighlights.filter(
      (h) => h.deleted === 0 && h.book === book && h.chapter === chapter,
    );
    if (phraseSelection) {
      return activeHere.filter((h) => isHighlightOverlap(h, {
        verseStart: phraseSelection.verseStart, verseEnd: phraseSelection.verseEnd,
        charStart: phraseSelection.charStart, charEnd: phraseSelection.charEnd,
      }));
    }
    return activeHere.filter((h) => [...selectedVerses].some((v) => v >= h.verse_start && v <= h.verse_end));
  }, [normalizedHighlights, book, chapter, phraseSelection, selectedVerses]);

  const selectedHighlightRecords = touchedHighlights();
  const selectedHighlightColors = [...new Set(selectedHighlightRecords.map((highlight) => highlight.color))];
  const selectedHighlightColor = selectedHighlightColors.length === 1 ? selectedHighlightColors[0]! : null;
  const mixedSelectionColors = selectedHighlightColors.length > 1;
  const hasExistingHighlight = (selectedVerses.size > 0 || phraseSelection != null) && selectedHighlightRecords.length > 0;
  const multiVerseSelect = selectedVerses.size > 1;

  const selectionRangeLabel = useMemo(() => {
    if (phraseSelection) {
      if (phraseSelection.verseStart === phraseSelection.verseEnd) {
        return `${displayBookName} ${chapter}:${phraseSelection.verseStart}`;
      }
      return `${displayBookName} ${chapter}:${phraseSelection.verseStart}–${phraseSelection.verseEnd}`;
    }
    if (selectedVerses.size === 0) return "";
    const sorted = [...selectedVerses].sort((a, b) => a - b);
    if (sorted.length === 1) return `${displayBookName} ${chapter}:${sorted[0]}`;
    return `${displayBookName} ${chapter}:${sorted[0]}–${sorted[sorted.length - 1]}`;
  }, [phraseSelection, selectedVerses, displayBookName, chapter]);

  // Ambient margin follows the verse nearest the reading eye-line — but never
  // while the pastor is working in the margin (pointer) or has locked a study
  // verse. Otherwise a click on Greek chips feels like "click out" and the
  // panel jumps to wherever the page is scrolled (often not verse 1).
  useEffect(() => {
    const root = contentRef.current;
    if (!root || !chapterData) {
      setNearVerse(null);
      return;
    }

    let raf = 0;
    const update = () => {
      if (marginActiveRef.current || studyLockVerseRef.current != null) return;
      const rootRect = root.getBoundingClientRect();
      const eyeY = rootRect.top + rootRect.height * 0.32;
      let best: number | null = null;
      let bestDist = Infinity;
      for (const [verseNum, el] of verseRowRefs.current) {
        const r = el.getBoundingClientRect();
        if (r.bottom < rootRect.top + 8 || r.top > rootRect.bottom - 8) continue;
        const mid = (r.top + r.bottom) / 2;
        const dist = Math.abs(mid - eyeY);
        if (dist < bestDist) {
          bestDist = dist;
          best = verseNum;
        }
      }
      setNearVerse((prev) => (prev === best ? prev : best));
    };

    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    root.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    raf = requestAnimationFrame(() => {
      raf = 0;
      update();
    });

    return () => {
      root.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [chapterData, book, chapter]);

  /** Pointer entered/left the Living Margin chrome. */
  const handleMarginActiveChange = useCallback((active: boolean) => {
    marginActiveRef.current = active;
  }, []);

  /**
   * Pastor started studying language for a verse.
   * Freeze ambient eye-line on that verse (do NOT auto-pin — pinning would
   * remount the language panel and close form/STEP notes mid-click).
   */
  const handleStudyVerse = useCallback((v: number) => {
    studyLockVerseRef.current = v;
    setNearVerse(v);
  }, []);

  // Reset nearVerse immediately on chapter/book/version change so a stale
  // "currently reading" preview from the previous text never flashes. Also clear any
  // pending verse selection/palette — otherwise a highlight action left open
  // while navigating (prev/next arrows, ⌘←/→) would apply to the new chapter
  // using verse numbers selected in the old one. Exception: if this chapter
  // change came from goTo(..., verse) (passage jump, cross-ref click-through),
  // pendingVerseSelectRef carries the verse that should end up selected —
  // honor that instead of clearing it right back out.
  useEffect(() => {
    setNearVerse(null);
    studyLockVerseRef.current = null;
    marginActiveRef.current = false;
    setShowHighlightPalette(false);
    setAnimateIds(new Set());
    setFadingIds(new Set());
    setPhraseSelection(null);
    const verse = pendingVerseSelectRef.current;
    const verseEnd = pendingVerseEndRef.current;
    pendingVerseSelectRef.current = null;
    pendingVerseEndRef.current = null;
    verseSelectionAnchorRef.current = verse ?? null;
    setSelectedVerses(verse
      ? new Set(Array.from(
          { length: Math.max(1, (verseEnd ?? verse) - verse + 1) },
          (_, index) => verse + index,
        ))
      : new Set());
  }, [book, chapter, packageId]);

  // Clear study lock when the user fully clears the selection (click away).
  useEffect(() => {
    if (selectedVerses.size === 0 && phraseSelection == null) {
      studyLockVerseRef.current = null;
    }
  }, [selectedVerses, phraseSelection]);

  return (
    <div className="scripture-page">
      <header className={`scripture-topbar${scrolled ? " scrolled" : ""}`} role="toolbar" aria-label="Reading toolbar">
        <div className="topbar-navigation">
        <div className="passage-picker-group" aria-label="Chapter navigation">
          <button
            ref={passageBtnRef}
            type="button"
            className={`passage-picker-btn${passageOpen ? " open" : ""}`}
            onClick={openPassagePopover}
            title="Choose passage"
            aria-label={`Choose passage. Current passage: ${displayBookName} ${chapter}`}
            aria-haspopup="dialog"
            aria-expanded={passageOpen}
          >
            <span className="passage-picker-book">{displayBookName}</span>{" "}
            <span className="passage-picker-chapter">{chapter}</span>
            <ChevronIcon />
          </button>
          <div className="chapter-nav-arrows" role="group" aria-label="Move by chapter">
            <button
              type="button"
              className="nav-arrow"
              onClick={() => {
                if (chapter > 1) {
                  userNavigatedRef.current = true;
                  setChapter(chapter - 1);
                }
              }}
              disabled={chapter <= 1}
              title="Previous chapter (⌘←)"
              aria-label="Previous chapter"
            >
              <ChapterArrowIcon direction="previous" />
            </button>
            <button
              type="button"
              className="nav-arrow"
              onClick={() => {
                if (chapter < chapterCount) {
                  userNavigatedRef.current = true;
                  setChapter(chapter + 1);
                }
              }}
              disabled={chapter >= chapterCount}
              title="Next chapter (⌘→)"
              aria-label="Next chapter"
            >
              <ChapterArrowIcon direction="next" />
            </button>
          </div>

          {passageOpen && (
            <Popover
              anchorRect={passageAnchor}
              onClose={closePassagePopover}
              width={340}
              className="passage-picker-popover"
              ariaLabel="Choose passage"
            >
              {passageView === "chapters" && (
                <>
                  {recents.length > 0 && (
                    <div className="picker-recents">
                      <div className="picker-recents-head">
                        <span className="picker-recents-label">Recent</span>
                      </div>
                      <div className="picker-recents-row" role="list">
                        {recents.map((r) => {
                          const label = formatRecentLabel(r, bookNames);
                          const isHere = r.book === book && r.chapter === chapter;
                          return (
                            <div key={`${r.book}:${r.chapter}`} className="picker-recent-chip-wrap" role="listitem">
                              <button
                                type="button"
                                className={`picker-recent-chip${isHere ? " active" : ""}`}
                                onClick={() => {
                                  if (r.packageId && r.packageId !== packageId) {
                                    // Same commit hygiene as the version picker:
                                    // clear old text before package id flips.
                                    setChapterData(null);
                                    setChapterError(null);
                                    setShowHighlightPalette(false);
                                    setSelectedVerses(new Set());
                                    setPhraseSelection(null);
                                    setPackageId(r.packageId);
                                  }
                                  goTo(r.book, r.chapter, r.verse);
                                  closePassagePopover();
                                }}
                                title={label}
                                aria-current={isHere ? "page" : undefined}
                              >
                                <span className="picker-recent-ref">{label}</span>
                                <span className="picker-recent-pkg">{r.packageId.toUpperCase()}</span>
                              </button>
                              <button
                                type="button"
                                className="picker-recent-dismiss"
                                title="Remove from recent"
                                aria-label={`Remove ${label} from recent`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setRecents((prev) => removeRecent(prev, r));
                                }}
                              >
                                ×
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  <div className="picker-title-row">
                    <div className="picker-title">
                      <span className="picker-title-book">{browseBookName}</span>
                      <span className="picker-title-sep" aria-hidden="true">·</span>
                      <span className="picker-title-meta">chapters</span>
                    </div>
                    <button type="button" className="picker-title-action" onClick={openBooksView}>
                      All books
                      <span className="picker-title-action-chev" aria-hidden="true">›</span>
                    </button>
                  </div>

                  <div className="chapter-grid">
                    {Array.from({ length: backbone.books[browseBook]?.chapters.length ?? 0 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        type="button"
                        className={`chapter-grid-num${browseBook === book && chapter === n ? " active" : ""}`}
                        onClick={() => {
                          goTo(browseBook, n);
                          closePassagePopover();
                        }}
                        aria-label={`Go to ${browseBookName} ${n}`}
                        aria-current={browseBook === book && chapter === n ? "page" : undefined}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {passageView === "books" && (
                <>
                  <div className="picker-title-row">
                    <button type="button" className="picker-back" onClick={() => setPassageView("chapters")}>
                      <BackChevronIcon />
                      <span>{browseBookName}</span>
                    </button>
                    <div className="picker-title picker-title-books">
                      <span className="picker-title-meta">Books</span>
                    </div>
                  </div>
                  <div className="popover-search">
                    <SearchIconSmall />
                    <input
                      ref={bookSearchRef}
                      type="text"
                      placeholder="Search books (1co, ps, rev…)"
                      value={bookQuery}
                      onChange={(e) => setBookQuery(e.target.value)}
                      aria-label="Search Bible books"
                    />
                  </div>
                  <div className="popover-scroll">
                    {filteredOt.length > 0 && (
                      <>
                        <div className="popover-group-label">Old Testament</div>
                        <div className="book-grid">
                          {filteredOt.map((b) => (
                            <button
                              key={b}
                              className={`book-grid-item${b === browseBook ? " active" : ""}`}
                              onClick={() => handleBookPick(b)}
                            >
                              {bookNames[b]?.[0] ?? b}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredNt.length > 0 && (
                      <>
                        <div className="popover-group-label">New Testament</div>
                        <div className="book-grid">
                          {filteredNt.map((b) => (
                            <button
                              key={b}
                              className={`book-grid-item${b === browseBook ? " active" : ""}`}
                              onClick={() => handleBookPick(b)}
                            >
                              {bookNames[b]?.[0] ?? b}
                            </button>
                          ))}
                        </div>
                      </>
                    )}
                    {filteredOt.length === 0 && filteredNt.length === 0 && (
                      <div className="popover-no-match">No books match your search.</div>
                    )}
                  </div>
                </>
              )}
            </Popover>
          )}
        </div>

        <div className="version-picker-group">
          <button
            ref={versionBtnRef}
            type="button"
            className={`version-picker-btn${versionOpen ? " open" : ""}`}
            onClick={openVersionPopover}
            title="Choose Bible translation"
            aria-label={`Choose Bible translation. Current translation: ${packageId.toUpperCase()}`}
            aria-haspopup="dialog"
            aria-expanded={versionOpen}
          >
            {packageId.toUpperCase()}
            <ChevronIcon />
          </button>
          {versionOpen && (
            <Popover
              anchorRect={versionAnchor}
              onClose={closeVersionPopover}
              width={280}
              className="version-picker-popover"
              ariaLabel="Choose Bible translation"
            >
              <div className="picker-menu-heading">
                <span>Bible text</span>
                <small>Notes stay anchored when the translation changes.</small>
              </div>
              {TRANSLATIONS.map((t) => (
                <button
                  key={t.code}
                  type="button"
                  className={`version-picker-item${t.code === packageId ? " active" : ""}`}
                  onClick={() => {
                    if (t.code !== packageId) {
                      // Clear the old translation's DOM and selection in the
                      // same commit as the package switch. Otherwise React can
                      // briefly paint new-package highlight offsets over the
                      // old translation before the text-loading effect runs.
                      setChapterData(null);
                      setChapterError(null);
                      setShowHighlightPalette(false);
                      setSelectedVerses(new Set());
                      setPhraseSelection(null);
                      verseSelectionAnchorRef.current = null;
                      setPackageId(t.code);
                    }
                    closeVersionPopover();
                  }}
                  aria-pressed={t.code === packageId}
                >
                  <span className="version-picker-code">{t.code.toUpperCase()}</span>
                  <span className="version-picker-name">{t.name}</span>
                  {t.code === packageId && <CheckIcon />}
                </button>
              ))}
            </Popover>
          )}
        </div>

        <form className="passage-jump" onSubmit={(e) => {
          e.preventDefault();
          const r = parsePassage(jumpText, bookNames, backbone);
          if (r.ok) {
            goTo(r.value.book, r.value.chapter, r.value.verse);
            setJumpText("");
            setJumpError(false);
          } else {
            setJumpError(true);
          }
        }}>
          <JumpIcon />
          <input
            ref={jumpInputRef}
            className={jumpError ? "passage-jump-input error" : "passage-jump-input"}
            value={jumpText}
            placeholder="Jump to passage"
            aria-label="Jump to passage"
            aria-invalid={jumpError}
            aria-describedby={jumpError ? "passage-jump-error" : undefined}
            onChange={(e) => { setJumpText(e.target.value); setJumpError(false); }}
            onKeyDown={(e) => {
              if (e.key !== "Escape") return;
              setJumpText("");
              setJumpError(false);
              e.currentTarget.blur();
            }}
          />
          {!jumpText && <kbd className="passage-jump-shortcut" aria-hidden="true">⌘K</kbd>}
          {jumpError && (
            <span id="passage-jump-error" className="passage-jump-error" role="status">
              Try a book and chapter, like John 3.
            </span>
          )}
        </form>
        </div>

        <div className="topbar-spacer" />

        <div className="topbar-tools" aria-label="Reading tools">
        {onReadingPrefsChange && onToggleFocus && (
          <ReadingComfort
            prefs={{ readingSize, readingWidth, verseNumbers }}
            onChange={onReadingPrefsChange}
            focusMode={focusMode}
            onToggleFocus={onToggleFocus}
          />
        )}

        <span className="topbar-tool-divider" aria-hidden="true" />
          {onToggleMargin && !focusMode && (
            <button
              type="button"
              className={`margin-toggle-btn${marginVisible ? " active" : ""}`}
              onClick={onToggleMargin}
              title={marginVisible ? "Hide Living Margin" : "Show Living Margin"}
              aria-label={marginVisible ? "Hide Living Margin" : "Show Living Margin"}
              aria-pressed={marginVisible}
            >
              <MarginToggleIcon />
            </button>
          )}

          {onThemeChange && <ThemePicker theme={theme} onChange={onThemeChange} />}
        </div>
      </header>

      <div className="scripture-body">
      <div className="scripture-content" ref={contentRef}>
        <article className="scripture-inner" aria-labelledby="reading-chapter-title">
          <div className="chapter-header">
            <h1 id="reading-chapter-title" className="chapter-title" ref={chapterHeadingRef} tabIndex={-1}>
              <span className="book-name">{displayBookName}</span>
              {" "}
              <span className="chapter-number">{chapter}</span>
            </h1>
          </div>

          <div
            className={[
              "verse-text",
              multiVerseSelect || mixedSelectionColors ? "has-multi-select" : "",
              pinnedRange ? "has-pin" : "",
            ].filter(Boolean).join(" ")}
            ref={verseTextRef}
            aria-busy={!chapterData && !chapterError}
            style={{ position: "relative" }}
            onMouseUp={handleTextMouseUp}
            onMouseDown={() => { suppressNextClickRef.current = false; }}
          >
            <HighlightUnderlay
              containerRef={verseTextRef}
              verseRowRefs={verseRowRefs}
              highlights={normalizedHighlights}
              book={book}
              chapter={chapter}
              animateIds={animateIds}
              fadingIds={fadingIds}
              themeToken={theme}
              pinRange={pinnedRange}
            />
            {chapterData?.verses.map((v, idx) => {
              const prevV = chapterData.verses[idx - 1];
              const contAbove = !!prevV && verseBridges.has(prevV.verse);
              const contBelow = verseBridges.has(v.verse);
              const isSelected = selectedVerses.has(v.verse);
              const rowClasses = [
                "verse-line",
                isSelected ? "selected" : "",
                isSelected && multiVerseSelect ? "multi-select" : "",
                isSelected && mixedSelectionColors ? "mixed-select" : "",
                getHighlightClass(v.verse),
                contAbove ? "cont-above" : "",
                contBelow ? "cont-below" : "",
              ].filter(Boolean).join(" ");
              const textClasses = [
                "verse-text-span",
                contAbove ? "cont-above" : "",
                contBelow ? "cont-below" : "",
              ].filter(Boolean).join(" ");
              return (
                <div
                  key={v.verse}
                  data-verse={v.verse}
                  className={rowClasses}
                  role="button"
                  tabIndex={0}
                  aria-label={`${displayBookName} ${chapter}:${v.verse}`}
                  aria-pressed={isSelected}
                  onClick={(e) => handleVerseClick(v.verse, e)}
                  onKeyDown={(e) => handleVerseKeyDown(v.verse, e)}
                  ref={(el) => {
                    if (el) verseRowRefs.current.set(v.verse, el);
                    else verseRowRefs.current.delete(v.verse);
                  }}
                >
                  <span className="verse-num">{v.verse}</span>
                  <span className={textClasses}>{v.text}</span>
                </div>
              );
            })}

            {!chapterData && !chapterError && (
              <ReadingCanvasLoading passage={`${displayBookName} ${chapter}`} />
            )}

            {chapterError && (
              <ReadingCanvasError
                passage={`${displayBookName} ${chapter}`}
                error={chapterError}
                onRetry={() => setRetryToken((token) => token + 1)}
              />
            )}

            {chapterData && chapterData.verses.length === 0 && (
              <ReadingCanvasEmpty
                passage={`${displayBookName} ${chapter}`}
                onRetry={() => setRetryToken((token) => token + 1)}
              />
            )}

            {/* Mini toolbar always when a selection is active — unified chrome
                whether the Living Margin is open or closed. */}
            <PaletteExit
              show={showHighlightPalette && (phraseSelection != null || selectedVerses.size > 0)}
            >
              {showHighlightPalette && (phraseSelection != null || selectedVerses.size > 0) && (
                <HighlightToolbar
                  variant="floating"
                  flipped={palettePos.flipped}
                  paletteRef={paletteRef}
                  style={{ top: palettePos.y, left: palettePos.x }}
                  rangeLabel={selectionRangeLabel}
                  activeColor={selectedHighlightColor}
                  mixedColors={mixedSelectionColors}
                  hasExistingHighlight={hasExistingHighlight}
                  phraseMode={phraseSelection != null}
                  onSetColor={(color) => void handleHighlight(color)}
                  onNote={handleNoteFromSelection}
                  onRemove={() => void handleRemoveSelection()}
                />
              )}
            </PaletteExit>
          </div>

          {chapterData && chapterData.verses.length > 0 && (
            <footer className="chapter-end">
              <span className="chapter-end-label">End of {displayBookName} {chapter}</span>
              {chapter < chapterCount && (
                <button
                  type="button"
                  className="chapter-continue"
                  onClick={() => {
                    shouldFocusChapterHeading.current = true;
                    userNavigatedRef.current = true;
                    setChapter((current) => current + 1);
                  }}
                  aria-label={`Continue to ${displayBookName} ${chapter + 1}`}
                >
                  <span>Continue to {displayBookName} {chapter + 1}</span>
                  <ChapterArrowIcon direction="next" />
                </button>
              )}
            </footer>
          )}
        </article>
      </div>

      {marginVisible && !focusMode && (
        <LivingMargin
          book={book}
          chapter={chapter}
          packageId={packageId}
          marginData={packageMarginData}
          crossRefs={crossRefs}
          bookNames={bookNames}
          semanticData={semanticData}
          semanticLoading={semanticLoading}
          chapterVerseText={chapterVerseText}
          pinnedRange={pinnedRange}
          nearVerse={pinnedRange ? null : nearVerse}
          onNavigateToRef={handleNavigateToRef}
          onPinClaim={async (claimId, assertion) => {
            await window.api.ai.pinClaim(claimId, assertion);
          }}
          onSetHighlightColor={(color) => void handleHighlight(color)}
          onCreateNote={handleNoteFromSelection}
          onRemoveHighlights={(entityIds) => void handleDeleteHighlights(entityIds)}
          onStudyVerse={handleStudyVerse}
          onMarginActiveChange={handleMarginActiveChange}
        />
      )}
      </div>

      {noteDraft && (
        <NoteCapture
          draft={noteDraft}
          onClose={() => setNoteDraft(null)}
          onSaved={handleNoteCaptureSaved}
        />
      )}
    </div>
  );
}
