// @vitest-environment jsdom

import type { ChartData, Dashboard, Datum, Filter, Renderer } from "@crossplot/core";
import { bin, category, createDashboard } from "@crossplot/core";
import { describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, effectScope, h, nextTick, type ShallowRef, shallowRef } from "vue";
import { Chart, useChart, useDashboard, useFilter, useFilters, useRows, useSummary } from "../src/index.js";

const rows = Array.from({ length: 100 }, (_, i) => ({ x: i, kind: i % 2 ? "odd" : "even" }));
const microtask = (run: () => void) => queueMicrotask(run);
const options = { data: rows, engine: "local" as const, schedule: microtask };

/** Wait for the dashboard to exist, then for it to settle. */
async function settle(dash: ShallowRef<Dashboard | null> | Dashboard | null, rounds = 3) {
  for (let i = 0; i < rounds; i++) {
    await new Promise((r) => setTimeout(r, 0));
    const d = dash && "value" in dash ? dash.value : dash;
    await d?.idle();
    await nextTick();
  }
}

/** A renderer that records what it was given, in plain DOM. */
function recorder() {
  const log: { view: unknown; data: ChartData | null; filter: Filter | null; destroyed: boolean }[] = [];
  let emit: (i: Parameters<Parameters<Renderer["mount"]>[2]>[0]) => void = () => {};
  const renderer: Renderer = {
    mount(el, view, e) {
      emit = e;
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
  return { renderer, log, emit: (i: Parameters<typeof emit>[0]) => emit(i) };
}

function mountApp(setup: () => () => ReturnType<typeof h>) {
  const root = document.createElement("div");
  document.body.append(root);
  const app = createApp(defineComponent({ setup }));
  app.mount(root);
  return { root, unmount: () => app.unmount() };
}

describe("useDashboard", () => {
  it("creates the dashboard after mount and destroys it on unmount", async () => {
    let dash!: ShallowRef<Dashboard | null>;
    const { unmount } = mountApp(() => {
      dash = useDashboard(options);
      return () => h("div");
    });
    expect(dash.value).toBeNull();
    await settle(dash);
    expect(dash.value?.summary.total).toBe(100);
    const destroy = vi.spyOn(dash.value!, "destroy");
    unmount();
    expect(destroy).toHaveBeenCalledOnce();
    expect(dash.value).toBeNull();
  });

  it("rebuilds when the data changes", async () => {
    const data = shallowRef(rows);
    const scope = effectScope();
    const dash = scope.run(() => useDashboard(() => ({ ...options, data: data.value })))!;
    await settle(dash);
    const first = dash.value!;
    data.value = rows.slice(0, 10);
    await settle(dash);
    expect(dash.value).not.toBe(first);
    expect(dash.value?.summary.total).toBe(10);
    scope.stop();
  });
});

describe("useChart", () => {
  it("follows data and filters, and draws into its ref", async () => {
    const { renderer, log, emit } = recorder();
    let api!: ReturnType<typeof useChart>;
    let dash!: ShallowRef<Dashboard | null>;
    const { root, unmount } = mountApp(() => {
      dash = useDashboard({ ...options, renderer });
      api = useChart(dash, { dimension: bin("x", { step: 25, extent: [0, 100] }) });
      return () => h("div", { ref: api.ref, class: "chart" });
    });
    await settle(dash);
    expect(api.chart.value?.id).toBe("x");
    expect(api.data.value?.data.map((d) => d.value)).toEqual([25, 25, 25, 25]);
    expect(root.querySelector(".chart p")?.textContent).toBe("25,25,25,25");

    emit({ type: "brush", range: [0, 50] });
    await settle(dash);
    expect(api.filter.value).toEqual({ range: [0, 50] });
    expect(log[0]!.filter).toEqual({ range: [0, 50] });

    api.reset();
    await settle(dash);
    expect(api.filter.value).toBeNull();

    unmount();
    expect(log[0]!.destroyed).toBe(true);
  });

  it("cross-filters a second chart and leaves its own bins alone", async () => {
    const scope = effectScope();
    const { dash, xs, kinds } = scope.run(() => {
      const dash = useDashboard(options);
      return {
        dash,
        xs: useChart(dash, { dimension: bin("x", { step: 50, extent: [0, 100] }) }),
        kinds: useChart(dash, { dimension: category("kind") }),
      };
    })!;
    await settle(dash);
    kinds.chart.value!.apply({ type: "select", keys: ["odd"], mode: "replace" });
    await settle(dash);
    expect(xs.data.value?.data.map((d) => d.value)).toEqual([25, 25]);
    expect(kinds.data.value?.data.map((d) => d.value)).toEqual([50, 50]);
    scope.stop();
  });

  it("recreates the chart when the dimension changes but only redraws for a new view", async () => {
    const { renderer, log } = recorder();
    const spec = shallowRef({ dimension: bin("x", { step: 50, extent: [0, 100] }), view: { title: "A" } });
    let api!: ReturnType<typeof useChart>;
    let dash!: ShallowRef<Dashboard | null>;
    const { unmount } = mountApp(() => {
      dash = useDashboard({ ...options, renderer });
      api = useChart(dash, spec);
      return () => h("div", { ref: api.ref });
    });
    await settle(dash);
    const first = api.chart.value;

    spec.value = { ...spec.value, view: { title: "B" } };
    await settle(dash);
    expect(api.chart.value).toBe(first);
    expect(log.map((l) => [l.view, l.destroyed])).toEqual([
      [{ title: "A" }, true],
      [{ title: "B" }, false],
    ]);

    spec.value = { ...spec.value, dimension: bin("x", { step: 25, extent: [0, 100] }) };
    await settle(dash);
    expect(api.chart.value).not.toBe(first);
    expect(api.data.value?.data).toHaveLength(4);
    unmount();
  });
});

describe("useFilters, useFilter, useSummary and useRows", () => {
  it("track the selection", async () => {
    const scope = effectScope();
    const { dash, summary, filters, kind, page } = scope.run(() => {
      const dash = useDashboard(options);
      useChart(dash, { dimension: category("kind") });
      return {
        dash,
        summary: useSummary(dash),
        filters: useFilters(dash),
        kind: useFilter(dash, "kind"),
        page: useRows(dash, { columns: ["x"], limit: 3 }),
      };
    })!;
    expect(summary.value).toBeNull();
    await settle(dash);
    expect(summary.value).toEqual({ selected: 100, total: 100 });
    expect(page.value?.rows).toEqual([{ x: 0 }, { x: 1 }, { x: 2 }]);

    dash.value!.filters.set("kind", { in: ["odd"] });
    await settle(dash);
    expect(summary.value?.selected).toBe(50);
    expect(filters.value).toEqual({ kind: { in: ["odd"] } });
    expect(kind.value).toEqual({ in: ["odd"] });
    expect(page.value?.rows).toEqual([{ x: 1 }, { x: 3 }, { x: 5 }]);

    dash.value!.filters.clear();
    await settle(dash);
    expect(summary.value?.selected).toBe(100);
    expect(filters.value).toEqual({});
    expect(kind.value).toBeNull();
    scope.stop();
    expect(summary.value).toBeNull();
  });
});

describe("<Chart>", () => {
  it("draws a chart in a div with the spec's renderer", async () => {
    const { renderer, log } = recorder();
    const dash = await createDashboard({ ...options });
    const spec = { dimension: category("kind"), view: { title: "Kind" }, renderer };
    const { root, unmount } = mountApp(() => () => h(Chart, { dashboard: dash, spec, class: "kind" }));
    await settle(dash);
    expect(root.querySelector("div.kind p")?.textContent).toBe("50,50");
    expect(log[0]!.view).toEqual({ title: "Kind" });
    unmount();
    expect(log[0]!.destroyed).toBe(true);
    dash.destroy();
  });
});
