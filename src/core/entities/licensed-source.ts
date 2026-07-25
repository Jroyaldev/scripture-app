/**
 * Naming the third parties whose prose we licensed.
 *
 * Quire Rev 04 §3·3 gave provenance a third ink: "Laurel — a named third party
 * wrote it and we licensed it." Rev 04 §7 ruling 4·5 reversed the earlier
 * decision to ship that prose unmarked, because unmarked means the edition, and
 * a Pleiades brief rendered unmarked was claiming to be scripture.
 *
 * §4's laurel rules are the reason this module exists rather than a string
 * constant at each render site:
 *
 *   "Never appears without a siglum — the ink is the class, the kicker is the
 *    name (PLEIADES, TIPNR). If you cannot name the source you may not use the
 *    ink: fall back to unmarked *and do not show the prose*."
 *
 * So naming has to be a lookup that can *fail*, and failure has to be a value
 * the renderer can see. A corpus this registry does not know is a corpus whose
 * prose does not render — that is the whole point, and it is why
 * `namedLicensedSource` returns null instead of inventing a kicker out of the
 * declared name. Deriving "TIPNR" by slicing "STEPBible TIPNR" would mean a
 * renamed upstream artifact silently produces a siglum nobody can follow.
 *
 * This module is pure TypeScript (INV-18): no I/O, no host globals.
 */

/**
 * A source we can name at the point its prose is drawn. Every field here has a
 * job on the surface: `siglum` is the kicker, `href` is the destination that
 * makes the siglum the only clickable provenance mark, and `name`/`license`
 * feed the citation the sources disclosure and the note capture already build.
 */
export type LicensedSource = {
  /** The kicker beside the laurel mark. Short, upper case, followable. */
  siglum: string;
  /** The corpus as it is credited in LICENSES.md, e.g. "STEPBible TIPNR". */
  name: string;
  /** SPDX-ish short form, e.g. "CC BY 4.0". */
  license: string;
  /**
   * Where the siglum goes. Null is legal and means the siglum renders as
   * static text rather than a button — a provenance mark with nowhere to go
   * must not pretend to be a link.
   */
  href: string | null;
};

/**
 * The registry. One row per corpus whose *prose* we render — sentences a human
 * at that institution wrote. Corpora that contribute only data (coordinates,
 * confidence scores, morphology codes, verse indexes) are deliberately absent:
 * laurel marks authorship, and nobody authored a latitude.
 *
 * `homeUrl` is the fallback destination, used when a record carries no URL of
 * its own. Pleiades records do carry one (`place.sourceUrl`, a per-place
 * pleiades.stoa.org permalink) and it is preferred; TIPNR entities do not, so
 * the dataset landing page is the best destination that exists.
 */
/* @quire trigger · taxonomy · public-domain third-party prose has no slot.
   Law 3·3 reads "Laurel — a named third party wrote it and *we licensed it*",
   and the app also renders prose nobody licensed to us because it is out of
   copyright: Strong's, Thayer and BDB set full dictionary entries in the words
   panel. Those sentences are not ours, not inferred, and not the edition — so
   three of the four slots are wrong — but the fourth says "licensed", which
   they are not. §9 forbids widening the nearest slot, "that is how a Pleiades
   brief came to claim it was scripture", so they are deliberately NOT in this
   registry and are still drawn unmarked pending an answer. The question is one
   sentence: does laurel mean "someone else wrote it" or "someone else wrote it
   and we hold a licence"? If the former, three more rows go here. */

const REGISTRY: ReadonlyArray<{
  match: RegExp;
  siglum: string;
  homeUrl: string;
}> = [
  {
    // TIPNR wrote `TipnrEntity.brief` and `.short` — the one-line identity and
    // the expanded sentence under More. Both are prose, both were unmarked.
    //
    // @quire guessed · laurel siglum destination · TIPNR publishes no
    // per-entity permalink, so the siglum lands on the corpus home page that
    // LICENSES.md already credits rather than on the record a reader is
    // actually reading. §4 says the siglum is clickable "because it is the only
    // one with somewhere to go"; this is somewhere, but it is not the record.
    match: /\btipnr\b/i,
    siglum: "TIPNR",
    homeUrl: "https://www.stepbible.org/",
  },
  {
    // Pleiades wrote `PleiadesPlace.description` — the ancient-record brief.
    match: /\bpleiades\b/i,
    siglum: "PLEIADES",
    homeUrl: "https://pleiades.stoa.org/",
  },
];

/** Only http(s) may become a destination; a siglum is not a shell. */
function usableDestination(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}

/**
 * Name a source, or fail to. Returns null when the declared name matches no
 * registered corpus, when the name is blank, or when no license is declared —
 * all three are the same condition in §4's terms: we cannot name it, so its
 * prose must not be shown.
 *
 * `recordUrl` lets a per-record permalink beat the corpus home page, which is
 * what makes the Pleiades siglum land on the place a reader is actually
 * reading about rather than on a gazetteer's front door.
 */
export function namedLicensedSource(
  declaredName: string | null | undefined,
  license: string | null | undefined,
  recordUrl?: string | null,
): LicensedSource | null {
  const name = declaredName?.trim();
  const licenseText = license?.trim();
  if (!name || !licenseText) return null;
  const row = REGISTRY.find((candidate) => candidate.match.test(name));
  if (!row) return null;
  return {
    siglum: row.siglum,
    name,
    license: licenseText,
    href: usableDestination(recordUrl) ?? usableDestination(row.homeUrl),
  };
}

/** The sigla this build knows how to name, for contract tests and diagnostics. */
export function registeredSigla(): string[] {
  return REGISTRY.map((row) => row.siglum);
}
