# Vue

`@crossplot/vue` ties a dashboard and its charts to Vue 3 components. It is a thin layer: the engine,
the filter store and the renderers are the same as without Vue, and every composable hands you the core
objects in shallow refs, so anything in the rest of this guide still applies.

```sh
pnpm add @crossplot/core @crossplot/vue @crossplot/plot @observablehq/plot
```

It needs Vue 3.3 or later and has no dependencies of its own. The API mirrors
[`@crossplot/react`](./react) and [`@crossplot/svelte`](./svelte).

## A dashboard

```vue
<script setup lang="ts">
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useDashboard, useSummary } from "@crossplot/vue";

const props = defineProps<{ data: Flight[] }>();

const dash = useDashboard({ data: props.data, renderer: plotRenderer() });
const summary = useSummary(dash);
const hour = { dimension: bin("hour", { step: 1, extent: [0, 24] }), view: { title: "Hour" } };
const carrier = { dimension: category("carrier"), view: { mark: "barX", select: "multi" } };
</script>

<template>
  <p>{{ summary ? `${summary.selected} of ${summary.total} flights` : "Loading…" }}</p>
  <Chart :dashboard="dash" :spec="hour" />
  <Chart :dashboard="dash" :spec="carrier" class="wide" />
</template>
```

`useDashboard` returns a ref holding `null` until the engine has loaded the data, and every other
composable and `<Chart>` accept that `null`, so the template renders the same way before and after. A
`<Chart>` is a `div` (attributes such as `class` go to it) that the chart's renderer draws into.

## Composables

Every composable takes the dashboard first, as a ref, a getter or a plain value, and returns shallow
refs.

| Composable | Returns |
| --- | --- |
| `useDashboard(options)` | The `Dashboard`, or `null` until it is ready. Options are those of `createDashboard`. |
| `useChart(dashboard, spec)` | `{ chart, data, filter, ref, reset }` for one chart. |
| `useFilters(dashboard)` | Every filter by chart id, as in `dashboard.filters.snapshot.filters`. |
| `useFilter(dashboard, id)` | One chart's filter, or `null`. |
| `useSummary(dashboard)` | `{ selected, total }`, or `null` until the dashboard is ready. |
| `useRows(dashboard, query)` | A page of filtered rows (`RowsResult`), fetched again after every update. |

### Drawing a chart yourself

`useChart` adds a chart for the lifetime of the component. Bind its `ref` as a function ref to have the
renderer draw there, or leave it off and draw `data` with Vue:

```vue
<script setup lang="ts">
import { category } from "@crossplot/core";
import { useChart } from "@crossplot/vue";

const props = defineProps<{ dash: Dashboard<keyof Flight> | null }>();
const carriers = useChart(() => props.dash, { dimension: category("carrier") });
const { data, filter, chart } = carriers;
const picked = (key: string) => !!filter.value && "in" in filter.value && filter.value.in.includes(key);
</script>

<template>
  <button
    v-for="d in data?.data ?? []"
    :key="d.key"
    :aria-pressed="picked(d.key)"
    @click="chart?.apply({ type: 'select', keys: [d.key], mode: 'toggle' })"
  >
    {{ d.key }}: {{ d.value }}
  </button>
  <!-- Or let the renderer draw it: <div :ref="carriers.ref" /> -->
</template>
```

`chart.apply` takes the same intents a renderer reports, and `reset()` clears the chart's filter.

### Filter state

The filter store is the core `FilterStore`, so reading and writing it works as in
[Filters](./filters): `useFilters` updates on every change, and `dash.value.filters.set`, `clear` and
`replace` write it from event handlers, for example to sync it with the URL.

## Lifetimes

- **The dashboard** is created when the component mounts and destroyed when it unmounts, which stops
  the worker. Pass a ref or a getter for the options to make them reactive: the dashboard is rebuilt
  only when `data` or `engine` change by identity. Other options (`renderer`, `schedule`) are read
  when it is created. Outside a component, call it inside an `effectScope`; stopping the scope destroys
  the dashboard.
- **A chart** is recreated, and its filter cleared, only when its `id`, `dimension`, `value` or
  `extra` change as JSON, so pass the spec as a ref or getter if any of them depend on state. A new
  `view` redraws the renderer's view and keeps the filter; a new `renderer` (by identity) mounts it
  again. Unmounting the chart removes it and its filter, and the other charts re-aggregate.
- **Server rendering** never starts an engine: the dashboard is created in `onMounted`, so the
  composables hold `null` (and `{}` for filters) and `<Chart>` renders an empty `div`.
- **Errors** loading the data are logged with `console.error` and leave the dashboard `null`.

See it running in the [Vue example](../examples/vue).
