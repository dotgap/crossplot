<script setup lang="ts">
import { bin, category } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useChart, useDashboard, useFilters, useSummary } from "@crossplot/vue";
import { computed } from "vue";
import { flights } from "./data.js";
import type { ExampleTheme } from "./theme.js";

const props = defineProps<{ theme: ExampleTheme }>();

// Created after mount, destroyed on unmount. `dash` is null until the data is indexed.
const dash = useDashboard({
  data: flights(),
  engine: "local",
  renderer: plotRenderer({ defaults: { color: props.theme.color, mutedColor: props.theme.muted, height: 160 } }),
});

// A chart you draw with a template ref, and whose data and filter you can read.
const hour = useChart(dash, {
  dimension: bin("hour", { step: 1, extent: [0, 24] }),
  view: { title: "Departure hour", xLabel: null },
});
const brushed = computed(() => {
  const f = hour.filter.value;
  return f && "range" in f ? `${f.range[0].toFixed(1)}h to ${f.range[1].toFixed(1)}h` : "all day";
});

// Or let <Chart> draw it.
const delay = {
  dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }),
  view: { title: "Arrival delay (minutes)", xLabel: null },
};
const carrier = { dimension: category("carrier"), view: { title: "Carrier", sort: "-baseline", xLabel: null } };

const summary = useSummary(dash);
const filters = useFilters(dash);
const filtered = computed(() => Object.keys(filters.value).length > 0);
const clear = () => dash.value?.filters.clear();
</script>

<template>
  <p class="crossplot-count">
    <template v-if="summary">
      {{ summary.selected.toLocaleString("en-US") }} of {{ summary.total.toLocaleString("en-US") }} flights,
      departing {{ brushed }}
    </template>
    <template v-else>Loading…</template>
    <button v-if="filtered" class="cp-button" type="button" @click="clear()">Clear all</button>
  </p>
  <div class="cp-grid">
    <div :ref="hour.ref" />
    <Chart :dashboard="dash" :spec="delay" />
    <Chart class="cp-wide" :dashboard="dash" :spec="carrier" />
  </div>
</template>
