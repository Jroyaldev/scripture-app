/**
 * Original-language strip for the Living Margin.
 *
 * Design goals (pastor, daily use, Shepherdly minimal):
 * - No tutorial copy once learned
 * - English always visible next to the form
 * - One clear selection → meaning + form
 * - Grammar detail only when opened
 * - Counts as a quiet line, not a dashboard
 */

import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  LanguageMorphPart,
  LanguageNameEntityHit,
  LanguagePackageSummary,
  LanguageStepMorph,
  LanguageSyntaxHit,
  LanguageToken,
  LanguageTokenCard,
} from "../api.js";
import { safeCall } from "../utils/safeCall.js";
import { RenderingOrbitView } from "./RenderingOrbit.js";
import { SyntaxArtView } from "./SyntaxArt.js";

/** Closed row shows at most this many grammar chips (+ optional Strong's id). */
const MORPH_CHIP_MAX = 5;

const NT = new Set([
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP",
  "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE",
  "1JN", "2JN", "3JN", "JUD", "REV",
]);

interface Props {
  book: string;
  chapter: number;
  verse: number;
  /**
   * Fired when the pastor starts studying language (word pick / form notes).
   * Parent should pin this verse so ambient scroll cannot steal the panel.
   */
  onStudyEngage?: (verse: number) => void;
}

type ChipToken = LanguageToken & {
  displayGloss?: string | null;
  hoverGloss?: string | null;
  displaySurface?: string;
  order?: number;
};

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "empty"; message: string }
  | {
      kind: "ready";
      packageId: string;
      packageName: string;
      language: string;
      tokens: ChipToken[];
    };

function isNtBook(book: string): boolean {
  return NT.has(book);
}

function pickLanguagePackage(
  packages: LanguagePackageSummary[],
  book: string,
): LanguagePackageSummary | null {
  if (isNtBook(book)) {
    const grc = packages.filter((p) => p.language === "grc" || p.family === "macula-greek");
    return grc.find((p) => p.id === "macula-greek-nestle1904") ?? grc[0] ?? null;
  }
  const hbo = packages.filter(
    (p) => p.language === "hbo" || p.family === "oshb" || p.family === "macula-hebrew",
  );
  return hbo.find((p) => p.id === "oshb-wlc") ?? hbo[0] ?? null;
}

function isContentish(t: ChipToken): boolean {
  const pos = (t.wordClass ?? t.morph.pos ?? "").toLowerCase();
  if (pos === "verb" || pos === "noun" || pos === "adj" || pos === "adjective") return true;
  if (t.lemma && t.strong && t.strong !== "3588") return true;
  return false;
}

