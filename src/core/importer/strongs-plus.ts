/**
 * Shape Strong's / Thayer / BDB dictionary plain text into pastor-facing
 * definition fields. BDB keeps numbered sense divisions for the future
 * senses-ring; Thayer uses CP1253-decoded Greek when imported with that flag.
 */

export type StrongSense = {
  /** Sense number as in the source: "1", "1a", "2b1", … */
  n: string;
  /** Optional compact display heading derived from the same source text. */
  label?: string;
  /** Complete display sentence / clause. Never a character-capped fragment. */
  text: string;
};

/** Duplicate source numbers make a sense tree ambiguous and unsafe to chart. */
export function duplicateSenseNumbers(senses: readonly StrongSense[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const sense of senses) {
    if (seen.has(sense.n)) duplicates.add(sense.n);
    seen.add(sense.n);
  }
  return [...duplicates];
}

export type StrongDefinition = {
  /** Strong's key with letter: H7225 / G25. */
  id: string;
  /** Closed expander preview — first sense / KJV gloss head. */
  firstSense: string;
  /** Full English body (no RTF, no LXX dump / KJV occurrence dump). */
  full: string;
  /** Latin transliteration when recoverable. */
  xlit?: string;
  /** Pronunciation key when recoverable. */
  pronunciation?: string;
  /** Numbered senses when the source has them (BDB). */
  senses?: StrongSense[];
  source: string;
};

const MOSTLY_LATIN = /[A-Za-z]/;

