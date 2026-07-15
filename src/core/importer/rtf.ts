/**
 * Minimal RTF / light-HTML converters for e-Sword modules.
 *
 * Goals (not a full RTF engine):
 *  - plain reading text for scripture packages
 *  - capture of inline Strong's tags written as RTF superscripts
 *    (`\super H7225`, `\super G2316`, sometimes multi-token `G3956 G3588`)
 *  - codepage escapes (`\'e0`) and Unicode escapes (`\u770?`)
 *  - light HTML branch for BDB+ / MySword-style entries (`<heb>`, `<br>`, …)
 */

export type StrongAlignmentToken = {
  /** Surface word the Strong's tag was attached to (may be empty for free-floating tags). */
  word: string;
  /** Normalized Strong's id(s), e.g. "H7225" or "G3956". */
  strongs: string[];
};

export type RtfParseResult = {
  text: string;
  /** Word → Strong's pairs in reading order (only when captureAlignments is true). */
  alignments: StrongAlignmentToken[];
};

export type RtfHexEncoding = "cp1252" | "cp1253";

export type RtfParseOptions = {
  /** Capture `\super H####` / `\super G####` as alignment tokens. */
  captureAlignments?: boolean;
  /**
   * How to decode `\'hh` hex bytes.
   * Thayer (and many Greek e-Sword modules) use Windows-1253 for Greek runs;
   * default CP1252 is correct for English/Hebrew-module Latin text.
   */
  hexEncoding?: RtfHexEncoding;
};

/** Decode a single `\'hh` byte under the chosen Windows code page. */
export function decodeRtfHexByte(hex: string, encoding: RtfHexEncoding = "cp1252"): string {
  const n = parseInt(hex, 16);
  if (!Number.isFinite(n) || n < 0 || n > 255) return "";
  if (encoding === "cp1253") {
    try {
      return new TextDecoder("windows-1253").decode(Uint8Array.of(n));
    } catch {
      /* fall through */
    }
  }
  // CP1252 ≈ latin1 for the high bytes e-Sword uses.
  return String.fromCharCode(n);
}

const STRONG_RE = /^[HG]\d{1,5}$/i;

/**
 * Convert an e-Sword Scripture/Definition RTF blob to plain text.
 * Optionally captures Strong's superscripts as alignment pairs.
 */
