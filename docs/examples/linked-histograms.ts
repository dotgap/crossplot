import { bin, createDashboard } from "@crossplot/core";
import { countDisplay } from "@crossplot/core/dom";
import { plotRenderer } from "@crossplot/plot";
import { flights } from "./data.js";
import { $, type MountExample } from "./theme.js";

export const mount: MountExample = async (el, theme) => {
  el.innerHTML = `
    <p class="crossplot-count" data-count></p>
    <div class="cp-grid">
      <div data-hour></div>
      <div data-delay></div>
      <div data-distance></div>
      <div data-date></div>
    </div>`;

  const dash = await createDashboard({
    data: flights(),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted, height: 160 } }),
  });

  dash.chart($(el, "[data-hour]"), {
    dimension: bin("hour", { step: 1, extent: [0, 24] }),
    view: { title: "Departure hour", xLabel: null },
  });
  dash.chart($(el, "[data-delay]"), {
    dimension: bin("delay", { step: 10, extent: [-60, 180], clamp: true }),
    view: { title: "Arrival delay (minutes)", xLabel: null },
  });
  dash.chart($(el, "[data-distance]"), {
    dimension: bin("distance", { scale: "log", bins: 30 }),
    view: { title: "Distance (miles, log scale)", xLabel: null },
  });
  dash.chart($(el, "[data-date]"), {
    dimension: bin("date", { interval: "week" }),
    view: { title: "Date", xLabel: null },
  });
  const stopCount = countDisplay(dash, $(el, "[data-count]"), {
    format: (s, t) => `${s.toLocaleString("en-US")} of ${t.toLocaleString("en-US")} flights selected`,
  });

  return () => {
    stopCount();
    dash.destroy();
  };
};
