/**
 * Electron main process — wires the M1 core behind real file I/O.
 * No core logic here; only window management and IPC bridge.
 */

import { app, BrowserWindow, crashReporter, dialog, ipcMain, nativeTheme, shell } from "electron";
import type { IpcMainEvent, IpcMainInvokeEvent } from "electron";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ElectronStore from "electron-store";

// electron-store v11 is pure ESM. Under Electron 35 (Node 22 require(esm))
// esbuild's CJS interop wraps the namespace so `.default` is the namespace,
// not the class — unwrap whichever shape arrives (fails loudly otherwise).
const Store = ((ElectronStore as unknown as { default?: unknown }).default ??
  ElectronStore) as typeof ElectronStore;

// In development Electron otherwise shares a generic profile with unrelated
// bare-Electron apps. This must precede every app.getPath() and Store call.
app.setName("Pericope");

const __dirname = dirname(fileURLToPath(import.meta.url));
import { ulid } from "ulid";
import type { BackboneData, BookCode, BookNameMap, CanonicalRef } from "../core/reference/types.js";
import { parseBref, toBref, toDisplayString, parseHumanRef } from "../core/reference/parser.js";
import { isValidBookCode, validateBackboneData, validateVerse } from "../core/reference/backbone.js";
import { ConnectionVersionConflictError, LibraryEngine } from "../host/library.js";
import { GitRevisionStore } from "../host/git-revision-store.js";
import { SQLiteMaterializer } from "../host/sqlite.js";
import { EmbeddingsStore } from "../host/embeddings-store.js";
import { BudgetManager } from "../host/budget-manager.js";
import { MockAIProvider, MockEmbeddingProvider, createDeepSeekProvider, OpenAICompatibleAIProvider } from "../host/ai-provider.js";
import { CodexExecAIProvider, createCodexProvider } from "../host/codex-provider.js";
import { RendererEmbeddingProvider } from "./renderer-embeddings.js";
import { loadEnvFile } from "../host/env.js";
import { embedAllNotes } from "../host/embeddings-sync.js";
import { enrichAllNotes, type EnrichTier } from "../host/enrichment-sync.js";
import type { ThemeEntry } from "../core/ai/note-enrichment.js";
import { healSuggestionOrder, inferredRefKey } from "../core/ai/note-enrichment.js";
import type { AIProvider, EmbeddingProvider } from "../core/interfaces.js";
import type { HighlightRecord } from "../core/indexer/types.js";
import { JobQueue } from "../host/job-queue.js";
import { assembleMargin } from "../core/margin/index.js";
import { runSemanticMargin } from "../host/semantic-margin-host.js";
import { importObsidianVault } from "../core/importer/obsidian.js";
import { TokenPackageLoader } from "../host/token-package-loader.js";
import { ReverseIndexLoader } from "../host/reverse-index-loader.js";
import { SyntaxTreeLoader } from "../host/syntax-tree-loader.js";
import { loadOpenBibleCrossReferences } from "../host/cross-reference-loader.js";
import {
  emptyCrossReferenceResult,
  parseCrossReferenceKey,
  queryCrossReferences,
  type CrossReferenceQueryResult,
} from "../core/cross-references/index.js";
import {
  getSharedStepMorphIndex,
  getSharedTipnrIndex,
  getSharedHebrewOrbitIndex,
} from "../core/language/index.js";
import type { CrossRefData, MarginQuery } from "../core/margin/types.js";
import {
  isHighlightOverlap,
  subtractHighlightRange,
  type HighlightRange,
} from "../core/events/highlightOverlap.js";
import {
  searchScriptureDocuments,
  type ScriptureSearchDocument,
} from "../core/search/scripture-search.js";
import { toFts5PlainQuery } from "../core/search/note-search-query.js";
import { PlaceResearchLoader } from "../host/place-research-loader.js";
import type {
  ConnectionRecord,
  CreateConnectionInput,
} from "../core/annotations/types.js";
import {
  captureOccurrenceAlignedSelection,
  projectBackboneTokenAnchor,
  selectionProjectionRoundTrips,
  type OccurrenceAlignmentVerseEvidence,
  type OccurrenceSelectionPiece,
} from "../core/annotations/occurrence-alignment.js";
import { checkMigration } from "../core/migration/index.js";
import { OccurrenceAlignmentStore } from "../host/occurrence-alignment-store.js";
import { sanitizeLegacySettings, type AdoptableLegacySettings } from "./legacy-settings.js";
import {
  bootstrapStudyWorkspaceSetting,
  mergeRawStudyWorkspaceSetting,
} from "./study-workspace-settings.js";
import {
  UserMutationBroker,
  type ExplicitUserMutationIntent,
  type UserConnectionMutationAction,
} from "../host/user-mutation-broker.js";
import {
  rankTrustedResources,
  validateTrustedResourceQuery,
} from "../core/resources/trusted-resources.js";
import { loadTrustedResourceManifests } from "../host/trusted-resource-loader.js";

const DATA_DIR = resolve(__dirname, "../../data/scripture");
const CROSS_REF_DIR = resolve(__dirname, "../../data/cross-references");
const TRUSTED_RESOURCE_DIR = resolve(__dirname, "../../data/resources");
const APP_SESSION_ID = ulid();
const APP_LOG_PATH = join(
  app.getPath("logs"),
  `scripture-main-${new Date().toISOString().slice(0, 10)}.jsonl`,
);
let appLogUnavailable = false;

const studyWorkspaceQaTraceEnabled =
  process.env["SCRIPTURE_QA_STUDY_WORKSPACE_TRACE"] === "1";

function traceStudyWorkspaceQa(
  event: "chapter" | "entity",
  detail: Record<string, unknown>,
): void {
  if (!studyWorkspaceQaTraceEnabled) return;
  const traceEvent = event === "chapter"
    ? "study-workspace-qa:chapter"
    : "study-workspace-qa:entity";
  console.log(`${traceEvent} ${JSON.stringify(detail)}`);
}

type DiagnosticLevel = "info" | "warn" | "error";

function diagnosticError(error: unknown): { name: string; message: string; stack?: string } {
  if (!(error instanceof Error)) {
    return { name: "Error", message: String(error).slice(0, 2_000) };
  }
  return {
    name: error.name,
    message: error.message.slice(0, 2_000),
    ...(error.stack ? { stack: error.stack.slice(0, 8_000) } : {}),
  };
}

/** App-private lifecycle evidence only; never write diagnostics into Library. */
function logLifecycle(
  event: string,
  details: Record<string, unknown> = {},
  level: DiagnosticLevel = "info",
): void {
  const record = {
    timestamp: new Date().toISOString(),
    sessionId: APP_SESSION_ID,
    pid: process.pid,
    event,
    ...details,
  };
  const consoleMethod = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  consoleMethod(`[electron:${event}]`, details);
  if (appLogUnavailable) return;
  try {
    mkdirSync(dirname(APP_LOG_PATH), { recursive: true });
    appendFileSync(APP_LOG_PATH, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
  } catch (error) {
    appLogUnavailable = true;
    console.warn("Electron lifecycle log is unavailable:", diagnosticError(error).message);
  }
}

try {
  crashReporter.start({
    productName: "Pericope",
    uploadToServer: false,
    ignoreSystemCrashHandler: false,
    globalExtra: {
      sessionId: APP_SESSION_ID,
      appVersion: app.getVersion(),
    },
  });
  logLifecycle("session-start", {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    crashDumpsPath: app.getPath("crashDumps"),
  });
} catch (error) {
  logLifecycle("crash-reporter-start-failed", { error: diagnosticError(error) }, "warn");
}

process.on("uncaughtExceptionMonitor", (error, origin) => {
  logLifecycle("uncaught-exception", { origin, error: diagnosticError(error) }, "error");
});

app.on("child-process-gone", (_event, details) => {
  logLifecycle("child-process-gone", {
    type: details.type,
    reason: details.reason,
    exitCode: details.exitCode,
    ...(details.name ? { name: details.name } : {}),
    ...(details.serviceName ? { serviceName: details.serviceName } : {}),
  }, details.reason === "clean-exit" ? "info" : "error");
});

const ALLOWED_RESEARCH_LINK_HOSTS = new Set([
  "commons.wikimedia.org",
  "creativecommons.org",
  "www.nationalarchives.gov.uk",
  "artlibre.org",
  "pleiades.stoa.org",
]);

const ALLOWED_TRUSTED_RESOURCE_HOSTS = new Set([
  "www.workingpreacher.org",
  "bibleproject.com",
  "www.thegospelcoalition.org",
]);

interface WindowBounds {
  x?: number;
  y?: number;
  width: number;
  height: number;
}

interface AppSettingsSchema {
  theme: "light" | "dark" | "porcelain" | "onyx";
  material: "solid" | "translucent";
  markingSurface: "palette" | "dock";
  sidebarCollapsed: boolean;
  marginVisible: boolean;
  readingSize: "s" | "m" | "l";
  readingWidth: "narrow" | "medium" | "wide";
  verseNumbers: "always" | "faint" | "hover";
  recentPassages: Array<{
    book: string;
    chapter: number;
    verse?: number;
    packageId: string;
    visitedAt: number;
  }>;
  /** Where the reader last was — restored on launch. Unlike recentPassages
   * (which only records deliberate jumps), this follows every chapter turn. */
  lastRead: {
    book: string;
    chapter: number;
    packageId: string;
    /** Backward-compatible exact eye-line fields; absent means chapter top. */
    verse?: number;
    verseOffset?: number;
  } | null;
  /** Raw until validated so a future-version object can remain byte-for-byte untouched. */
  studyWorkspace?: unknown;
  researchSession: {
    origin: {
      book: string;
      chapter: number;
      packageId: string;
      chapterEndVerse?: number;
      verseStart?: number;
      verseEnd?: number;
    };
    trail: Array<{ id: string; displayName: string; kind?: "person" | "place" | "other" }>;
  } | null;
  researchWorkspace: {
    tabs: Array<{
      id: string;
      entityId: string;
      origin: NonNullable<AppSettingsSchema["researchSession"]>["origin"];
      trail: Array<{ id: string; displayName: string; kind?: "person" | "place" | "other" }>;
      nonce: number;
    }>;
    activeTabId: string;
    lastResearchTabId: string | null;
    activationOrder: string[];
  } | null;
  keptContext: {
    book: string;
    chapter: number;
    verse: number;
    endVerse?: number;
    label?: string;
  } | null;
  windowBounds: WindowBounds | null;
  /** The library location the user last confirmed (Welcome screen or Switch
   * Library), if any. null means no choice has ever been confirmed — the
   * signal used at startup to decide whether to show the Welcome screen. */
  libraryPath: string | null;
}

type LegacySettingsAdoption =
  | { status: "dedicated-exists" | "legacy-missing" | "legacy-refused" | "legacy-read-failed" }
  | { status: "adopt"; settings: AdoptableLegacySettings };

function readLegacySettingsForAdoption(): LegacySettingsAdoption {
  const userDataDirectory = app.getPath("userData");
  const dedicatedConfig = join(userDataDirectory, "config.json");
  if (existsSync(dedicatedConfig)) return { status: "dedicated-exists" };

  const legacyConfig = resolve(userDataDirectory, "..", "Electron", "config.json");
  if (!existsSync(legacyConfig)) return { status: "legacy-missing" };
  try {
    const settings = sanitizeLegacySettings(JSON.parse(readFileSync(legacyConfig, "utf8")));
    return settings ? { status: "adopt", settings } : { status: "legacy-refused" };
  } catch {
    return { status: "legacy-read-failed" };
  }
}

const MARKING_SURFACE_IDS = new Set<AppSettingsSchema["markingSurface"]>([
  "palette",
  "dock",
]);

// The retired surfaces map to the one that replaced them: the rail was a
// persistent toolbar like the dock, and the radial was a floating one like
// the palette. Neither reader loses the kind of surface they chose.
const LEGACY_MARKING_SURFACE: Record<string, AppSettingsSchema["markingSurface"]> = {
  rail: "dock",
  radial: "palette",
};
const THEME_IDS = new Set<AppSettingsSchema["theme"]>([
  "light",
  "dark",
  "porcelain",
  "onyx",
]);

// Glass and Candlelight were never separate atmospheres — they were Paper and
// Ink with the material on. A reader who picked one did express a preference,
// so migrate it into (theme, material) rather than resetting them to Paper.
const LEGACY_THEME_MIGRATION: Record<string, { theme: AppSettingsSchema["theme"]; material: AppSettingsSchema["material"] }> = {
  "glass": { theme: "light", material: "translucent" },
  "dark-glass": { theme: "dark", material: "translucent" },
};

function normalizeTheme(value: unknown): AppSettingsSchema["theme"] {
  if (typeof value !== "string") return "light";
  const migrated = LEGACY_THEME_MIGRATION[value];
  if (migrated) return migrated.theme;
  return THEME_IDS.has(value as AppSettingsSchema["theme"])
    ? value as AppSettingsSchema["theme"]
    : "light";
}

function normalizeMaterial(value: unknown, rawTheme: unknown): AppSettingsSchema["material"] {
  if (value === "translucent" || value === "solid") return value;
  if (typeof rawTheme === "string" && LEGACY_THEME_MIGRATION[rawTheme]) {
    return LEGACY_THEME_MIGRATION[rawTheme].material;
  }
  return "solid";
}

function normalizeMarkingSurface(value: unknown): AppSettingsSchema["markingSurface"] {
  if (typeof value === "string" && LEGACY_MARKING_SURFACE[value]) {
    return LEGACY_MARKING_SURFACE[value]!;
  }
  return typeof value === "string"
    && MARKING_SURFACE_IDS.has(value as AppSettingsSchema["markingSurface"])
    ? value as AppSettingsSchema["markingSurface"]
    : "palette";
}

function normalizeLastRead(value: unknown): AppSettingsSchema["lastRead"] {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["book"] !== "string"
    || !Number.isInteger(candidate["chapter"])
    || (candidate["chapter"] as number) < 1
    || typeof candidate["packageId"] !== "string"
  ) return null;
  const verse = candidate["verse"];
  const verseOffset = candidate["verseOffset"];
  const hasEyeLine = Number.isInteger(verse)
    && (verse as number) >= 1
    && typeof verseOffset === "number"
    && Number.isFinite(verseOffset);
  return {
    book: candidate["book"],
    chapter: candidate["chapter"] as number,
    packageId: candidate["packageId"],
    ...(hasEyeLine ? { verse: verse as number, verseOffset } : {}),
  };
}

function normalizeResearchSession(value: unknown): AppSettingsSchema["researchSession"] {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const origin = candidate["origin"];
  const trail = candidate["trail"];
  if (!origin || typeof origin !== "object" || !Array.isArray(trail)) return null;
  const source = origin as Record<string, unknown>;
  if (
    typeof source["book"] !== "string"
    || !/^[1-3A-Z]{3}$/.test(source["book"])
    || !Number.isInteger(source["chapter"])
    || (source["chapter"] as number) < 1
    || typeof source["packageId"] !== "string"
    || source["packageId"].length < 1
  ) return null;
  const optionalPositive = (key: string): number | undefined => {
    const field = source[key];
    return Number.isInteger(field) && (field as number) > 0 ? field as number : undefined;
  };
  const normalizedTrail: Array<{ id: string; displayName: string; kind?: "person" | "place" | "other" }> = [];
  for (const item of trail.slice(-12)) {
    if (!item || typeof item !== "object") return null;
    const record = item as Record<string, unknown>;
    if (
      typeof record["id"] !== "string"
      || record["id"].length < 1
      || record["id"].length > 256
      || typeof record["displayName"] !== "string"
      || record["displayName"].length < 1
      || record["displayName"].length > 256
    ) return null;
    // Kind is cosmetic (tab glyph only) — an unrecognized value is dropped,
    // never a reason to refuse the whole session.
    const kind = record["kind"];
    normalizedTrail.push({
      id: record["id"],
      displayName: record["displayName"],
      ...(kind === "person" || kind === "place" || kind === "other" ? { kind } : {}),
    });
  }
  return {
    origin: {
      book: source["book"],
      chapter: source["chapter"] as number,
      packageId: source["packageId"],
      ...(optionalPositive("chapterEndVerse") != null ? { chapterEndVerse: optionalPositive("chapterEndVerse") } : {}),
      ...(optionalPositive("verseStart") != null ? { verseStart: optionalPositive("verseStart") } : {}),
      ...(optionalPositive("verseEnd") != null ? { verseEnd: optionalPositive("verseEnd") } : {}),
    },
    trail: normalizedTrail,
  };
}

