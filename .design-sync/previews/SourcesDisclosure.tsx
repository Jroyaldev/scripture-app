import { useEffect, useRef } from 'react';
import { SourcesDisclosure } from 'scripture-app';

/**
 * PREVIEW SETUP ONLY — not part of the component.
 *
 * SourcesDisclosure is a <details>, and <details> ships closed. A screenshot of
 * a closed disclosure is one line of text, so these stories open it after mount
 * exactly the way a reader's click would. `AtRest` deliberately skips this and
 * shows the resting state the panel actually draws.
 */
function Opened({ children }: { children: any }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelectorAll('details').forEach((d) => {
      d.open = true;
    });
  }, []);
  return <div ref={host}>{children}</div>;
}

/**
 * The real app renders inside `.app-shell.theme-porcelain` — the atmosphere
 * tokens live on that class, not on :root — and the Living Margin panel that
 * carries this disclosure is 380px of paper on the canvas.
 */
const panel = (children: any) => (
  <div
    className="app-shell theme-porcelain"
    style={{ display: 'block', height: 'auto', padding: 'var(--sp-md)' }}
  >
    <div
      style={{
        width: 380,
        maxHeight: 560,
        overflow: 'auto',
        boxSizing: 'border-box',
        padding: 'var(--sp-lg)',
        background: 'var(--bg-reading)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-ui)',
        fontSize: 'var(--fs-sm)',
        lineHeight: 'var(--lh-normal)',
      }}
    >
      {children}
    </div>
  </div>
);

/**
 * Preview framing, not component surface. The disclosure opens on a rule
 * because it closes an entry — it is the apparatus at the foot of a word card
 * or an entity card, never a panel of its own — so each story carries the one
 * line of entry it is citing.
 */
const entry = (title: string, line: string, dir?: 'rtl', lang?: string) => (
  <div style={{ marginBottom: 'var(--sp-sm)' }}>
    <div
      dir={dir}
      lang={lang}
      style={{
        fontFamily: 'var(--font-reading)',
        fontSize: 'var(--fs-lg)',
        lineHeight: 'var(--lh-tight)',
        color: 'var(--text-primary)',
      }}
    >
      {title}
    </div>
    <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
      {line}
    </div>
  </div>
);

/**
 * One source — the summary has to read "1 source", not "1 sources". This is the
 * entity card's floor: TIPNR identity and nothing else yet.
 * (LivingMargin's entityCaptureSources emits exactly this row.)
 */
const identityOnly = [
  { name: 'STEPBible TIPNR', license: 'CC BY 4.0', detail: 'Identity' },
];

/**
 * The stack a word card actually shows on ἀρχιερεύς at Acts 24:1 — one row per
 * claim, never one row per panel (brief §3·1), and the three licences kept
 * apart because they genuinely differ: CC BY, CC BY-SA and a non-commercial
 * grant may not be merged into one field (§3·3).
 *
 * Mounce carries an explicit `citation` because its licensor requires that
 * exact sentence, character for character, wherever the definition is used —
 * `formatSourceCitation` prefers `citation` over the assembled "name · licence
 * · detail" string, so Cite copies the licensor's own words.
 */
const wordCardSources = [
  { name: 'MACULA Greek Nestle 1904', license: 'CC BY 4.0', detail: 'Word and gloss' },
  { name: "Strong's", license: 'Public domain', detail: 'G749' },
  {
    name: 'Mounce Concise',
    license: 'Non-commercial, attribution',
    detail: 'G749 · a high-priest, chief-priest',
    citation:
      'Mounce Concise Greek-English Dictionary Copyright 1993 All Rights Reserved www.teknia.com/greek-dictionary',
  },
  { name: 'UBS SDGNT', license: 'CC BY-SA 4.0', detail: '53.89 · Roles and Functions' },
  { name: 'STEPBible TEGMC', license: 'CC BY 4.0', detail: 'Morphology' },
  { name: 'STEPBible TIPNR', license: 'CC BY 4.0', detail: 'Name data' },
];

/**
 * Dates are part of the mark (brief §3·2): "ISBE, 1915" tells a reader how to
 * weight the claim, and it is a feature rather than an apology for old
 * scholarship. Hitchcock's year is marked INFERRED in LICENSES.md, so the row
 * says so rather than presenting 1874 as the module's own claim.
 *
 * This is the entity card for Aaron — TIPNR person record, 333 references.
 */
const datedEntitySources = [
  { name: 'STEPBible TIPNR', license: 'CC BY 4.0', detail: 'Identity · 333 references' },
  { name: 'ISBE', license: 'Public domain', detail: '1915 · Aaron, article' },
  {
    name: "Hitchcock's Bible Names Dictionary",
    license: 'Public domain',
    detail: '1874 (inferred) · Etymology',
  },
  {
    name: 'UBS Semantic Dictionary of Biblical Hebrew',
    license: 'CC BY-SA 4.0',
    detail: 'H175 · Domains',
  },
];

export const OneSource = () =>
  panel(
    <>
      {entry('Ananias', 'Person · high priest during Paul’s trial · 2 references')}
      <Opened>
        <SourcesDisclosure sources={identityOnly} />
      </Opened>
    </>
  );

export const WordCardStack = () =>
  panel(
    <>
      {entry('ἀρχιερεὺς', 'high priest · G749 · Acts 24:1', undefined, 'grc')}
      <Opened>
        <SourcesDisclosure sources={wordCardSources} className="lang-sources" />
      </Opened>
    </>
  );

export const DatedSources = () =>
  panel(
    <>
      {entry('Aaron', 'Person · Moses’ brother, first high priest of Israel · 333 references')}
      <Opened>
        <SourcesDisclosure sources={datedEntitySources} />
      </Opened>
    </>
  );

/** The resting state: the word-card stack as it sits, closed, under the entry. */
export const AtRest = () =>
  panel(
    <>
      {entry('ἀρχιερεὺς', 'high priest · G749 · Acts 24:1', undefined, 'grc')}
      <SourcesDisclosure sources={wordCardSources} className="lang-sources" />
    </>
  );

/**
 * `sources: []` returns null — nothing at all, not an empty disclosure. Drawn
 * inside a labelled box so the empty cell is legibly deliberate rather than a
 * failed render.
 */
export const EmptyRendersNothing = () =>
  panel(
    <div
      style={{
        border: '1px dashed var(--border-subtle)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--sp-md)',
      }}
    >
      <p
        style={{
          margin: '0 0 var(--sp-sm)',
          color: 'var(--text-tertiary)',
          fontSize: 'var(--fs-xs)',
        }}
      >
        Below this line: SourcesDisclosure with an empty list. It returns null, so a
        card with nothing to cite draws no apparatus at all.
      </p>
      <SourcesDisclosure sources={[]} />
    </div>
  );
