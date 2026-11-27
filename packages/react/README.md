# @crossplot/react

React hooks and a component for [crossplot](https://github.com/dotgap/crossplot) dashboards.
`react` (18 or later) and `@crossplot/core` are peer dependencies; there are no others.

```tsx
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useChart, useDashboard, useSummary } from "@crossplot/react";

const renderer = plotRenderer();

function Flights({ data }: { data: Flight[] }) {
  const dash = useDashboard({ data, renderer });
  const summary = useSummary(dash);
  const carrier = useChart(dash, { dimension: category("carrier") });
  return (
    <>
      <p>{summary ? `${summary.selected} of ${summary.total}` : "Loading…"}</p>
      <Chart dashboard={dash} spec={{ dimension: bin("hour", { step: 1 }), view: { title: "Hour" } }} />
      <div ref={carrier.ref} />
      <button onClick={carrier.reset}>All carriers</button>
    </>
  );
}
```

- `useDashboard(options)`: the dashboard, or `null` until the data is loaded (and on the server).
  Recreated when `data` or `engine` change by identity; destroyed on unmount.
- `useChart(dashboard, spec)`: `{ chart, data, filter, ref, reset }`. Put `ref` on an element to draw
  with the renderer, or draw `data` yourself. Recreated when `id`, `dimension`, `value` or `extra`
  change as JSON; a new `view` only redraws.
- `useFilters(dashboard)`, `useFilter(dashboard, id)`, `useSummary(dashboard)`,
  `useRows(dashboard, query)`: filter state, row counts and filtered rows, re-rendering on change.
- `<Chart dashboard spec />`: a `div` the chart's renderer draws into.

Every hook accepts a `null` dashboard. Creation waits a microtask, so React StrictMode's
mount-unmount-mount starts one engine (one worker) and adds each chart once.
