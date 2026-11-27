// @vitest-environment jsdom

import {
  bin,
  type ChartData,
  category,
  type Dashboard,
  type DataEngine,
  type Filter,
  type FilterState,
  type Intent,
  localEngine,
  type Renderer,
} from "@crossplot/core";
import { act, cleanup, render, screen } from "@testing-library/react";
import { StrictMode, useState } from "react";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { Chart, useChart, useDashboard, useFilter, useFilters, useRows, useSummary } from "../src/index.js";

// React only wraps updates in act() when this flag is set.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Flight = { hour: number; carrier: string };
type Dash = Dashboard<keyof Flight>;
const rows: Flight[] = Array.from({ length: 100 }, (_, i) => ({ hour: i % 24, carrier: ["A", "B", "C", "D"][i % 4]! }));
const microtask = (run: () => void) => queueMicrotask(run);
/** Brute-force rows per 6-hour bin among the rows that pass `keep`. */
const hourCounts = (keep: (r: Flight) => boolean) =>
  [0, 6, 12, 18].map((lo) => rows.filter((r) => keep(r) && r.hour >= lo && r.hour < lo + 6).length);
const carrierCounts = (keep: (r: Flight) => boolean) =>
  ["A", "B", "C", "D"].map((c) => rows.filter((r) => keep(r) && r.carrier === c).length);

/** A local engine that counts how often it is loaded and disposed. */
function countingEngine() {
  const stats = { loads: 0, disposed: 0 };
  const inner = localEngine();
  const engine: DataEngine = {
    ...inner,
    load(table) {
      stats.loads++;
      return inner.load(table);
    },
    dispose() {
      stats.disposed++;
      inner.dispose();
    },
  };
  return { engine, stats };
}

/** A renderer that records what it was given and lets a test emit intents. */
function recordingRenderer() {
  const log = { mounts: 0, live: 0, updates: [] as Array<{ id: string; data: ChartData; filter: Filter | null }> };
  const emits = new Map<string, (intent: Intent) => void>();
  const views: unknown[] = [];
  const renderer: Renderer<{ title?: string }> = {
    mount(_el, view, emit, ctx) {
      log.mounts++;
      log.live++;
      views.push(view);
      emits.set(ctx.id, emit);
      return {
        update(data, filter) {
          log.updates.push({ id: ctx.id, data, filter });
        },
        destroy() {
          log.live--;
        },
      };
    },
  };
  return { renderer, log, emits, views };
}

/** Let microtasks, engine promises and React updates settle. */
async function settle(dash?: Dashboard | null) {
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
      if (dash) await dash.idle();
    });
  }
}

/** What the test components saw on their latest render. */
interface Probe {
  dash: Dash | null;
  hourData: ChartData | null;
  hourFilter: Filter | null;
  reset: () => void;
  filters: FilterState;
  carrier: Filter | null;
  show: (show: boolean) => void;
  retitle: (title: string) => void;
  setData: (data: Flight[]) => void;
}
const probe = (): Probe => ({
  dash: null,
  hourData: null,
  hourFilter: null,
  reset: () => {},
  filters: {},
  carrier: null,
  show: () => {},
  retitle: () => {},
  setData: () => {},
});

function Status({ engine, probe }: { engine: DataEngine; probe: Probe }) {
  const [data, setData] = useState(rows);
  probe.setData = setData;
  const dash = useDashboard({ data, engine, schedule: microtask });
  probe.dash = dash;
  const summary = useSummary(dash);
  return <p>{summary ? `${summary.selected}/${summary.total}` : "loading"}</p>;
}

function Hours({ dash, title, probe }: { dash: Dash | null; title: string; probe: Probe }) {
  const hour = useChart(dash, { id: "hour", dimension: bin("hour", { step: 6, extent: [0, 24] }), view: { title } });
  probe.hourData = hour.data;
  probe.hourFilter = hour.filter;
  probe.reset = hour.reset;
  return <div ref={hour.ref} />;
}

function App({
  engine,
  renderer,
  probe,
}: {
  engine: DataEngine;
  renderer: Renderer<{ title?: string }>;
  probe: Probe;
}) {
  const [show, setShow] = useState(true);
  const [title, setTitle] = useState("Hour");
  probe.show = setShow;
  probe.retitle = setTitle;
  const dash = useDashboard({ data: rows, engine, renderer, schedule: microtask });
  probe.dash = dash;
  probe.filters = useFilters(dash);
  probe.carrier = useFilter(dash, "carrier");
  const summary = useSummary(dash);
  return (
    <>
      <Hours dash={dash} title={title} probe={probe} />
      {show && <Chart dashboard={dash} spec={{ dimension: category("carrier") }} className="chart" />}
      <p>{summary ? "ready" : "loading"}</p>
    </>
  );
}

function Table({ engine, probe }: { engine: DataEngine; probe: Probe }) {
  const dash = useDashboard({ data: rows, engine, schedule: microtask });
  probe.dash = dash;
  useChart(dash, { id: "carrier", dimension: category("carrier") });
  const result = useRows(dash, { columns: ["hour", "carrier"], sort: "-hour", limit: 2 });
  return <p>{result ? `${result.selected}:${result.rows.map((r) => `${r.carrier}${r.hour}`).join(",")}` : "none"}</p>;
}

