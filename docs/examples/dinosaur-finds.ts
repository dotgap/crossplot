import { bin, createDashboard, fromColumns, lngLat, top } from "@crossplot/core";
import { countDisplay } from "@crossplot/core/dom";
import { plotRenderer } from "@crossplot/plot";
import { DIET_COLORS, GROUP_COLORS, loadDinosaurs } from "./dinosaurs.js";
import { $, type MountExample } from "./theme.js";

export const mount: MountExample = async (el, theme) => {
  const legend = Object.entries(GROUP_COLORS)
    .map(([group, color]) => `<span><i style="background:${color}"></i>${group}</span>`)
    .join("");
  el.innerHTML = `
    <p class="crossplot-count" data-count></p>
    <div class="cp-grid">
      <div class="cp-wide">
        <div data-age></div>
        <p class="cp-legend">${legend}</p>
      </div>
      <div class="cp-wide" data-map></div>
      <div data-country></div>
      <div>
        <div data-diet></div>
        <div data-reported></div>
      </div>
    </div>`;

  const dash = await createDashboard({
    data: fromColumns(await loadDinosaurs()),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted } }),
  });

  // Deep time, stacked by group. Brush a stretch of it: the Late Jurassic is long-necks from
  // Colorado, Portugal and Tanzania; the end of the Cretaceous is duck-bills and horned faces.
  dash.chart($(el, "[data-age]"), {
    dimension: [bin("age", { step: 2, extent: [64, 252] }), "group"],
    view: {
      title: "Finds by age, millions of years ago",
      mark: "stackY",
      reverse: true,
      colors: GROUP_COLORS,
      series: Object.keys(GROUP_COLORS),
      height: 220,
      xLabel: null,
      yLabel: null,
    },
  });

  // Where the finds were made, one dot per 3° cell. Drag a box to filter both axes at once.
  dash.chart($(el, "[data-map]"), {
    dimension: lngLat("lng", "lat", { step: 3 }),
    view: { title: "Where they were found", mark: "map", radius: 9 },
  });

  // The ten countries with the most finds, ranked by the current selection.
  dash.chart($(el, "[data-country]"), {
    dimension: top("country", 10),
    view: { title: "Top countries", sort: "-value", omit: ["Other"], labels: true, xLabel: null },
  });

  // One bar split into its parts; click a part to select it.
  dash.chart($(el, "[data-diet]"), {
    dimension: "diet",
    view: { title: "Diet", mark: "shareX", colors: DIET_COLORS },
  });

  // When each find was published. Brush the last two decades and Spain, China and Argentina climb the ranking.
  dash.chart($(el, "[data-reported]"), {
    dimension: bin("reported", { step: 5, extent: [1820, 2025] }),
    view: { title: "Finds by year published", mark: "areaY", height: 150, xLabel: null, yLabel: null },
  });

  const stopCount = countDisplay(dash, $(el, "[data-count]"), {
    format: (s, t) => `${s.toLocaleString("en-US")} of ${t.toLocaleString("en-US")} dinosaur finds selected`,
  });

  return () => {
    stopCount();
    dash.destroy();
  };
};