function surfaceOf(t: ChipToken | LanguageToken, displaySurface?: string): string {
  if (displaySurface) return displaySurface;
  const s = "displaySurface" in t && t.displaySurface ? t.displaySurface : t.surface;
  return s.replace(/\//g, "");
}

function engOf(t: ChipToken): string | null {
  if (t.displayGloss) return t.displayGloss;
  if (t.gloss) {
    const first = t.gloss.split(/[;.]/)[0]?.trim() ?? "";
    return first.length > 40 ? `${first.slice(0, 37)}…` : first || null;
  }
  return null;
}

/**
 * Persistent form row: chips always on; meanings progressive.
 * STEP overlay (Approach A) only when open — never changes chips.
 */
function MorphFormBlock({
  parts,
  code,
  strongId,
  stepMorph,
  open,
  onToggle,
}: {
  parts: LanguageMorphPart[];
  code: string;
  strongId?: string | null;
  stepMorph?: LanguageStepMorph | null;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const overflow = Math.max(0, parts.length - MORPH_CHIP_MAX);
  const chipParts = open || overflow === 0 ? parts : parts.slice(0, MORPH_CHIP_MAX);

  return (
    <div className="lang-form">
      <button
        type="button"
        className={`lang-form-row${open ? " is-open" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-expanded={open}
        title={open ? "Hide form notes" : "Show what these mean"}
      >
        <span className="lang-form-chips">
          {chipParts.map((p) => (
            <span
              key={p.label}
              className={[
                "lang-chip",
                p.kind === "pos" ? "lang-chip-pos" : "",
                p.unknown ? "lang-chip-unknown" : "",
              ]
                .filter(Boolean)
                .join(" ")}
            >
              {p.label}
            </span>
          ))}
          {!open && overflow > 0 && (
            <span className="lang-chip lang-chip-more" aria-hidden="true">
              +{overflow}
            </span>
          )}
          {strongId && (
            <span className="lang-chip lang-chip-id">{strongId}</span>
          )}
        </span>
        <span className="lang-form-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <>
          {/* STEP first — easier to notice (esp. OT composites after normalize). */}
          {stepMorph && (stepMorph.explanation?.trim() || stepMorph.phrase?.trim()) ? (
            <div className="lang-step-overlay">
              <div className="lang-step-kicker">Form in plain English</div>
              {stepMorph.phrase?.trim() ? (
                <p className="lang-step-phrase">{stepMorph.phrase.trim()}</p>
              ) : null}
              {stepMorph.explanation?.trim() ? (
                <p className="lang-step-expl">{stepMorph.explanation.trim()}</p>
              ) : null}
              {stepMorph.example?.trim() ? (
                <p className="lang-step-example">
                  <span className="lang-step-example-label">e.g.</span>
                  {stepMorph.example.trim()}
                </p>
              ) : null}
              <p className="lang-step-attr">{stepMorph.source} · CC BY</p>
            </div>
          ) : (
            <p className="lang-step-missing">
              No STEP form note for <code>{code || "this tag"}</code>
              {code?.includes("/") ? " (composite — try the main word only in data)" : ""}
            </p>
          )}

          <ul className="lang-form-notes">
            {parts.map((p) => (
              <li
                key={p.label}
                className={p.unknown ? "lang-form-note-unknown" : undefined}
              >
                <strong>{p.label}</strong>
                <span>{p.meaning}</span>
              </li>
            ))}
            {code ? (
              <li className="lang-form-code">
                <strong>code</strong>
                <span>{code}</span>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}

/** Prefer first content word so the pastor lands on something useful. */
function defaultTokenId(tokens: ChipToken[]): string | null {
  const content = tokens.find(isContentish);
  return (content ?? tokens[0])?.id ?? null;
}

/** Format APP.ch.v → display “Mat 3:1” style for the margin. */
function formatAppRef(key: string): string {
  const m = key.match(/^([A-Z0-9]+)\.(\d+)\.(\d+)$/);
  if (!m) return key;
  return `${m[1]} ${m[2]}:${m[3]}`;
}

/** Soften leftover TIPNR machine ids (Olives_Mount) if an older index is loaded. */
function prettyName(name: string): string {
  if (!name.includes("_") && !/[a-z][A-Z]/.test(name)) return name;
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Za-z])(\d+)(?=\s|$)/g, "$1 $2")
    .replace(/^(.+?)\s+Mount$/i, (_, base: string) =>
      /^Olives$/i.test(base.trim()) ? "Mount of Olives" : `Mount ${base.trim()}`,
    )
    .replace(/^(.+?)\s+Plains$/i, "Plains of $1")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * TIPNR individual card — person/place, not “all same Strong’s”.
 * Progressive: brief always; other refs on demand.
 */
function NameEntityCard({ hit }: { hit: LanguageNameEntityHit }): React.JSX.Element {
  const [openRefs, setOpenRefs] = useState(false);
  const e = hit.entity;
  const title = prettyName(e.displayName);
  const kindLabel =
    e.kind === "person" ? "Person" : e.kind === "place" ? "Place" : "Name";
  const otherRefs = e.refs.filter((r) => r !== e.firstRef).slice(0, 12);

  return (
    <div className={`lang-name-card kind-${e.kind}`}>
      <div className="lang-name-kicker">
        <span className="lang-name-kind">{kindLabel}</span>
        {hit.match === "ref+strong" && (
          <span className="lang-name-match" title="Matched this verse and Strong’s number">
            this verse
          </span>
        )}
      </div>
      <div className="lang-name-title">{title}</div>
      <p className="lang-name-brief">{e.brief}</p>
      {e.short && e.short !== e.brief && (
        <p className="lang-name-short">{e.short}</p>
      )}
      <div className="lang-name-meta">
        {e.uStrong && <span className="lang-name-strong">{e.uStrong}</span>}
        {e.refCount > 0 && (
          <span className="lang-name-refcount">
            {e.refCount} passage{e.refCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {otherRefs.length > 0 && (
        <div className="lang-name-refs">
          <button
            type="button"
            className="lang-name-refs-toggle"
            onClick={(ev) => {
              ev.stopPropagation();
              setOpenRefs((v) => !v);
            }}
            aria-expanded={openRefs}
          >
            {openRefs ? "Hide other refs" : "Other places named"}
            <span aria-hidden="true">{openRefs ? "▴" : "▾"}</span>
          </button>
          {openRefs && (
            <ul className="lang-name-ref-list">
              {otherRefs.map((r) => (
                <li key={r}>{formatAppRef(r)}</li>
              ))}
              {e.refCount > otherRefs.length + 1 && (
                <li className="lang-name-ref-more">+{e.refCount - otherRefs.length - 1} more</li>
              )}
            </ul>
          )}
        </div>
      )}
      {hit.alternatives.length > 0 && (
        <div className="lang-name-alts">
          <span className="lang-name-alts-label">Also at this Strong’s</span>
          <div className="lang-name-alt-chips">
            {hit.alternatives.map((a) => (
              <span key={a.id} className="lang-name-alt-chip" title={a.brief}>
                {prettyName(a.displayName)}
              </span>
            ))}
          </div>
        </div>
      )}
      <p className="lang-name-attr">TIPNR · STEPBible · CC BY</p>
    </div>
  );
}

export function LanguageWordsSection({ book, chapter, verse, onStudyEngage }: Props): React.JSX.Element | null {
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<LanguageTokenCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [usesOpen, setUsesOpen] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [syntaxHit, setSyntaxHit] = useState<LanguageSyntaxHit | null>(null);
  const [syntaxLoading, setSyntaxLoading] = useState(false);

  // Verse prop is authoritative once parent pins on study engage. We still
  // track local engagement for UI (notes open) but do not fight parent scroll.
  const verseRef = useRef(verse);
  verseRef.current = verse;
  const onStudyEngageRef = useRef(onStudyEngage);
  onStudyEngageRef.current = onStudyEngage;

  const engageStudy = useCallback(() => {
    onStudyEngageRef.current?.(verseRef.current);
  }, []);

  // Book/chapter change always clears local expand state.
  useEffect(() => {
    setGrammarOpen(false);
    setUsesOpen(false);
    setSyntaxOpen(false);
    setSyntaxHit(null);
    setShowAll(false);
  }, [book, chapter]);

  // When parent verse changes (new pin / ambient), close expanders so STEP
  // notes always belong to the card on screen.
  useEffect(() => {
    setGrammarOpen(false);
    setUsesOpen(false);
    setSyntaxOpen(false);
    setSyntaxHit(null);
  }, [verse]);

  const openToken = useCallback(async (packageId: string, tokenId: string, opts?: { userPick?: boolean }) => {
    if (opts?.userPick) {
      engageStudy();
      setGrammarOpen(false);
      setUsesOpen(false);
      setSyntaxOpen(false);
      setSyntaxHit(null);
    }
    setSelectedId(tokenId);
    setCardLoading(true);
    const result = await safeCall(() => window.api.language.getTokenCard(packageId, tokenId));
    setCard(result.ok ? result.value : null);
    setCardLoading(false);
  }, [engageStudy]);

  const toggleGrammar = useCallback(() => {
    setGrammarOpen((prev) => {
      if (!prev) engageStudy();
      return !prev;
    });
  }, [engageStudy]);

  const toggleUses = useCallback(() => {
    setUsesOpen((prev) => {
      if (!prev) engageStudy();
      return !prev;
    });
  }, [engageStudy]);

  const toggleSyntax = useCallback(async () => {
    if (syntaxOpen) {
      setSyntaxOpen(false);
      return;
    }
    engageStudy();
    if (!card || load.kind !== "ready") {
      setSyntaxOpen(true);
      return;
    }
    setSyntaxOpen(true);
    if (syntaxHit?.focusTokenId === card.token.id) return;
    setSyntaxLoading(true);
    const result = await safeCall(() =>
      window.api.language.getSyntaxForToken(load.packageId, book, card.token.id),
    );
    setSyntaxHit(result.ok ? result.value : null);
    setSyntaxLoading(false);
  }, [syntaxOpen, engageStudy, card, load, syntaxHit, book]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setSelectedId(null);
    setCard(null);
    setShowAll(false);
    setGrammarOpen(false);
    setUsesOpen(false);
    setSyntaxOpen(false);
    setSyntaxHit(null);

    void (async () => {
      const packagesRes = await safeCall(() => window.api.language.listPackages());
      if (cancelled) return;
      if (!packagesRes.ok) {
        setLoad({ kind: "empty", message: packagesRes.error });
        return;
      }
      const packages = packagesRes.value;
      if (packages.length === 0) {
        setLoad({
          kind: "empty",
          message: isNtBook(book)
            ? "Install a Greek language package to study words here."
            : "Install a Hebrew language package to study words here.",
        });
        return;
      }
      const pkg = pickLanguagePackage(packages, book);
      if (!pkg) {
        setLoad({
          kind: "empty",
          message: isNtBook(book)
            ? "No Greek package found."
            : "No Hebrew package found.",
        });
        return;
      }
      const loadedRes = await safeCall(() => window.api.language.loadPackage(pkg.id));
      if (cancelled) return;
      if (!loadedRes.ok || !loadedRes.value.ok) {
        setLoad({
          kind: "empty",
          message: !loadedRes.ok
            ? loadedRes.error
            : (loadedRes.value.error ?? `Could not load ${pkg.id}.`),
        });
        return;
      }
      const tokensRes = await safeCall(() =>
        window.api.language.getVerseTokens(pkg.id, book, chapter, verse),
      );
      if (cancelled) return;
      if (!tokensRes.ok) {
        setLoad({ kind: "empty", message: tokensRes.error });
        return;
      }
      const tokens = (tokensRes.value ?? []) as ChipToken[];
      if (tokens.length === 0) {
        setLoad({
          kind: "empty",
          message: `No word data for ${book} ${chapter}:${verse}.`,
        });
        return;
      }
      if (cancelled) return;
      setLoad({
        kind: "ready",
        packageId: pkg.id,
        packageName: pkg.name,
        language: pkg.language,
        tokens,
      });
      const id = defaultTokenId(tokens);
      if (id) void openToken(pkg.id, id);
    })();

    return () => {
      cancelled = true;
    };
  }, [book, chapter, verse, openToken]);

  const visibleTokens = useMemo(() => {
    if (load.kind !== "ready") return [];
    // Short verses: show everything. Long: content first.
    if (showAll || load.tokens.length <= 12) return load.tokens;
    const content = load.tokens.filter(isContentish);
    return content.length > 0 ? content : load.tokens;
  }, [load, showAll]);

  if (load.kind === "idle") return null;

  const isHebrew = load.kind === "ready" && load.language === "hbo";
  const langAttr = isHebrew ? "he" : "el";
  const dirAttr = isHebrew ? "rtl" : "ltr";
  const header =
    load.kind === "ready"
      ? isHebrew
        ? "Hebrew"
        : load.language === "grc"
          ? "Greek"
          : "Language"
      : "Language";

  return (
    <div className="margin-section lang">
      <div className="margin-section-header">{header}</div>

      {load.kind === "loading" && <div className="lang-muted">…</div>}

      {load.kind === "empty" && <div className="lang-muted">{load.message}</div>}

      {load.kind === "ready" && (
        <>
          {/* Interlinear strip — the only high-attention control */}
          <div className="lang-strip" role="list">
            {visibleTokens.map((t) => {
              const eng = engOf(t);
              const active = selectedId === t.id;
              const surf = surfaceOf(t);
              return (
                <button
                  key={t.id}
                  type="button"
                  role="listitem"
                  className={`lang-word${active ? " is-active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void openToken(load.packageId, t.id, { userPick: true });
                  }}
                  title={t.hoverGloss ?? t.gloss ?? eng ?? surf}
                  aria-pressed={active}
                  aria-label={eng ? `${surf}, ${eng}` : surf}
                >
                  <span className="lang-word-form" dir={dirAttr} lang={langAttr}>
                    {surf}
                  </span>
                  {eng ? (
                    <span className="lang-word-eng" dir="ltr">{eng}</span>
                  ) : null}
                </button>
              );
            })}
          </div>

          {load.tokens.length > 12 && load.tokens.some((t) => !isContentish(t)) && (
            <button
              type="button"
              className="lang-more"
              onClick={() => setShowAll((v) => !v)}
            >
              {showAll ? "Fewer" : `All ${load.tokens.length}`}
            </button>
          )}

          {cardLoading && <div className="lang-muted">…</div>}

          {!cardLoading && card && (
            <div className="lang-detail">
              {/* Primary: form + English */}
              <div
                className="lang-detail-form"
                dir={dirAttr}
                lang={langAttr}
              >
                {surfaceOf(card.token, card.displaySurface)}
              </div>

              {(card.gloss || card.token.gloss) && (
                <p className="lang-detail-gloss" dir="ltr">
                  {card.gloss ?? card.token.gloss}
                </p>
              )}

              {card.nameEntity && (
                <NameEntityCard hit={card.nameEntity} />
              )}

              {/* Rendering Orbit — corpus gloss spectrum */}
              {card.renderingOrbit && card.renderingOrbit.segments.length > 0 && (
                <RenderingOrbitView
                  orbit={card.renderingOrbit}
                  surface={surfaceOf(card.token, card.displaySurface)}
                  dir={dirAttr}
                  lang={langAttr}
                />
              )}

              {/* Form chips: persistent skeleton; meanings open on demand */}
              {card.morphExplain && card.morphExplain.parts.length > 0 && (
                <MorphFormBlock
                  parts={card.morphExplain.parts}
                  code={card.morphExplain.code}
                  strongId={card.token.strongPrefixed}
                  stepMorph={card.stepMorph}
                  open={grammarOpen}
                  onToggle={toggleGrammar}
                />
              )}

              {/* Syntax art — MACULA tree, progressive */}
              {isNtBook(book) && (
                <div className="lang-syntax-block">
                  <button
                    type="button"
                    className="lang-syntax-toggle"
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleSyntax();
                    }}
                    aria-expanded={syntaxOpen}
                  >
                    {syntaxOpen ? "Hide syntax art" : "Syntax art"}
                    <span aria-hidden="true">{syntaxOpen ? "▴" : "▾"}</span>
                  </button>
                  {syntaxOpen && (
                    syntaxLoading ? (
                      <div className="lang-muted">Loading tree…</div>
                    ) : syntaxHit ? (
                      <SyntaxArtView hit={syntaxHit} dir={dirAttr} lang={langAttr} />
                    ) : (
                      <p className="lang-muted lang-syntax-miss">
                        No syntax tree for this word yet. Import MACULA nodes
                        (`npm run import:macula-syntax`).
                      </p>
                    )
                  )}
                </div>
              )}

              {/* Quiet usage line */}
              <div className="lang-usage">
                <span>{card.lemmaFreq.chapter}× ch</span>
                <span className="lang-dot">·</span>
                <span>{card.lemmaFreq.book}× book</span>
                <span className="lang-dot">·</span>
                <span>{card.lemmaFreq.corpus}× corpus</span>
                {card.occurrencesInBook.length > 1 && (
                  <>
                    <span className="lang-dot">·</span>
                    <button
                      type="button"
                      className="lang-toggle"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleUses();
                      }}
                      aria-expanded={usesOpen}
                    >
                      {usesOpen ? "Hide uses" : "Uses"}
                    </button>
                  </>
                )}
              </div>

              <p className="lang-study-verse" aria-live="polite">
                {book} {chapter}:{verse}
              </p>

              {usesOpen && card.occurrencesInBook.length > 1 && (
                <ul className="lang-uses">
                  {card.occurrencesInBook.slice(0, 10).map((o) => (
                    <li key={o.id} className={o.id === card.token.id ? "is-here" : undefined}>
                      <span className="lang-uses-ref">
                        {o.chapter}:{o.verse}
                      </span>
                      <span className="lang-uses-form" dir={dirAttr} lang={langAttr}>
                        {surfaceOf(o)}
                      </span>
                    </li>
                  ))}
                  {card.occurrencesInBook.length > 10 && (
                    <li className="lang-uses-more">
                      +{card.occurrencesInBook.length - 10}
                    </li>
                  )}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