function normalizeResearchWorkspace(value: unknown): AppSettingsSchema["researchWorkspace"] {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate["tabs"])) return null;
  const tabs: NonNullable<AppSettingsSchema["researchWorkspace"]>["tabs"] = [];
  const ids = new Set<string>();
  for (const item of candidate["tabs"].slice(0, 64)) {
    if (!item || typeof item !== "object") return null;
    const tab = item as Record<string, unknown>;
    if (
      typeof tab["id"] !== "string"
      || tab["id"].length < 1
      || tab["id"].length > 160
      || ids.has(tab["id"])
      || typeof tab["entityId"] !== "string"
      || tab["entityId"].length < 1
      || tab["entityId"].length > 256
      || !Number.isSafeInteger(tab["nonce"])
      || (tab["nonce"] as number) < 0
    ) return null;
    const session = normalizeResearchSession({ origin: tab["origin"], trail: tab["trail"] });
    if (!session) return null;
    ids.add(tab["id"]);
    tabs.push({
      id: tab["id"],
      entityId: tab["entityId"],
      origin: session.origin,
      trail: session.trail,
      nonce: tab["nonce"] as number,
    });
  }
  const validIds = new Set(["scripture", ...ids]);
  const activeTabId = typeof candidate["activeTabId"] === "string" && validIds.has(candidate["activeTabId"])
    ? candidate["activeTabId"]
    : "scripture";
  const lastResearchTabId = typeof candidate["lastResearchTabId"] === "string" && ids.has(candidate["lastResearchTabId"])
    ? candidate["lastResearchTabId"]
    : tabs.at(-1)?.id ?? null;
  const activationOrder = Array.isArray(candidate["activationOrder"])
    ? [...new Set(candidate["activationOrder"].filter((id): id is string => typeof id === "string" && validIds.has(id)))]
    : [];
  if (!activationOrder.includes("scripture")) activationOrder.unshift("scripture");
  if (!activationOrder.includes(activeTabId)) activationOrder.push(activeTabId);
  return { tabs, activeTabId, lastResearchTabId, activationOrder };
}

function normalizeKeptContext(value: unknown): AppSettingsSchema["keptContext"] {
  if (value === null) return null;
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate["book"] !== "string"
    || !/^[1-3A-Z]{3}$/.test(candidate["book"])
    || !Number.isInteger(candidate["chapter"])
    || (candidate["chapter"] as number) < 1
    || !Number.isInteger(candidate["verse"])
    || (candidate["verse"] as number) < 1
  ) return null;
  const endVerse = Number.isInteger(candidate["endVerse"])
    && (candidate["endVerse"] as number) >= (candidate["verse"] as number)
    ? candidate["endVerse"] as number
    : undefined;
  const label = typeof candidate["label"] === "string"
    && candidate["label"].length > 0
    && candidate["label"].length <= 120
    ? candidate["label"]
    : undefined;
  return {
    book: candidate["book"],
    chapter: candidate["chapter"] as number,
    verse: candidate["verse"] as number,
    ...(endVerse != null ? { endVerse } : {}),
    ...(label ? { label } : {}),
  };
}

const legacySettingsAdoption = readLegacySettingsForAdoption();
const store = new Store<AppSettingsSchema>({
  defaults: {
    theme: nativeTheme.shouldUseDarkColors ? "dark" : "light",
    material: "solid",
    markingSurface: "palette",
    sidebarCollapsed: false,
    marginVisible: true,
    readingSize: "m",
    readingWidth: "medium",
    verseNumbers: "always",
    recentPassages: [],
    lastRead: null,
    researchSession: null,
    researchWorkspace: null,
    keptContext: null,
    windowBounds: null,
    libraryPath: null,
  },
});

if (legacySettingsAdoption.status === "adopt") {
  // The legacy store can still name Glass or Candlelight. Those were never
  // separate atmospheres, so adopt them as the theme they always were plus
  // the material switch they actually meant.
  const {
    theme: legacyTheme,
    markingSurface: legacySurface,
    ...adopted
  } = legacySettingsAdoption.settings;
  store.store = {
    ...store.store,
    ...adopted,
    ...(legacySurface === undefined
      ? {}
      : { markingSurface: normalizeMarkingSurface(legacySurface) }),
    ...(legacyTheme === undefined ? {} : {
      theme: normalizeTheme(legacyTheme),
      material: normalizeMaterial(undefined, legacyTheme),
    }),
  };
}
logLifecycle("legacy-settings-adoption", {
  status: legacySettingsAdoption.status,
  adoptedKeys: legacySettingsAdoption.status === "adopt"
    ? Object.keys(legacySettingsAdoption.settings).sort()
    : [],
});

let mainWindow: BrowserWindow | null = null;
let engine: LibraryEngine | null = null;
let revisionStore: GitRevisionStore | null = null;
let userMutationBroker: UserMutationBroker | null = null;
let occurrenceAlignmentStore: OccurrenceAlignmentStore | null = null;
let backbone: BackboneData | null = null;
let bookNames: BookNameMap | null = null;
let crossRefData: CrossRefData | null = null;
let embeddingsStore: EmbeddingsStore | null = null;
let budgetManager: BudgetManager | null = null;
let aiProvider: AIProvider | null = null;
let codexProvider: CodexExecAIProvider | null = null;
let themes: ThemeEntry[] = [];
let embeddingProvider: EmbeddingProvider | null = null;
let jobQueue: JobQueue | null = null;
let runtimeAccepting = false;
let runtimeOperationCount = 0;
let runtimeIdleWaiters: Array<() => void> = [];
let authoredOperationCount = 0;
let authoredIdleWaiters: Array<() => void> = [];
let semanticAccepting = false;
let semanticOperationCount = 0;
let semanticIdleWaiters: Array<() => void> = [];
let engineLifecycleTail: Promise<void> = Promise.resolve();
let isAppQuitting = false;

type RendererCloseRequestSource = "window" | "quit";

interface MainWindowCloseTarget {
  window: BrowserWindow;
  windowGeneration: number;
  guardReady: boolean;
}

interface PendingRendererCloseRequest {
  requestId: string;
  source: "window" | "quit";
  windowGeneration: number;
  senderId: number;
  promise: Promise<boolean>;
  resolve(approved: boolean): void;
}

let windowGeneration = 0;
let mainWindowCloseTarget: MainWindowCloseTarget | null = null;
let pendingRendererCloseRequest: PendingRendererCloseRequest | null = null;

function currentRendererCloseTarget(): MainWindowCloseTarget | null {
  const target = mainWindowCloseTarget;
  if (
    !target
    || mainWindow !== target.window
    || target.window.isDestroyed()
    || target.window.webContents.isDestroyed()
  ) return null;
  return target;
}

function cancelRendererCloseAcknowledgement(targetGeneration: number): void {
  const pending = pendingRendererCloseRequest;
  if (!pending || pending.windowGeneration !== targetGeneration) return;
  pendingRendererCloseRequest = null;
  pending.resolve(false);
}

/** Window chrome, renderer titlebar controls, and app.before-quit all wait on
 * this one renderer-owned authored-workspace decision. Repeated requests for
 * the current window share the same promise and therefore cannot duplicate a
 * flush, prompt, or close response. */
function requestRendererCloseAcknowledgement(
  source: RendererCloseRequestSource,
): Promise<boolean> {
  const target = currentRendererCloseTarget();
  // Startup failures and a renderer that has not installed its guard cannot
  // own authored in-memory state yet, so Electron may continue its native
  // lifecycle. A ready visible renderer must always acknowledge explicitly.
  if (!target || !target.guardReady) return Promise.resolve(true);

  if (
    pendingRendererCloseRequest
    && pendingRendererCloseRequest.windowGeneration === target.windowGeneration
    && pendingRendererCloseRequest.senderId === target.window.webContents.id
  ) {
    return pendingRendererCloseRequest.promise;
  }

  if (pendingRendererCloseRequest) {
    const stale = pendingRendererCloseRequest;
    pendingRendererCloseRequest = null;
    stale.resolve(false);
  }

  const requestId = ulid();
  let resolveAcknowledgement!: (approved: boolean) => void;
  const promise = new Promise<boolean>((resolvePending) => {
    resolveAcknowledgement = resolvePending;
  });
  pendingRendererCloseRequest = {
    requestId,
    source,
    windowGeneration: target.windowGeneration,
    senderId: target.window.webContents.id,
    promise,
    resolve: resolveAcknowledgement,
  };
  try {
    target.window.webContents.send("app-window-close-requested", { requestId, source });
  } catch (error) {
    pendingRendererCloseRequest = null;
    resolveAcknowledgement(false);
    logLifecycle("renderer-close-request-send-failed", {
      requestId,
      source,
      windowGeneration: target.windowGeneration,
      error: diagnosticError(error),
    }, "error");
  }
  return promise;
}

function resolveRendererCloseAcknowledgement(
  event: IpcMainEvent,
  requestId: unknown,
  proceed: unknown,
): void {
  const pending = pendingRendererCloseRequest;
  const target = currentRendererCloseTarget();
  if (
    typeof requestId !== "string" || typeof proceed !== "boolean"
    || !pending
    || !target
    || pending.requestId !== requestId
    || pending.senderId !== event.sender.id
    || pending.windowGeneration !== target.windowGeneration
    || event.sender !== target.window.webContents
  ) {
    logLifecycle("renderer-close-response-rejected", {
      requestId: typeof requestId === "string" ? requestId.slice(0, 64) : null,
      senderId: event.sender.id,
      activeWindowGeneration: target?.windowGeneration ?? null,
    }, "warn");
    return;
  }
  pendingRendererCloseRequest = null;
  pending.resolve(proceed);
}

ipcMain.on("app-window-close-response", resolveRendererCloseAcknowledgement);
ipcMain.on("app-window-close-guard-ready", (event) => {
  const target = currentRendererCloseTarget();
  if (target && event.sender === target.window.webContents) target.guardReady = true;
});
ipcMain.on("app-window-request-close", (event) => {
  const target = currentRendererCloseTarget();
  if (target && event.sender === target.window.webContents) target.window.close();
});
/** Original-language packages (MACULA Greek, later OSHB Hebrew). */
let tokenPackages: TokenPackageLoader | null = null;
let reverseIndexes: ReverseIndexLoader | null = null;
/** MACULA syntax trees (syntax art). */
let syntaxTrees: SyntaxTreeLoader | null = null;
/** OpenBible/TIPNR biblical-place research and Natural Earth minimaps. */
let placeResearch: PlaceResearchLoader | null = null;

interface EngineRuntime {
  engine: LibraryEngine;
  revisionStore: GitRevisionStore;
  userMutationBroker: UserMutationBroker;
  occurrenceAlignmentStore: OccurrenceAlignmentStore;
  backbone: BackboneData;
  bookNames: BookNameMap;
  crossRefData: CrossRefData | null;
  embeddingsStore: EmbeddingsStore | null;
  budgetManager: BudgetManager | null;
  aiProvider: AIProvider | null;
  codexProvider: CodexExecAIProvider | null;
  themes: ThemeEntry[];
  embeddingProvider: EmbeddingProvider | null;
  jobQueue: JobQueue | null;
  tokenPackages: TokenPackageLoader;
  reverseIndexes: ReverseIndexLoader;
  syntaxTrees: SyntaxTreeLoader;
  placeResearch: PlaceResearchLoader;
}

const SWITCH_DRAIN_TIMEOUT_MS = 30_000;
const QUIT_DRAIN_TIMEOUT_MS = 8_000;

function beginRuntimeOperation(): (() => void) | null {
  if (!runtimeAccepting) return null;
  runtimeOperationCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    runtimeOperationCount--;
    if (runtimeOperationCount !== 0) return;
    const waiters = runtimeIdleWaiters;
    runtimeIdleWaiters = [];
    for (const resolveIdle of waiters) resolveIdle();
  };
}

function waitForRuntimeIdle(): Promise<void> {
  if (runtimeOperationCount === 0) return Promise.resolve();
  return new Promise((resolveIdle) => runtimeIdleWaiters.push(resolveIdle));
}

function beginAuthoredOperation(): () => void {
  authoredOperationCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    authoredOperationCount--;
    if (authoredOperationCount !== 0) return;
    const waiters = authoredIdleWaiters;
    authoredIdleWaiters = [];
    for (const resolveIdle of waiters) resolveIdle();
  };
}

function waitForAuthoredIdle(): Promise<void> {
  if (authoredOperationCount === 0) return Promise.resolve();
  return new Promise((resolveIdle) => authoredIdleWaiters.push(resolveIdle));
}

function beginSemanticOperation(): (() => void) | null {
  if (!semanticAccepting) return null;
  semanticOperationCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    semanticOperationCount--;
    if (semanticOperationCount !== 0) return;
    const waiters = semanticIdleWaiters;
    semanticIdleWaiters = [];
    for (const resolveIdle of waiters) resolveIdle();
  };
}

function waitForSemanticIdle(): Promise<void> {
  if (semanticOperationCount === 0) return Promise.resolve();
  return new Promise((resolveIdle) => semanticIdleWaiters.push(resolveIdle));
}

async function withSemanticOperation<T>(
  unavailable: T,
  operation: () => Promise<T>,
): Promise<T> {
  const releaseRuntime = beginRuntimeOperation();
  if (!releaseRuntime) return unavailable;
  const releaseSemantic = beginSemanticOperation();
  if (!releaseSemantic) {
    releaseRuntime();
    return unavailable;
  }
  try {
    return await operation();
  } finally {
    releaseSemantic();
    releaseRuntime();
  }
}

function registerRuntimeIpc(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedMainRenderer(event)) {
      logLifecycle("untrusted-runtime-ipc-blocked", {
        channel,
        senderId: event.sender.id,
        senderUrl: event.senderFrame?.url ?? "detached",
      }, "warn");
      return { ok: false, error: "Untrusted renderer request was refused" };
    }
    const release = beginRuntimeOperation();
    if (!release) return { ok: false, error: "Library runtime is switching" };
    const releaseAuthored = beginAuthoredOperation();
    try {
      return Promise.resolve(listener(event, ...args)).finally(() => {
        releaseAuthored();
        release();
      });
    } catch (error) {
      releaseAuthored();
      release();
      throw error;
    }
  });
}

/** Read-only runtime lease. Exact capture and package projection inspect
 * immutable artifacts/Derived rows but never enter the authored-write drain. */
function registerRuntimeReadIpc(
  channel: string,
  listener: Parameters<typeof ipcMain.handle>[1],
  unavailable?: (message: string, args: readonly unknown[]) => unknown,
): void {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedMainRenderer(event)) {
      logLifecycle("untrusted-runtime-ipc-blocked", {
        channel,
        senderId: event.sender.id,
        senderUrl: event.senderFrame?.url ?? "detached",
      }, "warn");
      const message = "Untrusted renderer request was refused";
      return unavailable?.(message, args) ?? { ok: false, error: message };
    }
    const release = beginRuntimeOperation();
    if (!release) {
      const message = "Library runtime is switching";
      return unavailable?.(message, args) ?? { ok: false, error: message };
    }
    try {
      return Promise.resolve(listener(event, ...args)).finally(release);
    } catch (error) {
      release();
      throw error;
    }
  });
}

function isTrustedMainRenderer(event: IpcMainInvokeEvent): boolean {
  const win = mainWindow;
  const frame = event.senderFrame;
  if (!win || win.isDestroyed() || !frame || event.sender.id !== win.webContents.id) return false;
  const mainFrame = win.webContents.mainFrame;
  if (frame.processId !== mainFrame.processId || frame.routingId !== mainFrame.routingId) return false;
  return isTrustedRendererUrl(frame.url);
}

function isTrustedRendererUrl(value: string): boolean {
  try {
    const candidate = new URL(value);
    const expected = trustedDevelopmentRendererUrl()
      ?? pathToFileURL(join(__dirname, "../renderer/index.html"));
    candidate.hash = "";
    candidate.search = "";
    expected.hash = "";
    expected.search = "";
    if (expected.protocol === "file:") {
      return candidate.protocol === "file:" && fileURLToPath(candidate) === fileURLToPath(expected);
    }
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
  } catch {
    return false;
  }
}

function trustedDevelopmentRendererUrl(): URL | null {
  const configured = process.env["ELECTRON_DEV_URL"];
  if (!configured || app.isPackaged) return null;
  try {
    const candidate = new URL(configured);
    const loopback = candidate.hostname === "localhost"
      || candidate.hostname === "127.0.0.1"
      || candidate.hostname === "[::1]"
      || candidate.hostname === "::1";
    if (
      !loopback
      || (candidate.protocol !== "http:" && candidate.protocol !== "https:")
      || candidate.username
      || candidate.password
    ) return null;
    return candidate;
  } catch {
    return null;
  }
}

function currentRuntime(): EngineRuntime | null {
  if (!engine || !revisionStore || !userMutationBroker || !occurrenceAlignmentStore || !backbone || !bookNames
    || !tokenPackages || !reverseIndexes || !syntaxTrees || !placeResearch) {
    return null;
  }
  return {
    engine,
    revisionStore,
    userMutationBroker,
    occurrenceAlignmentStore,
    backbone,
    bookNames,
    crossRefData,
    embeddingsStore,
    budgetManager,
    aiProvider,
    codexProvider,
    themes,
    embeddingProvider,
    jobQueue,
    tokenPackages,
    reverseIndexes,
    syntaxTrees,
    placeResearch,
  };
}

