# Heatmap brushing

<script setup>
import { mount } from "./heatmap.ts";
</script>

An `[x, y]` pair makes a grid dimension. Drag a rectangle on the heatmap to filter both axes at once. A grid of a binned x and a categorical y draws as stacked bars with `mark: "stackY"`, brushable along x.

<LiveExample :run="mount" caption="Drag a rectangle on the heatmap" />

<<< @/examples/heatmap.ts
