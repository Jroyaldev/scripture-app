# Feature ideas — what the existing machinery makes cheap

Lens: features a pastor would reach for on a Tuesday night, ranked by reader-joy per effort.
Every idea cites the machinery in the snapshot at `scratchpad/worktrees/ideation-snapshot`
(commit 9130779) that makes it real. Nothing below duplicates in-flight work (study-line
authoring gestures, player Builds 2/3, connections revival) — each idea assumes those land
and builds on top of them.

Ground truth used throughout: 41,426 timed moments across 1,170 chapters
(`~/ScriptureLibrary/.artifacts/passage-index.json`, loader `src/host/passage-index-loader.ts`);
3,208 episodes with reference files and 3,521 transcripts carrying unused word-level timings
(`src/core/transcripts.ts:32-45` drops `text`/`brefs`; `words` array is never used past
`readingLines`); occurrence alignments for KJV/WEB/YLT
(`data/scripture/packages/{kjv,web,ylt}/occurrence-alignments-v1.jsonl`, core
`src/core/annotations/occurrence-alignment.ts`); 29,364 OpenBible cross-reference rows
(`data/cross-references/openbible.jsonl`, loader `src/host/cross-reference-loader.ts`);
TIPNR people index (`data/scripture/names/tipnr-index.json`) and Pleiades places with
coordinates, media, and a land-outline geojson (`data/scripture/places/pleiades-4.1.json`,
`natural-earth-50m-land.geojson`); authored-revision history
(`src/host/git-revision-store.ts`, `snapshot-revision-store.ts`, `revision-append.ts`);
notes core + search (`src/core/notes/`, `search-notes` IPC at `src/electron/main.ts:2592`);
local embeddings (`src/host/local-embeddings.ts`, `embeddings-store.ts`); study-group
mutations (`src/renderer/utils/studyWorkspace.ts`).

---

## 1. Hear this chapter taught — a chapter listening queue  *(weekend)*

**What.** One control on the chapter (or in the Taught Here block): "Listen through this
chapter" — a play queue of the chapter's moments, longest treatments first, each launching
at its timestamp and advancing to the next when the treatment's span ends. Romans 8 becomes
a 40-minute walk through what eight shows have said about it, while the chapter stays open
on paper.

**Why this app.** The whole queue already exists as data: `momentsFor`
(`src/core/passage-index.ts:211-243`) returns the chapter's moments banded `on/whole/chapter`
and sorted longest-first; every moment has a playable `audioUrl` (validated `https://` at
`:162` — 100% coverage); `playPodcastEpisode` + the `nowPlaying` store
(`src/renderer/components/PodcastPlayer.tsx:165-188`, `:125-158`) already launch any moment at
its second; MediaSession is live for hardware keys. The only new code is a queue array and an
"advance on span end" timer against the reference's treatment length. No new data, no new
surface — the player Build 2 sheet is the UI.

**Must NOT become.** An autoplay radio or an algorithmic "up next." The queue is the
chapter's own moments in a declared order, visible in full before it starts, and it ends
when the chapter ends. No recommendations, no cross-chapter drift.

---

## 2. Pull the threads — one gesture that assembles a sermon study  *(week)*

**What.** From a pinned selection (the marking gesture that already exists), one command:
"Start a study from this passage." It creates a named study group whose tabs are: the passage
itself, its strongest cross-references as passage tabs, and the people/places present as
entity tabs — the Tuesday-night spread, laid out in one act instead of eleven.

**Why this app.** Every ingredient is a live query and every act is an existing mutation.
Cross-references: 29,364 rows in `data/cross-references/openbible.jsonl` with vote weights,
loaded by `src/host/cross-reference-loader.ts`. Entities in range: the TIPNR index and the
entity plumbing that already powers entity workspace tabs
(`src/renderer/utils/studyWorkspace.ts` — `openEntityWorkspaceTab :1515`). Group creation:
`createStudyWorkspaceGroup :454` plus `openPassageWorkspaceTab :1816` inserting into the new
group; the naming popover handshake already exists
(`openWorkspaceGroupNamingAfterCommit`, app.tsx:969-977). Capacity feedback
(`workspaceCapacityFeedback.ts`) already handles the 64-tab cap. This is orchestration of
five existing calls, not new machinery — and it makes the just-landed study line the thing
that pays off the marking gesture.

**Must NOT become.** An AI sermon-outline generator, or a study pre-stuffed with twenty tabs.
Cap the seed at ~4 tabs (top 2-3 crossrefs by vote weight, entities only if the selection
names them), show exactly what will open before it opens, and let the reader delete freely.
The app assembles evidence; it never drafts the sermon.

---

## 3. The fair copy — export a study as a typeset handout  *(week)*

