import type { DataEngine } from "../types.js";
import { CrossIndex } from "./crossindex.js";
import { idleWork } from "./protocol.js";

/**
 * Runs the engine on the calling thread. Good for tests, server-side use and
 * small tables; the dashboard picks the worker engine when it can.
 */
export function localEngine(): DataEngine {
  const index = new CrossIndex();
  // Background work (2-D tiles on large tables) also runs between calls here, in short slices.
  const idle = idleWork(index);
  const after = <T>(value: T): T => {
    idle.poke();
    return value;
  };
  return {
    load: async (table) => index.load(table),
    addDimension: async (id, spec) => index.addDimension(id, spec),
    removeDimension: async (id) => index.removeDimension(id),
    addGroup: async (id, dim, agg) => index.addGroup(id, dim, agg),
    removeGroup: async (id) => index.removeGroup(id),
    update: async (filters, version) => after(index.update(filters, version)),
    rows: async (query) => index.rows(query),
    dispose: () => {
      idle.stop();
      index.load({ rowCount: 0, columns: {} });
    },
  };
}
