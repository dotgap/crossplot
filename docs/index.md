---
layout: home
title: crossplot
titleTemplate: Coordinated, cross-filtered charts for TypeScript

hero:
  name: crossplot
  text: Brush one chart. Every linked chart re-aggregates.
  tagline: Coordinated, cross-filtered charts for TypeScript. A fast columnar engine and a plain filter store, with drawing handed to the renderer you already like.
  image:
    light: /crossplot-mark-light.svg
    dark: /crossplot-mark-dark.svg
    alt: ""
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: See the dinosaur demo
      link: /demo/
      target: _self
    - theme: alt
      text: GitHub
      link: https://github.com/dotgap/crossplot

features:
  - title: Fast by design
    details: Typed-array columns, one filter bit per dimension, and updates that only touch the rows whose bit flips. About a millisecond per brush frame at a million rows.
  - title: Off the main thread
    details: The engine runs in a Web Worker by default. Requests are coalesced to one per frame and stale results are dropped, so brushing stays smooth.
  - title: Zero dependencies
    details: "@crossplot/core is headless and has no runtime dependencies. Renderers and framework wrappers are separate, opt-in packages."
  - title: Plain, serializable state
    details: Charts are spec objects and filters are JSON. Save them to a URL, restore them, or set them from code.
  - title: Exact filters
    details: Ranges are half-open and exact on raw values at the brush edges, not snapped to bins.
  - title: Bring your own renderer
    details: Observable Plot comes first. A renderer is three methods, mount, update and destroy, and it reports what the user did in data space.
---

<script setup>
import { mount } from "./examples/dinosaur-finds.ts";
</script>

<div class="cp-home">

## Try it

These five charts share one table of 21,253 dinosaur fossil finds. Brush a stretch of deep time or
drag a box on the map, and the rest redraw for those finds; click without dragging to clear.

<LiveExample :run="mount" caption="Linked charts, running in your browser" />

```ts
const dash = await createDashboard({ data: fromColumns(dinosaurs), renderer: plotRenderer() });

dash.chart("#age", { dimension: [bin("age", { step: 2 }), "group"], view: { mark: "stackY" } });
dash.chart("#map", { dimension: lngLat("lng", "lat", { step: 3 }), view: { mark: "map" } });
dash.chart("#country", { dimension: top("country", 10), view: { sort: "-value" } });
dash.chart("#diet", { dimension: "diet", view: { mark: "shareX" } });
dash.chart("#reported", { dimension: bin("reported", { step: 5 }), view: { mark: "areaY" } });
```

<a class="cp-demo-card" href="./demo/" target="_self">
  <img src="/dinosaur-demo.png" alt="Linked charts in the dinosaur demo, filtered to finds from Mongolia" />
  <div>
    <span class="cp-kicker">Demo</span>
    <h3>The Long Dig</h3>
    <p>An editorial page on 21,253 dinosaur fossil finds from the Paleobiology Database. Every chart on it is connected: pick a family, a country or a stretch of deep time, and the rest of the story redraws.</p>
    <span class="cp-cta">Open the demo →</span>
  </div>
</a>

## Status

crossplot is in early development and not on npm yet. APIs will change before the first release.

</div>
