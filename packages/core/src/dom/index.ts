/**
 * Plain-DOM widgets that need no plotting library. Kept out of the main entry
 * so `@crossplot/core` stays headless.
 *
 * @module @crossplot/core/dom
 */
import type { Dashboard } from "../dashboard.js";
import type { Value } from "../types.js";

function resolve(target: string | HTMLElement): HTMLElement {
  const el = typeof target === "string" ? document.querySelector<HTMLElement>(target) : target;
  if (!el) throw new Error(`No element matches "${String(target)}"`);
  return el;
}

const nf = new Intl.NumberFormat("en-US");

/** Options for {@link countDisplay}. */
export interface CountOptions {
  /** Custom text. Default: "1,234 of 45,716 rows selected". */
  format?: (selected: number, total: number) => string;
  /** Show a "Reset all" button while any filter is active. Default true. */
  reset?: boolean;
}

/** "N of M rows selected" with a reset-all button. Returns a cleanup function. */
export function countDisplay(
  // biome-ignore lint/suspicious/noExplicitAny: works with any row type.
  dash: Dashboard<any>,
  target: string | HTMLElement,
  options: CountOptions = {},
): () => void {
  const el = resolve(target);
  el.classList.add("crossplot-count");
  const text = document.createElement("span");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Reset all";
  button.className = "crossplot-reset";
  button.addEventListener("click", () => dash.filters.clear());
  el.replaceChildren(text);
  if (options.reset !== false) el.append(" ", button);
  const format = options.format ?? ((s, t) => `${nf.format(s)} of ${nf.format(t)} rows selected`);
  const off = dash.onUpdate(({ selected, total }) => {
    text.textContent = format(selected, total);
    button.hidden = Object.keys(dash.filters.snapshot.filters).length === 0;
  });
  return () => {
    off();
    el.replaceChildren();
  };
}

/** One column of a {@link dataTable}. */
export interface TableColumn {
  /** The row field to show. */
  field: string;
  /** Header text. Defaults to the field name. */
  label?: string;
  /** Cell text. Defaults to a locale number, an ISO date or the string value. */
  format?: (value: Value) => string;
}

/** Options for {@link dataTable}. */
export interface TableOptions {
  /** Field names, or column objects with a label and format. */
  columns: ReadonlyArray<string | TableColumn>;
  /** Initial sort, "-field" for descending. */
  sort?: string;
  /** Rows per page. Default 25. */
  pageSize?: number;
}

function defaultFormat(v: Value): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") return nf.format(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v);
}

/** A sortable, paged table of the rows passing every filter. Returns a cleanup function. */
export function dataTable(
  // biome-ignore lint/suspicious/noExplicitAny: works with any row type.
  dash: Dashboard<any>,
  target: string | HTMLElement,
  options: TableOptions,
): () => void {
  const el = resolve(target);
  const columns: TableColumn[] = options.columns.map((c) => (typeof c === "string" ? { field: c } : c));
  const pageSize = options.pageSize ?? 25;
  let sort = options.sort;
  let page = 0;
  let token = 0;

  const table = document.createElement("table");
  table.className = "crossplot-table";
  const thead = table.createTHead();
  const tbody = table.createTBody();
  const pager = document.createElement("div");
  pager.className = "crossplot-pager";
  const prev = document.createElement("button");
  const next = document.createElement("button");
  const status = document.createElement("span");
  prev.type = next.type = "button";
  prev.textContent = "Previous";
  next.textContent = "Next";
  pager.append(prev, " ", status, " ", next);
  el.replaceChildren(table, pager);

  const headRow = thead.insertRow();
  const headers = columns.map((c) => {
    const th = document.createElement("th");
    th.scope = "col";
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = c.label ?? c.field;
    b.addEventListener("click", () => {
      sort = sort === `-${c.field}` ? c.field : `-${c.field}`;
      page = 0;
      void render();
    });
    th.append(b);
    headRow.append(th);
    return th;
  });

  prev.addEventListener("click", () => {
    page = Math.max(0, page - 1);
    void render();
  });
  next.addEventListener("click", () => {
    page++;
    void render();
  });

  const render = async () => {
    const mine = ++token;
    const { rows, selected } = await dash.rows({
      columns: columns.map((c) => c.field),
      ...(sort ? { sort } : {}),
      limit: pageSize,
      offset: page * pageSize,
    });
    if (mine !== token) return;
    const pages = Math.max(1, Math.ceil(selected / pageSize));
    if (page >= pages) {
      page = pages - 1;
      return render();
    }
    columns.forEach((c, i) => {
      const dir = sort === c.field ? "ascending" : sort === `-${c.field}` ? "descending" : "none";
      headers[i]!.setAttribute("aria-sort", dir);
    });
    tbody.replaceChildren(
      ...rows.map((row) => {
        const tr = document.createElement("tr");
        for (const c of columns) {
          const td = document.createElement("td");
          td.textContent = (c.format ?? defaultFormat)(row[c.field]);
          tr.append(td);
        }
        return tr;
      }),
    );
    status.textContent = `Page ${page + 1} of ${pages}`;
    prev.disabled = page === 0;
    next.disabled = page >= pages - 1;
  };

  const off = dash.onUpdate(() => {
    page = 0;
    void render();
  });
  return () => {
    off();
    token++;
    el.replaceChildren();
  };
}