function publishRuntime(runtime: EngineRuntime): void {
  engine = runtime.engine;
  revisionStore = runtime.revisionStore;
  userMutationBroker = runtime.userMutationBroker;
  occurrenceAlignmentStore = runtime.occurrenceAlignmentStore;
  backbone = runtime.backbone;
  bookNames = runtime.bookNames;
  crossRefData = runtime.crossRefData;
  embeddingsStore = runtime.embeddingsStore;
  budgetManager = runtime.budgetManager;
  aiProvider = runtime.aiProvider;
  codexProvider = runtime.codexProvider;
  themes = runtime.themes;
  embeddingProvider = runtime.embeddingProvider;
  jobQueue = runtime.jobQueue;
  tokenPackages = runtime.tokenPackages;
  reverseIndexes = runtime.reverseIndexes;
  syntaxTrees = runtime.syntaxTrees;
  placeResearch = runtime.placeResearch;
  runtimeAccepting = true;
  semanticAccepting = runtime.embeddingsStore !== null && runtime.embeddingProvider !== null;
  highlightChanges.clear();
  scriptureChapterCache.clear();
  scriptureSearchCorpusCache.clear();
}

function freezeRuntimeOperations(): void {
  runtimeAccepting = false;
  semanticAccepting = false;
}

function unfreezeRuntimeOperations(runtime: EngineRuntime): void {
  runtimeAccepting = true;
  semanticAccepting = runtime.embeddingsStore !== null && runtime.embeddingProvider !== null;
}

async function settleWithin(
  waits: Promise<void>[],
  timeoutMs: number,
): Promise<{ completed: boolean; failures: unknown[] }> {
  const settled = Promise.allSettled(waits);
  let timeout: NodeJS.Timeout | null = null;
  const timedOut = new Promise<null>((resolveTimeout) => {
    timeout = setTimeout(() => resolveTimeout(null), timeoutMs);
  });
  const result = await Promise.race([settled, timedOut]);
  if (timeout) clearTimeout(timeout);
  if (result === null) {
    // allSettled remains observed after the deadline, so late failures never
    // become unhandled rejections while the old store deliberately stays open.
    void settled.then(() => undefined);
    return { completed: false, failures: [] };
  }
  return {
    completed: true,
    failures: result
      .filter((entry): entry is PromiseRejectedResult => entry.status === "rejected")
      .map((entry) => entry.reason),
  };
}

function disposeSemanticRuntime(runtime: EngineRuntime, reason: string, closeStore: boolean): void {
  if (runtime.embeddingProvider instanceof RendererEmbeddingProvider) {
    runtime.embeddingProvider.dispose(`Semantic runtime stopped: ${reason}`);
  }
  if (closeStore && runtime.embeddingsStore) {
    try {
      runtime.embeddingsStore.close();
    } catch (error) {
      logLifecycle("semantic-store-close-failed", {
        reason,
        error: diagnosticError(error),
      }, "error");
    }
  }
  if (closeStore) {
    runtime.occurrenceAlignmentStore.close();
  }
  logLifecycle("semantic-runtime-stopped", { reason });
}

async function retireRuntime(runtime: EngineRuntime, reason: string): Promise<void> {
  // This is called only after foreground leases are idle. A switch pause also
  // guarantees no background job still owns the old SQLite handle.
  let shutdownError: unknown;
  try {
    if (runtime.jobQueue) await runtime.jobQueue.shutdown();
  } catch (error) {
    shutdownError = error;
  } finally {
    disposeSemanticRuntime(runtime, reason, true);
  }
  if (shutdownError) throw shutdownError;
}

type ScriptureChapterFile = {
  verses: Array<{ verse: number; text: string }>;
  /** Editors' section headings; BSB carries them, the other packages do not. */
  headings?: Array<{
    beforeVerse: number;
    kind: "section" | "major-section" | "description" | "speaker" | "acrostic";
    level: number;
    text: string;
  }>;
};

const scriptureChapterCache = new Map<string, ScriptureChapterFile | null>();
const scriptureSearchCorpusCache = new Map<string, ScriptureSearchDocument[]>();

interface HighlightChangeSnapshot {
  before: HighlightRecord[];
  after: HighlightRecord[];
}

// Undo tokens are intentionally process-local and short-lived in product
// terms: they back the five-second toast, not durable history. The append-only
// event log remains the durable source of truth.
const highlightChanges = new Map<string, HighlightChangeSnapshot>();
const MAX_HIGHLIGHT_CHANGES = 50;

function rememberHighlightChange(before: HighlightRecord[], after: HighlightRecord[]): string {
  const changeId = `hlchg_${ulid()}`;
  highlightChanges.set(changeId, {
    before: before.map((record) => ({ ...record, deleted: 0 })),
    after: after.map((record) => ({ ...record, deleted: 0 })),
  });
  while (highlightChanges.size > MAX_HIGHLIGHT_CHANGES) {
    const oldest = highlightChanges.keys().next().value as string | undefined;
    if (!oldest) break;
    highlightChanges.delete(oldest);
  }
  return changeId;
}

function highlightRecordMatches(a: HighlightRecord | undefined, b: HighlightRecord): boolean {
  return !!a &&
    a.id === b.id &&
    a.book === b.book &&
    a.chapter === b.chapter &&
    a.verse_start === b.verse_start &&
    a.verse_end === b.verse_end &&
    a.package === b.package &&
    a.char_start === b.char_start &&
    a.char_end === b.char_end &&
    a.color === b.color &&
    a.deleted === 0;
}

function rangeRecord(
  id: string,
  source: HighlightRecord,
  range: HighlightRange,
): HighlightRecord {
  return {
    ...source,
    id,
    verse_start: range.verseStart,
    verse_end: range.verseEnd,
    char_start: range.charStart,
    char_end: range.charEnd,
    deleted: 0,
  };
}

function validateHighlightRange(range: HighlightRange): string | null {
  if (!Number.isInteger(range.verseStart) || !Number.isInteger(range.verseEnd) || range.verseStart < 1 || range.verseEnd < range.verseStart) {
    return "Invalid highlight verse range";
  }
  if (range.charStart != null && (!Number.isInteger(range.charStart) || range.charStart < 0)) {
    return "Invalid highlight start offset";
  }
  if (range.charEnd != null && (!Number.isInteger(range.charEnd) || range.charEnd < 0)) {
    return "Invalid highlight end offset";
  }
  if (
    range.verseStart === range.verseEnd &&
    range.charStart != null &&
    range.charEnd != null &&
    range.charEnd <= range.charStart
  ) {
    return "Highlight selection is empty";
  }
  return null;
}

function applyHighlightRecordUpdate(target: LibraryEngine, record: HighlightRecord): void {
  target.applyHighlightUpdate(record.id, {
    book: record.book,
    chapter: record.chapter,
    verseStart: record.verse_start,
    verseEnd: record.verse_end,
    package: record.package,
    color: record.color,
    charStart: record.char_start,
    charEnd: record.char_end,
  });
}

function explicitUserMutationIntent(
  action: UserConnectionMutationAction,
  commandId: string,
): ExplicitUserMutationIntent {
  return {
    source: "first-party-ui",
    action,
    commandId,
  };
}

const qaDroppedConnectionResponses = new Set<string>();

function maybeDropQaConnectionResponse(
  action: "create" | "update" | "delete",
  commandId: string,
): void {
  if (app.isPackaged || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(commandId)) return;
  const requested = new Set(
    (process.env["SCRIPTURE_QA_DROP_CONNECTION_RESPONSES"] ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  if (!requested.has(action)) return;
  const key = `${action}:${commandId}`;
  if (qaDroppedConnectionResponses.has(key)) return;
  qaDroppedConnectionResponses.add(key);
  throw new Error("QA simulated a lost renderer response after the authored event was committed.");
}

function isRuntimeRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ConnectionMutationOperation = "create" | "update" | "delete";

function connectionCommandDiagnosticId(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, 128) : null;
}

function connectionProjectionWarning(
  operation: ConnectionMutationOperation,
  commandId: unknown,
  projection: "current" | "rebuilt" | "pending",
  projectionError?: string,
): { warning?: string } {
  if (projectionError) {
    logLifecycle("connection-projection-recovery", {
      operation,
      commandId: connectionCommandDiagnosticId(commandId),
      projection,
      error: diagnosticError(projectionError),
    }, projection === "pending" ? "warn" : "info");
  }
  if (projection !== "pending") return {};
  return {
    warning: "Connection is safely recorded, but its reading index still needs recovery.",
  };
}

function loadBackbone(): BackboneData {
  const backbonePath = join(DATA_DIR, "backbone.json");
  const data = JSON.parse(readFileSync(backbonePath, "utf-8")) as BackboneData;
  const validation = validateBackboneData(data);
  if (!validation.ok) {
    throw new Error(`Backbone validation failed: ${validation.error}`);
  }
  return data;
}

function loadBookNames(): BookNameMap {
  const namesPath = join(DATA_DIR, "book-names-en.json");
  return JSON.parse(readFileSync(namesPath, "utf-8")) as BookNameMap;
}

function loadCrossRefs(): CrossRefData | null {
  const path = join(CROSS_REF_DIR, "openbible.jsonl");
  if (!existsSync(path)) return null;
  return loadOpenBibleCrossReferences(path);
}

function readScriptureChapter(packageId: string, book: string, chapter: number): ScriptureChapterFile | null {
  const libraryRoot = engine?.rootPath ?? "data";
  const cacheKey = `${libraryRoot}:${packageId}:${book}:${chapter}`;
  if (scriptureChapterCache.has(cacheKey)) {
    const cached = scriptureChapterCache.get(cacheKey) ?? null;
    scriptureChapterCache.delete(cacheKey);
    scriptureChapterCache.set(cacheKey, cached);
    return cached;
  }

  const libraryPath = engine
    ? join(engine.rootPath, ".artifacts/scripture/packages", packageId, "text", book, `${chapter}.json`)
    : "";
  const dataPath = join(DATA_DIR, "text", packageId, book, `${chapter}.json`);
  const path = libraryPath && existsSync(libraryPath) ? libraryPath : dataPath;
  const value = existsSync(path)
    ? JSON.parse(readFileSync(path, "utf-8")) as ScriptureChapterFile
    : null;
  scriptureChapterCache.set(cacheKey, value);
  while (scriptureChapterCache.size > MAX_SCRIPTURE_CHAPTER_CACHE_ENTRIES) {
    const oldest = scriptureChapterCache.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    scriptureChapterCache.delete(oldest);
  }
  return value;
}

const CONNECTION_SELECTION_KEYS = [
  "book",
  "chapter",
  "verse",
  "char_start",
  "char_end",
  "quote",
] as const;
const MAX_CONNECTION_SELECTION_PIECES = 256;
const MAX_CONNECTION_SELECTION_QUOTE = 8_192;
const MAX_CONNECTION_CAPTURE_BYTES = 384 * 1_024;
const MAX_CONNECTION_PROJECTION_IDS = 512;
const MAX_CONNECTION_ID_LENGTH = 128;
const MAX_SCRIPTURE_CHAPTER_CACHE_ENTRIES = 96;

type HostConnectionPaintFragment = {
  verse: number;
  char_start: number;
  char_end: number;
  quote: string;
};

type HostConnectionPaintAnchor = {
  book: BookCode;
  chapter: number;
  verse_start: number;
  verse_end: number;
  fragments: readonly HostConnectionPaintFragment[];
};

type HostConnectionPaintProjection = {
  connectionId: string;
  sourceActiveEventId: string | null;
  packageId: string;
  status: "exact" | "legacy-exact" | "unavailable";
  anchors: readonly HostConnectionPaintAnchor[];
  error?: { code: string; message: string };
};

type OccurrenceEvidenceEntry =
  | { ok: true; value: OccurrenceAlignmentVerseEvidence }
  | { ok: false; error: { code: string; message: string } };

type OccurrenceEvidenceCache = Map<string, OccurrenceEvidenceEntry>;

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function scriptureVerseText(
  packageId: string,
  book: BookCode,
  chapter: number,
  verse: number,
): string | undefined {
  return readScriptureChapter(packageId, book, chapter)?.verses
    .find((candidate) => candidate.verse === verse)?.text;
}

function normalizeOccurrenceSelections(
  raw: unknown,
): { ok: true; value: OccurrenceSelectionPiece[] } | { ok: false; error: string } {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CONNECTION_SELECTION_PIECES) {
    return {
      ok: false,
      error: `Exact capture requires 1 to ${MAX_CONNECTION_SELECTION_PIECES} selection pieces.`,
    };
  }
  if (!backbone) return { ok: false, error: "Backbone reference data is unavailable." };
  const normalized: OccurrenceSelectionPiece[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const candidate = raw[index];
    if (!isRuntimeRecord(candidate)) {
      return { ok: false, error: `Selection piece ${index} is invalid.` };
    }
    const keys = Object.keys(candidate);
    if (
      keys.length !== CONNECTION_SELECTION_KEYS.length
      || keys.some((key) => !(CONNECTION_SELECTION_KEYS as readonly string[]).includes(key))
    ) {
      return { ok: false, error: `Selection piece ${index} contains unknown or missing fields.` };
    }
    const book = candidate["book"];
    const chapter = candidate["chapter"];
    const verse = candidate["verse"];
    const charStart = candidate["char_start"];
    const charEnd = candidate["char_end"];
    const quote = candidate["quote"];
    if (
      typeof book !== "string"
      || !isValidBookCode(book)
      || !Number.isSafeInteger(chapter)
      || (chapter as number) <= 0
      || !Number.isSafeInteger(verse)
      || (verse as number) <= 0
      || !Number.isSafeInteger(charStart)
      || (charStart as number) < 0
      || !Number.isSafeInteger(charEnd)
      || (charEnd as number) <= (charStart as number)
      || typeof quote !== "string"
      || quote.length > MAX_CONNECTION_SELECTION_QUOTE
    ) {
      return { ok: false, error: `Selection piece ${index} is malformed.` };
    }
    const verseValidation = validateVerse(backbone, {
      book,
      chapter: chapter as number,
      verse: verse as number,
    });
    if (!verseValidation.ok) {
      return { ok: false, error: `Selection piece ${index}: ${verseValidation.error}` };
    }
    normalized.push({
      book,
      chapter: chapter as number,
      verse: verse as number,
      char_start: charStart as number,
      char_end: charEnd as number,
      quote,
    });
  }
  return { ok: true, value: normalized };
}

function occurrenceEvidence(
  packageId: string,
  book: BookCode,
  chapter: number,
  verses: readonly number[],
  cache?: OccurrenceEvidenceCache,
):
  | { ok: true; value: OccurrenceAlignmentVerseEvidence[] }
  | { ok: false; error: { code: string; message: string } } {
  const store = occurrenceAlignmentStore;
  if (!store || packageId !== "bsb") {
    return {
      ok: false,
      error: {
        code: "artifact-missing",
        message: `Exact word projection is not installed for package ${packageId}.`,
      },
    };
  }
  const evidence: OccurrenceAlignmentVerseEvidence[] = [];
  for (const verse of [...new Set(verses)].sort((left, right) => left - right)) {
    const cacheKey = `${packageId}:${book}:${chapter}:${verse}`;
    const cached = cache?.get(cacheKey);
    if (cached) {
      if (!cached.ok) return cached;
      evidence.push(cached.value);
      continue;
    }
    const text = scriptureVerseText(packageId, book, chapter, verse);
    if (text === undefined) {
      const failure = {
        ok: false,
        error: {
          code: "target-text-missing",
          message: `Package ${packageId} has no target text for ${book} ${chapter}:${verse}.`,
        },
      } as const;
      cache?.set(cacheKey, failure);
      return failure;
    }
    const alignment = store.readAlignmentVerse(book, chapter, verse, text);
    if (!alignment.ok) {
      const failure = {
        ok: false,
        error: { code: alignment.error.code, message: alignment.error.message },
      } as const;
      cache?.set(cacheKey, failure);
      return failure;
    }
    const value: OccurrenceAlignmentVerseEvidence = {
      book,
      chapter,
      verse,
      text,
      alignment: alignment.value,
    };
    cache?.set(cacheKey, { ok: true, value });
    evidence.push(value);
  }
  return { ok: true, value: evidence };
}

function unavailableConnectionProjection(
  connectionId: string,
  sourceActiveEventId: string | null,
  packageId: string,
  code: string,
  message: string,
): HostConnectionPaintProjection {
  return {
    connectionId,
    sourceActiveEventId,
    packageId,
    status: "unavailable",
    anchors: [],
    error: { code, message },
  };
}

