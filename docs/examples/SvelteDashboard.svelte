<script lang="ts">
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { chart, useChart, useDashboard, useFilters, useSummary } from "@crossplot/svelte";
import { flights } from "./data.js";
import type { ExampleTheme } from "./theme.js";

let { theme }: { theme: ExampleTheme } = $props();

// Created after mount, destroyed with the component. `dash.current` is null until the data is indexed.
// A getter keeps the options reactive; the dashboard is rebuilt only when `data` or `engine` change.
const data = flights();
const dash = useDashboard(() => ({
  data,
  engine: "local",
  renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted, height: 160 } }),
}));

// A chart you draw with an action, and whose data and filter you can read.
const hour = useChart(dash, {
  dimension: bin("hour", { step: 1, extent: [0, 24] }),
  view: { title: "Departure hour", xLabel: null },
});
const brushed = $derived(
  hour.filter && "range" in hour.filter
    ? `${hour.filter.range[0].toFixed(1)}h to ${hour.filter.range[1].toFixed(1)}h`
    : "all day",
);

// Or let the chart action create and draw it.
const delay = {
  dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }),
  view: { title: "Arrival delay (minutes)", xLabel: null },
};
const carrier = { dimension: category("carrier"), view: { title: "Carrier", sort: "-baseline", xLabel: null } };

const summary = useSummary(dash);
const filters = useFilters(dash);
</script>

<p class="crossplot-count">
  {#if summary.current}
    {summary.current.selected.toLocaleString("en-US")} of {summary.current.total.toLocaleString("en-US")} flights,
    departing {brushed}
  {:else}
    Loading…
  {/if}
  {#if Object.keys(filters.current).length}
    <button class="cp-button" type="button" onclick={() => dash.current?.filters.clear()}>Clear all</button>
  {/if}
</p>
<div class="cp-grid">
  <div use:hour.ref></div>
  <div use:chart={{ dashboard: dash.current, spec: delay }}></div>
  <div class="cp-wide" use:chart={{ dashboard: dash.current, spec: carrier }}></div>
</div>
