import type { Chart, ChartData, ChartSpec, Dashboard, Filter, Renderer } from "@crossplot/core";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

/** What {@link useChart} returns. */
export interface UseChartResult {
  /** The live chart, or null before the dashboard is ready. */
  readonly chart: Chart | null;
  /** The chart's latest aggregates, or null before the first update. */
  readonly data: ChartData | null;
  /** The chart's own filter, or null. */
  readonly filter: Filter | null;
  /**
   * A callback ref: put it on an element and the chart's renderer draws there with the spec's
   * `view`. Leave it unused for a headless chart that you draw yourself from `data`.
   */
  readonly ref: (el: HTMLElement | null) => void;
  /** Clear this chart's filter. */
  readonly reset: () => void;
}

const noop = () => {};
const none = () => null;

/**
 * Add a chart to a dashboard for the lifetime of a component and follow its data and filter.
 *
 * The chart is recreated (and its filter cleared) only when the spec's `id`, `dimension`,
 * `value` or `extra` change as JSON. A change to `view` only redraws the renderer's view, and a
 * change to `renderer` (by identity) mounts it again. Creation waits one microtask, so a
 * StrictMode mount, unmount and mount adds the chart once.
 */
export function useChart<F extends string, View = unknown>(
  dashboard: Dashboard<F> | null,
  spec: ChartSpec<F, View>,
): UseChartResult {
  const [chart, setChart] = useState<Chart | null>(null);
  const [el, setEl] = useState<HTMLElement | null>(null);
  const latest = useRef(spec);
  latest.current = spec;
  const chartKey = JSON.stringify([spec.id, spec.dimension, spec.value, spec.extra]);
  const viewKey = JSON.stringify(spec.view ?? null);
  const renderer = spec.renderer as Renderer<unknown> | undefined;

  useEffect(() => {
    void chartKey;
    if (!dashboard) return;
    let cancelled = false;
    let created: Chart | null = null;
    queueMicrotask(() => {
      if (cancelled) return;
      created = dashboard.chart(null, latest.current);
      setChart(created);
    });
    return () => {
      cancelled = true;
      created?.destroy();
      setChart(null);
    };
  }, [dashboard, chartKey]);

  useEffect(() => {
    void viewKey;
    if (!chart || !el) return;
    return chart.mount(el, latest.current.view, renderer);
  }, [chart, el, viewKey, renderer]);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!chart || !dashboard) return noop;
      const stopData = chart.subscribe(onChange);
      const stopFilter = dashboard.filters.subscribe(onChange);
      return () => {
        stopData();
        stopFilter();
      };
    },
    [chart, dashboard],
  );
  const data = useSyncExternalStore(subscribe, () => chart?.data ?? null, none);
  const filter = useSyncExternalStore(subscribe, () => chart?.filter ?? null, none);
  const reset = useCallback(() => chart?.apply({ type: "reset" }), [chart]);

  return useMemo(() => ({ chart, data, filter, ref: setEl, reset }), [chart, data, filter, reset]);
}
