import type React from "react";
import { useState, useEffect, useCallback, useRef } from "react";
import type { BackboneData, BookNameData, ChapterData, QueryResult, SemanticMarginResult } from "../api.js";
import { LivingMargin } from "./LivingMargin.js";

interface Props {
  backbone: BackboneData;
  bookNames: BookNameData;
  navigateRef: { book: string; chapter: number } | null;
  onCreateNote: (prefillBody?: string) => void;
}

const BOOK_ORDER = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI",
  "1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER",
  "LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAM","HAB","ZEP",
  "HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL",
  "EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE",
  "2PE","1JN","2JN","3JN","JUD","REV",
];

export function ScripturePage({ backbone, bookNames, navigateRef, onCreateNote }: Props): React.JSX.Element {
  const [book, setBook] = useState("ACT");
  const [chapter, setChapter] = useState(19);
  const [packageId, setPackageId] = useState("web");
  const [chapterData, setChapterData] = useState<ChapterData | null>(null);
  const [selectedVerses, setSelectedVerses] = useState<Set<number>>(new Set());
  const [marginData, setMarginData] = useState<QueryResult>({ anchors: [], highlights: [], notes: [] });
  const [crossRefs, setCrossRefs] = useState<string[]>([]);
  const [semanticData, setSemanticData] = useState<SemanticMarginResult | null>(null);
  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (navigateRef) {
      setBook(navigateRef.book);
      setChapter(navigateRef.chapter);
    }
  }, [navigateRef]);

  useEffect(() => {
    window.api.scripture.getChapterText(packageId, book, chapter).then(setChapterData);
  }, [book, chapter, packageId]);

  useEffect(() => {
    loadMarginData();
  }, [book, chapter]);

  const loadMarginData = useCallback(async () => {
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) return;
    const result = await window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount);
    setMarginData(result);

    const verses = Math.min(verseCount, 7);
    const xrefResults = await Promise.all(
      Array.from({ length: verses }, (_, i) =>
        window.api.scripture.getCrossRefs(book, chapter, i + 1),
      ),
    );
    setCrossRefs(xrefResults.flat());

    // Load semantic margin (AI)
    const passageText = chapterData?.verses.map((v) => v.text).join(" ") ?? "";
    if (passageText) {
      const semantic = await window.api.ai.semanticMargin({
        book,
        startChapter: chapter,
        startVerse: 1,
        endChapter: chapter,
        endVerse: verseCount,
        passageText,
      });
      setSemanticData(semantic);
    }
  }, [book, chapter, backbone, chapterData]);

  const bookData = backbone.books[book];
  const chapterCount = bookData?.chapters.length ?? 0;
  const displayBookName = bookNames[book]?.[0] ?? book;

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
    const containerRect = contentRef.current?.getBoundingClientRect();
    if (containerRect) {
      setPalettePos({
        top: rect.top - containerRect.top + (contentRef.current?.scrollTop ?? 0) - 36,
        left: rect.right - containerRect.left + 8,
      });
      setShowHighlightPalette(true);
    }
  }, []);

  const handleHighlight = async (color: string) => {
    if (selectedVerses.size === 0) return;
    const sorted = [...selectedVerses].sort((a, b) => a - b);
    await window.api.library.createHighlight(book, chapter, sorted[0]!, sorted[sorted.length - 1]!, color, packageId);
    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    loadMarginData();
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
    return hl ? `highlighted-${hl.color}` : "";
  };

  return (
    <div className="scripture-page">
      <div className="scripture-content" ref={contentRef}>
        <div className="scripture-inner">
          <div className="chapter-nav">
            <select value={book} onChange={(e) => { setBook(e.target.value); setChapter(1); }}>
              {BOOK_ORDER.map((b) => (
                <option key={b} value={b}>{bookNames[b]?.[0] ?? b}</option>
              ))}
            </select>
            <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
              {Array.from({ length: chapterCount }, (_, i) => (
                <option key={i + 1} value={i + 1}>{i + 1}</option>
              ))}
            </select>
            <div className="package-toggle">
              <button className={packageId === "web" ? "active" : ""} onClick={() => setPackageId("web")}>WEB</button>
              <button className={packageId === "kjv" ? "active" : ""} onClick={() => setPackageId("kjv")}>KJV</button>
            </div>
          </div>

          <div className="chapter-header">
            <span className="book-name">{displayBookName}</span>
            <span className="chapter-number">{chapter}</span>
          </div>

          <div className="verse-text" style={{ position: "relative" }}>
            {chapterData?.verses.map((v) => (
              <div
                key={v.verse}
                className={`verse-line ${selectedVerses.has(v.verse) ? "selected" : ""} ${getHighlightClass(v.verse)}`}
                onClick={(e) => handleVerseClick(v.verse, e)}
              >
                <sup className="verse-num">{v.verse}</sup>
                {v.text}
              </div>
            ))}

            {!chapterData && (
              <p style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
                Loading text...
              </p>
            )}

            {showHighlightPalette && selectedVerses.size > 0 && (
              <div className="highlight-palette" style={{ top: palettePos.top, left: palettePos.left }}>
                <button className="hl-btn-yellow" onClick={() => handleHighlight("yellow")} />
                <button className="hl-btn-green" onClick={() => handleHighlight("green")} />
                <button className="hl-btn-blue" onClick={() => handleHighlight("blue")} />
                <button className="hl-btn-pink" onClick={() => handleHighlight("pink")} />
                <button className="hl-btn-purple" onClick={() => handleHighlight("purple")} />
                <button
                  style={{ fontSize: "var(--fs-xs)", width: "auto", padding: "0 6px" }}
                  onClick={handleNoteFromSelection}
                >
                  Note
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <LivingMargin
        book={book}
        chapter={chapter}
        marginData={marginData}
        crossRefs={crossRefs}
        bookNames={bookNames}
        semanticData={semanticData}
        onPinClaim={async (claimId, assertion) => {
          await window.api.ai.pinClaim(claimId, assertion);
        }}
      />
    </div>
  );
}
