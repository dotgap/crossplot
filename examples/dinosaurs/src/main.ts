import {
  bin,
  type ChartData,
  createDashboard,
  type Datum,
  type Filter,
  type FilterState,
  fromColumns,
  lngLat,
  mean,
  top,
} from "@crossplot/core";
import { dataTable } from "@crossplot/core/dom";
import { type PlotView, plotRenderer } from "@crossplot/plot";
import * as Plot from "@observablehq/plot";

type Columns = {
  name: (string | null)[];
  genus: (string | null)[];
  group: string[];
  diet: string[];
  kind: string[];
  age: number[];
  oldest: number[];
  youngest: number[];
  country: (string | null)[];
  formation: (string | null)[];
  environment: string[];
  reported: (number | null)[];
  /** Where the find was made. */
  lng: (number | null)[];
  lat: (number | null)[];
  /** Where that spot lay when the animal died. */
  plng: (number | null)[];
  plat: (number | null)[];
};

/** Derived on load: the ancient position as a unit vector, so averaging works across the date line. */
type Derived = { px: (number | null)[]; py: (number | null)[]; pz: (number | null)[]; period: string[] };
type Row = { [K in keyof (Columns & Derived)]: (Columns & Derived)[K][number] };

type Coasts = Record<string, { type: "MultiPolygon"; coordinates: number[][][][] }>;
const [columns, coasts]: [Columns, Coasts] = await Promise.all([
  fetch("./dinosaurs.json").then((r) => r.json()),
  fetch("./coasts.json").then((r) => r.json()),
]);
const nf = new Intl.NumberFormat("en-US");
const fmt = (v: number) => nf.format(Math.round(v));

// --- Theme ------------------------------------------------------------------
// Colors live in CSS custom properties so light and dark mode each get their
// own validated steps. Plot needs real colors, so read them once.
const css = getComputedStyle(document.documentElement);
const token = (name: string) => css.getPropertyValue(name).trim();

const GROUPS = [
  "Theropods",
  "Long-necks",
  "Duck-bills and kin",
  "Horned and dome-headed",
  "Armored and plated",
  "Not identified",
] as const;
const GROUP_COLORS: Record<string, string> = {
  Theropods: token("--g-theropods"),
  "Long-necks": token("--g-longnecks"),
  "Duck-bills and kin": token("--g-duckbills"),
  "Horned and dome-headed": token("--g-horned"),
  "Armored and plated": token("--g-armored"),
  "Not identified": token("--g-unknown"),
};
const GROUP_NOTES: Record<string, string> = {
  Theropods: "two-legged hunters, from raptors to T. rex",
  "Long-necks": "sauropods and their ancestors",
  "Duck-bills and kin": "ornithopods, the grazing herds",
  "Horned and dome-headed": "Triceratops, Protoceratops, Pachycephalosaurus",
  "Armored and plated": "ankylosaurs and stegosaurs",
  "Not identified": "too incomplete to place",
};

// A page reload keeps the filters (they live in the URL), so switching the
// system theme simply reloads to pick up the other palette.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => location.reload());

// --- Derived columns ------------------------------------------------------------
const RAD = Math.PI / 180;
const unit = (i: number): [number, number, number] | null => {
  const lng = columns.plng[i];
  const lat = columns.plat[i];
  if (lng == null || lat == null) return null;
  return [Math.cos(lat * RAD) * Math.cos(lng * RAD), Math.cos(lat * RAD) * Math.sin(lng * RAD), Math.sin(lat * RAD)];
};
const vectors = columns.name.map((_, i) => unit(i));

// Publication periods for the country ranking. The keys sort as text, so they start with a year.
const thisYear = new Date().getUTCFullYear();
const PERIODS: [number, string][] = [
  [1950, "1824–1949"],
  [1980, "1950–1979"],
  [2000, "1980–1999"],
  [2010, "2000–2009"],
  [2020, "2010–2019"],
  [Infinity, `2020–${thisYear}`],
];
const period = (year: number | null) =>
  year == null ? "unknown" : (PERIODS.find(([end]) => year < end)?.[1] ?? "unknown");

const derived: Derived = {
  px: vectors.map((v) => v?.[0] ?? null),
  py: vectors.map((v) => v?.[1] ?? null),
  pz: vectors.map((v) => v?.[2] ?? null),
  period: columns.reported.map(period),
};

