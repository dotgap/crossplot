/**
 * React hooks and a component for crossplot dashboards. The dashboard, its charts and the filter
 * state stay in `@crossplot/core`; these hooks create them with a component's lifetime and
 * re-render when they change.
 *
 * @module @crossplot/react
 */
export type { ChartProps } from "./chart.js";
export { Chart } from "./chart.js";
export { useDashboard } from "./dashboard.js";
export { useFilter, useFilters, useRows, useSummary } from "./state.js";
export type { UseChartResult } from "./use-chart.js";
export { useChart } from "./use-chart.js";
