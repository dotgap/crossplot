# Renderers

The core never draws. A **renderer** turns a chart's aggregated bins into pixels and reports what the
user did. `@crossplot/plot`, built on Observable Plot, is the first one; you can write your own for any
plotting library, or plain DOM.

## The contract

A renderer is an object with one method, `mount`, which returns a handle with `update` and `destroy`:

```ts
import type { Renderer } from "@crossplot/core";

const myRenderer: Renderer<MyView> = {
  mount(el, view, emit, { id, dimension }) {
    // Build your chart inside `el`. `view` is the chart spec's `view`, untouched.
    return {
      update(data, filter) {
        // Redraw with fresh aggregates. `filter` is this chart's own filter, for highlighting.
      },
      resize(width, height) {
        // Optional.
      },
      destroy() {
        // Remove everything mount added.
      },
    };
  },
};
```

`mount` is called once the engine has indexed the dimension, so `dimension` already says what the bins
are: their kind (`bin` or `category`), edges or keys, log scale and whether they hold dates.

## What `update` gets

`ChartData` holds one `Datum` per bin, flat and ready for a plotting library:

```ts
{
  index: 3,          // bin index (row-major for grids)
  key: "15–20",      // category key, or a "lo–hi" label for numeric bins
  x0: 15, x1: 20,    // numeric bin edges; NaN for categories
  value: 1204,       // the aggregate, with every other chart's filter applied
  count: 1204,       // rows in the bin
  baseline: 2310,    // the aggregate with no filters at all
  ykey, y0, y1,      // grids only: the y bin
}
```

plus `selected` and `total` row counts. Draw `value` for the current selection and `baseline` for
context, and use `filter` to show which bins this chart itself has selected.

## Reporting intents

Renderers never touch the filter store. They call `emit` with an **intent** in data space:

```ts
emit({ type: "brush", range: [x0, x1] }); // or range: null to clear
emit({ type: "brushXY", x: [x0, x1], y: [y0, y1] });
emit({ type: "select", keys: ["Polar"], mode: "replace" }); // or mode: "toggle"
emit({ type: "reset" });
```

The dashboard turns intents into filters ([table](./filters#from-the-user)), runs the engine, and
calls `update` on every chart. Ranges should be raw data values, such as the pixel position inverted
through your x scale, not bin indexes; crossplot filters exactly on them.

## A renderer in plain DOM

The [custom renderer example](../examples/headless) draws a category chart as plain HTML bars: one row
per bin, click to toggle. It's a complete renderer, mixed into a dashboard with Plot charts.

## Choosing a renderer per chart

The dashboard's `renderer` is the default. A chart's own `renderer` overrides it, so one dashboard can
mix Plot charts, a canvas scatterplot and a custom widget:

```ts
const dash = await createDashboard({ data, renderer: plotRenderer() });
dash.chart("#hour", { dimension: bin("hour", { step: 1 }) }); // Plot
dash.chart("#carrier", { dimension: "carrier", renderer: htmlBars() }); // your own
```
