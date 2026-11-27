# Headless charts

<script setup>
import { mount } from "./custom-renderer.ts";
</script>

The carrier chart uses a custom renderer written in plain DOM, mixed with an Observable Plot chart in the same dashboard. Below them, a headless chart with no element and no renderer computes the mean delay by distance, which the example prints as text. All three filter each other.

<LiveExample :run="mount" caption="Click a carrier, brush the hours" />

<<< @/examples/custom-renderer.ts
