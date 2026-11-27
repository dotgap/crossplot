# React

<script setup>
import { mount } from "./react.tsx";
</script>

The same linked charts as a React app, rendered in `StrictMode` with `@crossplot/react`. The two histograms are `<Chart>` components drawn by Observable Plot. The carrier buttons are a headless chart from `useChart`, drawn with plain React elements; clicking one toggles it in the carrier filter. The count, the "Clear all" button and the table below follow the filter state through `useSummary`, `useFilters` and `useRows`.

<LiveExample :run="mount" caption="Brush a histogram or toggle a carrier" />

<<< @/examples/react.tsx
