import { localEngine } from "./engine/local.js";
import { workerEngine } from "./engine/worker.js";
import { FilterStore } from "./filters.js";
import type { ChartData, Datum, Intent, Renderer, RenderHandle } from "./renderer.js";
import { count as countAgg, dimensionName, toDimensionSpec } from "./specs.js";
import { toTable } from "./table.js";
import type {
  AggregateSpec,
  AxisInfo,
  ColumnTable,
  DataEngine,
  DimensionInfo,
  DimensionInput,
  FieldOf,
  Filter,
  Row,
  RowsQuery,
  RowsResult,
  UpdateResult,
} from "./types.js";

/** Options for {@link createDashboard}. */
export interface DashboardOptions<T extends Row> {
  /** Row objects or a column table. Row objects are converted once. */
  readonly data: readonly T[] | ColumnTable;
  /**
   * `"worker"` runs the engine in a Web Worker (the default where Worker
   * exists), `"local"` on the main thread, or pass any DataEngine.
   */
  readonly engine?: "worker" | "local" | DataEngine;
  /** Default renderer for charts that mount into an element. */
  // biome-ignore lint/suspicious/noExplicitAny: each chart narrows the renderer's view type.
  readonly renderer?: Renderer<any>;
  /**
   * How engine requests are coalesced. Defaults to one per animation frame
   * (or a macrotask where requestAnimationFrame is missing).
   */
  readonly schedule?: (run: () => void) => void;
}

/** A chart: what to group by, what to aggregate, and how to draw it. Plain and serializable apart from `renderer`. */
export interface ChartSpec<F extends string, View = unknown> {
  /** Filter key and chart id. Defaults to the field name ("x×y" for grids), made unique. */
  readonly id?: string;
  /** What to group rows by: a {@link bin}, {@link category} or {@link top} spec, a bare field name, or an `[x, y]` pair. */
  readonly dimension: DimensionInput<F>;
  /** Defaults to count(). */
  readonly value?: AggregateSpec<F>;
  /**
   * More aggregates over the same bins, by name. Each bin's results arrive in
   * `Datum.extra`, e.g. `{ lat: mean("paleolat") }` to place a map dot where
   * its rows were in the past.
   */
  readonly extra?: Readonly<Record<string, AggregateSpec<F>>>;
  /** Passed to the renderer untouched. */
  readonly view?: View;
  /** Overrides the dashboard's renderer for this chart. */
  readonly renderer?: Renderer<View>;
}

/** Called with a chart's fresh aggregates and its own filter after every update. */
export type ChartListener = (data: ChartData, filter: Filter | null) => void;

/** A live chart returned by {@link Dashboard.chart}. */
export interface Chart {
  /** The chart's id, which is also its key in the filter store. */
  readonly id: string;
  /** Resolves once the engine has indexed the dimension. */
  readonly ready: Promise<DimensionInfo>;
  /** The latest aggregates, or null before the first update. */
  readonly data: ChartData | null;
  /** This chart's own filter, or null. */
  readonly filter: Filter | null;
  /** Apply an intent as if the renderer had emitted it. */
  apply(intent: Intent): void;
  /**
   * Draw this chart in one more place, e.g. a compact copy in an overview.
   * Every view shares the chart's data and filter. Returns a function that
   * removes the view.
   */
  mount<View = unknown>(target: string | HTMLElement, view?: View, renderer?: Renderer<View>): () => void;
  /** Listen for fresh aggregates, e.g. to draw without a renderer. Returns a function that unsubscribes. */
  subscribe(listener: ChartListener): () => void;
  /** Remove the chart, its views, its dimension and its filter. */
  destroy(): void;
}

/** Row counts after the latest update. */
export interface Summary {
  /** Rows passing every filter. */
  readonly selected: number;
  /** All rows. */
  readonly total: number;
}

