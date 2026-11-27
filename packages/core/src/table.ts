import type { CategoryColumn, Column, ColumnTable, NumberColumn, Row, Value } from "./types.js";

export type ColumnType = "number" | "date" | "category";

export interface FromRowsOptions {
  /** Force a type per column instead of inferring it from the first non-missing value. */
  readonly types?: Readonly<Record<string, ColumnType>>;
  /** Only ingest these fields. Defaults to every key seen in the first 1,000 rows. */
  readonly columns?: readonly string[];
}

function isMissing(v: Value): boolean {
  return v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v));
}

function inferType(rows: readonly Row[], field: string): ColumnType {
  for (const row of rows) {
    const v = row[field];
    if (isMissing(v)) continue;
    if (typeof v === "number") return "number";
    if (v instanceof Date) return "date";
    return "category";
  }
  return "number";
}

function toNumber(v: Value): number {
  if (isMissing(v)) return Number.NaN;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "boolean") return v ? 1 : 0;
  return typeof v === "number" ? v : Number(v);
}

/** Dictionary-encode string-ish values. Codes are in first-seen order; -1 is missing. */
export function encodeCategories(values: Iterable<Value>, length: number): CategoryColumn {
  const codes = new Int32Array(length);
  const dictionary: string[] = [];
  const lookup = new Map<string, number>();
  let i = 0;
  for (const v of values) {
    if (isMissing(v)) {
      codes[i++] = -1;
      continue;
    }
    const key = v instanceof Date ? v.toISOString() : String(v);
    let code = lookup.get(key);
    if (code === undefined) {
      code = dictionary.length;
      dictionary.push(key);
      lookup.set(key, code);
    }
    codes[i++] = code;
  }
  return { type: "category", codes, dictionary };
}

/** Convert row objects to a column table, once, up front. */
export function fromRows(rows: readonly Row[], options: FromRowsOptions = {}): ColumnTable {
  const fields = options.columns ?? collectFields(rows);
  const columns: Record<string, Column> = {};
  for (const field of fields) {
    const type = options.types?.[field] ?? inferType(rows, field);
    if (type === "category") {
      columns[field] = encodeCategories(
        (function* () {
          for (const r of rows) yield r[field];
        })(),
        rows.length,
      );
    } else {
      const values = new Float64Array(rows.length);
      for (let i = 0; i < rows.length; i++) values[i] = toNumber(rows[i]![field]);
      columns[field] = { type, values } satisfies NumberColumn;
    }
  }
  return { rowCount: rows.length, columns };
}

function collectFields(rows: readonly Row[]): string[] {
  const seen = new Set<string>();
  const n = Math.min(rows.length, 1000);
  for (let i = 0; i < n; i++) for (const k of Object.keys(rows[i]!)) seen.add(k);
  return [...seen];
}

export type ColumnInput =
  | Float64Array
  | Float32Array
  | Int32Array
  | Uint32Array
  | Int16Array
  | Uint16Array
  | Int8Array
  | Uint8Array
  | readonly Value[]
  | Column;

/**
 * Build a table from column arrays. Typed arrays become numeric columns,
 * arrays are inferred like `fromRows`.
 */
export function fromColumns(input: Readonly<Record<string, ColumnInput>>): ColumnTable {
  const columns: Record<string, Column> = {};
  let rowCount = -1;
  for (const [field, data] of Object.entries(input)) {
    const col = toColumn(data);
    const len = col.type === "category" ? col.codes.length : col.values.length;
    if (rowCount === -1) rowCount = len;
    else if (len !== rowCount) {
      throw new Error(`Column "${field}" has ${len} rows, expected ${rowCount}`);
    }
    columns[field] = col;
  }
  return { rowCount: Math.max(rowCount, 0), columns };
}

function toColumn(data: ColumnInput): Column {
  if (ArrayBuffer.isView(data)) {
    const values = data instanceof Float64Array ? data : Float64Array.from(data as ArrayLike<number>);
    return { type: "number", values };
  }
  if (!Array.isArray(data)) return data as Column;
  const arr = data as readonly Value[];
  const first = arr.find((v) => !isMissing(v));
  if (typeof first === "string" || typeof first === "boolean") return encodeCategories(arr, arr.length);
  const values = new Float64Array(arr.length);
  for (let i = 0; i < arr.length; i++) values[i] = toNumber(arr[i]);
  return { type: first instanceof Date ? "date" : "number", values };
}

/** Accepts anything `createDashboard` takes as data. */
export function toTable(data: ColumnTable | readonly Row[]): ColumnTable {
  if (Array.isArray(data)) return fromRows(data as readonly Row[]);
  return data as ColumnTable;
}

/** Read one cell back as a plain value (used for row queries). */
export function cell(col: Column, i: number): Value {
  if (col.type === "category") {
    const c = col.codes[i]!;
    return c < 0 ? null : col.dictionary[c]!;
  }
  const v = col.values[i]!;
  if (Number.isNaN(v)) return null;
  return col.type === "date" ? new Date(v) : v;
}
