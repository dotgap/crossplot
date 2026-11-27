/**
 * Synthetic flight records for the live examples, generated in the browser from a fixed seed so every
 * visitor sees the same numbers. The shape follows the classic crossfilter demo: departure hour,
 * delay, distance, date, carrier and origin airport. None of it is real.
 */
// A type alias rather than an interface: row types need to be assignable to Record<string, Value>.
export type Flight = {
  /** Departure date, at midnight UTC. */
  date: Date;
  /** Scheduled departure, in hours since midnight (0 to 24). */
  hour: number;
  /** Arrival delay in minutes; negative is early. */
  delay: number;
  /** Distance in miles. */
  distance: number;
  carrier: string;
  origin: string;
};

export const CARRIERS = ["Bluebird", "Northwind", "Meridian", "Polar", "Cascade", "Harbor", "Summit", "Lark"];

// Origin airports, busiest first; picked with a Zipf-like weight so top-N has a long tail to fold.
const ORIGINS = [
  "ATL",
  "DFW",
  "DEN",
  "ORD",
  "LAX",
  "JFK",
  "LAS",
  "MCO",
  "MIA",
  "CLT",
  "SEA",
  "PHX",
  "EWR",
  "SFO",
  "IAH",
  "BOS",
  "FLL",
  "MSP",
  "LGA",
  "DTW",
  "PHL",
  "SLC",
  "BWI",
  "DCA",
  "SAN",
  "IAD",
  "TPA",
  "BNA",
  "AUS",
  "MDW",
];

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Generate `n` flights. The same `n` and `seed` always give the same rows. */
export function flights(n = 40_000, seed = 7): Flight[] {
  const rand = mulberry32(seed);
  const normal = () => {
    const u = 1 - rand();
    const v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  const originWeights = ORIGINS.map((_, i) => 1 / (i + 1) ** 0.9);
  const originTotal = originWeights.reduce((a, b) => a + b, 0);
  const pick = (r: number) => {
    let acc = 0;
    for (let i = 0; i < ORIGINS.length; i++) {
      acc += originWeights[i]! / originTotal;
      if (r < acc) return ORIGINS[i]!;
    }
    return ORIGINS[ORIGINS.length - 1]!;
  };
  const start = Date.UTC(2025, 0, 1);
  const rows: Flight[] = new Array(n);
  for (let i = 0; i < n; i++) {
    // Two departure waves, morning and late afternoon.
    const wave = rand() < 0.55 ? 8.5 : 17;
    const hour = Math.min(23.99, Math.max(5, wave + normal() * 2.6));
    // Delays grow through the day and are heavier in summer and around the holidays.
    const day = Math.floor(rand() * 365);
    const season = Math.cos(((day - 190) / 365) * 2 * Math.PI) * 0.5 + (day > 350 ? 0.8 : 0);
    const late = rand() < 0.18 + 0.012 * (hour - 5) + 0.06 * season;
    const delay = late ? Math.round(10 + Math.exp(2.6 + normal() * 0.9)) : Math.round(normal() * 7 - 4);
    const distance = Math.round(Math.min(2700, Math.max(90, Math.exp(6.4 + normal() * 0.7))));
    const carrier = CARRIERS[Math.floor(rand() ** 1.4 * CARRIERS.length)]!;
    rows[i] = {
      date: new Date(start + day * 86_400_000),
      hour,
      delay: Math.min(delay, 300),
      distance,
      carrier,
      origin: pick(rand()),
    };
  }
  return rows;
}
