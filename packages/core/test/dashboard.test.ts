import type { ChartData, Intent, Renderer } from "@crossplot/core";
import { bin, connectEngine, count, createDashboard, lngLat, mean, serveEngine, top } from "@crossplot/core";
import { describe, expect, it, vi } from "vitest";

const rows = [
  { name: "a", cls: "L5", mass: 10, year: 1900, fall: "Fell" },
  { name: "b", cls: "L5", mass: 100, year: 1950, fall: "Found" },
  { name: "c", cls: "H6", mass: 1000, year: 1950, fall: "Found" },
  { name: "d", cls: "H6", mass: null, year: 2000, fall: "Found" },
  { name: "e", cls: "Iron", mass: 5, year: null, fall: "Fell" },
];

const microtask = (run: () => void) => queueMicrotask(run);

describe("createDashboard", () => {
  it("is idle right away with no charts", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    await expect(dash.idle()).resolves.toBeUndefined();
    expect(dash.summary).toEqual({ selected: 5, total: 5 });
  });

  it("links charts through the filter store", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const fall = dash.chart(null, { dimension: "fall", value: count() });
    const year = dash.chart(null, { dimension: bin("year", { step: 50, extent: [1900, 2000] }) });
    await dash.idle();
    expect(fall.id).toBe("fall");
    expect(fall.data!.data.map((d) => [d.key, d.value])).toEqual([
      ["Fell", 2],
      ["Found", 3],
    ]);
    expect(year.data!.data.map((d) => d.key)).toEqual(["1900–1950", "1950–2000"]);

    fall.apply({ type: "select", keys: ["Found"], mode: "replace" });
    await dash.idle();
    expect(year.data!.data.map((d) => d.value)).toEqual([0, 3]);
    // A chart is not filtered by its own selection.
    expect(fall.data!.data.map((d) => d.value)).toEqual([2, 3]);
    expect(dash.summary).toEqual({ selected: 3, total: 5 });

    fall.apply({ type: "select", keys: ["Fell"], mode: "toggle" });
    expect(dash.filters.get("fall")).toEqual({ in: ["Found", "Fell"] });
    fall.apply({ type: "reset" });
    await dash.idle();
    expect(dash.summary.selected).toBe(5);
  });

  it("brushes ranges and grids", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const heat = dash.chart(null, {
      dimension: [bin("year", { step: 50, extent: [1900, 2000] }), bin("mass", { scale: "log", bins: 3 })],
    });
    const cls = dash.chart(null, { dimension: top("cls", 1) });
    await dash.idle();
    expect(heat.id).toBe("year×mass");
    expect(cls.data!.data.map((d) => d.key)).toEqual(["H6", "Other"]);

    heat.apply({ type: "brushXY", x: [1900, 1960], y: [50, 2000] });
    await dash.idle();
    expect(dash.summary.selected).toBe(2);
    expect(cls.data!.data.map((d) => d.value)).toEqual([1, 1]);

    heat.apply({ type: "brush", range: null });
    await dash.idle();
    expect(dash.summary.selected).toBe(5);
  });

  it("keeps the unfiltered baseline next to filtered values", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const fall = dash.chart(null, { dimension: "fall" });
    const cls = dash.chart(null, { dimension: "cls" });
    fall.apply({ type: "select", keys: ["Fell"], mode: "replace" });
    await dash.idle();
    const byKey = Object.fromEntries(cls.data!.data.map((d) => [d.key, [d.value, d.baseline]]));
    expect(byKey).toEqual({ L5: [1, 2], H6: [0, 2], Iron: [1, 1] });
  });

  it("adds extra aggregates per bin and filters a world grid on raw coordinates", async () => {
    const places = [
      { lng: -110.5, lat: 47.2, plat: 40, kind: "a" },
      { lng: -110.2, lat: 47.9, plat: 42, kind: "b" },
      { lng: 105.1, lat: 43.6, plat: 45, kind: "a" },
      { lng: 180, lat: -90, plat: -70, kind: "b" },
      { lng: null, lat: 10, plat: 0, kind: "a" },
    ];
    const dash = await createDashboard({ data: places, engine: "local", schedule: microtask });
    const map = dash.chart(null, {
      id: "map",
      dimension: lngLat("lng", "lat", { step: 10 }),
      extra: { plat: mean("plat") },
    });
    const kind = dash.chart(null, { dimension: "kind" });
    await dash.idle();
    expect(map.data!.dimension.x.size).toBe(36);
    expect(map.data!.dimension.y!.size).toBe(18);
    const montana = map.data!.data.find((d) => d.count === 2)!;
    expect(montana.extra).toEqual({ plat: 41 });
    // The pole and the antimeridian land in the last cells.
    expect(map.data!.data.at(-1)!.count).toBe(0);
    expect(map.data!.data[35 * 18]!.count).toBe(1);

    kind.apply({ type: "select", keys: ["a"], mode: "replace" });
    await dash.idle();
    expect(map.data!.data[montana.index]!.extra).toEqual({ plat: 40 });
    kind.apply({ type: "reset" });

    // A box filters on the raw values, not on the 10° cells.
    map.apply({ type: "brushXY", x: [-111, -110.3], y: [47, 48] });
    await dash.idle();
    expect(dash.summary.selected).toBe(1);
    expect(kind.data!.data.map((d) => d.value)).toEqual([1, 0]);
    map.destroy();
    await dash.idle();
    expect(dash.summary.selected).toBe(5);
  });

  it("filters a grid by a plain key set on its x axis", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const grid = dash.chart(null, { id: "cls", dimension: ["cls", bin("year", { step: 50, extent: [1900, 2000] })] });
    grid.apply({ type: "select", keys: ["H6"], mode: "replace" });
    await dash.idle();
    expect(dash.summary.selected).toBe(2);
  });

  it("brushes a grid along x only", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const stack = dash.chart(null, { dimension: [bin("year", { step: 50, extent: [1900, 2000] }), "fall"] });
    stack.apply({ type: "brush", range: [1940, 1960] });
    await dash.idle();
    expect(dash.summary.selected).toBe(2);
  });

  it("dedupes ids, coalesces updates and drops destroyed charts", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    const a = dash.chart(null, { dimension: "cls", value: mean("mass") });
    const b = dash.chart(null, { dimension: "cls" });
    expect(b.id).toBe("cls-2");
    const listener = vi.fn();
    dash.onUpdate(listener);
    listener.mockClear();
    dash.filters.set("cls-2", { in: ["L5"] });
    dash.filters.set("cls-2", { in: ["H6"] });
    dash.filters.set("cls-2", { in: ["H6", "L5"] });
    await dash.idle();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(a.data!.data.map((d) => d.value)).toEqual([1000, Number.NaN, 55]); // H6, Iron, L5
    b.destroy();
    await dash.idle();
    expect(dash.filters.get("cls-2")).toBeNull();
    expect(dash.summary.selected).toBe(5);
  });

  it("returns filtered, sorted rows", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    dash.chart(null, { dimension: "fall" });
    dash.filters.set("fall", { in: ["Found"] });
    const { rows: out, selected } = await dash.rows({ columns: ["name", "mass"], sort: "-mass" });
    expect(selected).toBe(3);
    expect(out).toEqual([
      { name: "c", mass: 1000 },
      { name: "b", mass: 100 },
      { name: "d", mass: null },
    ]);
  });

  it("mounts renderers and routes their intents", async () => {
    const updates: ChartData[] = [];
    let emit!: (i: Intent) => void;
    const destroy = vi.fn();
    const renderer: Renderer<{ mark: string }> = {
      mount(_el, view, e, ctx) {
        expect(view).toEqual({ mark: "barX" });
        expect(ctx.dimension.x.keys).toEqual(["Fell", "Found"]);
        emit = e;
        return { update: (d) => updates.push(d), destroy };
      },
    };
    const el = { nodeType: 1 } as unknown as HTMLElement;
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask, renderer });
    const chart = dash.chart(el, { dimension: "fall", view: { mark: "barX" } });
    await chart.ready;
    await dash.idle();
    expect(updates).toHaveLength(1);
    emit({ type: "select", keys: ["Fell"], mode: "replace" });
    await dash.idle();
    expect(dash.summary.selected).toBe(2);
    dash.destroy();
    expect(destroy).toHaveBeenCalled();
  });

  it("draws one chart in several places", async () => {
    const updates: string[] = [];
    const renderer: Renderer<{ name: string }> = {
      mount: (_el, view, emit) => ({
        update: (data) => {
          updates.push(`${view.name}:${data.selected}`);
          if (view.name === "copy" && data.selected === 5) emit({ type: "select", keys: ["Fell"], mode: "replace" });
        },
        destroy: () => updates.push(`${view.name}:destroyed`),
      }),
    };
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask, renderer });
    const el = {} as HTMLElement;
    const fall = dash.chart(el, { dimension: "fall", view: { name: "main" } });
    const remove = fall.mount(el, { name: "copy" });
    await fall.ready;
    await dash.idle();
    await dash.idle();
    // The copy's intent filters the shared chart; both views see it.
    expect(fall.filter).toEqual({ in: ["Fell"] });
    expect(updates).toContain("main:2");
    expect(updates).toContain("copy:2");
    remove();
    expect(updates).toContain("copy:destroyed");
  });

  it("destroys each view once, whoever removes it first", async () => {
    const destroyed: string[] = [];
    const renderer: Renderer<{ name: string }> = {
      mount: (_el, view) => ({ update: () => {}, destroy: () => destroyed.push(view.name) }),
    };
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask, renderer });
    const el = {} as HTMLElement;
    const fall = dash.chart(null, { dimension: "fall" });
    const removeA = fall.mount(el, { name: "a" });
    const year = dash.chart(null, { dimension: "year" });
    const removeB = year.mount(el, { name: "b" });
    await Promise.all([fall.ready, year.ready]);
    fall.destroy();
    removeA();
    dash.destroy();
    removeB();
    expect(destroyed).toEqual(["a", "b"]);
  });

  it("works with the engine on the other end of a message port", async () => {
    const { port1, port2 } = new MessageChannel();
    const stop = serveEngine(port2 as unknown as Parameters<typeof serveEngine>[0]);
    const engine = connectEngine(port1 as unknown as Parameters<typeof connectEngine>[0], () => {
      port1.close();
      port2.close();
    });
    const dash = await createDashboard({ data: rows, engine, schedule: microtask });
    const year = dash.chart(null, { dimension: bin("year", { step: 50, extent: [1900, 2000] }) });
    dash.chart(null, { dimension: "fall" });
    dash.filters.set("fall", { in: ["Fell"] });
    await dash.idle();
    expect(year.data!.data.map((d) => d.value)).toEqual([1, 0]);
    await expect(engine.addGroup("x", "missing", { op: "count" })).rejects.toThrow(/Unknown dimension/);
    stop();
    dash.destroy();
  });
});
