import { bin, createDashboard, top } from "@crossplot/core";
import { countDisplay } from "@crossplot/core/dom";
import { plotRenderer } from "@crossplot/plot";
import { CARRIERS, flights } from "./data.js";
import { $, type MountExample } from "./theme.js";

export const mount: MountExample = async (el, theme) => {
  el.innerHTML = `
    <p class="crossplot-count" data-count></p>
    <div class="cp-grid">
      <div class="cp-wide" data-heat></div>
      <div data-distance></div>
      <div data-stack></div>
    </div>`;

  const dash = await createDashboard({
    data: flights(),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted } }),
  });

  // An [x, y] pair makes a grid dimension. Drag a rectangle to filter both axes at once.
  dash.chart($(el, "[data-heat]"), {
    dimension: [bin("hour", { step: 1, extent: [0, 24] }), bin("delay", { step: 15, extent: [-30, 180], clamp: true })],
    view: { title: "Departure hour × arrival delay", height: 260, xLabel: "Hour", yLabel: "Delay (min)" },
  });

  dash.chart($(el, "[data-distance]"), {
    dimension: bin("distance", { scale: "log", bins: 30 }),
    view: { title: "Distance (miles)", height: 180, xLabel: null },
  });

  // A grid of a binned x and a categorical y draws as stacked bars, brushable along x.
  dash.chart($(el, "[data-stack]"), {
    dimension: [bin("date", { interval: "month" }), top("carrier", CARRIERS.length)],
    view: { title: "Flights per month by carrier", mark: "stackY", height: 180, xLabel: null },
  });

  const stopCount = countDisplay(dash, $(el, "[data-count]"));
  return () => {
    stopCount();
    dash.destroy();
  };
};
