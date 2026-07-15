/**
 * Parse bereanbible.com bsb_tables.tsv into per-verse alignments.jsonl
 * in the same shape as akjv-strongs:
 *
 *   { "book":"GEN","chapter":1,"verse":1,"tokens":[{"word":"beginning","strongs":["H7225"]},…] }
 *
 *   npm run import:bsb-tables -- --input ~/Downloads/bsb_tables.tsv
 */
import { createReadStream, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  return process.argv[i + 1];
}

const inputPath = resolve(arg("input") ?? join(process.env.HOME ?? "", "Downloads/bsb_tables.tsv"));
if (!existsSync(inputPath)) {
  console.error(`Not found: ${inputPath}`);
  process.exit(1);
}

const packageId = arg("id") ?? "bsb";
const outPath = resolve(
  arg("out") ?? join(repoRoot, "data/scripture/packages", packageId, "alignments.jsonl"),
);

/** English book name (as in VerseId) → USFM. */
const BOOK_NAME_TO_USFM: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalm: "PSA",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  "Song of Songs": "SNG",
  Song: "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAH",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV",
};

function parseVerseId(vid: string): { book: string; chapter: number; verse: number } | null {
  const m = vid.trim().match(/^(.+?)\s+(\d+):(\d+)\s*$/);
  if (!m) return null;
  const name = m[1]!.trim();
  const book = BOOK_NAME_TO_USFM[name];
  if (!book) return null;
  return { book, chapter: parseInt(m[2]!, 10), verse: parseInt(m[3]!, 10) };
}

function normalizeWord(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim()
    // Drop pure punctuation / dashes used as placeholders
    .replace(/^[-–—]+$/, "")
    .trim();
}

function strongFrom(heb: string, grk: string, language: string): string[] {
  const out: string[] = [];
  const h = heb.trim();
  const g = grk.trim();
  if (h && /^\d+$/.test(h)) out.push(`H${parseInt(h, 10)}`);
  if (g && /^\d+$/.test(g)) out.push(`G${parseInt(g, 10)}`);
  // Prefer language-appropriate single id when both present (rare)
  if (out.length === 2) {
    if (/hebrew|aramaic/i.test(language)) return [out[0]!];
    if (/greek/i.test(language)) return [out[1]!];
  }
  return out;
}

type Tok = { word: string; strongs: string[] };
type VerseKey = string;

const verses = new Map<VerseKey, { book: string; chapter: number; verse: number; tokens: Tok[] }>();

let current: { book: string; chapter: number; verse: number } | null = null;
let lineNo = 0;
let dataRows = 0;
let alignedTokens = 0;
let unknownBooks = 0;

const rl = createInterface({ input: createReadStream(inputPath, { encoding: "utf8" }), crlfDelay: Infinity });

for await (const line of rl) {
  lineNo++;
  if (lineNo === 1) continue; // header
  if (!line.trim()) continue;
  dataRows++;
  const cols = line.split("\t");
  // Columns: see handoff / bsb_tables header
  // 3=Verse, 4=Language, 10=Str Heb, 11=Str Grk, 12=VerseId, 18=BSB word
  const language = (cols[4] ?? "").trim();
  const strHeb = cols[10] ?? "";
  const strGrk = cols[11] ?? "";
  const verseId = (cols[12] ?? "").trim();
  const bsbWord = cols[18] ?? "";

  if (verseId) {
    const parsed = parseVerseId(verseId);
    if (parsed) current = parsed;
    else {
      unknownBooks++;
      if (unknownBooks <= 5) console.warn(`Unknown VerseId: ${verseId}`);
    }
  }
  if (!current) continue;

  const word = normalizeWord(bsbWord);
  if (!word) continue;
  // Skip pure markup/space placeholders
  if (word === "-" || word === "—") continue;

  const strongs = strongFrom(strHeb, strGrk, language);
  if (strongs.length === 0) continue;

  const key = `${current.book}.${current.chapter}.${current.verse}`;
  let bucket = verses.get(key);
  if (!bucket) {
    bucket = { book: current.book, chapter: current.chapter, verse: current.verse, tokens: [] };
    verses.set(key, bucket);
  }
  bucket.tokens.push({ word, strongs });
  alignedTokens++;
}

// Stable order: book order not critical; sort by ref string
const linesOut: string[] = [];
const keys = [...verses.keys()].sort((a, b) => {
  const [ab, ac, av] = a.split(".").map((x, i) => (i === 0 ? x : parseInt(x, 10))) as [string, number, number];
  const [bb, bc, bv] = b.split(".").map((x, i) => (i === 0 ? x : parseInt(x, 10))) as [string, number, number];
  if (ab !== bb) return ab.localeCompare(bb);
  if (ac !== bc) return ac - bc;
  return av - bv;
});

// Better book-order sort using protestant order
const ORDER = [
  "GEN","EXO","LEV","NUM","DEU","JOS","JDG","RUT","1SA","2SA","1KI","2KI","1CH","2CH","EZR","NEH","EST","JOB","PSA","PRO","ECC","SNG","ISA","JER","LAM","EZK","DAN","HOS","JOL","AMO","OBA","JON","MIC","NAH","HAB","ZEP","HAG","ZEC","MAL","MAT","MRK","LUK","JHN","ACT","ROM","1CO","2CO","GAL","EPH","PHP","COL","1TH","2TH","1TI","2TI","TIT","PHM","HEB","JAS","1PE","2PE","1JN","2JN","3JN","JUD","REV",
];
const ord = new Map(ORDER.map((b, i) => [b, i]));
keys.sort((a, b) => {
  const pa = a.split(".");
  const pb = b.split(".");
  const oa = ord.get(pa[0]!) ?? 999;
  const ob = ord.get(pb[0]!) ?? 999;
  if (oa !== ob) return oa - ob;
  const ca = parseInt(pa[1]!, 10);
  const cb = parseInt(pb[1]!, 10);
  if (ca !== cb) return ca - cb;
  return parseInt(pa[2]!, 10) - parseInt(pb[2]!, 10);
});

for (const key of keys) {
  const v = verses.get(key)!;
  linesOut.push(JSON.stringify({ book: v.book, chapter: v.chapter, verse: v.verse, tokens: v.tokens }));
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, linesOut.join("\n") + (linesOut.length ? "\n" : ""));

console.log("=== Doctor ===");
console.log(`  data rows:        ${dataRows}`);
console.log(`  verses aligned:   ${linesOut.length}`);
console.log(`  tokens with H/G:  ${alignedTokens}`);
console.log(`  unknown VerseIds: ${unknownBooks}`);
console.log(`  sample GEN 1:1:   ${linesOut.find((l) => l.includes('"GEN"') && l.includes('"chapter":1') && l.includes('"verse":1'))?.slice(0, 200)}`);
console.log(`\nWrote ${outPath}`);
