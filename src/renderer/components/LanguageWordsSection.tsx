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
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type {
  BookNameData,
  LanguageMorphPart,
  LanguageNameEntityHit,
  LanguagePackageSummary,
  LanguageStepMorph,
  LanguageSyntaxHit,
  LanguageToken,
  LanguageTokenCard,
} from "../api.js";
import { formatCanonicalRef } from "../utils/formatRef.js";
import { safeCall } from "../utils/safeCall.js";
import { laurelInk, laurelMarkLabel } from "../utils/laurel.js";
import {
  RenderingOrbitView,
  SenseOutlineView,
  forwardOrbitModel,
  reverseOrbitModel,
  semanticSenseOutlineModel,
  senseOutlineModel,
} from "./RenderingOrbit.js";
import { StructureModal } from "./StructureModal.js";
import { SourcesDisclosure, formatSourceCitation, type CitationSource } from "./SourcesDisclosure.js";

type OrbitMode = "english" | "behind" | "senses";

/** Session memory for orbit mode pills (not persisted to disk). */
let sessionOrbitMode: OrbitMode = "english";

const NT = new Set([
  "MAT", "MRK", "LUK", "JHN", "ACT", "ROM", "1CO", "2CO", "GAL", "EPH", "PHP",
  "COL", "1TH", "2TH", "1TI", "2TI", "TIT", "PHM", "HEB", "JAS", "1PE", "2PE",
  "1JN", "2JN", "3JN", "JUD", "REV",
]);

interface Props {
  sessionOwnerTabId: string;
  book: string;
  bookDisplayName?: string;
  bookNames?: BookNameData;
  chapter: number;
  verse: number;
  /**
   * Reading translation package (bsb, akjv-strongs, …). Used for reverse
   * orbit when that package has alignments / reverse-index.json.
   */
  readingPackageId?: string;
  /**
   * Fired when the pastor starts studying language (word pick / form notes).
   * Parent should pin this verse so ambient scroll cannot steal the panel.
   */
  onStudyEngage?: (verse: number) => void;
  /**
   * Ambient (reading-eye-line) usage only: once the pastor engages with any
   * study control, hold that verse's card steady instead of collapsing it on
   * the next scroll, until they resume following or the chapter changes.
   */
  freezeOnEngage?: boolean;
  wordsVerse?: number;
  wordsFollowingReading: boolean;
  onWordsStateChange: (
    ownerTabId: string,
    next: { wordsVerse: number; wordsFollowingReading: boolean },
  ) => void;
  onCapture?: (capture: LanguageWordCaptureRequest) => void;
}

export interface LanguageWordCaptureRequest {
  excerpt: string;
  sourceAttribution: string;
  reference: string;
  frozenOrigin: string;
  originLabel: "Word study";
}

type LanguageCitationSource = CitationSource;

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
  if (t.displayGloss) {
    // Two adjacent Hebrew object-marker morphemes otherwise both ellipsize to
    // “object mark…”, which looks like duplicated/truncated data.
    return t.displayGloss.trim().toLowerCase() === "object marker"
      ? "obj. marker"
      : t.displayGloss;
  }
  if (t.gloss) {
    const first = t.gloss.split(/[;.]/)[0]?.trim() ?? "";
    return first.length > 40 ? `${first.slice(0, 37)}…` : first || null;
  }
  return null;
}

function languagePackageLicense(packageId: string): string {
  if (packageId === "macula-greek-nestle1904" || packageId === "oshb-wlc") return "CC BY 4.0";
  return "See installed package license";
}

function languageSourceLicense(sourceName: string): string {
  if (/^STEPBible TE[GH]MC$/.test(sourceName) || sourceName === "STEPBible TIPNR") return "CC BY 4.0";
  if (sourceName === "MACULA / MARBLE") return "CC BY 4.0";
  if (sourceName === "Strong's" || sourceName === "Thayer" || sourceName === "BDB") return "Public domain";
  return "See source license";
}

