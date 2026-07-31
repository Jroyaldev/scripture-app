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