/** One table, one filter store and any number of linked charts. */
export interface Dashboard<F extends string = string> {
  /** The shared filter state. Read it, write it or subscribe to it. */
  readonly filters: FilterStore;
  /** Resolves when every request so far has been applied. */
  readonly idle: () => Promise<void>;
  /** Selected and total rows after the latest update. */
  readonly summary: Summary;
  /**
   * Add a chart. With a target element (or selector) the renderer draws it there; with `null` the chart is
   * headless and you read it through `subscribe` or `data`.
   */
  chart<View = unknown>(target: string | HTMLElement | null, spec: ChartSpec<F, View>): Chart;
  /** Called after every update with selected and total row counts. */
  onUpdate(listener: (summary: Summary) => void): () => void;
  /** Rows passing every filter. */
  rows(query?: RowsQuery & { columns?: readonly F[]; sort?: F | `-${F}` }): Promise<RowsResult>;
  /** Destroy every chart and stop the engine. */
  destroy(): void;
}

interface ChartState {
  readonly id: string;
  dimension: DimensionInfo | null;
  baseline: Float64Array | null;
  /** Names of the chart's extra aggregates. */
  readonly extra: readonly string[];
  data: ChartData | null;
  /** One handle per mounted view. */
  readonly handles: Set<RenderHandle>;
  /** Views waiting for the dimension to be ready. */
  readonly pending: Array<(info: DimensionInfo) => void>;
  readonly listeners: Set<ChartListener>;
  readonly chart: Chart;
}

function defaultSchedule(run: () => void): void {
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(() => run());
  else setTimeout(run, 0);
}

function resolveEngine(engine: DashboardOptions<Row>["engine"]): DataEngine {
  if (engine === "local") return localEngine();
  if (engine === "worker") return workerEngine();
  if (engine) return engine;
  return typeof Worker === "function" ? workerEngine() : localEngine();
}

/**
 * Create a dashboard: one table, one filter store, any number of linked charts.
 * Each chart aggregates the rows that pass every filter except its own.
 */