// --- Dashboard --------------------------------------------------------------
const dash = await createDashboard<Row>({
  data: fromColumns({ ...columns, ...derived }),
  renderer: plotRenderer({
    defaults: {
      color: token("--accent"),
      mutedColor: token("--muted-mark"),
      format: fmt,
    },
  }),
});

const ERAS = [
  { name: "Triassic", x1: 252, x2: 201.4 },
  { name: "Jurassic", x1: 201.4, x2: 145 },
  { name: "Cretaceous", x1: 145, x2: 66 },
];

const eraMarks = [
  Plot.rectX(ERAS, {
    x1: "x1",
    x2: "x2",
    fill: (_: unknown, i: number) => (i % 2 ? "currentColor" : "none"),
    fillOpacity: 0.04,
  }),
  Plot.text(ERAS, {
    x: (d: (typeof ERAS)[number]) => (d.x1 + d.x2) / 2,
    text: "name",
    frameAnchor: "top",
    dy: 10,
    fill: "currentColor",
    fillOpacity: 0.55,
    fontWeight: 600,
    fontSize: 11,
    textAnchor: "middle",
  }),
];

/** Dashed rules with labels in the margin above the chart, so they never sit on bars. */
type Note = { x: number; label: string; anchor?: "start" | "end"; row?: 0 | 1 };
const annotate = (items: Note[]) => [
  ...([0, 1] as const).map((row) =>
    Plot.ruleX(
      items.filter((d) => (d.row ?? 0) === row),
      { x: "x", stroke: "currentColor", strokeOpacity: 0.5, strokeDasharray: "2,3", insetTop: -6 - 14 * row },
    ),
  ),
  ...([0, 1] as const).flatMap((row) =>
    (["start", "end"] as const).map((anchor) =>
      Plot.text(
        items.filter((d) => (d.anchor ?? "start") === anchor && (d.row ?? 0) === row),
        {
          x: "x",
          text: "label",
          frameAnchor: "top",
          dy: -12 - 14 * row,
          dx: anchor === "end" ? -4 : 4,
          textAnchor: anchor,
          fill: "currentColor",
          fontSize: 11,
          fontWeight: 500,
        },
      ),
    ),
  ),
];

const narrow = () => document.documentElement.clientWidth < 640;

const age = dash.chart<PlotView>("#age", {
  id: "age",
  dimension: [bin("age", { step: 2, extent: [64, 252] }), "group"],
  view: {
    mark: "streamY",
    reverse: true,
    series: [...GROUPS],
    colors: GROUP_COLORS,
    height: narrow() ? 240 : 320,
    xLabel: null,
    yLabel: null,
    underlay: eraMarks,
    tooltip: (d, bins) =>
      [`${d.x1}–${d.x0} million years ago`, ...bins.map((b) => `${b.ykey}: ${fmt(b.value)}`)].join("\n"),
    plot: {
      marginTop: narrow() ? 26 : 40,
      marginLeft: 12,
      marginRight: 12,
      x: { label: "Millions of years ago", labelAnchor: "right", labelArrow: "none", reverse: true, domain: [64, 252] },
      marks: annotate([
        { x: 66, label: narrow() ? "Asteroid" : "Asteroid impact, 66 million years ago", anchor: "end" },
        { x: 233, label: "First dinosaurs" },
        ...(narrow()
          ? []
          : [
              { x: 150, label: "Morrison Formation", row: 1 as const },
              { x: 84, label: "Dinosaur Park, Hell Creek, Nemegt", anchor: "end" as const, row: 1 as const },
            ]),
      ]),
    },
  },
});

const group = dash.chart<PlotView>("#group", {
  id: "group",
  dimension: "group",
  view: {
    mark: "barX",
    sort: "-baseline",
    colors: GROUP_COLORS,
    compare: true,
    labels: true,
    yLabel: null,
    plot: { marginLeft: 170 },
  },
});

const shareTip = (d: Datum) => {
  const all = d.baseline > 0 ? ` (${fmt(d.baseline)} of all finds)` : "";
  return `${d.key}\n${fmt(d.value)} finds${all}`;
};