function projectLegacyConnection(
  connection: Extract<ConnectionRecord, { format_version: 1 }>,
  packageId: string,
): HostConnectionPaintProjection {
  const anchors: HostConnectionPaintAnchor[] = [];
  for (const anchor of connection.anchors) {
    const locator = anchor.render_locator;
    if (
      !locator
      || locator.package !== packageId
      || anchor.verse_start !== anchor.verse_end
    ) {
      return unavailableConnectionProjection(
        connection.id,
        connection.activeEventId,
        packageId,
        "legacy-exact-unavailable",
        "This legacy connection has no exact wording for the selected translation.",
      );
    }
    const text = scriptureVerseText(packageId, anchor.book, anchor.chapter, anchor.verse_start);
    if (
      text === undefined
      || locator.char_start < 0
      || locator.char_end <= locator.char_start
      || locator.char_end > text.length
      || text.slice(locator.char_start, locator.char_end) !== locator.quote
    ) {
      return unavailableConnectionProjection(
        connection.id,
        connection.activeEventId,
        packageId,
        "legacy-locator-stale",
        "This legacy connection's saved wording no longer matches the selected translation.",
      );
    }
    anchors.push({
      book: anchor.book,
      chapter: anchor.chapter,
      verse_start: anchor.verse_start,
      verse_end: anchor.verse_end,
      fragments: [{
        verse: anchor.verse_start,
        char_start: locator.char_start,
        char_end: locator.char_end,
        quote: locator.quote,
      }],
    });
  }
  return {
    connectionId: connection.id,
    sourceActiveEventId: connection.activeEventId,
    packageId,
    status: "legacy-exact",
    anchors,
  };
}

function projectCurrentConnection(
  connection: Extract<ConnectionRecord, { format_version: 2 }>,
  packageId: string,
  evidenceCache?: OccurrenceEvidenceCache,
): HostConnectionPaintProjection {
  const anchors: HostConnectionPaintAnchor[] = [];
  for (const anchor of connection.anchors) {
    const verses = anchor.exact.occurrences.map((occurrence) => occurrence.verse);
    const evidence = occurrenceEvidence(
      packageId,
      anchor.book,
      anchor.chapter,
      verses,
      evidenceCache,
    );
    if (!evidence.ok) {
      return unavailableConnectionProjection(
        connection.id,
        connection.activeEventId,
        packageId,
        evidence.error.code,
        evidence.error.message,
      );
    }
    const projection = projectBackboneTokenAnchor({
      anchor,
      target_package_id: packageId,
      verses: evidence.value,
      sha256: sha256Text,
    });
    if (!projection.ok) {
      return unavailableConnectionProjection(
        connection.id,
        connection.activeEventId,
        packageId,
        projection.error.code,
        projection.error.message,
      );
    }
    anchors.push({
      book: anchor.book,
      chapter: anchor.chapter,
      verse_start: anchor.verse_start,
      verse_end: anchor.verse_end,
      fragments: projection.fragments.map((fragment) => ({ ...fragment })),
    });
  }
  return {
    connectionId: connection.id,
    sourceActiveEventId: connection.activeEventId,
    packageId,
    status: "exact",
    anchors,
  };
}

function projectConnectionRecord(
  connection: ConnectionRecord,
  packageId: string,
  evidenceCache?: OccurrenceEvidenceCache,
): HostConnectionPaintProjection {
  return connection.format_version === 1
    ? projectLegacyConnection(connection, packageId)
    : projectCurrentConnection(connection, packageId, evidenceCache);
}

function getScriptureSearchCorpus(packageId: string): ScriptureSearchDocument[] {
  const libraryRoot = engine?.rootPath ?? "data";
  const cacheKey = `${libraryRoot}:${packageId}`;
  const cached = scriptureSearchCorpusCache.get(cacheKey);
  if (cached) return cached;
  if (!backbone) return [];

  const documents: ScriptureSearchDocument[] = [];
  let order = 0;
  for (const [book, bookData] of Object.entries(backbone.books)) {
    for (let chapter = 1; chapter <= bookData.chapters.length; chapter += 1) {
      const chapterData = readScriptureChapter(packageId, book, chapter);
      for (const verse of chapterData?.verses ?? []) {
        documents.push({ book, chapter, verse: verse.verse, text: verse.text, order });
        order += 1;
      }
    }
  }
  scriptureSearchCorpusCache.set(cacheKey, documents);
  return documents;
}

function addCrossReferencePreviews(
  result: CrossReferenceQueryResult,
  packageId: string,
): CrossReferenceQueryResult {
  return {
    ...result,
    items: result.items.map((item) => {
      const target = parseCrossReferenceKey(item.targetKey);
      if (!target) return item;
      const chapter = readScriptureChapter(packageId, target.start.book, target.start.chapter);
      if (!chapter) return item;
      const finalVerse = target.start.book === target.end.book && target.start.chapter === target.end.chapter
        ? Math.min(target.end.verse, target.start.verse + 1)
        : target.start.verse;
      const preview = chapter.verses
        .filter((verse) => verse.verse >= target.start.verse && verse.verse <= finalVerse)
        .map((verse) => verse.text.trim())
        .filter(Boolean)
        .join(" ")
        .replace(/\s+/g, " ");
      if (!preview) return item;
      return { ...item, preview };
    }),
  };
}

function loadThemes(): ThemeEntry[] {
  const themesPath = resolve(__dirname, "../../data/themes/themes-seed-en.json");
  if (!existsSync(themesPath)) return [];
  return (JSON.parse(readFileSync(themesPath, "utf-8")) as { themes: ThemeEntry[] }).themes;
}

function getLibraryPath(libraryPath?: string): string {
  return libraryPath ?? store.get("libraryPath") ?? process.env["LIBRARY_PATH"] ?? resolve(app.getPath("documents"), "ScriptureLibrary");
}

function createWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    return;
  }
  mainWindow = null;
  const savedBounds = store.get("windowBounds");
  const hasSaneBounds =
    savedBounds != null && savedBounds.width > 0 && savedBounds.height > 0;

  let win: BrowserWindow;
  try {
    win = new BrowserWindow({
      // Canvas. Without it Chromium paints its default white before the
      // renderer's first frame, so every cold start flashes white into an app
      // whose ground is #F1EFEA.
      backgroundColor: "#F1EFEA",
      width: hasSaneBounds ? savedBounds.width : 1400,
      height: hasSaneBounds ? savedBounds.height : 900,
      ...(hasSaneBounds && savedBounds.x != null && savedBounds.y != null
        ? { x: savedBounds.x, y: savedBounds.y }
        : {}),
      minWidth: 900,
      minHeight: 600,
      webPreferences: {
        preload: join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
      titleBarStyle: "hiddenInset",
      title: "Pericope",
    });
  } catch (error) {
    // Keep the visible-window slot empty so a later activation can retry.
    mainWindow = null;
    logLifecycle("main-window-construction-failed", { error: diagnosticError(error) }, "error");
    dialog.showErrorBox(
      "Could not open Pericope",
      `The reading window could not be created.\n\n${diagnosticError(error).message}`,
    );
    // macOS can retry from a later Dock activation. Other platforms have no
    // activation path once their only visible window failed to construct.
    if (process.platform !== "darwin") app.quit();
    return;
  }
  mainWindow = win;
  const closeTarget: MainWindowCloseTarget = {
    window: win,
    windowGeneration: ++windowGeneration,
    guardReady: false,
  };
  mainWindowCloseTarget = closeTarget;

  win.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame && isTrustedRendererUrl(details.url)) return;
    details.preventDefault();
    logLifecycle("renderer-navigation-blocked", {
      target: details.url,
      isMainFrame: details.isMainFrame,
    }, "warn");
  });
  win.webContents.on("will-redirect", (details) => {
    if (details.isMainFrame && isTrustedRendererUrl(details.url)) return;
    details.preventDefault();
    logLifecycle("renderer-redirect-blocked", {
      target: details.url,
      isMainFrame: details.isMainFrame,
    }, "warn");
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    logLifecycle("renderer-window-open-blocked", { target: url }, "warn");
    return { action: "deny" };
  });

  let rendererRecoveryPromptOpen = false;
  win.webContents.on("render-process-gone", (_event, details) => {
    closeTarget.guardReady = false;
    cancelRendererCloseAcknowledgement(closeTarget.windowGeneration);
    const expected = isAppQuitting || details.reason === "clean-exit";
    logLifecycle("main-render-process-gone", {
      reason: details.reason,
      exitCode: details.exitCode,
      expected,
    }, expected ? "info" : "error");
    if (expected || rendererRecoveryPromptOpen || win.isDestroyed()) return;

    rendererRecoveryPromptOpen = true;
    void dialog.showMessageBox(win, {
      type: "error",
      buttons: ["Reload Window", "Quit"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: "The reading window stopped unexpectedly.",
      detail: `Reason: ${details.reason} (exit ${details.exitCode}). Reloading restores the window; unsaved in-memory edits may be lost.`,
    }).then(({ response }) => {
      if (response === 0 && !win.isDestroyed() && !isAppQuitting) {
        // Recovery is explicitly user-directed. Never automatically reload a
        // repeatedly crashing renderer.
        win.reload();
      } else if (!isAppQuitting) {
        app.quit();
      }
    }).catch((error) => {
      logLifecycle("renderer-recovery-dialog-failed", {
        error: diagnosticError(error),
      }, "error");
    }).finally(() => {
      rendererRecoveryPromptOpen = false;
    });
  });
  win.webContents.on("did-fail-load", (
    _event,
    errorCode,
    errorDescription,
    validatedURL,
    isMainFrame,
  ) => {
    if (!isMainFrame) return;
    logLifecycle("main-did-fail-load", {
      errorCode,
      errorDescription,
      target: validatedURL.startsWith("file:") ? "packaged-renderer" : "development-renderer",
    }, errorCode === -3 ? "warn" : "error");
  });
  win.webContents.on("preload-error", (_event, _preloadPath, error) => {
    logLifecycle("main-preload-error", { error: diagnosticError(error) }, "error");
  });
  win.on("unresponsive", () => {
    logLifecycle("main-window-unresponsive", {}, "warn");
  });
  win.on("responsive", () => {
    logLifecycle("main-window-responsive");
  });

  // Browser beforeunload cannot await a custom renderer decision. Keep the
  // native close pending here, then let the renderer resolve the same draft
  // guard used by chapter, view, translation, and library exits.
  let closeRequestPending = false;
  let closeApproved = false;
  win.webContents.on("did-start-loading", () => {
    closeTarget.guardReady = false;
    closeRequestPending = false;
    cancelRendererCloseAcknowledgement(closeTarget.windowGeneration);
  });
  win.on("close", (event) => {
    if (isAppQuitting || closeApproved || !closeTarget.guardReady || win.webContents.isDestroyed()) return;
    event.preventDefault();
    if (closeRequestPending) return;
    closeRequestPending = true;
    void requestRendererCloseAcknowledgement("window")
      .then((approved) => {
        if (!approved || win.isDestroyed() || mainWindowCloseTarget !== closeTarget) return;
        closeApproved = true;
        win.close();
      })
      .finally(() => {
        closeRequestPending = false;
      });
  });

  const developmentUrl = trustedDevelopmentRendererUrl();
  const loadPromise = developmentUrl
    ? win.loadURL(developmentUrl.href)
    : win.loadFile(join(__dirname, "../renderer/index.html"));
  void loadPromise.catch((error) => {
    logLifecycle("main-window-load-rejected", { error: diagnosticError(error) }, "error");
  });

  // Open DevTools in development or when debugging
  if (process.env["SCRIPTURE_DEBUG"] === "1") {
    win.webContents.openDevTools();
  }

  let boundsSaveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    boundsSaveTimer = setTimeout(() => {
      if (!win.isDestroyed()) {
        store.set("windowBounds", win.getBounds());
      }
    }, 500);
  };
  win.on("resize", saveBounds);
  win.on("move", saveBounds);

  win.on("closed", () => {
    cancelRendererCloseAcknowledgement(closeTarget.windowGeneration);
    if (mainWindowCloseTarget === closeTarget) mainWindowCloseTarget = null;
    if (boundsSaveTimer) clearTimeout(boundsSaveTimer);
    if (mainWindow === win) mainWindow = null;
    // Hidden embedding BrowserWindows must not keep a non-macOS application
    // alive after its only user-visible window closes.
    if (process.platform !== "darwin" && !isAppQuitting) app.quit();
  });
}

function validatedResearchUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("Research link must be a URL");
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || !ALLOWED_RESEARCH_LINK_HOSTS.has(parsed.hostname)) {
    throw new Error("This research source is not on the approved external-link list");
  }
  return parsed.toString();
}

function loadCurrentTrustedResourceManifests(): ReturnType<typeof loadTrustedResourceManifests> {
  if (!backbone) {
    return { ok: false, refusal: { code: "read-failed", message: "Scripture backbone is not initialized" } };
  }
  return loadTrustedResourceManifests({
    ...(engine ? { installedRoot: join(engine.rootPath, ".artifacts/resources") } : {}),
    bundledRoot: TRUSTED_RESOURCE_DIR,
    backbone,
  });
}

function validateTrustedResourceOpenRequest(value: unknown): string {
  if (!isRuntimeRecord(value)) throw new Error("Trusted resource link request is invalid");
  const sourceId = value["sourceId"];
  const resourceId = value["resourceId"];
  const requestedUrl = value["url"];
  if (typeof sourceId !== "string" || typeof resourceId !== "string" || typeof requestedUrl !== "string") {
    throw new Error("Trusted resource link request is invalid");
  }
  const loaded = loadCurrentTrustedResourceManifests();
  if (!loaded.ok) throw new Error(loaded.refusal.message);
  const manifest = loaded.manifests.find((entry) => entry.manifest.source.id === sourceId)?.manifest;
  const record = manifest?.records.find((entry) => entry.id === resourceId && entry.officialUrl === requestedUrl);
  if (!manifest || !record) throw new Error("Trusted resource link is not present in a validated local manifest");
  const parsed = new URL(record.officialUrl);
  if (parsed.protocol !== "https:" || !manifest.source.officialHosts.includes(parsed.hostname) || !ALLOWED_TRUSTED_RESOURCE_HOSTS.has(parsed.hostname)) {
    throw new Error("Trusted resource link is not on the approved official-host list");
  }
  return parsed.toString();
}

function languagePackageRoots(libraryPath: string): string[] {
  return [
    join(libraryPath, ".artifacts/scripture/packages"),
    join(DATA_DIR, "packages"),
  ];
}

let stepMorphLoaded = false;

/** Load STEPBible TEGMC/TEHMC once into the shared index (CC BY). */
function loadStepMorphTablesOnce(): void {
  const index = getSharedStepMorphIndex();
  // Retry if a previous attempt left the index empty (missing files, race).
  if (stepMorphLoaded && index.size > 0) return;
  const morphDir = join(DATA_DIR, "morph");
  const greekPath = join(morphDir, "TEGMC-STEPBible-CC-BY.txt");
  const hebrewPath = join(morphDir, "TEHMC-STEPBible-CC-BY.txt");
  try {
    if (existsSync(greekPath)) {
      index.loadTable(readFileSync(greekPath, "utf8"), "STEPBible TEGMC");
    }
    if (existsSync(hebrewPath)) {
      index.loadTable(readFileSync(hebrewPath, "utf8"), "STEPBible TEHMC");
    }
    stepMorphLoaded = index.size > 0;
    console.log(
      `STEP morph overlay: ${index.size} codes` +
        ` (TEGMC ${existsSync(greekPath) ? "ok" : "MISSING"}, TEHMC ${existsSync(hebrewPath) ? "ok" : "MISSING"})` +
        ` dir=${morphDir}`,
    );
  } catch (err) {
    console.warn("STEP morph tables not loaded:", err);
    stepMorphLoaded = false;
  }
}

let tipnrLoaded = false;

/** Load compact TIPNR people/places index (CC BY). */
function loadTipnrIndexOnce(): void {
  const index = getSharedTipnrIndex();
  if (tipnrLoaded && index.loaded) return;
  const path = join(DATA_DIR, "names/tipnr-index.json");
  try {
    if (!existsSync(path)) {
      console.warn(`TIPNR index missing: ${path} (run npx tsx scripts/import-tipnr.ts)`);
      tipnrLoaded = false;
      return;
    }
    const n = index.loadJson(readFileSync(path, "utf8"));
    tipnrLoaded = n > 0;
    console.log(`TIPNR names index: ${n} entities (${path})`);
  } catch (err) {
    console.warn("TIPNR index not loaded:", err);
    tipnrLoaded = false;
  }
}

let hebrewOrbitLoaded = false;

/** MACULA-Hebrew gloss histogram for multi-band Rendering Orbit (CC BY). */
function loadHebrewOrbitIndexOnce(): void {
  const index = getSharedHebrewOrbitIndex();
  if (hebrewOrbitLoaded && index.loaded) return;
  const path = join(DATA_DIR, "lexicons/hebrew-strong-orbit.json");
  try {
    if (!existsSync(path)) {
      console.warn(
        `Hebrew orbit index missing: ${path} (run npm run build:hebrew-orbit)`,
      );
      hebrewOrbitLoaded = false;
      return;
    }
    const n = index.loadJson(readFileSync(path, "utf8"));
    hebrewOrbitLoaded = n > 0;
    console.log(`Hebrew orbit index: ${n} Strong’s keys (${path})`);
  } catch (err) {
    console.warn("Hebrew orbit index not loaded:", err);
    hebrewOrbitLoaded = false;
  }
}

