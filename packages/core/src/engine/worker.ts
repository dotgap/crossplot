import type { DataEngine } from "../types.js";
import { connectEngine } from "./protocol.js";

/**
 * Run the engine in a Web Worker. With no argument it starts the worker that
 * ships with this package; bundlers that understand
 * `new Worker(new URL(..., import.meta.url))` (Vite, webpack 5, esbuild with
 * a plugin) pick it up automatically. Pass your own Worker to control loading.
 */
export function workerEngine(worker?: Worker): DataEngine {
  const w = worker ?? new Worker(new URL("../worker.js", import.meta.url), { type: "module" });
  return connectEngine(w, () => w.terminate());
}
