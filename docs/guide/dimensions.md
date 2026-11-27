# Dimensions and aggregates

Every chart groups rows by a **dimension** and computes an **aggregate** per group. A dimension turns
each row into a bin id, once, when the chart is created. After that, filtering is integer work.

```ts
dash.chart("#delay", {
  dimension: bin("delay", { step: 10, extent: [-60, 180] }), // what to group by
  value: mean("distance"), // what to compute per group (default: count())
});
```

## Numeric bins

`bin(field, options)` bins a number or date column. Pick at most one way to size the bins:

```ts
bin("hour", { step: 1 }); // fixed width in data units
bin("hour", { bins: 24 }); // a bin count across the extent (the default is 20 bins)
bin("date", { interval: "month" }); // calendar bins for dates: "day", "week", "month" or "year", in UTC
```

and optionally:

```ts
bin("delay", { step: 10, extent: [-60, 180] }); // bin range; defaults to the data's min and max
bin("delay", { step: 10, extent: [-60, 180], clamp: true }); // put outliers in the first and last bins
bin("mass", { scale: "log", bins: 40 }); // bins even in log10 space; values <= 0 count as missing
```

Without `clamp`, values outside the `extent` are left out of that chart (they still count in every
other chart). Missing values are never drawn.

Bins are only for drawing. Filters on a binned dimension are exact on raw values: a brush from 12.5 to
17.25 keeps exactly the rows in `[12.5, 17.25)`, not whole bins.

## Categories

`category(field)` makes one bin per distinct value, in sorted order. A bare field name does the same:

```ts
dash.chart("#carrier", { dimension: category("carrier") });
dash.chart("#carrier", { dimension: "carrier" }); // equivalent
```

`top(field, n)` keeps the `n` most frequent values and folds the rest into one bin, `"Other"` by
default. Use it for long-tailed fields like countries or species:

```ts
dash.chart("#origin", { dimension: top("origin", 10) });
dash.chart("#origin", { dimension: top("origin", 10, "Everywhere else") });
```

Numeric columns work as categories too; their values are turned into strings.

## Grids

Pass an `[x, y]` pair for a two-dimensional dimension, for heatmaps and stacked bars. Each axis is any
one-dimensional spec or a field name:

```ts
dash.chart("#heat", { dimension: [bin("hour", { step: 1 }), bin("delay", { step: 15 })] });
dash.chart("#stack", { dimension: [bin("date", { interval: "month" }), "carrier"] });
```

Grid bins are numbered row-major: bin `i * ySize + j` is x bin `i` and y bin `j`. A grid also takes a
plain `{ range }` or `{ in }` filter, which applies to its x axis.

### Maps

`lngLat(lng, lat, { step })` is a grid of longitude by latitude cells covering the whole world, for the
Plot renderer's `map` mark. A box brushed on the map filters the raw coordinates, not the cells.

```ts
dash.chart("#map", { dimension: lngLat("lng", "lat", { step: 2 }), view: { mark: "map" } });
```

## Aggregates

| Builder | Computes per bin |
| --- | --- |
| `count()` | Rows in the bin. The default. |
| `sum(field)` | Sum of a numeric field, ignoring missing values. |
| `mean(field)` | Mean of a numeric field, ignoring missing values. `NaN` for an empty bin. |

Every bin also carries its row `count` and its `baseline`, the aggregate with no filters at all, so a
renderer can draw "everything" behind the current selection.

`extra` adds more named aggregates over the same bins. They arrive on each bin as `Datum.extra`:

```ts
dash.chart("#map", {
  dimension: lngLat("lng", "lat"),
  extra: { delay: mean("delay") },
  view: { mark: "map", tooltip: (d) => `${d.value} flights\nmean delay ${d.extra!.delay!.toFixed(0)} min` },
});
```

## Ids

A chart's id is its key in the filter store. It defaults to the field name, or `"x×y"` for grids, with
`-2`, `-3` appended when needed. Set it yourself when two charts share a field, so the filter keys
stay readable:

```ts
dash.chart("#count", { dimension: "carrier" }); // id "carrier"
dash.chart("#delay", { id: "carrier-delay", dimension: "carrier", value: mean("delay") });
```

Two charts are two dimensions, even on the same field, and filter independently. To draw the same
chart twice with one shared filter, use [`chart.mount`](./dashboards#more-than-one-view).
