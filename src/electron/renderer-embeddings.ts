/**
 * Hidden-renderer embedding provider — Electron shell layer.
 *
 * Electron's V8 memory cage (v21+) crashes onnxruntime-node in every
 * Node-side context (main / worker_threads / utilityProcess / run-as-node —
 * all verified SIGTRAP 2026-07-02). A hidden renderer sidesteps it entirely:
 * transformers.js resolves its browser build there and runs onnxruntime-web
 * (WASM) — no native buffers, compute isolated from the main process, and a
 * renderer crash never takes the app down (we just respawn lazily).
 *
 * Model + WASM artifacts are fetched by the renderer and cached in the
 * session's Cache API storage (userData partition) after first download.
 */

import { BrowserWindow, ipcMain, type Event as ElectronEvent, type IpcMainEvent } from "electron";
import { randomUUID } from "node:crypto";
import type { EmbeddingKind, EmbeddingProvider } from "../core/interfaces.js";
import { DEFAULT_MODEL_ID } from "../host/local-embeddings.js";

type HostIdentity = {
  protocolVersion: 1;
  providerNonce: string;
  generation: number;
  requestNonce: string;
  id: number;
};
type HostResponse =
  | (HostIdentity & { ok: true; rows: number; dim: number; vectors: ArrayBuffer[] })
  | (HostIdentity & { ok: false; error: string });

export type RendererEmbeddingOptions = {
  /** Absolute path to the embedding host html (dist/embedding-host/index.html). */
  htmlPath: string;
  /** Absolute path to the compiled preload (dist/electron/embed-preload.cjs). */
  preloadPath: string;
  modelId?: string;
  /** Bound a wedged renderer request so shutdown cannot wait forever. */
  requestTimeoutMs?: number;
  /** Bound preload/module startup so a broken host fails before inference. */
  startupTimeoutMs?: number;
  /** Shell-owned lifecycle diagnostics; must not include authored content. */
  onDiagnostic?: (event: string, details: Record<string, string | number | boolean>) => void;
};

type Pending = {
  id: number;
  generation: number;
  senderId: number;
  rowCount: number;
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
};

const DEFAULT_REQUEST_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const EMBED_PROTOCOL_VERSION = 1 as const;
const MAX_EMBED_BATCH = 64;
const MAX_QUEUED_BATCHES = 8;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHostResponse(value: unknown): value is HostResponse {
  if (!isRecord(value)
    || value["protocolVersion"] !== EMBED_PROTOCOL_VERSION
    || typeof value["providerNonce"] !== "string"
    || !Number.isSafeInteger(value["generation"])
    || typeof value["requestNonce"] !== "string"
    || !Number.isSafeInteger(value["id"])
    || typeof value["ok"] !== "boolean") {
    return false;
  }
  if (value["ok"] === false) return typeof value["error"] === "string";
  return Number.isSafeInteger(value["rows"])
    && Number.isSafeInteger(value["dim"])
    && Array.isArray(value["vectors"])
    && value["vectors"].every((vector) => vector instanceof ArrayBuffer);
}

function isReadyEnvelope(
  value: unknown,
  providerNonce: string,
  generation: number,
): boolean {
  return isRecord(value)
    && value["protocolVersion"] === EMBED_PROTOCOL_VERSION
    && value["providerNonce"] === providerNonce
    && value["generation"] === generation;
}

