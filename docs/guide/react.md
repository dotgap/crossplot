# React

`@crossplot/react` ties a dashboard and its charts to React components. It is a thin layer: the
engine, the filter store and the renderers are the same as without React, and every hook hands you the
core objects, so anything in the rest of this guide still applies.

```sh
pnpm add @crossplot/core @crossplot/react @crossplot/plot @observablehq/plot
```

It needs React 18 or later and has no dependencies of its own.

## A dashboard

```tsx
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useDashboard, useSummary } from "@crossplot/react";

const renderer = plotRenderer();
const hour = { dimension: bin("hour", { step: 1, extent: [0, 24] }), view: { title: "Hour" } };
const carrier = { dimension: category("carrier"), view: { mark: "barX", select: "multi" } };

export function Flights({ data }: { data: Flight[] }) {
  const dash = useDashboard({ data, renderer });
  const summary = useSummary(dash);
  return (
    <>
      <p>{summary ? `${summary.selected} of ${summary.total} flights` : "Loading…"}</p>
      <Chart dashboard={dash} spec={hour} />
      <Chart dashboard={dash} spec={carrier} className="wide" />
    </>
  );
}
```

`useDashboard` returns `null` until the engine has loaded the data, and every other hook and
`<Chart>` accept that `null`, so the tree renders the same way before and after. A `<Chart>` is a
`div` (extra props go to it) that the chart's renderer draws into.

## Hooks

| Hook | Returns |
| --- | --- |
| `useDashboard(options)` | The `Dashboard`, or `null` until it is ready. Options are those of `createDashboard`. |
| `useChart(dashboard, spec)` | `{ chart, data, filter, ref, reset }` for one chart. |
| `useFilters(dashboard)` | Every filter by chart id, as in `dashboard.filters.snapshot.filters`. |
| `useFilter(dashboard, id)` | One chart's filter, or `null`. |
| `useSummary(dashboard)` | `{ selected, total }`, or `null` until the dashboard is ready. |
| `useRows(dashboard, query)` | A page of filtered rows (`RowsResult`), fetched again after every update. |

The hooks subscribe through `useSyncExternalStore`, so a component re-renders only when the value it
reads changes: a chart's data after an engine update, the filter state after a brush.

### Drawing a chart yourself

`useChart` adds a chart for the lifetime of the component. Put its `ref` on an element to have the
renderer draw there, or leave it off and draw `data` with React:

```tsx
function Carriers({ dash }: { dash: Dashboard<keyof Flight> | null }) {
  const { data, filter, chart } = useChart(dash, { dimension: category("carrier") });
  const picked = filter && "in" in filter ? filter.in : [];
  return data?.data.map((d) => (
    <button
      key={d.key}
      aria-pressed={picked.includes(d.key)}
      onClick={() => chart?.apply({ type: "select", keys: [d.key], mode: "toggle" })}
    >
      {d.key}: {d.value}
    </button>
  ));
}
```

`chart.apply` takes the same intents a renderer reports, and `reset()` clears the chart's filter.

### Filter state

The filter store is the core `FilterStore`, so reading and writing it works as in
[Filters](./filters): `useFilters` re-renders on every change, and `dash.filters.set`,
`clear` and `replace` write it from event handlers, for example to sync it with the URL.

## Lifetimes

- **The dashboard** is created once and recreated only when `data` or `engine` change by identity,
  so keep the data in state, a memo or a module constant, and memoize a custom engine. Other options
  (`renderer`, `schedule`) are read when it is created. It is destroyed when the component unmounts,
  which stops the worker.
- **A chart** is recreated, and its filter cleared, only when its `id`, `dimension`, `value` or
  `extra` change as JSON, so inline spec objects are fine. A new `view` redraws the renderer's view
  and keeps the filter; a new `renderer` (by identity) mounts it again. Unmounting the chart removes
  it and its filter, and the other charts re-aggregate.
- **StrictMode** mounts, unmounts and mounts every component in development. Creating the dashboard
  and charts waits one microtask, so that cycle starts one engine, one worker and one chart each.
- **Server rendering** runs no effects: the hooks return `null` (and `{}` for filters) and `<Chart>`
  renders an empty `div`. The engine starts in the browser after hydration.
- **Errors** loading the data are thrown from `useDashboard` during render, for an error boundary.

See it running in the [React example](../examples/react).
