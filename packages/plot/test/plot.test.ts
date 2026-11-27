// @vitest-environment jsdom

import type { Datum } from "@crossplot/core";
import { bin, createDashboard, lngLat, mean, top } from "@crossplot/core";
import { describe, expect, it } from "vitest";
import { plotRenderer } from "../src/index.js";

const rows = Array.from({ length: 200 }, (_, i) => ({
  year: 1800 + ((i * 37) % 200),
  cls: ["L5", "H6", "LL6", "Iron"][i % 4]!,
  mass: 10 ** ((i % 50) / 10),
}));
const microtask = (run: () => void) => queueMicrotask(run);

async function setup() {
  document.body.innerHTML = `<div id="year"></div><div id="cls"></div><div id="heat"></div>`;
  const dash = await createDashboard({
    data: rows,
    engine: "local",
    schedule: microtask,
    renderer: plotRenderer({ defaults: { width: 400 } }),
  });
  const year = dash.chart("#year", {
    dimension: bin("year", { step: 10, extent: [1800, 2000] }),
    view: { title: "Year" },
  });
  const cls = dash.chart("#cls", { dimension: top("cls", 3) });
  const heat = dash.chart("#heat", {
    dimension: [bin("year", { step: 50, extent: [1800, 2000] }), bin("mass", { scale: "log", bins: 5 })],
  });
  await Promise.all([year.ready, cls.ready, heat.ready]);
  await dash.idle();
  return { dash, year, cls, heat };
}

function fills(sel: string): string[] {
  return [...document.querySelectorAll(`${sel} [aria-label="${sel === "#cls" ? "bar" : "rect"}"] rect`)].map(
    (r) => r.getAttribute("fill")!,
  );
}

describe("plotRenderer", () => {
  it("draws a histogram, a bar chart and a heatmap", async () => {
    await setup();
    expect(document.querySelector("#year .crossplot-title")!.textContent).toBe("Year");
    expect(fills("#year")).toHaveLength(20);
    expect(fills("#cls")).toHaveLength(4); // top 3 + Other
    expect(document.querySelectorAll("#heat [aria-label=rect] rect").length).toBeGreaterThan(0);
    expect(document.querySelectorAll(".crossplot-overlay")).toHaveLength(3);
  });

  it("selects a category on click and greys out the rest", async () => {
    const { dash, cls } = await setup();
    const overlay = document.querySelector<SVGSVGElement>("#cls .crossplot-overlay")!;
    // Find the band of the first category through the rendered bars.
    const first = document.querySelector("#cls [aria-label=bar] rect")!;
    const y = Number(first.getAttribute("y")) + Number(first.getAttribute("height")) / 2;
    const x = Number(first.getAttribute("x")) + 2;
    overlay.dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
    await dash.idle();
    expect(cls.filter).toEqual({ in: [cls.data!.dimension.x.keys[0]] });
    const f = fills("#cls");
    expect(f.filter((c) => c === "#4c7dff")).toHaveLength(1);
    expect(dash.summary.selected).toBe(50);

    // Clicking outside the bars resets.
    overlay.dispatchEvent(new MouseEvent("click", { clientX: 1, clientY: 1, bubbles: true }));
    await dash.idle();
    expect(cls.filter).toBeNull();
  });

  it("draws the brush for a filter set elsewhere and highlights bins", async () => {
    const { dash, year } = await setup();
    dash.filters.set(year.id, { range: [1850, 1900] });
    await dash.idle();
    const rect = document.querySelector("#year .crossplot-overlay rect")!;
    expect(rect.getAttribute("visibility")).toBe("visible");
    expect(Number(rect.getAttribute("width"))).toBeGreaterThan(0);
    expect(fills("#year").filter((c) => c === "#4c7dff")).toHaveLength(5);
    dash.filters.clear();
    await dash.idle();
    expect(rect.getAttribute("visibility")).toBe("hidden");
  });

  it("turns a pointer drag into a brush filter", async () => {
    const { dash, year } = await setup();
    if (typeof PointerEvent !== "function") return; // jsdom without PointerEvent
    const overlay = document.querySelector<SVGSVGElement>("#year .crossplot-overlay")!;
    const bars = [...document.querySelectorAll("#year [aria-label=rect] rect")];
    const xOf = (i: number) => Number(bars[i]!.getAttribute("x"));
    const yMid = Number(bars[0]!.getAttribute("y"));
    const ev = (type: string, x: number) =>
      new PointerEvent(type, { clientX: x, clientY: yMid, pointerId: 1, button: 0, bubbles: true });
    overlay.dispatchEvent(ev("pointerdown", xOf(2) + 1));
    overlay.dispatchEvent(ev("pointermove", xOf(6) + 1));
    overlay.dispatchEvent(ev("pointerup", xOf(6) + 1));
    await dash.idle();
    const f = year.filter as { range: [number, number] };
    expect(f.range[0]).toBeCloseTo(1820, -1);
    expect(f.range[1]).toBeCloseTo(1860, -1);
    // A click without a drag clears it.
    overlay.dispatchEvent(ev("pointerdown", xOf(3)));
    overlay.dispatchEvent(ev("pointerup", xOf(3)));
    await dash.idle();
    expect(year.filter).toBeNull();
  });

  it("stacks a [bin, category] grid and outlines the unfiltered shape", async () => {
    document.body.innerHTML = `<div id="stack"></div><div id="cls"></div>`;
    const dash = await createDashboard({
      data: rows,
      engine: "local",
      schedule: microtask,
      renderer: plotRenderer({ defaults: { width: 400 } }),
    });
    const stack = dash.chart("#stack", {
      dimension: [bin("year", { step: 50, extent: [1800, 2000] }), "cls"],
      view: { mark: "stackY", colors: { Iron: "#000000" } },
    });
    const cls = dash.chart("#cls", { dimension: "cls", view: { compare: true, sort: "-baseline" } });
    await Promise.all([stack.ready, cls.ready]);
    await dash.idle();
    // 4 x bins × 4 classes, all non-empty.
    expect(document.querySelectorAll("#stack [aria-label=rect] rect")).toHaveLength(16);
    expect(document.querySelectorAll('#stack rect[fill="#000000"]')).toHaveLength(4);
    // No filter yet: nothing to compare against.
    expect(document.querySelector("#cls [aria-label=tick]")).toBeNull();

    stack.apply({ type: "brush", range: [1800, 1850] });
    await dash.idle();
    expect(dash.summary.selected).toBe(50);
    expect(document.querySelectorAll("#cls [aria-label=tick] line")).toHaveLength(4);
  });
});

