# Data

A dashboard works on one table. You can hand it row objects, which crossplot converts once, or build
the columns yourself.

## Row objects

The simplest input is an array of plain objects:

```ts
const dash = await createDashboard({
  data: [
    { date: new Date("2025-03-01"), hour: 8.5, delay: 12, carrier: "Polar" },
    { date: new Date("2025-03-01"), hour: 17.2, delay: -3, carrier: "Lark" },
    // ...
  ],
});
```

Each field's type is inferred from its first non-missing value:

| First value | Column type | Stored as |
| --- | --- | --- |
| `number` | number | `Float64Array` |
| `Date` | date | `Float64Array` of epoch milliseconds |
| `string`, `boolean` | category | `Int32Array` codes into a dictionary of strings |

`null`, `undefined`, `""` and `NaN` are missing values. Field names are collected from the first 1,000
rows.

To override inference, or ingest only some fields, call `fromRows` yourself:

```ts
import { fromRows } from "@crossplot/core";

const table = fromRows(rows, {
  columns: ["year", "country", "mass"],
  types: { year: "category" }, // treat years as labels, not numbers
});
const dash = await createDashboard({ data: table });
```

## Columns

If your data is already columnar, for example JSON shaped as `{ field: [values] }` or typed arrays from
Arrow or Parquet, skip the row objects entirely. `fromColumns` takes arrays and typed arrays; typed
arrays are used as numeric columns without a copy when they are `Float64Array`s.

```ts
import { fromColumns } from "@crossplot/core";

const columns = await (await fetch("/dinosaurs.json")).json(); // { name: [...], age: [...], ... }
const dash = await createDashboard({ data: fromColumns(columns) });
```

The [dinosaur demo](/demo/){target="_self"} loads its 21,253 rows this way: one JSON object of arrays,
which is smaller to ship and faster to parse than an array of objects.

## Typing columnar data

`createDashboard` takes its field names from the row type. With `fromColumns` there are no row objects
to infer from, so pass the row type explicitly:

```ts
type Columns = { name: string[]; age: number[]; country: (string | null)[] };
type Row = { [K in keyof Columns]: Columns[K][number] };

const dash = await createDashboard<Row>({ data: fromColumns(columns) });
```

## Limits

Each dashboard holds up to 32 dimensions (one bit per dimension per row) and a dimension holds up to
about a million bins. Tables of a few million rows are comfortable; see [the engine](./engine) for
timings.