function buildEngineRuntime(
  libraryPathArg?: string,
  autoCreateIfMissing: boolean = true,
): EngineRuntime {
  const nextBackbone = loadBackbone();
  const nextBookNames = loadBookNames();
  const nextCrossRefData = loadCrossRefs();
  const libraryPath = getLibraryPath(libraryPathArg);
  const nextOccurrenceAlignmentStore = new OccurrenceAlignmentStore({
    scriptureRoot: DATA_DIR,
    packageId: "bsb",
  });
  const nextEngine = new LibraryEngine(
    libraryPath,
    nextBackbone,
    nextBookNames,
    nextOccurrenceAlignmentStore,
  );
  const nextRevisionStore = new GitRevisionStore(libraryPath);
  const nextUserMutationBroker = new UserMutationBroker(nextEngine, nextRevisionStore);
  const hebrewGlossPath = join(DATA_DIR, "lexicons/strongs-hebrew-gloss.json");
  const hebrewGlossJson = existsSync(hebrewGlossPath)
    ? readFileSync(hebrewGlossPath, "utf8")
    : undefined;
  const strongDefsPath = join(DATA_DIR, "lexicons/strongs-plus.json");
  const strongDefinitionsJson = existsSync(strongDefsPath)
    ? readFileSync(strongDefsPath, "utf8")
    : undefined;
  const thayerPath = join(DATA_DIR, "lexicons/thayer.json");
  const thayerDefinitionsJson = existsSync(thayerPath)
    ? readFileSync(thayerPath, "utf8")
    : undefined;
  const bdbPath = join(DATA_DIR, "lexicons/bdb-kjv.json");
  const bdbDefinitionsJson = existsSync(bdbPath)
    ? readFileSync(bdbPath, "utf8")
    : undefined;

  // STEP morph overlay (Approach A) — load before any card request.
  loadStepMorphTablesOnce();
  loadTipnrIndexOnce();
  loadHebrewOrbitIndexOnce();
  const nextPlaceResearch = new PlaceResearchLoader();
  if (!nextPlaceResearch.loaded) {
    try {
      const count = nextPlaceResearch.load(join(DATA_DIR, "places"));
      if (count > 0) console.log(`OpenBible place research: ${count} TIPNR identities`);
      else console.warn("OpenBible place research artifact is missing");
    } catch (err) {
      console.warn("OpenBible place research not loaded:", err);
    }
  }

  const pkgRoots = languagePackageRoots(libraryPath);
  const nextReverseIndexes = new ReverseIndexLoader(pkgRoots);
  const nextTokenPackages = new TokenPackageLoader(pkgRoots, {
    hebrewGlossJson,
    strongDefinitionsJson,
    thayerDefinitionsJson,
    bdbDefinitionsJson,
    ensureStepMorph: loadStepMorphTablesOnce,
    reverseIndex: nextReverseIndexes,
  });
  const nextSyntaxTrees = new SyntaxTreeLoader([join(DATA_DIR, "syntax")]);

  let nextEmbeddingsStore: EmbeddingsStore | null = null;
  let nextBudgetManager: BudgetManager | null = null;
  let nextAiProvider: AIProvider | null = null;
  let nextCodexProvider: CodexExecAIProvider | null = null;
  let nextThemes: ThemeEntry[] = [];
  let nextEmbeddingProvider: EmbeddingProvider | null = null;
  let nextJobQueue: JobQueue | null = null;

  try {
    // Ensure library is initialized.
    const manifestPath = join(libraryPath, "config/library-manifest.json");
    const initializationMarker = join(libraryPath, ".scripture-library-initializing");
    const manifestExists = existsSync(manifestPath);
    if (manifestExists) {
      const manifest = nextEngine.readManifest();
      if (!manifest) throw new Error("Library manifest could not be read");
      const migration = checkMigration(manifest, true);
      if (migration.status === "refused" || migration.status === "error") {
        throw new Error(migration.message);
      }
    }
    if (autoCreateIfMissing || manifestExists) {
      if (!manifestExists) {
        mkdirSync(libraryPath, { recursive: true });
        const unexplainedEntries = readdirSync(libraryPath)
          .filter((entry) => entry !== ".DS_Store" && entry !== ".scripture-library-initializing");
        if (unexplainedEntries.length > 0 && !existsSync(initializationMarker)) {
          throw new Error(
            "The selected folder is not empty and is not an unfinished Scripture Library. Choose an empty folder to protect its existing files.",
          );
        }
        if (!existsSync(initializationMarker)) {
          writeFileSync(initializationMarker, JSON.stringify({ version: 1, createdAt: new Date().toISOString() }));
        }
        // The manifest is the atomic commit marker and is published only after
        // every candidate resource below has initialized successfully.
        nextEngine.initLibrary(false);
        nextEngine.installBackboneData(
          join(DATA_DIR, "backbone.json"),
          join(DATA_DIR, "versification"),
        );
        nextRevisionStore.init();
      }

      const dbPath = join(libraryPath, ".system/library.sqlite");
      if (!existsSync(dbPath) || !nextEngine.isConnectionProjectionCurrent()) {
        nextEngine.buildSqlite();
        // One bounded attempt only. If another process appends while the
        // candidate rebuilds, fail closed instead of publishing stale Derived
        // state or entering an unbounded rebuild race.
        if (!nextEngine.isConnectionProjectionCurrent()) {
          throw new Error(
            "Connection Substrate changed during startup rebuild; refusing to publish a stale runtime.",
          );
        }
      }

      // Construct every semantic member locally. Nothing becomes visible to
      // IPC until the complete candidate runtime succeeds.
      nextEmbeddingsStore = new EmbeddingsStore(join(libraryPath, ".system/embeddings.sqlite"));
      nextBudgetManager = new BudgetManager(join(libraryPath, "config"));
      loadEnvFile(resolve(__dirname, "../../.env"));
      nextAiProvider = createDeepSeekProvider(process.env) ?? new MockAIProvider();
      nextCodexProvider = createCodexProvider(process.env);
      nextThemes = loadThemes();
      nextEmbeddingProvider =
        process.env["EMBEDDING_MODEL"] === "mock"
          ? new MockEmbeddingProvider()
          : new RendererEmbeddingProvider({
              htmlPath: join(__dirname, "../embedding-host/index.html"),
              preloadPath: join(__dirname, "embed-preload.cjs"),
              onDiagnostic: (event, details) => {
                const level: DiagnosticLevel = event.includes("gone") || event.includes("fail")
                  ? "error"
                  : "warn";
                logLifecycle(event, details, level);
              },
            });
      nextJobQueue = new JobQueue(nextBudgetManager, nextEmbeddingsStore);
      if (!manifestExists) {
        nextEngine.commitLibraryManifest();
        try {
          unlinkSync(initializationMarker);
        } catch (error) {
          logLifecycle("library-initialization-marker-cleanup-failed", {
            error: diagnosticError(error),
          }, "warn");
        }
      }
    }

    return {
      engine: nextEngine,
      revisionStore: nextRevisionStore,
      userMutationBroker: nextUserMutationBroker,
      occurrenceAlignmentStore: nextOccurrenceAlignmentStore,
      backbone: nextBackbone,
      bookNames: nextBookNames,
      crossRefData: nextCrossRefData,
      embeddingsStore: nextEmbeddingsStore,
      budgetManager: nextBudgetManager,
      aiProvider: nextAiProvider,
      codexProvider: nextCodexProvider,
      themes: nextThemes,
      embeddingProvider: nextEmbeddingProvider,
      jobQueue: nextJobQueue,
      tokenPackages: nextTokenPackages,
      reverseIndexes: nextReverseIndexes,
      syntaxTrees: nextSyntaxTrees,
      placeResearch: nextPlaceResearch,
    };
  } catch (error) {
    nextOccurrenceAlignmentStore.close();
    if (nextEmbeddingProvider instanceof RendererEmbeddingProvider) {
      nextEmbeddingProvider.dispose("Semantic runtime initialization failed");
    }
    if (nextEmbeddingsStore) {
      try {
        nextEmbeddingsStore.close();
      } catch (closeError) {
        logLifecycle("semantic-store-close-failed", {
          reason: "initialization failed",
          error: diagnosticError(closeError),
        }, "error");
      }
    }
    throw error;
  }
}

function initializeEngine(
  libraryPathArg?: string,
  autoCreateIfMissing: boolean = true,
): Promise<void> {
  const run = engineLifecycleTail.then(async () => {
    // Candidate construction is completely off-global. A failure leaves the
    // visible library and every loader/runtime reference untouched.
    const candidate = buildEngineRuntime(libraryPathArg, autoCreateIfMissing);
    const previous = currentRuntime();
    if (!previous) {
      if (libraryPathArg) store.set("libraryPath", libraryPathArg);
      publishRuntime(candidate);
      return;
    }

    const deadline = Date.now() + SWITCH_DRAIN_TIMEOUT_MS;
    freezeRuntimeOperations();
    try {
      const drain = await settleWithin([
        waitForRuntimeIdle(),
        waitForSemanticIdle(),
        ...(previous.jobQueue ? [previous.jobQueue.pauseAndWait()] : []),
      ], Math.max(1, deadline - Date.now()));
      if (!drain.completed || drain.failures.length > 0) {
        throw new Error("Could not switch libraries because active work did not stop safely");
      }

      // Revision receipts belong to the old library. Flush them before its
      // RevisionStore is replaced so no pending authored change is orphaned.
      const flushBudgetMs = Math.max(100, deadline - Date.now());
      const flush = await settleWithin(
        [previous.revisionStore.flush("Switch library", Math.floor(flushBudgetMs / 10))],
        flushBudgetMs,
      );
      if (!flush.completed || flush.failures.length > 0) {
        throw flush.failures[0] ?? new Error("Timed out while saving the current library");
      }

      // Persisting the selected path is part of the commit. It happens while
      // the old runtime is still recoverable and before the no-await publish.
      if (libraryPathArg) store.set("libraryPath", libraryPathArg);
    } catch (error) {
      previous.jobQueue?.resume();
      unfreezeRuntimeOperations(previous);
      disposeSemanticRuntime(candidate, "candidate switch aborted", true);
      throw error;
    }

    // One synchronous turn publishes every candidate member; handlers cannot
    // observe a half-old/half-new runtime.
    publishRuntime(candidate);
    void retireRuntime(previous, "library reinitialize").catch((error) => {
      logLifecycle("runtime-retirement-failed", {
        reason: "library reinitialize",
        error: diagnosticError(error),
      }, "error");
    });
  });
  // Keep later retries possible after a failed initialization while returning
  // the original rejection to the caller that requested this run.
  engineLifecycleTail = run.then(() => undefined, () => undefined);
  return run;
}

async function shutdownRuntimeForQuit(): Promise<void> {
  const runtime = currentRuntime();
  if (!runtime) return;
  const deadline = Date.now() + QUIT_DRAIN_TIMEOUT_MS;
  freezeRuntimeOperations();
  if (runtime.embeddingProvider instanceof RendererEmbeddingProvider) {
    runtime.embeddingProvider.recycle("Embedding runtime stopping: app quit");
  }
  const queueShutdown = runtime.jobQueue?.shutdown();
  void queueShutdown?.catch(() => undefined);
  const runtimeWaits = [
    waitForRuntimeIdle(),
    waitForSemanticIdle(),
    ...(queueShutdown ? [queueShutdown] : []),
  ];

  // Authored mutations have their own lease. A wedged cloud/embedding call
  // must not prevent already-finished user writes from receiving a revision.
  const authoredDrain = await settleWithin(
    [waitForAuthoredIdle()],
    Math.max(1, deadline - Date.now()),
  );
  if (authoredDrain.completed && authoredDrain.failures.length === 0) {
    const flushBudgetMs = Math.max(100, deadline - Date.now());
    const flush = await settleWithin(
      [runtime.revisionStore.flush("Session close", Math.floor(flushBudgetMs / 10))],
      flushBudgetMs,
    );
    if (!flush.completed || flush.failures.length > 0) {
      logLifecycle("revision-flush-failed", {
        reason: "app quit",
        error: diagnosticError(flush.failures[0] ?? new Error("flush deadline exceeded")),
      }, "error");
    }
  } else {
    logLifecycle("authored-runtime-drain-timeout", {
      reason: "app quit",
      activeOperations: authoredOperationCount,
    }, "error");
  }

  const drain = await settleWithin(runtimeWaits, Math.max(1, deadline - Date.now()));
  const drained = drain.completed && drain.failures.length === 0;
  if (!drained) {
    logLifecycle("runtime-drain-timeout", {
      reason: "app quit",
      activeOperations: runtimeOperationCount,
    }, "warn");
  }
  // If a non-cooperative cloud operation exceeded the deadline, keep its
  // SQLite handle open until process exit rather than closing beneath it.
  disposeSemanticRuntime(runtime, "app quit", drained);
  if (!drained && runtime.embeddingsStore) {
    logLifecycle("semantic-store-close-skipped", {
      reason: "app quit drain timeout",
    }, "warn");
  }
}

async function shutdownForQuitDeadline(): Promise<void> {
  const teardown = engineLifecycleTail.then(() => shutdownRuntimeForQuit());
  const bounded = await settleWithin([teardown], QUIT_DRAIN_TIMEOUT_MS);
  if (!bounded.completed) {
    logLifecycle("quit-hard-deadline", {
      timeoutMs: QUIT_DRAIN_TIMEOUT_MS,
      activeOperations: runtimeOperationCount,
    }, "error");
  }
  for (const failure of bounded.failures) {
    logLifecycle("quit-teardown-failed", { error: diagnosticError(failure) }, "error");
  }
}

// --- IPC Handlers ---

