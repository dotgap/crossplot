# Dinosaur finds

<script setup>
import { mount } from "./dinosaur-finds.ts";
</script>

Five linked charts on 21,253 dinosaur fossil finds from the Paleobiology Database: a stacked time series, a map, ranked bars, a part-of-whole bar and an area chart. Drag across the time chart or draw a box on the map to filter the other charts. Click a diet to select it, and click without dragging to clear a brush.

<LiveExample :run="mount" caption="Drag across the time chart or draw a box on the map" />

<<< @/examples/dinosaur-finds.ts

::: details Data loader
<<< @/examples/dinosaurs.ts
:::
