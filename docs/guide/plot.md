# Observable Plot renderer

`@crossplot/plot` draws charts with [Observable Plot](https://observablehq.com/plot/) and adds brushing
and click selection on top. `@observablehq/plot` is a peer dependency.

```ts
import { createDashboard } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";

const dash = await createDashboard({
  data,
  renderer: plotRenderer({ defaults: { color: "#3b6cf0", mutedColor: "#d4d6dc", height: 180 } }),
});
```

`defaults` are merged under every chart's `view`. Each chart's `view` is a
[`PlotView`](/api/@crossplot/plot/interfaces/PlotView); every field is optional.

## Marks

The mark follows the dimension unless you pick one:

| Dimension | Default mark | Also works |
| --- | --- | --- |
| `bin(...)` | `rectY` histogram | `line`, `areaY`, `barY` |
| `category(...)`, `top(...)` | `barX` horizontal bars | `barY` |
| `[bin, bin]` grid | `rect` heatmap | |
| grid with a categorical axis | `cell` | `stackY`: stacked bars over a binned x, one color per y key; `streamY`: the same as a centered streamgraph |
| `category(...)` with a few keys | | `shareX`: one bar split into parts; click a part to select it |
| `[category, category]` grid | | `bump`: one line per x key, ranked within each y key; click a line to select it |
| `lngLat(...)` world grid | | `map`: dots sized by value on a plate carrée map; drag a box to filter |

```ts
dash.chart("#date", { dimension: bin("date", { interval: "week" }), view: { mark: "line" } });
dash.chart("#stack", {
  dimension: [bin("date", { interval: "month" }), "carrier"],
  view: { mark: "stackY", colors: { Polar: "#13a39b" } },
});
```

### Maps

`map` draws one dot per occupied cell; `radius` sets the largest dot's size. Land comes from your app
as Plot marks in `underlay` (for example `Plot.geo(land)`), so the renderer ships no map data.
`layouts` adds buttons that animate the dots to other positions, such as where each place lay millions
of years ago; brushing is off while dots are away from their cells.

```ts
dash.chart("#map", {
  dimension: lngLat("lng", "lat", { step: 2 }),
  extra: { plng: mean("plng"), plat: mean("plat") },
  view: {
    mark: "map",
    layouts: [
      { label: "Today", underlay: [Plot.geo(land, { fill: "#e4e2dc" })] },
      { label: "Then", position: (d) => [d.extra!.plng!, d.extra!.plat!] },
    ],
  },
});
```

## Interaction

| Option | Applies to | Default |
| --- | --- | --- |
| `brush: "x" \| "xy" \| false` | binned dimensions and grids | `"x"` for 1-D, `"xy"` for grids |
| `select: "single" \| "multi" \| false` | categories | `"multi"` |

Drag to brush; a click without dragging clears the brush. On category charts a click selects a bar,
clicking more bars adds them with `"multi"`, and clicking outside the bars clears the selection.
Brushing uses a small pointer-event overlay, not d3-brush, and inverts pixels through Plot's own x and
y scales, so filters land on exact data values.

## Ordering and labels

```ts
view: {
  sort: "-baseline",  // "key" (default), "value", "-value", "baseline" or "-baseline"
  omit: ["Other"],    // keys not to draw, such as the "Other" bin of top()
  labels: true,       // value labels at the end of barX bars
  format: (v: number) => v.toFixed(1),
  reverse: true,      // run a binned x axis right to left, e.g. "millions of years ago"
}
```

`-baseline` sorts by the unfiltered values, so bars keep their place while the selection changes.

## Comparing with everything

`compare: true` draws the unfiltered distribution as a dashed outline, scaled to the current total, so
the shape of a selection can be compared with the shape of all rows. It works with `rectY`, `barX` and
`barY`.

## Colors and theming

| Option | What it colors |
| --- | --- |
| `color` | Bars inside this chart's own filter, or all bars when it has none |
| `mutedColor` | Bars outside this chart's own filter |
| `colors` | Series of a `stackY` chart, or selected bars of a category chart, by key |
| `scheme` | Heatmap color scheme; default `blues` |

Axes and text use `currentColor`, so charts follow your page's text color. The hover tooltip reads
three CSS custom properties:

```css
.dashboard {
  --crossplot-tooltip-bg: #171719;
  --crossplot-tooltip-fg: #ededeb;
  --crossplot-tooltip-border: #2a2a2d;
}
```

Change the tooltip text with `tooltip: (d, bin) => "First line, bold\nSecond line"`, or turn it off
with `tooltip: false`.

## Anything else

`underlay` takes static Plot marks drawn under the data, such as shaded eras or reference lines, and
`plot` takes raw Plot options merged last:

```ts
view: {
  underlay: [Plot.rectX(eras, { x1: "start", x2: "end", fill: "currentColor", fillOpacity: 0.05 })],
  plot: { marginLeft: 80, y: { grid: true } },
}
```

`title`, `width`, `height`, `xLabel` and `yLabel` do what they say; the width follows the container
unless you set it.
