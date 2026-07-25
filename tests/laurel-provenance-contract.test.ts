/**
 * Laurel — the third provenance ink, and the rules that keep it honest.
 *
 * Quire Rev 04 §3·3 gave provenance a third slot: "Laurel — a named third party
 * wrote it and we licensed it." Ruling 4·5 reversed the earlier decision to ship
 * that prose unmarked, because unmarked means the edition, and a Pleiades brief
 * rendered unmarked was claiming to be scripture.
 *
 * The rule these tests exist for is §4's fallback:
 *
 *   "If you cannot name the source you may not use the ink: fall back to
 *    unmarked *and do not show the prose*."
 *
 * That one regresses silently. The natural repair when a siglum goes missing is
 * to drop the mark and keep the sentence — which puts licensed prose straight
 * back into the edition's unmarked voice, i.e. reinstates the exact defect 4·5
 * reversed, with no visible symptom.
 *
 * The decisions the law turns on therefore live in pure functions rather than
 * inside JSX — `laurelInk` answers "may this prose be drawn at all", and
 * `laurelSiglumRole` answers "may this siglum be a control" — and those are
 * asserted directly here. The components are then checked, in this repo's
 * existing contract-test style, for actually delegating to them; that second
 * half matters because a component that stopped calling `laurelInk` would pass
 * every unit test above it while shipping the defect.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  laurelInk,
  laurelMarkLabel,
  laurelSiglumRole,
} from "../src/renderer/utils/laurel.js";
import {
  namedLicensedSource,
  registeredSigla,
} from "../src/core/entities/licensed-source.js";

const repoRoot = resolve(import.meta.dirname, "..");
const read = (...parts: string[]): string => readFileSync(join(repoRoot, ...parts), "utf-8");

const margin = read("src", "renderer", "components", "LivingMargin.tsx");
const words = read("src", "renderer", "components", "LanguageWordsSection.tsx");
const entriesCss = read("src", "renderer", "styles", "margin-entries.css");
const css = read("src", "renderer", "styles.css");
const main = read("src", "electron", "main.ts");

/* ---------------------------------------------------------------------------
   The crux — no siglum, no prose
   ------------------------------------------------------------------------- */

test("a source that cannot be named yields no ink, which is what suppresses the prose", () => {
  // Not "renders unmarked". Not "renders with a placeholder kicker". Nothing.
  // §4's fallback is to hide the sentence, because an unattributable licensed
  // sentence set in the edition's unmarked voice is the defect ruling 4·5
  // reversed — it is the sentence claiming to be scripture.
  const unnameable = [
    null,
    undefined,
    {},
    { siglum: null },
    { siglum: "" },
    { siglum: "   " },
    // A destination without a name is still nameless. The href is not a siglum.
    { siglum: "", href: "https://pleiades.stoa.org/places/1004" },
  ];

  for (const candidate of unnameable) {
    assert.equal(laurelInk(candidate), null, `named the unnameable: ${JSON.stringify(candidate)}`);
  }
});

test("both laurel components suppress the whole block, not just the mark", () => {
  // This is the assertion that stops the silent regression. The tempting repair
  // when a siglum goes missing is to drop the mark and keep the sentence, and
  // that repair is invisible in review because the page still looks fine — it
  // just quietly starts claiming the edition wrote a licensed brief. So both
  // components must return before they render anything at all.
  const why = /\nfunction MarginEntryWhy\([\s\S]*?\n\}\n/.exec(margin)?.[0];
  assert.ok(why, "MarginEntryWhy has gone");
  assert.match(
    why,
    /const laurel = provenance === "licensed" \? laurelInk\(licensed\) : null;/,
    "MarginEntryWhy no longer asks whether the source can be named",
  );
  assert.match(
    why,
    /if \(provenance === "licensed" && !laurel\) return null;/,
    "MarginEntryWhy no longer suppresses unattributable licensed prose",
  );
  // The guard has to come before any JSX, or a partial tree escapes with it.
  assert.ok(
    why.indexOf("return null;") < why.indexOf("<div className={`margin-entry-why"),
    "MarginEntryWhy renders markup before deciding whether it may",
  );

  const prose = /\nfunction LaurelProse\([\s\S]*?\n\}\n/.exec(margin)?.[0];
  assert.ok(prose, "LaurelProse has gone");
  assert.match(prose, /const laurel = laurelInk\(licensed\);\s*\n\s*if \(!laurel\) return null;/);
});