const DIET_COLORS: Record<string, string> = {
  "Plant-eater": token("--g-duckbills"),
  "Meat-eater": token("--g-theropods"),
  Omnivore: token("--g-horned"),
  Unknown: token("--g-unknown"),
};
const KIND_COLORS: Record<string, string> = {
  "Bones and teeth": token("--accent"),
  Footprints: token("--g-armored"),
  Eggs: token("--g-horned"),
};

const diet = dash.chart<PlotView>("#diet", {
  id: "diet",
  dimension: "diet",
  view: { mark: "shareX", sort: "-baseline", colors: DIET_COLORS, tooltip: shareTip },
});

/** Countries the text talks about, picked out in the ranking until the reader selects their own. */
const RISERS: Record<string, string> = {
  USA: token("--accent"),
  Spain: token("--g-theropods"),
  Argentina: token("--g-duckbills"),
  Brazil: token("--g-horned"),
};

// Ranked by finds published in each period: a bump chart. Selecting a line filters by country.
const bumpTip = (d: Datum) => `${d.key}, published ${d.ykey}\n${fmt(d.value)} finds`;
const country = dash.chart<PlotView>("#country", {
  id: "country",
  dimension: [top("country", 10), "period"],
  view: {
    mark: "bump",
    omit: ["Other", "unknown"],
    tooltip: bumpTip,
    colors: RISERS,
    height: narrow() ? 300 : 320,
    plot: { marginLeft: narrow() ? 78 : 96, marginRight: narrow() ? 78 : 96 },
  },
});

// --- The map ---------------------------------------------------------------------
const land = token("--land");
const TIMES = Object.keys(coasts)
  .map(Number)
  .filter((t) => t > 0);
const equator = Plot.ruleY([0], { stroke: "currentColor", strokeOpacity: 0.18, strokeDasharray: "2,4" });
const coastMarks = new Map<number, Plot.Markish[]>();
/** Land for a moment in time (0 is today), built once per moment so the map only redraws when it changes. */
const coastsAt = (t: number) => {
  let marks = coastMarks.get(t);
  if (!marks) {
    marks = [
      Plot.geo(coasts[t], { fill: land, stroke: "none", clip: "frame" }),
      equator,
      ...(t > 0
        ? [
            Plot.text([`Coastlines ${t} million years ago`], {
              frameAnchor: "bottom-left",
              dx: 10,
              dy: -10,
              fill: "currentColor",
              fillOpacity: 0.7,
              fontSize: 12,
              fontWeight: 500,
            }),
          ]
        : []),
    ];
    coastMarks.set(t, marks);
  }
  return marks;
};
/** The modelled moment closest to the average age of the finds on the map. */
const coastsFor = (data: ChartData) => {
  let n = 0;
  let sum = 0;
  for (const d of data.data) {
    const a = d.extra?.age;
    if (d.value > 0 && a !== undefined && !Number.isNaN(a)) {
      n += d.value;
      sum += d.value * a;
    }
  }
  const mid = n ? sum / n : 100;
  return coastsAt(TIMES.reduce((best, t) => (Math.abs(t - mid) < Math.abs(best - mid) ? t : best)));
};
/** A cell's average ancient position, back from the averaged unit vector. */
const ancient = (d: Datum): [number, number] | null => {
  const e = d.extra;
  if (!e || Number.isNaN(e.px!) || Number.isNaN(e.py!) || Number.isNaN(e.pz!)) return null;
  const { px, py, pz } = e as { px: number; py: number; pz: number };
  return [Math.atan2(py, px) / RAD, Math.atan2(pz, Math.hypot(px, py)) / RAD];
};
const degrees = ([lng, lat]: readonly [number, number]) =>
  `${Math.abs(Math.round(lat))}°${lat >= 0 ? "N" : "S"}, ${Math.abs(Math.round(lng))}°${lng >= 0 ? "E" : "W"}`;
const mapTip = (d: Datum) => {
  const then = ancient(d);
  return [
    `${fmt(d.value)} ${d.value === 1 ? "find" : "finds"}`,
    `Found near ${degrees([(d.x0 + d.x1) / 2, ((d.y0 ?? 0) + (d.y1 ?? 0)) / 2])}`,
    ...(then ? [`Then near ${degrees(then)}, ${Math.round(d.extra!.age!)} million years ago`] : []),
  ].join("\n");
};

