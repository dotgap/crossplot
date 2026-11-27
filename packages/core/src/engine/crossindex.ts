import { type Classified, type CompiledDimension, compileDimension, IN, OUT, PARTIAL } from "../binning.js";
import { cell } from "../table.js";
import type {
  AggregateSpec,
  ColumnTable,
  DimensionInfo,
  DimensionSpec,
  Filter,
  FilterState,
  GroupResult,
  Row,
  RowsQuery,
  RowsResult,
  UpdateResult,
} from "../types.js";
import { binOrder } from "./sort.js";

/** One bit per dimension in a Uint32 filter mask. */
export const MAX_DIMENSIONS = 32;

/** Options for {@link CrossIndex}. */
export interface CrossIndexOptions {
  /**
   * Tables with at least this many rows answer drags on a binned dimension from
   * prefix-sum tiles (see {@link CrossIndex}). Smaller tables always update
   * incrementally. Box brushes on grids, and two range brushes moved in turn,
   * use tiles only once their frames update more than `4 * tileMinRows` group
   * entries without them. `Infinity` turns tiles off. Default 100,000.
   */
  readonly tileMinRows?: number;
}

/** Cells (float64) one set of tiles may use, across all of its groups. */
const TILE_BUDGET = 1 << 23;
const MAX_SLICES = 2048;
/** Smallest slice, as a power of two: below ~64 rows the prefix tables cost more than scanning. */
const MIN_SLICE_SHIFT = 6;
/** Build tiles on a brush's first frame when it would flip more than this share of rows. */
const TILE_FLIP_SHARE = 1 / 16;
/**
 * When a filter change would flip more than this share of rows, rewrite the
 * dimension's mask bit and recount every group in sequential passes instead
 * of visiting the flipped rows in bin order.
 */
const RECOUNT_SHARE = 1 / 12;

interface Dim {
  readonly id: string;
  readonly bit: number;
  readonly compiled: CompiledDimension;
  /** Row ids sorted by bin (counting sort), so a bin's rows are contiguous. */
  readonly order: Uint32Array;
  /** offsets[b]..offsets[b + 1] is bin b's slice of `order`; slot `size` is missing. */
  readonly offsets: Uint32Array;
  filterKey: string;
  /** The current filter, which tiles may be answering ahead of the mask. */
  filter: Filter | null;
  classified: Classified;
  /**
   * Raw values of a one-dimensional binned dimension, whose rows are sorted by
   * value inside each bin; null for categories and grids.
   */
  readonly values: Float64Array | null;
  /**
   * For dimensions with `values`: in bin b, the rows at positions lo[b]..hi[b]
   * of `order` pass the filter that the mask currently reflects.
   */
  lo: Uint32Array;
  hi: Uint32Array;
  /** How many incremental updates of this dimension in a row were slow (see `slowWork`). */
  slow: number;
  /** Position of each row in `order`, built with the first tiles on this dimension. */
  pos: Uint32Array | null;
}

/**
 * Prefix sums over one "active" dimension, after Falcon (Moritz et al. 2019).
 * The active dimension's rows, in value order, are cut into slices of 2^shift
 * rows. For every other group, `counts[s * slots + bin]` aggregates the rows
 * before slice s that pass every filter except the active one and the group's
 * own. A range on the active dimension is a run of positions; whole slices
 * come from two prefix rows, and the at most 2 * 2^shift rows at the ragged
 * ends are added one by one, so results stay exact.
 */
interface Tiles {
  readonly dim: Dim;
  readonly shift: number;
  readonly parts: TilePart[];
  /** Prefix count of rows passing every other filter (for `selected`). */
  readonly total: Uint32Array;
  /** The active filter's passing slices, which the mask has not caught up with. */
  lo: Uint32Array;
  hi: Uint32Array;
}

interface TilePart {
  readonly group: Group;
  readonly slots: number;
  /** Mask bits that exclude a row from this group, apart from the active dimension's. */
  readonly keep: number;
  /** The group's bin per row. */
  readonly bins: Uint32Array;
  /** Prefix tables, (slices + 1) rows of `slots`. Integer counts stay exact. */
  readonly counts: Uint32Array;
  readonly sums: Float64Array | null;
  readonly valid: Uint32Array | null;
}

/**
 * Prefix sums over two axes at once: the x and y of a grid dimension (a
 * heatmap or map brush), or two binned dimensions brushed in turn. Each axis
 * is cut into value slices of roughly equal row counts, plus a last slice for
 * missing rows, and every row lands in one (u, v) cell. For each group, a
 * summed-area table gives the aggregate of any block of whole cells from four
 * lookups per bin. A brushed rectangle is a block of whole cells plus a rim
 * of cells it only partly covers, whose rows are tested on their raw values,
 * so results stay exact.
 */
interface Tiles2 {
  readonly u: TileAxis;
  readonly v: TileAxis;
  /** The grid dimension both axes belong to, or null for two binned dimensions. */
  readonly grid: Dim | null;
  /** Row ids by cell; cell (i, j) holds order[offsets[c]..offsets[c + 1]] with c = (i + 1) * (Sv + 2) + j + 1. */
  readonly order: Uint32Array;
  readonly offsets: Uint32Array;
  /** Each row's u and v values in cell order, rounded to float32: brush edges read exact values only on ties. */
  readonly cuv: Float32Array;
  /**
   * One record of `width` per row in cell order: PASS_* flags, then each
   * part's bin (at its `col`), or `none` where filters other than the
   * brush's exclude the row.
   */
  readonly rec: Uint16Array | Uint32Array;
  readonly width: number;
  readonly none: number;
  /** Groups filtered by both axes: (Su + 2) x (Sv + 2) prefix tables. */
  readonly both: TilePart2[];
  /** Two dimensions only: groups on u's dimension (filtered by v alone), and the reverse. */
  readonly alongV: TilePart2[];
  readonly alongU: TilePart2[];
  /** Summed-area table of rows passing every filter but the axes'. */
  readonly total: Uint32Array;
  /**
   * Groups with too many bins to tile at a useful resolution (a fine map
   * grid). They update row by row as the brush moves, so the mask follows
   * the brush every frame ("eager"); otherwise it catches up on `settle`.
   */
  readonly heavy: TilePart2[];
  /** For a lazy grid: the filter its mask bit reflects. */
  synced: Classified;
}

/** A group in 2-D tiles: its prefix tables (none for heavy groups) and its column in the row records. */
interface TilePart2 {
  readonly group: Group;
  readonly slots: number;
  readonly col: number;
  readonly counts: Uint32Array;
  readonly sums: Float64Array | null;
  readonly valid: Uint32Array | null;
}

/** Row flags of 2-D tiles: the row passes u's filter (or the grid's), v's, and every filter but the brush's. */
const PASS_U = 1;
const PASS_V = 2;
const PASS_OTHERS = 4;

type SliceRun = [number, number, number, number];

interface TileAxis {
  readonly dim: Dim;
  /** Raw values; rows in the missing slice never pass a range. */
  readonly values: Float64Array;
  /** Slice i holds values in [edges[i], edges[i + 1]); edges[0] is -Infinity, edges[S] is Infinity. */
  readonly edges: Float64Array;
  /** Number of value slices S; slice S holds the rows missing on this axis. */
  readonly slices: number;
  /** The axis filter [a, b), or null to pass every row, missing ones included. */
  range: AxisRange;
  /** The axis filter the mask reflects, when the tiles keep it current. */
  synced: AxisRange;
}

/** Where an axis of 2-D tiles reads its rows. */
interface AxisSource {
  readonly dim: Dim;
  readonly values: Float64Array;
  /** A row is missing on the axis when `missingBins[row] === missing`. */
  readonly missingBins: Uint32Array;
  readonly missing: number;
  /** The axis' own bin per row and bin edges, to narrow the search for each row's slice. */
  readonly axisBins: Uint32Array;
  readonly binEdges: Float64Array;
}

/** Cells (4-byte units) one set of 2-D tiles may use. */
const TILE_BUDGET_2D = 1 << 24;
/** Most slices per axis of 2-D tiles. */
const MAX_SLICES_2D = 512;
/** Most cells (4-byte units) per table row that 2-D tiles may use. */
const TABLE_CELLS_PER_ROW = 4;
/** Rows (or table cells) a 2-D tile build handles between checks of its time budget. */
const BUILD_CHUNK = 1 << 15;
/**
 * Milliseconds of 2-D tile building an update may add to its frame. Frames
 * that trigger a build are slow ones (tens of milliseconds), so this adds a
 * fraction to them while the build runs.
 */
const BUILD_STEP_MS = 10;

/**
 * A 2-D tile build in progress. It is advanced a time slice at a time, by
 * updates that only move its axes' brushes and by {@link CrossIndex.work};
 * meanwhile those updates are answered incrementally. Any other change
 * cancels it.
 */
interface Build2 {
  /** The dimensions whose filters may change while it runs (the grid twice, or two binned dimensions). */
  readonly u: Dim;
  readonly v: Dim;
  readonly steps: Generator<void, Tiles2 | null, void>;
}

interface Group {
  readonly id: string;
  readonly dim: Dim;
  readonly op: AggregateSpec["op"];
  /** Field values for sum and mean; null for count. */
  readonly field: Float64Array | null;
  /** Rows per bin (last slot: missing). */
  readonly counts: Float64Array;
  /** Sum of non-missing field values per bin. */
  readonly sums: Float64Array;
  /** Non-missing field values per bin, for mean. */
  readonly valid: Float64Array;
}