afterEach(() => cleanup());

describe("useDashboard", () => {
  it("creates one engine under StrictMode and destroys it on unmount", async () => {
    const { engine, stats } = countingEngine();
    const p = probe();
    const view = render(
      <StrictMode>
        <Status engine={engine} probe={p} />
      </StrictMode>,
    );
    expect(screen.getByText("loading")).toBeTruthy();
    await settle();
    expect(screen.getByText("100/100")).toBeTruthy();
    expect(stats.loads).toBe(1);
    view.unmount();
    expect(stats.disposed).toBe(1);
  });

  it("recreates the dashboard when the data changes", async () => {
    const { engine, stats } = countingEngine();
    const p = probe();
    render(<Status engine={engine} probe={p} />);
    await settle();
    act(() => p.setData(rows.slice(0, 10)));
    await settle();
    expect(screen.getByText("10/10")).toBeTruthy();
    expect(stats.loads).toBe(2);
    expect(stats.disposed).toBe(1);
  });

  it("renders on the server without creating anything", () => {
    const { engine, stats } = countingEngine();
    const { renderer, log } = recordingRenderer();
    const html = renderToString(<App engine={engine} renderer={renderer} probe={probe()} />);
    expect(html).toContain('<div class="chart"></div>');
    expect(html).toContain("loading");
    expect(stats.loads).toBe(0);
    expect(log.mounts).toBe(0);
  });
});

describe("useChart and Chart", () => {
  async function setup(strict = false) {
    const { engine, stats } = countingEngine();
    const rec = recordingRenderer();
    const p = probe();
    const app = <App engine={engine} renderer={rec.renderer} probe={p} />;
    const view = render(strict ? <StrictMode>{app}</StrictMode> : app);
    await settle();
    await settle(p.dash);
    return { view, p, stats, rec };
  }

  it("draws each chart once, cross-filters, and follows filters", async () => {
    const { p, rec } = await setup(true);
    expect(rec.log.live).toBe(2);
    expect(p.hourData?.data.map((d) => d.count)).toEqual(hourCounts(() => true));

    // Brush the hour chart through its renderer: the carrier chart re-aggregates.
    await act(async () => rec.emits.get("hour")!({ type: "brush", range: [0, 6] }));
    await settle(p.dash);
    expect(p.hourFilter).toEqual({ range: [0, 6] });
    expect(p.filters).toEqual({ hour: { range: [0, 6] } });
    const carrier = rec.log.updates.filter((u) => u.id === "carrier").at(-1)!;
    expect(carrier.data.selected).toBe(hourCounts(() => true)[0]);
    expect(carrier.data.data.map((d) => d.count)).toEqual(carrierCounts((r) => r.hour < 6));

    // Select a carrier: the hour chart re-aggregates.
    await act(async () => rec.emits.get("carrier")!({ type: "select", keys: ["A"], mode: "replace" }));
    await settle(p.dash);
    expect(p.carrier).toEqual({ in: ["A"] });
    expect(p.hourData?.data.map((d) => d.count)).toEqual(hourCounts((r) => r.carrier === "A"));

    await act(async () => p.reset());
    await settle(p.dash);
    expect(p.hourFilter).toBeNull();
    expect(p.filters).toEqual({ carrier: { in: ["A"] } });
  });

  it("removes a chart and its filter on unmount", async () => {
    const { p, rec } = await setup();
    await act(async () => rec.emits.get("carrier")!({ type: "select", keys: ["B"], mode: "replace" }));
    await settle(p.dash);
    expect(p.hourData?.selected).toBe(25);

    act(() => p.show(false));
    await settle(p.dash);
    expect(rec.log.live).toBe(1);
    expect(p.filters).toEqual({});
    expect(p.hourData?.selected).toBe(100);
  });

  it("remounts only the view when the view changes", async () => {
    const { p, rec } = await setup();
    await act(async () => rec.emits.get("hour")!({ type: "brush", range: [6, 12] }));
    await settle(p.dash);
    const mounts = rec.log.mounts;

    act(() => p.retitle("Departure hour"));
    await settle(p.dash);
    expect(rec.log.mounts).toBe(mounts + 1);
    expect(rec.log.live).toBe(2);
    expect(rec.views.at(-1)).toEqual({ title: "Departure hour" });
    // Same chart, so its filter survives.
    expect(p.hourFilter).toEqual({ range: [6, 12] });
  });

  it("destroys charts and the engine together on unmount", async () => {
    const { view, rec, stats } = await setup(true);
    view.unmount();
    expect(rec.log.live).toBe(0);
    expect(stats.disposed).toBe(1);
  });
});

describe("useRows", () => {
  it("fetches filtered rows after every update", async () => {
    const { engine } = countingEngine();
    const p = probe();
    render(<Table engine={engine} probe={p} />);
    await settle();
    await settle(p.dash);
    expect(screen.getByText("100:D23,D23")).toBeTruthy();
    await act(async () => p.dash!.filters.set("carrier", { in: ["A"] }));
    await settle(p.dash);
    expect(screen.getByText("25:A20,A20")).toBeTruthy();
  });
});