const map = dash.chart<PlotView>("#map", {
  id: "map",
  dimension: lngLat("lng", "lat", { step: 2 }),
  extra: { px: mean("px"), py: mean("py"), pz: mean("pz"), age: mean("age") },
  view: {
    mark: "map",
    radius: narrow() ? 9 : 16,
    tooltip: mapTip,
    layouts: [
      { label: "Where they were found", underlay: coastsAt(0) },
      { label: "When they lived", position: ancient, underlay: coastsFor },
    ],
  },
});
const mapHint = document.getElementById("map-hint")!;
new MutationObserver(() => {
  const then = document.querySelector("#map .crossplot-chart")?.getAttribute("data-layout") === "1";
  mapHint.textContent = then
    ? "Pick a span on the timeline to see the coastlines of that age"
    : "Drag a box on today's map to pick a region";
}).observe(document.getElementById("map")!, { subtree: true, attributes: true, attributeFilter: ["data-layout"] });

const formation = dash.chart<PlotView>("#formation", {
  id: "formation",
  dimension: top("formation", 12),
  view: {
    mark: "barX",
    sort: "-baseline",
    omit: ["Other"],
    compare: true,
    labels: true,
    yLabel: null,
    plot: { marginLeft: 130 },
  },
});

const environment = dash.chart<PlotView>("#environment", {
  id: "environment",
  dimension: "environment",
  view: { mark: "barX", sort: "-baseline", compare: true, labels: true, yLabel: null, plot: { marginLeft: 150 } },
});

const reported = dash.chart<PlotView>("#reported", {
  id: "reported",
  dimension: bin("reported", { step: 1, extent: [1820, thisYear + 1] }),
  view: {
    mark: "rectY",
    compare: true,
    height: narrow() ? 200 : 240,
    xLabel: null,
    yLabel: "Finds",
    tooltip: (d) => `${d.x0}\n${fmt(d.value)} finds published`,
    plot: {
      marginTop: narrow() ? 30 : 44,
      marginLeft: 40,
      marks: annotate(
        narrow()
          ? [
              { x: 1877, label: "Bone Wars" },
              { x: 1996, label: "Feathered dinosaurs", anchor: "end" },
            ]
          : [
              { x: 1865, label: "Hitchcock's footprints", anchor: "end", row: 1 },
              { x: 1877, label: "Cope and Marsh's “Bone Wars”" },
              { x: 1922, label: "Expeditions to the Gobi and Tanzania" },
              { x: 1969, label: "“Dinosaur Renaissance”", row: 1 },
              { x: 1996, label: "Feathered dinosaurs, China" },
            ],
      ),
    },
  },
});

const kind = dash.chart<PlotView>("#kind", {
  id: "kind",
  dimension: "kind",
  view: { mark: "shareX", sort: "-baseline", colors: KIND_COLORS, tooltip: shareTip },
});

// --- The legend doubles as a filter on the family chart -----------------------
const legend = document.getElementById("legend")!;
const chips = GROUPS.map((g) => {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "chip";
  b.style.setProperty("--swatch", GROUP_COLORS[g]!);
  b.innerHTML = `<span class="swatch"></span><span class="label"></span>`;
  b.querySelector(".label")!.textContent = g;
  b.title = GROUP_NOTES[g]!;
  b.addEventListener("click", () => group.apply({ type: "select", keys: [g], mode: "toggle" }));
  legend.append(b);
  return b;
});
dash.filters.subscribe((snap) => {
  const f = snap.filters.group;
  const picked = f && "in" in f ? f.in : null;
  for (const [i, g] of GROUPS.entries()) chips[i]!.setAttribute("aria-pressed", String(picked?.includes(g) ?? false));
  legend.classList.toggle("has-selection", !!picked);
});

// --- Who is in the selection: a headless chart with a hand-made view --------
const genera = dash.chart(null, { id: "genus", dimension: top("genus", 80) });

