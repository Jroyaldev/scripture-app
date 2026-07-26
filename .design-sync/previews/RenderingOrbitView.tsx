import { RenderingOrbitView } from 'scripture-app';
// The model BUILDERS are not on window.ScriptureApp — .design-sync/entry.tsx
// re-exports RenderingOrbitView and SenseOutlineView but not forwardOrbitModel /
// reverseOrbitModel / senseOutlineModel (its own comment says they ship; the
// export list disagrees). Until the entry exports them, they are imported from
// the source module, which story-imports bundles rather than shimming — these
// are pure functions with no React context, so a bundled copy is safe. The
// VIEW still comes from the shipped bundle above, as house style requires.
import { forwardOrbitModel, reverseOrbitModel } from 'scripture-app';

/**
 * The real app renders inside `.app-shell.theme-porcelain` — the atmosphere
 * tokens live on that class — and this block sits on the 380px study panel.
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
 * Every model below sets a `kicker`. An empty kicker means "the parent owns
 * this heading" — in the app LanguageWordsSection draws the In English /
 * Behind this word / Senses tablist above the block. A preview has no parent,
 * so it owns its own kicker, which is what the field is for.
 */
const kicked = <T extends { kicker: string }>(model: T, kicker: string): T => ({ ...model, kicker });

/**
 * Preview framing, not component surface: the word being studied, so a cell
 * says which word its bands belong to.
 *
 * The orbit never appears without that word in the app — the word card's head
 * carries it — but RenderingOrbitView itself draws no hub. `hubLabel`,
 * `hubMeta` and `hubDir` survive in OrbitViewModel from the donut this
 * replaced and are not rendered anywhere in the current view.
 */
const head = (surface: string, meta: string, dir?: 'rtl', lang?: string) => (
  <div style={{ marginBottom: 'var(--sp-md)' }}>
    <div
      dir={dir}
      lang={lang}
      style={{
        fontFamily: 'var(--font-reading)',
        fontSize: 'var(--fs-xl)',
        lineHeight: 'var(--lh-tight)',
        color: 'var(--text-primary)',
      }}
    >
      {surface}
    </div>
    <div style={{ marginTop: 2, fontSize: 'var(--fs-xs)', color: 'var(--text-tertiary)' }}>
      {meta}
    </div>
  </div>
);

/**
 * ἀρχιερεύς at Acts 24:1 — "after five days the high priest Ananias came down".
 * 122 occurrences in the NT, and the MACULA gloss spectrum buckets them into
 * exactly three renderings, so there is no tail to write. The reader's own
 * verse is the 57-strong "High Priest" band, which the row marks and the focus
 * line names.
 */
const archiereus = {
  lemma: 'ἀρχιερεύς',
  strongPrefixed: 'G749',
  total: 122,
  lemmaCount: 122,
  segments: [
    { label: 'Chief Priests', count: 64, share: 64 / 122 },
    { label: 'High Priest', count: 57, share: 57 / 122, isCurrent: true },
    { label: 'High Priesthood', count: 1, share: 1 / 122 },
  ],
  source: 'package-gloss' as const,
  kind: 'content' as const,
};

/**
 * καταργέω at Romans 6:6 — "that the body of sin might be annulled". 27 uses
 * spread over nine bands, so six fall past the three ranked rows and the tail
 * reads "6 more renderings" — C·4 §3·6's phrase, not a "+6" notation.
 * (The ninth band is the orbit's own "Other (8)" overflow bucket.)
 */
const katargeo = {
  lemma: 'καταργέω',
  strongPrefixed: 'G2673',
  total: 27,
  lemmaCount: 27,
  segments: [
    { label: 'Abolished', count: 3, share: 3 / 27 },
    { label: 'Annulled', count: 3, share: 3 / 27, isCurrent: true },
    { label: 'Away', count: 3, share: 3 / 27 },
    { label: 'Nullify', count: 3, share: 3 / 27 },
    { label: 'Annul', count: 2, share: 2 / 27 },
    { label: 'Destroy', count: 2, share: 2 / 27 },
    { label: 'Fading Away', count: 2, share: 2 / 27 },
    { label: 'Cleared', count: 1, share: 1 / 27 },
    { label: 'Other (8)', count: 8, share: 8 / 27 },
  ],
  source: 'package-gloss' as const,
  kind: 'content' as const,
};

/**
 * חֶסֶד at Psalm 136:1 — "for his steadfast love endures for ever". 237 glossed
 * occurrences from the shipped MACULA Hebrew orbit index, nine bands, so the
 * same six-deep tail. `hubDir: "rtl"` is set because the studied word is
 * Hebrew while its rendering labels stay left-to-right English — that split is
 * why the field exists — but note the current view draws no hub, so the flag
 * has no visible effect today.
 */
