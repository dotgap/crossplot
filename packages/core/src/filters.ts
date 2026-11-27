import type { Filter, FilterState } from "./types.js";

/** An immutable view of every filter at one point in time. */
export interface FilterSnapshot {
  /** Increases by one on every change. */
  readonly version: number;
  /** Filters by dimension id. */
  readonly filters: FilterState;
  /** JSON-safe form, for URLs and storage. */
  toJSON(): FilterState;
}

/** Called with the new snapshot after every change. */
export type FilterListener = (snapshot: FilterSnapshot) => void;

/**
 * Shared filter state for one dashboard: a map from dimension id to filter.
 * Every change produces a new immutable snapshot with a higher version.
 */
export class FilterStore {
  private state: FilterState = {};
  private version = 0;
  private readonly listeners = new Set<FilterListener>();

  /** The current snapshot. */
  get snapshot(): FilterSnapshot {
    const filters = this.state;
    return { version: this.version, filters, toJSON: () => filters };
  }

  /** The filter on one dimension, or null. */
  get(id: string): Filter | null {
    return this.state[id] ?? null;
  }

  /** Set or replace one dimension's filter. `null` clears it. Setting an equal filter is a no-op. */
  set(id: string, filter: Filter | null): void {
    if (filter === null) {
      this.clear(id);
      return;
    }
    if (sameFilter(this.state[id], filter)) return;
    this.commit({ ...this.state, [id]: freeze(clone(filter)) });
  }

  /** Clear one filter, or every filter when called without an id. */
  clear(id?: string): void {
    if (id === undefined) {
      if (Object.keys(this.state).length > 0) this.commit({});
      return;
    }
    if (!(id in this.state)) return;
    const { [id]: _, ...rest } = this.state;
    this.commit(rest);
  }

  /** Replace the whole state, e.g. when restoring from a URL. */
  replace(state: FilterState): void {
    const next: Record<string, Filter> = {};
    for (const [k, v] of Object.entries(state)) if (v) next[k] = freeze(clone(v));
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.commit(next);
  }

  /** Listen for changes. Returns a function that unsubscribes. */
  subscribe(listener: FilterListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private commit(next: FilterState): void {
    this.state = Object.freeze(next);
    this.version++;
    const snap = this.snapshot;
    for (const l of [...this.listeners]) l(snap);
  }
}

function sameFilter(a: Filter | undefined, b: Filter): boolean {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const v of Object.values(value)) freeze(v);
    Object.freeze(value);
  }
  return value;
}