**What.** "Print this study": a study group renders to one or two pages of the app's own
paper grammar — the passage text with the reader's washes as printed underlines, loom-bracket
connections redrawn in ink, margin notes set as sidenotes, seals as small marks, with an
honest provenance footer (translation, package SHA, sources). A Bible-class handout or a
pulpit copy, straight from Tuesday's work.

**Why this app.** The hard part of print export — knowing exactly which characters an
annotation covers — is already solved: backbone token anchors resolve to char offsets via the
occurrence alignments (`src/core/annotations/occurrence-alignment.ts` — fragments are
`[char_start, char_end, occurrence_positions]` against SHA-bound package text, "the sole
render source"). Connection geometry is already computed as pure layout
(`src/renderer/utils/connectionGeometry.ts`, `connectionRowLayout.ts`,
`connectionPaint.ts`) so the brackets can be re-emitted as print SVG. Notes are structured
(`src/core/notes/`). Electron ships `webContents.printToPDF` — no dependency. The design
system's ink-and-weight law is *made* for monochrome paper; this is the one export that
looks like the app because the app already looks like print.

**Must NOT become.** A report builder. No templates, no options panel, no logos, no font
picker. One paper grammar, the app's own, take it or leave it. If it grows a settings sheet
it has failed.

---

## 4. By heart — memorization on the alignment spine  *(week)*

**What.** Mark a verse "learning it" (a seal — reader authorship already has a mark grammar).
The verse then offers a quiet recall mode: progressive word-masking on paper (first letters,
then blanks), recite, reveal. Because the verse is anchored to spine occurrences, the same
memory work renders in KJV, WEB, or YLT — the reader memorizes in his preaching translation.

**Why this app.** Word-masking is trivially exact here and nowhere else: occurrence-alignment
fragments give per-occurrence char ranges into the package text
(`occurrence-alignments-v1.jsonl` for all three packages;
`src/core/annotations/occurrence-alignment.ts`), so hiding "every third occurrence" is a
`slice` operation, not a tokenizer. The seal vocabulary and marking surface exist
(`src/renderer/components/MarkingSurface.tsx`). Bonus, nearly free: the Taught Here block
already knows where a verse is preached (`momentsFor` with verse banding, `on` band), so a
verse being memorized can offer "hear it taught" as an aid — hearing a text preached is how
pastors have always memorized it.

**Must NOT become.** A spaced-repetition app with streaks, decks, and due-counts. No
notification, no score, no percentage. The verse remembers it is being learned; the reader
decides when to sit with it. Progress is a seal state, not a chart.

---

## 5. The collation — three translations, one verse, shared ink  *(week)*

**What.** From any verse: a collation card (margin or popover) laying KJV, WEB, and YLT
renderings in parallel. Hover or touch a word in one and its counterpart occurrences light
in the other two — same spine occurrence, three English clothings. For a preacher deciding
whether to say "propitiation" or "atoning sacrifice," this is the decision surface.

**Why this app.** This is the occurrence-alignment spine demonstrating itself: all three
packages carry `occurrence-alignments-v1` artifacts mapping char ranges to shared
`occurrence_positions` (`src/core/annotations/occurrence-alignment.ts`), so cross-lighting is
a lookup, not NLP. The store is loaded (`src/host/occurrence-alignment-store.ts`), and the
alignments just shipped with freshness and conformance gates (commit d3712ab) — this feature
is the first *reader-facing* return on that investment. Per the alignment-lab memory:
English-to-English via the spine, Greek/Hebrew never a mandatory pivot — this card honors
that exactly.

**Must NOT become.** An interlinear dashboard or a fourth reading pane. It is a card
summoned for one verse and dismissed; the paper stays the single reading surface. No
permanent split view, no Strong's numbers printed by default.

---

## 6. The ledger of a passage — your history with this text  *(weekend)*

**What.** On any chapter, a quiet margin entry: "You have been here." The dates you marked
it, the notes you wrote and how they changed, the study it belonged to — a reader's own
provenance, in the same footing grammar the app uses for publishers. Opening Romans 8 in
2027 and seeing your 2026 hand is the moment this app becomes a life companion instead of
a tool.

**Why this app.** Every authored act is already recorded with history: git-backed revisions
(`src/host/git-revision-store.ts`, `snapshot-revision-store.ts`, `revision-append.ts` —
STATUS.md confirms authored-revision flushing is hardened), and notes/marks are anchored to
passages so a per-chapter query is an index read. The Living Margin already has the exact
place for it (a fourth block alongside Taught Here). Provenance honesty is a stated design
law — this extends it to the reader's own work.

**Must NOT become.** An activity dashboard, heatmap, or "your year in review." No counts,
no graphs, no streaks. Prose and dates, at most three lines, expandable. It reads like a
library slip in the back of a book, not like GitHub.

---

## 7. Search my own margin  *(weekend)*

**What.** A command-palette scope: "in my notes and marks." Type "wineskins" and get every
note, wash quote, and connection label you have ever authored that touches it, each row
landing on its passage. The pastor's real Tuesday question is rarely "what does the Bible
say" — it is "where did I write that down."

**Why this app.** The pieces exist and are half-wired: `search-notes` IPC is live
(`src/electron/main.ts:2592`) with a query parser (`src/core/search/note-search-query.ts`);
mark quotes are derivable exactly via alignment char ranges (idea 3's machinery); the
command palette is the established entry (`src/renderer/components/CommandPalette.tsx`).
Local embeddings (`src/host/local-embeddings.ts`, `embeddings-store.ts`) can widen recall
later — but ship exact-match first; this reader values evidence over vibes.

**Must NOT become.** A second search app or a global omnibox that mixes scripture text,
notes, and podcasts into one ranked soup. Scopes stay named and separate; a result always
says what it is and where it lives.

---

## 8. The locator — an ink map for every place  *(week)*

**What.** When a place entity opens (or appears in the margin), a small locator drawn in the
app's own ink: the Natural-Earth coastline as a hairline, a single point for the place, the
distance from Jerusalem in a caption. Lystra stops being a word and becomes *somewhere* —
one glance, no atlas chrome.

**Why this app.** The cartography is already on disk and licensed:
`data/scripture/places/pleiades-4.1.json` (coordinates), `natural-earth-50m-land.geojson`
(coastlines), `openbible-places.json`, plus a `media/` directory — all behind
`src/host/place-research-loader.ts` and `src/core/entities/pleiades-research.ts`. Rendering
a geojson outline as a single-color SVG path is a projection function, not a mapping stack.
Ink-and-weight over fills is the design law; a hairline coastline with one dot *is* that law
applied to geography.

**Must NOT become.** A slippy map. No tiles, no zoom controls, no satellite layer, no pins
cluster. It is an engraving, fixed and quiet; if the reader wants Google Earth he has it.

---

## 9. The word's trail — where this word walks  *(week)*

**What.** Long-press a word in the AKJV: a margin list of the other places the same
underlying occurrence-word appears, grouped by book, each row a quotation with the word set
in slightly heavier ink. "Comfort" in 2 Corinthians 1 unfolds into its ten neighbors —
concordance work at the speed of a gesture.

**Why this app.** `data/scripture/packages/akjv-strongs` carries Strong's-tagged text, the
lexicons and morphology are in `data/scripture/lexicons` and `data/scripture/morph`, and the
backbone token index (`data/scripture/backbone-token-v1.jsonl` + index) gives the reverse
lookup shape (`src/host/reverse-index-loader.ts` exists). Per the alignment-spine memory,
third-party Strong's data must be screened before trusting it — the trail should render with
its footing declared (AKJV/Strong's, public data) per the provenance law, which the footing
grammar already supports.

**Must NOT become.** A Strong's-number interface. The reader sees English words and
quotations; codes stay in the provenance footer. And it must not auto-open — it is summoned,
like everything else in the margin.

---

## 10. Tomorrow's page — a next-chapter ritual with one voice  *(weekend)*

**What.** On launch, if the reader left off mid-book, the paper opens where he left it and
the margin offers exactly one thing: the next chapter's single longest treatment ("Spoken
Gospel walks Exodus 15 — 22 minutes"). A morning-reading ritual: read the page, then let one
trusted voice walk it with you.

**Why this app.** `recentPassages.ts` already tracks where the reader has been; the passage
index answers "best moment for this chapter" in one call (`momentsFor` returns
longest-first); launching it is `playPodcastEpisode`. Total new surface: one margin line and
one sort. The 41,426-moment corpus means nearly every chapter a pastor would read
devotionally (1,170 chapters covered) has a companion waiting.

**Must NOT become.** A homepage. No "daily verse," no reading-plan engine, no streak, no
carousel of suggestions. One line, one voice, dismissible forever per-book. If the reader
ignores it three times, it should learn to be quieter, not louder.

---

## Ranking rationale

**1 (chapter queue)** leads because it is a weekend of orchestration over the app's largest
asset (41,426 moments, 100% playable) and converts the corpus from lookup material into a
sustained listening practice — the highest joy-per-line-of-code in the list. **2 (pull the
threads)** is the sermon-prep centerpiece and the payoff of the study line, all existing
mutations. **3 (fair copy)** is the only idea that leaves the app and lands in a pew, and
the alignment/geometry machinery makes it honest rather than lossy. **4-5** are the
reader-facing return on the alignment-spine investment. **6-7** are weekend-tier and deepen
ownership. **8-10** are genuine delights that must be built exactly as small as specified
or not at all.
