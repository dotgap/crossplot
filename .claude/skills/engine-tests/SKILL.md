---
name: engine-tests
description: Write or extend tests for the crossplot core engine (CrossIndex, binning, filters, dashboard), including the randomized brute-force reference check. Use when changing anything in packages/core, adding a dimension, filter or aggregate kind, or chasing a wrong-count bug.
---

# Engine tests

Tests use Vitest and import `@crossplot/core` straight from source (aliases in `vitest.config.ts`),
so no build is needed. Run one file while iterating:

```sh
pnpm vitest run packages/core/test/crossindex.test.ts
pnpm vitest run -t "brute-force"
```

| File | Covers |
| --- | --- |
| `packages/core/test/crossindex.test.ts` | `CrossIndex` directly: binning, filters, aggregates, rows, and the brute-force reference |
| `packages/core/test/dashboard.test.ts` | `createDashboard`: linking, intents, ids, worker protocol |
| `packages/core/test/filters.test.ts` | `FilterStore` |
| `packages/core/test/dom.test.ts` | `@crossplot/core/dom` widgets (jsdom) |

## Unit tests on CrossIndex

Test the engine synchronously, with no dashboard or worker:

```ts
const ix = new CrossIndex();
ix.load(fromRows([{ cls: "L5", mass: 10 }, { cls: "H6", mass: null }]));
ix.addDimension("cls", { kind: "category", field: "cls" });
ix.addDimension("mass", bin("mass", { step: 50, extent: [0, 100] }));
ix.addGroup("cls", "cls", { op: "count" });
// Filters are keyed by dimension id; keys with no dimension are ignored.
const res = ix.update({ mass: { range: [0, 100] } }, 1);
expect(Array.from(res.groups.cls!.values)).toEqual([0, 1]); // category bins are sorted: H6, L5
```

Write a small hand-checked case for every new behaviour, and always cover the edges:

- missing values (NaN, `null`, category code -1) are excluded from bins and rejected by a filter on
  that dimension;
- the top edge of an extent lands in the last bin; values outside the extent are out of range
  unless `clamp` is set;
- range filters are half-open `[lo, hi)` and exact on raw values inside partially covered bins;
- a chart is not filtered by its own filter;
- `log` scales drop values <= 0;
- clearing filters and removing dimensions restores the totals.

## The brute-force reference check (required for engine changes)

`"matches a brute-force reference under random filter sequences"` in `crossindex.test.ts` builds a
seeded random table (`makeTable`, deterministic `rng`), registers several dimensions with `count`
and `mean` groups, then applies 40 random filter states. For each step it recomputes from scratch:
`passes()` decides per row whether a filter accepts it, a row counts towards a group when it passes
every dimension's filter except that group's own, and every bin's count and mean must equal the
engine's incremental result.

When you add a dimension kind, filter kind, aggregate or option:

1. Add a spec using it to the `specs` record in that test.
2. Teach `randomFilter` to generate filters for it, including empty and full selections, and
   ranges that start or end outside the data.
3. Teach `passes()` the reference semantics in the simplest possible code (a straight loop over raw
   values, never reuse engine helpers), and the expected-aggregate loop the new aggregate.
4. If it fails, keep the seed and print `id @ step` (already in the assertion message) to find the
   first diverging step, then reduce it to a hand-written unit test before fixing.

Keep the table small (about 2,000 rows) so the test stays fast; it should run in well under a second.

The engine has four update paths, and `checkReference` runs against each: incremental row flips
(small changes), sequential recounts (changes that flip many rows), prefix-sum tiles (a drag on
one binned dimension), and 2-D tiles (a box drag on a grid, or two binned brushes moved in turn).
`new CrossIndex({ tileMinRows: 0 })` forces tiles on the small test table and
`tileMinRows: Infinity` turns them off; the drag tests use `dragging()` so most steps nudge a brush
by a few rows. The 2-D tests also run with a small `tileBudget2` (a private field) so some groups
are left "heavy" and follow the brush row by row, and with a small `buildChunk` and
`buildStepMs: 0` so 2-D tiles are built across many updates and `work()` calls, as on a large table.
A new filter or aggregate kind must pass all of them.

## Dashboard and renderer tests

Use the main-thread engine and a microtask scheduler so updates are deterministic:

```ts
const microtask = (run: () => void) => queueMicrotask(run);
const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
const chart = dash.chart(null, { dimension: "fall" });   // null target: no renderer, data only
chart.apply({ type: "select", keys: ["Found"], mode: "replace" });
await dash.idle();
```

Assert on `chart.data`, `chart.filter`, `dash.summary` and `dash.filters`. For the worker path, the
dashboard tests wire `connectEngine` and `serveEngine` through a `MessageChannel`; follow that
pattern rather than spawning a real Worker.

## Performance

For changes in `engine/crossindex.ts` or `binning.ts`, run `pnpm bench` (and `pnpm bench 10000000`)
before and after and mention the numbers in the PR if they moved.
