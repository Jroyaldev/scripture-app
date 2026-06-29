/**
 * Note parser — extracts frontmatter, inline note links, and scripture references
 * from Markdown note files. Pure, platform-agnostic (INV-18).
 */

import type { BackboneData, BookNameMap, CanonicalRef } from "../reference/types.js";
import { parseHumanRef } from "../reference/parser.js";
import type { NoteFrontmatter, NoteLink, ParsedNote, ScriptureRefMatch } from "./types.js";

/**
 * Parse a Markdown note file into its structured components.
 * The Markdown file is authoritative for everything inside it (INV-11).
 */
export function parseNote(
  content: string,
  bookNames: BookNameMap,
  backbone: BackboneData,
): ParsedNote {
  const { frontmatter, body } = parseFrontmatter(content);
  const noteLinks = parseNoteLinks(body);
  const scriptureRefs = parseScriptureRefs(body, bookNames, backbone);

  return {
    frontmatter,
    body,
    noteLinks,
    scriptureRefs,
    rawContent: content,
  };
}

/**
 * Parse YAML frontmatter from a note. Uses a simple parser to avoid
 * importing heavy dependencies into the pure core.
 */
export function parseFrontmatter(content: string): {
  frontmatter: NoteFrontmatter;
  body: string;
} {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = fmRegex.exec(content);
  if (!match) {
    return {
      frontmatter: { id: "", title: "", created: "", modified: "" },
      body: content,
    };
  }

  const yamlStr = match[1]!;
  const body = match[2]!;
  const fm = parseSimpleYaml(yamlStr);

  return {
    frontmatter: {
      id: String(fm["id"] ?? ""),
      title: String(fm["title"] ?? "").replace(/^"|"$/g, ""),
      created: String(fm["created"] ?? ""),
      modified: String(fm["modified"] ?? ""),
      type: fm["type"] ? String(fm["type"]) : undefined,
      tags: parseTags(fm["tags"]),
    },
    body,
  };
}

function parseSimpleYaml(yaml: string): Record<string, string | undefined> {
  const result: Record<string, string | undefined> = {};
  for (const line of yaml.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    result[key] = value;
  }
  return result;
}

function parseTags(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  // Handle YAML array: [tag1, tag2, tag3]
  const bracketMatch = /^\[(.+)\]$/.exec(raw);
  if (bracketMatch) {
    return bracketMatch[1]!
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return undefined;
}

/**
 * Extract inline note links: [[note:ULID|cached label]]
 */
export function parseNoteLinks(body: string): NoteLink[] {
  const linkRegex = /\[\[note:([A-Z0-9]+)\|([^\]]*)\]\]/g;
  const links: NoteLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(body)) !== null) {
    links.push({
      targetId: m[1]!,
      cachedLabel: m[2]!,
      raw: m[0],
    });
  }
  return links;
}

/**
 * Extract scripture references from note body text.
 * Handles common forms: "Acts 19:1-7", "John 3:1-8", "cf. Gal 3:26-29", "1 Samuel 3:1".
 */
export function parseScriptureRefs(
  body: string,
  bookNames: BookNameMap,
  backbone: BackboneData,
): ScriptureRefMatch[] {
  const refs: ScriptureRefMatch[] = [];
  const seen = new Set<string>();

  // Build a regex from book names, longest first
  const allNames: string[] = [];
  for (const names of Object.values(bookNames)) {
    if (names) {
      for (const name of names) {
        allNames.push(name);
      }
    }
  }
  allNames.sort((a, b) => b.length - a.length);

  const escapedNames = allNames.map((n) =>
    n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
  );
  const namePattern = escapedNames.join("|");

  // Match: optional prefix (cf., see) + book name + space? + chapter:verse[-verse]
  const pattern = new RegExp(
    `(?:cf\\.?\\s+|see\\s+|See\\s+)?(${namePattern})\\s+(\\d+):(\\d+)(?:\\s*[-\u2013]\\s*(?:(\\d+):)?(\\d+))?`,
    "g",
  );

  let m: RegExpExecArray | null;
  while ((m = pattern.exec(body)) !== null) {
    const raw = m[0];
    const result = parseHumanRef(raw, bookNames, backbone);
    if (result.ok) {
      const key = refKey(result.value);
      if (!seen.has(key)) {
        seen.add(key);
        refs.push({ raw, ref: result.value });
      }
    }
  }

  return refs;
}

function refKey(ref: CanonicalRef): string {
  return `${ref.start.book}.${ref.start.chapter}.${ref.start.verse}-${ref.end.book}.${ref.end.chapter}.${ref.end.verse}`;
}
