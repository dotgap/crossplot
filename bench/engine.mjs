// Brush latency benchmark for the cross-filter engine, without rendering.
//
//   pnpm bench                     1M rows
//   pnpm bench 10000000            10M rows
//   node bench/engine.mjs 1e6,1e7 --frames 240 --json bench.json --markdown bench.md
//   node bench/engine.mjs 1e7 --idle 0       no idle time between frames
//
// Data is synthetic and seeded, so every run sees the same rows and the same
// brush gestures. Each scenario is a gesture: frame 0 is the brush start (the
// filter goes from "none" to a first range, or a filter is added on top of
// others), the remaining frames are the drag. Start and drag latencies are
// reported separately, as percentiles over the drag frames. Between frames the
// engine gets `--idle` ms (default 16, about one rendered frame) of
// `work()`, untimed, as the worker engine does while the page renders; large
// tables build 2-D tiles in that time and in a slice of each frame, and
// "build" counts the frames that ran while a build was pending. Runs against
// packages/core/dist, so build first (`pnpm bench` does).
import { writeFileSync } from "node:fs";
import { bin, CrossIndex, fromColumns, lngLat, top } from "../packages/core/dist/index.js";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : args[i + 1];
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const sizes = (positional[0] ?? "1000000").split(",").map((s) => Math.round(Number(s)));
const frames = Number(flag("--frames", 120));
const idle = Number(flag("--idle", 16));
const jsonPath = flag("--json", null);
const markdownPath = flag("--markdown", null);

function makeTable(n) {
  let seed = 1;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  const year = new Float64Array(n);
  const mass = new Float64Array(n);
  const lat = new Float64Array(n);
  const lng = new Float64Array(n);
  const delay = new Float64Array(n);
  const codes = new Int32Array(n);
  const fall = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    year[i] = 1800 + Math.floor(rand() * 225);
    mass[i] = 10 ** (rand() * 7);
    lat[i] = rand() * 180 - 90;
    lng[i] = rand() * 360 - 180;
    delay[i] = (rand() + rand() + rand()) * 80 - 120;
    codes[i] = Math.floor(rand() * rand() * 300);
    fall[i] = rand() < 0.1 ? 0 : 1;
  }
  return fromColumns({
    year,
    mass,
    lat,
    lng,
    delay,
    cls: { type: "category", codes, dictionary: Array.from({ length: 300 }, (_, i) => `C${i}`) },
    fall: { type: "category", codes: fall, dictionary: ["Fell", "Found"] },
  });
}

const dims = {
  year: bin("year", { step: 1, extent: [1800, 2025] }),
  mass: bin("mass", { scale: "log", bins: 40 }),
  lat: bin("lat", { bins: 90 }),
  delay: bin("delay", { step: 5 }),
  cls: top("cls", 15),
  fall: { kind: "category", field: "fall" },
  heat: { kind: "grid", x: bin("year", { step: 5, extent: [1800, 2025] }), y: bin("mass", { scale: "log", bins: 28 }) },
  map: lngLat("lng", "lat", { step: 2 }),
};

// Each gesture starts from `base` filters (applied untimed) and then runs
// `frames` filter states; frame 0 is the brush start.
const gestures = [
  {
    name: "year: drag a 20-year window, 1 year/frame",
    frame: (f) => ({ year: { range: [1850 + (f % 150), 1870 + (f % 150)] } }),
  },
  {
    name: "year: grow a brush, 1 year/frame",
    frame: (f) => ({ year: { range: [1900, 1901 + (f % 120)] } }),
  },
  {
    name: "mass: drag a log window, sub-bin edges",
    frame: (f) => ({ mass: { range: [10 ** (1 + (f % 200) * 0.02), 10 ** (3 + (f % 200) * 0.02)] } }),
  },
  {
    name: "lat: fast drag, 15 degrees/frame",
    frame: (f) => {
      const x = Math.abs(((f * 15) % 240) - 120) - 60; // bounces between -60 and 60
      return { lat: { range: [x - 25.3, x + 25.3] } };
    },
  },
  {
    name: "delay: drag with year + class filters on",
    base: { year: { range: [1900, 1990] }, cls: { in: ["C0", "C1", "C2"] } },
    frame: (f) => ({
      year: { range: [1900, 1990] },
      cls: { in: ["C0", "C1", "C2"] },
      delay: { range: [-100 + (f % 120), -40 + (f % 120)] },
    }),
  },
  {
    name: "heatmap: drag a box, both axes",
    frame: (f) => {
      const x = 1820 + (f % 150);
      const y = 1 + (f % 150) * 0.02;
      return { heat: { x: { range: [x, x + 40.5] }, y: { range: [10 ** y, 10 ** (y + 2.5)] } } };
    },
  },
  {
    name: "map: drag a box, 1.5 degrees/frame",
    frame: (f) => {
      const x = -150 + ((f * 1.5) % 200);
      const y = -60 + ((f * 0.75) % 60);
      return { map: { x: { range: [x, x + 70] }, y: { range: [y, y + 45] } } };
    },
  },
  {
    // Worst case for per-dimension caches: the brushed dimension changes every frame.
    name: "year / mass: alternate brushes each frame",
    frame: (f) => ({
      year: { range: [1850 + ((f + 1) >> 1), 1900 + ((f + 1) >> 1)] },
      mass: { range: [10 ** (1 + (f >> 1) * 0.01), 10 ** (4 + (f >> 1) * 0.01)] },
    }),
  },
];