function dedupeLanguageSources(sources: LanguageCitationSource[]): LanguageCitationSource[] {
  const seen = new Set<string>();
  return sources.filter((source) => {
    const key = `${source.name}|${source.license}|${source.detail ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function languageCardSources(
  card: LanguageTokenCard,
  packageId: string,
  packageName: string,
  strongPeek: NonNullable<LanguageTokenCard["definition"]> | null,
): LanguageCitationSource[] {
  const sources: LanguageCitationSource[] = [
    { name: packageName, license: languagePackageLicense(packageId), detail: "Word and gloss" },
  ];
  if (card.definition) {
    sources.push({
      name: card.definition.source,
      license: languageSourceLicense(card.definition.source),
      detail: card.definition.id,
    });
    if (card.definition.deeper) {
      sources.push({
        name: card.definition.deeper.source,
        license: languageSourceLicense(card.definition.deeper.source),
        detail: card.definition.deeper.id,
      });
    }
  }
  if (card.stepMorph?.source) {
    sources.push({
      name: card.stepMorph.source,
      license: languageSourceLicense(card.stepMorph.source),
      detail: "Morphology",
    });
  }
  if (card.nameEntity) sources.push({ name: "STEPBible TIPNR", license: "CC BY 4.0", detail: "Name data" });
  if (card.semanticSenses) sources.push({ name: "MACULA / MARBLE", license: "CC BY 4.0", detail: "Context senses" });
  if (strongPeek) {
    sources.push({
      name: strongPeek.source,
      license: languageSourceLicense(strongPeek.source),
      detail: strongPeek.id,
    });
    if (strongPeek.deeper) {
      sources.push({
        name: strongPeek.deeper.source,
        license: languageSourceLicense(strongPeek.deeper.source),
        detail: strongPeek.deeper.id,
      });
    }
  }
  return dedupeLanguageSources(sources);
}

export function formatLanguageSourceCitation(source: LanguageCitationSource): string {
  return formatSourceCitation(source);
}

export function buildLanguageWordCapture({
  card,
  packageId,
  packageName,
  reference,
}: {
  card: LanguageTokenCard;
  packageId: string;
  packageName: string;
  reference: string;
}): LanguageWordCaptureRequest {
  const surface = surfaceOf(card.token, card.displaySurface);
  const transliteration = card.definition?.xlit?.trim() || card.definition?.deeper?.xlit?.trim();
  const gloss = (card.gloss ?? card.token.gloss)?.trim();
  const descriptors = [...new Set([transliteration, gloss].filter((value): value is string => Boolean(value)))];
  const wordLine = descriptors.length > 0 ? `${surface} · ${descriptors.join(" · ")}` : surface;
  const definitionLine = card.definition?.firstSense.trim();
  const sourceEntries = dedupeLanguageSources([
    { name: packageName, license: languagePackageLicense(packageId) },
    ...(card.definition ? [{
      name: card.definition.source,
      license: languageSourceLicense(card.definition.source),
    }] : []),
  ]);
  return {
    excerpt: definitionLine ? `${wordLine}\nDefinition: ${definitionLine}` : wordLine,
    sourceAttribution: sourceEntries.map((source) => `${source.name} (${source.license})`).join("; "),
    reference,
    frozenOrigin: reference,
    originLabel: "Word study",
  };
}

/**
 * The head's morph line, and the form notes behind it.
 *
 * C·4 §3·2: "Morphology is spelled out once, at the head, and the duplicate
 * chip row goes." The row of chip spans this block used to draw was
 * built from `card.morphExplain.parts` — the same array, the same words, the
 * same middle dot — as the head's kind line two blocks above it, so the entry
 * said "aorist middle indicative" twice before the reader reached the gloss.
 * C2·7 said step away from the chips; C·4 says where the surviving copy lives.
 * It lives at the head, and it carries the disclosure the chip row carried:
 * the STEP sentences, each part's meaning in plain English, and the parse code
 * and lexicon key that C2·7 kept behind a disclosure rather than on the row.
 *
 * @quire derived · kin: margin entry · the one remaining morph line becomes the
 * trigger, because deleting the duplicate must not also delete what opened.
 */
function MorphFormBlock({
  kindLine,
  parts,
  code,
  strongId,
  stepMorph,
  open,
  onToggle,
}: {
  kindLine: string;
  parts: LanguageMorphPart[];
  code: string;
  strongId?: string | null;
  stepMorph?: LanguageStepMorph | null;
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  // The morph line is never elided. C2·7 draws it whole — "Adjective · dative
  // singular feminine" — and a "+1" standing in for one word costs the reader
  // a click to learn a word that would have fitted on the line it was cut from.
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
        {/* Strong's number left the resting row for the entry's name line,
            where it arrives on hover. It is a lookup key for a book the
            reader does not have open. */}
        <span className="margin-entry-kind lang-detail-kind">{kindLine}</span>
        <span className="lang-form-caret" aria-hidden="true">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <>
          {/* STEP first — easier to notice (esp. OT composites after normalize). */}
          {stepMorph && (stepMorph.explanation?.trim() || stepMorph.phrase?.trim()) ? (
            <div className="lang-step-overlay">
              {/* Owed, not decided: STEPBible TEGMC/TEHMC wrote these sentences
                  verbatim and licensed them CC BY 4.0, so they are laurel by
                  Law 3·3 exactly as TIPNR's brief was. `stepMorph.source` is
                  already in scope here, and the kicker below reads "Form in
                  plain English", which is the app's voice over another author's
                  prose. Left unmigrated only because this corpus is outside the
                  pass ruling 4·5 authorised (TIPNR and Pleiades). */}
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
            </div>
          ) : null}

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
            {/* The code and the lexicon key, behind the disclosure: same
                information as the three chips they replace, one row, and no
                false affordance. */}
            {code ? (
              <li className="lang-form-code">
                <strong>code</strong>
                <span>{code}</span>
              </li>
            ) : null}
            {strongId ? (
              <li className="lang-form-code">
                <strong>lexicon key</strong>
                <span>{strongId}</span>
              </li>
            ) : null}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Strong's definition expander — same row pattern as MorphFormBlock.
 * Closed: first sense line. Open: full English entry + quiet attribution.
 */
function DefinitionBlock({
  definition,
  open,
  onToggle,
}: {
  definition: {
    firstSense: string;
    full: string;
    xlit?: string;
    pronunciation?: string;
    source: string;
    id: string;
    deeper?: {
      firstSense: string;
      full: string;
      source: string;
      id: string;
      xlit?: string;
      senses?: Array<{ n: string; text: string }>;
    } | null;
  };
  open: boolean;
  onToggle: () => void;
}): React.JSX.Element {
  const deeper = definition.deeper;
  return (
    <div className="lang-def">
      <button
        type="button"
        className={`lang-def-row${open ? " is-open" : ""}`}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onToggle();
        }}
        aria-expanded={open}
        title={open ? "Hide definition" : "Show full definition"}
      >
        {/* C2·7 keeps the truncated gloss and its disclosure, but the label
            drops to sentence case on its own line and the caret becomes a
            word. "more" sits at the end of the gloss it continues, because a
            triangle in the corner says "this row expands" without saying what
            is behind it. */}
        <span className="lang-def-kicker">Definition</span>
        <span
          className={`lang-def-preview${open ? " is-open-label" : ""}`}
          dir="ltr"
        >
          {open ? definition.id : definition.firstSense}
          <span className="lang-def-caret">{open ? "less" : "more"}</span>
        </span>
      </button>
      {open && (
        <div className="lang-def-body" dir="ltr">
          {/* Strong's — head layer */}
          {(definition.xlit || definition.pronunciation) && (
            <p className="lang-def-meta">
              {definition.xlit ? <span className="lang-def-xlit">{definition.xlit}</span> : null}
              {definition.xlit && definition.pronunciation ? (
                <span className="lang-dot">·</span>
              ) : null}
              {definition.pronunciation ? (
                <span className="lang-def-pron">{definition.pronunciation}</span>
              ) : null}
            </p>
          )}
          <p className="lang-def-full">{definition.full}</p>

          {/* Deeper lexicon (Thayer Greek / BDB Hebrew) — same expander, second block */}
          {deeper && (
            <div className="lang-def-deeper">
              {deeper.xlit ? (
                <p className="lang-def-meta">
                  <span className="lang-def-xlit">{deeper.xlit}</span>
                </p>
              ) : null}
              {deeper.senses && deeper.senses.length > 0 ? (
                <ol className="lang-def-senses">
                  {deeper.senses.map((s) => (
                    <li key={s.n} className="lang-def-sense">
                      <span className="lang-def-sense-n">{s.n}</span>
                      <span className="lang-def-sense-text">{s.text}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="lang-def-full lang-def-deeper-full">{deeper.full}</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Prefer first content word so the pastor lands on something useful. */
function defaultTokenId(tokens: ChipToken[]): string | null {
  const content = tokens.find(isContentish);
  return (content ?? tokens[0])?.id ?? null;
}

/**
 * One word-map block with quiet mode pills (Structure modal tab style).
 * Corpus modes use one quantitative orbit; Senses uses a structural outline.
 */
function OrbitModesBlock({
  card,
  surface,
  dir,
  lang,
  onJumpStrong,
  onPeekDefinition,
}: {
  card: LanguageTokenCard;
  surface: string;
  dir: "ltr" | "rtl";
  lang: string;
  onJumpStrong: (strongs: string) => boolean;
  onPeekDefinition: (def: NonNullable<LanguageTokenCard["definition"]>) => void;
}): React.JSX.Element | null {
  const panelId = useId();
  const modeRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isGreek = card.token.strongPrefixed?.startsWith("G")
    || card.token.datasetId.includes("macula-greek");
  const senses = isGreek ? undefined : card.definition?.deeper?.senses;
  const senseModel = useMemo(
    () => {
      if (isGreek) {
        return card.semanticSenses
          ? semanticSenseOutlineModel({
              lemma: surface,
              outline: card.semanticSenses,
              strongId: card.token.strongPrefixed ?? undefined,
            })
          : null;
      }
      return senses
        ? senseOutlineModel({
            lemma: surface,
            senses,
            strongId: card.token.strongPrefixed ?? undefined,
            source: card.definition?.deeper?.source,
          })
        : null;
    },
    [
      card.definition?.deeper?.source,
      card.semanticSenses,
      card.token.strongPrefixed,
      isGreek,
      senses,
      surface,
    ],
  );
  const hasEnglish = !!(card.renderingOrbit && card.renderingOrbit.segments.length > 0);
  const hasBehind = !!(card.reverseOrbit && card.reverseOrbit.segments.length > 0);
  const hasSenses = senseModel != null;

  const available = useMemo(() => {
    const m: OrbitMode[] = [];
    if (hasEnglish) m.push("english");
    if (hasBehind) m.push("behind");
    if (hasSenses) m.push("senses");
    return m;
  }, [hasEnglish, hasBehind, hasSenses]);

  const [mode, setMode] = useState<OrbitMode>(() =>
    available.includes(sessionOrbitMode) ? sessionOrbitMode : (available[0] ?? "english"),
  );

  useEffect(() => {
    if (available.length === 0) return;
    if (!available.includes(mode)) {
      const next = available.includes(sessionOrbitMode)
        ? sessionOrbitMode
        : available[0]!;
      setMode(next);
    }
  }, [available, mode]);

  if (available.length === 0) return null;

  const pick = (m: OrbitMode): void => {
    sessionOrbitMode = m;
    setMode(m);
  };

  const moveMode = (index: number): void => {
    if (available.length === 0) return;
    const nextIndex = (index + available.length) % available.length;
    const next = available[nextIndex];
    if (!next) return;
    pick(next);
    window.setTimeout(() => modeRefs.current[nextIndex]?.focus(), 0);
  };

  const onModeKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = index + 1;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = index - 1;
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = available.length - 1;
    if (nextIndex == null) return;
    event.preventDefault();
    moveMode(nextIndex);
  };

  const model =
    mode === "english" && card.renderingOrbit
      ? forwardOrbitModel(card.renderingOrbit, surface)
      : mode === "behind" && card.reverseOrbit
        ? reverseOrbitModel(card.reverseOrbit)
        : null;

  const reverseScope = card.reverseOrbit?.scopeHint?.split(/\s*·\s*/)[0]?.trim();
  const countLabel =
    mode === "senses"
      ? `${senseModel?.total ?? 0} senses`
      : mode === "behind"
        ? `${card.reverseOrbit?.total ?? 0} uses · ${reverseScope || "whole Bible"}`
        : `${card.renderingOrbit?.total ?? 0} uses`;

  return (
    <div className="lang-orbit-block" data-study-surface="word-map">
      <div className="lang-orbit-modes" role="tablist" aria-label="Word map" aria-orientation="horizontal">
        {available.map((availableMode, index) => {
          const label = availableMode === "english"
            ? "In English"
            : availableMode === "behind"
              ? "Behind this word"
              : "Senses";
          const active = mode === availableMode;
          return (
            <button
              key={availableMode}
              ref={(node) => { modeRefs.current[index] = node; }}
              id={`${panelId}-${availableMode}-tab`}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`${panelId}-panel`}
              className={`lang-orbit-mode${active ? " is-active" : ""}`}
              tabIndex={active ? 0 : -1}
              onClick={() => pick(availableMode)}
              onKeyDown={(event) => onModeKeyDown(event, index)}
            >
              {label}
            </button>
          );
        })}
        <span className="lang-orbit-mode-meta" aria-live="polite">{countLabel}</span>
      </div>
      <div
        id={`${panelId}-panel`}
        className="lang-orbit-panel"
        role="tabpanel"
        aria-labelledby={`${panelId}-${mode}-tab`}
      >
        {mode === "senses" && senseModel ? (
          <SenseOutlineView model={senseModel} activeMorphLabels={card.morphLabels} />
        ) : model ? (
          <RenderingOrbitView
            model={model}
            dir={dir}
            lang={lang}
            onSelectSegment={
              mode === "behind"
                ? (i) => {
                    const seg = card.reverseOrbit?.segments[i];
                    if (!seg?.strongs) return;
                    const jumped = onJumpStrong(seg.strongs);
                    if (!jumped && seg.definition) {
                      onPeekDefinition(seg.definition);
                    } else if (!jumped) {
                      // Still open a minimal peek from label alone.
                      onPeekDefinition({
                        id: seg.strongs,
                        firstSense: seg.label,
                        full: seg.label,
                        source: "Strong's",
                      });
                    }
                  }
                : undefined
            }
          />
        ) : null}
      </div>
    </div>
  );
}

/** Lightweight Strong's peek when reverse-band has no verse token (cross-testament). */
function StrongPeekCard({
  definition,
  onClose,
}: {
  definition: NonNullable<LanguageTokenCard["definition"]>;
  onClose: () => void;
}): React.JSX.Element {
  return (
    <div className="lang-strong-peek" role="dialog" aria-label={`Definition ${definition.id}`}>
      <div className="lang-strong-peek-head">
        <span className="lang-strong-peek-id">{definition.id}</span>
        <button type="button" className="lang-strong-peek-close" onClick={onClose}>
          Close
        </button>
      </div>
      {definition.xlit ? <p className="lang-def-meta">{definition.xlit}</p> : null}
      <p className="lang-def-full">{definition.full}</p>
      {definition.deeper?.senses && definition.deeper.senses.length > 0 ? (
        <ol className="lang-def-senses">
          {definition.deeper.senses.map((s) => (
            <li key={s.n} className="lang-def-sense">
              <span className="lang-def-sense-n">{s.n}</span>
              <span className="lang-def-sense-text">{s.text}</span>
            </li>
          ))}
        </ol>
      ) : definition.deeper?.full ? (
        <p className="lang-def-full lang-def-deeper-full">{definition.deeper.full}</p>
      ) : null}
    </div>
  );
}

/** Format APP.ch.v → display "Mat 3:1" style for the margin. */
function formatAppRef(key: string, bookNames?: BookNameData): string {
  return formatCanonicalRef(key, bookNames);
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
function NameEntityCard({ hit, bookNames }: { hit: LanguageNameEntityHit; bookNames?: BookNameData }): React.JSX.Element {
  const [openRefs, setOpenRefs] = useState(false);
  const e = hit.entity;
  const title = prettyName(e.displayName);
  const kindLabel =
    e.kind === "person" ? "Person" : e.kind === "place" ? "Place" : "Deity or object";
  const otherRefs = e.refs.filter((r) => r !== e.firstRef).slice(0, 12);
  // A name collision is stated on the name line, never silently disambiguated
  // — this is the field where a study app most easily lies by omission. The
  // group is ordered by its lexicon key, which is how the source numbers them.
  const sameName = [e, ...hit.alternatives]
    .filter((candidate) => prettyName(candidate.displayName) === title)
    .sort((left, right) => left.uStrong.localeCompare(right.uStrong));
  const collisionIndex = sameName.findIndex((candidate) => candidate.id === e.id) + 1;
  const collision = sameName.length > 1 && collisionIndex > 0
    ? { index: collisionIndex, total: sameName.length }
    : null;
  const otherNames = sameName.filter((candidate) => candidate.id !== e.id);
  // Rev 04 §3·3 · every sentence on this card — the brief, the expanded gloss,
  // and the one-line note beside each same-named alternative — was written by
  // the name index, not by the edition and not by us. One card is one corpus,
  // so one siglum names all of it.
  //
  // @quire derived · kin: margin entry · a single kicker serves the card rather
  // than repeating on the alternatives list, because the ink is the class and
  // the class does not change halfway down a card.
  //
  // §4's fallback is the important branch: if the index cannot name itself,
  // every one of those sentences disappears. Nothing here degrades to unmarked
  // prose, because unmarked would say the edition wrote it.
  const laurel = laurelInk(hit.licensed);

  return (
    <div className={`lang-name-card margin-entry kind-${e.kind}`}>
      <div className="margin-entry-name lang-name-title">
        <span className="margin-entry-name-text">{title}</span>
        {collision && (
          <span className="margin-entry-name-collision">{collision.index} of {collision.total}</span>
        )}
        {e.uStrong && <span className="margin-entry-name-key">{e.uStrong}</span>}
      </div>
      <p className="margin-entry-kind lang-name-kind">
        {[
          kindLabel,
          // Provenance is stated, not hidden in a tooltip: this identity was
          // matched on the verse and the lexicon key, not on the name alone.
          hit.match === "ref+strong" ? "matched in this verse" : null,
          e.refCount === 1 ? "named once" : `named ${e.refCount.toLocaleString()} times`,
        ].filter(Boolean).join(" · ")}
      </p>
      {laurel && (
        <div className="margin-entry-why is-licensed laurel-prose lang-name-licensed">
          <span className="margin-entry-mark is-licensed">
            <span className="sr-only">{laurelMarkLabel(laurel)}</span>
          </span>
          <div className="margin-entry-why-copy">
            {/* No handler: this card has no external-link plumbing of its own,
                so the siglum names the source without pretending to lead
                anywhere. §4 allows the ink only with a siglum; it does not
                require the siglum to be a button. */}
            <span className="margin-entry-siglum is-static">{laurel.siglum}</span>
            <p className="lang-name-brief margin-entry-why-text">{e.brief}</p>
            {e.short && e.short !== e.brief && (
              <p className="lang-name-short">{e.short}</p>
            )}
          </div>
        </div>
      )}
      {otherNames.length > 0 && (
        // Alternatives are never merged. They are listed as themselves.
        <div className="margin-entry-related lang-name-alts">
          <span className="margin-entry-part-label">Others with this name</span>
          <div className="margin-entry-related-list">
            {otherNames.map((alternative) => (
              <span className="margin-entry-relation is-static" key={alternative.id}>
                {/* The name is a label and stays whatever happens. The note
                    beside it is the index's prose, so it goes when the index
                    cannot be named — an alternative listed without its gloss
                    is still listed, which is the point of listing it. */}
                <span className="margin-entry-relation-name">{prettyName(alternative.displayName)}</span>
                {laurel && <span className="margin-entry-relation-note">{alternative.brief}</span>}
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Appears in — three, then a count. The rest is a disclosure, not a
          wall: a reader who wants all 22 is going to Research anyway. */}
      {otherRefs.length > 0 && (
        <div className="margin-entry-appears lang-name-refs">
          <span className="margin-entry-part-label">Appears in</span>
          <div className="margin-entry-appears-list">
            {(openRefs ? otherRefs : otherRefs.slice(0, 3)).map((r) => (
              <span className="margin-entry-appears-row is-static" key={r}>
                <span className="margin-entry-appears-ref">{formatAppRef(r, bookNames)}</span>
              </span>
            ))}
            {e.refCount > 4 && (
              <button
                type="button"
                className="margin-entry-appears-more lang-name-refs-toggle"
                onClick={(ev) => {
                  ev.stopPropagation();
                  setOpenRefs((v) => !v);
                }}
                aria-expanded={openRefs}
              >
                {openRefs ? "Fewer" : `${(e.refCount - 4).toLocaleString()} more`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export function LanguageWordsSection({
  sessionOwnerTabId,
  book,
  bookDisplayName,
  bookNames,
  chapter,
  verse: followedVerse,
  readingPackageId,
  onStudyEngage,
  freezeOnEngage = false,
  wordsVerse,
  wordsFollowingReading,
  onWordsStateChange,
  onCapture,
}: Props): React.JSX.Element | null {
  // Ambient freeze: the first study engagement (word pick, grammar, uses…)
  // holds the controlled verse steady so ordinary scrolling cannot collapse
  // open study state. Fresh navigation supplies a following snapshot; an
  // owner/history restore supplies its own frozen-or-following snapshot.
  const controlledWordsVerse = Number.isInteger(wordsVerse) && (wordsVerse ?? 0) > 0
    ? wordsVerse!
    : followedVerse;
  const verse = wordsFollowingReading
    ? followedVerse
    : freezeOnEngage
      ? controlledWordsVerse
      : followedVerse;
  const readingFrozen = freezeOnEngage && !wordsFollowingReading;
  const [load, setLoad] = useState<LoadState>({ kind: "idle" });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [card, setCard] = useState<LanguageTokenCard | null>(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [definitionOpen, setDefinitionOpen] = useState(false);
  const [usesOpen, setUsesOpen] = useState(false);
  const [syntaxOpen, setSyntaxOpen] = useState(false);
  const [syntaxHit, setSyntaxHit] = useState<LanguageSyntaxHit | null>(null);
  const [syntaxLoading, setSyntaxLoading] = useState(false);
  /** Whether the reading package has a reverse index (null = unknown yet). */
  const [hasReverse, setHasReverse] = useState<boolean | null>(null);
  /** Cross-testament Strong's peek (no token in this verse). */
  const [strongPeek, setStrongPeek] = useState<NonNullable<LanguageTokenCard["definition"]> | null>(
    null,
  );

  // Verse prop is authoritative once parent pins on study engage. We still
  // track local engagement for UI (notes open) but do not fight parent scroll.
  const verseRef = useRef(verse);
  verseRef.current = verse;
  const followedVerseRef = useRef(followedVerse);
  followedVerseRef.current = followedVerse;
  const onStudyEngageRef = useRef(onStudyEngage);
  onStudyEngageRef.current = onStudyEngage;
  const wordsStateChangeRef = useRef(onWordsStateChange);
  wordsStateChangeRef.current = onWordsStateChange;
  const ownerContextKey = `${sessionOwnerTabId}:${book}:${chapter}:${verse}:${readingPackageId ?? ""}`;
  const ownerContextKeyRef = useRef(ownerContextKey);
  ownerContextKeyRef.current = ownerContextKey;
  const tokenRequestSequenceRef = useRef(0);
  const syntaxRequestSequenceRef = useRef(0);

  const engageStudy = useCallback(() => {
    if (freezeOnEngage) {
      wordsStateChangeRef.current(sessionOwnerTabId, {
        wordsVerse: verseRef.current,
        wordsFollowingReading: false,
      });
    }
    onStudyEngageRef.current?.(verseRef.current);
  }, [freezeOnEngage, sessionOwnerTabId]);

  // Book/chapter change always clears local expand state.
  useEffect(() => {
    setGrammarOpen(false);
    setDefinitionOpen(false);
    setUsesOpen(false);
    setSyntaxOpen(false);
    setSyntaxHit(null);
    setShowAll(false);
  }, [book, chapter, sessionOwnerTabId]);

  // When parent verse changes (new pin / ambient), close expanders so STEP
  // notes always belong to the card on screen.
  useEffect(() => {
    setGrammarOpen(false);
    setDefinitionOpen(false);
    setUsesOpen(false);
    setSyntaxOpen(false);
    setSyntaxHit(null);
  }, [verse]);

  const openToken = useCallback(async (packageId: string, tokenId: string, opts?: { userPick?: boolean }) => {
    const requestSequence = ++tokenRequestSequenceRef.current;
    const requestContextKey = ownerContextKeyRef.current;
    if (opts?.userPick) {
      engageStudy();
      setGrammarOpen(false);
      setDefinitionOpen(false);
      setUsesOpen(false);
      setSyntaxOpen(false);
      setSyntaxHit(null);
      setStrongPeek(null);
    }
    setSelectedId(tokenId);
    setCardLoading(true);
    const result = await safeCall(() =>
      window.api.language.getTokenCard(packageId, tokenId, readingPackageId),
    );
    if (requestSequence !== tokenRequestSequenceRef.current
      || requestContextKey !== ownerContextKeyRef.current) return;
    setCard(result.ok ? result.value : null);
    setCardLoading(false);
  }, [engageStudy, readingPackageId]);

  /**
   * Jump reverse-ring segment → token in this verse with matching Strong's.
   * Returns true if a card was opened; false if caller should show a definition peek.
   */
  const jumpToStrong = useCallback(
    (strongs: string | null | undefined): boolean => {
      if (!strongs || load.kind !== "ready") return false;
      const norm = strongs.toUpperCase().replace(/^([HG])0+/, "$1");
      const digits = norm.replace(/^[HG]/, "");
      const hit =
        load.tokens.find((t) => {
          const sp = (t.strongPrefixed ?? "").toUpperCase();
          const s = (t.strong ?? "").replace(/^0+/, "");
          // Require letter match when both sides have H/G prefix.
          if (sp && sp[0] !== norm[0]) return false;
          return sp === norm || s === digits;
        }) ?? null;
      if (hit) {
        setStrongPeek(null);
        void openToken(load.packageId, hit.id, { userPick: true });
        return true;
      }
      return false;
    },
    [load, openToken],
  );

  // Reverse index is BSB-backed for all translations (akjv when reading AKJV).
  useEffect(() => {
    let cancelled = false;
    const probeId =
      readingPackageId === "akjv-strongs" ? "akjv-strongs" : "bsb";
    void safeCall(() => window.api.language.hasReverseIndex(probeId)).then((res) => {
      if (cancelled) return;
      setHasReverse(res.ok ? !!res.value : false);
    });
    return () => {
      cancelled = true;
    };
  }, [readingPackageId]);

  const toggleGrammar = useCallback(() => {
    setGrammarOpen((prev) => {
      if (!prev) engageStudy();
      return !prev;
    });
  }, [engageStudy]);

  const toggleDefinition = useCallback(() => {
    setDefinitionOpen((prev) => {
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

  const closeStructureModal = useCallback(() => {
    setSyntaxOpen(false);
  }, []);

  /** Full-page structure modal — margin is only the trigger. */
  const openStructureModal = useCallback(async () => {
    engageStudy();
    setSyntaxOpen(true);
    if (!card || load.kind !== "ready") return;
    if (syntaxHit?.focusTokenId === card.token.id) return;
    const requestSequence = ++syntaxRequestSequenceRef.current;
    const requestContextKey = ownerContextKeyRef.current;
    setSyntaxLoading(true);
    const result = await safeCall(() =>
      window.api.language.getSyntaxForToken(load.packageId, book, card.token.id),
    );
    if (requestSequence !== syntaxRequestSequenceRef.current
      || requestContextKey !== ownerContextKeyRef.current) return;
    setSyntaxHit(result.ok ? result.value : null);
    setSyntaxLoading(false);
  }, [engageStudy, card, load, syntaxHit, book]);

  useEffect(() => {
    let cancelled = false;
    setLoad({ kind: "loading" });
    setSelectedId(null);
    setCard(null);
    setShowAll(false);
    setGrammarOpen(false);
    setDefinitionOpen(false);
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
  const reference = `${bookDisplayName ?? book} ${chapter}:${verse}`;
  // The kind line: part of speech, then the form in words. Never the code —
  // that lives in the form disclosure, where someone reading a commentary
  // will look for it. C·4 sets it whole at the head: "Verb · aorist middle
  // indicative, third person singular". The comma is the drawing's, and it is
  // read off the feature families rather than guessed — what the form does
  // (stem, tense, voice, mood) on one side, who it is about (person, number,
  // gender, case) on the other. An adjective has nothing on the first side and
  // reads "Adjective · dative singular feminine", exactly as C2·7 draws it.
  const morphParts = card?.morphExplain?.parts ?? [];
  const morphPos = morphParts.find((part) => part.kind === "pos")?.label;
  const morphAction = morphParts
    .filter((part) => part.kind === "stem" || part.kind === "tense" || part.kind === "voice" || part.kind === "mood")
    .map((part) => part.label);
  const morphAgreement = morphParts
    .filter((part) => part.kind !== "pos" && !(part.kind === "stem" || part.kind === "tense" || part.kind === "voice" || part.kind === "mood"))
    .map((part) => part.label);
  const morphClauses = [morphAction.join(" "), morphAgreement.join(" ")].filter(Boolean).join(", ");
  const morphKindLine = morphPos || morphClauses
    ? [morphPos ? morphPos.charAt(0).toUpperCase() + morphPos.slice(1) : null, morphClauses]
        .filter(Boolean)
        .join(" · ")
    : null;
  const cardSources = card && load.kind === "ready"
    ? languageCardSources(card, load.packageId, load.packageName, strongPeek)
    : [];

  return (
    <div className="margin-section lang">
      <div className="margin-section-header lang-section-header">
        <span>{header}</span>
        {readingFrozen && (
          <button
            type="button"
            className="margin-frame-action"
            onClick={() => wordsStateChangeRef.current(sessionOwnerTabId, {
              wordsVerse: followedVerseRef.current,
              wordsFollowingReading: true,
            })}
            title="Release this study verse and follow your reading"
          >
            Follow reading
          </button>
        )}
      </div>

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
            <div className="lang-detail margin-entry">
              {/* C·2 · part 1 — the lexicon head is the default. The
                  transliteration is italic serif beside it, because it is a
                  pronunciation and not an identifier; Strong's number is a
                  lookup key for a book the reader does not have open, so it
                  waits in space reserved for it and arrives on hover. */}
              <div className="lang-detail-heading margin-entry-name">
                <div
                  className="lang-detail-form margin-entry-name-text"
                  dir={dirAttr}
                  lang={langAttr}
                >
                  {surfaceOf(card.token, card.displaySurface)}
                </div>
                {card.definition?.xlit && (
                  <span className="margin-entry-name-original lang-detail-xlit">{card.definition.xlit}</span>
                )}
                {card.token.strongPrefixed && (
                  <span className="margin-entry-name-key lang-detail-strong">{card.token.strongPrefixed}</span>
                )}
              </div>

              {/* C·2 · part 2, and C·4 §3·2 — morphology spelled out in words,
                  once. A bare parse code is the only genuinely intimidating
                  thing on this surface, and it costs 30px to fix. The chip row
                  that used to repeat this line further down the entry is gone;
                  this is the surviving copy and it opens the form notes. */}
              {card.morphExplain && card.morphExplain.parts.length > 0 ? (
                <MorphFormBlock
                  kindLine={morphKindLine ?? card.morphExplain.summary}
                  parts={card.morphExplain.parts}
                  code={card.morphExplain.code}
                  strongId={card.token.strongPrefixed}
                  stepMorph={card.stepMorph}
                  open={grammarOpen}
                  onToggle={toggleGrammar}
                />
              ) : morphKindLine ? (
                <p className="margin-entry-kind lang-detail-kind">{morphKindLine}</p>
              ) : null}

              {/* C·2 · part 3 — why it is here, in the reading face */}
              {(card.gloss || card.token.gloss) && (
                <p className="lang-detail-gloss margin-entry-why-text" dir="ltr">
                  {card.gloss ?? card.token.gloss}
                </p>
              )}

              {card.definition && (
                <DefinitionBlock
                  definition={card.definition}
                  open={definitionOpen}
                  onToggle={toggleDefinition}
                />
              )}

              {card.nameEntity && (
                <NameEntityCard hit={card.nameEntity} bookNames={bookNames} />
              )}

              {/* One orbit + mode pills (In English · Behind this word · Senses) */}
              <OrbitModesBlock
                card={card}
                surface={surfaceOf(card.token, card.displaySurface)}
                dir={dirAttr}
                lang={langAttr}
                onJumpStrong={jumpToStrong}
                onPeekDefinition={(def) => setStrongPeek(def)}
              />
              {strongPeek && (
                <StrongPeekCard definition={strongPeek} onClose={() => setStrongPeek(null)} />
              )}
              {/* Empty only when BSB reverse index itself is missing */}
              {hasReverse === false && !card.reverseOrbit && (
                <p className="lang-muted lang-reverse-empty">No word data for this translation</p>
              )}

              {/* C·2 · part 4 — three scales in one line, with the
                  abbreviations spelled out to fit the margin's no-mono rule. */}
              <div className="lang-usage margin-entry-fact">
                <span className="lang-usage-label">Frequency</span>
                <span>{card.lemmaFreq.chapter.toLocaleString()} in this chapter</span>
                <span className="lang-dot">·</span>
                <span>{card.lemmaFreq.book.toLocaleString()} in {bookDisplayName ?? book}</span>
                <span className="lang-dot">·</span>
                <span>{card.lemmaFreq.corpus.toLocaleString()} in the corpus</span>
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
              <SourcesDisclosure sources={cardSources} className="lang-sources" />

              {/* C·4 §3·3 — Structure and the capture verb "join the footer
                  where every other destination lives". C2·7 asked for a pane
                  footer and there was none, which is why both were marooned in
                  the body: capture rode the lemma's baseline and Structure sat
                  mid-entry dressed as a button. §C4·6: verbs are words in a
                  footer — no bordered buttons, no circular chips — and the
                  reference closes the row in tabular figures.

                  The Structure drill-down itself is undrawn and parked. This
                  is the link; the destination is not touched. */}
              <div className="lang-footer">
                {onCapture && load.kind === "ready" && (
                  <button
                    type="button"
                    className="margin-capture-action lang-capture-action"
                    aria-label={`Add ${surfaceOf(card.token, card.displaySurface)} word study to a note`}
                    onClick={() => onCapture(buildLanguageWordCapture({
                      card,
                      packageId: load.packageId,
                      packageName: load.packageName,
                      reference,
                    }))}
                  >
                    Add to note
                  </button>
                )}
                <button
                  type="button"
                  className={`lang-syntax-toggle${syntaxOpen ? " is-open" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (syntaxOpen) closeStructureModal();
                    else void openStructureModal();
                  }}
                  aria-expanded={syntaxOpen}
                  aria-haspopup="dialog"
                >
                  Structure
                </button>
                <p className="lang-study-verse" aria-live="polite">
                  {bookDisplayName ?? book} {chapter}:{verse}
                </p>
              </div>
              <StructureModal
                open={syntaxOpen}
                onClose={closeStructureModal}
                hit={syntaxHit}
                loading={syntaxLoading}
                dir={dirAttr}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
