import { encodeCategories } from "./table.js";
import type {
  AxisInfo,
  BinSpec,
  CategoryColumn,
  CategorySpec,
  Column,
  ColumnTable,
  Dimension1DSpec,
  DimensionSpec,
  Filter,
  GridFilter,
  RangeFilter,
  SetFilter,
  TimeInterval,
} from "./types.js";

/** Bin state for a filter: row is out, in, or must be checked against its raw value. */
export const OUT = 0;
export const IN = 1;
export const PARTIAL = 2;

/**
 * A filter compiled against a dimension's bins. `state` has one entry per bin
 * plus a trailing entry for the missing / out-of-range slot.
 */
export interface Classified {
  readonly state: Uint8Array;
  readonly test: ((row: number) => boolean) | null;
}

export interface Axis {
  readonly info: AxisInfo;
  /** Bin per row; `info.size` marks missing or out-of-range. */
  readonly bins: Uint32Array;
  classify(filter: RangeFilter | SetFilter | null): Classified;
}

/** A dimension's per-row bin index and filter compiler. */
export interface CompiledDimension {
  readonly x: Axis;
  readonly y: Axis | null;
  readonly size: number;
  /** Bin per row; `size` marks missing. */
  readonly bins: Uint32Array;
  classify(filter: Filter | null): Classified;
}

const MAX_BINS = 1 << 20;

export function compileDimension(table: ColumnTable, spec: DimensionSpec): CompiledDimension {
  if (spec.kind !== "grid") {
    const x = buildAxis(table, spec);
    return {
      x,
      y: null,
      size: x.info.size,
      bins: x.bins,
      classify: (f) => x.classify(f === null ? null : asAxisFilter(f, spec.field)),
    };
  }
  const x = buildAxis(table, spec.x);
  const y = buildAxis(table, spec.y);
  const xs = x.info.size;
  const ys = y.info.size;
  const size = xs * ys;
  if (size > MAX_BINS) throw new Error(`Grid has ${size} bins; the limit is ${MAX_BINS}`);
  const bins = new Uint32Array(table.rowCount);
  for (let i = 0; i < bins.length; i++) {
    const bx = x.bins[i]!;
    const by = y.bins[i]!;
    bins[i] = bx === xs || by === ys ? size : bx * ys + by;
  }
  return {
    x,
    y,
    size,
    bins,
    classify(filter) {
      if (filter === null) return { state: allIn(size), test: null };
      // A plain range or key set on a grid selects along x and keeps every y.
      const g: GridFilter = "range" in filter || "in" in filter ? { x: filter, y: null } : filter;
      const cx = x.classify(g.x);
      const cy = y.classify(g.y);
      const state = new Uint8Array(size + 1);
      let partial = false;
      for (let i = 0; i < xs; i++) {
        const sx = cx.state[i]!;
        for (let j = 0; j < ys; j++) {
          const sy = cy.state[j]!;
          const s = sx === OUT || sy === OUT ? OUT : sx === IN && sy === IN ? IN : PARTIAL;
          if (s === PARTIAL) partial = true;
          state[i * ys + j] = s;
        }
      }
      state[size] = OUT;
      const tx = cx.test;
      const ty = cy.test;
      const test = partial ? (r: number) => (tx === null || tx(r)) && (ty === null || ty(r)) : null;
      return { state, test };
    },
  };
}

function asAxisFilter(f: Filter, field: string): RangeFilter | SetFilter {
  if ("range" in f || "in" in f) return f;
  throw new Error(`Dimension "${field}" is one-dimensional; got a grid filter`);
}

function allIn(size: number): Uint8Array {
  // The missing slot passes too: no filter means every row passes.
  return new Uint8Array(size + 1).fill(IN);
}

function getColumn(table: ColumnTable, field: string): Column {
  const col = table.columns[field];
  if (!col) throw new Error(`Unknown field "${field}"`);
  return col;
}

export function buildAxis(table: ColumnTable, spec: Dimension1DSpec): Axis {
  const col = getColumn(table, spec.field);
  return spec.kind === "category" ? categoryAxis(col, spec, table.rowCount) : binAxis(col, spec);
}