const pct = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
const fmt = (ms) => (ms < 10 ? ms.toFixed(2) : ms < 100 ? ms.toFixed(1) : ms.toFixed(0));

const report = { node: process.version, frames, idle, runs: [] };
for (const n of sizes) {
  const t0 = performance.now();
  const table = makeTable(n);
  const t1 = performance.now();
  const ix = new CrossIndex();
  ix.load(table);
  for (const [id, spec] of Object.entries(dims)) {
    ix.addDimension(id, spec);
    ix.addGroup(id, id, { op: "count" });
  }
  const t2 = performance.now();
  const run = { rows: n, dimensions: Object.keys(dims).length, generateMs: t1 - t0, indexMs: t2 - t1, gestures: [] };
  console.log(`\n${n.toLocaleString("en-US")} rows, ${run.dimensions} dimensions, indexed in ${fmt(run.indexMs)} ms`);
  console.log(
    `${"gesture".padEnd(44)} ${"start".padStart(8)} ${"p50".padStart(8)} ${"p95".padStart(8)} ${"p99".padStart(8)} ${"max".padStart(8)} ${"build".padStart(6)}  (ms)`,
  );

  let version = 0;
  for (const g of gestures) {
    // Start each gesture cold: a filter on another chart drops any cached tiles.
    ix.update({ fall: { in: ["Fell"] } }, version++);
    ix.update({}, version++);
    if (g.base) ix.update(g.base, version++);
    const times = [];
    let building = 0;
    for (let f = 0; f < frames; f++) {
      const filters = g.frame(f);
      const start = performance.now();
      ix.update(filters, version++);
      times.push(performance.now() - start);
      if (ix.pending) building++;
      if (idle > 0) ix.work(idle);
    }
    const startMs = times[0];
    const drag = times.slice(1).sort((a, b) => a - b);
    const row = {
      name: g.name,
      startMs,
      p50: pct(drag, 0.5),
      p95: pct(drag, 0.95),
      p99: pct(drag, 0.99),
      max: drag[drag.length - 1],
      buildFrames: building,
    };
    run.gestures.push(row);
    console.log(
      `${g.name.padEnd(44)} ${[row.startMs, row.p50, row.p95, row.p99, row.max].map((v) => fmt(v).padStart(8)).join(" ")} ${String(building).padStart(6)}`,
    );
  }
  run.peakRssMB = Math.round(process.resourceUsage().maxRSS / 1024);
  console.log(`peak memory (process so far): ${run.peakRssMB} MB`);
  report.runs.push(run);
}

if (jsonPath) writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
if (markdownPath) {
  const lines = [];
  for (const run of report.runs) {
    lines.push(
      `### ${run.rows.toLocaleString("en-US")} rows (indexed in ${fmt(run.indexMs)} ms, peak RSS ${run.peakRssMB} MB, Node ${report.node})`,
    );
    lines.push(
      "",
      "| Gesture | Start | p50 | p95 | p99 | Max | Build frames |",
      "| --- | ---: | ---: | ---: | ---: | ---: | ---: |",
    );
    for (const g of run.gestures)
      lines.push(`| ${g.name} | ${[g.startMs, g.p50, g.p95, g.p99, g.max].map(fmt).join(" | ")} | ${g.buildFrames} |`);
    lines.push(
      "",
      `Milliseconds per \`update()\`. Start is the first frame of the gesture; percentiles are over the drag. Each frame is followed by ${report.idle} ms of idle \`work()\`; build frames ran while 2-D tiles were still being built.`,
      "",
    );
  }
  writeFileSync(markdownPath, lines.join("\n"));
}
