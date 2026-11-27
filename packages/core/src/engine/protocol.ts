import type { ColumnTable, DataEngine, UpdateResult } from "../types.js";
import { CrossIndex } from "./crossindex.js";

export type Method = Exclude<keyof DataEngine, "dispose">;

/** Milliseconds of background work (see {@link CrossIndex.work}) per idle task between messages. */
const IDLE_SLICE_MS = 8;

/**
 * Give an index's background work idle time: tasks of `IDLE_SLICE_MS`, each
 * scheduled with `setTimeout` so messages that arrive meanwhile are not held
 * up by more than one slice. Call `poke` after handling a message; `stop`
 * cancels the pending task.
 */
export function idleWork(index: CrossIndex): { poke(): void; stop(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = () => {
    timer = undefined;
    if (index.work(IDLE_SLICE_MS)) timer = setTimeout(run, 0);
  };
  return {
    poke() {
      if (timer === undefined && index.pending) timer = setTimeout(run, 0);
    },
    stop() {
      clearTimeout(timer);
      timer = undefined;
    },
  };
}

export interface Request {
  readonly id: number;
  readonly method: Method;
  readonly args: readonly unknown[];
}

export type Response =
  | { readonly id: number; readonly ok: true; readonly value: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** The subset of Worker / MessagePort / DedicatedWorkerGlobalScope we use. */
export interface Port {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  start?(): void;
}

/** Serve a CrossIndex over a port. Call this inside the worker. */
export function serveEngine(port: Port): () => void {
  const index = new CrossIndex();
  const idle = idleWork(index);
  const handlers: Record<Method, (...args: never[]) => unknown> = {
    load: (table: ColumnTable) => index.load(table),
    addDimension: (id: string, spec) => index.addDimension(id, spec),
    removeDimension: (id: string) => index.removeDimension(id),
    addGroup: (id: string, dim: string, agg) => index.addGroup(id, dim, agg),
    removeGroup: (id: string) => index.removeGroup(id),
    update: (filters, version: number) => index.update(filters, version),
    rows: (query) => index.rows(query),
  };
  const listener = (event: MessageEvent) => {
    const { id, method, args } = event.data as Request;
    let response: Response;
    let transfer: Transferable[] = [];
    try {
      const value = (handlers[method] as (...a: unknown[]) => unknown)(...args);
      if (method === "update") transfer = transferables(value as UpdateResult);
      response = { id, ok: true, value };
    } catch (err) {
      response = { id, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    port.postMessage(response, transfer);
    idle.poke();
  };
  port.addEventListener("message", listener);
  port.start?.();
  return () => {
    idle.stop();
    port.removeEventListener("message", listener);
  };
}

function transferables(result: UpdateResult): Transferable[] {
  const out: Transferable[] = [];
  for (const g of Object.values(result.groups)) out.push(g.values.buffer, g.counts.buffer);
  return out;
}

/** Talk to a served engine through a port (a Worker, or one end of a MessageChannel). */
export function connectEngine(port: Port, terminate?: () => void): DataEngine {
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  const listener = (event: MessageEvent) => {
    const res = event.data as Response;
    const p = pending.get(res.id);
    if (!p) return;
    pending.delete(res.id);
    if (res.ok) p.resolve(res.value);
    else p.reject(new Error(res.error));
  };
  port.addEventListener("message", listener);
  port.start?.();

  const call = <T>(method: Method, args: unknown[]): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      port.postMessage({ id, method, args } satisfies Request);
    });

  return {
    load: (table) => call("load", [table]),
    addDimension: (id, spec) => call("addDimension", [id, spec]),
    removeDimension: (id) => call("removeDimension", [id]),
    addGroup: (id, dim, agg) => call("addGroup", [id, dim, agg]),
    removeGroup: (id) => call("removeGroup", [id]),
    update: (filters, version) => call("update", [filters, version]),
    rows: (query) => call("rows", [query]),
    dispose() {
      port.removeEventListener("message", listener);
      for (const p of pending.values()) p.reject(new Error("Engine disposed"));
      pending.clear();
      terminate?.();
    },
  };
}
