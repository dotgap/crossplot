# @crossplot/core

Headless, zero-dependency cross-filter engine and dashboard model for
[crossplot](https://github.com/dotgap/crossplot).

```ts
import { bin, count, createDashboard, mean, top } from "@crossplot/core";

const dash = await createDashboard({ data: rows });   // engine: "worker" | "local" | DataEngine
const year = dash.chart(null, { dimension: bin("year", { step: 10 }), value: count() });
year.subscribe((data) => console.log(data.data));     // per-bin { key, x0, x1, value, count }
dash.filters.set(year.id, { range: [1900, 1950] });
```

- `createDashboard({ data, engine, renderer })` takes row objects or a column table
  (`fromRows`, `fromColumns`).
- Dimensions: `bin(field, { step | bins | interval, scale, extent, clamp })`, a bare field name
  (categorical), `top(field, n)`, or an `[x, y]` pair for grids.
- Aggregates: `count()`, `sum(field)`, `mean(field)`.
- Filters: `{ range: [lo, hi] }` (half-open), `{ in: [...keys] }`, `{ x, y }` for grids.
- Every chart's data carries `baseline` per bin: the aggregate with no filters, for drawing
  "everything" behind a selection. A plain `{ range }` on a grid filters its x axis.
- `chart.mount(target, view)` draws an existing chart in another place; all its views share
  one dimension and one filter.
- `CrossIndex` is the synchronous engine underneath, usable on its own.
- `@crossplot/core/dom` has `countDisplay` and `dataTable` widgets with no other dependencies.

Renderers implement `Renderer` (see `src/renderer.ts`); `@crossplot/plot` is the first one.
