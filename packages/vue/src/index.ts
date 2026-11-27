/**
 * Vue 3 composables for crossplot: create a dashboard, add linked charts and read the selection as refs.
 *
 * @module @crossplot/vue
 */
import type {
  ChartData,
  ChartSpec,
  Chart as CrossChart,
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
import {
  type ComponentPublicInstance,
  defineComponent,
  getCurrentInstance,
  h,
  type MaybeRefOrGetter,
  onMounted,
  onScopeDispose,
  type PropType,
  type ShallowRef,
  shallowRef,
  toValue,
  watch,
} from "vue";

/** A dashboard, a ref to one, or a getter; null or undefined while it loads. */
export type DashboardSource<F extends string = string> = MaybeRefOrGetter<Dashboard<F> | null | undefined>;

/**
 * Create a dashboard and destroy it when the calling component unmounts (or its effect scope stops).
 * The ref holds null until the engine has loaded the data, and always during server rendering.
 *
 * Pass a ref or getter to make the options reactive: the dashboard is rebuilt when `data` or
 * `engine` changes. Other options are read once per build.
 */
export function useDashboard<T extends Row>(
  options: MaybeRefOrGetter<DashboardOptions<T>>,
): ShallowRef<Dashboard<FieldOf<T>> | null> {
  const dashboard = shallowRef<Dashboard<FieldOf<T>> | null>(null);
  let generation = 0;
  let current: Dashboard<FieldOf<T>> | null = null;
  let disposed = false;

  const teardown = () => {
    generation++;
    current?.destroy();
    current = null;
    dashboard.value = null;
  };

  const build = () => {
    teardown();
    if (disposed) return;
    const mine = generation;
    createDashboard(toValue(options)).then(
      (dash) => {
        if (mine !== generation || disposed) return dash.destroy();
        current = dash;
        dashboard.value = dash;
      },
      (err) => console.error("[crossplot] dashboard failed", err),
    );
  };

  const start = () => {
    const opts = () => toValue(options);
    watch([() => opts().data, () => opts().engine], build, { immediate: true });
  };
  // Inside a component, wait for mount so server rendering never starts an engine.
  if (getCurrentInstance()) onMounted(start);
  else start();
  onScopeDispose(() => {
    disposed = true;
    teardown();
  });
  return dashboard;
}

/** What {@link useChart} returns. */
export interface UseChart {
  /** The live chart, or null while the dashboard loads. */
  readonly chart: ShallowRef<CrossChart | null>;
  /** The chart's latest aggregates, or null before the first update. */
  readonly data: ShallowRef<ChartData | null>;
  /** The chart's own filter, or null. */
  readonly filter: ShallowRef<Filter | null>;
  /**
   * A function template ref: `<div :ref="hour.ref" />` draws the chart there with the dashboard's
   * renderer (or `spec.renderer`). Leave it unused for a headless chart.
   */
  readonly ref: (el: Element | ComponentPublicInstance | null) => void;
  /** Clear this chart's filter. */
  reset(): void;
}

/** The parts of a spec that change the engine's work; anything else only redraws. */
function specKey(spec: ChartSpec<string, unknown>): string {
  return JSON.stringify([spec.id, spec.dimension, spec.value, spec.extra]);
}

/**
 * Add a chart to a dashboard for as long as the calling component lives.
 *
 * The chart is recreated (and its filter cleared) when the dashboard or the spec's `id`,
 * `dimension`, `value` or `extra` change. A change to `view` or `renderer` only redraws it.
 */
export function useChart<F extends string, View = unknown>(
  dashboard: DashboardSource<F>,
  spec: MaybeRefOrGetter<ChartSpec<F, View>>,
): UseChart {
  const chart = shallowRef<CrossChart | null>(null);
  const data = shallowRef<ChartData | null>(null);
  const filter = shallowRef<Filter | null>(null);
  const el = shallowRef<HTMLElement | null>(null);

  watch(
    [() => toValue(dashboard), () => specKey(toValue(spec))],
    ([dash], _, onCleanup) => {
      if (!dash) return;
      const c = dash.chart(null, toValue(spec));
      chart.value = c;
      const stop = c.subscribe((d, f) => {
        data.value = d;
        filter.value = f;
      });
      onCleanup(() => {
        stop();
        c.destroy();
        chart.value = null;
        data.value = null;
        filter.value = null;
      });
    },
    { immediate: true },
  );

  watch(
    [chart, el, () => JSON.stringify(toValue(spec).view ?? null), () => toValue(spec).renderer],
    ([c, node], _, onCleanup) => {
      if (!c || !node) return;
      const s = toValue(spec);
      onCleanup(c.mount(node, s.view, s.renderer));
    },
    { immediate: true, flush: "post" },
  );

  return {
    chart,
    data,
    filter,
    ref: (node) => {
      el.value = node instanceof HTMLElement ? node : null;
    },
    reset: () => chart.value?.apply({ type: "reset" }),
  };
}

/** Run `start` for each dashboard the source holds, and its cleanup when the dashboard goes away. */
function onDashboard<F extends string>(source: DashboardSource<F>, start: (dash: Dashboard<F>) => () => void): void {
  watch(
    () => toValue(source),
    (dash, _, onCleanup) => {
      if (dash) onCleanup(start(dash));
    },
    { immediate: true },
  );
}

/**
 * Every filter, by chart id: the same plain object as `dashboard.filters.snapshot.filters`, replaced
 * on each change. Empty before the dashboard is ready.
 */
export function useFilters(dashboard: DashboardSource): ShallowRef<FilterState> {
  const filters = shallowRef<FilterState>({});
  onDashboard(dashboard, (dash) => {
    filters.value = dash.filters.snapshot.filters;
    const stop = dash.filters.subscribe((s) => {
      filters.value = s.filters;
    });
    return () => {
      stop();
      filters.value = {};
    };
  });
  return filters;
}

/** One chart's filter by id, or null. */
export function useFilter(dashboard: DashboardSource, id: MaybeRefOrGetter<string>): ShallowRef<Filter | null> {
  const filters = useFilters(dashboard);
  const filter = shallowRef<Filter | null>(null);
  watch(
    () => filters.value[toValue(id)] ?? null,
    (f) => {
      filter.value = f;
    },
    { immediate: true },
  );
  return filter;
}

/** Selected and total row counts after the latest update, or null before the dashboard is ready. */
export function useSummary(dashboard: DashboardSource): ShallowRef<Summary | null> {
  const summary = shallowRef<Summary | null>(null);
  onDashboard(dashboard, (dash) => {
    const stop = dash.onUpdate((s) => {
      summary.value = s;
    });
    return () => {
      stop();
      summary.value = null;
    };
  });
  return summary;
}

/** Options for {@link useRows}: a page of filtered rows. */
export type RowsOptions<F extends string = string> = RowsQuery & {
  readonly columns?: readonly F[];
  readonly sort?: F | `-${F}`;
};

/** The filtered rows, fetched again after every update and whenever the query changes. Null until the first page arrives. */
export function useRows<F extends string>(
  dashboard: DashboardSource<F>,
  query: MaybeRefOrGetter<RowsOptions<F>> = {},
): ShallowRef<RowsResult | null> {
  const rows = shallowRef<RowsResult | null>(null);
  watch(
    [() => toValue(dashboard), () => JSON.stringify(toValue(query))],
    ([dash], _, onCleanup) => {
      if (!dash) return;
      let seq = 0;
      let live = true;
      const fetch = () => {
        const mine = ++seq;
        dash.rows(toValue(query)).then(
          (r) => {
            if (live && mine === seq) rows.value = r;
          },
          (err) => console.error("[crossplot] rows failed", err),
        );
      };
      const stop = dash.onUpdate(fetch);
      onCleanup(() => {
        live = false;
        stop();
        rows.value = null;
      });
    },
    { immediate: true },
  );
  return rows;
}

/**
 * Draws one chart in a `<div>` with the spec's renderer or the dashboard's:
 * `<Chart :dashboard="dash" :spec="spec" />`. Attributes such as `class` and `style` go on the div.
 * Same lifetime rules as {@link useChart}. The component exposes `chart`, `data`, `filter` and `reset`.
 */
export const Chart = defineComponent({
  name: "CrossplotChart",
  props: {
    /** The dashboard, or null while it loads. */
    dashboard: { type: Object as PropType<Dashboard | null>, default: null },
    /** The chart spec. */
    spec: { type: Object as PropType<ChartSpec<string>>, required: true },
  },
  setup(props, { expose }) {
    const c = useChart(
      () => props.dashboard,
      () => props.spec,
    );
    expose({ chart: c.chart, data: c.data, filter: c.filter, reset: c.reset });
    return () => h("div", { ref: c.ref });
  },
});
