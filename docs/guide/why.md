# Why crossplot

In a set of coordinated views, selecting data in one chart filters the data in the others. For
example, brushing a range of departure hours shows the delay distribution for flights in that range.
[dc.js](https://dc-js.github.io/dc.js/) and [Crossfilter](https://square.github.io/crossfilter/) are
the best-known JavaScript libraries for this. crossplot implements the same model in TypeScript.

## What crossplot does

crossplot has two parts:

- **A cross-filter engine.** It bins each chart's dimension once, keeps a bitmask of which filters each
  row fails, and updates aggregates incrementally when a filter changes.
- **A filter store.** Filter state is a plain, observable, serializable object. You can store it in a
  URL or set it from code.

Charts are drawn by a renderer. A renderer receives aggregated bins and reports user input, such as
"brushed x from 10 to 40". The first renderer uses [Observable Plot](https://observablehq.com/plot/).
A custom renderer is a few dozen lines of code.

## Comparison with dc.js

| | dc.js + Crossfilter | crossplot |
| --- | --- | --- |
| Language | JavaScript | TypeScript, with field names checked against your row type |
| Engine | Main thread | Web Worker by default, or the main thread |
| Storage | Arrays of row objects | Typed-array columns and dictionary-encoded categories |
| Filters | Functions and bin-snapped ranges | Plain JSON, exact on raw values |
| Drawing | Built-in D3 charts | Pluggable renderers, starting with Observable Plot |
| Dependencies | D3, Crossfilter | None in the core |

## Design principles

- **The core has zero runtime dependencies** and never touches the DOM, apart from two optional widgets
  under `@crossplot/core/dom`.
- **Data flows one way.** Renderers get data and their own filter, and report intents. They never read
  or write the filter store.
- **Crossfilter semantics.** Each chart aggregates the rows that pass every filter except its own, so
  a brushed chart keeps showing the full distribution it was brushed on.
- **Everything across the engine boundary is serializable**: specs, filters and results. That is what
  lets the engine run in a worker.
- **Performance.** The hot path uses typed arrays and bit operations and does not allocate per row.

## Status

crossplot is at 0.x on npm, and the API can change between minor versions. Live or streaming data,
accessibility work, map projections other than plate carrée and database backends are not supported
yet.
