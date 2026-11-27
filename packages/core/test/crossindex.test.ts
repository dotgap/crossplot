import type { DimensionSpec, Filter, FilterState } from "@crossplot/core";
import { bin, CrossIndex, fromColumns, fromRows, top } from "@crossplot/core";
import { describe, expect, it, vi } from "vitest";
import { idleWork } from "../src/engine/protocol.js";
import { binOrder } from "../src/engine/sort.js";

// Small deterministic PRNG so failures are reproducible.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

const CLASSES = ["L5", "H6", "LL6", "Iron", "CM2", "Eucrite"];

function makeTable(n: number, seed = 1) {
  const r = rng(seed);
  const year = new Float64Array(n);
  const mass = new Float64Array(n);
  const cls: (string | null)[] = [];
  for (let i = 0; i < n; i++) {
    year[i] = r() < 0.05 ? Number.NaN : Math.floor(1800 + r() * 230);
    mass[i] = r() < 0.05 ? Number.NaN : 10 ** (r() * 6);
    cls.push(r() < 0.03 ? null : CLASSES[Math.floor(r() * r() * CLASSES.length)]!);
  }
  return fromColumns({ year, mass, cls });
}

/** Brute-force reference: does a row pass a filter on a spec? */
function passes(spec: DimensionSpec, f: Filter | undefined, table: ReturnType<typeof makeTable>, row: number): boolean {
  if (!f) return true;
  if (spec.kind === "grid") {
    // A plain range or key set on a grid applies to its x axis.
    if ("range" in f || "in" in f) return passes(spec.x, f, table, row);
    const g = f as { x: Filter | null; y: Filter | null };
    return passes(spec.x, g.x ?? undefined, table, row) && passes(spec.y, g.y ?? undefined, table, row);
  }
  const col = table.columns[spec.field]!;
  if ("range" in f) {
    if (col.type === "category") throw new Error("bad test");
    const v = col.values[row]!;
    // Only rows inside the binned extent are part of the dimension.
    // Clamped dimensions keep out-of-extent values in their edge bins.
    if (spec.kind === "bin" && spec.extent && !spec.clamp && (v < spec.extent[0] || v > spec.extent[1])) return false;
    if (spec.kind === "bin" && spec.scale === "log" && !(v > 0)) return false;
    return v >= f.range[0] && v < f.range[1];
  }
  if ("in" in f) {
    if (col.type !== "category") throw new Error("bad test");
    const c = col.codes[row]!;
    if (c < 0) return false;
    const key = col.dictionary[c]!;
    if (spec.kind === "category" && spec.limit !== undefined) {
      const topKeys = topKeysOf(table, spec.field, spec.limit);
      const k = topKeys.includes(key) ? key : (spec.otherLabel ?? "Other");
      return f.in.includes(k);
    }
    return f.in.includes(key);
  }
  throw new Error("bad filter");
}

const topCache = new WeakMap<object, Map<string, string[]>>();
function topKeysOf(table: ReturnType<typeof makeTable>, field: string, limit: number): string[] {
  const memo = topCache.get(table) ?? new Map<string, string[]>();
  topCache.set(table, memo);
  const k = `${field}:${limit}`;
  if (!memo.has(k)) memo.set(k, computeTopKeys(table, field, limit));
  return memo.get(k)!;
}

function computeTopKeys(table: ReturnType<typeof makeTable>, field: string, limit: number): string[] {
  const col = table.columns[field]!;
  if (col.type !== "category") throw new Error("bad");
  const freq = new Map<string, number>();
  for (const c of col.codes) if (c >= 0) freq.set(col.dictionary[c]!, (freq.get(col.dictionary[c]!) ?? 0) + 1);
  return [...freq]
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([k]) => k);
}