/**
 * The cross-filter index. Synchronous, single-threaded, no DOM: the worker
 * and local engines both wrap one of these.
 *
 * Every row has a Uint32 mask with bit d set when the row fails dimension d's
 * filter. A group on dimension d aggregates rows whose mask is zero once bit d
 * is ignored ("exclude self"). Changing one filter only visits rows in bins
 * whose state changed, and only rows whose bit flips touch the aggregates.
 * Rows inside a bin are sorted by value, so a range that cuts through a bin
 * only visits the rows between the old and new cut.
 *
 * On large tables, a drag on one binned dimension switches to prefix-sum
 * tiles: one pass builds them, and then every frame costs a few lookups per
 * bin of the other charts, however far the brush moved. A box brush on a grid
 * dimension (a heatmap or map), or two binned dimensions brushed in turn, use
 * 2-D tiles (summed-area tables) the same way, once their frames are slow.
 * Those take seconds to build on the largest tables, so they are built a
 * slice at a time, in each update and in {@link CrossIndex.work}, while the
 * drag goes on incrementally. The first change to any other dimension writes
 * the mask back and drops the tiles (or the build).
 */
export class CrossIndex {
  private table: ColumnTable = { rowCount: 0, columns: {} };
  private mask = new Uint32Array(0);
  private readonly dims = new Map<string, Dim>();
  private readonly groups = new Map<string, Group>();
  private freeBits = 0xffffffff >>> 0;
  /** Rows passing every filter. */
  private selected = 0;
  private tiles: Tiles | null = null;
  private tiles2: Tiles2 | null = null;
  private build2: Build2 | null = null;
  /** Dimensions the previous update changed, and the one before. */
  private lastChanged: Dim[] = [];
  private prevChanged: Dim[] = [];
  private readonly tileMinRows: number;
  /** Size limits for 2-D tiles; tests change them to exercise heavy groups. */
  private tileBudget2 = TILE_BUDGET_2D;
  private tileCellsPerRow = TABLE_CELLS_PER_ROW;
  /** Time slice and chunk size of 2-D tile builds; tests shrink them to spread builds over many updates. */
  private buildStepMs = BUILD_STEP_MS;
  private buildChunk = BUILD_CHUNK;

  constructor(options: CrossIndexOptions = {}) {
    this.tileMinRows = options.tileMinRows ?? 100_000;
  }

  load(table: ColumnTable): void {
    this.tiles = null;
    this.tiles2 = null;
    this.build2 = null;
    this.lastChanged = [];
    this.prevChanged = [];
    this.table = table;
    this.mask = new Uint32Array(table.rowCount);
    this.dims.clear();
    this.groups.clear();
    this.freeBits = 0xffffffff >>> 0;
    this.selected = table.rowCount;
  }

  get rowCount(): number {
    return this.table.rowCount;
  }

  addDimension(id: string, spec: DimensionSpec): DimensionInfo {
    if (this.dims.has(id)) throw new Error(`Dimension "${id}" already exists`);
    if (this.freeBits === 0) throw new Error(`At most ${MAX_DIMENSIONS} dimensions per dashboard`);
    const compiled = compileDimension(this.table, spec);
    this.settle();
    this.build2 = null;
    const bit = 31 - Math.clz32(this.freeBits & -this.freeBits);
    this.freeBits = (this.freeBits & ~(1 << bit)) >>> 0;

    const col = spec.kind === "bin" ? this.table.columns[spec.field] : undefined;
    const values = col && col.type !== "category" ? col.values : null;
    const { order, offsets } = binOrder(compiled.bins, compiled.size, values);
    const lo = offsets.slice(0, compiled.size + 1);
    const hi = offsets.slice(1);
    const dim: Dim = {
      id,
      bit,
      compiled,
      order,
      offsets,
      filterKey: "null",
      filter: null,
      classified: compiled.classify(null),
      values,
      lo,
      hi,
      slow: 0,
      pos: null,
    };
    this.dims.set(id, dim);
    return info(id, compiled);
  }

  removeDimension(id: string): void {
    const dim = this.dims.get(id);
    if (!dim) return;
    this.settle();
    this.build2 = null;
    this.lastChanged = [];
    this.prevChanged = [];
    // Clearing its filter first restores every other group's totals.
    this.setFilter(id, null);
    for (const g of [...this.groups.values()]) if (g.dim === dim) this.groups.delete(g.id);
    this.dims.delete(id);
    this.freeBits = (this.freeBits | (1 << dim.bit)) >>> 0;
  }

  /**
   * Add an aggregate over a dimension's bins. Returns the aggregate with no
   * filters applied (one value per bin), which charts can draw as a baseline.
   */
  addGroup(id: string, dimensionId: string, aggregate: AggregateSpec): Float64Array {
    if (this.groups.has(id)) throw new Error(`Group "${id}" already exists`);
    const dim = this.dims.get(dimensionId);
    if (!dim) throw new Error(`Unknown dimension "${dimensionId}"`);
    this.settle();
    this.build2 = null;
    let field: Float64Array | null = null;
    if (aggregate.op !== "count") {
      const col = this.table.columns[aggregate.field];
      if (!col) throw new Error(`Unknown field "${aggregate.field}"`);
      if (col.type === "category") throw new Error(`${aggregate.op}("${aggregate.field}") needs a numeric column`);
      field = col.values;
    }
    const slots = dim.compiled.size + 1;
    const group: Group = {
      id,
      dim,
      op: aggregate.op,
      field,
      counts: new Float64Array(slots),
      sums: new Float64Array(slots),
      valid: new Float64Array(slots),
    };
    // Full passes to seed the group and its unfiltered baseline.
    const base: Group = {
      ...group,
      counts: new Float64Array(slots),
      sums: new Float64Array(slots),
      valid: new Float64Array(slots),
    };
    accumulate(base, this.mask, 0);
    accumulate(group, this.mask, ~(1 << dim.bit));
    this.groups.set(id, group);
    return values(base);
  }

  removeGroup(id: string): void {
    const uses = (parts: TilePart[] | undefined) => parts?.some((p) => p.group.id === id) === true;
    const t2 = this.tiles2;
    const uses2 = (parts: TilePart2[] | undefined) => parts?.some((p) => p.group.id === id) === true;
    if (uses(this.tiles?.parts) || uses2(t2?.both) || uses2(t2?.alongU) || uses2(t2?.alongV) || uses2(t2?.heavy)) {
      this.settle();
    }
    this.build2 = null;
    this.groups.delete(id);
  }

  /** Apply a full filter state; dimensions absent from it are cleared. */
  update(filters: FilterState, version: number): UpdateResult {
    const changed: [Dim, Filter | null, string][] = [];
    for (const [id, dim] of this.dims) {
      const f = filters[id] ?? null;
      const key = JSON.stringify(f);
      if (key !== dim.filterKey) changed.push([dim, f, key]);
    }
    if (changed.length > 0) {
      if (!this.tileUpdate(changed)) {
        this.settle();
        let stale = false;
        for (const [dim, f, key] of changed) stale = this.apply(dim, f, key, stale) || stale;
        if (stale) this.recount();
      }
      this.prevChanged = this.lastChanged;
      this.lastChanged = changed.map((c) => c[0]);
    }
    return this.result(version);
  }

  setFilter(id: string, filter: Filter | null): void {
    const dim = this.dims.get(id);
    if (!dim) throw new Error(`Unknown dimension "${id}"`);
    const key = JSON.stringify(filter);
    if (key === dim.filterKey) return;
    this.settle();
    this.build2 = null;
    if (this.apply(dim, filter, key, false)) this.recount();
  }

  /**
   * Update the mask for one dimension's new filter (no tiles may be active).
   * Small changes also update the aggregates, row by row. A change that flips
   * a large share of rows, or any change once the aggregates are `stale`, only
   * rewrites the mask; then it returns true and the caller must `recount()`.
   */
  private apply(dim: Dim, filter: Filter | null, key: string, stale: boolean): boolean {
    const next = dim.compiled.classify(filter);
    const prev = dim.classified;
    const size = dim.compiled.size;
    const { order, offsets } = dim;
    const nextCuts = dim.values !== null ? cuts(dim, next, filter) : null;

    let flips = 0;
    for (let b = 0; b <= size; b++) {
      if (nextCuts !== null) {
        flips += Math.abs(nextCuts.lo[b]! - dim.lo[b]!) + Math.abs(nextCuts.hi[b]! - dim.hi[b]!);
      } else if (prev.state[b] !== next.state[b] || next.state[b] === PARTIAL) {
        flips += offsets[b + 1]! - offsets[b]!;
      }
    }
    dim.classified = next;
    dim.filterKey = key;
    dim.filter = filter;
    // Work for this update: visited rows times the groups they update.
    const work =
      (stale || flips > this.table.rowCount * RECOUNT_SHARE ? this.table.rowCount : flips) * this.groups.size;
    dim.slow = work >= this.slowWork() ? dim.slow + 1 : 0;
    if (stale || flips > this.table.rowCount * RECOUNT_SHARE) {
      this.rewriteBit(dim, next);
      if (nextCuts !== null) {
        dim.lo = nextCuts.lo;
        dim.hi = nextCuts.hi;
      }
      return true;
    }

    const bit = 1 << dim.bit;
    const others = [...this.groups.values()].filter((g) => g.dim !== dim);
    const ignores = others.map((g) => ~(1 << g.dim.bit));
    const mask = this.mask;

    if (nextCuts !== null) {
      // Sorted bins: a bin's passing rows are one slice, so only rows between
      // the old and the new cuts can change.
      const { lo, hi } = nextCuts;
      for (let b = 0; b <= size; b++) {
        const p0 = dim.lo[b]!;
        const p1 = dim.hi[b]!;
        const q0 = lo[b]!;
        const q1 = hi[b]!;
        if (p0 === q0 && p1 === q1) continue;
        for (const [k0, k1] of changedRuns(p0, p1, q0, q1)) this.flip(order, k0, k1, q0, q1, bit, others, ignores);
      }
      dim.lo = lo;
      dim.hi = hi;
      return false;
    }

    const test = next.test;
    for (let b = 0; b <= size; b++) {
      const s0 = prev.state[b]!;
      const s1 = next.state[b]!;
      // A bin that is wholly in or wholly out both times cannot change.
      if (s0 === s1 && s0 !== PARTIAL) continue;
      const end = offsets[b + 1]!;
      for (let k = offsets[b]!; k < end; k++) {
        const r = order[k]!;
        const m = mask[r]!;
        const failsNow = s1 === OUT ? true : s1 === IN ? false : !test!(r);
        const failed = (m & bit) !== 0;
        if (failsNow === failed) continue;
        const rest = m & ~bit;
        const sign = failsNow ? -1 : 1;
        mask[r] = failsNow ? m | bit : rest;
        if (rest === 0) this.selected += sign;
        for (let g = 0; g < others.length; g++) {
          if ((rest & ignores[g]!) === 0) {
            const grp = others[g]!;
            add(grp, grp.dim.compiled.bins[r]!, r, sign);
          }
        }
      }
    }
    return false;
  }