function isMostlyLatin(line: string): boolean {
  const letters = line.replace(/[^A-Za-z\u00C0-\u024F]/g, "");
  if (letters.length < 2) return false;
  const nonLatin = line.replace(/[\x00-\x7F\u00C0-\u024F\s'’\-.,;:()[\]{}0-9]/g, "");
  return nonLatin.length <= letters.length * 0.35 && MOSTLY_LATIN.test(line);
}

function capSense(s: string, max = 90): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Convert RTF-stripped Strong's dictionary text into structured fields.
 */
export function formatStrongDefinition(
  topic: string,
  plain: string,
  source = "Strong's",
): StrongDefinition | null {
  const id = topic.trim().toUpperCase();
  if (!/^[HG]\d{1,5}$/.test(id)) return null;

  const beforeLxx = (plain.split(/\n\s*LXX related/i)[0] ?? plain).trim();
  if (!beforeLxx) return null;

  const lines = beforeLxx
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const latinLines = lines.filter(isMostlyLatin);
  if (latinLines.length === 0) return null;

  let xlit: string | undefined;
  let pronunciation: string | undefined;
  let bodyStart = 0;
  const pronIdx = latinLines.findIndex(
    (l) =>
      l.length <= 48 &&
      !l.includes(";") &&
      /[''′]/.test(l) &&
      (l.includes("-") || /[aeiouy]/i.test(l)),
  );
  if (pronIdx >= 0) {
    pronunciation = latinLines[pronIdx];
    if (
      pronIdx > 0 &&
      latinLines[pronIdx - 1] &&
      latinLines[pronIdx - 1]!.length <= 40 &&
      !latinLines[pronIdx - 1]!.includes(";") &&
      !latinLines[pronIdx - 1]!.includes(":")
    ) {
      xlit = latinLines[pronIdx - 1];
      bodyStart = pronIdx + 1;
    } else {
      bodyStart = pronIdx + 1;
    }
  } else if (
    latinLines[0] &&
    latinLines[0].length <= 40 &&
    !latinLines[0].includes(";") &&
    !latinLines[0].includes(":") &&
    latinLines[1] &&
    (latinLines[1].includes(";") || latinLines[1].length > 40)
  ) {
    xlit = latinLines[0];
    bodyStart = 1;
  }

  const bodyLines = latinLines.slice(bodyStart);
  let full = bodyLines.join(" ").replace(/\s+/g, " ").trim();
  if (!full && xlit) {
    full = xlit;
    xlit = undefined;
  }
  if (!full) return null;

  let firstSense = "";
  const glossMatch = full.match(/:\s*-\s*(.+)$/);
  if (glossMatch?.[1]) {
    firstSense = glossMatch[1]
      .split(/[.;]/)[0]!
      .replace(/\s*Compare\s+[HG]\d+.*$/i, "")
      .trim();
  }
  if (!firstSense) {
    const clause = full.split(/[.;]/)[0]?.trim() ?? full;
    firstSense = clause
      .replace(
        /^(?:A primitive (?:root|word)|From (?:the same as )?[HG]?\d+|Plural of [HG]?\d+|Of uncertain[^;]*);\s*/i,
        "",
      )
      .trim();
  }
  firstSense = capSense(firstSense || full.slice(0, 80));

  return {
    id,
    firstSense,
    full,
    ...(xlit ? { xlit } : {}),
    ...(pronunciation ? { pronunciation } : {}),
    source,
  };
}

/**
 * BDB-KJV module: keep numbered sense tree.
 *
 *   BDB Definition:
 *   1) first, beginning, best, chief
 *   1a) beginning
 *   …
 *   Part of Speech: …
 *   Total KJV Occurrences: …
 */
export function parseBdbSenses(plain: string): StrongSense[] {
  let body = plain;
  for (const re of [
    /\nPart of Speech:/i,
    /\nA Related Word by BDB/i,
    /\nSame Word by TWOT/i,
    /\nTotal KJV Occurrences:/i,
  ]) {
    const match = body.search(re);
    if (match >= 0) body = body.slice(0, match);
  }

  const senses: StrongSense[] = [];
  const senseRe = /^(\d+[a-z]*(?:\d+[a-z]*)*)\)\s*(.+)$/i;
  for (const line of body.split(/\n/).map((value) => value.trim()).filter(Boolean)) {
    const match = line.match(senseRe);
    if (match) senses.push({ n: match[1]!.toLowerCase(), text: match[2]!.trim() });
  }
  return senses;
}

export function formatBdbDefinition(topic: string, plain: string, source = "BDB"): StrongDefinition | null {
  const id = topic.trim().toUpperCase();
  if (!/^H\d{1,5}$/.test(id)) return null;
  if (!plain.trim()) return null;

  // Drop occurrence dump / related-word trailers after the sense block.
  let body = plain;
  const cutMarkers = [
    /\nPart of Speech:/i,
    /\nA Related Word by BDB/i,
    /\nSame Word by TWOT/i,
    /\nTotal KJV Occurrences:/i,
  ];
  for (const re of cutMarkers) {
    const m = body.search(re);
    if (m >= 0) body = body.slice(0, m);
  }

  const lines = body
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  // Optional xlit: short latin line before "BDB Definition:"
  let xlit: string | undefined;
  const bdbIdx = lines.findIndex((l) => /^BDB Definition:?$/i.test(l));
  if (bdbIdx > 0) {
    for (let i = 0; i < bdbIdx; i++) {
      const l = lines[i]!;
      if (isMostlyLatin(l) && l.length <= 40 && !l.includes(")")) {
        xlit = l.replace(/^[''′]/, "'");
      }
    }
  }

  const senses = parseBdbSenses(body);

  if (senses.length === 0) {
    // Fallback: treat as flat Strong's-style entry.
    return formatStrongDefinition(id, plain, source);
  }

  const full = senses.map((s) => `${s.n}) ${s.text}`).join("\n");
  const firstSense = capSense(senses[0]!.text);
  const malformed = duplicateSenseNumbers(senses).length > 0;

  return {
    id,
    firstSense,
    full,
    // Preserve the definition prose, but never expose an impossible tree to
    // the senses pill. Import Doctor reports these malformed source entries.
    ...(malformed ? {} : { senses }),
    ...(xlit ? { xlit } : {}),
    source,
  };
}

const THAYER_SCAFFOLD = /^(?:(?:properly|figuratively|metaphorically|tropically|absolutely|transitively|intransitively|universally|passively|actively|middle|plural|of place|of time|with additions?)[\s,;:()]*)$/i;
const THAYER_REF = /\b(?:[1-3])?[A-Z][a-z]{1,8}_\d+:\d+\b/;

/** Display-only repairs for defects already present in the source module. */
function cleanThayerDisplay(text: string): string {
  return text
    .replace(/\b(Latin|German)(?=[a-z])/g, "$1 ")
    .replace(/^to\s+[a-z]+\s+equivalent\s+to\s+to\s+/i, "to ")
    .replace(/\bequivalent\s+to\s+to\b/gi, "equivalent to")
    .replace(/^to\s+have\s+equivalent\s+to\s+/i, "to ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** A reference colon (Joh_6:55) is content, never a heading separator. */
function firstThayerSeparator(text: string): number {
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== ":" && ch !== ";") continue;
    if (ch === ":" && /(?:[1-3])?[A-Z][a-z]{1,8}_\d+$/.test(text.slice(0, i))) continue;
    return i;
  }
  return -1;
}

function isThayerScaffold(line: string): boolean {
  const compact = cleanThayerDisplay(line).replace(/[.,;:]+$/, "").trim();
  if (/^(?:τί|what)$/iu.test(compact)) return true;
  if (THAYER_SCAFFOLD.test(line.trim())) return true;
  return compact.split(/\s+/).length <= 5 && /^(?:properly|figuratively|metaphorically|tropically|absolutely|transitively|intransitively|universally|passively|actively|middle|plural)\b/i.test(compact);
}

function stripThayerOutline(text: string): string {
  return text
    .replace(/^(?:(?:[a-z]|[α-ω])\s*[.)]\s*)+/iu, "")
    .replace(/^(?:of persons|of things)\s*;\s*/i, "")
    .replace(/^(?:[a-z]|[α-ω])\s*[.)]\s*/iu, "")
    .replace(/^(?:properly|figuratively|metaphorically|tropically|absolutely|transitive|intransitive|transitively|intransitively|passive|active|middle|universally)\s*[,;:]\s*/i, "")
    .trim();
}

