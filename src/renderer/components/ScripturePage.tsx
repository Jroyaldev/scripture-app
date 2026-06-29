/**
 * Scripture Page — passage reading, reference navigation, verse numbers.
 * WEB/KJV toggle, optional paragraph mode.
 */

import { useState, useEffect, useCallback } from "react";
import type { CanonicalRef } from "../../core/reference/types.js";

type Props = {
  activeRef: CanonicalRef | null;
  bookNames: Record<string, string[]>;
  onNavigate: (input: string) => void;
};

type VerseData = {
  verse: number;
  text: string;
};

export function ScripturePage({ activeRef, bookNames: _bookNames, onNavigate }: Props) {
  const [verses, setVerses] = useState<VerseData[]>([]);
  const [activePackage, setActivePackage] = useState<string>("web");
  const [refInput, setRefInput] = useState("");
  const [displayTitle, setDisplayTitle] = useState("");

  useEffect(() => {
    if (!activeRef) return;
    void loadText(activeRef, activePackage);
    void formatTitle(activeRef);
  }, [activeRef, activePackage]);

  const loadText = async (ref: CanonicalRef, pkg: string) => {
    const result = await window.electronAPI.readScriptureText({
      book: ref.start.book,
      chapter: ref.start.chapter,
      package: pkg,
    });
    if (result && result.verses) {
      // Filter to the range
      const filtered = result.verses.filter(
        (v) => v.verse >= ref.start.verse && v.verse <= ref.end.verse,
      );
      setVerses(filtered.length > 0 ? filtered : result.verses);
    } else {
      setVerses([]);
    }
  };

  const formatTitle = async (ref: CanonicalRef) => {
    const display = await window.electronAPI.formatDisplay(ref);
    setDisplayTitle(display);
  };

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      if (refInput.trim()) {
        onNavigate(refInput.trim());
        setRefInput("");
      }
    },
    [refInput, onNavigate],
  );

  if (!activeRef) {
    return (
      <div className="scripture-page">
        <div className="empty-state">
          <h2>Open a passage</h2>
          <p>Type a reference like &ldquo;Acts 19:1-7&rdquo; to begin reading.</p>
          <form onSubmit={handleSubmit} style={{ marginTop: "1rem" }}>
            <input
              className="search-input"
              value={refInput}
              onChange={(e) => setRefInput(e.target.value)}
              placeholder="e.g. Acts 19:1-7, John 3:1-8"
            />
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="scripture-page">
      <div className="scripture-header">
        <h1>
          {displayTitle}
          <span className="package-toggle">
            <button
              className={activePackage === "web" ? "active" : ""}
              onClick={() => setActivePackage("web")}
            >
              WEB
            </button>
            <button
              className={activePackage === "kjv" ? "active" : ""}
              onClick={() => setActivePackage("kjv")}
            >
              KJV
            </button>
          </span>
        </h1>
        <form className="ref-nav" onSubmit={handleSubmit}>
          <input
            value={refInput}
            onChange={(e) => setRefInput(e.target.value)}
            placeholder="Go to reference..."
          />
          <button type="submit">Go</button>
        </form>
      </div>

      <div className="scripture-text">
        {verses.length === 0 ? (
          <p style={{ color: "var(--text-tertiary)", fontStyle: "italic" }}>
            No text loaded. Scripture text packages will be available after importing text data.
          </p>
        ) : (
          verses.map((v) => (
            <span key={v.verse} className="verse">
              <sup className="verse-num">{v.verse}</sup>
              <span className="verse-text">{v.text} </span>
            </span>
          ))
        )}
      </div>
    </div>
  );
}
