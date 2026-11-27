import type {
  Chart,
  ChartData,
  ChartSpec,
  Dashboard,
  DashboardOptions,
  FieldOf,
  Filter,
  FilterState,
  Row,
  RowsQuery,
  RowsResult,
  Summary,
} from "@crossplot/core";
import { createDashboard } from "@crossplot/core";
import { untrack } from "svelte";
import type { Action } from "svelte/action";

/** A value, or a function that returns it so runes can track what it reads. */
export type MaybeGetter<T> = T | (() => T);

/**
 * Where a dashboard comes from: the object {@link useDashboard} returns, a getter, or the dashboard itself.
 * Null or undefined while it loads.
 */
export type DashboardSource<F extends string = string> =
  | Dashboard<F>
  | { readonly current: Dashboard<F> | null }
  | (() => Dashboard<F> | null | undefined)
  | null
  | undefined;

function get<T>(value: MaybeGetter<T>): T {
  return typeof value === "function" ? (value as () => T)() : value;
}

/** @internal */
export function readDashboard<F extends string>(source: DashboardSource<F>): Dashboard<F> | null {
  const value = typeof source === "function" ? source() : source;
  if (value && "current" in value) return value.current;
  return value ?? null;
}

/** @internal The parts of a spec that change the engine's work; anything else only redraws. */
export function specKey(spec: ChartSpec<string, unknown>): string {
  return JSON.stringify([spec.id, spec.dimension, spec.value, spec.extra]);
}

/**
 * Create a dashboard and destroy it when the calling component is destroyed. `current` is null until the
 * engine has loaded the data, and always during server rendering.
 *
 * Call it while a component initializes, or inside `$effect.root`.
 *
 * Pass a getter to make the options reactive: the dashboard is rebuilt when `data` or `engine` changes.
 * Other options are read once per build.
 */
export function useDashboard<T extends Row>(
  options: MaybeGetter<DashboardOptions<T>>,
): Current<Dashboard<FieldOf<T>> | null> {
  let current = $state.raw<Dashboard<FieldOf<T>> | null>(null);
  const data = $derived(get(options).data);
  const engine = $derived(get(options).engine);

  $effect(() => {
    void data;
    void engine;
    let live = true;
    let made: Dashboard<FieldOf<T>> | null = null;
    untrack(() => createDashboard(get(options))).then(
      (dash) => {
        if (!live) return dash.destroy();
        made = dash;
        current = dash;
      },
      (err) => console.error("[crossplot] dashboard failed", err),
    );
    return () => {
      live = false;
      made?.destroy();
      current = null;
    };
  });

  return {
    get current() {
      return current;
    },
  };
}

/** What {@link useChart} returns. Every field is reactive. */
export interface UseChart {
  /** The live chart, or null while the dashboard loads. */
  readonly chart: Chart | null;
  /** The chart's latest aggregates, or null before the first update. */
  readonly data: ChartData | null;
  /** The chart's own filter, or null. */
  readonly filter: Filter | null;
  /**
   * An action that draws the chart in an element with the dashboard's renderer (or `spec.renderer`):
   * `<div use:hour.ref></div>`. Leave it unused for a headless chart.
   */
  readonly ref: Action<HTMLElement>;
  /** Clear this chart's filter. */
  reset(): void;
}

/**
 * Add a chart to a dashboard for as long as the calling component lives.
 *
 * Pass the spec as a getter to make it reactive. The chart is recreated (and its filter cleared) when the
 * dashboard or the spec's `id`, `dimension`, `value` or `extra` change; a change to `view` or `renderer`
 * only redraws it.
 */
