import { bin, category, createDashboard, type FilterState } from "@crossplot/core";
import { plotRenderer } from "@crossplot/plot";
import { flights } from "./data.js";
import { $, type MountExample } from "./theme.js";

export const mount: MountExample = async (el, theme) => {
  el.innerHTML = `
    <div class="cp-grid">
      <div data-hour></div>
      <div data-carrier></div>
    </div>
    <p>
      <button type="button" class="cp-button" data-save>Save filters</button>
      <button type="button" class="cp-button" data-restore disabled>Restore saved</button>
      <button type="button" class="cp-button" data-preset>Evening flights on Polar</button>
      <button type="button" class="cp-button" data-clear>Clear</button>
    </p>
    <pre class="cp-out" data-json></pre>`;

  const dash = await createDashboard({
    data: flights(),
    engine: "local",
    renderer: plotRenderer({ defaults: { color: theme.color, mutedColor: theme.muted, height: 170 } }),
  });
  const hour = dash.chart($(el, "[data-hour]"), {
    dimension: bin("hour", { step: 1, extent: [0, 24] }),
    view: { title: "Departure hour", xLabel: null },
  });
  dash.chart($(el, "[data-carrier]"), {
    dimension: category("carrier"),
    view: { title: "Carrier", sort: "-baseline", xLabel: null },
  });

  // The filter state is a plain object keyed by chart id. Show it as it changes.
  const json = $(el, "[data-json]");
  const show = () => {
    json.textContent = JSON.stringify(dash.filters.snapshot.toJSON(), null, 2);
  };
  show();
  const unsubscribe = dash.filters.subscribe(show);

  // Save and restore it, as you would with a URL hash or localStorage.
  let saved: FilterState | null = null;
  const restore = $(el, "[data-restore]") as HTMLButtonElement;
  $(el, "[data-save]").onclick = () => {
    saved = dash.filters.snapshot.toJSON();
    restore.disabled = false;
  };
  restore.onclick = () => saved && dash.filters.replace(saved);

  // Filters can be set from code too; charts redraw exactly as if the user had brushed.
  $(el, "[data-preset]").onclick = () => {
    dash.filters.set(hour.id, { range: [17, 21] });
    dash.filters.set("carrier", { in: ["Polar"] });
  };
  $(el, "[data-clear]").onclick = () => dash.filters.clear();

  return () => {
    unsubscribe();
    dash.destroy();
  };
};
