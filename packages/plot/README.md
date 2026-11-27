# @crossplot/plot

[Observable Plot](https://observablehq.com/plot/) renderer for
[crossplot](https://github.com/dotgap/crossplot). `@observablehq/plot` is a peer dependency.

```ts
import { createDashboard, bin } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";

const dash = await createDashboard({ data, renderer: plotRenderer() });
dash.chart("#year", { dimension: bin("year", { step: 1 }), view: { mark: "rectY", brush: "x" } });
```

`view` options: `mark` (`rectY`, `barY`, `barX`, `line`, `areaY`, `rect`, `cell`, `stackY`),
`brush` (`x`, `xy`, `false`), `select` (`single`, `multi`, `false`), `sort` (`key`, `value`,
`baseline`, or descending with `-`), `omit`, `title`, `width`, `height`, `color`, `mutedColor`,
`colors`, `series`, `scheme`, `compare`, `labels`, `format`, `tooltip`, `reverse`, `xLabel`,
`yLabel`, `underlay` for static marks under the data, and `plot` for raw Plot options merged last.

- `stackY` draws a `[bin, category]` grid as stacked bars, one color per category, brushable along x.
- `compare: true` draws the unfiltered distribution as a dashed outline scaled to the current
  total, so a selection's shape can be compared with everything.
- Hovering shows a tooltip; pass `tooltip: (d, bin) => "line 1\nline 2"` to change its text.

Brushing uses a small pointer-event overlay (no d3-brush) that inverts pixels through
`plot.scale("x")`. A click without a drag clears the brush; clicking outside the bars of a category
chart clears its selection.
