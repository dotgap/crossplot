---
layout: home
title: crossplot
titleTemplate: Cross-filtered charts for TypeScript

hero:
  name: crossplot
  text: Cross-filtered charts for TypeScript
  tagline: Select a range in one chart and the other charts on the page update to show only the matching rows. crossplot provides the filtering engine and the filter state. A separate renderer package draws the charts.
  image:
    light: /crossplot-mark-light.svg
    dark: /crossplot-mark-dark.svg
    alt: ""
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Demo
      link: /demo/
      target: _self
    - theme: alt
      text: GitHub
      link: https://github.com/dotgap/crossplot

features:
  - title: Incremental updates
    details: Data is stored in typed-array columns with one filter bit per dimension. When a filter changes, only rows whose bit changes are updated. With a million rows, the engine handles a brush frame in 0.3 to 2 ms.
  - title: Web Worker engine
    details: The engine runs in a Web Worker by default. The dashboard sends at most one request per animation frame and discards results that are out of date.
  - title: No runtime dependencies
    details: "@crossplot/core has no runtime dependencies and does not draw anything. Renderers and the React, Vue and Svelte bindings are separate packages."
  - title: Serializable state
    details: Chart specs are plain objects and filters are JSON. You can store filters in a URL, restore them later, or set them from code.
  - title: Exact range filters
    details: Range filters are half-open intervals on the raw values. A brush that ends inside a bin keeps only the rows on its side of the edge.
  - title: Pluggable renderers
    details: The first renderer uses Observable Plot. A renderer implements mount, update and destroy, and reports user input such as brushes and clicks in data units.
---

<script setup>
import { mount } from "./examples/linked-histograms.ts";
</script>

<div class="cp-home">

## Example

These four charts use the same table of 40,000 synthetic flights. Drag across a chart to filter the
other three. Click without dragging to clear the filter.

<LiveExample :run="mount" caption="Linked histograms, running in your browser" />

```ts
const dash = await createDashboard({ data: flights, renderer: plotRenderer() });

dash.chart("#hour", { dimension: bin("hour", { step: 1, extent: [0, 24] }) });
dash.chart("#delay", { dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }) });
dash.chart("#distance", { dimension: bin("distance", { scale: "log", bins: 30 }) });
dash.chart("#date", { dimension: bin("date", { interval: "week" }) });
```

<a class="cp-demo-card" href="./demo/" target="_self">
  <img src="/dinosaur-demo.png" alt="Linked charts in the dinosaur demo, filtered to finds from Mongolia" />
  <div>
    <span class="cp-kicker">Demo</span>
    <h3>Dinosaur fossil finds</h3>
    <p>A page of linked charts on 21,253 dinosaur fossil finds from the Paleobiology Database. Select a family, a country or a time range, and the other charts update.</p>
    <span class="cp-cta">Open the demo</span>
  </div>
</a>

## Status

crossplot 0.1 is on npm. The API can change between minor versions until 1.0.

</div>