describe("CrossIndex", () => {
  it("counts rows per bin and excludes missing values", () => {
    const t = fromRows([{ x: 1 }, { x: 2 }, { x: 2 }, { x: null }, { x: 9 }]);
    const ix = new CrossIndex();
    ix.load(t);
    const info = ix.addDimension("x", bin("x", { step: 2, extent: [0, 10] }));
    expect(info.size).toBe(5);
    expect(Array.from(info.x.edges)).toEqual([0, 2, 4, 6, 8, 10]);
    ix.addGroup("x", "x", { op: "count" });
    const res = ix.update({}, 1);
    expect(Array.from(res.groups.x!.values)).toEqual([1, 2, 0, 0, 1]);
    expect(res.selected).toBe(5);
    expect(res.total).toBe(5);
  });

  it("puts the extent's top value in the last bin", () => {
    const t = fromRows([{ x: 0 }, { x: 10 }]);
    const ix = new CrossIndex();
    ix.load(t);
    ix.addDimension("x", bin("x", { bins: 2 }));
    ix.addGroup("x", "x", { op: "count" });
    expect(Array.from(ix.update({}, 0).groups.x!.values)).toEqual([1, 1]);
  });

  it("excludes a chart's own filter (crossfilter semantics)", () => {
    const t = fromRows([
      { a: "x", b: 1 },
      { a: "x", b: 5 },
      { a: "y", b: 5 },
    ]);
    const ix = new CrossIndex();
    ix.load(t);
    ix.addDimension("a", { kind: "category", field: "a" });
    ix.addDimension("b", bin("b", { step: 5, extent: [0, 10] }));
    ix.addGroup("a", "a", { op: "count" });
    ix.addGroup("b", "b", { op: "count" });
    const res = ix.update({ a: { in: ["x"] } }, 1);
    // Group a ignores its own filter.
    expect(Array.from(res.groups.a!.values)).toEqual([2, 1]);
    // Group b sees only a = x.
    expect(Array.from(res.groups.b!.values)).toEqual([1, 1]);
    expect(res.selected).toBe(2);
  });

  it("filters exactly on raw values inside partially covered bins", () => {
    const t = fromRows([{ v: 1.2 }, { v: 1.7 }, { v: 2.1 }, { v: 3.5 }]);
    const ix = new CrossIndex();
    ix.load(t);
    ix.addDimension("v", bin("v", { step: 1, extent: [0, 4] }));
    ix.addGroup("all", "v", { op: "count" });
    expect(ix.update({ v: { range: [1.5, 2.5] } }, 1).selected).toBe(2);
    expect(ix.rows({ columns: ["v"] }).rows).toEqual([{ v: 1.7 }, { v: 2.1 }]);
  });

  it("computes sum and mean, skipping missing values", () => {
    const t = fromRows([
      { k: "a", v: 2 },
      { k: "a", v: 4 },
      { k: "a", v: null },
      { k: "b", v: 10 },
    ]);
    const ix = new CrossIndex();
    ix.load(t);
    ix.addDimension("k", { kind: "category", field: "k" });
    ix.addGroup("sum", "k", { op: "sum", field: "v" });
    ix.addGroup("mean", "k", { op: "mean", field: "v" });
    const res = ix.update({}, 0);
    expect(Array.from(res.groups.sum!.values)).toEqual([6, 10]);
    expect(Array.from(res.groups.mean!.values)).toEqual([3, 10]);
    expect(Array.from(res.groups.mean!.counts)).toEqual([3, 1]);
  });

  it("groups rare categories into Other with top()", () => {
    const rows = [..."aaaabbbccd"].map((k) => ({ k }));
    const ix = new CrossIndex();
    ix.load(fromRows(rows));
    const info = ix.addDimension("k", top("k", 2));
    expect(info.x.keys).toEqual(["a", "b", "Other"]);
    ix.addGroup("k", "k", { op: "count" });
    ix.addDimension("k2", { kind: "category", field: "k" });
    ix.addGroup("k2", "k2", { op: "count" });
    const res = ix.update({ k: { in: ["Other"] } }, 0);
    expect(Array.from(res.groups.k!.values)).toEqual([4, 3, 3]);
    expect(Array.from(res.groups.k2!.values)).toEqual([0, 0, 2, 1]);
  });

  it("bins log scales and drops non-positive values", () => {
    const ix = new CrossIndex();
    ix.load(fromRows([{ m: 0 }, { m: -1 }, { m: 1 }, { m: 10 }, { m: 100 }, { m: 1000 }]));
    const info = ix.addDimension("m", bin("m", { scale: "log", bins: 3 }));
    expect(Array.from(info.x.edges)).toEqual([1, 10, 100, 1000]);
    ix.addGroup("m", "m", { op: "count" });
    expect(Array.from(ix.update({}, 0).groups.m!.values)).toEqual([1, 1, 2]);
  });

  it("bins dates by calendar month", () => {
    const d = (s: string) => new Date(`${s}T00:00:00Z`);
    const ix = new CrossIndex();
    ix.load(fromRows([{ t: d("2024-01-05") }, { t: d("2024-01-31") }, { t: d("2024-03-01") }]));
    const info = ix.addDimension("t", bin("t", { interval: "month" }));
    expect(info.x.date).toBe(true);
    expect(info.size).toBe(3);
    ix.addGroup("t", "t", { op: "count" });
    expect(Array.from(ix.update({}, 0).groups.t!.values)).toEqual([2, 0, 1]);
  });

  it("filters grid dimensions on both axes", () => {
    const ix = new CrossIndex();
    ix.load(
      fromRows([
        { x: 1, y: 1 },
        { x: 1, y: 9 },
        { x: 9, y: 9 },
      ]),
    );
    ix.addDimension("g", {
      kind: "grid",
      x: bin("x", { bins: 2, extent: [0, 10] }),
      y: bin("y", { bins: 2, extent: [0, 10] }),
    });
    ix.addDimension("x", bin("x", { bins: 2, extent: [0, 10] }));
    ix.addGroup("g", "g", { op: "count" });
    ix.addGroup("x", "x", { op: "count" });
    expect(Array.from(ix.update({}, 0).groups.g!.values)).toEqual([1, 1, 0, 1]);
    const res = ix.update({ g: { x: { range: [0, 5] }, y: { range: [5, 10] } } }, 1);
    expect(res.selected).toBe(1);
    expect(Array.from(res.groups.x!.values)).toEqual([1, 0]);
  });

  it("restores totals when filters clear and dimensions are removed", () => {
    const t = makeTable(500);
    const ix = new CrossIndex();
    ix.load(t);
    ix.addDimension("year", bin("year", { step: 10, extent: [1800, 2030] }));
    ix.addDimension("cls", { kind: "category", field: "cls" });
    ix.addGroup("cls", "cls", { op: "count" });
    const before = Array.from(ix.update({}, 0).groups.cls!.values);
    ix.update({ year: { range: [1900, 1950] } }, 1);
    ix.removeDimension("year");
    const after = ix.update({}, 2);
    expect(Array.from(after.groups.cls!.values)).toEqual(before);
    expect(after.selected).toBe(500);
  });

  it("rejects more than 32 dimensions", () => {
    const ix = new CrossIndex();
    ix.load(fromRows([{ x: 1 }]));
    for (let i = 0; i < 32; i++) ix.addDimension(`d${i}`, bin("x"));
    expect(() => ix.addDimension("d32", bin("x"))).toThrow(/32/);
    ix.removeDimension("d5");
    expect(() => ix.addDimension("d32", bin("x"))).not.toThrow();
  });

  it("sorts and pages rows, with missing values last", () => {
    const ix = new CrossIndex();
    ix.load(
      fromRows([
        { n: "a", v: 3 },
        { n: "b", v: null },
        { n: "c", v: 1 },
        { n: "d", v: 2 },
      ]),
    );
    expect(ix.rows({ sort: "-v", columns: ["n"] }).rows.map((r) => r.n)).toEqual(["a", "d", "c", "b"]);
    expect(ix.rows({ sort: "v", columns: ["n"], limit: 2, offset: 1 }).rows.map((r) => r.n)).toEqual(["d", "a"]);
  });

  it("sorts rows by value inside each bin, for any float", () => {
    const r = rng(3);
    const special = [-Infinity, Infinity, -0, 0, -1e-300, 5e-324, -5, 1e308, -1e308];
    for (const n of [10, 40, 5000]) {
      const values = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const u = r();
        values[i] =
          u < 0.2 ? special[Math.floor(r() * special.length)]! : u < 0.4 ? Math.round(r() * 4) : (r() - 0.5) * 1e6;
      }
      // Three coarse bins by sign, plus missing rows in slot 3.
      const bins = Uint32Array.from(values, (v, i) => (i % 17 === 0 ? 3 : v < 0 ? 0 : v === 0 ? 1 : 2));
      const { order, offsets } = binOrder(bins, 3, values);
      expect(Array.from(order).sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
      for (let b = 0; b <= 3; b++) {
        for (let k = offsets[b]!; k < offsets[b + 1]!; k++) {
          expect(bins[order[k]!]).toBe(b);
          if (b < 3 && k > offsets[b]!) expect(values[order[k - 1]!]! <= values[order[k]!]!).toBe(true);
        }
      }
    }
  });

  it("keeps brush edges exact with infinities, ties and clamped bins (tiles)", () => {
    const values = [-Infinity, -3, -3, -0, 0, 0.5, 1, 1, 1, 2.25, 9, Infinity, Number.NaN];
    const rows = values.flatMap((x, i) => Array.from({ length: 10 }, (_, j) => ({ x, y: (i * 10 + j) % 4 })));
    const ix = new CrossIndex({ tileMinRows: 0 });
    ix.load(fromRows(rows));
    ix.addDimension("x", bin("x", { step: 1, extent: [-2, 3], clamp: true }));
    ix.addDimension("y", bin("y", { step: 1, extent: [0, 4] }));
    ix.addGroup("y", "y", { op: "count" });
    const ranges: [number, number][] = [
      [-Infinity, Infinity],
      [-3, 1],
      [-2.5, 0],
      [0, 0.5],
      [-0, 1.0000001],
      [1, 1],
      [2.25, Infinity],
      [-Infinity, -3],
    ];
    ranges.forEach((range, step) => {
      const res = ix.update({ x: { range } }, step);
      const want = [0, 0, 0, 0];
      let selected = 0;
      for (const row of rows) {
        if (!(row.x >= range[0] && row.x < range[1])) continue;
        selected++;
        want[row.y]!++;
      }
      expect(res.selected, `selected for ${range}`).toBe(selected);
      expect(Array.from(res.groups.y!.values), `y for ${range}`).toEqual(want);
    });
  });

  it("matches a brute-force reference under random filter sequences", () => {
    const r = rng(42);
    checkReference(new CrossIndex(), r, (_prev, randomFilter, ids) => {
      const state: Record<string, Filter> = {};
      for (const id of ids) {
        const f = randomFilter(id);
        if (f) state[id] = f;
      }
      return state;
    });
  });

  /** Drag-like sequences: mostly nudge the last-moved brush, sometimes jump, switch or change two at once. */
  const dragging = (r: () => number): NextState => {
    let dragged: string | null = null;
    return (prev, randomFilter, ids) => {
      const state: Record<string, Filter> = { ...prev };
      const roll = r();
      const moves = roll < 0.1 ? 2 : 1;
      for (let i = 0; i < moves; i++) {
        const id = roll < 0.75 && dragged ? dragged : ids[Math.floor(r() * ids.length)]!;
        dragged = id;
        const f = state[id];
        if (f && "range" in f && r() < 0.7) {
          // Small move: a few rows cross each edge.
          const [a, b] = f.range;
          const d = (b - a) * (r() - 0.5) * 0.1;
          state[id] = { range: r() < 0.5 ? [a + d, b + d] : [a, Math.max(a, b + d)] };
          continue;
        }
        const next = randomFilter(id);
        if (next) state[id] = next;
        else delete state[id];
      }
      return state;
    };
  };

  it("matches the reference while dragging brushes (incremental)", () => {
    checkReference(new CrossIndex({ tileMinRows: Infinity }), rng(11), dragging(rng(12)), 150);
  });

  it("matches the reference while dragging brushes (tiles)", () => {
    const reads = vi.spyOn(CrossIndex.prototype as unknown as { readTiles: () => void }, "readTiles");
    // tileMinRows 0 forces tiles on this small table.
    checkReference(new CrossIndex({ tileMinRows: 0 }), rng(7), dragging(rng(8)), 150);
    // Drags on the three binned dimensions should be answered from tiles.
    expect(reads.mock.calls.length).toBeGreaterThan(30);
    reads.mockRestore();
  });

  /** Nudge a range by a few rows' worth: shift it, or move its top edge. */
  const nudge = (r: () => number, [a, b]: readonly [number, number]): [number, number] => {
    const d = (b - a) * (r() - 0.5) * 0.1;
    return r() < 0.5 ? [a + d, b + d] : [a, Math.max(a, b + d)];
  };

  /**
   * Tiles on the small test table; a small 2-D budget leaves the groups with
   * most bins untiled ("heavy"). `stepped` builds 2-D tiles in small chunks,
   * one per update, as on a large table.
   */
  const tiled = (budget?: number, stepped = false) => {
    const ix = new CrossIndex({ tileMinRows: 0 });
    const limits = ix as unknown as {
      tileBudget2: number;
      tileCellsPerRow: number;
      buildChunk: number;
      buildStepMs: number;
    };
    limits.tileCellsPerRow = Number.POSITIVE_INFINITY;
    if (budget !== undefined) limits.tileBudget2 = budget;
    if (stepped) {
      limits.buildChunk = 128;
      limits.buildStepMs = 0;
    }
    return ix;
  };

  /** Sometimes give a pending build idle time, as the worker does between messages. */
  const idle = (ix: CrossIndex, r: () => number) => {
    if (r() < 0.3) for (let i = Math.floor(r() * 400); i > 0 && ix.work(0); i--);
  };

  // [name, 2-D budget, whether some groups are heavy, whether builds take many updates]
  const variants = [
    ["all groups tiled", undefined, false, false],
    ["heavy groups row by row", 60_000, true, false],
    ["built in steps", 3_000_000, false, true],
    ["heavy groups, built in steps", 60_000, true, true],
  ] as const;

  it.each(variants)(
    "matches the reference while dragging grid brushes (2-D tiles, %s)",
    (_name, budget, heavy, stepped) => {
      const reads = vi.spyOn(CrossIndex.prototype as unknown as { readTiles2: () => void }, "readTiles2");
      const follows = vi.spyOn(CrossIndex.prototype as unknown as { followBrush: () => void }, "followBrush");
      const r = rng(21);
      const ix = tiled(budget, stepped);
      let building = 0;
      checkReference(
        ix,
        rng(22),
        (prev, randomFilter, ids) => {
          if (ix.pending) building++;
          if (stepped) idle(ix, r);
          const state: Record<string, Filter> = { ...prev };
          const roll = r();
          const f = state.grid;
          if (roll < 0.8 && f && "x" in f && f.y && "range" in f.y) {
            // Drag the box: both edges of both axes move a little.
            const x = f.x && "range" in f.x ? { range: nudge(r, f.x.range) } : f.x;
            state.grid = { x, y: { range: nudge(r, f.y.range) } };
            return state;
          }
          // Otherwise start a new box, or change another chart.
          const id = roll < 0.9 ? "grid" : ids[Math.floor(r() * ids.length)]!;
          const next = randomFilter(id);
          if (next) state[id] = next;
          else delete state[id];
          return state;
        },
        150,
      );
      const [readCalls, followCalls] = [reads.mock.calls.length, follows.mock.calls.length];
      reads.mockRestore();
      follows.mockRestore();
      expect(readCalls).toBeGreaterThan(stepped ? 15 : 80);
      expect(followCalls > 0).toBe(heavy);
      // Stepped builds span many updates; the others finish on the update that starts them.
      expect(building > 20).toBe(stepped);
    },
  );

  it.each(variants)(
    "matches the reference while alternating two brushes (2-D tiles, %s)",
    (_name, budget, heavy, stepped) => {
      const reads = vi.spyOn(CrossIndex.prototype as unknown as { readTiles2: () => void }, "readTiles2");
      const follows = vi.spyOn(CrossIndex.prototype as unknown as { followBrush: () => void }, "followBrush");
      const r = rng(31);
      let turn = 0;
      const ix = tiled(budget, stepped);
      let building = 0;
      checkReference(
        ix,
        rng(32),
        (prev, randomFilter, ids) => {
          if (ix.pending) building++;
          if (stepped) idle(ix, r);
          const state: Record<string, Filter> = { ...prev };
          const roll = r();
          // Mostly: move year and mass in turn, sometimes both at once.
          const pair = roll < 0.15 ? ["year", "mass"] : [turn++ % 2 === 0 ? "year" : "mass"];
          if (roll > 0.92) pair[0] = ids[Math.floor(r() * ids.length)]!;
          for (const id of pair) {
            const f = state[id];
            if (f && "range" in f && r() < 0.85) {
              state[id] = { range: nudge(r, f.range) };
              continue;
            }
            const next = randomFilter(id);
            if (next) state[id] = next;
            else delete state[id];
          }
          return state;
        },
        150,
      );
      const [readCalls, followCalls] = [reads.mock.calls.length, follows.mock.calls.length];
      reads.mockRestore();
      follows.mockRestore();
      expect(readCalls).toBeGreaterThan(stepped ? 15 : 80);
      expect(followCalls > 0).toBe(heavy);
      expect(building > 20).toBe(stepped);
    },
  );

  it("builds 2-D tiles in the background, and drops the build when another filter changes", () => {
    const ix = tiled(60_000, true);
    const plain = new CrossIndex({ tileMinRows: Infinity });
    const table = makeTable(2000, 5);
    for (const engine of [ix, plain]) {
      engine.load(table);
      engine.addDimension("grid", {
        kind: "grid",
        x: bin("year", { step: 20, extent: [1800, 2030] }),
        y: bin("mass", { scale: "log", bins: 6 }),
      });
      engine.addDimension("year", bin("year", { step: 5, extent: [1800, 2030] }));
      engine.addDimension("cls", { kind: "category", field: "cls" });
      for (const id of ["grid", "year", "cls"]) engine.addGroup(id, id, { op: "count" });
    }
    let version = 0;
    const box = (f: number): FilterState => ({
      grid: { x: { range: [1850 + f, 1950 + f] }, y: { range: [10 + f, 1e4 + f * 100] } },
    });
    const check = (filters: FilterState) => {
      const res = ix.update(filters, version);
      const want = plain.update(filters, version++);
      expect(res.selected).toBe(want.selected);
      for (const id of ["grid", "year", "cls"]) {
        expect(Array.from(res.groups[id]!.values), id).toEqual(Array.from(want.groups[id]!.values));
      }
    };
    // Slow frames start a build; with no idle time it advances one step per frame.
    for (let f = 0; f < 4; f++) check(box(f));
    expect(ix.pending).toBe(true);
    // A filter on another chart cancels it.
    check({ ...box(4), cls: { in: ["L5"] } });
    expect(ix.pending).toBe(false);
    for (let f = 5; f < 9; f++) check({ ...box(f), cls: { in: ["L5"] } });
    expect(ix.pending).toBe(true);
    // Idle time finishes it, and the next frame is answered from the tiles.
    while (ix.work(0));
    expect(ix.pending).toBe(false);
    const reads = vi.spyOn(CrossIndex.prototype as unknown as { readTiles2: () => void }, "readTiles2");
    for (let f = 9; f < 14; f++) check({ ...box(f), cls: { in: ["L5"] } });
    const calls = reads.mock.calls.length;
    reads.mockRestore();
    expect(calls).toBe(5);
  });

  it("gives pending background work idle time in slices, until it is done or stopped", () => {
    vi.useFakeTimers();
    try {
      let left = 3;
      const slices: number[] = [];
      const index = {
        get pending() {
          return left > 0;
        },
        work(ms: number) {
          slices.push(ms);
          return --left > 0;
        },
      } as unknown as CrossIndex;
      const idle = idleWork(index);
      idle.poke();
      idle.poke();
      vi.runAllTimers();
      expect(slices).toEqual([8, 8, 8]);
      idle.poke();
      vi.runAllTimers();
      expect(slices.length).toBe(3);
      left = 2;
      idle.poke();
      idle.stop();
      vi.runAllTimers();
      expect(slices.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps 2-D brush edges exact with infinities, ties, clamps and missing values", () => {
    const xs = [-Infinity, -3, -0, 0, 0.5, 1, 1, 2.25, 9, Infinity, Number.NaN];
    const ys = [Number.NaN, -1, 0, 0, 1.5, 2, 3, 3.99, 4, 7];
    const rows = xs.flatMap((x, i) => ys.map((y, j) => ({ x, y, c: (i + j) % 3 })));
    // Every update also goes to an engine without tiles, and all groups must match it.
    const tiled = new CrossIndex({ tileMinRows: 0 });
    const plain = new CrossIndex({ tileMinRows: Infinity });
    for (const engine of [tiled, plain]) {
      engine.load(fromRows(rows));
      engine.addDimension("xy", {
        kind: "grid",
        x: bin("x", { step: 1, extent: [-2, 3], clamp: true }),
        y: bin("y", { step: 1, extent: [0, 4] }),
      });
      engine.addDimension("x", bin("x", { step: 1, extent: [-2, 3], clamp: true }));
      engine.addDimension("y", bin("y", { step: 1, extent: [0, 4], clamp: true }));
      engine.addDimension("c", bin("c", { step: 1, extent: [0, 3] }));
      for (const id of ["xy", "x", "y", "c"]) engine.addGroup(id, id, { op: "count" });
    }
    const ix = {
      update(filters: FilterState, version: number) {
        const res = tiled.update(filters, version);
        const want = plain.update(filters, version);
        for (const id of ["xy", "x", "y"]) {
          expect(Array.from(res.groups[id]!.values), `${id} @ ${version}`).toEqual(Array.from(want.groups[id]!.values));
        }
        return res;
      },
    };
    const ranges: [number, number][] = [
      [-Infinity, Infinity],
      [-3, 1],
      [0, 0.5],
      [-0, 1.0000001],
      [1, 1],
      [2.25, Infinity],
      [0, 4],
      [3.99, 7],
    ];
    const inside = (v: number, [a, b]: [number, number]) => v >= a && v < b;
    let step = 0;
    // Grid boxes: rows outside the grid's extent (y here) never pass.
    for (const rx of ranges) {
      for (const ry of [ranges[0]!, ranges[6]!, ranges[7]!, rx]) {
        // Drag twice so the second update comes from tiles.
        for (const filters of [
          { xy: { x: { range: rx }, y: { range: ry } } },
          { xy: { x: { range: rx }, y: { range: ry } } },
        ]) {
          const res = ix.update(filters, step++);
          const want = [0, 0, 0];
          for (const row of rows) {
            const onGrid = !Number.isNaN(row.x) && !Number.isNaN(row.y) && row.y >= 0 && row.y <= 4;
            if (onGrid && inside(row.x, rx) && inside(row.y, ry)) want[row.c]!++;
          }
          expect(Array.from(res.groups.c!.values), `xy ${rx} x ${ry}`).toEqual(want);
          expect(res.selected).toBe(want[0]! + want[1]! + want[2]!);
        }
      }
    }
    // Two clamped dimensions in turn: x, y, x, ... so the pair is tiled.
    ix.update({}, step++);
    const reads = vi.spyOn(CrossIndex.prototype as unknown as { readTiles2: () => void }, "readTiles2");
    let ry = ranges[0]!;
    ranges.forEach((rx, i) => {
      const states = [{ x: { range: rx }, y: { range: ry } }];
      ry = ranges[(i * 3 + 1) % ranges.length]!;
      states.push({ x: { range: rx }, y: { range: ry } });
      for (const filters of states) {
        const res = ix.update(filters, step++);
        const want = [0, 0, 0];
        for (const row of rows) {
          if (inside(row.x, filters.x.range) && inside(row.y, filters.y.range)) want[row.c]!++;
        }
        expect(Array.from(res.groups.c!.values), `x ${filters.x.range}, y ${filters.y.range}`).toEqual(want);
      }
    });
    expect(reads.mock.calls.length).toBeGreaterThan(10);
    reads.mockRestore();
  });
});

type NextState = (
  prev: Record<string, Filter>,
  randomFilter: (id: string) => Filter | undefined,
  ids: string[],
) => Record<string, Filter>;

/**
 * Apply `steps` filter states from `next` and check every group, `selected`
 * and `rows()` against a from-scratch recount.
 */
function checkReference(ix: CrossIndex, r: () => number, next: NextState, steps = 40): void {
  const table = makeTable(2000, 7);
  const specs: Record<string, DimensionSpec> = {
    year: bin("year", { step: 7, extent: [1800, 2030] }),
    yearc: bin("year", { bins: 9, extent: [1850, 2000], clamp: true }),
    mass: bin("mass", { scale: "log", bins: 13 }),
    cls: { kind: "category", field: "cls" },
    topcls: top("cls", 3),
    grid: {
      kind: "grid",
      x: bin("year", { step: 20, extent: [1800, 2030] }),
      y: bin("mass", { scale: "log", bins: 6 }),
    },
    catgrid: {
      kind: "grid",
      x: top("cls", 2),
      y: bin("year", { step: 25, extent: [1800, 2030] }),
    },
  };
  ix.load(table);
  for (const [id, spec] of Object.entries(specs)) {
    ix.addDimension(id, spec);
    ix.addGroup(id, id, { op: "count" });
    ix.addGroup(`${id}:mean`, id, { op: "mean", field: "mass" });
  }
  const infos = Object.fromEntries(Object.keys(specs).map((id) => [id, (ix as any).dims.get(id).compiled]));
  const randRange = (lo: number, hi: number): [number, number] => {
    const a = lo + r() * (hi - lo);
    const b = lo + r() * (hi - lo);
    return a < b ? [a, b] : [b, a];
  };
  const randomFilter = (id: string): Filter | undefined => {
    if (r() < 0.35) return undefined;
    switch (id) {
      case "year":
      case "yearc":
        // Whole years hit bin edges and ties exactly; fractions cut inside bins.
        return { range: randRange(1790, 2040).map((v) => (r() < 0.4 ? Math.round(v) : v)) as [number, number] };
      case "mass":
        return {
          range: randRange(0.5, 2e6)
            .map((v) => v ** (r() < 0.5 ? 1 : 0.5))
            .sort((a, b) => a - b) as [number, number],
        };
      case "cls":
        return { in: CLASSES.filter(() => r() < 0.5) };
      case "topcls":
        return { in: [...CLASSES, "Other"].filter(() => r() < 0.5) };
      case "catgrid": {
        const keys = [...CLASSES, "Other"].filter(() => r() < 0.5);
        if (r() < 0.5) return { in: keys };
        return { x: r() < 0.3 ? null : { in: keys }, y: { range: randRange(1790, 2040) } };
      }
      default:
        return {
          x: r() < 0.2 ? null : { range: randRange(1800, 2030) },
          y: { range: [10 ** (r() * 3), 10 ** (3 + r() * 3)] },
        };
    }
  };

  let state: Record<string, Filter> = {};
  for (let step = 0; step < steps; step++) {
    state = next(state, randomFilter, Object.keys(specs));
    const res = ix.update(state as FilterState, step);

    // Reference: recompute every group from scratch.
    // A filtered dimension rejects rows that are missing or out of range on it.
    const ids = Object.keys(specs);
    const ok = ids.map((id) => {
      const out = new Uint8Array(table.rowCount);
      for (let row = 0; row < table.rowCount; row++) {
        out[row] =
          !state[id] || (infos[id].bins[row] < infos[id].size && passes(specs[id]!, state[id], table, row)) ? 1 : 0;
      }
      return out;
    });
    const passAll = (row: number, except?: string) => ids.every((id, d) => id === except || ok[d]![row] === 1);
    let selected = 0;
    for (let row = 0; row < table.rowCount; row++) if (passAll(row)) selected++;
    expect(res.selected, `selected @ step ${step}`).toBe(selected);
    if (step % 5 === 0) expect(ix.rows({ columns: ["year"] }).rows.length).toBe(selected);

    for (const id of Object.keys(specs)) {
      const compiled = infos[id];
      const expected = new Float64Array(compiled.size);
      const sums = new Float64Array(compiled.size);
      const valid = new Float64Array(compiled.size);
      const massCol = table.columns.mass as { values: Float64Array };
      for (let row = 0; row < table.rowCount; row++) {
        const b = compiled.bins[row];
        if (b >= compiled.size || !passAll(row, id)) continue;
        expected[b] = expected[b]! + 1;
        const m = massCol.values[row]!;
        if (!Number.isNaN(m)) {
          sums[b] = sums[b]! + m;
          valid[b] = valid[b]! + 1;
        }
      }
      expect(Array.from(res.groups[id]!.values), `${id} @ step ${step}`).toEqual(Array.from(expected));
      const means = res.groups[`${id}:mean`]!.values;
      for (let b = 0; b < compiled.size; b++) {
        const want = valid[b]! > 0 ? sums[b]! / valid[b]! : Number.NaN;
        if (Number.isNaN(want)) expect(means[b]).toBeNaN();
        else expect(means[b]).toBeCloseTo(want, 3);
      }
    }
  }
}