  /** Recompute one dimension's mask bit for every row, in row order. */
  private rewriteBit(dim: Dim, classified: Classified): void {
    const mask = this.mask;
    const bins = dim.compiled.bins;
    const { state, test } = classified;
    const bit = 1 << dim.bit;
    for (let r = 0; r < mask.length; r++) {
      const s = state[bins[r]!]!;
      const passes = s === IN || (s === PARTIAL && test!(r));
      mask[r] = passes ? mask[r]! & ~bit : mask[r]! | bit;
    }
  }

  /** Recompute every group and `selected` from the mask, in row order. */
  private recount(): void {
    const mask = this.mask;
    let selected = 0;
    for (let r = 0; r < mask.length; r++) if (mask[r] === 0) selected++;
    this.selected = selected;
    for (const g of this.groups.values()) {
      g.counts.fill(0);
      g.sums.fill(0);
      g.valid.fill(0);
      accumulate(g, mask, ~(1 << g.dim.bit));
    }
  }

  /** Set or clear the row's bit for positions k0..k1 of `order`: it passes when q0 <= k < q1. */
  private flip(
    order: Uint32Array,
    k0: number,
    k1: number,
    q0: number,
    q1: number,
    bit: number,
    others: Group[],
    ignores: number[],
  ): void {
    const mask = this.mask;
    for (let k = k0; k < k1; k++) {
      const r = order[k]!;
      const m = mask[r]!;
      const failsNow = k < q0 || k >= q1;
      if (failsNow === ((m & bit) !== 0)) continue;
      const rest = m & ~bit;
      const sign = failsNow ? -1 : 1;
      mask[r] = failsNow ? m | bit : rest;
      if (rest === 0) this.selected += sign;
      for (let g = 0; g < others.length; g++) {
        if ((rest & ignores[g]!) === 0) {
          const grp = others[g]!;
          add(grp, grp.dim.compiled.bins[r]!, r, sign);
        }
      }
    }
  }

  /**
   * Try to answer a filter change from tiles, building them if the gesture
   * looks like it will continue. Returns false to update incrementally.
   */
  private tileUpdate(changed: [Dim, Filter | null, string][]): boolean {
    if (this.table.rowCount < this.tileMinRows) return false;
    const t2 = this.tiles2;
    if (t2 !== null && changed.every(([d]) => d === t2.u.dim || d === t2.v.dim)) {
      if (this.setAxes(t2, changed)) {
        this.readTiles2(t2);
        return true;
      }
      return false;
    }
    const job = this.build2;
    if (job !== null) {
      if (changed.every(([d]) => d === job.u || d === job.v)) return this.continueBuild(changed);
      this.build2 = null;
    }
    const last = this.lastChanged;
    const prev = this.prevChanged;
    if (changed.length === 1) {
      const [dim, filter, key] = changed[0]!;
      if (dim.compiled.y !== null) return this.gridTiles(dim, changed);
      // Two brushes moving in turn (A, B, A): tile both together.
      const other = last.length === 1 ? last[0]! : null;
      if (other !== null && other !== dim && other.values !== null && prev.length === 1 && prev[0] === dim) {
        const slow = dim.slow > 0 && other.slow > 0;
        if (dim.values !== null && slow) {
          if (this.pairTiles(dim, other, changed)) return true;
          // Building in the background: stay incremental rather than build 1-D tiles meanwhile.
          if (this.build2 !== null) return false;
        }
      }
      return this.tileUpdate1(dim, filter, key);
    }
    // Two brushes moving together, frame after frame.
    if (changed.length === 2 && last.length === 2) {
      const [a, b] = [changed[0]![0], changed[1]![0]];
      const slow = a.slow > 0 && b.slow > 0;
      if (a.values !== null && b.values !== null && slow && last.includes(a) && last.includes(b)) {
        return this.pairTiles(a, b, changed);
      }
    }
    return false;
  }

  /**
   * Row-group updates above which an incremental update counts as slow:
   * 2-D tiles are only built for drags whose frames keep being slow.
   */
  private slowWork(): number {
    return this.tileMinRows * 4;
  }

  /** Whether the last two updates changed this dimension alone. */
  private dragging(dim: Dim): boolean {
    const { lastChanged: last, prevChanged: prev } = this;
    return last.length === 1 && last[0] === dim && prev.length === 1 && prev[0] === dim;
  }

  /** One-dimensional tiles on a binned dimension, for a drag on it alone. */
  private tileUpdate1(dim: Dim, filter: Filter | null, key: string): boolean {
    const n = this.table.rowCount;
    if (dim.values === null) return false;
    if (filter !== null && !("range" in filter)) return false;
    const classified = dim.compiled.classify(filter);
    const next = cuts(dim, classified, filter);
    const run = span(next.lo, next.hi);
    if (run === null) return false;

    let tiles = this.tiles;
    if (tiles?.dim !== dim) {
      if (!(this.lastChanged.length === 1 && this.lastChanged[0] === dim)) {
        let flips = 0;
        for (let b = 0; b < next.lo.length; b++) {
          flips += Math.abs(next.lo[b]! - dim.lo[b]!) + Math.abs(next.hi[b]! - dim.hi[b]!);
        }
        if (flips < n * TILE_FLIP_SHARE) return false;
      }
      this.settle();
      tiles = this.buildTiles(dim);
      if (tiles === null) return false;
      this.tiles = tiles;
    }
    dim.classified = classified;
    dim.filterKey = key;
    dim.filter = filter;
    tiles.lo = next.lo;
    tiles.hi = next.hi;
    this.readTiles(tiles, run[0], run[1]);
    return true;
  }

  private buildTiles(dim: Dim): Tiles | null {
    const n = this.table.rowCount;
    const parts = [...this.groups.values()].filter((g) => g.dim !== dim);
    let cells = 1;
    for (const g of parts) cells += (g.dim.compiled.size + 1) * (g.field === null ? 1 : 3);
    const slices = Math.min(MAX_SLICES, Math.floor(TILE_BUDGET / cells));
    if (slices < 2) return null;
    const shift = Math.max(MIN_SLICE_SHIFT, Math.ceil(Math.log2(n / slices)));
    const rows = (n >>> shift) + 2; // prefix rows 0..S, where S = ceil(n / 2^shift)

    let pos = dim.pos;
    if (pos === null) {
      pos = new Uint32Array(n);
      const order = dim.order;
      for (let k = 0; k < n; k++) pos[order[k]!] = k;
      dim.pos = pos;
    }
    const mask = this.mask;
    const notActive = ~(1 << dim.bit);

    const total = new Uint32Array(rows);
    const tileParts: TilePart[] = parts.map((group) => {
      const cells = rows * (group.dim.compiled.size + 1);
      const numeric = group.field !== null;
      return {
        group,
        slots: group.dim.compiled.size + 1,
        keep: notActive & ~(1 << group.dim.bit),
        bins: group.dim.compiled.bins,
        counts: new Uint32Array(cells),
        sums: numeric ? new Float64Array(cells) : null,
        valid: numeric ? new Uint32Array(cells) : null,
      };
    });
    // Rows land in the table row of their slice, (pos >> shift) + 1, so that
    // row 0 stays zero. One tight pass per table, in row order.
    for (let r = 0; r < n; r++) if ((mask[r]! & notActive) === 0) total[(pos[r]! >>> shift) + 1]!++;
    for (const p of tileParts) {
      const { keep, slots, bins, counts, sums, valid } = p;
      const field = p.group.field;
      if (sums === null || valid === null || field === null) {
        for (let r = 0; r < n; r++) {
          if ((mask[r]! & keep) === 0) counts[((pos[r]! >>> shift) + 1) * slots + bins[r]!]!++;
        }
        continue;
      }
      for (let r = 0; r < n; r++) {
        if ((mask[r]! & keep) !== 0) continue;
        const c = ((pos[r]! >>> shift) + 1) * slots + bins[r]!;
        counts[c]!++;
        const v = field[r]!;
        if (!Number.isNaN(v)) {
          sums[c]! += v;
          valid[c]!++;
        }
      }
    }
    prefix(total, 1);
    for (const p of tileParts) {
      prefix(p.counts, p.slots);
      if (p.sums !== null) prefix(p.sums, p.slots);
      if (p.valid !== null) prefix(p.valid, p.slots);
    }
    return { dim, shift, parts: tileParts, total, lo: dim.lo, hi: dim.hi };
  }

