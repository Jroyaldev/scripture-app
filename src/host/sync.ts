/**
 * Folder-based sync adapter — Node host layer.
 * Merges Substrate folders without deleting authored data.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import type { LibraryEvent } from "../core/events/types.js";
import { parseFrontmatter } from "../core/notes/parser.js";

export type SyncResult = {
  eventsCopied: number;
  noteConflicts: number;
  artifactPointersCopied: number;
};

export class FolderSyncAdapter {
  syncLibraries(leftRoot: string, rightRoot: string): SyncResult {
    const leftToRightEvents = this.mergeEventLogs(leftRoot, rightRoot);
    const rightToLeftEvents = this.mergeEventLogs(rightRoot, leftRoot);
    const leftToRightNotes = this.mergeNotes(leftRoot, rightRoot);
    const rightToLeftNotes = this.mergeNotes(rightRoot, leftRoot);
    const leftToRightPointers = this.syncArtifactPointers(leftRoot, rightRoot);
    const rightToLeftPointers = this.syncArtifactPointers(rightRoot, leftRoot);

    return {
      eventsCopied: leftToRightEvents + rightToLeftEvents,
      noteConflicts: leftToRightNotes + rightToLeftNotes,
      artifactPointersCopied: leftToRightPointers + rightToLeftPointers,
    };
  }

  private mergeEventLogs(sourceRoot: string, targetRoot: string): number {
    const annotationsDir = join(sourceRoot, "annotations");
    if (!existsSync(annotationsDir)) return 0;
    let copied = 0;
    for (const filename of readdirSync(annotationsDir).filter((file) => file.endsWith(".jsonl"))) {
      const sourceEvents = readEvents(join(sourceRoot, "annotations", filename));
      const targetPath = join(targetRoot, "annotations", filename);
      const targetEvents = readEvents(targetPath);
      const targetIds = new Set(targetEvents.map((event) => event.eventId));
      const merged = [...targetEvents];
      for (const event of sourceEvents) {
        if (!targetIds.has(event.eventId)) {
          merged.push(event);
          targetIds.add(event.eventId);
          copied++;
        }
      }
      merged.sort(compareEvents);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, merged.map((event) => JSON.stringify(event)).join("\n") + (merged.length > 0 ? "\n" : ""));
    }
    return copied;
  }

  private mergeNotes(sourceRoot: string, targetRoot: string): number {
    const sourceNotesDir = join(sourceRoot, "notes");
    const targetNotesDir = join(targetRoot, "notes");
    if (!existsSync(sourceNotesDir)) return 0;
    mkdirSync(targetNotesDir, { recursive: true });

    const targetById = noteIndex(targetNotesDir);
    let conflicts = 0;
    for (const filename of readdirSync(sourceNotesDir).filter((file) => file.endsWith(".md"))) {
      const sourcePath = join(sourceNotesDir, filename);
      const sourceContent = readFileSync(sourcePath, "utf-8");
      const sourceId = parseFrontmatter(sourceContent).frontmatter.id;
      if (!sourceId) continue;

      const targetPath = targetById.get(sourceId);
      if (!targetPath) {
        copyFileSync(sourcePath, join(targetNotesDir, filename));
        continue;
      }

      const targetContent = readFileSync(targetPath, "utf-8");
      if (targetContent === sourceContent) continue;
      if (hasConflictCopy(targetNotesDir, sourceId, sourceContent)) continue;

      const conflictName = conflictFilename(filename, sourceId, sourceContent);
      writeFileSync(join(targetNotesDir, conflictName), sourceContent);
      conflicts++;
    }
    return conflicts;
  }

  private syncArtifactPointers(sourceRoot: string, targetRoot: string): number {
    const sourcePackages = join(sourceRoot, ".artifacts/scripture/packages");
    if (!existsSync(sourcePackages)) return 0;
    let copied = 0;
    for (const packageId of readdirSync(sourcePackages)) {
      const sourcePackage = join(sourcePackages, packageId);
      if (!statSync(sourcePackage).isDirectory()) continue;
      const sourceManifest = join(sourcePackage, "manifest.json");
      if (!existsSync(sourceManifest)) continue;

      const targetPackage = join(targetRoot, ".artifacts/scripture/packages", packageId);
      mkdirSync(targetPackage, { recursive: true });
      copyFileSync(sourceManifest, join(targetPackage, "manifest.json"));
      copied++;

      if (canSyncPackageContent(sourceManifest)) {
        copyDirectoryContents(sourcePackage, targetPackage, (path) => basename(path) !== "manifest.json");
      }
    }
    return copied;
  }
}

function readEvents(path: string): LibraryEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as LibraryEvent);
}

function compareEvents(a: LibraryEvent, b: LibraryEvent): number {
  if (a.deviceId !== b.deviceId) return a.deviceId < b.deviceId ? -1 : 1;
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0;
}

function noteIndex(notesDir: string): Map<string, string> {
  const index = new Map<string, string>();
  if (!existsSync(notesDir)) return index;
  for (const filename of readdirSync(notesDir).filter((file) => file.endsWith(".md"))) {
    const path = join(notesDir, filename);
    const content = readFileSync(path, "utf-8");
    const id = parseFrontmatter(content).frontmatter.id;
    if (id && !index.has(id)) index.set(id, path);
  }
  return index;
}

function hasConflictCopy(notesDir: string, noteId: string, content: string): boolean {
  const digest = shortHash(content);
  return readdirSync(notesDir)
    .filter((file) => file.includes(`.conflict-sync-${noteId}-${digest}`))
    .some((file) => readFileSync(join(notesDir, file), "utf-8") === content);
}

function conflictFilename(originalFilename: string, noteId: string, content: string): string {
  const stem = originalFilename.replace(/\.md$/, "");
  return `${stem}.conflict-sync-${noteId}-${shortHash(content)}.md`;
}

function shortHash(content: string): string {
  return createHash("sha256").update(content).digest("hex").slice(0, 12);
}

function canSyncPackageContent(manifestPath: string): boolean {
  const parsed = JSON.parse(readFileSync(manifestPath, "utf-8")) as unknown;
  if (!isRecord(parsed)) return false;
  const license = parsed["license"];
  if (!isRecord(license)) return false;
  const permissions = license["permissions"];
  if (!isRecord(permissions)) return false;
  return permissions["syncToOwnDevices"] === true;
}

function copyDirectoryContents(sourceDir: string, targetDir: string, shouldCopy: (path: string) => boolean): void {
  for (const entry of readdirSync(sourceDir)) {
    const sourcePath = join(sourceDir, entry);
    if (!shouldCopy(sourcePath)) continue;
    const targetPath = join(targetDir, entry);
    const stat = statSync(sourcePath);
    if (stat.isDirectory()) {
      mkdirSync(targetPath, { recursive: true });
      copyDirectoryContents(sourcePath, targetPath, () => true);
    } else {
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
