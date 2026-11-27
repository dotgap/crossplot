// @vitest-environment jsdom

import type { ChartData, Dashboard, Datum, Filter, Renderer } from "@crossplot/core";
import { bin, category } from "@crossplot/core";
import { flushSync, mount, tick, unmount } from "svelte";
import { describe, expect, it, vi } from "vitest";
import { useChart, useDashboard, useSummary } from "../src/index.js";
import Harness from "./Harness.svelte";

const rows = Array.from({ length: 100 }, (_, i) => ({ x: i, kind: i % 2 ? "odd" : "even" }));
const microtask = (run: () => void) => queueMicrotask(run);
const options = { data: rows, engine: "local" as const, schedule: microtask };

/** Wait for the dashboard to exist, then for it to settle. */
async function settle(dash: { current: Dashboard | null }, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    await dash.current?.idle();
    flushSync();
    await tick();
  }
}

/** A renderer that records what it was given, in plain DOM. */
function recorder() {
  const log: { view: unknown; data: ChartData | null; filter: Filter | null; destroyed: boolean }[] = [];
  const emits: Parameters<Renderer["mount"]>[2][] = [];
  const renderer: Renderer = {
    mount(el, view, emit) {
      emits.push(emit);
      const entry = { view, data: null as ChartData | null, filter: null as Filter | null, destroyed: false };
      log.push(entry);
      const p = el.appendChild(document.createElement("p"));
      return {
        update(data, filter) {
          entry.data = data;
          entry.filter = filter;
          p.textContent = data.data.map((d: Datum) => d.value).join(",");
        },
        destroy() {
          entry.destroyed = true;
          p.remove();
        },
      };
    },
  };
  return { renderer, log, emits };
}

describe("@crossplot/svelte in a component", () => {
  it("draws, cross-filters, follows the selection and cleans up", async () => {
    const { renderer, log, emits } = recorder();
    const props = $state({
      options: { ...options, renderer },
      step: 25,
      title: "X",
      renderer,
      expose: (_: unknown) => {},
    });
    let api!: { dash: { current: Dashboard | null }; xs: any; summary: any; filters: any; kind: any; page: any };
    props.expose = (a: unknown) => {
      api = a as typeof api;
    };
    const target = document.createElement("div");
    document.body.append(target);
    const app = mount(Harness, { target, props });
    flushSync();
    expect(target.querySelector(".count")?.textContent).toBe("Loading");
    await settle(api.dash);

    expect(target.querySelector(".count")?.textContent).toBe("100 of 100");
    expect(target.querySelector(".xs p")?.textContent).toBe("25,25,25,25");
    expect(target.querySelector(".kinds p")?.textContent).toBe("50,50");
    expect(api.page.current.rows).toEqual([{ x: 0 }, { x: 1 }, { x: 2 }]);

    const emitFor = (title: string) => emits[log.findIndex((l) => (l.view as { title: string }).title === title)]!;
    // The kind chart selects odd rows; the x chart re-aggregates.
    emitFor("Kind")({ type: "select", keys: ["odd"], mode: "replace" });
    await settle(api.dash);
    expect(target.querySelector(".count")?.textContent).toBe("50 of 100");
    expect(api.xs.data.data.map((d: Datum) => d.value)).toEqual([12, 13, 12, 13]);
    expect(api.filters.current).toEqual({ kind: { in: ["odd"] } });
    expect(api.kind.current).toEqual({ in: ["odd"] });
    expect(api.page.current.rows).toEqual([{ x: 1 }, { x: 3 }, { x: 5 }]);

    emitFor("X")({ type: "brush", range: [0, 50] });
    await settle(api.dash);
    expect(api.xs.filter).toEqual({ range: [0, 50] });
    api.xs.reset();
    api.dash.current!.filters.clear();
    await settle(api.dash);
    expect(api.filters.current).toEqual({});
    expect(api.kind.current).toBeNull();
    expect(target.querySelector(".count")?.textContent).toBe("100 of 100");

    // A new title only redraws; a new step recreates the chart.
    const first = api.xs.chart;
    props.title = "Y";
    await settle(api.dash);
    expect(api.xs.chart).toBe(first);
    expect(log.at(-1)!.view).toEqual({ title: "Y" });
    props.step = 50;
    await settle(api.dash);
    expect(api.xs.chart).not.toBe(first);
    expect(target.querySelector(".xs p")?.textContent).toBe("50,50");

    const dash = api.dash.current!;
    const destroy = vi.spyOn(dash, "destroy");
    unmount(app);
    expect(destroy).toHaveBeenCalledOnce();
    expect(log.every((l) => l.destroyed)).toBe(true);
    target.remove();
  });
});

describe("runes outside a component", () => {
  it("rebuild the dashboard when the data changes", async () => {
    const state = $state({ data: rows });
    let dash!: { current: Dashboard | null };
    let sel!: ReturnType<typeof useSummary>;
    let xs!: ReturnType<typeof useChart>;
    const stop = $effect.root(() => {
      dash = useDashboard(() => ({ ...options, data: state.data }));
      xs = useChart(() => dash.current, { dimension: category("kind") });
      sel = useSummary(dash);
    });
    expect(dash.current).toBeNull();
    expect(sel.current).toBeNull();
    await settle(dash);
    const first = dash.current;
    expect(sel.current?.total).toBe(100);

    state.data = rows.slice(0, 10);
    await settle(dash);
    expect(dash.current).not.toBe(first);
    expect(sel.current?.total).toBe(10);
    expect(xs.data?.data.map((d) => d.value)).toEqual([5, 5]);
    stop();
    expect(dash.current).toBeNull();
  });

  it("accept a bare dashboard and a spec without a renderer", async () => {
    let dash!: { current: Dashboard | null };
    const stop = $effect.root(() => {
      dash = useDashboard(options);
    });
    await settle(dash);
    const d = dash.current!;
    let xs!: ReturnType<typeof useChart>;
    const stop2 = $effect.root(() => {
      xs = useChart(d, { dimension: bin("x", { step: 50, extent: [0, 100] }) });
    });
    await settle(dash);
    expect(xs.data?.data.map((x) => x.value)).toEqual([50, 50]);
    stop2();
    stop();
  });
});