export async function createDashboard<T extends Row>(options: DashboardOptions<T>): Promise<Dashboard<FieldOf<T>>> {
  type F = FieldOf<T>;
  const table = toTable(options.data as ColumnTable | readonly Row[]);
  const engine = resolveEngine(options.engine);
  const schedule = options.schedule ?? defaultSchedule;
  await engine.load(table);

  const filters = new FilterStore();
  const charts = new Map<string, ChartState>();
  const summaryListeners = new Set<(s: Summary) => void>();
  let summary: Summary = { selected: table.rowCount, total: table.rowCount };
  let destroyed = false;

  // Request scheduling: at most one update in flight, coalesced per frame.
  let seq = 0; // bumps on anything that needs a re-query
  let sentSeq = 0; // nothing to query until the first chart or filter
  let scheduled = false;
  let inflight: Promise<void> | null = null;
  let pendingSetup: Promise<unknown>[] = [];
  let idleWaiters: Array<() => void> = [];
  let failure: unknown = null;

  const request = () => {
    seq++;
    if (scheduled || destroyed) return;
    scheduled = true;
    schedule(() => {
      scheduled = false;
      void pump();
    });
  };

  const pump = async (): Promise<void> => {
    if (inflight || destroyed) return;
    if (sentSeq === seq) return settleIdle();
    const mySeq = seq;
    sentSeq = mySeq;
    inflight = (async () => {
      const setup = pendingSetup;
      pendingSetup = [];
      await Promise.allSettled(setup);
      const snap = filters.snapshot;
      const known: Record<string, Filter> = {};
      for (const [id, f] of Object.entries(snap.filters)) if (charts.get(id)?.dimension) known[id] = f;
      const result = await engine.update(known, mySeq);
      if (!destroyed) apply(result);
    })().catch((err) => {
      failure = err;
      console.error("[crossplot] update failed", err);
    });
    await inflight;
    inflight = null;
    // Something changed while we were waiting: go again right away.
    if (sentSeq !== seq) void pump();
    else settleIdle();
  };

  const settleIdle = () => {
    if (scheduled || inflight || sentSeq !== seq) return;
    const waiters = idleWaiters;
    idleWaiters = [];
    for (const w of waiters) w();
  };

  const apply = (result: UpdateResult) => {
    summary = { selected: result.selected, total: result.total };
    for (const state of charts.values()) {
      const g = result.groups[state.id];
      if (!g || !state.dimension) continue;
      const extra: Record<string, Float64Array> = {};
      for (const name of state.extra) {
        const e = result.groups[extraId(state.id, name)];
        if (e) extra[name] = e.values;
      }
      const data: ChartData = {
        dimension: state.dimension,
        data: toData(state.dimension, g.values, g.counts, state.baseline, state.extra.length ? extra : null),
        selected: result.selected,
        total: result.total,
      };
      state.data = data;
      const filter = filters.get(state.id);
      for (const h of state.handles) h.update(data, filter);
      for (const l of state.listeners) l(data, filter);
    }
    for (const l of summaryListeners) l(summary);
  };

  filters.subscribe(() => request());

  const uniqueId = (base: string) => {
    let id = base;
    for (let i = 2; charts.has(id); i++) id = `${base}-${i}`;
    return id;
  };

  const dashboard: Dashboard<F> = {
    filters,
    get summary() {
      return summary;
    },
    idle: () =>
      new Promise<void>((resolve, reject) => {
        const done = () => (failure ? reject(failure) : resolve());
        if (!scheduled && !inflight && sentSeq === seq) return done();
        idleWaiters.push(done);
      }),

    chart<View>(target: string | HTMLElement | null, spec: ChartSpec<F, View>): Chart {
      const dimSpec = toDimensionSpec(spec.dimension);
      const id = spec.id ?? uniqueId(dimensionName(dimSpec));
      if (charts.has(id)) throw new Error(`A chart with id "${id}" already exists`);
      const renderer = (spec.renderer ?? options.renderer) as Renderer<View> | undefined;
      const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
      if (typeof target === "string" && !el) throw new Error(`No element matches "${target}"`);
      if (el && !renderer) throw new Error(`Chart "${id}" has an element but no renderer`);

      const emit = (intent: Intent) => applyIntent(id, intent);
      const setup = (async () => {
        const info = await engine.addDimension(id, dimSpec);
        const baseline = await engine.addGroup(id, id, spec.value ?? countAgg());
        for (const [name, agg] of Object.entries(spec.extra ?? {})) await engine.addGroup(extraId(id, name), id, agg);
        return { info, baseline: baseline ?? null };
      })();
      const ready = setup.then((s) => s.info);
      pendingSetup.push(ready);

      const state: ChartState = {
        id,
        dimension: null,
        baseline: null,
        extra: Object.keys(spec.extra ?? {}),
        data: null,
        handles: new Set(),
        pending: [],
        listeners: new Set(),
        chart: {
          id,
          ready,
          get data() {
            return state.data;
          },
          get filter() {
            return filters.get(id);
          },
          apply: emit,
          mount(target, view, viewRenderer) {
            const r = (viewRenderer ?? renderer ?? options.renderer) as Renderer<unknown> | undefined;
            const node = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
            if (!node) throw new Error(`No element matches "${String(target)}"`);
            if (!r) throw new Error(`Chart "${id}" has no renderer to mount with`);
            let handle: RenderHandle | null = null;
            let removed = false;
            const attach = (info: DimensionInfo) => {
              if (removed || !charts.has(id)) return;
              handle = r.mount(node, view ?? {}, emit, { id, dimension: info });
              state.handles.add(handle);
              if (state.data) handle.update(state.data, filters.get(id));
            };
            if (state.dimension) attach(state.dimension);
            else state.pending.push(attach);
            return () => {
              removed = true;
              // The chart or the dashboard may have destroyed the handle already.
              if (handle && state.handles.delete(handle)) handle.destroy();
            };
          },
          subscribe(listener) {
            state.listeners.add(listener);
            if (state.data) listener(state.data, filters.get(id));
            return () => state.listeners.delete(listener);
          },
          destroy() {
            if (!charts.has(id)) return;
            charts.delete(id);
            for (const h of state.handles) h.destroy();
            state.handles.clear();
            filters.clear(id);
            pendingSetup.push(engine.removeDimension(id));
            request();
          },
        },
      };
      charts.set(id, state);

      setup.then(
        ({ info, baseline }) => {
          if (!charts.has(id) || destroyed) return;
          state.dimension = info;
          state.baseline = baseline;
          if (el && renderer)
            state.handles.add(renderer.mount(el, (spec.view ?? {}) as View, emit, { id, dimension: info }));
          for (const attach of state.pending.splice(0)) attach(info);
        },
        (err) => {
          charts.delete(id);
          console.error(`[crossplot] chart "${id}" failed`, err);
        },
      );
      request();
      return state.chart;
    },

    onUpdate(listener) {
      summaryListeners.add(listener);
      listener(summary);
      return () => summaryListeners.delete(listener);
    },

    async rows(query = {}) {
      await dashboard.idle();
      return engine.rows(query);
    },

    destroy() {
      if (destroyed) return;
      destroyed = true;
      for (const s of charts.values()) {
        for (const h of s.handles) h.destroy();
        s.handles.clear();
      }
      charts.clear();
      summaryListeners.clear();
      engine.dispose();
    },
  };

  const applyIntent = (id: string, intent: Intent) => {
    const current = filters.get(id);
    switch (intent.type) {
      case "reset":
        return filters.clear(id);
      case "brush":
        return filters.set(id, intent.range ? { range: [intent.range[0], intent.range[1]] } : null);
      case "brushXY":
        return filters.set(id, {
          x: { range: [intent.x[0], intent.x[1]] },
          y: { range: [intent.y[0], intent.y[1]] },
        });
      case "select": {
        let keys = [...intent.keys];
        if (intent.mode === "toggle" && current && "in" in current) {
          const set = new Set(current.in);
          for (const k of intent.keys) {
            if (set.has(k)) set.delete(k);
            else set.add(k);
          }
          keys = [...set];
        }
        return filters.set(id, keys.length ? { in: keys } : null);
      }
    }
  };

  return dashboard;
}