// ---------------------------------------------------------------------------
// Categorical axes
// ---------------------------------------------------------------------------

function categoryAxis(column: Column, spec: CategorySpec, rowCount: number): Axis {
  const col: CategoryColumn =
    column.type === "category"
      ? column
      : encodeCategories(
          Array.from(column.values, (v) => (Number.isNaN(v) ? null : column.type === "date" ? new Date(v) : v)),
          rowCount,
        );
  const dictSize = col.dictionary.length;
  const freq = new Float64Array(dictSize);
  for (let i = 0; i < col.codes.length; i++) {
    const c = col.codes[i]!;
    if (c >= 0) freq[c]!++;
  }

  // codeToBin maps dictionary code -> bin.
  const codeToBin = new Uint32Array(dictSize);
  let keys: string[];
  const order = Array.from({ length: dictSize }, (_, i) => i).filter((c) => freq[c]! > 0);
  if (spec.limit !== undefined && order.length > spec.limit) {
    order.sort((a, b) => freq[b]! - freq[a]! || cmp(col.dictionary[a]!, col.dictionary[b]!));
    const top = order.slice(0, spec.limit);
    keys = top.map((c) => col.dictionary[c]!);
    keys.push(spec.otherLabel ?? "Other");
    codeToBin.fill(spec.limit);
    for (const [b, c] of top.entries()) codeToBin[c] = b;
  } else {
    order.sort((a, b) => cmp(col.dictionary[a]!, col.dictionary[b]!));
    keys = order.map((c) => col.dictionary[c]!);
    for (const [b, c] of order.entries()) codeToBin[c] = b;
  }

  const size = keys.length;
  const bins = new Uint32Array(col.codes.length);
  for (let i = 0; i < bins.length; i++) {
    const c = col.codes[i]!;
    bins[i] = c < 0 ? size : codeToBin[c]!;
  }
  const info: AxisInfo = {
    kind: "category",
    field: spec.field,
    size,
    edges: new Float64Array(0),
    keys,
    scale: "linear",
    date: false,
  };
  return {
    info,
    bins,
    classify(filter) {
      if (filter === null) return { state: allIn(size), test: null };
      if (!("in" in filter)) throw new Error(`Category dimension "${spec.field}" needs an { in: [...] } filter`);
      const wanted = new Set(filter.in);
      const state = new Uint8Array(size + 1);
      for (let b = 0; b < size; b++) state[b] = wanted.has(keys[b]!) ? IN : OUT;
      return { state, test: null };
    },
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Numeric axes
// ---------------------------------------------------------------------------

function binAxis(column: Column, spec: BinSpec): Axis {
  if (column.type === "category") throw new Error(`bin("${spec.field}") needs a numeric or date column`);
  const values = column.values;
  const log = spec.scale === "log";
  const date = column.type === "date";
  const t = log ? (v: number) => (v > 0 ? Math.log10(v) : Number.NaN) : (v: number) => v;

  let lo: number;
  let hi: number;
  if (spec.extent) {
    [lo, hi] = spec.extent;
    if (log && (lo <= 0 || hi <= 0)) throw new Error(`Log extent for "${spec.field}" must be positive`);
  } else {
    lo = Infinity;
    hi = -Infinity;
    for (let i = 0; i < values.length; i++) {
      const v = values[i]!;
      if (Number.isNaN(v) || (log && v <= 0)) continue;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (lo === Infinity) lo = hi = log ? 1 : 0;
  }
  if (!(hi >= lo)) throw new Error(`Invalid extent for "${spec.field}": [${lo}, ${hi}]`);

  let edges: Float64Array;
  let binOf: (v: number) => number;

  if (spec.interval) {
    edges = calendarEdges(lo, hi, spec.interval);
    binOf = (v) => upperBound(edges, v) - 1;
  } else {
    const tlo = t(lo);
    const thi = t(hi);
    let size: number;
    let width: number;
    if (spec.step !== undefined) {
      if (!(spec.step > 0)) throw new Error(`step must be positive for "${spec.field}"`);
      width = spec.step;
      size = Math.max(1, Math.ceil((thi - tlo) / width - 1e-9));
    } else {
      size = Math.max(1, Math.floor(spec.bins ?? 20));
      width = (thi - tlo) / size || 1;
    }
    if (size > MAX_BINS) throw new Error(`"${spec.field}" would have ${size} bins; the limit is ${MAX_BINS}`);
    edges = new Float64Array(size + 1);
    for (let i = 0; i <= size; i++) {
      const e = tlo + i * width;
      edges[i] = log ? 10 ** e : e;
    }
    binOf = (v) => Math.floor((t(v) - tlo) / width);
  }

  const size = edges.length - 1;
  const first = edges[0]!;
  const last = edges[size]!;
  const clamp = spec.clamp === true;
  const bins = new Uint32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    const v = values[i]!;
    let b: number;
    if (Number.isNaN(v) || (log && v <= 0)) b = size;
    else if (v < first) b = clamp ? 0 : size;
    else if (v > last) b = clamp ? size - 1 : size;
    else b = Math.min(Math.max(binOf(v), 0), size - 1); // v === last lands in the last bin
    bins[i] = b;
  }

  const info: AxisInfo = { kind: "bin", field: spec.field, size, edges, keys: [], scale: log ? "log" : "linear", date };
  return {
    info,
    bins,
    classify(filter) {
      if (filter === null) return { state: allIn(size), test: null };
      if (!("range" in filter)) throw new Error(`Binned dimension "${spec.field}" needs a { range: [lo, hi] } filter`);
      const [a, b] = filter.range[0] <= filter.range[1] ? filter.range : [filter.range[1], filter.range[0]];
      const state = new Uint8Array(size + 1);
      let partial = false;
      for (let i = 0; i < size; i++) {
        let e0 = edges[i]!;
        let e1 = edges[i + 1]!;
        // Clamped edge bins hold values beyond their nominal edges.
        if (clamp && i === 0) e0 = -Infinity;
        if (clamp && i === size - 1) e1 = Infinity;
        // The last bin is closed at the top, so it reaches past e1 by one value.
        const closedTop = i === size - 1;
        let s: number;
        if (e0 >= a && (e1 < b || (!closedTop && e1 <= b))) s = IN;
        else if (e1 < a || (!closedTop && e1 === a) || e0 >= b) s = OUT;
        else s = PARTIAL;
        if (s === PARTIAL) partial = true;
        state[i] = s;
      }
      state[size] = OUT;
      const test = partial
        ? (r: number) => {
            const v = values[r]!;
            return v >= a && v < b;
          }
        : null;
      return { state, test };
    },
  };
}

/** Index of the first edge greater than v. */
function upperBound(edges: Float64Array, v: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! <= v) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** UTC calendar edges covering [lo, hi]. */
export function calendarEdges(lo: number, hi: number, interval: TimeInterval): Float64Array {
  const floor = (ms: number): Date => {
    const d = new Date(ms);
    switch (interval) {
      case "year":
        return new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      case "month":
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
      case "week": {
        const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
        // Weeks start on Monday (ISO).
        day.setUTCDate(day.getUTCDate() - ((day.getUTCDay() + 6) % 7));
        return day;
      }
      case "day":
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    }
  };
  const next = (d: Date): Date => {
    const n = new Date(d.getTime());
    if (interval === "year") n.setUTCFullYear(n.getUTCFullYear() + 1);
    else if (interval === "month") n.setUTCMonth(n.getUTCMonth() + 1);
    else n.setUTCDate(n.getUTCDate() + (interval === "week" ? 7 : 1));
    return n;
  };
  const out: number[] = [];
  let d = floor(lo);
  out.push(d.getTime());
  do {
    d = next(d);
    out.push(d.getTime());
    if (out.length > MAX_BINS) throw new Error(`Too many ${interval} bins`);
  } while (d.getTime() <= hi);
  return Float64Array.from(out);
}
