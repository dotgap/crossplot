// Bundles each public entry point with esbuild (minified, peers external) and checks the
// gzipped size against the budgets in size-limits.json. Run after `pnpm build`.
import { appendFileSync, readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { build } from "esbuild";
import { compileModule } from "svelte/compiler";

const root = new URL("../", import.meta.url);
const limits = JSON.parse(readFileSync(new URL("size-limits.json", import.meta.url), "utf8"));
const kb = (bytes) => `${(bytes / 1024).toFixed(2)} kB`;

// Svelte bindings ship runes in `*.svelte.js`; measure what the app's Svelte compiler turns them into.
const svelteModules = {
  name: "svelte-modules",
  setup(b) {
    b.onLoad({ filter: /\.svelte\.js$/ }, ({ path }) => ({
      contents: compileModule(readFileSync(path, "utf8"), { filename: path, generate: "client" }).js.code,
      loader: "js",
    }));
  },
};

let failed = false;
const rows = [];
for (const { name, entry, external = [], limit } of limits) {
  const result = await build({
    entryPoints: [new URL(entry, root).pathname],
    bundle: true,
    minify: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    external,
    plugins: [svelteModules],
    write: false,
    logLevel: "silent",
  });
  const code = result.outputFiles[0].contents;
  const gzip = gzipSync(code, { level: 9 }).length;
  const budget = Number.parseFloat(limit) * 1024;
  const over = gzip > budget;
  failed ||= over;
  rows.push({ name, minified: kb(code.length), gzip: kb(gzip), limit, status: over ? "OVER" : "ok" });
}

console.table(rows);
if (process.env.GITHUB_STEP_SUMMARY) {
  const lines = ["| Entry | Minified | Gzip | Limit | |", "| --- | --- | --- | --- | --- |"];
  for (const r of rows) lines.push(`| \`${r.name}\` | ${r.minified} | ${r.gzip} | ${r.limit} | ${r.status} |`);
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### Bundle size\n\n${lines.join("\n")}\n`);
}
if (failed) {
  console.error("Bundle size budget exceeded. Shrink the code or raise the limit in scripts/size-limits.json.");
  process.exit(1);
}
