# Filters

A dashboard has one `FilterStore`: a plain map from chart id to filter. Renderers don't write to it
directly. They report what the user did, and the dashboard turns that into a filter. You can read and
write the store yourself at any time.

## Filter shapes

Filters are plain JSON in data space:

```ts
{ range: [17, 21] }                       // numbers in [17, 21): half-open
{ range: [Date.UTC(2025, 5, 1), Date.UTC(2025, 8, 1)] } // dates, as epoch milliseconds
{ in: ["Polar", "Lark"] }                 // category keys
{ x: { range: [6, 12] }, y: { range: [30, 180] } } // a rectangle on a grid
{ x: { range: [0, 100] }, y: { in: ["Theropods"] } } // grid axes can mix ranges and key sets
```

A grid also takes a plain `{ range }`, which filters its x axis and keeps every y. Use `null` for a
grid axis you don't want to filter.

Ranges are exact on raw values, independent of the chart's bins. `[17, 21)` keeps a flight at 20.99
and drops one at 21.0.

## Crossfilter semantics

Each chart aggregates the rows that pass **every filter except its own**. When you brush the hour
chart, the hour chart keeps drawing all hours, highlighting the brushed ones, while every other chart
redraws for the flights in that range. This lets you move the brush and compare each selection with
the full distribution.

A chart's own filter is still applied to every other chart, and to the dashboard's `summary` and
`rows()`.

## Reading and writing

```ts
dash.filters.get("carrier"); // { in: ["Polar"] } or null
dash.filters.set("carrier", { in: ["Polar", "Lark"] });
dash.filters.set("hour", { range: [6, 9] });
dash.filters.set("hour", null); // clear one
dash.filters.clear("hour"); // same
dash.filters.clear(); // clear all
```

Charts redraw exactly as if the user had brushed or clicked. Setting an equal filter does nothing.
A filter for an id with no chart is kept in the store but ignored by the engine until a chart with that
id exists.

## Listening

`subscribe` calls you with an immutable snapshot after every change:

```ts
const off = dash.filters.subscribe((snapshot) => {
  console.log(snapshot.version, snapshot.filters);
});
```

## Saving and restoring

Snapshots are JSON-safe, so filter state can live in a URL hash, `localStorage` or a server:

```ts
// Save on every change.
dash.filters.subscribe((snap) => {
  history.replaceState(null, "", `#${encodeURIComponent(JSON.stringify(snap.toJSON()))}`);
});

// Restore on load, replacing whatever was there.
if (location.hash.length > 1) dash.filters.replace(JSON.parse(decodeURIComponent(location.hash.slice(1))));
```

The [dinosaur demo](/demo/){target="_self"} keeps its filters in the URL this way, so a reload or a
shared link opens the same selection. Try it live in the [filter state example](../examples/url-state).

## From the user

The dashboard maps renderer intents to filters on the chart that emitted them:

| Intent | Filter |
| --- | --- |
| `{ type: "brush", range: [lo, hi] }` | `{ range: [lo, hi] }` |
| `{ type: "brush", range: null }` | cleared |
| `{ type: "brushXY", x, y }` | `{ x: { range: x }, y: { range: y } }` |
| `{ type: "select", keys, mode: "replace" }` | `{ in: keys }`, or cleared when `keys` is empty |
| `{ type: "select", keys, mode: "toggle" }` | `keys` toggled in or out of the current set |
| `{ type: "reset" }` | cleared |

You can apply intents yourself with `chart.apply(intent)`, for example from a custom control.