  /** Write every other group's aggregates and `selected` for positions k0..k1 of the active dimension. */
  private readTiles(tiles: Tiles, k0: number, k1: number): void {
    const { shift, parts, total } = tiles;
    const s0 = (k0 + (1 << shift) - 1) >>> shift;
    const s1 = k1 >>> shift;
    const whole = s0 <= s1;
    let selected = whole ? total[s1]! - total[s0]! : 0;
    for (const p of parts) {
      const g = p.group;
      const { slots } = p;
      if (!whole) {
        g.counts.fill(0);
        g.sums.fill(0);
        g.valid.fill(0);
        continue;
      }
      diff(g.counts, p.counts, s0 * slots, s1 * slots, slots);
      if (p.sums !== null && p.valid !== null) {
        diff(g.sums, p.sums, s0 * slots, s1 * slots, slots);
        diff(g.valid, p.valid, s0 * slots, s1 * slots, slots);
      }
    }
    // Ragged ends: rows in partly covered slices, one at a time.
    const order = tiles.dim.order;
    const mask = this.mask;
    const notActive = ~(1 << tiles.dim.bit);
    const ends = whole ? [k0, s0 << shift, s1 << shift, k1] : [k0, k1];
    for (let e = 0; e < ends.length; e += 2) {
      const end = ends[e + 1]!;
      for (let k = ends[e]!; k < end; k++) {
        const r = order[k]!;
        const m = mask[r]!;
        if ((m & notActive) === 0) selected++;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i]!;
          if ((m & p.keep) === 0) add(p.group, p.bins[r]!, r, 1);
        }
      }
    }
    this.selected = selected;
  }

  /** 2-D tiles for a brush on a grid dimension. */
  private gridTiles(dim: Dim, changed: [Dim, Filter | null, string][]): boolean {
    const { x, y } = dim.compiled;
    if (y === null || x.info.kind !== "bin" || y.info.kind !== "bin") return false;
    // Only for a drag whose last two frames were slow without tiles, from one box to another.
    if (!this.dragging(dim) || dim.slow < 2) return false;
    if (axisRanges(dim, changed[0]![1]) === null || axisRanges(dim, dim.filter) === null) return false;
    const xv = this.table.columns[x.info.field];
    const yv = this.table.columns[y.info.field];
    if (!xv || !yv || xv.type === "category" || yv.type === "category") return false;
    this.settle();
    // A row missing from the grid (on either axis, or outside its extent) is missing on both.
    const { bins, size } = dim.compiled;
    const steps = this.buildTiles2(
      { dim, values: xv.values, missingBins: bins, missing: size, axisBins: x.bins, binEdges: x.info.edges },
      { dim, values: yv.values, missingBins: bins, missing: size, axisBins: y.bins, binEdges: y.info.edges },
      dim,
    );
    this.build2 = { u: dim, v: dim, steps };
    return this.continueBuild(changed);
  }

  /** 2-D tiles over two binned dimensions brushed in turn or together. */
  private pairTiles(a: Dim, b: Dim, changed: [Dim, Filter | null, string][]): boolean {
    const filterOf = (d: Dim) => {
      const c = changed.find(([x]) => x === d);
      return c ? c[1] : d.filter;
    };
    if (axisRanges(a, filterOf(a)) === null || axisRanges(b, filterOf(b)) === null) return false;
    this.settle();
    const axis = (d: Dim): AxisSource => ({
      dim: d,
      values: d.values!,
      missingBins: d.compiled.bins,
      missing: d.compiled.size,
      axisBins: d.compiled.bins,
      binEdges: d.compiled.x.info.edges,
    });
    this.build2 = { u: a, v: b, steps: this.buildTiles2(axis(a), axis(b), null) };
    return this.continueBuild(changed);
  }

  /**
   * Spend a time slice on the pending 2-D tile build. Once it is done, answer
   * this update from the new tiles; until then, return false so the update
   * runs incrementally (which keeps the mask current for the build's last step).
   */
  private continueBuild(changed: [Dim, Filter | null, string][]): boolean {
    if (changed.some(([d, f]) => axisRanges(d, f) === null)) {
      this.build2 = null;
      return false;
    }
    const tiles = this.advanceBuild(this.buildStepMs);
    if (tiles === null) return false;
    this.setAxes(tiles, changed);
    this.readTiles2(tiles);
    return true;
  }

  /**
   * Run the pending build for up to `ms` milliseconds (at least one step).
   * Returns the tiles, now active, when it finishes; null while it continues
   * or if it gave up.
   */
  private advanceBuild(ms: number): Tiles2 | null {
    const job = this.build2;
    if (job === null) return null;
    // Small tables build in one go: a few chunks take only milliseconds.
    const end = this.table.rowCount <= this.buildChunk * 8 ? Number.POSITIVE_INFINITY : performance.now() + ms;
    for (;;) {
      const step = job.steps.next();
      if (step.done) {
        this.build2 = null;
        if (step.value === null) return null;
        // The build reads the mask, so no other tiles may be ahead of it (updates during it settle them).
        this.settle();
        this.tiles2 = step.value;
        return step.value;
      }
      if (performance.now() >= end) return null;
    }
  }

  /**
   * Whether background work is pending: a 2-D tile build for a box drag, or
   * two range brushes moved in turn, on a large table. Call {@link work} in
   * idle time to finish it sooner; updates also advance it.
   */
  get pending(): boolean {
    return this.build2 !== null;
  }

  /**
   * Spend up to `ms` milliseconds on pending background work (see
   * {@link pending}), at least one small step. Results don't change. Returns
   * whether work remains. The worker engine calls this between messages.
   */
  work(ms: number): boolean {
    this.advanceBuild(ms);
    return this.build2 !== null;
  }

  /** Point the tiles' axes at the changed filters; false (and nothing changed) if one is not a range. */
  private setAxes(tiles: Tiles2, changed: [Dim, Filter | null, string][]): boolean {
    const ranges = changed.map(([d, f]) => axisRanges(d, f));
    if (ranges.some((r) => r === null)) return false;
    changed.forEach(([dim, filter, key], i) => {
      const [ru, rv] = ranges[i]!;
      dim.classified = dim.compiled.classify(filter);
      dim.filterKey = key;
      dim.filter = filter;
      if (tiles.grid !== null) {
        tiles.u.range = ru;
        tiles.v.range = rv;
      } else if (dim === tiles.u.dim) {
        tiles.u.range = ru;
      } else {
        tiles.v.range = ru;
      }
    });
    return true;
  }

  /**
   * Build 2-D tiles a chunk at a time: the generator yields after every
   * `buildChunk` rows (or table entries), so a build can spread over many
   * frames and idle time. It reads only filters other than the axes', which
   * can't change while it runs (any other change cancels it), and the axes'
   * current filters on its last step.
   */
  private *buildTiles2(ua: AxisSource, va: AxisSource, grid: Dim | null): Generator<void, Tiles2 | null, void> {
    const n = this.table.rowCount;
    const chunk = this.buildChunk;
    const mask = this.mask;
    const bits = grid !== null ? 1 << grid.bit : (1 << ua.dim.bit) | (1 << va.dim.bit);
    const notActive = ~bits;
    const both: Group[] = [];
    const alongV: Group[] = [];
    const alongU: Group[] = [];
    for (const g of this.groups.values()) {
      if (grid !== null) {
        if (g.dim !== grid) both.push(g);
      } else if (g.dim === ua.dim) alongV.push(g);
      else if (g.dim === va.dim) alongU.push(g);
      else both.push(g);
    }
    // Tables are capped by the budget and by a few cells per row. Tile the
    // groups with the fewest bins first; a group that would halve the slices
    // is left to update row by row ("heavy").
    const budget = Math.min(this.tileBudget2, n * this.tileCellsPerRow);
    const weight = (g: Group) => (g.dim.compiled.size + 1) * (g.field === null ? 1 : 3);
    const fit = (cells: number) => Math.min(MAX_SLICES_2D, Math.floor(Math.sqrt(budget / cells)) - 2);
    both.sort((a, b) => weight(a) - weight(b));
    let cells = 1;
    let light = 0;
    while (light < both.length && fit(cells + weight(both[light]!)) * 2 >= fit(cells)) cells += weight(both[light++]!);
    const heavy = both.splice(light);
    const slices = fit(cells);
    if (slices < 2) return null;

    const u = yield* sliceAxis(ua, slices, chunk);
    const v = yield* sliceAxis(va, slices, chunk);
    const su = u.edges.length - 1;
    const sv = v.edges.length - 1;
    const stride = sv + 2;
    const rows = (su + 2) * stride;

    // Rows sorted by cell: cell (i, j) is table row c = (i + 1) * stride + j + 1, so row 0 and column 0 stay zero.
    const us = u.slice;
    const vs = v.slice;
    const offsets = new Uint32Array(rows + 1);
    for (let r0 = 0; r0 < n; r0 += chunk) {
      const r1 = Math.min(n, r0 + chunk);
      for (let r = r0; r < r1; r++) offsets[(us[r]! + 1) * stride + vs[r]! + 2]!++;
      yield;
    }
    for (let c = 0; c < rows; c++) offsets[c + 1]! += offsets[c]!;
    // One record per row in cell order: flags, then each group's bin (or `none` if other filters exclude the row).
    const tiled = [...both, ...alongV, ...alongU, ...heavy];
    const width = tiled.length + 1;
    const wide = tiled.some((g) => g.dim.compiled.size + 1 >= 0xffff);
    const none = wide ? 0xffffffff : 0xffff;
    const out: CellRows = {
      order: new Uint32Array(n),
      cuv: new Float32Array(2 * n),
      rec: wide ? new Uint32Array(n * width) : new Uint16Array(n * width),
      width,
      none,
      cursor: offsets.slice(0, rows),
      stride,
    };
    // Fresh memory is mapped on first write; do that up front, a slice at a time, not all in the first scattered chunk.
    for (const a of [out.order, out.cuv, out.rec]) yield* touch(a, chunk * 32);
    const keeps = Int32Array.from(tiled, (g) => notActive & ~(1 << g.dim.bit));
    const binsOf = tiled.map((g) => g.dim.compiled.bins);
    for (let r0 = 0; r0 < n; r0 += chunk) {
      fillRows(out, mask, notActive, keeps, binsOf, us, vs, ua.values, va.values, r0, Math.min(n, r0 + chunk));
      yield;
    }
    const { order, cuv, rec } = out;

    // Tables, filled cell by cell so each cell's writes stay close together.
    const part = (g: Group, col: number, tableRows: number): TilePart2 => {
      const slots = g.dim.compiled.size + 1;
      const numeric = g.field !== null && tableRows > 0;
      return {
        group: g,
        slots,
        col,
        counts: new Uint32Array(tableRows * slots),
        sums: numeric ? new Float64Array(tableRows * slots) : null,
        valid: numeric ? new Uint32Array(tableRows * slots) : null,
      };
    };
    let col = 1;
    const bothParts = both.map((g) => part(g, col++, rows));
    const vParts = alongV.map((g) => part(g, col++, sv + 2));
    const uParts = alongU.map((g) => part(g, col++, su + 2));
    const heavyParts = heavy.map((g) => part(g, col++, 0));
    const total = new Uint32Array(rows);
    let done = 0;
    for (let c = 0; c < rows; c++) {
      const k0 = offsets[c]!;
      const k1 = offsets[c + 1]!;
      if (k0 === k1) continue;
      for (let k = k0; k < k1; k++) if ((rec[k * width]! & PASS_OTHERS) !== 0) total[c]!++;
      for (const p of bothParts) tally(p, rec, width, none, order, k0, k1, c);
      for (const p of vParts) tally(p, rec, width, none, order, k0, k1, c % stride);
      for (const p of uParts) tally(p, rec, width, none, order, k0, k1, Math.floor(c / stride));
      done += k1 - k0;
      if (done >= chunk) {
        done = 0;
        yield;
      }
    }
    // Summed-area tables a row of cells at a time: prefix along the row, then add the row before.
    const tables: [Float64Array | Uint32Array, number][] = [[total, 1]];
    for (const p of bothParts) {
      tables.push([p.counts, p.slots]);
      if (p.sums !== null) tables.push([p.sums, p.slots]);
      if (p.valid !== null) tables.push([p.valid, p.slots]);
    }
    for (const [t, slots] of tables) {
      const row = stride * slots;
      for (let base = 0; base < t.length; base += row) {
        prefixRow(t, slots, base, row);
        done += row;
        // A table entry costs far less than a row of the other passes.
        if (done >= chunk * 8) {
          done = 0;
          yield;
        }
      }
    }
    for (const p of [...vParts, ...uParts]) {
      prefix(p.counts, p.slots);
      if (p.sums !== null) prefix(p.sums, p.slots);
      if (p.valid !== null) prefix(p.valid, p.slots);
    }

    // The axes' filters as the mask reflects them (a range each: other filters cancel the build).
    const ranges = (): [AxisRange, AxisRange] | null => {
      if (grid !== null) return axisRanges(grid, grid.filter);
      const fu = axisRanges(ua.dim, ua.dim.filter);
      const fv = axisRanges(va.dim, va.dim.filter);
      return fu === null || fv === null ? null : [fu[0], fv[0]];
    };
    const r0 = ranges();
    if (r0 === null) return null;
    const tiles: Tiles2 = {
      u: { dim: ua.dim, values: ua.values, edges: u.edges, slices: su, range: r0[0], synced: r0[0] },
      v: { dim: va.dim, values: va.values, edges: v.edges, slices: sv, range: r0[1], synced: r0[1] },
      grid,
      order,
      offsets,
      cuv,
      rec,
      width,
      none,
      both: bothParts,
      alongV: vParts,
      alongU: uParts,
      total,
      heavy: heavyParts,
      synced: grid?.classified ?? ua.dim.classified,
    };
    if (heavyParts.length > 0) {
      // Heavy groups will follow the brush from the mask, so each row's axis
      // flags must match the mask. Set them for the filters as they are now,
      // over several steps, then on the last step fix the cells that the
      // brush has moved across since.
      yield* passFlags(tiles, null, chunk);
    }
    const r1 = ranges();
    if (r1 === null) return null;
    tiles.u.range = tiles.u.synced = r1[0];
    tiles.v.range = tiles.v.synced = r1[1];
    tiles.synced = grid?.classified ?? ua.dim.classified;
    if (heavyParts.length > 0) {
      const fix = passFlags(tiles, r0, Number.POSITIVE_INFINITY);
      while (!fix.next().done);
    }
    return tiles;
  }

  /** Recompute every tiled group and `selected` for the tiles' current axis ranges. */
  private readTiles2(tiles: Tiles2): void {
    const { u, v, order, offsets, both, total, rec, width, none } = tiles;
    const ru = sliceRun(u);
    const rv = sliceRun(v);
    const [tu0, fu0, fu1, tu1] = ru;
    const [tv0, fv0, fv1, tv1] = rv;
    const stride = v.slices + 2;

    // Whole cells: four lookups per bin.
    const c00 = fu0 * stride + fv0;
    const c01 = fu0 * stride + fv1;
    const c10 = fu1 * stride + fv0;
    const c11 = fu1 * stride + fv1;
    let selected = total[c11]! - total[c01]! - total[c10]! + total[c00]!;
    for (const p of both) {
      const g = p.group;
      const k = p.slots;
      sat(g.counts, p.counts, c00 * k, c01 * k, c10 * k, c11 * k, k);
      if (p.sums !== null && p.valid !== null) {
        sat(g.sums, p.sums, c00 * k, c01 * k, c10 * k, c11 * k, k);
        sat(g.valid, p.valid, c00 * k, c01 * k, c10 * k, c11 * k, k);
      }
    }
    // The rim: cells in the touched block but outside the whole one, row by row.
    const tu = new EdgeTest(u, tiles, 0);
    const tv = new EdgeTest(v, tiles, 1);
    for (let i = tu0; i < tu1; i++) {
      const wholeU = i >= fu0 && i < fu1;
      // In a whole column only the cells above and below the whole block are rim.
      const runs = wholeU ? [tv0, fv0, fv1, tv1] : [tv0, tv1];
      for (let e = 0; e < runs.length; e += 2) {
        for (let j = runs[e]!; j < runs[e + 1]!; j++) {
          const wholeV = j >= fv0 && j < fv1;
          const c = (i + 1) * stride + j + 1;
          const end = offsets[c + 1]!;
          for (let k = offsets[c]!; k < end; k++) {
            if (!wholeU && !tu.passes(k)) continue;
            if (!wholeV && !tv.passes(k)) continue;
            const base = k * width;
            if ((rec[base]! & PASS_OTHERS) !== 0) selected++;
            for (let q = 0; q < both.length; q++) {
              const p = both[q]!;
              const b = rec[base + p.col]!;
              if (b !== none) add(p.group, b, order[k]!, 1);
            }
          }
        }
      }
    }
    this.selected = selected;
    readAlong(tiles, tiles.alongV, tv, rv, false);
    readAlong(tiles, tiles.alongU, tu, ru, true);
    if (tiles.heavy.length > 0) this.followBrush(tiles, tu, tv, ru, rv);
  }

  /**
   * Move the axes' mask bits from their synced ranges to the current ones,
   * updating the heavy groups for every row that flips. Only cells whose
   * state changes, or that a range cuts through, are visited.
   */
  private followBrush(tiles: Tiles2, tu: EdgeTest, tv: EdgeTest, nu: SliceRun, nv: SliceRun): void {
    const { u, v, grid, offsets } = tiles;
    const stride = v.slices + 2;
    const pu = sliceRun({ ...u, range: u.synced });
    const pv = sliceRun({ ...v, range: v.synced });
    if (grid !== null) {
      // One bit; a row passes when its cell is in on both axes.
      const [i0, i1] = [Math.min(pu[0], nu[0]), Math.max(pu[3], nu[3])];
      const [j0, j1] = [Math.min(pv[0], nv[0]), Math.max(pv[3], nv[3])];
      for (let i = i0; i < i1; i++) {
        const a0 = cellState(i, pu);
        const a1 = cellState(i, nu);
        if (a0 === OUT && a1 === OUT) continue;
        for (let j = j0; j < j1; j++) {
          const b0 = cellState(j, pv);
          const b1 = cellState(j, nv);
          const s0 = a0 === OUT || b0 === OUT ? OUT : a0 === IN && b0 === IN ? IN : PARTIAL;
          const s1 = a1 === OUT || b1 === OUT ? OUT : a1 === IN && b1 === IN ? IN : PARTIAL;
          if (s0 === s1 && s0 !== PARTIAL) continue;
          const c = (i + 1) * stride + j + 1;
          const testU = a1 === IN ? null : tu;
          const testV = b1 === IN ? null : tv;
          this.flipRows(tiles, offsets[c]!, offsets[c + 1]!, 1 << grid.bit, PASS_U, 0, s1, testU, testV);
        }
      }
      tiles.synced = grid.classified;
    } else {
      // Two bits, one per axis: walk the changed slices of each axis across the other.
      for (const [p, q, isU] of [
        [pu, nu, true],
        [pv, nv, false],
      ] as const) {
        const bit = 1 << (isU ? u : v).dim.bit;
        const [flag, need] = isU ? [PASS_U, PASS_V] : [PASS_V, PASS_U];
        for (let i = Math.min(p[0], q[0]); i < Math.max(p[3], q[3]); i++) {
          const s0 = cellState(i, p);
          const s1 = cellState(i, q);
          if (s0 === s1 && s0 !== PARTIAL) continue;
          const test = s1 !== PARTIAL ? null : isU ? tu : tv;
          if (isU) {
            // Slice i of u is one run of cells.
            const k0 = offsets[(i + 1) * stride + 1]!;
            const k1 = offsets[(i + 1) * stride + v.slices + 2]!;
            this.flipRows(tiles, k0, k1, bit, flag, need, s1, test, null);
          } else {
            for (let j = 0; j <= u.slices; j++) {
              const c = (j + 1) * stride + i + 1;
              this.flipRows(tiles, offsets[c]!, offsets[c + 1]!, bit, flag, need, s1, test, null);
            }
          }
        }
      }
    }
    u.synced = u.range;
    v.synced = v.range;
  }

  /**
   * Set the mask bit `bit` (pass flag `flag`) for rows k0..k1 in cell order:
   * in, out, or tested on the given axes. Rows that flip update the heavy
   * groups, if they also pass the other axis (`need`).
   */
  private flipRows(
    tiles: Tiles2,
    k0: number,
    k1: number,
    bit: number,
    flag: number,
    need: number,
    state: number,
    tu: EdgeTest | null,
    tv: EdgeTest | null,
  ): void {
    const { order, rec, width, none, heavy } = tiles;
    const mask = this.mask;
    for (let k = k0; k < k1; k++) {
      let passes = state !== OUT;
      if (state === PARTIAL) passes = (tu === null || tu.passes(k)) && (tv === null || tv.passes(k));
      const base = k * width;
      const f = rec[base]!;
      if (passes === ((f & flag) !== 0)) continue;
      rec[base] = f ^ flag;
      const r = order[k]!;
      mask[r] = passes ? mask[r]! & ~bit : mask[r]! | bit;
      if ((f & need) !== need) continue;
      const sign = passes ? 1 : -1;
      for (let g = 0; g < heavy.length; g++) {
        const h = heavy[g]!;
        const b = rec[base + h.col]!;
        if (b !== none) add(h.group, b, r, sign);
      }
    }
  }

  /** Bring the mask up to date with the tiled filters, keeping the tiles. */
  private syncMask(): void {
    const tiles = this.tiles;
    if (tiles !== null) this.writeCuts(tiles.dim, tiles.lo, tiles.hi);
    const t2 = this.tiles2;
    if (t2 === null) return;
    if (t2.heavy.length > 0) {
      // The mask already follows the brush; only the binned dimensions' cuts are behind.
      if (t2.grid === null) {
        for (const dim of [t2.u.dim, t2.v.dim]) {
          const next = cuts(dim, dim.classified, dim.filter);
          dim.lo = next.lo;
          dim.hi = next.hi;
        }
      }
      return;
    }
    if (t2.grid !== null) {
      this.writeBins(t2.grid, t2.synced, t2.grid.classified);
      t2.synced = t2.grid.classified;
      return;
    }
    for (const dim of [t2.u.dim, t2.v.dim]) {
      const next = cuts(dim, dim.classified, dim.filter);
      this.writeCuts(dim, next.lo, next.hi);
    }
  }

  /** Set a sorted binned dimension's mask bit for its passing slices `lo`/`hi` (aggregates untouched). */
  private writeCuts(dim: Dim, lo: Uint32Array, hi: Uint32Array): void {
    if (lo === dim.lo && hi === dim.hi) return;
    const mask = this.mask;
    const bit = 1 << dim.bit;
    const order = dim.order;
    let flips = 0;
    for (let b = 0; b < lo.length; b++) flips += Math.abs(lo[b]! - dim.lo[b]!) + Math.abs(hi[b]! - dim.hi[b]!);
    if (flips > this.table.rowCount / 8 && dim.pos !== null) {
      // One sequential pass beats scattered writes when much of the table flips.
      const pos = dim.pos;
      const bins = dim.compiled.bins;
      for (let r = 0; r < mask.length; r++) {
        const k = pos[r]!;
        const b = bins[r]!;
        mask[r] = k >= lo[b]! && k < hi[b]! ? mask[r]! & ~bit : mask[r]! | bit;
      }
    } else {
      for (let b = 0; b < lo.length; b++) {
        const p0 = dim.lo[b]!;
        const p1 = dim.hi[b]!;
        const q0 = lo[b]!;
        const q1 = hi[b]!;
        if (p0 === q0 && p1 === q1) continue;
        for (const [k0, k1] of changedRuns(p0, p1, q0, q1)) {
          for (let k = k0; k < k1; k++) {
            const r = order[k]!;
            mask[r] = k >= q0 && k < q1 ? mask[r]! & ~bit : mask[r]! | bit;
          }
        }
      }
    }
    dim.lo = lo;
    dim.hi = hi;
  }

  /** Move a dimension's mask bit from `prev` to `next`, visiting only bins that change or are cut. */
  private writeBins(dim: Dim, prev: Classified, next: Classified): void {
    if (prev === next) return;
    const mask = this.mask;
    const bit = 1 << dim.bit;
    const { order, offsets } = dim;
    const test = next.test;
    for (let b = 0; b < next.state.length; b++) {
      const s0 = prev.state[b]!;
      const s1 = next.state[b]!;
      if (s0 === s1 && s0 !== PARTIAL) continue;
      const end = offsets[b + 1]!;
      for (let k = offsets[b]!; k < end; k++) {
        const r = order[k]!;
        const passes = s1 === IN || (s1 === PARTIAL && test!(r));
        mask[r] = passes ? mask[r]! & ~bit : mask[r]! | bit;
      }
    }
  }

  /** Leave tile mode: sync the mask and drop the tiles. Group aggregates are already current. */
  private settle(): void {
    this.syncMask();
    this.tiles = null;
    this.tiles2 = null;
  }

  result(version: number): UpdateResult {
    const groups: Record<string, GroupResult> = {};
    for (const g of this.groups.values()) {
      const counts = g.counts.slice(0, g.dim.compiled.size);
      groups[g.id] = { id: g.id, dimension: g.dim.id, values: values(g), counts };
    }
    return { version, selected: this.selected, total: this.table.rowCount, groups };
  }

  /** Rows passing every filter, optionally sorted ("-field" for descending) and paged. */
  rows(query: RowsQuery = {}): RowsResult {
    this.syncMask();
    const mask = this.mask;
    const ids = new Uint32Array(this.selected);
    let n = 0;
    for (let r = 0; r < mask.length; r++) if (mask[r] === 0) ids[n++] = r;

    const columns = query.columns ?? Object.keys(this.table.columns);
    if (query.sort) {
      const desc = query.sort.startsWith("-");
      const field = desc ? query.sort.slice(1) : query.sort;
      const col = this.table.columns[field];
      if (!col) throw new Error(`Unknown sort field "${field}"`);
      const dir = desc ? -1 : 1;
      let keyOf: (r: number) => number | string;
      if (col.type === "category") keyOf = (r) => (col.codes[r]! < 0 ? "" : col.dictionary[col.codes[r]!]!);
      else keyOf = (r) => col.values[r]!;
      const sorted = Array.from(ids).sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        // Missing values sort last in either direction.
        const ma = ka === "" || Number.isNaN(ka);
        const mb = kb === "" || Number.isNaN(kb);
        if (ma || mb) return ma === mb ? a - b : ma ? 1 : -1;
        return ka < kb ? -dir : ka > kb ? dir : a - b;
      });
      ids.set(sorted);
    }
    const offset = query.offset ?? 0;
    const end = Math.min(n, offset + (query.limit ?? n));
    const rows: Row[] = [];
    for (let k = offset; k < end; k++) {
      const r = ids[k]!;
      const row: Row = {};
      for (const c of columns) {
        const col = this.table.columns[c];
        if (col) row[c] = cell(col, r);
      }
      rows.push(row);
    }
    return { rows, selected: this.selected };
  }
}