describe("plotRenderer: maps, streams, share bars and bump charts", () => {
  const finds = Array.from({ length: 120 }, (_, i) => ({
    lng: [-110, 105, 20, -65][i % 4]! + (i % 7) * 0.3,
    lat: [47, 43, 5, -40][i % 4]! + (i % 5) * 0.2,
    plat: [40, 45, -10, -50][i % 4]!,
    plng: [-80, 90, 0, -30][i % 4]!,
    age: 70 + (i % 30) * 4,
    kind: ["Bones", "Bones", "Bones", "Eggs", "Footprints"][i % 5]!,
    country: ["USA", "China", "Niger", "Argentina"][i % 4]!,
    era: ["1900", "1950", "2000"][(i * 7) % 3]!,
    group: ["A", "B"][i % 2]!,
  }));

  async function make(spec: (dash: Awaited<ReturnType<typeof createDashboard>>) => unknown) {
    document.body.innerHTML = `<div id="a"></div><div id="b"></div>`;
    const dash = await createDashboard({
      data: finds,
      engine: "local",
      schedule: microtask,
      renderer: plotRenderer({ defaults: { width: 360 } }),
    });
    const chart = spec(dash) as { ready: Promise<unknown>; filter: unknown; id: string };
    await chart.ready;
    await dash.idle();
    return { dash, chart };
  }

  const pointer = (target: Element, type: string, x: number, y: number) =>
    target.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, button: 0, bubbles: true }));

  it("draws a map with one dot per occupied cell and brushes a box of coordinates", async () => {
    const { dash, chart } = await make((dash) =>
      dash.chart("#a", {
        id: "map",
        dimension: lngLat("lng", "lat", { step: 10 }),
        extra: { plat: mean("plat"), plng: mean("plng") },
        view: {
          mark: "map",
          layouts: [{ label: "Today" }, { label: "Then", position: (d: Datum) => [d.extra!.plng!, d.extra!.plat!] }],
        },
      }),
    );
    const circles = [...document.querySelectorAll("#a .crossplot-dots circle")] as SVGCircleElement[];
    expect(circles).toHaveLength(4);
    expect(document.querySelectorAll("#a .crossplot-layouts button")).toHaveLength(2);
    if (typeof PointerEvent !== "function") return;
    // 360 px wide plate carrée: 1 px per degree, so (lng, lat) sits at (lng + 180, 90 - lat).
    const overlay = document.querySelector("#a .crossplot-overlay")!;
    pointer(overlay, "pointerdown", 180 - 120, 90 - 50);
    pointer(overlay, "pointermove", 180 - 100, 90 - 40);
    pointer(overlay, "pointerup", 180 - 100, 90 - 40);
    await dash.idle();
    const f = chart.filter as { x: { range: number[] }; y: { range: number[] } };
    expect(f.x.range[0]).toBeCloseTo(-120, 0);
    expect(f.y.range[1]).toBeCloseTo(50, 0);
    expect(dash.summary.selected).toBe(30);
    expect(circles.filter((c) => c.dataset.selected === "true")).toHaveLength(1);

    // Switching layouts moves the dots and turns the brush off.
    const before = circles.map((c) => c.style.transform);
    document.querySelector<HTMLButtonElement>('#a .crossplot-layouts [data-layout="1"]')!.click();
    expect(circles.map((c) => c.style.transform)).not.toEqual(before);
    expect(document.querySelector("#a .crossplot-overlay rect:first-child")!.getAttribute("visibility")).toBe("hidden");
    pointer(overlay, "pointerdown", 10, 10);
    pointer(overlay, "pointerup", 10, 10);
    await dash.idle();
    expect(chart.filter).not.toBeNull();
  });

  it("draws a streamgraph and shades outside the brush", async () => {
    const { dash, chart } = await make((dash) =>
      dash.chart("#a", {
        id: "age",
        dimension: [bin("age", { step: 10, extent: [70, 190] }), "group"],
        view: { mark: "streamY", colors: { A: "#111111", B: "#222222" } },
      }),
    );
    expect(document.querySelectorAll("#a [aria-label=area] path")).toHaveLength(2);
    dash.filters.set(chart.id, { range: [100, 140] });
    await dash.idle();
    const shades = [...document.querySelectorAll("#a .crossplot-overlay rect")].slice(1, 3);
    expect(shades.map((r) => r.getAttribute("visibility"))).toEqual(["visible", "visible"]);
  });

  it("splits a category into one share bar and selects a segment on click", async () => {
    const { dash, chart } = await make((dash) =>
      dash.chart("#a", { id: "kind", dimension: "kind", view: { mark: "shareX", sort: "-baseline" } }),
    );
    const rects = [...document.querySelectorAll("#a [aria-label=rect] rect")];
    expect(rects).toHaveLength(3);
    const first = rects[0]!;
    const x = Number(first.getAttribute("x")) + 3;
    const y = Number(first.getAttribute("y")) + Number(first.getAttribute("height")) / 2;
    document
      .querySelector("#a .crossplot-overlay")!
      .dispatchEvent(new MouseEvent("click", { clientX: x, clientY: y, bubbles: true }));
    await dash.idle();
    expect(chart.filter).toEqual({ in: ["Bones"] });
    expect(dash.summary.selected).toBe(72);
  });

  it("ranks lines in a bump chart and selects a line on click", async () => {
    const { dash, chart } = await make((dash) =>
      dash.chart("#a", { id: "country", dimension: ["country", "era"], view: { mark: "bump" } }),
    );
    // 4 countries × 3 eras.
    expect(document.querySelectorAll("#a [aria-label=dot] circle")).toHaveLength(12);
    const dot = document.querySelector("#a [aria-label=dot] circle")!;
    const cx = Number(dot.getAttribute("cx"));
    const cy = Number(dot.getAttribute("cy"));
    document
      .querySelector("#a .crossplot-overlay")!
      .dispatchEvent(new MouseEvent("click", { clientX: cx + 1, clientY: cy, bubbles: true }));
    await dash.idle();
    const f = chart.filter as { in: string[] };
    expect(f.in).toHaveLength(1);
    expect(dash.summary.selected).toBe(30);
  });
});
