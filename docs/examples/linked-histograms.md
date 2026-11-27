# Linked histograms

<script setup>
import { mount } from "./linked-histograms.ts";
</script>

Four binned charts on one table. Drag across any chart to filter the rest; click without dragging to clear. Each chart keeps drawing its own full distribution, with the brushed bins highlighted, while every other chart redraws.

<LiveExample :run="mount" caption="Drag across any chart" />

<<< @/examples/linked-histograms.ts
