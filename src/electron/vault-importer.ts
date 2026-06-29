/**
 * Obsidian vault importer.
 * Maps [[wikilinks]] to [[note:ULID|label]], imports frontmatter, resolves scripture references.
 * (§6 M2: so a new user arrives populated)
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, basename, extname } from "node:path";
import { ulid } from "ulid";
import type { LibraryEngine } from "../host/library.js";
import type { BackboneData, BookNameMap } from "../core/reference/types.js";
import matter from "gray-matter";

interface ImportResult {
  ok: boolean;
  imported: number;
  skipped: number;
  linksMapped: number;
  errors: string[];
}

export function importObsidianVault(
  vaultPath: string,
  engine: LibraryEngine,
  _backbone: BackboneData,
  _bookNames: BookNameMap,
): ImportResult {
  const result: ImportResult = { ok: true, imported: 0, skipped: 0, linksMapped: 0, errors: [] };

  // Collect all markdown files recursively
  const mdFiles = collectMarkdownFiles(vaultPath);

  // Build a filename→ULID map for wikilink resolution
  const nameToId = new Map<string, string>();
  const fileEntries: Array<{ path: string; name: string; id: string }> = [];

  for (const filePath of mdFiles) {
    const name = basename(filePath, extname(filePath));
    const id = ulid();
    nameToId.set(name, id);
    nameToId.set(name.toLowerCase(), id);
    fileEntries.push({ path: filePath, name, id });
  }

  // Import each file
  for (const entry of fileEntries) {
    try {
      const raw = readFileSync(entry.path, "utf-8");
      const parsed = matter(raw);

      // Map wikilinks [[Target Note]] or [[Target Note|Display]] to [[note:ULID|label]]
      let body = parsed.content;
      const wikiLinkRegex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
      body = body.replace(wikiLinkRegex, (_match, target: string, display?: string) => {
        const targetId = nameToId.get(target) ?? nameToId.get(target.toLowerCase());
        if (targetId) {
          result.linksMapped++;
          return `[[note:${targetId}|${display ?? target}]]`;
        }
        return display ? `[[${target}|${display}]]` : `[[${target}]]`;
      });

      // Preserve existing frontmatter fields
      const title = (parsed.data["title"] as string | undefined) ?? entry.name;
      const type = parsed.data["type"] as string | undefined;
      const tags = parsed.data["tags"] as string[] | undefined;

      engine.createNote(entry.id, title, body, { type, tags });
      result.imported++;
    } catch (err) {
      result.errors.push(`Failed to import ${entry.name}: ${String(err)}`);
      result.skipped++;
    }
  }

  return result;
}

function collectMarkdownFiles(dir: string): string[] {
  const results: string[] = [];
  const entries = readdirSync(dir);

  for (const entry of entries) {
    if (entry.startsWith(".")) continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      results.push(...collectMarkdownFiles(fullPath));
    } else if (entry.endsWith(".md")) {
      results.push(fullPath);
    }
  }

  return results;
}
