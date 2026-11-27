import { bin, category, type Dashboard } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { Chart, useChart, useDashboard, useFilters, useRows, useSummary } from "@crossplot/react";
import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { type Flight, flights } from "./data.js";
import type { ExampleTheme, MountExample } from "./theme.js";

type Field = keyof Flight;

const hourSpec = {
  id: "hour",
  dimension: bin("hour", { step: 1, extent: [0, 24] }),
  view: { title: "Departure hour", xLabel: null },
};
const delaySpec = {
  id: "delay",
  dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }),
  view: { title: "Arrival delay (minutes)", xLabel: null },
};

function Flights({ theme }: { theme: ExampleTheme }) {
  // Keep the data and the renderer stable: a new array would load a new dashboard.
  const data = useMemo(() => flights(), []);
  const renderer = useMemo(
    () => plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted, height: 150 } }),
    [theme],
  );
  const dash = useDashboard({ data, engine: "local", renderer });
  const summary = useSummary(dash);
  const filters = useFilters(dash);

  return (
    <>
      <p className="crossplot-count">
        {summary
          ? `${summary.selected.toLocaleString("en-US")} of ${summary.total.toLocaleString("en-US")} flights selected`
          : "Loading…"}
        {Object.keys(filters).length > 0 && (
          <button type="button" className="cp-button" onClick={() => dash?.filters.clear()}>
            Clear all
          </button>
        )}
      </p>
      <div className="cp-grid">
        <Chart dashboard={dash} spec={hourSpec} />
        <Chart dashboard={dash} spec={delaySpec} />
      </div>
      <Carriers dash={dash} />
      <Latest dash={dash} />
    </>
  );
}

/** A headless chart drawn with plain React: one toggle button per carrier. */
function Carriers({ dash }: { dash: Dashboard<Field> | null }) {
  const { data, filter, chart, reset } = useChart(dash, { id: "carrier", dimension: category("carrier") });
  const picked = filter && "in" in filter ? filter.in : [];
  return (
    <p>
      {data?.data.map((d) => (
        <button
          key={d.key}
          type="button"
          className="cp-button"
          aria-pressed={picked.includes(d.key)}
          style={picked.includes(d.key) ? { borderColor: "var(--cp-accent)" } : undefined}
          onClick={() => chart?.apply({ type: "select", keys: [d.key], mode: "toggle" })}
        >
          {d.key} {d.value.toLocaleString("en-US")}
        </button>
      ))}
      {picked.length > 0 && (
        <button type="button" className="cp-button" onClick={reset}>
          All carriers
        </button>
      )}
    </p>
  );
}

/** The most delayed flights in the selection, refetched after every update. */
function Latest({ dash }: { dash: Dashboard<Field> | null }) {
  const result = useRows(dash, { columns: ["carrier", "origin", "hour", "delay"], sort: "-delay", limit: 3 });
  if (!result) return null;
  const lines = result.rows.map(
    (r) => `${r.carrier} from ${r.origin} at ${Number(r.hour).toFixed(1)}h: ${Math.round(Number(r.delay))} min late`,
  );
  return <pre className="cp-out">{`Most delayed of the selection\n${lines.join("\n")}`}</pre>;
}

export const mount: MountExample = async (el, theme) => {
  const root = createRoot(el);
  root.render(
    <StrictMode>
      <Flights theme={theme} />
    </StrictMode>,
  );
  return () => root.unmount();
};
