// Builds public/coasts.json: simplified coastlines for the map, today and at
// several moments in the past.
//
// - Today: Natural Earth 1:110m land (public domain), as GeoJSON. Convert the
//   world-atlas package's land-110m.json with topojson-client:
//     npx -p topojson-client topo2geo land=land.json < land-110m.json
// - The past: coastlines reconstructed with the Merdith et al. (2021) plate
//   model through the GPlates Web Service (CC BY 4.0), the same model the
//   demo uses to place each find where it lay when the animal died.
//
//   node scripts/prepare-coasts.mjs land.json [dir-with-coast-merdith-<T>.json]
//
// Without a directory, the reconstructions are downloaded from gws.gplates.org.
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const TIMES = [230, 200, 170, 150, 125, 100, 80, 66];
const TOLERANCE = 0.45; // degrees
const MIN_AREA = 1.5; // square degrees

const [landPath, dir] = process.argv.slice(2);
if (!landPath) throw new Error("usage: prepare-coasts.mjs land.json [coast-dir]");

const load = async (time) => {
  if (dir) return JSON.parse(await readFile(join(dir, `coast-merdith-${time}.json`), "utf8"));
  const url = `https://gws.gplates.org/reconstruct/coastlines/?time=${time}&model=MERDITH2021`;
  return (await fetch(url)).json();
};

/** Polygons of any GeoJSON object, as arrays of rings. */
function polygons(geo) {
  if (geo.type === "FeatureCollection") return geo.features.flatMap((f) => polygons(f.geometry));
  if (geo.type === "Feature") return polygons(geo.geometry);
  if (geo.type === "GeometryCollection") return geo.geometries.flatMap(polygons);
  if (geo.type === "Polygon") return [geo.coordinates];
  if (geo.type === "MultiPolygon") return geo.coordinates;
  return [];
}

/** Douglas–Peucker on one ring. */
function simplify(ring, tol) {
  if (ring.length < 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = ring[a];
    const [bx, by] = ring[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let worst = -1;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const [px, py] = ring[i];
      const d =
        len === 1 && dx === 0 && dy === 0
          ? Math.hypot(px - ax, py - ay)
          : Math.abs(dy * px - dx * py + bx * ay - by * ax) / len;
      if (d > worst) {
        worst = d;
        at = i;
      }
    }
    if (worst > tol) {
      keep[at] = 1;
      stack.push([a, at], [at, b]);
    }
  }
  return ring.filter((_, i) => keep[i]);
}

function area(ring) {
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++)
    s += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  return Math.abs(s / 2);
}

const round = (v) => Math.round(v * 10) / 10;

/**
 * Planar maps can't draw a ring that crosses the date line: it would streak
 * across the whole map. A ring that circles a pole crosses it once; close it
 * along the pole instead. A ring that crosses twice is made continuous past
 * ±180°, with a copy shifted by a full turn, so each side of the map shows its
 * half (the map clips the rest).
 */
function unwrap(poly) {
  const jumps = (r) => r.filter((p, i) => i > 0 && Math.abs(p[0] - r[i - 1][0]) > 180).length;
  if (!poly.some((r) => jumps(r) > 0)) return [poly];
  const fixed = poly.map((r) => {
    if (jumps(r) === 1) {
      const out = [];
      for (const [i, p] of r.entries()) {
        const q = r[i - 1];
        if (q && Math.abs(p[0] - q[0]) > 180) {
          const pole = p[1] < 0 ? -90 : 90;
          out.push([q[0] > 0 ? 180 : -180, pole], [p[0] > 0 ? 180 : -180, pole]);
        }
        out.push(p);
      }
      return { ring: out, wraps: false };
    }
    let shift = 0;
    const out = r.map((p, i) => {
      const q = r[i - 1];
      if (q && Math.abs(p[0] - q[0]) > 180) shift += q[0] > p[0] ? 360 : -360;
      return [p[0] + shift, p[1]];
    });
    return { ring: out, wraps: true };
  });
  const rings = fixed.map((f) => f.ring);
  if (!fixed.some((f) => f.wraps)) return [rings];
  const turn = (k) => rings.map((r) => r.map(([x, y]) => [x + k, y]));
  return [rings, turn(-360), turn(360)];
}

function compact(geo) {
  const out = [];
  for (const poly of polygons(geo).flatMap(unwrap)) {
    const rings = poly
      .map((r) => simplify(r, TOLERANCE).map(([x, y]) => [round(x), round(y)]))
      .filter((r) => r.length >= 4 && area(r) >= MIN_AREA);
    // Drop the polygon if its outer ring went.
    if (rings.length && poly[0] && area(poly[0]) >= MIN_AREA) out.push(rings);
  }
  return { type: "MultiPolygon", coordinates: out };
}

const shapes = { 0: compact(JSON.parse(await readFile(landPath, "utf8"))) };
for (const t of TIMES) shapes[t] = compact(await load(t));

await writeFile(new URL("../public/coasts.json", import.meta.url), JSON.stringify(shapes));
const points = Object.values(shapes).reduce((n, g) => n + g.coordinates.flat(2).length, 0);
console.log(`Wrote ${Object.keys(shapes).length} coastlines, ${points} points`);