/* ---------------------------------------------------------------------------
   The siglum is the only clickable provenance mark
   ------------------------------------------------------------------------- */

test("a siglum is a control only when it has somewhere to go", () => {
  // §4: "The siglum is the only clickable provenance mark, because it is the
  // only one with somewhere to go." A siglum whose corpus publishes no
  // permalink still has to be drawn — the ink may not appear without it — but a
  // button that cannot act is a worse promise than plain text.
  const withHref = { siglum: "PLEIADES", href: "https://pleiades.stoa.org/places/1004" };
  const withoutHref = { siglum: "TIPNR", href: null };

  assert.equal(laurelSiglumRole(withHref, true), "link");
  assert.equal(laurelSiglumRole(withHref, false), "static", "no opener in scope, no control");
  assert.equal(laurelSiglumRole(withoutHref, true), "static", "nowhere to go, no control");
  assert.equal(laurelSiglumRole(withoutHref, false), "static");

  // And the component asks rather than deciding for itself.
  assert.match(margin, /laurelSiglumRole\(source, onOpenSource != null\) === "static"/);
  assert.match(
    margin,
    /return <span className="margin-entry-siglum is-static">\{source\.siglum\}<\/span>/,
    "a siglum with nowhere to go must degrade to text, not to a dead button",
  );
});

test("seal and slate marks are inert — the siglum is the only one that acts", () => {
  // The marks are bare spans carrying only screen-reader text. Nothing in the
  // margin may turn one into a control, because neither has a destination.
  for (const mark of ["is-app", "is-reader"] as const) {
    const rendered = new RegExp(
      `<(\\w+)[^>]*className="margin-entry-mark ${mark}"`,
    ).exec(margin);
    assert.ok(rendered, `the ${mark} mark is no longer drawn`);
    assert.equal(rendered[1], "span", `the ${mark} mark became an element that can act`);
  }
  assert.doesNotMatch(
    margin,
    /<button[^>]*className="margin-entry-mark/,
    "a provenance mark other than the siglum became clickable",
  );

  // And in CSS, so a mark sitting inside a clickable lead row — the note leads
  // in the overview are whole-row buttons — cannot silently become the thing
  // the pointer lands on.
  assert.match(
    entriesCss,
    /\.margin-entry-mark\.is-app,\s*\.margin-entry-mark\.is-reader\s*\{[^}]*pointer-events:\s*none/,
    "seal and slate marks must not absorb the pointer",
  );
  const laurelMarkRule = /\.margin-entry-mark\.is-licensed\s*\{([^}]*)\}/.exec(entriesCss)?.[1] ?? "";
  assert.doesNotMatch(
    laurelMarkRule,
    /pointer-events:\s*none/,
    "the laurel mark sits beside the one provenance control and must stay reachable",
  );
});

test("the edition's own text takes no mark and no kicker", () => {
  // Law 3: "Unmarked — the edition, and nothing else may go unmarked." So the
  // unmarked branch has to stay genuinely empty, or the one voice that is
  // allowed to be silent starts speaking.
  const why = /\nfunction MarginEntryWhy\([\s\S]*?\n\}\n/.exec(margin)?.[0] ?? "";
  for (const branch of [/provenance === "app" &&/, /provenance === "reader" &&/, /laurel &&/]) {
    assert.match(why, branch, "a provenance branch went missing");
  }
  assert.doesNotMatch(
    why,
    /provenance === "edition" &&/,
    "the edition grew a mark; unmarked is the whole of its provenance",
  );
});

/* ---------------------------------------------------------------------------
   Naming a source is a lookup that is allowed to fail
   ------------------------------------------------------------------------- */