const THAYER_NON_VERB_AFTER_TO = new Set([
  "a",
  "an",
  "another",
  "any",
  "anything",
  "him",
  "himself",
  "her",
  "herself",
  "his",
  "it",
  "itself",
  "me",
  "nothing",
  "one",
  "others",
  "property",
  "some",
  "something",
  "the",
  "their",
  "them",
  "themselves",
  "this",
  "those",
  "us",
  "what",
  "which",
  "whom",
  "you",
  "yourself",
]);

function thayerInfinitiveStart(text: string): number {
  const re = /\bto\s+([a-z]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (!THAYER_NON_VERB_AFTER_TO.has(match[1]!.toLowerCase())) return match.index;
  }
  return -1;
}

/** Select a complete source clause without cutting a word or a verse reference. */
function thayerDefinitionClause(text: string): string {
  const clean = cleanThayerDisplay(stripThayerOutline(text));
  const infinitiveAt = thayerInfinitiveStart(clean);
  const firstPunctuation = clean.search(/[,;:]/);
  const firstParen = clean.indexOf("(");
  const meaningfulNounLead = /^(?:the|a|an|of\s+(?:Christ|God|men|persons|things|one|those))\b/i.test(clean);
  const meaningfulShortLead =
    firstPunctuation >= 3 &&
    firstPunctuation < 90 &&
    !/^\p{Script=Greek}/u.test(clean) &&
    !/^(?:with|as|when|where|which|according|followed)\b/i.test(clean);
  const start =
    meaningfulNounLead ||
    (meaningfulShortLead && (infinitiveAt < 0 || firstPunctuation < infinitiveAt))
      ? 0
      : infinitiveAt >= 0
        ? infinitiveAt
        : 0;
  const candidate = clean.slice(start);
  const refAt = candidate.search(THAYER_REF);
  const dashAt = candidate.search(/\s[—–]\s/);
  const separatorAt = firstThayerSeparator(candidate);
  const sentenceAt = thayerSentenceEnd(candidate.slice(0, 220));
  const nounPhraseAt = [firstPunctuation, firstParen]
    .filter((value) => value >= 4)
    .sort((a, b) => a - b)[0] ?? -1;
  const nounWords = nounPhraseAt > 0
    ? candidate.slice(0, nounPhraseAt).trim().split(/\s+/).length
    : 0;
  const nounAt = meaningfulNounLead && nounPhraseAt >= 8 && nounWords >= 3
    ? nounPhraseAt
    : -1;
  const boundaries = [refAt, dashAt, separatorAt, sentenceAt, nounAt].filter((value) => value >= 3);
  let clause = candidate.slice(0, boundaries.length ? Math.min(...boundaries) : undefined).trim();
  if (clause.length > 150) {
    const soft = clause.slice(35, 150).search(/,\s+(?:and|but|which|where|when|with|as)\b/i);
    if (soft >= 0) clause = clause.slice(0, soft + 35);
  }
  if (clause.length > 180) {
    const commaAt = clause.slice(20, 180).indexOf(",");
    clause = commaAt >= 0
      ? clause.slice(0, commaAt + 20)
      : clause.split(/\s+/).slice(0, 18).join(" ");
  }
  return clause.replace(/[\s,;:]+$/, "").trim();
}