function renderGenera(el: HTMLElement, limit: number) {
  genera.subscribe((data, filter) => {
    const picked = filter && "in" in filter ? filter.in : [];
    const items = data.data.filter((d) => d.key !== "Other" && (d.value > 0 || picked.includes(d.key)));
    items.sort((a, b) => b.value - a.value);
    const shown = items.slice(0, limit);
    const max = Math.max(1, ...shown.map((d) => d.value));
    el.replaceChildren(
      ...shown.map((d) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "genus";
        b.setAttribute("aria-pressed", String(picked.includes(d.key)));
        b.style.setProperty("--share", String(d.value / max));
        const name = document.createElement("i");
        name.textContent = d.key;
        const n = document.createElement("span");
        n.textContent = fmt(d.value);
        b.append(name, n);
        b.addEventListener("click", () => genera.apply({ type: "select", keys: [d.key], mode: "toggle" }));
        return b;
      }),
    );
    if (!shown.length) el.textContent = "None of the most common names are in this selection.";
  });
}
renderGenera(document.getElementById("genera")!, 24);
renderGenera(document.getElementById("x-genera")!, 12);

// --- Explore: the same charts again, compact, in one grid ------------------
// mount() draws an existing chart in a second place. Both views share one
// dimension and one filter, so brushing either one updates the other.
const compact = (view: PlotView): PlotView => ({ ...view, labels: false });
age.mount("#x-age", {
  mark: "streamY",
  series: [...GROUPS],
  colors: GROUP_COLORS,
  height: 190,
  xLabel: null,
  yLabel: null,
  underlay: [eraMarks[0]!],
  tooltip: (d, bins) =>
    [`${d.x1}–${d.x0} million years ago`, ...bins.map((b) => `${b.ykey}: ${fmt(b.value)}`)].join("\n"),
  plot: { marginLeft: 8, marginRight: 8, x: { reverse: true, domain: [64, 252], label: null } },
} satisfies PlotView);
reported.mount("#x-reported", {
  mark: "rectY",
  compare: true,
  height: 190,
  xLabel: null,
  yLabel: null,
  tooltip: (d) => `${d.x0}\n${fmt(d.value)} finds published`,
  plot: { marginLeft: 40 },
} satisfies PlotView);
group.mount(
  "#x-group",
  compact({
    mark: "barX",
    sort: "-baseline",
    colors: GROUP_COLORS,
    compare: true,
    yLabel: null,
    plot: { marginLeft: 150 },
  }),
);
diet.mount("#x-diet", { mark: "shareX", sort: "-baseline", colors: DIET_COLORS, tooltip: shareTip } satisfies PlotView);
kind.mount("#x-kind", { mark: "shareX", sort: "-baseline", colors: KIND_COLORS, tooltip: shareTip } satisfies PlotView);
map.mount("#x-map", {
  mark: "map",
  radius: 9,
  tooltip: mapTip,
  layouts: [{ label: "Today", underlay: coastsAt(0) }],
} satisfies PlotView);
country.mount("#x-country", {
  mark: "bump",
  omit: ["Other", "unknown"],
  tooltip: bumpTip,
  colors: RISERS,
  height: 240,
  plot: { marginLeft: 70, marginRight: 70, x: { label: null, tickFormat: (k: string) => k.slice(0, 4), axis: "top" } },
} satisfies PlotView);
formation.mount(
  "#x-formation",
  compact({ mark: "barX", sort: "-baseline", omit: ["Other"], compare: true, yLabel: null, plot: { marginLeft: 115 } }),
);
environment.mount(
  "#x-environment",
  compact({ mark: "barX", sort: "-baseline", compare: true, yLabel: null, plot: { marginLeft: 140 } }),
);

dataTable(dash, "#rows", {
  columns: [
    { field: "name", label: "Identified as" },
    { field: "group", label: "Family" },
    {
      field: "oldest",
      label: "From (million years ago)",
      format: (v) => (typeof v === "number" ? String(+v.toFixed(1)) : ""),
    },
    { field: "youngest", label: "To", format: (v) => (typeof v === "number" ? String(+v.toFixed(1)) : "") },
    { field: "country", label: "Country" },
    { field: "formation", label: "Formation" },
    { field: "reported", label: "Published", format: (v) => (v == null ? "" : String(v)) },
  ],
  sort: "-reported",
  pageSize: 10,
});

// --- The selection, in words ---------------------------------------------------
const list = (keys: readonly string[], joiner = "or") =>
  keys.length <= 2 ? keys.join(` ${joiner} `) : `${keys.slice(0, -1).join(", ")} ${joiner} ${keys.at(-1)}`;
const lower = (keys: readonly string[]) => keys.map((k) => k.toLowerCase());
const keysOf = (f: Filter | undefined) => (f && "in" in f ? f.in : null);
const rangeOf = (f: Filter | undefined) =>
  f && "range" in f ? f.range : f && "x" in f && f.x && "range" in f.x ? f.x.range : null;