/** Per-bin aggregate values, without the trailing missing slot. */
function values(g: Group): Float64Array {
  const n = g.dim.compiled.size;
  if (g.op === "count") return g.counts.slice(0, n);
  if (g.op === "sum") return g.sums.slice(0, n);
  const out = new Float64Array(n);
  for (let b = 0; b < n; b++) out[b] = g.valid[b]! > 0 ? g.sums[b]! / g.valid[b]! : Number.NaN;
  return out;
}

/** Add every row whose mask has none of `keep`'s bits set to the group, in row order. */
function accumulate(g: Group, mask: Uint32Array, keep: number): void {
  const bins = g.dim.compiled.bins;
  const { counts, sums, valid, field } = g;
  const n = mask.length;
  if (field === null) {
    for (let r = 0; r < n; r++) if ((mask[r]! & keep) === 0) counts[bins[r]!]!++;
    return;
  }
  for (let r = 0; r < n; r++) {
    if ((mask[r]! & keep) !== 0) continue;
    const b = bins[r]!;
    counts[b]!++;
    const v = field[r]!;
    if (!Number.isNaN(v)) {
      sums[b]! += v;
      valid[b]!++;
    }
  }
}

function add(g: Group, bin: number, row: number, sign: number): void {
  g.counts[bin]! += sign;
  if (g.field !== null) {
    const v = g.field[row]!;
    if (!Number.isNaN(v)) {
      g.sums[bin]! += sign * v;
      g.valid[bin]! += sign;
    }
  }
}

