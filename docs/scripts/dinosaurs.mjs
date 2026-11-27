// Builds public/dinosaurs.json for the live examples: a slice of the dinosaur demo's data
// (examples/dinosaurs/public/dinosaurs.json, from the Paleobiology Database, CC BY 4.0) with only
// the columns the examples chart, rounded to keep the file small. Run with `pnpm --filter docs data`.
import { readFile, writeFile } from "node:fs/promises";

const src = JSON.parse(
  await readFile(new URL("../../examples/dinosaurs/public/dinosaurs.json", import.meta.url), "utf8"),
);
const round = (digits) => (v) => (v == null ? null : Math.round(v * 10 ** digits) / 10 ** digits);
const keep = (v) => v;

const columns = { age: round(1), group: keep, diet: keep, country: keep, reported: keep, lng: round(1), lat: round(1) };
const out = Object.fromEntries(Object.entries(columns).map(([name, f]) => [name, src[name].map(f)]));

await writeFile(new URL("../public/dinosaurs.json", import.meta.url), JSON.stringify(out));
console.log(`${out.age.length} rows, ${Object.keys(out).length} columns`);
