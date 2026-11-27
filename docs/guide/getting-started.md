# Getting started

## Install

Install the core, a renderer, and the renderer's plotting library:

::: code-group

```sh [npm]
npm install @crossplot/core @crossplot/plot @observablehq/plot
```

```sh [pnpm]
pnpm add @crossplot/core @crossplot/plot @observablehq/plot
```

```sh [yarn]
yarn add @crossplot/core @crossplot/plot @observablehq/plot
```

:::

`@crossplot/core` has no dependencies of its own. `@crossplot/plot` lists `@observablehq/plot` as a peer
dependency, so you control its version.

## Your first dashboard

Start with some elements to draw into:

```html
<p id="count"></p>
<div id="hour"></div>
<div id="delay"></div>
<div id="carrier"></div>
```

Then create a dashboard from an array of row objects and add charts:

```ts
import { bin, category, createDashboard } from "@crossplot/core";
import { countDisplay } from "@crossplot/core/dom";
import { plotRenderer } from "@crossplot/plot";

type Flight = { hour: number; delay: number; carrier: string };
const flights: Flight[] = await (await fetch("/flights.json")).json();

const dash = await createDashboard({ data: flights, renderer: plotRenderer() });

dash.chart("#hour", { dimension: bin("hour", { step: 1, extent: [0, 24] }) });
dash.chart("#delay", { dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }) });
dash.chart("#carrier", { dimension: category("carrier") });

countDisplay(dash, "#count"); // "12,345 of 40,000 rows selected", with a reset button
```

The three charts are now linked. Drag across the hour chart and the delay and carrier charts redraw for
the flights in that range. Click a carrier bar to select it.

<script setup>
import { mount } from "../examples/categories.ts";
</script>

<LiveExample :run="mount" caption="Click bars to select carriers and origins, or drag across the hours" />

What these calls set up:

- **The rows were converted once** into typed-array columns. Numbers and dates become `Float64Array`s,
  strings become dictionary-encoded categories.
- **Each chart got a dimension**: `bin` for numbers and dates, `category` for strings. A chart with no
  `value` counts rows; see [aggregates](./dimensions#aggregates) for `sum` and `mean`.
- **Each chart got an id**, the field name by default. That id is also its key in the filter store.
- **The engine started in a Web Worker.** See [the engine](./engine) for when to run it on the main
  thread instead.

## Field names are typed

`createDashboard` infers field names from your row type, so a typo is a compile error:

```ts
dash.chart("#hour", { dimension: bin("hours") });
// Error: Type '"hours"' is not assignable to type 'keyof Flight'. Did you mean '"hour"'?
```

## Bundlers and the worker

The worker engine starts with `new Worker(new URL("../worker.js", import.meta.url), { type: "module" })`.
Vite, webpack 5 and Parcel pick that up without configuration. If yours doesn't, start the worker
yourself and pass it in:

```ts
import { createDashboard, workerEngine } from "@crossplot/core";

const worker = new Worker(new URL("@crossplot/core/worker", import.meta.url), { type: "module" });
const dash = await createDashboard({ data, engine: workerEngine(worker), renderer: plotRenderer() });
```

## Next steps

- [Data](./data): row objects, columns and types.
- [Dimensions and aggregates](./dimensions): every way to bin a field.
- [Filters](./filters): reading, writing and saving filter state.
- [Examples](../examples/): more live dashboards to copy from.
