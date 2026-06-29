/**
 * Obsidian vault importer — converts an Obsidian vault into Library notes.
 * Maps [[wikilinks]] to [[note:ULID|label]] format.
 * Pure, platform-agnostic (INV-18). File I/O injected via parameters.
 */

import type { ImportedNote, ImportResult, WikiLink } from "./types.js";

/**
 * Parse an Obsidian vault from raw file data.
 * @param files Array of { path, content } for each .md file in the vault
 * @param generateId Function that returns a new ULID (injected to keep core pure)
 */
export function importObsidianVault(
  files: Array<{ path: string; content: string }>,
  generateId: () => string,
): ImportResult {
  const notes: ImportedNote[] = [];
  const titleToId = new Map<string, string>();
  const allWikiLinks: Array<{ noteId: string; link: WikiLink }> = [];
  let skipped = 0;

  // First pass: create notes and map titles to IDs
  for (const file of files) {
    if (!file.path.endsWith(".md")) {
      skipped++;
      continue;
    }

    const { frontmatter, body } = parseObsidianFrontmatter(file.content);
    const id = generateId();
    const title = frontmatter.title ?? extractTitleFromPath(file.path);

    const note: ImportedNote = {
      id,
      title,
      body,
      tags: frontmatter.tags ?? [],
      created: frontmatter.created ?? new Date().toISOString(),
      modified: frontmatter.modified ?? new Date().toISOString(),
      originalPath: file.path,
    };
    notes.push(note);
    titleToId.set(normalizeTitle(title), id);

    // Also map by filename (without extension)
    const filenameTitle = extractTitleFromPath(file.path);
    if (filenameTitle !== title) {
      titleToId.set(normalizeTitle(filenameTitle), id);
    }
  }

  // Second pass: extract and resolve wikilinks
  for (const note of notes) {
    const wikiLinks = extractWikiLinks(note.body);
    for (const link of wikiLinks) {
      allWikiLinks.push({ noteId: note.id, link });
    }
  }

  // Resolve links
  const resolvedLinks: Array<{ fromId: string; toId: string; label: string }> = [];
  const unresolvedLinks: Array<{ noteId: string; link: WikiLink }> = [];

  for (const { noteId, link } of allWikiLinks) {
    const targetId = titleToId.get(normalizeTitle(link.target));
    if (targetId) {
      resolvedLinks.push({
        fromId: noteId,
        toId: targetId,
        label: link.alias ?? link.target,
      });
    } else {
      unresolvedLinks.push({ noteId, link });
    }
  }

  // Third pass: rewrite note bodies with resolved links
  for (const note of notes) {
    note.body = rewriteWikiLinks(note.body, titleToId);
  }

  return {
    notes,
    unresolvedLinks,
    resolvedLinks,
    stats: {
      totalFiles: files.length,
      imported: notes.length,
      skipped,
      linksResolved: resolvedLinks.length,
      linksUnresolved: unresolvedLinks.length,
    },
  };
}

/**
 * Parse Obsidian-style YAML frontmatter.
 */
function parseObsidianFrontmatter(content: string): {
  frontmatter: {
    title?: string;
    tags?: string[];
    created?: string;
    modified?: string;
  };
  body: string;
} {
  const fmRegex = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
  const match = fmRegex.exec(content);
  if (!match) {
    return { frontmatter: {}, body: content };
  }

  const yamlStr = match[1]!;
  const body = match[2]!;
  const fm: Record<string, string | undefined> = {};

  for (const line of yamlStr.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    let value = line.slice(colonIdx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fm[key] = value;
  }

  const tags = parseFrontmatterTags(fm["tags"]);
  const created = fm["created"] ?? fm["date"] ?? fm["created_at"];
  const modified = fm["modified"] ?? fm["updated"] ?? fm["modified_at"];

  return {
    frontmatter: {
      title: fm["title"],
      tags,
      created,
      modified,
    },
    body,
  };
}

function parseFrontmatterTags(raw: string | undefined): string[] | undefined {
  if (!raw) return undefined;
  const bracketMatch = /^\[(.+)\]$/.exec(raw);
  if (bracketMatch) {
    return bracketMatch[1]!.split(",").map((t) => t.trim()).filter(Boolean);
  }
  // Handle space-separated or comma-separated without brackets
  if (raw.includes(",")) {
    return raw.split(",").map((t) => t.trim()).filter(Boolean);
  }
  return raw.split(/\s+/).filter(Boolean);
}

/**
 * Extract [[wikilinks]] from markdown body.
 * Handles [[target]], [[target|alias]], and [[target#heading|alias]].
 */
export function extractWikiLinks(body: string): WikiLink[] {
  const linkRegex = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  const links: WikiLink[] = [];
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(body)) !== null) {
    links.push({
      target: m[1]!.trim(),
      alias: m[2]?.trim() ?? null,
      raw: m[0],
    });
  }
  return links;
}

/**
 * Rewrite [[wikilinks]] to [[note:ULID|label]] format.
 */
function rewriteWikiLinks(body: string, titleToId: Map<string, string>): string {
  return body.replace(
    /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g,
    (_match, target: string, alias: string | undefined) => {
      const normalizedTarget = normalizeTitle(target.trim());
      const id = titleToId.get(normalizedTarget);
      if (id) {
        const label = alias?.trim() ?? target.trim();
        return `[[note:${id}|${label}]]`;
      }
      // Keep unresolved links as-is
      return _match;
    },
  );
}

function extractTitleFromPath(path: string): string {
  const parts = path.split("/");
  const filename = parts[parts.length - 1] ?? path;
  return filename.replace(/\.md$/, "");
}

function normalizeTitle(title: string): string {
  return title.toLowerCase().trim();
}
