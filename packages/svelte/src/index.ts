/**
 * Svelte 5 bindings for crossplot: runes that create a dashboard, add linked charts and follow the
 * selection, plus a `chart` action that draws one chart in an element.
 *
 * @module @crossplot/svelte
 */
import type { Chart, ChartSpec, Dashboard, Renderer } from "@crossplot/core";
import type { ActionReturn } from "svelte/action";
import { specKey } from "./runes.svelte.js";

export type { Current, DashboardSource, MaybeGetter, RowsOptions, UseChart } from "./runes.svelte.js";
export { useChart, useDashboard, useFilter, useFilters, useRows, useSummary } from "./runes.svelte.js";

/** Parameters of the {@link chart} action. */
export interface ChartParams<View = unknown> {
  /** The dashboard, or null while it loads. */
  readonly dashboard: Dashboard | null | undefined;
  /** The chart spec. Its renderer, or the dashboard's, draws it. */
  readonly spec: ChartSpec<string, View>;
}

/**
 * An action that adds a chart and draws it in the element with the spec's renderer or the dashboard's.
 * The chart lives as long as the element. A new dashboard or a change to the spec's `id`,
 * `dimension`, `value` or `extra` recreates it; a new `view` or `renderer` only redraws it.
 *
 * ```svelte
 * <div use:chart={{ dashboard: dash.current, spec }}></div>
 * ```
 */
export function chart<View = unknown>(node: HTMLElement, params: ChartParams<View>): ActionReturn<ChartParams<View>> {
  let current: Chart | null = null;
  let dash: Dashboard | null = null;
  let key = "";
  let drawn: string | null = null;
  let drawnWith: Renderer<View> | undefined;
  let unmount: (() => void) | null = null;

  const undraw = () => {
    unmount?.();
    unmount = null;
    drawn = null;
  };

  const apply = (p: ChartParams<View>) => {
    const d = p.dashboard ?? null;
    const k = specKey(p.spec);
    if (d !== dash || k !== key) {
      undraw();
      current?.destroy();
      current = d ? d.chart(null, p.spec) : null;
      dash = d;
      key = k;
    }
    const view = JSON.stringify(p.spec.view ?? null);
    const renderer = p.spec.renderer;
    if (current && (view !== drawn || renderer !== drawnWith)) {
      undraw();
      unmount = current.mount(node, p.spec.view, renderer);
      drawn = view;
      drawnWith = renderer;
    }
  };

  apply(params);
  return {
    update: apply,
    destroy() {
      undraw();
      current?.destroy();
      current = null;
    },
  };
}
