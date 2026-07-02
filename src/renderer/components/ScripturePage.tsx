import type React from "react";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import type { BackboneData, BookNameData, ChapterData, QueryResult, SemanticMarginResult } from "../api.js";
import { LivingMargin } from "./LivingMargin.js";
import { useToast } from "./Toast.js";
import { safeCall } from "../utils/safeCall.js";
import { parsePassage } from "../utils/parsePassage.js";
import { Popover } from "./Popover.js";

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
  theme?: "light" | "dark";
  onToggleTheme?: () => void;
  /** Lifted to App, same pattern as onToggleTheme; ScripturePage never owns marginVisible itself. */
  onToggleMargin?: () => void;
  /** Fired whenever the pinned (selected) verse range changes; null when nothing is selected. */
  onPinnedRangeChange?: (range: PinnedRange | null) => void;
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
  { code: "web", name: "World English Bible" },
  { code: "kjv", name: "King James Version" },
];

function SunIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="currentColor" stroke="none">
      <path d="M17.5 10.7a7.5 7.5 0 1 1-8.2-8.2 5.8 5.8 0 0 0 8.2 8.2z" />
    </svg>
  );
}

function MoonIcon(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <circle cx="10" cy="10" r="3.3" fill="currentColor" stroke="none" />
      <path d="M10 2.5v2M10 15.5v2M2.5 10h2M15.5 10h2M4.8 4.8l1.4 1.4M13.8 13.8l1.4 1.4M4.8 15.2l1.4-1.4M13.8 6.2l1.4-1.4" />
    </svg>
  );
}

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

function SearchIconSmall(): React.JSX.Element {
  return (
    <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round">
      <circle cx="8.5" cy="8.5" r="5.5" />
      <path d="M16.5 16.5l-4-4" />
    </svg>
  );
}