test("naming a source fails closed rather than inventing a kicker", () => {
  // Slicing a siglum out of the declared name would mean a renamed upstream
  // artifact silently produces a kicker nobody can follow. An unregistered
  // corpus is unnameable, and unnameable prose does not render.
  assert.equal(namedLicensedSource("Some Unregistered Gazetteer", "CC BY 4.0"), null);
  assert.equal(namedLicensedSource("", "CC BY 4.0"), null);
  assert.equal(namedLicensedSource(null, "CC BY 4.0"), null);
  // A corpus that declares no license is not a corpus we can claim to license.
  assert.equal(namedLicensedSource("STEPBible TIPNR", ""), null);
  assert.equal(namedLicensedSource("STEPBible TIPNR", undefined), null);
});

test("the registered corpora are the ones whose prose the app actually draws", () => {
  // Laurel marks authorship. A corpus that contributes only data — coordinates,
  // confidence scores, verse indexes — is deliberately absent, because nobody
  // authored a latitude.
  assert.deepEqual(registeredSigla().sort(), ["PLEIADES", "TIPNR"]);

  const tipnr = namedLicensedSource("STEPBible TIPNR", "CC BY 4.0");
  assert.equal(tipnr?.siglum, "TIPNR");
  assert.equal(tipnr?.license, "CC BY 4.0");

  const pleiades = namedLicensedSource("Pleiades Gazetteer", "CC BY 3.0");
  assert.equal(pleiades?.siglum, "PLEIADES");
});

test("a per-record permalink beats the corpus front door", () => {
  // This is what makes the Pleiades siglum land on the place the reader is
  // reading about rather than on a gazetteer's home page.
  const record = namedLicensedSource(
    "Pleiades Gazetteer",
    "CC BY 3.0",
    "https://pleiades.stoa.org/places/1004",
  );
  assert.equal(record?.href, "https://pleiades.stoa.org/places/1004");

  // And a record URL that is not a web address is refused, not passed through:
  // a siglum is a citation, not a shell.
  const hostile = namedLicensedSource("Pleiades Gazetteer", "CC BY 3.0", "file:///etc/passwd");
  assert.equal(hostile?.href, "https://pleiades.stoa.org/");
  assert.equal(laurelInk({ siglum: "X", href: "javascript:alert(1)" })?.href, null);
});

test("every siglum destination the app can produce is one the host will open", () => {
  // §4 calls the siglum clickable "because it is the only one with somewhere to
  // go". A destination the main process refuses is not somewhere to go — it is
  // a button that always fails, which is worse than no button at all. So every
  // home URL in the registry has to be on the research-link allowlist.
  const allowlist = /const ALLOWED_RESEARCH_LINK_HOSTS = new Set\(\[([\s\S]*?)\]\)/.exec(main)?.[1];
  assert.ok(allowlist, "could not find the research-link allowlist");

  for (const siglum of registeredSigla()) {
    const source = siglum === "TIPNR"
      ? namedLicensedSource("STEPBible TIPNR", "CC BY 4.0")
      : namedLicensedSource("Pleiades Gazetteer", "CC BY 3.0");
    assert.ok(source?.href, `${siglum} has no destination at all`);
    const host = new URL(source.href).hostname;
    assert.ok(
      allowlist.includes(`"${host}"`),
      `${siglum} points at ${host}, which the host process will refuse to open`,
    );
  }
});

test("the mark says its provenance out loud", () => {
  // The mark is a 2px spine with no text, so the sentence it opens needs its
  // provenance said aloud — the same job "Written by you" and "Written by the
  // app" already do for seal and slate.
  assert.equal(laurelMarkLabel({ siglum: "TIPNR", href: null }), "Licensed from TIPNR");
});

/* ---------------------------------------------------------------------------
   Migration — every licensed string in the margin is on the ink
   ------------------------------------------------------------------------- */

test("no licensed prose is left in the edition's unmarked voice", () => {
  // Ruling 4·5. Before this pass, TIPNR's brief was drawn inside
  // `provenance="edition"`, which the component's own contract defines as
  // "unmarked = it is the edition". Two sentences by STEPBible were therefore
  // presented as the edition's own.
  const editionBlocks = [...margin.matchAll(
    /<MarginEntryWhy\s+provenance="edition"[\s\S]*?<\/MarginEntryWhy>/g,
  )].map((match) => match[0]!);

  for (const block of editionBlocks) {
    assert.doesNotMatch(block, /\.brief\b/, "a licensed brief is drawn as the edition's own text");
    assert.doesNotMatch(block, /\.short\b/, "a licensed gloss is drawn as the edition's own text");
    assert.doesNotMatch(block, /\.description\b/, "a licensed description is drawn as the edition's own text");
  }
});

