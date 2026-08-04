// The Bible itself, readable by the model.
//
// Everything else in this lab hands the model *talk about* scripture; this
// module hands it the text. The tours it was building without this leaned on
// the model's own memory of the passage — a why that says "the text says X"
// should be grounded in the text saying X. The World English Bible is served
// because it is public domain end to end (bundle, display, quote, export all
// granted in its manifest) — a run record that embeds verse text must not
// embed anyone's copyright.
//
// Read-only, same posture as corpus.mjs: nothing here writes.
// (Unrelated caution recorded where cost work will look: run-record dollars
// are whatever OpenRouter billed, promotions included — see pricing.json.)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const LAB_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTURE_DIR = path.resolve(LAB_DIR, '..', '..', 'data', 'scripture');
const TEXT_DIR = path.join(SCRIPTURE_DIR, 'text', 'web');
export const TRANSLATION = 'World English Bible (WEB), public domain';

/* A chapter's verses go back as JSON inside runTool's 14,000-char payload
   cap. Most chapters fit whole; Psalm 119 does not. Rather than let a blind
   truncation snap the JSON mid-verse, the read stops at a verse boundary and
   says how to continue. The budget counts verse TEXT only — measured on
   Psalm 119, JSON overhead adds ~30 chars a verse, so 9,000 of text keeps
   the whole payload comfortably under the cap. */
const CHAR_BUDGET = 9000;

/* Director references are claim-bearing rather than forgiving reader input.
   They therefore use exact book aliases and refuse every range that cannot be
   reproduced exactly from the bundled canon. */
export const DIRECTOR_REFERENCE_MAX_VERSES = 3;
const DIRECTOR_REFERENCE_REFUSAL = 'DIRECTOR_REFERENCE_REFUSED';

let BOOKS = null;

function loadBooks() {
  if (BOOKS) return BOOKS;
  const names = JSON.parse(fs.readFileSync(path.join(SCRIPTURE_DIR, 'book-names-en.json'), 'utf8'));
  const backbone = JSON.parse(fs.readFileSync(path.join(SCRIPTURE_DIR, 'backbone.json'), 'utf8'));
  const aliasToCode = new Map();
  const display = new Map();
  for (const [code, aliases] of Object.entries(names)) {
    display.set(code, Array.isArray(aliases) && aliases[0] ? aliases[0] : code);
    aliasToCode.set(code.toLowerCase(), code);
    for (const alias of Array.isArray(aliases) ? aliases : []) {
      aliasToCode.set(String(alias).toLowerCase().replace(/\s+/g, ' '), code);
    }
  }
  const chapters = new Map();
  for (const [code, entry] of Object.entries(backbone.books || {})) {
    if (Array.isArray(entry?.chapters)) chapters.set(code, entry.chapters.length);
  }
  BOOKS = { aliasToCode, display, chapters };
  return BOOKS;
}

export function resolveBookCode(book) {
  const b = loadBooks();
  const key = String(book ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!key) return null;
  if (b.aliasToCode.has(key)) return b.aliasToCode.get(key);
  for (const [alias, code] of b.aliasToCode) {
    if (alias.startsWith(key)) return code;
  }
  return null;
}

/**
 * Verse text for one chapter, optionally narrowed to a verse range.
 * Ranges are clamped rather than rejected: asking for verses 25-40 of a
 * 31-verse chapter is a reader overshooting, not an error worth a retry.
 */
export function readPassage({ book, chapter, fromVerse = null, toVerse = null }) {
  const b = loadBooks();
  const code = resolveBookCode(book);
  if (!code) return { error: `unknown book "${book}" — use a name like "Genesis" or a code like GEN` };
  const ch = Number(chapter);
  const chapterCount = b.chapters.get(code) ?? null;
  if (!Number.isInteger(ch) || ch < 1 || (chapterCount && ch > chapterCount)) {
    return { error: `${b.display.get(code)} has ${chapterCount ?? '?'} chapters; asked for chapter ${chapter}` };
  }
  let file;
  try {
    file = JSON.parse(fs.readFileSync(path.join(TEXT_DIR, code, `${ch}.json`), 'utf8'));
  } catch {
    return { error: `no text on disk for ${code} ${ch}` };
  }
  const all = Array.isArray(file.verses) ? file.verses : [];
  const lo = fromVerse == null ? 1 : Math.max(1, Number(fromVerse) || 1);
  const hi = toVerse == null ? Infinity : Math.max(lo, Number(toVerse) || lo);

  const verses = [];
  let chars = 0;
  let clipped = false;
  for (const v of all) {
    if (v.verse < lo || v.verse > hi) continue;
    const text = String(v.text ?? '');
    if (chars + text.length > CHAR_BUDGET && verses.length > 0) { clipped = true; break; }
    verses.push({ verse: v.verse, text });
    chars += text.length;
  }
  if (verses.length === 0) {
    return { error: `${b.display.get(code)} ${ch} has verses 1-${all.length}; asked for ${lo}${hi === Infinity ? '+' : `-${hi}`}` };
  }
  const out = {
    translation: TRANSLATION,
    book: code,
    bookName: b.display.get(code),
    chapter: ch,
    verseCount: all.length,
    verses,
  };
  if (clipped) {
    out.note = `long chapter — stopped after verse ${verses.at(-1).verse} of ${all.length}; call again with fromVerse ${verses.at(-1).verse + 1} to read on`;
  }
  return out;
}

