# @crossplot/svelte

Svelte 5 runes and a chart action for [crossplot](https://github.com/dotgap/crossplot) dashboards.
`svelte` (5 or later) and `@crossplot/core` are peer dependencies; there are no others.

```svelte
<script lang="ts">
  import { bin, category } from "@crossplot/core";
  import { plotRenderer } from "@crossplot/plot";
  import { chart, useChart, useDashboard, useSummary } from "@crossplot/svelte";

  let { data }: { data: Flight[] } = $props();
  const dash = useDashboard(() => ({ data, renderer: plotRenderer() }));
  const summary = useSummary(dash);
  const carrier = useChart(dash, { dimension: category("carrier") });
  const hour = { dimension: bin("hour", { step: 1 }), view: { title: "Hour" } };
</script>

<p>{summary.current ? `${summary.current.selected} of ${summary.current.total}` : "Loading…"}</p>
<div use:chart={{ dashboard: dash.current, spec: hour }}></div>
<div use:carrier.ref></div>
<button onclick={carrier.reset}>All carriers</button>
```

- `useDashboard(options)`: `{ current }`, the dashboard or `null` until the data is loaded (and on
  the server). Pass a getter to make options reactive; rebuilt when `data` or `engine` change by
  identity; destroyed with the component.
- `useChart(dashboard, spec)`: `{ chart, data, filter, ref, reset }`, all reactive. `ref` is an action
  that draws with the renderer; or draw `data` yourself. Recreated when `id`, `dimension`, `value` or
  `extra` change as JSON; a new `view` only redraws.
- `useFilters(dashboard)`, `useFilter(dashboard, id)`, `useSummary(dashboard)`,
  `useRows(dashboard, query)`: filter state, row counts and filtered rows, each as `{ current }`.
- `use:chart={{ dashboard, spec }}`: an action that adds a chart and draws it in the element.

Every rune takes the dashboard as the object `useDashboard` returns, a getter or a plain value, and
tolerates `null`. The runes ship as `.svelte.js` modules compiled by your app's Svelte compiler. The
API mirrors `@crossplot/react` and `@crossplot/vue`.