/** Runs of positions that cover the difference between slices [p0, p1) and [q0, q1). */
function changedRuns(p0: number, p1: number, q0: number, q1: number): [number, number][] {
  if (p0 === p1 || q0 === q1 || p1 <= q0 || q1 <= p0) {
    return [
      [p0, p1],
      [q0, q1],
    ];
  }
  return [
    [Math.min(p0, q0), Math.max(p0, q0)],
    [Math.min(p1, q1), Math.max(p1, q1)],
  ];
}

/** Passing slice of `order` per bin for a binned dimension whose bins are sorted by value. */
function cuts(dim: Dim, classified: Classified, filter: Filter | null): { lo: Uint32Array; hi: Uint32Array } {
  const { offsets, order } = dim;
  const values = dim.values!;
  const state = classified.state;
  const slots = state.length;
  const lo = new Uint32Array(slots);
  const hi = new Uint32Array(slots);
  let a = Number.NaN;
  let z = Number.NaN;
  if (filter !== null && "range" in filter) {
    [a, z] = filter.range[0] <= filter.range[1] ? filter.range : [filter.range[1], filter.range[0]];
  }
  for (let b = 0; b < slots; b++) {
    const s = state[b]!;
    const start = offsets[b]!;
    const end = offsets[b + 1]!;
    if (s === IN) {
      lo[b] = start;
      hi[b] = end;
    } else if (s === OUT) {
      lo[b] = start;
      hi[b] = start;
    } else if (Number.isNaN(a) || Number.isNaN(z)) {
      lo[b] = start;
      hi[b] = start;
    } else {
      // Same test as the classifier's: a <= v < z.
      const k0 = lowerBound(order, values, start, end, a);
      lo[b] = k0;
      hi[b] = Math.max(k0, lowerBound(order, values, k0, end, z));
    }
  }
  return { lo, hi };
}

