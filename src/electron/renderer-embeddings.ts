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

import { BrowserWindow, ipcMain } from "electron";
import type { EmbeddingKind, EmbeddingProvider } from "../core/interfaces.js";
import { DEFAULT_MODEL_ID } from "../host/local-embeddings.js";

type HostResponse =
  | { id: number; ok: true; vectors: ArrayBuffer[] }
  | { id: number; ok: false; error: string };

export type RendererEmbeddingOptions = {
  /** Absolute path to the embedding host html (dist/embedding-host/index.html). */
  htmlPath: string;
  /** Absolute path to the compiled preload (dist/electron/embed-preload.cjs). */
  preloadPath: string;
  modelId?: string;
};

type Pending = {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
};

export class RendererEmbeddingProvider implements EmbeddingProvider {
  readonly dim = 768;
  readonly modelId: string;
  private opts: RendererEmbeddingOptions;
  private windowReady: Promise<BrowserWindow> | null = null;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private channelRegistered = false;

  constructor(opts: RendererEmbeddingOptions) {
    this.opts = opts;
    this.modelId = opts.modelId ?? process.env["EMBEDDING_MODEL"] ?? DEFAULT_MODEL_ID;
  }

  private registerChannel(): void {
    if (this.channelRegistered) return;
    this.channelRegistered = true;
    ipcMain.on("embed-response", (_event, resp: HostResponse) => {
      const entry = this.pending.get(resp.id);
      if (!entry) return;
      this.pending.delete(resp.id);
      if (resp.ok) {
        entry.resolve(resp.vectors.map((buf) => new Float32Array(buf)));
      } else {
        entry.reject(new Error(resp.error));
      }
    });
  }

  private getWindow(): Promise<BrowserWindow> {
    if (this.windowReady) return this.windowReady;
    this.registerChannel();

    const fail = (err: Error) => {
      for (const entry of this.pending.values()) entry.reject(err);
      this.pending.clear();
      this.windowReady = null;
    };

    this.windowReady = (async () => {
      const win = new BrowserWindow({
        show: false,
        skipTaskbar: true,
        webPreferences: {
          preload: this.opts.preloadPath,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      win.webContents.on("render-process-gone", (_e, details) => {
        fail(new Error(`embedding renderer gone: ${details.reason}`));
      });
      win.on("closed", () => {
        fail(new Error("embedding renderer window closed"));
      });
      await win.loadFile(this.opts.htmlPath);
      return win;
    })();
    this.windowReady.catch(fail);
    return this.windowReady;
  }

  async embed(texts: string[], kind: EmbeddingKind = "document"): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const win = await this.getWindow();
    const id = this.nextId++;
    return new Promise<Float32Array[]>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      win.webContents.send("embed-request", { id, texts, kind, modelId: this.modelId });
    });
  }

  /** Destroy the hidden window (call on app quit). */
  dispose(): void {
    if (this.windowReady) {
      void this.windowReady.then((w) => {
        if (!w.isDestroyed()) w.destroy();
      }).catch(() => undefined);
      this.windowReady = null;
    }
  }
}
