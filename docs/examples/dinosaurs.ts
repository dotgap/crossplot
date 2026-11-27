/**
 * Dinosaur fossil finds for the live examples: 21,253 records from the Paleobiology Database
 * (paleobiodb.org, CC BY 4.0), the same data as the dinosaur demo with only the columns charted here.
 * The JSON is one object of arrays, which `fromColumns` takes as it is.
 */
// A type alias rather than an interface: column types need to be assignable to Record<string, Value[]>.
export type Dinosaurs = {
  /** When the animal lived, in millions of years ago (the midpoint of the rock's dated range). */
  age: number[];
  /** Broad group, such as "Theropods" or "Long-necks". */
  group: string[];
  /** "Plant-eater", "Meat-eater", "Omnivore" or "Unknown". */
  diet: string[];
  /** Country of the find. */
  country: (string | null)[];
  /** Year the find was published. */
  reported: (number | null)[];
  /** Where the find was made, in degrees. */
  lng: number[];
  lat: number[];
};

/** Groups in a fixed order, with one color each that reads on light and dark backgrounds. */
export const GROUP_COLORS: Record<string, string> = {
  Theropods: "#d1435b",
  "Long-necks": "#3b6cf0",
  "Duck-bills and kin": "#13a39b",
  "Horned and dome-headed": "#d39a00",
  "Armored and plated": "#7a5cd6",
  "Not identified": "#9a9ea8",
};

/** Diets, colored to match the groups that mostly have them. */
export const DIET_COLORS: Record<string, string> = {
  "Plant-eater": "#13a39b",
  "Meat-eater": "#d1435b",
  Omnivore: "#d39a00",
  Unknown: "#9a9ea8",
};

let cached: Promise<Dinosaurs> | undefined;

/** Fetch the columns once per page; every example shares them. */
export function loadDinosaurs(): Promise<Dinosaurs> {
  cached ??= fetch(`${import.meta.env.BASE_URL}dinosaurs.json`).then((r) => {
    if (!r.ok) throw new Error(`dinosaurs.json: ${r.status}`);
    return r.json() as Promise<Dinosaurs>;
  });
  return cached;
}
