import type { ChartSpec, Dashboard } from "@crossplot/core";
import { createElement, type HTMLAttributes, type ReactElement } from "react";
import { useChart } from "./use-chart.js";

/** Props for {@link Chart}. Other props go to the `div` the chart draws into. */
export interface ChartProps<F extends string, View = unknown> extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  /** The dashboard from {@link useDashboard}. Renders an empty `div` while it is null. */
  readonly dashboard: Dashboard<F> | null;
  /** The chart spec, as for `dashboard.chart`. Its renderer, or the dashboard's, draws it. */
  readonly spec: ChartSpec<F, View>;
}

/** A chart drawn by its renderer into a `div`. Same lifetime rules as {@link useChart}. */
export function Chart<F extends string, View = unknown>({
  dashboard,
  spec,
  ...rest
}: ChartProps<F, View>): ReactElement {
  const { ref } = useChart(dashboard, spec);
  return createElement("div", { ...rest, ref });
}