const hesed = {
  lemma: 'חֵסֵד',
  strongPrefixed: 'H2617',
  total: 237,
  lemmaCount: 237,
  segments: [
    { label: 'Steadfast Love', count: 127, share: 127 / 237, isCurrent: true },
    { label: 'Kindness', count: 36, share: 36 / 237 },
    { label: 'Love', count: 34, share: 34 / 237 },
    { label: 'Loyalty', count: 12, share: 12 / 237 },
    { label: 'Kind', count: 6, share: 6 / 237 },
    { label: 'Disgrace', count: 2, share: 2 / 237 },
    { label: 'Favor', count: 2, share: 2 / 237 },
    { label: 'Good Deed', count: 2, share: 2 / 237 },
    { label: 'Other (16)', count: 16, share: 16 / 237 },
  ],
  source: 'package-gloss' as const,
  kind: 'content' as const,
};

/**
 * The reverse direction: the English word "love" in the BSB, and the five
 * originals standing behind its 160 aligned occurrences. Greek bands lead
 * because the reader is in a Greek verse (1 Corinthians 13:13); the two Hebrew
 * ones fall into the tail, which counts "words behind it" rather than
 * renderings — the noun changes with the direction.
 */
const behindLove = {
  englishWord: 'love',
  key: 'love',
  total: 160,
  packageId: 'bsb',
  source: 'alignments' as const,
  scopeHint: 'whole Bible · BSB',
  segments: [
    { label: 'ἀγάπη', count: 96, share: 96 / 160, isCurrent: true, strongs: 'G26' },
    { label: 'ἀγαπάω', count: 36, share: 36 / 160, strongs: 'G25' },
    { label: 'φιλέω', count: 3, share: 3 / 160, strongs: 'G5368' },
    { label: 'אָהַב', count: 15, share: 15 / 160, strongs: 'H157' },
    { label: 'אַהֲבָה', count: 10, share: 10 / 160, strongs: 'H160' },
  ],
};

/**
 * The countMeta:false variant — an orbit that ranks without measuring. No
 * builder covers this yet (forwardOrbitModel and reverseOrbitModel are both
 * frequency orbits and hard-set countMeta:true), which is exactly the case the
 * flag was reserved for, so the model is written out here.
 *
 * λόγος and its twelve Louw-Nida senses as MACULA tags them across the NT. The
 * counts are real and stay on the segments; the view is told not to print them,
 * because a sense is a kind and not a quantity, and the kicker says "12 senses"
 * rather than "12 uses".
 */
const logosSenses = {
  hubLabel: 'λόγος',
  hubMeta: 'G3056',
  total: 12,
  kicker: 'Louw-Nida',
  countMeta: false,
  remainderNoun: 'senses',
  ariaLabel: 'Semantic range of λόγος',
  segments: [
    { label: 'word, saying, message, statement, question', count: 201, share: 201 / 351, isCurrent: true },
    { label: 'what is preached, gospel', count: 89, share: 89 / 351 },
    { label: 'speaking, speech', count: 29, share: 29 / 351 },
    { label: 'account, credit, debit', count: 9, share: 9 / 351 },
    { label: 'reason', count: 6, share: 6 / 351 },
    { label: 'Word, Message', count: 6, share: 6 / 351 },
    { label: 'treatise, book, account', count: 4, share: 4 / 351 },
    { label: 'matter, thing, event', count: 3, share: 3 / 351 },
    { label: 'charges, accusation, declaration of wrongdoing', count: 1, share: 1 / 351 },
    { label: 'to consider, to regard, to hold a view', count: 1, share: 1 / 351 },
    { label: 'appearance, to seem to be', count: 1, share: 1 / 351 },
    { label: 'for a message to spread rapidly', count: 1, share: 1 / 351 },
  ],
};

const noop = () => {};

export const HighPriestInActs = () =>
  panel(
    <>
      {head('ἀρχιερεὺς', 'ἀρχιερεύς · G749 · Acts 24:1', undefined, 'grc')}
      <RenderingOrbitView
        model={kicked(forwardOrbitModel(archiereus, 'ἀρχιερεὺς'), 'In English')}
        lang="grc"
      />
    </>
  );

export const SixMoreRenderings = () =>
  panel(
    <>
      {head('καταργηθῇ', 'καταργέω · G2673 · Romans 6:6', undefined, 'grc')}
      <RenderingOrbitView
        model={kicked(forwardOrbitModel(katargeo, 'καταργηθῇ'), 'In English')}
        lang="grc"
      />
    </>
  );

export const HebrewChesed = () =>
  panel(
    <>
      {head('חַסְדּֽוֹ', 'חֵסֵד · H2617 · Psalm 136:1', 'rtl', 'hbo')}
      <RenderingOrbitView
        model={{ ...kicked(forwardOrbitModel(hesed, 'חַסְדּֽוֹ'), 'In English'), hubDir: 'rtl' }}
        dir="rtl"
        lang="hbo"
      />
    </>
  );

/** Two-step activation: hover or focus a row, then activate it again to jump. */
export const BehindThisWord = () =>
  panel(
    <>
      {head('love', 'BSB · 1 Corinthians 13:13')}
      <RenderingOrbitView
        model={kicked(reverseOrbitModel(behindLove), 'Behind this word')}
        onSelectSegment={noop}
      />
    </>
  );

export const SensesWithoutCounts = () =>
  panel(
    <>
      {head('λόγος', 'λόγος · G3056 · John 1:1', undefined, 'grc')}
      <RenderingOrbitView model={logosSenses} lang="grc" />
    </>
  );
