# @crossplot/vue

Vue 3 composables and a component for [crossplot](https://github.com/dotgap/crossplot) dashboards.
`vue` (3.3 or later) and `@crossplot/core` are peer dependencies; there are no others.

```vue
<script setup lang="ts">
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useChart, useDashboard, useSummary } from "@crossplot/vue";

const props = defineProps<{ data: Flight[] }>();
const dash = useDashboard({ data: props.data, renderer: plotRenderer() });
const summary = useSummary(dash);
const carrier = useChart(dash, { dimension: category("carrier") });
const hour = { dimension: bin("hour", { step: 1 }), view: { title: "Hour" } };
</script>

<template>
  <p>{{ summary ? `${summary.selected} of ${summary.total}` : "Loading…" }}</p>
  <Chart :dashboard="dash" :spec="hour" />
  <div :ref="carrier.ref" />
  <button @click="carrier.reset()">All carriers</button>
</template>
```

- `useDashboard(options)`: a shallow ref to the dashboard, or `null` until the data is loaded (and on
  the server). Options can be a ref or getter; rebuilt when `data` or `engine` change by identity;
  destroyed when the component unmounts or its effect scope stops.
- `useChart(dashboard, spec)`: `{ chart, data, filter, ref, reset }`, with `chart`, `data` and
  `filter` as shallow refs. Bind `ref` as a function ref to draw with the renderer, or draw `data`
  yourself. Recreated when `id`, `dimension`, `value` or `extra` change as JSON; a new `view` only
  redraws.
- `useFilters(dashboard)`, `useFilter(dashboard, id)`, `useSummary(dashboard)`,
  `useRows(dashboard, query)`: filter state, row counts and filtered rows as shallow refs.
- `<Chart :dashboard :spec />`: a `div` the chart's renderer draws into.

Every composable accepts the dashboard as a ref, a getter or a plain value, and tolerates `null`.
The API mirrors `@crossplot/react` and `@crossplot/svelte`.
