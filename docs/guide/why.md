# Why crossplot

Coordinated views are one of the oldest good ideas in data visualization. Put a few charts next to each
other, let the reader brush one, and watch the others answer: which hours have the late flights, which
countries have the Jurassic fossils. [dc.js](https://dc-js.github.io/dc.js/) and
[Crossfilter](https://square.github.io/crossfilter/) made the pattern popular a decade ago. crossplot is a
modern take on it for TypeScript.

## What it owns, and what it doesn't

crossplot owns the two hard parts:

- **A cross-filter engine.** It bins each chart's dimension once, keeps a bitmask of which filters each
  row fails, and updates aggregates incrementally when a filter moves.
- **A filter store.** Filter state is plain, observable and serializable, so it can live in a URL or be
  set from code.

Drawing is someone else's job. A renderer gets aggregated bins and reports what the user did, such as
"brushed x from 10 to 40". The first renderer uses [Observable Plot](https://observablehq.com/plot/);
you can write your own in a few dozen lines.

## How it differs from dc.js

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
- **Performance is a feature.** The hot path is typed arrays and bit operations, with no per-row
  allocations.

## Status

crossplot is in early development (0.x on npm). APIs can still change between minor versions. Live or
streaming data, accessibility work, maps and database backends are planned for later.