function thayerSentenceEnd(text: string): number {
  const re = /[.!?](?=\s+(?:(?:[a-zα-ω])\.\s|[A-ZΑ-ΩἈ-Ὧ"'(])|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index < 40) continue;
    const before = text.slice(Math.max(0, match.index - 8), match.index + 1).trimEnd();
    if (/(?:\b[ie]\. |\b[ie]\.|\bi\.\s*e\.|\be\.\s*g\.|\bcf\.|\betc\.)$/i.test(before)) continue;
    return match.index + 1;
  }
  return -1;
}

function finishThayerSentence(text: string): string {
  const clean = cleanThayerDisplay(text)
    .replace(/[\s,]+(?:or|and)$/i, "")
    .replace(/[\s,;:]+$/, "")
    .replace(/\s*[([{—–-]+$/, "")
    .trim();
  if (!clean) return clean;
  const sentence = `${clean.charAt(0).toUpperCase()}${clean.slice(1)}`;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

function thayerLabelClause(root: string): string {
  const clean = cleanThayerDisplay(root);
  if (/^(?:the|a|an)\b/i.test(clean)) return thayerDefinitionClause(clean);
  const shortInfinitive = clean.match(/^(to\s+[a-z]+(?:\s+[a-z]+){0,3})\s*\(/i)?.[1];
  if (shortInfinitive) return shortInfinitive;
  const qualifier = clean.match(/^(intransitive|transitive|intransitively|transitively|middle|passive|active)\b/i)?.[1];
  if (qualifier) {
    const clause = thayerDefinitionClause(clean);
    if (/^to\s+/i.test(clause)) return `${qualifier}, ${clause}`;
  }

  const separatorAt = firstThayerSeparator(clean);
  const refAt = clean.search(THAYER_REF);
  const sentenceAt = thayerSentenceEnd(clean.slice(0, 220));
  const boundaries = [separatorAt, refAt, sentenceAt].filter((value) => value >= 3);
  const boundary = boundaries.length ? Math.min(...boundaries) : -1;
  if (boundary >= 0 && boundary <= 180) return clean.slice(0, boundary).trim();

  // Long biographical/grammatical sentences still need a scannable noun
  // phrase in the closed row. The full first sentence repeats on expansion.
  const commaAt = clean.slice(20, 180).indexOf(",");
  if (commaAt >= 0) return clean.slice(0, commaAt + 20).trim();
  return thayerDefinitionClause(clean);
}

function thayerSenseDisplay(chunk: string): { label: string; text: string } | null {
  const paragraphs = chunk
    .split(/\n+/)
    .map((value) => cleanThayerDisplay(value))
    .filter(Boolean);
  const root = paragraphs[0]?.replace(/,?\s*i\.\s*e\.\s*:?$/i, "").trim();
  if (!root) return null;
  const continuation = paragraphs.slice(1).join(" ");
  const scaffold = isThayerScaffold(root);

  let labelSource: string;
  if (scaffold && continuation) {
    labelSource = thayerDefinitionClause(continuation);
  } else {
    labelSource = thayerLabelClause(root);
  }
  if (!labelSource || isThayerScaffold(labelSource)) {
    labelSource = thayerDefinitionClause(continuation || root);
  }
  labelSource = cleanThayerDisplay(labelSource)
    .replace(/^to\s+/i, "")
    .replace(/^of\s+(?=[A-Z])/i, "")
    .replace(/,\s*\d+\.$/, "")
    .replace(/[\s,;:.!?]+$/, "")
    .trim();
  if (!labelSource) return null;
  const label = `${labelSource.charAt(0).toUpperCase()}${labelSource.slice(1)}`;

  let display: string;
  if (scaffold) {
    display = thayerDefinitionClause(continuation || root);
  } else {
    display = root;
    if (display.length > 520) {
      const sentenceEnd = thayerSentenceEnd(display.slice(0, 520));
      const sentence = sentenceEnd >= 40 ? display.slice(0, sentenceEnd) : "";
      const balanced =
        (sentence.match(/\(/g)?.length ?? 0) === (sentence.match(/\)/g)?.length ?? 0) &&
        (sentence.match(/\[/g)?.length ?? 0) === (sentence.match(/\]/g)?.length ?? 0);
      if (sentence && balanced) {
        display = sentence;
      } else {
        const refAt = display.search(THAYER_REF);
        display = refAt >= 40 && refAt <= 520 ? display.slice(0, refAt) : labelSource;
      }
    }
  }
  display = finishThayerSentence(display);
  return display.length >= 3 ? { label, text: display } : null;
}

function romanSenseNumber(value: string): number {
  const values: Record<string, number> = { I: 1, V: 5, X: 10 };
  let total = 0;
  let previous = 0;
  for (const char of [...value.toUpperCase()].reverse()) {
    const current = values[char] ?? 0;
    total += current < previous ? -current : current;
    previous = Math.max(previous, current);
  }
  return total;
}

type ThayerSenseHit = { n: string; at: number };

function cleanThayerSenseRun(hits: ThayerSenseHit[]): boolean {
  if (hits.length < 2) return false;
  const nums = hits.map((hit) => parseInt(hit.n, 10));
  if (nums[0] !== 1 || new Set(nums).size !== nums.length) return false;
  return nums.every((n, index) => index === 0 || n === nums[index - 1]! + 1);
}

/**
 * Extract the highest reliable Thayer level. Roman I/II sections outrank their
 * numbered children; otherwise a clean 1/2 run becomes the flat outline.
 * Letter sub-senses inform display text but never become equal-weight roots.
 */
export function parseThayerSenses(plain: string): StrongSense[] {
  // Normalize: ensure sense numbers that follow prose can start a "line".
  const text = plain.replace(/\r\n/g, "\n");

  // Thayer frequently uses Roman heads for real semantic divisions and Arabic
  // numbers beneath them. Prefer the Roman layer when it is a clean I/II run.
  const romanHits: ThayerSenseHit[] = [];
  const romanRe = /(?:^|\n)\s*([IVX]{1,4})\.\s+([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = romanRe.exec(text))) {
    const n = romanSenseNumber(m[1]!);
    if (n > 0) romanHits.push({ n: String(n), at: m.index });
  }

  const numericHits: ThayerSenseHit[] = [];
  const numericRe = /(?:^|\n)\s*(\d{1,2})\.\s+([^\n]+)/g;
  while ((m = numericRe.exec(text))) {
    const n = m[1]!;
    let senseText = m[2]!.trim();
    // Drop trailing refs-heavy tails lightly for the closed sense label.
    senseText = senseText.replace(/\s*;?\s*[A-Z][a-z]+_\d+:\d+.*$/, "").trim();
    if (senseText.length < 3) continue;
    numericHits.push({ n, at: m.index });
  }

  const roman = cleanThayerSenseRun(romanHits);
  const hits = roman ? romanHits : numericHits;
  if (!cleanThayerSenseRun(hits)) return [];

  // Expand each sense's text to include following prose until next sense.
  const senses: StrongSense[] = [];
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i]!.at;
    const end = i + 1 < hits.length ? hits[i + 1]!.at : text.length;
    // Slice from after "N. "; retain continuations for a complete display sentence.
    const marker = roman ? /^\s*[IVX]{1,4}\.\s+/ : /^\s*\d{1,2}\.\s+/;
    const chunk = text.slice(start, end).replace(marker, "").trim();
    const display = thayerSenseDisplay(chunk);
    if (!display) continue;
    senses.push({ n: hits[i]!.n, ...display });
  }
  return senses.length >= 2 ? senses : [];
}

/**
 * Thayer Unabridged: long scholarly Greek entry. Prefer English clauses;
 * keep leading lemma line (with correctly decoded Greek) for context.
 * Emits senses[] only when a clean top-level numbered structure is found.
 */
export function formatThayerDefinition(
  topic: string,
  plain: string,
  source = "Thayer",
): StrongDefinition | null {
  const id = topic.trim().toUpperCase();
  if (!/^G\d{1,5}$/.test(id)) return null;
  if (!plain.trim()) return null;

  // Trim enormous entries lightly at common trailers.
  let body = plain.trim();
  for (const re of [/\nSynonyms?:/i, /\nSee Synonyms?/i]) {
    const m = body.search(re);
    if (m > 200) body = body.slice(0, m);
  }

  // Collapse whitespace but keep paragraph breaks for readability.
  body = body
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  const senses = parseThayerSenses(body);

  // First sense: first structured sense, else first English-looking clause.
  let firstSense = "";
  if (senses[0]) {
    firstSense = senses[0].text;
  } else {
    const toVerb = body.match(/\bto\s+[a-z][a-z\- ]{2,40}/i);
    if (toVerb) {
      firstSense = toVerb[0]!.trim();
    }
    if (!firstSense) {
      const eng = body.match(
        /((?:a |an |the |of |from |properly |literally |metaphorically |i\.e\.|[A-Za-z]{4,})[^.]{8,120})/,
      );
      if (eng) firstSense = eng[1]!.trim();
    }
    if (!firstSense) firstSense = body.slice(0, 90);
  }
  firstSense = capSense(firstSense.replace(/\s+/g, " "));

  // Preserve the source article. The Senses widget carries its own compact,
  // complete display sentences, so full text need not be destructively capped.
  const full = body;

  return {
    id,
    firstSense,
    full,
    ...(senses.length ? { senses } : {}),
    source,
  };
}

/** Dispatch by source / topic letter. */
export function formatLexiconEntry(
  topic: string,
  plain: string,
  source: string,
  kind: "strongs" | "thayer" | "bdb" = "strongs",
): StrongDefinition | null {
  if (kind === "bdb") return formatBdbDefinition(topic, plain, source);
  if (kind === "thayer") return formatThayerDefinition(topic, plain, source);
  return formatStrongDefinition(topic, plain, source);
}
