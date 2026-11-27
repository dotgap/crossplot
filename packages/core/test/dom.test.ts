// @vitest-environment jsdom

import { createDashboard } from "@crossplot/core";
import { countDisplay, dataTable } from "@crossplot/core/dom";
import { describe, expect, it } from "vitest";

const rows = Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, v: i, g: i % 2 ? "odd" : "even" }));
const microtask = (run: () => void) => queueMicrotask(run);
const flush = () => new Promise((r) => setTimeout(r, 0));

describe("dom widgets", () => {
  it("shows the selected count and resets", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    dash.chart(null, { dimension: "g" });
    const el = document.createElement("div");
    countDisplay(dash, el);
    expect(el.textContent).toContain("30 of 30 rows selected");
    dash.filters.set("g", { in: ["odd"] });
    await dash.idle();
    expect(el.textContent).toContain("15 of 30 rows selected");
    el.querySelector("button")!.click();
    await dash.idle();
    expect(el.textContent).toContain("30 of 30");
  });

  it("renders a sortable, paged table", async () => {
    const dash = await createDashboard({ data: rows, engine: "local", schedule: microtask });
    dash.chart(null, { dimension: "g" });
    const el = document.createElement("div");
    dataTable(dash, el, { columns: ["id", { field: "v", label: "Value" }], sort: "-v", pageSize: 10 });
    await flush();
    const cells = () => [...el.querySelectorAll("tbody tr")].map((tr) => tr.firstElementChild!.textContent);
    expect(cells()[0]).toBe("r29");
    expect(el.textContent).toContain("Page 1 of 3");
    (el.querySelectorAll("thead button")[1] as HTMLButtonElement).click(); // -v -> v
    await flush();
    expect(cells()[0]).toBe("r0");
    dash.filters.set("g", { in: ["odd"] });
    await dash.idle();
    await flush();
    expect(cells()[0]).toBe("r1");
    expect(el.textContent).toContain("Page 1 of 2");
  });
});
