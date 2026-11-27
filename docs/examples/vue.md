# Vue

<script setup>
import { mount } from "./vue.ts";
</script>

The linked histograms again, written as a Vue single-file component with
[`@crossplot/vue`](/guide/vue). `useChart` gives the hour chart a template ref and reactive `data` and
`filter`; the other two are drawn by `<Chart>`. The count line comes from `useSummary` and `useFilters`.

<LiveExample :run="mount" caption="Drag across a histogram, click a carrier" />

<<< @/examples/VueDashboard.vue
