# Dashboards and charts

`createDashboard` ties one table, one engine and one filter store together. Charts are added to it one
at a time.

```ts
const dash = await createDashboard({
  data: rows, // row objects or a column table
  renderer: plotRenderer(), // default renderer for charts that draw into an element
  engine: "worker", // "worker" (default where available), "local", or your own DataEngine
});
```

It resolves once the table is loaded into the engine.

## Adding charts

`dash.chart(target, spec)` adds a chart and returns it right away. The engine indexes the dimension in
the background; `chart.ready` resolves when it's done.

```ts
const hour = dash.chart("#hour", {
  id: "hour", // optional; defaults to the field name
  dimension: bin("hour", { step: 1 }),
  value: count(), // optional; the default
  view: { brush: "x" }, // handed to the renderer untouched
  renderer: plotRenderer(), // optional; overrides the dashboard's renderer
});
```

The target is a CSS selector, an element, or `null` for a [headless chart](#headless-charts).

The spec is a plain object. Everything except `renderer` and `view` is sent to the engine, so it has
to be serializable. `view` is whatever your renderer understands; for Observable Plot that's
[`PlotView`](./plot).

## Updates

Changes are coalesced. However many filters change within one animation frame, the dashboard sends
one request to the engine and draws once with the result. If the engine is still busy with an older
request, newer changes wait and older results are never drawn over newer ones.

`dash.idle()` resolves when everything requested so far has been drawn, which is useful in tests:

```ts
dash.filters.set("hour", { range: [6, 9] });
await dash.idle();
expect(dash.summary.selected).toBe(4_211);
```

## Reading results

Each chart exposes its latest aggregates as `chart.data`, and calls subscribers after every update:

```ts
hour.subscribe(({ data, selected, total }, filter) => {
  for (const d of data) console.log(d.key, d.value, d.baseline);
});
```

`dash.onUpdate` reports selected and total row counts, and `dash.rows()` returns a page of the rows
passing every filter:

```ts
dash.onUpdate(({ selected, total }) => console.log(`${selected} of ${total}`));
const { rows } = await dash.rows({ columns: ["date", "carrier", "delay"], sort: "-delay", limit: 20 });
```

## Headless charts

A chart with a `null` target has no renderer. It's still a full dimension: it filters the others and
gets filtered by them. Use it to compute numbers for your own UI, or to filter on a field you don't
draw:

```ts
const byCarrier = dash.chart(null, { dimension: "carrier", value: mean("delay") });
byCarrier.subscribe(({ data }) => updateMyTable(data));
byCarrier.apply({ type: "select", keys: ["Polar"], mode: "replace" });
```

## More than one view

`chart.mount(target, view?)` draws an existing chart in one more place, such as a compact copy in a
summary strip. Every view shares the chart's dimension and filter, so brushing either one moves both.
It returns a function that removes the view.

```ts
const timeline = dash.chart("#timeline", { dimension: bin("age", { step: 1 }), view: { height: 300 } });
const removeMini = timeline.mount("#mini-timeline", { height: 60, xLabel: null });
```

## DOM widgets

`@crossplot/core/dom` has two small widgets that need no plotting library:

```ts
import { countDisplay, dataTable } from "@crossplot/core/dom";

countDisplay(dash, "#count"); // "1,234 of 40,000 rows selected" plus a "Reset all" button
dataTable(dash, "#table", { columns: ["date", "carrier", { field: "delay", label: "Delay (min)" }], sort: "-delay" });
```

Both return a cleanup function.

## Cleaning up

`chart.destroy()` removes a chart, its views, its dimension and its filter. `dash.destroy()` removes
everything and stops the engine, terminating the worker.
