import type { DimensionInfo, Filter } from "./types.js";

/**
 * One bin of a chart's aggregated data, flattened so renderers can hand it
 * straight to a plotting library.
 */
export interface Datum {
  /** Bin index in the dimension (row-major for grids). */
  readonly index: number;
  /** The aggregate (count, sum or mean). NaN when a mean has no values. */
  readonly value: number;
  /** Rows in the bin. */
  readonly count: number;
  /** The aggregate with no filters at all, for drawing "everything" behind a selection. NaN if unknown. */
  readonly baseline: number;
  /** Category key, or a "lo–hi" label for numeric bins. */
  readonly key: string;
  /** Numeric bin edges along x; NaN for categories. */
  readonly x0: number;
  /** Upper bin edge along x (exclusive). */
  readonly x1: number;
  /** Grid dimensions only: the y axis bin. */
  readonly ykey?: string;
  /** Grid dimensions only: the y bin's lower edge. */
  readonly y0?: number;
  /** Grid dimensions only: the y bin's upper edge (exclusive). */
  readonly y1?: number;
  /** The chart's extra aggregates for this bin, by name (see `ChartSpec.extra`). */
  readonly extra?: Readonly<Record<string, number>>;
}

/** Everything a renderer needs to draw one chart. */
export interface ChartData {
  /** The chart's bins: axis kinds, edges and keys. */
  readonly dimension: DimensionInfo;
  /** One datum per bin. */
  readonly data: readonly Datum[];
  /** Rows passing every filter. */
  readonly selected: number;
  /** All rows. */
  readonly total: number;
}

/** What a renderer reports back, in data space. It never touches filters. */
export type Intent =
  | { readonly type: "brush"; readonly range: readonly [number, number] | null }
  | { readonly type: "brushXY"; readonly x: readonly [number, number]; readonly y: readonly [number, number] }
  | { readonly type: "select"; readonly keys: readonly string[]; readonly mode: "replace" | "toggle" }
  | { readonly type: "reset" };

/** Passed to {@link Renderer.mount}. */
export interface MountContext {
  /** The chart id. */
  readonly id: string;
  /** The chart's bins, known before the first update. */
  readonly dimension: DimensionInfo;
}

/**
 * The contract every renderer implements. `View` is the chart spec's `view`
 * object, passed through untouched.
 */
export interface Renderer<View = unknown> {
  /** Draw a chart into `el`. Call `emit` when the user brushes, clicks or resets. */
  mount(el: HTMLElement, view: View, emit: (intent: Intent) => void, context: MountContext): RenderHandle;
}

/** A mounted chart, returned by {@link Renderer.mount}. */
export interface RenderHandle {
  /** Redraw with fresh aggregates. `filter` is this chart's own filter, for highlighting. */
  update(data: ChartData, filter: Filter | null): void;
  /** Optional: the container changed size. */
  resize?(width: number, height: number): void;
  /** Remove everything `mount` added. */
  destroy(): void;
}
