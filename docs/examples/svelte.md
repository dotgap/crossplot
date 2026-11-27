# Svelte

<script setup>
import { mount } from "./svelte.ts";
</script>

The same dashboard as a Svelte 5 component with [`@crossplot/svelte`](/guide/svelte). `useChart` gives
the hour chart an action and reactive `data` and `filter`; the other two are drawn by the `chart`
action. The count line comes from `useSummary` and `useFilters`.

<LiveExample :run="mount" caption="Drag across a histogram, click a carrier" />

<<< @/examples/SvelteDashboard.svelte
