# Dinosaur finds

<script setup>
import { mount } from "./dinosaur-finds.ts";
</script>

21,253 dinosaur fossil finds from the Paleobiology Database, on five linked charts: a stacked time series, a map, ranked bars, a part-of-whole bar and an area chart. Brush a stretch of deep time or drag a box on the map, and every other chart redraws for those finds; click a diet to select it. Click without dragging to clear a brush.

<LiveExample :run="mount" caption="Brush deep time or drag a box on the map" />

<<< @/examples/dinosaur-finds.ts

::: details Data loader
<<< @/examples/dinosaurs.ts
:::
