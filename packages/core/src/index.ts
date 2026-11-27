/**
 * Headless cross-filter engine, filter store and dashboard model.
 *
 * @module @crossplot/core
 */
export type { Chart, ChartListener, ChartSpec, Dashboard, DashboardOptions, Summary } from "./dashboard.js";
export { createDashboard } from "./dashboard.js";
export type { CrossIndexOptions } from "./engine/crossindex.js";
export { CrossIndex, MAX_DIMENSIONS } from "./engine/crossindex.js";
export { localEngine } from "./engine/local.js";
export type { Port } from "./engine/protocol.js";
export { connectEngine, serveEngine } from "./engine/protocol.js";
export { workerEngine } from "./engine/worker.js";
export type { FilterListener, FilterSnapshot } from "./filters.js";
export { FilterStore } from "./filters.js";
export type { ChartData, Datum, Intent, MountContext, Renderer, RenderHandle } from "./renderer.js";
export type { BinOptions, LngLatOptions } from "./specs.js";
export { bin, category, count, lngLat, mean, sum, top } from "./specs.js";
export type { ColumnInput, ColumnType, FromRowsOptions } from "./table.js";
export { fromColumns, fromRows } from "./table.js";
export type * from "./types.js";
