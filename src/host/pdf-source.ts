/**
 * PDF source extraction — Node host layer.
 * Produces regenerable SourceChunks with PDF page/bbox locators.
 */

import { fileURLToPath } from "node:url";
import type { PdfLocator } from "../core/indexer/types.js";
import type { SourceChunk } from "../core/sources/types.js";

const STANDARD_FONT_DATA_PATH = fileURLToPath(new URL("../../node_modules/pdfjs-dist/standard_fonts/", import.meta.url));

type PdfTextItem = {
  str: string;
  transform: number[];
  width: number;
  height: number;
};

type PdfJsModule = {
  getDocument(src: {
    data: Uint8Array;
    disableWorker: boolean;
    isEvalSupported: boolean;
    standardFontDataUrl: string;
  }): {
    promise: Promise<{
      numPages: number;
      getPage(pageNumber: number): Promise<{
        getTextContent(): Promise<{ items: unknown[] }>;
      }>;
      cleanup?(keepLoadedFonts?: boolean): Promise<void>;
    }>;
    destroy?(): Promise<void>;
  };
};

export async function extractPdfChunks(sourceId: string, data: Uint8Array): Promise<SourceChunk[]> {
  const { getDocument } = await loadPdfJs();
  const loadingTask = getDocument({
    data,
    disableWorker: true,
    isEvalSupported: false,
    standardFontDataUrl: STANDARD_FONT_DATA_PATH,
  });
  const doc = await loadingTask.promise;
  try {
    const chunks: SourceChunk[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const textContent = await page.getTextContent();
      const textItems = textContent.items.filter(isPdfTextItem);
      const text = normalizeWhitespace(textItems.map((item) => item.str).join(" "));
      if (!text) continue;

      const locator: PdfLocator = {
        kind: "pdf",
        page: pageNumber,
        bbox: boundingBox(textItems),
        textStart: 0,
        textEnd: text.length,
      };
      const ordinal = chunks.length;
      chunks.push({
        id: `${sourceId}#chunk_${String(ordinal + 1).padStart(4, "0")}`,
        source_id: sourceId,
        ordinal,
        text,
        locator,
      });
    }
    return chunks;
  } finally {
    await doc.cleanup?.();
    await loadingTask.destroy?.();
  }
}

function isPdfTextItem(item: unknown): item is PdfTextItem {
  if (!isRecord(item)) return false;
  return (
    typeof item["str"] === "string" &&
    Array.isArray(item["transform"]) &&
    item["transform"].every((value) => typeof value === "number") &&
    typeof item["width"] === "number" &&
    typeof item["height"] === "number"
  );
}

function boundingBox(items: PdfTextItem[]): PdfLocator["bbox"] {
  if (items.length === 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const item of items) {
    const x = item.transform[4] ?? 0;
    const y = item.transform[5] ?? 0;
    const width = Math.max(0, item.width);
    const height = Math.max(0, item.height);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + width);
    maxY = Math.max(maxY, y + height);
  }

  return {
    x: round(minX),
    y: round(minY),
    width: round(Math.max(0, maxX - minX)),
    height: round(Math.max(0, maxY - minY)),
  };
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

async function loadPdfJs(): Promise<PdfJsModule> {
  const moduleName = "pdfjs-dist/legacy/build/pdf.mjs";
  return await import(moduleName) as PdfJsModule;
}