export class RendererEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 768;
  readonly modelId: string;
  private opts: RendererEmbeddingOptions;
  private windowReady: Promise<BrowserWindow> | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private readonly providerNonce = randomUUID();
  private responseListener: ((event: IpcMainEvent, response: unknown) => void) | null = null;
  private activeWindow: BrowserWindow | null = null;
  private windowGeneration = 0;
  private startupCancel: ((error: Error) => void) | null = null;
  private dispatchTail: Promise<void> = Promise.resolve();
  private queuedBatchCount = 0;
  private requestEpoch = 0;
  private disposed = false;

  constructor(opts: RendererEmbeddingOptions) {
    this.opts = opts;
    this.modelId = opts.modelId ?? process.env["EMBEDDING_MODEL"] ?? DEFAULT_MODEL_ID;
  }

  private registerChannel(): void {
    if (this.responseListener) return;
    this.responseListener = (event, payload) => {
      const win = this.activeWindow;
      if (!win || win.isDestroyed() || event.sender !== win.webContents) {
        this.diagnose("embedding-response-ignored", { reason: "inactive-sender" });
        return;
      }
      if (!isHostResponse(payload)) {
        const error = new Error("embedding renderer returned a malformed response");
        this.diagnose("embedding-response-malformed", { generation: this.windowGeneration });
        this.failGeneration(this.windowGeneration, error);
        return;
      }
      const resp = payload;
      if (resp.providerNonce !== this.providerNonce || resp.generation !== this.windowGeneration) {
        const error = new Error("embedding renderer response session mismatch");
        this.diagnose("embedding-response-malformed", { generation: this.windowGeneration });
        this.failGeneration(this.windowGeneration, error);
        return;
      }
      const entry = this.pending.get(resp.requestNonce);
      if (!entry) return;
      if (entry.id !== resp.id
        || entry.generation !== resp.generation
        || entry.senderId !== event.sender.id) {
        const error = new Error("embedding renderer response identity mismatch");
        this.diagnose("embedding-response-malformed", { generation: resp.generation });
        this.failGeneration(resp.generation, error);
        return;
      }
      if (resp.ok) {
        try {
          if (resp.rows !== entry.rowCount
            || resp.dim !== this.dim
            || resp.vectors.length !== entry.rowCount
            || resp.vectors.some((buffer) => buffer.byteLength !== this.dim * Float32Array.BYTES_PER_ELEMENT)) {
            throw new Error("embedding renderer returned an invalid vector shape");
          }
          const vectors = resp.vectors.map((buffer) => new Float32Array(buffer));
          if (vectors.some((vector) => vector.some((value) => !Number.isFinite(value)))) {
            throw new Error("embedding renderer returned a non-finite vector");
          }
          this.pending.delete(resp.requestNonce);
          clearTimeout(entry.timer);
          entry.resolve(vectors);
        } catch (error) {
          const normalized = error instanceof Error ? error : new Error(String(error));
          this.diagnose("embedding-response-malformed", { generation: resp.generation });
          // Do not orphan this promise: failGeneration rejects every pending
          // request before recycling the now-untrusted host.
          this.failGeneration(resp.generation, normalized);
        }
      } else {
        this.pending.delete(resp.requestNonce);
        clearTimeout(entry.timer);
        entry.reject(new Error(resp.error));
      }
    };
    ipcMain.on("embed-response", this.responseListener);
  }

  private diagnose(event: string, details: Record<string, string | number | boolean>): void {
    this.opts.onDiagnostic?.(event, details);
  }

  private rejectGeneration(generation: number, error: Error): void {
    for (const [requestNonce, entry] of this.pending) {
      if (entry.generation !== generation) continue;
      this.pending.delete(requestNonce);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private rejectAll(error: Error): void {
    for (const [requestNonce, entry] of this.pending) {
      this.pending.delete(requestNonce);
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private failGeneration(generation: number, error: Error): void {
    if (generation !== this.windowGeneration) return;
    const cancelStartup = this.startupCancel;
    this.startupCancel = null;
    cancelStartup?.(error);
    const win = this.activeWindow;
    this.activeWindow = null;
    this.windowReady = null;
    this.windowGeneration++;
    this.requestEpoch++;
    this.rejectGeneration(generation, error);
    if (win && !win.isDestroyed()) win.destroy();
  }

  private rejectedWindow(error: Error): Promise<BrowserWindow> {
    const rejected = Promise.reject<BrowserWindow>(error);
    void rejected.catch(() => undefined);
    return rejected;
  }

  private getWindow(): Promise<BrowserWindow> {
    if (this.disposed) return this.rejectedWindow(new Error("embedding renderer provider disposed"));
    if (this.windowReady) return this.windowReady;
    this.registerChannel();

    const generation = ++this.windowGeneration;
    let win: BrowserWindow;
    try {
      win = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: {
          preload: this.opts.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.diagnose("embedding-window-construction-failed", { message: normalized.message });
      // Keep windowReady empty so the next request retries construction.
      return this.rejectedWindow(normalized);
    }
    this.activeWindow = win;

    try {
      win.webContents.on("render-process-gone", (_e, details) => {
        this.diagnose("embedding-render-process-gone", {
          reason: details.reason,
          exitCode: details.exitCode,
        });
        this.failGeneration(generation, new Error(
          `embedding renderer gone: ${details.reason} (exit ${details.exitCode})`,
        ));
      });
      win.webContents.on("did-fail-load", (_e, errorCode, errorDescription, _url, isMainFrame) => {
        if (!isMainFrame) return;
        this.diagnose("embedding-did-fail-load", { errorCode, errorDescription });
      });
      win.webContents.on("unresponsive", () => {
        this.diagnose("embedding-unresponsive", { generation });
      });
      win.on("closed", () => {
        if (this.disposed || generation !== this.windowGeneration) return;
        this.diagnose("embedding-window-closed", { generation });
        this.failGeneration(generation, new Error("embedding renderer window closed"));
      });
      const readyPromise = new Promise<BrowserWindow>((resolveReady, rejectReady) => {
        let settled = false;
        const cleanup = () => {
          ipcMain.removeListener("embed-host-ready", readyListener);
          win.webContents.removeListener("preload-error", preloadErrorListener);
          clearTimeout(startupTimer);
          if (this.startupCancel === fail) this.startupCancel = null;
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          rejectReady(error);
        };
        const readyListener = (event: IpcMainEvent, payload: unknown) => {
          if (event.sender !== win.webContents) return;
          if (!isReadyEnvelope(payload, this.providerNonce, generation)) {
            fail(new Error("embedding renderer returned an invalid ready envelope"));
            return;
          }
          if (settled) return;
          settled = true;
          cleanup();
          resolveReady(win);
        };
        const preloadErrorListener = (
          _event: ElectronEvent,
          _preloadPath: string,
          error: Error,
        ) => fail(new Error(`embedding renderer preload failed: ${error.message}`));
        const startupTimeoutMs = this.opts.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;
        const startupTimer = setTimeout(() => {
          fail(new Error(`embedding renderer did not become ready within ${startupTimeoutMs}ms`));
        }, startupTimeoutMs);
        // Cancellation must reject the startup promise, not merely remove its
        // listeners; otherwise recycle/dispose can strand getWindow forever.
        this.startupCancel = fail;
        ipcMain.on("embed-host-ready", readyListener);
        win.webContents.once("preload-error", preloadErrorListener);

        void win.loadFile(this.opts.htmlPath).then(() => {
          if (this.disposed || this.windowGeneration !== generation || win.isDestroyed()) {
            fail(new Error("embedding renderer provider disposed during startup"));
            return;
          }
          win.webContents.send("embed-host-init", {
            protocolVersion: EMBED_PROTOCOL_VERSION,
            providerNonce: this.providerNonce,
            generation,
          });
        }).catch((error: unknown) => {
          fail(error instanceof Error ? error : new Error(String(error)));
        });
      });
      this.windowReady = readyPromise;
      void readyPromise.catch((error) => {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.diagnose("embedding-window-start-failed", { message: normalized.message });
        this.failGeneration(generation, normalized);
      });
      return readyPromise;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.diagnose("embedding-window-setup-failed", { message: normalized.message });
      this.failGeneration(generation, normalized);
      return this.rejectedWindow(normalized);
    }
  }

  async embed(texts: string[], kind: EmbeddingKind = "document"): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const vectors: Float32Array[] = [];
    const epoch = this.requestEpoch;
    // Keep each WASM activation set bounded. Batches are awaited in order so
    // one large note cannot create overlapping inference allocations.
    for (let offset = 0; offset < texts.length; offset += MAX_EMBED_BATCH) {
      vectors.push(...await this.scheduleBatch(
        texts.slice(offset, offset + MAX_EMBED_BATCH),
        kind,
        epoch,
      ));
    }
    return vectors;
  }

  private scheduleBatch(
    texts: string[],
    kind: EmbeddingKind,
    epoch: number,
  ): Promise<Float32Array[]> {
    if (this.queuedBatchCount >= MAX_QUEUED_BATCHES) {
      return Promise.reject(new Error("embedding renderer queue is busy; retry the latest passage"));
    }
    this.queuedBatchCount++;
    const run = this.dispatchTail.then(() => {
      if (this.disposed || epoch !== this.requestEpoch) {
        throw new Error("embedding request canceled because the renderer was recycled");
      }
      return this.embedBatch(texts, kind);
    });
    this.dispatchTail = run.then(() => undefined, () => undefined);
    return run.finally(() => {
      this.queuedBatchCount--;
    });
  }

  private async embedBatch(texts: string[], kind: EmbeddingKind): Promise<Float32Array[]> {
    if (this.disposed) throw new Error("embedding renderer provider disposed");
    const win = await this.getWindow();
    if (this.disposed || win.isDestroyed()) {
      throw new Error("embedding renderer provider disposed");
    }
    const id = this.nextId++;
    const generation = this.windowGeneration;
    const requestNonce = randomUUID();
    return new Promise<Float32Array[]>((resolve, reject) => {
      const timeoutMs = this.opts.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      const timer = setTimeout(() => {
        if (!this.pending.has(requestNonce)) return;
        const error = new Error(`embedding renderer request timed out after ${timeoutMs}ms`);
        this.diagnose("embedding-request-timeout", { requestId: id, timeoutMs });
        // A timed-out host is no longer trustworthy: reject every request
        // assigned to this generation and lazily create a fresh host later.
        this.failGeneration(generation, error);
      }, timeoutMs);
      this.pending.set(requestNonce, {
        id,
        generation,
        senderId: win.webContents.id,
        rowCount: texts.length,
        resolve,
        reject,
        timer,
      });
      try {
        win.webContents.send("embed-request", {
          protocolVersion: EMBED_PROTOCOL_VERSION,
          providerNonce: this.providerNonce,
          generation,
          requestNonce,
          id,
          texts,
          kind,
          modelId: this.modelId,
        });
      } catch (error) {
        const normalized = error instanceof Error ? error : new Error(String(error));
        this.failGeneration(generation, normalized);
      }
    });
  }

  /** Reject current inference and recycle its renderer while keeping this provider reusable. */
  recycle(reason = "embedding renderer recycled"): void {
    if (this.disposed) return;
    const error = new Error(reason);
    if (this.activeWindow || this.windowReady) {
      this.failGeneration(this.windowGeneration, error);
    } else {
      this.rejectAll(error);
      this.windowGeneration++;
      this.requestEpoch++;
    }
  }

  /** Destroy the hidden window (call on app quit). */
  dispose(reason = "embedding renderer provider disposed"): void {
    if (this.disposed) return;
    this.disposed = true;
    const error = new Error(reason);
    const win = this.activeWindow;
    this.activeWindow = null;
    this.windowReady = null;
    const cancelStartup = this.startupCancel;
    this.startupCancel = null;
    cancelStartup?.(error);
    this.windowGeneration++;
    this.requestEpoch++;
    this.rejectAll(error);
    if (win && !win.isDestroyed()) win.destroy();

    if (this.responseListener) {
      ipcMain.removeListener("embed-response", this.responseListener);
      this.responseListener = null;
    }
  }
}