export function parseEswordRtf(input: string, options: RtfParseOptions = {}): RtfParseResult {
  if (!input) return { text: "", alignments: [] };
  // Not RTF — may be plain text or HTML.
  if (!input.includes("\\") && (input.includes("<") || !input.startsWith("{"))) {
    return parseLightHtml(input);
  }
  if (!input.includes("\\")) {
    return { text: collapseWs(input), alignments: [] };
  }

  const capture = options.captureAlignments === true;
  const hexEnc: RtfHexEncoding = options.hexEncoding ?? "cp1252";
  const alignments: StrongAlignmentToken[] = [];
  let text = "";
  let i = 0;
  const s = input;

  /** Last word in the plain text so far (re-scanned — reliable across control runs). */
  const lastWord = (): string => {
    const m = text.match(/([^\s.,;:!?()"“”'’\-—–]+)\s*[,.;:!?…"”'’]*\s*$/);
    return m?.[1] ?? "";
  };

  const pushText = (chunk: string): void => {
    if (!chunk) return;
    text += chunk;
  };

  while (i < s.length) {
    const ch = s[i]!;

    // Group braces — structural only.
    if (ch === "{" || ch === "}") {
      i++;
      continue;
    }

    if (ch === "\\") {
      i++;
      if (i >= s.length) break;
      const next = s[i]!;

      // \'hh — hex codepage byte (CP1252 English / CP1253 Greek for Thayer).
      if (next === "'") {
        const hex = s.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) {
          pushText(decodeRtfHexByte(hex, hexEnc));
          i += 3;
          continue;
        }
      }

      // \uN? — Unicode code point (optional trailing fallback char).
      if (next === "u") {
        const m = s.slice(i).match(/^u(-?\d+)(\?)?/);
        if (m) {
          let code = parseInt(m[1]!, 10);
          if (code < 0) code = 65536 + code; // RTF signed 16-bit
          if (code > 0) pushText(String.fromCodePoint(code));
          i += m[0].length;
          continue;
        }
      }

      // Escaped specials.
      if (next === "\\" || next === "{" || next === "}") {
        pushText(next);
        i++;
        continue;
      }
      if (next === "~") {
        pushText("\u00A0");
        i++;
        continue;
      }
      if (next === "-" || next === "_") {
        pushText("-");
        i++;
        continue;
      }

      // Control word: \wordN?
      const cw = s.slice(i).match(/^([a-zA-Z]+)(-?\d*) ?/);
      if (cw) {
        const word = cw[1]!.toLowerCase();
        const arg = cw[2] ?? "";
        i += cw[0].length;

        if (word === "par" || word === "line" || word === "softline") {
          pushText("\n");
          continue;
        }
        if (word === "tab") {
          pushText(" ");
          continue;
        }
        if (word === "emdash") {
          pushText("—");
          continue;
        }
        if (word === "endash") {
          pushText("–");
          continue;
        }
        if (word === "lquote" || word === "rquote") {
          pushText("'");
          continue;
        }
        if (word === "ldblquote" || word === "rdblquote") {
          pushText('"');
          continue;
        }
        if (word === "bullet") {
          pushText("•");
          continue;
        }

        // Strong's as superscript: \super H7225  or  \super G3956 G3588
        if (capture && word === "super") {
          // Consume following text until \nosupersub or next control that ends super.
          let superBuf = "";
          while (i < s.length) {
            if (s[i] === "{" || s[i] === "}") {
              i++;
              continue;
            }
            if (s[i] === "\\") {
              const peek = s.slice(i + 1).match(/^([a-zA-Z]+)/);
              if (peek) {
                const w = peek[1]!.toLowerCase();
                if (
                  w === "nosupersub" ||
                  w === "super" ||
                  w === "cf" ||
                  w === "f" ||
                  w === "fs" ||
                  w === "b" ||
                  w === "i" ||
                  w === "ul" ||
                  w === "par" ||
                  w === "plain"
                ) {
                  break;
                }
              }
              // skip unknown control inside super
              const skip = s.slice(i + 1).match(/^([a-zA-Z]+)(-?\d*) ?/);
              if (skip) {
                i += 1 + skip[0].length;
                continue;
              }
              if (s[i + 1] === "'") {
                const hex = s.slice(i + 2, i + 4);
                if (/^[0-9a-fA-F]{2}$/.test(hex)) {
                  superBuf += decodeRtfHexByte(hex, hexEnc);
                  i += 4;
                  continue;
                }
              }
              i += 2;
              continue;
            }
            superBuf += s[i];
            i++;
            // safety: supers usually short
            if (superBuf.length > 40) break;
          }
          const strongs = superBuf
            .trim()
            .split(/\s+/)
            .map((t) => t.replace(/[^HG0-9]/gi, "").toUpperCase())
            .filter((t) => STRONG_RE.test(t));
          if (strongs.length > 0) {
            alignments.push({ word: lastWord(), strongs });
          }
          continue;
        }

        // Ignore formatting controls (cf, f, fs, b, i, ul, …) including destination groups.
        if (word === "fonttbl" || word === "colortbl" || word === "stylesheet" || word === "info") {
          // Skip until matching brace depth if we entered a group — best-effort:
          // these usually appear only in headers we rarely see mid-verse.
          void arg;
          continue;
        }

        void arg;
        continue;
      }

      // Unknown single-char control — skip.
      i++;
      continue;
    }

    // Bare text.
    let j = i + 1;
    while (j < s.length && s[j] !== "\\" && s[j] !== "{" && s[j] !== "}") j++;
    pushText(s.slice(i, j));
    i = j;
  }

  return { text: collapseWs(text), alignments };
}

/** Plain-text helper used by bible import (no alignment). */
export function rtfToPlain(input: string, hexEncoding?: RtfHexEncoding): string {
  return parseEswordRtf(input, { captureAlignments: false, hexEncoding }).text;
}

/**
 * RTF with Strong's capture — for AKJV+2 reverse-ring fuel.
 */
export function rtfToPlainWithStrongs(input: string): RtfParseResult {
  return parseEswordRtf(input, { captureAlignments: true });
}

/**
 * Light HTML (BDB+ .lexi, some MySword) → plain text.
 * Keeps Hebrew/Greek text content; drops tags.
 */
export function parseLightHtml(input: string): RtfParseResult {
  let s = input;
  s = s.replace(/<\s*br\s*\/?>/gi, "\n");
  s = s.replace(/<\/\s*p\s*>/gi, "\n");
  s = s.replace(/<\/\s*div\s*>/gi, "\n");
  s = s.replace(/<[^>]+>/g, "");
  s = s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));
  return { text: collapseWs(s), alignments: [] };
}

/** YLT-style plain text with occasional <i>…</i> / <br />. */
export function stripLightMarkup(input: string): string {
  if (!input.includes("<") && !input.includes("&")) {
    return collapseWs(input);
  }
  return parseLightHtml(input).text;
}

function collapseWs(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