export function ScripturePage({ backbone, bookNames, navigateRef, onCreateNote, marginVisible, onAiBusyChange, theme, onToggleTheme, onToggleMargin, onPinnedRangeChange }: Props): React.JSX.Element {
  const [book, setBook] = useState("ACT");
  const [chapter, setChapter] = useState(19);
  const [packageId, setPackageId] = useState("web");
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<number>>(new Set());
  const [marginData, setMarginData] = useState<QueryResult>({ anchors: [], highlights: [], notes: [] });
  const [crossRefs, setCrossRefs] = useState<string[]>([]);
  const [semanticData, setSemanticData] = useState<SemanticMarginResult | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });
  const [highlightLoading, setHighlightLoading] = useState(false);
  const [jumpText, setJumpText] = useState("");
  const [jumpError, setJumpError] = useState(false);
  const [retryToken, setRetryToken] = useState(0);
  const [scrolled, setScrolled] = useState(false);

  // Passage picker popover state
  const [passageOpen, setPassageOpen] = useState(false);
  const [passageView, setPassageView] = useState<"chapters" | "books">("chapters");
  const [bookQuery, setBookQuery] = useState("");
  const [browseBook, setBrowseBook] = useState(book);
  const passageBtnRef = useRef<HTMLButtonElement>(null);
  const [passageAnchor, setPassageAnchor] = useState<DOMRect | null>(null);
  const bookSearchRef = useRef<HTMLInputElement>(null);

  // Version picker popover state
  const [versionOpen, setVersionOpen] = useState(false);
  const versionBtnRef = useRef<HTMLButtonElement>(null);
  const [versionAnchor, setVersionAnchor] = useState<DOMRect | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const { showToast } = useToast();

  // The first annotated verse (has a highlight, note, or cross-ref) currently
  // scrolled into view — drives the Living Margin's ambient "currently
  // reading" state. Derived, not persisted; reset on chapter/book change.
  const [nearVerse, setNearVerse] = useState<number | null>(null);
  const verseRowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

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
      setCrossRefs([]);
      return () => {
        cancelled = true;
      };
    }

    // Keep verse highlight classes current even when the Living Margin is hidden.
    safeCall(() => window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount)).then((res) => {
      if (!cancelled && res.ok) setMarginData(res.value);
    });

    if (!marginVisible) {
      setCrossRefs([]);
      return () => {
        cancelled = true;
      };
    }

    // Batched cross-refs (single IPC call instead of 7)
    safeCall(() => window.api.scripture.getCrossRefsForChapter(book, chapter, verseCount)).then((res) => {
      if (!cancelled && res.ok) setCrossRefs(res.value);
    });

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

  // Atomic navigation: set book+chapter together in one render so only a
  // single getChapterText fetch happens (avoids the intermediate chapter-1 load).
  // An optional verse is remembered in a ref (not state) so the chapter-change
  // reset effect below can tell "this navigation deliberately wants verse N
  // selected" apart from "this is a plain chapter change, clear any stale
  // selection" — otherwise that effect (which must keep running for prev/next
  // arrows and keyboard nav) would wipe the selection right back out in the
  // same commit.
  const pendingVerseSelectRef = useRef<number | null>(null);
  const goTo = useCallback((b: string, c: number, verse?: number) => {
    pendingVerseSelectRef.current = verse ?? null;
    setBook(b);
    setChapter(c);
  }, []);

  // Cross-reference click-through (Living Margin's xref-link entries were
  // previously decorative text). Reuses the same parser as the "Go to..."
  // jump input, since cross-refs are rendered as "Book chapter:verse" text.
  // Falls back to stripping a trailing "-N" range (e.g. "Acts 19:1-7") since
  // parsePassage only targets a single verse, not a range.
  const handleNavigateToRef = useCallback((ref: string) => {
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

  // Keep the passage-picker's book-browsing view in sync with the current book.
  useEffect(() => {
    setBrowseBook(book);
  }, [book]);

  const closePassagePopover = useCallback(() => {
    setPassageOpen(false);
    setPassageView("chapters");
    setBookQuery("");
  }, []);

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

  const closeVersionPopover = useCallback(() => setVersionOpen(false), []);

  const openVersionPopover = () => {
    if (versionBtnRef.current) setVersionAnchor(versionBtnRef.current.getBoundingClientRect());
    setVersionOpen(true);
  };

  const matchesQuery = (code: string) => {
    const name = bookNames[code]?.[0] ?? code;
    return name.toLowerCase().includes(bookQuery.trim().toLowerCase());
  };
  const filteredOt = OT_BOOKS.filter(matchesQuery);
  const filteredNt = NT_BOOKS.filter(matchesQuery);

  // Derived "pinned range" — min/max of the selectedVerses set, or null when
  // nothing is selected. Consumed by the Living Margin in a later phase.
  const pinnedRange = useMemo<PinnedRange | null>(() => {
    if (selectedVerses.size === 0) return null;
    const vals = [...selectedVerses];
    return { start: Math.min(...vals), end: Math.max(...vals) };
  }, [selectedVerses]);

  useEffect(() => {
    onPinnedRangeChange?.(pinnedRange);
  }, [pinnedRange, onPinnedRangeChange]);

  // Reload margin data after highlight changes
  const reloadMarginHighlights = useCallback(async () => {
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) return;
    const res = await safeCall(() => window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount));
    if (res.ok) setMarginData(res.value);
  }, [book, chapter, backbone]);

  // Click-outside to dismiss palette
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: MouseEvent) => {
      if (paletteRef.current && !paletteRef.current.contains(e.target as Node)) {
        setShowHighlightPalette(false);
        setSelectedVerses(new Set());
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showHighlightPalette]);

  // Escape to dismiss palette
  useEffect(() => {
    if (!showHighlightPalette) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowHighlightPalette(false);
        setSelectedVerses(new Set());
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
        if (chapter > 1) setChapter(chapter - 1);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "ArrowRight") {
        e.preventDefault();
        if (chapter < chapterCount) setChapter(chapter + 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [chapter, chapterCount]);

  const handleVerseClick = useCallback((verse: number, event: React.MouseEvent) => {
    setSelectedVerses((prev) => {
      const next = new Set(prev);
      if (event.shiftKey && prev.size > 0) {
        const min = Math.min(verse, ...prev);
        const max = Math.max(verse, ...prev);
        for (let v = min; v <= max; v++) next.add(v);
      } else if (event.metaKey || event.ctrlKey) {
        if (next.has(verse)) next.delete(verse);
        else next.add(verse);
      } else {
        if (next.size === 1 && next.has(verse)) {
          next.clear();
        } else {
          next.clear();
          next.add(verse);
        }
      }
      return next;
    });

    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    setPalettePos({
      top: rect.top - 36,
      left: rect.right + 8,
    });
    setShowHighlightPalette(true);
  }, []);

  const handleHighlight = async (color: string) => {
    if (selectedVerses.size === 0) return;
    const sorted = [...selectedVerses].sort((a, b) => a - b);
    setHighlightLoading(true);

    // Optimistic update
    setMarginData((prev) => ({
      ...prev,
      highlights: [
        ...prev.highlights.filter(
          (h) => !(h.chapter === chapter && h.verse_start <= sorted[sorted.length - 1]! && h.verse_end >= sorted[0]!),
        ),
        {
          id: "temp",
          book,
          chapter,
          verse_start: sorted[0]!,
          verse_end: sorted[sorted.length - 1]!,
          package: packageId,
          char_start: null,
          char_end: null,
          color,
          kind: "highlight",
          note_id: null,
          deleted: 0,
        },
      ],
    }));

    // The highlight is already visible optimistically; do not keep the palette
    // spinning while disk/Git persistence finishes.
    setHighlightLoading(false);
    setShowHighlightPalette(false);
    setSelectedVerses(new Set());

    const res = await safeCall(() =>
      window.api.library.createHighlight(book, chapter, sorted[0]!, sorted[sorted.length - 1]!, color, packageId),
    );

    if (res.ok && res.value.ok) {
      const hlId = res.value.highlightId ?? "";
      showToast("Highlight created", "Undo", () => {
        void safeCall(() => window.api.library.deleteHighlight(hlId, ""));
        void reloadMarginHighlights();
      });
      void reloadMarginHighlights();
    } else {
      showToast("Failed to create highlight");
      void reloadMarginHighlights(); // Revert optimistic update
    }
  };

  const handleDeleteHighlight = async (entityId: string) => {
    const res = await safeCall(() => window.api.library.deleteHighlight(entityId, ""));
    if (res.ok && res.value.ok) {
      showToast("Highlight removed", "Undo", () => {
        // Can't truly undo a delete (the event is append-only),
        // but we can tell the user it was removed
      });
      void reloadMarginHighlights();
    } else {
      showToast("Failed to remove highlight");
    }
  };

  const handleNoteFromSelection = () => {
    if (selectedVerses.size === 0) return;
    const sorted = [...selectedVerses].sort((a, b) => a - b);
    const rangeStr = sorted.length === 1
      ? `${displayBookName} ${chapter}:${sorted[0]}`
      : `${displayBookName} ${chapter}:${sorted[0]}-${sorted[sorted.length - 1]}`;
    onCreateNote(`\n\nPassage: ${rangeStr}`);
    setSelectedVerses(new Set());
    setShowHighlightPalette(false);
  };

  const getHighlightClass = (verse: number): string => {
    const hl = marginData.highlights.find(
      (h) => h.deleted === 0 && verse >= h.verse_start && verse <= h.verse_end,
    );
    return hl ? `hl-${hl.color}` : "";
  };

  // Active highlight color for a given verse, or null. Backs the
  // adjacent-verse merge logic below (reads marginData.highlights).
  const getHighlightColor = useCallback((verse: number): string | null => {
    const hl = marginData.highlights.find(
      (h) => h.deleted === 0 && verse >= h.verse_start && verse <= h.verse_end,
    );
    return hl ? hl.color : null;
  }, [marginData.highlights]);

  const hasExistingHighlight = selectedVerses.size > 0 && marginData.highlights.some(
    (h) => h.deleted === 0 && [...selectedVerses].some((v) => v >= h.verse_start && v <= h.verse_end),
  );

  // A verse is "annotated" (eligible to be reported as nearVerse) if it has a
  // live highlight, a note anchored to it, or appears in the chapter's
  // cross-refs list. Only real data — never a fabricated signal.
  const isVerseAnnotated = useCallback((verse: number): boolean => {
    const hasHighlight = marginData.highlights.some(
      (h) => h.deleted === 0 && verse >= h.verse_start && verse <= h.verse_end,
    );
    if (hasHighlight) return true;
    const hasNote = marginData.anchors.some(
      (a) => a.chapter === chapter && verse >= a.verse_start && verse <= a.verse_end,
    );
    if (hasNote) return true;
    return crossRefs.some((ref) => ref.includes(`:${verse}`));
  }, [marginData, crossRefs, chapter]);

  // Full verse text for the current chapter, keyed by verse number — passed
  // down to the Living Margin for pinned-passage quotes and the passage-
  // scoped AI insight call.
  const chapterVerseText = useMemo<Map<number, string>>(() => {
    const m = new Map<number, string>();
    for (const v of chapterData?.verses ?? []) m.set(v.verse, v.text);
    return m;
  }, [chapterData]);

  // Track the first annotated verse currently intersecting the reading
  // column as `nearVerse`. Only relevant when nothing is pinned (precedence
  // handled by the caller/LivingMargin), but we compute it regardless so it
  // is ready the instant the selection clears.
  useEffect(() => {
    const root = contentRef.current;
    if (!root) {
      setNearVerse(null);
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .map((e) => Number((e.target as HTMLElement).dataset.verse))
          .filter((v) => Number.isFinite(v));
        if (visible.length === 0) return;
        const next = visible.filter((v) => isVerseAnnotated(v)).sort((a, b) => a - b)[0] ?? null;
        setNearVerse(next);
      },
      { root, threshold: 0.5 },
    );

    for (const el of verseRowRefs.current.values()) observer.observe(el);

    return () => observer.disconnect();
  }, [chapterData, isVerseAnnotated]);

  // Reset nearVerse immediately on chapter/book change so a stale "currently
  // reading" preview from the previous chapter never flashes. Also clear any
  // pending verse selection/palette — otherwise a highlight action left open
  // while navigating (prev/next arrows, ⌘←/→) would apply to the new chapter
  // using verse numbers selected in the old one. Exception: if this chapter
  // change came from goTo(..., verse) (passage jump, cross-ref click-through),
  // pendingVerseSelectRef carries the verse that should end up selected —
  // honor that instead of clearing it right back out.
  useEffect(() => {
    setNearVerse(null);
    setShowHighlightPalette(false);
    const verse = pendingVerseSelectRef.current;
    pendingVerseSelectRef.current = null;
    setSelectedVerses(verse ? new Set([verse]) : new Set());
  }, [book, chapter]);

  return (
    <div className="scripture-page">
      <div className={`scripture-topbar${scrolled ? " scrolled" : ""}`}>
        <div className="passage-picker-group">
          <button
            ref={passageBtnRef}
            className={`passage-picker-btn${passageOpen ? " open" : ""}`}
            onClick={openPassagePopover}
          >
            <span className="passage-picker-book">{displayBookName}</span>{" "}
            <span className="passage-picker-chapter">{chapter}</span>
            <ChevronIcon />
          </button>
          <div className="chapter-nav-arrows">
            <button
              className="nav-arrow"
              onClick={() => chapter > 1 && setChapter(chapter - 1)}
              disabled={chapter <= 1}
              title="Previous chapter (⌘←)"
            >
              ←
            </button>
            <button
              className="nav-arrow"
              onClick={() => chapter < chapterCount && setChapter(chapter + 1)}
              disabled={chapter >= chapterCount}
              title="Next chapter (⌘→)"
            >
              →
            </button>
          </div>

          {passageOpen && (
            <Popover anchorRect={passageAnchor} onClose={closePassagePopover} width={320} className="passage-picker-popover">
              {passageView === "chapters" && (
                <>
                  <button className="passage-popback" onClick={openBooksView}>
                    <BackChevronIcon />
                    back to {bookNames[browseBook]?.[0] ?? browseBook}
                  </button>
                  <div className="chapter-grid">
                    {Array.from({ length: backbone.books[browseBook]?.chapters.length ?? 0 }, (_, i) => i + 1).map((n) => (
                      <button
                        key={n}
                        className={`chapter-grid-num${browseBook === book && chapter === n ? " active" : ""}`}
                        onClick={() => {
                          goTo(browseBook, n);
                          closePassagePopover();
                        }}
                      >
                        {n}
                      </button>
                    ))}
                  </div>
                </>
              )}

              {passageView === "books" && (
                <>
                  <div className="popover-search">
                    <SearchIconSmall />
                    <input
                      ref={bookSearchRef}
                      type="text"
                      placeholder="Search books"
                      value={bookQuery}
                      onChange={(e) => setBookQuery(e.target.value)}
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
            className={`version-picker-btn${versionOpen ? " open" : ""}`}
            onClick={openVersionPopover}
          >
            {packageId.toUpperCase()}
            <ChevronIcon />
          </button>
          {versionOpen && (
            <Popover anchorRect={versionAnchor} onClose={closeVersionPopover} width={260} className="version-picker-popover">
              {TRANSLATIONS.map((t) => (
                <button
                  key={t.code}
                  className={`version-picker-item${t.code === packageId ? " active" : ""}`}
                  onClick={() => {
                    setPackageId(t.code);
                    closeVersionPopover();
                  }}
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
          <input
            className={jumpError ? "passage-jump-input error" : "passage-jump-input"}
            value={jumpText}
            placeholder="Go to… (e.g. Rev 14)"
            aria-label="Jump to passage"
            onChange={(e) => { setJumpText(e.target.value); setJumpError(false); }}
          />
        </form>

        <div className="topbar-spacer" />

        {/* Matches the Living Margin's own width when it's open, so these
            two icons sit directly above the panel they act on instead of
            floating at an arbitrary point in a wide, otherwise-empty topbar;
            collapses to content width when the margin is hidden. */}
        <div className={`topbar-margin-slot${marginVisible ? "" : " collapsed"}`}>
          {onToggleMargin && (
            <button
              className={`margin-toggle-btn${marginVisible ? " active" : ""}`}
              onClick={onToggleMargin}
              title={marginVisible ? "Hide Living Margin" : "Show Living Margin"}
            >
              <MarginToggleIcon />
            </button>
          )}

          {onToggleTheme && (
            <button className="theme-toggle-btn" onClick={onToggleTheme} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}>
              {theme === "dark" ? <MoonIcon /> : <SunIcon />}
            </button>
          )}
        </div>
      </div>

      <div className="scripture-body">
      <div className="scripture-content" ref={contentRef}>
        <div className="scripture-inner">
          <div className="chapter-header">
            <span className="book-name">{displayBookName}</span>
            <span className="chapter-number">{chapter}</span>
          </div>

          {semanticData && semanticData.threads.length > 0 && (
            <div className="theme-tag-row">
              {semanticData.threads.slice(0, 3).map((t) => (
                <span key={t.id} className="theme-tag">{t.label}</span>
              ))}
            </div>
          )}

          <div className="verse-text" style={{ position: "relative" }}>
            {chapterData?.verses.map((v, idx) => {
              const color = getHighlightColor(v.verse);
              const prevV = chapterData.verses[idx - 1];
              const nextV = chapterData.verses[idx + 1];
              const contAbove = !!color && !!prevV && getHighlightColor(prevV.verse) === color;
              const contBelow = !!color && !!nextV && getHighlightColor(nextV.verse) === color;
              const rowClasses = [
                "verse-line",
                selectedVerses.has(v.verse) ? "selected" : "",
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
                  onClick={(e) => handleVerseClick(v.verse, e)}
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
              <p className="loading-text-inline">Loading text...</p>
            )}

            {chapterError && (
              <div className="chapter-error">
                <p>Failed to load {displayBookName} {chapter}</p>
                <p className="chapter-error-detail">{chapterError}</p>
                <button className="btn-secondary" onClick={() => setRetryToken((t) => t + 1)}>
                  Retry
                </button>
              </div>
            )}

            {!marginVisible && showHighlightPalette && selectedVerses.size > 0 && (
              <div
                ref={paletteRef}
                className="highlight-palette"
                style={{ top: palettePos.top, left: palettePos.left }}
              >
                <button className="hl-btn-yellow" onClick={() => handleHighlight("yellow")} disabled={highlightLoading} title="Yellow" />
                <button className="hl-btn-green" onClick={() => handleHighlight("green")} disabled={highlightLoading} title="Green" />
                <button className="hl-btn-blue" onClick={() => handleHighlight("blue")} disabled={highlightLoading} title="Blue" />
                <button className="hl-btn-pink" onClick={() => handleHighlight("pink")} disabled={highlightLoading} title="Pink" />
                <button className="hl-btn-purple" onClick={() => handleHighlight("purple")} disabled={highlightLoading} title="Purple" />
                {hasExistingHighlight && (
                  <button
                    className="hl-btn-delete"
                    onClick={() => {
                      const toDelete = marginData.highlights.filter(
                        (h) => h.deleted === 0 && [...selectedVerses].some((v) => v >= h.verse_start && v <= h.verse_end),
                      );
                      for (const h of toDelete) {
                        void handleDeleteHighlight(h.id);
                      }
                      setShowHighlightPalette(false);
                      setSelectedVerses(new Set());
                    }}
                    disabled={highlightLoading}
                    title="Remove highlight"
                  >
                    ✕
                  </button>
                )}
                <button
                  className="hl-btn-note"
                  onClick={handleNoteFromSelection}
                  disabled={highlightLoading}
                >
                  Note
                </button>
                {highlightLoading && <span className="hl-loading" />}
              </div>
            )}
          </div>
        </div>
      </div>

      {marginVisible && (
        <LivingMargin
          book={book}
          chapter={chapter}
          marginData={marginData}
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
          onRemoveHighlight={(entityId) => void handleDeleteHighlight(entityId)}
        />
      )}
      </div>
    </div>
  );
}
