# Examples

Small dashboards that run right here in the page, each on the same 40,000 synthetic flights. The code
under each one is the complete source of what you see, apart from the shared data generator.

- [Linked histograms](./linked-histograms): four binned charts, brushing along x.
- [Categories and top-N](./categories): click selection, top-N with "Other", a `mean` aggregate and the
  `compare` outline.
- [Heatmap brushing](./heatmap): a two-dimensional brush and stacked bars.
- [Filter state](./url-state): reading, setting, saving and restoring filter state.
- [Headless charts](./headless): a custom HTML renderer and a chart with no renderer at all.
- [React](./react): the same dashboard as React components and hooks, in `StrictMode`.
- [Vue](./vue): linked charts as a Vue single-file component with composables and `<Chart>`.
- [Svelte](./svelte): the same in Svelte 5, with runes and the `chart` action.

For a full page built with crossplot, see the [dinosaur demo](/demo/){target="_self"}.

## The data

The flights are generated in the browser from a fixed seed, so everyone sees the same numbers. Two
departure waves, delays that grow through the day and peak in summer, and a long tail of origin
airports. None of it is real.

::: details Data generator
<<< @/examples/data.ts
:::