function directorReferenceRefusal(input, reason, message, details = {}) {
  return {
    ok: false,
    code: DIRECTOR_REFERENCE_REFUSAL,
    reason,
    input: String(input ?? '').trim(),
    message,
    ...details,
  };
}

/**
 * Strict canonical resolver for claim-bearing /magic director artifacts.
 *
 * Unlike readPassage(), this path never guesses a partial book name and never
 * clamps a verse coordinate. It accepts one same-chapter verse or an inclusive
 * range of at most three verses and returns the exact WEB text Luna named.
 */
export function resolveDirectorPassageReference(input) {
  const raw = String(input ?? '').trim();
  const crossChapter = raw.match(/^(.+?)\s+(\d{1,3})\s*:\s*(\d{1,3})\s*[\u2013\u2014-]\s*(\d{1,3})\s*:\s*(\d{1,3})$/u);
  if (crossChapter) {
    return directorReferenceRefusal(raw, 'cross-chapter-range', 'director references must stay within one chapter');
  }

  const match = raw.match(/^(.+?)\s+(\d{1,3})\s*:\s*(\d{1,3})(?:\s*[\u2013\u2014-]\s*(\d{1,3}))?$/u);
  if (!match) {
    return directorReferenceRefusal(raw, 'unparsable-reference', 'expected "Book chapter:verse" or a same-chapter verse range');
  }

  const books = loadBooks();
  const bookKey = match[1].trim().toLowerCase().replace(/\s+/g, ' ');
  const code = books.aliasToCode.get(bookKey) ?? null;
  if (!code) {
    return directorReferenceRefusal(raw, 'unknown-book', 'book must be an exact known name, alias, or USFM code');
  }

  const chapter = Number(match[2]);
  const chapterCount = books.chapters.get(code) ?? null;
  if (!Number.isInteger(chapter) || chapter < 1 || !chapterCount || chapter > chapterCount) {
    return directorReferenceRefusal(raw, 'invalid-chapter', `${books.display.get(code)} does not have chapter ${match[2]}`);
  }

  const fromVerse = Number(match[3]);
  const toVerse = match[4] == null ? fromVerse : Number(match[4]);
  if (!Number.isInteger(fromVerse) || !Number.isInteger(toVerse) || fromVerse < 1 || toVerse < 1) {
    return directorReferenceRefusal(raw, 'invalid-verse', 'verse coordinates must be positive integers');
  }
  if (toVerse < fromVerse) {
    return directorReferenceRefusal(raw, 'reversed-range', 'the end verse must not precede the start verse');
  }
  const rangeSize = toVerse - fromVerse + 1;
  if (rangeSize > DIRECTOR_REFERENCE_MAX_VERSES) {
    return directorReferenceRefusal(
      raw,
      'range-too-wide',
      `director references may contain at most ${DIRECTOR_REFERENCE_MAX_VERSES} verses`,
      { rangeSize, maxVerses: DIRECTOR_REFERENCE_MAX_VERSES },
    );
  }

  /* A whole-chapter probe supplies the authoritative last verse. Its text may
     be character-budget clipped, but verseCount always describes the complete
     on-disk chapter. This check prevents readPassage's reader-friendly clamp
     from silently changing a director's claim. */
  const chapterProbe = readPassage({ book: code, chapter });
  if (chapterProbe.error || !Number.isInteger(chapterProbe.verseCount)) {
    return directorReferenceRefusal(raw, 'passage-lookup-failed', chapterProbe.error || 'canonical chapter is unavailable');
  }
  if (fromVerse > chapterProbe.verseCount || toVerse > chapterProbe.verseCount) {
    return directorReferenceRefusal(
      raw,
      'range-out-of-bounds',
      `${chapterProbe.bookName} ${chapter} has verses 1-${chapterProbe.verseCount}`,
      { verseCount: chapterProbe.verseCount },
    );
  }

  const passage = readPassage({ book: code, chapter, fromVerse, toVerse });
  if (passage.error || !Array.isArray(passage.verses)) {
    return directorReferenceRefusal(raw, 'passage-lookup-failed', passage.error || 'canonical passage is unavailable');
  }
  const exact = passage.verses.length === rangeSize
    && passage.verses.every((verse, index) => verse.verse === fromVerse + index);
  if (!exact) {
    return directorReferenceRefusal(
      raw,
      'clamped-range-mismatch',
      'canonical lookup did not return the exact requested verse range',
      { requestedFromVerse: fromVerse, requestedToVerse: toVerse },
    );
  }

  const ref = `${passage.bookName} ${chapter}:${fromVerse}${toVerse > fromVerse ? `\u2013${toVerse}` : ''}`;
  return {
    ok: true,
    value: {
      ref,
      book: passage.book,
      bookName: passage.bookName,
      chapter,
      fromVerse,
      toVerse,
      verses: passage.verses.map((verse) => ({ ...verse })),
      text: passage.verses.map((verse) => String(verse.text ?? '')).join(' '),
      translation: passage.translation,
    },
  };
}

/** Resolve a list atomically: one bad reference refuses the complete list. */
export function resolveDirectorPassageReferences(inputs) {
  if (!Array.isArray(inputs)) {
    return directorReferenceRefusal('', 'invalid-reference-list', 'director reference list must be an array');
  }
  const values = [];
  for (const [index, input] of inputs.entries()) {
    const resolved = resolveDirectorPassageReference(input);
    if (!resolved.ok) return { ...resolved, index };
    values.push(resolved.value);
  }
  return { ok: true, values };
}
