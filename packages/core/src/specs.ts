import type {
  AggregateSpec,
  BinSpec,
  CategorySpec,
  Dimension1DSpec,
  DimensionInput,
  DimensionSpec,
  GridSpec,
  TimeInterval,
} from "./types.js";

/** Options for {@link bin}. Set at most one of `step`, `bins` or `interval`. */
export interface BinOptions {
  /** Linear bin width in data units. */
  step?: number;
  /** Bin count across the extent. Default 20 when neither `step` nor `interval` is set. */
  bins?: number;
  /** Calendar interval for date columns (UTC). */
  interval?: TimeInterval;
  /** `log` bins evenly in log10 space. */
  scale?: "linear" | "log";
  /** Bin range; defaults to the data's min and max. */
  extent?: readonly [number, number];
  /** Keep out-of-range values in the edge bins. */
  clamp?: boolean;
}

/** A binned numeric or date dimension. */
export function bin<F extends string>(field: F, options: BinOptions = {}): BinSpec<F> {
  const set = [options.step, options.bins, options.interval].filter((v) => v !== undefined).length;
  if (set > 1) throw new Error(`bin("${field}"): pass only one of step, bins or interval`);
  return { kind: "bin", field, ...options };
}

/** A categorical dimension with one bin per distinct value. */
export function category<F extends string>(field: F): CategorySpec<F> {
  return { kind: "category", field };
}

/** A categorical dimension that keeps the `n` most frequent values and groups the rest. */
export function top<F extends string>(field: F, n: number, otherLabel = "Other"): CategorySpec<F> {
  if (!(n >= 1)) throw new Error(`top("${field}", n): n must be at least 1`);
  return { kind: "category", field, limit: Math.floor(n), otherLabel };
}

/** Count the rows in each bin. The default aggregate. */
export function count(): AggregateSpec<never> {
  return { op: "count" };
}

/** Sum a numeric field over the rows in each bin. Missing values count as zero. */
export function sum<F extends string>(field: F): AggregateSpec<F> {
  return { op: "sum", field };
}

/** Average a numeric field over the rows in each bin, ignoring missing values. */
export function mean<F extends string>(field: F): AggregateSpec<F> {
  return { op: "mean", field };
}

export interface LngLatOptions {
  /** Cell size in degrees. Default 1. */
  step?: number;
}

/**
 * A world grid of longitude by latitude cells, for maps. Brushing it filters
 * on the raw coordinates, so a box drawn on a plate carrée map is exact.
 */
export function lngLat<F extends string>(lng: F, lat: F, options: LngLatOptions = {}): GridSpec<F> {
  const step = options.step ?? 1;
  if (!(step > 0)) throw new Error("lngLat(): step must be positive");
  return {
    kind: "grid",
    x: { kind: "bin", field: lng, step, extent: [-180, 180] },
    y: { kind: "bin", field: lat, step, extent: [-90, 90] },
  };
}

function one<F extends string>(d: Dimension1DSpec<F> | F): Dimension1DSpec<F> {
  return typeof d === "string" ? category(d) : d;
}

/** Normalize what a chart spec accepts into an engine dimension spec. */
export function toDimensionSpec<F extends string>(input: DimensionInput<F>): DimensionSpec<F> {
  if (typeof input === "string") return category(input);
  if (Array.isArray(input)) {
    const [x, y] = input as readonly [Dimension1DSpec<F> | F, Dimension1DSpec<F> | F];
    return { kind: "grid", x: one(x), y: one(y) };
  }
  return input as DimensionSpec<F>;
}

/** A readable default id: the field name, or "x×y" for grids. */
export function dimensionName(spec: DimensionSpec): string {
  return spec.kind === "grid" ? `${spec.x.field}×${spec.y.field}` : spec.field;
}