/** First position in lo..hi whose value is not below x. */
function lowerBound(order: Uint32Array, values: Float64Array, lo: number, hi: number, x: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (values[order[mid]!]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The passing positions as one run [k0, k1), or null if the slices leave gaps. */
function span(lo: Uint32Array, hi: Uint32Array): [number, number] | null {
  let k0 = -1;
  let k1 = -1;
  for (let b = 0; b < lo.length; b++) {
    if (lo[b] === hi[b]) continue;
    if (k0 < 0) k0 = lo[b]!;
    else if (lo[b] !== k1) return null;
    k1 = hi[b]!;
  }
  return k0 < 0 ? [0, 0] : [k0, k1];
}

/** Running sum down the rows of a (rows x slots) table. */
function prefix(a: Float64Array | Uint32Array, slots: number): void {
  for (let i = slots; i < a.length; i++) a[i]! += a[i - slots]!;
}

/** out[j] = table[j1 + j] - table[j0 + j]. */
function diff(out: Float64Array, table: Float64Array | Uint32Array, j0: number, j1: number, slots: number): void {
  for (let j = 0; j < slots; j++) out[j] = table[j1 + j]! - table[j0 + j]!;
}

/** Exact `a <= x < b` on one axis of 2-D tiles, reading float32 copies in cell order and the exact value only on ties. */
class EdgeTest {
  private readonly a: number;
  private readonly b: number;
  private readonly fa: number;
  private readonly fb: number;
  private readonly cuv: Float32Array;
  private readonly order: Uint32Array;
  private readonly values: Float64Array;
  constructor(
    axis: TileAxis,
    tiles: Tiles2,
    private readonly index: number,
  ) {
    [this.a, this.b] = axis.range ?? [0, 0];
    this.fa = Math.fround(this.a);
    this.fb = Math.fround(this.b);
    this.cuv = tiles.cuv;
    this.order = tiles.order;
    this.values = axis.values;
  }

  passes(k: number): boolean {
    // Rounding to float32 keeps order, so only values that round onto an edge need the exact check.
    const x = this.cuv[2 * k + this.index]!;
    if (x > this.fa && x < this.fb) return true;
    if (x !== this.fa && x !== this.fb) return false;
    const e = this.values[this.order[k]!]!;
    return e >= this.a && e < this.b;
  }
}

/** Add rows k0..k1 (in cell order) to table row `row` of a part. */
function tally(
  p: TilePart2,
  rec: Uint16Array | Uint32Array,
  width: number,
  none: number,
  order: Uint32Array,
  k0: number,
  k1: number,
  row: number,
): void {
  const { counts, sums, valid, slots, col } = p;
  const field = p.group.field;
  const at = row * slots;
  for (let k = k0; k < k1; k++) {
    const b = rec[k * width + col]!;
    if (b === none) continue;
    counts[at + b]!++;
    if (sums === null || valid === null || field === null) continue;
    const x = field[order[k]!]!;
    if (!Number.isNaN(x)) {
      sums[at + b]! += x;
      valid[at + b]!++;
    }
  }
}

/**
 * Groups filtered by one axis only, summed over every slice of the other:
 * whole slices from the prefix table, the at most two cut slices row by row.
 */
function readAlong(tiles: Tiles2, parts: TilePart2[], test: EdgeTest, run: SliceRun, isU: boolean): void {
  if (parts.length === 0) return;
  const [t0, f0, f1, t1] = run;
  for (const p of parts) {
    const k = p.slots;
    diff(p.group.counts, p.counts, f0 * k, f1 * k, k);
    if (p.sums !== null && p.valid !== null) {
      diff(p.group.sums, p.sums, f0 * k, f1 * k, k);
      diff(p.group.valid, p.valid, f0 * k, f1 * k, k);
    }
  }
  const { order, offsets, rec, width, none } = tiles;
  const sv = tiles.v.slices;
  const stride = sv + 2;
  const runs = [t0, f0, f1, t1];
  const visit = (k0: number, k1: number) => {
    for (let k = k0; k < k1; k++) {
      if (!test.passes(k)) continue;
      for (let q = 0; q < parts.length; q++) {
        const p = parts[q]!;
        const b = rec[k * width + p.col]!;
        if (b !== none) add(p.group, b, order[k]!, 1);
      }
    }
  };
  for (let e = 0; e < 4; e += 2) {
    for (let j = runs[e]!; j < runs[e + 1]!; j++) {
      // A u slice is one run of cells; a v slice takes one cell from each u slice.
      if (isU) visit(offsets[(j + 1) * stride + 1]!, offsets[(j + 1) * stride + sv + 2]!);
      else {
        for (let i = 0; i <= tiles.u.slices; i++) {
          const c = (i + 1) * stride + j + 1;
          visit(offsets[c]!, offsets[c + 1]!);
        }
      }
    }
  }
}

type AxisRange = [number, number] | null;

/**
 * A filter as tile axis ranges ([u, v]; v is unused for one-dimensional
 * dimensions), or null if tiles can't answer it: key sets, and a grid filter
 * with neither axis set (which passes every row but the missing ones).
 */
function axisRanges(dim: Dim, f: Filter | null): [AxisRange, AxisRange] | null {
  if (f === null) return [null, null];
  if ("range" in f) return [ordered(f.range), null];
  if ("in" in f || dim.compiled.y === null) return null;
  const { x, y } = f;
  if (x === null && y === null) return null;
  if ((x !== null && !("range" in x)) || (y !== null && !("range" in y))) return null;
  return [x === null ? null : ordered(x.range), y === null ? null : ordered(y.range)];
}

function ordered(r: readonly [number, number]): [number, number] {
  return r[0] <= r[1] ? [r[0], r[1]] : [r[1], r[0]];
}

/** Whether slice i is wholly in, out of, or cut by (PARTIAL) a run from {@link sliceRun}. */
function cellState(i: number, run: SliceRun): number {
  return i < run[0] || i >= run[3] ? OUT : i >= run[1] && i < run[2] ? IN : PARTIAL;
}

/**
 * Slices of an axis for its range, as [t0, f0, f1, t1]: slices t0..t1 may
 * hold passing rows, and f0..f1 (inside them) hold only passing rows. A null
 * range passes every slice, the missing one included.
 */
function sliceRun(ax: Pick<TileAxis, "slices" | "range" | "edges">): SliceRun {
  const s = ax.slices;
  if (ax.range === null) return [0, 0, s + 1, s + 1];
  const [a, b] = ax.range;
  if (!(a < b)) return [0, 0, 0, 0];
  const e = ax.edges;
  const t0 = edgeUpper(e, a) - 1;
  const t1 = edgeLower(e, b);
  let f0 = edgeLower(e, a);
  // The last slice is never whole: it may hold Infinity, which no range passes.
  let f1 = Math.min(edgeUpper(e, b) - 1, s - 1);
  if (f1 <= f0) f0 = f1 = t0;
  return [t0, f0, f1, t1];
}

/**
 * Cut an axis into about `slices` value slices of similar row counts, and
 * find each row's slice (missing rows get the last). Slices follow the axis'
 * bins: small neighbouring bins share a slice, and a bin with many rows is
 * split into equal-width pieces, so a row's slice is one multiply away.
 */
function* sliceAxis(
  src: AxisSource,
  slices: number,
  chunk: number,
): Generator<void, { edges: Float64Array; slice: Uint16Array }, void> {
  const { values, missingBins, missing, axisBins, binEdges } = src;
  const n = values.length;
  const bins = binEdges.length - 1;
  const count = new Float64Array(bins);
  let m = 0;
  for (let r0 = 0; r0 < n; r0 += chunk) {
    const r1 = Math.min(n, r0 + chunk);
    for (let r = r0; r < r1; r++) {
      if (missingBins[r] === missing) continue;
      count[axisBins[r]!]!++;
      m++;
    }
    yield;
  }
  const target = Math.max(1, m / slices);
  const cut = [Number.NEGATIVE_INFINITY];
  const base = new Uint16Array(bins);
  const pieces = new Uint16Array(bins);
  const scale = new Float64Array(bins);
  let filled = 0;
  for (let b = 0; b < bins; b++) {
    const c = count[b]!;
    const k = Math.floor(c / target);
    const e0 = binEdges[b]!;
    // Start a new slice at this bin's lower edge when the current one is full, or before splitting it.
    if (b > 0 && c > 0 && filled > 0 && (filled >= target || k >= 2) && e0 > cut[cut.length - 1]!) {
      cut.push(e0);
      filled = 0;
    }
    base[b] = cut.length - 1;
    pieces[b] = 1;
    if (k >= 2) {
      const w = (binEdges[b + 1]! - e0) / k;
      for (let j = 1; j < k; j++) {
        const e = e0 + j * w;
        if (e > cut[cut.length - 1]!) cut.push(e);
      }
      pieces[b] = k;
      scale[b] = 1 / w;
      filled = c / k;
    } else {
      filled += c;
    }
  }
  cut.push(Number.POSITIVE_INFINITY);
  const edges = Float64Array.from(cut);
  const slice = new Uint16Array(n);
  const cuts: SliceCuts = { src, edges, base, pieces, scale, slice };
  for (let r0 = 0; r0 < n; r0 += chunk) {
    assignSlices(cuts, r0, Math.min(n, r0 + chunk));
    yield;
  }
  return { edges, slice };
}

/** An axis' slice edges from {@link sliceAxis}, and how to find a row's slice from its bin. */
interface SliceCuts {
  readonly src: AxisSource;
  readonly edges: Float64Array;
  /** Per axis bin: its first slice, how many equal-width pieces it is cut into, and 1 / piece width. */
  readonly base: Uint16Array;
  readonly pieces: Uint16Array;
  readonly scale: Float64Array;
  /** Each row's slice, filled in by {@link assignSlices}. */
  readonly slice: Uint16Array;
}

/** Find the slice of rows r0..r1. */
function assignSlices(cuts: SliceCuts, r0: number, r1: number): void {
  const { src, edges, base, pieces, scale, slice } = cuts;
  const { values, missingBins, missing, axisBins, binEdges } = src;
  const s = edges.length - 1;
  for (let r = r0; r < r1; r++) {
    if (missingBins[r] === missing) {
      slice[r] = s;
      continue;
    }
    const x = values[r]!;
    const b = axisBins[r]!;
    let i = base[b]!;
    const k = pieces[b]!;
    if (k > 1) {
      // Truncation is floor here, and wild values (clamped outliers) are fixed up below.
      let d = ((x - binEdges[b]!) * scale[b]!) | 0;
      if (d < 0) d = 0;
      else if (d >= k) d = k - 1;
      i += d;
    }
    if (i > s - 1) i = s - 1;
    // Rounding, clamped values, and pieces dropped as too thin: settle on the exact slice.
    while (i > 0 && x < edges[i]!) i--;
    while (i + 1 < s && x >= edges[i + 1]!) i++;
    slice[r] = i;
  }
}

/** Cell-ordered copies of the rows, while a 2-D tile build fills them in. */
interface CellRows {
  readonly order: Uint32Array;
  readonly cuv: Float32Array;
  readonly rec: Uint16Array | Uint32Array;
  readonly width: number;
  readonly none: number;
  /** Each cell's next free position. */
  readonly cursor: Uint32Array;
  readonly stride: number;
}

/**
 * Copy rows r0..r1 to their cells: row id, float32 axis values, and a record
 * of PASS_OTHERS and each tiled group's bin (`none` where `keeps[q]` bits
 * exclude the row). PASS_U and PASS_V are left for {@link passFlags}.
 */
function fillRows(
  out: CellRows,
  mask: Uint32Array,
  notActive: number,
  keeps: Int32Array,
  binsOf: Uint32Array[],
  us: Uint16Array,
  vs: Uint16Array,
  uValues: Float64Array,
  vValues: Float64Array,
  r0: number,
  r1: number,
): void {
  const { order, cuv, rec, width, none, cursor, stride } = out;
  const parts = keeps.length;
  for (let r = r0; r < r1; r++) {
    const k = cursor[(us[r]! + 1) * stride + vs[r]! + 1]!++;
    const m = mask[r]!;
    order[k] = r;
    cuv[2 * k] = uValues[r]!;
    cuv[2 * k + 1] = vValues[r]!;
    const base = k * width;
    rec[base] = (m & notActive) === 0 ? PASS_OTHERS : 0;
    for (let q = 0; q < parts; q++) rec[base + q + 1] = (m & keeps[q]!) === 0 ? binsOf[q]![r]! : none;
  }
}

/**
 * Set rows' PASS_U and PASS_V flags for the axes' synced ranges, the filters
 * the mask reflects; for a grid, both flags mean the row passes it. With
 * `from`, the [u, v] ranges the flags reflect so far, only cells whose state
 * changed, or that either range cuts through, are visited. Yields after about
 * `chunk` rows.
 */
function* passFlags(tiles: Tiles2, from: [AxisRange, AxisRange] | null, chunk: number): Generator<void, void, void> {
  const { u, v, grid, offsets, rec, width } = tiles;
  const ru = sliceRun({ ...u, range: u.synced });
  const rv = sliceRun({ ...v, range: v.synced });
  const pu = from === null ? null : sliceRun({ ...u, range: from[0] });
  const pv = from === null ? null : sliceRun({ ...v, range: from[1] });
  const tu = new EdgeTest({ ...u, range: u.synced }, tiles, 0);
  const tv = new EdgeTest({ ...v, range: v.synced }, tiles, 1);
  const stride = v.slices + 2;
  const same = (s0: number, s1: number) => s0 === s1 && s0 !== PARTIAL;
  let done = 0;
  for (let i = 0; i <= u.slices; i++) {
    const a = cellState(i, ru);
    const a0 = pu === null ? -1 : cellState(i, pu);
    for (let j = 0; j <= v.slices; j++) {
      const b = cellState(j, rv);
      if (pu !== null && pv !== null) {
        const b0 = cellState(j, pv);
        if (grid !== null ? same(both2(a0, b0), both2(a, b)) : same(a0, a) && same(b0, b)) continue;
      }
      const c = (i + 1) * stride + j + 1;
      const k0 = offsets[c]!;
      const k1 = offsets[c + 1]!;
      setFlags(rec, width, grid !== null, a, b, tu, tv, k0, k1);
      done += k1 - k0;
      if (done >= chunk) {
        done = 0;
        yield;
      }
    }
  }
}

/** A cell's state on a grid, from its states on the two axes. */
function both2(a: number, b: number): number {
  return a === OUT || b === OUT ? OUT : a === IN && b === IN ? IN : PARTIAL;
}

/** Set PASS_U and PASS_V of rows k0..k1 in one cell, whose axis states are `a` and `b`. */
function setFlags(
  rec: Uint16Array | Uint32Array,
  width: number,
  grid: boolean,
  a: number,
  b: number,
  tu: EdgeTest,
  tv: EdgeTest,
  k0: number,
  k1: number,
): void {
  for (let k = k0; k < k1; k++) {
    const passU = a === IN || (a === PARTIAL && tu.passes(k));
    const passV = b === IN || (b === PARTIAL && tv.passes(k));
    let f = rec[k * width]! & ~(PASS_U | PASS_V);
    if (grid) {
      if (passU && passV) f |= PASS_U | PASS_V;
    } else {
      if (passU) f |= PASS_U;
      if (passV) f |= PASS_V;
    }
    rec[k * width] = f;
  }
}

/** Write zeros over a fresh array `step` elements at a time, so its memory is mapped in small steps. */
function* touch(a: Uint16Array | Uint32Array | Float32Array, step: number): Generator<void, void, void> {
  for (let i = 0; i < a.length; i += step) {
    a.fill(0, i, i + step);
    yield;
  }
}

/** One row of a summed-area table: prefix sums along it, then add the (finished) row before it. */
function prefixRow(a: Float64Array | Uint32Array, slots: number, base: number, row: number): void {
  for (let i = base + slots; i < base + row; i++) a[i]! += a[i - slots]!;
  if (base >= row) for (let i = base; i < base + row; i++) a[i]! += a[i - row]!;
}

/** out[j] = the block of cells between table corners c00 and c11, from four lookups. */
function sat(
  out: Float64Array,
  t: Float64Array | Uint32Array,
  c00: number,
  c01: number,
  c10: number,
  c11: number,
  slots: number,
): void {
  for (let j = 0; j < slots; j++) out[j] = t[c11 + j]! - t[c01 + j]! - t[c10 + j]! + t[c00 + j]!;
}

/** Index of the first edge greater than x. */
function edgeUpper(edges: Float64Array, x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first edge not below x. */
function edgeLower(edges: Float64Array, x: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (edges[mid]! < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function info(id: string, c: CompiledDimension): DimensionInfo {
  return { id, x: c.x.info, y: c.y?.info ?? null, size: c.size };
}
