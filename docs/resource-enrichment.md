# Resource enrichment brief

You are deciding, for each resource in a task file, **which passage of Scripture
it is about** — or that it is about none.

An importer already linked everything the publisher stated outright. What is
left needs someone to read the page and judge. About 17,000 records are in this
state, most of them Gospel Coalition articles, which carry no scripture tag at
all.

Your answers are merged by a script that validates every row. Nothing you write
is edited by hand afterwards, so the shape below is not a preference.

---

## The loop

1. Read `tasks-NNN.jsonl`. One record per line.
2. For each, open its `url` and decide.
3. Write `answers-NNN.jsonl` beside it — one line per task, same order is helpful
   but not required.
4. Run the merge in dry-run and fix whatever it rejects:

```bash
node --import tsx scripts/merge-resource-enrichment.ts --source the-gospel-coalition --dry-run
```

Every task needs exactly one answer. An answer is either a link or a skip; a
skip is a real answer and is expected to be common.

---

## What a task looks like

```json
{"id":"the-gospel-coalition:article:41231","sourceId":"the-gospel-coalition","kind":"article","title":"The Man Who Wrestled God","url":"https://www.thegospelcoalition.org/article/man-wrestled-god/","publishedAt":"2019-04-02"}
```

## What an answer looks like

```json
{"id":"the-gospel-coalition:article:41231","decision":"link","brefs":["bref:v1/GEN.32.22-GEN.32.32"],"note":"expounds the Jabbok wrestling"}
{"id":"the-gospel-coalition:article:52880","decision":"skip","note":"topical piece on prayer, no passage is its subject"}
{"id":"the-gospel-coalition:sermon:9902","decision":"link","brefs":["bref:v1/ROM.8.1-ROM.8.11","bref:v1/ROM.8.31-ROM.8.39"],"kind":"sermon"}
```

Fields:

| field | required | what it is |
|---|---|---|
| `id` | yes | copied from the task, unchanged |
| `decision` | yes | `"link"` or `"skip"` |
| `brefs` | when linking | one or more coordinates, see below |
| `kind` | no | only if the task's kind is plainly wrong |
| `note` | no | a few words on why; kept out of the app, read by humans |

Everything else about the record — its title, its URL, its date — comes from
the task file. Do not restate it and do not correct it here; if a title is
wrong, that is a separate fix in the importer.

---

## Coordinates

```
bref:v1/BOOK.CHAPTER.VERSE
bref:v1/BOOK.CHAPTER.VERSE-BOOK.CHAPTER.VERSE
```

Book codes are three letters, uppercase: `GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA
1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO
OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP
COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV`

Both ends are always given in full, including the book, even inside one chapter:

```
bref:v1/ROM.8.1-ROM.8.11      Romans 8:1–11
bref:v1/JHN.3.16              a single verse
bref:v1/GEN.1.1-GEN.2.4       across a chapter break
bref:v1/JON.1.1-JON.4.11      a whole short book
```

Verses must exist. `bref:v1/ROM.8.99` is rejected — Romans 8 has 39 verses. The
merge checks every one of these against the app's versification, so a typo comes
back as a rejected row rather than a broken card.

---

## When to link

**Link when the passage is the subject.** The resource expounds it, preaches it,
walks through it, or answers a question about it.

**Prefer the narrowest span that is true.** An article on the prodigal son is
`LUK.15.11-LUK.15.32`, not `LUK.15.1-LUK.15.32` and not the book of Luke. Being
narrower than the resource is wrong; being wider is worse, because a wide span
outranks nothing and buries everything.

**More than one passage is fine** when the resource genuinely treats several.
Three or four is plausible for a sermon; a dozen means it is a topical piece
that quotes widely, which is a skip.

**Whole books are allowed but weak.** A book-length span ranks below every
chapter-level card and will rarely surface. Use it only when a resource really
is about a whole book — an introduction, an overview, a book review.

## When to skip

- **Topical, not textual.** "Five Ways to Pray With Your Children" quotes six
  passages and is about none of them.
- **A verse used as an epigraph.** Being quoted is not being about.
- **Biography, obituary, news, conference notice, Q&A** with no single text.
- **You are not sure.** A skip costs nothing; a wrong link puts a card in front
  of a reader who trusted the passage match.

The rule behind all of these: a reader who opens this card from that passage
should feel it was chosen, not scraped. If you would be embarrassed for them to
click it, skip.

---

## What the merge does with your answers

It refuses more than it accepts if you let it. Every row is checked for:

- an `id` that exists in a task file for this source, answered exactly once
- a `decision` of `link` or `skip`
- at least one `bref` on a link, each one parseable, verse-level, and real in
  the versification
- a `kind` from `article commentary guide podcast sermon video`

Then the whole manifest is validated as one document before anything is written.
If it would not load in the app, nothing is saved and you get the reason.

Records you add are recorded with `matchBasis: "publisher-title"` rather than
`publisher-scripture-tag`, because the publisher did not state this coordinate —
a reader did. That distinction is load-bearing: the app ranks the publisher's own
claims above our readings of them, and the manifest has to keep the difference
visible.

---

## Splitting the work

Each `tasks-NNN.jsonl` is independent. Give one file per worker, collect the
`answers-NNN.jsonl` files back into the same directory, and merge once. Two
workers on one file will collide — the merge reports `answered twice` and
rejects both.

`MANIFEST.json` in the export directory records what was exported, how many
chunks, and how many records were already linked.
