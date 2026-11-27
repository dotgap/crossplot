// Builds public/dinosaurs.json from the Paleobiology Database (PBDB, CC BY 4.0):
// every recorded occurrence of a non-bird dinosaur, with plain-language
// columns derived for the demo.
//
// Each find also gets the place it lay when the animal died: its modern
// coordinates rotated back to its age with the Merdith et al. (2021) plate
// model, through the GPlates Web Service (gws.gplates.org). The map's ancient
// coastlines (scripts/prepare-coasts.mjs) come from the same model.
//
//   node scripts/prepare-data.mjs                                # download everything
//   node scripts/prepare-data.mjs occs.csv taxa.csv [paleo.csv]  # use saved files
//
// paleo.csv has the columns occurrence_no,age,plng,plat (as this script
// would compute them); without it the positions are downloaded.
import { readFile, writeFile } from "node:fs/promises";

const API = "https://paleobiodb.org/data1.2";
const OCCS_URL = `${API}/occs/list.csv?base_name=Dinosauria%5EAves&show=class,coords,loc,strat,env,ecospace,ref&limit=all`;
const TAXA_URL = `${API}/taxa/list.csv?base_name=Dinosauria%5EAves&show=attr,ecospace,size,app&limit=all`;

const [occsPath, taxaPath, paleoPath] = process.argv.slice(2);
const load = async (path, url) => (path ? readFile(path, "utf8") : (await fetch(url)).text());
const [occsText, taxaText] = await Promise.all([load(occsPath, OCCS_URL), load(taxaPath, TAXA_URL)]);

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes). */
function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quoted) {
      if (c === '"' && input[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && input[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function records(text) {
  const [header, ...body] = parseCsv(text).filter((r) => r.length > 1);
  return body.map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
}

const occs = records(occsText);
const taxa = records(taxaText);

// --- Where each find lay when the animal died --------------------------------
/** A find's age for the rotation: the middle of its dated range, in whole millions of years. */
const midAge = (o) => Math.round((Number(o.max_ma) + Number(o.min_ma)) / 2);

async function rotate() {
  const byAge = new Map();
  for (const o of occs) {
    if (o.lng === "" || o.lat === "") continue;
    const age = midAge(o);
    if (!byAge.has(age)) byAge.set(age, new Map());
    byAge.get(age).set(`${o.lng},${o.lat}`, null);
  }
  for (const [age, points] of byAge) {
    const keys = [...points.keys()];
    for (let i = 0; i < keys.length; i += 150) {
      const chunk = keys.slice(i, i + 150);
      const url = `https://gws.gplates.org/reconstruct/reconstruct_points/?points=${chunk.join(",")}&time=${age}&model=MERDITH2021&return_null_points`;
      const res = await (await fetch(url)).json();
      // With return_null_points the service keeps the input order.
      const coords = res.coordinates ?? res.geometries?.map((g) => g?.coordinates ?? null) ?? [];
      for (const [j, k] of chunk.entries()) points.set(k, coords[j] ?? null);
    }
  }
  const out = new Map();
  for (const o of occs) {
    const p = byAge.get(midAge(o))?.get(`${o.lng},${o.lat}`);
    if (p) out.set(o.occurrence_no, [p[0], p[1]]);
  }
  return out;
}

async function paleoPositions() {
  if (!paleoPath) return rotate();
  const out = new Map();
  for (const r of records(await readFile(paleoPath, "utf8"))) {
    if (r.plng !== "" && r.plat !== "") out.set(r.occurrence_no, [Number(r.plng), Number(r.plat)]);
  }
  return out;
}
const paleo = await paleoPositions();
const coord = (v) => (v === "" || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * 100) / 100);

// --- Taxonomy: walk each taxon up to the clades we care about ----------------
const byNo = new Map();
for (const t of taxa) {
  byNo.set(t.orig_no, t);
  byNo.set(t.taxon_no, t);
}

/** Lineage names from a taxon up to the root, following parent numbers. */
const lineageCache = new Map();
function lineage(no) {
  if (lineageCache.has(no)) return lineageCache.get(no);
  const names = [];
  const seen = new Set();
  for (let t = byNo.get(no); t && !seen.has(t.orig_no); t = byNo.get(t.parent_no)) {
    seen.add(t.orig_no);
    names.push(t.accepted_name || t.taxon_name);
  }
  lineageCache.set(no, names);
  return names;
}

const BIRDS = ["Avialae", "Aves", "Neornithes", "Ornithurae", "Ornithuromorpha", "Enantiornithes", "Pygostylia"];
const GROUPS = [
  ["Theropoda", "Theropods"],
  ["Sauropodomorpha", "Long-necks"],
  ["Ornithopoda", "Duck-bills and kin"],
  ["Marginocephalia", "Horned and dome-headed"],
  ["Ceratopsia", "Horned and dome-headed"],
  ["Pachycephalosauria", "Horned and dome-headed"],
  ["Thyreophora", "Armored and plated"],
  ["Ankylosauria", "Armored and plated"],
  ["Stegosauria", "Armored and plated"],
];

function group(names) {
  for (const [clade, label] of GROUPS) if (names.includes(clade)) return label;
  return "Not identified";
}

function diet(raw) {
  if (!raw) return "Unknown";
  if (raw.includes("omnivore") || (raw.includes("herbivore") && raw.includes("carnivore"))) return "Omnivore";
  if (/herbivore|browser|frugivore|granivore|grazer/.test(raw)) return "Plant-eater";
  if (/carnivore|piscivore|insectivore/.test(raw)) return "Meat-eater";
  return "Unknown";
}

// Trace fossils: footprints (ichnotaxa) and eggs (ootaxa) have their own names.
function kind(o, names) {
  const text = `${o.identified_name} ${names.join(" ")}`.toLowerCase();
  if (/oolith|eggshell|\beggs?\b|oolithidae/.test(text)) return "Eggs";
  if (o.flags.includes("I") || /footprint|track|ichn|pus\b|pes\b|podus|grallator|eubrontes|anomoepus/.test(text))
    return "Footprints";
  return "Bones and teeth";
}

const ENVIRONMENTS = [
  [/eolian|dune|interdune|sand sheet/, "Deserts and dunes"],
  [/cave|fissure|karst/, "Caves and fissures"],
  [/lacustrine|pond|mire|swamp|spring/, "Lakes and swamps"],
  [
    /estuar|delta|lagoon|peritidal|paralic|coastal|marginal marine|shoreface|foreshore|tidal|beach|bay/,
    "Coasts and deltas",
  ],
  [/marine|subtidal|offshore|carbonate|reef|basin|slope|shelf/, "Open sea"],
  [/fluvial|channel|floodplain|crevasse|levee|alluvial|point bar|braided|meander/, "Rivers and floodplains"],
];

function environment(raw) {
  const e = raw.toLowerCase();
  for (const [re, label] of ENVIRONMENTS) if (re.test(e)) return label;
  return "Not recorded";
}

// PBDB uses "UK" where ISO uses "GB".
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
function country(cc) {
  if (!cc) return null;
  const code = cc === "UK" ? "GB" : cc;
  try {
    const name = regionNames.of(code);
    return name === code ? cc : name;
  } catch {
    return cc;
  }
}

const SHORT_COUNTRY = { "United States": "USA", "United Kingdom": "UK" };

/**
 * Year of the publication that recorded the find, from "A. Author. 1998. Title…".
 * A few compilations are dated in the future; those have no real year.
 */
const THIS_YEAR = new Date().getUTCFullYear();
function reportedYear(ref) {
  const m = ref.match(/\.\s(1[89]\d\d|20\d\d)[a-z]?\.\s/) ?? ref.match(/\b(1[89]\d\d|20\d\d)\b/);
  const year = m ? Number(m[1]) : null;
  return year !== null && year <= THIS_YEAR ? year : null;
}

/**
 * A stable pseudo-random number in [0, 1) from an occurrence number, so the
 * same find lands in the same place every time the script runs.
 */
function unit(id) {
  let h = 2166136261;
  for (const ch of String(id)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

const out = {
  name: [],
  genus: [],
  group: [],
  diet: [],
  kind: [],
  age: [],
  oldest: [],
  youngest: [],
  country: [],
  formation: [],
  environment: [],
  reported: [],
  lng: [],
  lat: [],
  plng: [],
  plat: [],
};

let birds = 0;
for (const o of occs) {
  const names = lineage(o.accepted_no);
  if (names.some((n) => BIRDS.includes(n))) {
    birds++;
    continue;
  }
  const max = Number(o.max_ma);
  const min = Number(o.min_ma);
  // Non-bird dinosaurs end at 66 million years ago; younger rows are birds or reworked fossils.
  if (!(min >= 65)) {
    birds++;
    continue;
  }
  const c = country(o.cc);
  out.name.push(o.accepted_name || o.identified_name);
  out.genus.push(o.genus || null);
  out.group.push(group(names));
  out.diet.push(diet(o.diet));
  out.kind.push(kind(o, names));
  // Most finds are dated only to a geological stage, millions of years long.
  // Placing each one at a random point inside its range spreads them the way
  // the evidence allows, instead of piling every find onto the stage's middle.
  out.age.push(Math.round((min + unit(o.occurrence_no) * (max - min)) * 10) / 10);
  out.oldest.push(max);
  out.youngest.push(min);
  out.country.push(c ? (SHORT_COUNTRY[c] ?? c) : null);
  out.formation.push(o.formation || null);
  out.environment.push(environment(o.environment));
  out.reported.push(reportedYear(o.primary_reference));
  out.lng.push(coord(o.lng));
  out.lat.push(coord(o.lat));
  const p = paleo.get(o.occurrence_no);
  out.plng.push(p ? coord(p[0]) : null);
  out.plat.push(p ? coord(p[1]) : null);
}

await writeFile(new URL("../public/dinosaurs.json", import.meta.url), JSON.stringify(out));
console.log(`Wrote ${out.name.length} occurrences (skipped ${birds} bird or post-Mesozoic rows)`);