function describe(filters: FilterState): string[] {
  const parts: string[] = [];
  const g = keysOf(filters.group);
  if (g) parts.push(list(lower(g)));
  const d = keysOf(filters.diet);
  if (d) parts.push(list(lower(d)));
  const k = keysOf(filters.kind);
  if (k) parts.push(list(lower(k)));
  const gen = keysOf(filters.genus);
  if (gen) parts.push(`named ${list(gen)}`);
  const a = rangeOf(filters.age);
  if (a) parts.push(`from ${Math.round(a[1])} to ${Math.round(a[0])} million years ago`);
  const c = keysOf(filters.country);
  if (c) parts.push(`found in ${list(c)}`);
  const fm = keysOf(filters.formation);
  if (fm) parts.push(`from the ${list(fm)} ${fm.length > 1 ? "formations" : "Formation"}`);
  const m = filters.map;
  if (m && "x" in m && m.x && m.y && "range" in m.x && "range" in m.y)
    parts.push(`found between ${degrees([m.x.range[0], m.y.range[0]])} and ${degrees([m.x.range[1], m.y.range[1]])}`);
  const e = keysOf(filters.environment);
  if (e) parts.push(`preserved in ${list(lower(e))}`);
  const r = rangeOf(filters.reported);
  if (r) {
    const lo = Math.ceil(r[0]);
    const hi = Math.ceil(r[1]) - 1;
    parts.push(lo >= hi ? `published in ${lo}` : `published ${lo}–${hi}`);
  }
  return parts;
}

const sentence = document.getElementById("sentence")!;
const reset = document.getElementById("reset") as HTMLButtonElement;
reset.addEventListener("click", () => dash.filters.clear());

dash.onUpdate(({ selected, total }) => {
  const parts = describe(dash.filters.snapshot.filters);
  sentence.replaceChildren();
  const strong = document.createElement("strong");
  if (!parts.length) {
    strong.textContent = `all ${nf.format(total)} finds`;
    sentence.append("Showing ", strong, ". Drag or click any chart to narrow it down.");
  } else {
    strong.textContent = `${nf.format(selected)} of ${nf.format(total)} finds`;
    sentence.append("Showing ", strong, `: ${parts.join(", ")}.`);
  }
  reset.hidden = parts.length === 0;
});

for (const el of document.querySelectorAll("[data-total]")) el.textContent = nf.format(dash.summary.total);

// --- Story links in the prose set the whole filter state -------------------
const STORIES: Record<string, FilterState> = {
  trex: { age: { range: [64, 68] }, country: { in: ["USA", "Canada"] } },
  omnivores: { diet: { in: ["Omnivore"] } },
  armored: { group: { in: ["Armored and plated"] } },
  gobi: { country: { in: ["Mongolia"] } },
  morrison: { formation: { in: ["Morrison"] } },
  hellcreek: { formation: { in: ["Hell Creek"] } },
  sea: { environment: { in: ["Open sea"] } },
  footprints: { kind: { in: ["Footprints"] } },
  triassic: { age: { range: [201.4, 237] } },
  jurassic: { age: { range: [145, 163.5] } },
  last: { age: { range: [66, 72.1] } },
};
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-story]")) {
  const story = STORIES[button.dataset.story!];
  if (!story) continue;
  button.addEventListener("click", () => {
    dash.filters.replace(story);
    // Some stories also switch the map to a layout, through its own buttons.
    const layout = button.dataset.layout;
    if (layout)
      document.querySelector<HTMLButtonElement>(`#map [data-layout="${layout}"]:not([aria-pressed="true"])`)?.click();
  });
}

// --- Keep the filter state in the URL so a view can be shared or reloaded ----
const fromHash = () => {
  try {
    const raw = decodeURIComponent(location.hash.slice(1));
    dash.filters.replace(raw ? JSON.parse(raw) : {});
  } catch {
    // Ignore malformed hashes.
  }
};
fromHash();
window.addEventListener("hashchange", fromHash);
dash.filters.subscribe((snap) => {
  const json = JSON.stringify(snap.toJSON());
  history.replaceState(null, "", json === "{}" ? location.pathname : `#${encodeURIComponent(json)}`);
});
