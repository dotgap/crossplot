import { bin, category, createDashboard, mean, top } from "@crossplot/core";
import { countDisplay } from "@crossplot/core/dom";
import { plotRenderer } from "@crossplot/plot";
import { flights } from "./data.js";
import { $, type MountExample } from "./theme.js";

export const mount: MountExample = async (el, theme) => {
  el.innerHTML = `
    <p class="crossplot-count" data-count></p>
    <div class="cp-grid">
      <div data-carrier></div>
      <div data-origin></div>
      <div data-mean></div>
      <div data-hour></div>
    </div>`;

  const dash = await createDashboard({
    data: flights(),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted } }),
  });

  // Click a bar to select it; click more to add them. Bars keep their place while filters change.
  dash.chart($(el, "[data-carrier]"), {
    dimension: category("carrier"),
    view: { title: "Flights by carrier", sort: "-baseline", labels: true, xLabel: null },
  });

  // The ten busiest origins; the rest share an "Other" bin, which this chart leaves out.
  dash.chart($(el, "[data-origin]"), {
    dimension: top("origin", 10),
    view: { title: "Top 10 origins", sort: "-baseline", omit: ["Other"], select: "single", xLabel: null },
  });

  // A second chart on the same field, with a different aggregate and its own id.
  dash.chart($(el, "[data-mean]"), {
    id: "carrier-delay",
    dimension: category("carrier"),
    value: mean("delay"),
    view: {
      title: "Mean arrival delay by carrier (minutes)",
      sort: "-value",
      labels: true,
      format: (v: number) => v.toFixed(1),
      xLabel: null,
    },
  });

  dash.chart($(el, "[data-hour]"), {
    dimension: bin("hour", { step: 1, extent: [0, 24] }),
    view: { title: "Departure hour", height: 180, xLabel: null, compare: true },
  });

  const stopCount = countDisplay(dash, $(el, "[data-count]"));
  return () => {
    stopCount();
    dash.destroy();
  };
};