function registerIpcHandlers(): void {
  ipcMain.handle("get-library-path", () => {
    return engine?.rootPath ?? getLibraryPath();
  });

  ipcMain.handle("get-library-info", () => {
    if (!engine) return null;
    return {
      path: engine.rootPath,
      hasLibrary: existsSync(join(engine.rootPath, "config/library-manifest.json")),
    };
  });

  ipcMain.handle("reveal-in-finder", () => {
    if (!engine) return { ok: false, error: "Not initialized" };
    shell.showItemInFolder(engine.rootPath);
    return { ok: true };
  });

  ipcMain.handle("get-library-summary", () => {
    if (!engine) return null;
    return engine.getSummary();
  });

  ipcMain.handle("read-all-notes", () => {
    if (!engine) return [];
    return engine.readAllNotes();
  });

  ipcMain.handle("init-library", async (event, libraryPath: unknown) => {
    if (!isTrustedMainRenderer(event)) return { ok: false, error: "Untrusted renderer request was refused" };
    if (typeof libraryPath !== "string" || !libraryPath.trim()) {
      return { ok: false, error: "Library path is required" };
    }
    if (isAppQuitting) return { ok: false, error: "App is quitting" };
    try {
      await initializeEngine(libraryPath);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  ipcMain.handle("resolve-reference", (_event, input: string) => {
    if (!backbone || !bookNames) return { ok: false, error: "Not initialized" };
    if (typeof input !== "string" || !input) return { ok: false, error: "Reference is required" };
    if (input.startsWith("bref:")) {
      return parseBref(input);
    }
    return parseHumanRef(input, bookNames, backbone);
  });

  ipcMain.handle("format-bref", (_event, ref: CanonicalRef) => {
    return toBref(ref);
  });

  ipcMain.handle("format-display", (_event, ref: CanonicalRef) => {
    if (!bookNames) return "";
    return toDisplayString(ref, bookNames);
  });

  ipcMain.handle("get-margin", (_event, query: MarginQuery) => {
    if (!engine || !bookNames) return { notes: [], highlights: [], crossRefs: [], backlinks: [] };
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return { notes: [], highlights: [], crossRefs: [], backlinks: [] };

    const db = new SQLiteMaterializer(dbPath);
    try {
      const result = assembleMargin(query, db, crossRefData, bookNames);
      return result;
    } finally {
      db.close();
    }
  });

  registerRuntimeReadIpc("trusted-resources-query", (_event, input: unknown) => {
    if (!backbone) return { ok: false, refusal: { code: "read-failed", message: "Scripture backbone is not initialized" } };
    const query = validateTrustedResourceQuery(input, backbone);
    if (!query.ok) return { ok: false, refusal: { code: "invalid-query", message: query.error } };
    const loaded = loadCurrentTrustedResourceManifests();
    if (!loaded.ok) return loaded;
    return {
      ok: true,
      resources: rankTrustedResources(loaded.manifests.map((entry) => entry.manifest), query.value),
    };
  });

  registerRuntimeReadIpc("trusted-resource-open", async (_event, input: unknown) => {
    await shell.openExternal(validateTrustedResourceOpenRequest(input));
    return { ok: true as const };
  });

  ipcMain.handle("query-verse", (_event, book: string, chapter: number, verse: number) => {
    if (!engine) return { anchors: [], highlights: [], connections: [], notes: [] };
    return engine.queryVerse(book, chapter, verse);
  });

  ipcMain.handle("query-range", (
    _event,
    startBook: string,
    startCh: number,
    startV: number,
    endBook: string,
    endCh: number,
    endV: number,
  ) => {
    if (!engine || startBook !== endBook) return { anchors: [], highlights: [], connections: [], notes: [] };
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return { anchors: [], highlights: [], connections: [], notes: [] };

    const db = new SQLiteMaterializer(dbPath);
    try {
      const anchors = db.queryAnchorsForRange(startBook, startCh, startV, endCh, endV);
      const highlights = db.queryHighlightsForRange(startBook, startCh, startV, endCh, endV);
      const connectionMap = new Map<string, ConnectionRecord>();
      for (let queryChapter = startCh; queryChapter <= endCh; queryChapter += 1) {
        const verseCount = backbone?.books[startBook]?.chapters[queryChapter - 1] ?? 0;
        const rangeStart = queryChapter === startCh ? startV : 1;
        const rangeEnd = queryChapter === endCh ? endV : verseCount;
        if (rangeEnd < rangeStart) continue;
        for (const connection of engine.queryConnectionsForRange(
          startBook,
          queryChapter,
          rangeStart,
          rangeEnd,
        )) {
          connectionMap.set(connection.id, connection);
        }
      }
      const connections = [...connectionMap.values()];
      const noteIds = new Set<string>();
      for (const anchor of anchors) {
        if (anchor.src_kind === "note") noteIds.add(anchor.src_id);
      }
      const notes = [...noteIds]
        .map((noteId) => db.queryNoteById(noteId))
        .filter((note) => note != null);

      return { anchors, highlights, connections, notes };
    } finally {
      db.close();
    }
  });

  ipcMain.handle("search-notes", (_event, query: string) => {
    if (!engine) return [];
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return [];
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.searchNotes(toFts5PlainQuery(query));
    } finally {
      db.close();
    }
  });

  registerRuntimeIpc("create-note", async (_event, opts: { title: string; body: string; anchorRef?: CanonicalRef; tags?: string[] }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const id = ulid();
    const notePath = engine.createNote(id, opts.title, opts.body, {
      type: "user",
      tags: opts.tags,
    });

    // Track change for git
    const relPath = notePath.replace(engine.rootPath + "/", "");
    const txn = await revisionStore.beginTransaction(`Create note: ${opts.title}`);
    txn.files.push(relPath);
    await revisionStore.commit(txn);

    // Rebuild SQLite
    engine.buildSqlite();

    return { ok: true, noteId: id };
  });

  registerRuntimeIpc("update-note", async (_event, opts: { id: string; title: string; body: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const notePath = engine.updateNote(opts.id, opts.title, opts.body);
    if (!notePath) return { ok: false, error: "Note not found" };
    const relPath = notePath.replace(engine.rootPath + "/", "");
    const txn = await revisionStore.beginTransaction(`Update note: ${opts.title}`);
    txn.files.push(relPath);
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true };
  });

  registerRuntimeIpc("delete-note", async (_event, opts: { id: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const removed = engine.deleteNote(opts.id);
    if (!removed) return { ok: false, error: "Note not found" };
    const relPath = `notes/${removed.filename}`;
    const txn = await revisionStore.beginTransaction("Delete note");
    txn.files.push(relPath);
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true, ...removed };
  });

  registerRuntimeIpc("restore-note", async (_event, opts: { filename: string; content: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const notePath = engine.restoreNote(opts.filename, opts.content);
    if (!notePath) return { ok: false, error: "The note could not be restored" };
    const relPath = notePath.replace(engine.rootPath + "/", "");
    const txn = await revisionStore.beginTransaction("Restore note");
    txn.files.push(relPath);
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true };
  });

  ipcMain.handle("get-all-notes", () => {
    if (!engine) return [];
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return [];
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.getAllNotes();
    } finally {
      db.close();
    }
  });

  ipcMain.handle("get-note", (_event, id: string) => {
    if (!engine) return null;
    const dbPath = join(engine.rootPath, ".system/library.sqlite");
    if (!existsSync(dbPath)) return null;
    const db = new SQLiteMaterializer(dbPath);
    try {
      return db.queryNoteById(id);
    } finally {
      db.close();
    }
  });

  ipcMain.handle("get-backbone", () => {
    return backbone;
  });

  ipcMain.handle("get-book-names", () => {
    return bookNames;
  });

  registerRuntimeIpc("import-obsidian-vault", async (_event, vaultPath: string) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    if (!existsSync(vaultPath)) return { ok: false, error: "Vault path does not exist" };

    // Read all .md files from the vault
    const files: Array<{ path: string; content: string }> = [];
    function readDir(dir: string, prefix: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          readDir(full, rel);
        } else if (entry.name.endsWith(".md")) {
          files.push({ path: rel, content: readFileSync(full, "utf-8") });
        }
      }
    }
    readDir(vaultPath, "");

    const result = importObsidianVault(files, ulid);

    // Write imported notes to the library
    const writtenPaths: string[] = [];
    for (const note of result.notes) {
      const notePath = engine.createNote(note.id, note.title, note.body, { tags: note.tags });
      writtenPaths.push(notePath.replace(engine.rootPath + "/", ""));
    }

    // Track in git
    const txn = await revisionStore.beginTransaction(`Import Obsidian vault: ${result.stats.imported} notes`);
    txn.files.push(...writtenPaths);
    await revisionStore.commit(txn);

    // Rebuild
    engine.buildSqlite();

    return { ok: true, stats: result.stats };
  });

  ipcMain.handle("read-scripture-text", (_event, opts: { book: string; chapter: number; package: string }) => {
    traceStudyWorkspaceQa("chapter", {
      packageId: opts.package,
      book: opts.book,
      chapter: opts.chapter,
    });
    if (!engine) return null;
    return readScriptureChapter(opts.package, opts.book, opts.chapter);
  });

  ipcMain.handle(
    "search-scripture-text",
    (
      _event,
      opts: {
        packageId: string;
        query: string;
        limit?: number;
        currentBook?: string;
        currentChapter?: number;
      },
    ) => searchScriptureDocuments(getScriptureSearchCorpus(opts.packageId), opts.query, {
      limit: opts.limit,
      currentBook: opts.currentBook,
      currentChapter: opts.currentChapter,
    }),
  );

  // --- Original-language token packages (data-first language layer) ---

  ipcMain.handle("language-list-packages", () => {
    return tokenPackages?.listPackages() ?? [];
  });

  ipcMain.handle("language-load-package", (_event, packageId: string) => {
    if (!tokenPackages) return { ok: false, error: "Loader not ready" };
    const ok = tokenPackages.load(packageId);
    return ok
      ? { ok: true, packageId, loaded: true }
      : { ok: false, error: `Package not found or empty: ${packageId}` };
  });

  ipcMain.handle(
    "language-verse-tokens",
    (
      _event,
      opts: { packageId: string; book: string; chapter: number; verse: number },
    ) => {
      if (!tokenPackages) return null;
      return tokenPackages.getVerseTokens(
        opts.packageId,
        opts.book,
        opts.chapter,
        opts.verse,
      );
    },
  );

  ipcMain.handle(
    "language-get-token",
    (_event, opts: { packageId: string; tokenId: string }) => {
      if (!tokenPackages) return null;
      return tokenPackages.getToken(opts.packageId, opts.tokenId);
    },
  );

  ipcMain.handle(
    "language-token-card",
    (
      _event,
      opts: { packageId: string; tokenId: string; readingPackageId?: string },
    ) => {
      if (!tokenPackages) return null;
      return tokenPackages.getTokenCard(opts.packageId, opts.tokenId, {
        readingPackageId: opts.readingPackageId,
      });
    },
  );

  ipcMain.handle(
    "language-has-reverse-index",
    (_event, readingPackageId: string) => {
      return reverseIndexes?.hasIndex(readingPackageId) ?? false;
    },
  );

  ipcMain.handle(
    "language-entities-for-range",
    (_event, opts: { book: string; chapter: number; startVerse: number; endVerse: number }) => {
      const index = getSharedTipnrIndex();
      return {
        entities: index.entitiesForRange(opts.book, opts.chapter, opts.startVerse, opts.endVerse),
        attribution: { name: index.source, license: index.license },
      };
    },
  );

  ipcMain.handle(
    "language-search-entities",
    (_event, opts: { query: string; limit?: number }) => {
      const index = getSharedTipnrIndex();
      return {
        entities: index.search(opts.query, opts.limit),
        attribution: { name: index.source, license: index.license },
      };
    },
  );

  ipcMain.handle(
    "language-entity-research",
    (_event, entityId: string) => {
      traceStudyWorkspaceQa("entity", { entityId });
      const entity = getSharedTipnrIndex().get(entityId);
      if (!entity) return null;
      return placeResearch?.research(entity) ?? {
        entity,
        place: null,
        pleiades: null,
        imageDataUrl: null,
      };
    },
  );

  ipcMain.handle(
    "language-lemma-in-book",
    (_event, opts: { packageId: string; book: string; lemma: string }) => {
      if (!tokenPackages) return null;
      return tokenPackages.getLemmaInBook(opts.packageId, opts.book, opts.lemma);
    },
  );

  ipcMain.handle(
    "language-verse-marks",
    (
      _event,
      opts: { packageId: string; book: string; chapter: number; verse: number },
    ) => {
      if (!tokenPackages) return null;
      return tokenPackages.getMarksForVerse(
        opts.packageId,
        opts.book,
        opts.chapter,
        opts.verse,
      );
    },
  );

  ipcMain.handle(
    "language-syntax-for-token",
    (
      _event,
      opts: { packageId: string; book: string; tokenId: string },
    ) => {
      if (!syntaxTrees) return null;
      // OSHB ids ≠ MACULA Hebrew leaf ids — pass Strong’s / verse for focus match
      const token = tokenPackages?.getToken(opts.packageId, opts.tokenId);
      const ctx = token
        ? {
            chapter: token.chapter,
            verse: token.verse,
            position: token.position,
            strong: token.strong,
            surface: token.surface,
          }
        : null;
      return syntaxTrees.getForToken(opts.packageId, opts.book, opts.tokenId, ctx);
    },
  );

  ipcMain.handle("get-cross-refs-for-passage", (_event, opts: {
    book: string;
    chapter: number;
    startVerse: number;
    endVerse: number;
    packageId: string;
  }) => {
    const query = {
      book: opts.book,
      startChapter: opts.chapter,
      startVerse: opts.startVerse,
      endChapter: opts.chapter,
      endVerse: opts.endVerse,
    };
    if (!bookNames || !crossRefData) return emptyCrossReferenceResult(query, crossRefData);
    return addCrossReferencePreviews(
      queryCrossReferences(crossRefData, query, bookNames),
      opts.packageId,
    );
  });

  registerRuntimeReadIpc("capture-connection-selection", (_event, rawRequest: unknown) => {
    if (!occurrenceAlignmentStore || !backbone) {
      return {
        ok: false,
        status: "refused",
        error: { code: "artifact-missing", message: "Exact-word capture is not initialized." },
      };
    }
    if (
      !isRuntimeRecord(rawRequest)
      || Object.keys(rawRequest).length !== 2
      || !("packageId" in rawRequest)
      || !("selections" in rawRequest)
      || typeof rawRequest["packageId"] !== "string"
      || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(rawRequest["packageId"])
    ) {
      return {
        ok: false,
        status: "refused",
        error: { code: "invalid-selection", message: "Exact-word capture request is invalid." },
      };
    }
    const packageId = rawRequest["packageId"];
    const normalized = normalizeOccurrenceSelections(rawRequest["selections"]);
    if (!normalized.ok) {
      return {
        ok: false,
        status: "refused",
        error: { code: "invalid-selection", message: normalized.error },
      };
    }
    const captureBytes = Buffer.byteLength(JSON.stringify({
      packageId,
      selections: normalized.value,
    }), "utf8");
    if (captureBytes > MAX_CONNECTION_CAPTURE_BYTES) {
      return {
        ok: false,
        status: "refused",
        error: {
          code: "invalid-selection",
          message: `Exact-word capture exceeds the ${MAX_CONNECTION_CAPTURE_BYTES}-byte boundary.`,
        },
      };
    }
    const first = normalized.value[0]!;
    if (normalized.value.some((selection) => (
      selection.book !== first.book || selection.chapter !== first.chapter
    ))) {
      return {
        ok: false,
        status: "refused",
        error: {
          code: "mixed-selection-passage",
          message: "One exact connection phrase cannot cross books or chapters.",
        },
      };
    }
    const evidence = occurrenceEvidence(
      packageId,
      first.book,
      first.chapter,
      normalized.value.map((selection) => selection.verse),
    );
    if (!evidence.ok) {
      return {
        ok: false,
        status: "refused",
        error: { code: evidence.error.code, message: evidence.error.message },
      };
    }
    const capture = captureOccurrenceAlignedSelection({
      package_id: packageId,
      selections: normalized.value,
      verses: evidence.value,
      sha256: sha256Text,
    });
    if (!capture.ok) return capture;
    const projection = projectBackboneTokenAnchor({
      anchor: capture.anchor,
      target_package_id: packageId,
      verses: evidence.value,
      sha256: sha256Text,
    });
    if (!projection.ok) {
      return {
        ok: false,
        status: "refused",
        error: { code: projection.error.code, message: projection.error.message },
      };
    }
    if (!selectionProjectionRoundTrips(normalized.value, projection.fragments)) {
      return {
        ok: false,
        status: "refused",
        error: {
          code: "selection-round-trip-mismatch",
          message: "This translation cannot preserve those exact words yet. Adjust the selection or use a note or wash.",
        },
      };
    }
    return capture;
  }, (message) => ({
    ok: false,
    status: "refused",
    error: { code: "artifact-missing", message },
  }));

  registerRuntimeReadIpc("project-connections", (_event, rawRequest: unknown) => {
    const packageId = isRuntimeRecord(rawRequest) ? rawRequest["packageId"] : undefined;
    const rawConnections = isRuntimeRecord(rawRequest) ? rawRequest["connections"] : undefined;
    if (
      !engine
      || !isRuntimeRecord(rawRequest)
      || Object.keys(rawRequest).length !== 2
      || typeof packageId !== "string"
      || !/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(packageId)
      || !Array.isArray(rawConnections)
      || rawConnections.length > MAX_CONNECTION_PROJECTION_IDS
      || rawConnections.some((request) => (
        !isRuntimeRecord(request)
        || Object.keys(request).length !== 2
        || typeof request["connectionId"] !== "string"
        || request["connectionId"].length === 0
        || request["connectionId"].length > MAX_CONNECTION_ID_LENGTH
        || typeof request["expectedActiveEventId"] !== "string"
        || request["expectedActiveEventId"].length === 0
        || request["expectedActiveEventId"].length > MAX_CONNECTION_ID_LENGTH
      ))
    ) {
      return {
        ok: false,
        packageId: typeof packageId === "string" ? packageId : "",
        projections: [],
        error: {
          code: "invalid-projection-request",
          message: "Connection projection request is invalid.",
        },
      };
    }
    const requests = rawConnections.map((request) => ({
      connectionId: (request as Record<string, unknown>)["connectionId"] as string,
      expectedActiveEventId: (request as Record<string, unknown>)["expectedActiveEventId"] as string,
    }));
    if (new Set(requests.map((request) => request.connectionId)).size !== requests.length) {
      return {
        ok: false,
        packageId,
        projections: [],
        error: {
          code: "duplicate-connection-id",
          message: "Connection projection request contains duplicate ids.",
        },
      };
    }
    try {
      const authoredHeads = new Map(
        engine.queryAuthoredConnectionHeads(requests.map((request) => request.connectionId))
          .map((connection) => [connection.id, connection] as const),
      );
      const evidenceCache: OccurrenceEvidenceCache = new Map();
      const projections = requests.map((request): HostConnectionPaintProjection => {
        const connection = authoredHeads.get(request.connectionId);
        if (!connection) {
          return unavailableConnectionProjection(
            request.connectionId,
            null,
            packageId,
            "connection-missing",
            "The requested connection is no longer active.",
          );
        }
        if (connection.activeEventId !== request.expectedActiveEventId) {
          return unavailableConnectionProjection(
            request.connectionId,
            connection.activeEventId,
            packageId,
            "connection-version-mismatch",
            "The connection changed while its wording was being resolved.",
          );
        }
        return projectConnectionRecord(connection, packageId, evidenceCache);
      });
      return { ok: true, packageId, projections };
    } catch (error) {
      return {
        ok: false,
        packageId,
        projections: [],
        error: {
          code: "authored-projection-refused",
          message: diagnosticError(error).message,
        },
      };
    }
  }, (message, args) => {
    const rawRequest = args[0];
    const packageId = isRuntimeRecord(rawRequest) && typeof rawRequest["packageId"] === "string"
      ? rawRequest["packageId"]
      : "";
    return {
      ok: false,
      packageId,
      projections: [],
      error: { code: "runtime-unavailable", message },
    };
  });

  registerRuntimeIpc("create-connection", async (_event, rawCommand: unknown) => {
    if (!userMutationBroker) return { ok: false, error: "Not initialized" };
    const commandId = isRuntimeRecord(rawCommand) ? rawCommand["commandId"] : undefined;
    try {
      if (!isRuntimeRecord(rawCommand)) throw new Error("Connection create command is invalid.");
      const input = {
        kind: rawCommand["kind"],
        label: rawCommand["label"],
        observation: rawCommand["observation"],
        anchors: rawCommand["anchors"],
      } as CreateConnectionInput;
      const committed = await userMutationBroker.createConnection(
        explicitUserMutationIntent("connection:create", commandId as string),
        input,
      );
      maybeDropQaConnectionResponse("create", commandId as string);
      return {
        ok: true,
        connection: committed.connection,
        ...connectionProjectionWarning("create", commandId, committed.projection, committed.projectionError),
      };
    } catch (error) {
      logLifecycle("connection-mutation-failed", {
        operation: "create",
        commandId: connectionCommandDiagnosticId(commandId),
        error: diagnosticError(error),
      }, "error");
      return { ok: false, error: "Connection save could not be confirmed." };
    }
  });

  registerRuntimeIpc("update-connection", async (_event, rawOptions: unknown) => {
    if (!userMutationBroker) return { ok: false, error: "Not initialized" };
    const commandId = isRuntimeRecord(rawOptions) ? rawOptions["commandId"] : undefined;
    try {
      if (!isRuntimeRecord(rawOptions)) throw new Error("Connection update command is invalid.");
      const connectionId = rawOptions["connectionId"];
      const input = rawOptions["input"] as CreateConnectionInput;
      const expectedBaseEventId = rawOptions["expectedBaseEventId"];
      const committed = await userMutationBroker.updateConnection(
        explicitUserMutationIntent("connection:update", commandId as string),
        connectionId as string,
        input,
        expectedBaseEventId as string,
      );
      maybeDropQaConnectionResponse("update", commandId as string);
      return {
        ok: true,
        connection: committed.connection,
        ...connectionProjectionWarning("update", commandId, committed.projection, committed.projectionError),
      };
    } catch (error) {
      const conflict = error instanceof ConnectionVersionConflictError;
      logLifecycle(conflict ? "connection-mutation-conflict" : "connection-mutation-failed", {
        operation: "update",
        commandId: connectionCommandDiagnosticId(commandId),
        error: diagnosticError(error),
      }, conflict ? "warn" : "error");
      return {
        ok: false,
        ...(conflict ? { conflict: true } : {}),
        error: conflict
          ? "This connection changed elsewhere."
          : "Connection change could not be confirmed.",
      };
    }
  });

  registerRuntimeIpc("delete-connection", async (_event, rawOptions: unknown) => {
    if (!userMutationBroker) return { ok: false, error: "Not initialized" };
    const commandId = isRuntimeRecord(rawOptions) ? rawOptions["commandId"] : undefined;
    try {
      if (!isRuntimeRecord(rawOptions)) throw new Error("Connection delete command is invalid.");
      const connectionId = rawOptions["connectionId"];
      const expectedBaseEventId = rawOptions["expectedBaseEventId"];
      const committed = await userMutationBroker.deleteConnection(
        explicitUserMutationIntent("connection:delete", commandId as string),
        connectionId as string,
        expectedBaseEventId as string,
      );
      maybeDropQaConnectionResponse("delete", commandId as string);
      return {
        ok: true,
        ...connectionProjectionWarning("delete", commandId, committed.projection, committed.projectionError),
      };
    } catch (error) {
      const conflict = error instanceof ConnectionVersionConflictError;
      logLifecycle(conflict ? "connection-mutation-conflict" : "connection-mutation-failed", {
        operation: "delete",
        commandId: connectionCommandDiagnosticId(commandId),
        error: diagnosticError(error),
      }, conflict ? "warn" : "error");
      return {
        ok: false,
        ...(conflict ? { conflict: true } : {}),
        error: conflict
          ? "This connection changed elsewhere."
          : "Connection deletion could not be confirmed.",
      };
    }
  });

  registerRuntimeIpc("create-highlight", async (_event, opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
    package: string;
    charStart?: number | null;
    charEnd?: number | null;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    const incoming: HighlightRange = {
      verseStart: opts.verseStart,
      verseEnd: opts.verseEnd,
      charStart: opts.charStart ?? null,
      charEnd: opts.charEnd ?? null,
    };
    const rangeError = validateHighlightRange(incoming);
    if (rangeError) return { ok: false, error: rangeError };

    const existing = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package);
    const before = existing.filter((highlight) => isHighlightOverlap(highlight, incoming));
    const after: HighlightRecord[] = [];

    // Subtract the incoming range from every highlight underneath it. The
    // first remainder keeps the original entity id; a second remainder gets a
    // fresh id. This preserves untouched outer verses/characters for every
    // single- and multi-verse overlap shape.
    for (const h of before) {
      const remainders = subtractHighlightRange(h, incoming);
      if (remainders.length === 0) {
        engine.applyHighlightDelete(h.id);
        continue;
      }

      const first = rangeRecord(h.id, h, remainders[0]!);
      applyHighlightRecordUpdate(engine, first);
      after.push(first);
      for (const remainder of remainders.slice(1)) {
        const remainderId = engine.applyHighlightCreate(
          h.book,
          h.chapter,
          remainder.verseStart,
          remainder.verseEnd,
          h.color,
          h.package,
          remainder.charStart,
          remainder.charEnd,
        );
        after.push(rangeRecord(remainderId, h, remainder));
      }
    }

    const entityId = engine.applyHighlightCreate(
      opts.book, opts.chapter, opts.verseStart, opts.verseEnd, opts.color, opts.package,
      incoming.charStart, incoming.charEnd,
    );
    after.push({
      id: entityId,
      book: opts.book,
      chapter: opts.chapter,
      verse_start: opts.verseStart,
      verse_end: opts.verseEnd,
      package: opts.package,
      char_start: incoming.charStart,
      char_end: incoming.charEnd,
      color: opts.color,
      kind: "highlight",
      note_id: null,
      deleted: 0,
    });
    const changeId = rememberHighlightChange(before, after);

    const txn = await revisionStore.beginTransaction("Create highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    return { ok: true, highlightId: entityId, changeId };
  });

  registerRuntimeIpc("erase-highlight-range", async (_event, opts: {
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    package: string;
    charStart?: number | null;
    charEnd?: number | null;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const incoming: HighlightRange = {
      verseStart: opts.verseStart,
      verseEnd: opts.verseEnd,
      charStart: opts.charStart ?? null,
      charEnd: opts.charEnd ?? null,
    };
    const rangeError = validateHighlightRange(incoming);
    if (rangeError) return { ok: false, error: rangeError };

    const existing = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package);
    const before = existing.filter((highlight) => isHighlightOverlap(highlight, incoming));
    if (before.length === 0) return { ok: true };
    const after: HighlightRecord[] = [];

    for (const h of before) {
      const remainders = subtractHighlightRange(h, incoming);
      if (remainders.length === 0) {
        engine.applyHighlightDelete(h.id);
        continue;
      }
      const first = rangeRecord(h.id, h, remainders[0]!);
      applyHighlightRecordUpdate(engine, first);
      after.push(first);
      for (const remainder of remainders.slice(1)) {
        const id = engine.applyHighlightCreate(
          h.book,
          h.chapter,
          remainder.verseStart,
          remainder.verseEnd,
          h.color,
          h.package,
          remainder.charStart,
          remainder.charEnd,
        );
        after.push(rangeRecord(id, h, remainder));
      }
    }

    const changeId = rememberHighlightChange(before, after);
    const txn = await revisionStore.beginTransaction("Erase highlight range");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  registerRuntimeIpc("recolor-highlights", async (_event, opts: {
    book: string;
    chapter: number;
    package: string;
    entityIds: string[];
    color: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const ids = new Set(opts.entityIds);
    const before = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package)
      .filter((highlight) => ids.has(highlight.id));
    if (before.length === 0) return { ok: false, error: "Highlights no longer exist" };

    const after = before.map((highlight) => ({ ...highlight, color: opts.color, deleted: 0 }));
    for (const highlight of after) applyHighlightRecordUpdate(engine, highlight);
    const changeId = rememberHighlightChange(before, after);
    const txn = await revisionStore.beginTransaction("Recolor highlights");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  registerRuntimeIpc("delete-highlights", async (_event, opts: {
    book: string;
    chapter: number;
    package: string;
    entityIds: string[];
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const ids = new Set(opts.entityIds);
    const before = engine.queryHighlightsForChapter(opts.book, opts.chapter, opts.package)
      .filter((highlight) => ids.has(highlight.id));
    if (before.length === 0) return { ok: false, error: "Highlights no longer exist" };
    for (const highlight of before) engine.applyHighlightDelete(highlight.id);
    const changeId = rememberHighlightChange(before, []);
    const txn = await revisionStore.beginTransaction("Delete highlights");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true, changeId };
  });

  registerRuntimeIpc("undo-highlight-change", async (_event, changeId: string) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const change = highlightChanges.get(changeId);
    if (!change) return { ok: false, error: "This highlight change can no longer be undone" };

    const relevant = [...change.before, ...change.after];
    const currentById = new Map<string, HighlightRecord>();
    const queried = new Set<string>();
    for (const record of relevant) {
      const key = `${record.book}\u0000${record.chapter}\u0000${record.package}`;
      if (queried.has(key)) continue;
      queried.add(key);
      for (const current of engine.queryHighlightsForChapter(record.book, record.chapter, record.package)) {
        currentById.set(current.id, current);
      }
    }

    const afterIds = new Set(change.after.map((record) => record.id));
    const beforeIds = new Set(change.before.map((record) => record.id));
    const afterStillCurrent = change.after.every((record) => highlightRecordMatches(currentById.get(record.id), record));
    const deletedBeforeStillAbsent = change.before
      .filter((record) => !afterIds.has(record.id))
      .every((record) => !currentById.has(record.id));
    if (!afterStillCurrent || !deletedBeforeStillAbsent) {
      return { ok: false, error: "That highlight changed again, so the older Undo was not applied" };
    }

    for (const record of change.after) {
      if (!beforeIds.has(record.id)) engine.applyHighlightDelete(record.id);
    }
    for (const record of change.before) {
      if (afterIds.has(record.id)) applyHighlightRecordUpdate(engine, record);
      else engine.applyHighlightRestore(record);
    }

    highlightChanges.delete(changeId);
    const txn = await revisionStore.beginTransaction("Undo highlight change");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    return { ok: true };
  });

  registerRuntimeIpc("delete-highlight", async (_event, opts: { entityId: string; baseEventId: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };

    engine.applyHighlightDelete(opts.entityId, opts.baseEventId);

    const txn = await revisionStore.beginTransaction("Delete highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);

    return { ok: true };
  });

  ipcMain.handle("rebuild-sqlite", () => {
    if (!engine) return null;
    return engine.buildSqlite();
  });

  const readSettings = () => {
    const current = store.store;
    const workspaceBootstrap = bootstrapStudyWorkspaceSetting({
      hasStudyWorkspaceKey: Object.prototype.hasOwnProperty.call(current, "studyWorkspace"),
      studyWorkspace: current.studyWorkspace,
      researchWorkspace: current.researchWorkspace,
      researchSession: current.researchSession,
      lastRead: current.lastRead,
      keptContext: current.keptContext,
    });
    if (workspaceBootstrap.write) store.set({ ...current, ...workspaceBootstrap.write });
    const settled = store.store;
    return {
      ...settled,
      theme: normalizeTheme(settled.theme),
      material: normalizeMaterial(settled.material, settled.theme),
      markingSurface: normalizeMarkingSurface(settled.markingSurface),
      lastRead: normalizeLastRead(settled.lastRead),
      researchSession: normalizeResearchSession(settled.researchSession),
      researchWorkspace: normalizeResearchWorkspace(settled.researchWorkspace),
      keptContext: normalizeKeptContext(settled.keptContext),
      studyWorkspace: workspaceBootstrap.studyWorkspace,
      ...(workspaceBootstrap.studyWorkspaceRefusal
        ? { studyWorkspaceRefusal: workspaceBootstrap.studyWorkspaceRefusal }
        : {}),
    };
  };

  ipcMain.handle("settings:get", readSettings);

  ipcMain.handle("settings:set", (_event, partial: Partial<AppSettingsSchema>) => {
    const hasLastRead = Object.prototype.hasOwnProperty.call(partial, "lastRead");
    const hasResearchSession = Object.prototype.hasOwnProperty.call(partial, "researchSession");
    const hasResearchWorkspace = Object.prototype.hasOwnProperty.call(partial, "researchWorkspace");
    const hasKeptContext = Object.prototype.hasOwnProperty.call(partial, "keptContext");
    const hasStudyWorkspace = Object.prototype.hasOwnProperty.call(partial, "studyWorkspace");
    const hasCurrentStudyWorkspace = Object.prototype.hasOwnProperty.call(
      store.store,
      "studyWorkspace",
    );
    const mergedStudyWorkspace = mergeRawStudyWorkspaceSetting(
      store.store.studyWorkspace,
      partial.studyWorkspace,
      hasStudyWorkspace,
    );
    const sanitizedPartial = { ...partial };
    delete sanitizedPartial.studyWorkspace;
    store.set({
      ...store.store,
      ...sanitizedPartial,
      theme: normalizeTheme(partial.theme ?? store.store.theme),
      material: normalizeMaterial(
        partial.material ?? store.store.material,
        partial.theme ?? store.store.theme,
      ),
      markingSurface: normalizeMarkingSurface(partial.markingSurface ?? store.store.markingSurface),
      lastRead: normalizeLastRead(hasLastRead ? partial.lastRead : store.store.lastRead),
      researchSession: normalizeResearchSession(
        hasResearchSession ? partial.researchSession : store.store.researchSession,
      ),
      researchWorkspace: normalizeResearchWorkspace(
        hasResearchWorkspace ? partial.researchWorkspace : store.store.researchWorkspace,
      ),
      keptContext: normalizeKeptContext(hasKeptContext ? partial.keptContext : store.store.keptContext),
      ...(hasStudyWorkspace || hasCurrentStudyWorkspace
        ? mergedStudyWorkspace === undefined
          ? {}
          : { studyWorkspace: mergedStudyWorkspace }
        : {}),
    });
    return readSettings();
  });

  ipcMain.handle("dialog-open-directory", async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory"],
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });

  ipcMain.handle("open-external-research-url", async (_event, value: unknown) => {
    await shell.openExternal(validatedResearchUrl(value));
    return { ok: true as const };
  });

  // --- M3: Semantic Intelligence ---

  ipcMain.handle("embed-notes", async () => {
    return withSemanticOperation(
      { ok: false, error: "Semantic runtime is restarting" },
      async () => {
        const currentEngine = engine;
        const currentStore = embeddingsStore;
        const currentProvider = embeddingProvider;
        const currentThemes = themes;
        if (!currentEngine || !currentStore || !currentProvider) {
          return { ok: false, error: "Not initialized" };
        }
        const dbPath = join(currentEngine.rootPath, ".system/library.sqlite");
        const db = new SQLiteMaterializer(dbPath);
        try {
          const result = await embedAllNotes(db, currentStore, currentProvider, currentThemes);
          return { ok: true, ...result };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
          db.close();
        }
      },
    );
  });

  // --- B3.6: capture-time note enrichment ---

  /** Enrichment tier stack honoring the budget envelope (INV-16). */
  function enrichmentTiers(): EnrichTier[] {
    if (!budgetManager || budgetManager.get().backgroundAI !== "cloud") return [];
    const tiers: EnrichTier[] = [];
    if (codexProvider) tiers.push({ provider: codexProvider, modelId: `codex-${codexProvider.model}` });
    if (aiProvider && aiProvider instanceof OpenAICompatibleAIProvider) {
      tiers.push({ provider: aiProvider, modelId: aiProvider.model });
    }
    return tiers;
  }

  ipcMain.handle("enrich-note", async (_event, opts: { noteId: string }) => {
    return withSemanticOperation(
      { ok: false, error: "Semantic runtime is restarting" },
      async () => {
        const currentEngine = engine;
        const currentStore = embeddingsStore;
        const currentBackbone = backbone;
        const currentBookNames = bookNames;
        const currentProvider = embeddingProvider;
        const currentThemes = themes;
        if (!currentEngine || !currentStore || !currentBackbone || !currentBookNames || !currentProvider) {
          return { ok: false, error: "Not initialized" };
        }
        const tiers = enrichmentTiers();
        if (tiers.length === 0) {
          return { ok: false, error: "background AI is off (budget envelope) or no provider configured" };
        }
        const dbPath = join(currentEngine.rootPath, ".system/library.sqlite");
        const db = new SQLiteMaterializer(dbPath);
        try {
          const note = db.queryNoteById(opts.noteId);
          if (!note) return { ok: false, error: "note not found" };
          await enrichAllNotes({
            notes: [{ id: note.id, title: note.title, body_text: note.body_text }],
            store: currentStore,
            backbone: currentBackbone,
            themes: currentThemes,
            tiers,
          });
          // Re-embed so the expansion chunk participates in retrieval immediately.
          await embedAllNotes(db, currentStore, currentProvider, currentThemes);
          return {
            ok: true,
            ...getEnrichmentSuggestions(opts.noteId, currentStore, currentBookNames),
          };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        } finally {
          db.close();
        }
      },
    );
  });

  /** Suggestions = inferred refs minus feedback, healed by prior confirms, display-ready. */
  function getEnrichmentSuggestions(
    noteId: string,
    storeOverride: EmbeddingsStore | null = embeddingsStore,
    bookNamesOverride: BookNameMap | null = bookNames,
  ): {
    enriched: boolean;
    noScriptureIntent: boolean;
    suggestions: { refKey: string; display: string; bref: string; healed: boolean }[];
  } {
    if (!storeOverride || !bookNamesOverride) {
      return { enriched: false, noScriptureIntent: false, suggestions: [] };
    }
    const enrichment = storeOverride.getEnrichment(noteId);
    if (!enrichment) return { enriched: false, noScriptureIntent: false, suggestions: [] };
    const feedback = new Set(storeOverride.getEnrichmentFeedback(noteId).map((f) => f.refKey));

    // E5 healing: passages the user confirmed on theme-sharing notes lead.
    const allEnrichments = storeOverride.getAllEnrichments();
    const { suggestions: ordered, healedKeys } = healSuggestionOrder({
      noteThemes: enrichment.themes,
      suggestions: enrichment.inferredRefs.filter((r) => !feedback.has(inferredRefKey(r))),
      confirmations: storeOverride
        .getAllEnrichmentFeedback()
        .filter((f) => f.action === "confirmed" && f.noteId !== noteId)
        .map((f) => ({ noteId: f.noteId, refKey: f.refKey })),
      themesByNote: new Map(allEnrichments.map((e) => [e.noteId, e.themes])),
    });

    const suggestions = ordered.map((r) => {
      const name = bookNamesOverride[r.book]?.[0] ?? r.book;
      const display =
        r.verseStart !== undefined
          ? `${name} ${r.chapter}:${r.verseStart}${r.verseEnd && r.verseEnd !== r.verseStart ? `–${r.verseEnd}` : ""}`
          : `${name} ${r.chapter}`;
      const bref =
        r.verseStart !== undefined
          ? `bref:v1/${r.book}.${r.chapter}.${r.verseStart}`
          : `bref:v1/${r.book}.${r.chapter}.1`;
      return { refKey: inferredRefKey(r), display, bref, healed: healedKeys.has(inferredRefKey(r)) };
    });
    return { enriched: true, noScriptureIntent: enrichment.noScriptureIntent, suggestions };
  }

  ipcMain.handle("get-enrichment", (_event, opts: { noteId: string }) => {
    if (!embeddingsStore) return { enriched: false, noScriptureIntent: false, suggestions: [] };
    return getEnrichmentSuggestions(opts.noteId);
  });

  registerRuntimeIpc(
    "enrichment-feedback",
    async (_event, opts: { noteId: string; refKey: string; action: "confirmed" | "dismissed"; refDisplay?: string }) => {
      return withSemanticOperation(
        { ok: false, error: "Semantic runtime is restarting" },
        async () => {
          const currentEngine = engine;
          const currentStore = embeddingsStore;
          const currentRevisionStore = revisionStore;
          if (!currentEngine || !currentStore || !currentRevisionStore) {
            return { ok: false, error: "Not initialized" };
          }
          currentStore.setEnrichmentFeedback({
            noteId: opts.noteId,
            refKey: opts.refKey,
            action: opts.action,
            created: new Date().toISOString(),
          });
          if (opts.action === "confirmed" && opts.refDisplay) {
            // Confirmation is a USER action: the ref is appended to the note
            // body (the file is authoritative, INV-11) and becomes a real,
            // full-strength anchor on the next index pass. INV-1 satisfied:
            // the write happens only on this explicit user action.
            const parsed = currentEngine.readAllNotes().find((n) => n.frontmatter.id === opts.noteId);
            if (!parsed) return { ok: false, error: "note not found" };
            const newBody = `${parsed.body.trimEnd()}\n\nRelated: ${opts.refDisplay}\n`;
            const notePath = currentEngine.createNote(opts.noteId, parsed.frontmatter.title, newBody, {
              type: parsed.frontmatter.type ?? "user",
              tags: parsed.frontmatter.tags,
            });
            const relPath = notePath.replace(currentEngine.rootPath + "/", "");
            const txn = await currentRevisionStore.beginTransaction(`Anchor note to ${opts.refDisplay}`);
            txn.files.push(relPath);
            await currentRevisionStore.commit(txn);
            currentEngine.buildSqlite();
          }
          return { ok: true };
        },
      );
    },
  );

  // A-5: unanchor is one tap, symmetrical with anchor. Removes the appended
  // "Related: <ref>" line and clears the feedback record (the suggestion may
  // return; the user changed their mind, they didn't dismiss the idea).
  registerRuntimeIpc(
    "unanchor-note-ref",
    async (_event, opts: { noteId: string; refKey: string; refDisplay: string }) => {
      return withSemanticOperation(
        { ok: false, error: "Semantic runtime is restarting" },
        async () => {
          const currentEngine = engine;
          const currentStore = embeddingsStore;
          const currentRevisionStore = revisionStore;
          if (!currentEngine || !currentStore || !currentRevisionStore) {
            return { ok: false, error: "Not initialized" };
          }
          const parsed = currentEngine.readAllNotes().find((n) => n.frontmatter.id === opts.noteId);
          if (!parsed) return { ok: false, error: "note not found" };
          const line = `Related: ${opts.refDisplay}`;
          const newBody = parsed.body
            .split("\n")
            .filter((l) => l.trim() !== line)
            .join("\n")
            .replace(/\n{3,}/g, "\n\n");
          const notePath = currentEngine.createNote(opts.noteId, parsed.frontmatter.title, newBody, {
            type: parsed.frontmatter.type ?? "user",
            tags: parsed.frontmatter.tags,
          });
          const relPath = notePath.replace(currentEngine.rootPath + "/", "");
          const txn = await currentRevisionStore.beginTransaction(`Unanchor note from ${opts.refDisplay}`);
          txn.files.push(relPath);
          await currentRevisionStore.commit(txn);
          currentEngine.buildSqlite();
          currentStore.deleteEnrichmentFeedback(opts.noteId, opts.refKey);
          return { ok: true };
        },
      );
    },
  );

  ipcMain.handle("semantic-margin", async (_event, opts: {
    book: string;
    startChapter: number;
    startVerse: number;
    endChapter: number;
    endVerse: number;
    passageText: string;
  }) => {
    return withSemanticOperation(null, async () => {
      const currentEngine = engine;
      const currentStore = embeddingsStore;
      const currentProvider = embeddingProvider;
      const currentBookNames = bookNames;
      const currentCrossRefData = crossRefData;
      const currentThemes = themes;
      if (!currentEngine || !currentStore || !currentBookNames || !currentProvider) return null;
      const dbPath = join(currentEngine.rootPath, ".system/library.sqlite");
      const db = new SQLiteMaterializer(dbPath);
      try {
        // B3.5: one shared code path (host runner) for the IPC handler, the
        // eval harness, and smoke scripts — hybrid retrieval with the
        // calibrated quality bar lives in core, wiring lives in the runner.
        return await runSemanticMargin({
          db,
          embeddingsStore: currentStore,
          provider: currentProvider,
          crossRefData: currentCrossRefData,
          bookNames: currentBookNames,
          themes: currentThemes,
          request: opts,
        });
      } finally {
        db.close();
      }
    });
  });

  registerRuntimeIpc("pin-claim", async (_event, opts: { claimId: string; assertion: string; userNote?: string }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const factId = engine.pinClaim(opts.claimId, opts.assertion, opts.userNote);
    const txn = await revisionStore.beginTransaction("Pin claim → FactCard");
    txn.files.push("annotations/pinned-facts.jsonl");
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true, factId };
  });

  registerRuntimeIpc("promote-overlay", async (_event, opts: {
    overlayId: string;
    book: string;
    chapter: number;
    verseStart: number;
    verseEnd: number;
    color: string;
  }) => {
    if (!engine || !revisionStore) return { ok: false, error: "Not initialized" };
    const hlId = engine.promoteOverlay(opts.overlayId, opts.book, opts.chapter, opts.verseStart, opts.verseEnd, opts.color);
    const txn = await revisionStore.beginTransaction("Promote overlay → highlight");
    txn.files.push("annotations/highlights.jsonl");
    await revisionStore.commit(txn);
    engine.buildSqlite();
    return { ok: true, highlightId: hlId };
  });

  ipcMain.handle("insert-claim", (_event, opts: {
    id: string;
    assertion: string;
    claimType: string;
    confidence: number;
    extractor: string;
    anchors: { book: string; chapter: number; verse: number }[];
    sources: { kind: string; ref: string }[];
  }) => {
    if (!embeddingsStore) return { ok: false, error: "Not initialized" };
    // B-1: claims live in the persistent AI-derived store (embeddings.sqlite),
    // not library.sqlite — the materialized view is wiped on every note save.
    embeddingsStore.insertClaim({
      id: opts.id,
      assertion: opts.assertion,
      claim_type: opts.claimType,
      confidence: opts.confidence,
      extractor: opts.extractor,
      created: new Date().toISOString(),
      status: "active",
    });
    for (const a of opts.anchors) {
      embeddingsStore.insertClaimAnchor({ claim_id: opts.id, book: a.book, chapter: a.chapter, verse: a.verse });
    }
    for (const s of opts.sources) {
      embeddingsStore.insertClaimSource({ claim_id: opts.id, kind: s.kind, ref: s.ref });
    }
    return { ok: true };
  });

  ipcMain.handle("insert-overlay", (_event, opts: {
    id: string;
    book: string;
    chapter: number;
    verse: number;
    charStart: number;
    charEnd: number;
    reason: string;
    extractor: string;
  }) => {
    if (!engine) return { ok: false, error: "Not initialized" };
    engine.insertOverlay(opts);
    return { ok: true };
  });

  ipcMain.handle("get-budget-envelope", () => {
    if (!budgetManager) return null;
    return { envelope: budgetManager.get(), usage: budgetManager.getUsage() };
  });

  ipcMain.handle("set-budget-envelope", (_event, opts: { backgroundAI: string; networkBackground: boolean; dailyTokenCeiling?: number }) => {
    if (!budgetManager) return { ok: false, error: "Not initialized" };
    budgetManager.update({
      backgroundAI: opts.backgroundAI as "off" | "local-only" | "cloud",
      networkBackground: opts.networkBackground,
      dailyTokenCeiling: opts.dailyTokenCeiling,
    });
    return { ok: true };
  });

  ipcMain.handle("get-ai-jobs", () => {
    if (!embeddingsStore) return [];
    return embeddingsStore.getRecentJobs();
  });

  ipcMain.handle("get-all-facts", () => {
    if (!engine) return [];
    return engine.getAllFacts();
  });

  ipcMain.handle("ai-invoke", async (_event, opts: { prompt: string; context?: string }) => {
    return withSemanticOperation(
      { ok: false, error: "Semantic runtime is restarting" },
      async () => {
        const currentAiProvider = aiProvider;
        const currentBudgetManager = budgetManager;
        if (!currentAiProvider || !currentBudgetManager) {
          return { ok: false, error: "AI not initialized" };
        }
        if (!currentBudgetManager.canSpend(1000)) return { ok: false, error: "Budget exceeded" };
        const resp = await currentAiProvider.invoke({ prompt: opts.prompt, context: opts.context });
        currentBudgetManager.recordSpend(resp.tokensUsed);
        return { ok: true, text: resp.text, tokensUsed: resp.tokensUsed };
      },
    );
  });

  ipcMain.handle("get-ai-status", () => {
    if (!budgetManager) return null;
    const isReal = aiProvider instanceof OpenAICompatibleAIProvider;
    return {
      aiAllowed: budgetManager.isAIAllowed(),
      networkAllowed: budgetManager.isNetworkAllowed(),
      usage: budgetManager.getUsage(),
      provider: isReal ? "deepseek" : "mock",
      model: isReal ? (aiProvider as OpenAICompatibleAIProvider).model : null,
      embeddingModel: embeddingProvider?.modelId ?? null,
    };
  });

  ipcMain.handle("enqueue-ai-job", (_event, opts: { kind: string }) => {
    if (!jobQueue || !aiProvider) return { ok: false, error: "Not initialized" };
    const currentQueue = jobQueue;
    const currentAiProvider = aiProvider;
    try {
      const jobId = currentQueue.enqueue(opts.kind as "embed-notes" | "semantic-resurface" | "extract-claims" | "suggest-xrefs" | "generate-thread", async () => {
        const resp = await currentAiProvider.invoke({ prompt: `Job: ${opts.kind}` });
        return { tokensUsed: resp.tokensUsed, error: null };
      });
      return { ok: true, jobId };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}

/**
 * Native module ABI guard (Task A1).
 *
 * `better-sqlite3` is a native addon whose binary is compiled for one
 * Node/Electron ABI at a time. Electron 35 uses ABI 133; Node 24 uses ABI 137.
 * If the binary was rebuilt for Node-side verification, launching Electron
 * crashes deep inside `initializeEngine` with an opaque ERR_DLOPEN_FAILED.
 * This probe surfaces the failure as a visible dialog with an actionable
 * command before any library work begins.
 */
async function probeNativeModule(): Promise<boolean> {
  try {
    const require_ = createRequire(import.meta.url);
    const Database = require_("better-sqlite3") as new (path: string) => { exec: (s: string) => void; close: () => void };
    const db = new Database(":memory:");
    db.exec("CREATE TABLE preflight_probe (x INTEGER)");
    db.close();
    return true;
  } catch (err) {
    const detail = String((err as Error)?.message ?? err).split("\n").slice(0, 4).join("\n");
    dialog.showErrorBox(
      "Native module ABI mismatch",
      "better-sqlite3 could not be loaded by this Electron runtime.\n\n" +
        "This usually means the native binary was rebuilt for Node-side\n" +
        "verification (ABI 137) instead of Electron (ABI 133).\n\n" +
        "Fix: run  npm run rebuild:electron\n" +
        "Then re-launch the app.\n\n" +
        "Underlying error:\n" + detail,
    );
    app.quit();
    return false;
  }
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  logLifecycle("second-instance-refused");
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      if (app.isReady()) createWindow();
      return;
    }
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
    if (!(await probeNativeModule())) return;
    try {
      // Only skip auto-create (and let the renderer show the Welcome screen)
      // on a genuinely first-ever launch — once the user has confirmed ANY
      // location (default or custom), store.get("libraryPath") is set and we
      // treat that as "already onboarded", auto-creating there if its files
      // were somehow removed rather than reverting to first-run.
      await initializeEngine(undefined, store.get("libraryPath") != null);
    } catch (err) {
      const detail = String((err as Error)?.message ?? err);
      dialog.showErrorBox(
        "Failed to initialize library",
        "The library engine could not start.\n\n" +
          "Underlying error:\n" + detail,
      );
      app.quit();
      return;
    }
    registerIpcHandlers();
    createWindow();
  }).catch((error) => {
    logLifecycle("startup-failed", { error: diagnosticError(error) }, "error");
    dialog.showErrorBox(
      "Failed to start Pericope",
      `The desktop shell could not finish starting.\n\n${diagnosticError(error).message}`,
    );
    app.quit();
  });
}

let quitTeardownStarted = false;
let quitTeardownComplete = false;
let quitApprovalPending = false;
let quitApproved = false;
app.on("before-quit", (event) => {
  if (quitTeardownComplete) return;
  event.preventDefault();
  if (quitApprovalPending || quitTeardownStarted) return;
  if (quitApproved) return;
  quitApprovalPending = true;

  void requestRendererCloseAcknowledgement("quit").then((approved) => {
    quitApprovalPending = false;
    if (!approved) return;
    quitApproved = true;
    isAppQuitting = true;
    quitTeardownStarted = true;

    return shutdownForQuitDeadline()
      .catch((error) => {
        logLifecycle("quit-teardown-failed", { error: diagnosticError(error) }, "error");
      })
      .finally(() => {
        quitTeardownComplete = true;
        logLifecycle("session-end");
        // A second app.quit() issued from an asynchronously prevented
        // before-quit cycle is ignored by Electron on macOS. Cleanup is now
        // complete, so exit without re-entering that lifecycle event.
        app.exit(0);
      });
  });
});

app.on("window-all-closed", () => {
  // This is only a fallback: the hidden embedding host may keep this event
  // from firing, so the visible window's `closed` handler owns non-mac quit.
  if (process.platform !== "darwin" && !mainWindow) {
    app.quit();
  }
});

app.on("activate", () => {
  if (!isAppQuitting && (!mainWindow || mainWindow.isDestroyed())) {
    createWindow();
  }
});
