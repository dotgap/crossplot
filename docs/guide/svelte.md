# Svelte

`@crossplot/svelte` ties a dashboard and its charts to Svelte 5 components with runes. It is a thin
layer: the engine, the filter store and the renderers are the same as without Svelte, and every rune
hands you the core objects, so anything in the rest of this guide still applies.

```sh
pnpm add @crossplot/core @crossplot/svelte @crossplot/plot @observablehq/plot
```

It needs Svelte 5 and has no dependencies of its own. The package ships its runes as `.svelte.js`
modules, which your Svelte compiler (through `vite-plugin-svelte` or SvelteKit) compiles with the rest of
your app. The API mirrors [`@crossplot/react`](./react) and [`@crossplot/vue`](./vue).

## A dashboard

```svelte
<script lang="ts">
  import { bin, category } from "@crossplot/core";
  import { plotRenderer } from "@crossplot/plot";
  import { chart, useDashboard, useSummary } from "@crossplot/svelte";

  let { data }: { data: Flight[] } = $props();

  const dash = useDashboard(() => ({ data, renderer: plotRenderer() }));
  const summary = useSummary(dash);
  const hour = { dimension: bin("hour", { step: 1, extent: [0, 24] }), view: { title: "Hour" } };
  const carrier = { dimension: category("carrier"), view: { mark: "barX", select: "multi" } };
</script>

<p>{summary.current ? `${summary.current.selected} of ${summary.current.total} flights` : "Loading…"}</p>
<div use:chart={{ dashboard: dash.current, spec: hour }}></div>
<div class="wide" use:chart={{ dashboard: dash.current, spec: carrier }}></div>
```

`useDashboard` returns an object whose `current` is `null` until the engine has loaded the data, and
every other rune and the `chart` action accept that `null`, so the markup renders the same way before
and after. The `chart` action creates the chart and has its renderer draw into the element.

## Runes

Call them while a component initializes. Each takes the dashboard first: the object `useDashboard`
returns, a getter, or a plain `Dashboard`. Results are reactive: read them in markup, `$derived` or
`$effect`.

| Function | Returns |
| --- | --- |
| `useDashboard(options)` | `{ current }`: the `Dashboard`, or `null` until it is ready. Options are those of `createDashboard`. |
| `useChart(dashboard, spec)` | `{ chart, data, filter, ref, reset }` for one chart. |
| `useFilters(dashboard)` | `{ current }`: every filter by chart id, as in `dashboard.filters.snapshot.filters`. |
| `useFilter(dashboard, id)` | `{ current }`: one chart's filter, or `null`. |
| `useSummary(dashboard)` | `{ current }`: `{ selected, total }`, or `null` until the dashboard is ready. |
| `useRows(dashboard, query)` | `{ current }`: a page of filtered rows (`RowsResult`), fetched again after every update. |

The values follow Svelte's `.current` convention from `svelte/reactivity`. Don't destructure them: read
`summary.current` where you need it, so the read stays reactive.

### Drawing a chart yourself

`useChart` adds a chart for the lifetime of the component. Its `ref` is an action: put it on an element
with `use:` to have the renderer draw there, or leave it off and draw `data` with Svelte:

```svelte
<script lang="ts">
  import { category } from "@crossplot/core";
  import { useChart } from "@crossplot/svelte";

  let { dash }: { dash: { current: Dashboard<keyof Flight> | null } } = $props();
  const carriers = useChart(() => dash.current, { dimension: category("carrier") });
  const picked = $derived(carriers.filter && "in" in carriers.filter ? carriers.filter.in : []);
</script>

{#each carriers.data?.data ?? [] as d (d.key)}
  <button
    aria-pressed={picked.includes(d.key)}
    onclick={() => carriers.chart?.apply({ type: "select", keys: [d.key], mode: "toggle" })}
  >
    {d.key}: {d.value}
  </button>
{/each}
<!-- Or let the renderer draw it: <div use:carriers.ref></div> -->
```

`chart.apply` takes the same intents a renderer reports, and `reset()` clears the chart's filter.

### Filter state

The filter store is the core `FilterStore`, so reading and writing it works as in
[Filters](./filters): `useFilters` updates on every change, and `dash.current.filters.set`, `clear`
and `replace` write it from event handlers, for example to sync it with the URL.

## Lifetimes

- **The dashboard** is created in an effect after the component mounts and destroyed with the
  component, which stops the worker. Pass the options as a getter to make them reactive: the dashboard
  is rebuilt only when `data` or `engine` change by identity. Other options (`renderer`, `schedule`)
  are read when it is created. Outside a component, call the runes inside `$effect.root`; calling its
  cleanup destroys the dashboard.
- **A chart** is recreated, and its filter cleared, only when its `id`, `dimension`, `value` or
  `extra` change as JSON, so pass the spec as a getter if any of them depend on state. A new `view`
  redraws the renderer's view and keeps the filter; a new `renderer` (by identity) mounts it again.
  Removing the component (or the element with the `chart` action) removes the chart and its filter,
  and the other charts re-aggregate.
- **Server rendering** runs no effects: the runes hold `null` (and `{}` for filters) and the engine
  starts in the browser after hydration.
- **Errors** loading the data are logged with `console.error` and leave the dashboard `null`.

See it running in the [Svelte example](../examples/svelte).
