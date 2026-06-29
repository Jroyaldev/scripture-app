import React, { useState, useEffect, useCallback, useRef } from "react";
import type { BackboneData, BookNameData, ChapterData, QueryResult } from "../api.js";
import { LivingMargin } from "../components/LivingMargin.js";

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
  const [showHighlightPalette, setShowHighlightPalette] = useState(false);
  const [palettePos, setPalettePos] = useState({ top: 0, left: 0 });
  const contentRef = useRef<HTMLDivElement>(null);

  // Navigate to ref from external source
  useEffect(() => {
    if (navigateRef) {
      setBook(navigateRef.book);
      setChapter(navigateRef.chapter);
    }
  }, [navigateRef]);

  // Load chapter text
  useEffect(() => {
    window.api.scripture.getChapterText(packageId, book, chapter).then(setChapterData);
  }, [book, chapter, packageId]);

  // Load margin data when chapter changes or selection changes
  useEffect(() => {
    loadMarginData();
  }, [book, chapter]);

  const loadMarginData = useCallback(async () => {
    const verseCount = backbone.books[book]?.chapters[chapter - 1] ?? 0;
    if (verseCount === 0) return;
    const result = await window.api.library.queryRange(book, chapter, 1, book, chapter, verseCount);
    setMarginData(result);

    // Load cross-references for all verses
    const allXrefs: string[] = [];
    for (let v = 1; v <= Math.min(verseCount, 5); v++) {
      const refs = await window.api.scripture.getCrossRefs(book, chapter, v);
      allXrefs.push(...refs);
    }
    setCrossRefs(allXrefs);
  }, [book, chapter, backbone]);

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
        if (next.has(verse) && next.size === 1) {
          next.clear();
          setShowHighlightPalette(false);
          return next;
        }
        next.clear();
        next.add(verse);
      }
      if (next.size > 0) {
        const rect = (event.target as HTMLElement).getBoundingClientRect();
        const containerRect = contentRef.current?.getBoundingClientRect();
        if (containerRect) {
          setPalettePos({
            top: rect.top - containerRect.top + contentRef.current!.scrollTop - 36,
            left: rect.right - containerRect.left + 8,
          });
          setShowHighlightPalette(true);
        }
      } else {
        setShowHighlightPalette(false);
      }
      return next;
    });

    // Load cross-refs for selected verse
    window.api.scripture.getCrossRefs(book, chapter, verse).then((refs) => {
      setCrossRefs(refs);
    });
  }, [book, chapter]);

  const handleHighlight = useCallback(async (color: string) => {
    if (selectedVerses.size === 0) return;
    const sorted = Array.from(selectedVerses).sort((a, b) => a - b);
    const verseStart = sorted[0]!;
    const verseEnd = sorted[sorted.length - 1]!;
    await window.api.library.createHighlight(book, chapter, verseStart, verseEnd, color, packageId);
    setShowHighlightPalette(false);
    setSelectedVerses(new Set());
    loadMarginData();
  }, [selectedVerses, book, chapter, packageId, loadMarginData]);

  const handleCreateNoteFromPassage = useCallback(() => {
    if (selectedVerses.size === 0) return;
    const sorted = Array.from(selectedVerses).sort((a, b) => a - b);
    const verseStart = sorted[0]!;
    const verseEnd = sorted[sorted.length - 1]!;
    const refStr = verseStart === verseEnd
      ? `${displayBookName} ${chapter}:${verseStart}`
      : `${displayBookName} ${chapter}:${verseStart}-${verseEnd}`;
    onCreateNote(refStr);
  }, [selectedVerses, displayBookName, chapter, onCreateNote]);

  const getVerseHighlightClass = (verse: number): string => {
    const hl = marginData.highlights.find(
      (h) => h.verse_start <= verse && h.verse_end >= verse && h.deleted === 0,
    );
    if (hl) return `highlighted-${hl.color}`;
    return "";
  };

  return (
    <div className="scripture-page">
      <div className="scripture-content" ref={contentRef} style={{ position: "relative" }}>
        <div className="scripture-inner">
          <div className="chapter-nav">
            <select value={book} onChange={(e) => { setBook(e.target.value); setChapter(1); }}>
              {BOOK_ORDER.map((code) => (
                <option key={code} value={code}>{bookNames[code]?.[0] ?? code}</option>
              ))}
            </select>
            <select value={chapter} onChange={(e) => setChapter(Number(e.target.value))}>
              {Array.from({ length: chapterCount }, (_, i) => i + 1).map((ch) => (
                <option key={ch} value={ch}>Chapter {ch}</option>
              ))}
            </select>
            <div className="package-toggle">
              <button className={packageId === "web" ? "active" : ""} onClick={() => setPackageId("web")}>WEB</button>
              <button className={packageId === "kjv" ? "active" : ""} onClick={() => setPackageId("kjv")}>KJV</button>
            </div>
            {selectedVerses.size > 0 && (
              <button onClick={handleCreateNoteFromPassage} style={{
                padding: "4px 12px", border: "1px solid var(--border-medium)",
                borderRadius: "var(--radius-sm)", background: "var(--bg-surface)",
                fontSize: "var(--fs-xs)", cursor: "pointer",
              }}>
                + Note from selection
              </button>
            )}
          </div>

          <div className="chapter-header">
            <span className="book-name">{displayBookName}</span>
            <span className="chapter-number">{chapter}</span>
          </div>

          <div className="verse-text">
            {chapterData?.verses.map((v) => (
              <span
                key={v.verse}
                className={`verse-line ${selectedVerses.has(v.verse) ? "selected" : ""} ${getVerseHighlightClass(v.verse)}`}
                onClick={(e) => handleVerseClick(v.verse, e)}
              >
                <sup className="verse-num">{v.verse}</sup>
                {v.text}{" "}
              </span>
            ))}
          </div>

          {showHighlightPalette && (
            <div className="highlight-palette" style={{ top: palettePos.top, left: palettePos.left }}>
              <button className="hl-btn-yellow" onClick={() => handleHighlight("yellow")} title="Yellow" />
              <button className="hl-btn-green" onClick={() => handleHighlight("green")} title="Green" />
              <button className="hl-btn-blue" onClick={() => handleHighlight("blue")} title="Blue" />
              <button className="hl-btn-pink" onClick={() => handleHighlight("pink")} title="Pink" />
              <button className="hl-btn-purple" onClick={() => handleHighlight("purple")} title="Purple" />
            </div>
          )}
        </div>
      </div>

      <LivingMargin
        book={book}
        chapter={chapter}
        marginData={marginData}
        crossRefs={crossRefs}
        bookNames={bookNames}
      />
    </div>
  );
}
