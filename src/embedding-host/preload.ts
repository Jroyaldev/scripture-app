/**
 * Preload for the hidden embedding-host renderer.
 * Minimal bridge: receive embed requests from main, send responses back.
 */

import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("embedHost", {
  onRequest: (cb: (req: unknown) => void) => {
    ipcRenderer.on("embed-request", (_event, req: unknown) => cb(req));
  },
  respond: (resp: unknown) => {
    ipcRenderer.send("embed-response", resp);
  },
});
