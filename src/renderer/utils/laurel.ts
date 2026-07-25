/**
 * Laurel — the render-side half of the third provenance ink.
 *
 * Quire Rev 04 §3·3: "Provenance is carried by ink. Seal — you wrote it.
 * Slate — the app inferred it. Laurel — a named third party wrote it and we
 * licensed it. Unmarked — the edition, and nothing else may go unmarked."
 *
 * §4's laurel rules, and where each one is enforced:
 *
 *   1. "Never appears without a siglum" — `laurelInk` returns null unless a
 *      non-blank siglum is present, and every laurel component treats null as
 *      "render nothing".
 *   2. "If you cannot name the source you may not use the ink: fall back to
 *      unmarked *and do not show the prose*" — this is the rule that silently
 *      regresses, because the tempting failure mode is to drop the mark and
 *      keep the sentence, which puts licensed prose back into the edition's
 *      unmarked voice. That is precisely the defect ruling 4·5 reversed, so
 *      `laurelInk` returning null must suppress the *text*, not the mark.
 *   3. "The siglum is the only clickable provenance mark, because it is the
 *      only one with somewhere to go" — `href` is separate from `siglum`
 *      exactly so a siglum with nowhere to go renders as static text instead
 *      of a dead button. Seal and slate marks carry no handler at all.
 *   4. "Laurel prose is never edited in place" — enforced at the render sites,
 *      which draw this prose as text nodes only; the capture flow quotes it
 *      into a seal entry rather than opening it for editing.
 *
 * Kept in `src/renderer/utils` and structurally typed so the renderer does not
 * have to reach into `src/core` for it. The core half (`licensed-source.ts`)
 * decides *whether a corpus can be named at all*; this half decides whether
 * what arrived is drawable.
 */

/** The minimum a laurel mark needs: a name, and optionally somewhere to go. */
export type LaurelSource = {
  /** The kicker. `PLEIADES`, `TIPNR`. */
  siglum: string;
  /** Destination for the siglum, or null when the source has no permalink. */
  href: string | null;
};

/** Anything that claims to name a source. Structural, so both the IPC shape
 *  and the core `LicensedSource` satisfy it without an import. */
export type LaurelCandidate = {
  siglum?: string | null;
  href?: string | null;
} | null | undefined;

/**
 * Turn a claimed source into laurel ink, or refuse.
 *
 * Refusing is the important half. A null result means the caller must draw
 * neither the mark, the kicker, nor the prose — see rule 2 above.
 */
export function laurelInk(candidate: LaurelCandidate): LaurelSource | null {
  const siglum = candidate?.siglum?.trim();
  if (!siglum) return null;
  const href = candidate?.href?.trim();
  // A destination has to be a web address. A siglum is a citation, not a shell,
  // and `openExternalResearchUrl` is the only thing on the other end of it.
  return { siglum, href: href && /^https?:\/\//i.test(href) ? href : null };
}

/**
 * How the siglum should be drawn.
 *
 * §4 makes the siglum "the only clickable provenance mark, because it is the
 * only one with somewhere to go" — which means a siglum with nowhere to go, or
 * on a surface with no opener wired to it, must not be drawn as a control. It
 * still has to appear: the ink may not be used without it. So the failure mode
 * is static text, never a button that refuses.
 *
 * Split out of the components so the rule can be asserted directly rather than
 * inferred from a rendered tree.
 */
export type LaurelSiglumRole = "link" | "static";

export function laurelSiglumRole(
  source: LaurelSource,
  canOpen: boolean,
): LaurelSiglumRole {
  return source.href && canOpen ? "link" : "static";
}

/**
 * Screen-reader wording for the mark itself. The mark is a 2px spine with no
 * text, so the sentence it opens needs its provenance said out loud — the same
 * job "Written by you" and "Written by the app" already do for seal and slate.
 */
export function laurelMarkLabel(source: LaurelSource): string {
  return `Licensed from ${source.siglum}`;
}