export function useChart<F extends string, View = unknown>(
  dashboard: DashboardSource<F>,
  spec: MaybeGetter<ChartSpec<F, View>>,
): UseChart {
  let chart = $state.raw<Chart | null>(null);
  let data = $state.raw<ChartData | null>(null);
  let filter = $state.raw<Filter | null>(null);
  let el = $state.raw<HTMLElement | null>(null);
  const dash = $derived(readDashboard(dashboard));
  const key = $derived(specKey(get(spec)));
  const viewKey = $derived(JSON.stringify(get(spec).view ?? null));
  const renderer = $derived(get(spec).renderer);

  $effect(() => {
    const d = dash;
    void key;
    if (!d) return;
    const c = untrack(() => d.chart(null, get(spec)));
    chart = c;
    const stop = c.subscribe((next, f) => {
      data = next;
      filter = f;
    });
    return () => {
      stop();
      c.destroy();
      chart = null;
      data = null;
      filter = null;
    };
  });

  $effect(() => {
    const c = chart;
    const node = el;
    const r = renderer;
    void viewKey;
    if (!c || !node) return;
    return untrack(() => c.mount(node, get(spec).view, r));
  });

  return {
    get chart() {
      return chart;
    },
    get data() {
      return data;
    },
    get filter() {
      return filter;
    },
    ref: (node) => {
      el = node;
      return {
        destroy() {
          if (el === node) el = null;
        },
      };
    },
    reset: () => chart?.apply({ type: "reset" }),
  };
}

/** A reactive value: read `.current` in a template, `$derived` or `$effect`. */
export interface Current<T> {
  /** The latest value. */
  readonly current: T;
}

/**
 * Every filter, by chart id: the same plain object as `dashboard.filters.snapshot.filters`, replaced
 * on each change. Empty before the dashboard is ready.
 */
export function useFilters(dashboard: DashboardSource): Current<FilterState> {
  let current = $state.raw<FilterState>({});
  const dash = $derived(readDashboard(dashboard));
  $effect(() => {
    const d = dash;
    if (!d) return;
    return untrack(() => {
      current = d.filters.snapshot.filters;
      const stop = d.filters.subscribe((s) => {
        current = s.filters;
      });
      return () => {
        stop();
        current = {};
      };
    });
  });
  return {
    get current() {
      return current;
    },
  };
}

/** One chart's filter by id, or null. Pass a getter for an id that changes. */
export function useFilter(dashboard: DashboardSource, id: MaybeGetter<string>): Current<Filter | null> {
  const filters = useFilters(dashboard);
  const current = $derived(filters.current[get(id)] ?? null);
  return {
    get current() {
      return current;
    },
  };
}

/** Selected and total row counts after the latest update, or null before the dashboard is ready. */
export function useSummary(dashboard: DashboardSource): Current<Summary | null> {
  let current = $state.raw<Summary | null>(null);
  const dash = $derived(readDashboard(dashboard));
  $effect(() => {
    const d = dash;
    if (!d) return;
    return untrack(() => {
      const stop = d.onUpdate((s) => {
        current = s;
      });
      return () => {
        stop();
        current = null;
      };
    });
  });
  return {
    get current() {
      return current;
    },
  };
}

/** Options for {@link useRows}: a page of filtered rows. */
export type RowsOptions<F extends string = string> = RowsQuery & {
  readonly columns?: readonly F[];
  readonly sort?: F | `-${F}`;
};

/** The filtered rows, fetched again after every update and whenever the query changes. */
export function useRows<F extends string>(
  dashboard: DashboardSource<F>,
  query: MaybeGetter<RowsOptions<F>> = {},
): Current<RowsResult | null> {
  let current = $state.raw<RowsResult | null>(null);
  const dash = $derived(readDashboard(dashboard));
  const queryKey = $derived(JSON.stringify(get(query)));

  $effect(() => {
    const d = dash;
    void queryKey;
    if (!d) return;
    let seq = 0;
    let live = true;
    const stop = untrack(() =>
      d.onUpdate(() => {
        const mine = ++seq;
        d.rows(get(query)).then(
          (r) => {
            if (live && mine === seq) current = r;
          },
          (err) => console.error("[crossplot] rows failed", err),
        );
      }),
    );
    return () => {
      live = false;
      stop();
      current = null;
    };
  });

  return {
    get current() {
      return current;
    },
  };
}
