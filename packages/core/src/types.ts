/** A primitive cell value accepted on ingest. */
export type Value = number | string | boolean | Date | null | undefined;

/** A row object. Field names are its keys. */
export type Row = Record<string, Value>;

/** Keys of a row type that can be used as field names. */
export type FieldOf<T> = Extract<keyof T, string>;

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

/**
 * Numeric column. Missing values are NaN. `date` marks columns that came from
 * Date objects; values are epoch milliseconds.
 */
export interface NumberColumn {
  readonly type: "number" | "date";
  readonly values: Float64Array;
}

/**
 * Dictionary-encoded categorical column. `codes[i]` indexes `dictionary`;
 * -1 means missing.
 */
export interface CategoryColumn {
  readonly type: "category";
  readonly codes: Int32Array;
  readonly dictionary: readonly string[];
}

export type Column = NumberColumn | CategoryColumn;

/** A columnar table: the only shape the engine works with. */
export interface ColumnTable {
  readonly rowCount: number;
  readonly columns: Readonly<Record<string, Column>>;
}

// ---------------------------------------------------------------------------
// Dimension specs (serializable, sent to the engine)
// ---------------------------------------------------------------------------

/** Calendar intervals for binning dates. */
export type TimeInterval = "day" | "week" | "month" | "year";

/** Numeric binning. Exactly one of `step`, `bins` or `interval` decides the bin width. */
export interface BinSpec<F extends string = string> {
  readonly kind: "bin";
  readonly field: F;
  /** Linear bin width, in data units. */
  readonly step?: number;
  /** Number of bins across the extent (linear or log). */
  readonly bins?: number;
  /** Calendar interval for date columns (UTC). */
  readonly interval?: TimeInterval;
  /** `log` bins evenly in log10 space; values <= 0 are treated as missing. */
  readonly scale?: "linear" | "log";
  /** Bin range. Defaults to the data's min and max. Values outside are out of range. */
  readonly extent?: readonly [number, number];
  /** Put out-of-range values in the first or last bin instead of dropping them from the chart. */
  readonly clamp?: boolean;
}

/** Categorical dimension: one bin per distinct value. */
export interface CategorySpec<F extends string = string> {
  readonly kind: "category";
  readonly field: F;
  /** Keep only the `limit` most frequent values; the rest share one bin. */
  readonly limit?: number;
  /** Label of the shared bin when `limit` is set. */
  readonly otherLabel?: string;
}

/** A one-axis dimension. */
export type Dimension1DSpec<F extends string = string> = BinSpec<F> | CategorySpec<F>;

/** Two-dimensional dimension, e.g. for heatmaps. */
export interface GridSpec<F extends string = string> {
  readonly kind: "grid";
  readonly x: Dimension1DSpec<F>;
  readonly y: Dimension1DSpec<F>;
}

/** Any dimension the engine can index. */
export type DimensionSpec<F extends string = string> = Dimension1DSpec<F> | GridSpec<F>;

/** What a chart's `dimension` accepts: a spec, a bare field name (categorical), or an [x, y] pair. */
export type DimensionInput<F extends string = string> =
  | F
  | DimensionSpec<F>
  | readonly [Dimension1DSpec<F> | F, Dimension1DSpec<F> | F];

// ---------------------------------------------------------------------------
// Aggregates
// ---------------------------------------------------------------------------

/** What to compute per bin. Build one with {@link count}, {@link sum} or {@link mean}. */
export type AggregateSpec<F extends string = string> =
  | { readonly op: "count" }
  | { readonly op: "sum"; readonly field: F }
  | { readonly op: "mean"; readonly field: F };

// ---------------------------------------------------------------------------
// Filters (value space, serializable)
// ---------------------------------------------------------------------------

/** Half-open numeric range [lo, hi). */
export interface RangeFilter {
  /** `[lo, hi)`: includes `lo`, excludes `hi`. Dates are epoch milliseconds. */
  readonly range: readonly [number, number];
}

/** Set of category keys. */
export interface SetFilter {
  /** Category keys to keep. */
  readonly in: readonly string[];
}

/** Rectangle on a grid dimension; each axis is a range or a key set. */
export interface GridFilter {
  readonly x: RangeFilter | SetFilter | null;
  readonly y: RangeFilter | SetFilter | null;
}

/** A filter on one dimension. A grid dimension also takes a plain RangeFilter or SetFilter, applied to its x axis. */
export type Filter = RangeFilter | SetFilter | GridFilter;

/** Every filter, keyed by dimension id. */
export type FilterState = Readonly<Record<string, Filter>>;

// ---------------------------------------------------------------------------
// Engine results
// ---------------------------------------------------------------------------

/** Describes one axis of a dimension's bins. */
export interface AxisInfo {
  readonly kind: "bin" | "category";
  readonly field: string;
  readonly size: number;
  /** For `bin` axes: size + 1 edges. Empty for `category`. */
  readonly edges: Float64Array;
  /** For `category` axes: one key per bin. Empty for `bin`. */
  readonly keys: readonly string[];
  readonly scale: "linear" | "log";
  readonly date: boolean;
}

export interface DimensionInfo {
  readonly id: string;
  readonly x: AxisInfo;
  readonly y: AxisInfo | null;
  /** Total bin count (x.size * y.size for grids). */
  readonly size: number;
}

/** Per-bin aggregate values for one group, plus the row counts behind them. */
export interface GroupResult {
  readonly id: string;
  readonly dimension: string;
  readonly values: Float64Array;
  readonly counts: Float64Array;
}

export interface UpdateResult {
  readonly version: number;
  readonly selected: number;
  readonly total: number;
  readonly groups: Readonly<Record<string, GroupResult>>;
}

/** Which filtered rows to return from {@link Dashboard.rows}. */
export interface RowsQuery {
  /** Fields to include. Defaults to all. */
  readonly columns?: readonly string[];
  /** Field to sort by; prefix with `-` for descending. */
  readonly sort?: string;
  /** Maximum rows to return. */
  readonly limit?: number;
  /** Rows to skip, for paging. */
  readonly offset?: number;
}

/** A page of filtered rows. */
export interface RowsResult {
  /** The rows, as plain objects. */
  readonly rows: Row[];
  /** Rows passing every filter, across all pages. */
  readonly selected: number;
}

/**
 * The data engine contract. The built-in engines run the same code either on
 * the main thread or in a Web Worker. Everything crossing it is serializable.
 */
export interface DataEngine {
  load(table: ColumnTable): Promise<void>;
  addDimension(id: string, spec: DimensionSpec): Promise<DimensionInfo>;
  removeDimension(id: string): Promise<void>;
  /**
   * Resolves with the aggregate before any filter (one value per bin), or
   * nothing if the engine does not compute it.
   */
  addGroup(id: string, dimension: string, aggregate: AggregateSpec): Promise<Float64Array | undefined>;
  removeGroup(id: string): Promise<void>;
  /** Apply the whole filter state and return every group's aggregates. */
  update(filters: FilterState, version: number): Promise<UpdateResult>;
  rows(query: RowsQuery): Promise<RowsResult>;
  dispose(): void;
}