const dash = "–";

/** Engine group id of a chart's extra aggregate. */
const extraId = (chart: string, name: string) => `${chart}\u001f${name}`;

function axisKey(axis: AxisInfo, i: number): { key: string; x0: number; x1: number } {
  if (axis.kind === "category") return { key: axis.keys[i]!, x0: Number.NaN, x1: Number.NaN };
  const x0 = axis.edges[i]!;
  const x1 = axis.edges[i + 1]!;
  return { key: `${fmt(x0, axis)}${dash}${fmt(x1, axis)}`, x0, x1 };
}

function fmt(v: number, axis: AxisInfo): string {
  if (axis.date) return new Date(v).toISOString().slice(0, 10);
  return Number.isInteger(v) ? String(v) : String(+v.toPrecision(4));
}

function toData(
  dim: DimensionInfo,
  values: Float64Array,
  counts: Float64Array,
  baseline: Float64Array | null,
  extra: Readonly<Record<string, Float64Array>> | null,
): Datum[] {
  const out: Datum[] = new Array(dim.size);
  const base = (i: number) => (baseline ? baseline[i]! : Number.NaN);
  const names = extra ? Object.keys(extra) : [];
  const more = (i: number): Pick<Datum, "extra"> => {
    if (!extra) return {};
    const e: Record<string, number> = {};
    for (const n of names) e[n] = extra[n]![i]!;
    return { extra: e };
  };
  if (!dim.y) {
    for (let i = 0; i < dim.size; i++) {
      out[i] = { index: i, value: values[i]!, count: counts[i]!, baseline: base(i), ...axisKey(dim.x, i), ...more(i) };
    }
    return out;
  }
  const ys = dim.y.size;
  for (let i = 0; i < dim.x.size; i++) {
    const xk = axisKey(dim.x, i);
    for (let j = 0; j < ys; j++) {
      const yk = axisKey(dim.y, j);
      const index = i * ys + j;
      out[index] = {
        index,
        value: values[index]!,
        count: counts[index]!,
        baseline: base(index),
        ...xk,
        ykey: yk.key,
        y0: yk.x0,
        y1: yk.x1,
        ...more(index),
      };
    }
  }
  return out;
}
