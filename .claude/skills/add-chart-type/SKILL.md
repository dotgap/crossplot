---
name: add-chart-type
description: Add a new chart type to crossplot, such as a new Observable Plot mark in @crossplot/plot, a new renderer package, or a new dimension or aggregate kind in the core engine. Use when asked for a chart, mark or visualization the library can't draw yet.
---

# Add a chart type

First decide which layer the chart needs. Most requests only touch the renderer.

| The chart needs... | Change |
| --- | --- |
| A new look for data the engine already produces (1-D bins, categories, 2-D grids) | A mark in `packages/plot/src/index.ts` |
| A different drawing library (uPlot, canvas, WebGL) | A new renderer package implementing `Renderer` |
| New binning (e.g. a new scale) or a new aggregate (e.g. min/max) | Core: `types.ts`, `specs.ts`, `binning.ts`, `engine/crossindex.ts`. See the `engine-tests` skill. |
| A map of places | Use `lngLat()` with the `map` mark; per-cell values beyond the main aggregate go in the chart's `extra` |
| Per-row geometry (scatter of raw points, projected maps) | Out of scope for now: the engine only returns aggregates. Ask before starting. |

## A new mark in @crossplot/plot

Everything lives in `packages/plot/src/index.ts`.

1. Add the name to `PlotMark` and document it on `PlotView.mark`. If it needs options, add them to
   `PlotView` with JSDoc (they arrive untouched from the chart spec's `view`).
2. If it should be the default for some dimension shape, update `defaultMark`.
3. Draw it in `buildPlot`, in the branch for its dimension shape: `dim.y` set (grid),
   `dim.x.kind === "category"`, or binned 1-D. Use the `Datum` fields (`x0`/`x1` bin edges, `key`,
   `value`, `count`, and `ykey`/`y0`/`y1` for grids). Keep the axis domain on the full dimension
   (`dim.x.edges` / `dim.x.keys`) so bars don't jump when filters change.
4. Highlight the chart's own filter: selected bins use `accent`, others `muted` (`isSelected`), or
   lower opacity for grids. The brush rectangle is drawn by the overlay, not by the mark.
5. Interaction. Brushing comes from `brushMode` and click selection from `selectMode` in
   `mountChart`; both read Plot scales through `readFrame` and emit intents in data space. If the
   mark is oriented differently (vertical vs horizontal bands), update `hitBand` and the
   brush/select mode logic so clicks and drags map to the right axis. Never set filters directly:
   call `emit({ type: "brush", range })` / `"select"` / `"reset"`.
6. Respect log and date axes via `scaleType(axis)` and `tickFormat(axis)`.
7. Test it in `packages/plot/test/plot.test.ts` (jsdom): it renders the expected number of marks,
   highlights bins for a filter set through `dash.filters.set`, and turns a click or drag into the
   right filter. Copy the `setup()` pattern there.
8. Try it in the demo (`run-demo` skill) and update the README if the mark list changed.

## A new renderer package

1. Create `packages/<name>` modeled on `packages/plot`: `package.json` (`@crossplot/<name>`, ESM,
   `exports`, `files`, `"build": "tsc -b"`), `tsconfig.json` extending `../../tsconfig.base.json`
   with a project reference to `../core`, the drawing library as a **peer** dependency (and dev
   dependency), and `@crossplot/core` as `workspace:^` peer + dev dependency. Copy the publishing
   metadata from `packages/plot/package.json` (keywords, homepage, bugs, repository with
   `directory`, `sideEffects`, `publishConfig`) and copy the root `LICENSE` and a `README.md` into
   the package; `pnpm check:packages` enforces this. Releases pick the package up automatically.
2. Export a factory returning `Renderer<View>`: `mount(el, view, emit, ctx)` returns a
   `RenderHandle` with `update(data, filter)`, optional `resize`, and `destroy` (remove listeners and
   DOM). `ctx.dimension` describes the axes before the first update.
3. Add the package to the root `typecheck` script and to the README package table, and add an alias
   in `vitest.config.ts` if tests import it by package name.
4. Add a jsdom test like `packages/plot/test/plot.test.ts`.

## Checklist before opening a PR

- `pnpm build && pnpm test && pnpm typecheck`, plus the lint script if the repo has one.
- `@crossplot/core` still has no `dependencies`.
- `pnpm check:packages` passes after a build, and a changeset is added (`pnpm changeset`).
- The demo still runs without console errors (`run-demo` skill).
