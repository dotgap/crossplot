# The engine

The engine is where rows get filtered and aggregated. It's built for brushing: a filter moving a few
pixels should cost a few rows, not a full scan.

## How it works

- **Columnar table.** Rows are converted once into `Float64Array` columns and dictionary-encoded
  categories.
- **Binned dimensions.** Each chart's dimension computes a bin id per row up front, and row ids are
  counting-sorted by bin, so every bin's rows are one contiguous slice.
- **Filter bitmask.** Each row has a 32-bit mask, one bit per dimension, set when the row fails that
  dimension's filter. A row is selected when its mask is zero, and passes "every filter except chart
  _k_" when its mask has no bits other than _k_.
- **Incremental updates.** When a filter changes, the engine classifies each bin as fully in, fully
  out or partial. It only visits bins whose state changed, and only rows whose bit actually flips
  touch the aggregates. Partial bins at the brush edges are tested row by row on raw values, which is
  what makes range filters exact.
- **Tiles for drags.** On large tables, dragging a range brush switches to prefix sums over the
  brushed chart's rows in value order, so a frame costs a few lookups per bin of the other charts,
  however far the brush moves. A box drag on a heatmap or map, or two range brushes moved in turn,
  uses 2-D summed-area tables the same way once its frames get slow. Rows at the brush edges are
  still tested exactly.

## Worker or main thread

By default the engine runs in a Web Worker, so heavy filtering never blocks input. Everything crossing
the boundary (specs, filters, results) is plain data.

```ts
createDashboard({ data, engine: "worker" }); // the default where Worker exists
createDashboard({ data, engine: "local" }); // main thread: tests, server-side, small tables
createDashboard({ data, engine: workerEngine(myWorker) }); // a worker you started
```

The dashboard coalesces requests to one per animation frame and keeps at most one in flight. If the
user keeps brushing while the engine works, the next request carries the latest filters and
intermediate states are skipped.

The live examples in these docs use `engine: "local"`, since their 40,000 rows filter in well under a
millisecond.

## Performance

`pnpm bench` in the repository times brush-to-aggregates for eight linked dimensions, including a
heatmap and a 2° world map, without rendering. Median per drag frame in a cloud dev container:

| Rows | Range brushes | Box brushes (heatmap, map) |
| --- | --- | --- |
| 1 million | about 0.3 to 0.7 ms | about 1 to 2 ms |
| 10 million | about 3 to 12 ms | about 4 to 8 ms |

The first frame of a range drag builds its tiles and takes longer: about 0.1 s at 1 million rows and
0.5 s at 10 million. Tiles for a box brush (or two range brushes moved in turn) take about 2 s to build
at 10 million rows, so they never block a frame: the engine builds them a slice at a time, 10 ms per
frame plus idle time between frames, while the drag carries on incrementally (about 40 to 100 ms per
frame at that size), and switches to them once they are ready, after about 70 frames in the
benchmark. Rendering usually costs more than the engine at these sizes.

## Using the engine directly

`CrossIndex` is the synchronous engine underneath, usable without a dashboard, for example in Node:

```ts
import { bin, CrossIndex, fromColumns } from "@crossplot/core";

const index = new CrossIndex();
index.load(fromColumns({ hour, delay }));
index.addDimension("hour", bin("hour", { step: 1 }));
index.addGroup("hour", "hour", { op: "count" });
index.addDimension("delay", bin("delay", { step: 10 }));
index.addGroup("delay", "delay", { op: "count" });

const result = index.update({ hour: { range: [6, 9] } }, 1);
result.groups.delay?.values; // Float64Array of counts per delay bin, for flights from 6 to 9
```

Large tables can leave background work pending after an update: 2-D tiles for a box drag, built a
slice at a time. Updates advance it on their own, and `index.work(ms)` gives it idle time (it returns
whether work remains, as does `index.pending`). The worker and local engines do this between calls.

To run it somewhere other than a Web Worker, such as a `MessagePort` or a Node worker thread, serve it
with `serveEngine(port)` on one side and connect with `connectEngine(port)` on the other. Any object
implementing `DataEngine` can be passed as `engine`.