test("every laurel render site is handed a source to name", () => {
  // `provenance="licensed"` without a `licensed=` prop cannot name anything, so
  // it would suppress its own prose at runtime — silently removing content
  // instead of marking it. Catch that here rather than in the margin.
  const sites = [...margin.matchAll(/<MarginEntryWhy\b([\s\S]*?)>/g)].map((match) => match[1]!);
  const licensedSites = sites.filter((props) => /provenance="licensed"/.test(props));
  assert.ok(licensedSites.length >= 2, "expected the migrated laurel entries to be present");
  for (const props of licensedSites) {
    assert.match(props, /licensed=\{/, "a laurel entry was given no source to name");
  }
});

test("the gazetteer's own description hangs off a laurel mark", () => {
  // Pleiades wrote this sentence. It sat unmarked in --text-secondary, which is
  // the edition's voice, and it is the exact case §9's third trigger names:
  // "that is how a Pleiades brief came to claim it was scripture."
  assert.match(
    margin,
    /<LaurelProse[\s\S]{0,320}entity-pleiades-description/,
    "the Pleiades description must be drawn inside a laurel block",
  );
  assert.doesNotMatch(
    margin,
    /\{place\.description && <p className="entity-pleiades-description">/,
    "the unmarked Pleiades paragraph is back",
  );
});

test("the words panel suppresses its whole licensed card rather than unmarking it", () => {
  // One card is one corpus, so one siglum names all of it — and when the index
  // cannot name itself, the brief, the expanded gloss and the note beside each
  // same-named alternative all go. The alternative's *name* stays: a name is a
  // label, and an alternative listed without its gloss is still listed.
  assert.match(words, /const laurel = laurelInk\(hit\.licensed\)/);
  assert.match(words, /\{laurel && <span className="margin-entry-relation-note">/);

  // The brief has to sit inside the laurel block, not merely somewhere in the
  // same file: the laurel wrapper opens on `{laurel && …}`, so a brief drawn
  // outside it would render whether or not the corpus could be named.
  const laurelBlock = /\{laurel && \(\s*<div className="margin-entry-why is-licensed[\s\S]*?\n {6}\)\}/
    .exec(words)?.[0];
  assert.ok(laurelBlock, "the words panel has no laurel block");
  assert.match(laurelBlock, /margin-entry-mark is-licensed/);
  assert.match(laurelBlock, /margin-entry-siglum/);
  assert.match(laurelBlock, /\{e\.brief\}/, "the brief must be drawn inside the laurel block");
  assert.match(laurelBlock, /\{e\.short\}/, "the expanded gloss must be drawn inside it too");

  // …and nowhere else in the card.
  assert.equal(
    (words.match(/\{e\.brief\}/g) ?? []).length,
    1,
    "the licensed brief is drawn more than once, and only one copy is guarded",
  );
});

/* ---------------------------------------------------------------------------
   The ink itself
   ------------------------------------------------------------------------- */

test("laurel is drawn in the laurel token, never in an ink borrowed from elsewhere", () => {
  // §9's first trigger is "you need a colour that is not in the palette". The
  // answer is not to reach for seal or a hand-mixed hex; laurel is a declared
  // token in every atmosphere, and both the mark and the kicker consume it.
  assert.match(
    entriesCss,
    /\.margin-entry-mark\.is-licensed\s*\{[^}]*background:\s*var\(--accent-laurel\)/,
    "the laurel mark must be inked in --accent-laurel",
  );
  assert.match(
    entriesCss,
    /\.margin-entry-siglum\s*\{[^}]*color:\s*var\(--accent-laurel\)/,
    "the siglum must be inked in --accent-laurel",
  );

  // Wherever slate is declared, laurel is declared. Three inks or none — an
  // atmosphere that ships two of them puts laurel prose in an undefined colour.
  const slateBlocks = (css.match(/--accent-machine:/g) ?? []).length;
  const laurelBlocks = (css.match(/--accent-laurel:/g) ?? []).length;
  assert.equal(
    laurelBlocks,
    slateBlocks,
    "laurel must be declared in every atmosphere that declares slate",
  );
});

test("laurel takes seal's geometry, not slate's", () => {
  // The 2px spine already means "a person wrote this sentence"; the 4px dot
  // already means "this was computed". A licensed brief is authorship, so it
  // belongs on the spine side, and the hue carries the whole difference.
  const laurelRule = /\.margin-entry-mark\.is-licensed\s*\{([^}]*)\}/.exec(entriesCss)?.[1] ?? "";
  assert.match(laurelRule, /width:\s*2px/);
  assert.doesNotMatch(laurelRule, /border-radius:\s*50%/, "laurel must not take the machine dot");
});

test("the margin's siglum keeps the margin's voice", () => {
  // §8 leaves mono to "header instruments, key hints and reference labels", but
  // the margin gave up mono entirely — serif for content, UI sans for handles —
  // and a siglum inside an entry belongs to the entry's voice first.
  const siglumRule = /\.margin-entry-siglum\s*\{([^}]*)\}/.exec(entriesCss)?.[1] ?? "";
  assert.match(siglumRule, /font-family:\s*var\(--font-ui\)/);
  assert.doesNotMatch(siglumRule, /--font-mono/);
});

test("the siglum's focus ring is the language's focus ring", () => {
  // Rev 04 §4 · full-strength seal, outside the shape. Never inset: an inset
  // outline lands on the element's own fill and loses its ratio.
  const focusRule = /\.margin-entry-siglum:focus-visible\s*\{([^}]*)\}/.exec(entriesCss)?.[1] ?? "";
  assert.match(focusRule, /outline:\s*2px solid var\(--accent-seal\)/);
  assert.match(focusRule, /outline-offset:\s*2px/);
});

/* ---------------------------------------------------------------------------
   The boundaries — where laurel must not go
   ------------------------------------------------------------------------- */

test("laurel does not leak into connections — every connection is seal", () => {
  // Rev 04 §8, withdrawing an earlier ambiguity: "Laurel does not apply to
  // connections — every connection is authored, so every connection is seal."
  for (const [selector, body] of [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => [match[1]!.replace(/\/\*[\s\S]*?\*\//g, " ").trim(), match[2]!] as const)) {
    if (/\.connection-|\.scripture-workspace-/.test(selector)) {
      assert.doesNotMatch(
        body,
        /--accent-laurel/,
        `${selector} inks a connection surface in laurel`,
      );
    }
  }

  const connectionCard = read("src", "renderer", "components", "ConnectionCard.tsx");
  assert.doesNotMatch(connectionCard, /laurel/i, "the connection inspector reached for laurel");
});

test("laurel prose is never edited in place", () => {
  // Rev 04 §4: "Laurel prose is never edited in place — editing it makes it
  // yours, and it becomes a seal entry quoting a laurel one." So the licensed
  // string may be drawn as a text node and copied into a note, but must never
  // be bound to a control that writes back to it. The capture flow is the law's
  // second clause, not a breach of its first: it quotes into a new seal entry
  // and leaves the laurel entry untouched.
  for (const [file, source] of [["LivingMargin.tsx", margin], ["LanguageWordsSection.tsx", words]] as const) {
    // `contentEditable` as an *attribute we set* is the breach. The margin's
    // focus-trap selector mentions the attribute in order to find other
    // people's editable nodes, which is the opposite of making one.
    // The JSX attribute is the breach. The margin's focus-trap selector names
    // the lowercase HTML attribute in order to *find* other people's editable
    // nodes, which is the opposite of making one.
    assert.doesNotMatch(
      source,
      /\scontentEditable\s*=/,
      `${file} makes an element in the margin directly editable`,
    );
    const bindings = [...source.matchAll(
      /<(?:textarea|input|ControlTextarea|ControlInput)\b[\s\S]{0,400}?\/?>/gi,
    )];
    for (const binding of bindings) {
      for (const field of [/\.brief\b/, /place\.description\b/, /\.short\b/]) {
        assert.doesNotMatch(
          binding[0]!,
          field,
          `${file} binds licensed prose to an editable control`,
        );
      }
    }
  }
});
