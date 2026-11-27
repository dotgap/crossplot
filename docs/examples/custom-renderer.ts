import { bin, createDashboard, type Datum, mean, type Renderer } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { flights } from "./data.js";
import { $, type MountExample } from "./theme.js";

/**
 * A complete renderer in plain DOM: one row of text and a bar per category. Click a row to select it,
 * click again to toggle it off. It reports intents and never touches the filter store.
 */
function htmlBars(color: string, muted: string): Renderer<{ title: string }> {
  return {
    mount(el, view, emit) {
      const root = document.createElement("div");
      const title = document.createElement("p");
      title.className = "crossplot-title";
      title.textContent = view.title;
      const list = document.createElement("div");
      root.append(title, list);
      el.append(root);
      list.addEventListener("click", (event) => {
        const row = (event.target as HTMLElement).closest<HTMLElement>("[data-key]");
        if (row) emit({ type: "select", keys: [row.dataset.key!], mode: "toggle" });
      });
      return {
        update(chart, filter) {
          const keys = filter && "in" in filter ? new Set(filter.in) : null;
          const max = Math.max(1, ...chart.data.map((d) => d.baseline));
          list.replaceChildren(...chart.data.map((d) => barRow(d, max, keys && !keys.has(d.key) ? muted : color)));
        },
        destroy: () => root.remove(),
      };
    },
  };
}

function barRow(d: Datum, max: number, fill: string): HTMLElement {
  const row = document.createElement("div");
  row.dataset.key = d.key;
  row.style.cssText = "display:grid;grid-template-columns:90px 1fr 64px;gap:8px;cursor:pointer;font-size:14px";
  const label = document.createElement("span");
  label.textContent = d.key;
  const bar = document.createElement("span");
  bar.style.cssText = `align-self:center;height:10px;width:${(100 * d.value) / max}%;background:${fill}`;
  const value = document.createElement("span");
  value.style.cssText = "text-align:right;font-variant-numeric:tabular-nums";
  value.textContent = d.value.toLocaleString("en-US");
  row.append(label, bar, value);
  return row;
}

export const mount: MountExample = async (el, theme) => {
  el.innerHTML = `
    <div class="cp-grid">
      <div data-carrier></div>
      <div data-hour></div>
    </div>
    <pre class="cp-out" data-summary></pre>`;

  const dash = await createDashboard({
    data: flights(),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted, height: 180 } }),
  });

  // This chart overrides the dashboard's renderer with the one above.
  dash.chart($(el, "[data-carrier]"), {
    dimension: "carrier",
    renderer: htmlBars(theme.color, theme.muted),
    view: { title: "Flights by carrier (custom HTML renderer)" },
  });

  dash.chart($(el, "[data-hour]"), {
    dimension: bin("hour", { step: 1, extent: [0, 24] }),
    view: { title: "Departure hour (Observable Plot)", xLabel: null },
  });

  // A headless chart: no element and no renderer, just aggregates to read.
  const delays = dash.chart(null, {
    id: "delay-by-distance",
    dimension: bin("distance", { step: 500, extent: [0, 3000], clamp: true }),
    value: mean("delay"),
  });
  const summary = $(el, "[data-summary]");
  const unsubscribe = delays.subscribe(({ data, selected }) => {
    const lines = data.map((d) => `${d.key.padEnd(12)} ${Number.isNaN(d.value) ? "–" : d.value.toFixed(1)} min`);
    summary.textContent = `Mean delay by distance, ${selected.toLocaleString("en-US")} flights\n${lines.join("\n")}`;
  });

  return () => {
    unsubscribe();
    dash.destroy();
  };
};
